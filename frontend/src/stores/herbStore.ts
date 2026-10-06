import { create } from 'zustand';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import type { HerbGroupSummary, HerbMaterial, HerbOrigin, HerbPart } from '../types/herb-material';

export interface HerbInput {
  name: string;
  origin: HerbOrigin;
  part: HerbPart;
  batchNo: string;
  feedKg: number;
  receivedAt?: string;
  remark?: string;
}

interface HerbState {
  herbs: HerbMaterial[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  addHerb: (input: HerbInput) => Promise<HerbMaterial>;
  updateHerb: (id: string, patch: Partial<HerbInput>) => Promise<void>;
  removeHerb: (id: string) => Promise<void>;
  /** 按药材分组回显批次与待炮制量 */
  groupSummary: () => HerbGroupSummary[];
}

export const useHerbStore = create<HerbState>()((set, get) => ({
  herbs: [],
  hydrated: false,

  hydrate: async () => {
    const herbs = await db.herbs.orderBy('receivedAt').reverse().toArray();
    set({ herbs, hydrated: true });
  },

  addHerb: async (input) => {
    const herb: HerbMaterial = {
      id: uid('herb'),
      name: input.name.trim(),
      origin: input.origin,
      part: input.part,
      batchNo: input.batchNo.trim(),
      feedKg: Number(input.feedKg) || 0,
      receivedAt: input.receivedAt ?? new Date().toISOString(),
      remark: input.remark?.trim() || undefined,
    };
    await db.herbs.put(herb);
    set({ herbs: [herb, ...get().herbs] });
    return herb;
  },

  updateHerb: async (id, patch) => {
    const current = get().herbs.find((h) => h.id === id);
    if (!current) {
      return;
    }
    const next: HerbMaterial = { ...current, ...patch, feedKg: patch.feedKg !== undefined ? Number(patch.feedKg) : current.feedKg };
    await db.herbs.put(next);
    set({ herbs: get().herbs.map((h) => (h.id === id ? next : h)) });
  },

  removeHerb: async (id) => {
    await db.herbs.delete(id);
    set({ herbs: get().herbs.filter((h) => h.id !== id) });
  },

  groupSummary: () => {
    const map = new Map<string, HerbGroupSummary>();
    get().herbs.forEach((herb) => {
      const key = herb.name;
      const existed = map.get(key);
      if (existed) {
        existed.batches += 1;
        existed.pendingKg += herb.feedKg;
      } else {
        map.set(key, { name: herb.name, origin: herb.origin, part: herb.part, batches: 1, pendingKg: herb.feedKg });
      }
    });
    return Array.from(map.values()).sort((a, b) => b.pendingKg - a.pendingKg);
  },
}));
