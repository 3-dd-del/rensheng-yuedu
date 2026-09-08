import { describe, expect, it } from 'vitest';

import {
  decodeText,
  detectEncoding,
  decodePreview,
  splitText
} from './encoding';

const utf8 = (text: string) => new TextEncoder().encode(text);

function gb18030(text: string): Uint8Array {
  const table: Record<string, [number, number]> = {
    你: [0xc4, 0xe3],
    好: [0xba, 0xc3],
    中: [0xd6, 0xd0],
    文: [0xce, 0xc4],
    阅: [0xd4, 0xc4],
    读: [0xb6, 0xc1],
    测: [0xb2, 0xe2],
    试: [0xca, 0xd4]
  };
  const bytes: number[] = [];
  for (const char of text) {
    if (char === ' ') {
      bytes.push(0x20);
    } else if (char.charCodeAt(0) < 128) {
      bytes.push(char.charCodeAt(0));
    } else {
      const pair = table[char];
      if (!pair) throw new Error(`测试样本缺少 ${char} 的 GB18030 编码`);
      bytes.push(pair[0], pair[1]);
    }
  }
  return new Uint8Array(bytes);
}

function utf16le(text: string, withBom: boolean): Uint8Array {
  const bytes: number[] = [];
  if (withBom) bytes.push(0xff, 0xfe);
  for (const char of text) {
    const code = char.charCodeAt(0);
    bytes.push(code & 0xff, (code >> 8) & 0xff);
  }
  return new Uint8Array(bytes);
}

describe('编码识别与解码', () => {
  it('识别 UTF-8 BOM', () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('人生阅读')]);
    const result = detectEncoding(bom);
    expect(result.encoding).toBe('utf-8');
    expect(result.auto).toBe(true);
    expect(result.basis).toBe('bom');
    expect(result.preview).toBe('人生阅读');
  });

  it('识别无 BOM 的严格 UTF-8', () => {
    const result = detectEncoding(utf8('你好，中文阅读测试。'));
    expect(result.encoding).toBe('utf-8');
    expect(result.auto).toBe(true);
    expect(result.basis).toBe('utf8-valid');
  });

  it('识别带 BOM 的 UTF-16LE', () => {
    const bytes = utf16le('这是一段中文。', true);
    const result = detectEncoding(bytes);
    expect(result.encoding).toBe('utf-16le');
    expect(result.auto).toBe(true);
    expect(decodeText(bytes, 'utf-16le')).toBe('这是一段中文。');
  });

  it('启发式识别 GB18030 内容并正确解码', () => {
    const bytes = gb18030('你好阅读测试中文'.repeat(120));
    const result = detectEncoding(bytes);
    expect(result.encoding).toBe('gb18030');
    expect(result.auto).toBe(true);
    expect(result.basis).toBe('heuristic');
    expect(decodeText(bytes, 'gb18030')).toContain('你好阅读测试中文');
    expect(decodePreview(bytes, 'gb18030')).toContain('你好');
  });

  it('启发式无法确认时自动进入手动选择', () => {
    const bytes = new Uint8Array(Array.from({ length: 120 }, (_, index) => (index % 2 === 0 ? 0x80 : 0x40)));
    const result = detectEncoding(bytes);
    expect(result.auto).toBe(false);
    expect(result.basis).toBe('unsupported');
  });

  it('按固定块大小切分不丢字、不重字', () => {
    const text = '人生阅读是一款本地优先的个人电子阅读器。'.repeat(30);
    const chunks = splitText(text, 40);
    expect(chunks.join('')).toBe(text);
    expect(chunks.length).toBe(Math.ceil(text.length / 40));
  });
});
