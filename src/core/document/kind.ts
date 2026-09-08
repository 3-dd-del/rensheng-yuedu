export type ImportDocumentKind = 'text' | 'html' | 'pdf' | 'docx' | 'epub';

export interface FileLike {
  name: string;
  type?: string;
}

const TEXT_EXTENSIONS = new Set([
  'txt',
  'text',
  'md',
  'markdown',
  'log',
  'srt',
  'csv',
  'json',
  'xml',
  'yaml',
  'yml',
  'ini',
  'conf',
  'nfo'
]);

export const DOCUMENT_KIND_LABEL: Record<ImportDocumentKind, string> = {
  text: '文本',
  html: '网页',
  pdf: 'PDF',
  docx: 'Word 文档',
  epub: 'EPUB 电子书'
};

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

export function detectDocumentKind(file: FileLike): ImportDocumentKind | 'unsupported' {
  const extension = extensionOf(file.name);
  const mime = (file.type ?? '').toLowerCase();

  if (extension === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (
    extension === 'docx' ||
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return 'docx';
  }
  if (extension === 'epub' || mime === 'application/epub+zip') return 'epub';
  if (extension === 'html' || extension === 'htm' || extension === 'xhtml') return 'html';
  if (TEXT_EXTENSIONS.has(extension)) return 'text';
  if (mime.startsWith('text/')) return 'text';
  return 'unsupported';
}

export function isSupportedDocument(file: FileLike): file is FileLike & { name: string } {
  return detectDocumentKind(file) !== 'unsupported';
}

export const DOCUMENT_ACCEPT =
  '.txt,.text,.md,.markdown,.log,.srt,.csv,.json,.xml,.html,.htm,.pdf,.docx,.epub,text/plain';
