# FreeLLM

> Self-hosted, OpenAI-compatible LLM gateway with policy-driven multi-provider routing and a complete operations console.

*[中文版 / Chinese README](README.zh.md)*

FreeLLM sits between your applications and upstream LLM providers (OpenRouter, OpenAI, Anthropic, or any OpenAI-compatible endpoint). Downstream, it speaks the standard OpenAI API, so existing SDKs work unchanged. Upstream, a scoring engine routes each request across a pool of models with automatic failover, circuit breaking, and per-request cost accounting. An admin console covers routing, cost governance, alerting, multi-tenancy, and observability.

It is, in effect, a self-hostable OpenRouter with a full operations backend — no vendor lock-in, no per-seat pricing.

---

## Why

Calling LLM providers directly couples your application to one vendor's availability, pricing, and model catalog. Hosted aggregators solve that but are themselves a dependency you cannot inspect, extend, or run on your own infrastructure.

FreeLLM is the gateway you run yourself:

- **One stable API** in front of many shifting providers and models.
- **Routing as policy, not code** — weight the dimensions you care about (latency, cost, quality, …) and let the engine pick.
- **Cost and quota control** built into the key model, not bolted on afterwards.
- **Full visibility** — every request's routing decision, every dollar, every failure, auditable.

---

## Features

### OpenAI-compatible API
- `POST /v1/chat/completions` (streaming and non-streaming), `POST /v1/embeddings`, `GET /v1/models`, plus key and usage introspection.
- Point an existing OpenAI SDK's `base_url` at FreeLLM and authenticate with a FreeLLM virtual key — no code changes.

### Routing engine
- **Composite scoring across 9 dimensions**: availability, latency, rate-limit headroom, quality, context window, capability, freshness, cost, and stability.
- **Seven routing modes** (best-free, round-robin, weighted, provider-specific, prefer-model-with-fallback, paid-allowed, …).
- **Named policies** with live activation (a single active policy is enforced transactionally) and a **visual weight editor** that re-ranks real models as you move each slider.
- **Resilience**: automatic cooldown / circuit breaking, fallback chains, a per-request route-attempt waterfall, and cross-request failure-mode aggregation.

### Model management
- Automatic provider model discovery and snapshotting, with a **diff timeline** showing how each model's pricing, capabilities, and context window changed over time.
- **Capability matrix** (every model × stream / json / tools / vision / audio / reasoning / long-context), multi-model comparison, and a **batch test bench** that runs one prompt across several models side by side.

### Cost governance
- Cost analytics by virtual key, by model, and by **organization / project**.
- **Budgets** (global / per-key / per-model, daily / weekly / monthly) that feed the alerting engine when usage crosses a threshold.

### Multi-tenancy & keys
- Organizations → projects → **virtual keys**, each with quotas (requests/min, requests/day, tokens/day, embeddings/day, USD/day) and model/provider allow-lists.
- Upstream provider keys are encrypted at rest; secrets are never logged or returned to the frontend.

### Alerting & integrations
- **Rule engine**: metric × operator × threshold, evaluated on a schedule.
- **Multi-channel dispatch**: email (via a pluggable HTTP mail relay), Slack, and generic webhooks — outbound URLs are SSRF-guarded.
- **Outbound webhooks** with HMAC signing, exponential-backoff retry, and a delivery history.

### Observability
- Real-time dashboard (24h KPIs + system health), request audit log with the routing waterfall, admin action audit, and a Prometheus metrics endpoint.

### Roles
- Admin (full console), user (own keys, logs, and playground), and anonymous read-only / playground access.

---

## Architecture

```
                         ┌──────────────────────────────────────────┐
   Downstream apps  ───▶ │  /v1/*  (OpenAI-compatible)               │
   (OpenAI SDKs)         │   └─ virtual-key auth + quota enforcement │
                         │                                          │
                         │  Routing engine                          │
                         │   └─ 9-dim scoring → policy → candidate   │
                         │      pool → cooldown / fallback chain     │
                         └───────────────┬──────────────────────────┘
                                         │
                  ┌──────────────────────┼──────────────────────┐
                  ▼                      ▼                      ▼
            OpenRouter               OpenAI            Any OpenAI-compatible
                                         │
                         ┌───────────────┴──────────────────────────┐
                         │  Telemetry: request logs · route attempts │
                         │  · cost · errors · health checks          │
                         └───────────────┬──────────────────────────┘
                                         │
                         ┌───────────────┴──────────────────────────┐
   Admin console  ◀───── │  Fastify admin API  ◀── React + Vite SPA  │
   (routing / cost /     └───────────────────────────────────────────┘
    alerts / tenancy)
```

**Monorepo layout** (pnpm workspaces):

| Package | Responsibility |
|---|---|
| `apps/api` | Fastify server: `/v1/*` gateway + `/admin/*` console API + cron jobs |
| `apps/web` | React + Vite single-page admin console |
| `packages/shared` | env loading, error model, secret store, shared types |
| `packages/provider-core` | provider registry + adapters (OpenRouter / OpenAI / mock) |
| `packages/routing-core` | scoring, cooldown engine, policy weights |
| `packages/ui` | shared UI primitives |

---

## Quick start

### Docker Compose

```bash
git clone https://github.com/your-org/freellm.git
cd freellm
cp .env.example .env          # then edit secrets (see Configuration)
docker compose up -d
```

The API listens on `127.0.0.1:18610`; the web console is served as static assets (front it with the reverse proxy of your choice — a sample Caddyfile is in `deploy/`).

### Manual (Node + pnpm)

```bash
pnpm install
cp .env.example .env          # edit secrets
pnpm --filter @freellm/api prisma:generate
pnpm --filter @freellm/api prisma:migrate:deploy   # builds the full schema on a fresh DB
pnpm --filter @freellm/api build && pnpm --filter @freellm/web build
node apps/api/dist/server.js
```

Default storage is SQLite at `data/freellm.db`. For PostgreSQL, see [`docs/MIGRATION_POSTGRES.md`](docs/MIGRATION_POSTGRES.md).

### First call

```bash
curl http://127.0.0.1:18610/v1/chat/completions \
  -H "Authorization: Bearer <your-virtual-key>" \
  -H "Content-Type: application/json" \
  -d '{"model":"free/auto","messages":[{"role":"user","content":"hello"}]}'
```

---

## Configuration

All configuration is via environment variables — see [`.env.example`](.env.example) for the full list. The essentials:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | `file:./data/freellm.db` (SQLite) or a `postgresql://…` URL |
| `FREELLM_SESSION_SECRET` | admin session signing key (≥32 bytes) |
| `FREELLM_MASTER_KEY` | encryption key for upstream secrets at rest |
| `FREELLM_ADMIN_USERNAME` / `FREELLM_ADMIN_PASSWORD` | bootstrap admin credentials |
| `FREELLM_OPENROUTER_API_KEY` | upstream provider key(s) |
| `FREELLM_MAILER_URL` | optional HTTP mail relay for the email alert channel |

Secrets are read through a validated schema; the server refuses to start with missing or weak required secrets.

---

## Tech stack

- **Backend**: Fastify, Prisma, SQLite (PostgreSQL-ready), TypeScript (strict mode).
- **Frontend**: React, Vite, TanStack Query, Recharts, Tailwind.
- **Tooling**: pnpm workspaces, Vitest, ESLint.
- **Deploy**: systemd + reverse proxy, or Docker Compose. `scripts/deploy.sh` builds and ships in one command with a version-consistency health check.

---

## Project status

FreeLLM is feature-complete for self-hosted single-node operation: the gateway, routing engine, and full admin console are implemented and in use. It is **pre-1.0** — the public API surface and database schema may still change between minor versions, so pin a version for production.

SQLite is the default and is comfortable for small-to-medium volume. For higher throughput, migrate to PostgreSQL; the schema is portable and migration notes are included.

---

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design and data model
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — production deployment
- [`docs/API.md`](docs/API.md) — API reference
- [`docs/ROUTING.md`](docs/ROUTING.md) — scoring and routing internals
- [`docs/SECURITY.md`](docs/SECURITY.md) — threat model and hardening
- [`docs/ENV.md`](docs/ENV.md) — full environment reference

---

## Contributing

Issues and pull requests are welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for development setup and conventions.

## License

See [`LICENSE`](LICENSE).
