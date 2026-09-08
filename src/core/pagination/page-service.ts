import { PAGE_YIELD_EVERY } from '../constants';
import { listPageRows, savePageRows } from '../storage/db';
import type { BookTextSource } from '../text-source';
import type { DomPageMeasurer } from './dom-measurer';

export interface LocatedPage {
  /** 页码（从 0 开始）。 */
  page: number;
  start: number;
  end: number;
  reachedEndOfBook: boolean;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 把一个布局下的页边界作为“从第 0 页开始的连续前缀”缓存。
 * 读取任意偏移时，从已知的最新页边界向后逐页排版到目标附近；
 * 计算过的边界都会落库，因此同一布局再次打开可秒回。
 */
export class PageService {
  /** starts[i] = 第 i 页的起始字符偏移；前缀必须从 0 连续。 */
  private starts: number[] = [];
  private pendingSave: { bookId: string; layoutKey: string; page: number; start: number }[] = [];

  constructor(
    private readonly bookId: string,
    private readonly layoutKey: string,
    private readonly measurer: DomPageMeasurer,
    private readonly source: BookTextSource
  ) {}

  async loadCachedPrefix(): Promise<void> {
    const rows = await listPageRows(this.bookId, this.layoutKey);
    rows.sort((a, b) => a.page - b.page);
    const starts: number[] = [];
    for (const row of rows) {
      if (row.page !== starts.length) break; // 只信任从 0 连续的前缀
      if (starts.length === 0 && row.start !== 0) break;
      starts.push(row.start);
    }
    if (starts.length === 0) starts.push(0);
    this.starts = starts;
  }

  private async flush(force = false): Promise<void> {
    if (this.pendingSave.length === 0) return;
    if (!force && this.pendingSave.length < PAGE_YIELD_EVERY) return;
    const batch = this.pendingSave.splice(0);
    await savePageRows(batch);
  }

  private async pushBoundary(start: number): Promise<void> {
    const page = this.starts.length;
    this.starts.push(start);
    this.pendingSave.push({ bookId: this.bookId, layoutKey: this.layoutKey, page, start });
    if (this.pendingSave.length >= PAGE_YIELD_EVERY) {
      await this.flush();
      await sleep(0);
    }
  }

  private pageIndexForOffset(offset: number): number {
    let index = 0;
    const effective = Math.min(offset, Math.max(0, this.source.totalChars - 1));
    for (let i = 0; i < this.starts.length; i += 1) {
      if (this.starts[i] <= effective) index = i;
      else break;
    }
    return index;
  }

  /**
   * 定位到包含 offset 的页。必要时会从已知前缀末尾向后连续排版。
   * onProgress 参数为 0–1（相对起点到目标的排版进度），用于大距离跳转。
   */
  async locate(
    offset: number,
    onProgress?: (ratio: number) => void
  ): Promise<LocatedPage> {
    const target = Math.max(0, Math.min(offset, this.source.totalChars));
    if (this.starts.length === 0) {
      this.starts.push(0);
    }
    if (target > 0) {
      const originOffset = this.starts[this.starts.length - 1];
      let scans = 0;
      while (
        this.starts[this.starts.length - 1] <= target &&
        this.starts[this.starts.length - 1] < this.source.totalChars
      ) {
        const cursor = this.starts[this.starts.length - 1];
        const next = await this.measurer.pageEnd(cursor, this.source);
        if (next <= cursor || next >= this.source.totalChars) {
          // 防御：出现无法推进的异常布局时停止。
          break;
        }
        await this.pushBoundary(next);
        scans += 1;
        if (scans % PAGE_YIELD_EVERY === 0 && onProgress && target > originOffset) {
          const ratio = Math.min(0.99, (next - originOffset) / (target - originOffset));
          onProgress(ratio);
        }
      }
    }
    await this.flush(true);

    const index = this.pageIndexForOffset(target);
    return this.pageAt(index, target);
  }

  /** 取得某页的起始与终点（终点未知时现场排版并缓存下一页边界）。 */
  async pageAt(pageIndex: number, expectedOffset?: number): Promise<LocatedPage> {
    if (pageIndex < 0) {
      throw new Error('页码不能为负');
    }
    if (this.starts.length === 0) this.starts.push(0);
    while (pageIndex >= this.starts.length) {
      const cursor = this.starts[this.starts.length - 1];
      if (cursor >= this.source.totalChars) {
        throw new Error('已到全书末尾');
      }
      const next = await this.measurer.pageEnd(cursor, this.source);
      await this.pushBoundary(next);
    }

    const start = this.starts[pageIndex];
    if (pageIndex + 1 < this.starts.length) {
      // end 在下方统一计算
    } else if (start < this.source.totalChars) {
      const next = await this.measurer.pageEnd(start, this.source);
      if (next < this.source.totalChars) {
        await this.pushBoundary(next);
      }
    } else {
      // 已是末页
    }
    await this.flush(true);

    const gotOffset = expectedOffset ?? start;
    const index = this.pageIndexForOffset(gotOffset);
    const resolved = this.starts[index];
    const isLastKnownPage = index === this.starts.length - 1;
    return {
      page: index,
      start: resolved,
      end: index + 1 < this.starts.length ? this.starts[index + 1] : this.source.totalChars,
      reachedEndOfBook:
        isLastKnownPage &&
        (resolved >= this.source.totalChars ||
          (index + 1 < this.starts.length
            ? this.starts[index + 1] >= this.source.totalChars
            : true))
    };
  }

  async pageCountKnown(): Promise<number> {
    return this.starts.length;
  }

  hasPage(pageIndex: number): boolean {
    return pageIndex >= 0 && pageIndex < this.starts.length;
  }
}
