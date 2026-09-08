import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '../storage/db';
import { PageService } from './page-service';
import type { BookTextSource } from '../text-source';
import type { DomPageMeasurer } from './dom-measurer';

const TOTAL = 1050;
const CHARS_PER_PAGE = 100;

function fakeSource() {
  const full = '测'.repeat(TOTAL);
  return {
    totalChars: TOTAL,
    getText: async (start: number, end: number) => full.slice(start, end)
  } as unknown as BookTextSource;
}

function fakeMeasurer() {
  return {
    pageEnd: async (start: number, source: BookTextSource) =>
      Math.min(source.totalChars, start + CHARS_PER_PAGE),
    estimatedPageChars: CHARS_PER_PAGE
  } as unknown as DomPageMeasurer;
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('PageService：页边界缓存与断点定位', () => {
  it('从开头向后连续排版，页边界不重叠也不缺漏', async () => {
    const service = new PageService('book-1', 'layout-a', fakeMeasurer(), fakeSource());
    await service.loadCachedPrefix();
    const page = await service.locate(499);
    expect(page.start).toBe(400);
    expect(page.end).toBe(500);
    expect(page.page).toBe(4);

    const next = await service.pageAt(5);
    expect(next.start).toBe(500);
    expect(next.end).toBe(600);
  });

  it('定位到全书末尾时返回最后一页', async () => {
    const service = new PageService('book-1', 'layout-a', fakeMeasurer(), fakeSource());
    await service.loadCachedPrefix();
    const page = await service.locate(TOTAL);
    expect(page.start).toBe(1000);
    expect(page.end).toBe(TOTAL);
    expect(page.reachedEndOfBook).toBe(true);
    expect(page.page).toBe(10);
  });

  it('同一布局下的缓存前缀可被再次加载，无需重新排版', async () => {
    const first = new PageService('book-1', 'layout-a', fakeMeasurer(), fakeSource());
    await first.loadCachedPrefix();
    await first.locate(499);

    const second = new PageService('book-1', 'layout-a', fakeMeasurer(), fakeSource());
    await second.loadCachedPrefix();
    const cached = await second.locate(499);
    expect(cached.start).toBe(400);
    expect(cached.end).toBe(500);
  });

  it('同一本书在不同布局指纹下各自缓存', async () => {
    const serviceA = new PageService('book-1', 'layout-a', fakeMeasurer(), fakeSource());
    await serviceA.loadCachedPrefix();
    await serviceA.locate(450);

    const serviceB = new PageService('book-1', 'layout-b', fakeMeasurer(), fakeSource());
    await serviceB.loadCachedPrefix();
    const pageB = await serviceB.locate(150);
    expect(pageB.start).toBe(100);

    const againA = new PageService('book-1', 'layout-a', fakeMeasurer(), fakeSource());
    await againA.loadCachedPrefix();
    expect(await againA.locate(450)).toMatchObject({ start: 400 });
  });
});
