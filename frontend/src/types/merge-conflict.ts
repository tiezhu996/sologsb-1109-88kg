import type { HerbMaterial } from './herb-material';
import type { ProcessingMethod } from './processing-method';
import type { ProcessBatch } from './process-batch';
import type { RetainSample } from './retain-sample';

/** 参与对账合并的四张表 */
export type MergeTable = 'herbs' | 'methods' | 'batches' | 'samples';

export const MERGE_TABLE_LABELS: Record<MergeTable, string> = {
  herbs: '药材',
  methods: '炮制方法',
  batches: '炮制批次',
  samples: '留样',
};

/** 冲突处理方式：保留本机 / 采用备份 */
export type ConflictStatus = 'pending' | 'kept-local' | 'took-incoming';

export const CONFLICT_STATUS_LABELS: Record<ConflictStatus, string> = {
  pending: '待处理',
  'kept-local': '已保留本机',
  'took-incoming': '已采用备份',
};

/** 单字段差异（已渲染为展示文本，随冲突记录持久化） */
export interface ConflictDiff {
  /** 字段中文名 */
  label: string;
  /** 本机值（展示文本） */
  local: string;
  /** 备份值（展示文本） */
  incoming: string;
}

/**
 * 合并冲突记录：同业务键的记录两边内容不一致时生成，
 * 未处理前备份版本不写入本机；处理结果持久化，重开仍在。
 */
export interface MergeConflict {
  id: string;
  table: MergeTable;
  /** 业务键（药材名+批号 / 炮制方法 / 生产批号 / 留样编号） */
  bizKey: string;
  /** 展示用名称 */
  label: string;
  diffs: ConflictDiff[];
  /** 本机记录 id（采用备份时保留本机 id 覆盖内容，引用不断链） */
  localId: string;
  /** 备份记录（引用已重映射到本机 id 体系） */
  incomingRecord: HerbMaterial | ProcessingMethod | ProcessBatch | RetainSample;
  detectedAt: string;
  status: ConflictStatus;
  resolvedAt?: string;
}
