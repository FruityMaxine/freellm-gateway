/**
 * Organization service (Tick 19 v1.3.0.0)。
 *
 * 多租户最外层划分：一个 Organization 含多个 Project；Project 含多个 VirtualKey。
 * 本服务只做 CRUD + slug 校验；rate limit / webhook 等留 v1.3 后期 tick。
 *
 * slug 规则（与 GitHub / Vercel 习惯对齐）：
 * - 全局唯一（Prisma `@unique`）
 * - 仅小写字母 / 数字 / 连字符
 * - 长度 [2, 48]
 * - 不能以连字符开头 / 结尾
 */
import type { Organization, PrismaClient } from '@prisma/client';
import { FreeLLMError } from '@freellm/shared';

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,46}[a-z0-9]$/;

export interface CreateOrganizationInput {
  name: string;
  slug: string;
  billingEmail?: string | null;
  /** Tick 20 v1.3.1.0：组织级 RPM 上限（null = 无限制）。 */
  rpmLimit?: number | null;
}

export interface UpdateOrganizationInput {
  name?: string;
  slug?: string;
  billingEmail?: string | null;
  rpmLimit?: number | null;
}

export class OrganizationService {
  constructor(private readonly prisma: PrismaClient) {}

  validateSlug(slug: string): void {
    if (!SLUG_PATTERN.test(slug)) {
      throw new FreeLLMError(
        'bad_request',
        '组织 slug 仅允许小写字母 / 数字 / 连字符，长度 2-48 且不能以连字符开头或结尾',
      );
    }
  }

  async list(): Promise<Organization[]> {
    return this.prisma.organization.findMany({
      orderBy: { createdAt: 'asc' },
    });
  }

  async listWithProjects() {
    return this.prisma.organization.findMany({
      orderBy: { createdAt: 'asc' },
      include: { projects: { orderBy: { createdAt: 'asc' } } },
    });
  }

  async findById(id: string): Promise<Organization | null> {
    return this.prisma.organization.findUnique({ where: { id } });
  }

  async findBySlug(slug: string): Promise<Organization | null> {
    return this.prisma.organization.findUnique({ where: { slug } });
  }

  async create(input: CreateOrganizationInput): Promise<Organization> {
    this.validateSlug(input.slug);
    const existing = await this.prisma.organization.findUnique({ where: { slug: input.slug } });
    if (existing) {
      throw new FreeLLMError('bad_request', `组织 slug "${input.slug}" 已被占用`);
    }
    return this.prisma.organization.create({
      data: {
        name: input.name.trim(),
        slug: input.slug,
        billingEmail: input.billingEmail ?? null,
        ...(input.rpmLimit !== undefined ? { rpmLimit: input.rpmLimit } : {}),
      },
    });
  }

  async update(id: string, input: UpdateOrganizationInput): Promise<Organization> {
    if (input.slug !== undefined) {
      this.validateSlug(input.slug);
      const conflict = await this.prisma.organization.findFirst({
        where: { slug: input.slug, NOT: { id } },
      });
      if (conflict) {
        throw new FreeLLMError('bad_request', `组织 slug "${input.slug}" 已被占用`);
      }
    }
    const updated = await this.prisma.organization.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.slug !== undefined ? { slug: input.slug } : {}),
        ...(input.billingEmail !== undefined ? { billingEmail: input.billingEmail } : {}),
        ...(input.rpmLimit !== undefined ? { rpmLimit: input.rpmLimit } : {}),
      },
    });
    return updated;
  }

  /**
   * 删除组织 → cascade 删除其所有 Project（Prisma schema `onDelete: Cascade`）。
   * VirtualKey 的 projectId 是 nullable `SetNull`，所以 VK 不会被删除，仅切断归属。
   */
  async delete(id: string): Promise<void> {
    await this.prisma.organization.delete({ where: { id } });
  }
}
