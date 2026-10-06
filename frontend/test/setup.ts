import 'fake-indexeddb/auto';
import { beforeEach } from 'vitest';
import { db } from '../src/utils/db';

/** 每个用例使用全新的 IndexedDB：删除库后重新打开，触发最新 schema 建表 */
beforeEach(async () => {
  await db.delete();
  await db.open();
});
