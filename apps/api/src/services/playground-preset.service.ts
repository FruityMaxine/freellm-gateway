/**
 * Playground 配置预设服务（Tick 45 v1.7.17.0 引入）。
 *
 * 与 Tick 36 PlaygroundSession 同构：访客 ownerId（localStorage cuid）做所有权校验，
 * 跨 owner 视为 404。预设含 system prompt + 模型偏好 + 温度等参数，方便保存常用配置。
 */
import type { PrismaClient, PlaygroundPreset } from '@prisma/client';
import { FreeLLMError } from '@freellm/shared';

const MAX_NAME_LEN = 80;
const MAX_PROMPT_LEN = 16 * 1024;
const MAX_NOTES_LEN = 1024;

export interface CreatePresetInput {
  ownerId: string;
  name: string;
  systemPrompt?: string | null;
  preferredModel?: string | null;
  temperature?: number | null;
  maxTokens?: number | null;
  streaming?: boolean;
  notes?: string | null;
}

export interface UpdatePresetInput {
  name?: string;
  systemPrompt?: string | null;
  preferredModel?: string | null;
  temperature?: number | null;
  maxTokens?: number | null;
  streaming?: boolean;
  notes?: string | null;
}

export class PlaygroundPresetService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(ownerId: string): Promise<PlaygroundPreset[]> {
    return this.prisma.playgroundPreset.findMany({
      where: { ownerId },
      orderBy: [{ lastUsedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    });
  }

  async findByIdForOwner(id: string, ownerId: string): Promise<PlaygroundPreset | null> {
    const row = await this.prisma.playgroundPreset.findUnique({ where: { id } });
    if (!row || row.ownerId !== ownerId) return null;
    return row;
  }

  async create(input: CreatePresetInput): Promise<PlaygroundPreset> {
    if (!input.ownerId.trim()) {
      throw new FreeLLMError('bad_request', 'ownerId 必填');
    }
    if (!input.name.trim()) {
      throw new FreeLLMError('bad_request', 'name 必填');
    }
    validatePromptLen(input.systemPrompt);
    validateNotesLen(input.notes);
    validateTemperature(input.temperature);

    return this.prisma.playgroundPreset.create({
      data: {
        ownerId: input.ownerId,
        name: input.name.slice(0, MAX_NAME_LEN),
        systemPrompt: input.systemPrompt ?? null,
        preferredModel: input.preferredModel ?? null,
        temperature: input.temperature ?? null,
        maxTokens: input.maxTokens ?? null,
        streaming: input.streaming ?? true,
        notes: input.notes ?? null,
      },
    });
  }

  async update(id: string, ownerId: string, input: UpdatePresetInput): Promise<PlaygroundPreset> {
    const existing = await this.findByIdForOwner(id, ownerId);
    if (!existing) {
      throw new FreeLLMError('not_found', '预设不存在或无权访问');
    }
    if (input.systemPrompt !== undefined) validatePromptLen(input.systemPrompt);
    if (input.notes !== undefined) validateNotesLen(input.notes);
    if (input.temperature !== undefined) validateTemperature(input.temperature);

    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name.slice(0, MAX_NAME_LEN);
    if (input.systemPrompt !== undefined) data.systemPrompt = input.systemPrompt;
    if (input.preferredModel !== undefined) data.preferredModel = input.preferredModel;
    if (input.temperature !== undefined) data.temperature = input.temperature;
    if (input.maxTokens !== undefined) data.maxTokens = input.maxTokens;
    if (input.streaming !== undefined) data.streaming = input.streaming;
    if (input.notes !== undefined) data.notes = input.notes;
    return this.prisma.playgroundPreset.update({ where: { id }, data });
  }

  async delete(id: string, ownerId: string): Promise<void> {
    const existing = await this.findByIdForOwner(id, ownerId);
    if (!existing) {
      throw new FreeLLMError('not_found', '预设不存在或无权访问');
    }
    await this.prisma.playgroundPreset.delete({ where: { id } });
  }

  /** 把 lastUsedAt 戳到当前时间（访客应用预设时调用）。 */
  async markUsed(id: string, ownerId: string): Promise<PlaygroundPreset> {
    const existing = await this.findByIdForOwner(id, ownerId);
    if (!existing) {
      throw new FreeLLMError('not_found', '预设不存在或无权访问');
    }
    return this.prisma.playgroundPreset.update({
      where: { id },
      data: { lastUsedAt: new Date() },
    });
  }
}

function validatePromptLen(prompt: string | null | undefined): void {
  if (prompt && prompt.length > MAX_PROMPT_LEN) {
    throw new FreeLLMError('bad_request', `system prompt 过长（>${MAX_PROMPT_LEN} 字符）`);
  }
}

function validateNotesLen(notes: string | null | undefined): void {
  if (notes && notes.length > MAX_NOTES_LEN) {
    throw new FreeLLMError('bad_request', `notes 过长（>${MAX_NOTES_LEN} 字符）`);
  }
}

function validateTemperature(temp: number | null | undefined): void {
  if (temp === undefined || temp === null) return;
  if (temp < 0 || temp > 2) {
    throw new FreeLLMError('bad_request', `temperature 必须在 0-2 范围内`);
  }
}
