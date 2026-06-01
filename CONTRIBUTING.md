# 贡献指南

感谢愿意为 FreeLLM 贡献。本文规定开发流程、提交规范、测试与文档要求。

## 开发环境

- Node.js ≥ 20（推荐 22 LTS，与 Dockerfile 一致）
- pnpm ≥ 9.15
- SQLite（开发默认）或 PostgreSQL（schema 兼容）
- Linux / macOS（Windows 需 WSL2）

## 第一次上手

```bash
git clone https://github.com/<owner>/freellm.git
cd freellm
cp .env.example .env
# 改 FREELLM_MASTER_KEY / FREELLM_SESSION_SECRET / FREELLM_ADMIN_PASSWORD（详见 docs/ENV.md）

pnpm install
pnpm prisma:migrate
pnpm prisma:seed
pnpm dev:api    # 终端 1
pnpm dev:web    # 终端 2
```

提交前检查：`pnpm typecheck` + `pnpm test` + `pnpm lint`。

## 分支策略

- `main` 永远可发版。
- 功能分支：`feat/<scope>-<short>`（如 `feat/web-routing-lab`）。
- 修复分支：`fix/<scope>-<short>`。
- 重构分支：`refactor/<scope>-<short>`。
- 性能分支：`perf/<scope>-<short>`。
- 不要在 `main` 上直接 commit；走 PR。

## Commit 规范（强制）

采用 Conventional Commits 扩展形式：

```
<type>(<scope>): v<X.Y.Z.W> <一句话描述>
```

- `type`：`feat` / `fix` / `chore` / `docs` / `refactor` / `perf` / `test` / `style` / `build` / `ci`。
- `scope`：`freellm` / `web` / `api` / `shared` / `routing-core` / `provider-core` / `prisma` / `docs` / `ci`。
- 版本号：扩展 SemVer 4 段（详见 [`/root/.claude/CLAUDE.md`](https://github.com/<owner>/freellm) 项目级版本号规则，右零归零）。

示例：

```
feat(freellm): v1.1.0.0 加入 Embeddings 端点

OpenAI 兼容 /v1/embeddings 落地：
- packages/provider-core 增 embed() 抽象
- 4 个上游 OpenAICompatProvider 实现 + 1 个 Mock
- apps/api routes/v1/embeddings.routes.ts
- 单元测试 12 个，集成测试 3 个
```

**禁止**在 commit message 里：

- 加 `Co-Authored-By: Claude` / `Generated with Claude Code` 之类的 trailer。
- 用 emoji。
- 写空消息或仅写 `fix bug` / `update`。

## 版本号 bump 规则

| 改动类型 | bump 段 |
|---|---|
| 破坏性变更 / 数据库迁移破坏 / 核心流程重构 | MAJOR |
| 新功能（向后兼容）/ 新页面 / 新 endpoint | MINOR |
| Bug 修复（向后兼容） | PATCH |
| 文案 / 注释 / 单字符 / 文档 typo | BUILD |

混合改动按最大那段升。升某段时右侧全部归零（`2.0.0.5` 修 bug → `2.0.1.0` 不是 `2.0.1.5`）。

修改后必同步：

- `VERSION` 文件
- `package.json`（根 + 6 个 workspace）
- 提交 message 第一行

## 测试要求

**任何 PR 必须**：

1. 现有测试全过：`pnpm -r test` = 140/140（或更多）。
2. TypeScript 严格通过：`pnpm typecheck`。
3. ESLint 0 errors：`pnpm lint`（warnings 允许，但应尽量减少）。
4. 新增功能必带新测试：单元 + 集成至少各一。
5. 修复 bug 必带回归测试，固化错误条件。
6. 性能敏感路径改动必跑 `pnpm --filter @freellm/api bench` 对照 `docs/perf/baseline.md`，hz 下降 > 15% 视为回归。

测试层级（详见 [docs/TESTING.md](./docs/TESTING.md)）：

- **单元** `packages/*/__tests__/`：纯函数，无 I/O。
- **集成** `apps/api/__tests__/`：起 Fastify + Prisma in-memory，端到端验证。
- **回归** `apps/api/__tests__/regression/`：baseline.json 锚定的 AI 决策行为。
- **基准** `apps/api/__benchmarks__/`：vitest bench mode 测吞吐。

## 文档要求

- 修改 API surface（请求 / 响应 / 错误码）→ 同步 `docs/API.md`。
- 加新 endpoint → `docs/API.md` 表格新行 + 错误码列入。
- 加新路由模式 / 评分维度 → `docs/ROUTING.md`。
- 加新 env 变量 → `docs/ENV.md` 表格新行 + 默认值说明。
- 修改安全模型 → `docs/SECURITY.md` 威胁缓解表对应 ID。
- 影响部署流程 → `docs/DEPLOYMENT.md` 步骤补充。
- 公开行为变化 → `CHANGELOG.md` 当前未发版节加条目。

## 中文文案铁律

所有用户可见处用简体中文：

- 前端 UI label / button / toast / empty / error / placeholder
- 后端 `FreeLLMError` message（API 直接返回给客户端的部分）
- `ErrorEvent.message`（DB 存储管理员可见）
- logger 第二参数描述（次要，但应优先中文）
- `docs/*.md` 章节与段落
- 代码注释 `//` `/** */` JSDoc

唯有代码本体（变量名 / 函数名 / SQL / API path）保持英文。

## PR 检查清单

提交 PR 前自检：

- [ ] 分支名遵循 `<type>/<scope>-<short>` 形式
- [ ] commit message 含版本号 + 单行总结 + 详细 body
- [ ] `VERSION` / 7 个 `package.json` 同步升级
- [ ] `pnpm typecheck` clean
- [ ] `pnpm test` 全过
- [ ] `pnpm lint` 0 errors
- [ ] 新增功能带测试（单元 + 集成至少各一）
- [ ] 修 bug 带回归测试
- [ ] 性能敏感路径跑过 bench 对照 baseline
- [ ] 文档同步更新（API / ENV / SECURITY / ROUTING / DEPLOYMENT 等）
- [ ] `CHANGELOG.md` 未发版节加条目
- [ ] 中文文案铁律已遵守
- [ ] commit 无 `Co-Authored-By` / `Generated with` 之类的 trailer

## 报告 Bug

请用 GitHub Issues 模板（`.github/ISSUE_TEMPLATE/`）：

- **Bug**：复现步骤 + 期望 / 实际 + 版本号 + 日志 / 截图
- **Feature**：动机 + 期望行为 + 替代方案考量
- **Security**：**不要**用公开 issue，请邮件 `<security email>`，包含复现 PoC + CVSS 估分

## 安全声明

发现安全漏洞请遵循 [docs/SECURITY.md](./docs/SECURITY.md) 的私下披露流程，不要公开 issue。

## 许可

提交贡献即同意以 [MIT License](./LICENSE) 协议授权。
