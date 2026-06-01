/**
 * FreeLLM dev seed.
 * Idempotent: safe to run repeatedly. Creates the admin user, baseline settings,
 * default routing policy, and the synthetic mock provider so `/v1/chat/completions`
 * has somewhere to route in mock mode.
 */
import { PrismaClient } from '@prisma/client';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const prisma = new PrismaClient();

// scrypt-based password hasher kept inline so the seed has no workspace dependency at install time.
// The runtime auth plugin (Tick 5) will switch to bcrypt; the format we write here is recognized
// by the runtime as `scrypt$<salt>$<hash>` for forward-compat verification.
function hashPasswordScrypt(plain: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(plain, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPasswordScrypt(plain: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(plain, salt, 64);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function upsertSetting(key: string, value: unknown, category = 'general') {
  await prisma.setting.upsert({
    where: { key },
    update: { value: JSON.stringify(value), category },
    create: { key, value: JSON.stringify(value), category },
  });
}

async function main() {
  const adminUsername = process.env.FREELLM_ADMIN_USERNAME ?? 'admin';
  const adminPassword = process.env.FREELLM_ADMIN_PASSWORD ?? 'ChangeMe_OnFirstLogin';

  // 1) admin user
  const existingAdmin = await prisma.adminUser.findUnique({ where: { username: adminUsername } });
  if (!existingAdmin) {
    await prisma.adminUser.create({
      data: {
        username: adminUsername,
        passwordHash: hashPasswordScrypt(adminPassword),
      },
    });
    console.info(`[seed] created admin user: ${adminUsername}`);
  } else {
    if (!verifyPasswordScrypt(adminPassword, existingAdmin.passwordHash)) {
      console.info(`[seed] admin user '${adminUsername}' exists; password unchanged`);
    } else {
      console.info(`[seed] admin user '${adminUsername}' exists; password matches env`);
    }
  }

  // 2) baseline settings (Admin UI can override these later)
  await upsertSetting('model.discovery.intervalMinutes', 30, 'discovery');
  await upsertSetting('routing.maxAttempts', 4, 'routing');
  await upsertSetting('routing.allowPaidFallback', false, 'routing');
  await upsertSetting('logging.promptDigest', true, 'logging');
  await upsertSetting('logging.fullPrompt', false, 'logging');
  await upsertSetting('upstream.requestTimeoutMs', 60_000, 'upstream');
  console.info('[seed] baseline settings upserted');

  // 3) default routing policy
  await prisma.routingPolicy.upsert({
    where: { name: 'default-auto-best-free' },
    update: {},
    create: {
      name: 'default-auto-best-free',
      description: 'Built-in policy: auto-select the best currently-free model with fallback.',
      isDefault: true,
      mode: 'auto-best-free',
      weightsJson: JSON.stringify({
        availability: 0.3,
        latency: 0.15,
        rateLimit: 0.2,
        quality: 0.15,
        context: 0.1,
        freshness: 0.05,
        cost: 0,
        stability: 0.05,
      }),
    },
  });
  console.info('[seed] default routing policy ensured');

  // 4) mock provider (always present so the system demos without real keys)
  const mockSlug = 'mock';
  await prisma.provider.upsert({
    where: { slug: mockSlug },
    update: {},
    create: {
      slug: mockSlug,
      kind: 'mock',
      name: 'Mock Provider',
      baseUrl: 'mock://local',
      enabled: true,
      priority: 999,
      compatibleMode: 'openai',
      supportsStreaming: true,
      notes: 'Synthetic provider used for offline demos, CI tests, and fallback drills.',
    },
  });
  console.info('[seed] mock provider ensured');

  // 5) optional OpenRouter provider (only created in skeleton form; key arrives in Tick 3)
  await prisma.provider.upsert({
    where: { slug: 'openrouter' },
    update: {},
    create: {
      slug: 'openrouter',
      kind: 'openrouter',
      name: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      enabled: true,
      priority: 100,
      compatibleMode: 'openai',
      supportsStreaming: true,
      notes: 'OpenRouter aggregator; free models discovered via Model Discovery Service (Tick 3).',
    },
  });
  console.info('[seed] openrouter provider scaffold ensured');

  // 6) Tick 19 v1.3.0.0：Default Organization + Default Project + backfill 旧 VK 归属
  const defaultOrg = await prisma.organization.upsert({
    where: { slug: 'default' },
    update: {},
    create: {
      name: 'Default Org',
      slug: 'default',
      billingEmail: null,
    },
  });
  console.info('[seed] default organization ensured:', defaultOrg.slug);

  const defaultProject = await prisma.project.upsert({
    where: {
      organizationId_slug: { organizationId: defaultOrg.id, slug: 'default' },
    },
    update: {},
    create: {
      organizationId: defaultOrg.id,
      name: 'Default Project',
      slug: 'default',
    },
  });
  console.info('[seed] default project ensured:', defaultProject.slug);

  // 把所有未归属项目的虚拟密钥 backfill 到 Default Project（不影响显式归属的 key）
  const orphanResult = await prisma.virtualKey.updateMany({
    where: { projectId: null },
    data: { projectId: defaultProject.id },
  });
  if (orphanResult.count > 0) {
    console.info(`[seed] backfill: ${orphanResult.count} 个旧虚拟密钥已归属到 Default Project`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error('[seed] failed:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
