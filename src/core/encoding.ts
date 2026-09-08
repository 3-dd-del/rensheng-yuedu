import jschardet from 'jschardet';

import type { DetectionResult, EncodingId, EncodingOption } from './types';

export const ENCODING_OPTIONS: EncodingOption[] = [
  { id: 'utf-8', label: 'UTF-8' },
  { id: 'gb18030', label: 'GBK / GB18030（简体）' },
  { id: 'big5', label: 'Big5（繁体）' },
  { id: 'utf-16le', label: 'UTF-16 LE' },
  { id: 'utf-16be', label: 'UTF-16 BE' }
];

export const ENCODING_LABEL: Record<EncodingId, string> = {
  'utf-8': 'UTF-8',
  gb18030: 'GBK / GB18030',
  big5: 'Big5',
  'utf-16le': 'UTF-16 LE',
  'utf-16be': 'UTF-16 BE'
};

const DECODER_LABEL: Record<EncodingId, string> = {
  'utf-8': 'utf-8',
  gb18030: 'gb18030',
  big5: 'big5',
  'utf-16le': 'utf-16le',
  'utf-16be': 'utf-16be'
};

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (bytes[i] !== prefix[i]) return false;
  }
  return true;
}

function isStrictUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

function normalizeName(name: string): string {
  return (name ?? '').toLowerCase().replace(/[-_\s]/g, '');
}

function mapHeuristicName(name: string): EncodingId | null {
  const n = normalizeName(name);
  if (n === 'utf8' || n === 'utf8s' || n.startsWith('utf-8') || n === 'unicode') return 'utf-8';
  if (n === 'utf16le' || n === 'utf-16le' || n === 'ucs2le') return 'utf-16le';
  if (n === 'utf16be' || n === 'utf-16be' || n === 'ucs2be') return 'utf-16be';
  if (
    n === 'gb2312' ||
    n === 'gbk' ||
    n === 'gb18030' ||
    n === 'euc-cn' ||
    n === 'euc-cn-2013' ||
    n === 'cp936' ||
    n === 'hz'
  ) {
    return 'gb18030';
  }
  if (n === 'big5' || n === 'big-5' || n === 'cp950') return 'big5';
  return null;
}

function decode(bytes: Uint8Array, encoding: EncodingId): string {
  const label = DECODER_LABEL[encoding];
  // 非致命模式：手动指定编码时仍能给出预览，即使个别字节不合法。
  return new TextDecoder(label).decode(bytes);
}

export function decodeText(bytes: Uint8Array | ArrayBuffer, encoding: EncodingId): string {
  const target = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return decode(target, encoding);
}

export function decodePreview(
  bytes: Uint8Array | ArrayBuffer,
  encoding: EncodingId,
  maxBytes = 12_000,
  maxChars = 600
): string {
  const target = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const sample = target.subarray(0, Math.min(target.byteLength, maxBytes));
  const text = decode(sample, encoding);
  return text.slice(0, maxChars);
}

/**
 * 编码识别顺序：BOM → 严格 UTF-8 全量校验 → jschardet 启发式探测。
 * 大文件放在 Worker 中调用，避免阻塞主线程。
 */
export function detectEncoding(bytes: Uint8Array | ArrayBuffer): DetectionResult {
  const target = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

  if (startsWith(target, [0xef, 0xbb, 0xbf])) {
    return {
      encoding: 'utf-8',
      auto: true,
      basis: 'bom',
      confidence: 1,
      preview: decodePreview(target, 'utf-8')
    };
  }
  if (startsWith(target, [0xff, 0xfe])) {
    return {
      encoding: 'utf-16le',
      auto: true,
      basis: 'bom',
      confidence: 1,
      preview: decodePreview(target, 'utf-16le')
    };
  }
  if (startsWith(target, [0xfe, 0xff])) {
    return {
      encoding: 'utf-16be',
      auto: true,
      basis: 'bom',
      confidence: 1,
      preview: decodePreview(target, 'utf-16be')
    };
  }

  if (isStrictUtf8(target)) {
    return {
      encoding: 'utf-8',
      auto: true,
      basis: 'utf8-valid',
      confidence: 1,
      preview: decodePreview(target, 'utf-8')
    };
  }

  const sample = target.subarray(0, Math.min(target.byteLength, 1_000_000));
  try {
    // jschardet 的浏览器版以二进制字符串为输入。
    const binary = new TextDecoder('latin1').decode(sample);
    const detected = jschardet.detect(binary as never);
    const mapped = mapHeuristicName(detected.encoding ?? '');
    const confidence = typeof detected.confidence === 'number' ? detected.confidence : null;
    if (mapped) {
      // 已排除严格 UTF-8 的情况下，启发式给出明确的简体/繁体编码即可自动导入；
      // 置信度过低或无映射时再让用户手动选择。
      const auto = confidence !== null && confidence >= 0.6;
      return {
        encoding: mapped,
        auto,
        basis: 'heuristic',
        confidence,
        preview: decodePreview(target, mapped)
      };
    }
  } catch {
    // 探测库异常时走手动编码选择。
  }

  return {
    encoding: 'gb18030',
    auto: false,
    basis: 'unsupported',
    confidence: null,
    preview: decodePreview(target, 'gb18030')
  };
}

export function splitText(text: string, chunkSize: number): string[] {
  const chunks: string[] = [];
  for (let start = 0; start < text.length; start += chunkSize) {
    chunks.push(text.slice(start, start + chunkSize));
  }
  return chunks;
}
