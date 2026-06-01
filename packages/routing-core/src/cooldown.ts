/**
 * Cooldown manager.
 *
 * Lives at two scopes — per-model and per-provider. Uses exponential backoff
 * with capped jitter; supports half-open probes so a model that has cooled
 * down can be re-checked with a single shot before traffic resumes.
 *
 * The runtime persistence lives in the `cooldowns` Prisma table; the engine
 * here is storage-agnostic and accepts a `CooldownStore` port so we can swap
 * Redis/PG later.
 */

export type CooldownScope = 'model' | 'provider';

export interface CooldownRecord {
  id: string;
  scope: CooldownScope;
  key: string; // modelId or providerSlug
  reason: string;
  attempts: number;
  backoffMs: number;
  expiresAt: Date;
  halfOpen: boolean;
  createdAt: Date;
}

export interface CooldownStore {
  list(scope?: CooldownScope): Promise<CooldownRecord[]>;
  findActive(scope: CooldownScope, key: string): Promise<CooldownRecord | null>;
  upsert(record: Omit<CooldownRecord, 'createdAt'>): Promise<CooldownRecord>;
  reset(id: string): Promise<void>;
  clearExpired(now?: Date): Promise<number>;
}

export interface RegisterFailureInput {
  scope: CooldownScope;
  key: string;
  reason: string;
  hintMs?: number;
}

export interface CooldownDecision {
  allowed: boolean;
  /** When `allowed: true` but probe is requested, only one in-flight call should be sent. */
  halfOpenProbe: boolean;
  record?: CooldownRecord;
  reason?: string;
}

export interface CooldownEngineOptions {
  /** Base backoff for the first failure. Default 30s for `rate_limited`-ish. */
  baseMs?: number;
  maxMs?: number;
  jitterPct?: number;
  now?: () => Date;
}

const DEFAULT_BASE = 30_000;
const DEFAULT_MAX = 5 * 60_000;
const DEFAULT_JITTER = 0.2;

export class CooldownEngine {
  constructor(
    private readonly store: CooldownStore,
    private readonly opts: CooldownEngineOptions = {},
  ) {}

  private now(): Date {
    return this.opts.now ? this.opts.now() : new Date();
  }

  /**
   * Decide whether to allow an attempt against `key`. If a cooldown exists
   * but has expired, flip it to half-open and let exactly one probe through.
   */
  async check(scope: CooldownScope, key: string): Promise<CooldownDecision> {
    const record = await this.store.findActive(scope, key);
    if (!record) return { allowed: true, halfOpenProbe: false };
    const now = this.now();
    if (record.expiresAt.getTime() > now.getTime()) {
      return {
        allowed: false,
        halfOpenProbe: false,
        record,
        reason: `cooldown active until ${record.expiresAt.toISOString()}`,
      };
    }
    if (!record.halfOpen) {
      await this.store.upsert({
        id: record.id,
        scope: record.scope,
        key: record.key,
        reason: record.reason,
        attempts: record.attempts,
        backoffMs: record.backoffMs,
        expiresAt: record.expiresAt,
        halfOpen: true,
      });
      return { allowed: true, halfOpenProbe: true, record, reason: 'half-open probe' };
    }
    return { allowed: false, halfOpenProbe: false, record, reason: 'half-open probe in flight' };
  }

  async registerFailure(input: RegisterFailureInput): Promise<CooldownRecord> {
    const existing = await this.store.findActive(input.scope, input.key);
    const attempts = (existing?.attempts ?? 0) + 1;
    const base = input.hintMs ?? this.opts.baseMs ?? DEFAULT_BASE;
    const max = this.opts.maxMs ?? DEFAULT_MAX;
    const jitterPct = this.opts.jitterPct ?? DEFAULT_JITTER;
    const exp = Math.min(max, base * Math.pow(2, attempts - 1));
    const jitter = exp * jitterPct * (Math.random() * 2 - 1);
    const backoffMs = Math.max(1000, Math.round(exp + jitter));
    const now = this.now();
    return this.store.upsert({
      id: existing?.id ?? `cd-${input.scope}-${input.key}`,
      scope: input.scope,
      key: input.key,
      reason: input.reason,
      attempts,
      backoffMs,
      expiresAt: new Date(now.getTime() + backoffMs),
      halfOpen: false,
    });
  }

  async registerSuccess(scope: CooldownScope, key: string): Promise<void> {
    const existing = await this.store.findActive(scope, key);
    if (!existing) return;
    await this.store.reset(existing.id);
  }

  /** Convenience for admin endpoints. */
  async listActive(scope?: CooldownScope): Promise<CooldownRecord[]> {
    return this.store.list(scope);
  }
}

/** In-memory implementation used by tests and to bootstrap before DB is wired. */
export class MemoryCooldownStore implements CooldownStore {
  private records = new Map<string, CooldownRecord>();

  async list(scope?: CooldownScope): Promise<CooldownRecord[]> {
    const all = Array.from(this.records.values());
    return scope ? all.filter((r) => r.scope === scope) : all;
  }
  async findActive(scope: CooldownScope, key: string): Promise<CooldownRecord | null> {
    const id = `cd-${scope}-${key}`;
    return this.records.get(id) ?? null;
  }
  async upsert(record: Omit<CooldownRecord, 'createdAt'>): Promise<CooldownRecord> {
    const full: CooldownRecord = {
      ...record,
      createdAt: this.records.get(record.id)?.createdAt ?? new Date(),
    };
    this.records.set(record.id, full);
    return full;
  }
  async reset(id: string): Promise<void> {
    this.records.delete(id);
  }
  async clearExpired(now: Date = new Date()): Promise<number> {
    let n = 0;
    for (const [id, r] of this.records) {
      if (r.expiresAt.getTime() <= now.getTime() && !r.halfOpen) {
        this.records.delete(id);
        n += 1;
      }
    }
    return n;
  }
}
