import { BACKUP_FORMAT_VERSION } from './constants';
import {
  db,
  findBookByFingerprint,
  saveBookWithChunks,
  savePageRows,
  saveSettings
} from './storage/db';
import type { BookRecord, ChunkRecord, PageCacheRow, ReaderSettings } from './types';

export interface BackupBookItem {
  book: BookRecord;
  chunks: ChunkRecord[];
  pages: PageCacheRow[];
}

export interface BackupFile {
  format: 'rensheng-yuedu-backup';
  version: number;
  exportedAt: string;
  settings: ReaderSettings | null;
  books: BackupBookItem[];
}

export interface BackupResult {
  imported: number;
  skipped: number;
  invalid: number;
}

function assertBackup(value: unknown): asserts value is BackupFile {
  if (!value || typeof value !== 'object') throw new Error('不是有效的备份文件');
  const backup = value as Partial<BackupFile>;
  if (backup.format !== 'rensheng-yuedu-backup' || backup.version !== BACKUP_FORMAT_VERSION) {
    throw new Error('备份文件版本不受支持');
  }
  if (!Array.isArray(backup.books)) throw new Error('备份文件缺少书库数据');
}

export async function exportBackupData(): Promise<BackupFile> {
  const books = await db.books.orderBy('importedAt').toArray();
  const items: BackupBookItem[] = [];
  for (const book of books) {
    const [chunks, pages] = await Promise.all([
      db.chunks.where('bookId').equals(book.id).sortBy('index'),
      db.pages.where('bookId').equals(book.id).sortBy('page')
    ]);
    items.push({ book, chunks, pages });
  }
  const settingsRow = await db.settings.get('reader');
  return {
    format: 'rensheng-yuedu-backup',
    version: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    settings: settingsRow ? (settingsRow.value as ReaderSettings) : null,
    books: items
  };
}

export async function importBackupData(
  backup: BackupFile,
  onProgress?: (index: number, total: number) => void
): Promise<BackupResult> {
  assertBackup(backup);
  const result: BackupResult = { imported: 0, skipped: 0, invalid: 0 };

  if (backup.settings) {
    await saveSettings(backup.settings);
  }

  const total = backup.books.length;
  for (let index = 0; index < total; index += 1) {
    const item = backup.books[index];
    if (!item?.book || !Array.isArray(item.chunks)) {
      result.invalid += 1;
      continue;
    }
    try {
      const existing = await db.books.get(item.book.id);
      const fingerprintMatch = existing
        ? true
        : await findBookByFingerprint(item.book.fingerprint);
      if (existing || fingerprintMatch) {
        result.skipped += 1;
        continue;
      }
      const book: BookRecord = {
        ...item.book,
        lastLayoutKey: null,
        lastPage: null,
        lastReadAt: item.book.lastReadAt,
        lastOffset: item.book.lastOffset
      };
      await saveBookWithChunks(book, item.chunks);
      const pages = Array.isArray(item.pages) ? item.pages : [];
      if (pages.length > 0) {
        await savePageRows(pages);
      }
      result.imported += 1;
    } catch {
      result.invalid += 1;
    }
    onProgress?.(index + 1, total);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return result;
}
