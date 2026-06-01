/**
 * Snapshot diff engine.
 *
 * Each discovery cycle produces a `DiscoveredModel[]`. The diff engine
 * compares the new batch against the live `models` rows for the same
 * provider and emits one of six change events per affected model. The
 * caller (the discovery service) is responsible for persisting the
 * changes and writing the corresponding `error_events` rows.
 */
import type { DiscoveredModel } from '@freellm/shared';
import type { PrismaClient } from '@prisma/client';

export type ModelChangeEvent =
  | { kind: 'added'; upstreamId: string; model: DiscoveredModel }
  | { kind: 'removed'; upstreamId: string; modelId: string }
  | {
      kind: 'paid_now';
      upstreamId: string;
      modelId: string;
      previousClassification: 'free' | 'suspected';
      newClassification: 'paid';
      previousPricing?: unknown;
      newPricing?: unknown;
    }
  | {
      kind: 'context_changed';
      upstreamId: string;
      modelId: string;
      previousContextLength: number;
      newContextLength: number;
    }
  | {
      kind: 'capability_changed';
      upstreamId: string;
      modelId: string;
      previousCapabilities: DiscoveredModel['capabilities'];
      newCapabilities: DiscoveredModel['capabilities'];
      added: string[];
      removed: string[];
    }
  | {
      kind: 'status_changed';
      upstreamId: string;
      modelId: string;
      previousStatus: string;
      newStatus: string;
    };

export interface ExistingModelRow {
  id: string;
  upstreamId: string;
  contextLength: number;
  isFree: boolean;
  pricingJson?: string | null;
  capabilitiesJson: string;
  status: string;
}

export interface SnapshotDiffInput {
  discovered: DiscoveredModel[];
  existing: ExistingModelRow[];
}

export interface SnapshotDiffResult {
  events: ModelChangeEvent[];
  /** Stats useful for logging + admin dashboards. */
  stats: {
    discovered: number;
    existing: number;
    added: number;
    removed: number;
    paidNow: number;
    contextChanged: number;
    capabilityChanged: number;
    statusChanged: number;
    unchanged: number;
  };
}

function parseCapabilities(json: string): DiscoveredModel['capabilities'] {
  try {
    const obj = JSON.parse(json) as Record<string, unknown>;
    return {
      stream: Boolean(obj.stream),
      json: Boolean(obj.json),
      tools: Boolean(obj.tools),
      vision: Boolean(obj.vision),
      audio: Boolean(obj.audio),
      reasoning: Boolean(obj.reasoning),
      longContext: Boolean(obj.longContext),
    };
  } catch {
    return { stream: false, json: false, tools: false, vision: false, audio: false };
  }
}

function diffCapabilities(
  previous: DiscoveredModel['capabilities'],
  next: DiscoveredModel['capabilities'],
): { added: string[]; removed: string[] } {
  const added: string[] = [];
  const removed: string[] = [];
  const keys = new Set<keyof DiscoveredModel['capabilities']>([
    ...(Object.keys(previous) as Array<keyof DiscoveredModel['capabilities']>),
    ...(Object.keys(next) as Array<keyof DiscoveredModel['capabilities']>),
  ]);
  for (const k of keys) {
    const a = previous[k] === true;
    const b = next[k] === true;
    if (!a && b) added.push(k);
    if (a && !b) removed.push(k);
  }
  return { added, removed };
}

export function diffSnapshots({ discovered, existing }: SnapshotDiffInput): SnapshotDiffResult {
  const byUpstreamId = new Map<string, ExistingModelRow>();
  for (const row of existing) byUpstreamId.set(row.upstreamId, row);
  const seen = new Set<string>();
  const events: ModelChangeEvent[] = [];
  let unchanged = 0;
  let added = 0;
  let removed = 0;
  let paidNow = 0;
  let contextChanged = 0;
  let capabilityChanged = 0;
  let statusChanged = 0;

  for (const dm of discovered) {
    seen.add(dm.upstreamId);
    const row = byUpstreamId.get(dm.upstreamId);
    if (!row) {
      events.push({ kind: 'added', upstreamId: dm.upstreamId, model: dm });
      added += 1;
      continue;
    }
    let touched = false;

    // pricing: free → paid
    if (row.isFree && dm.classification === 'paid') {
      events.push({
        kind: 'paid_now',
        upstreamId: dm.upstreamId,
        modelId: row.id,
        previousClassification: 'free',
        newClassification: 'paid',
        ...(row.pricingJson ? { previousPricing: safeJson(row.pricingJson) } : {}),
        ...(dm.pricing ? { newPricing: dm.pricing } : {}),
      });
      paidNow += 1;
      touched = true;
    }

    // context length changed
    if (row.contextLength !== dm.contextLength) {
      events.push({
        kind: 'context_changed',
        upstreamId: dm.upstreamId,
        modelId: row.id,
        previousContextLength: row.contextLength,
        newContextLength: dm.contextLength,
      });
      contextChanged += 1;
      touched = true;
    }

    // capabilities diff
    const prevCaps = parseCapabilities(row.capabilitiesJson);
    const { added: capsAdded, removed: capsRemoved } = diffCapabilities(prevCaps, dm.capabilities);
    if (capsAdded.length || capsRemoved.length) {
      events.push({
        kind: 'capability_changed',
        upstreamId: dm.upstreamId,
        modelId: row.id,
        previousCapabilities: prevCaps,
        newCapabilities: dm.capabilities,
        added: capsAdded,
        removed: capsRemoved,
      });
      capabilityChanged += 1;
      touched = true;
    }

    // status returning to active if row was previously removed/disabled
    if (row.status === 'removed' || row.status === 'paid_now') {
      events.push({
        kind: 'status_changed',
        upstreamId: dm.upstreamId,
        modelId: row.id,
        previousStatus: row.status,
        newStatus: 'active',
      });
      statusChanged += 1;
      touched = true;
    }

    if (!touched) unchanged += 1;
  }

  for (const row of existing) {
    if (seen.has(row.upstreamId)) continue;
    if (row.status === 'removed') continue; // already reported previously
    events.push({ kind: 'removed', upstreamId: row.upstreamId, modelId: row.id });
    removed += 1;
  }

  return {
    events,
    stats: {
      discovered: discovered.length,
      existing: existing.length,
      added,
      removed,
      paidNow,
      contextChanged,
      capabilityChanged,
      statusChanged,
      unchanged,
    },
  };
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

// ── 组 8 Tick 3 v1.25.0.0：相邻历史快照 diff ──
// 区别于 diffSnapshots（"新抓 discovered vs DB existing" 语义）：本函数对同一模型的
// ModelSnapshot 历史按 takenAt 排序，相邻两两比对，复用底层 diffCapabilities。

export interface AdjacentSnapshotChange {
  fromTakenAt: Date;
  toTakenAt: Date;
  capsAdded: string[];
  capsRemoved: string[];
  contextFrom: number;
  contextTo: number;
  freeFrom: boolean;
  freeTo: boolean;
}

export interface SnapshotTimeline {
  total: number;
  snapshots: Array<{ takenAt: Date; isFree: boolean; contextLength: number }>;
  changes: AdjacentSnapshotChange[];
}

// ModelSnapshot 的能力存于 payloadJson（完整 DiscoveredModel 序列化）的 capabilities 字段。
function capsFromPayload(payloadJson: string): DiscoveredModel['capabilities'] {
  try {
    const p = JSON.parse(payloadJson) as { capabilities?: Record<string, unknown> };
    const c = p.capabilities ?? {};
    return {
      stream: Boolean(c.stream),
      json: Boolean(c.json),
      tools: Boolean(c.tools),
      vision: Boolean(c.vision),
      audio: Boolean(c.audio),
      reasoning: Boolean(c.reasoning),
      longContext: Boolean(c.longContext),
    } as DiscoveredModel['capabilities'];
  } catch {
    // 补全 7 键保持类型诚实（与正常路径一致，避免 diff 误判）。
    return {
      stream: false,
      json: false,
      tools: false,
      vision: false,
      audio: false,
      reasoning: false,
      longContext: false,
    } as DiscoveredModel['capabilities'];
  }
}

/** 取某模型 ModelSnapshot 按 takenAt 排序，相邻两两比对（复用 diffCapabilities），返回时间线 + 变化点。 */
export async function diffAdjacentSnapshots(
  prisma: PrismaClient,
  modelId: string,
  limit = 60,
): Promise<SnapshotTimeline> {
  // 取最近 limit 条（desc）后转为时间正序，确保展示的是最新变化趋势。
  const recent = await prisma.modelSnapshot.findMany({
    where: { modelId },
    orderBy: { takenAt: 'desc' },
    take: limit,
    select: { takenAt: true, isFree: true, contextLength: true, payloadJson: true },
  });
  const rows = recent.reverse();
  const changes: AdjacentSnapshotChange[] = [];
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1]!;
    const cur = rows[i]!;
    const { added, removed } = diffCapabilities(
      capsFromPayload(prev.payloadJson),
      capsFromPayload(cur.payloadJson),
    );
    const contextChanged = prev.contextLength !== cur.contextLength;
    const freeChanged = prev.isFree !== cur.isFree;
    if (added.length || removed.length || contextChanged || freeChanged) {
      changes.push({
        fromTakenAt: prev.takenAt,
        toTakenAt: cur.takenAt,
        capsAdded: added,
        capsRemoved: removed,
        contextFrom: prev.contextLength,
        contextTo: cur.contextLength,
        freeFrom: prev.isFree,
        freeTo: cur.isFree,
      });
    }
  }
  return {
    total: rows.length,
    snapshots: rows.map((r) => ({ takenAt: r.takenAt, isFree: r.isFree, contextLength: r.contextLength })),
    changes,
  };
}
