/**
 * 管理员操作审计自动捕获插件（Tick 29 v1.7.1.0）。
 *
 * 在所有 /admin/* 路由完成后自动写一条 admin_audit_log 记录。
 * 仅记录写操作（POST / PATCH / PUT / DELETE）+ 登录/登出事件。
 * 失败时静默回落（不阻塞业务响应），错误打 stderr。
 *
 * GET 请求不入审计：审计本身是读操作，对 GET 全记会爆表（dashboard 轮询 30s/次）。
 */
import fp from 'fastify-plugin';
import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { getPrisma } from '../lib/prisma.js';
import {
  AdminAuditService,
  actionFromMethod,
  resourceTypeFromPath,
  resourceIdFromPath,
  serializeBody,
} from '../services/admin-audit.service.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** payload body 缓存，供 onResponse 钩子取用（Fastify 在 onResponse 阶段 req.body 仍可读）。*/
    _auditStartedAt?: number;
  }
}

const AUDIT_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const PUBLIC_AUDIT_PATHS = new Set(['/admin/auth/login', '/admin/auth/logout']);

function clientIpOf(req: FastifyRequest): string | null {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string') return fwd.split(',')[0]!.trim();
  if (Array.isArray(fwd) && fwd[0]) return fwd[0].split(',')[0]!.trim();
  return req.ip ?? null;
}

const plugin: FastifyPluginCallback = (app, _opts, done) => {
  const svc = new AdminAuditService(getPrisma());

  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/admin/')) return;
    req._auditStartedAt = Date.now();
  });

  app.addHook('onResponse', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.url.startsWith('/admin/')) return;
    const method = req.method.toUpperCase();
    // 只审计写操作或 login/logout（即便后者是 POST 都会被前一条覆盖）
    if (!AUDIT_METHODS.has(method) && !PUBLIC_AUDIT_PATHS.has(req.url.split('?')[0]!)) {
      return;
    }
    const path = req.url.split('?')[0]!;
    const status = reply.statusCode;
    const session = req.adminSession;
    // login 成功后 adminSession 是 undefined（cookie 刚设），用 body.username 兜底
    let username = session?.username ?? 'unknown';
    const userId: string | null = session?.userId ?? null;
    if (path === '/admin/auth/login') {
      const body = req.body as { username?: string } | undefined;
      if (body?.username) username = body.username;
    }
    const action = actionFromMethod(method, path);
    const resourceType = resourceTypeFromPath(path);
    const resourceId = resourceIdFromPath(path);
    const requestBody = serializeBody(req.body);
    let errorMessage: string | null = null;
    if (status >= 400) {
      // 尝试从响应 payload 提取 error.message（reply 本身不缓存 payload，但 Fastify
      // 把错误对象塞进 reply.raw.statusMessage 不可靠 — 退而求其次只记 status 即可）。
      errorMessage = `HTTP ${status}`;
    }
    const durationMs = req._auditStartedAt ? Date.now() - req._auditStartedAt : null;
    await svc.record({
      userId,
      username,
      action,
      resourceType,
      resourceId,
      method,
      path,
      status,
      requestBody,
      clientIp: clientIpOf(req),
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
      requestId: req.requestId,
      errorMessage,
      durationMs,
    });
  });

  done();
};

export default fp(plugin, { name: 'admin-audit', dependencies: ['admin-auth'] });
