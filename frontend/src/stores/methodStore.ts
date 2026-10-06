import { create } from 'zustand';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import type { Auxiliary, CriterionDimension, FireLevel, MethodName, ProcessingMethod } from '../types/processing-method';

export interface MethodInput {
  name: MethodName;
  auxiliary: Auxiliary;
  auxRatio: number;
  fireLevel: FireLevel;
  tempRange: [number, number];
  duration: number;
  criterion: string;
  criterionDimension: CriterionDimension;
  applicable: string;
  derivedFrom?: string;
}

interface MethodState {
  methods: ProcessingMethod[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  addMethod: (input: MethodInput) => Promise<ProcessingMethod>;
  updateMethod: (id: string, patch: Partial<MethodInput>) => Promise<void>;
  removeMethod: (id: string) => Promise<void>;
  /** 复制派生：以已有方法为模板生成新方法（可改辅料比例） */
  deriveMethod: (sourceId: string, name: MethodName, auxRatio?: number) => Promise<ProcessingMethod | undefined>;
  /** 选择方法即带出辅料比例、火候与判断标准 */
  describe: (id: string) => { auxiliary: Auxiliary; auxRatio: number; fireLevel: FireLevel; tempRange: [number, number]; duration: number; criterion: string } | undefined;
}

export const useMethodStore = create<MethodState>()((set, get) => ({
  methods: [],
  hydrated: false,

  hydrate: async () => {
    const methods = await db.methods.toArray();
    set({ methods, hydrated: true });
  },

  addMethod: async (input) => {
    const method: ProcessingMethod = {
      id: uid('method'),
      name: input.name,
      auxiliary: input.auxiliary,
      auxRatio: Number(input.auxRatio) || 0,
      fireLevel: input.fireLevel,
      tempRange: input.tempRange,
      duration: Number(input.duration) || 0,
      criterion: input.criterion.trim(),
      criterionDimension: input.criterionDimension,
      applicable: input.applicable.trim(),
      derivedFrom: input.derivedFrom,
    };
    await db.methods.put(method);
    set({ methods: [...get().methods, method] });
    return method;
  },

  updateMethod: async (id, patch) => {
    const current = get().methods.find((m) => m.id === id);
    if (!current) {
      return;
    }
    const next: ProcessingMethod = { ...current, ...patch };
    await db.methods.put(next);
    set({ methods: get().methods.map((m) => (m.id === id ? next : m)) });
  },

  removeMethod: async (id) => {
    await db.methods.delete(id);
    set({ methods: get().methods.filter((m) => m.id !== id) });
  },

  deriveMethod: async (sourceId, name, auxRatio) => {
    const source = get().methods.find((m) => m.id === sourceId);
    if (!source) {
      return undefined;
    }
    return get().addMethod({
      name,
      auxiliary: source.auxiliary,
      auxRatio: auxRatio ?? source.auxRatio,
      fireLevel: source.fireLevel,
      tempRange: source.tempRange,
      duration: source.duration,
      criterion: source.criterion,
      criterionDimension: source.criterionDimension,
      applicable: `${source.applicable}（派生）`,
      derivedFrom: source.id,
    });
  },

  describe: (id) => {
    const method = get().methods.find((m) => m.id === id);
    if (!method) {
      return undefined;
    }
    return {
      auxiliary: method.auxiliary,
      auxRatio: method.auxRatio,
      fireLevel: method.fireLevel,
      tempRange: method.tempRange,
      duration: method.duration,
      criterion: method.criterion,
    };
  },
}));
