# FreeLLM API

The complete OpenAI-compatible surface ships in **Tick 5 (v0.4.0.0)**. The list
below is the canonical contract; ticks that follow this document MUST honour
the response shapes here.

## Public (`/v1/*`) — requires `Authorization: Bearer fllm_…`

| Method | Path                       | Status   | Description                                              |
| ------ | -------------------------- | -------- | -------------------------------------------------------- |
| POST   | `/v1/chat/completions`     | Tick 5   | OpenAI-compatible. `model` accepts alias or upstream id. |
| GET    | `/v1/models`               | Tick 5   | Lists models the calling virtual key may use.            |
| GET    | `/v1/key`                  | Tick 5   | Info about the calling key (label, limits, usage).       |
| GET    | `/v1/usage`                | Tick 5   | Aggregate usage for the calling key (last 24h / 7d).     |

### Response headers on every `/v1/*` response

```
x-freellm-request-id:       req_xxxxxx
x-freellm-upstream-provider: openrouter
x-freellm-upstream-model:    meta-llama/llama-3.3-70b-instruct:free
x-freellm-route-attempts:    2
x-freellm-cache-hit:         false
```

## Admin (`/admin/*`) — requires admin session cookie

| Method | Path                            | Status | Description                                            |
| ------ | ------------------------------- | ------ | ------------------------------------------------------ |
| POST   | `/admin/auth/login`             | Tick 5 | Username + password; sets HttpOnly cookie.             |
| POST   | `/admin/auth/logout`            | Tick 5 | Revokes the current session.                           |
| GET    | `/admin/metrics`                | Tick 5 | 24h / 7d roll-ups for dashboard.                       |
| GET    | `/admin/models`                 | Tick 3 | All models known to the registry.                      |
| POST   | `/admin/models/refresh`         | Tick 3 | Forces a discovery cycle.                              |
| GET    | `/admin/models/:id`             | Tick 3 | Detail + snapshot history.                             |
| PATCH  | `/admin/models/:id`             | Tick 3 | Enable/disable, weight nudge, blacklist.               |
| GET    | `/admin/providers`              | Tick 5 | List of providers.                                     |
| POST   | `/admin/providers`              | Tick 5 | Create.                                                |
| PATCH  | `/admin/providers/:id`          | Tick 5 | Update.                                                |
| DELETE | `/admin/providers/:id`          | Tick 5 | Remove.                                                |
| POST   | `/admin/providers/:id/test`     | Tick 5 | Smoke-test connection + auth.                          |
| GET    | `/admin/virtual-keys`           | Tick 5 | List.                                                  |
| POST   | `/admin/virtual-keys`           | Tick 5 | Create. Plaintext returned once.                       |
| PATCH  | `/admin/virtual-keys/:id`       | Tick 5 | Edit label / permissions / quotas / enable.            |
| POST   | `/admin/virtual-keys/:id/rotate`| Tick 5 | Rotate secret. New plaintext returned once.            |
| DELETE | `/admin/virtual-keys/:id`       | Tick 5 | Revoke.                                                |
| PATCH  | `/admin/routing-policy`         | Tick 4 | Tune weights / default mode.                           |
| GET    | `/admin/cooldowns`              | Tick 4 | Active model / provider cooldowns.                     |
| POST   | `/admin/cooldowns/:id/reset`    | Tick 4 | Manual recovery.                                       |
| GET    | `/admin/logs`                   | Tick 5 | Request log with filters.                              |
| GET    | `/admin/logs/:id`               | Tick 5 | Single request detail + route attempts timeline.       |
| GET    | `/admin/settings`               | Tick 5 | Live settings.                                         |
| PATCH  | `/admin/settings`               | Tick 5 | Patch settings.                                        |
| POST   | `/admin/test-chat`              | Tick 5 | Routing Lab endpoint: run a chat through routing and return route attempts. |

## Liveness / readiness

| Method | Path        | Status      | Description                                         |
| ------ | ----------- | ----------- | --------------------------------------------------- |
| GET    | `/health`   | v0.1.0.0    | Liveness; no DB.                                    |
| GET    | `/ready`    | v0.1.0.0    | Readiness; pings DB.                                |

## Error envelope

Every error response carries:

```json
{
  "error": {
    "message": "Human readable",
    "type": "rate_limit_error",
    "code": "rate_limited"
  },
  "request_id": "req_abc12345"
}
```

`code` is one of `FreeLLMErrorKind` (defined in `@freellm/shared/errors.ts`).
`type` is OpenAI-compatible (`invalid_request_error`, `authentication_error`,
`rate_limit_error`, `billing_error`, `content_policy_violation`, `api_error`).

## 错误码完整对照表（v1.0 稳定，详见 `packages/shared/src/errors.ts`）

| `code` (`FreeLLMErrorKind`) | HTTP | OpenAI `type` | 含义 | 客户端处理建议 |
|---|---|---|---|---|
| `bad_request` | 400 | `invalid_request_error` | 参数缺失 / 格式错 | 修参数后重试 |
| `unauthorized` | 401 | `authentication_error` | 缺 Bearer 或 API key 无效 | 检查 `Authorization: Bearer fllm_…` |
| `auth_failure` | 401 | `authentication_error` | 上游密钥失效 | 后台联系管理员，客户端不需要重试 |
| `balance_insufficient` | 402 | `billing_error` | 上游余额不足 | 后台联系管理员，客户端不需要重试 |
| `forbidden` | 403 | `authentication_error` | 已认证但权限不足 / streaming 被禁 | 检查虚拟密钥权限矩阵 |
| `not_found` | 404 | `invalid_request_error` | 资源不存在 | 修 URL 或 ID 后重试 |
| `context_overflow` | 413 | `invalid_request_error` | 上下文超模型上限 | 截短 prompt 或切大上下文模型 |
| `content_filter` | 451 | `content_policy_violation` | 上游内容过滤拦截 | 修改 prompt；**不要**自动重试 |
| `unsupported_capability` | 422 | `invalid_request_error` | 模型不支持请求能力（如 tools） | 切换支持该能力的模型 |
| `rate_limited` | 429 | `rate_limit_error` | 虚拟密钥 RPM/日额超 OR 上游 429 | 看响应 `Retry-After` 头，指数退避重试 |
| `network_error` | 502 | `api_error` | 上游连接 / DNS / TCP 错误 | FreeLLM 已自动 fallback；若收到说明全军覆没，可短延迟重试 |
| `invalid_response` | 502 | `api_error` | 上游返回的 JSON 不可解析 | 同上 |
| `all_attempts_failed` | 502 | `api_error` | 所有候选模型均失败 | 短延迟重试；若持续，看 `/admin/logs` |
| `provider_unavailable` | 503 | `api_error` | 上游 5xx | FreeLLM 已自动 fallback；持续失败说明全军覆没 |
| `no_route_available` | 503 | `api_error` | 路由器筛不出候选 | 检查模型池 + 虚拟密钥黑白名单 + 能力要求 |
| `cooldown_active` | 503 | `api_error` | 唯一候选正在冷却 | 短延迟重试 |
| `timeout` | 504 | `api_error` | 上游超时 | 短延迟重试 |
| `unknown` | 500 | `api_error` | 未分类异常 | 看 `/admin/logs` 详情，提 issue |

### 客户端编程建议

- **不要重试的 code**：`bad_request` / `unauthorized` / `forbidden` / `not_found` / `context_overflow` / `unsupported_capability` / `content_filter` / `auth_failure` / `balance_insufficient`。
- **可重试的 code**（建议指数退避 + jitter）：`rate_limited` / `network_error` / `invalid_response` / `provider_unavailable` / `timeout` / `cooldown_active` / `all_attempts_failed`。
- **路由层 code**（FreeLLM 本身的决策结果）：`no_route_available` / `all_attempts_failed` / `cooldown_active`。

## v1.0 稳定承诺

从 v1.0.0.0 起：

- 上表所有 `FreeLLMErrorKind` 枚举值在 v1 大版本内**不会被删除或重命名**。新 kind 允许追加。
- 上表 `HTTP` 列与 `OpenAI type` 列的映射**不会改变**。
- `/v1/*` 公开端点的请求 / 响应 schema 在 v1 内保持向后兼容（新字段允许追加，不删除现有字段、不改语义）。
- `/admin/*` 端点在 v1 内保持向后兼容（同上）。
- `x-freellm-*` 响应头列表稳定，新头允许追加。

破坏性变更只在 v2 引入，并提前 ≥1 个 v1.x 小版本在 [ROADMAP.md](../ROADMAP.md) 通告。
