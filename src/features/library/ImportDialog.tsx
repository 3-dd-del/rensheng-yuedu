import { useCallback, useEffect, useRef, useState } from 'react';

import { decodePreview, ENCODING_LABEL, ENCODING_OPTIONS } from '../../core/encoding';
import { findBookByFingerprint, db } from '../../core/storage/db';
import type { BookRecord, DetectionResult, EncodingId } from '../../core/types';
import { Modal } from '../../components/Modal';
import { persistImportedBook, validateDecodedChunks } from '../import/import-core';
import { ImportWorkerClient } from '../import/worker-client';

type Phase =
  | { name: 'idle' }
  | { name: 'detecting'; fileName: string }
  | { name: 'duplicate'; fileName: string; existing: BookRecord }
  | {
      name: 'encoding';
      fileName: string;
      file: File;
      fingerprint: string;
      initial: DetectionResult;
      previewText: string;
      selected: EncodingId;
      reason: string;
    }
  | { name: 'importing'; fileName: string; percent: number; message: string }
  | { name: 'done'; fileName: string; book: BookRecord }
  | { name: 'error'; fileName: string; message: string };

export interface ImportDialogProps {
  file: File | null;
  onDismiss: () => void;
  onImported: (book: BookRecord, openNow: boolean) => void;
}

function basisText(detection: DetectionResult): string {
  if (detection.basis === 'bom') return '文件带有编码标记（BOM），已自动识别';
  if (detection.basis === 'utf8-valid') return '内容通过严格 UTF-8 校验';
  if (detection.basis === 'heuristic') {
    const confidence = detection.confidence == null ? '' : `（置信度 ${Math.round(detection.confidence * 100)}%）`;
    return `按内容特征探测为 ${ENCODING_LABEL[detection.encoding]}${confidence}`;
  }
  return '未能可靠判断编码，请手动选择';
}

export function ImportDialog({ file, onDismiss, onImported }: ImportDialogProps) {
  const [phase, setPhase] = useState<Phase>({ name: 'idle' });
  const [previewLoading, setPreviewLoading] = useState(false);
  const workerRef = useRef<ImportWorkerClient | null>(null);

  useEffect(() => {
    if (!file) return;
    if (!workerRef.current) workerRef.current = new ImportWorkerClient();
    return () => {
      workerRef.current?.dispose();
      workerRef.current = null;
    };
  }, [file]);

  const beginImport = useCallback(
    async (fileName: string, fingerprint: string, encoding: EncodingId, fileForRead: File) => {
      const worker = workerRef.current;
      if (!worker) return;
      setPhase({ name: 'importing', fileName, percent: 2, message: '正在解码全文…' });
      try {
        const buffer = await fileForRead.arrayBuffer();
        const payload = await worker.decodeChunks(buffer, encoding, (percent) => {
          setPhase({
            name: 'importing',
            fileName,
            percent: Math.round(8 + percent * 0.55),
            message: percent < 35 ? '正在解码全文…' : '正在按页分块…'
          });
        });
        validateDecodedChunks(payload.totalChars, payload.chunks);
        setPhase({
          name: 'importing',
          fileName,
          percent: 68,
          message: '正在写入本地书库…'
        });
        const book = await persistImportedBook(
          db,
          {
            title: fileName.replace(/\.[^.]+$/, ''),
            originalFileName: fileName,
            fingerprint: fingerprint || payload.fingerprint,
            encoding,
            totalChars: payload.totalChars,
            chunks: payload.chunks
          },
          (percent) => {
            setPhase({
              name: 'importing',
              fileName,
              percent: Math.round(68 + percent * 0.3),
              message: '正在写入本地书库…'
            });
          }
        );
        setPhase({ name: 'done', fileName, book });
      } catch (error) {
        setPhase({
          name: 'error',
          fileName,
          message: error instanceof Error ? error.message : '导入失败，请重试'
        });
      }
    },
    []
  );

  useEffect(() => {
    if (!file) {
      setPhase({ name: 'idle' });
      return;
    }
    const worker = workerRef.current;
    if (!worker) return;

    let cancelled = false;
    const fileName = file.name;
    (async () => {
      setPhase({ name: 'detecting', fileName });
      try {
        const buffer = await file.arrayBuffer();
        const payload = await worker.detectFile(buffer);
        if (cancelled) return;

        const existing = await findBookByFingerprint(payload.fingerprint);
        if (existing) {
          setPhase({ name: 'duplicate', fileName, existing });
          return;
        }

        if (payload.detection.auto) {
          await beginImport(fileName, payload.fingerprint, payload.detection.encoding, file);
          return;
        }

        const previewBytes = new Uint8Array(await file.slice(0, 16_000).arrayBuffer());
        const previewText = decodePreview(previewBytes, payload.detection.encoding);
        setPhase({
          name: 'encoding',
          fileName,
          file,
          fingerprint: payload.fingerprint,
          initial: payload.detection,
          previewText,
          selected: payload.detection.encoding,
          reason: basisText(payload.detection)
        });
      } catch (error) {
        if (!cancelled) {
          setPhase({
            name: 'error',
            fileName,
            message: error instanceof Error ? error.message : '读取文件失败'
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file, beginImport]);

  const busy = phase.name === 'detecting' || phase.name === 'importing';
  const title =
    phase.name === 'duplicate'
      ? '书库中已有此书'
      : phase.name === 'encoding'
        ? '选择文字编码'
        : phase.name === 'done'
          ? '导入完成'
          : phase.name === 'error'
            ? '导入失败'
            : '导入书籍';

  const changeEncoding = async (encoding: EncodingId) => {
    if (phase.name !== 'encoding') return;
    setPreviewLoading(true);
    try {
      const bytes = new Uint8Array(await phase.file.slice(0, 16_000).arrayBuffer());
      setPhase({ ...phase, selected: encoding, previewText: decodePreview(bytes, encoding) });
    } finally {
      setPreviewLoading(false);
    }
  };

  const renderBody = () => {
    if (phase.name === 'idle') return null;
    if (phase.name === 'detecting') {
      return (
        <div className="import-progress">
          <div className="spinner" aria-hidden="true" />
          <p>正在识别编码并计算内容指纹…</p>
        </div>
      );
    }
    if (phase.name === 'duplicate') {
      return (
        <div>
          <p>
            <strong>{phase.existing.title}</strong> 已经在书库中（内容指纹一致），不会重复导入。
          </p>
          <p className="muted">上次阅读到 {Math.round((phase.existing.lastOffset / phase.existing.totalChars) * 100)}%。</p>
        </div>
      );
    }
    if (phase.name === 'encoding') {
      return (
        <div className="encoding-choice">
          <p className="muted">{phase.reason}</p>
          <div className="segmented" role="radiogroup" aria-label="编码">
            {ENCODING_OPTIONS.map((option) => (
              <label key={option.id} className={phase.selected === option.id ? 'selected' : ''}>
                <input
                  type="radio"
                  name="encoding"
                  value={option.id}
                  checked={phase.selected === option.id}
                  onChange={() => void changeEncoding(option.id)}
                />
                {option.label}
              </label>
            ))}
          </div>
          <label className="field-label">编码预览</label>
          {previewLoading ? (
            <div className="preview-box preview-loading">正在更新预览…</div>
          ) : (
            <pre className="preview-box" lang="zh-CN">
              {phase.previewText}
            </pre>
          )}
          <p className="muted small">预览只读取文件开头；正文开头若为无关页眉属正常现象。</p>
        </div>
      );
    }
    if (phase.name === 'importing') {
      return (
        <div className="import-progress">
          <div className="progress-track" role="progressbar" aria-valuenow={phase.percent}>
            <div className="progress-fill" style={{ width: `${phase.percent}%` }} />
          </div>
          <p>{phase.message}（{phase.percent}%）</p>
          <p className="muted small">请勿关闭页面；导入完成后书籍与进度都会保存在本机。</p>
        </div>
      );
    }
    if (phase.name === 'done') {
      return (
        <div>
          <p>
            已保存 <strong>{phase.book.title}</strong>
            ，共 {phase.book.totalChars.toLocaleString()} 个字符。现在就可以开始阅读。
          </p>
        </div>
      );
    }
    return <p className="error-text">{phase.message}</p>;
  };

  const renderFooter = () => {
    if (phase.name === 'duplicate') {
      return (
        <>
          <button type="button" className="button ghost" onClick={onDismiss}>
            返回书架
          </button>
          <button
            type="button"
            className="button primary"
            onClick={() => onImported(phase.existing, true)}
          >
            继续阅读
          </button>
        </>
      );
    }
    if (phase.name === 'encoding') {
      return (
        <>
          <button type="button" className="button ghost" onClick={onDismiss}>
            取消
          </button>
          <button
            type="button"
            className="button primary"
            disabled={previewLoading}
            onClick={() => void beginImport(phase.fileName, phase.fingerprint, phase.selected, phase.file)}
          >
            按此编码导入
          </button>
        </>
      );
    }
    if (phase.name === 'done') {
      return (
        <>
          <button type="button" className="button ghost" onClick={onDismiss}>
            返回书架
          </button>
          <button type="button" className="button primary" onClick={() => onImported(phase.book, true)}>
            开始阅读
          </button>
        </>
      );
    }
    if (phase.name === 'error') {
      return (
        <button type="button" className="button primary" onClick={onDismiss}>
          知道了
        </button>
      );
    }
    return null;
  };

  // 没有待导入文件时不渲染任何浮层，书架页才能正常交互。
  if (!file) return null;

  return (
    <Modal
      title={title}
      onClose={busy ? undefined : onDismiss}
      dismissible={!busy}
      footer={renderFooter()}
    >
      {renderBody()}
    </Modal>
  );
}
