import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';

import { ConfirmDialog } from '../components/ConfirmDialog';
import { Modal } from '../components/Modal';
import { MAX_READING_WIDTH } from '../core/constants';
import { DomPageMeasurer } from '../core/pagination/dom-measurer';
import { computeLayoutKey, type PageBox } from '../core/pagination/layout-key';
import { PageService } from '../core/pagination/page-service';
import {
  getBook,
  deleteBook,
  getSettings,
  saveSettings,
  setReadingPosition,
  db
} from '../core/storage/db';
import { BookTextSource } from '../core/text-source';
import type { BookRecord, ReaderSettings } from '../core/types';
import { SHORTCUTS } from '../core/shortcuts';

export interface ReaderPageProps {
  bookId: string;
  onBack: () => void;
}

interface PageView {
  pageIndex: number;
  start: number;
  end: number;
  text: string;
}

interface SessionResources {
  layoutKey: string;
  source: BookTextSource;
  measurer: DomPageMeasurer;
  service: PageService;
}

interface StoredPosition {
  start: number;
  layoutKey: string;
  page: number;
}

const clampPercent = (value: number) => Math.max(0, Math.min(100, value));

function SettingsPanel({
  settings,
  onChange
}: {
  settings: ReaderSettings;
  onChange: (next: ReaderSettings) => void;
}) {
  const [draft, setDraft] = useState<ReaderSettings>(settings);
  useEffect(() => setDraft(settings), [settings]);

  const apply = (next: ReaderSettings) => {
    setDraft(next);
    onChange(next);
  };

  return (
    <div className="settings-body">
      <label className="settings-row">
        <span>
          字号 <b>{draft.fontSize}px</b>
        </span>
        <div className="settings-controls">
          <button
            type="button"
            className="button small ghost"
            onClick={() => apply({ ...draft, fontSize: Math.max(12, draft.fontSize - 1) })}
            disabled={draft.fontSize <= 12}
            aria-label="减小字号"
          >
            A−
          </button>
          <input
            type="range"
            min="12"
            max="32"
            step="1"
            value={draft.fontSize}
            aria-label="字号"
            onChange={(event) => {
              const value = Number(event.target.value);
              setDraft({ ...draft, fontSize: value });
            }}
            onPointerUp={() => onChange({ ...draft, fontSize: draft.fontSize })}
            onKeyUp={(event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                onChange({ ...draft, fontSize: draft.fontSize });
              }
            }}
          />
          <button
            type="button"
            className="button small ghost"
            onClick={() => apply({ ...draft, fontSize: Math.min(32, draft.fontSize + 1) })}
            disabled={draft.fontSize >= 32}
            aria-label="增大字号"
          >
            A+
          </button>
        </div>
      </label>
      <label className="settings-row">
        <span>
          行距 <b>{draft.lineHeight.toFixed(1)}</b>
        </span>
        <div className="settings-controls">
          <input
            type="range"
            min="1.4"
            max="2.4"
            step="0.1"
            value={draft.lineHeight}
            aria-label="行距"
            onChange={(event) => {
              const value = Number(event.target.value);
              setDraft({ ...draft, lineHeight: value });
            }}
            onPointerUp={() => onChange({ ...draft, lineHeight: draft.lineHeight })}
          />
        </div>
      </label>
      <div className="settings-preview" style={{ fontSize: draft.fontSize, lineHeight: draft.lineHeight }}>
        每当我看见路，我就想起故乡…这是调整字号与行距后的效果预览。
      </div>
      <p className="muted small">设置会全局保存，也会用新的排版重新定位当前进度。</p>
    </div>
  );
}

export function ReaderPage({ bookId, onBack }: ReaderPageProps) {
  const [book, setBook] = useState<BookRecord | null>(null);
  const [bookMissing, setBookMissing] = useState(false);
  const [settings, setSettings] = useState<ReaderSettings>({ fontSize: 18, lineHeight: 1.8 });
  const [dims, setDims] = useState<{ width: number; height: number } | null>(null);
  const [view, setView] = useState<PageView | null>(null);
  const [phase, setPhase] = useState<'loading' | 'locating' | 'ready'>('loading');
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [dragPercent, setDragPercent] = useState<number | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const mainRef = useRef<HTMLDivElement>(null);
  const seekRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<SessionResources | null>(null);
  const viewRef = useRef<PageView | null>(null);
  const lastOffsetRef = useRef(0);
  const storedPositionRef = useRef<StoredPosition | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const taskTokenRef = useRef(0);
  const navBusyRef = useRef(false);
  const dragStateRef = useRef<{ active: boolean; pointerId: number }>({ active: false, pointerId: -1 });

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  // 读取书籍元数据与全局阅读设置。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [loadedBook, loadedSettings] = await Promise.all([getBook(bookId), getSettings()]);
      if (cancelled) return;
      if (!loadedBook) {
        setBookMissing(true);
        return;
      }
      setBook(loadedBook);
      lastOffsetRef.current = loadedBook.lastOffset ?? 0;
      setSettings(loadedSettings);
    })();
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  // 观察可用阅读区域，字号/行距/窗口变化都会产生新的布局指纹。
  useEffect(() => {
    const node = mainRef.current;
    if (!node) return;
    const update = () => {
      const rect = node.getBoundingClientRect();
      const width = Math.max(220, Math.min(MAX_READING_WIDTH, Math.floor(rect.width) - 48));
      const height = Math.max(120, Math.floor(rect.height) - 24);
      setDims((current) =>
        current?.width === width && current.height === height ? current : { width, height }
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const pageBox = useMemo<PageBox | null>(
    () =>
      dims
        ? {
            width: dims.width,
            height: dims.height,
            fontSize: settings.fontSize,
            lineHeight: settings.lineHeight
          }
        : null,
    [dims, settings.fontSize, settings.lineHeight]
  );

  const persistPosition = useCallback(() => {
    const position = storedPositionRef.current;
    if (!position) return;
    void setReadingPosition(bookId, position.start, position.layoutKey, position.page).catch(() => {
      // 写入失败不打断阅读；下次翻页或关闭时会再次尝试。
    });
  }, [bookId]);

  const schedulePositionSave = useCallback(
    (position: StoredPosition) => {
      storedPositionRef.current = position;
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null;
        persistPosition();
      }, 450);
    },
    [persistPosition]
  );

  const showLocatedPage = useCallback(
    async (
      located: Awaited<ReturnType<PageService['pageAt']>>,
      token: number = taskTokenRef.current
    ) => {
      const session = sessionRef.current;
      if (!session) return;
      const text = await session.source.getText(located.start, located.end);
      if (token !== taskTokenRef.current) return;
      const next: PageView = {
        pageIndex: located.page,
        start: located.start,
        end: located.end,
        text
      };
      setView(next);
      viewRef.current = next;
      lastOffsetRef.current = next.start;
      schedulePositionSave({
        start: next.start,
        layoutKey: session.layoutKey,
        page: next.pageIndex
      });
      setPhase('ready');
      setStatusMessage('');
    },
    [schedulePositionSave]
  );

  // 为当前 bookId + 布局构建排版会话，并恢复/定位阅读进度。
  useEffect(() => {
    if (!book || !pageBox) return;
    const token = ++taskTokenRef.current;
    navBusyRef.current = false;
    const previous = sessionRef.current;
    sessionRef.current = null;
    previous?.measurer.dispose();

    setView(null);
    setPhase('locating');
    setStatusMessage('正在恢复上次阅读位置…');
    setError(null);

    const layoutKey = computeLayoutKey(pageBox);
    const source = new BookTextSource(db, book.id, book.totalChars);
    const measurer = new DomPageMeasurer(pageBox);
    const service = new PageService(book.id, layoutKey, measurer, source);

    let disposed = false;
    void (async () => {
      try {
        await service.loadCachedPrefix();
        if (disposed || token !== taskTokenRef.current) return;
        const offset = lastOffsetRef.current;
        const located = await service.locate(offset, (ratio) => {
          if (token === taskTokenRef.current) {
            setStatusMessage(`正在排版定位… ${Math.round(ratio * 100)}%`);
          }
        });
        if (disposed || token !== taskTokenRef.current) return;
        sessionRef.current = { layoutKey, source, measurer, service };
        await showLocatedPage(located, token);
      } catch (caught) {
        if (disposed || token !== taskTokenRef.current) return;
        measurer.dispose();
        setError(caught instanceof Error ? caught.message : '阅读器初始化失败');
        setPhase('ready');
      }
    })();

    return () => {
      disposed = true;
      sessionRef.current = null;
      measurer.dispose();
    };
  }, [book, pageBox, showLocatedPage]);

  // 关闭标签页/切到后台时立即落盘进度。
  useEffect(() => {
    const flushNow = () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      persistPosition();
    };
    window.addEventListener('pagehide', flushNow);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushNow();
    });
    return () => {
      window.removeEventListener('pagehide', flushNow);
      document.removeEventListener('visibilitychange', flushNow);
      flushNow();
    };
  }, [persistPosition]);

  const runTask = useCallback(async (label: string, task: () => Promise<void>) => {
    if (navBusyRef.current) return;
    navBusyRef.current = true;
    const token = taskTokenRef.current;
    setStatusMessage(label);
    try {
      await task();
    } catch (caught) {
      if (token === taskTokenRef.current) {
        setError(caught instanceof Error ? caught.message : '操作失败');
      }
    } finally {
      if (token === taskTokenRef.current) {
        setStatusMessage('');
      }
      navBusyRef.current = false;
    }
  }, []);

  const turnTo = useCallback(
    (pageIndex: number) => {
      if (pageIndex < 0) return;
      const session = sessionRef.current;
      if (!session || navBusyRef.current) return;
      void runTask('正在翻页…', async () => {
        const token = taskTokenRef.current;
        const located = await session.service.pageAt(pageIndex);
        if (token !== taskTokenRef.current) return;
        await showLocatedPage(located, token);
      });
    },
    [runTask, showLocatedPage]
  );

  const previousPage = useCallback(() => {
    const current = viewRef.current;
    if (current && current.pageIndex > 0) turnTo(current.pageIndex - 1);
  }, [turnTo]);

  const nextPage = useCallback(() => {
    const current = viewRef.current;
    if (!current) return;
    const session = sessionRef.current;
    if (!session) return;
    if (current.start >= session.source.totalChars || current.end >= session.source.totalChars) {
      return;
    }
    turnTo(current.pageIndex + 1);
  }, [turnTo]);

  const jumpToPercent = useCallback(
    (percent: number) => {
      const session = sessionRef.current;
      if (!session || navBusyRef.current) return;
      const offset = Math.round((clampPercent(percent) / 100) * session.source.totalChars);
      void runTask('正在跳转…', async () => {
        const token = taskTokenRef.current;
        const located = await session.service.locate(offset, (ratio) => {
          if (token === taskTokenRef.current) {
            setStatusMessage(`正在排版跳转… ${Math.round(ratio * 100)}%`);
          }
        });
        if (token !== taskTokenRef.current) return;
        await showLocatedPage(located, token);
      });
    },
    [runTask, showLocatedPage]
  );

  const updateSettings = useCallback(
    (next: ReaderSettings) => {
      setSettings(next);
      void saveSettings(next).catch(() => undefined);
    },
    []
  );

  // 键盘快捷键：只在阅读器聚焦且未输入时生效。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable;
      if (event.key === 'Escape') {
        if (helpOpen) setHelpOpen(false);
        else if (settingsOpen) setSettingsOpen(false);
        else onBack();
        return;
      }
      if (typing || helpOpen) return;
      const key = event.key;
      if (
        (key === ' ' || key === 'Enter') &&
        target instanceof HTMLElement &&
        target.closest('button')
      ) {
        return;
      }
      if (key === 'ArrowRight' || key === ' ' || key === 'PageDown') {
        event.preventDefault();
        nextPage();
      } else if (key === 'ArrowLeft' || key === 'PageUp') {
        event.preventDefault();
        previousPage();
      } else if (key === 's' || key === 'S') {
        setSettingsOpen((open) => !open);
      } else if (key === '?') {
        setHelpOpen(true);
      } else if (settingsOpen && (key === '+' || key === '=')) {
        event.preventDefault();
        updateSettings({
          ...settings,
          fontSize: Math.min(32, settings.fontSize + 1)
        });
      } else if (settingsOpen && (key === '-' || key === '_')) {
        event.preventDefault();
        updateSettings({
          ...settings,
          fontSize: Math.max(12, settings.fontSize - 1)
        });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [helpOpen, nextPage, onBack, previousPage, settings, settingsOpen, updateSettings]);

  // 进度条拖动。
  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragStateRef.current = { active: true, pointerId: event.pointerId };
    seekRef.current?.setPointerCapture(event.pointerId);
    const ratio = ratioFromPointer(event);
    setDragPercent(clampPercent(ratio * 100));
  };

  const ratioFromPointer = (event: React.PointerEvent | PointerEvent) => {
    const track = seekRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    return clampPercent(((event.clientX - rect.left) / Math.max(1, rect.width)) * 100) / 100;
  };

  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStateRef.current.active || dragStateRef.current.pointerId !== event.pointerId) return;
    setDragPercent(clampPercent(ratioFromPointer(event) * 100));
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStateRef.current.active || dragStateRef.current.pointerId !== event.pointerId) return;
    dragStateRef.current = { active: false, pointerId: -1 };
    const value = dragPercent;
    setDragPercent(null);
    if (value !== null) jumpToPercent(value);
  };

  const shortcutsByScope = useMemo(() => {
    const all = SHORTCUTS.filter((item) => item.scope !== 'library');
    return all;
  }, []);

  if (bookMissing) {
    return (
      <div className="reader-root">
        <div className="empty-state">
          <h2>找不到这本书</h2>
          <p>它可能已被删除。</p>
          <button type="button" className="button primary" onClick={onBack}>
            返回书架
          </button>
        </div>
      </div>
    );
  }

  const atLastPage =
    view &&
    book &&
    view.end >= book.totalChars;
  const displayPercent =
    book && book.totalChars > 0 ? clampPercent((view?.start ?? 0) / book.totalChars * 100) : 0;

  return (
    <div className="reader-root">
      <header className="reader-header">
        <button type="button" className="reader-back button ghost" onClick={onBack}>
          ‹ 书架
        </button>
        <div className="reader-title" title={book?.title}>
          {book?.title ?? '…'}
        </div>
        <div className="reader-header-actions">
          <button
            type="button"
            className="button ghost small"
            title="阅读设置（S）"
            onClick={() => setSettingsOpen((open) => !open)}
          >
            Aa
          </button>
          <button
            type="button"
            className="button ghost small"
            title="快捷键说明（?）"
            onClick={() => setHelpOpen(true)}
          >
            ?
          </button>
          <button
            type="button"
            className="icon-button subtle"
            aria-label="删除本书"
            title="删除本书"
            onClick={() => setDeleteConfirmOpen(true)}
          >
            🗑
          </button>
        </div>
      </header>

      <main
        ref={mainRef}
        className="reader-main"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const x = event.clientX - rect.left;
          if (x < rect.width * 0.28) previousPage();
          else if (x > rect.width * 0.72) nextPage();
        }}
      >
        {!book || !pageBox || phase === 'loading' ? (
          <div className="reader-loading">
            <div className="spinner" />
            <p>打开中…</p>
          </div>
        ) : phase === 'locating' ? (
          <div className="reader-loading">
            <div className="spinner" />
            <p>{statusMessage || '正在排版…'}</p>
          </div>
        ) : error ? (
          <div className="reader-loading">
            <div className="error-text">出错了：{error}</div>
            <button type="button" className="button ghost small" onClick={onBack}>
              返回书架
            </button>
          </div>
        ) : view ? (
          <div
            className="reader-page-wrap"
            style={{ width: pageBox.width, height: pageBox.height }}
          >
            <div
              className="reader-page"
              style={{
                fontSize: settings.fontSize,
                lineHeight: settings.lineHeight,
                height: '100%'
              }}
            >
              {view.text}
            </div>
          </div>
        ) : null}
      </main>

      <footer className="reader-footer">
        <button type="button" className="button ghost small page-button" onClick={previousPage}>
          ‹ 上一页
        </button>
        <div className="reader-progress">
          <span className="reader-percent">{Math.round(displayPercent)}%</span>
          <div
            ref={seekRef}
            className="seek-track"
            role="slider"
            aria-label="阅读进度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(dragPercent ?? displayPercent)}
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <div
              className="seek-fill"
              style={{ width: `${Math.round(dragPercent ?? displayPercent)}%` }}
            />
            <div
              className="seek-handle"
              style={{ left: `calc(${Math.round(dragPercent ?? displayPercent)}% - 7px)` }}
            />
          </div>
          <span className="reader-page-num">
            {atLastPage ? '最后一页' : view ? `第 ${view.pageIndex + 1} 页` : '—'}
          </span>
        </div>
        <button type="button" className="button ghost small page-button" onClick={nextPage}>
          下一页 ›
        </button>
      </footer>

      <div className="click-hint muted small">点击左右两侧翻页 · 拖动底部进度条跳转</div>

      {settingsOpen && (
        <Modal title="阅读设置" onClose={() => setSettingsOpen(false)} width={460}>
          <SettingsPanel settings={settings} onChange={updateSettings} />
        </Modal>
      )}

      {helpOpen && (
        <Modal title="键盘快捷键" onClose={() => setHelpOpen(false)} width={520}>
          <ul className="shortcut-list">
            {shortcutsByScope.map((item) => (
              <li key={`${item.scope}-${item.label}`}>
                <kbd>{item.keys}</kbd>
                <span>{item.label}</span>
              </li>
            ))}
          </ul>
          <p className="muted small">在输入框或弹窗内不会触发阅读快捷键。</p>
        </Modal>
      )}

      {deleteConfirmOpen && book && (
        <ConfirmDialog
          title="删除本书"
          message={
            <>
              确定删除《{book.title}》吗？本书正文、阅读进度和分页缓存都会被移除。
            </>
          }
          confirmLabel="删除并返回书架"
          danger
          onCancel={() => setDeleteConfirmOpen(false)}
          onConfirm={() => {
            setDeleteConfirmOpen(false);
            void (async () => {
              await deleteBook(bookId);
              onBack();
            })();
          }}
        />
      )}
    </div>
  );
}
