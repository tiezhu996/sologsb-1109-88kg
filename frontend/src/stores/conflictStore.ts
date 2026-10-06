import { create } from 'zustand';
import { db } from '../utils/db';
import { resolveConflict } from '../utils/merge';
import type { MergeConflict } from '../types/merge-conflict';

interface ConflictState {
  conflicts: MergeConflict[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  /** 待处理冲突（未决前备份版本不入本机） */
  pending: () => MergeConflict[];
  pendingCount: () => number;
  /** 已处理条数（处理记录持久化，重开仍在） */
  resolvedCount: () => number;
  resolve: (id: string, choice: 'local' | 'incoming') => Promise<void>;
}

export const useConflictStore = create<ConflictState>()((set, get) => ({
  conflicts: [],
  hydrated: false,

  hydrate: async () => {
    const conflicts = await db.conflicts.orderBy('detectedAt').reverse().toArray();
    set({ conflicts, hydrated: true });
  },

  pending: () => get().conflicts.filter((c) => c.status === 'pending'),

  pendingCount: () => get().conflicts.filter((c) => c.status === 'pending').length,

  resolvedCount: () => get().conflicts.filter((c) => c.status !== 'pending').length,

  resolve: async (id, choice) => {
    await resolveConflict(id, choice);
    await get().hydrate();
  },
}));
