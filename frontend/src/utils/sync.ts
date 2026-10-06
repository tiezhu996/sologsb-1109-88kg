import { db } from './db';
import { uid } from './id';
import type { BackupPayload } from './export';
import type {
  ImportSession,
  LedgerEntry,
  MergeConflict,
  MergeCounts,
  StagingRow,
  SyncLedger,
  SyncTable,
} from '../types/sync';
import type { HerbMaterial } from '../types/herb-material';
import type { ProcessingMethod } from '../types/processing-method';
import type { BatchLockSnapshot, ProcessBatch } from '../types/process-batch';
import type { RetainSample } from '../types/retain-sample';

const LEDGER_KEY = 'syncLedger';
const STAGING_CHUNK = 200;

const emptyCounts = (): MergeCounts => ({ added: 0, updated: 0, unchanged: 0, conflicts: 0, blocked: 0 });

/* ------------------------------------------------------------------ */
/* 内容指纹                                                            */
/* ------------------------------------------------------------------ */

/** FNV-1a 32 位哈希，返回 8 位十六进制（内容指纹，非密码学用途） */
export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** 稳定序列化：对象键排序、undefined 归为 null，保证同内容同指纹 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        const v = (value as Record<string, unknown>)[key];
        acc[key] = v === undefined ? null : sortValue(v);
        return acc;
      }, {});
  }
  return value ?? null;
}

/* ------------------------------------------------------------------ */
/* 自然键（对账依据：药材名+批号 / 炮制方法 / 生产批号 / 留样编号）      */
/* ------------------------------------------------------------------ */

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string {
  return String(value ?? '').trim();
}

export function naturalKeyOf(table: SyncTable, row: unknown): string {
  const r = asRecord(row);
  switch (table) {
    case 'herbs':
      // 药材名 + 批号
      return `${str(r.name)}|${str(r.batchNo)}`;
    case 'methods':
      // 炮制方法：方法名 + 辅料 + 辅料比例 + 火力 + 时长 + 判断维度，区分同名不同规格
      return [str(r.name), str(r.auxiliary), str(r.auxRatio), str(r.fireLevel), str(r.duration), str(r.criterionDimension)].join('|');
    case 'batches':
      // 炮制批次以生产批号对账
      return str(r.batchNo);
    case 'samples':
      // 留样以留样编号对账
      return str(r.sampleNo);
  }
}

export function conflictIdOf(table: SyncTable, naturalKey: string): string {
  return `${table}:${naturalKey}`;
}

export function titleOf(table: SyncTable, row: unknown): string {
  const r = asRecord(row);
  switch (table) {
    case 'herbs':
      return `${str(r.name) || '未命名药材'}（批号 ${str(r.batchNo) || '—'}）`;
    case 'methods':
      return `${str(r.name) || '未命名方法'} · ${str(r.auxiliary) || '无辅料'} · ${str(r.auxRatio) || '0'}kg/100kg`;
    case 'batches':
      return `炮制批次 ${str(r.batchNo) || '—'}`;
    case 'samples':
      return `留样 ${str(r.sampleNo) || '—'}`;
  }
}

/** 参与内容指纹的字段（id、updatedAt、跨表引用的本机 id 不计入） */
const CONTENT_FIELDS: Record<SyncTable, string[]> = {
  herbs: ['name', 'origin', 'part', 'batchNo', 'feedKg', 'receivedAt', 'remark'],
  methods: ['name', 'auxiliary', 'auxRatio', 'fireLevel', 'tempRange', 'duration', 'criterion', 'criterionDimension', 'applicable', 'derivedFrom'],
  batches: ['batchNo', 'feedKg', 'auxUsedKg', 'fireLevel', 'startedAt', 'endedAt', 'yieldRate', 'degree', 'operator', 'locked', 'lockedAt', 'qcBy', 'remark', 'lockSnapshot'],
  samples: ['sampleNo', 'amountG', 'retainMonths', 'cabinet', 'retainedAt', 'observeLogs', 'batchNoSnapshot'],
};

/** 冲突对比页展示的字段与中文列名 */
export const CONFLICT_FIELDS: Record<SyncTable, Array<{ key: string; label: string }>> = {
  herbs: [
    { key: 'name', label: '药材名' },
    { key: 'origin', label: '基原' },
    { key: 'part', label: '药用部位' },
    { key: 'batchNo', label: '批次号' },
    { key: 'feedKg', label: '投料量(kg)' },
    { key: 'receivedAt', label: '入库时间' },
    { key: 'remark', label: '备注' },
  ],
  methods: [
    { key: 'name', label: '方法名' },
    { key: 'auxiliary', label: '辅料' },
    { key: 'auxRatio', label: '辅料用量(kg/100kg)' },
    { key: 'fireLevel', label: '火力' },
    { key: 'tempRange', label: '温度区间(℃)' },
    { key: 'duration', label: '炮制时间(min)' },
    { key: 'criterion', label: '判断标准' },
    { key: 'criterionDimension', label: '判断维度' },
    { key: 'applicable', label: '适用药材' },
  ],
  batches: [
    { key: 'batchNo', label: '生产批号' },
    { key: 'feedKg', label: '投料量(kg)' },
    { key: 'auxUsedKg', label: '辅料用量(kg)' },
    { key: 'fireLevel', label: '火力' },
    { key: 'startedAt', label: '开始时间' },
    { key: 'endedAt', label: '结束时间' },
    { key: 'yieldRate', label: '得率(%)' },
    { key: 'degree', label: '程度判定' },
    { key: 'operator', label: '操作人' },
    { key: 'locked', label: '是否锁定' },
    { key: 'lockedAt', label: '锁定时间' },
    { key: 'qcBy', label: '质检放行' },
    { key: 'remark', label: '备注' },
  ],
  samples: [
    { key: 'sampleNo', label: '留样编号' },
    { key: 'amountG', label: '留样量(g)' },
    { key: 'retainMonths', label: '留样期(月)' },
    { key: 'cabinet', label: '柜位' },
    { key: 'retainedAt', label: '留样日期' },
    { key: 'batchNoSnapshot', label: '关联批号' },
  ],
};

function hashRow(table: SyncTable, row: Record<string, unknown>): string {
  const picked: Record<string, unknown> = {};
  CONTENT_FIELDS[table].forEach((key) => {
    picked[key] = row[key] ?? null;
  });
  if (table === 'samples' && Array.isArray(picked.observeLogs)) {
    // 观察记录按日期+id 稳定排序，避免追加顺序不同导致误判
    picked.observeLogs = (picked.observeLogs as unknown[]).slice().sort((a, b) => {
      const ra = asRecord(a);
      const rb = asRecord(b);
      return `${str(ra.date)}|${str(ra.id)}`.localeCompare(`${str(rb.date)}|${str(rb.id)}`);
    });
  }
  return fnv1a(stableStringify(picked));
}

/* ------------------------------------------------------------------ */
/* 锁定版本快照                                                        */
/* ------------------------------------------------------------------ */

/** 锁定瞬间固化药材与炮制方法版本，之后二者再改也不回头影响本批 */
export function buildLockSnapshot(
  herb: HerbMaterial | undefined,
  method: ProcessingMethod | undefined,
): BatchLockSnapshot {
  return {
    herbName: herb?.name ?? '（已失配药材）',
    herbBatchNo: herb?.batchNo ?? '—',
    methodName: method?.name ?? '（已失配方法）',
    auxiliary: method?.auxiliary ?? '无',
    auxRatio: method ? Number(method.auxRatio) || 0 : 0,
    fireLevel: method?.fireLevel ?? '文火',
    tempRange: method?.tempRange ?? [0, 0],
    duration: method ? Number(method.duration) || 0 : 0,
    criterion: method?.criterion ?? '—',
  };
}

/** 已锁定批次的药材名以锁定快照为准，未锁定批次实时取药材表 */
export function batchHerbName(batch: ProcessBatch, herbs: HerbMaterial[]): string {
  if (batch.locked && batch.lockSnapshot) {
    return batch.lockSnapshot.herbName;
  }
  return herbs.find((h) => h.id === batch.herbId)?.name ?? '未知药材';
}

/** 已锁定批次的炮制方法名以锁定快照为准，未锁定批次实时取方法表 */
export function batchMethodName(batch: ProcessBatch, methods: ProcessingMethod[]): string {
  if (batch.locked && batch.lockSnapshot) {
    return batch.lockSnapshot.methodName;
  }
  return methods.find((m) => m.id === batch.methodId)?.name ?? '未知方法';
}

/* ------------------------------------------------------------------ */
/* 旧备份升级（v1/v2 → 当前结构）                                       */
/* ------------------------------------------------------------------ */

interface NormalizedBackup {
  schemaVersion: number;
  exportedAt?: string;
  herbs: HerbMaterial[];
  methods: ProcessingMethod[];
  batches: ProcessBatch[];
  samples: RetainSample[];
}

function validRow(table: SyncTable, row: unknown): boolean {
  const r = asRecord(row);
  if (!str(r.id)) return false;
  return Boolean(naturalKeyOf(table, r));
}

/**
 * 把任意历史版本的备份规整为当前结构：
 * - v1 批次补 locked（Dexie 侧的 v2 升级只作用于本机库，备份行需在此补）
 * - 补 updatedAt，供「两侧是否都改过」判断
 * - 已锁定批次补锁定版本快照；留样补关联批号快照
 */
export function normalizeBackup(payload: Partial<BackupPayload>): NormalizedBackup {
  const herbs = (payload.herbs ?? []).filter((r) => validRow('herbs', r)).map((r) => {
    const row = { ...(r as HerbMaterial) };
    row.name = row.name.trim();
    row.batchNo = row.batchNo.trim();
    row.feedKg = Number(row.feedKg) || 0;
    row.updatedAt = row.updatedAt || row.receivedAt || payload.exportedAt || new Date(0).toISOString();
    return row;
  });
  const methods = (payload.methods ?? []).filter((r) => validRow('methods', r)).map((r) => {
    const row = { ...(r as ProcessingMethod) };
    row.auxRatio = Number(row.auxRatio) || 0;
    row.duration = Number(row.duration) || 0;
    row.updatedAt = row.updatedAt || payload.exportedAt || new Date(0).toISOString();
    return row;
  });
  const herbById = new Map(herbs.map((h) => [h.id, h]));
  const methodById = new Map(methods.map((m) => [m.id, m]));
  const batches = (payload.batches ?? []).filter((r) => validRow('batches', r)).map((r) => {
    const row = { ...(r as ProcessBatch) };
    if (typeof row.locked !== 'boolean') row.locked = false;
    row.feedKg = Number(row.feedKg) || 0;
    row.auxUsedKg = Number(row.auxUsedKg) || 0;
    row.yieldRate = Number(row.yieldRate) || 0;
    if (row.locked && !row.lockSnapshot) {
      row.lockSnapshot = buildLockSnapshot(herbById.get(row.herbId), methodById.get(row.methodId));
    }
    row.updatedAt = row.updatedAt || row.lockedAt || row.endedAt || row.startedAt || payload.exportedAt || new Date(0).toISOString();
    return row;
  });
  const batchById = new Map(batches.map((b) => [b.id, b]));
  const samples = (payload.samples ?? []).filter((r) => validRow('samples', r)).map((r) => {
    const row = { ...(r as RetainSample) };
    row.amountG = Number(row.amountG) || 0;
    row.retainMonths = Number(row.retainMonths) || 0;
    row.observeLogs = Array.isArray(row.observeLogs) ? row.observeLogs : [];
    if (!row.batchNoSnapshot) {
      row.batchNoSnapshot = batchById.get(row.batchId)?.batchNo;
    }
    const lastLog = row.observeLogs.map((log) => log.date).sort().at(-1);
    row.updatedAt = row.updatedAt || (lastLog ? new Date(lastLog).toISOString() : undefined) || row.retainedAt || payload.exportedAt || new Date(0).toISOString();
    return row;
  });
  return {
    schemaVersion: Number(payload.schemaVersion) || 1,
    exportedAt: payload.exportedAt,
    herbs,
    methods,
    batches,
    samples,
  };
}

/* ------------------------------------------------------------------ */
/* 对账台账                                                            */
/* ------------------------------------------------------------------ */

async function loadLedger(): Promise<SyncLedger> {
  const row = await db.meta.get(LEDGER_KEY);
  if (!row?.value) return {};
  try {
    return JSON.parse(row.value) as SyncLedger;
  } catch {
    return {};
  }
}

async function saveLedgerInTx(ledger: SyncLedger): Promise<void> {
  await db.meta.put({ key: LEDGER_KEY, value: JSON.stringify(ledger) });
}

/* ------------------------------------------------------------------ */
/* 合并引擎                                                            */
/* ------------------------------------------------------------------ */

interface RowSet {
  rows: Record<string, unknown>[];
  byKey: Map<string, Record<string, unknown>>;
  idToKey: Map<string, string>;
}

function indexRows(table: SyncTable, rows: unknown[]): RowSet {
  const list = rows.map((r) => asRecord(r));
  const byKey = new Map<string, Record<string, unknown>>();
  const idToKey = new Map<string, string>();
  list.forEach((row) => {
    const key = naturalKeyOf(table, row);
    byKey.set(key, row);
    idToKey.set(str(row.id), key);
  });
  return { rows: list, byKey, idToKey };
}

function pickWinnerLocked(local: ProcessBatch, remote: ProcessBatch): 'local' | 'remote' {
  // 两边都锁定：以最早锁定的版本为权威（先锁定即定论）；时间相同保留本机
  if (local.lockedAt && remote.lockedAt && local.lockedAt !== remote.lockedAt) {
    return local.lockedAt < remote.lockedAt ? 'local' : 'remote';
  }
  return 'local';
}

/**
 * 按自然键对账合并暂存区到本机库（单事务，失败整体回滚，本机库不动）。
 * 可对同一会话反复执行：已并入内容幂等，冲突处理后重跑可放行暂挂记录。
 *
 * overrides：人工裁决刚写入本机的行。裁决发生在事务外，重跑合并时同事务内读到的
 * 本地快照可能尚未包含它们，这里显式并入对账视图，保证子表引用重写到落库 id。
 */
export async function mergeSession(
  session: ImportSession,
  overrides: Partial<Record<SyncTable, Record<string, unknown>[]>> = {},
): Promise<MergeCounts> {
  const counts = emptyCounts();
  await db.transaction(
    'rw',
    [db.herbs, db.methods, db.batches, db.samples, db.conflicts, db.staging, db.meta],
    async () => {
      const ledger = await loadLedger();
      const staged = await db.staging.where('sessionId').equals(session.id).toArray();
      const remoteRows: Record<SyncTable, unknown[]> = { herbs: [], methods: [], batches: [], samples: [] };
      staged.forEach((item) => remoteRows[item.table].push(item.row));

      const remote: Record<SyncTable, RowSet> = {
        herbs: indexRows('herbs', remoteRows.herbs),
        methods: indexRows('methods', remoteRows.methods),
        batches: indexRows('batches', remoteRows.batches),
        samples: indexRows('samples', remoteRows.samples),
      };
      /** 各自然键合并后落库的最终 id（供子表重写引用） */
      const resolvedIds: Record<SyncTable, Map<string, string>> = {
        herbs: new Map(),
        methods: new Map(),
        batches: new Map(),
        samples: new Map(),
      };

      const local: Record<SyncTable, RowSet> = {
        herbs: indexRows('herbs', await db.herbs.toArray()),
        methods: indexRows('methods', await db.methods.toArray()),
        batches: indexRows('batches', await db.batches.toArray()),
        samples: indexRows('samples', await db.samples.toArray()),
      };

      // 合并刚裁决写入的行到本地对账视图（以自然键覆盖同键行，并预置其落库 id）
      (Object.keys(overrides) as SyncTable[]).forEach((table) => {
        (overrides[table] ?? []).forEach((row) => {
          const key = naturalKeyOf(table, row);
          local[table].byKey.set(key, row);
          local[table].idToKey.set(str(row.id), key);
          resolvedIds[table].set(key, str(row.id));
        });
      });

      const existingConflicts = await db.conflicts.toArray();
      const conflictById = new Map(existingConflicts.map((c) => [c.id, c]));
      const pendingKeys = new Set(existingConflicts.filter((c) => c.status === 'pending').map((c) => c.id));
      const conflictWrites = new Map<string, MergeConflict>();
      const autoClose = new Set<string>();

      const now = new Date().toISOString();

      const rememberRejected = (entry: LedgerEntry | undefined, hash: string): string[] => {
        const set = new Set(entry?.rejectedHashes ?? []);
        set.add(hash);
        return Array.from(set);
      };

      const putResolved = async (table: SyncTable, key: string, row: Record<string, unknown>, finalId: string, hash: string) => {
        const out = { ...row, id: finalId };
        await db[table].put(out as never);
        resolvedIds[table].set(key, finalId);
        ledger[`${table}:${key}`] = {
          ...(ledger[`${table}:${key}`] ?? {}),
          contentHash: hash,
          recordId: finalId,
          at: now,
        } as LedgerEntry;
      };

      const recordAutoConflict = (
        table: SyncTable,
        key: string,
        localRow: Record<string, unknown>,
        remoteRow: Record<string, unknown>,
        winner: 'local' | 'remote',
        autoReason: string,
      ) => {
        // 自动裁定也留痕，处理记录重开仍在
        conflictWrites.set(conflictIdOf(table, key), {
          ...(conflictById.get(conflictIdOf(table, key)) ?? {}),
          id: conflictIdOf(table, key),
          table,
          naturalKey: key,
          title: titleOf(table, winner === 'local' ? localRow : remoteRow),
          local: localRow,
          remote: remoteRow,
          localUpdatedAt: str(localRow.updatedAt) || undefined,
          remoteUpdatedAt: str(remoteRow.updatedAt) || undefined,
          sessionId: session.id,
          sourceName: session.fileName,
          exportedAt: session.exportedAt,
          createdAt: conflictById.get(conflictIdOf(table, key))?.createdAt ?? now,
          status: 'resolved',
          resolution: winner,
          autoReason,
          resolvedAt: now,
        });
        pendingKeys.delete(conflictIdOf(table, key));
      };

      const recordPendingConflict = (
        table: SyncTable,
        key: string,
        localRow: Record<string, unknown>,
        remoteRow: Record<string, unknown>,
      ) => {
        const previous = conflictById.get(conflictIdOf(table, key));
        conflictWrites.set(conflictIdOf(table, key), {
          id: conflictIdOf(table, key),
          table,
          naturalKey: key,
          title: titleOf(table, remoteRow),
          local: localRow,
          remote: remoteRow,
          localUpdatedAt: str(localRow.updatedAt) || undefined,
          remoteUpdatedAt: str(remoteRow.updatedAt) || undefined,
          sessionId: session.id,
          sourceName: session.fileName,
          exportedAt: session.exportedAt,
          createdAt: previous?.status === 'resolved' ? previous.createdAt : now,
          status: 'pending',
        });
        pendingKeys.add(conflictIdOf(table, key));
      };

      const canonicalRemoteId = (table: SyncTable, key: string, remoteRow: Record<string, unknown>): string => {
        const localRow = local[table].byKey.get(key);
        if (localRow) return str(localRow.id); // 并入本机同业务记录，保留本机 id 与既有引用
        const remoteId = str(remoteRow.id);
        const ownerKey = local[table].idToKey.get(remoteId);
        if (ownerKey && ownerKey !== key) {
          // 极小概率的 id 撞号：新分配 id，绝不覆盖他人记录
          return uid(table.slice(0, -1));
        }
        return remoteId;
      };

      /** 父表（药材/方法）对账，返回该表是否产生新未决冲突 */
      const mergeParentTable = (table: SyncTable) => {
        remote[table].byKey.forEach((remoteRow, key) => {
          const localRow = local[table].byKey.get(key);
          const ledgerKey = `${table}:${key}`;
          const base = ledger[ledgerKey];
          const remoteHash = hashRow(table, remoteRow);

          if (!localRow) {
            // 本机缺失：并入（曾经删除过也重新补回）
            const finalId = canonicalRemoteId(table, key, remoteRow);
            void putResolved(table, key, remoteRow, finalId, remoteHash);
            counts.added += 1;
            if (pendingKeys.has(conflictIdOf(table, key))) {
              autoClose.add(conflictIdOf(table, key));
              recordAutoConflict(table, key, conflictById.get(conflictIdOf(table, key))?.local ?? {}, remoteRow, 'remote', '本机无此记录，已采用备份版本');
            }
            return;
          }

          const localHash = hashRow(table, localRow);

          if (localHash === remoteHash) {
            counts.unchanged += 1;
            resolvedIds[table].set(key, str(localRow.id));
            if (!base) {
              ledger[ledgerKey] = { contentHash: localHash, recordId: str(localRow.id), at: now };
            }
            if (pendingKeys.has(conflictIdOf(table, key))) {
              autoClose.add(conflictIdOf(table, key));
              recordAutoConflict(table, key, localRow, remoteRow, 'local', '两侧内容已一致，自动消除冲突');
            }
            return;
          }

          // 一侧曾被明确否决：沿用当初决定，同文件重复导入不会翻盘
          if (base?.rejectedHashes?.includes(remoteHash)) {
            counts.unchanged += 1;
            resolvedIds[table].set(key, str(localRow.id));
            return;
          }
          if (base?.rejectedHashes?.includes(localHash)) {
            const finalId = canonicalRemoteId(table, key, remoteRow);
            void putResolved(table, key, remoteRow, finalId, remoteHash);
            counts.updated += 1;
            return;
          }

          if (base?.contentHash) {
            if (base.contentHash === localHash) {
              // 本机未改、备份较新
              const finalId = canonicalRemoteId(table, key, remoteRow);
              void putResolved(table, key, remoteRow, finalId, remoteHash);
              counts.updated += 1;
              return;
            }
            if (base.contentHash === remoteHash) {
              // 备份未改、本机较新，保留本机并前移基线
              resolvedIds[table].set(key, str(localRow.id));
              ledger[ledgerKey] = { ...base, contentHash: localHash, recordId: str(localRow.id), at: now };
              counts.unchanged += 1;
              return;
            }
          }

          // 两侧都相对基线改过（或无基线的同名记录）→ 列冲突，未决不入本机
          resolvedIds[table].set(key, str(localRow.id));
          recordPendingConflict(table, key, localRow, remoteRow);
          counts.conflicts += 1;
        });

        // 本机独有而备份没有的记录：保留不动
        local[table].byKey.forEach((localRow, key) => {
          if (!remote[table].byKey.has(key)) {
            resolvedIds[table].set(key, str(localRow.id));
          }
        });
      };

      mergeParentTable('herbs');
      mergeParentTable('methods');

      /** 子表合并：父记录未决时暂挂，待决后续传再并入 */
      const mergeChildTable = (
        table: SyncTable,
        parentRefs: (row: Record<string, unknown>) => Array<{ table: SyncTable; remoteId: string }>,
      ) => {
        remote[table].byKey.forEach((remoteRow, key) => {
          const refs = parentRefs(remoteRow)
            .map((ref) => ({ ...ref, key: remote[ref.table].idToKey.get(ref.remoteId) }))
            .filter((ref): ref is { table: SyncTable; remoteId: string; key: string } => Boolean(ref.key));

          const blockedByParent = refs.some((ref) => pendingKeys.has(conflictIdOf(ref.table, ref.key)));
          if (blockedByParent) {
            counts.blocked += 1;
            return;
          }

          const localRow = local[table].byKey.get(key);
          const ledgerKey = `${table}:${key}`;
          const base = ledger[ledgerKey];
          const remoteHash = hashRow(table, remoteRow);

          // 重写跨表引用为本机落库 id
          const rewritten = { ...remoteRow };
          refs.forEach((ref) => {
            const finalParentId = resolvedIds[ref.table].get(ref.key);
            if (ref.table === 'herbs') rewritten.herbId = finalParentId ?? ref.remoteId;
            if (ref.table === 'methods') rewritten.methodId = finalParentId ?? ref.remoteId;
            if (ref.table === 'batches') rewritten.batchId = finalParentId ?? ref.remoteId;
          });

          if (!localRow) {
            const finalId = canonicalRemoteId(table, key, rewritten);
            void putResolved(table, key, rewritten, finalId, remoteHash);
            counts.added += 1;
            return;
          }

          const localHash = hashRow(table, localRow);
          resolvedIds[table].set(key, str(localRow.id));

          if (localHash === remoteHash) {
            counts.unchanged += 1;
            if (!base) ledger[ledgerKey] = { contentHash: localHash, recordId: str(localRow.id), at: now };
            return;
          }

          if (base?.rejectedHashes?.includes(remoteHash)) {
            counts.unchanged += 1;
            return;
          }
          if (base?.rejectedHashes?.includes(localHash)) {
            const finalId = canonicalRemoteId(table, key, rewritten);
            void putResolved(table, key, rewritten, finalId, remoteHash);
            counts.updated += 1;
            return;
          }

          // 锁定批次优先规则置于自动合并之前：一经锁定即以锁定版本为准，
          // 炮制方法/药材后改或对端修改都不回头改写
          const lockedWinner = lockedWinnerOf(localRow, rewritten);
          if (lockedWinner) {
            if (lockedWinner === 'local') {
              ledger[ledgerKey] = {
                ...(base ?? {}),
                contentHash: localHash,
                recordId: str(localRow.id),
                rejectedHashes: rememberRejected(base, remoteHash),
                at: now,
              } as LedgerEntry;
              recordAutoConflict(table, key, localRow, rewritten, 'local', '炮制批次已锁定：以本机锁定版本为准，备份侧修改不回写');
            } else {
              const finalId = canonicalRemoteId(table, key, rewritten);
              void putResolved(table, key, rewritten, finalId, remoteHash);
              ledger[ledgerKey] = {
                ...(base ?? {}),
                contentHash: remoteHash,
                recordId: finalId,
                rejectedHashes: rememberRejected(base, localHash),
                at: now,
              } as LedgerEntry;
              recordAutoConflict(table, key, localRow, rewritten, 'remote', '炮制批次已锁定：以备份中的锁定版本为准');
            }
            counts.updated += 1;
            return;
          }

          if (base?.contentHash) {
            if (base.contentHash === localHash) {
              const finalId = canonicalRemoteId(table, key, rewritten);
              void putResolved(table, key, rewritten, finalId, remoteHash);
              counts.updated += 1;
              return;
            }
            if (base.contentHash === remoteHash) {
              ledger[ledgerKey] = { ...base, contentHash: localHash, recordId: str(localRow.id), at: now };
              counts.unchanged += 1;
              return;
            }
          }

          recordPendingConflict(table, key, localRow, rewritten);
          counts.conflicts += 1;
        });

        local[table].byKey.forEach((localRow, key) => {
          if (!remote[table].byKey.has(key)) resolvedIds[table].set(key, str(localRow.id));
        });
      };

      const lockedWinnerOf = (localRow: Record<string, unknown>, remoteRow: Record<string, unknown>): 'local' | 'remote' | undefined => {
        const localLocked = localRow.locked === true;
        const remoteLocked = remoteRow.locked === true;
        if (!localLocked && !remoteLocked) return undefined;
        if (localLocked && !remoteLocked) return 'local';
        if (remoteLocked && !localLocked) return 'remote';
        return pickWinnerLocked(localRow as unknown as ProcessBatch, remoteRow as unknown as ProcessBatch);
      };

      mergeChildTable('batches', (row) => [
        { table: 'herbs', remoteId: str(row.herbId) },
        { table: 'methods', remoteId: str(row.methodId) },
      ]);
      mergeChildTable('samples', (row) => [{ table: 'batches', remoteId: str(row.batchId) }]);

      // 父记录已决/消失后，旧的未决冲突若实际已无分歧则自动销账（保留为已处理记录）
      conflictById.forEach((conflict) => {
        if (conflict.status !== 'pending') return;
        if (conflictWrites.has(conflict.id) || autoClose.has(conflict.id)) return;
        const key = conflict.naturalKey;
        const localRow = local[conflict.table].byKey.get(key);
        const remoteRow = remote[conflict.table].byKey.get(key);
        if (!remoteRow) {
          recordAutoConflict(conflict.table, key, conflict.local, conflict.remote, 'local', '本次备份不含该记录，保留本机版本');
        } else if (!localRow) {
          recordAutoConflict(conflict.table, key, conflict.local, remoteRow, 'remote', '本机记录已删除，采用备份版本');
        } else if (hashRow(conflict.table, localRow) === hashRow(conflict.table, remoteRow)) {
          recordAutoConflict(conflict.table, key, localRow, remoteRow, 'local', '两侧内容已一致，自动消除冲突');
        }
      });

      if (conflictWrites.size > 0) {
        await db.conflicts.bulkPut(Array.from(conflictWrites.values()));
      }
      await saveLedgerInTx(ledger);
    },
  );

  // 完成判定以本会话为界：本会话产生的未决冲突、或本会话被挂起的子记录仍待处理。
  // 其他导入会话遗留的未决冲突不阻止本会话完成，避免无关冲突让会话一直停在待决。
  const ownPending = await db.conflicts
    .where('sessionId')
    .equals(session.id)
    .filter((c) => c.status === 'pending')
    .count();
  const sessionWaiting = ownPending > 0 || counts.blocked > 0;
  await db.importSessions.update(session.id, {
    status: sessionWaiting ? 'conflicts' : 'done',
    mergedRows: counts.added + counts.updated + counts.unchanged,
    conflictCount: counts.conflicts,
    finishedAt: sessionWaiting ? undefined : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  return counts;
}

/* ------------------------------------------------------------------ */
/* 导入会话：旧备份升级、断点续传、重复导入幂等                          */
/* ------------------------------------------------------------------ */

export type ImportOutcome = 'merged' | 'conflicts' | 'duplicate' | 'failed';

export interface ImportResult {
  outcome: ImportOutcome;
  session: ImportSession;
  counts?: MergeCounts;
  /** duplicate / conflicts 时当前未决冲突总数 */
  pending?: number;
  /** 已存在会话被沿用（续传） */
  resumed?: boolean;
}

function stageRows(sessionId: string, table: SyncTable, rows: unknown[]): StagingRow[] {
  const chunks: StagingRow[] = [];
  rows.forEach((row, index) => {
    const chunkIndex = Math.floor(index / STAGING_CHUNK);
    chunks.push({ id: `${sessionId}:${table}:${chunkIndex}:${index}`, sessionId, table, chunkIndex, rowIndex: index, row });
  });
  return chunks;
}

/**
 * 解析备份并发起对账合并。
 * - 解析失败：不触碰本机库，抛出异常供界面提示重试；
 * - 同一文件（fileHash）：已完成则直接返回，不多出一份；有未决冲突则引导去处理；失败/中断则续传；
 * - 合并事务失败：本机库回滚不动，会话标记 failed，可重试。
 */
export async function startImport(text: string, fileName: string): Promise<ImportResult> {
  let payload: Partial<BackupPayload>;
  try {
    payload = JSON.parse(text) as Partial<BackupPayload>;
  } catch {
    throw new Error('备份文件不是合法 JSON，请确认选择的是本应用导出的备份');
  }
  if (!payload || payload.app !== 'gbherbprocess') {
    throw new Error('备份文件格式不匹配（缺少 app=gbherbprocess 标记）');
  }

  const fileHash = fnv1a(text.replace(/\s+/g, ''));
  const existed = await db.importSessions.where('fileHash').equals(fileHash).first();

  const normalized = normalizeBackup(payload);
  const totalRows = normalized.herbs.length + normalized.methods.length + normalized.batches.length + normalized.samples.length;

  let session: ImportSession;
  if (existed) {
    session = existed;
    if (session.status === 'done') {
      // 同一文件已完整导入：幂等返回，绝不并入第二份
      await clearStaging(session.id);
      return { outcome: 'duplicate', session, pending: 0 };
    }
    // conflicts / failed / staged / parsing：落到下方重写暂存（幂等）并续传合并
  } else {
    session = {
      id: uid('import'),
      fileHash,
      fileName,
      schemaVersion: normalized.schemaVersion,
      exportedAt: normalized.exportedAt,
      status: 'parsing',
      stagedChunks: [],
      totalRows,
      stagedRows: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await db.importSessions.put(session);
  }

  // 分块写入暂存区（行 id 确定，重复写入幂等——中断后续传不会重复）
  const allStaging: StagingRow[] = [
    ...stageRows(session.id, 'herbs', normalized.herbs),
    ...stageRows(session.id, 'methods', normalized.methods),
    ...stageRows(session.id, 'batches', normalized.batches),
    ...stageRows(session.id, 'samples', normalized.samples),
  ];
  for (let i = 0; i < allStaging.length; i += STAGING_CHUNK) {
    const slice = allStaging.slice(i, i + STAGING_CHUNK);
    await db.staging.bulkPut(slice);
    session.stagedRows = Math.min(i + slice.length, allStaging.length);
    session.status = 'staged';
    session.updatedAt = new Date().toISOString();
    await db.importSessions.update(session.id, {
      stagedRows: session.stagedRows,
      status: 'staged',
      totalRows,
      updatedAt: session.updatedAt,
    });
  }

  try {
    const counts = await mergeSession(session);
    const refreshed = (await db.importSessions.get(session.id))!;
    const pending = await db.conflicts.where('status').equals('pending').count();
    if (refreshed.status === 'done') {
      // 无待决/待续传：释放暂存区
      await clearStaging(session.id);
    }
    // outcome 以本会话状态为准；pending 字段给界面展示全局待决数（含其他会话）
    return {
      outcome: refreshed.status === 'conflicts' ? 'conflicts' : 'merged',
      session: refreshed,
      counts,
      pending,
      resumed: Boolean(existed),
    };
  } catch (error) {
    await db.importSessions.update(session.id, {
      status: 'failed',
      error: (error as Error).message,
      updatedAt: new Date().toISOString(),
    });
    return {
      outcome: 'failed',
      session: (await db.importSessions.get(session.id))!,
      resumed: Boolean(existed),
    };
  }
}

/** 清理已完成导入会话的暂存区（失败/中断的保留以供重试） */
async function clearStaging(sessionId: string): Promise<void> {
  await db.staging.where('sessionId').equals(sessionId).delete();
}

/** 续传/重试一个中断或失败的导入会话（暂存区完整，无需重新选文件） */
export async function resumeImport(
  sessionId: string,
  overrides: Partial<Record<SyncTable, Record<string, unknown>[]>> = {},
): Promise<ImportResult> {
  const session = await db.importSessions.get(sessionId);
  if (!session) {
    throw new Error('导入会话不存在，可能已被清理');
  }
  if (session.status === 'done') {
    await clearStaging(sessionId);
    return { outcome: 'duplicate', session, pending: 0 };
  }
  try {
    const counts = await mergeSession(session, overrides);
    const refreshed = (await db.importSessions.get(sessionId))!;
    const pending = await db.conflicts.where('status').equals('pending').count();
    // 裁决后续传且本会话已无待处理：按重复/完成处理，调用方据此停止续传
    if (refreshed.status === 'done') {
      await clearStaging(sessionId);
      return { outcome: 'duplicate', session: refreshed, counts, pending, resumed: true };
    }
    return { outcome: 'conflicts', session: refreshed, counts, pending, resumed: true };
  } catch (error) {
    await db.importSessions.update(sessionId, {
      status: 'failed',
      error: (error as Error).message,
      updatedAt: new Date().toISOString(),
    });
    return { outcome: 'failed', session: (await db.importSessions.get(sessionId))!, resumed: true };
  }
}

/* ------------------------------------------------------------------ */
/* 冲突裁决                                                            */
/* ------------------------------------------------------------------ */

export type ConflictSide = 'local' | 'remote';

/**
 * 人工裁决一条同名冲突：未决前备份侧记录不入本机，裁决后并入并自动续传暂挂记录。
 */
export async function resolveConflict(conflictId: string, side: ConflictSide): Promise<MergeCounts | undefined> {
  const conflict = await db.conflicts.get(conflictId);
  if (!conflict || conflict.status !== 'pending') {
    return undefined;
  }

  const remoteRow = conflict.remote;
  const remoteHash = hashRow(conflict.table, remoteRow);
  let resolvedLocalRow: Record<string, unknown> | undefined;
  let finalId = str(remoteRow.id);

  await db.transaction('rw', db[conflict.table], db.conflicts, db.meta, async () => {
    const ledger = await loadLedger();
    const ledgerKey = `${conflict.table}:${conflict.naturalKey}`;
    const base = ledger[ledgerKey];
    const now = new Date().toISOString();
    const localRows = (await db[conflict.table].toArray()) as unknown as Record<string, unknown>[];
    const localRow = localRows.find((row) => naturalKeyOf(conflict.table, row) === conflict.naturalKey);

    if (side === 'local') {
      if (!localRow) {
        throw new Error('本机记录已不存在，无法保留本机版本，请改用备份版本');
      }
      resolvedLocalRow = localRow;
      finalId = str(localRow.id);
      const localHash = hashRow(conflict.table, localRow);
      ledger[ledgerKey] = {
        ...(base ?? {}),
        contentHash: localHash,
        recordId: str(localRow.id),
        rejectedHashes: Array.from(new Set([...(base?.rejectedHashes ?? []), remoteHash])),
        at: now,
      } as LedgerEntry;
    } else {
      finalId = localRow ? str(localRow.id) : str(remoteRow.id);
      const out = { ...remoteRow, id: finalId };
      await db[conflict.table].put(out as never);
      resolvedLocalRow = out;
      const localHash = localRow ? hashRow(conflict.table, localRow) : undefined;
      ledger[ledgerKey] = {
        ...(base ?? {}),
        contentHash: remoteHash,
        recordId: finalId,
        rejectedHashes: localHash ? Array.from(new Set([...(base?.rejectedHashes ?? []), localHash])) : base?.rejectedHashes,
        at: now,
      } as LedgerEntry;
    }

    await db.meta.put({ key: LEDGER_KEY, value: JSON.stringify(ledger) });
    await db.conflicts.update(conflictId, {
      status: 'resolved',
      resolution: side,
      resolvedAt: now,
    });
  });

  // 裁决后重跑合并：放行被父记录挂起的批次/留样，整体幂等。
  // 把裁决结果作为 overrides 传入，确保刚写入的行及其 id 进入本次对账视图。
  const overrides: Partial<Record<SyncTable, Record<string, unknown>[]>> = {};
  overrides[conflict.table] = resolvedLocalRow ? [resolvedLocalRow] : [{ ...remoteRow, id: finalId }];
  return resumeImport(conflict.sessionId, overrides).then((result) => result.counts);
}

/* ------------------------------------------------------------------ */
/* 查询辅助                                                            */
/* ------------------------------------------------------------------ */

export async function listConflicts(): Promise<MergeConflict[]> {
  return db.conflicts.toArray();
}

export async function listImportSessions(): Promise<ImportSession[]> {
  return db.importSessions.reverse().toArray();
}

/** 启动时检查：是否存在中断/失败、可续传的导入 */
export async function findResumableSession(): Promise<ImportSession | undefined> {
  const sessions = await db.importSessions.toArray();
  return sessions.find((s) => s.status === 'failed' || s.status === 'staged' || s.status === 'merging' || s.status === 'parsing');
}

/** 从现有全表构建对账台账（示例数据/迁移后建立基线，避免把自身误判为冲突） */
export async function buildLedgerFromTables(): Promise<SyncLedger> {
  const [herbs, methods, batches, samples] = await Promise.all([
    db.herbs.toArray(),
    db.methods.toArray(),
    db.batches.toArray(),
    db.samples.toArray(),
  ]);
  const ledger: SyncLedger = {};
  (
    [
      ['herbs', herbs],
      ['methods', methods],
      ['batches', batches],
      ['samples', samples],
    ] as unknown as Array<[SyncTable, Record<string, unknown>[]]>
  ).forEach(([table, rows]) => {
    const now = new Date().toISOString();
    rows.forEach((row) => {
      ledger[`${table}:${naturalKeyOf(table, row)}`] = {
        contentHash: hashRow(table, row),
        recordId: str(row.id),
        at: now,
      };
    });
  });
  return ledger;
}

/** 仅当台账尚不存在时写入（首次建库建立基线） */
export async function ensureSeedLedger(): Promise<void> {
  const existing = await db.meta.get(LEDGER_KEY);
  if (existing?.value) return;
  const ledger = await buildLedgerFromTables();
  await db.meta.put({ key: LEDGER_KEY, value: JSON.stringify(ledger) });
}
