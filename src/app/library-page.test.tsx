import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '../core/storage/db';
import { LibraryPage } from './LibraryPage';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('书架页', () => {
  it('空书架展示导入引导', async () => {
    render(<LibraryPage onOpenBook={vi.fn()} />);
    expect(await screen.findByText('书架还是空的')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ 导入文档' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '导入书籍' })).not.toBeInTheDocument();
  });

  it('新导入的书可直接点“开始阅读”进入', async () => {
    await db.books.add({
      id: 'book-new',
      title: '新书',
      originalFileName: '新书.pdf',
      fingerprint: 'fp-new',
      encoding: 'utf-8',
      totalChars: 1000,
      chunkCount: 1,
      importedAt: Date.now(),
      lastReadAt: null,
      lastOffset: 0,
      lastLayoutKey: null,
      lastPage: null
    });
    const onOpenBook = vi.fn();
    render(<LibraryPage onOpenBook={onOpenBook} />);
    expect(await screen.findByText('新书')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '开始阅读' }));
    expect(onOpenBook).toHaveBeenCalledWith('book-new');
  });
});
