import { CHUNK_SIZE } from '../../core/constants';
import { makeId } from '../../core/id';
import { deleteBook, type ReaderDatabase } from '../../core/storage/db';
import type { BookRecord, ChunkRecord, EncodingId } from '../../core/types';
import type { DecodedChunk } from './worker-client';

const SAVE_BATCH = 20;

export function titleFromFileName(fileName: string): string {
  const base = fileName.replace(/\\/g, '/').split('/').pop() ?? fileName;
  // 仅去掉 .txt 之类的扩展名；保留用户文件名其余部分。
  const dot = base.lastIndexOf('.');
  if (dot > 0 && dot < base.length - 1) return base.slice(0, dot);
  return base;
}

export async function persistImportedBook(
  db: ReaderDatabase,
  input: {
    id?: string;
    title: string;
    originalFileName: string;
    fingerprint: string;
    encoding: EncodingId;
    totalChars: number;
    chunks: DecodedChunk[];
    importedAt?: number;
  },
  onProgress?: (percent: number) => void
): Promise<BookRecord> {
  const id = input.id ?? makeId();
  const chunkRecords: ChunkRecord[] = input.chunks.map((chunk) => ({
    bookId: id,
    index: chunk.index,
    start: chunk.start,
    text: chunk.text
  }));
  const book: BookRecord = {
    id,
    title: input.title.trim() || titleFromFileName(input.originalFileName),
    originalFileName: input.originalFileName,
    fingerprint: input.fingerprint,
    encoding: input.encoding,
    totalChars: input.totalChars,
    chunkCount: chunkRecords.length,
    importedAt: input.importedAt ?? Date.now(),
    lastReadAt: null,
    lastOffset: 0,
    lastLayoutKey: null,
    lastPage: null
  };

  try {
    for (let i = 0; i < chunkRecords.length; i += SAVE_BATCH) {
      const batch = chunkRecords.slice(i, i + SAVE_BATCH);
      await db.chunks.bulkPut(batch);
      if (onProgress) {
        onProgress(Math.round((Math.min(i + SAVE_BATCH, chunkRecords.length) / chunkRecords.length) * 100));
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    await db.books.put(book);
    return book;
  } catch (error) {
    // 写入中途失败时清理不完整的书，避免书架出现“半本书”。
    await deleteBook(id).catch(() => undefined);
    throw error;
  }
}

/** 校验分块与字符总数一致，避免损坏的备份/异常数据入库。 */
export function validateDecodedChunks(totalChars: number, chunks: DecodedChunk[]): void {
  let covered = 0;
  for (const chunk of [...chunks].sort((a, b) => a.index - b.index)) {
    if (chunk.start !== chunk.index * CHUNK_SIZE) {
      throw new Error('分块偏移不连续');
    }
    if (chunk.start !== covered) {
      throw new Error('分块之间有缺漏或重叠');
    }
    covered += chunk.text.length;
  }
  if (covered !== totalChars) {
    throw new Error('分块长度与总字符数不一致');
  }
}
