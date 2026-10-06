import type { FireLevel } from './processing-method';

/** 炮制程度 */
export type ProcessDegree = '不及' | '适中' | '太过';

/** 炮制工序记录 */
export interface ProcessBatch {
  id: string;
  /** 生产批号 */
  batchNo: string;
  /** 关联药材 */
  herbId: string;
  /** 采用方法 */
  methodId: string;
  /** 投料量（kg） */
  feedKg: number;
  /** 辅料实际用量（kg） */
  auxUsedKg: number;
  /** 火候 */
  fireLevel: FireLevel;
  /** 开始时间 ISO */
  startedAt: string;
  /** 结束时间 ISO */
  endedAt: string;
  /** 得率（%） */
  yieldRate: number;
  /** 程度判定 */
  degree: ProcessDegree;
  /** 操作人 */
  operator: string;
  /** 得率与程度提交后锁定，仅质检员可改 */
  locked: boolean;
  /** 锁定时间 */
  lockedAt?: string;
  /** 质检员放行/改判人 */
  qcBy?: string;
  /** 备注 */
  remark?: string;
  /**
   * 锁定版本快照：锁定瞬间固化的药材名/批号、炮制方法名与火候参数。
   * 锁定后即使药材或炮制方法记录被修改，本批仍以锁定版本展示与对账，不被回头改写。
   */
  lockSnapshot?: BatchLockSnapshot;
  /** 最近修改时间 ISO 字符串（导入对账用于判断两侧是否都改过） */
  updatedAt?: string;
}

/** 炮制批次锁定时固化的版本快照 */
export interface BatchLockSnapshot {
  /** 锁定时的药材名 */
  herbName: string;
  /** 锁定时的药材批次号 */
  herbBatchNo: string;
  /** 锁定时的炮制方法名 */
  methodName: string;
  /** 锁定时的辅料 */
  auxiliary: string;
  /** 锁定时每 100kg 药材辅料用量（kg） */
  auxRatio: number;
  /** 锁定时的火力 */
  fireLevel: FireLevel;
  /** 锁定时的温度区间（℃） */
  tempRange: [number, number];
  /** 锁定时的炮制时间（min） */
  duration: number;
  /** 锁定时的判断标准 */
  criterion: string;
}

/** 程度判定规则说明 */
export interface DegreeRule {
  degree: ProcessDegree;
  condition: string;
  action: string;
}

export const PROCESS_DEGREES: ProcessDegree[] = ['不及', '适中', '太过'];
