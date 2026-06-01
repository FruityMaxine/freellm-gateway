/**
 * Tick 19 v1.3.0.0 集成测试：Organization + Project + VirtualKey 归属。
 *
 * 覆盖：
 * - slug 校验（合法 / 非法 / 大小写 / 长度 / 边界连字符）
 * - Organization CRUD + 唯一性冲突
 * - Project CRUD + 组织范围内 slug 唯一
 * - Project 删除时 VK projectId 自动 SetNull（不删除 VK）
 * - Organization 删除时 cascade 删除其所有 Project
 */
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { OrganizationService } from '../src/services/organization.service.js';
import { ProjectService } from '../src/services/project.service.js';
import { VirtualKeyService } from '../src/services/virtual-key.service.js';
import { FreeLLMError } from '@freellm/shared';

const TEST_DB = resolvePath(
  process.cwd().endsWith('/apps/api')
    ? `${process.cwd()}/../../data/freellm-tick19-test.db`
    : `${process.cwd()}/data/freellm-tick19-test.db`,
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

describe('Tick 19 — OrganizationService.validateSlug', () => {
  it('合法 slug 通过', () => {
    expect(() => orgSvc.validateSlug('default')).not.toThrow();
    expect(() => orgSvc.validateSlug('my-org-1')).not.toThrow();
    expect(() => orgSvc.validateSlug('a1')).not.toThrow();
  });

  it('非法 slug 抛 bad_request', () => {
    expect(() => orgSvc.validateSlug('UPPER')).toThrow(FreeLLMError);
    expect(() => orgSvc.validateSlug('with space')).toThrow(FreeLLMError);
    expect(() => orgSvc.validateSlug('-leading')).toThrow(FreeLLMError);
    expect(() => orgSvc.validateSlug('trailing-')).toThrow(FreeLLMError);
    expect(() => orgSvc.validateSlug('a')).toThrow(FreeLLMError); // 太短
    expect(() => orgSvc.validateSlug('a'.repeat(49))).toThrow(FreeLLMError); // 太长
  });
});

describe('Tick 19 — Organization + Project CRUD', () => {
  it('创建组织 + 项目 + 查询', async () => {
    const org = await orgSvc.create({ name: 'Acme Inc', slug: 'acme', billingEmail: 'bills@acme.dev' });
    expect(org.slug).toBe('acme');
    expect(org.name).toBe('Acme Inc');
    expect(org.billingEmail).toBe('bills@acme.dev');

    const project = await projectSvc.create({ organizationId: org.id, name: 'API Gateway', slug: 'api-gw' });
    expect(project.organizationId).toBe(org.id);
    expect(project.slug).toBe('api-gw');

    const listed = await orgSvc.listWithProjects();
    const acme = listed.find((o) => o.id === org.id);
    expect(acme).toBeDefined();
    expect(acme!.projects).toHaveLength(1);
    expect(acme!.projects[0]!.slug).toBe('api-gw');
  });

  it('slug 唯一性冲突拒绝', async () => {
    await expect(
      orgSvc.create({ name: 'Acme 2', slug: 'acme' }),
    ).rejects.toThrow(/slug "acme" 已被占用/);
  });

  it('Project slug 在同 Org 内唯一，跨 Org 可以重名', async () => {
    const org1 = await orgSvc.create({ name: 'OrgA', slug: 'org-a' });
    const org2 = await orgSvc.create({ name: 'OrgB', slug: 'org-b' });
    await projectSvc.create({ organizationId: org1.id, name: 'P', slug: 'shared' });
    await projectSvc.create({ organizationId: org2.id, name: 'P', slug: 'shared' });
    // 第二次同 org 重复应拒
    await expect(
      projectSvc.create({ organizationId: org1.id, name: 'P', slug: 'shared' }),
    ).rejects.toThrow(/在该组织内已被占用/);
  });
});

describe('Tick 19 — VirtualKey 归属项目 + cascade 规则', () => {
  it('创建 VK 时显式指定 projectId，列表反映该字段', async () => {
    const org = await orgSvc.create({ name: 'VK Org', slug: 'vk-org' });
    const proj = await projectSvc.create({ organizationId: org.id, name: 'Default', slug: 'default' });
    const vk = await vkSvc.create({
      label: 'test-key',
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
    const row = await prisma.virtualKey.findUnique({ where: { id: vk.id } });
    expect(row?.projectId).toBe(proj.id);
  });

  it('删除 Project 后，归属 VK 的 projectId 被 SetNull（不删除 VK）', async () => {
    const org = await orgSvc.create({ name: 'SetNull Org', slug: 'setnull-org' });
    const proj = await projectSvc.create({ organizationId: org.id, name: 'P', slug: 'pj' });
    const vk = await vkSvc.create({
      label: 'orphan-target',
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
    await projectSvc.delete(proj.id);
    const row = await prisma.virtualKey.findUnique({ where: { id: vk.id } });
    expect(row).not.toBeNull();
    expect(row!.projectId).toBeNull();
  });

  it('删除 Organization 后，cascade 删除其 Project（VK 仍存留但 projectId=null）', async () => {
    const org = await orgSvc.create({ name: 'Cascade Org', slug: 'cascade-org' });
    const proj = await projectSvc.create({ organizationId: org.id, name: 'P', slug: 'pj' });
    const vk = await vkSvc.create({
      label: 'cascade-target',
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
    await orgSvc.delete(org.id);
    expect(await prisma.organization.findUnique({ where: { id: org.id } })).toBeNull();
    expect(await prisma.project.findUnique({ where: { id: proj.id } })).toBeNull();
    const vkRow = await prisma.virtualKey.findUnique({ where: { id: vk.id } });
    expect(vkRow).not.toBeNull();
    expect(vkRow!.projectId).toBeNull();
  });
});
