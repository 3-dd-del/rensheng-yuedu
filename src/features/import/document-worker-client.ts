import type { ImportDocumentKind } from '../../core/document/kind';

export interface ConvertedDocument {
  totalChars: number;
  chunks: { index: number; start: number; text: string }[];
}

interface Pending {
  resolve: (value: ConvertedDocument) => void;
  reject: (reason: unknown) => void;
}

/** 把 PDF / Word / EPUB 转成纯文本的 Worker 客户端。 */
export class DocumentWorkerClient {
  private readonly worker: Worker;
  private nextRequestId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly progress = new Map<number, (percent: number) => void>();

  constructor() {
    this.worker = new Worker(new URL('../../workers/document.worker.ts', import.meta.url), {
      type: 'module'
    });
    this.worker.onmessage = (event: MessageEvent) => {
      const message = event.data as {
        kind: string;
        requestId: number;
        [key: string]: unknown;
      };
      if (message.kind === 'document-result') {
        const pending = this.pending.get(message.requestId);
        if (!pending) return;
        this.pending.delete(message.requestId);
        this.progress.delete(message.requestId);
        pending.resolve({
          totalChars: message.totalChars as number,
          chunks: message.chunks as ConvertedDocument['chunks']
        });
      } else if (message.kind === 'document-error') {
        const pending = this.pending.get(message.requestId);
        if (!pending) return;
        this.pending.delete(message.requestId);
        this.progress.delete(message.requestId);
        pending.reject(new Error(String(message.message ?? '文档转换失败')));
      } else if (message.kind === 'document-progress') {
        this.progress.get(message.requestId)?.(message.percent as number);
      }
    };
    this.worker.onerror = (event) => {
      const reason = event.message || '文档转换线程出错';
      for (const pending of this.pending.values()) pending.reject(reason);
      this.pending.clear();
      this.progress.clear();
    };
  }

  convert(
    buffer: ArrayBuffer,
    documentType: Extract<ImportDocumentKind, 'pdf' | 'docx' | 'epub'>,
    onProgress?: (percent: number) => void
  ): Promise<ConvertedDocument> {
    const requestId = this.nextRequestId++;
    return new Promise<ConvertedDocument>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      if (onProgress) this.progress.set(requestId, onProgress);
      this.worker.postMessage(
        { kind: 'convert', requestId, buffer, documentType },
        [buffer]
      );
    });
  }

  dispose(): void {
    this.worker.terminate();
  }
}
