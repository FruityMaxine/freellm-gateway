# FreeLLM — 自适应免费模型网关

> 一个 base URL、一把虚拟密钥。FreeLLM 自动发现 OpenRouter 持续变化的免费模型池，按 9 维评分智能路由，
> 在 429 / 5xx / 超时 / 上下文不足时自动回退，下游应用永不直接接触上游真实 API 密钥。

[![version](https://img.shields.io/badge/version-v1.0.0.0-success)](./VERSION)
[![tests](https://img.shields.io/badge/tests-140%2F140-brightgreen)](./docs/TESTING.md)
[![stack](https://img.shields.io/badge/stack-Fastify%20%2B%20Prisma%20%2B%20React%2019-7c3aed)](./docs/ARCHITECTURE.md)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

```
 ┌──────────────┐  fllm_live_xxx   ┌─────────────────┐  9 维评分    ┌──────────────┐
 │ 你的应用     │ ───────────────▶│   FreeLLM 网关  │ ───────────▶ │  OpenRouter  │
 │ (一个        │  OpenAI 兼容形态 │  (Fastify +     │  自动回退    │  OpenAI      │
 │  base URL)   │ ◀───────────────│  Prisma + SSE)  │  冷却恢复    │  Anthropic   │
 └──────────────┘                  └─────────────────┘              │  DeepSeek    │
                                                                    │  Google …    │
                                                                    └──────────────┘
```

## 为什么需要 FreeLLM

| 痛点 | 传统做法 | FreeLLM 做法 |
|---|---|---|
| OpenRouter 免费模型每周洗牌 | 手写在 .env 里几天就过期 | 每 30 分钟自动同步 + 快照差异检测 |
| 一个模型 429 把整个池拖慢 | 等用户报错 | 9 维评分 + 指数退避冷却 + 自动切换候选 |
| 真实 key 复制到几十个项目 | 一旦泄露全部失血 | 网关只签发 fllm_* 虚拟密钥，真 key 永不离开后端 |
| 不知道哪个请求被哪个模型回了 | 翻多份日志 | 每请求 `route_attempts` 瀑布图 + 全局指标 |

## 五分钟快速开始

### 本地开发（最快路径）

```bash
git clone https://github.com/<owner>/freellm.git && cd freellm
cp .env.example .env
# 三处必改（生成强密钥）：
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"  # FREELLM_MASTER_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"     # FREELLM_SESSION_SECRET
# 把生成结果填进 .env，再改 FREELLM_ADMIN_PASSWORD

pnpm install
pnpm prisma:migrate && pnpm prisma:seed
pnpm dev:api    # 后端 127.0.0.1:3001
pnpm dev:web    # 前端 127.0.0.1:5173
```

打开 [http://127.0.0.1:5173](http://127.0.0.1:5173) → 用 `admin` + 你设的密码登录 → 签发一把 `fllm_test_…` 密钥。

### 在你的应用里使用

```ts
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://127.0.0.1:3001/v1',
  apiKey: 'fllm_live_xxxxxxxxxxxxxxxx',
});

const response = await client.chat.completions.create({
  model: 'free/auto',              // 让 FreeLLM 自动挑当前最优免费模型
  messages: [{ role: 'user', content: '你好 FreeLLM' }],
});
console.log(response.choices[0]?.message?.content);
```

支持的别名（详见 [docs/ROUTING.md](./docs/ROUTING.md)）：

| 别名 | 含义 |
|---|---|
| `free/auto` | 综合 9 维评分挑当前最优免费模型 |
| `free/best` | 质量优先，允许牺牲时延 |
| `free/fast` | 时延优先 |
| `free/large-context` | 上下文窗口 ≥ 100K 的免费模型 |
| `openrouter/free` | 透传到 OpenRouter 的 `:free` 路由 |
| `<provider>/<model>` | 显式锁定，受虚拟密钥黑白名单约束 |

### 生产部署

详见 [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) 的 6 步流程（含 Docker / systemd / Caddy 三层守门 / UFW / 公网 IP 实测）。

## 架构总览

```
┌──────────────────────────────────────────────────────────────────────┐
│  apps/web        React 19 + Vite + Tailwind 4 + shadcn-风组件        │
│  ├─ Landing      Hero / Aurora / GlassCard / TypingText 动效         │
│  ├─ Dashboard    12 KPI + 上游健康 + 24h 趋势                        │
│  ├─ Models       360+ 模型可筛选 / 黑白名单 / 权重调整               │
│  ├─ Providers    上游配置 + 余额 / 错误次数 / 冷却状态               │
│  ├─ Virtual Keys 签发 / 轮换 / 吊销 + 一次性明文披露                 │
│  ├─ Routing Lab  实时路由演示 + 回退时间轴                           │
│  ├─ Logs         审计日志 + 路由尝试瀑布图 + CSV 导出                │
│  └─ Settings     8 分组配置 + 主题切换 + 管理员密码修改              │
├──────────────────────────────────────────────────────────────────────┤
│  apps/api        Fastify 5 + zod + pino                              │
│  ├─ plugins      虚拟密钥鉴权 / Cookie 管理员认证 / 错误信封 / 限流  │
│  ├─ routes/v1    chat-completions / models / key / usage             │
│  ├─ routes/admin 模型管理 / providers / virtual-keys / logs / routing│
│  └─ services     Route Executor / 评分更新 / 冷却存储 / 请求日志     │
├──────────────────────────────────────────────────────────────────────┤
│  packages                                                             │
│  ├─ shared           FreeLLMError / 9 维 capability / redact / env   │
│  ├─ provider-core    OpenAICompatProvider + 5 个具体上游 + Mock      │
│  └─ routing-core     Router (7 模式) + Scorer (9 维) + Cooldown      │
├──────────────────────────────────────────────────────────────────────┤
│  prisma          16 表 schema（identity → providers → models →       │
│                                routing → telemetry）                  │
│                  SQLite 默认 · 切 PostgreSQL 只需改 provider 行       │
└──────────────────────────────────────────────────────────────────────┘
```

完整设计参见 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)。

## 性能基线（v0.9.1.0 实测，详见 [docs/perf/baseline.md](./docs/perf/baseline.md)）

| 路径 | 吞吐 | p99 |
|---|---|---|
| 单次模型评分 | 830 K hz | 3 μs |
| 100 模型池路由决策 | 8 K hz | 0.3 ms |
| 冷却查询（命中） | 1.2 M hz | 3 μs |
| 200-chunk SSE 解析 | 34 K hz | 50 μs |
| 1000 行 Pool 装配 | 2.9 K hz | 0.6 ms |

后续 tick 提交前用 `pnpm bench` 对照本表；hz 下降 > 15% 视为性能回归。

## v1.0 公开承诺（API 稳定性）

从 v1.0.0.0 起：

- **OpenAI 兼容接口 `/v1/chat/completions` / `/v1/models` / `/v1/key` / `/v1/usage`** 的请求 / 响应形态在整个 v1 大版本内保持稳定，遵循 SemVer。
- **管理 API `/admin/*`** 在 v1 内保持向后兼容（新字段允许追加，不删除现有字段、不改变现有字段语义）。
- **数据库 schema** 仅追加迁移，不破坏性变更（迁移文件已固化在 `prisma/migrations/`）。
- **环境变量** 列表见 [docs/ENV.md](./docs/ENV.md)，新增允许，不重命名 / 不删除既有变量。
- **错误码** `FreeLLMErrorKind` 枚举值稳定（详见 [docs/API.md](./docs/API.md) 错误码表）。

破坏性变更只在 v2 大版本中引入，并会提前在 [ROADMAP.md](./ROADMAP.md) 里通告 ≥1 个 v1.x 小版本周期。

## 文档地图

| 文档 | 内容 |
|---|---|
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | 系统架构 + 模块边界 + 数据流 |
| [docs/API.md](./docs/API.md) | OpenAI 兼容接口 + 管理 API + 错误码表 |
| [docs/ROUTING.md](./docs/ROUTING.md) | 9 维评分原理 + 7 路由模式决策树 |
| [docs/SECURITY.md](./docs/SECURITY.md) | 威胁模型 + 加固清单 + 已知限制 |
| [docs/TESTING.md](./docs/TESTING.md) | 单元 / 集成 / 回归 / 基准 4 层覆盖说明 |
| [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) | 6 步部署 + Caddy 三层守门 + 排错 |
| [docs/ENV.md](./docs/ENV.md) | 完整环境变量参考 |
| [docs/perf/baseline.md](./docs/perf/baseline.md) | 性能基线 + 回归门槛 |
| [CHANGELOG.md](./CHANGELOG.md) | 所有版本变更 |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | 开发流程 + commit 规范 + 测试要求 |
| [ROADMAP.md](./ROADMAP.md) | v1.x / v2 计划 |

## 许可

[MIT](./LICENSE) — 自由商用，无义务背靠任何商业实体。
