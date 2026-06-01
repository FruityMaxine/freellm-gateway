/**
 * 模型快照历史 hooks（组 8 Tick 3 v1.25.0.0）。
 */
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export interface SnapshotModelRow {
  modelId: string | null;
  upstreamId: string;
  snapshotCount: number;
}

export interface SnapshotChange {
  fromTakenAt: string;
  toTakenAt: string;
  capsAdded: string[];
  capsRemoved: string[];
  contextFrom: number;
  contextTo: number;
  freeFrom: boolean;
  freeTo: boolean;
}

export interface SnapshotTimeline {
  total: number;
  snapshots: Array<{ takenAt: string; isFree: boolean; contextLength: number }>;
  changes: SnapshotChange[];
}

export function useSnapshotModels() {
  return useQuery({
    queryKey: ['snapshot-models'],
    queryFn: async (): Promise<{ models: SnapshotModelRow[] }> => {
      const { data } = await api.get('/admin/model-snapshots/models');
      return data;
    },
  });
}

export function useSnapshotHistory(modelId: string | null) {
  return useQuery({
    queryKey: ['snapshot-history', modelId],
    queryFn: async (): Promise<SnapshotTimeline> => {
      const { data } = await api.get('/admin/model-snapshots', { params: { modelId } });
      return data;
    },
    enabled: !!modelId,
  });
}
