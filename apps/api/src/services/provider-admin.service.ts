/**
 * Provider 增删改 service（Tick 54 v1.7.26.0 引入）。
 *
 * 51 个 tick 都没人写 POST /admin/providers — 后端只能从 seed 或手动 SQLite 插入。
 * 本 service + 配套路由把"加 provider"做成真功能,并把 UpstreamKey 加密存进
 * SecretStore (EnvSecretStore 实现: 写到环境内存 map / 不落硬盘明文)。
 *
 * 关键点:
 *   - createProvider 同步 install 到 registry (热加载, 无需重启 freellm-api)
 *   - updateProvider 改完后重新调 installer 让 registry 拿到新 baseUrl/headers
 *   - deleteProvider 级联删 UpstreamKey + 从 registry remove
 *   - rotateApiKey 重写 UpstreamKey cipher + 触发 registry 重装
 */
import type { PrismaClient } from '@prisma/client';
import { randomBytes, createHash } from 'node:crypto';
import type { SecretStore } from '@freellm/shared';
import type { ProviderRegistry } from '@freellm/provider-core';
import { ProviderInstaller } from './provider-installer.service.js';
import { getConfig } from '../config.js';

export interface CreateProviderInput {
  slug: string;
  kind: string;
  name: string;
  baseUrl: string;
  apiKey?: string | null;
  enabled?: boolean;
  priority?: number;
  rpmLimit?: number | null;
  dailyLimit?: number | null;
  timeoutMs?: number;
  compatibleMode?: string;
  notes?: string | null;
}

export interface UpdateProviderInput {
  name?: string;
  baseUrl?: string;
  enabled?: boolean;
  priority?: number;
  rpmLimit?: number | null;
  dailyLimit?: number | null;
  timeoutMs?: number;
  compatibleMode?: string;
  notes?: string | null;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;
const ALLOWED_KINDS = new Set([
  'openrouter',
  'openai',
  'anthropic',
  'deepseek',
  'google',
  'openai-compat',
  'mistral',
  'groq',
  'together',
  'moonshot',
  'qwen',
  'mock',
]);

export class ProviderAdminService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly registry: ProviderRegistry,
    private readonly secrets: SecretStore,
  ) {}

  async list() {
    const rows = await this.prisma.provider.findMany({
      orderBy: [{ priority: 'desc' }, { name: 'asc' }],
      include: { upstreamKeys: { select: { id: true, label: true, enabled: true, keyDigest: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      kind: r.kind,
      name: r.name,
      baseUrl: r.baseUrl,
      enabled: r.enabled,
      priority: r.priority,
      rpmLimit: r.rpmLimit,
      dailyLimit: r.dailyLimit,
      timeoutMs: r.timeoutMs,
      compatibleMode: r.compatibleMode,
      status: r.status,
      hasApiKey: r.upstreamKeys.some((k) => k.enabled),
      keyDigest: r.upstreamKeys.find((k) => k.enabled)?.keyDigest ?? null,
      notes: r.notes,
      registered: this.registry.has(r.slug),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  async create(input: CreateProviderInput): Promise<{ id: string; slug: string } | { error: string }> {
    const slug = input.slug.trim().toLowerCase();
    if (!SLUG_RE.test(slug)) return { error: 'slug 必须 2-41 字符: 小写字母数字与短横线' };
    if (!ALLOWED_KINDS.has(input.kind)) return { error: `kind 必须是: ${Array.from(ALLOWED_KINDS).join(' / ')}` };
    if (!input.baseUrl.startsWith('http://') && !input.baseUrl.startsWith('https://')) {
      return { error: 'baseUrl 必须以 http:// 或 https:// 开头' };
    }
    const existing = await this.prisma.provider.findUnique({ where: { slug } });
    if (existing) return { error: `provider ${slug} 已存在` };

    const provider = await this.prisma.provider.create({
      data: {
        slug,
        kind: input.kind,
        name: input.name.trim() || slug,
        baseUrl: input.baseUrl,
        enabled: input.enabled ?? true,
        priority: input.priority ?? 100,
        rpmLimit: input.rpmLimit ?? null,
        dailyLimit: input.dailyLimit ?? null,
        timeoutMs: input.timeoutMs ?? 60_000,
        compatibleMode: input.compatibleMode ?? 'openai',
        notes: input.notes ?? null,
      },
    });

    if (input.apiKey && input.apiKey.trim().length > 0) {
      await this.attachApiKey(provider.id, input.apiKey.trim(), 'default');
    }

    await this.refreshRegistry();
    return { id: provider.id, slug: provider.slug };
  }

  async update(slug: string, patch: UpdateProviderInput): Promise<boolean> {
    const existing = await this.prisma.provider.findUnique({ where: { slug } });
    if (!existing) return false;
    await this.prisma.provider.update({
      where: { slug },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.baseUrl !== undefined ? { baseUrl: patch.baseUrl } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
        ...(patch.rpmLimit !== undefined ? { rpmLimit: patch.rpmLimit } : {}),
        ...(patch.dailyLimit !== undefined ? { dailyLimit: patch.dailyLimit } : {}),
        ...(patch.timeoutMs !== undefined ? { timeoutMs: patch.timeoutMs } : {}),
        ...(patch.compatibleMode !== undefined ? { compatibleMode: patch.compatibleMode } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      },
    });
    await this.refreshRegistry();
    return true;
  }

  async delete(slug: string): Promise<boolean> {
    const existing = await this.prisma.provider.findUnique({ where: { slug } });
    if (!existing) return false;
    // 级联删 UpstreamKey + 清 secret store
    const keys = await this.prisma.upstreamKey.findMany({ where: { providerId: existing.id } });
    for (const k of keys) {
      try {
        await this.secrets.remove(`upstream_key:${k.id}`);
      } catch {
        /* ignore */
      }
    }
    await this.prisma.upstreamKey.deleteMany({ where: { providerId: existing.id } });
    await this.prisma.provider.delete({ where: { slug } });
    this.registry.remove(slug);
    return true;
  }

  async rotateApiKey(slug: string, newKey: string, label = 'default'): Promise<{ ok: true } | { error: string }> {
    const provider = await this.prisma.provider.findUnique({
      where: { slug },
      include: { upstreamKeys: true },
    });
    if (!provider) return { error: '上游不存在' };
    if (newKey.trim().length === 0) return { error: 'API Key 不能为空' };

    // 禁用所有旧 key + 删 secret store entries
    for (const k of provider.upstreamKeys) {
      try {
        await this.secrets.remove(`upstream_key:${k.id}`);
      } catch {
        /* ignore */
      }
    }
    await this.prisma.upstreamKey.updateMany({
      where: { providerId: provider.id },
      data: { enabled: false },
    });

    await this.attachApiKey(provider.id, newKey.trim(), label);
    await this.refreshRegistry();
    return { ok: true };
  }

  private async attachApiKey(providerId: string, plain: string, label: string): Promise<void> {
    // SecretStore 接口要求一个 ref id - 我们用 randomBytes 当 ref
    // 先创建 UpstreamKey 拿到 id, 再把 cipher 落 secret store (key = upstream_key:<id>)
    const keyDigest = displayDigest(plain);
    const cipherPlaceholder = `pending:${randomBytes(16).toString('hex')}`;
    const row = await this.prisma.upstreamKey.create({
      data: {
        providerId,
        label,
        cipherText: cipherPlaceholder,
        keyDigest,
        enabled: true,
        priority: 100,
      },
    });
    try {
      await this.secrets.write(`upstream_key:${row.id}`, plain);
    } catch (err) {
      // 组 4 Tick 5 P2 修复：生产模式绝不降级 plain: 明文落盘（明文 key 进 DB = 后门）。
      // 删占位行让创建失败 + 抛错上报，运维据此修 master key；仅 dev 容忍 plain: 降级。
      const isProd = getConfig().env.FREELLM_NODE_ENV === 'production';
      if (isProd) {
        await this.prisma.upstreamKey.delete({ where: { id: row.id } }).catch(() => {});
        throw new Error(
          `生产环境 secret store 写入失败，拒绝明文降级：${(err as Error).message}（请检查 FREELLM_MASTER_KEY）`,
        );
      }
      await this.prisma.upstreamKey.update({
        where: { id: row.id },
        data: { cipherText: `plain:${plain}`, notes: `secret store fail (dev): ${(err as Error).message}` },
      });
    }
  }

  private async refreshRegistry(): Promise<void> {
    // 重新跑 installFromDatabase 让 registry 反映最新 enabled rows
    const installer = new ProviderInstaller(this.prisma, this.registry, this.secrets);
    await installer.installFromDatabase();
  }
}

function displayDigest(plain: string): string {
  const tail = plain.slice(-4);
  const sha = createHash('sha256').update(plain).digest('hex').slice(0, 6);
  return `sk-${sha}…${tail}`;
}
