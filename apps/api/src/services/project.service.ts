/**
 * Project service (Tick 19 v1.3.0.0)。
 *
 * Project 归属到 Organization；VirtualKey 归属到 Project。
 * slug 在 Organization 范围内唯一（不强制全局唯一）。
 */
import type { Project, PrismaClient } from '@prisma/client';
import { FreeLLMError } from '@freellm/shared';

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,46}[a-z0-9]$/;

export interface CreateProjectInput {
  organizationId: string;
  name: string;
  slug: string;
}

export interface UpdateProjectInput {
  name?: string;
  slug?: string;
}

export class ProjectService {
  constructor(private readonly prisma: PrismaClient) {}

  validateSlug(slug: string): void {
    if (!SLUG_PATTERN.test(slug)) {
      throw new FreeLLMError(
        'bad_request',
        '项目 slug 仅允许小写字母 / 数字 / 连字符，长度 2-48 且不能以连字符开头或结尾',
      );
    }
  }

  async list(filter?: { organizationId?: string }): Promise<Project[]> {
    return this.prisma.project.findMany({
      where: filter?.organizationId ? { organizationId: filter.organizationId } : {},
      orderBy: { createdAt: 'asc' },
    });
  }

  async findById(id: string): Promise<Project | null> {
    return this.prisma.project.findUnique({ where: { id } });
  }

  async findBySlug(organizationId: string, slug: string): Promise<Project | null> {
    return this.prisma.project.findUnique({
      where: { organizationId_slug: { organizationId, slug } },
    });
  }

  async create(input: CreateProjectInput): Promise<Project> {
    this.validateSlug(input.slug);
    const org = await this.prisma.organization.findUnique({ where: { id: input.organizationId } });
    if (!org) {
      throw new FreeLLMError('not_found', `组织 ${input.organizationId} 不存在`);
    }
    const conflict = await this.prisma.project.findUnique({
      where: { organizationId_slug: { organizationId: input.organizationId, slug: input.slug } },
    });
    if (conflict) {
      throw new FreeLLMError('bad_request', `项目 slug "${input.slug}" 在该组织内已被占用`);
    }
    return this.prisma.project.create({
      data: {
        organizationId: input.organizationId,
        name: input.name.trim(),
        slug: input.slug,
      },
    });
  }

  async update(id: string, input: UpdateProjectInput): Promise<Project> {
    const existing = await this.prisma.project.findUnique({ where: { id } });
    if (!existing) throw new FreeLLMError('not_found', `项目 ${id} 不存在`);

    if (input.slug !== undefined) {
      this.validateSlug(input.slug);
      const conflict = await this.prisma.project.findFirst({
        where: { organizationId: existing.organizationId, slug: input.slug, NOT: { id } },
      });
      if (conflict) {
        throw new FreeLLMError('bad_request', `项目 slug "${input.slug}" 在该组织内已被占用`);
      }
    }
    return this.prisma.project.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.slug !== undefined ? { slug: input.slug } : {}),
      },
    });
  }

  /**
   * 删除 Project。
   * VirtualKey.projectId 通过 schema `onDelete: SetNull` 被切断（不删除 VK），保证审计完整。
   */
  async delete(id: string): Promise<void> {
    await this.prisma.project.delete({ where: { id } });
  }
}
