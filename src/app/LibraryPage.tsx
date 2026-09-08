import { useCallback, useEffect, useRef, useState } from 'react';

import { ConfirmDialog } from '../components/ConfirmDialog';
import { deleteBook, listBooks } from '../core/storage/db';
import { importBackupData, exportBackupData, type BackupFile } from '../core/backup';
import type { BookRecord } from '../core/types';
import { ImportDialog } from '../features/library/ImportDialog';

export interface LibraryPageProps {
  onOpenBook: (bookId: string) => void;
}

function isTxtFile(file: File): boolean {
  return file.name.toLowerCase().endsWith('.txt') || file.type === 'text/plain';
}

function formatReadTime(timestamp: number | null): string {
  if (!timestamp) return '尚未阅读';
  const date = new Date(timestamp);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) {
    return `今天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  }
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

export function LibraryPage({ onOpenBook }: LibraryPageProps) {
  const [books, setBooks] = useState<BookRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<BookRecord | null>(null);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const txtInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const next = await listBooks();
    setBooks(next);
    setSelectedId((current) => {
      if (current && next.some((book) => book.id === current)) return current;
      return next[0]?.id ?? null;
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const importBook = useCallback(
    (book: BookRecord, openNow: boolean) => {
      setImportFile(null);
      void refresh();
      if (openNow) onOpenBook(book.id);
    },
    [onOpenBook, refresh]
  );

  const openSelected = useCallback(
    (id?: string) => {
      const target = id ?? selectedId ?? books[0]?.id;
      if (target) onOpenBook(target);
    },
    [books, onOpenBook, selectedId]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (importFile || confirmDelete || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable
      ) {
        return;
      }
      if (
        (event.key === 'Enter' || event.key === ' ') &&
        target instanceof HTMLElement &&
        target.closest('button')
      ) {
        return;
      }
      if (books.length === 0) return;

      const index = books.findIndex((book) => book.id === selectedId);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        const nextIndex = (index + delta + books.length) % books.length;
        setSelectedId(books[nextIndex].id);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        openSelected();
      } else if (event.key === 'Delete') {
        const selected = books.find((book) => book.id === selectedId);
        if (selected) setConfirmDelete(selected);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [books, confirmDelete, importFile, openSelected, selectedId]);

  const handleFileDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragging(false);
      const file = Array.from(event.dataTransfer.files).find(isTxtFile);
      if (!file) {
        setNotice('请拖入 .txt 文本文件');
        window.setTimeout(() => setNotice(null), 3500);
        return;
      }
      setImportFile(file);
    },
    []
  );

  const handleFilePick = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';
    if (file) setImportFile(file);
  }, []);

  const handleExport = useCallback(async () => {
    setBackupBusy(true);
    try {
      const data = await exportBackupData();
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `人生阅读备份-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice('书库备份已导出');
    } catch (error) {
      setNotice(error instanceof Error ? `导出失败：${error.message}` : '导出失败');
    } finally {
      setBackupBusy(false);
      window.setTimeout(() => setNotice(null), 3500);
    }
  }, []);

  const handleBackupFile = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0] ?? null;
      event.target.value = '';
      if (!file) return;
      setBackupBusy(true);
      try {
        const text = await file.text();
        const backup = JSON.parse(text) as BackupFile;
        const result = await importBackupData(backup);
        await refresh();
        setNotice(
          `备份恢复完成：新导入 ${result.imported} 本，跳过重复 ${result.skipped} 本${
            result.invalid ? `，忽略损坏 ${result.invalid} 本` : ''
          }`
        );
      } catch (error) {
        setNotice(error instanceof Error ? `恢复失败：${error.message}` : '备份文件无效');
      } finally {
        setBackupBusy(false);
        window.setTimeout(() => setNotice(null), 5000);
      }
    },
    [refresh]
  );

  const handleQuitService = useCallback(async () => {
    try {
      const response = await fetch('/api/quit', { method: 'POST' });
      if (!response.ok) throw new Error('服务未响应');
      setNotice('本地服务已停止，现在可以关闭此页面');
      window.setTimeout(() => window.close(), 800);
    } catch {
      setNotice('退出仅在使用「人生阅读」本地服务时可用');
    } finally {
      window.setTimeout(() => setNotice(null), 4000);
    }
  }, []);

  const handleDelete = useCallback(async () => {
    if (!confirmDelete) return;
    await deleteBook(confirmDelete.id);
    setConfirmDelete(null);
    await refresh();
  }, [confirmDelete, refresh]);

  const empty = books.length === 0;

  return (
    <div
      className="library-page"
      onDragEnter={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        setDragging(false);
      }}
      onDrop={(event) => {
        void handleFileDrop(event);
      }}
    >
      <header className="library-header">
        <div className="library-title">
          <h1>人生阅读</h1>
          <p className="muted">本地书架 · 读得动大书，记得住进度</p>
        </div>
        <div className="library-actions">
          <button
            type="button"
            className="button ghost small"
            title="停止本地服务（仅本地服务版可用）"
            onClick={() => void handleQuitService()}
          >
            退出本地服务
          </button>
          <button
            type="button"
            className="button ghost small"
            disabled={backupBusy}
            onClick={() => backupInputRef.current?.click()}
          >
            导入备份
          </button>
          <button
            type="button"
            className="button ghost small"
            disabled={backupBusy}
            onClick={() => void handleExport()}
          >
            导出书库
          </button>
          <button
            type="button"
            className="button primary"
            onClick={() => txtInputRef.current?.click()}
          >
            + 导入 TXT
          </button>
        </div>
      </header>

      <input
        ref={txtInputRef}
        type="file"
        accept=".txt,text/plain"
        hidden
        onChange={handleFilePick}
      />
      <input
        ref={backupInputRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(event) => void handleBackupFile(event)}
      />

      <main className="library-main">
        {loading ? (
          <div className="empty-state">
            <div className="spinner" />
            <p>正在打开书架…</p>
          </div>
        ) : empty ? (
          <div className="empty-state">
            <div className="empty-icon">📚</div>
            <h2>书架还是空的</h2>
            <p>点击右上角「导入 TXT」，或直接把文本文件拖进这个窗口。</p>
            <p className="muted small">支持 UTF-8、GBK / GB18030、Big5、UTF-16 的中文 TXT，大文件也放心导入。</p>
          </div>
        ) : (
          <>
            <div className="shelf-tip muted small">
              最近在读的书排在最前面。使用 ↑ ↓ 选择，Enter 阅读，Delete 删除。
            </div>
            <ul className="book-list" aria-label="书库">
              {books.map((book) => {
                const percent =
                  book.totalChars > 0 ? Math.min(100, (book.lastOffset / book.totalChars) * 100) : 0;
                return (
                  <li
                    key={book.id}
                    className={`book-card ${selectedId === book.id ? 'selected' : ''}`}
                    onClick={() => setSelectedId(book.id)}
                    onDoubleClick={() => onOpenBook(book.id)}
                  >
                    <div className="book-cover" aria-hidden="true">
                      {book.title.slice(0, 1) || '书'}
                    </div>
                    <div className="book-info">
                      <div className="book-title-row">
                        <span className="book-title">{book.title}</span>
                        <span className="book-time">{formatReadTime(book.lastReadAt)}</span>
                      </div>
                      <div className="book-meta muted small">
                        {book.totalChars > 10000
                          ? `${(book.totalChars / 10000).toFixed(book.totalChars >= 100000 ? 0 : 1)} 万字`
                          : `${book.totalChars} 字`}
                        <span aria-hidden="true"> · </span>
                        {book.originalFileName}
                      </div>
                      <div className="progress-track thin">
                        <div className="progress-fill" style={{ width: `${percent}%` }} />
                      </div>
                    </div>
                    <div className="book-actions">
                      {book.lastReadAt && (
                        <button
                          type="button"
                          className="button small"
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpenBook(book.id);
                          }}
                        >
                          续读 {Math.round(percent)}%
                        </button>
                      )}
                      <button
                        type="button"
                        className="icon-button subtle"
                        aria-label={`删除《${book.title}》`}
                        title="删除"
                        onClick={(event) => {
                          event.stopPropagation();
                          setConfirmDelete(book);
                        }}
                      >
                        🗑
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </main>

      {dragging && (
        <div className="drop-overlay">
          <div>松开即可导入 TXT</div>
        </div>
      )}

      {notice && <div className="toast" role="status">{notice}</div>}

      <ImportDialog
        file={importFile}
        onDismiss={() => setImportFile(null)}
        onImported={importBook}
      />

      {confirmDelete && (
        <ConfirmDialog
          title="删除书籍"
          message={
            <>
              确定删除《{confirmDelete.title}》吗？阅读进度和已导入的内容都会被移除。
              {confirmDelete.lastReadAt
                ? ` 你已读到 ${Math.round((confirmDelete.lastOffset / confirmDelete.totalChars) * 100)}%。`
                : ''}
            </>
          }
          confirmLabel="删除"
          danger
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => void handleDelete()}
        />
      )}
    </div>
  );
}
