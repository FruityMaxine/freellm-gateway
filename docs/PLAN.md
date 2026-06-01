# FreeLLM 项目总览索引（v1.0+ 现行版）

> v0.1 ~ v1.0 通过 `/betterloop` 自主迭代完成（共 15 个 tick + Tick 16 polish）。
> 历史 Phase 0 spec 已归档到 `docs/progress/loop-plan-组*.md` 与 `CHANGELOG.md`。
> 本文档替代 v0.1.0 时期的 `PLAN.md`，作为入口索引指向各专题文档。

## 一句话定位

> 一个 base URL、一把虚拟密钥。FreeLLM 自动管 OpenRouter 免费模型池、按 9 维评分智能路由、
> 在 429/5xx/超时时自动回退，下游应用永不接触上游真实 key。

完整产品介绍见 [README.md](../README.md)。

## 想做什么 → 看哪份文档

| 我想… | 看这里 |
|---|---|
| 5 分钟跑起来 | [README.md](../README.md#五分钟快速开始) |
| 部署到自己的服务器 | [docs/DEPLOYMENT.md](./DEPLOYMENT.md) 6 步流程 |
| 调用 OpenAI 兼容 API | [docs/API.md](./API.md) |
| 看 `code` 错误码什么意思 | [docs/API.md](./API.md) 错误码完整对照表 |
| 理解 9 维评分怎么算 | [docs/ROUTING.md](./ROUTING.md) 9 维评分公式段 |
| 调路由策略 / 权重 | [docs/ROUTING.md](./ROUTING.md) 7 模式决策树段 |
| 配 env 变量 | [docs/ENV.md](./ENV.md) |
| 检查安全模型 | [docs/SECURITY.md](./SECURITY.md) |
| 跑测试 / 加测试 | [docs/TESTING.md](./TESTING.md) 四层覆盖说明 |
| 看性能基线 | [docs/perf/baseline.md](./perf/baseline.md) |
| 系统架构 / 模块边界 | [docs/ARCHITECTURE.md](./ARCHITECTURE.md) |
| 贡献代码 | [CONTRIBUTING.md](../CONTRIBUTING.md) |
| 看路线图 | [ROADMAP.md](../ROADMAP.md) |
| 看版本变化 | [CHANGELOG.md](../CHANGELOG.md) |
| 看历史 tick 计划 / 总结 | [docs/progress/](./progress/) 子目录 |

## 北极星用户故事（不变）

> 「我希望我的副项目通过一个 URL 调 OpenRouter 免费模型；每个项目一把虚拟密钥；
> 不用手动维护模型 ID；不用担心 429。我要一个控制台告诉我哪些是健康的、哪些在冷却、
> 平台把请求花到哪儿去了。」

## 架构四根支柱

四根支柱保持 v0.1 → v1.0 不变（仅实现增量），完整解读看 [docs/ARCHITECTURE.md](./ARCHITECTURE.md)：

1. **Provider 抽象**（`packages/provider-core`）—— `BaseProvider` + `OpenAICompatProvider` + `ProviderRegistry`，api 层永远拿抽象、永不 import 具体上游。
2. **模型发现**（`apps/api/services/model-discovery.service.ts`）—— 30 分钟定时同步 + 快照差异 + 6 类变化事件 + 6 态状态机。
3. **9 维评分 + 7 模式路由**（`packages/routing-core`）—— EWMA 更新、白黑名单 bonus/penalty、capability 过滤、指数退避冷却 + 半开探测。
4. **虚拟密钥 + 安全**（`apps/api/services/virtual-key.service.ts` + `plugins/`）—— sha256 仅存哈希、AES-256-GCM 加密上游 key、Cookie + Bearer 双轨鉴权、Caddy 三层守门。

## 访客体验（Tick 23-24 v1.5 引入）

v1.5 之前，FreeLLM 默认是「先登录管理员才能用」的内部网关。v1.5 把 Landing 与 Playground 对未登录访客开放：

- `/` Landing 任意访问 —— Hero CTA「立即试用」直达 Playground。
- `/playground` Playground 公开 —— 自动调 `POST /public/demo-key` 拿一把临时 demo 密钥（紧额度：15 请求 / 1000 token / 天），输入 prompt 即可跑通 9 维评分 + 自动回退路由全链。
- Sidebar 自动检测登录态：未登录时只显示 Landing + Playground；登录后展开完整 admin 路由。
- `/public/demo-key` 端点默认关闭（`FREELLM_DEMO_ENABLED=true` 显式启用），并叠加 IP 级速率限制（同 IP 每小时最多签 5 把）。
- demo 密钥走独立限额桶（`apps/api/src/lib/demo-limit.ts`），不影响正常 VK 配额；过期或额度耗尽时返回中文友好提示。

不引入 OAuth / 注册账户系统 —— 那些属于 v2 范畴。本期只做匿名访客体验。

## 当前状态（Tick 24 v1.5.1.0 时点）

- **v1.0 API 稳定承诺**已发布（见 [README.md](../README.md#v10-公开承诺-api-稳定性) 与 [CHANGELOG.md](../CHANGELOG.md)）。
- **140 / 140 tests passing**（10 + 22 + 41 + 67 跨 4 包）。
- **0 ESLint errors / 0 warnings**（v1.0.1.0 完成清理）。
- **Vite 主 chunk 251 KB**（v0.9.x 的 1127 KB 经 Tick 15 拆分 + Tick 16 路由级 lazy load 后总降 77%）。
- **/admin/metrics 5s TTL 缓存**（Tick 16），Dashboard 5 秒轮询不再每次打 DB 8 个查询。
- **公网部署链** Docker + systemd + Caddy 三层守门 已通过 9 项公网 IP 烟测。

## Group 历史回顾（已完成）

| Group | Tick | 主要交付 |
|---|---|---|
| 1 | 2-5 | Monorepo + Schema + Provider abstraction + Discovery + Routing + OpenAI API |
| 2 | 7-10 | 前端 8 页 + Design tokens + Settings + 主题 + 24 截图 + mock-prefer 联调 |
| 3 | 12-15 | 多 reviewer 审计 + 性能优化 + Benchmark + ESLint + AI 回归 + i18n + Docker + Caddy + 1.0 发版 |
| 4+ | 16+ | v1.x polish 与功能扩展（详见 [ROADMAP.md](../ROADMAP.md)） |

## 反偷懒约束（仍然适用）

每个 tick / PR 必须同时满足：

- **实测 ≠ 类型检查**：UI 改动必须 Playwright 截图或人工浏览验证；API 改动必须 curl + 验证 response shape；部署改动必须公网 IP 烟测。
- **版本号 4 段制**：任何代码改动同步升 `VERSION` + 7 个 `package.json`。
- **commit 无 AI 痕迹**：禁 `Co-Authored-By` / `Generated with Claude Code` 之类的 trailer。
- **中文文案铁律**：所有用户可见处中文（UI / FreeLLMError / 注释 / docs）。

完整约束见 [CONTRIBUTING.md](../CONTRIBUTING.md) 与项目级 `CLAUDE.md`。
