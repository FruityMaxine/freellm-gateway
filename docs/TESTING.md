# FreeLLM Testing Guide

## Pyramid

```
       e2e (Playwright vs real server) ────── few, Group 2+
      ┌─────────────────────────────┐
     │  routing scenarios            │
     │  (mock provider injection)    │ ── Tick 4+
    └────────────────────────────────┘
     │  integration (supertest +     │
     │  buildApp + in-memory mock)   │ ── Tick 2 onward
   └─────────────────────────────────┘
      unit (per-package, Vitest)     ── starts here
```

## Commands

```bash
# Run every package's tests
pnpm test

# A single package
pnpm --filter @freellm/shared test
pnpm --filter @freellm/provider-core test

# Watch mode while iterating
pnpm --filter @freellm/shared exec vitest

# Typecheck (no emit)
pnpm typecheck

# Build (per package; api emits to dist/)
pnpm build
```

## Mock mode

`FREELLM_MOCK_PROVIDERS_ENABLED=true` (default) installs the synthetic
`mock` provider in the registry on boot. It always returns 200, echoes the
last user turn, and supports streaming (one chunk per choice). This is
what lets `/v1/chat/completions` succeed without any upstream key.

The routing engine (Tick 4) ships a richer `MockProvider` variant that
can be programmed to emit 429 / 5xx / timeout / partial-stream so we
exercise fallback paths.

## Conventions

- Vitest config is the workspace default — `vitest run` from any package
  works without per-package config.
- Tests live in `__tests__/` next to the source they cover.
- `_setConfigForTests()` lets you swap the `getConfig()` cache; do this in
  `beforeAll` and reset in `afterAll`.
- Tests never touch real upstreams. The only allowed external surface is
  `MockProvider` (and, later, recorded fixtures for OpenRouter).
- Database tests use SQLite at `data/freellm-test.db` and migrate fresh
  each run.

## Coverage targets

- `@freellm/shared` — 90%+ (small surface, deterministic).
- `@freellm/provider-core` — 80%+ (mock + classifier are 100%; OpenAI-compat HTTP
  paths covered by recorded fixtures from Tick 3).
- `@freellm/routing-core` — 85%+ (Tick 4 closes scorer/router/cooldown/classifier).
- `apps/api` — every route file has at least one happy-path supertest case
  and one error-path case.

## 四层测试覆盖（v1.0 实际状态）

测试总数 **140 / 140 passing**（v1.0.0.0 实测，详见 [CHANGELOG.md](../CHANGELOG.md)）。

| 层 | 路径 | 数量 | 跑命令 | 用途 |
|---|---|---|---|---|
| 单元 | `packages/shared/__tests__/` | 10 | `pnpm --filter @freellm/shared test` | 纯函数 / 类型守卫 / 配置解析 |
| 单元 | `packages/provider-core/__tests__/` | 22 | `pnpm --filter @freellm/provider-core test` | Provider 抽象 + 错误分类 + 免费检测 |
| 单元 | `packages/routing-core/__tests__/` | 41 | `pnpm --filter @freellm/routing-core test` | Scorer + Router + Cooldown + ErrorClassifier |
| 集成 | `apps/api/__tests__/*.test.ts` | 57 | `pnpm --filter @freellm/api test` | 起 Fastify + Prisma in-memory，supertest 端到端 |
| 回归 | `apps/api/__tests__/regression/` | 10 | 同上（自动选中） | `baselines.json` 锚定的 AI 决策行为（路由 3 + 权限 3 + 错误分类 4） |
| 基准 | `apps/api/__benchmarks__/` | 5 个文件 / 16 bench | `pnpm --filter @freellm/api bench` | 吞吐 / 时延 / p99 实测，与 `docs/perf/baseline.md` 对照 |

### 单元层（90%+ 覆盖目标）

只测纯函数：无 I/O、无 Prisma、无网络。运行最快（每个包 <100 ms）。

### 集成层（端到端 supertest）

每个 API route 至少 1 个 happy path + 1 个 error path。`buildApp()` 起完整 Fastify pipeline（plugins / routes / errors），Prisma 跑迁移到 in-memory SQLite。

测试涉及的「外部」surface 只有 `MockProvider`（受控可编程错误） + 录制的 fixture 文件，绝不打真实上游。

### 回归层（AI 决策 baseline）

`apps/api/__tests__/regression/baselines.json` 钉死 10 条预期决策：

- **routing** 3 条：`auto-best-free` 选最高分免费、`blacklisted` 永不入候选、`openrouter/free` 别名只选 1 个。
- **permissions** 3 条：`deniedModels` 屏蔽指定 upstream、`allowedProviders` 之外不进候选、`allowPaidModels=false` 排除付费。
- **errors** 4 条：429 → `rate_limited`、500 → `provider_unavailable`、`AbortError` → `timeout`、`ECONNRESET` → `network_error`。

任何后续 tick 改路由 / 权限 / 错误分类策略导致 baseline 偏移 → 测试立即失败。改动确实合理时，同步更新 `baselines.json` 并在 commit message 说明。

### 基准层（性能回归门槛）

5 个 vitest bench 文件（v0.9.1.0 引入）：

```bash
pnpm --filter @freellm/api bench
# 输出: hz / mean / p99 / 离散 RME
```

对照 [docs/perf/baseline.md](./perf/baseline.md) 的固化数据，任意指标 hz **下降 > 15%** 视为性能回归，必须在 PR 说明原因或回滚。

### Lint 与 Type 安全（PR 必过）

```bash
pnpm typecheck        # tsc --noEmit 所有 workspace
pnpm lint             # eslint --config lint.config.mjs (v0.9.1.0 引入)
```

ESLint 当前 0 errors / 11 warnings（皆 unused-vars 或 react-hooks 提示）。0 errors 是 PR 必过门槛。

### 公网部署烟测（部署/升级必做）

`docs/DEPLOYMENT.md` 步骤 6 的 9 项公网 IP 烟测必过（含 `/health` 200、`/v1/models` 401 中文、Caddy 守门 302、token Set-Cookie、SPA 200、admin login 200）。

## 覆盖率与 Vitest UI（v1.0.1.0 引入）

### 覆盖率

```bash
pnpm coverage
```

跨所有 workspace 跑 Vitest 并产出 V8 覆盖率报告（`coverage/` 目录下 HTML + JSON）。首次跑会自动装 `@vitest/coverage-v8`。

**当前覆盖率目标**（仍是 `docs/TESTING.md` 既有目标）：

- `@freellm/shared` — 90%+
- `@freellm/provider-core` — 80%+
- `@freellm/routing-core` — 85%+
- `apps/api` — 每个 route 至少 1 happy + 1 error path

### Vitest UI（交互浏览）

```bash
pnpm test:ui
```

启动 Vitest 自带的 web UI（默认 `http://127.0.0.1:51204/__vitest__/`），可视化浏览每个测试用例、失败堆栈、覆盖率、运行历史。

> 注：`test:ui` 走单 workspace 模式（不递归），适合开发期聚焦某个包；CI 跑全量用 `pnpm test`。
