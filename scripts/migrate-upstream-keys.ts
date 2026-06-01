/**
 * 一次性迁移：把 upstream_keys.cipherText 里的 `plain:<key>` 明文降级记录
 * 重新用 FREELLM_MASTER_KEY 加密成 `v1:iv:tag:ct`，消除 DB 中的明文 key。
 *
 * 组 4 Tick 2 v1.8.0.0。read 三格式已能直接读 plain:（真实 LLM 不靠本脚本就已打通），
 * 本脚本是安全加固——让静态 DB 不再残留明文上游 key。
 *
 * 用法（先备份 DB！）：
 *   cp /opt/freellm/data/freellm.db /opt/freellm/data/freellm.db.bak-$(date +%s)
 *   DATABASE_URL="file:/opt/freellm/data/freellm.db" \
 *   FREELLM_MASTER_KEY="<同 .env 的 master key>" \
 *   .venv/bin/tsx scripts/migrate-upstream-keys.ts   # scripts/ 不在 tsc include，只能 tsx 跑
 *
 * 幂等：已是 v1:/pending: 的行跳过；只处理 plain: 前缀。
 */
import { PrismaClient } from '@prisma/client';
import { encryptSecret } from '@freellm/shared';

async function main(): Promise<void> {
  const masterKey = process.env.FREELLM_MASTER_KEY;
  if (!masterKey || masterKey.trim().length < 32) {
    throw new Error('FREELLM_MASTER_KEY 缺失或过短（需 ≥32 字节 base64/hex），中止迁移');
  }
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.upstreamKey.findMany({
      select: { id: true, label: true, cipherText: true },
    });
    let migrated = 0;
    let skipped = 0;
    for (const row of rows) {
      if (!row.cipherText.startsWith('plain:')) {
        skipped++;
        continue;
      }
      const plain = row.cipherText.slice('plain:'.length);
      if (!plain) {
        skipped++;
        continue;
      }
      const blob = encryptSecret(plain, masterKey, { aad: `upstream_key:${row.id}` });
      await prisma.upstreamKey.update({ where: { id: row.id }, data: { cipherText: blob } });
      migrated++;
      // 只打印 label 与 id，绝不打印 key 明文
      console.log(`  migrated upstream_key:${row.id} (label=${row.label}) plain → v1 cipher`);
    }
    console.log(`\n迁移完成：${migrated} 条 plain→cipher，${skipped} 条已是密文/占位跳过。`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('迁移失败：', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
