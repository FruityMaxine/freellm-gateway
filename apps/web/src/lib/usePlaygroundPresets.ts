/**
 * Playground 预设 TanStack 钩子（Tick 45 v1.7.17.0）。
 *
 * 与 `/public/playground/presets/*` 公开端点交互。
 * ownerId 复用 Tick 36 `useOrCreateOwnerId` 持久化的 cuid。
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export interface PlaygroundPresetRow {
  id: string;
  name: string;
  systemPrompt: string | null;
  preferredModel: string | null;
  temperature: number | null;
  maxTokens: number | null;
  streaming: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
}

export interface CreatePresetInput {
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

export function usePlaygroundPresets(ownerId: string) {
  return useQuery({
    queryKey: ['playground', 'presets', ownerId],
    enabled: !!ownerId,
    queryFn: async (): Promise<{ data: PlaygroundPresetRow[]; total: number }> => {
      const res = await api.get('/public/playground/presets', { params: { owner: ownerId } });
      return res.data;
    },
    staleTime: 60_000,
  });
}

export function useCreatePlaygroundPreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      ownerId: string;
      input: CreatePresetInput;
    }): Promise<{ ok: true; preset: PlaygroundPresetRow }> => {
      const res = await api.post('/public/playground/presets', {
        ownerId: args.ownerId,
        ...args.input,
      });
      return res.data;
    },
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: ['playground', 'presets', vars.ownerId] });
    },
  });
}

export function useUpdatePlaygroundPreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      id: string;
      ownerId: string;
      input: UpdatePresetInput;
    }): Promise<{ ok: true; preset: PlaygroundPresetRow }> => {
      const res = await api.patch(`/public/playground/presets/${args.id}`, args.input, {
        params: { owner: args.ownerId },
      });
      return res.data;
    },
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: ['playground', 'presets', vars.ownerId] });
    },
  });
}

export function useDeletePlaygroundPreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; ownerId: string }) => {
      const res = await api.delete(`/public/playground/presets/${args.id}`, {
        params: { owner: args.ownerId },
      });
      return res.data;
    },
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: ['playground', 'presets', vars.ownerId] });
    },
  });
}

export function useMarkPresetUsed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; ownerId: string }) => {
      const res = await api.post(`/public/playground/presets/${args.id}/mark-used`, undefined, {
        params: { owner: args.ownerId },
      });
      return res.data;
    },
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: ['playground', 'presets', vars.ownerId] });
    },
  });
}
