/**
 * Playground 历史会话服务（Tick 36 v1.7.8.0 引入）。
 *
 * 访客打开 /playground → 浏览器本地生成持久化 ownerId (cuid)，所有 CRUD 凭 ownerId
 * 做所有权校验。无账号体系：丢失 localStorage 即丢失历史（设计取舍：访客匿名）。
 *
 * messagesJson 是完整 chat 数组（role + content）的 JSON.stringify；追加新消息时
 * 整段重写（适合 ≤ 50 轮的 Playground 量级；超大量需要 messages 子表）。
 */
import type { PrismaClient, PlaygroundSession } from '@prisma/client';
import { FreeLLMError } from '@freellm/shared';

const MAX_NAME_LEN = 80;
const MAX_MESSAGES_BYTES = 256 * 1024; // 256 KB JSON cap

export interface PlaygroundMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** 助手回复时记的简要 attempt 信息（model + duration），可选。 */
  meta?: { upstreamModel?: string; durationMs?: number };
}

export interface CreateSessionInput {
  ownerId: string;
  name?: string;
  messages?: PlaygroundMessage[];
  demoVkPrefix?: string;
}

export interface UpdateSessionInput {
  name?: string;
  messages?: PlaygroundMessage[];
  demoVkPrefix?: string;
}

export class PlaygroundSessionService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(ownerId: string, limit = 50): Promise<PlaygroundSession[]> {
    return this.prisma.playgroundSession.findMany({
      where: { ownerId },
      orderBy: { lastMessageAt: 'desc' },
      take: Math.min(limit, 200),
    });
  }

  async findByIdForOwner(id: string, ownerId: string): Promise<PlaygroundSession | null> {
    const row = await this.prisma.playgroundSession.findUnique({ where: { id } });
    if (!row || row.ownerId !== ownerId) return null;
    return row;
  }

  async create(input: CreateSessionInput): Promise<PlaygroundSession> {
    if (!input.ownerId.trim()) {
      throw new FreeLLMError('bad_request', 'ownerId 必填');
    }
    const messages = input.messages ?? [];
    const name = (input.name ?? deriveNameFromMessages(messages)).slice(0, MAX_NAME_LEN) || '新对话';
    const messagesJson = JSON.stringify(messages);
    if (messagesJson.length > MAX_MESSAGES_BYTES) {
      throw new FreeLLMError('bad_request', '会话消息过大（>256 KB），请新建会话');
    }
    return this.prisma.playgroundSession.create({
      data: {
        ownerId: input.ownerId,
        name,
        messagesJson,
        demoVkPrefix: input.demoVkPrefix ?? null,
        lastMessageAt: new Date(),
      },
    });
  }

  async update(
    id: string,
    ownerId: string,
    input: UpdateSessionInput,
  ): Promise<PlaygroundSession> {
    const existing = await this.findByIdForOwner(id, ownerId);
    if (!existing) {
      throw new FreeLLMError('not_found', '会话不存在或无权访问');
    }
    const data: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) {
      data.name = input.name.slice(0, MAX_NAME_LEN) || existing.name;
    }
    if (input.messages !== undefined) {
      const messagesJson = JSON.stringify(input.messages);
      if (messagesJson.length > MAX_MESSAGES_BYTES) {
        throw new FreeLLMError('bad_request', '会话消息过大（>256 KB），请新建会话');
      }
      data.messagesJson = messagesJson;
      data.lastMessageAt = new Date();
    }
    if (input.demoVkPrefix !== undefined) {
      data.demoVkPrefix = input.demoVkPrefix;
    }
    return this.prisma.playgroundSession.update({ where: { id }, data });
  }

  async delete(id: string, ownerId: string): Promise<void> {
    const existing = await this.findByIdForOwner(id, ownerId);
    if (!existing) {
      throw new FreeLLMError('not_found', '会话不存在或无权访问');
    }
    await this.prisma.playgroundSession.delete({ where: { id } });
  }

  /**
   * 旧记录回收：> daysOld 天的 session 全清。可由 cron 调度。
   */
  async purgeOlderThan(daysOld: number): Promise<number> {
    const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60_000);
    const result = await this.prisma.playgroundSession.deleteMany({
      where: { lastMessageAt: { lt: cutoff } },
    });
    return result.count;
  }
}

export function deriveNameFromMessages(messages: PlaygroundMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user');
  if (!firstUser) return '新对话';
  return firstUser.content.replace(/\s+/g, ' ').trim().slice(0, 60) || '新对话';
}

/** 解析 messagesJson 安全 fallback。 */
export function parseMessages(json: string): PlaygroundMessage[] {
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (m): m is PlaygroundMessage =>
        m &&
        typeof m === 'object' &&
        typeof (m as PlaygroundMessage).role === 'string' &&
        typeof (m as PlaygroundMessage).content === 'string',
    );
  } catch {
    return [];
  }
}
