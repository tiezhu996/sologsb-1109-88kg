/** 药材基原 */
export type HerbOrigin = '植物' | '动物' | '矿物';

/** 药用部位 */
export type HerbPart = '根' | '茎' | '叶' | '果实';

/** 药材与批次（炮制投料的基本单位） */
export interface HerbMaterial {
  id: string;
  /** 药材名 */
  name: string;
  /** 基原 */
  origin: HerbOrigin;
  /** 药用部位 */
  part: HerbPart;
  /** 批次号 */
  batchNo: string;
  /** 投料量（kg） */
  feedKg: number;
  /** 入库时间 ISO 字符串 */
  receivedAt: string;
  /** 备注 */
  remark?: string;
}

export const HERB_ORIGINS: HerbOrigin[] = ['植物', '动物', '矿物'];
export const HERB_PARTS: HerbPart[] = ['根', '茎', '叶', '果实'];

/** 按药材名分组的待炮制汇总 */
export interface HerbGroupSummary {
  name: string;
  origin: HerbOrigin;
  part: HerbPart;
  batches: number;
  pendingKg: number;
}
