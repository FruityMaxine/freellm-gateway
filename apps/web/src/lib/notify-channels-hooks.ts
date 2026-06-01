/**
 * 告警通知渠道 hooks（组 8 Tick 5 v1.27.0.0）。
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export interface NotifyChannelRow {
  id: string;
  name: string;
  type: string;
  target: string;
  enabled: boolean;
  createdAt: string;
}

export function useNotifyChannels() {
  return useQuery({
    queryKey: ['notify-channels'],
    queryFn: async (): Promise<{ channels: NotifyChannelRow[] }> => {
      const { data } = await api.get('/admin/notify-channels');
      return data;
    },
  });
}

export function useCreateNotifyChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { name: string; type: string; target: string }) => {
      const { data } = await api.post('/admin/notify-channels', body);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notify-channels'] }),
  });
}

export function useUpdateNotifyChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, unknown> }) => {
      const { data } = await api.patch(`/admin/notify-channels/${id}`, patch);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notify-channels'] }),
  });
}

export function useDeleteNotifyChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.delete(`/admin/notify-channels/${id}`);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notify-channels'] }),
  });
}

export function useTestNotifyChannel() {
  return useMutation({
    mutationFn: async (id: string): Promise<{ ok: boolean; detail: string }> => {
      const { data } = await api.post(`/admin/notify-channels/${id}/test`);
      return data;
    },
  });
}
