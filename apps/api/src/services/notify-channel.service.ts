/**
 * 告警通知渠道分发服务（组 8 Tick 5 v1.27.0.0；v1.27.1.0 加固 SSRF/timeout/静默失败）。
 *
 * 按渠道 type 分发：
 *   - email   → 外部邮件网关（HTTP mail relay，env FREELLM_MAILER_URL，POST {subject,body,source,to}），不自起 SMTP
 *   - slack   → target 作 Slack incoming webhook URL，POST { text }（先过 SSRF 校验）
 *   - webhook → target 作通用 URL，POST { subject, body, source }（先过 SSRF 校验）
 * 各 fetch 带 8s 超时；各自 try/catch 记日志；dispatchAll 用 allSettled 解耦，单渠道失败不阻断其他。
 */
import type { PrismaClient } from '@prisma/client';

// 邮件网关 URL（HTTP mail relay / SMTP-HTTP 桥）。由 env 配置，未设时回落本机默认中继端口。
const MAILER_URL = process.env.FREELLM_MAILER_URL ?? 'http://127.0.0.1:8025/api/mail/send';
const FETCH_TIMEOUT_MS = 8000;

export interface NotifyChannelLike {
  type: string;
  target: string;
  name?: string | null;
}
export interface DispatchResult {
  ok: boolean;
  detail: string;
}

/**
 * SSRF 防护：slack/webhook 的 target 是用户可控 URL，dispatch 前拒绝内网/回环/链路本地/metadata 地址。
 * 落库（POST/PATCH）与发送时双重校验。
 */
export function assertSafeTarget(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('非法 URL');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('仅允许 http/https');
  const host = u.hostname.toLowerCase();
  if (
    /^(localhost|0\.0\.0\.0|::1)$/.test(host) ||
    /^127\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host.startsWith('fd') ||
    host.startsWith('fe80')
  ) {
    throw new Error('禁止内网 / 回环 / 链路本地地址');
  }
  return u;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  ms = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export class NotifyChannelService {
  constructor(private prisma: PrismaClient) {}

  async dispatch(channel: NotifyChannelLike, subject: string, body: string): Promise<DispatchResult> {
    try {
      if (channel.type === 'email') {
        // 把 target 作为收件人传给邮件网关（支持则按渠道收件，不支持则回落默认收件人）。
        const res = await fetchWithTimeout(MAILER_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ to: channel.target, subject, body, source: 'freellm-alert' }),
        });
        return { ok: res.ok, detail: `mail-relay HTTP ${res.status}` };
      }
      // slack/webhook：先过 SSRF 校验再 fetch。
      assertSafeTarget(channel.target);
      if (channel.type === 'slack') {
        const res = await fetchWithTimeout(channel.target, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: `*${subject}*\n${body}` }),
        });
        return { ok: res.ok, detail: `slack HTTP ${res.status}` };
      }
      const res = await fetchWithTimeout(channel.target, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subject, body, source: 'freellm-alert' }),
      });
      return { ok: res.ok, detail: `webhook HTTP ${res.status}` };
    } catch (e) {
      const detail = (e as Error).message;
      // 不静默吞错：分发失败记日志。
      console.warn(`[notify] dispatch 失败 type=${channel.type} name=${channel.name ?? '?'}: ${detail}`);
      return { ok: false, detail };
    }
  }

  /** 向所有 enabled 渠道分发（alert-rule 命中时调用）。allSettled 解耦 + 失败明细。 */
  async dispatchAll(
    subject: string,
    body: string,
  ): Promise<{ total: number; sent: number; failures: Array<{ name: string; detail: string }> }> {
    const channels = await this.prisma.notifyChannel.findMany({ where: { enabled: true } });
    const settled = await Promise.allSettled(channels.map((c) => this.dispatch(c, subject, body)));
    const failures: Array<{ name: string; detail: string }> = [];
    let sent = 0;
    settled.forEach((s, i) => {
      if (s.status === 'fulfilled' && s.value.ok) {
        sent += 1;
      } else {
        const detail =
          s.status === 'fulfilled' ? s.value.detail : ((s.reason as Error)?.message ?? 'unknown');
        failures.push({ name: channels[i]?.name ?? '?', detail });
      }
    });
    if (failures.length) {
      console.warn(`[notify] dispatchAll ${failures.length}/${channels.length} 渠道失败:`, failures);
    }
    return { total: channels.length, sent, failures };
  }

  async testSend(channel: NotifyChannelLike): Promise<DispatchResult> {
    return this.dispatch(
      channel,
      'FreeLLM 测试通知',
      `这是来自 FreeLLM 告警系统的测试消息（渠道：${channel.name ?? channel.type}）。若收到说明渠道配置正常。`,
    );
  }
}
