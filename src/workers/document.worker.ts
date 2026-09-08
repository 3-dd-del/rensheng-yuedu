/// <reference lib="webworker" />

import { CHUNK_SIZE } from '../core/constants';
import { docxToText } from '../core/document/docx';
import { epubToText } from '../core/document/epub';
import type { ImportDocumentKind } from '../core/document/kind';
import { pdfToText } from '../core/document/pdf';
import { splitText } from '../core/encoding';

interface DocumentConvertRequest {
  kind: 'convert';
  requestId: number;
  buffer: ArrayBuffer;
  documentType: Extract<ImportDocumentKind, 'pdf' | 'docx' | 'epub'>;
}

interface DocumentProgressMessage {
  kind: 'document-progress';
  requestId: number;
  /** 0–100 */
  percent: number;
}

interface DocumentResultMessage {
  kind: 'document-result';
  requestId: number;
  totalChars: number;
  chunks: { index: number; start: number; text: string }[];
}

type WorkerResponse = DocumentProgressMessage | DocumentResultMessage;

const ctx = self as DedicatedWorkerGlobalScope;

ctx.onmessage = async (event: MessageEvent<DocumentConvertRequest>) => {
  const request = event.data;
  if (request.kind !== 'convert') return;
  const bytes = new Uint8Array(request.buffer);
  const post = (percent: number) => {
    ctx.postMessage({
      kind: 'document-progress',
      requestId: request.requestId,
      percent: Math.max(0, Math.min(100, percent))
    } satisfies WorkerResponse);
  };

  try {
    let text = '';
    if (request.documentType === 'pdf') {
      post(2);
      text = await pdfToText(bytes, (done, total) => {
        post(4 + (done / total) * 86);
      });
    } else if (request.documentType === 'docx') {
      post(5);
      text = await docxToText(bytes);
      post(90);
    } else if (request.documentType === 'epub') {
      post(5);
      text = await epubToText(bytes);
      post(90);
    }
    post(95);
    const totalChars = text.length;
    const parts = splitText(text, CHUNK_SIZE);
    const chunks = parts.map((part, index) => ({
      index,
      start: index * CHUNK_SIZE,
      text: part
    }));
    ctx.postMessage({
      kind: 'document-result',
      requestId: request.requestId,
      totalChars,
      chunks
    } satisfies WorkerResponse);
  } catch (error) {
    ctx.postMessage({
      kind: 'document-error',
      requestId: request.requestId,
      message: error instanceof Error ? error.message : '文档转换失败'
    } satisfies DocumentErrorMessage);
  }
};

interface DocumentErrorMessage {
  kind: 'document-error';
  requestId: number;
  message: string;
}

export {};
