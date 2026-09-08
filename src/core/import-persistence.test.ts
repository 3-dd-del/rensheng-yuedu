import { beforeEach, describe, expect, it } from 'vitest';

import { splitText } from './encoding';
import { persistImportedBook } from '../features/import/import-core';
import { exportBackupData, importBackupData } from './backup';
import {
  db,
  deleteBook,
  findBookByFingerprint,
  getBook,
  getSettings,
  listBooks,
  listPageRows,
  saveSettings,
  savePageRows
} from './storage/db';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('书库数据持久化', () => {
  it('保存书籍与分块后可读回', async () => {
    const text = '这是一本测试书。'.repeat(500);
    const parts = splitText(text, 20);
    const book = await persistImportedBook(db, {
      title: '测试书',
      originalFileName: '测试书.txt',
      fingerprint: 'abc123',
      encoding: 'utf-8',
      totalChars: text.length,
      chunks: parts.map((part, index) => ({ index, start: index * 20, text: part }))
    });

    const stored = await getBook(book.id);
    expect(stored?.totalChars).toBe(text.length);
    expect(stored?.chunkCount).toBe(parts.length);
    const library = await listBooks();
    expect(library.map((item) => item.id)).toContain(book.id);
    expect(await findBookByFingerprint('abc123')).toMatchObject({ id: book.id });
  });

  it('删除书籍会一并移除正文与分页缓存', async () => {
    const parts = splitText('删除测试'.repeat(100), 10);
    const book = await persistImportedBook(db, {
      title: '删除测试书',
      originalFileName: 'delete.txt',
      fingerprint: 'delete-fp',
      encoding: 'utf-8',
      totalChars: 500,
      chunks: parts.map((part, index) => ({ index, start: index * 10, text: part }))
    });
    await savePageRows([{ bookId: book.id, layoutKey: 'L', page: 0, start: 0 }]);
    await deleteBook(book.id);
    expect(await getBook(book.id)).toBeUndefined();
    expect(await listPageRows(book.id, 'L')).toEqual([]);
  });

  it('阅读设置本地记忆并做范围校验', async () => {
    await saveSettings({ fontSize: 24, lineHeight: 2.0 });
    expect(await getSettings()).toEqual({ fontSize: 24, lineHeight: 2.0 });
    await saveSettings({ fontSize: 1, lineHeight: 9 });
    expect(await getSettings()).toEqual({ fontSize: 18, lineHeight: 1.8 });
  });

  it('书库备份导出后可恢复到空数据库', async () => {
    const text = '备份恢复测试。'.repeat(120);
    const parts = splitText(text, 12);
    const book = await persistImportedBook(db, {
      title: '备份书',
      originalFileName: 'backup.txt',
      fingerprint: 'backup-fp-1',
      encoding: 'gb18030',
      totalChars: text.length,
      chunks: parts.map((part, index) => ({ index, start: index * 12, text: part }))
    });
    await saveSettings({ fontSize: 22, lineHeight: 2.1 });
    await savePageRows([{ bookId: book.id, layoutKey: 'L1', page: 0, start: 0 }]);

    const backup = await exportBackupData();
    expect(backup.format).toBe('rensheng-yuedu-backup');
    expect(backup.books).toHaveLength(1);

    await db.delete();
    await db.open();
    const result = await importBackupData(backup);
    expect(result.imported).toBe(1);
    const restored = await getBook(book.id);
    expect(restored).toMatchObject({ title: '备份书', totalChars: text.length });
    expect(await listPageRows(book.id, 'L1')).toHaveLength(1);
    expect(await getSettings()).toEqual({ fontSize: 22, lineHeight: 2.1 });

    // 同一指纹再次恢复会被跳过，不产生重复。
    const again = await importBackupData(backup);
    expect(again.skipped).toBe(1);
  });
});
