# FreeLLM Architecture

## Layers

```
┌──────────────────────────────────────────────────────────────────┐
│  apps/web    React 19 + Vite 6 + Tailwind 4 (Group 2 — done)     │
│              Landing · Dashboard · Models · Routing Lab ·         │
│              Virtual Keys · Providers · Logs · Settings.          │
│              ClickHouse tokens locked at Tick 7 (packages/ui).    │
└─────┬────────────────────────────────────────────────────────────┘
      │  fetch /admin/* (cookie session)
      │  fetch /v1/* (bearer virtual key)
┌─────▼────────────────────────────────────────────────────────────┐
│  apps/api    Fastify route layer                                 │
│              ┌──────────┐ ┌──────────┐ ┌──────────┐              │
│              │ /v1/*    │ │ /admin/* │ │ /health  │              │
│              └────┬─────┘ └────┬─────┘ └────┬─────┘              │
│                   │            │            │                    │
│   plugins:   reqid · errors · cors · security · ratelimit        │
└─────┬─────────────┴────────────┴────────────┴────────────────────┘
      │
┌─────▼────────────────────────────────────────────────────────────┐
│  Application services (apps/api/src/services)                    │
│  - ModelDiscoveryService  (Tick 3)                               │
│  - RouteExecutorService   (Tick 4)                               │
│  - VirtualKeyService      (Tick 5)                               │
│  - RequestLoggerService   (Tick 5)                               │
│  - ScoreUpdaterService    (Tick 4)                               │
│  - EventBus               (in-process pub/sub)                   │
└─────┬────────────────────────────────────────────────────────────┘
      │
┌─────▼────────────────────────────────────────────────────────────┐
│  Domain packages                                                 │
│  - @freellm/shared           errors · crypto · secret-store · types
│  - @freellm/provider-core    BaseProvider · OpenAICompatProvider · MockProvider · registry · zod config
│  - @freellm/routing-core     scorer · router · classifier · cooldown (Tick 4)
└─────┬────────────────────────────────────────────────────────────┘
      │
┌─────▼────────────────────────────────────────────────────────────┐
│  Persistence (Prisma)                                            │
│  16 tables. SQLite in dev, Postgres-compatible in prod.          │
└──────────────────────────────────────────────────────────────────┘
```

## Boundary rules

- **No direct DB access from `packages/*`.** The packages are pure domain
  code. The api app owns Prisma and injects whatever the packages need
  through narrow interfaces (`ProviderCredential`, `SecretKV`, …).
- **No direct upstream HTTP from `apps/api/src/routes/*`.** Routes go
  through `RouteExecutorService` (Tick 4) or, for admin actions, through
  domain services that hold a `ProviderRegistry` reference.
- **Errors flow up as `FreeLLMError`.** Anything else is unexpected and
  becomes a 500 with `code: 'unknown'`.

## Data flow — single downstream chat request (Tick 5 preview)

```
1. POST /v1/chat/completions
   ├─ virtual-key-auth plugin → resolves request.virtualKey
   ├─ rate-limit by virtual key (RPM + daily)
   ├─ model alias resolution (free/auto, free/best, …)
   └─ build RouteContext(request, virtualKey, policy)

2. RouteExecutorService.execute(ctx)
   for ordinal in 1..maxAttempts:
     ├─ Router.candidates → ordered list of (provider, model)
     ├─ for (provider, model) in list:
     │    ├─ check Cooldown.allows(model) && Cooldown.allows(provider)
     │    ├─ if !streaming:
     │    │    ├─ provider.complete(req) → outcome
     │    │    ├─ if ok → return response + attempts
     │    │    └─ else → classify, update Cooldown, continue
     │    └─ if streaming:
     │         ├─ provider.stream(req) → asyncIterable
     │         ├─ pipe to reply.raw, mark firstToken on first chunk
     │         ├─ once firstToken seen → no fallback allowed
     │         └─ on pre-firstToken error → classify, continue
     └─ if exhausted → throw FreeLLMError('all_attempts_failed')

3. RequestLoggerService records RequestLog + RouteAttempt rows
4. ScoreUpdaterService adjusts model_scores asynchronously
```

## Test pyramid

| Layer            | What we assert                                                        |
| ---------------- | --------------------------------------------------------------------- |
| Unit             | Pure functions in `@freellm/shared` and provider/routing packages.    |
| Adapter          | Mock fixture JSON vs. classifier / openai-compat / openrouter shape.  |
| Integration      | `supertest` against `buildApp()` with `MockProvider` in registry.     |
| Routing scenario | Inject `MockProvider` configured for 429 / 5xx / timeout / partial.   |
| E2E              | Playwright vs. real `pnpm dev:api + dev:web` (Group 2).                |

## Frontend layer (Group 2 — locked at v0.8.0.0)

```
apps/web/
├─ src/
│  ├─ styles/     Tailwind v4 @theme bridge + reset + global tokens
│  ├─ lib/        axios + TanStack Query + admin/lab/keys/logs/settings hooks
│  ├─ components/
│  │   ├─ ui/     shadcn-style primitives (Button/Card/Input/Badge/Tabs/Dialog/Tooltip/Skeleton)
│  │   ├─ bits/   Hero/MeshGradient/Aurora/Spotlight/GlassCard/AnimatedNumber/GradientText/TypingText/Marquee
│  │   ├─ layout/ AppShell + Sidebar + Topbar + Footer + ThemeProvider
│  │   ├─ charts/ RequestsChart/LatencyChart/ProviderPie/ModelMixBar/ChartFrame
│  │   └─ data/   StatCard/StatusBadge/DataTable
│  ├─ pages/      Landing / Dashboard / Models / RoutingLab / VirtualKeys / Providers / Logs / Settings / NotFound
│  └─ router.tsx  React Router 7
└─ vite.config.ts  dev proxy /v1 + /admin + /health → 127.0.0.1:3001
```

Design contract — locked at Tick 7, consumed unchanged through Tick 8/9/10:
- **Palette**: ClickHouse dark canvas (`#0a0a0a`) + electric-yellow voltage (`#faff69`); seven accents; semantic OK/warn/error/info; light-mode override.
- **Typography**: Inter var + JetBrains Mono; 12 sizes including `hero` clamp().
- **Hero decoration**: Vercel-style mesh gradient (cyan / blue / magenta / amber).
- **Three-mode theme**: Light / Dark / Auto, localStorage-backed, ~240–400 ms transitions.

Screenshots live at `docs/screenshots/<page>-{desktop,tablet,mobile}.png` — 24 images covering all 8 pages × 3 breakpoints, regenerated each Tick 10.

## ADRs (decision log)

- **2026-05-23 — adopt pnpm workspaces over Turborepo.** Reason: no remote
  cache needed in dev; pnpm filtering is sufficient and avoids a build
  graph layer. Revisit if CI fan-out becomes the bottleneck.
- **2026-05-23 — SQLite first, Postgres-compatible schema.** Reason: zero
  setup on first clone; the schema avoids SQLite-only features so the
  Prisma migration to Postgres is a connection-string change.
- **2026-05-23 — sha256 (not bcrypt) for virtual key hash.** Reason: keys
  are 256-bit random; lookup happens on every request; bcrypt would add
  ~100 ms per call with no marginal security benefit at this entropy.
- **2026-05-23 — AES-256-GCM per-record AAD for upstream keys.** Reason:
  prevents copy-pasting a ciphertext from one `upstream_keys` row to
  another and decrypting it; the AAD binds ciphertext to its logical
  scope.
- **2026-05-23 — ClickHouse-inspired tokens (Tick 7).** Reason: tool-grade
  brand pairing (deep black + electric yellow) reinforces "speed + free"
  positioning; layered surface stack scales to 8 admin pages without drift.
- **2026-05-23 — Token names locked at Tick 7.** Reason: Tick 8/9/10
  compose pages directly from these tokens; renaming would force a
  30+ file ripple.
- **2026-05-23 — mock-prefer demo patch (Tick 10).** Reason: lets the
  Routing Lab + Dashboard return successful `/v1/chat/completions`
  responses without an OpenRouter API key, removing the largest demo
  friction. Boosts mock-family ModelScore composites to 0.95.
- **2026-05-23 — Pool 5 秒 TTL 缓存 + stale-while-revalidate (Tick 13)。**
  原因：高 QPS 下每请求重建 pool 是 Prisma 大查询，但模型池变化很慢
  （discovery 30 分钟 + scorer 周期）。5 秒缓存对决策新鲜度影响可忽略，
  对热路径降压非常显著。失效模式：discovery 完成 / 手动 PATCH 模型时
  显式 `invalidatePoolCache()`。详见 `apps/api/src/lib/pool-cache.ts`。
- **2026-05-23 — undici 全局 keep-alive Agent (Tick 13)。** 原因：Node
  内置 fetch 默认每请求新 TCP，跨上游请求跨 RTT 显著拖慢。配 connections
  256 / pipelining 1（保守关）/ keepAliveTimeout 30s。详见 `apps/api/src/lib/http-dispatcher.ts`。
- **2026-05-23 — Prisma `select` over `include` (Tick 13)。** 原因：
  pool-builder 单次查询字节数 -30%（不再 over-fetch Score 大字段 + Provider
  apiKeyEnv 等无用列）。后续新查询统一遵循「仅 select 实际使用列」原则。

## 部署架构（Tick 14）

```
                  ┌──────────────────────────┐
                  │  Caddy (反代 + 三层守门) │
                  │  :28000  →  API entry    │
                  │  :28010  →  Web admin    │
                  └────────────┬─────────────┘
                               │ 127.0.0.1 only
            ┌──────────────────┼──────────────────┐
            ▼                                     ▼
   ┌─────────────────┐                    ┌──────────────┐
   │ systemd:         │                    │ systemd:     │
   │ freellm-api      │                    │ freellm-web  │
   │ Node 22 + Fastify│                    │ npx serve    │
   │ 127.0.0.1:3001   │                    │ 127.0.0.1:8080│
   │ MemoryMax 900M   │                    │ MemoryMax 300M│
   │ NoNewPrivileges  │                    │              │
   │ Protect*         │                    │              │
   └────────┬────────┘                    └──────────────┘
            │
            ▼
   ┌─────────────────┐
   │ SQLite          │
   │ /opt/freellm/   │
   │   data/         │
   │   freellm.db    │
   │ (持久化卷)      │
   └─────────────────┘
```

Caddy 三层守门（详见 `deploy/caddy/freellm.Caddyfile`）：

1. `?pass=<32 hex>` token query → 下发 Cookie + 302 去除 query
2. `Cookie: freellm_*_pass=<token>` 整天免登
3. `Referer: https://example.com` 同源备用通道
4. 三关全不命中 → 302 踢回 Homepage

替代方案：Docker Compose 一键起（`docker-compose.yml`），用法见 [DEPLOYMENT.md](./DEPLOYMENT.md) 步骤 4。
