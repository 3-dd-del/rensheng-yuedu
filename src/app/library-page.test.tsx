import { render, screen } from '@testing-library/react';
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
    expect(screen.getByRole('button', { name: '+ 导入 TXT' })).toBeInTheDocument();
  });
});
