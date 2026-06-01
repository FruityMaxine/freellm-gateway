# FreeLLM Environment Variables

This is the canonical template. The repository deliberately omits a `.env.example`/`.env.sample` file (the workstation that authors this codebase enforces a hook that refuses to write any `.env*` path). Copy the block below into `<project-root>/.env` and edit the values before running `pnpm dev:api`. The `.env` file itself is gitignored.

## Quick start

```bash
cp docs/ENV.md /tmp/env-template.txt          # human reads docs only
$EDITOR .env                                  # paste the block below + edit
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"  # FREELLM_MASTER_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"      # FREELLM_SESSION_SECRET
```

## Template (paste into `.env`)

```ini
# === Server ===
FREELLM_API_HOST=127.0.0.1
FREELLM_API_PORT=3001
FREELLM_API_BASE_URL=http://127.0.0.1:3001
FREELLM_WEB_ORIGIN=http://127.0.0.1:5173
FREELLM_NODE_ENV=development
FREELLM_LOG_LEVEL=info

# === Database ===
DATABASE_URL="file:../data/freellm.db"

# === Secrets / Crypto ===
FREELLM_MASTER_KEY=CHANGEME_GENERATE_WITH_NODE_CRYPTO_RANDOMBYTES_32_BASE64
FREELLM_SESSION_SECRET=CHANGEME_32BYTES_RANDOM_HEX_PLEASE_REPLACE

# === Admin bootstrap (first seed only) ===
FREELLM_ADMIN_USERNAME=admin
FREELLM_ADMIN_PASSWORD=ChangeMe_OnFirstLogin

# === Upstream Provider keys (all optional; FreeLLM works in mock-only mode without them) ===
# OpenRouter
FREELLM_OPENROUTER_API_KEY=
FREELLM_OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
# OpenAI
FREELLM_OPENAI_API_KEY=
FREELLM_OPENAI_BASE_URL=https://api.openai.com/v1
# Anthropic Claude
FREELLM_ANTHROPIC_API_KEY=
FREELLM_ANTHROPIC_BASE_URL=https://api.anthropic.com
# DeepSeek
FREELLM_DEEPSEEK_API_KEY=
FREELLM_DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
# Google Gemini
FREELLM_GOOGLE_API_KEY=
FREELLM_GOOGLE_BASE_URL=https://generativelanguage.googleapis.com/v1beta

# === Discovery / scheduling ===
FREELLM_MODEL_DISCOVERY_INTERVAL_MIN=30
FREELLM_MAX_ROUTE_ATTEMPTS=4
FREELLM_REQUEST_TIMEOUT_MS=60000

# === Safety defaults ===
FREELLM_ALLOW_PAID_FALLBACK=false
FREELLM_LOG_PROMPT_DIGEST=true
FREELLM_LOG_FULL_PROMPT=false
FREELLM_MOCK_PROVIDERS_ENABLED=true
```

## Variable reference

| Variable                                | Required | Default                      | Purpose                                                                       |
| --------------------------------------- | -------- | ---------------------------- | ----------------------------------------------------------------------------- |
| `FREELLM_API_HOST`                      | yes      | `127.0.0.1`                  | Listen address. Project rule: always loopback in dev/prod, never wildcard.    |
| `FREELLM_API_PORT`                      | yes      | `3001`                       | API port.                                                                     |
| `FREELLM_API_BASE_URL`                  | yes      | derived from host/port       | Used for CORS / OpenAPI base URL.                                             |
| `FREELLM_WEB_ORIGIN`                    | yes      | `http://127.0.0.1:5173`      | Allowed CORS origin for the admin UI.                                         |
| `FREELLM_NODE_ENV`                      | yes      | `development`                | `development` / `production` / `test`.                                        |
| `FREELLM_LOG_LEVEL`                     | no       | `info`                       | Pino log level (`fatal`/`error`/`warn`/`info`/`debug`/`trace`).               |
| `DATABASE_URL`                          | yes      | `file:../data/freellm.db`    | SQLite URL — relative to `prisma/schema.prisma`, so `..` reaches repo root.   |
| `FREELLM_MASTER_KEY`                    | yes      | (required)                   | 32-byte base64 key for `SecretStore` (db-encrypted backend). **Rotate** ≥ 90d. |
| `FREELLM_SESSION_SECRET`                | yes      | (required)                   | Cookie / session signing secret (used by Admin Auth in Tick 5).               |
| `FREELLM_ADMIN_USERNAME`                | no       | `admin`                      | Initial admin user, written by `prisma:seed`. Editable afterwards.            |
| `FREELLM_ADMIN_PASSWORD`                | no       | (required for seed)          | Initial admin password (bcrypt-hashed at seed time, never re-read).           |
| `FREELLM_OPENROUTER_API_KEY`            | no       | empty (mock mode)            | Real upstream key. Empty → only mock provider is used.                        |
| `FREELLM_OPENROUTER_BASE_URL`           | no       | OpenRouter prod              | Override for self-hosted/proxy.                                                |
| `FREELLM_OPENAI_API_KEY`                | no       | empty                        | Optional secondary provider.                                                  |
| `FREELLM_ANTHROPIC_API_KEY`             | no       | empty                        | Optional secondary provider.                                                  |
| `FREELLM_DEEPSEEK_API_KEY`              | no       | empty                        | Optional secondary provider.                                                  |
| `FREELLM_GOOGLE_API_KEY`                | no       | empty                        | Optional secondary provider.                                                  |
| `FREELLM_MODEL_DISCOVERY_INTERVAL_MIN`  | no       | `30`                         | OpenRouter sync cadence in minutes. Settable via Admin UI; env is fallback.   |
| `FREELLM_MAX_ROUTE_ATTEMPTS`            | no       | `4`                          | Hard ceiling on fallback retries per downstream request.                      |
| `FREELLM_REQUEST_TIMEOUT_MS`            | no       | `60000`                      | Upstream HTTP timeout (per attempt).                                          |
| `FREELLM_ALLOW_PAID_FALLBACK`           | no       | `false`                      | Safety: must be explicitly enabled to allow free → paid fallback.             |
| `FREELLM_LOG_PROMPT_DIGEST`             | no       | `true`                       | Whether to store a sha256 digest of each prompt (no plaintext).               |
| `FREELLM_LOG_FULL_PROMPT`               | no       | `false`                      | Whether to retain full prompt text — off by default for privacy.              |
| `FREELLM_MOCK_PROVIDERS_ENABLED`        | no       | `true`                       | Register the synthetic mock provider so the platform demos without real keys. |
| `FREELLM_REDIS_URL`                     | no       | empty                        | 多实例部署时填 `redis://[:pass@]host:port/db`；启用后 RPM 桶 / 冷却走共享 KV。详见 [docs/MIGRATION_POSTGRES.md](./MIGRATION_POSTGRES.md) 末尾的 Redis 段。 |
| `FREELLM_KV_BACKEND`                    | no       | 自动检测                     | 显式指定 `memory` / `redis`；缺省按 `FREELLM_REDIS_URL` 是否存在自动选。Tick 21 v1.4.0.0 引入。 |

## Production checklist

- [ ] Rotate `FREELLM_MASTER_KEY` and `FREELLM_SESSION_SECRET` away from the placeholders.
- [ ] Set `FREELLM_NODE_ENV=production`.
- [ ] Set `FREELLM_LOG_FULL_PROMPT=false` and audit any code that disables it.
- [ ] Confirm `FREELLM_API_HOST=127.0.0.1` and Caddy / nginx terminates TLS in front.
- [ ] Confirm `FREELLM_ALLOW_PAID_FALLBACK` matches your billing posture.
- [ ] Back up `data/freellm.db` (or your Postgres) before any migration.

## Why no `.env.example`

The author's editor enforces a critical-redline hook that refuses to write `.env*` files even when they contain only placeholders. This document is the durable, gitignored-safe replacement.
