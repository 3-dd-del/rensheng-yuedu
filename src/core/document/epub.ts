import JSZip from 'jszip';

import { htmlToPlainText } from './html';

interface OpfData {
  manifest: Map<string, { href: string; mediaType: string }>;
  spine: string[];
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

async function readZipText(zip: JSZip, name: string): Promise<string | null> {
  const entry = zip.file(name);
  if (!entry) return null;
  return decodeUtf8(await entry.async('uint8array'));
}

function tagAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of tag.matchAll(/([:\w-]+)\s*=\s*"([^"]*)"/g)) {
    attributes[match[1]] = match[2];
  }
  return attributes;
}

function parseOpf(opfXml: string): OpfData {
  const manifest = new Map<string, { href: string; mediaType: string }>();
  for (const match of opfXml.matchAll(/<item\b[^>]*>/gi)) {
    const tag = match[0];
    const attrs = tagAttributes(tag);
    if (attrs.id && attrs.href) {
      manifest.set(attrs.id, {
        href: attrs.href,
        mediaType: attrs['media-type'] ?? ''
      });
    }
  }
  const spine: string[] = [];
  for (const match of opfXml.matchAll(/<itemref\b[^>]*\/?>/gi)) {
    const idref = tagAttributes(match[0]).idref;
    if (idref) spine.push(idref);
  }
  return { manifest, spine };
}

function isHtmlName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.xhtml') || lower.endsWith('.html') || lower.endsWith('.htm');
}

function resolvePath(basePath: string, href: string): string {
  if (href.startsWith('/')) return href.slice(1).replace(/^\/+/, '');
  const segments = basePath ? basePath.split('/').filter(Boolean) : [];
  for (const part of href.split('/')) {
    if (part === '..') segments.pop();
    else if (part !== '.' && part !== '') segments.push(part);
  }
  return segments.join('/');
}

async function fallbackRead(zip: JSZip): Promise<string> {
  const names = Object.keys(zip.files)
    .filter((name) => !zip.files[name].dir && isHtmlName(name))
    .sort();
  const parts: string[] = [];
  for (const name of names) {
    const lower = name.toLowerCase();
    if (lower.includes('nav') || lower.includes('toc') || lower.includes('cover')) continue;
    const text = await readZipText(zip, name);
    if (text) parts.push(htmlToPlainText(text));
  }
  return parts.join('\n\n');
}

/** 解析 .epub：按目录(spine)顺序读取各章节，并转成纯文本。 */
export async function epubToText(bytes: Uint8Array): Promise<string> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new Error('无法打开 EPUB（文件可能已损坏）');
  }

  const container = await readZipText(zip, 'META-INF/container.xml');
  const rootMatch = container ? /full-path\s*=\s*"([^"]+)"/i.exec(container) : null;
  const opfPath = rootMatch?.[1];
  if (!opfPath) {
    const fallback = await fallbackRead(zip);
    if (fallback.trim()) return fallback;
    throw new Error('这个 EPUB 缺少目录信息');
  }

  const opfXml = await readZipText(zip, opfPath);
  if (!opfXml) throw new Error('EPUB 目录文件无法读取');
  const basePath = opfPath.split('/').slice(0, -1).join('/');
  const { manifest, spine } = parseOpf(opfXml);
  if (spine.length === 0) {
    const fallback = await fallbackRead(zip);
    if (fallback.trim()) return fallback;
  }

  const parts: string[] = [];
  for (const idref of spine) {
    const item = manifest.get(idref);
    if (!item) continue;
    const href = item.mediaType.includes('html') || isHtmlName(item.href) ? item.href : null;
    if (!href) continue;
    const name = resolvePath(basePath, href);
    const text = await readZipText(zip, name);
    if (text) parts.push(htmlToPlainText(text));
  }
  const result = parts.join('\n\n');
  if (!result.trim()) {
    throw new Error('这个 EPUB 里没有可提取的文字');
  }
  return result;
}
