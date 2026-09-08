import JSZip from 'jszip';

import { docxXmlToText } from './html';

/** 解析 .docx：解包后读取 word/document.xml 中的正文段落。 */
export async function docxToText(bytes: Uint8Array): Promise<string> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new Error('无法打开 Word 文档（文件可能已损坏）');
  }
  const entry = zip.file('word/document.xml');
  if (!entry) {
    throw new Error('该 Word 文档缺少正文内容，或不是 .docx 格式');
  }
  const xml = await entry.async('string');
  const text = docxXmlToText(xml);
  if (!text.trim()) {
    throw new Error('这个 Word 文档里没有可提取的文字');
  }
  return text;
}
