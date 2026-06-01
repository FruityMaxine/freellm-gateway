/**
 * /public/playground/presets/* —— Playground 预设 CRUD（Tick 45 v1.7.17.0）。
 *
 * 与 Tick 36 /public/playground/sessions/* 同构：匿名 ownerId 做所有权校验。
 *
 *   GET    /public/playground/presets?owner=
 *   POST   /public/playground/presets        (body: { ownerId, name, systemPrompt?, ... })
 *   GET    /public/playground/presets/:id?owner=
 *   PATCH  /public/playground/presets/:id?owner=
 *   DELETE /public/playground/presets/:id?owner=
 *   POST   /public/playground/presets/:id/mark-used?owner=   触发 lastUsedAt 更新
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { FreeLLMError } from '@freellm/shared';
import { getPrisma } from '../../lib/prisma.js';
import { PlaygroundPresetService } from '../../services/playground-preset.service.js';

const ownerIdSchema = z.string().min(8).max(80);

function serialize(p: {
  id: string;
  ownerId: string;
  name: string;
  systemPrompt: string | null;
  preferredModel: string | null;
  temperature: number | null;
  maxTokens: number | null;
  streaming: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastUsedAt: Date | null;
}) {
  return {
    id: p.id,
    name: p.name,
    systemPrompt: p.systemPrompt,
    preferredModel: p.preferredModel,
    temperature: p.temperature,
    maxTokens: p.maxTokens,
    streaming: p.streaming,
    notes: p.notes,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    lastUsedAt: p.lastUsedAt,
  };
}

const plugin: FastifyPluginAsync = async (app) => {
  app.get('/public/playground/presets', async (req) => {
    const query = z.object({ owner: ownerIdSchema }).parse(req.query);
    const svc = new PlaygroundPresetService(getPrisma());
    const rows = await svc.list(query.owner);
    return { data: rows.map(serialize), total: rows.length };
  });

  app.post('/public/playground/presets', async (req) => {
    const body = z
      .object({
        ownerId: ownerIdSchema,
        name: z.string().min(1).max(80),
        systemPrompt: z.string().max(16 * 1024).optional().nullable(),
        preferredModel: z.string().max(120).optional().nullable(),
        temperature: z.number().min(0).max(2).optional().nullable(),
        maxTokens: z.number().int().min(1).max(64_000).optional().nullable(),
        streaming: z.boolean().optional(),
        notes: z.string().max(1024).optional().nullable(),
      })
      .parse(req.body ?? {});
    const svc = new PlaygroundPresetService(getPrisma());
    const created = await svc.create(body);
    return { ok: true, preset: serialize(created) };
  });

  app.get('/public/playground/presets/:id', async (req) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const query = z.object({ owner: ownerIdSchema }).parse(req.query);
    const svc = new PlaygroundPresetService(getPrisma());
    const row = await svc.findByIdForOwner(params.id, query.owner);
    if (!row) {
      throw new FreeLLMError('not_found', '预设不存在或无权访问');
    }
    return { preset: serialize(row) };
  });

  app.patch('/public/playground/presets/:id', async (req) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const query = z.object({ owner: ownerIdSchema }).parse(req.query);
    const body = z
      .object({
        name: z.string().min(1).max(80).optional(),
        systemPrompt: z.string().max(16 * 1024).optional().nullable(),
        preferredModel: z.string().max(120).optional().nullable(),
        temperature: z.number().min(0).max(2).optional().nullable(),
        maxTokens: z.number().int().min(1).max(64_000).optional().nullable(),
        streaming: z.boolean().optional(),
        notes: z.string().max(1024).optional().nullable(),
      })
      .parse(req.body ?? {});
    const svc = new PlaygroundPresetService(getPrisma());
    const updated = await svc.update(params.id, query.owner, body);
    return { ok: true, preset: serialize(updated) };
  });

  app.delete('/public/playground/presets/:id', async (req) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const query = z.object({ owner: ownerIdSchema }).parse(req.query);
    const svc = new PlaygroundPresetService(getPrisma());
    await svc.delete(params.id, query.owner);
    return { ok: true };
  });

  app.post('/public/playground/presets/:id/mark-used', async (req) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const query = z.object({ owner: ownerIdSchema }).parse(req.query);
    const svc = new PlaygroundPresetService(getPrisma());
    const updated = await svc.markUsed(params.id, query.owner);
    return { ok: true, preset: serialize(updated) };
  });
};

export default plugin;
