import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { HerbMaterial, HerbOrigin, HerbPart } from '../types/herb-material';

export interface HerbFilterState {
  keyword: string;
  origin: '' | HerbOrigin;
  part: '' | HerbPart;
  batchNo: string;
}

export interface HerbFilterApi extends HerbFilterState {
  /** 过滤条件是否生效 */
  active: boolean;
  activeCount: number;
  setKeyword: (value: string) => void;
  setOrigin: (value: string) => void;
  setPart: (value: string) => void;
  setBatchNo: (value: string) => void;
  reset: () => void;
  /** 对药材列表应用筛选 */
  apply: (herbs: HerbMaterial[]) => HerbMaterial[];
}

/**
 * 药材筛选条件（基原 / 药用部位 / 批次号 / 关键字），状态保存在 URL query 中，
 * 刷新与前进后退都能还原，药材台账与工序记录台共用。
 */
export function useHerbFilter(): HerbFilterApi {
  const [params, setParams] = useSearchParams();

  const state: HerbFilterState = useMemo(
    () => ({
      keyword: params.get('kw') ?? '',
      origin: (params.get('origin') ?? '') as HerbFilterState['origin'],
      part: (params.get('part') ?? '') as HerbFilterState['part'],
      batchNo: params.get('batch') ?? '',
    }),
    [params],
  );

  const patch = useCallback(
    (updates: Record<string, string>) => {
      const next = new URLSearchParams(params);
      Object.entries(updates).forEach(([key, value]) => {
        if (value) {
          next.set(key, value);
        } else {
          next.delete(key);
        }
      });
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const reset = useCallback(() => {
    const next = new URLSearchParams(params);
    ['kw', 'origin', 'part', 'batch'].forEach((key) => next.delete(key));
    setParams(next, { replace: true });
  }, [params, setParams]);

  const apply = useCallback(
    (herbs: HerbMaterial[]) => {
      const kw = state.keyword.trim().toLowerCase();
      return herbs.filter((herb) => {
        if (state.origin && herb.origin !== state.origin) {
          return false;
        }
        if (state.part && herb.part !== state.part) {
          return false;
        }
        if (state.batchNo && !herb.batchNo.toLowerCase().includes(state.batchNo.toLowerCase())) {
          return false;
        }
        if (kw) {
          const haystack = `${herb.name} ${herb.batchNo} ${herb.remark ?? ''}`.toLowerCase();
          if (!haystack.includes(kw)) {
            return false;
          }
        }
        return true;
      });
    },
    [state],
  );

  const activeCount = [state.keyword, state.origin, state.part, state.batchNo].filter(Boolean).length;

  return {
    ...state,
    active: activeCount > 0,
    activeCount,
    setKeyword: (value) => patch({ kw: value }),
    setOrigin: (value) => patch({ origin: value }),
    setPart: (value) => patch({ part: value }),
    setBatchNo: (value) => patch({ batch: value }),
    reset,
    apply,
  };
}
