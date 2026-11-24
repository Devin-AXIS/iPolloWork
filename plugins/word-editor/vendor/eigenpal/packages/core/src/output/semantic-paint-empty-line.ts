import type { LineRecord, ResolvedRunStyle } from '../layout/index.ts';
import { DEFAULT_RUN_STYLE } from '../layout/run-style.ts';

/** Give lines without text a native composition anchor. */
export function appendEmptyLineAnchor(
  element: HTMLElement,
  line: LineRecord,
  scale: number,
  style: ResolvedRunStyle,
  applyFont: (style: ResolvedRunStyle) => void
): void {
  if (line.spans.length !== 0) return;
  // An IME inserts bare text into an empty line. A zero font size hides both
  // the preedit text and the native caret. Populated lines retain their zero strut.
  applyFont({
    ...DEFAULT_RUN_STYLE,
    fontFamily: style.fontFamily,
    fontSizePt: style.fontSizePt,
    bold: style.bold,
    italic: style.italic,
  });
  const anchor = element.ownerDocument.createElement('br');
  anchor.style.lineHeight = `${line.box.height * scale}px`;
  element.append(anchor);
}
