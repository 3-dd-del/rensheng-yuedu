import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

let workerConfigured = false;

function configurePdfWorker(): void {
  if (workerConfigured) return;
  GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  workerConfigured = true;
}

/**
 * 提取 PDF 中的文字层。扫描件/纯图片 PDF 不含文字层，会返回空文本。
 */
export async function pdfToText(
  bytes: Uint8Array,
  onProgress?: (donePages: number, totalPages: number) => void
): Promise<string> {
  configurePdfWorker();
  let document: Awaited<ReturnType<typeof getDocument>['promise']>;
  try {
    const task = getDocument({
      data: bytes,
      disableFontFace: true,
      useSystemFonts: true,
      isEvalSupported: false,
      verbosity: 0
    });
    document = await task.promise;
  } catch (error) {
    throw new Error(`无法读取 PDF：${error instanceof Error ? error.message : '文件可能已损坏'}`);
  }

  const pages: string[] = [];
  const total = document.numPages;
  try {
    for (let pageNumber = 1; pageNumber <= total; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      let pageText = '';
      for (const item of content.items) {
        if ('str' in item) {
          pageText += item.str;
          if (item.hasEOL) pageText += '\n';
        }
      }
      pages.push(pageText);
      onProgress?.(pageNumber, total);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    await document.destroy();
  }

  const text = pages
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) {
    throw new Error('这个 PDF 没有文字层（可能是扫描图片），暂不能直接导入');
  }
  return text;
}
