---
name: Bug 报告
about: 报告功能不工作或异常行为
title: '[Bug] '
labels: bug
assignees: ''
---

## 简述

<!-- 一两句话说哪里不对 -->

## 复现步骤

1.
2.
3.

## 期望行为

<!-- 你认为应该是什么样 -->

## 实际行为

<!-- 实际看到的是什么样 -->

## 环境

- FreeLLM 版本（看 `VERSION` 或 `/health` 端点返回）: <!-- e.g. v1.0.0.0 -->
- 部署方式：<!-- systemd / Docker Compose / 其他 -->
- Node.js 版本：<!-- e.g. 22.11.0 -->
- 数据库：<!-- SQLite / PostgreSQL -->
- OS：<!-- e.g. Ubuntu 24.04 -->

## 日志 / 错误信封

<!-- 粘贴关键日志或 OpenAI 错误信封 JSON。
     注意先去除敏感信息：API key / Bearer / cookie 等 -->

```
<paste here>
```

## 截图（如适用）

<!-- 拖图片到此处 -->

## 排查记录

<!-- 你已经尝试过的排查动作 -->

- [ ] 看了 `docs/DEPLOYMENT.md` 排错速查表
- [ ] 看了 `journalctl -u freellm-api -n 200`
- [ ] 看了 `/admin/logs/:requestId` 详情
- [ ] 看了 Caddy `/var/log/caddy/freellm-*.log`

## 安全相关？

如本 issue 涉及安全漏洞（密钥泄露、绕过鉴权、提权等），**不要**在这里报告 —— 请按 [docs/SECURITY.md](../docs/SECURITY.md) 的私下披露流程联系维护者。
