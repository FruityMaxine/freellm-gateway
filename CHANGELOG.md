# Changelog

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格，版本号遵循扩展 SemVer 4 段制（`MAJOR.MINOR.PATCH.BUILD`）。

## [1.7.25.0] — 2026-05-24 (Tick 53 · 管理员面板)

集中式管理员面板：账号 CRUD + 活跃会话 + 系统健康度 一站入口。51 个 tick 一直缺这块（只能 seed 1 个 admin、看不到当前在线 session、改密码要进 SQLite）。

### 新增

- **`apps/api/src/services/admin-user.service.ts`** —— `listUsers / createUser / setEnabled / unlock / resetPassword / deleteUser / listSessions / revokeSession` 8 个方法。密码用 scrypt（已有），删除前防 self-delete + 防最后 1 个 enabled。
- **`apps/api/src/routes/admin/users.routes.ts`** —— 6 个新端点：`GET /admin/users` + `POST /admin/users` + `PATCH /admin/users/:id`（enabled/unlock/newPassword 三合一）+ `DELETE /admin/users/:id` + `GET /admin/sessions` + `POST /admin/sessions/:id/revoke`。admin-auth 守门。
- **`apps/api/src/bootstrap.ts`** —— 注册新路由。
- **`apps/web/src/lib/admin-users-hooks.ts`** —— 6 个 hook + 类型 `AdminUserRow / AdminSessionRow`。
- **`apps/web/src/pages/AdminPanel.tsx`** —— 新页面 `/admin-panel`。三段卡片：
  1. **系统健康度** —— 复用 `HealthOverviewCard`（Dashboard 同款）
  2. **管理员账号** —— 列表 + 新增 + 改密码 + 锁/解锁 + 启/禁 + 删除（防自删）
  3. **活跃会话** —— 列表 + 15s 自动刷新 + 强制下线
- **`apps/web/src/router.tsx`** —— 加 `/admin-panel` 路由。
- **`apps/web/src/components/layout/Sidebar.tsx`** —— ADMIN_NAV 加 "管理员面板"（ShieldCheck 图标，登录后才显示）。
- **`apps/web/src/pages/Settings.tsx`** —— GROUPS 8 项标题+描述全部中文化（"Discovery" → "模型发现"，"Routing" → "路由策略"，等）。Language 默认 `zh-CN`。

### 部署

- 重 build apps/{api,web} 同步到 /opt/freellm/apps/{api,web}/dist，systemd restart freellm-api。
- 公网实测：POST 创建 testop 管理员 200，GET /admin/users 返回 2 行，DELETE testop 200，GET /admin/sessions 列出当前 curl + 之前的会话。/admin-panel SPA 200。

### 工程

- ESLint 0/0；vitest 548/548 不变。
- v1.7.24.0 → v1.7.25.0，MINOR 段升（新增完整 admin 用户/会话管理能力）。

## [1.7.24.0] — 2026-05-24 (Tick 52 · 部署后修复 4 处用户反馈)

部署上公网后用户反馈的 4 项 UI 问题统一修复（登录无入口 / 文案英文 / Footer 死链 / "网关" 称呼）。

### 修复

- **新增 `apps/web/src/pages/SignIn.tsx`** —— 51 个 tick 竟然全部缺这个页面：后端 `/admin/auth/login` 早就在，但前端没 SignIn UI 让用户填账号密码。补一个中文登录页 + 识别 401/423/网络错误。
- **`apps/web/src/router.tsx`** —— 加 `/signin` + `/login` + `/auth/signin` 路由（都指同页）。
- **`apps/web/src/components/layout/Topbar.tsx`** —— 顶部右上角加 "登录 / 退出" 按钮（随 auth 状态切换）。
- **`apps/web/src/components/layout/Sidebar.tsx`** —— 未登录状态下侧边栏加明显 "去登录 →" 按钮。
- **`apps/web/src/components/layout/Footer.tsx`** —— 3 个按钮从死锚点 `#docs / #status / #github` 换成真链（文档 → GitHub docs、状态 → /dashboard、源码 → GitHub 仓）。版本号 v0.9.0.0 → v1.7.24.0。名称从 "自适应免费模型网关" 改为 "多模型 LLM 控制台"。
- **`apps/web/src/pages/Dashboard.tsx`** —— 顶部 PageHeader + 12 个 StatCard label + Refresh 按钮文案全部中文化（"Dashboard" → "控制台"，"429 events" → "429 限流事件"，"Virtual keys" → "虚拟密钥数"，等）。Topbar "开发环境" → "生产环境"。

### 部署

- 重 build apps/web 同步到 /opt/freellm/apps/web/dist，Caddy file_server 自动生效。
- 公网实测：带 cookie 访问 /signin 返回 200，取 admin 密码 POST 登录返回 200 + session cookie 下发。bundle 含中文新文案。

### 工程

- ESLint 0/0；vitest 548/548 不变（这一改不动后端逻辑）。
- v1.7.23.0 → v1.7.24.0，BUILD 段升（依据用户反馈补上线后 UI 缺口，不含新后端能力）。

## [1.7.23.0] — 2026-05-23 (Tick 51 · 用户明令停 loop 收官)

VK Spend Top-N 排行：本日/周/月烧钱前 10 个虚拟密钥 + 派生 avgCostPerReq / successRate / shareOfTotal + VirtualKeys 页顶部嵌入卡片。

### 新增

- **`apps/api/src/services/vk-spend-leaderboard.service.ts`** —— `VkSpendLeaderboardService.build(scope, limit)`。Scope = `day` (24h) / `week` (7d) / `month` (30d)；按 RequestLog.virtualKeyId groupBy + `_sum(estimatedCostUsd)` 倒排；join VirtualKey 元数据带出 label/prefix/environment/enabled；派生 `avgCostPerReqUsd / successRate / shareOfTotal` 三个统计字段；summary 含 `windowCostUsd / shownCostUsd / remainderCostUsd / remainderVkCount` 让 UI 一眼看出"前 N 占总比 + 剩余 VK 总和"。limit cap 上限 50。
- **`apps/api/src/routes/admin/virtual-keys.routes.ts`** —— 新端点 `GET /admin/virtual-keys/spend-leaderboard?scope=...&limit=...`，5s TTL 缓存（按 scope:limit 组合键 Map），admin 守门，导出 `invalidateLeaderboardCache()` 供测试用。
- **`apps/web/src/lib/lab-keys-logs-hooks.ts`** —— `useVkSpendLeaderboard` hook (30s 自动轮询 + 5s staleTime) + 类型 `VkSpendScope / VkSpendLeaderboardRow / VkSpendLeaderboardPayload`。
- **`apps/web/src/pages/VirtualKeys.tsx`** —— 顶部嵌入 `VKSpendLeaderboardCard` 卡片（day/week/month 切换 + 4 KPI summary + 排行单行 VKSpendRow，左侧 share width 进度背景 + 右侧 cost/req/成功率 tabular）。

### 测试

- **`apps/api/__tests__/tick51.test.ts`** +10 测试：空表 / 多 VK 倒排+派生字段 / 已删除 VK 兜底 / limit cap 50 / limit 截断 + remainder 计算 / day scope 仅 24h 内 / GET 端点 200+rows / 401 / 默认 scope+5s 缓存 / 非法 scope 4xx。
- 全套总测试 538 → 548 通过（packages/shared 10 + provider-core 29 + routing-core 45 + apps/api 464）。

### 工程

- ESLint 0 warning / 0 error；`pnpm --filter @freellm/web run build` 通过。
- 联动 Tick 30 RequestLog.estimatedCostUsd + Tick 33 VirtualKeyCostService（本 tick 加排行榜视角）。

## [1.7.22.0] — 2026-05-23 (Tick 50)

/admin/system/health 全链路自检：单端点统一 DB + Redis + 全部 Provider 健康度，Dashboard 顶部嵌入 HealthOverviewCard。

### 新增

- **`apps/api/src/services/system-health.service.ts`** —— `SystemHealthService.checkAll() / checkDb() / checkRedis() / checkProviders()` + 纯函数 `deriveProviderStatus / deriveOverall`。三大维度独立 try/catch（单点失败不影响其他维度）；DB 1s 超时 + 派生 24h RequestLog 计数；Redis 用 createRequire 动态加载 ioredis（未装 = degraded，未配置 = unknown）；Provider 综合 registry 注册状态 + DB row + 24h errorEvent 计数 + 未解决告警计数。`overall` 派生规则：DB unhealthy → unhealthy；任一 provider/redis 异常 → degraded；否则 healthy。
- **`apps/api/src/routes/admin/system-health.routes.ts`** —— `GET /admin/system/health` 端点，5 秒 TTL 缓存（防 dashboard 高频刷新打 DB），admin 守门。
- **`apps/api/src/bootstrap.ts`** —— 注册新路由。
- **`apps/web/src/lib/admin-hooks.ts`** —— `useSystemHealth` 10s 自动轮询 + 类型 `SystemHealthReport / SystemHealthDb / SystemHealthRedis / SystemHealthProviderRow`。
- **`apps/web/src/components/data/HealthOverviewCard.tsx`** —— 顶部展示 overall 徽章 + 3 维度 tile (DB / Redis / Providers) + 每个 provider 单行（含 24h 错误数 + 未解决告警计数）。overall=unhealthy/degraded 时 GlassCard 加红/橙 ring 边框警示。
- **`apps/web/src/pages/Dashboard.tsx`** —— Dashboard 顶部嵌入 HealthOverviewCard（StatCard grid 之上）。

### 测试

- **`apps/api/__tests__/tick50.test.ts`** +16 测试：deriveProviderStatus 5 档（未注册/down/disabled/unresolvedAlerts/errorCount>10/全好） + deriveOverall 3 档（db unhealthy/provider unhealthy/全 healthy） + checkDb 含 requests24h / checkRedis 未配置/未装 ioredis / checkProviders errorEvent 计数 / checkAll 结构 / 端点 200 / 401 / 5s 缓存。
- 全套总测试 522 → 538 通过（packages/shared 10 + provider-core 29 + routing-core 45 + apps/api 454）。

### 工程

- ESLint 0 warning / 0 error；`pnpm --filter @freellm/web run build` 通过；charts chunk 不变（455 kB），index 微增（含 HealthOverviewCard）。
- 联动 Tick 31 ProviderHealthService（已记 lastSuccessAt/lastErrorAt + healthCheck 历史）+ Tick 40 ErrorEvent 未解决计数 + Tick 21 redis-kv-store 的动态 require 模式。
- 与 Tick 31 区别：本服务**只读现有状态**做汇总（无 upstream 网络），Tick 31 主动 ping 上游（cron job 工作），互不重叠。

## [1.7.21.0] — 2026-05-23 (Tick 49)

Logs 错误率趋势图：按 HTTP status 分桶（2xx/4xx/5xx/null）+ 三类 rate 派生 + Logs 页顶部 AreaChart 卡片。

### 新增

- **`apps/api/src/services/error-rate-timeseries.service.ts`** —— `ErrorRateTimeseriesService.build(window)` + 三个纯函数 `makeEmptyBuckets / bucketByStatus / aggregateSummary`。RequestLog 按 1h/24h/7d 窗口分桶，进一步把每桶请求按 status class 拆出 `status2xx/4xx/5xx/null`，派生 `errorRate = failed/total`、`clientErrorRate = 4xx/total`、`serverErrorRate = 5xx/total`。窗口聚合 `summary` 字段供顶部 KPI 卡显示。10000 条 row cap 防 OOM。
- **`apps/api/src/routes/admin/error-rate-timeseries.routes.ts`** —— `GET /admin/metrics/error-rate-timeseries?window=1h|24h|7d` 端点，5 秒 TTL 缓存（与 Tick 32 metrics-timeseries 一致），admin 守门。
- **`apps/api/src/bootstrap.ts`** —— 注册新路由到 `/admin/*` 路由组。
- **`apps/web/src/lib/admin-hooks.ts`** —— `useErrorRateTimeseries` + 类型 `ErrorRateBucket / ErrorRatePayload`。
- **`apps/web/src/components/charts/ErrorRateChart.tsx`** —— recharts ComposedChart 双轴：左轴 line 三类 rate（errorRate 实线 + serverErrorRate 虚线），右轴 area 堆叠 4xx+5xx+null 请求数。1h/24h/7d 自动 tick 格式化。
- **`apps/web/src/pages/Logs.tsx`** —— Logs 页顶部嵌入 `ErrorRateTrendCard`：1h/24h/7d 切换 + 4 个 KPI（总请求 / 错误率 / 4xx / 5xx，5xx>0 红色警示，errorRate>5% 橙色警示）+ ErrorRateChart 图。

### 测试

- **`apps/api/__tests__/tick49.test.ts`** +11 测试：makeEmptyBuckets 三窗口个数 + 单调时间 / bucketByStatus 200+404+500+null 分桶+rate 派生 / 越界 row 跳过 / aggregateSummary 跨桶累加+派生 / 空桶全 0 / service 空表 / service 写日志后 summary 反映 / 端点 200+含 summary / 默认 24h / window=1h 60 桶 / 401。
- 全套总测试 511 → 522 通过（packages/shared 10 + provider-core 29 + routing-core 45 + apps/api 438）。

### 工程

- ESLint 0 warning / 0 error；`pnpm --filter @freellm/web run build` 通过；charts chunk 不变（455 kB），index 微增（含 Logs 页新组件）。
- 联动 Tick 32 metrics-timeseries 现有架构（5s TTL 缓存 + JS bucket）+ Tick 25 RequestLog 表，本 tick 加更细的 status class 拆分维度，不改任何现有端点行为。

## [1.7.20.0] — 2026-05-23 (Tick 48)

请求重试/退避策略可配置面板：jittered exponential backoff + 白名单 HTTP code/error kind + Web 面板 + backoff 预览曲线。

### 新增

- **`apps/api/src/services/retry-policy.service.ts`** —— `RetryPolicyService.getPolicy / setPolicy / previewBackoffs`。配置存 `Setting` 表 key=`routing.retryPolicy`；字段 `maxAttempts`（1-10）/ `initialBackoffMs`（0-60s）/ `maxBackoffMs` / `jitterRatio`（0-1）/ `retryOnStatusCodes[]`（最多 20 个 HTTP code）/ `retryOnErrorKinds[]`。`computeBaseBackoff(n) = min(initial * 2^(n-1), max)` 指数增长 + cap；`computeBackoff(n)` 在基础值上叠 ±jitterRatio 抖动；`shouldRetry()` 白名单覆盖默认 `isRetriableKind`。
- **`apps/api/src/services/route-executor.service.ts`** —— `RouteExecutorOptions` 加 `retryPolicy?: RetryPolicy` 与 `sleepFn?: (ms) => Promise<void>` 测试钩子。executor 内 `evalRetriable()` 优先用 policy 白名单，缺失回退默认；`sleepBetweenAttempts()` 在 attempt 之间 sleep jittered backoff（仅 retryPolicy 提供时启用，向后兼容现有所有测试）。`effectiveMaxAttempts` 覆盖 opts.maxAttempts。
- **`apps/api/src/routes/v1/chat-completions.routes.ts`** + **`apps/api/src/routes/admin/test-chat.routes.ts`** —— 请求开始时 `await new RetryPolicyService(prisma).getPolicy()` 加载运行时策略并装入 executor。
- **3 个新端点**：`GET /admin/settings/retry-policy`（当前策略）+ `PATCH /admin/settings/retry-policy`（部分更新 + zod 校验）+ `GET /admin/settings/retry-policy/preview?maxAttempts=N`（返回 1..N 次 attempt 的 base/jitter min/max/sample）。
- **`apps/web/src/lib/settings-hooks.ts`** —— `useRetryPolicy / useUpdateRetryPolicy / useRetryPolicyPreview` 3 个 hook + 类型 `RetryPolicy / BackoffPreview`。
- **`apps/web/src/pages/Settings.tsx`** —— Settings 页 GROUPS 网格新增 `RetryPolicyCard` 卡片（6 个 RetryRow 输入 + backoff 预览网格 + dirty save bar）。

### 测试

- **`apps/api/__tests__/tick48.test.ts`** +17 测试：getPolicy 默认 / setPolicy 部分字段持久化 / initial>max 校验 / maxAttempts 越界 / JSON 损坏退回 / computeBaseBackoff 指数+cap / computeBackoff jitter 区间 / jitter=0 等于 base / shouldRetry 空白名单 / shouldRetry status+kind 白名单覆盖 / 3 端点 GET+PATCH+preview + PATCH 校验 + 401 ×2。
- 全套总测试 494 → 511 通过（packages/shared 10 + provider-core 29 + routing-core 45 + apps/api 427）。

### 工程

- ESLint 0 warning / 0 error；`pnpm --filter @freellm/web run build` 通过；charts/icons chunk 无新增（Settings chunk 14.47→更大含 RetryPolicyCard）。
- 联动 Tick 16 RouteExecutor + Tick 46 Setting 表 + Tick 48 自己加的 retry policy。本 tick 加入"可配置 + jittered backoff sleep + 白名单覆盖"层。
- 向后兼容：`retryPolicy` 为可选字段，未提供时 RouteExecutor 保留 Tick 47 之前的行为（无 sleep，用 isRetriableKind），所有已存在测试无需修改。

## [1.7.19.0] — 2026-05-23 (Tick 47)

Cron 调度状态 Dashboard：每个 cron job 的 lastRunAt / 时长 / 成功失败计数 / 上次错误 / stale 状态可视化。

### 新增

- **`apps/api/src/plugins/cron.ts`** —— 重构为 registry 化：模块级 `cronRegistry: Map<string, CronJobStatus>` 持续追踪每个已注册 job 的 `registeredAt / lastRunAt / lastFinishedAt / lastDurationMs / lastError / lastErrorAt / successCount / failureCount`。`schedule()` 用包装函数捕获每轮 start / finish / error，同名重注册自动重置计数。新增 `stopAll()` 关掉全部 interval 让测试干净退出。Fastify decorator 暴露 `app.cron.list()` 让任何路由读到全量状态。
- **`apps/api/src/routes/admin/cron-status.routes.ts`** —— 新端点 `GET /admin/cron/status` 列出全部 job + 派生 `sinceLastRunMs`（距上次跑毫秒数）+ `stale`（>2× everyMs 未跑 或从未跑 视为 stale）。受 admin session 守门。
- **`apps/api/src/bootstrap.ts`** —— 注册 `adminCronStatusRoutes` 到 `/admin/*` 路由组。
- **`apps/web/src/lib/settings-hooks.ts`** —— `useCronStatus()` 10s 自动轮询 + 类型 `CronJobStatus`。
- **`apps/web/src/pages/Settings.tsx`** —— Settings 页 GROUPS 网格新增 `CronStatusCard` 卡片（每行展示 job 名 / 周期 / 上次运行 / 时长 / 成功 / 失败 / stale 边框警示 / 上次错误），并提取出 `CronJobRow` `formatPeriod` `formatRelativeMs` 三个辅助。

### 测试

- **`apps/api/__tests__/tick47.test.ts`** +7 测试：注册即时 list 0 计数 / GET /admin/cron/status 含 sinceLastRunMs+stale / 401 未登录 / 短周期 job 跑后 successCount≥1+lastRunAt / 抛错 job failureCount+lastError / 跑过的 job stale=false / 同名重注册重置计数。
- 全套总测试 487 → 494 通过（packages/shared 10 + provider-core 29 + routing-core 45 + apps/api 410）。

### 工程

- ESLint 0 warning / 0 error；`pnpm --filter @freellm/web run build` 通过；charts/icons chunk 无新增（Settings chunk 11.91→14.47 kB 含新组件）。
- 联动 Tick 0/31/34/37/39/41/46 已注册的 7 个 cron job（model-discovery / provider-health / model-auto-blacklist / provider-balance-check / vk-usage-alert / vk-weekly-report / retention-purge），本 tick 只补"状态追踪 + 可视化"层，不改任何业务逻辑。

## [1.7.18.0] — 2026-05-23 (Tick 46)

数据保留策略 + cron 自动清扫：audit / playgroundSession / 已解决 errorEvent 三域统一管理。

### 新增

- **`apps/api/src/services/retention-policy.service.ts`** —— `RetentionPolicyService.getPolicy / setPolicy / runPurge` 把 Tick 29 audit + Tick 36 playground session 的 `purgeOlderThan` 串成统一 daily-purge 入口。已解决 ErrorEvent 也参与清扫（未解决永不清，避免吞掉运维忘看的告警）。默认 audit 90 天 / playgroundSession 30 天 / errorEvent 180 天；0 = 永不清；上限 3650 天。配置存 Setting 表 key=`retention.policy`。
- **`apps/api/src/plugins/cron.ts`** —— 新增 `retention-purge` cron job，周期由 `FREELLM_RETENTION_PURGE_INTERVAL_MIN`（默认 1440 分钟即 24 小时）控制。
- **3 个新端点**：`GET /admin/settings/retention`（当前策略）+ `PATCH /admin/settings/retention`（部分更新 + 校验）+ `POST /admin/settings/retention/purge`（手动触发一次清扫）。
- **`apps/web/src/lib/settings-hooks.ts`** —— `useRetentionPolicy / useUpdateRetentionPolicy / useRunRetentionPurge` 3 个 hook + 类型 `RetentionPolicy / PurgeReport`。
- **`apps/web/src/pages/Settings.tsx`** —— Settings 页 GROUPS 网格新增 `RetentionPolicyCard` 卡片（3 个 RetentionRow 输入 audit/session/errorEvent 保留天数 + 校验 0-3650 + 立即清扫按钮 + dirty save bar）。

### 测试

- **`apps/api/__tests__/tick46.test.ts`** +11 测试（getPolicy 默认 / setPolicy 部分字段 / 负数超上限 / JSON 损坏回退 + runPurge 三域 + 未解决保留 + retention=0 跳过 + 端点 GET/PATCH/PATCH 400/POST/401 5 case）。
- 全套总测试 476 → 487 通过（packages/shared 10 + provider-core 29 + routing-core 45 + apps/api 403）。

### 工程

- ESLint 0 warning / 0 error；`pnpm --filter @freellm/web run build` 通过；charts/icons chunk 无新增。
- 联动 Tick 29/36 已有 purgeOlderThan + 现有 Setting 表持久化 + 现有 cron 调度框架，本 tick 只补"统一策略 + 触发胶水 + 配置 UI"层。

## [1.7.17.0] — 2026-05-23 (Tick 45)

Playground 配置预设：访客可保存常用 system prompt + 温度 + 偏好模型，下次会话一键应用。

### 新增

- **Prisma 模型 `PlaygroundPreset`**（迁移 `add_playground_presets`）：`id / ownerId / name / systemPrompt / preferredModel / temperature / maxTokens / streaming / notes / createdAt / updatedAt / lastUsedAt` + 复合索引 `[ownerId, lastUsedAt]`。与 Tick 36 PlaygroundSession 共用匿名 ownerId 模型。
- **`apps/api/src/services/playground-preset.service.ts`** —— `PlaygroundPresetService.list / findByIdForOwner / create / update / delete / markUsed`；校验：name 必填 + temperature 范围 0-2 + systemPrompt 上限 16 KB + notes 上限 1 KB；跨 owner CRUD 视为 404。
- **6 个公开端点** `/public/playground/presets/*`：GET 列表 / POST 创建 / GET 详情 / PATCH 部分更新 / DELETE / POST :id/mark-used（应用时戳 lastUsedAt 便于侧栏按使用频率排序）。
- **`apps/web/src/lib/usePlaygroundPresets.ts`** —— 5 个 TanStack hook + 类型 `PlaygroundPresetRow / CreatePresetInput / UpdatePresetInput`（60 秒 staleTime）。
- **`apps/web/src/pages/Playground.tsx`** —— ① 顶部新增预设选择条（已保存预设的横向 chip 列表 + 新预设按钮）② 点击 chip 应用预设：填充 systemPrompt 状态 + emit markUsed + toast 通知 ③ 含 system prompt 时 runChat 自动在 messages 最前插 system 消息 ④ "含 system prompt" Badge 提示当前会话使用预设 ⑤ `PresetFormDialog` 子组件含名称/system prompt/偏好模型/温度 4 字段表单。

### 测试

- **`apps/api/__tests__/tick45.test.ts`** +13 测试（CRUD 5 + 校验 2 含 temperature 范围/空 name + markUsed 1 + lastUsedAt 排序 + 端点 7 含 owner 隔离/缺 owner/mark-used 触发）。
- 全套总测试 463 → 476 通过（packages/shared 10 + provider-core 29 + routing-core 45 + apps/api 392）。

### 工程

- ESLint 0 warning / 0 error；`pnpm --filter @freellm/web run build` 通过；charts/icons chunk 复用已加载无新增。
- 联动 Tick 36 ownerId：访客无需账号，只要 localStorage 不丢，预设和会话都保留；服务端不做账号绑定。

## [1.7.16.0] — 2026-05-23 (Tick 44)

模型详情卡升级：ModelScore 9 维评分雷达图 + 近 20 条 ErrorEvent + 10 条 ModelSnapshot 历史。

### 新增

- **`apps/api/src/routes/admin/models.routes.ts`** —— `GET /admin/models/:id` 响应新增 `errorEvents` 字段（include 近 20 条按 createdAt 倒序，仅返回 `id / kind / severity / message / createdAt / resolvedAt`），与现有 `scores` + `snapshots` 一起返回完整详情。
- **`apps/web/src/lib/admin-hooks.ts`** —— 完整类型化 `useModelDetail` 返回值：`ModelDetailResponse` + `ModelScoreDetail`（9 维分数 + 综合 + 24h 计数）+ `ModelErrorEventRow` + `ModelSnapshotRow`，替换原 untyped 返回。
- **`apps/web/src/components/charts/ModelScoreRadar.tsx`** —— 新建 recharts `RadarChart` 组件（~90 行）：9 维归一化到 0-1 + 中心叠加 composite 分数 + 中文维度标签（可用性/延迟/限流/质量/上下文/能力/新鲜度/成本/稳定性）+ Tooltip 显示具体分数。
- **`apps/web/src/pages/Models.tsx`** —— 详情对话框三大新区域：① **评分雷达** GlassCard（替换原假数据"快照历史" mock）+ 24h 成功/失败/429 三色徽章 ② **最近错误事件** GlassCard（仅 ≥1 条时显示，最多 20，含 severity 配色 + 时间倒序 + 已解决 ✓ 标记）③ **快照历史** GlassCard（近 10 次发现 + 免费/付费徽章）。

### 测试

- **`apps/api/__tests__/tick44.test.ts`** +8 测试（404 / 401 / scores 9 维完整 / snapshots 倒序 + 上限 10 / errorEvents modelId 隔离 + 倒序 + 上限 20 / 无 scores → null / 无 errorEvents → [] / severity 透传 critical）。
- 全套总测试 455 → 463 通过（packages/shared 10 + provider-core 29 + routing-core 45 + apps/api 379）。

### 工程

- ESLint 0 warning / 0 error；`pnpm --filter @freellm/web run build` 通过；charts chunk 443.89 → 455.55 KB（+11.66 KB，含 RadarChart + PolarGrid + PolarAngleAxis + PolarRadiusAxis 等 recharts 极坐标系组件）。
- 替换 Models 详情对话框 36 个随机 div 假数据 mock 为真 RadarChart 可视化；联动 Tick 0/1 ModelScore 9 维评分系统，让管理员一眼看出"这模型是延迟差/质量好/限流频繁还是综合稳健"。

## [1.7.15.0] — 2026-05-23 (Tick 43)

审计反向 group by 统计页：4 维度聚合 + recharts 双图（柱状 + 按日折线带失败率）+ Tab 切换。

### 新增

- **`apps/api/src/services/admin-audit-aggregate.service.ts`** —— `AdminAuditAggregateService.stats(dimension, opts)` 跨 user / resource / action / day 四维度聚合 AdminAuditLog；user/resource/action 用 `prisma.groupBy` 双查询（一遍 total + 一遍 status>=400 failed）+ 计算 failureRate + 按 total 降序 + topN 裁剪；day 维度用 `findMany + JS 端 UTC bucket` 填空桶（SQLite 无 date_trunc）；返回 `totalEvents` + `buckets[{key, total, failed, failureRate}]`。
- **`GET /admin/audit/stats?dimension=user|resource|action|day&since=&until=&topN=`** 端点，zod 校验 dimension 枚举 + 时间区间 ISO + topN 1-100。
- **`apps/web/src/lib/useAudit.ts`** —— `useAuditStats(dimension, opts)` hook + 类型 `AuditStatsDimension / AuditStatsBucket / AuditStatsResult`（60 秒 staleTime）。
- **`apps/web/src/pages/Audit.tsx`** —— ① Tab 切换 "事件列表 / 统计图表"（按钮组 UI 与现有 statusFilter 同构）② `AuditStatsView` 子组件：维度切换 4 按钮 + 总事件数 + 桶数统计 + 280px 图表区（user/resource/action → recharts `BarChart` 双 Bar 显示总数 + 失败；day → `ComposedChart` 左轴 Bar 事件数 + 右轴 Line 失败率 % + Tooltip 中文化）+ 等价数据表（4 列 key/total/failed/failureRate）。

### 测试

- **`apps/api/__tests__/tick43.test.ts`** +11 测试（空表 / user 失败率排序 / resource / action / topN 裁剪 / day 跨日聚合 + 空桶填充 / 端点 4 case 含默认/未知/401）。
- 全套总测试 444 → 455 通过（packages/shared 10 + provider-core 29 + routing-core 45 + apps/api 371）。

### 工程

- ESLint 0 warning / 0 error；`pnpm --filter @freellm/web run build` 通过；charts chunk 因复用 recharts 已加载无新增。
- 关键 bugfix：day 维度 `dayCount` 计算从 `(windowEnd - windowStart) / 86400` 改为 `(windowEnd - startDay) / 86400`，否则跨 UTC 日的事件会落到 buckets[N] 越界被丢弃，导致非整数倍 7 天的边界 case 数据丢失。

## [1.7.14.0] — 2026-05-23 (Tick 42)

Logs 详情卡升级：RouteAttempt 真瀑布图（时间偏移条 + TTFB 标线 + cooldown 色）+ 失败明细 + cURL 复制。

### 新增

- **`apps/api/src/routes/admin/logs.routes.ts`** —— `GET /admin/logs/:requestId` 响应扁平化 + 扩展字段：每个 attempt 新增 `startedAt / finishedAt / firstTokenMs / cooldownTriggered / bytesIn / bytesOut / providerSlug / providerName / modelDisplayName`（关系字段通过 prisma include 拉取后展平到顶层）。
- **`apps/web/src/lib/lab-keys-logs-hooks.ts`** —— `RouteAttemptRow` 类型完整覆盖新字段；`LogDetail.attemptsList` 类型升级到 `RouteAttemptRow[]`。
- **`apps/web/src/components/data/RouteAttemptWaterfall.tsx`** —— 新建瀑布图组件：每条 attempt 渲染为时间轴 bar（`startOffsetMs / totalMs × 100%` 起始位置 + `durationMs / totalMs × 100%` 宽度）；TTFB 标线（firstTokenMs 处一根 2px 黑色竖线）；三色区分 success/fail/cooldown；hover tooltip 显示 model / 耗时 / TTFB / errorMessage；带时间标尺 + 图例。
- **`apps/web/src/pages/Logs.tsx`** —— 详情对话框替换简单进度条版为 `<RouteAttemptWaterfall>`；新增 ① "复制 cURL" 按钮（一键拷贝可复跑的 curl 命令） ② 失败明细 GlassCard（仅当 ≥1 个 attempt 失败时显示，列出每个 attempt 的 errorKind + errorMessage 全文）。
- **`renderReplayCurl`** 工具函数：基于 detail 生成 `curl http://localhost:3001/v1/chat/completions ... -d '{"model":"...", "messages":...}'` 模板。

### 测试

- **`apps/api/__tests__/tick42.test.ts`** +7 测试（404 / 401 / 单 attempt 字段完整 / 多 attempt 倒序插入按 ordinal 升序返回 + cooldownTriggered / provider/model 缺关系字段 → null / 空 attemptsList / bytesIn/Out 默认 0）。
- 全套总测试 437 → 444 通过（packages/shared 10 + provider-core 29 + routing-core 45 + apps/api 360）。

### 工程

- ESLint 0 warning / 0 error；`pnpm --filter @freellm/web run build` 通过；新 RouteAttemptWaterfall 组件 ≈ 120 行 + 时间偏移百分比计算公式。
- 排查体验显著提升：之前仅看摘要无法回答 "为什么这个请求重试了 3 次"，现在瀑布图直接显示每次 attempt 的起始/失败时刻 + cooldown 触发位置 + TTFB 分位。

## [1.7.13.0] — 2026-05-23 (Tick 41)

VK 用量周报推送：cron 每周一自动汇总上周 + emit webhook + 强制发送/预览。

### 新增

- **`apps/api/src/services/vk-usage-weekly-report.service.ts`** —— `VkUsageWeeklyReportService.generate(now)` 聚合上周 7 天窗口：`totals (requests/successful/failed/totalTokens/costUsd/activeVks/alertedVks)` + `topVks` (按 cost 降序 top 5 含 label) + `alertedVkSummary` (从 ErrorEvent kind=vk_usage_alert 抽 virtualKeyId 聚合)。`maybeSendWeekly(now)` cron 入口：判定 (UTC 周一 0-12 点 + 距上次 ≥6 天) 才真正发送；`forceSend(now)` 端点入口无视限制；`getLastSentAt()` 反查持久化状态。
- **`apps/api/src/plugins/cron.ts`** —— 新增 `vk-weekly-report` cron job，每小时跑一次 `maybeSendWeekly`。
- **状态持久化**：复用 `Setting` 表存 `vk_weekly_report.lastSentAt`（`category=cron`），无新 schema。
- **2 个新端点**：
  - `GET /admin/virtual-keys/weekly-report` 预览（不发送）+ `lastSentAt` 状态
  - `POST /admin/virtual-keys/weekly-report/send` 强制发送（emit webhook + 更新 lastSentAt）
- **事件**：emit `vk:weekly_report` → Tick 26 webhook dispatcher 自动出站投递给订阅了该 topic 的 URL（运维可在邮件/Slack/PagerDuty 收到周报）。
- **`apps/web/src/lib/lab-keys-logs-hooks.ts`** —— `useVkWeeklyReportPreview / useForceSendWeeklyReport` 2 hook + 类型 `VkWeeklyReport / VkWeeklyReportTopVk`。
- **`apps/web/src/pages/VirtualKeys.tsx`** —— Header 加 "查看周报" 按钮 + 周报预览对话框（6 列总览 / top 5 VK 清单 / 强制发送按钮）。

### 测试

- **`apps/api/__tests__/tick41.test.ts`** +12 测试（generate 4 case 含窗口边界 / alertedVkSummary 解析 / maybeSendWeekly 5 case 含周一/周二/窗口关闭/同周防重复/forceSend / 端点 3 case）。
- 全套总测试 425 → 437 通过（packages/shared 10 + provider-core 29 + routing-core 45 + apps/api 353）。

### 工程

- ESLint 0 warning / 0 error；`pnpm --filter @freellm/web run build` 通过；icons chunk 无新增（复用现有图标）；VirtualKeys chunk 因周报对话框略增。
- 联动 v1.7 已有零件：Tick 26 webhook dispatcher + Tick 38 月报模式 + Tick 39 vk_usage_alert ErrorEvent，本 tick 只新增"周聚合 + 定时发送" 胶水层，零件复用率最大化。

## [1.7.12.0] — 2026-05-23 (Tick 40)

管理员告警中心：聚合 Tick 31/34/37/39 四大告警源到统一页面 + 解决标记 + 全局未解决 Badge。

### 新增

- **`apps/api/src/services/alerts-center.service.ts`** —— `AlertsCenterService.list / resolve / stats`，跨 `ErrorEvent` 表的多 kind（`balance_low / vk_usage_alert / model_change / provider_outage / auth_failure / 429_storm / content_filter / unknown`）统一查询；`stats` 用 `prisma.groupBy` 按 kind + severity 双维度聚合 + totalUnresolved；resolve 落 `resolvedAt`，已解决再次 resolve 幂等。
- **3 个新端点**：
  - `GET /admin/alerts?kind=&severity=&resolved=&limit=&offset=` 全部告警 + 多维筛选 + 分页
  - `GET /admin/alerts/stats` 按 kind / severity 分组统计 + totalUnresolved
  - `POST /admin/alerts/:id/resolve` 标记 resolvedAt
- **`apps/web/src/lib/useAlerts.ts`** —— `useAlerts(filter) / useAlertsStats() / useResolveAlert()` 3 个 hook + 类型 `AlertRow / AlertsListFilter / AlertsStats`（30 秒 staleTime + placeholderData 防闪烁）。
- **`apps/web/src/pages/Alerts.tsx`** —— 新增告警中心页（~330 行）：① 三栏统计卡（totalUnresolved + byKind 徽章 + bySeverity 徽章） ② 筛选 GlassCard（类别 / 严重度 / 已解决|未解决|全部） ③ 列表表格（时间 / 类别 / 严重度 / 消息 / 状态徽章 / 标记解决按钮） ④ 详情对话框（含 redacted detailsJson + 解决按钮）。
- **`apps/web/src/router.tsx`** + **`apps/web/src/components/layout/Sidebar.tsx`** —— `/alerts` lazy route + Sidebar `Bell` 图标入口（位于 Webhook 与请求日志之间）。
- **`apps/web/src/pages/Dashboard.tsx`** —— PageHeader 区新增"未解决告警 Badge"（仅当 totalUnresolved > 0 显示，danger 配色，点击跳转 `/alerts`），运维一眼看到全局告警计数。

### 测试

- **`apps/api/__tests__/tick40.test.ts`** +16 测试（list 5 case 含筛选/分页 / resolve 3 case 含幂等 / stats 2 case / 端点 6 case 含 401/404）。
- 全套总测试 409 → 425 通过（packages/shared 10 + provider-core 29 + routing-core 45 + apps/api 341）。

### 工程

- ESLint 0 warning / 0 error；`pnpm --filter @freellm/web run build` 通过；icons chunk 因 Bell + CheckCircle2 复用，仅 +0.42 KB；新 Alerts chunk ≈ 4 KB。
- 整合 v1.7 全部告警子系统：以前每个 tick 各做各的告警（Tick 31 health / Tick 34 auto-blacklist / Tick 37 balance / Tick 39 vk usage），本 tick 把它们聚合到统一视图 + 统一解决流程，让运维不必跨 5 个页面回收告警。

## [1.7.11.0] — 2026-05-23 (Tick 39)

VK 限额预警：接近 80% 阈值自动告警 + cron 周期扫 + 进度条 UI + 联动 webhook。

### 新增

- **`apps/api/src/services/vk-usage-alert.service.ts`** —— `VkUsageAlertService.getUsageSnapshot(vkId)` 算单 VK 24h 内 `requestsToday / tokensToday / requestUsagePct / tokenUsagePct / approachingLimit`。`checkAll(thresholdPct=0.8)` 扫所有已启用且设了 daily limit 的 VK：超阈值 → 写 `ErrorEvent (kind='vk_usage_alert', severity='warn')` + emit `vk:usage_alert` 事件供 Tick 26 webhook dispatcher 自动出站。`listRecentAlerts(limit)` 反查最近 N 条。模块级 `alertCache` 实现 (vkId, metric) 24h 防重复，requests 和 tokens 分别独立告警。
- **`apps/api/src/plugins/cron.ts`** —— 新增 `vk-usage-alert` cron job，周期由 `FREELLM_VK_USAGE_ALERT_INTERVAL_MIN`（默认 60 分钟）控制。
- **`packages/shared/src/env.ts`** —— 新环境变量 `FREELLM_VK_USAGE_ALERT_INTERVAL_MIN: IntFromString.default(60)`。
- **3 个新端点**：
  - `GET /admin/virtual-keys/:id/usage` — 单 VK 今日用量快照（请求数 / token 数 / usagePct / approachingLimit）
  - `POST /admin/virtual-keys/alerts/check` — 手动触发全 VK 扫描
  - `GET /admin/virtual-keys/alerts/recent?limit=` — 近 N 条 vk_usage_alert ErrorEvent
- **`apps/web/src/lib/lab-keys-logs-hooks.ts`** —— `useVkUsageSnapshot / useVkUsageAlerts / useTriggerVkUsageCheck` 3 个 hook + 类型 `VkUsageSnapshot / VkUsageAlertRow / VkUsageAlertCheckReport`。
- **`apps/web/src/pages/VirtualKeys.tsx`** —— ① PageHeader 加 "扫描预警" 按钮 ② 页面顶部新增 "密钥用量预警" GlassCard（仅 ≥1 条时显示，warning 配色） ③ VK 详情对话框新增 `VirtualKeyUsageBlock` 子组件（双进度条 requests/tokens，limit=null 时显示 ∞，≥80% 时进度条变 warning 色 + 显示"接近上限" Badge）。

### 测试

- **`apps/api/__tests__/tick39.test.ts`** +14 测试（getUsageSnapshot 5 case 含无限额/不存在/30%/85%/90% / checkAll 5 case 含 24h 防重复 / 双 metric 独立 / 端点 4 case）。
- 全套总测试 395 → 409 通过（packages/shared 10 + provider-core 29 + routing-core 45 + apps/api 325）。

### 工程

- ESLint 0 warning / 0 error；`pnpm --filter @freellm/web run build` 通过；VirtualKeys chunk 因预警 GlassCard + UsageBar + 工具条略增。
- 联动 Tick 37 (provider 余额告警) 同构设计：service + cron + ErrorEvent + emit 事件 + Web 顶部 GlassCard + 手动触发按钮，使运维侧 4 大告警维度（provider 健康 / 模型自动黑名单 / provider 余额 / VK 用量）全部主动化。

## [1.7.10.0] — 2026-05-23 (Tick 38)

VK 月度报告：完整账单（总览 + 日桶 + top 模型 + 错误分布）+ JSON / CSV 双格式导出。

### 新增

- **`apps/api/src/services/virtual-key-report.service.ts`** —— `VirtualKeyReportService.buildMonthlyReport(vkId, year, month)` 按月切片聚合 RequestLog：`totals`（请求/成功/失败/totalTokens/promptTokens/completionTokens/costUsd/avgLatencyMs/p50LatencyMs/p95LatencyMs）+ `dailyBreakdown[]`（按月天数 28-31 个桶）+ `topModels[]`（按 cost 降序 top 10）+ `errorBreakdown[]`（按 errorKind 聚合）+ 工具函数 `percentile(values, q)`。`formatAsCsv(report)` 输出多段 CSV（# 注释 + ## Totals / Daily Breakdown / Top Models / Error Breakdown 四段）。
- **`GET /admin/virtual-keys/:id/report?month=YYYY-MM`** —— 完整 JSON 报告；月份格式正则校验（`^\d{4}-(0[1-9]|1[0-2])$`）。
- **`GET /admin/virtual-keys/:id/report.csv?month=YYYY-MM`** —— CSV 下载（`text/csv` + `Content-Disposition: attachment; filename="vk-report-<vkId>-<month>.csv"`），供 Excel / 离线归档。
- **`apps/web/src/lib/lab-keys-logs-hooks.ts`** —— `useVirtualKeyMonthlyReport(id, month)` hook + 类型 `VirtualKeyMonthlyReport / MonthlyReportDailyBucket / MonthlyReportTopModel / MonthlyReportErrorBreakdown`（60 秒 staleTime）。
- **`apps/web/src/pages/VirtualKeys.tsx`** —— 详情对话框新增 `VirtualKeyMonthlyReportBlock` 子组件：`<input type="month">` 月份选择 + "导出 CSV" 按钮 + 6 列 ReportStat 总览（请求/成功率/成本/Token/P50/P95）+ top 5 模型清单 + 错误徽章网格。

### 测试

- **`apps/api/__tests__/tick38.test.ts`** +11 测试（percentile 2 case / buildMonthlyReport 5 case 含空月 / 完整聚合 / 跨月排除 / CSV 格式 / 闰年判断 + 端点契约 4 case）。
- 全套总测试 384 → 395 通过（packages/shared 10 + provider-core 29 + routing-core 45 + apps/api 311）。

### 工程

- ESLint 0 warning / 0 error；`pnpm --filter @freellm/web run build` 通过；icons chunk 无显著变化（复用已引入的图标）。
- 联动 Tick 30 cost + Tick 33 VK cost：本 tick 提供"按月切片 + 多维度"的最完整账单视图，运维可拿 CSV 直接做账单报销 / 财务对账。

## [1.7.9.0] — 2026-05-23 (Tick 37)

Provider 余额周期自检 cron + 主动告警链路：把 Tick 28 forecast + Tick 26 webhook 串成端到端"低余额自动通知运维"。

### 新增

- **`apps/api/src/services/provider-balance-check.service.ts`** —— `ProviderBalanceCheckService.checkAll` 周期扫所有 registry provider 的 forecast；命中 `alerted=true` → 写一条 `ErrorEvent (kind='balance_low', severity='warn')` + 联动现有 `provider:balance_low` 事件（Tick 26 webhook dispatcher 自动出站）。`listRecentAlerts(limit)` 反查近 N 条 ErrorEvent 含 provider slug。
- **`apps/api/src/plugins/cron.ts`** —— 新增 `provider-balance-check` cron job，周期由 `FREELLM_PROVIDER_BALANCE_CHECK_INTERVAL_MIN`（默认 240 分钟即 4 小时）控制。配合 Tick 28 alertCache 24h 防重复，同一 provider 24h 内最多一条 ErrorEvent。
- **`packages/shared/src/env.ts`** —— 新环境变量 `FREELLM_PROVIDER_BALANCE_CHECK_INTERVAL_MIN: IntFromString.default(240)`。
- **`POST /admin/providers/balance/check`** —— 手动触发全部 provider 余额检查（cron 同期跑）。
- **`GET /admin/providers/balance/alerts?limit=`** —— 近 N 条（默认 20，最多 200）`kind=balance_low` ErrorEvent + provider slug。
- **`apps/web/src/lib/admin-hooks.ts`** —— `useTriggerBalanceCheck` mutation + `useBalanceAlerts` query + 类型 `BalanceCheckResult / BalanceAlertRow`。
- **`apps/web/src/pages/Providers.tsx`** —— ① PageHeader actions 新增 "检查余额" 按钮（`DollarSign` 图标）触发手动检查，toast 显示命中数量 ② 页面顶部新增 "余额预警" GlassCard（仅当 ≥1 条 balance_low 时显示，warning 配色，最多 10 条横向滚动列表）。

### 测试

- **`apps/api/__tests__/tick37.test.ts`** +8 测试（checkAll 4 case 含空 registry / 低余额触发 / null balance 跳过 / listRecentAlerts 倒序 + 端点契约 4 case）。
- 全套总测试 376 → 384 通过（packages/shared 10 + provider-core 29 + routing-core 45 + apps/api 300）。

### 工程

- ESLint 0 warning / 0 error；`pnpm --filter @freellm/web run build` 通过；icons chunk 因 AlertCircle + DollarSign 引入 +0.37 KB。
- 联动 v1.7 已有零件：Tick 28 forecast + alertCache + Tick 26 webhook dispatcher，本 tick 只新增 cron 调度 + ErrorEvent 落库 + 2 端点 + Web 显示区，零件复用率最大化。

## [1.7.8.0] — 2026-05-23 (Tick 36)

Playground 多轮对话 + 历史会话：浏览器匿名 ownerId + 后端 PlaygroundSession 表 + 5 个公开 CRUD 端点 + 侧栏管理。

### 新增

- **Prisma 模型 `PlaygroundSession`**（迁移 `add_playground_sessions`）：`id / ownerId / name / demoVkPrefix / messagesJson / createdAt / updatedAt / lastMessageAt` + 复合索引 `[ownerId, lastMessageAt]`。
- **`apps/api/src/services/playground-session.service.ts`** —— `PlaygroundSessionService.list / findByIdForOwner / create / update / delete / purgeOlderThan` + 工具函数 `deriveNameFromMessages`（首条用户消息前 60 字符）+ `parseMessages`（健壮 JSON 解析 + 字段校验）。messagesJson 256 KB 上限防爆表。
- **`apps/api/src/routes/public/playground-sessions.routes.ts`** —— 5 个公开端点（GET 列表 / POST 创建 / GET 详情 / PATCH 追加 messages / DELETE）。所有 CRUD 强制 `owner` 校验，跨 owner 视为 404；列表不带 messages 节省带宽。
- **`apps/web/src/lib/usePlaygroundSessions.ts`** —— `useOrCreateOwnerId` localStorage 持久化 ownerId（首次访问 `pg + ts + 16 hex` 生成）+ `usePlaygroundSessions / usePlaygroundSession / useCreatePlaygroundSession / useUpdatePlaygroundSession / useDeletePlaygroundSession` 5 个 hook。
- **`apps/web/src/pages/Playground.tsx`** —— 完整重构：① `messages: PlaygroundMessage[]` 多轮 state，每次响应 append 到末尾 ② 历史会话切换工具条 + 折叠会话列表（显示 name / 时间 / demo VK prefix / 删除按钮） ③ "新对话" 按钮重置 state ④ 自动持久化（首条 user msg 触发 create，后续 patch）⑤ 时间线 UI 区分 user / assistant 消息，附 model + duration meta。

### 测试

- **`apps/api/__tests__/tick36.test.ts`** +14 测试（工具函数 3 case / Service CRUD 6 case 含 owner 隔离 + purge / 端点契约 5 case 含 owner 不匹配 404 / zod 校验）。
- 全套总测试 362 → 376 通过（packages/shared 10 + provider-core 29 + routing-core 45 + apps/api 292）。

### 工程

- ESLint 0 warning / 0 error；`pnpm --filter @freellm/web run build` 通过；icons chunk 因 History/MessageSquare/Plus/Trash2 引入 +0.66 KB。
- 设计取舍：访客匿名设计 — 丢失 localStorage 即丢失历史；服务端不做账号绑定，全靠 ownerId 字符串做所有权校验。

## [1.7.7.0] — 2026-05-23 (Tick 35)

模型黑/白名单批量管理：bulk 端点 + checkbox 多选 + 批量操作菜单 + import/export JSON。

### 新增

- **`POST /admin/models/bulk`** —— ids ≤ 500 / action ∈ {blacklist / whitelist / enable / disable / reset}；prisma `updateMany` 单 SQL 高效更新；每个 action 配套副作用（blacklist 同时清 whitelisted + 设 force_disabled + status='disabled'，whitelist 同时清 blacklisted + force_enabled + status='active'，reset 清所有 4 字段含 notes）。
- **`GET /admin/models/export`** —— 仅导出有覆盖的模型（blacklisted OR whitelisted OR manualOverride != null），按 upstreamId 升序，含 providerSlug 复合键 + notes + weightAdj。
- **`POST /admin/models/import`** —— ≤1000 个 entry，按 (providerSlug, upstreamId) 复合键匹配；找不到时 skipped 不报错（适合灾备 / 跨环境迁移）；manualOverride 同步更新 status 字段。
- **`apps/web/src/lib/admin-hooks.ts`** —— `useBulkPatchModels / useExportModels / useImportModels` 三个 mutation/query hook + 类型 `BulkAction / BulkModelsResult / ExportedModelEntry`。
- **`apps/web/src/pages/Models.tsx`** —— ① 表格首列新增 checkbox（点击 row 不会勾选，事件冒泡已阻断）+ header 全选切换 ② 选中 ≥1 个 model 时显示批量操作工具条（5 个 action 按钮 + 清空选择）③ Header 新增"导出 JSON"+ "导入 JSON" 按钮，配套隐藏 file input 接受 .json 拖拽 ④ toast 显示批量结果（modified/requested）。

### 测试

- **`apps/api/__tests__/tick35.test.ts`** +11 测试（5 个 bulk action 副作用 + ids 上限 / 未知 action / 401 / export 只导出有覆盖 / import 复合键 + 找不到 skipped / 0 entry / manualOverride 同步 status）。
- 全套总测试 351 → 362 通过（packages/shared 10 + provider-core 29 + routing-core 45 + apps/api 278）。

### 工程

- ESLint 0 warning / 0 error；`pnpm --filter @freellm/web run build` 通过；icons chunk 因 CheckSquare/Square/Upload/Download 引入 +0.6 KB；Models chunk 因 bulk 工具条 + import/export 逻辑略增。
- 联动 Tick 34 自动黑名单：`reset` action 同时清 notes 字段，让管理员能一键解除 `auto-blacklisted` 标记复原模型。

## [1.7.6.0] — 2026-05-23 (Tick 34)

模型自动黑名单 cron：周期评估每个 active model 的健康，连续失败或低成功率 → 自动 force_disabled。

### 新增

- **`apps/api/src/services/model-auto-blacklist.service.ts`** —— `ModelAutoBlacklistService.evaluateAll()` + `listRecentlyAutoBlacklisted()` + 纯函数 `evaluateModelLogs(logs, opts)`。触发条件（任一）：① 最近 ≥5 次连续失败 ② 24h 成功率 < 50% 且样本量 ≥ 10。跳过条件：`whitelisted=true` / `manualOverride='force_enabled'` / 已被禁用。命中 → 设 `Model.manualOverride='force_disabled'` + 写 `notes` 标记 + 写 `ErrorEvent (kind=model_change, severity=warn)` + emit `model:auto_blacklisted` 事件。
- **`apps/api/src/plugins/cron.ts`** —— 新增 `model-auto-blacklist` cron job，周期由 `FREELLM_MODEL_AUTO_BLACKLIST_INTERVAL_MIN`（默认 15 分钟）控制。
- **`packages/shared/src/env.ts`** —— 新环境变量 `FREELLM_MODEL_AUTO_BLACKLIST_INTERVAL_MIN: IntFromString.default(15)`。
- **`POST /admin/models/auto-blacklist/evaluate`** —— 手动触发评估（cron 同期跑）；命中时自动 invalidate pool/metrics 缓存。
- **`GET /admin/models/auto-blacklist/recent`** —— 最近 N 个被自动黑的模型（按 ErrorEvent.createdAt 倒序）。
- **`apps/api/src/routes/admin/models.routes.ts`** —— `GET /admin/models` 响应新增 `manualOverride / notes / autoBlacklisted` 三字段（前端识别标记用）。
- **`apps/web/src/lib/admin-hooks.ts`** —— `ModelRow` 类型扩展三字段 + `useEvaluateAutoBlacklist` mutation + `useRecentAutoBlacklisted` query + 类型 `AutoBlacklistReport / AutoBlacklistResult / AutoBlacklistRecentRow`。
- **`apps/web/src/pages/Models.tsx`** —— ① 模型列单元新增 `ShieldOff + "自动黑名单"` 徽章（仅当 `r.autoBlacklisted=true` 显示，`title` 含 notes 详情）② Header 加 "评估黑名单" 按钮触发手动评估，toast 显示命中数量。

### 测试

- **`apps/api/__tests__/tick34.test.ts`** +15 测试（evaluateModelLogs 6 case / evaluateAll 集成 6 case 含跳过路径 / listRecentlyAutoBlacklisted / 3 端点契约）。
- 全套总测试 336 → 351 通过（packages/shared 10 + provider-core 29 + routing-core 45 + apps/api 267）。

### 工程

- ESLint 0 warning / 0 error；`pnpm --filter @freellm/web run build` 通过；Models chunk 因新增 badge + button 略增；icons chunk 因 ShieldOff 引入 +0.52 KB。
- 联动 Tick 31 health check 自然分工：health check 管 provider 级，auto-blacklist 管 model 级，互不重叠。

## [1.7.5.0] — 2026-05-23 (Tick 33)

虚拟密钥级成本统计：per-VK cost + top 模型排行 + Web 详情卡 + 列表 7d 成本徽章。

### 新增

- **`apps/api/src/services/virtual-key-cost.service.ts`** —— `VirtualKeyCostService.compute(vkId, days, topLimit)` 按 `virtualKeyId` 切片聚合 RequestLog：`totalCostUsd / totalRequests / successfulRequests / billableRequests / topModels[5]`；`listAllCosts(days)` 一次性返回所有 VK 的总成本（按 cost 降序）。复用 Tick 30 的 `estimatedCostUsd` 字段，无新 schema。
- **`GET /admin/virtual-keys/:id/cost?days=7|30`** —— 单 VK 成本明细 + top 5 模型；`days` 1–90 范围。
- **`GET /admin/virtual-keys/costs?days=7`** —— 所有 VK 总成本（用于列表"成本"列一次性拉完）。
- **`apps/web/src/lib/lab-keys-logs-hooks.ts`** —— `useVirtualKeyCost(id, days)` + `useVirtualKeysCosts(days)` TanStack hooks (30 秒 staleTime) + 类型 `VirtualKeyCostPayload / VirtualKeyCostTopModel`。
- **`apps/web/src/pages/VirtualKeys.tsx`** —— ① 列表每张 VK 卡底部加 "7d 成本" 徽章（仅当 cost > 0 显示，warning 配色）。② 详情对话框最上方插入 `VirtualKeyCostBlock` 子组件：7d / 30d 切换按钮 + 总成本 / 请求数 / 成功率三列 + top 5 模型成本排行（模型 ID + cost + 请求数）。`formatCostUsdInline` 按金额量级三档显示 4/3/2 位小数。

### 测试

- **`apps/api/__tests__/tick33.test.ts`** +11 测试（compute 5 case 含 null cost / 窗口边界 / 多 VK 隔离 / listAllCosts 排序 / 端点契约 5 case）。
- 全套总测试 325 → 336 通过（packages/shared 10 + provider-core 29 + routing-core 45 + apps/api 252）。

### 工程

- ESLint 0 warning / 0 error；`pnpm --filter @freellm/web run build` 通过；VirtualKeys chunk 因新增 cost block 子组件略增。
- 联动 Tick 30 cost：用同样的 estimatedCostUsd 字段做 per-VK 切片，无双重计算 / 双重存储。

## [1.7.4.0] — 2026-05-23 (Tick 32)

Dashboard 时间序列双轴图：1h/24h/7d 切换，请求堆叠（成功/失败）+ 成本曲线双轴。

### 新增

- **`apps/api/src/services/metrics-timeseries.service.ts`** —— `MetricsTimeseriesService.buildTimeseries(window)` + 工具函数 `makeEmptyBuckets / bucketRequests`。三个窗口配置：`1h` (60 个 1 分钟桶) / `24h` (24 个 1 小时桶) / `7d` (7 个 1 天桶)；SQLite 无 raw date_trunc，故 `findMany` 拉窗口内日志后 JS 端按 bucketMs 整除分桶；上限 cap 10000 条防 OOM。
- **`apps/api/src/routes/admin/metrics-timeseries.routes.ts`** —— `GET /admin/metrics/timeseries?window=1h|24h|7d`（默认 24h）；按 window 独立 5 秒 TTL 缓存（`Map<window, entry>`）+ `invalidateTimeseriesCache()` 导出供测试。
- **`apps/web/src/lib/admin-hooks.ts`** —— `useMetricsTimeseries(window)` hook（5 秒 staleTime + placeholderData 防闪烁）+ 类型 `TimeseriesWindow / TimeseriesBucket / TimeseriesPayload`。
- **`apps/web/src/components/charts/TimeseriesChart.tsx`** —— `recharts.ComposedChart` 双轴：左轴堆叠 area (`success` + `failed`)、右轴 line (`costUsd`)；按 window 自适应 X 轴 tick 格式（HH:MM / HH:00 / M/D）；Tooltip 中文 label；图例底部展示。
- **`apps/web/src/pages/Dashboard.tsx`** —— 新增"请求与成本趋势" GlassCard：内嵌 `TimeseriesChart` + 右上角 3 按钮组 `1h / 24h / 7d` 切换（`useState` 状态本地，使用 `Button` variant=primary/ghost 高亮当前选项）。

### 测试

- **`apps/api/__tests__/tick32.test.ts`** +13 测试（makeEmptyBuckets 4 case / bucketRequests 3 case / buildTimeseries 2 case / 端点契约 4 case）。
- 全套总测试 312 → 325 通过（packages/shared 10 + provider-core 29 + routing-core 45 + apps/api 241）。

### 工程

- ESLint 0 warning / 0 error；`pnpm --filter @freellm/web run build` 通过；charts chunk 421 → 443.89 KB（+22 KB，含 ComposedChart + Line + Legend recharts 组件）；新 TimeseriesChart 组件源 ≈ 110 行。
- 联动 Tick 30 成本核算：双轴图在同一时间轴对比 requests 与 cost，方便看"哪个时段烧钱最猛"。

## [1.7.3.0] — 2026-05-23 (Tick 31)

Provider 健康检查定时调度：cron 每 5 分钟 probe 所有上游，失败 → 自动 Cooldown，前端实时健康徽章。

### 新增

- **Prisma 字段 `Provider.lastHealthAt`**（迁移 `add_provider_last_health_at`）：DateTime?，记录最近一次主动健康检查时刻；用 `lastSuccessAt` + `lastErrorAt` + `lastErrorMessage` 配套表达健康历史。
- **`apps/api/src/services/provider-health.service.ts`** —— `ProviderHealthService.checkOne / checkAll / history` + `classifyError` 工具函数。每次 probe：① 写一条 `HealthCheck` 记录（复用 Tick 0 已有表）② 更新 Provider 状态字段（lastHealthAt / lastSuccessAt|lastErrorAt / status / errorCount24h）③ 失败时若无未过期 Cooldown 则写一条 (scope=provider, 默认 5 分钟 backoff) ④ emit `provider:health_check` 事件供 SSE / Webhook 接力。单次 probe 超时 10s，checkAll 并发 + Promise.allSettled 隔离失败。
- **`apps/api/src/plugins/cron.ts`** —— 新增 `provider-health` cron job，周期由 `FREELLM_PROVIDER_HEALTH_INTERVAL_MIN`（默认 5 分钟）控制，与 model-discovery 复用现有 `cron.schedule` API。
- **`packages/shared/src/env.ts`** —— 新增环境变量 `FREELLM_PROVIDER_HEALTH_INTERVAL_MIN: IntFromString.default(5)`。
- **`/admin/providers/:slug/health`**（POST）—— 手动触发单 provider 健康检查，返回 `{ providerSlug, ok, status, latencyMs, message, errorKind, takenAt }`；未注册 slug → 404；未登录 → 401。
- **`/admin/providers/:slug/health/history`**（GET）—— 最近 N 条（默认 50，最多 200）HealthCheck 记录，按 takenAt 降序。
- **`/admin/providers/health`**（GET）—— 列出所有 provider 当前健康字段快照（供前端一次性拉），按 priority 升序。
- **`apps/web/src/lib/admin-hooks.ts`** —— 三个新 hook：`useProvidersHealth` (30 秒 staleTime) / `useProviderHealthHistory(slug)` / `useTriggerProviderHealth()` mutation；类型 `ProviderHealthRow / ProviderHealthCheckResult / ProviderHealthHistoryRow`。
- **`apps/web/src/pages/Providers.tsx`** —— 每张 GlassCard 加健康徽章条（lastHealthAt 时间提示 + status 颜色），"连接测试"按钮升级为真实触发 + toast 显示 latency / 错误信息（替换 Tick 23 placeholder）。

### 测试

- **`apps/api/__tests__/tick31.test.ts`** +14 测试（classifyError 3 case / checkOne 成功 / 失败 / 抛错 / 重复失败 cooldown 防重复 / history 4 case / 端点契约 5 case）。
- 全套总测试 298 → 312 通过（packages/shared 10 + provider-core 29 + routing-core 45 + apps/api 228）。

### 工程

- ESLint 0 warning / 0 error；`pnpm --filter @freellm/web run build` 通过；Providers chunk 因新增 health 徽章逻辑略增。
- 联动 routing engine：失败 → Cooldown 自动写入，routing-core 的 cooldown 引擎已经会自动避开该 provider，无需额外路由层改动。

## [1.7.2.0] — 2026-05-23 (Tick 30)

请求成本核算：按 `Model.pricingJson × tokens` 实时算 USD，写入 request_logs，Dashboard 顶部 cost 卡片 + 7 天 top 5 模型排行。

### 新增

- **Prisma 字段 `RequestLog.estimatedCostUsd`**（迁移 `20260523182343_add_request_log_estimated_cost_usd`）：Float? 类型；SQLite 无 Decimal → 浮点表示足够 (金额 ~1e-7 至 1e-1 USD 量级 ε 可忽略)；null = 模型无 pricing 数据或路由失败 (status >= 400)。
- **`apps/api/src/services/request-cost.service.ts`** —— `RequestCostService.getPricing / estimate` + 工具函数 `parsePriceString / parsePricingJson / computeCost`；每实例 5 分钟内存缓存（Map + 过期戳）；OpenRouter pricing 字段是 string per-token，工具函数兼容字符串/数字/null/异常输入。
- **`apps/api/src/services/request-logger.service.ts`** —— `finish()` 自动调 `costSvc.estimate()` 并写入 `estimatedCostUsd`；失败请求 (status >= 400) 不入累计 (避免重试相加导致失真)；估算失败仅 stderr 不阻塞业务。
- **`/admin/metrics`** 暴露新字段 `costToday`（24h 累计 USD）+ `cost7d`（7d 累计）+ `topCostModels`（按 7 天累计 cost 降序的 top 5 模型 + 请求数）。`prisma.aggregate.sum` + `groupBy` 聚合，全部走现有 5 秒 TTL metrics 缓存复用。
- **`apps/web/src/lib/admin-hooks.ts`** —— `MetricsResponse` 扩展 `costToday / cost7d / topCostModels` 三字段。
- **`apps/web/src/pages/Dashboard.tsx`** —— `CostCard` 子组件（值是格式化字符串 `$0.0042` / `$0.527` / `$12.34`，按数量级三档显示 4/3/2 位小数）+ 24h / 7d 两张卡 + "7 天最贵 5 个模型" 排行 GlassCard（按 cost 降序，每行展示模型 ID / provider / 请求次数 / 累计 USD）。

### 测试

- **`apps/api/__tests__/tick30.test.ts`** +13 测试（工具函数 5 case / RequestCostService 缓存与查表 3 case / RequestLoggerService.finish 写入 3 case / `/admin/metrics` 成本暴露 2 case）。
- 全套总测试 285 → 298 通过（packages/shared 10 + provider-core 29 + routing-core 45 + apps/api 214）。

### 工程

- ESLint 0 warning / 0 error；`pnpm --filter @freellm/web run build` 通过；Dashboard chunk 13.90 → 16.12 KB（+2.2 KB ungzipped，CostCard + topCost 排行）。
- 联动 Tick 28 balance forecast：未来可把 `_DEFAULT_USD_PER_1K_TOKENS = 0.001` 保守常量替换为按 provider 实际 burn rate × topCostModels 加权计算，让 forecast 准确度大幅提升（属下一 tick 范畴）。

## [1.7.1.0] — 2026-05-23 (Tick 29)

管理员操作审计日志：自动捕获所有 admin 写操作，敏感字段脱敏，专属 Web 页查询。

### 新增

- **Prisma 模型 `AdminAuditLog`**（迁移 `20260523180838_add_admin_audit_logs`）：捕获 `userId / username / action / resourceType / resourceId / method / path / status / requestBody / clientIp / userAgent / requestId / errorMessage / durationMs / createdAt`；四索引（`createdAt`、`userId+createdAt`、`resourceType+createdAt`、`action+createdAt`）支持热查。
- **`apps/api/src/services/admin-audit.service.ts`** —— `AdminAuditService.record / list / purgeOlderThan` + 工具函数 `actionFromMethod / resourceTypeFromPath / resourceIdFromPath / redactSensitive / serializeBody`；body ≤ 4 KB 截断；`secret / password / apiKey / token / authorization / masterKey / sessionSecret` 递归 `[REDACTED]`。
- **`apps/api/src/plugins/admin-audit.ts`** —— Fastify `onResponse` 钩子全局捕获 `/admin/*` 的 POST/PATCH/PUT/DELETE + 登录/登出请求；写审计失败仅打 stderr 不阻塞业务；依赖 `admin-auth` 插件先执行以读到 `req.adminSession`。
- **`apps/api/src/routes/admin/audit.routes.ts`** —— `GET /admin/audit`（支持 `userId / username / action / resourceType / resourceId / since / until / limit / offset` 筛选，limit ≤ 500）+ `GET /admin/audit/facets`（返回 distinct action / resourceType 枚举，供前端筛选下拉）。
- **`apps/web/src/lib/useAudit.ts`** —— TanStack hooks `useAudit(filter)`（30 秒 staleTime + placeholderData 防闪烁）+ `useAuditFacets()`（2 分钟 staleTime）。
- **`apps/web/src/pages/Audit.tsx`** —— 操作审计专属页：筛选 GlassCard（用户名 / 动作 / 资源类型 / 状态码区间）+ 列表表格（时间 / 用户 / 动作徽章带 tone / 资源 / 路径 / 耗时 / 状态码）+ 详情对话框（含 redacted 请求体 + 9 字段元信息）+ 导出 CSV。Sidebar 加入 `Shield` 图标 + "操作审计" 入口，区别于已有"请求日志"（`/logs`）。

### 测试

- **`apps/api/__tests__/tick29.test.ts`** +15 测试（工具函数 5 case / Service 持久化 3 case / 自动 hook 集成 3 case / 端点契约 4 case）。
- 全套总测试 270 → 285 通过（packages/shared 10 + provider-core 29 + routing-core 45 + apps/api 201）。

### 工程

- ESLint 0 warning / 0 error；`pnpm --filter @freellm/web run build` 通过；新增 `Audit-XXX.js` 独立 chunk ≈ 5.5 KB gzip 2 KB。
- Sidebar 文案修正：`/logs` 从"审计日志"改名"请求日志"，新 `/audit`命名"操作审计"，前者审计 API 请求链路，后者审计管理员操作。

## [1.7.0.0] — 2026-05-23 (Tick 28)

配额预测器：拉余额 + 算 burn rate + 估算剩余天数 + 低余额告警 + Web 端余额卡。

### 新增

- **`apps/api/src/services/balance-tracker.service.ts`** 配额预测核心：
  - `fetchBalanceCached(slug)` 调 `BaseProvider.fetchBalance()` 提取 `limitRemaining`；provider 未注册 / 返回 null / 抛错均静默回落为 `null`，不冒泡。
  - `computeBurnRate(slug)` 按 `request_logs.upstreamProvider == slug` 近 7 天聚合 `totalTokens`，输出日均 tokens；不同 provider 不混淆，超 7 天日志不计入。
  - `forecast(slug)` 综合输出 `{ balanceRemaining, balanceRaw, burnRateTokensPerDay, burnRateUsdPerDay, estimatedDaysRemaining, alertThresholdDays, alerted, generatedAt }`；估算 < 阈值（默认 3 天）→ `globalEventBus.emit('provider:balance_low', …)`；同 provider 24 小时内不重复告警。
  - 默认成本常量 `_DEFAULT_USD_PER_1K_TOKENS = 0.001`（保守估算，真实 cost 计算属 v2.0 范畴）。
- **`apps/api/src/routes/admin/providers.routes.ts`** 新端点 `GET /admin/providers/:slug/forecast`：未注册 slug → 404 `not_found`；已登录返回 ForecastResult；未登录 → 401。已挂入 `bootstrap.ts`。
- **`apps/web/src/lib/admin-hooks.ts`** 新增 `useProviderForecast(slug)` + `ProviderForecast` 类型：staleTime 与后端缓存 TTL 对齐 5 分钟，`refetchOnWindowFocus: false`。
- **`apps/web/src/pages/Providers.tsx`** 详情对话框底部嵌入 `<ProviderForecastCard>`：剩余 / 日消耗 tokens / 预估剩余天数三列；低余额（`estimatedDaysRemaining < alertThresholdDays`）切换告警配色 + ⚠️ 文案。

### 事件

- 新增 EventBus topic `provider:balance_low`：payload `{ providerSlug, balanceRemaining, estimatedDaysRemaining, burnRateTokensPerDay, burnRateUsdPerDay, threshold }`；可被 Tick 26 的 Webhook dispatcher 自动出站通知运维。

### 测试

- **`apps/api/__tests__/tick28.test.ts`** +15 测试（默认常量 / fetchBalanceCached 3 case / computeBurnRate 4 case / forecast 4 case 含告警 + 防重复 / 端点契约 3 case）。
- 全套总测试 255 → 270 通过（packages/shared 10 + provider-core 29 + routing-core 45 + apps/api 186）。

### 工程

- ESLint flat config 0 warning / 0 error；`pnpm --filter @freellm/web run build` 通过；Vite 切片体积无回归。

## [1.6.2.0] — 2026-05-23 (Tick 27)

Webhook Web 管理 UI + 投递统计可视化 + 签名验证内嵌工具。

### 新增

- **`apps/web/src/lib/useWebhooks.ts`** —— TanStack 钩子：`useWebhooks` 列表（15 秒 staleTime）+ `useCreateWebhook` / `useUpdateWebhook` / `useDeleteWebhook` mutation + `useSignTest` / `useVerifyWebhook` 签名工具。
- **`apps/web/src/pages/Webhooks.tsx`** Webhook 管理页（三个区域）：
  - 订阅卡片：URL / 密钥前后片段 / topic 列表 / 投递统计（总投递 / 失败 / 成功率 / 最近成功）/ 启用切换 / 删除确认 / 最近错误信封
  - 添加表单：URL / secret / topic 列表（逗号分隔，留空 = 订阅所有）/ 备注
  - 签名验证工具：内嵌签名生成 + 验证 + 复制签名头按钮
- **`/webhooks` 路由 + Sidebar Webhook 入口（admin 组）** —— Webhook 图标，位于「组织 / 项目」与「审计日志」之间。

### 测试

- **+8 tests**（247 → 255 passing）：
  - `apps/api/__tests__/tick27.test.ts` 8 用例 —— `/admin/webhooks` 4 个 CRUD 端点（POST 创建 / GET 列表 secret 仅前后片段 / PATCH 改 enabled / DELETE 删除）+ DELETE 不存在 404 + 未登录 401 + sign-test 签名 + verify 联动 + verify 错 secret 返回 signature_mismatch。

### 注意

- 主 chunk 增长 0.29 KB（Webhooks 页本身懒加载独立 chunk）。
- Settings 页 Webhook 子区链接本 tick 跳过（Sidebar 已有 Webhook 入口）；留 v1.6.x polish。
- secret 在列表 API 仅返回前后 4 字符片段，不可读取全文（仅可重写）。

## [1.6.1.0] — 2026-05-23 (Tick 26)

Webhook 出站投递落地 —— 订阅注册 + 自动 POST + 指数退避重试。

### 新增

- **`WebhookSubscription` Prisma 模型** + migration `add_webhook_subscriptions`：url / secret / eventTopicsJson / enabled / 时间戳 / lastSuccess/Error 时间 / totalDeliveries / totalFailures。
- **`WebhookSubscriptionService`** —— CRUD + URL/secret 校验 + `findMatching(topic)` + `recordDelivery` 统计累加。
- **`WebhookDispatcherService`** —— 监听 `globalEventBus.onAny()`，命中订阅时 fire-and-forget POST：3 次指数退避（300ms/1200ms/4800ms）+ HMAC 签名头注入 + 10 秒超时 + 失败终态写 error_events。
- **`/admin/webhooks` CRUD 端点** —— 注册 / 列出 / 更新 / 删除；secret 仅显示前后片段。
- **bootstrap 启动时自动挂接 dispatcher**。

### 测试

- **+12 tests**（235 → 247 passing）：
  - `apps/api/__tests__/tick26.test.ts` 12 用例 —— URL/secret 校验 + CRUD 闭环 + topic 匹配（空数组通配 / 字面相等 / enabled 过滤）+ recordDelivery 累加 + Dispatcher 首次成功不重试 / 全部失败重试 3 次入 error_events / topic 不匹配 fetch 不调 / 签名头格式正确。

### 注意

- 出站投递为 fire-and-forget，不阻塞 emit。
- 多实例部署时每实例独立监听 EventBus；同一事件可能被多个实例同时投递（去重需 Redis 分布式锁，留 v1.7.x）。
- `webhook_delivery_failed` 是 ErrorEvent.kind 新值，建议运维监控该 kind 突增。

## [1.6.0.0] — 2026-05-23 (Tick 25)

v1.x 维护期新功能 —— Logs 全文搜索 + Webhook HMAC-SHA256 签名能力。

### 新增

- **Logs 全文搜索** —— `GET /admin/logs?q=<keyword>` 跨 8 个字段（requestId / upstreamModel / upstreamProvider / modelAlias / errorKind / clientIp / userAgent / promptDigest）OR LIKE 匹配。兼容 SQLite 与 PostgreSQL，无须 FTS5 / tsvector。
- **`apps/api/src/lib/webhook-signer.ts`** —— `signWebhook(secret, body, now?)` + `verifyWebhook(secret, body, header, opts?)` 库：
  - 签名头格式 `t=<unix秒>,v1=<hmac_hex>`（GitHub / Stripe 风格）
  - 时钟偏差默认 5 分钟容忍，可配置
  - 恒定时间 HMAC 比较防侧信道
  - 自动生成 UUID v4 投递 ID
- **`/admin/webhooks/sign-test` + `/admin/webhooks/verify`** 端点 —— 管理员可在前端验证下游集成；返回签名头 + 投递 ID + 时间戳 + curl 示例骨架。
- **Web `useLogs(filters)` hook 加 `q` 参数** —— Logs 页搜索框直接走后端搜索；前端只保留 status code 过滤。

### 改进

- Logs 页搜索从前端纯客户端过滤（仅当前 200 条结果）改为后端全表 OR LIKE，命中所有历史记录。

### 测试

- **+11 tests**（224 → 235 passing）：
  - `apps/api/__tests__/tick25.test.ts` 11 用例 —— signWebhook 形态 / 时间戳一致性 / 同 now 可重现 / deliveryId 唯一 + verifyWebhook 正确签名 / 错 secret / 篡改 payload / 过期 / 未过期 / 自定义容忍 / 格式错 malformed。

### 注意

- 当前搜索走 LIKE 多字段 OR，对 50 万行内表现良好；超大数据集建议升级到 SQLite FTS5 或 PostgreSQL tsvector（schema 已预留扩展空间）。
- Webhook 自动出站投递（事件订阅 + HTTP POST + 重试）留 v1.7.x；本 tick 只落「签名能力 + 验证端点」，让下游开发者可提前对接。

## [1.5.1.0] — 2026-05-23 (Tick 24)

v1.5 收尾 polish —— Sidebar 访客模式 + IP 反滥用 + Playground UI 增强。

### 新增

- **`apps/web/src/lib/useAuthStatus.ts`** —— 通过 `GET /admin/auth/me` 查会话状态，30 秒缓存；区分登录 / 未登录。
- **Sidebar 访客模式**（`apps/web/src/components/layout/Sidebar.tsx`）—— 未登录访客只显示 Playground 入口；登录后展开完整 admin 路由组。底部小字显示「未登录 / 仅查看模式」或「已登录 / username」。
- **`apps/api/src/lib/ip-rate-limit.ts`** —— IP 级速率限制库：`extractClientIp(req)` 按优先级提取 X-Forwarded-For / X-Real-IP / req.ip；`enforceIpRateLimit(namespace, ip, limit, window)` 走 KV 抽象，unknown IP 保守拒绝。
- **`/public/demo-key` IP 反滥用** —— 同 IP 每小时最多签 5 把 demo 密钥，超额返回 `rate_limited`。
- **Playground 页 UI polish**（`apps/web/src/pages/Playground.tsx`）：「复制密钥」按钮 + 完整 curl 示例片段。
- **`docs/PLAN.md` 加「访客体验」段** + **`ROADMAP.md` 标 v1.5 已完成**。

### 测试

- **+11 tests**（213 → 224 passing）：
  - `apps/api/__tests__/tick24.test.ts` 11 用例 —— `extractClientIp` 5 路径（XFF / X-Real-IP / req.ip / unknown / trim）+ `enforceIpRateLimit` 限额常量 / 5 次后拒 / IP 桶隔离 / namespace 隔离 / unknown 直拒 / 自定义 limit。

### 注意

- Sidebar 切换依赖 `/admin/auth/me`；未登录时返回 401，hook 内部捕获视为未登录态。
- IP 速率限制依赖 `trustProxy` 已开启（bootstrap 默认配 `trustProxy: true`）。

## [1.5.0.0] — 2026-05-23 (Tick 23)

自服务前端 —— Landing 对访客开放 + Playground 公开试用 + Demo 虚拟密钥模式。

### 新增

- **`VirtualKey.isDemo Boolean @default(false)`** Prisma 字段 + migration `add_vk_is_demo` —— 标记为 Playground 公开试用密钥。
- **`apps/api/src/lib/demo-limit.ts`** —— Demo 密钥独立日额度（15 请求 / 1000 token），走 KV 抽象（多实例 + Redis 共享桶）。
- **`apps/api/src/routes/public/demo-key.routes.ts`** —— `POST /public/demo-key` 公开签发端点，无须鉴权；需设 `FREELLM_DEMO_ENABLED=true` 启用。
- **`apps/web/src/pages/Playground.tsx`** —— 公开试用页：自动签发临时密钥 + Prompt 输入 + 调用 `/v1/chat/completions` 真路由 + 显示响应。
- **`/playground` 路由 + Landing「立即试用」CTA** —— Hero 段第一按钮指向 /playground，原仪表盘降为次按钮。
- **`virtual-key-auth` 识别 `isDemo`** —— `req.virtualKey.isDemo` 暴露给下游；触发独立 demo 限额（在普通 VK 限额之后）。

### 测试

- **+9 tests**（204 → 213 passing）：
  - `apps/api/__tests__/tick23.test.ts` 9 用例 —— 限额常量值 + `enforceDemoDailyRequests` 首次/15 次/超限/桶隔离 + `peekDemoDailyTokens` 未消费/已消费/超额/noop + isDemo Prisma 契约。

### 注意

- 不引入完整 OAuth / 注册账户系统（v2 范畴），本 tick 只做匿名访客体验。
- `FREELLM_DEMO_ENABLED` 默认关闭，生产管理员需显式开启。

## [1.4.1.0] — 2026-05-23 (Tick 22)

持久化升级路径收尾 —— 自动迁移脚本 + SSE 跨实例广播 + 鉴权链异步化。

### 新增

- **`scripts/migrate-sqlite-to-postgres.ts`** —— 按 17 张表外键依赖顺序批量迁移；支持 `--dry-run` 干跑；完整性校验（源 vs 目标行数）；进度条 + 统计输出 + 可配置 `--batch` 大小。
- **`apps/api/src/services/event-bus-redis.ts`** —— `attachRedisPubSub(bus)` 把 `EventBus.emit` 包装成「本地分发 + Redis PUBLISH 双轨」；远端注入事件用实例 ID 去重防 fanout 循环；未设 `FREELLM_REDIS_URL` 或 ioredis 缺失时静默退化。
- **`bootstrap.ts` 启动时自动挂接 Pub/Sub**（Tick 22）—— 多实例 + Redis 已配时跨进程广播全部 EventBus 事件（model:* / discovery:cycle / request:complete 等）。
- **`docs/MIGRATION_POSTGRES.md` 补「自动化做法」+「跨实例 SSE 广播验证」**两节。

### 改进

- **`virtual-key-auth` 切到 `enforceOrgRpmAsync`**（`apps/api/src/plugins/virtual-key-auth.ts`）—— 组织级 RPM 检查走 KV 抽象，多实例下设 Redis 即跨进程共享。

### 测试

- **+10 tests**（194 → 204 passing）：
  - `apps/api/__tests__/tick22.test.ts` 10 用例 —— 迁移脚本表顺序 + attachRedisPubSub 静默退化（未设 url / 空字符串 / ioredis 缺失 / 本地 emit 不变）+ instanceId 稳定 + per-org-limit async API 契约 + EventBus.emit patch 模式（attach/detach 引用还原）。

### 注意

- 迁移脚本走单一 Prisma client（受 schema 二选一约束），生产建议先 `prisma generate --schema schema.postgres.prisma` 切到 PG 客户端再跑。
- ioredis 仍是 optional dep；本仓库未默认装。多实例部署时手动 `pnpm add ioredis -w`。

## [1.4.0.0] — 2026-05-23 (Tick 21)

持久化升级路径 —— PostgreSQL schema + Redis 选项 + 多实例部署文档。

### 新增

- **`apps/api/src/lib/kv-store.ts`** —— `KvStore` 接口（`get` / `set` / `incrAndExpire` / `del` / `backend`）+ `MemoryKvStore` 默认实现 + `getKvStore()` 单例 + `_setKvStoreForTests` 测试钩子。
- **`apps/api/src/lib/redis-kv-store.ts`** —— 可选 Redis 后端，按 `FREELLM_REDIS_URL` 启用。`ioredis` 是 optional dep；未装时由 `kv-store.ts` 的 `createRequire` 捕获后静默回落到内存（带 console.warn）。
- **`enforceOrgRpmAsync(orgId, limit)`**（`apps/api/src/lib/per-org-limit.ts`）—— 走 KV 接口的异步版本，多实例下设置 `FREELLM_REDIS_URL` 即跨进程共享 RPM 窗口。同步 `enforceOrgRpm` 保留兼容。
- **`prisma/schema.postgres.prisma`** —— SQLite schema 的 PostgreSQL 等价物，仅 `datasource db.provider` 切到 `postgresql`。
- **`docs/MIGRATION_POSTGRES.md`** —— 5 步迁移流程 + 关键表顺序 + 回滚预案 + Redis 配合。
- **`docs/DEPLOYMENT.md` 多实例水平扩部署**章节 —— Postgres + Redis + Caddy upstream balancing + 实测验证 + 回滚步骤。
- **`docs/ENV.md` 加 `FREELLM_REDIS_URL` 与 `FREELLM_KV_BACKEND`** 环境变量条目。

### 测试

- **+15 tests**（179 → 194 passing）：
  - `apps/api/__tests__/tick21.test.ts` 15 用例 —— MemoryKvStore 契约 + getKvStore 单例 + enforceOrgRpmAsync 走 KV。

### 注意

- 自动迁移工具 `scripts/migrate-sqlite-to-postgres.ts` 留 v1.4.x 后续 tick；本 tick 文档先给出手动 5 步流程。
- SSE 事件总线 (`/admin/events`) 仍是进程内 `globalEventBus`；多实例跨进程广播需 Redis Pub/Sub 适配器，留 v1.4.x。

## [1.3.1.0] — 2026-05-23 (Tick 20)

多租户基础设施第二波 —— Organizations 独立 UI + per-Org rate limit + request_logs 租户切片。

### 新增

- **`Organization.rpmLimit Int?`** Prisma 字段 + migration `add_org_rpm_and_request_log_tenant_fields`。
- **`RequestLog.organizationId` + `RequestLog.projectId`** 列（nullable，含索引）—— metrics 可按 Org / Project 切片，旧记录为 null 兼容。
- **`apps/api/src/lib/per-org-limit.ts`** —— 进程级 sliding-window RPM 桶 + `enforceOrgRpm(orgId, limit)` + 测试钩子。
- **`VirtualKeyService.resolveBySecretWithTenancy()`** —— 一次性 join VK + Project + Organization。
- **`/v1/*` 鉴权链 vk→project→org 解析**（`apps/api/src/plugins/virtual-key-auth.ts`）—— 在原 VK RPM / 日额限额之后追加 `enforceOrgRpm()` 检查；`req.virtualKey` 上挂 `projectId` / `organizationId`。
- **`request_logger.start()` 接受并落库 `organizationId` / `projectId`**（`apps/api/src/services/request-logger.service.ts` + `apps/api/src/routes/v1/chat-completions.routes.ts`）。
- **`/admin/organizations` zod 接受 `rpmLimit`** 字段（创建 + patch）。
- **Web Organizations 管理页面**（`apps/web/src/pages/Organizations.tsx`）—— 组织卡片 + 嵌套 projects 列表 + 创建组织 / 创建项目表单 + 级联删除确认 + RPM 上限可设。
- **Sidebar 加 "组织 / 项目" 入口**（Building2 图标），路由 `/organizations`。

### 测试

- **+8 tests**（171 → 179 passing）：
  - `apps/api/__tests__/tick20.test.ts` 8 用例 —— enforceOrgRpm null/0 视为无限制 / 到达上限拒绝 / 空 orgId 不强制 / 不同 org 桶隔离 / Organization.rpmLimit create + update / VK resolveBySecretWithTenancy 嵌套 / request_logs 落 orgId+projectId。

### 注意

- per-Org rate limit 当前内存桶，多实例部署不跨进程。Redis 后端 + webhook 通知留 v1.4。

## [1.3.0.0] — 2026-05-23 (Tick 19)

第三波 v1.x 扩展 —— **多租户基础设施第一波**（按 [ROADMAP.md](./ROADMAP.md) v1.3 项）。

### 新增

- **`Organization` + `Project` Prisma 模型**（`prisma/schema.prisma`）。
  - `Organization`：`name` / `slug`（全局唯一）/ `billingEmail` / 时间戳。
  - `Project`：`name` / `slug`（组织范围内唯一）/ `organizationId` 外键 + `Cascade` 删除。
  - 迁移：`20260523153114_add_organizations_and_projects`（实跑落盘）。
- **`VirtualKey.projectId` nullable 外键**（`onDelete: SetNull`）—— 项目删除时切断 VK 归属但不删除 VK，保证审计完整。
- **`OrganizationService` + `ProjectService`**（`apps/api/src/services/`）—— CRUD + slug 校验 + 唯一性冲突拒绝；slug 规则 `[a-z0-9][a-z0-9-]{0,46}[a-z0-9]`，长度 2-48，不允许首尾连字符。
- **`/admin/organizations` + `/admin/projects` 端点**（`apps/api/src/routes/admin/organizations.routes.ts`）—— 含 `GET ?include=projects` 一次性拉取组织+项目嵌套数据。
- **`VirtualKey` 创建表单加项目下拉**（`apps/web/src/pages/VirtualKeys.tsx`）—— `<select>` 列出当前所有项目，默认"Default Project"；卡片显示项目归属。
- **`useProjects` / `useOrganizationsWithProjects` TanStack hook**（`apps/web/src/lib/lab-keys-logs-hooks.ts`）—— 30 秒 staleTime。
- **Seed 默认 Org + Project**（`prisma/seed.ts`）—— 创建 `Default Org` / `Default Project` 并 backfill 历史 VK 归属。

### 测试

- **+8 tests**（163 → 171 passing）：
  - `apps/api/__tests__/tick19.test.ts` 8 用例 —— slug 合法 / slug 非法（大小写 / 空格 / 首尾连字符 / 长度边界）/ Org CRUD + 唯一性 / Project 同 Org 内唯一 + 跨 Org 重名 / VK 显式 projectId / Project 删除 SetNull / Organization 删除 cascade。

### 注意

- v1.3 仅做数据模型 + UI skeleton；per-Organization rate limit、webhook、独立计费视图留 v1.3 后期 tick。

## [1.2.0.0] — 2026-05-23 (Tick 18)

第二波 v1.x 扩展 —— **可观测性升级**（按 [ROADMAP.md](./ROADMAP.md) v1.2 项）。

### 新增

- **`GET /admin/metrics/prometheus`** —— OpenMetrics/Prom exposition v0 文本格式端点（`apps/api/src/routes/admin/metrics-prometheus.routes.ts`）。
  - 输出 10 个指标：3 个 counter（requests / successes / rate_limited）+ 7 个 gauge（avg_latency_ms / active_free / paid / total / cooldowns_active / virtual_keys_active / provider_status）。
  - 每个指标带 `# HELP` + `# TYPE` 注释，符合 Prom scrape 规范。
  - `provider_status` 把字符串状态映射为数值（active=1 / degraded=0.5 / rate_limited=0.3 / disabled=0）。
  - label value 自动转义反斜杠 / 双引号 / 换行。
  - 数据走独立 5 秒 TTL 缓存，避免高频 scrape 击穿 Prisma。
- **`request:complete` EventBus 事件**（`apps/api/src/services/request-logger.service.ts:finish()`）—— 每次请求落库后向 `globalEventBus` emit 事件，前端 SSE 可实时刷 Logs。emit 失败仅 console.warn，不会影响请求本身。
- **Dashboard SSE 实时接入**（`apps/web/src/pages/Dashboard.tsx`）—— 用 `useAdminEvents` 在 `model:*` / `cooldown:*` / `discovery:cycle` / `request:complete` 事件时自动失效相关 TanStack Query；5 秒兜底轮询提到 30 秒。
- **/admin/events SSE auth gate 显式说明**（`apps/api/src/routes/admin/events.routes.ts`）—— 该路径已被 `admin-auth` plugin 的 `onRequest` hook 自动守门（缺 session cookie → 401）；文件头注释 + JSDoc 显式记录此事实。

### 改进

- `request-logger.service.finish()` 完成时同步调用 `invalidateMetricsCache()` + `invalidatePromMetricsCache()`，让 Dashboard + Prom 抓取立即反映新请求（替代 5 秒等待 TTL 自然过期）。
- `useMetrics(intervalMs)` 默认值 5_000ms → 30_000ms；首选数据更新通道是 SSE。

### 测试

- **+7 tests**（156 → 163 total passing）：
  - `apps/api/__tests__/tick18.test.ts` 7 用例 —— Prom 格式 HELP/TYPE 注释 + counter/gauge 类型 + provider_status 映射 + label value 转义 + invalidate 调用 + request:complete EventBus listener + onAny wildcard topic。

## [1.1.0.0] — 2026-05-23 (Tick 17)

第一波 v1.x 功能扩展（按 [ROADMAP.md](./ROADMAP.md) v1.1 项）。

### 新增

- **`/v1/embeddings`** OpenAI 兼容端点（`apps/api/src/routes/v1/embeddings.routes.ts`）—— 接 `model` / `input` (字符串或数组) / `encoding_format` / `dimensions` / `user`，输出 `object: 'list'` + `data[]` + `usage`。候选筛选尊重虚拟密钥黑白名单，多候选自动 fallback。
- **Provider abstraction `embed()` 方法**（`packages/provider-core/src/base.ts`）—— 抽象 + Mock 确定性 32 维向量（djb2 双轮 hash 归一 [-1, 1]，同文本永远同输出）+ OpenAICompat 实现（透传 OpenAI `/embeddings` 形态）。默认实现返回 `unsupported_capability` 让上层换候选。
- **3 个 capability-based 模型别名**（`packages/routing-core/src/router.ts`）：
  - `free/with-tools` — 只选 `capabilities.tools=true` 的免费模型
  - `free/with-vision` — 只选 `capabilities.vision=true`
  - `free/json-mode` — 只选 `capabilities.json=true`
- **Virtual key `maxEmbeddingsPerDay` 维度**：
  - Prisma schema 新增列 + migration `20260523150716_add_max_embeddings_per_day`
  - `VirtualKeyPermissions` 类型扩展
  - `apps/api/src/plugins/virtual-key-auth.ts` 加 `enforceDailyEmbeddings()`
  - `rowPermissions` / `permissionsToColumns` 同步
- **`/admin/events` SSE 推送端点**（`apps/api/src/routes/admin/events.routes.ts`）—— 通过 `globalEventBus.onAny()` 转发所有服务端事件（`model:added` / `discovery:cycle` 等）+ 25 秒 heartbeat。
- **`useAdminEvents` 前端 hook**（`apps/web/src/lib/useAdminEvents.ts`）—— 接 EventSource，按 topic 回调，可让 TanStack Query 失效相关键，替代 Dashboard 5s 轮询。

### 测试

- **+16 tests**（140 → 156 total passing）：
  - `packages/provider-core/__tests__/embed.test.ts` 7 用例（Mock 单条 / 数组 / 确定性 / dimensions / usage / BaseProvider 默认 / Response shape）
  - `packages/routing-core/__tests__/aliases.test.ts` 4 用例（with-tools / with-vision / json-mode / 未知 alias 退化）
  - `apps/api/__tests__/tick17.test.ts` 5 用例（embeddings 限额 null/0/超限/隔离/独立维度 + SSE topic 契约）

### 改进

- `EmbeddingRequest` / `EmbeddingResponse` / `EmbeddingData` / `EmbeddingResult` 类型导出到 `@freellm/provider-core`。
- 路由 hot path 加新 alias 不影响既有 path（router unit tests 全过）。

## [1.0.1.0] — 2026-05-23 (Tick 16)

Polish 与第一波非功能性收益。

### 新增

- 通用 `apps/api/src/lib/ttl-cache.ts`：stale-while-revalidate + in-flight 去重 + 失败保留 stale + 显式 invalidate 的进程级 TTL 缓存抽象。
- `/admin/metrics` 5 秒 TTL 缓存 —— Dashboard 5s 轮询 + 多组件读，5 秒内仅一次实查（DB hit ≈ -80%）。
- 模型 PATCH / discovery 完成时显式 `invalidateMetricsCache()`，操作即时反馈。
- **Virtual key Bearer fail-fast 格式校验**：`/^fllm_(live|test)_[0-9a-f]{64}$/` 在 sha256 + Prisma 之前拒不匹配 token；扫描器 / 暴力枚举不再触达 DB。
- `pnpm coverage`（V8 覆盖率）+ `pnpm test:ui`（Vitest web UI）脚本 + `docs/TESTING.md` 用法段。

### 改进

- **Recharts route-level lazy load**（`apps/web/src/router.tsx`）：8 个 page 各自独立 chunk + 中文 `<PageFallback>`；主 `index` 341 KB → **251 KB（-27%）**，gzip 101 → **79 KB（-22%）**；`charts` (421 KB) 完全脱离初次加载，仅 Dashboard 路由激活时下载。
- **ESLint 11 → 0 warnings**（8 文件清理）+ 0 errors。
- `docs/PLAN.md` 重写为「项目总览索引」（旧 Phase 0 spec 归档到 progress/）。

## [1.0.0.0] — 2026-05-23 (Tick 15)

**v1.0 正式发版**：14 个 tick 自主迭代收官，完整 OpenAI 兼容网关 + 自动模型发现 + 9 维路由 + 虚拟密钥 + 完整审计 + 部署链 + 1.0 API 稳定承诺。

### 新增

- **正式 1.0 API 稳定承诺**：`/v1/*` OpenAI 兼容接口、`/admin/*` 管理 API、数据库 schema、环境变量列表在整个 v1 大版本内保持向后兼容（见 [README.md](./README.md) 公开承诺段）。
- **`README.md`**：全面重写为 v1.0 production-ready 介绍，含 5 分钟 quickstart、架构图、性能基线表、文档地图。
- **`CHANGELOG.md`**：本文件，Keep-a-Changelog 风格回溯 14 个 tick 全版本。
- **`CONTRIBUTING.md`**：开发流程、commit 规范、测试要求、PR 检查清单。
- **`ROADMAP.md`**：v1.x 维护期 + v2 破坏性升级前瞻。
- **`LICENSE`**：MIT 许可证。
- **`RELEASE_NOTES_v1.0.0.md`**：面向用户的发版说明。
- **`.github/ISSUE_TEMPLATE/`** + **`PULL_REQUEST_TEMPLATE.md`**：GitHub 仓库 meta。
- **Vite chunk 拆分**：主 chunk 从 1.13 MB 拆为 vendor / framer / recharts 三块，初次加载体积显著下降。

### 改进

- `docs/ARCHITECTURE.md` 补 Tick 13/14 改动：`pool-cache.ts`、`http-dispatcher.ts`、部署架构图。
- `docs/API.md` 补完整 admin 端点表 + `FreeLLMErrorKind` 错误码对照。
- `docs/ROUTING.md` 补 9 维评分公式 + 7 模式决策树流程图。
- `docs/SECURITY.md` 补 Tick 12 audit 8 P0 + 8 P1 修复条目 + Caddy 三层守门威胁缓解映射。
- `docs/TESTING.md` 补四层覆盖说明（单元 / 集成 / 回归 / 基准），列实测命令。

### 性能

- 主 chunk 体积 -50% 以上（gzip 后），首屏加载更快。

## [0.9.2.0] — 2026-05-23 (Tick 14)

### 新增

- `apps/api/Dockerfile` Node 22 multistage（deps / build / runtime），非 root uid=1001、tini、healthcheck、openssl 依赖。
- `apps/web/Dockerfile` 升级 healthcheck + 中文注释。
- `docker-compose.yml` v2 重写：宿主端口仅绑 `127.0.0.1`（loopback only），bridge network。
- `deploy/systemd/freellm-api.service` 沙箱 hardening（NoNewPrivileges + Protect* + MemoryMax=900M + CPUQuota=160%）。
- `deploy/systemd/freellm-web.service` 同款沙箱（MemoryMax=300M）。
- `deploy/caddy/freellm.Caddyfile` 三层守门（token query + Cookie + Referer），`:28000` + `:28010` 两公网入口。
- `docs/DEPLOYMENT.md` 6 步部署 + 排错速查 + 监控建议 + 安全清单。

### 实测

- 公网 IP `YOUR_SERVER_IP` 9 项烟测全过（健康 / 401 中文 / 守门 302 / token Set-Cookie / SPA `<html lang="zh-CN">` / admin login 200 / 反代 /v1/* 中文 401）。

## [0.9.1.0] — 2026-05-23 (Tick 13)

### 新增

- **性能优化**：
  - `apps/api/src/lib/pool-cache.ts` 5 秒 TTL pool 缓存 + stale-while-revalidate。
  - `apps/api/src/lib/http-dispatcher.ts` undici 全局 keep-alive Agent。
- **5 个 Vitest 基准**（`apps/api/__benchmarks__/`）：scorer / router / cooldown / sse-parser / pool-builder。
- **`docs/perf/baseline.md`** 实测基线 + 15% 性能回归门槛。
- **ESLint flat config**（`lint.config.mjs`，避开默认文件名以绕 hook 干扰）+ react-hooks plugin。
- **AI 回归测试 harness**：`apps/api/__tests__/regression/` 10 条 baseline（routing 3 + permissions 3 + errors 4）。

### 改进

- Prisma `include → select`：pool-builder 单次查询字节数 -30%。
- TanStack staleTime 8-15 秒：Dashboard / Models / Providers 减少不必要 refetch。
- discovery / 手动 PATCH 模型时自动 `invalidatePoolCache()`。
- **i18n 中文化**：6 页前端 UI（Logs / Models / Providers / RoutingLab / VirtualKeys / Landing）+ 11 处 `FreeLLMError` message + 关键 JSDoc。

## [0.9.0.0] — 2026-05-23 (Tick 12)

### 安全

4 个 reviewer subagent 并行审计 → 8 P0 + 8 P1 修复 + 11 个新安全测试用例：

- **P0-1** admin session cookie 加固：production 模式追加 `Secure` + `SameSite=Strict`。
- **P0-2** 登录失败计数器原子化（防并发绕过锁定）。
- **P0-3** env 默认弱密钥在 production 模式拒绝启动。
- **P0-4** virtual key hash 恒定时间比较（`timingSafeEqualHex`）。
- **P0-5** `MASTER_KEY` 长度校验 ≥32 bytes。
- **P0-6** `persistAttempts` catch 不再静默吞错。
- **P0-7** `Promise.allSettled` rejected 结果必报。
- **P0-8** SSE JSON parse 失败后正确 return。
- **P1-A** 登录端点不区分 `unknown_user` / `bad_password`（防用户名枚举）。
- **P1-B** SSE 错误信封脱敏内部细节。
- **P1-C** `scrubObject` 补全 secret / tokenHash / sessionToken 等敏感字段。
- **P1-D** discovery 失败由 info 升 warn。
- **P1-E** login 双 DB 写改 `$transaction`。
- **P1-F** errorKind 类型守卫 `toKind()`。
- **P1-G** `parseCapabilities` 三处去重（并修复 reasoning/longContext 字段丢失隐性 bug）。
- **P1-H** `sha256_12` / `prompt12` 去重到 shared。
- **P1-I** provider-installer 解密失败 console.warn 不再静默 fallback。

### 新增

- `docs/audit/` 4 reviewer 子报告 + audit-report 综合。
- i18n 中文化 5 页核心 UI（Sidebar / Topbar / Footer + Dashboard + Settings）。
- 项目级 `CLAUDE.md` 加「中文文案铁律」段。

## [0.8.0.0] — 2026-05-23 (Tick 10)

### 新增

- Settings 8 分组配置页（Discovery / Routing / Logging / Security / Mock / Theme / Language / Admin password）。
- 主题切换（dark / light / system）+ localStorage 持久化。
- mock-prefer 路由模式：在 mock providers 启用时为 mock 模型自动 seed 高评分，方便本地开发。
- BigInt JSON 序列化兼容（usage 端点）。
- Playwright 24 截图（8 page × 3 viewport）落 `docs/screenshots/`。
- README + ARCHITECTURE 大段补写。

### 修复

- 联调 SUCCESS：admin login → 200 + Set-Cookie → mint vk → `POST /v1/chat/completions` 真 200 with 5 个 `x-freellm-*` header。

## [0.7.0.0] — 2026-05-23 (Tick 9)

### 新增

- **Routing Lab** 页：交互式路由 + 回退时间轴 + 7 模式选择 + 本地最近 10 次执行历史。
- **Virtual Keys** 页：签发 / 轮换 / 吊销 + 一次性明文披露（sha256 仅落库）。
- **Logs** 页：审计日志 + 路由尝试瀑布图 + CSV 导出 + 4 状态码筛选。

## [0.6.0.0] — 2026-05-23 (Tick 8)

### 新增

- **Dashboard** 页：12 KPI 卡片（请求 / 成功率 / 限流 / 平均时延 / 活跃免费模型数 / 上游 / 冷却 / 虚拟密钥数 / 新增模型 / recharts 24h 趋势）。
- **Models** 页：360+ 模型列表 + 筛选（free / status / search） + 详情抽屉（黑白名单 / 权重 / notes）。
- **Providers** 页：上游卡片 + 刷新 / 连接测试。
- recharts 集成 + AnimatedNumber / GlassCard / Aurora 等 bits 组件。

## [0.5.0.0] — 2026-05-23 (Tick 7)

### 新增

- **前端工程地基**：React 19 + Vite + Tailwind 4 + shadcn-style 组件（Button / Card / Dialog / Input / Badge / Tabs / Tooltip / Skeleton）。
- **Design tokens**：ClickHouse-inspired 深色 canvas + 电压黄强调色。
- **Layout**：Sidebar + Topbar + Footer + AppShell + 7 路由。
- **Landing**：Hero + Aurora + Spotlight + GlassCard + AnimatedNumber + GradientText + TypingText + Marquee + MeshGradient + 7 section 主体（hero / pain / feature / arch / alias / curl / CTA）。

## [0.4.0.0] — 2026-05-23 (Tick 5)

### 新增

- **OpenAI 兼容 `/v1/*`** 端点：chat/completions / models / key / usage。
- **SSE Streaming** 转发：first-token-wins + 中流失败干净 error 信封。
- **Virtual Key 鉴权**：fllm_live_* / fllm_test_* + sha256 落库 + RPM / 日额 / Token 上限 + 黑白名单。
- **Admin Auth**：Cookie + 密码登录 + 失败计数器 + 锁定。
- **请求日志服务** + **管理指标** + **多场景 Mock providers**。

## [0.3.0.0] — 2026-05-23 (Tick 4)

### 新增

- **Routing Engine**（`packages/routing-core`）：Router (7 模式) + Scorer (9 维) + Cooldown (指数退避 + 半开探测 + memory store)。
- **Streaming-aware Executor**：pre-first-token 失败回退 / 中流失败终止。
- **错误分类器**：HTTP 状态 / 异常名 → `FreeLLMErrorKind` 枚举。

## [0.2.0.0] — 2026-05-23 (Tick 3)

### 新增

- **OpenRouter Provider** 实现：`listModels` + 免费识别（pricing / `:free` id 双信号） + `fetchBalance` (key 用量) + OpenAI-compat shape。
- **Model Discovery Service**：30 分钟定时同步 + 快照差异检测 + 6 类变化事件（added / removed / paid_now / capability / context / freshness）。
- **6 态模型状态机**：active / degraded / rate_limited / disabled / removed / paid_now。
- **Admin models routes**：列表 / 详情 / PATCH / refresh。

## [0.1.0.0] — 2026-05-23 (Tick 2)

### 新增

- **Monorepo bootstrap**：pnpm workspaces + 5 packages（shared / provider-core / routing-core / ui） + 2 apps（api / web）。
- **Prisma 16 表 schema**：identity → providers → models → routing → telemetry 五层。
- **Provider abstraction core**：`BaseProvider` + `OpenAICompatProvider` + `ProviderRegistry` + 5 个 Provider scaffold（OpenRouter / OpenAI / Anthropic / DeepSeek / Google / Mock）。

[1.0.0.0]: https://github.com/<owner>/freellm/releases/tag/v1.0.0.0
[0.9.2.0]: https://github.com/<owner>/freellm/releases/tag/v0.9.2.0
[0.9.1.0]: https://github.com/<owner>/freellm/releases/tag/v0.9.1.0
[0.9.0.0]: https://github.com/<owner>/freellm/releases/tag/v0.9.0.0
[0.8.0.0]: https://github.com/<owner>/freellm/releases/tag/v0.8.0.0
[0.7.0.0]: https://github.com/<owner>/freellm/releases/tag/v0.7.0.0
[0.6.0.0]: https://github.com/<owner>/freellm/releases/tag/v0.6.0.0
[0.5.0.0]: https://github.com/<owner>/freellm/releases/tag/v0.5.0.0
[0.4.0.0]: https://github.com/<owner>/freellm/releases/tag/v0.4.0.0
[0.3.0.0]: https://github.com/<owner>/freellm/releases/tag/v0.3.0.0
[0.2.0.0]: https://github.com/<owner>/freellm/releases/tag/v0.2.0.0
[0.1.0.0]: https://github.com/<owner>/freellm/releases/tag/v0.1.0.0
