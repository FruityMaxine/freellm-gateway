# FreeLLM Routing

The full routing engine ships in **Tick 4 (v0.3.0.0)**. This document fixes the
contract early so dependent code in Tick 5 (the `/v1/chat/completions` route)
can be written against a stable surface.

## Routing modes

| Mode                       | Behaviour                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------- |
| `auto-best-free` (default) | Highest composite score among free, capable, non-cooled models.                    |
| `round-robin-free`         | Even distribution across the free pool, weighted by `enabled` only.                |
| `weighted-free`            | Probabilistic pick weighted by composite score.                                    |
| `openrouter-free-router`   | Hand off to OpenRouter's `:free` router model directly.                            |
| `prefer-model-fallback`    | Try the user-specified model first; on failure, fall through to the auto pool.     |
| `provider-specific`        | Pin to one provider; respect that provider's policy.                               |
| `paid-allowed`             | Same as `auto-best-free`, then escalate to paid models when the free pool empties. |

The active policy comes from `RoutingPolicy.isDefault = true`; a virtual key
may override the mode through `permissions.routingMode` (Tick 5 extension).

## Scoring formula

```
composite = availability * w.availability
          + latency      * w.latency
          + rateLimit    * w.rateLimit
          + quality      * w.quality
          + context      * w.context
          + freshness    * w.freshness
          + cost         * w.cost
          + stability    * w.stability
          + userWeight   * w.userWeight   // weight nudge from operator
          - blacklistPenalty
```

Weights are stored in `routing_policies.weightsJson`. The default policy
(seeded by `prisma:seed`) uses:

```json
{
  "availability": 0.3,
  "latency":      0.15,
  "rateLimit":    0.2,
  "quality":      0.15,
  "context":      0.1,
  "freshness":    0.05,
  "cost":         0,
  "stability":    0.05
}
```

The scorer returns a `ScoreExplanation` object alongside the composite — the
Routing Lab page displays this so operators can see *why* the engine picked a
given model.

## Candidate filter chain

For a request `R` with virtual key `K`:

1. Drop models where `R.requiredCapabilities` is not satisfied by
   `Model.capabilitiesJson`.
2. Drop models in `K.deniedModels`.
3. If `K.allowedModels` is non-empty, keep only those.
4. Drop models whose `providerId` is not in `K.allowedProviders` (if non-empty).
5. Drop models in active `Cooldown` (model scope) and models whose provider
   is in active `Cooldown` (provider scope).
6. Drop models with `status` ∈ {`disabled`, `removed`, `paid_now` if
   `K.allowPaidModels = false`}.
7. Sort by composite score descending (or shuffle for `round-robin-free`).
8. Take up to `FREELLM_MAX_ROUTE_ATTEMPTS` candidates.

## Fallback contract

- **Non-streaming**: any retriable error (per `isRetriable` in
  `provider-core/errors.ts`) → next candidate. Cooldown registered against the
  failing model and/or provider.
- **Streaming**:
  - **Before first token**: same as non-streaming.
  - **After first token**: cease the upstream, return a `partial` response with
    `finish_reason: 'error'`, log a `partial_failure` event. *Never* silently
    switch upstream mid-stream.

## Cooldown rules

| Error kind          | Model cooldown                    | Provider cooldown |
| ------------------- | --------------------------------- | ----------------- |
| `rate_limited`      | exp backoff from 30 s             | extra 5s once provider sees 3 in a window |
| `provider_unavailable` | exp backoff from 15 s          | exp backoff from 30 s |
| `timeout`           | exp backoff from 10 s             | flag, no cooldown |
| `auth_failure`      | disable provider until manual fix | disable provider  |
| `balance_insufficient` | disable provider until refilled| disable provider  |
| `content_filter`    | no cooldown (model-specific)      | none              |

Backoff = `min(base * 2^(attempts-1), maxBackoffMs) + jitter`. Cooldowns
transition to `halfOpen` after the timer expires; the next request is allowed
through to probe; success clears the cooldown, failure resets the timer.

## Streaming-aware executor pseudo-code

```ts
for (const [i, cand] of candidates.entries()) {
  if (cooldown.isActive(cand)) continue;
  const result = streaming
    ? await cand.provider.stream(req)
    : await cand.provider.complete(req);
  if (result.outcome().ok) return finalize(result, attempts);
  cooldown.register(cand, result.outcome().errorKind);
  attempts.push(report(cand, result.outcome()));
  if (streaming && firstTokenSeen) throw partialFailure(attempts);
}
throw new FreeLLMError('all_attempts_failed', `${attempts.length} attempts failed`);
```

## 9 维评分公式（详见 `packages/routing-core/src/scorer.ts`）

每个模型有 9 个 `[0, 1]` 归一化子分（数据库 `ModelScore` 表持久化，EWMA 更新）：

| 维度 | 含义 | 数据源 | 默认基线 |
|---|---|---|---|
| `availability` | 近期请求成功率 | `route_attempts` 滚动窗口 | 0.5 |
| `latency` | 平均响应耗时（越短越好，归一） | `route_attempts.durationMs` EWMA | 0.5 |
| `rateLimit` | 429 频率（越少越好） | `route_attempts.errorKind=rate_limited` 计数 | 0.5 |
| `quality` | 默认评分 + 用户手动评分 | `Setting.qualityOverride` | 0.5 |
| `context` | 上下文长度归一 | `model.contextLength / 200_000` | 自动 |
| `freshness` | 新模型探索权重（避免老模型垄断） | `firstSeenAt` 距今天数 | 0.5 |
| `cost` | 免费模型为 1，付费按价格降权 | `pricing.prompt + pricing.completion` | 免费 1 / 付费动态 |
| `stability` | 过去 N 次连续成功率 | `route_attempts` 滚动窗口 | 0.5 |
| `firstTokenLatency` | 流式首 token 耗时 | `route_attempts.firstTokenMs` | 0.5 |

**综合分公式**：

```
composite = Σ(weight_i × score_i)     ∀ i ∈ 9 dim
         + weightAdj × 0.1             (操作员手动 nudge ±1)
         + (isFree && cost weight == 0 ? 0.02 : 0)   (免费探索 bonus)
         + (whitelisted ? 0.05 : 0)
         × 0  if blacklisted            (黑名单硬否决)

clamped to [0, 1]
```

默认权重（`DEFAULT_WEIGHTS`）：

```
availability 0.30   latency 0.15   rateLimit 0.20   quality 0.15
context 0.10        freshness 0.05  cost 0.00       stability 0.05
firstTokenLatency 0.05
```

**自定义权重** 通过 `PATCH /admin/routing-policy` 实时生效，无需重启。

## 7 模式决策树

```
请求到达 Router.decide(pool, ctx)
        │
        ▼
   alias 匹配？ ── 是 ──► 按别名过滤池
        │ 否           （free/auto, free/best, free/fast,
        │                free/large-context, openrouter/free）
        ▼
   ctx.policy.mode = ?
        │
        ├─ auto-best-free        →  按 composite 降序排，首选评分最高的免费模型
        ├─ round-robin-free      →  免费池按 hash(reqId) % N 轮转
        ├─ weighted-free         →  按 composite 加权随机
        ├─ openrouter-free-router→  锁 providerSlug=openrouter + upstreamId=openrouter/free
        ├─ prefer-model-fallback →  显式 ctx.explicitModel 优先；失败回 auto-best-free 池
        ├─ provider-specific     →  锁 ctx.policy.params.providerSlug
        └─ paid-allowed          →  混合 free + paid 池，按 composite 排序
        │
        ▼
   权限过滤
        │  · perm.allowedModels 白名单（如有）
        │  · perm.deniedModels 黑名单
        │  · perm.allowedProviders 白名单（如有）
        │  · perm.allowPaidModels = false → 排除 isFree=false
        ▼
   能力过滤（如 ctx.requireCapabilities 指定）
        │  · stream / json / tools / vision / audio
        │  · minContextLength
        ▼
   状态过滤
        │  · 排除 disabled / removed
        │  · 排除 paid_now（除非 paid-allowed 模式）
        ▼
   评分 + 排序 + take(maxCandidates)
        │
        ▼
   交给 RouteExecutor.execute(candidates)
        │
        ▼
   逐个候选：检查冷却 → 调 provider →
   失败注册冷却 → 切下一候选（pre-first-token）
        │
        ▼
   成功 → finalize()   全部失败 → all_attempts_failed
```

## 冷却语义补充

- **scope**：`model` 或 `provider`。`provider` 冷却时该上游所有模型都被跳过。
- **半开探测**：冷却到期后第一个请求被放行作为探针；成功重置冷却，失败再次触发指数退避。
- **手动恢复**：`POST /admin/cooldowns/:id/reset` 立即清除（Routing Lab 与 Logs 页都有按钮）。
- **持久化**：生产用 `PrismaCooldownStore`（落 SQLite），测试用 `MemoryCooldownStore`。
