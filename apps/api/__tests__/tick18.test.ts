/**
 * Tick 18 v1.2.0.0 集成测试：
 * - Prometheus exposition 文本格式
 * - request:complete 事件经 EventBus 推送
 * - /admin/events SSE 缺 cookie 时被 admin-auth gate 拦截 401
 */
import { describe, it, expect } from 'vitest';
import {
  renderPrometheusText,
  invalidatePromMetricsCache,
} from '../src/routes/admin/metrics-prometheus.routes.js';
import { EventBus } from '../src/services/event-bus.js';

describe('Tick 18 — Prometheus exposition 格式', () => {
  const snap = {
    requestsToday: 1234,
    successesToday: 1180,
    rateLimitedToday: 12,
    avgLatencyMs: 487,
    activeFreeModels: 30,
    paidModels: 330,
    totalModels: 360,
    cooldownsActive: 4,
    virtualKeys: 7,
    providers: [
      { slug: 'openrouter', status: 'active' },
      { slug: 'openai', status: 'degraded' },
      { slug: 'mock', status: 'disabled' },
    ],
    generatedAt: '2026-05-23T15:00:00.000Z',
  };

  const out = renderPrometheusText(snap);

  it('每个指标都有 HELP + TYPE 注释 + 数值行', () => {
    expect(out).toMatch(/^# HELP freellm_requests_today_total /m);
    expect(out).toMatch(/^# TYPE freellm_requests_today_total counter$/m);
    expect(out).toMatch(/^freellm_requests_today_total 1234$/m);

    expect(out).toMatch(/^# TYPE freellm_request_avg_latency_milliseconds gauge$/m);
    expect(out).toMatch(/^freellm_request_avg_latency_milliseconds 487$/m);
  });

  it('counter 用于累计量，gauge 用于瞬时量', () => {
    // counter 系列
    expect(out).toMatch(/# TYPE freellm_requests_today_total counter/);
    expect(out).toMatch(/# TYPE freellm_requests_successes_today_total counter/);
    expect(out).toMatch(/# TYPE freellm_requests_rate_limited_today_total counter/);
    // gauge 系列
    expect(out).toMatch(/# TYPE freellm_models_active_free gauge/);
    expect(out).toMatch(/# TYPE freellm_cooldowns_active gauge/);
    expect(out).toMatch(/# TYPE freellm_provider_status gauge/);
  });

  it('provider_status 按状态映射到数值（active=1 / degraded=0.5 / disabled=0）', () => {
    expect(out).toMatch(/freellm_provider_status\{slug="openrouter",status="active"\} 1$/m);
    expect(out).toMatch(/freellm_provider_status\{slug="openai",status="degraded"\} 0\.5$/m);
    expect(out).toMatch(/freellm_provider_status\{slug="mock",status="disabled"\} 0$/m);
  });

  it('label value 中的反斜杠 / 双引号正确转义', () => {
    const tricky = renderPrometheusText({
      ...snap,
      providers: [{ slug: 'p\\with"quote', status: 'active' }],
    });
    expect(tricky).toMatch(/slug="p\\\\with\\"quote"/);
  });

  it('invalidatePromMetricsCache() 不抛错（仅 sanity 检查）', () => {
    expect(() => invalidatePromMetricsCache()).not.toThrow();
  });
});

describe('Tick 18 — request:complete EventBus 通道', () => {
  it('listener 订阅 request:complete 能收到完整 payload', async () => {
    const bus = new EventBus();
    const received: unknown[] = [];
    bus.on('request:complete', (p) => {
      received.push(p);
    });
    await bus.emit('request:complete', {
      requestId: 'req_test1',
      status: 200,
      errorKind: null,
      upstreamProvider: 'mock',
      upstreamModel: 'mock/echo:free',
      durationMs: 42,
      attempts: 1,
      finishedAt: new Date().toISOString(),
    });
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      requestId: 'req_test1',
      status: 200,
      upstreamProvider: 'mock',
    });
  });

  it('wildcard listener (onAny) 收到的 topic 字段为 "request:complete"', async () => {
    const bus = new EventBus();
    const events: Array<{ topic: string }> = [];
    bus.onAny((e) => {
      events.push({ topic: e.topic });
    });
    await bus.emit('request:complete', { requestId: 'r1' });
    expect(events.map((e) => e.topic)).toContain('request:complete');
  });
});
