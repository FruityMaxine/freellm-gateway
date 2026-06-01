/**
 * /admin/system/health 全链路自检服务（Tick 50 v1.7.22.0 引入）。
 *
 * 统一暴露三大维度的健康度，让运维一个端点就能看到：
 *   1. DB         — Prisma `SELECT 1` 探针 + 最近 24h RequestLog 计数（活跃度）
 *   2. Redis      — FREELLM_REDIS_URL 设置时尝试连接 + PING；未设 = N/A
 *   3. Providers  — Registry 列出的全部 provider + 各自 DB 最近 status / lastSuccessAt /
 *                   lastErrorAt / 最近一条未解决 ErrorEvent
 *
 * 设计原则：
 *   - **不阻塞**：每个维度独立 try/catch，单点失败不影响其他维度
 *   - **不副作用**：纯查询 + ping，不写入任何状态、不触发 cron
 *   - **超时**：DB 1s / Redis 1s / Provider list 仅读 registry+DB（无 upstream 网络）
 *   - **overall**：DB fail → unhealthy；任一 provider error → degraded；其他 → healthy
 *
 * 与 Tick 31 ProviderHealthService 区别：
 *   - Tick 31 主动 ping 上游 (network call, 写 cooldown) — 是 cron job 的工作
 *   - 本服务只读现有状态做汇总 (no network) — 是 dashboard 的工作
 */
import type { PrismaClient } from '@prisma/client';
import type { ProviderRegistry } from '@freellm/provider-core';

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export interface DbHealth {
  status: HealthStatus;
  pingMs: number | null;
  requests24h: number | null;
  errorMessage?: string;
}

export interface RedisHealth {
  status: HealthStatus;
  configured: boolean;
  pingMs: number | null;
  errorMessage?: string;
}

export interface ProviderHealthRow {
  slug: string;
  name: string;
  registered: boolean;
  status: HealthStatus;
  dbStatus: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  errorCount24h: number;
  unresolvedAlerts: number;
}

export interface SystemHealthReport {
  overall: HealthStatus;
  generatedAt: string;
  db: DbHealth;
  redis: RedisHealth;
  providers: ProviderHealthRow[];
}

const DB_TIMEOUT_MS = 1000;
const REDIS_TIMEOUT_MS = 1000;

export class SystemHealthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly registry: ProviderRegistry,
  ) {}

  async checkAll(): Promise<SystemHealthReport> {
    const [db, redis, providers] = await Promise.all([
      this.checkDb(),
      this.checkRedis(),
      this.checkProviders(),
    ]);
    return {
      overall: deriveOverall(db, redis, providers),
      generatedAt: new Date().toISOString(),
      db,
      redis,
      providers,
    };
  }

  async checkDb(): Promise<DbHealth> {
    const start = Date.now();
    try {
      const pingPromise = this.prisma.$queryRaw`SELECT 1` as Promise<unknown>;
      await withTimeout(pingPromise, DB_TIMEOUT_MS, 'db ping timeout');
      const pingMs = Date.now() - start;
      let requests24h: number | null = null;
      try {
        const since = new Date(Date.now() - 24 * 60 * 60_000);
        requests24h = await this.prisma.requestLog.count({ where: { startedAt: { gte: since } } });
      } catch {
        // 计数失败不致整体 fail，留 null
      }
      return { status: 'healthy', pingMs, requests24h };
    } catch (err) {
      return {
        status: 'unhealthy',
        pingMs: null,
        requests24h: null,
        errorMessage: (err as Error).message,
      };
    }
  }

  async checkRedis(): Promise<RedisHealth> {
    const url = process.env.FREELLM_REDIS_URL;
    if (!url) {
      return { status: 'unknown', configured: false, pingMs: null };
    }
    const start = Date.now();
    try {
      // ioredis 是 optional dep — 用 createRequire 动态加载，未装时回落 degraded。
      const { createRequire } = await import('node:module');
      const nodeRequire = createRequire(import.meta.url);
      let IORedis: unknown;
      try {
        IORedis = nodeRequire('ioredis');
      } catch {
        return {
          status: 'degraded',
          configured: true,
          pingMs: null,
          errorMessage: 'ioredis 未安装但 FREELLM_REDIS_URL 已设',
        };
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Redis = ((IORedis as any).default ?? (IORedis as any).Redis ?? IORedis) as new (
        url: string,
        opts: Record<string, unknown>,
      ) => { connect: () => Promise<void>; ping: () => Promise<string>; disconnect: () => void };
      const client = new Redis(url, { lazyConnect: true, connectTimeout: REDIS_TIMEOUT_MS });
      try {
        await withTimeout(client.connect(), REDIS_TIMEOUT_MS, 'redis connect timeout');
        await withTimeout(client.ping(), REDIS_TIMEOUT_MS, 'redis ping timeout');
        return { status: 'healthy', configured: true, pingMs: Date.now() - start };
      } finally {
        try {
          client.disconnect();
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      return {
        status: 'unhealthy',
        configured: true,
        pingMs: null,
        errorMessage: (err as Error).message,
      };
    }
  }

  async checkProviders(): Promise<ProviderHealthRow[]> {
    const registered = new Set(this.registry.list().map((p) => p.slug));
    const dbRows = await this.prisma.provider.findMany({
      where: { enabled: true },
      orderBy: { priority: 'desc' },
    });
    const since = new Date(Date.now() - 24 * 60 * 60_000);
    return Promise.all(
      dbRows.map(async (p) => {
        const [errorCount24h, unresolvedAlerts] = await Promise.all([
          this.prisma.errorEvent
            .count({
              where: {
                providerId: p.id,
                createdAt: { gte: since },
              },
            })
            .catch(() => 0),
          this.prisma.errorEvent
            .count({
              where: {
                providerId: p.id,
                resolvedAt: null,
              },
            })
            .catch(() => 0),
        ]);
        const isRegistered = registered.has(p.slug);
        return {
          slug: p.slug,
          name: p.name,
          registered: isRegistered,
          status: deriveProviderStatus(p.status, isRegistered, errorCount24h, unresolvedAlerts),
          dbStatus: p.status,
          lastSuccessAt: p.lastSuccessAt ? p.lastSuccessAt.toISOString() : null,
          lastErrorAt: p.lastErrorAt ? p.lastErrorAt.toISOString() : null,
          lastErrorMessage: p.lastErrorMessage,
          errorCount24h,
          unresolvedAlerts,
        };
      }),
    );
  }
}

export function deriveOverall(
  db: DbHealth,
  redis: RedisHealth,
  providers: ProviderHealthRow[],
): HealthStatus {
  if (db.status === 'unhealthy') return 'unhealthy';
  if (redis.status === 'unhealthy') return 'degraded';
  const anyProviderUnhealthy = providers.some((p) => p.status === 'unhealthy');
  if (anyProviderUnhealthy) return 'degraded';
  const anyProviderDegraded = providers.some((p) => p.status === 'degraded');
  if (anyProviderDegraded) return 'degraded';
  return 'healthy';
}

export function deriveProviderStatus(
  dbStatus: string | null,
  registered: boolean,
  errorCount24h: number,
  unresolvedAlerts: number,
): HealthStatus {
  if (!registered) return 'unhealthy';
  if (dbStatus === 'down' || dbStatus === 'disabled') return 'unhealthy';
  if (unresolvedAlerts > 0) return 'degraded';
  if (dbStatus === 'degraded') return 'degraded';
  if (errorCount24h > 10) return 'degraded';
  if (dbStatus === 'healthy' || dbStatus === 'ok' || dbStatus === 'active' || dbStatus === null) {
    return 'healthy';
  }
  return 'unknown';
}

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(msg)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
