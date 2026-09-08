function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&nbsp;/g, '\u00a0')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** 把常见 XHTML/HTML 片段提取成适合连续阅读的纯文本。 */
export function htmlToPlainText(html: string): string {
  let text = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|head|title|nav|header|footer)[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(
      /<(br|\/p|\/div|\/h[1-6]|\/li|\/tr|\/section|\/article|\/blockquote|\/pre)[^>]*>/gi,
      '\n'
    )
    .replace(/<[^>]+>/g, '');
  text = decodeEntities(text)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text;
}

/** 把 DOCX 的 word/document.xml 正文转成纯文本。 */
export function docxXmlToText(xml: string): string {
  const lines: string[] = [];
  const paragraphs = xml.split(/<\/w:p>/gi);
  for (const paragraph of paragraphs) {
    const clean = paragraph.replace(/<w:p\b[^>]*>/gi, '');
    let line = '';
    const tokenPattern =
      /<w:tab\s*\/>|<w:br\s*\/>|<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gi;
    for (const match of clean.matchAll(tokenPattern)) {
      if (match[0].startsWith('<w:tab')) line += '\t';
      else if (match[0].startsWith('<w:br')) line += '\n';
      else line += decodeXmlEntities(match[1] ?? '');
    }
    if (line.trim()) lines.push(line.trimEnd());
  }
  return lines.join('\n');
}

export function decodeXml(value: string): string {
  return decodeXmlEntities(value);
}
