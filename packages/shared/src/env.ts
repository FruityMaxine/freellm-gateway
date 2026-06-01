/**
 * Strongly-typed environment loader.
 *
 * Used by both the api server and the seed/migrate scripts. Validation is done
 * with zod so a missing or malformed value fails loudly at startup instead of
 * silently driving the routing engine into undefined behaviour.
 */
import { z } from 'zod';

const BoolFromString = z
  .union([z.boolean(), z.string()])
  .transform((v) => {
    if (typeof v === 'boolean') return v;
    return v.toLowerCase() === 'true' || v === '1' || v === 'yes';
  });

const IntFromString = z
  .union([z.number(), z.string()])
  .transform((v) => (typeof v === 'number' ? v : Number.parseInt(v, 10)))
  .refine((n) => Number.isFinite(n), 'expected a finite integer');

export const envSchema = z.object({
  FREELLM_API_HOST: z.string().default('127.0.0.1'),
  FREELLM_API_PORT: IntFromString.default(3001),
  FREELLM_API_BASE_URL: z.string().url().default('http://127.0.0.1:3001'),
  FREELLM_WEB_ORIGIN: z.string().url().default('http://127.0.0.1:5173'),
  FREELLM_NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  FREELLM_LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
  DATABASE_URL: z.string().min(1).default('file:../data/freellm.db'),
  // 审计 P0-5：master key 必须解码为 ≥32 字节，前置阀值提升到 32 字符。
  FREELLM_MASTER_KEY: z
    .string()
    .min(32, 'FREELLM_MASTER_KEY must be ≥32 chars (base64 or hex of 32 bytes)'),
  // 审计 P0-3：session secret 阀值上调到 ≥32；schema 不带 default —
  // loadEnv() 仅在 NODE_ENV !== production 时回落到已知不安全的 dev key。
  FREELLM_SESSION_SECRET: z.string().min(32, 'FREELLM_SESSION_SECRET must be ≥32 chars'),
  FREELLM_ADMIN_USERNAME: z.string().default('admin'),
  // 审计 P0-3：初始密码 ≥12 字符；默认值只在 dev 环境用。
  FREELLM_ADMIN_PASSWORD: z
    .string()
    .min(12, 'FREELLM_ADMIN_PASSWORD must be ≥12 chars')
    .default('ChangeMe_OnFirstLogin'),
  FREELLM_OPENROUTER_API_KEY: z.string().optional().default(''),
  FREELLM_OPENROUTER_BASE_URL: z
    .string()
    .url()
    .default('https://openrouter.ai/api/v1'),
  FREELLM_OPENAI_API_KEY: z.string().optional().default(''),
  FREELLM_OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  FREELLM_ANTHROPIC_API_KEY: z.string().optional().default(''),
  FREELLM_ANTHROPIC_BASE_URL: z.string().url().default('https://api.anthropic.com'),
  FREELLM_DEEPSEEK_API_KEY: z.string().optional().default(''),
  FREELLM_DEEPSEEK_BASE_URL: z.string().url().default('https://api.deepseek.com/v1'),
  FREELLM_GOOGLE_API_KEY: z.string().optional().default(''),
  FREELLM_GOOGLE_BASE_URL: z
    .string()
    .url()
    .default('https://generativelanguage.googleapis.com/v1beta'),
  FREELLM_MODEL_DISCOVERY_INTERVAL_MIN: IntFromString.default(30),
  // Tick 31 v1.7.3.0：Provider 健康检查周期（分钟），0 = 关闭 cron。
  FREELLM_PROVIDER_HEALTH_INTERVAL_MIN: IntFromString.default(5),
  // Tick 34 v1.7.6.0：模型自动黑名单 cron 周期（分钟）。
  FREELLM_MODEL_AUTO_BLACKLIST_INTERVAL_MIN: IntFromString.default(15),
  // Tick 37 v1.7.9.0：Provider 余额周期检查 cron（分钟，默认 4 小时）。
  FREELLM_PROVIDER_BALANCE_CHECK_INTERVAL_MIN: IntFromString.default(240),
  // Tick 39 v1.7.11.0：VK 用量预警 cron（分钟，默认 1 小时）。
  FREELLM_VK_USAGE_ALERT_INTERVAL_MIN: IntFromString.default(60),
  // Tick 46 v1.7.18.0：数据保留清扫 cron（分钟，默认 24 小时）。
  FREELLM_RETENTION_PURGE_INTERVAL_MIN: IntFromString.default(24 * 60),
  FREELLM_MAX_ROUTE_ATTEMPTS: IntFromString.default(4),
  FREELLM_REQUEST_TIMEOUT_MS: IntFromString.default(60_000),
  FREELLM_ALLOW_PAID_FALLBACK: BoolFromString.default(false),
  FREELLM_LOG_PROMPT_DIGEST: BoolFromString.default(true),
  FREELLM_LOG_FULL_PROMPT: BoolFromString.default(false),
  FREELLM_MOCK_PROVIDERS_ENABLED: BoolFromString.default(true),
});

export type FreeLLMEnv = z.infer<typeof envSchema>;

// 已知不安全占位符 — 仅在 NODE_ENV !== production 时自动注入，
// 避免 dev 首次 clone 需要先生成密钥。生产环境必须显式提供两把密钥，
// 否则 loadEnv 抛出明确错误。
const DEV_MASTER_KEY = 'dev-master-key-CHANGE-IN-PROD-32bytes-please';
const DEV_SESSION_SECRET = 'dev-session-secret-CHANGE-IN-PROD-32bytes';

/**
 * 将 process.env 解析为校验后的配置。
 * test / development 下，缺失密钥会自动填充已知占位符；
 * production 下，缺失密钥会硬失败并打印明确错误。
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): FreeLLMEnv {
  const augmented = { ...source };
  const mode = augmented.FREELLM_NODE_ENV ?? 'development';
  if (!augmented.FREELLM_MASTER_KEY && mode !== 'production') {
    augmented.FREELLM_MASTER_KEY = DEV_MASTER_KEY;
  }
  if (!augmented.FREELLM_SESSION_SECRET && mode !== 'production') {
    augmented.FREELLM_SESSION_SECRET = DEV_SESSION_SECRET;
  }
  const result = envSchema.safeParse(augmented);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid FreeLLM environment:\n${issues}`);
  }
  return result.data;
}
