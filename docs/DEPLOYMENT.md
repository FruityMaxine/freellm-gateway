# FreeLLM 部署手册（Tick 14 · v0.9.2.0）

> ## ⚠ 实际部署现状校正（2026-06-01，以此为准）
>
> 本手册早期段落（systemd web.service / `prisma migrate deploy`）与**当前 Vega 生产实况已不符**，按下表校正：
>
> | 主题 | 手册旧述 | **生产实况（以此为准）** |
> |---|---|---|
> | **前端 web** | `freellm-web.service` systemd | **无 web.service** —— Caddy `root * /opt/freellm/apps/web/dist` + file_server 静态托管（见 `/etc/caddy/conf.d/freellm.Caddyfile`）。下文「安装 web.service」段作废。 |
> | **部署方式** | 手工 cp / rsync | **用 `scripts/deploy.sh`**（build + rsync dist + **VERSION + package.json** + chown + 重启 + 内外网版本校验）。历史教训：手工只 rsync dist、漏同步 VERSION 文件 → health 长期报旧版本号（代码其实最新）。脚本已固化防漂移。 |
> | **数据库迁移** | `prisma migrate deploy` | 线上库由 **`prisma db push` 建表**，**无 `_prisma_migrations` 表**，故 `migrate deploy` 对线上库**不可直接用**（会与现状 drift）。源码 `prisma/migrations/` 已补全 baseline（含 alert_rules/budgets/notify_channels/webhook_deliveries 等），**全新环境**可正常 `migrate deploy` 从头建全 26 表；**现有线上库**继续用 `db push`（动 schema 后须 rsync prisma client 到 /opt，见下）。 |
> | **测试库** | — | 源码 `prisma/data/*.db`（freellm-dev / *-test）已被 `.gitignore` 忽略，未入 git；`deploy.sh` 刻意**不同步 prisma/data**，无覆盖生产库风险。 |
> | **生产 /opt** | — | **非 git 仓库**（拷贝部署）。改动以源码仓库为准，经 `deploy.sh` 上架。 |
> | **DB 规模** | — | SQLite 单文件 ~214M 且增长，业务量大时迁 PostgreSQL（见 §「迁到 PostgreSQL」/ MIGRATION_POSTGRES.md）。 |
>
> **动 schema 后的 prisma client 同步铁律**：prisma 6.19 `generate` 输出到 `node_modules/.pnpm/@prisma+client@6.19.3.../node_modules`，须 rsync 该目录的 `@prisma/client/` + `.prisma/` 到 `/opt/freellm` 同路径 + chown，否则 `prisma.<新model>` 运行时 undefined 崩。

适配 your server 服务器（Ubuntu 24.04 · Caddy + UFW + systemd 既有栈），覆盖：

- 单机 systemd 部署（**推荐**，与服务器现有项目一致）
- 单机 Docker Compose 部署（开发 / 演示快速起）
- Caddy 反代 + 三层守门
- 公网 IP 实测验证
- 排错与监控

> 部署后**必须**从公网 IP 实测 `/health` 通透（不只是 `curl 127.0.0.1` —— loopback 不经 UFW 是已知盲区）。

---

## 0. 前置准备（一次性）

```bash
# 1. 用户与目录
sudo useradd -r -m -d /opt/freellm -s /sbin/nologin freellm
sudo mkdir -p /opt/freellm/data
sudo chown -R freellm:freellm /opt/freellm

# 2. Node 22 LTS（与 Dockerfile 一致）
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt-get install -y nodejs

# 3. pnpm
sudo corepack enable && sudo corepack prepare pnpm@9.15.0 --activate

# 4. （可选）Docker Engine —— 仅 Compose 路线需要
# 已装跳过；未装见 https://docs.docker.com/engine/install/ubuntu/
```

---

## 1. 拉取源码

```bash
sudo -u freellm git clone https://github.com/<owner>/freellm.git /opt/freellm
cd /opt/freellm
sudo -u freellm cp .env.example .env
```

**编辑 `/opt/freellm/.env`，至少改这三项**：

```bash
FREELLM_MASTER_KEY=<node -e "console.log(require('crypto').randomBytes(32).toString('base64'))">
FREELLM_SESSION_SECRET=<node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
FREELLM_ADMIN_PASSWORD=<请改成强密码>
```

> 生产模式启动时若 `FREELLM_MASTER_KEY` / `FREELLM_SESSION_SECRET` 仍是默认占位值，API 会主动拒绝启动并报错（审计 P0-3）。

---

## 2. 构建与初始化

```bash
cd /opt/freellm
sudo -u freellm pnpm install --frozen-lockfile
sudo -u freellm pnpm prisma:generate
sudo -u freellm pnpm prisma:migrate:deploy
sudo -u freellm pnpm build
# 首次 seed 管理员账号（仅首次）
sudo -u freellm pnpm prisma:seed
```

构建完成后 `apps/api/dist/server.js` 与 `apps/web/dist/index.html` 都应存在。

---

## 3. systemd 上线（推荐路线）

```bash
sudo cp /opt/freellm/deploy/systemd/freellm-api.service /etc/systemd/system/
sudo cp /opt/freellm/deploy/systemd/freellm-web.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now freellm-api.service
sudo systemctl enable --now freellm-web.service

# 本机自检（注意：仅 loopback 自检，不能算"上线成功"）
curl -s http://127.0.0.1:3001/health
curl -s http://127.0.0.1:8080/ | head -5

# journalctl 查看日志
journalctl -u freellm-api -f
journalctl -u freellm-web -f
```

> systemd unit 中**严禁**写行尾注释（systemd 会静默忽略整行 → 资源限制不生效）。修改时确保所有 `# 注释` 都独立成行。

---

## 4. Docker Compose 替代路线（可选）

```bash
cd /opt/freellm
sudo docker compose up -d --build
sudo docker compose logs -f api
```

`docker-compose.yml` 仅把端口暴露在 `127.0.0.1:3001` / `127.0.0.1:8080`；公网入口仍走 Caddy。

---

## 5. Caddy 反代 + UFW + 公网入口

```bash
# 1. 生成两把独立 token
FREELLM_API_TOKEN=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
FREELLM_WEB_TOKEN=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
echo "api token: $FREELLM_API_TOKEN"
echo "web token: $FREELLM_WEB_TOKEN"

# 2. 复制并替换占位符
sudo cp /opt/freellm/deploy/caddy/freellm.Caddyfile /etc/caddy/conf.d/freellm.Caddyfile
sudo sed -i "s/REPLACE_WITH_FREELLM_API_TOKEN/$FREELLM_API_TOKEN/g" /etc/caddy/conf.d/freellm.Caddyfile
sudo sed -i "s/REPLACE_WITH_FREELLM_WEB_TOKEN/$FREELLM_WEB_TOKEN/g" /etc/caddy/conf.d/freellm.Caddyfile

# 3. 把 conf.d 包进主 Caddyfile（若尚未 import）
grep -q 'import conf.d/\*' /etc/caddy/Caddyfile || \
  echo 'import conf.d/*.Caddyfile' | sudo tee -a /etc/caddy/Caddyfile

# 4. UFW 放行（loopback 盲区铁律：不放 = 公网包到不了 Caddy）
sudo ufw allow 28000/tcp comment "freellm api entry (Caddy gated)"
sudo ufw allow 28010/tcp comment "freellm web entry (Caddy gated)"

# 5. Caddy 验证 + reload
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy

# 6. 写入 Homepage 卡片（/opt/homepage/config/services.yaml）
# 卡片 href 形如：
#   http://YOUR_SERVER_IP:28010/?pass=$FREELLM_WEB_TOKEN
sudo docker restart homepage
```

---

## 6. 公网 IP 实测（**必做** · 不能跳过）

```bash
PUBLIC_IP=$(curl -s ifconfig.me)
echo "Public IP: $PUBLIC_IP"

# API healthz —— 应返回 200 + JSON
curl -sv http://$PUBLIC_IP:28000/health | head -20

# Web 首次访问（无 pass）—— 应 302 踢回 Homepage
curl -sv http://$PUBLIC_IP:28010/ 2>&1 | grep -E "^< HTTP|^< Location"

# 带 token 访问 —— 应 302 重定向去除 query 并下发 Cookie
curl -sv "http://$PUBLIC_IP:28010/?pass=$FREELLM_WEB_TOKEN" 2>&1 | grep -E "Set-Cookie|HTTP"
```

预期：
- `/health` 走任意通道都直接 200
- `/` 无 token 一律 302 → `example.com/`
- `/?pass=<correct>` 302 + Set-Cookie，然后跟 Cookie 可以正常访问 SPA

---

## 排错速查

| 症状 | 排查 |
|---|---|
| 公网 curl 超时 | UFW 漏放 :28xxx —— 见步骤 5 的 ufw allow |
| 公网 curl 502 | Caddy 反代地址不对 —— 看 `journalctl -u caddy -n 50`，检查 127.0.0.1:3001/8080 服务在不在 |
| API 启动立即退出 | `journalctl -u freellm-api -n 100` —— 八成是 `.env` 里 MASTER_KEY/SESSION_SECRET 仍是占位值 |
| `/v1/chat/completions` 返回 503 `no_route_available` | 上游 Provider key 都没配，且 mock 已关 —— 看 `.env` 的 FREELLM_MOCK_PROVIDERS_ENABLED |
| Web 页面空白 | `apps/web/dist/` 不存在 —— 重跑 `pnpm build` 或 docker 重建 |
| systemd 内存限制不生效 | 检查 unit 文件**没有**行尾注释（铁律） |
| 端口冲突 | 28000 / 28010 / 3001 / 8080 被占 —— `ss -ltnp \| grep -E ':28000\|:3001\|:8080'` |

---

## 监控建议

1. **journalctl + 日志轮转**：默认 30 天，必要时 `/etc/systemd/journald.conf` 调 `SystemMaxUse=2G`。
2. **Caddy access log**：`/var/log/caddy/freellm-{api,web}.log` 已开 JSON 输出；可挂 promtail → loki 收集。
3. **Prometheus 抓取**（如需）：API 暴露 `/admin/metrics` JSON，可写自定义 exporter 转 Prom 格式。
4. **健康检查 cron**：每分钟从外部网络 `curl /health`，失败连续 3 次推 Vega Mail（`mail-relay` 接口，见 `/root/.claude/CLAUDE.md`）。
5. **磁盘**：SQLite 落在 `/opt/freellm/data/freellm.db`，业务量大时关注 inode + 大小，必要时迁 PostgreSQL（schema 已兼容）。

---

## 版本与升级

```bash
# 1. 拉新
cd /opt/freellm && sudo -u freellm git pull
sudo -u freellm pnpm install --frozen-lockfile
sudo -u freellm pnpm prisma:migrate:deploy
sudo -u freellm pnpm build

# 2. 重启 API；web 是静态文件，无须重启服务（npx serve 自动重新读 dist）
sudo systemctl restart freellm-api
# 若用 npx serve 跑 web，请也重启以重新加载 dist：
sudo systemctl restart freellm-web

# 3. 公网 IP 再次实测 /health
curl -sv http://$PUBLIC_IP:28000/health | head -3
```

---

## 安全清单（部署前过一遍）

- [ ] `.env` 已改强密钥（MASTER_KEY / SESSION_SECRET / ADMIN_PASSWORD 都不是默认值）
- [ ] FREELLM_NODE_ENV=production
- [ ] 首登后已改默认管理员密码（UI 设置页）
- [ ] Caddy token 已用 `crypto.randomBytes(32)` 重新生成，未硬编码到 git
- [ ] UFW 默认 deny incoming，仅明示 allow 22 / 80 / 443 / 28000 / 28010 / 28xxx 等
- [ ] 上游真实 API key 在 `.env` 中，**不**进 git（已 .gitignore）
- [ ] systemd unit 已加 ProtectSystem / NoNewPrivileges / 资源上限
- [ ] DEPLOYMENT.md 步骤 6 的公网实测全过（不仅 loopback）

---

## 多实例水平扩部署（Tick 21 v1.4.0.0 引入）

单实例 FreeLLM 在 SQLite + 内存 RPM 桶下足以支撑数千 QPS。
若需要跨主机水平扩 / 蓝绿切换 / 负载均衡，按以下步骤升级：

### 一、把数据库迁到 PostgreSQL

详见 [docs/MIGRATION_POSTGRES.md](./MIGRATION_POSTGRES.md)，关键 env：

```bash
# /opt/freellm/.env
DATABASE_URL='postgresql://user:password@db-host:5432/freellm'
```

Prisma 客户端用 `prisma/schema.postgres.prisma` 重新生成。

### 二、启用 Redis 共享速率限制 / 冷却

否则每个实例各自一份内存 RPM 桶，单 key 实际可用配额会按实例数翻倍，限额形同虚设。

```bash
# /opt/freellm/.env
FREELLM_REDIS_URL='redis://default:password@redis-host:6379/0'
```

API 启动时检测：

- 未设此变量 → 走 `MemoryKvStore`（单实例足够）
- 已设且 `ioredis` 已安装 → 走 `RedisKvStore`（共享窗口）
- 已设但 `ioredis` 未安装 → console.warn 回落内存（不中断启动）

可选显式装 ioredis：

```bash
cd /opt/freellm && sudo -u freellm pnpm add ioredis -w
```

### 三、Caddy upstream 负载均衡

把多实例配在 Caddy 的 `reverse_proxy` 后面：

```caddy
:28000 {
    # ... token / cookie / referer 守门段保持不变 ...

    handle /health {
        reverse_proxy host-1:3001 host-2:3001 host-3:3001 {
            lb_policy round_robin
            health_uri /health
            health_interval 10s
            health_timeout 3s
        }
    }
    handle /v1/* {
        reverse_proxy host-1:3001 host-2:3001 host-3:3001 {
            lb_policy least_conn
            transport http {
                keepalive 60s
                keepalive_idle_conns_per_host 32
            }
        }
    }
}
```

### 四、共享 SSE 推送（暂未实现，留 v1.4.x）

`/admin/events` 当前的 `globalEventBus` 是进程内的；多实例下 A 实例处理的请求 emit 的事件不会被订阅到 B 实例 SSE 的客户端。
v1.4.x 计划在 EventBus 上加 Redis Pub/Sub 适配器，跨实例广播。本 tick 暂不实现，多实例部署期间建议把 `/admin/events` 反代固定到单一 sticky 实例。

### 五、实测验证多实例工作

```bash
# 1. 起两个 API 实例（分别在 3001 / 3002）
# 2. Caddy 后端配两个 upstream
# 3. 公网快速循环 curl /v1/models 看 status header
for i in {1..20}; do
  curl -sv http://$PUBLIC_IP:28000/v1/models -H "Authorization: Bearer fllm_test_xxxxx" 2>&1 | grep -i x-freellm-request-id
done
# 期望：request_id 跨请求分布在两个实例，无单实例独占。

# 4. 验证 RPM 限额跨实例：设虚拟密钥 RPM=10，并发 20 个请求
ab -n 20 -c 10 -H "Authorization: Bearer fllm_test_xxxxx" http://$PUBLIC_IP:28000/v1/models
# 期望：约 10 个 200 + 10 个 429（限额准确生效），而非 20 个 200。
```

### 六、回滚

把 `DATABASE_URL` 改回 SQLite、删 `FREELLM_REDIS_URL`、Caddy upstream 只保留单实例、重启即可。
SQLite 文件迁移期间是只读导出，未被本次升级修改，原数据完整保留。
