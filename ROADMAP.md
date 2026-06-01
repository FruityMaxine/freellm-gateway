# Roadmap

> v1.0.0.0 已发版。本文档列 v1.x 维护期 + v2 重大升级的方向。
> 任何破坏性变更**至少提前一个 v1.x 小版本**通告在本文。

## v1.x 维护期（向后兼容增量）

### v1.1 — 客户端能力扩展

- `/v1/embeddings` 端点（OpenAI 兼容）+ 4 个上游 + Mock。
- `/v1/responses` 端点（OpenAI Responses API，含 tool_calls / multi-turn state）。
- 模型别名扩展：`free/with-tools` / `free/with-vision` / `free/json-mode`。
- Virtual key 增维度：`maxEmbeddingsPerDay` / `maxImageInputsPerDay`。

### v1.2 — 可观测性升级

- Prometheus exporter（`/admin/metrics/prometheus`）。
- 全请求 OpenTelemetry trace 注入（可选 export 到 OTLP）。
- Sentry 集成（可选 `FREELLM_SENTRY_DSN`）。
- Web 端实时 SSE 推送 dashboard 更新（替代 5 秒轮询）。

### v1.3 — 多租户与组织维度

- `Organization` / `Project` 数据模型（schema 已预留迁移空间）。
- 虚拟密钥归属到 Project；Project 归属到 Organization。
- 每 Organization 独立限额池 + 独立 webhook 通知配置。
- Admin UI 增「组织」与「项目」两层导航。

### v1.4 — 持久化升级路径

- 提供 `pnpm prisma:migrate:postgres` 一键迁移 SQLite → PostgreSQL（脚本 + 数据迁移工具）。
- Redis 可选作为 rate-limit 与 cooldown 共享存储（多实例部署必备）。
- ClickHouse 可选作为 request_logs / route_attempts 长期存储（高吞吐场景）。

### v1.5 — 自服务前端 ✅ 已完成（Tick 23-24）

- ✅ Landing 页对未登录访客开放（替代当前默认跳 admin）—— Tick 23 v1.5.0.0 落地。
- ✅ 公开 「Playground」 路由：访客可用 demo 虚拟密钥试用（额度受限）—— Tick 23。
- ✅ Sidebar 访客模式 + 「未登录 / 仅查看模式」提示 —— Tick 24 v1.5.1.0。
- ✅ Playground UI polish（复制密钥 + curl 示例）+ IP 级反滥用（5 次 / 小时） —— Tick 24。
- ⏳ 自动从 GitHub Marketplace 安装 / 升级 FreeLLM 的 deploy bundle —— 留 v1.5.x 后续 tick。

## v2.0 候选（破坏性变更，至少 v1.5 时通告）

> 以下是候选清单，**未承诺**全部进 v2.0。会在 v1.5 发版时定稿。

- **数据库 schema 重构**：拆分 `request_logs` 到时序表（PostgreSQL TimescaleDB 或 ClickHouse 原生）。
- **Provider abstraction v2**：抽离 capability discovery 接口；moves 当前 `OpenAICompatProvider` 的 OpenAI Chat 形态假设到 adapter 层。
- **错误码体系重构**：`FreeLLMErrorKind` 可能新增分类、个别现有 kind 可能合并（v1.5 时给完整 deprecation 表）。
- **配置体系重写**：`.env` 改为分层 YAML（`config.yaml` + `config.local.yaml`），支持 env 覆盖。
- **管理 UI 重构**：基于新的 Web Components 框架替代 React（待定，可能保留 React）。
- **路由策略 DSL**：允许操作员通过 YAML 写自定义路由规则（替代当前硬编码 7 种模式）。

## 不会做的事

明确**不在本项目 scope** 内的方向：

- 任何形式的**上游平台限额绕过 / 风控对抗 / 付费规则规避** — 项目定位是合理多 provider 网关，不是 anti-abuse 工具（详见 [README](./README.md) 合规边界段）。
- **托管服务（SaaS）** — FreeLLM 永远只发布自托管版本；商业托管由社区或第三方提供。
- **代理付费转免费的「中转商」业务** — 这超出网关角色，且违反上游 ToS。

## 已确认的非 goal

- **微服务拆分** — 单体 Fastify + Prisma 在可预见的负载下完全够用，拆分只会增加维护成本。
- **完全无状态** — 路由评分 / 冷却状态需要持久化；Redis-only 不替代 SQLite/PostgreSQL。
- **GraphQL** — REST + OpenAI 形态契合下游既有 SDK，GraphQL 收益不显著。

## 反馈渠道

- GitHub Issues：功能请求 / Bug
- GitHub Discussions：架构 / 路线图讨论
- Email `<roadmap@...>`：商业级合作 / Roadmap 优先级 lobbying

每个 v1.x 发版后，本文档会刷新；v2.0 启动时本文档会移到 `ROADMAP_v2.md` 并锁定 v1.x 部分作为归档。
