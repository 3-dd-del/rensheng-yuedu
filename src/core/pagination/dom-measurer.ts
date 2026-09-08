import type { BookTextSource } from '../text-source';
import { estimateCharsPerPage, type PageBox } from './layout-key';

/**
 * 隐藏测量容器 + Range 二分逼近：
 * 把从某字符偏移开始的一段文本放进与正文同宽同字号的隐藏容器，
 * 找到“恰好装满一页、再多一个字符就会溢出”的字符终点。
 */
export class DomPageMeasurer {
  private readonly box: HTMLDivElement;
  private readonly range: Range;
  private readonly pageBox: PageBox;
  private readonly fontFamily: string;
  private loadedStart = -1;
  private loadedText = '';

  constructor(pageBox: PageBox) {
    this.pageBox = pageBox;
    this.fontFamily = getComputedStyle(document.body).fontFamily;
    this.box = document.createElement('div');
    this.box.setAttribute('aria-hidden', 'true');
    this.box.style.position = 'fixed';
    this.box.style.left = '0';
    this.box.style.top = '0';
    this.box.style.width = `${pageBox.width}px`;
    this.box.style.height = `${pageBox.height}px`;
    this.box.style.visibility = 'hidden';
    this.box.style.pointerEvents = 'none';
    this.box.style.whiteSpace = 'pre-wrap';
    this.box.style.overflowWrap = 'anywhere';
    this.box.style.boxSizing = 'border-box';
    this.box.style.margin = '0';
    this.box.style.padding = '0';
    this.box.style.fontSize = `${pageBox.fontSize}px`;
    this.box.style.lineHeight = String(pageBox.lineHeight);
    this.box.style.fontFamily = this.fontFamily;
    document.body.appendChild(this.box);
    this.range = document.createRange();
  }

  dispose(): void {
    this.box.remove();
  }

  private setContent(text: string): void {
    if (this.loadedStart >= 0 && this.loadedText === text && this.box.firstChild) {
      return;
    }
    this.box.textContent = '';
    this.box.appendChild(document.createTextNode(text));
    this.loadedText = text;
  }

  private async load(startOffset: number, length: number, source: BookTextSource): Promise<number> {
    if (this.loadedStart !== startOffset || this.loadedText.length < length) {
      const text = await source.getText(startOffset, startOffset + length);
      this.loadedStart = startOffset;
      this.setContent(text);
    }
    return Math.min(this.loadedText.length, length);
  }

  private heightFor(characterCount: number): number {
    const textNode = this.box.firstChild;
    if (!textNode || characterCount <= 0) return 0;
    this.range.setStart(textNode, 0);
    this.range.setEnd(textNode, Math.min(characterCount, this.loadedText.length));
    const rect = this.range.getBoundingClientRect();
    return rect.height;
  }

  /** 从 startOffset 开始排一页，返回本页终点（下一页的起始字符偏移）。 */
  async pageEnd(startOffset: number, source: BookTextSource): Promise<number> {
    const remaining = source.totalChars - startOffset;
    if (remaining <= 0) return startOffset;

    const { height } = this.pageBox;
    const initialProbe = Math.min(
      remaining,
      Math.max(120, estimateCharsPerPage(this.pageBox) * 2)
    );
    const targetHeight = height;

    let upper = initialProbe;
    let loaded = await this.load(startOffset, upper, source);
    upper = Math.min(upper, loaded);
    let measured = this.heightFor(upper);

    while (measured <= targetHeight && startOffset + upper < source.totalChars) {
      const next = Math.min(remaining, Math.max(upper + 1, Math.floor(upper * 1.8)));
      if (next === upper) break;
      upper = next;
      loaded = await this.load(startOffset, upper, source);
      upper = Math.min(upper, loaded);
      measured = this.heightFor(upper);
    }

    if (measured <= targetHeight) {
      // 剩余文本不足一页。
      return startOffset + upper;
    }

    let low = 0;
    let high = upper;
    while (low + 1 < high) {
      const mid = Math.floor((low + high) / 2);
      if (this.heightFor(mid) <= targetHeight) {
        low = mid;
      } else {
        high = mid;
      }
    }
    return startOffset + Math.max(1, low);
  }

  /** 估算一屏字符数，供 UI 显示“正在定位”进度使用。 */
  get estimatedPageChars(): number {
    return estimateCharsPerPage(this.pageBox);
  }

  get lineHeightPx(): number {
    return this.pageBox.fontSize * this.pageBox.lineHeight;
  }

  get boxHeight(): number {
    return this.pageBox.height;
  }

  get fontSize(): number {
    return this.pageBox.fontSize;
  }
}
