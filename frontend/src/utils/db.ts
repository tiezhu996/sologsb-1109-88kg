import Dexie, { type Table } from 'dexie';
import type { HerbMaterial } from '../types/herb-material';
import type { ProcessingMethod } from '../types/processing-method';
import type { ProcessBatch } from '../types/process-batch';
import type { RetainSample } from '../types/retain-sample';
import type { ImportSession, MergeConflict, StagingRow } from '../types/sync';

/** IndexedDB 库名（浏览器本地存储，无后端） */
export const DB_NAME = 'gbherbprocess-db';

/** 当前 schema 版本，与 db.version(n) 对应 */
export const SCHEMA_VERSION = 3;

class HerbProcessDB extends Dexie {
  herbs!: Table<HerbMaterial, string>;
  methods!: Table<ProcessingMethod, string>;
  batches!: Table<ProcessBatch, string>;
  samples!: Table<RetainSample, string>;
  meta!: Table<{ key: string; value: string }, string>;
  /** 跨机备份对账冲突（已决记录保留，重开仍在） */
  conflicts!: Table<MergeConflict, string>;
  /** 备份升级导入会话（中断可续传、失败可重试） */
  importSessions!: Table<ImportSession, string>;
  /** 导入暂存行（按会话分块，续传不重复） */
  staging!: Table<StagingRow, string>;

  constructor() {
    super(DB_NAME);

    // v1：建表声明索引
    this.version(1).stores({
      herbs: 'id, name, origin, part, batchNo, receivedAt',
      methods: 'id, name, auxiliary, fireLevel',
      batches: 'id, batchNo, herbId, methodId, degree, startedAt',
      samples: 'id, sampleNo, batchId, cabinet, retainedAt',
      meta: 'key',
    });

    // v2：批次表增加 locked 索引（锁定/质检放行查询更快），并回填历史数据的 locked 字段。
    // 升级前请在「导出备份」中导出 JSON。
    this.version(2)
      .stores({
        herbs: 'id, name, origin, part, batchNo, receivedAt',
        methods: 'id, name, auxiliary, fireLevel',
        batches: 'id, batchNo, herbId, methodId, degree, startedAt, locked',
        samples: 'id, sampleNo, batchId, cabinet, retainedAt',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        await tx
          .table('batches')
          .toCollection()
          .modify((row: ProcessBatch) => {
            if (typeof row.locked !== 'boolean') {
              row.locked = false;
            }
          });
      });

    // v3：跨机备份对账合并
    //  - conflicts：同名记录两侧都改时的未决/已决冲突（首页显示冲突数，处理记录永久保留）
    //  - importSessions / staging：旧备份升级导入的断点续传与失败重试
    //  - 回填 updatedAt；为历史已锁定批次补锁定版本快照（药材/方法后改不回头改写）
    this.version(3)
      .stores({
        herbs: 'id, name, origin, part, batchNo, receivedAt',
        methods: 'id, name, auxiliary, fireLevel',
        batches: 'id, batchNo, herbId, methodId, degree, startedAt, locked',
        samples: 'id, sampleNo, batchId, cabinet, retainedAt',
        meta: 'key',
        conflicts: 'id, table, naturalKey, status, sessionId, createdAt',
        importSessions: 'id, fileHash, status, createdAt, updatedAt',
        staging: 'id, sessionId, table, chunkIndex',
      })
      .upgrade(async (tx) => {
        const herbs = (await tx.table('herbs').toArray()) as HerbMaterial[];
        const methods = (await tx.table('methods').toArray()) as ProcessingMethod[];
        const batches = (await tx.table('batches').toArray()) as ProcessBatch[];
        const herbById = new Map(herbs.map((h) => [h.id, h]));
        const methodById = new Map(methods.map((m) => [m.id, m]));
        const batchById = new Map(batches.map((b) => [b.id, b]));

        await tx
          .table('herbs')
          .toCollection()
          .modify((row: HerbMaterial) => {
            if (!row.updatedAt) row.updatedAt = row.receivedAt;
          });
        await tx
          .table('methods')
          .toCollection()
          .modify((row: ProcessingMethod) => {
            if (!row.updatedAt) row.updatedAt = new Date(0).toISOString();
          });
        await tx
          .table('batches')
          .toCollection()
          .modify((row: ProcessBatch) => {
            if (typeof row.locked !== 'boolean') row.locked = false;
            if (row.locked && !row.lockSnapshot) {
              const herb = herbById.get(row.herbId);
              const method = methodById.get(row.methodId);
              row.lockSnapshot = {
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
            if (!row.updatedAt) row.updatedAt = row.lockedAt || row.endedAt || row.startedAt;
          });
        await tx
          .table('samples')
          .toCollection()
          .modify((row: RetainSample) => {
            if (!row.batchNoSnapshot) row.batchNoSnapshot = batchById.get(row.batchId)?.batchNo;
            if (!row.updatedAt) {
              const lastLog = row.observeLogs.map((log) => log.date).sort().at(-1);
              row.updatedAt = (lastLog ? new Date(lastLog).toISOString() : undefined) || row.retainedAt;
            }
          });
      });
  }
}

export const db = new HerbProcessDB();

export async function getMeta(key: string): Promise<string | undefined> {
  const row = await db.meta.get(key);
  return row?.value;
}

export async function setMeta(key: string, value: string): Promise<void> {
  await db.meta.put({ key, value });
}
