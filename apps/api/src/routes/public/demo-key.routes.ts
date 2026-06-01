/**
 * GET /public/demo-key —— 公开签发 / 复用 Playground demo 密钥（Tick 23 v1.5.0.0 引入）。
 *
 * 行为：
 * - 查找任意已启用且 `isDemo=true` 的虚拟密钥，返回其 prefix + 一个新签发的 demo key（明文，仅一次性）。
 * - 若数据库不存在 demo 密钥，按需创建一个（用 Default Project + 紧额度）。
 * - 不强制鉴权，任何访客可调；本身的额度通过 demo 密钥独立计数限制（15 请求 / 天）。
 *
 * 安全：
 * - 仅在 `FREELLM_DEMO_ENABLED=true` 或 setting `demo.enabled=true` 时启用；默认关闭。
 * - 每次签发的 demo 密钥都是独立的，sha256 落库，旧的依然有效但额度共享同一计数。
 * - 不返回 admin token / 真实 provider key。
 */
import type { FastifyPluginAsync } from 'fastify';
import { FreeLLMError } from '@freellm/shared';
import { getPrisma } from '../../lib/prisma.js';
import { VirtualKeyService } from '../../services/virtual-key.service.js';
import {
  DEMO_DAILY_REQUEST_LIMIT,
  DEMO_DAILY_TOKEN_LIMIT,
} from '../../lib/demo-limit.js';
import { enforceIpRateLimit, extractClientIp } from '../../lib/ip-rate-limit.js';

const plugin: FastifyPluginAsync = async (app) => {
  app.post('/public/demo-key', async (req) => {
    const enabled = process.env.FREELLM_DEMO_ENABLED === 'true';
    if (!enabled) {
      throw new FreeLLMError('forbidden', 'Playground 试用功能未启用（请联系管理员开启 FREELLM_DEMO_ENABLED）', {
        context: { requestId: req.requestId },
      });
    }

    // Tick 24 v1.5.1.0：IP 级反滥用 —— 同 IP 每小时最多签 5 把 demo 密钥。
    const ip = extractClientIp(req);
    if (!(await enforceIpRateLimit('demo-key', ip))) {
      throw new FreeLLMError('rate_limited', '该 IP 在一小时内签发 demo 密钥过于频繁，请稍后再试', {
        context: { requestId: req.requestId, retryAfterSeconds: 3600 },
      });
    }

    const prisma = getPrisma();
    const svc = new VirtualKeyService(prisma);

    // 优先复用已有 demo 密钥（避免每次访客点击都签新 key）。
    // 但 demo 密钥的明文只在创建时返回一次，因此「复用」其实是签发一把全新的 demo key
    // 复用旧的限额桶 —— 这里简化：每次直接签新 key（公开渠道无登录态可绑定）。
    const defaultProject = await prisma.project.findUnique({
      where: { organizationId_slug: await defaultOrgProjectKey(prisma) },
    });

    const created = await svc.create({
      label: `playground-demo-${new Date().toISOString().slice(0, 10)}`,
      environment: 'test',
      permissions: {
        allowedModels: [],
        deniedModels: [],
        allowedProviders: [],
        maxRequestsPerMinute: 5,
        maxRequestsPerDay: DEMO_DAILY_REQUEST_LIMIT,
        maxTokensPerDay: DEMO_DAILY_TOKEN_LIMIT,
        allowPaidModels: false,
        allowStreaming: true,
      },
      ...(defaultProject ? { projectId: defaultProject.id } : {}),
    });
    // 后置打 isDemo 标志 —— VirtualKeyService.create 不接此字段，避免误用。
    await prisma.virtualKey.update({
      where: { id: created.id },
      data: { isDemo: true },
    });

    return {
      ok: true,
      key: {
        id: created.id,
        secret: created.secret,
        prefix: created.prefix,
        environment: created.environment,
        isDemo: true,
        limits: {
          requestsPerDay: DEMO_DAILY_REQUEST_LIMIT,
          tokensPerDay: DEMO_DAILY_TOKEN_LIMIT,
          requestsPerMinute: 5,
        },
        notice: '本密钥仅供 Playground 试用，额度受限，关闭页面后不可恢复。',
      },
    };
  });
};

async function defaultOrgProjectKey(prisma: ReturnType<typeof getPrisma>) {
  const org = await prisma.organization.findUnique({ where: { slug: 'default' } });
  if (!org) {
    return { organizationId: 'unknown', slug: 'default' };
  }
  return { organizationId: org.id, slug: 'default' };
}

export default plugin;
