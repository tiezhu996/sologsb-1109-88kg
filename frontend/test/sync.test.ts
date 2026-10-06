import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '../src/utils/db';
import {
  buildLedgerFromTables,
  normalizeBackup,
  startImport,
  resumeImport,
  resolveConflict,
} from '../src/utils/sync';
import { ensureSeedLedger } from '../src/utils/sync';
import type { BackupPayload } from '../src/utils/export';
import type { HerbMaterial } from '../src/types/herb-material';
import type { ProcessBatch } from '../src/types/process-batch';
import type { RetainSample } from '../src/types/retain-sample';

function herb(over: Partial<HerbMaterial> = {}): HerbMaterial {
  return {
    id: 'h1',
    name: '白术',
    origin: '植物',
    part: '根',
    batchNo: 'BT-1',
    feedKg: 100,
    receivedAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...over,
  };
}

function batch(over: Partial<ProcessBatch> = {}): ProcessBatch {
  return {
    id: 'b1',
    batchNo: 'PZ-1',
    herbId: 'h1',
    methodId: 'm1',
    feedKg: 100,
    auxUsedKg: 10,
    fireLevel: '中火',
    startedAt: '2025-02-01T00:00:00.000Z',
    endedAt: '2025-02-01T00:10:00.000Z',
    yieldRate: 96,
    degree: '适中',
    operator: '张三',
    locked: false,
    updatedAt: '2025-02-01T00:10:00.000Z',
    ...over,
  };
}

function sample(over: Partial<RetainSample> = {}): RetainSample {
  return {
    id: 's1',
    sampleNo: 'LY-1',
    batchId: 'b1',
    amountG: 300,
    retainMonths: 12,
    cabinet: 'A-01',
    retainedAt: '2025-03-01T00:00:00.000Z',
    observeLogs: [],
    batchNoSnapshot: 'PZ-1',
    updatedAt: '2025-03-01T00:00:00.000Z',
    ...over,
  };
}

const method = {
  id: 'm1',
  name: '麸炒',
  auxiliary: '麦麸',
  auxRatio: 10,
  fireLevel: '中火',
  tempRange: [130, 160] as [number, number],
  duration: 10,
  criterion: '色转深黄',
  criterionDimension: '色泽' as const,
  applicable: '白术',
  updatedAt: '2025-01-01T00:00:00.000Z',
};

function backup(over: Partial<BackupPayload> = {}, rows?: { herbs?: unknown[]; methods?: unknown[]; batches?: unknown[]; samples?: unknown[] }): string {
  const payload: BackupPayload = {
    app: 'gbherbprocess',
    schemaVersion: 3,
    exportedAt: '2025-05-01T00:00:00.000Z',
    herbs: rows?.herbs ?? [],
    methods: rows?.methods ?? [],
    batches: rows?.batches ?? [],
    samples: rows?.samples ?? [],
    ...over,
  };
  return JSON.stringify(payload);
}

async function localCount() {
  const [herbs, methods, batches, samples] = await Promise.all([
    db.herbs.toArray(),
    db.methods.toArray(),
    db.batches.toArray(),
    db.samples.toArray(),
  ]);
  return { herbs, methods, batches, samples };
}

describe('备份对账合并', () => {
  it('备份中独有的记录并入本机，本机独有记录保留，不做整库覆盖', async () => {
    await db.herbs.put(herb({ id: 'local-h', name: '本地药材', batchNo: 'LOCAL-1' }));
    await db.methods.put(method);
    await ensureSeedLedger();

    const remoteHerb = herb({ id: 'remote-h', name: '他机药材', batchNo: 'REMOTE-1' });
    const result = await startImport(backup({}, { herbs: [remoteHerb] }), 'other.json');

    expect(result.outcome).toBe('merged');
    expect(result.counts?.added).toBe(1);
    const herbs = await db.herbs.toArray();
    expect(herbs.map((h) => h.batchNo).sort()).toEqual(['LOCAL-1', 'REMOTE-1']);
  });

  it('两侧内容一致时不产生更新，且重复导入同一份备份不会多出一份', async () => {
    await db.herbs.put(herb());
    await db.methods.put(method);
    await ensureSeedLedger();

    const first = await startImport(backup({}, { herbs: [herb()], methods: [method] }), 'a.json');
    expect(first.counts?.unchanged).toBe(2);
    expect((await db.herbs.count()).valueOf()).toBe(1);

    const second = await startImport(backup({}, { herbs: [herb()], methods: [method] }), 'a.json');
    expect(second.outcome).toBe('duplicate');
    expect((await db.herbs.count()).valueOf()).toBe(1);
    expect((await db.importSessions.count()).valueOf()).toBe(1);
  });

  it('同名记录两侧都改过（无共同基线）时列为冲突，未决前备份侧不入本机', async () => {
    await db.herbs.put(herb({ feedKg: 100 }));
    await db.methods.put(method);
    // 不建基线，模拟两台机器各自从同一初始台账改起
    const remoteHerb = herb({ feedKg: 200, id: 'remote-id' });
    const result = await startImport(backup({}, { herbs: [remoteHerb] }), 'b.json');

    expect(result.outcome).toBe('conflicts');
    expect(result.pending).toBe(1);
    const local = await db.herbs.where('batchNo').equals('BT-1').first();
    expect(local?.feedKg).toBe(100); // 未决，本机不变

    const conflicts = await db.conflicts.where('status').equals('pending').toArray();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].table).toBe('herbs');
  });

  it('冲突选择保留本机：本机内容保留，重跑同一备份不再翻盘', async () => {
    await db.herbs.put(herb({ feedKg: 100 }));
    await db.methods.put(method);
    await startImport(backup({}, { herbs: [herb({ feedKg: 200, id: 'r' })] }), 'c.json');

    const conflict = (await db.conflicts.where('status').equals('pending').toArray())[0];
    await resolveConflict(conflict.id, 'local');

    const local = await db.herbs.where('batchNo').equals('BT-1').first();
    expect(local?.feedKg).toBe(100);

    // 同份备份再次导入：曾被否决的内容不会翻盘（已完成会话按重复导入处理）
    const again = await startImport(backup({}, { herbs: [herb({ feedKg: 200, id: 'r' })] }), 'c.json');
    expect(['merged', 'duplicate']).toContain(again.outcome);
    const stillLocal = await db.herbs.where('batchNo').equals('BT-1').first();
    expect(stillLocal?.feedKg).toBe(100);
  });

  it('冲突选择采用备份：覆盖本机同业务记录且保留本机 id，不产生重复行', async () => {
    await db.herbs.put(herb({ id: 'local-id', feedKg: 100 }));
    await db.methods.put(method);
    await startImport(backup({}, { herbs: [herb({ feedKg: 200, id: 'remote-id' })] }), 'd.json');

    const conflict = (await db.conflicts.where('status').equals('pending').toArray())[0];
    await resolveConflict(conflict.id, 'remote');

    const rows = await db.herbs.where('batchNo').equals('BT-1').toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].feedKg).toBe(200);
    expect(rows[0].id).toBe('local-id'); // 保留本机 id，既有子表引用不断
  });

  it('有共同基线时仅一侧改过的自动合并，不列冲突', async () => {
    await db.herbs.put(herb({ feedKg: 100 }));
    await db.methods.put(method);
    await ensureSeedLedger(); // 基线 = feedKg 100

    // 本机改成 120（本机较新），备份仍是基线 → 保留本机
    await db.herbs.put(herb({ feedKg: 120, updatedAt: '2025-06-01T00:00:00.000Z' }));
    const result = await startImport(backup({}, { herbs: [herb({ feedKg: 100 })] }), 'e.json');
    expect(result.outcome).toBe('merged');
    expect(result.counts?.conflicts ?? 0).toBe(0);
    expect((await db.herbs.where('batchNo').equals('BT-1').first())?.feedKg).toBe(120);
  });

  it('锁定批次以锁定版本为准：备份改了得率也不回头改写本机锁定批', async () => {
    await db.herbs.put(herb());
    await db.methods.put(method);
    const lockedLocal = batch({
      yieldRate: 96,
      locked: true,
      lockedAt: '2025-02-01T00:30:00.000Z',
      lockSnapshot: {
        herbName: '白术',
        herbBatchNo: 'BT-1',
        methodName: '麸炒',
        auxiliary: '麦麸',
        auxRatio: 10,
        fireLevel: '中火',
        tempRange: [130, 160],
        duration: 10,
        criterion: '色转深黄',
      },
    });
    await db.batches.put(lockedLocal);
    await ensureSeedLedger();

    // 他机把同一批号改成得率 80（且仍标记锁定），不应覆盖本机锁定版本
    const remoteBatch = batch({ yieldRate: 80, locked: true, lockedAt: '2025-02-01T00:30:00.000Z' });
    const result = await startImport(backup({}, { batches: [remoteBatch] }), 'f.json');

    const local = await db.batches.where('batchNo').equals('PZ-1').first();
    expect(local?.yieldRate).toBe(96);
    // 自动裁定留痕，无未决冲突
    expect(result.pending ?? 0).toBe(0);
    const resolved = await db.conflicts.toArray();
    expect(resolved.some((c) => c.autoReason?.includes('锁定'))).toBe(true);
  });

  it('炮制方法在批次锁定后被修改，已锁定批次仍展示锁定快照', async () => {
    await db.herbs.put(herb());
    const lockedBatch = batch({
      locked: true,
      lockedAt: '2025-02-01T00:30:00.000Z',
      lockSnapshot: {
        herbName: '白术',
        herbBatchNo: 'BT-1',
        methodName: '麸炒',
        auxiliary: '麦麸',
        auxRatio: 10,
        fireLevel: '中火',
        tempRange: [130, 160],
        duration: 10,
        criterion: '色转深黄',
      },
    });
    await db.batches.put(lockedBatch);
    // 方法后改：辅料比例 10 → 15、时长 10 → 12
    await db.methods.put({ ...method, auxRatio: 15, duration: 12 });
    await ensureSeedLedger();

    const reloaded = await db.batches.where('batchNo').equals('PZ-1').first();
    expect(reloaded?.lockSnapshot?.auxRatio).toBe(10);
    expect(reloaded?.lockSnapshot?.duration).toBe(10);
  });

  it('父记录冲突未决时子记录暂挂；父记录裁决后子记录自动续传并入并重写引用', async () => {
    await db.herbs.put(herb({ id: 'local-herb', feedKg: 100 }));
    await db.methods.put(method);
    // 子批次引用本机药材 id，且有对账基线（本机未改）—— 他机改了得率应自动并入
    await db.batches.put(batch({ id: 'local-batch', herbId: 'local-herb', yieldRate: 96 }));
    await ensureSeedLedger();

    // 药材无基线且两侧都改 → 冲突；批次有基线、仅他机改 → 本应自动并入，但父药材未决先暂挂
    const meta = await db.meta.get('syncLedger');
    const ledger = JSON.parse(meta!.value) as Record<string, unknown>;
    delete ledger['herbs:白术|BT-1']; // 去掉药材基线，构造两侧都改的同名冲突
    await db.meta.put({ key: 'syncLedger', value: JSON.stringify(ledger) });

    const remoteHerb = herb({ id: 'remote-herb', feedKg: 200 });
    const remoteBatch = batch({ id: 'remote-batch', herbId: 'remote-herb', yieldRate: 90 });
    const result = await startImport(backup({}, { herbs: [remoteHerb], batches: [remoteBatch] }), 'g.json');
    expect(result.counts?.blocked).toBe(1);
    // 未决前批次仍是本机 96
    expect((await db.batches.where('batchNo').equals('PZ-1').first())?.yieldRate).toBe(96);

    // 裁决药材采用备份，触发续传：批次他机改动并入，且 herbId 重写为药材的本机落库 id
    const herbConflict = (await db.conflicts.where('status').equals('pending').toArray()).find((c) => c.table === 'herbs');
    expect(herbConflict).toBeTruthy();
    await resolveConflict(herbConflict!.id, 'remote');

    const storedBatch = await db.batches.where('batchNo').equals('PZ-1').first();
    expect(storedBatch?.yieldRate).toBe(90);
    expect(storedBatch?.herbId).toBe('local-herb'); // 引用指向药材并入后的本机 id
  });

  it('留样按关联批号并入，跨机 id 差异通过自然键重写 batchId', async () => {
    await db.herbs.put(herb({ id: 'local-herb' }));
    await db.methods.put(method);
    await db.batches.put(batch({ id: 'local-batch' }));
    await ensureSeedLedger();

    const remoteSample = sample({ id: 'remote-sample', batchId: 'remote-batch', sampleNo: 'LY-NEW' });
    const remoteBatch = batch({ id: 'remote-batch', sampleNo: undefined as never });
    const result = await startImport(
      backup({}, { batches: [remoteBatch], samples: [remoteSample] }),
      'h.json',
    );
    expect(result.outcome).toBe('merged');
    const stored = await db.samples.where('sampleNo').equals('LY-NEW').first();
    expect(stored).toBeTruthy();
    expect(stored?.batchId).toBe('local-batch');
  });

  it('旧版本（v1，无 locked 字段）备份升级后正常并入', async () => {
    await db.herbs.put(herb());
    await db.methods.put(method);
    await ensureSeedLedger();

    const oldBatch: Record<string, unknown> = {
      id: 'old-b',
      batchNo: 'PZ-OLD',
      herbId: 'h1',
      methodId: 'm1',
      feedKg: 100,
      auxUsedKg: 10,
      fireLevel: '中火',
      startedAt: '2025-02-01T00:00:00.000Z',
      endedAt: '2025-02-01T00:10:00.000Z',
      yieldRate: 96,
      degree: '适中',
      operator: '张三',
      // 注意：故意不带 locked / updatedAt
    };
    const result = await startImport(
      JSON.stringify({ app: 'gbherbprocess', schemaVersion: 1, exportedAt: '2025-03-01T00:00:00.000Z', herbs: [], methods: [], batches: [oldBatch], samples: [] }),
      'v1.json',
    );
    expect(result.outcome).toBe('merged');
    const stored = await db.batches.where('batchNo').equals('PZ-OLD').first();
    expect(stored?.locked).toBe(false);
    expect(stored?.updatedAt).toBeTruthy();
  });

  it('normalizeBackup 为历史已锁定批次补锁定快照、为留样补批号快照', async () => {
    const lockedBatch = batch({ locked: true, lockedAt: '2025-02-01T00:30:00.000Z' });
    delete (lockedBatch as Partial<ProcessBatch>).lockSnapshot;
    const oldSample = sample();
    delete (oldSample as Partial<RetainSample>).batchNoSnapshot;

    const normalized = normalizeBackup({
      app: 'gbherbprocess',
      schemaVersion: 2,
      exportedAt: '2025-04-01T00:00:00.000Z',
      herbs: [herb()],
      methods: [method],
      batches: [lockedBatch],
      samples: [{ ...oldSample, batchId: 'b1' }],
    });
    expect(normalized.batches[0].lockSnapshot?.herbName).toBe('白术');
    expect(normalized.samples[0].batchNoSnapshot).toBe('PZ-1');
  });

  it('失败的导入可重试，且失败期间本机库不被破坏', async () => {
    await db.herbs.put(herb({ name: '本地保留', batchNo: 'KEEP-1' }));
    await db.methods.put(method);
    await ensureSeedLedger();

    // 制造一个非法行（缺 id）—— 该行被规整过滤；其余正常并入，不应整体失败。
    const bad = { name: '无id药材', batchNo: 'X-1' };
    const good = herb({ id: 'g1', name: '正常药材', batchNo: 'OK-1' });
    const result = await startImport(backup({}, { herbs: [bad, good] }), 'i.json');
    expect(result.outcome).toBe('merged');
    expect((await db.herbs.where('batchNo').equals('KEEP-1').count()).valueOf()).toBe(1);
    expect((await db.herbs.where('batchNo').equals('OK-1').count()).valueOf()).toBe(1);
    expect((await db.herbs.where('batchNo').equals('X-1').count()).valueOf()).toBe(0);
  });

  it('导入会话与暂存行落库，可通过 resumeImport 重放且结果幂等', async () => {
    await db.herbs.put(herb());
    await db.methods.put(method);
    await ensureSeedLedger();

    const result = await startImport(
      backup({}, { herbs: [herb({ id: 'x', name: '续传药材', batchNo: 'RESUME-1' })] }),
      'resume.json',
    );
    expect(result.outcome).toBe('merged');
    const session = result.session;

    // 完成后暂存区被清理、会话标记 done
    expect(session.status).toBe('done');
    expect((await db.staging.where('sessionId').equals(session.id).count()).valueOf()).toBe(0);

    // 显式续传已完成会话：返回 duplicate，不新增数据
    const again = await resumeImport(session.id);
    expect(again.outcome).toBe('duplicate');
    expect((await db.herbs.where('batchNo').equals('RESUME-1').count()).valueOf()).toBe(1);
  });

  it('重复导入不同文件名但相同内容：按内容指纹识别为同一份，不多出一份', async () => {
    await db.herbs.put(herb());
    await db.methods.put(method);
    await ensureSeedLedger();

    const text = backup({}, { herbs: [herb({ id: 'z', name: '同内容药材', batchNo: 'HASH-1' })] });
    await startImport(text, 'copy-a.json');
    const second = await startImport(text, 'copy-b-renamed.json');
    expect(second.outcome).toBe('duplicate');
    expect((await db.herbs.where('batchNo').equals('HASH-1').count()).valueOf()).toBe(1);
    expect((await db.importSessions.count()).valueOf()).toBe(1);
  });

  it('处理过的冲突重开仍在（已决记录持久保留）', async () => {
    await db.herbs.put(herb({ feedKg: 100 }));
    await db.methods.put(method);
    await startImport(backup({}, { herbs: [herb({ feedKg: 200, id: 'r' })] }), 'j.json');
    const conflict = (await db.conflicts.where('status').equals('pending').toArray())[0];
    await resolveConflict(conflict.id, 'local');

    // 重新读取（模拟重开应用）
    const all = await db.conflicts.toArray();
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe('resolved');
    expect(all[0].resolution).toBe('local');
    expect(all[0].resolvedAt).toBeTruthy();
  });

  it('buildLedgerFromTables 为现有全表建立内容基线', async () => {
    await db.herbs.put(herb());
    await db.methods.put(method);
    await db.batches.put(batch());
    await db.samples.put(sample());
    const ledger = await buildLedgerFromTables();
    expect(Object.keys(ledger).sort()).toEqual([
      'batches:PZ-1',
      'herbs:白术|BT-1',
      'methods:麸炒|麦麸|10|中火|10|色泽',
      'samples:LY-1',
    ]);
    const counts = await localCount();
    expect(counts.batches).toHaveLength(1);
  });
});
