import { runBorderStrokesForLine } from '../layout/run-border-strokes.ts';
import type { LineRecord } from '../layout/semantic-records.ts';
import { applyParagraphBorderStyle } from './border-stroke-paint.ts';

/** Six hex digits, either case; anything else is not a colour this paints. */
const HEX = /^[0-9A-Fa-f]{6}$/;

/** Paint the engine's character-border bands without changing text advances. */
export function paintRunBorders(
  document: Document,
  host: HTMLElement,
  line: LineRecord,
  scale: number
): void {
  for (const { box, edge, side } of runBorderStrokesForLine(line)) {
    // Six hex digits or black, as the paragraph and page border painters do. The colour is
    // file-supplied and lands in inline CSS, so anything else must not reach the sink.
    const color = edge.color && HEX.test(edge.color) ? edge.color : '000000';
    const rule = document.createElement('span');
    rule.className = `docx-run-border docx-run-border-${side}`;
    rule.dataset.docxMarker = '';
    rule.setAttribute('aria-hidden', 'true');
    rule.setAttribute('contenteditable', 'false');
    Object.assign(rule.style, {
      position: 'absolute',
      pointerEvents: 'none',
      left: `${(box.x - line.contentX) * scale}px`,
      top: `${(box.y - line.box.y) * scale}px`,
      width: `${box.width * scale}px`,
      height: `${box.height * scale}px`,
      backgroundColor: `#${color}`,
    });
    const vertical = side === 'left' || side === 'right';
    applyParagraphBorderStyle(
      rule,
      edge.val,
      color,
      vertical,
      (vertical ? box.width : box.height) * scale,
      scale
    );
    host.append(rule);
  }
}
