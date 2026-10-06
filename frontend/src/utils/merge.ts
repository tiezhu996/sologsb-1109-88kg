import { db, getMeta, setMeta, SCHEMA_VERSION } from './db';
import { uid } from './id';
import type { BackupPayload } from './export';
import type { HerbMaterial } from '../types/herb-material';
import type { ProcessingMethod } from '../types/processing-method';
import type { ProcessBatch } from '../types/process-batch';
import type { RetainSample, ObserveLog } from '../types/retain-sample';
import type { ConflictDiff, MergeConflict, MergeTable } from '../types/merge-conflict';

/**
 * 备份对账合并：不再整库清库恢复，而是按业务键（药材名+批号 / 炮制方法 / 生产批号 / 留样编号）
 * 与本机库逐条对账。炮制批次一经锁定以锁定版本为准；两边都改过的同名记录列为冲突，
 * 未处理前备份版本不写入本机。导入按块写入并持久化进度，中断可续传、重复导入幂等。
 */

// ---------- 业务键 ----------

export const herbKey = (h: Pick<HerbMaterial, 'name' | 'batchNo'>): string => `${h.name}#${h.batchNo}`;
/** 同名炮制方法按辅料与比例区分派生 */
export const methodKey = (m: Pick<ProcessingMethod, 'name' | 'auxiliary' | 'auxRatio'>): string =>
  `${m.name}#${m.auxiliary}#${m.auxRatio}`;
export const batchKey = (b: Pick<ProcessBatch, 'batchNo'>): string => b.batchNo;
export const sampleKey = (s: Pick<RetainSample, 'sampleNo'>): string => s.sampleNo;

// ---------- 备份解析与旧版本升级 ----------

/** 归一化后的备份（旧版本已升级到当前 schema） */
export interface NormalizedBackup {
  /** 备份文件原始 schema 版本 */
  sourceVersion: number;
  herbs: HerbMaterial[];
  methods: ProcessingMethod[];
  batches: ProcessBatch[];
  samples: RetainSample[];
}

const asRecord = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const bool = (v: unknown, d = false): boolean => (typeof v === 'boolean' ? v : d);
const optStr = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

function normalizeHerb(raw: unknown): HerbMaterial | undefined {
  const r = asRecord(raw);
  if (!r) return undefined;
  return {
    id: str(r.id) || uid('herb'),
    name: str(r.name),
    origin: str(r.origin, '植物') as HerbMaterial['origin'],
    part: str(r.part, '根') as HerbMaterial['part'],
    batchNo: str(r.batchNo),
    feedKg: num(r.feedKg),
    receivedAt: str(r.receivedAt) || new Date().toISOString(),
    remark: optStr(r.remark),
  };
}

function normalizeMethod(raw: unknown): ProcessingMethod | undefined {
  const r = asRecord(raw);
  if (!r) return undefined;
  const range = Array.isArray(r.tempRange) ? r.tempRange : [];
  return {
    id: str(r.id) || uid('method'),
    name: str(r.name, '清炒') as ProcessingMethod['name'],
    auxiliary: str(r.auxiliary, '无') as ProcessingMethod['auxiliary'],
    auxRatio: num(r.auxRatio),
    fireLevel: str(r.fireLevel, '文火') as ProcessingMethod['fireLevel'],
    tempRange: [num(range[0]), num(range[1])],
    duration: num(r.duration),
    criterion: str(r.criterion),
    criterionDimension: str(r.criterionDimension, '色泽') as ProcessingMethod['criterionDimension'],
    applicable: str(r.applicable),
    derivedFrom: optStr(r.derivedFrom),
  };
}

function normalizeBatch(raw: unknown): ProcessBatch | undefined {
  const r = asRecord(raw);
  if (!r) return undefined;
  return {
    id: str(r.id) || uid('batch'),
    batchNo: str(r.batchNo),
    herbId: str(r.herbId),
    methodId: str(r.methodId),
    feedKg: num(r.feedKg),
    auxUsedKg: num(r.auxUsedKg),
    fireLevel: str(r.fireLevel, '文火') as ProcessBatch['fireLevel'],
    startedAt: str(r.startedAt),
    endedAt: str(r.endedAt),
    yieldRate: num(r.yieldRate),
    degree: str(r.degree, '适中') as ProcessBatch['degree'],
    operator: str(r.operator),
    // v1 备份没有 locked 字段，升级时回填为未锁定
    locked: bool(r.locked, false),
    lockedAt: optStr(r.lockedAt),
    qcBy: optStr(r.qcBy),
    remark: optStr(r.remark),
  };
}

function normalizeSample(raw: unknown): RetainSample | undefined {
  const r = asRecord(raw);
  if (!r) return undefined;
  const logs: ObserveLog[] = asArray(r.observeLogs)
    .map(asRecord)
    .filter((l): l is Record<string, unknown> => !!l)
    .map((l) => ({
      id: str(l.id) || uid('log'),
      date: str(l.date),
      color: str(l.color),
      odor: str(l.odor),
      mold: str(l.mold),
      observer: str(l.observer),
      note: optStr(l.note),
    }));
  return {
    id: str(r.id) || uid('sample'),
    sampleNo: str(r.sampleNo),
    batchId: str(r.batchId),
    amountG: num(r.amountG),
    retainMonths: num(r.retainMonths, 6),
    cabinet: str(r.cabinet),
    retainedAt: str(r.retainedAt) || new Date().toISOString(),
    observeLogs: logs,
  };
}

/**
 * 解析备份文本并升级旧版本（v1 批次补 locked 等）。
 * 解析失败直接抛错——此时尚未触碰本机库，本机数据保持原样。
 */
export function parseAndUpgrade(text: string): NormalizedBackup {
  let payload: Partial<BackupPayload>;
  try {
    payload = JSON.parse(text) as Partial<BackupPayload>;
  } catch {
    throw new Error('备份文件不是有效的 JSON');
  }
  if (!payload || payload.app !== 'gbherbprocess') {
    throw new Error('备份文件格式不匹配（缺少 app=gbherbprocess 标记）');
  }
  const sourceVersion = typeof payload.schemaVersion === 'number' ? payload.schemaVersion : 1;
  if (sourceVersion > SCHEMA_VERSION) {
    throw new Error(`备份由更高版本导出（schema v${sourceVersion}），当前应用最高支持 v${SCHEMA_VERSION}`);
  }
  const pick = <T>(list: unknown[], normalize: (raw: unknown) => T | undefined): T[] =>
    list.map(normalize).filter((row): row is T => !!row);
  return {
    sourceVersion,
    herbs: pick(asArray(payload.herbs), normalizeHerb),
    methods: pick(asArray(payload.methods), normalizeMethod),
    batches: pick(asArray(payload.batches), normalizeBatch),
    samples: pick(asArray(payload.samples), normalizeSample),
  };
}

/** 备份文件指纹（同一文件重复导入 / 中断续传的识别依据） */
export function fingerprintOf(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${(hash >>> 0).toString(16)}-${text.length}`;
}

// ---------- 对账计划 ----------

export type PlanAction = 'insert' | 'same' | 'locked-keep' | 'locked-take' | 'conflict';

export interface PlanEntry {
  table: MergeTable;
  bizKey: string;
  label: string;
  action: PlanAction;
  /** insert / locked-take 时要写入本机的记录（引用已重映射到本机 id 体系） */
  record?: HerbMaterial | ProcessingMethod | ProcessBatch | RetainSample;
  /** conflict 时生成的冲突单 */
  conflict?: MergeConflict;
}

export interface MergeStats {
  inserted: number;
  same: number;
  lockedKeep: number;
  lockedTake: number;
  conflicts: number;
}

export interface MergePlan {
  entries: PlanEntry[];
  stats: MergeStats;
}

/** 内容指纹：排除 id，引用按业务键折算，保证两台机器各自生成的 id 不影响一致性判断 */
const herbContent = (h: HerbMaterial): string =>
  JSON.stringify([h.name, h.origin, h.part, h.batchNo, h.feedKg, h.receivedAt, h.remark ?? null]);
const methodContent = (m: ProcessingMethod, derivedKey: string | null): string =>
  JSON.stringify([
    m.name,
    m.auxiliary,
    m.auxRatio,
    m.fireLevel,
    m.tempRange,
    m.duration,
    m.criterion,
    m.criterionDimension,
    m.applicable,
    derivedKey,
  ]);
const batchContent = (b: ProcessBatch, herbK: string, methodK: string): string =>
  JSON.stringify([
    b.batchNo,
    herbK,
    methodK,
    b.feedKg,
    b.auxUsedKg,
    b.fireLevel,
    b.startedAt,
    b.endedAt,
    b.yieldRate,
    b.degree,
    b.operator,
    b.locked,
    b.lockedAt ?? null,
    b.qcBy ?? null,
    b.remark ?? null,
  ]);
const sampleContent = (s: RetainSample, batchK: string): string =>
  JSON.stringify([
    s.sampleNo,
    batchK,
    s.amountG,
    s.retainMonths,
    s.cabinet,
    s.retainedAt,
    s.observeLogs.map((l) => [l.date, l.color, l.odor, l.mold, l.observer, l.note ?? '']),
  ]);

/** 插入记录采用备份 id；若本机已有同 id 的不同业务记录则换发新 id，避免串号 */
function adoptId<T>(incomingId: string, localById: Map<string, T>, keyOf: (row: T) => string, key: string, prefix: string): string {
  const hit = localById.get(incomingId);
  if (hit && keyOf(hit) !== key) {
    return uid(prefix);
  }
  return incomingId;
}

const fmtIso = (v?: string): string => (v ? v.slice(0, 16).replace('T', ' ') : '—');
const fmtVal = (v: unknown): string => (v === undefined || v === null || v === '' ? '—' : String(v));

type ViewRow = Array<[string, string]>;

function diffViews(local: ViewRow, incoming: ViewRow): ConflictDiff[] {
  return local
    .filter(([, localVal], i) => incoming[i][1] !== localVal)
    .map(([label, localVal], i) => ({ label, local: localVal, incoming: incoming[i][1] }));
}

/** 基于当前本机库构建对账计划（只读，不写库） */
export async function buildPlan(payload: NormalizedBackup): Promise<MergePlan> {
  const [localHerbs, localMethods, localBatches, localSamples] = await Promise.all([
    db.herbs.toArray(),
    db.methods.toArray(),
    db.batches.toArray(),
    db.samples.toArray(),
  ]);

  const localHerbById = new Map(localHerbs.map((h) => [h.id, h]));
  const localMethodById = new Map(localMethods.map((m) => [m.id, m]));
  const localBatchById = new Map(localBatches.map((b) => [b.id, b]));
  const localSampleById = new Map(localSamples.map((s) => [s.id, s]));
  const localHerbByKey = new Map(localHerbs.map((h) => [herbKey(h), h]));
  const localMethodByKey = new Map(localMethods.map((m) => [methodKey(m), m]));
  const localBatchByKey = new Map(localBatches.map((b) => [batchKey(b), b]));
  const localSampleByKey = new Map(localSamples.map((s) => [sampleKey(s), s]));

  const incomingHerbById = new Map(payload.herbs.map((h) => [h.id, h]));
  const incomingMethodById = new Map(payload.methods.map((m) => [m.id, m]));
  const incomingBatchById = new Map(payload.batches.map((b) => [b.id, b]));

  /** 备份 id → 本机 id 的重映射表 */
  const herbIdMap = new Map<string, string>();
  const methodIdMap = new Map<string, string>();
  const batchIdMap = new Map<string, string>();

  const herbKeyOfId = (id: string): string => {
    const row = localHerbById.get(id) ?? incomingHerbById.get(id);
    return row ? herbKey(row) : `#${id}`;
  };
  const methodKeyOfId = (id: string): string => {
    const row = localMethodById.get(id) ?? incomingMethodById.get(id);
    return row ? methodKey(row) : `#${id}`;
  };
  const batchKeyOfId = (id: string): string => {
    const row = localBatchById.get(id) ?? incomingBatchById.get(id);
    return row ? batchKey(row) : `#${id}`;
  };

  const herbDisplay = (id: string): string => {
    const row = localHerbById.get(id) ?? incomingHerbById.get(id);
    return row ? `${row.name}（${row.batchNo}）` : `#${id}`;
  };
  const methodDisplay = (id: string): string => {
    const row = localMethodById.get(id) ?? incomingMethodById.get(id);
    return row ? `${row.name}·${row.auxiliary}${row.auxRatio}` : `#${id}`;
  };
  const batchDisplay = (id: string): string => {
    const row = localBatchById.get(id) ?? incomingBatchById.get(id);
    return row ? row.batchNo : `#${id}`;
  };

  const herbView = (h: HerbMaterial): ViewRow => [
    ['药材名', h.name],
    ['基原', h.origin],
    ['药用部位', h.part],
    ['批次号', h.batchNo],
    ['投料量(kg)', String(h.feedKg)],
    ['入库时间', fmtIso(h.receivedAt)],
    ['备注', fmtVal(h.remark)],
  ];
  const methodView = (m: ProcessingMethod): ViewRow => [
    ['方法名', m.name],
    ['辅料', m.auxiliary],
    ['辅料比例(kg/100kg)', String(m.auxRatio)],
    ['火力', m.fireLevel],
    ['温度区间(℃)', `${m.tempRange[0]}~${m.tempRange[1]}`],
    ['炮制时间(min)', String(m.duration)],
    ['判断标准', m.criterion],
    ['侧重维度', m.criterionDimension],
    ['适用药材', m.applicable],
    ['派生自', m.derivedFrom ? methodDisplay(m.derivedFrom) : '—'],
  ];
  const batchView = (b: ProcessBatch): ViewRow => [
    ['生产批号', b.batchNo],
    ['药材', herbDisplay(b.herbId)],
    ['炮制方法', methodDisplay(b.methodId)],
    ['投料量(kg)', String(b.feedKg)],
    ['辅料用量(kg)', String(b.auxUsedKg)],
    ['火候', b.fireLevel],
    ['开始时间', fmtIso(b.startedAt)],
    ['结束时间', fmtIso(b.endedAt)],
    ['得率(%)', String(b.yieldRate)],
    ['程度判定', b.degree],
    ['操作人', b.operator],
    ['锁定状态', b.locked ? `已锁定（${fmtIso(b.lockedAt)}）` : '未锁定'],
    ['质检放行', fmtVal(b.qcBy)],
    ['备注', fmtVal(b.remark)],
  ];
  const sampleView = (s: RetainSample): ViewRow => [
    ['留样编号', s.sampleNo],
    ['关联批次', batchDisplay(s.batchId)],
    ['留样量(g)', String(s.amountG)],
    ['留样期(月)', String(s.retainMonths)],
    ['柜位', s.cabinet],
    ['留样日期', fmtIso(s.retainedAt)],
    [
      '观察记录',
      s.observeLogs.length > 0 ? `${s.observeLogs.length} 条（最近 ${s.observeLogs[s.observeLogs.length - 1].date}）` : '无',
    ],
  ];

  const entries: PlanEntry[] = [];
  const makeConflict = (
    table: MergeTable,
    bizKey: string,
    label: string,
    localId: string,
    diffs: ConflictDiff[],
    incomingRecord: PlanEntry['record'],
  ): MergeConflict => ({
    id: uid('conflict'),
    table,
    bizKey,
    label,
    diffs,
    localId,
    incomingRecord: incomingRecord!,
    detectedAt: new Date().toISOString(),
    status: 'pending',
  });

  // —— 药材：按 药材名+批号 对账 ——
  for (const inc of payload.herbs) {
    const key = herbKey(inc);
    const label = `${inc.name}（${inc.batchNo}）`;
    const local = localHerbByKey.get(key);
    if (!local) {
      const record: HerbMaterial = { ...inc, id: adoptId(inc.id, localHerbById, herbKey, key, 'herb') };
      herbIdMap.set(inc.id, record.id);
      localHerbByKey.set(key, record);
      localHerbById.set(record.id, record);
      entries.push({ table: 'herbs', bizKey: key, label, action: 'insert', record });
    } else {
      herbIdMap.set(inc.id, local.id);
      if (herbContent(local) === herbContent(inc)) {
        entries.push({ table: 'herbs', bizKey: key, label, action: 'same' });
      } else {
        entries.push({
          table: 'herbs',
          bizKey: key,
          label,
          action: 'conflict',
          conflict: makeConflict('herbs', key, label, local.id, diffViews(herbView(local), herbView(inc)), inc),
        });
      }
    }
  }

  // —— 炮制方法：先建立 id 映射（派生引用可能指向靠后的方法），再逐条分类 ——
  for (const inc of payload.methods) {
    const key = methodKey(inc);
    const local = localMethodByKey.get(key);
    if (local) {
      methodIdMap.set(inc.id, local.id);
    } else {
      const id = adoptId(inc.id, localMethodById, methodKey, key, 'method');
      methodIdMap.set(inc.id, id);
    }
  }
  for (const inc of payload.methods) {
    const key = methodKey(inc);
    const label = `${inc.name}（${inc.auxiliary} ${inc.auxRatio}kg/100kg）`;
    const remapped: ProcessingMethod = {
      ...inc,
      id: methodIdMap.get(inc.id)!,
      derivedFrom: inc.derivedFrom ? methodIdMap.get(inc.derivedFrom) ?? inc.derivedFrom : undefined,
    };
    const local = localMethodByKey.get(key);
    if (!local) {
      localMethodByKey.set(key, remapped);
      localMethodById.set(remapped.id, remapped);
      entries.push({ table: 'methods', bizKey: key, label, action: 'insert', record: remapped });
    } else {
      const derivedKeyOf = (id?: string): string | null => (id ? methodKeyOfId(methodIdMap.get(id) ?? id) : null);
      if (methodContent(local, derivedKeyOf(local.derivedFrom)) === methodContent(remapped, derivedKeyOf(inc.derivedFrom))) {
        entries.push({ table: 'methods', bizKey: key, label, action: 'same' });
      } else {
        entries.push({
          table: 'methods',
          bizKey: key,
          label,
          action: 'conflict',
          conflict: makeConflict('methods', key, label, local.id, diffViews(methodView(local), methodView(remapped)), remapped),
        });
      }
    }
  }

  // —— 炮制批次：按生产批号对账，锁定版本优先 ——
  for (const inc of payload.batches) {
    const key = batchKey(inc);
    const label = inc.batchNo;
    const remapped: ProcessBatch = {
      ...inc,
      herbId: herbIdMap.get(inc.herbId) ?? inc.herbId,
      methodId: methodIdMap.get(inc.methodId) ?? inc.methodId,
    };
    const local = localBatchByKey.get(key);
    if (!local) {
      const record: ProcessBatch = { ...remapped, id: adoptId(inc.id, localBatchById, batchKey, key, 'batch') };
      batchIdMap.set(inc.id, record.id);
      localBatchByKey.set(key, record);
      localBatchById.set(record.id, record);
      entries.push({ table: 'batches', bizKey: key, label, action: 'insert', record });
      continue;
    }
    batchIdMap.set(inc.id, local.id);
    const sameContent =
      batchContent(local, herbKeyOfId(local.herbId), methodKeyOfId(local.methodId)) ===
      batchContent(remapped, herbKeyOfId(remapped.herbId), methodKeyOfId(remapped.methodId));
    if (sameContent) {
      entries.push({ table: 'batches', bizKey: key, label, action: 'same' });
    } else if (local.locked) {
      // 本机批次已锁定：以锁定版本为准，备份侧后改的药材/方法/得率一律不得回写
      entries.push({ table: 'batches', bizKey: key, label, action: 'locked-keep' });
    } else if (remapped.locked) {
      // 备份批次已锁定而本机未锁定：采用锁定版本（保留本机 id 覆盖，引用不断链）
      const record: ProcessBatch = { ...remapped, id: local.id };
      entries.push({ table: 'batches', bizKey: key, label, action: 'locked-take', record });
    } else {
      entries.push({
        table: 'batches',
        bizKey: key,
        label,
        action: 'conflict',
        conflict: makeConflict('batches', key, label, local.id, diffViews(batchView(local), batchView(remapped)), remapped),
      });
    }
  }

  // —— 留样：按留样编号对账 ——
  for (const inc of payload.samples) {
    const key = sampleKey(inc);
    const label = inc.sampleNo;
    const remapped: RetainSample = { ...inc, batchId: batchIdMap.get(inc.batchId) ?? inc.batchId };
    const local = localSampleByKey.get(key);
    if (!local) {
      const record: RetainSample = { ...remapped, id: adoptId(inc.id, localSampleById, sampleKey, key, 'sample') };
      localSampleByKey.set(key, record);
      localSampleById.set(record.id, record);
      entries.push({ table: 'samples', bizKey: key, label, action: 'insert', record });
    } else if (sampleContent(local, batchKeyOfId(local.batchId)) === sampleContent(remapped, batchKeyOfId(remapped.batchId))) {
      entries.push({ table: 'samples', bizKey: key, label, action: 'same' });
    } else {
      entries.push({
        table: 'samples',
        bizKey: key,
        label,
        action: 'conflict',
        conflict: makeConflict('samples', key, label, local.id, diffViews(sampleView(local), sampleView(remapped)), remapped),
      });
    }
  }

  const stats: MergeStats = { inserted: 0, same: 0, lockedKeep: 0, lockedTake: 0, conflicts: 0 };
  for (const entry of entries) {
    if (entry.action === 'insert') stats.inserted += 1;
    else if (entry.action === 'same') stats.same += 1;
    else if (entry.action === 'locked-keep') stats.lockedKeep += 1;
    else if (entry.action === 'locked-take') stats.lockedTake += 1;
    else stats.conflicts += 1;
  }
  return { entries, stats };
}

// ---------- 导入会话（断点续传 / 失败重试）----------

export interface ImportSession {
  fingerprint: string;
  fileName: string;
  /** 备份文件原始 schema 版本（旧备份升级导入留痕） */
  sourceVersion: number;
  status: 'applying' | 'awaiting-conflicts' | 'done' | 'failed';
  total: number;
  /** 已写入的 table:bizKey，续传时跳过 */
  appliedKeys: string[];
  stats: MergeStats;
  startedAt: string;
  updatedAt: string;
  error?: string;
}

const SESSION_META_KEY = 'import-session';
const CHUNK_SIZE = 25;

export async function loadImportSession(): Promise<ImportSession | undefined> {
  const raw = await getMeta(SESSION_META_KEY);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as ImportSession;
  } catch {
    return undefined;
  }
}

const saveSession = (session: ImportSession): Promise<void> => setMeta(SESSION_META_KEY, JSON.stringify(session));

export interface MergePreview {
  payload: NormalizedBackup;
  plan: MergePlan;
  /** 同一文件上次中断/失败的会话（存在则本次导入将续传） */
  resumeSession?: ImportSession;
}

/** 预览对账结果（只读） */
export async function previewMerge(text: string): Promise<MergePreview> {
  const payload = parseAndUpgrade(text);
  const plan = await buildPlan(payload);
  const fingerprint = fingerprintOf(text);
  const session = await loadImportSession();
  const resumeSession =
    session && session.fingerprint === fingerprint && (session.status === 'applying' || session.status === 'failed')
      ? session
      : undefined;
  return { payload, plan, resumeSession };
}

export interface MergeSummary {
  stats: MergeStats;
  /** 本次检出的待决冲突数 */
  conflicts: number;
  /** 是否接续了上次中断的导入 */
  resumed: boolean;
  /** 续传前已写入的条数 */
  previouslyApplied: number;
  status: 'done' | 'awaiting-conflicts';
}

const MERGE_TABLES = [db.herbs, db.methods, db.batches, db.samples];

/**
 * 执行对账合并：分块写入，每块事务内持久化进度。
 * 中断/失败后用同一文件重导即续传；重复导入已一致的记录全部跳过，不会多出一份。
 */
export async function applyMerge(
  text: string,
  fileName: string,
  onProgress?: (done: number, total: number) => void,
): Promise<MergeSummary> {
  const payload = parseAndUpgrade(text);
  const fingerprint = fingerprintOf(text);
  const plan = await buildPlan(payload);
  const writes = plan.entries.filter((e) => e.action === 'insert' || e.action === 'locked-take');
  const conflictEntries = plan.entries.filter((e) => e.action === 'conflict' && e.conflict);

  const prev = await loadImportSession();
  const resumed = !!prev && prev.fingerprint === fingerprint && (prev.status === 'applying' || prev.status === 'failed');
  const applied = new Set<string>(resumed ? prev!.appliedKeys : []);
  const previouslyApplied = resumed ? prev!.appliedKeys.length : 0;
  const total = resumed ? Math.max(prev!.total, writes.length) : writes.length;

  let session: ImportSession = {
    fingerprint,
    fileName,
    sourceVersion: payload.sourceVersion,
    status: 'applying',
    total,
    appliedKeys: [...applied],
    stats: plan.stats,
    startedAt: resumed ? prev!.startedAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  try {
    // 第一步：登记待决冲突（同业务键幂等 upsert，重复导入不会重复生成）并落会话
    await db.transaction('rw', [...MERGE_TABLES, db.conflicts, db.meta], async () => {
      for (const entry of conflictEntries) {
        const conflict = entry.conflict!;
        const existing = await db.conflicts
          .where('bizKey')
          .equals(conflict.bizKey)
          .filter((row) => row.table === conflict.table && row.status === 'pending')
          .first();
        if (existing) {
          await db.conflicts.update(existing.id, {
            label: conflict.label,
            diffs: conflict.diffs,
            incomingRecord: conflict.incomingRecord,
            localId: conflict.localId,
            detectedAt: conflict.detectedAt,
          });
        } else {
          await db.conflicts.put(conflict);
        }
      }
      await saveSession(session);
    });

    // 第二步：分块写入新增/锁定覆盖记录，逐块推进续传进度
    const pendingWrites = writes.filter((e) => !applied.has(`${e.table}:${e.bizKey}`));
    for (let i = 0; i < pendingWrites.length; i += CHUNK_SIZE) {
      const chunk = pendingWrites.slice(i, i + CHUNK_SIZE);
      await db.transaction('rw', [...MERGE_TABLES, db.meta], async () => {
        for (const entry of chunk) {
          await db.table(entry.table).put(entry.record!);
        }
        chunk.forEach((e) => applied.add(`${e.table}:${e.bizKey}`));
        session = { ...session, appliedKeys: [...applied], updatedAt: new Date().toISOString() };
        await saveSession(session);
      });
      onProgress?.(Math.min(applied.size, total), total);
    }

    const finalStatus: MergeSummary['status'] = conflictEntries.length > 0 ? 'awaiting-conflicts' : 'done';
    session = { ...session, status: finalStatus, updatedAt: new Date().toISOString() };
    await saveSession(session);
    return { stats: plan.stats, conflicts: conflictEntries.length, resumed, previouslyApplied, status: finalStatus };
  } catch (error) {
    // 失败：已提交的块保留（本机库始终有效），记录进度后可原文件重试续传
    session = {
      ...session,
      status: 'failed',
      error: (error as Error).message,
      appliedKeys: [...applied],
      updatedAt: new Date().toISOString(),
    };
    await saveSession(session);
    throw error;
  }
}

// ---------- 冲突处理 ----------

/**
 * 处理冲突：保留本机（仅标记）或采用备份（保留本机 id 覆盖内容，引用不断链）。
 * 处理结果持久化在 conflicts 表，重开仍在。
 */
export async function resolveConflict(id: string, choice: 'local' | 'incoming'): Promise<void> {
  await db.transaction('rw', [...MERGE_TABLES, db.conflicts], async () => {
    const conflict = await db.conflicts.get(id);
    if (!conflict || conflict.status !== 'pending') {
      return;
    }
    if (choice === 'incoming') {
      await db.table(conflict.table).put({ ...conflict.incomingRecord, id: conflict.localId });
    }
    await db.conflicts.update(id, {
      status: choice === 'local' ? 'kept-local' : 'took-incoming',
      resolvedAt: new Date().toISOString(),
    });
  });
}
