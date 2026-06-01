/**
 * Tick 20 v1.3.1.0 集成测试：
 * - enforceOrgRpm sliding window 行为
 * - Organization.rpmLimit 字段读写
 * - request_logs 落 organizationId / projectId 列
 * - VirtualKey.resolveBySecretWithTenancy 返回 project + organization 嵌套
 */
import { afterAll, beforeAll, describe, it, expect, beforeEach } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { OrganizationService } from '../src/services/organization.service.js';
import { ProjectService } from '../src/services/project.service.js';
import { VirtualKeyService } from '../src/services/virtual-key.service.js';
import { RequestLoggerService } from '../src/services/request-logger.service.js';
import {
  enforceOrgRpm,
  _resetOrgRpmBuckets,
  _peekOrgRpmBucket,
} from '../src/lib/per-org-limit.js';

const TEST_DB = resolvePath(
  process.cwd().endsWith('/apps/api')
    ? `${process.cwd()}/../../data/freellm-tick20-test.db`
    : `${process.cwd()}/data/freellm-tick20-test.db`,
);

let prisma: PrismaClient;
let orgSvc: OrganizationService;
let projectSvc: ProjectService;
let vkSvc: VirtualKeyService;

beforeAll(async () => {
  for (const ext of ['', '-journal', '-wal', '-shm']) {
    const p = `${TEST_DB}${ext}`;
    if (existsSync(p)) rmSync(p);
  }
  mkdirSync('./data', { recursive: true });
  execSync(
    `DATABASE_URL=\"file:${TEST_DB}\" npx prisma db push --schema prisma/schema.prisma --skip-generate --accept-data-loss`,
    {
      cwd: process.cwd().endsWith('/apps/api') ? `${process.cwd()}/../..` : process.cwd(),
      stdio: 'pipe',
    },
  );
  prisma = new PrismaClient({ datasources: { db: { url: `file:${TEST_DB}` } } });
  orgSvc = new OrganizationService(prisma);
  projectSvc = new ProjectService(prisma);
  vkSvc = new VirtualKeyService(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Tick 20 — enforceOrgRpm sliding window', () => {
  beforeEach(() => {
    _resetOrgRpmBuckets();
  });

  it('null / 0 / undefined limit 视为无限制', () => {
    expect(enforceOrgRpm('org-a', null)).toBe(true);
    expect(enforceOrgRpm('org-a', 0)).toBe(true);
    expect(enforceOrgRpm('org-a', undefined)).toBe(true);
  });

  it('未到上限 +1 命中；到达上限拒绝', () => {
    expect(enforceOrgRpm('org-b', 2)).toBe(true); // 1
    expect(enforceOrgRpm('org-b', 2)).toBe(true); // 2
    expect(enforceOrgRpm('org-b', 2)).toBe(false); // 3 → 拒
    expect(_peekOrgRpmBucket('org-b')?.count).toBe(2);
  });

  it('orgId 为空字符串或 null 视为不强制', () => {
    expect(enforceOrgRpm(null, 1)).toBe(true);
    expect(enforceOrgRpm('', 1)).toBe(true);
  });

  it('不同 orgId 桶互不干扰', () => {
    expect(enforceOrgRpm('org-c', 1)).toBe(true);
    expect(enforceOrgRpm('org-c', 1)).toBe(false);
    expect(enforceOrgRpm('org-d', 1)).toBe(true);
  });
});

describe('Tick 20 — Organization.rpmLimit 字段', () => {
  it('创建组织时可指定 rpmLimit', async () => {
    const org = await orgSvc.create({ name: 'Limit Co', slug: 'limit-co', rpmLimit: 120 });
    expect(org.rpmLimit).toBe(120);
  });

  it('update 可以改 rpmLimit；null 表示无限制', async () => {
    const org = await orgSvc.create({ name: 'Patch Co', slug: 'patch-co' });
    expect(org.rpmLimit).toBeNull();
    const updated = await orgSvc.update(org.id, { rpmLimit: 60 });
    expect(updated.rpmLimit).toBe(60);
    const updated2 = await orgSvc.update(org.id, { rpmLimit: null });
    expect(updated2.rpmLimit).toBeNull();
  });
});

describe('Tick 20 — VK resolveBySecretWithTenancy 嵌套', () => {
  it('返回的 row 含 project + organization', async () => {
    const org = await orgSvc.create({ name: 'Tenancy Co', slug: 'tenancy-co' });
    const proj = await projectSvc.create({ organizationId: org.id, name: 'P1', slug: 'p1' });
    const vk = await vkSvc.create({
      label: 'tenancy-key',
      environment: 'test',
      projectId: proj.id,
      permissions: {
        allowedModels: [],
        deniedModels: [],
        allowedProviders: [],
        maxRequestsPerMinute: null,
        maxRequestsPerDay: null,
        maxTokensPerDay: null,
        allowPaidModels: false,
        allowStreaming: true,
      },
    });
    const resolved = await vkSvc.resolveBySecretWithTenancy(vk.secret);
    expect(resolved).not.toBeNull();
    expect(resolved!.id).toBe(vk.id);
    expect(resolved!.project?.id).toBe(proj.id);
    expect(resolved!.project?.organization?.id).toBe(org.id);
    expect(resolved!.project?.organization?.slug).toBe('tenancy-co');
  });
});

describe('Tick 20 — request_logs 落 organizationId / projectId', () => {
  it('start 时显式传入 → 落库可查', async () => {
    const org = await orgSvc.create({ name: 'Log Co', slug: 'log-co' });
    const proj = await projectSvc.create({ organizationId: org.id, name: 'P', slug: 'lp' });
    const logger = new RequestLoggerService(prisma, { keepDigest: false, keepFull: false });
    const reqId = 'req_tick20_test_1';
    await logger.start({
      requestId: reqId,
      streaming: false,
      messages: [{ role: 'user', content: 'hi' }],
      organizationId: org.id,
      projectId: proj.id,
    });
    const row = await prisma.requestLog.findUnique({ where: { requestId: reqId } });
    expect(row).not.toBeNull();
    expect(row!.organizationId).toBe(org.id);
    expect(row!.projectId).toBe(proj.id);
  });
});
