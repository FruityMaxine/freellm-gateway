/**
 * Bridges the DB-resident `providers` rows with the in-process
 * `ProviderRegistry`. The api app calls `installFromDatabase` once at boot
 * and again whenever an admin edits a provider row.
 *
 * Concrete provider kinds are registered as factories here — that's the
 * single point where the application says "we know how to talk to
 * OpenRouter/OpenAI/Mock/…". Future kinds plug in by adding one line.
 */
import type { PrismaClient } from '@prisma/client';
import {
  type ProviderRegistry,
  parseProviderConfig,
  openrouterFactory,
  mockOpenRouterFactory,
} from '@freellm/provider-core';
import type { SecretStore } from '@freellm/shared';
import { getConfig } from '../config.js';

export interface InstallReport {
  installed: string[];
  skipped: Array<{ slug: string; reason: string }>;
}

export class ProviderInstaller {
  constructor(
    private prisma: PrismaClient,
    private registry: ProviderRegistry,
    private secrets: SecretStore,
  ) {
    // Register factories once per process.
    this.registry.registerFactory('openrouter', (cfg, cred) => {
      if (cfg.slug.startsWith('mock-') || cfg.slug === 'mock-openrouter') {
        return mockOpenRouterFactory(cfg, cred);
      }
      return openrouterFactory(cfg, cred);
    });
    // Catch-all OpenAI-compatible factory falls back to OpenRouter base for now;
    // dedicated openai / deepseek / anthropic factories land in later ticks.
  }

  async installFromDatabase(): Promise<InstallReport> {
    const { env } = getConfig();
    const rows = await this.prisma.provider.findMany({ where: { enabled: true } });
    const installed: string[] = [];
    const skipped: { slug: string; reason: string }[] = [];

    for (const row of rows) {
      const cfg = (() => {
        try {
          return parseProviderConfig({
            slug: row.slug,
            kind: row.kind,
            name: row.name,
            baseUrl: row.baseUrl,
            enabled: row.enabled,
            priority: row.priority,
            rpmLimit: row.rpmLimit ?? null,
            dailyLimit: row.dailyLimit ?? null,
            timeoutMs: row.timeoutMs,
            supportsStreaming: row.supportsStreaming,
            compatibleMode: row.compatibleMode,
            ...(row.headerOverrides ? { headerOverrides: safeJsonObject(row.headerOverrides) } : {}),
            ...(row.region ? { region: row.region } : {}),
            ...(row.notes ? { notes: row.notes } : {}),
          });
        } catch (err) {
          skipped.push({ slug: row.slug, reason: `invalid config: ${(err as Error).message}` });
          return null;
        }
      })();
      if (!cfg) continue;

      const apiKey = await this.resolveKey(row.slug, env);
      const credential = {
        apiKey,
        baseUrl: row.baseUrl,
        ...(cfg.headerOverrides ? { headerOverrides: cfg.headerOverrides } : {}),
      };
      try {
        this.registry.install(cfg, credential);
        installed.push(row.slug);
      } catch (err) {
        skipped.push({ slug: row.slug, reason: (err as Error).message });
      }
    }

    return { installed, skipped };
  }

  /**
   * Resolve a provider's upstream API key. Order of preference:
   *   1. Per-provider `UpstreamKey` cipher-text (production).
   *   2. Per-provider env var fallback like `FREELLM_OPENROUTER_API_KEY`.
   *   3. `null` — provider runs in mock/offline mode.
   */
  private async resolveKey(slug: string, env: Record<string, unknown>): Promise<string | null> {
    const row = await this.prisma.upstreamKey.findFirst({
      where: { provider: { slug }, enabled: true },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });
    if (row) {
      try {
        const plain = await this.secrets.read(`upstream_key:${row.id}`);
        if (plain) return plain;
      } catch (err) {
        // 组 4 Tick 5 P0 修复：解密失败绝不静默吞——这是"网关假活"的唯一诊断信号。
        // key 不存在是正常 fall through；read 抛错 = 密文损坏/master key 轮换/AAD 不符，
        // 必须 error 级醒目记录，否则又退回"假活且无日志可查"（组 4 三 tick 修复的根因）。
        console.error(
          `[provider-installer] upstream key 解密失败 slug=${slug} ` +
            `ref=upstream_key:${row.id}: ${(err as Error).message} ` +
            `— 回落 env，该 provider 可能无凭据运行（网关假活风险，请检查 master key / 密文完整性）`,
        );
      }
    }
    // Env fallback — handy for dev. e.g. openrouter → FREELLM_OPENROUTER_API_KEY
    const envKey = `FREELLM_${slug.toUpperCase().replace(/-/g, '_')}_API_KEY`;
    const v = env[envKey];
    return typeof v === 'string' && v.length > 0 ? v : null;
  }
}

function safeJsonObject(raw: string): Record<string, string> | undefined {
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(obj)) out[k] = String(v);
      return out;
    }
  } catch {
    /* ignore */
  }
  return undefined;
}
