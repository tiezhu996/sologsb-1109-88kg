import { useCallback, useMemo } from 'react';
import type { Auxiliary } from '../types/processing-method';

export interface RatioInput {
  /** 每 100kg 药材辅料用量（kg） */
  auxRatio: number;
  /** 投料量（kg） */
  feedKg: number;
  /** 辅料实际用量（kg） */
  auxUsedKg?: number;
  /** 炮制后重量（kg），用于计算得率 */
  outputKg?: number;
}

export interface RatioResult {
  /** 按比例折算的辅料应用量（kg） */
  auxTargetKg: number;
  /** 实际用量与应用量偏差（kg） */
  deviationKg: number;
  /** 偏差百分比 */
  deviationPct: number;
  /** 换算比例文案，如 10kg/100kg */
  ratioText: string;
  /** 反向推算：给定辅料用量所需的投料量（kg） */
  feedKgFromAux: (auxKg: number) => number;
  /** 得率（%） */
  yieldRate: (outputKgOverride?: number) => number;
}

/** 每 100kg 辅料用量折算、反向推算与得率计算 */
export function useRatio({ auxRatio, feedKg, auxUsedKg, outputKg }: RatioInput): RatioResult {
  const auxTargetKg = useMemo(() => Number(((Number(feedKg) || 0) * (Number(auxRatio) || 0)) / 100).toFixed(2), [feedKg, auxRatio]);

  const auxTargetNum = Number(auxTargetKg);
  const used = Number(auxUsedKg) || 0;
  const deviationKg = Number((used - auxTargetNum).toFixed(2));
  const deviationPct = auxTargetNum > 0 ? Number(((deviationKg / auxTargetNum) * 100).toFixed(1)) : 0;

  const feedKgFromAux = useCallback(
    (auxKg: number) => {
      const ratio = Number(auxRatio) || 0;
      if (ratio <= 0) {
        return 0;
      }
      return Number(((auxKg * 100) / ratio).toFixed(2));
    },
    [auxRatio],
  );

  const yieldRate = useCallback(
    (outputKgOverride?: number) => {
      const out = Number(outputKgOverride ?? outputKg) || 0;
      const feed = Number(feedKg) || 0;
      if (feed <= 0) {
        return 0;
      }
      return Number(((out / feed) * 100).toFixed(1));
    },
    [feedKg, outputKg],
  );

  return {
    auxTargetKg: auxTargetNum,
    deviationKg,
    deviationPct,
    ratioText: `${auxRatio || 0}kg / 100kg`,
    feedKgFromAux,
    yieldRate,
  };
}

/** 辅料是否需要按比例折算（「无」辅料的方法不折算） */
export function needAuxiliary(auxiliary: Auxiliary): boolean {
  return auxiliary !== '无';
}
