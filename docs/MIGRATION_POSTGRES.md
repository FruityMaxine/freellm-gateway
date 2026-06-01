# 迁移到 PostgreSQL

> 适用：当 SQLite 单文件遇到瓶颈（高 QPS、`request_logs` 表膨胀、需要跨实例共享），把数据迁移到 PostgreSQL。
> 本文档对应 v1.4.0.0 引入的 `prisma/schema.postgres.prisma` + KV 抽象。

## 何时该迁移

| 信号 | 含义 |
|---|---|
| `request_logs` 行数 > 500 万 | SQLite 单文件写入会出现 `database is locked` 抖动 |
| 需要多实例水平扩 | SQLite 无原生跨进程锁；Postgres + Redis 才能水平扩 |
| 长期保留全量审计 | Postgres + 时序分区（如 TimescaleDB）远比 SQLite 一张大表友好 |
| 多区域部署 | Postgres 有成熟主从 / 异步复制方案 |

如果上述条件都没遇到，**继续用 SQLite**——零运维负担，0.5 ms `/v1` 调用全靠它。

## 准备

1. 启一台 PostgreSQL 14+（自建 / RDS / Supabase / Neon 均可）。
2. 建一个空数据库：`CREATE DATABASE freellm;`
3. 生成连接串：`postgresql://user:password@host:5432/freellm`

## 步骤

### 一、生成 PostgreSQL 客户端

```bash
DATABASE_URL='postgresql://user:password@host:5432/freellm' \
  pnpm prisma generate --schema prisma/schema.postgres.prisma
```

> 注：此时 `node_modules/.prisma/client` 会被覆盖为 Postgres 版本；如果还想保留 SQLite 客户端，请用不同 `output` 目录或两份 workspace。

### 二、应用 schema 到 Postgres

```bash
DATABASE_URL='postgresql://user:password@host:5432/freellm' \
  pnpm prisma db push --schema prisma/schema.postgres.prisma --accept-data-loss
```

> 也可走 `migrate deploy`，但因 SQLite 与 PostgreSQL 的 migration history 不共享，初次推荐 `db push` 一把建表。

### 三、迁移数据

**简单做法**（小数据集）：

```bash
# 1. SQLite 全表导出 CSV
sqlite3 data/freellm.db ".headers on" ".mode csv" \
  ".output /tmp/admin_users.csv" "SELECT * FROM admin_users;"
# 对每张表重复...

# 2. 用 \copy 导入 Postgres
psql 'postgresql://user:password@host:5432/freellm' \
  -c "\copy admin_users FROM '/tmp/admin_users.csv' WITH (FORMAT csv, HEADER true);"
```

**自动化做法**（Tick 22 v1.4.1.0 引入 `scripts/migrate-sqlite-to-postgres.ts`）：

```bash
# 1) 干跑 —— 仅读源库 + 统计每表行数，不写目标库
SQLITE_URL='file:./data/freellm.db' \
POSTGRES_URL='postgresql://user:pass@host:5432/freellm' \
  pnpm tsx scripts/migrate-sqlite-to-postgres.ts --dry-run

# 2) 真跑 —— 按外键依赖顺序逐表 SELECT * → batch createMany
SQLITE_URL='file:./data/freellm.db' \
POSTGRES_URL='postgresql://user:pass@host:5432/freellm' \
  pnpm tsx scripts/migrate-sqlite-to-postgres.ts

# 默认批量 500 行；可用 --batch 调整
pnpm tsx scripts/migrate-sqlite-to-postgres.ts --batch 1000
```

脚本特性：

- 按 17 张表的外键依赖顺序（AdminUser → Session → Organization → Project → Provider → UpstreamKey → ... → Setting）逐表迁移。
- 完整性校验：每张表迁完比对源 vs 目标行数；任一不一致即报错退出。
- 进度条 + 统计输出：实时显示当前正在迁的表 + 总进度，最终输出每表读写行数 + 耗时。
- 失败时已完成的表保留；重跑前建议先 TRUNCATE 目标库（`skipDuplicates: true` 处理重跑安全）。
- 内部用 `Prisma.createMany` —— 受 SQLite 适配限制，**实际生产建议先 `prisma generate --schema schema.postgres.prisma` 切到 PG client 再跑**。

> 局限：当前脚本走单一 Prisma client（受 schema 二选一约束）；大数据集（> 数百万行）建议使用 `pg_dump` / `pg_restore` 配合 SQL 适配层。脚本主要面向开发与中小生产数据集。

## 跨实例 SSE 广播验证（Tick 22 v1.4.1.0）

多实例部署时启用 Redis Pub/Sub 后，事件总线自动跨进程广播。验证步骤：

```bash
# 1) 启用 Redis 后端（两实例同环境）
export FREELLM_REDIS_URL='redis://default:password@redis-host:6379/0'

# 2) 起两个 API 实例（不同端口）
FREELLM_API_PORT=3001 pnpm dev:api &
FREELLM_API_PORT=3002 pnpm dev:api &

# 3) 实例 A 接收 SSE 流
curl -sN -b /tmp/cookies.txt http://127.0.0.1:3001/admin/events > /tmp/a.sse &

# 4) 实例 B 触发一次 model:added 事件（用 admin/models/refresh 走 mock provider 即可）
curl -X POST -b /tmp/cookies.txt http://127.0.0.1:3002/admin/models/refresh

# 5) 检查 /tmp/a.sse 是否收到了 model:added 事件（即跨实例广播生效）
grep "event: model:" /tmp/a.sse
```

预期：实例 A 的 SSE 流里出现实例 B 的 emit 事件。若未出现：

- 检查 `journalctl -u freellm-api -n 50` 看是否有 `event-bus-redis: 跨实例广播已启用` 日志
- 检查 ioredis 是否已装：`cd /opt/freellm && pnpm ls ioredis`
- 检查 Redis 连接是否正常：`redis-cli -u $FREELLM_REDIS_URL ping`

**关键表迁移顺序**（避免外键失败）：

1. `admin_users`
2. `sessions`（依赖 admin_users）
3. `organizations`
4. `projects`（依赖 organizations）
5. `providers`
6. `upstream_keys`（依赖 providers）
7. `models`（依赖 providers）
8. `model_snapshots`（依赖 providers + models）
9. `model_scores`（依赖 models）
10. `routing_policies`
11. `cooldowns`（独立）
12. `virtual_keys`（依赖 projects）
13. `request_logs`（依赖 virtual_keys + organizations + projects）
14. `route_attempts`（依赖 request_logs）
15. `error_events`
16. `health_checks`
17. `settings`

### 四、切换运行时配置

```bash
# 在 /opt/freellm/.env 或 docker-compose env 中
DATABASE_URL='postgresql://user:password@host:5432/freellm'
```

重启 API：

```bash
sudo systemctl restart freellm-api
# 或
docker compose restart api
```

公网 IP 实测：

```bash
curl -s "http://<server>:28000/health" | head -3
```

应仍返回 `{"ok":true,"service":"freellm-api","version":"1.4.0.0",...}`。

### 五、回滚预案

若发现新 Postgres 部署异常：

1. 立即把 `DATABASE_URL` 改回 `file:../data/freellm.db`
2. 重启 API
3. SQLite 文件未被本次迁移修改（导出是只读），可直接接管流量
4. Postgres 库保留以便排查；下次迁移前 `DROP DATABASE freellm; CREATE DATABASE freellm;` 重建

## 配合 Redis 共享速率限制

Postgres 解决数据持久化；多实例水平扩还需要 Redis 共享 RPM 桶 / 冷却记录。

设置环境变量启用：

```bash
FREELLM_REDIS_URL='redis://default:password@host:6379/0'
```

API 启动时会自动检测：

- 未设此变量 → 走进程内存（单实例足够）
- 已设且 `ioredis` 已安装 → 走 Redis（跨实例共享）
- 已设但 `ioredis` 未安装 → console.warn 回落内存

详见 `apps/api/src/lib/kv-store.ts` 注释。

## 已知限制 / 后续 tick 处理

- `scripts/migrate-sqlite-to-postgres.ts` 自动迁移工具留 v1.4.x 后续 tick 补完，本 tick 仅提供 schema 文件 + 手动步骤文档。
- 当前 Prisma 客户端只能同时 generate 一个 provider 的 schema；切回 SQLite 需重新 `prisma generate --schema prisma/schema.prisma`。
- `request_logs` 在 Postgres 下推荐配 TimescaleDB 或 pg_partman 分区，单表千万行后查询性能仍可控。
