/**
 * Pool builder 数据装配 bench：Prisma 行 → PoolModel 的纯内存转换开销。
 * 模拟 100 / 500 / 1000 模型行的全量装配。
 *
 * 本 bench 不连数据库，重点衡量解析 + 字段映射 + JSON parse 的纯 CPU 开销。
 */
import { bench, describe } from 'vitest';

interface FakeModelRow {
  id: string;
  upstreamId: string;
  isFree: boolean;
  contextLength: number;
  capabilitiesJson: string;
  status: string;
  blacklisted: boolean;
  whitelisted: boolean;
  weightAdj: number;
  provider: { slug: string };
  scores: {
    availabilityScore: number;
    latencyScore: number;
    rateLimitScore: number;
    qualityScore: number;
    contextScore: number;
    freshnessScore: number;
    costScore: number;
    stabilityScore: number;
  } | null;
}

function makeRows(n: number): FakeModelRow[] {
  const rows: FakeModelRow[] = [];
  const capsJson = JSON.stringify({ stream: true, json: true, tools: false, vision: false, audio: false });
  for (let i = 0; i < n; i++) {
    rows.push({
      id: `m-${i}`,
      upstreamId: `provider-${i % 5}/model-${i}`,
      isFree: i % 7 !== 0,
      contextLength: 32_000 + (i * 100) % 100_000,
      capabilitiesJson: capsJson,
      status: 'active',
      blacklisted: false,
      whitelisted: false,
      weightAdj: 0,
      provider: { slug: `provider-${i % 5}` },
      scores: i % 3 === 0
        ? null
        : {
            availabilityScore: 0.7,
            latencyScore: 0.6,
            rateLimitScore: 0.8,
            qualityScore: 0.65,
            contextScore: 0.5,
            freshnessScore: 0.55,
            costScore: 1,
            stabilityScore: 0.75,
          },
    });
  }
  return rows;
}

function transform(rows: FakeModelRow[]): unknown[] {
  return rows.map((m) => {
    let caps;
    try {
      caps = JSON.parse(m.capabilitiesJson);
    } catch {
      caps = { stream: false, json: false, tools: false, vision: false, audio: false };
    }
    const s = m.scores;
    return {
      modelId: m.id,
      upstreamId: m.upstreamId,
      providerSlug: m.provider.slug,
      isFree: m.isFree,
      contextLength: m.contextLength,
      capabilities: caps,
      status: m.status,
      blacklisted: m.blacklisted,
      whitelisted: m.whitelisted,
      weightAdj: m.weightAdj,
      scores: {
        availability: s?.availabilityScore ?? 0.5,
        latency: s?.latencyScore ?? 0.5,
        rateLimit: s?.rateLimitScore ?? 0.5,
        quality: s?.qualityScore ?? 0.5,
        context: s?.contextScore ?? Math.min(1, m.contextLength / 200_000),
        freshness: s?.freshnessScore ?? 0.5,
        cost: s?.costScore ?? (m.isFree ? 1 : 0),
        stability: s?.stabilityScore ?? 0.5,
        firstTokenLatency: 0.5,
      },
    };
  });
}

const rows100 = makeRows(100);
const rows500 = makeRows(500);
const rows1000 = makeRows(1000);

describe('pool-builder 数据装配', () => {
  bench('100 行装配', () => {
    transform(rows100);
  });

  bench('500 行装配', () => {
    transform(rows500);
  });

  bench('1000 行装配', () => {
    transform(rows1000);
  });
});
