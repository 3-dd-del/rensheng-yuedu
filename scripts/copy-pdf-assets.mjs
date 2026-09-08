/**
 * 构建后把 PDF.js 需要的 CMap / 标准字体数据复制到 dist。
 * 中文 PDF 缺少 CMap 时，文字会被读成“显示符号”而不是真正的中文。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.dirname(scriptDir);
const distDir = path.join(projectDir, 'dist');

function copyDirectory(from, to) {
  if (!fs.existsSync(from)) {
    throw new Error(`找不到 PDF.js 资源目录：${from}`);
  }
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(source, target);
    } else {
      fs.copyFileSync(source, target);
    }
  }
}

const pdfjsRoot = path.join(
  projectDir,
  'node_modules',
  '.pnpm',
  'pdfjs-dist@4.10.38',
  'node_modules',
  'pdfjs-dist'
);
copyDirectory(path.join(pdfjsRoot, 'cmaps'), path.join(distDir, 'pdfjs-cmaps'));
copyDirectory(
  path.join(pdfjsRoot, 'standard_fonts'),
  path.join(distDir, 'pdfjs-standard-fonts')
);

console.log('PDF.js cmaps 与标准字体已复制到 dist');
