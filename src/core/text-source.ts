import type { ReaderDatabase } from './storage/db';
import { CHUNK_SIZE } from './constants';

/** 按需从 IndexedDB 读取字符区间，并对最近读取的少量块做内存缓存。 */
export class BookTextSource {
  private readonly cache = new Map<number, string>();
  private readonly maxCachedChunks = 12;

  constructor(
    private readonly db: ReaderDatabase,
    readonly bookId: string,
    readonly totalChars: number
  ) {}

  async getText(start: number, end: number): Promise<string> {
    if (end <= start) return '';
    const first = Math.max(0, Math.floor(start / CHUNK_SIZE));
    const last = Math.min(
      Math.floor((this.totalChars - 1) / CHUNK_SIZE),
      Math.floor((end - 1) / CHUNK_SIZE)
    );
    if (first > last) return '';

    let output = '';
    for (let index = first; index <= last; index += 1) {
      const chunkStart = index * CHUNK_SIZE;
      const chunkEnd = Math.min(this.totalChars, chunkStart + CHUNK_SIZE);
      const localStart = Math.max(0, start - chunkStart);
      const localEnd = Math.min(chunkEnd, end) - chunkStart;
      if (localEnd <= localStart) continue;
      let text = this.cache.get(index);
      if (text === undefined) {
        const row = await this.db.chunks.get([this.bookId, index]);
        if (!row) {
          throw new Error(`书籍分块数据缺失：块 ${index}`);
        }
        text = row.text;
        this.cache.set(index, text);
        if (this.cache.size > this.maxCachedChunks) {
          const oldest = this.cache.keys().next().value as number;
          this.cache.delete(oldest);
        }
      }
      output += text.slice(localStart, localEnd);
    }
    return output;
  }
}
