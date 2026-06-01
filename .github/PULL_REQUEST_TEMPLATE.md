## 概述

<!-- 一句话说本 PR 干了什么 -->

## 变更类型

<!-- 在适用项前打 [x] -->

- [ ] `feat` 新功能（MINOR / MAJOR 级）
- [ ] `fix` 修 bug（PATCH 级）
- [ ] `refactor` 重构（一般 MINOR）
- [ ] `perf` 性能（PATCH 或 MINOR）
- [ ] `docs` 仅文档（BUILD 级）
- [ ] `chore` 杂项（BUILD 级）
- [ ] `test` 仅测试
- [ ] `build` / `ci`

## 版本号

- 当前 `VERSION`: <!-- e.g. v0.9.2.0 -->
- 升级到：<!-- e.g. v0.9.3.0 -->
- 升级理由：<!-- 按 CONTRIBUTING.md 的 bump 规则 -->

## 测试

- [ ] 现有测试全过：`pnpm -r test` = 140+ / 140+
- [ ] TypeScript 严格：`pnpm typecheck` clean
- [ ] ESLint：`pnpm lint` 0 errors
- [ ] 新增功能带新测试（单元 + 集成）
- [ ] 修 bug 带回归测试
- [ ] 性能敏感路径跑过 `pnpm bench` 对照 `docs/perf/baseline.md`

## 文档同步

- [ ] API surface 变更 → 同步 `docs/API.md`
- [ ] 路由模式 / 评分变更 → 同步 `docs/ROUTING.md`
- [ ] 新 env 变量 → 同步 `docs/ENV.md`
- [ ] 安全模型变化 → 同步 `docs/SECURITY.md`
- [ ] 部署流程变化 → 同步 `docs/DEPLOYMENT.md`
- [ ] 公开行为变化 → 加 `CHANGELOG.md` 当前未发版节

## 中文文案铁律

- [ ] 所有用户可见处用简体中文（UI / FreeLLMError message / 注释 / docs）

## 影响范围

<!-- 列出本 PR 修改的层（API / Web / Schema / Provider / Routing / Deployment / Docs） -->

## 回滚预案

<!-- 万一上线后出问题，怎么回滚？一句话 -->

## 关联 Issue

<!-- Closes #123 / Refs #456 -->
