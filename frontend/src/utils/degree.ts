import type { FireLevel, MethodName, ProcessingMethod } from '../types/processing-method';
import type { DegreeRule, ProcessDegree } from '../types/process-batch';
import type { RetainSample, SampleExpiry, SampleExpiryState } from '../types/retain-sample';

/** 火力对应的常见温度区间提示（℃） */
export const FIRE_LEVEL_TEMP: Record<FireLevel, [number, number]> = {
  文火: [90, 130],
  中火: [120, 180],
  武火: [180, 300],
};

/** 各炮制方法的预期得率（%）——用于程度判定中的损耗比对 */
export const EXPECTED_YIELD: Record<MethodName, number> = {
  清炒: 94,
  麸炒: 96,
  酒炙: 93,
  醋炙: 92,
  盐炙: 97,
  蜜炙: 108,
  蒸: 90,
  煮: 88,
  燀: 70,
  煅: 82,
};

export function expectedYieldOf(method: ProcessingMethod): number {
  return EXPECTED_YIELD[method.name];
}

export function fireLevelTempRange(level: FireLevel): [number, number] {
  return FIRE_LEVEL_TEMP[level];
}

/** 程度判定规则表（页面直接展示，供操作工对照） */
export const DEGREE_RULES: DegreeRule[] = [
  { degree: '不及', condition: '锅温低于标准区间下限，或时长不足标准值 20% 以上，或得率高于预期 3% 以上', action: '延长炮制时间后复判，禁止直接提交' },
  { degree: '适中', condition: '锅温落入标准区间，时长在标准值 ±20% 内，得率在预期 ±3% 内', action: '判定适中并锁定批次，可取样留样' },
  { degree: '太过', condition: '锅温高于标准区间上限，或时长超出标准值 20% 以上，或得率低于预期 6% 以上', action: '判定太过并隔离本批，转不合格品流程' },
];

export interface DegreeInput {
  method: ProcessingMethod;
  fireLevel: FireLevel;
  /** 实际炮制时长（min） */
  duration: number;
  /** 实际锅温（℃） */
  temp: number;
  /** 实际得率（%） */
  yieldRate: number;
}

export interface DegreeVerdict {
  degree: ProcessDegree;
  /** 判定依据 */
  reasons: string[];
  /** 该方法的预期得率 */
  expectedYield: number;
  /** 与标准的偏差项数量 */
  deviations: number;
}

/**
 * 炮制程度判定：分别比对温度、时长与得率，按偏差方向投票得出程度。
 */
export function judgeDegree(input: DegreeInput): DegreeVerdict {
  const { method, fireLevel, duration, temp, yieldRate } = input;
  const [tempMin, tempMax] = method.tempRange;
  const expectedYield = expectedYieldOf(method);
  const reasons: string[] = [];
  let under = 0;
  let over = 0;

  if (temp < tempMin) {
    under += 1;
    reasons.push(`锅温 ${temp}℃ 低于标准下限 ${tempMin}℃，火候不足`);
  } else if (temp > tempMax) {
    over += 1;
    reasons.push(`锅温 ${temp}℃ 高于标准上限 ${tempMax}℃，有过火风险`);
  } else {
    reasons.push(`锅温 ${temp}℃ 落在标准区间 ${tempMin}~${tempMax}℃ 内`);
  }

  const minDuration = method.duration * 0.8;
  const maxDuration = method.duration * 1.2;
  if (duration < minDuration) {
    under += 1;
    reasons.push(`炮制 ${duration}min 短于标准 ${method.duration}min 的 80%，有效成分转化不完全`);
  } else if (duration > maxDuration) {
    over += 1;
    reasons.push(`炮制 ${duration}min 超过标准 ${method.duration}min 的 120%，色泽易过深`);
  } else {
    reasons.push(`炮制 ${duration}min 在标准 ${method.duration}min ±20% 内`);
  }

  if (yieldRate > expectedYield + 3) {
    under += 1;
    reasons.push(`得率 ${yieldRate}% 高于预期 ${expectedYield}%，含水量偏高、炮制不透`);
  } else if (yieldRate < expectedYield - 6) {
    over += 1;
    reasons.push(`得率 ${yieldRate}% 低于预期 ${expectedYield}%，损耗过大、疑有焦化`);
  } else {
    reasons.push(`得率 ${yieldRate}% 与预期 ${expectedYield}% 相符`);
  }

  const [fireMin, fireMax] = FIRE_LEVEL_TEMP[fireLevel];
  reasons.push(`火候 ${fireLevel}（常用区间 ${fireMin}~${fireMax}℃）`);

  let degree: ProcessDegree = '适中';
  if (under > over) {
    degree = '不及';
  } else if (over > under) {
    degree = '太过';
  }

  return { degree, reasons, expectedYield, deviations: under + over };
}

/** 依据方法的标准值给出建议录入值（锅温取区间中值） */
export function suggestedValues(method: ProcessingMethod): { temp: number; duration: number; yieldRate: number } {
  return {
    temp: Math.round((method.tempRange[0] + method.tempRange[1]) / 2),
    duration: method.duration,
    yieldRate: expectedYieldOf(method),
  };
}

const DAY_MS = 86_400_000;

/** 留样到期日：留样日期 + 留样期（月） */
export function expireDateOf(sample: RetainSample): Date {
  const base = new Date(sample.retainedAt);
  const expire = new Date(base);
  expire.setMonth(expire.getMonth() + sample.retainMonths);
  return expire;
}

export function formatDate(value: Date | string): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 距到期天数（负数表示已过期） */
export function daysToExpire(sample: RetainSample, now: Date = new Date()): number {
  return Math.ceil((expireDateOf(sample).getTime() - now.getTime()) / DAY_MS);
}

export function expiryStateOf(daysLeft: number, warnDays = 30): SampleExpiryState {
  if (daysLeft < 0) {
    return '已到期';
  }
  if (daysLeft <= warnDays) {
    return '临期';
  }
  return '观察中';
}

/** 留样到期派生清单，按剩余天数升序 */
export function buildExpiryList(samples: RetainSample[], warnDays = 30, now: Date = new Date()): SampleExpiry[] {
  return samples
    .map((sample) => {
      const daysLeft = daysToExpire(sample, now);
      return {
        sample,
        expireAt: formatDate(expireDateOf(sample)),
        daysLeft,
        state: expiryStateOf(daysLeft, warnDays),
      };
    })
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

/** 到期（含 30 天内临期）清单 */
export function dueSamples(samples: RetainSample[], warnDays = 30, now: Date = new Date()): SampleExpiry[] {
  return buildExpiryList(samples, warnDays, now).filter((item) => item.daysLeft <= warnDays);
}

export function todayStr(): string {
  return formatDate(new Date());
}
