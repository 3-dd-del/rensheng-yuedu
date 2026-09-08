export type EncodingId = 'utf-8' | 'utf-16le' | 'utf-16be' | 'gb18030' | 'big5';

export interface BookRecord {
  id: string;
  /** 展示用书名（默认取文件名）。 */
  title: string;
  /** 导入时的原始文件名。 */
  originalFileName: string;
  /** 原始字节的 SHA-256 指纹，用于查重。 */
  fingerprint: string;
  /** 实际采用的解码编码。 */
  encoding: EncodingId;
  /** 解码后文本的字符总数。 */
  totalChars: number;
  /** 分块数量。 */
  chunkCount: number;
  importedAt: number;
  lastReadAt: number | null;
  /** 上次阅读位置（相对文本开头的字符偏移）。 */
  lastOffset: number;
  /** 上次阅读时的布局指纹，用于快速恢复页码。 */
  lastLayoutKey: string | null;
  /** 上次阅读时的页码（与 lastLayoutKey 配套）。 */
  lastPage: number | null;
}

export interface ChunkRecord {
  bookId: string;
  index: number;
  /** 该块文本在全书中的起始字符偏移。 */
  start: number;
  text: string;
}

export interface PageCacheRow {
  bookId: string;
  layoutKey: string;
  /** 从 0 开始的页码（该布局下的全局页边界缓存）。 */
  page: number;
  /** 本页正文的起始字符偏移。 */
  start: number;
}

export interface ReaderSettings {
  /** 字号，单位 px。 */
  fontSize: number;
  /** 行距倍数。 */
  lineHeight: number;
}

export interface EncodingOption {
  id: EncodingId;
  label: string;
}

export interface DetectionResult {
  encoding: EncodingId;
  /** 是否足以自动进入导入。 */
  auto: boolean;
  /** 探测来源/依据，供界面展示。 */
  basis: 'bom' | 'utf8-valid' | 'heuristic' | 'unsupported';
  /** 探测置信度（0–1），无法给出时为 null。 */
  confidence: number | null;
  /** 原文件开头一小段按该编码解码后的文本，供人工预览。 */
  preview: string;
}
