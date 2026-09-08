import type { DetectionResult, EncodingId } from '../../core/types';

export interface DetectPayload {
  fingerprint: string;
  detection: DetectionResult;
}

export interface DecodedChunk {
  index: number;
  start: number;
  text: string;
}

export interface DecodePayload {
  fingerprint: string;
  encoding: EncodingId;
  totalChars: number;
  chunks: DecodedChunk[];
}

type Pending<T> = {
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

/**
 * 浏览器 Web Worker 客户端：解码、编码识别与指纹计算都在 Worker 内完成，
 * 避免导入大文件时阻塞界面。
 */
export class ImportWorkerClient {
  private readonly worker: Worker;
  private nextRequestId = 1;
  private readonly pendingDetect = new Map<number, Pending<DetectPayload>>();
  private readonly pendingDecode = new Map<number, Pending<DecodePayload>>();
  private readonly decodeProgress = new Map<number, (percent: number) => void>();
  private terminated = false;

  constructor() {
    this.worker = new Worker(new URL('../../workers/import.worker.ts', import.meta.url), {
      type: 'module'
    });
    this.worker.onmessage = (event: MessageEvent) => {
      const message = event.data as {
        kind: string;
        requestId: number;
        [key: string]: unknown;
      };
      if (message.kind === 'detect-result') {
        const pending = this.pendingDetect.get(message.requestId);
        if (!pending) return;
        this.pendingDetect.delete(message.requestId);
        pending.resolve({
          fingerprint: message.fingerprint as string,
          detection: message.detection as DetectionResult
        });
      } else if (message.kind === 'import-result') {
        const pending = this.pendingDecode.get(message.requestId);
        if (!pending) return;
        this.pendingDecode.delete(message.requestId);
        this.decodeProgress.delete(message.requestId);
        pending.resolve({
          fingerprint: message.fingerprint as string,
          encoding: message.encoding as EncodingId,
          totalChars: message.totalChars as number,
          chunks: message.chunks as DecodedChunk[]
        });
      } else if (message.kind === 'import-progress') {
        const progress = this.decodeProgress.get(message.requestId);
        progress?.(message.percent as number);
      }
    };
    this.worker.onerror = (event) => {
      const reason = event.message || '导入工作线程出错';
      for (const pending of this.pendingDetect.values()) pending.reject(reason);
      for (const pending of this.pendingDecode.values()) pending.reject(reason);
      this.pendingDetect.clear();
      this.pendingDecode.clear();
      this.decodeProgress.clear();
    };
  }

  async detectFile(buffer: ArrayBuffer): Promise<DetectPayload> {
    const requestId = this.nextRequestId++;
    return new Promise<DetectPayload>((resolve, reject) => {
      this.pendingDetect.set(requestId, { resolve, reject });
      this.worker.postMessage(
        { kind: 'detect', requestId, buffer },
        [buffer]
      );
    });
  }

  async decodeChunks(
    buffer: ArrayBuffer,
    encoding: EncodingId,
    onProgress?: (percent: number) => void
  ): Promise<DecodePayload> {
    const requestId = this.nextRequestId++;
    return new Promise<DecodePayload>((resolve, reject) => {
      this.pendingDecode.set(requestId, { resolve, reject });
      if (onProgress) this.decodeProgress.set(requestId, onProgress);
      this.worker.postMessage(
        { kind: 'import', requestId, buffer, encoding },
        [buffer]
      );
    });
  }

  dispose(): void {
    if (this.terminated) return;
    this.terminated = true;
    this.worker.terminate();
  }
}
