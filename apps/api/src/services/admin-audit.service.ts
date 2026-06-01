/**
 * 管理员操作审计服务（Tick 29 v1.7.1.0 引入）。
 *
 * 中间件自动捕获所有 /admin/* 写操作（POST/PATCH/DELETE/PUT）+ 登录/登出事件，
 * 写入 admin_audit_logs 表用于合规审计、操作回溯、安全调查。
 *
 * 敏感字段（secret / password / apiKey / token）会被 redact 后再持久化。
 */
import type { PrismaClient, AdminAuditLog } from '@prisma/client';

/** 最长存储 4 KB 的请求体（再长截断，防止日志爆表）。 */
const MAX_BODY_BYTES = 4 * 1024;

const SENSITIVE_KEYS = new Set([
  'secret',
  'password',
  'apikey',
  'api_key',
  'token',
  'authorization',
  'masterkey',
  'sessionsecret',
]);

/** 资源类型 ← URL path 启发式映射。 */
const PATH_TO_RESOURCE: Array<[RegExp, string]> = [
  [/^\/admin\/virtual-keys/, 'virtual_key'],
  [/^\/admin\/providers/, 'provider'],
  [/^\/admin\/webhooks/, 'webhook'],
  [/^\/admin\/models/, 'model'],
  [/^\/admin\/settings/, 'setting'],
  [/^\/admin\/organizations/, 'organization'],
  [/^\/admin\/routing/, 'routing_policy'],
  [/^\/admin\/auth/, 'auth'],
  [/^\/admin\/audit/, 'audit'],
];

export interface AuditRecord {
  userId: string | null;
  username: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  method: string;
  path: string;
  status: number;
  requestBody: string | null;
  clientIp: string | null;
  userAgent: string | null;
  requestId: string | null;
  errorMessage: string | null;
  durationMs: number | null;
}

export interface AuditListFilter {
  userId?: string;
  username?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  /** 起始时间（含），ISO string。 */
  since?: Date;
  /** 结束时间（含），ISO string。 */
  until?: Date;
  limit?: number;
  offset?: number;
}

export interface AuditListResult {
  data: AdminAuditLog[];
  total: number;
}

/** 按 HTTP method 推 action 关键字。 */
export function actionFromMethod(method: string, path: string): string {
  const m = method.toUpperCase();
  if (path === '/admin/auth/login') return 'login';
  if (path === '/admin/auth/logout') return 'logout';
  if (path.endsWith('/refresh') || path.endsWith('/rotate')) return 'refresh';
  if (m === 'POST') return 'create';
  if (m === 'PATCH' || m === 'PUT') return 'update';
  if (m === 'DELETE') return 'delete';
  return 'other';
}

/** 按 URL path 推 resourceType。 */
export function resourceTypeFromPath(path: string): string {
  for (const [re, type] of PATH_TO_RESOURCE) {
    if (re.test(path)) return type;
  }
  return 'other';
}

/** 抽 resource id：URL 最后一段（若不是已知 root 关键字）。 */
export function resourceIdFromPath(path: string): string | null {
  const trimmed = path.split('?')[0]!.replace(/\/$/, '');
  const segs = trimmed.split('/').filter(Boolean);
  if (segs.length < 3) return null; // /admin/<type> 没有 id
  const last = segs[segs.length - 1]!;
  // 排除 sub-action 关键字
  if (['refresh', 'rotate', 'revoke', 'login', 'logout', 'sign-test', 'verify'].includes(last)) {
    return null;
  }
  return last;
}

/** 递归 redact 敏感字段。 */
export function redactSensitive(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => redactSensitive(v));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(k.toLowerCase())) {
        out[k] = typeof v === 'string' && v.length > 0 ? '[REDACTED]' : v;
      } else {
        out[k] = redactSensitive(v);
      }
    }
    return out;
  }
  return value;
}

/** 序列化 body 为可存储字符串（≤ 4 KB）。 */
export function serializeBody(body: unknown): string | null {
  if (body === null || body === undefined) return null;
  if (typeof body === 'string' && body.length === 0) return null;
  if (typeof body === 'object' && body !== null && Object.keys(body).length === 0) return null;
  try {
    const redacted = redactSensitive(body);
    const json = JSON.stringify(redacted);
    if (json.length <= MAX_BODY_BYTES) return json;
    return `${json.slice(0, MAX_BODY_BYTES)}…[truncated, original ${json.length} bytes]`;
  } catch {
    return '[unserializable]';
  }
}

export class AdminAuditService {
  constructor(private readonly prisma: PrismaClient) {}

  async record(rec: AuditRecord): Promise<void> {
    try {
      await this.prisma.adminAuditLog.create({
        data: {
          userId: rec.userId,
          username: rec.username,
          action: rec.action,
          resourceType: rec.resourceType,
          resourceId: rec.resourceId,
          method: rec.method,
          path: rec.path,
          status: rec.status,
          requestBody: rec.requestBody,
          clientIp: rec.clientIp,
          userAgent: rec.userAgent,
          requestId: rec.requestId,
          errorMessage: rec.errorMessage,
          durationMs: rec.durationMs,
        },
      });
    } catch (err) {
      // audit 失败绝不阻塞业务（仅打 stderr 警告）
      console.warn('[admin-audit] 写审计失败：', (err as Error).message);
    }
  }

  async list(filter: AuditListFilter = {}): Promise<AuditListResult> {
    const where: Record<string, unknown> = {};
    if (filter.userId) where.userId = filter.userId;
    if (filter.username) where.username = filter.username;
    if (filter.action) where.action = filter.action;
    if (filter.resourceType) where.resourceType = filter.resourceType;
    if (filter.resourceId) where.resourceId = filter.resourceId;
    if (filter.since || filter.until) {
      where.createdAt = {
        ...(filter.since ? { gte: filter.since } : {}),
        ...(filter.until ? { lte: filter.until } : {}),
      };
    }
    const limit = Math.min(filter.limit ?? 100, 500);
    const offset = filter.offset ?? 0;
    const [data, total] = await Promise.all([
      this.prisma.adminAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.adminAuditLog.count({ where }),
    ]);
    return { data, total };
  }

  /**
   * 旧记录回收（默认保留 90 天）。可由 cron 调度。
   */
  async purgeOlderThan(daysOld: number): Promise<number> {
    const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60_000);
    const result = await this.prisma.adminAuditLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return result.count;
  }
}
