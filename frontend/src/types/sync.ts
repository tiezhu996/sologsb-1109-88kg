import type { HerbMaterial } from './herb-material';
import type { ProcessingMethod } from './processing-method';
import type { ProcessBatch } from './process-batch';
import type { RetainSample } from './retain-sample';

/** 参与对账的业务表 */
export type SyncTable = 'herbs' | 'methods' | 'batches' | 'samples';

export const SYNC_TABLES: SyncTable[] = ['herbs', 'methods', 'batches', 'samples'];

export const SYNC_TABLE_LABEL: Record<SyncTable, string> = {
  herbs: '药材批次',
  methods: '炮制方法',
  batches: '炮制批次',
  samples: '留样',
};

/** 表行联合类型 */
export type SyncRow = HerbMaterial | ProcessingMethod | ProcessBatch | RetainSample;

/** 对账合并结果统计 */
export interface MergeCounts {
  /** 仅备份中存在、新并入本机的记录数 */
  added: number;
  /** 按规则自动更新本机的记录数 */
  updated: number;
  /** 两侧一致、无需处理的记录数 */
  unchanged: number;
  /** 两侧都改过、需人工选择的冲突数 */
  conflicts: number;
  /** 因父记录冲突暂挂、待父记录决定后续传的记录数 */
  blocked: number;
}

/**
 * 对账冲突。自然键（药材名+批号 / 炮制方法 / 生产批号 / 留样编号）相同、
 * 但两侧内容都相对最近一次对账版本发生变化时生成；未决前备份侧记录不入本机。
 */
export interface MergeConflict {
  /** `${table}:${naturalKey}`，同一自然键的未决冲突唯一 */
  id: string;
  table: SyncTable;
  /** 自然键（对账依据：药材名/炮制方法/批号/留样编号） */
  naturalKey: string;
  /** 便于列表展示的标题 */
  title: string;
  /** 本机当前记录（快照） */
  local: Record<string, unknown>;
  /** 备份侧记录（快照） */
  remote: Record<string, unknown>;
  /** 本机记录最近修改时间 */
  localUpdatedAt?: string;
  /** 备份记录最近修改时间 */
  remoteUpdatedAt?: string;
  /** 发起该冲突的导入会话 */
  sessionId: string;
  /** 备份文件名（便于追溯来源电脑） */
  sourceName: string;
  /** 备份导出时间 */
  exportedAt?: string;
  createdAt: string;
  /** 未决 / 已决 */
  status: 'pending' | 'resolved';
  /** 决定保留哪一侧 */
  resolution?: 'local' | 'remote';
  /** 自动裁定原因（如：锁定批次以锁定版本为准） */
  autoReason?: string;
  resolvedAt?: string;
}

/** 导入会话阶段：解析 → 暂存（可中断续传）→ 合并 → 完成/待决/失败 */
export type ImportStatus = 'parsing' | 'staged' | 'merging' | 'ready' | 'conflicts' | 'done' | 'failed';

/** 备份中一行的暂存（按表分块，断点续传时跳过已写入块） */
export interface StagingRow {
  /** `${sessionId}:${table}:${chunkIndex}:${rowIndex}` */
  id: string;
  sessionId: string;
  table: SyncTable;
  chunkIndex: number;
  rowIndex: number;
  row: unknown;
}

/**
 * 旧备份升级导入会话。
 * - parsing/staged/merging 中断后可从 staging 续传，无需重新解析；
 * - failed 保留本机库不动，重试同一文件沿用本会话；
 * - 同一文件重复导入按 fileHash 命中已完成会话，不会多出一份。
 */
export interface ImportSession {
  id: string;
  /** 备份文件内容指纹（去空格后哈希），用于重复导入识别 */
  fileHash: string;
  fileName: string;
  schemaVersion: number;
  exportedAt?: string;
  status: ImportStatus;
  /** 已写入的暂存分块，如 "herbs:0" */
  stagedChunks: string[];
  totalRows: number;
  stagedRows: number;
  mergedRows?: number;
  conflictCount?: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
}

/** 每条自然键在本机的最近一次对账内容指纹（存于 meta.syncLedger） */
export interface LedgerEntry {
  /** 最近并入版本的内容哈希（不含 id / updatedAt） */
  contentHash?: string;
  /** 最近并入记录的本机 id */
  recordId: string;
  /** 最近并入时间 */
  at: string;
  /** 人工/规则明确否决过的内容哈希：同版本再次导入不再翻盘 */
  rejectedHashes?: string[];
}

/** 全量对账台账，key 为 `${table}:${naturalKey}` */
export type SyncLedger = Record<string, LedgerEntry>;
