# FreeLLM Security & Threat Model

> Full secrets+auth implementation lands in **Tick 5 (v0.4.0.0)**. This doc
> states the threats we design against, and the controls that map to each.

## Assets we protect

| Asset                              | Sensitivity                                            |
| ---------------------------------- | ------------------------------------------------------ |
| Upstream provider API keys         | High — recovery cost, billing exposure.                |
| Virtual API key plaintext          | High at issue, low after (only hash stored).           |
| Admin password / session cookie    | High — full platform access.                           |
| Request prompts & completions     | Variable — user-supplied; default policy: do not log full text. |
| Telemetry / route attempts         | Low — anonymised by request id.                        |

## Threats and controls

| #  | Threat                                                                      | Control                                                                                                |
| -- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1  | Downstream key exfiltration via leaked log line                              | pino global redact + per-call `scrubObject` + virtual keys are sha256-hashed at rest.                  |
| 2  | Upstream key exfiltration via DB dump                                       | AES-256-GCM ciphertext with per-record AAD; the master key never enters the DB.                        |
| 3  | Upstream key exfiltration via frontend bundle                                | The frontend never touches `/admin/providers/:id` cleartext response; only ciphertext + last-used at.  |
| 4  | Prompt data exfiltration via overly verbose logs                            | `FREELLM_LOG_FULL_PROMPT=false` by default; `FREELLM_LOG_PROMPT_DIGEST=true` records a 12-char sha256. |
| 5  | Free-model abuse → OpenRouter cuts the upstream key                          | per-virtual-key RPM / daily quotas + global rate-limit + cooldown 429 detector + manual kill switch.   |
| 6  | 429 storm cascades into infinite fallback                                   | per-model + per-provider cooldown with exp backoff + half-open probe; `FREELLM_MAX_ROUTE_ATTEMPTS`.    |
| 7  | Fallback loop (A→B→A) wastes upstream call budget                            | model-id deduplication in candidate list; each candidate appears once per request.                     |
| 8  | Paid model called by mistake → billing surprise                              | `FREELLM_ALLOW_PAID_FALLBACK=false` by default; `allowPaidModels` defaults to false on virtual keys.    |
| 9  | Admin brute-force                                                            | bcrypt password + 5-failed-logins-locks-10-minutes + audit log on every login attempt (Tick 5).        |
| 10 | CSRF on admin endpoints                                                     | `SameSite=Lax` admin cookie + state-changing endpoints require `Origin` matching `FREELLM_WEB_ORIGIN`. |
| 11 | Replay of stolen admin cookie                                               | Session row in DB with `revokedAt`; logout immediately invalidates server-side regardless of cookie.   |
| 12 | Tampered virtual key (forge plaintext)                                      | 256-bit random; sha256 collision-resistant; constant-time hash compare.                                |
| 13 | Bind 0.0.0.0 leaks API to public internet                                   | `FREELLM_API_HOST=127.0.0.1` enforced by hook (project rule); Caddy fronts in prod.                    |
| 14 | systemd inline comments silently no-op resource limits                      | Project rule prohibits trailing comments in unit files; documented in CLAUDE.md.                       |
| 15 | TLS interception via misconfigured upstream                                  | All upstream `baseUrl` values must be `https://`; zod schema enforces.                                 |

## Secret rotation

- **`FREELLM_MASTER_KEY`** — rotate every 90 days. Rotation procedure: stage a
  new key as `FREELLM_MASTER_KEY_NEW`, run `pnpm rotate-secrets` (Tick 5
  extension), which re-encrypts every `upstream_keys.cipherText` with the new
  key, then atomically swaps `FREELLM_MASTER_KEY = FREELLM_MASTER_KEY_NEW`.
- **`FREELLM_SESSION_SECRET`** — rotate every 90 days. All existing sessions
  invalidate; admins re-login.
- **Virtual keys** — rotate per project lifecycle. The Admin UI offers
  `/admin/virtual-keys/:id/rotate`; the old hash is preserved with `revokedAt`
  for 24h audit.
- **Upstream keys** — when the provider's portal warns of leak or scheduled
  rotation.

## Hardening checklist for production

- [ ] `FREELLM_NODE_ENV=production`, `FREELLM_LOG_LEVEL=info`.
- [ ] `FREELLM_MASTER_KEY` and `FREELLM_SESSION_SECRET` rotated off placeholders.
- [ ] Caddy / reverse proxy in front, TLS terminated outside the process.
- [ ] `/admin/*` behind a separate auth front (e.g. Authelia) where possible.
- [ ] Database backups encrypted at rest.
- [ ] Audit logs (`error_events` table) ship to long-term storage weekly.
- [ ] `FREELLM_ALLOW_PAID_FALLBACK` explicitly set (no implicit default).
- [ ] Monitor `error_events WHERE kind='429_storm'` — auto-page if it fires.

## Tick 12 安全审计修复（v0.9.0.0 落地）

4 个 reviewer subagent 并行扫，发现 P0 8 / P1 22 / P2 14（去重后），全部 P0 + 关键 P1 已修，每条对应一个 `apps/api/__tests__/security.test.ts` 用例。

| 编号 | 位置 | 标题 | 修复要点 |
|---|---|---|---|
| P0-1 | `plugins/admin-auth.ts` | admin session cookie 缺 Secure + SameSite=Strict | 生产模式追加 Secure；全程 SameSite=Strict |
| P0-2 | `services/admin-user.service.ts` | 登录失败计数器无原子操作 | 改 Prisma `increment` 原子写 |
| P0-3 | `packages/shared/src/env.ts` | env 默认弱密钥 / 弱密码无 production 强制 | production 模式占位符值即拒绝启动 |
| P0-4 | `services/virtual-key.service.ts` | virtual key hash 非恒定时间二次校验 | `timingSafeEqualHex` |
| P0-5 | `packages/shared/src/env.ts` | MASTER_KEY 长度校验 16 太弱 | 改 ≥32 bytes |
| P0-6 | `services/route-executor.service.ts` | persistAttempts catch 完全静默 | console.error 留痕 |
| P0-7 | `services/event-bus.ts` | Promise.allSettled 结果不检查 | rejected 时 console.error |
| P0-8 | `packages/provider-core/src/openai-compat.ts` | SSE JSON parse 失败后未 return | catch 内 return |
| P1-A | `routes/admin/auth.routes.ts` | unknown_user/bad_password 区分 = 用户名枚举 | 改统一 `用户名或密码错误` |
| P1-B | `routes/v1/chat-completions.routes.ts` | SSE 错误 message 泄露内部细节 | 改通用错误 |
| P1-C | `packages/shared/src/redact.ts` | scrubObject 缺 secret/tokenHash/sessionToken | 补全 |
| P1-D | `plugins/cron.ts` | discovery 失败仅 info 不警告 | 升 warn |
| P1-E | `services/admin-user.service.ts` | login 双 DB 写无事务 | `$transaction` |
| P1-F | `services/route-executor.service.ts` | errorKind 强转 | `toKind` 类型守卫 |
| P1-G | 3 处重复 | parseCapabilities | 下沉 `shared/parseModelCapabilities`，修一隐性 bug |
| P1-I | `provider-installer.service.ts` | 解密失败静默 fallback | console.warn |

## Tick 14 部署链 Caddy 三层守门威胁缓解

| #  | Threat | Control |
| -- | --- | --- |
| 16 | 攻击者直接扫公网 `:28000/:28010` 爬取 admin endpoint | Caddy `handle` 链：token query → Cookie → Referer 三层任意命中才反代；全不中 302 portal。详见 `deploy/caddy/freellm.Caddyfile`。 |
| 17 | 攻击者拿到 token 后跨域跳转利用 | Cookie 带 `HttpOnly; SameSite=Lax`；admin session 生产 `SameSite=Strict + Secure`。 |
| 18 | 服务监听 0.0.0.0 被公网绕过 Caddy 直连 | systemd unit + Docker compose 都把 host bind 限定 `127.0.0.1`；公网入口仅 Caddy :28000/:28010。 |
| 19 | UFW 漏放 :28xxx 端口导致 loopback 盲区 | 部署文档 step 5 强制 `ufw allow`；step 6 强制公网 IP 实测，不允许只 curl 127.0.0.1。 |
| 20 | systemd unit 行尾注释被静默忽略，资源限制不生效 | 项目 CLAUDE.md 写明 systemd 铁律：注释独立成行；`freellm-{api,web}.service` 已合规。 |

## 已知限制（v1.0 公开声明）

- **单实例 RPM 计数器**：当前 rate-limit 用内存 Map；多实例部署需 Redis（计划 v1.4）。
- **`headerOverrides`**：上游 provider 允许自定义 header；当前无白名单校验。
- **`Setting` JSON 无签名**：admin 改 Setting 时不验证 JWS；依赖 admin auth 本身。
- **CSP**：项目内未设全套 CSP，建议在 Caddy 层补 `Content-Security-Policy` header。
- **localStorage 失败静默**：前端某些 hook 写 localStorage 失败时静默忽略 quota。
- **`approximateTokensFromStream` 为 0**：流式响应的 token 计数当前是粗略 placeholder，v1.x 接入 tiktoken 改进。
- **AdminUser 单账号**：v1.0 只支持一个管理员；多账号 + 组织 / 项目待 v1.3。
