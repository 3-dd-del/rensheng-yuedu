export interface PageBox {
  width: number;
  height: number;
  fontSize: number;
  lineHeight: number;
}

export function computeLayoutKey(box: PageBox): string {
  return [
    Math.round(box.width),
    Math.round(box.height),
    Math.round(box.fontSize * 10),
    Math.round(box.lineHeight * 10)
  ].join('|');
}

export function estimateCharsPerPage(box: PageBox): number {
  const lines = Math.max(1, Math.floor(box.height / (box.fontSize * box.lineHeight)));
  // 0.55 按常见中文与西文混合宽度估计，宁可偏大，避免首块探测不够。
  const perLine = Math.max(16, Math.floor(box.width / (box.fontSize * 0.55)));
  return lines * perLine;
}
