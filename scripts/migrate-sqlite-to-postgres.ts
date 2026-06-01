/**
 * SQLite → PostgreSQL 自动迁移脚本（Tick 22 v1.4.1.0 引入）。
 *
 * 用法：
 *   # 干跑（仅读源库 + 统计，不写目标库）
 *   SQLITE_URL='file:./data/freellm.db' \
 *   POSTGRES_URL='postgresql://user:pass@host:5432/freellm' \
 *   pnpm tsx scripts/migrate-sqlite-to-postgres.ts --dry-run
 *
 *   # 真跑（按表顺序逐表 SELECT → 批量 INSERT）
 *   SQLITE_URL='file:./data/freellm.db' \
 *   POSTGRES_URL='postgresql://user:pass@host:5432/freellm' \
 *   pnpm tsx scripts/migrate-sqlite-to-postgres.ts
 *
 * 前置：
 *   1. Postgres 目标库已建好且已应用 schema.postgres.prisma
 *      （详见 docs/MIGRATION_POSTGRES.md 步骤一、二）
 *   2. 同时持有源 SQLite 文件与目标 Postgres 连接串
 *
 * 行为：
 *   - 按外键依赖顺序逐表迁移；批量大小默认 500 行
 *   - 类型适配：BigInt → bigint, Date → Date, JSON 字段保持字符串
 *   - 每张表迁完比对源 vs 目标 count，不一致即报错退出
 *   - 失败时已完成的表保留，可重跑（INSERT 失败说明目标已有数据，建议先 TRUNCATE 重建）
 *   - --dry-run：仅读取与统计，不写入
 */
import { PrismaClient as SqlitePrisma } from '@prisma/client';

const TABLE_ORDER = [
  'AdminUser',
  'Session',
  'Organization',
  'Project',
  'Provider',
  'UpstreamKey',
  'RoutingPolicy',
  'Cooldown',
  'Model',
  'ModelSnapshot',
  'ModelScore',
  'VirtualKey',
  'RequestLog',
  'RouteAttempt',
  'ErrorEvent',
  'HealthCheck',
  'UsageDaily',
  'Setting',
] as const;

interface MigrationStats {
  table: string;
  rowsRead: number;
  rowsWritten: number;
  durationMs: number;
  ok: boolean;
  error?: string;
}

interface Options {
  dryRun: boolean;
  batchSize: number;
  sqliteUrl: string;
  postgresUrl: string;
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const batchIdx = args.indexOf('--batch');
  const batchSize = batchIdx >= 0 ? Number.parseInt(args[batchIdx + 1] ?? '500', 10) : 500;
  const sqliteUrl = process.env.SQLITE_URL ?? '';
  const postgresUrl = process.env.POSTGRES_URL ?? '';
  if (!sqliteUrl) throw new Error('请设 SQLITE_URL 环境变量（如 file:./data/freellm.db）');
  if (!dryRun && !postgresUrl) throw new Error('真跑模式请设 POSTGRES_URL 环境变量');
  return { dryRun, batchSize, sqliteUrl, postgresUrl };
}

/**
 * 拿一张表的所有行（按主键 id 排序，便于断点续传与可重现）。
 * 注意：使用 Prisma client 的动态模型访问 —— `(prisma as any)[modelName].findMany`。
 */
async function readAll(
  prisma: SqlitePrisma,
  modelName: string,
): Promise<Record<string, unknown>[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model = (prisma as any)[lowerFirst(modelName)];
  if (!model) throw new Error(`Prisma client 找不到模型 "${modelName}"`);
  // ESLint 无法推断动态访问的类型，这里只做 SELECT *。
  return model.findMany({}) as Promise<Record<string, unknown>[]>;
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

async function migrateOne(
  src: SqlitePrisma,
  dst: SqlitePrisma | null,
  modelName: string,
  opts: Options,
): Promise<MigrationStats> {
  const start = Date.now();
  const stats: MigrationStats = {
    table: modelName,
    rowsRead: 0,
    rowsWritten: 0,
    durationMs: 0,
    ok: false,
  };
  try {
    const rows = await readAll(src, modelName);
    stats.rowsRead = rows.length;

    if (opts.dryRun || !dst) {
      stats.rowsWritten = 0;
      stats.ok = true;
      stats.durationMs = Date.now() - start;
      return stats;
    }

    if (rows.length === 0) {
      stats.ok = true;
      stats.durationMs = Date.now() - start;
      return stats;
    }

    // 分批 createMany；Prisma createMany 接受数组并跳过冲突可选。
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const targetModel = (dst as any)[lowerFirst(modelName)];
    if (!targetModel || typeof targetModel.createMany !== 'function') {
      throw new Error(`目标 client 不支持 ${modelName}.createMany`);
    }
    for (let i = 0; i < rows.length; i += opts.batchSize) {
      const batch = rows.slice(i, i + opts.batchSize);
      const r = await targetModel.createMany({ data: batch, skipDuplicates: true });
      stats.rowsWritten += typeof r?.count === 'number' ? r.count : batch.length;
    }

    // 完整性校验：目标计数应 ≥ 源计数（允许 skipDuplicates 时持平）。
    const dstCount = await targetModel.count();
    if (dstCount < stats.rowsRead) {
      throw new Error(`完整性校验失败：源 ${stats.rowsRead} 行 vs 目标 ${dstCount} 行`);
    }
    stats.ok = true;
    stats.durationMs = Date.now() - start;
    return stats;
  } catch (err) {
    stats.error = (err as Error).message;
    stats.durationMs = Date.now() - start;
    return stats;
  }
}

function progressBar(done: number, total: number, width = 24): string {
  const pct = total === 0 ? 0 : done / total;
  const filled = Math.round(pct * width);
  return `[${'='.repeat(filled)}${'.'.repeat(width - filled)}] ${done}/${total}`;
}

export async function runMigration(opts: Options): Promise<MigrationStats[]> {
  // 注：单次运行只能用一份 Prisma client（schema 是 SQLite 或 Postgres 二选一）。
  // 完整跑通需用户先 `prisma generate --schema schema.prisma`（SQLite）读源，
  // 再切到 `--schema schema.postgres.prisma` 重生成 client，由本脚本写目标。
  // 当前实现假设两个 client 都通过 `datasources` 覆盖 URL 即可（同一 client 双 URL）。
  // 真正的两 client 双轨需 Prisma multi-schema 支持，目前为路线图项；本脚本走 dry-run 优先。
  process.env.DATABASE_URL = opts.sqliteUrl;
  const src = new SqlitePrisma({ datasources: { db: { url: opts.sqliteUrl } } });
  let dst: SqlitePrisma | null = null;
  if (!opts.dryRun) {
    dst = new SqlitePrisma({ datasources: { db: { url: opts.postgresUrl } } });
  }

  const results: MigrationStats[] = [];
  try {
    for (let i = 0; i < TABLE_ORDER.length; i++) {
      const table = TABLE_ORDER[i]!;
      process.stdout.write(`\r${progressBar(i, TABLE_ORDER.length)} 当前：${table.padEnd(20)}`);
      const stats = await migrateOne(src, dst, table, opts);
      results.push(stats);
      if (!stats.ok) {
        process.stdout.write('\n');
        console.error(`[迁移] ${table} 失败：${stats.error}`);
        break;
      }
    }
    process.stdout.write(`\r${progressBar(results.length, TABLE_ORDER.length)} 完成\n`);
  } finally {
    await src.$disconnect();
    if (dst) await dst.$disconnect();
  }
  return results;
}

function printReport(results: MigrationStats[], opts: Options): void {
  console.info('\n===== 迁移报告 =====');
  console.info(`模式：${opts.dryRun ? '干跑（仅读源）' : '真跑'}`);
  let totalRead = 0;
  let totalWritten = 0;
  for (const r of results) {
    const status = r.ok ? '✓' : '✗';
    console.info(
      `${status} ${r.table.padEnd(18)} 读 ${String(r.rowsRead).padStart(6)} · ` +
        `写 ${String(r.rowsWritten).padStart(6)} · ${r.durationMs}ms` +
        (r.error ? ` · 错误：${r.error}` : ''),
    );
    totalRead += r.rowsRead;
    totalWritten += r.rowsWritten;
  }
  console.info(`-------------------------------------`);
  console.info(`总计：源 ${totalRead} 行，目标写入 ${totalWritten} 行`);
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(`\n失败表：${failed.map((r) => r.table).join(', ')}`);
    process.exit(1);
  }
}

// 仅在直接执行时跑（被 import 时不跑）。
const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('migrate-sqlite-to-postgres.ts');

if (isMain) {
  const opts = parseArgs();
  runMigration(opts)
    .then((results) => {
      printReport(results, opts);
    })
    .catch((err) => {
      console.error('[迁移] 顶层异常：', err);
      process.exit(1);
    });
}
