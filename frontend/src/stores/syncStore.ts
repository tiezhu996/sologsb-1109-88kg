import { create } from 'zustand';
import {
  findResumableSession,
  listConflicts,
  listImportSessions,
  resolveConflict as resolveConflictUtil,
  resumeImport as resumeImportUtil,
  startImport as startImportUtil,
  type ImportResult,
} from '../utils/sync';
import type { ImportSession, MergeConflict } from '../types/sync';

interface SyncState {
  conflicts: MergeConflict[];
  sessions: ImportSession[];
  resumable?: ImportSession;
  hydrated: boolean;
  /** 重新装载冲突、会话与续传提示（导入/裁决后调用） */
  hydrate: () => Promise<void>;
  /** 读取备份文本并对账合并；任何失败都不改动本机库 */
  startImport: (text: string, fileName: string) => Promise<ImportResult>;
  /** 续传/重试中断或失败的导入 */
  resumeImport: (sessionId: string) => Promise<ImportResult>;
  /** 裁决一条未决冲突，并自动续传被挂起的子记录 */
  resolveConflict: (conflictId: string, side: 'local' | 'remote') => Promise<void>;
  pendingCount: () => number;
}

export const useSyncStore = create<SyncState>()((set, get) => ({
  conflicts: [],
  sessions: [],
  hydrated: false,

  hydrate: async () => {
    const [conflicts, sessions, resumable] = await Promise.all([
      listConflicts(),
      listImportSessions(),
      findResumableSession(),
    ]);
    set({ conflicts, sessions, resumable, hydrated: true });
  },

  startImport: async (text, fileName) => {
    const result = await startImportUtil(text, fileName);
    await get().hydrate();
    return result;
  },

  resumeImport: async (sessionId) => {
    const result = await resumeImportUtil(sessionId);
    await get().hydrate();
    return result;
  },

  resolveConflict: async (conflictId, side) => {
    await resolveConflictUtil(conflictId, side);
    await get().hydrate();
  },

  pendingCount: () => get().conflicts.filter((c) => c.status === 'pending').length,
}));
