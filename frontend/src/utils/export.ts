import { db, SCHEMA_VERSION } from './db';

export interface BackupPayload {
  app: string;
  schemaVersion: number;
  exportedAt: string;
  herbs: unknown[];
  methods: unknown[];
  batches: unknown[];
  samples: unknown[];
}

/** 汇总全部本地表为 JSON 备份（schema 迁移前先导出） */
export async function buildBackup(): Promise<BackupPayload> {
  const [herbs, methods, batches, samples] = await Promise.all([
    db.herbs.toArray(),
    db.methods.toArray(),
    db.batches.toArray(),
    db.samples.toArray(),
  ]);
  return {
    app: 'gbherbprocess',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    herbs,
    methods,
    batches,
    samples,
  };
}

export async function exportBackupJson(): Promise<string> {
  return JSON.stringify(await buildBackup(), null, 2);
}

export function downloadText(filename: string, text: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** 导出 CSV（台账打印用） */
export function downloadCsv<T extends Record<string, unknown>>(filename: string, rows: T[], columns: Array<{ key: keyof T; title: string }>): void {
  const header = columns.map((c) => `"${c.title}"`).join(',');
  const body = rows
    .map((row) => columns.map((c) => `"${String(row[c.key] ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  downloadText(filename, `\ufeff${header}\n${body}`, 'text/csv');
}

/** 恢复 JSON 备份 */
export async function importBackup(text: string): Promise<{ herbs: number; methods: number; batches: number; samples: number }> {
  const payload = JSON.parse(text) as Partial<BackupPayload>;
  if (!payload || payload.app !== 'gbherbprocess') {
    throw new Error('备份文件格式不匹配（缺少 app=gbherbprocess 标记）');
  }
  const counts = {
    herbs: payload.herbs?.length ?? 0,
    methods: payload.methods?.length ?? 0,
    batches: payload.batches?.length ?? 0,
    samples: payload.samples?.length ?? 0,
  };
  await db.transaction('rw', db.herbs, db.methods, db.batches, db.samples, async () => {
    await Promise.all([
      db.herbs.clear(),
      db.methods.clear(),
      db.batches.clear(),
      db.samples.clear(),
    ]);
    if (payload.herbs?.length) await db.herbs.bulkPut(payload.herbs as never[]);
    if (payload.methods?.length) await db.methods.bulkPut(payload.methods as never[]);
    if (payload.batches?.length) await db.batches.bulkPut(payload.batches as never[]);
    if (payload.samples?.length) await db.samples.bulkPut(payload.samples as never[]);
  });
  return counts;
}
