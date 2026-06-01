# FreeLLM v1.0.0.0 发版说明

**发布日期**：2026-05-23

经过 14 个 `/betterloop` 自主迭代 tick，FreeLLM 进入 **1.0 生产可用**阶段。

## 一句话总结

> 一个 base URL、一把虚拟密钥，FreeLLM 自动管 OpenRouter 免费模型池、按 9 维评分智能路由、在 429/5xx/超时时自动回退，下游应用永不接触真实上游 key。

## 核心能力

| 能力 | 说明 |
|---|---|
| **OpenAI 兼容 API** | `/v1/chat/completions` + `/v1/models` + `/v1/key` + `/v1/usage`，所有主流 OpenAI SDK 直接用 |
| **自动模型发现** | 每 30 分钟同步 OpenRouter，免费 / 付费自动分类，下线 / 转付费 / 能力变化自动报警 |
| **9 维评分路由** | 可用性 / 时延 / 限流 / 质量 / 上下文 / 新鲜度 / 成本 / 稳定性 / 首 Token —— 加权综合分排序 |
| **7 种路由模式** | auto-best-free / round-robin / weighted / openrouter-pass-through / prefer-fallback / provider-pin / paid-allowed |
| **指数退避冷却** | 模型 + 上游分别独立冷却，半开探测，一键手动恢复 |
| **流式感知回退** | 首 token 前失败自动切候选；中流失败干净 SSE error 信封收尾 |
| **虚拟密钥** | fllm_live_* / fllm_test_*，sha256 落库，RPM / 日额 / Token 上限 / 黑白名单 / 轮换 / 吊销 |
| **完整审计** | 每请求 `route_attempts` 瀑布图 + 12 KPI Dashboard + CSV 导出 |
| **生产级安全** | Cookie `Secure + SameSite=Strict` / 恒定时间 hash 比较 / env 弱密钥拒绝 / 三层 Caddy 守门 |
| **现代前端** | React 19 + Vite + Tailwind 4，8 页完整 UI，shadcn-风组件 + Framer Motion 动效 |

## v1.0 API 稳定承诺

从本版本起：

- `/v1/*` OpenAI 兼容接口在整个 v1 大版本内保持稳定。
- `/admin/*` 管理 API 在 v1 内向后兼容（追加新字段允许，删除 / 改语义不允许）。
- 数据库 schema 仅追加迁移，不破坏。
- 环境变量列表（详见 [docs/ENV.md](./docs/ENV.md)）新增允许，不删除 / 不重命名。
- `FreeLLMErrorKind` 错误码枚举值稳定（详见 [docs/API.md](./docs/API.md)）。

破坏性变更只在 v2 引入，并提前 ≥1 个 v1.x 小版本在 [ROADMAP.md](./ROADMAP.md) 通告。

## 性能基线（实测）

| 路径 | 吞吐 | p99 |
|---|---|---|
| 单次模型评分 | 830K hz | 3 μs |
| 100 模型池路由决策 | 8K hz | 0.3 ms |
| 冷却查询（命中） | 1.2M hz | 3 μs |
| 200-chunk SSE 解析 | 34K hz | 50 μs |
| 1000 行 Pool 装配 | 2.9K hz | 0.6 ms |

详见 [docs/perf/baseline.md](./docs/perf/baseline.md)。Tick 13 引入的 5 秒 TTL pool 缓存 + Prisma `select` 优化 + undici keep-alive 显著提升高 QPS 表现。

## 测试覆盖

- **单元 + 集成**：140 / 140 passing
- **AI 回归测试**：10 条 baseline 用例（路由 3 + 权限 3 + 错误分类 4）
- **5 个 Vitest 基准**：scorer / router / cooldown / sse-parser / pool-builder
- **公网 IP 烟测**：9 项全过（健康 / 401 中文 / 守门 302 / token Set-Cookie / SPA 中文 / admin login 200 / 反代）

## 升级指南

如果你从 v0.9.x 升级到 v1.0：

1. `git pull && pnpm install --frozen-lockfile`
2. `pnpm prisma:migrate:deploy` — 数据库迁移为追加式，不会破坏现有数据。
3. `pnpm build && systemctl restart freellm-api` —— 完成。
4. 公网 IP 实测 `/health` 与 `/v1/models`。

**新部署**：直接看 [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) 6 步流程。

## 已知限制（计划在 v1.x 处理）

- 单实例内存计数器（rate-limit / cooldown）—— 多实例部署需要 v1.4 的 Redis 选项。
- Admin UI 暂时只支持单管理员账号 —— v1.3 引入 Organization / Project 模型。
- `request_logs` 在 SQLite 高吞吐下会膨胀 —— v1.4 提供 PostgreSQL / ClickHouse 迁移工具。
- 安全：详见 [docs/SECURITY.md](./docs/SECURITY.md) 末尾的"已知限制"段。

## 致谢

本项目通过 Claude Code 的 `/betterloop` 自主迭代框架建造，全过程 14 个 tick、约 50 个文件改动、~1800+ 行新增。

非常规协作模式产生的非常规产物——但每一行代码都经过实测验证，每一个错误信封都标准化，每一个安全约束都跟 audit 报告挂钩。

欢迎使用。Bug 报告与功能请求请提 GitHub Issues，破坏性提议请走 [ROADMAP.md](./ROADMAP.md) 的反馈渠道。
