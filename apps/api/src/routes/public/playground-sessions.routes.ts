/**
 * /public/playground/sessions/* —— Playground 历史会话 CRUD（Tick 36 v1.7.8.0）。
 *
 * 公开路由，无 admin 鉴权。匿名访客在浏览器本地 localStorage 持久化一个 ownerId (cuid)，
 * 通过 query param `owner` 传递；所有 CRUD 强制按 ownerId 做所有权校验，跨 owner 视为 404。
 *
 * 端点：
 *   GET    /public/playground/sessions?owner=&limit=
 *   POST   /public/playground/sessions          (body: { ownerId, name?, messages?, demoVkPrefix? })
 *   GET    /public/playground/sessions/:id?owner=
 *   PATCH  /public/playground/sessions/:id?owner=   (body: { name?, messages?, demoVkPrefix? })
 *   DELETE /public/playground/sessions/:id?owner=
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { FreeLLMError } from '@freellm/shared';
import { getPrisma } from '../../lib/prisma.js';
import {
  PlaygroundSessionService,
  parseMessages,
  type PlaygroundMessage,
} from '../../services/playground-session.service.js';

const messageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().max(64 * 1024),
  meta: z
    .object({
      upstreamModel: z.string().optional(),
      durationMs: z.number().optional(),
    })
    .optional(),
});

const ownerIdSchema = z.string().min(8).max(80);

function serialize(s: {
  id: string;
  ownerId: string;
  name: string;
  demoVkPrefix: string | null;
  messagesJson: string;
  createdAt: Date;
  updatedAt: Date;
  lastMessageAt: Date;
}) {
  return {
    id: s.id,
    name: s.name,
    demoVkPrefix: s.demoVkPrefix,
    messages: parseMessages(s.messagesJson),
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    lastMessageAt: s.lastMessageAt,
  };
}

const plugin: FastifyPluginAsync = async (app) => {
  app.get('/public/playground/sessions', async (req) => {
    const query = z
      .object({ owner: ownerIdSchema, limit: z.coerce.number().int().min(1).max(200).optional() })
      .parse(req.query);
    const svc = new PlaygroundSessionService(getPrisma());
    const rows = await svc.list(query.owner, query.limit ?? 50);
    return {
      data: rows.map((r) => ({
        id: r.id,
        name: r.name,
        demoVkPrefix: r.demoVkPrefix,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        lastMessageAt: r.lastMessageAt,
        // 列表不包 messages（节省带宽），详情接口取
      })),
      total: rows.length,
    };
  });

  app.post('/public/playground/sessions', async (req) => {
    const body = z
      .object({
        ownerId: ownerIdSchema,
        name: z.string().max(80).optional(),
        messages: z.array(messageSchema).optional(),
        demoVkPrefix: z.string().max(40).optional(),
      })
      .parse(req.body ?? {});
    const svc = new PlaygroundSessionService(getPrisma());
    const created = await svc.create({
      ownerId: body.ownerId,
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.messages !== undefined ? { messages: body.messages as PlaygroundMessage[] } : {}),
      ...(body.demoVkPrefix !== undefined ? { demoVkPrefix: body.demoVkPrefix } : {}),
    });
    return { ok: true, session: serialize(created) };
  });

  app.get('/public/playground/sessions/:id', async (req) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const query = z.object({ owner: ownerIdSchema }).parse(req.query);
    const svc = new PlaygroundSessionService(getPrisma());
    const row = await svc.findByIdForOwner(params.id, query.owner);
    if (!row) {
      throw new FreeLLMError('not_found', '会话不存在或无权访问');
    }
    return { session: serialize(row) };
  });

  app.patch('/public/playground/sessions/:id', async (req) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const query = z.object({ owner: ownerIdSchema }).parse(req.query);
    const body = z
      .object({
        name: z.string().max(80).optional(),
        messages: z.array(messageSchema).optional(),
        demoVkPrefix: z.string().max(40).optional(),
      })
      .parse(req.body ?? {});
    const svc = new PlaygroundSessionService(getPrisma());
    const updated = await svc.update(params.id, query.owner, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.messages !== undefined ? { messages: body.messages as PlaygroundMessage[] } : {}),
      ...(body.demoVkPrefix !== undefined ? { demoVkPrefix: body.demoVkPrefix } : {}),
    });
    return { ok: true, session: serialize(updated) };
  });

  app.delete('/public/playground/sessions/:id', async (req) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const query = z.object({ owner: ownerIdSchema }).parse(req.query);
    const svc = new PlaygroundSessionService(getPrisma());
    await svc.delete(params.id, query.owner);
    return { ok: true };
  });
};

export default plugin;
