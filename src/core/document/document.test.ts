import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { detectDocumentKind } from './kind';
import { docxXmlToText, htmlToPlainText } from './html';
import { docxToText } from './docx';
import { epubToText } from './epub';

describe('文档格式识别', () => {
  it('识别常见文档扩展名', () => {
    expect(detectDocumentKind({ name: '小说.txt' })).toBe('text');
    expect(detectDocumentKind({ name: 'README.md' })).toBe('text');
    expect(detectDocumentKind({ name: '笔记.html' })).toBe('html');
    expect(detectDocumentKind({ name: '书.pdf' })).toBe('pdf');
    expect(detectDocumentKind({ name: '报告.docx' })).toBe('docx');
    expect(detectDocumentKind({ name: 'book.epub' })).toBe('epub');
    expect(detectDocumentKind({ name: '旧版.doc' })).toBe('unsupported');
  });

  it('也能按 MIME 类型兜底识别', () => {
    expect(detectDocumentKind({ name: '无扩展名', type: 'application/pdf' })).toBe('pdf');
    expect(detectDocumentKind({ name: 'notes', type: 'text/plain' })).toBe('text');
  });
});

describe('网页与 Word 文本提取', () => {
  it('HTML 转纯文本会去掉标签', () => {
    const html =
      '<html><head><title>隐藏</title></head><body><h1>第一章</h1><p>你好，<b>人生阅读</b>。</p><script>alert(1)</script></body></html>';
    const text = htmlToPlainText(html);
    expect(text).toContain('第一章');
    expect(text).toContain('你好，人生阅读。');
    expect(text).not.toContain('<');
    expect(text).not.toContain('alert');
  });

  it('DOCX XML 正文按段落提取', () => {
    const xml = `<w:document xmlns:w="urn"><w:body>
      <w:p><w:r><w:t>第一段：人生阅读</w:t></w:r></w:p>
      <w:p><w:r><w:t>第二段：中文 &amp; 阅读。</w:t></w:r></w:p>
    </w:body></w:document>`;
    const text = docxXmlToText(xml);
    expect(text.split('\n')).toContain('第一段：人生阅读');
    expect(text).toContain('中文 & 阅读。');
  });

  it('完整 DOCX 可解包并读出正文', async () => {
    const zip = new JSZip();
    zip.file(
      'word/document.xml',
      '<w:document xmlns:w="urn"><w:body><w:p><w:r><w:t>Word 文档测试内容</w:t></w:r></w:p></w:body></w:document>'
    );
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    expect(await docxToText(bytes)).toContain('Word 文档测试内容');
  });
});

describe('EPUB 文本提取', () => {
  it('按 spine 顺序读取各章正文', async () => {
    const zip = new JSZip();
    zip.file(
      'META-INF/container.xml',
      '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'
    );
    zip.file(
      'OEBPS/content.opf',
      `<?xml version="1.0"?>
      <package><manifest>
        <item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
        <item id="c2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
      </manifest><spine>
        <itemref idref="c1"/><itemref idref="c2"/>
      </spine></package>`
    );
    zip.file(
      'OEBPS/chapter1.xhtml',
      '<html><body><p>第一章：开始。</p><p>继续阅读。</p></body></html>'
    );
    zip.file(
      'OEBPS/chapter2.xhtml',
      '<html><body><p>第二章：结束。</p></body></html>'
    );
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const text = await epubToText(bytes);
    expect(text).toContain('第一章：开始。');
    expect(text).toContain('第二章：结束。');
    expect(text.indexOf('第一章')).toBeLessThan(text.indexOf('第二章'));
  });
});
