/** 火力等级 */
export type FireLevel = '文火' | '中火' | '武火';

/** 炮制方法类别 */
export type MethodName =
  | '清炒'
  | '麸炒'
  | '酒炙'
  | '醋炙'
  | '盐炙'
  | '蜜炙'
  | '蒸'
  | '煮'
  | '燀'
  | '煅';

/** 辅料 */
export type Auxiliary = '无' | '黄酒' | '米醋' | '食盐' | '蜂蜜' | '麦麸' | '灶心土';

/** 判断标准维度 */
export type CriterionDimension = '色泽' | '气味' | '断面';

/** 炮制方法（辅料比例 / 火候 / 判断标准） */
export interface ProcessingMethod {
  id: string;
  /** 方法名 */
  name: MethodName;
  /** 辅料 */
  auxiliary: Auxiliary;
  /** 每 100kg 药材辅料用量（kg） */
  auxRatio: number;
  /** 火力 */
  fireLevel: FireLevel;
  /** 温度区间（℃），[下限, 上限] */
  tempRange: [number, number];
  /** 炮制时间（min） */
  duration: number;
  /** 判断标准：色泽 / 气味 / 断面 */
  criterion: string;
  /** 判断标准侧重维度 */
  criterionDimension: CriterionDimension;
  /** 适用药材说明 */
  applicable: string;
  /** 是否为派生方法（由某个基础方法复制派生而来） */
  derivedFrom?: string;
}

export const FIRE_LEVELS: FireLevel[] = ['文火', '中火', '武火'];
export const METHOD_NAMES: MethodName[] = [
  '清炒',
  '麸炒',
  '酒炙',
  '醋炙',
  '盐炙',
  '蜜炙',
  '蒸',
  '煮',
  '燀',
  '煅',
];
export const AUXILIARIES: Auxiliary[] = ['无', '黄酒', '米醋', '食盐', '蜂蜜', '麦麸', '灶心土'];
export const CRITERION_DIMENSIONS: CriterionDimension[] = ['色泽', '气味', '断面'];
