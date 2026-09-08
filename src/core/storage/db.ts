import Dexie, { type Table } from 'dexie';

import { DB_NAME } from '../constants';
import type { BookRecord, ChunkRecord, PageCacheRow, ReaderSettings } from '../types';

export class ReaderDatabase extends Dexie {
  books!: Table<BookRecord, string>;
  chunks!: Table<ChunkRecord, [string, number]>;
  pages!: Table<PageCacheRow, number>;
  settings!: Table<{ key: string; value: unknown }, string>;

  constructor(name = DB_NAME) {
    super(name);
    this.version(1).stores({
      books: 'id, fingerprint, lastReadAt, importedAt',
      chunks: '[bookId+index], [bookId+start], bookId',
      pages: '++id, [bookId+layoutKey+page], bookId, layoutKey',
      settings: 'key'
    });
  }
}

export const db = new ReaderDatabase();

export async function getBook(id: string): Promise<BookRecord | undefined> {
  return db.books.get(id);
}

export async function findBookByFingerprint(fingerprint: string): Promise<BookRecord | undefined> {
  return db.books.where('fingerprint').equals(fingerprint).first();
}

export async function listBooks(): Promise<BookRecord[]> {
  const all = await db.books.toArray();
  return all.sort((a, b) => {
    const ar = a.lastReadAt ?? 0;
    const br = b.lastReadAt ?? 0;
    if (ar !== br) return br - ar;
    return b.importedAt - a.importedAt;
  });
}

export async function saveBookWithChunks(
  book: BookRecord,
  chunks: ChunkRecord[]
): Promise<void> {
  await db.transaction('rw', [db.books, db.chunks], async () => {
    await db.books.put(book);
    if (chunks.length > 0) {
      await db.chunks.bulkPut(chunks);
    }
  });
}

export async function deleteBook(id: string): Promise<void> {
  await db.transaction('rw', [db.books, db.chunks, db.pages], async () => {
    await db.chunks.where('bookId').equals(id).delete();
    await db.pages.where('bookId').equals(id).delete();
    await db.books.delete(id);
  });
}

export async function setReadingPosition(
  bookId: string,
  offset: number,
  layoutKey: string,
  page: number
): Promise<void> {
  await db.books.update(bookId, {
    lastOffset: offset,
    lastReadAt: Date.now(),
    lastLayoutKey: layoutKey,
    lastPage: page
  });
}

export async function getSettings(): Promise<ReaderSettings> {
  const row = await db.settings.get('reader');
  const defaults: ReaderSettings = { fontSize: 18, lineHeight: 1.8 };
  if (!row?.value) return defaults;
  const value = row.value as Partial<ReaderSettings>;
  return {
    fontSize:
      typeof value.fontSize === 'number' && value.fontSize >= 12 && value.fontSize <= 32
        ? value.fontSize
        : defaults.fontSize,
    lineHeight:
      typeof value.lineHeight === 'number' && value.lineHeight >= 1.2 && value.lineHeight <= 2.6
        ? value.lineHeight
        : defaults.lineHeight
  };
}

export async function saveSettings(settings: ReaderSettings): Promise<void> {
  await db.settings.put({ key: 'reader', value: settings });
}

export async function listPageRows(bookId: string, layoutKey: string): Promise<PageCacheRow[]> {
  return db.pages
    .where('[bookId+layoutKey+page]')
    .between([bookId, layoutKey, Dexie.minKey], [bookId, layoutKey, Dexie.maxKey])
    .sortBy('page');
}

export async function savePageRows(rows: PageCacheRow[]): Promise<void> {
  if (rows.length === 0) return;
  await db.pages.bulkPut(rows);
}

export async function clearPageRows(bookId: string, layoutKey: string): Promise<void> {
  await db.pages.where('layoutKey').equals(layoutKey).and((row) => row.bookId === bookId).delete();
}
