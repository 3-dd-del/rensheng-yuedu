/// <reference lib="webworker" />

import { CHUNK_SIZE } from '../core/constants';
import { decodeText, detectEncoding, splitText } from '../core/encoding';
import { sha256Hex } from '../core/fingerprint';
import type { EncodingId } from '../core/types';

type WorkerRequest =
  | {
      kind: 'detect';
      requestId: number;
      buffer: ArrayBuffer;
    }
  | {
      kind: 'import';
      requestId: number;
      buffer: ArrayBuffer;
      encoding: EncodingId;
    };

interface ImportChunkPayload {
  index: number;
  start: number;
  text: string;
}

type WorkerResponse =
  | {
      kind: 'detect-result';
      requestId: number;
      fingerprint: string;
      detection: ReturnType<typeof detectEncoding>;
    }
  | {
      kind: 'import-progress';
      requestId: number;
      /** 0–100 */
      percent: number;
    }
  | {
      kind: 'import-result';
      requestId: number;
      fingerprint: string;
      encoding: EncodingId;
      totalChars: number;
      chunks: ImportChunkPayload[];
    };

const ctx = self as DedicatedWorkerGlobalScope;

ctx.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.kind === 'detect') {
    const bytes = new Uint8Array(request.buffer);
    const fingerprint = await sha256Hex(bytes);
    const detection = detectEncoding(bytes);
    const response: WorkerResponse = {
      kind: 'detect-result',
      requestId: request.requestId,
      fingerprint,
      detection
    };
    ctx.postMessage(response);
    return;
  }

  if (request.kind === 'import') {
    const bytes = new Uint8Array(request.buffer);
    const fingerprint = await sha256Hex(bytes);
    ctx.postMessage({
      kind: 'import-progress',
      requestId: request.requestId,
      percent: 5
    } satisfies WorkerResponse);

    const text = decodeText(bytes, request.encoding);
    const totalChars = text.length;
    const parts = splitText(text, CHUNK_SIZE);
    ctx.postMessage({
      kind: 'import-progress',
      requestId: request.requestId,
      percent: 35
    } satisfies WorkerResponse);

    const chunks: ImportChunkPayload[] = parts.map((part, index) => ({
      index,
      start: index * CHUNK_SIZE,
      text: part
    }));
    ctx.postMessage({
      kind: 'import-progress',
      requestId: request.requestId,
      percent: 70
    } satisfies WorkerResponse);

    const response: WorkerResponse = {
      kind: 'import-result',
      requestId: request.requestId,
      fingerprint,
      encoding: request.encoding,
      totalChars,
      chunks
    };
    ctx.postMessage(response);
    return;
  }
};

export {};
