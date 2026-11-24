// Draw the `w:pgBorders` frame layout published for one sheet.
//
// Position and thickness come from the record and nothing else — no margins, no `w:offsetFrom`,
// no remeasuring. `page-border-frame.ts` already resolved where the rule sits, which is the
// only place that can: the offset mode is a question about the section's margins.
//
// One layer element per sheet, so the frame can be inserted at one point in the page's child
// order and `w:zOrder` becomes a choice of WHERE, not a z-index fight with painted content.

import type { PageBorderFrameRecord, PageBorderStrokeRecord } from '../layout/semantic-records.ts';
import { applyParagraphBorderStyle, isCompoundParagraphBorder } from './border-stroke-paint.ts';

/** Six hex digits, either case; anything else is not a colour this paints. */
const HEX = /^[0-9A-Fa-f]{6}$/;

function paintPageBorderStroke(
  document: Document,
  stroke: PageBorderStrokeRecord,
  scale: number
): HTMLElement {
  const rule = document.createElement('div');
  rule.className = `docx-page-border docx-page-border-${stroke.side}`;
  rule.setAttribute('aria-hidden', 'true');
  rule.style.position = 'absolute';
  const vertical = stroke.side === 'left' || stroke.side === 'right';
  const published = (vertical ? stroke.box.width : stroke.box.height) * scale;
  // Word's ¼pt frames are 0.33 CSS px at 96dpi and vanish. Snap a single rule to a screen
  // hairline; compound styles were already inflated in layout and keep what they were given.
  // The rule grows INWARD from its published outer face, so the snap never crosses the paper's
  // edge: a bottom or right rule is pinned by its far side, exactly as `w:pBdr` does it.
  const thickness = isCompoundParagraphBorder(stroke.edge.val) ? published : Math.max(1, published);
  const grew = thickness - published;
  rule.style.left = `${stroke.box.x * scale - (stroke.side === 'right' ? grew : 0)}px`;
  rule.style.top = `${stroke.box.y * scale - (stroke.side === 'bottom' ? grew : 0)}px`;
  rule.style.width = vertical ? `${thickness}px` : `${stroke.box.width * scale}px`;
  rule.style.height = vertical ? `${stroke.box.height * scale}px` : `${thickness}px`;
  const color = stroke.edge.color && HEX.test(stroke.edge.color) ? stroke.edge.color : '000000';
  rule.style.backgroundColor = `#${color}`;
  applyParagraphBorderStyle(rule, stroke.edge.val, color, vertical, thickness, scale);
  return rule;
}

/**
 * The frame layer for one sheet, positioned in PAGE-BOX coordinates.
 *
 * Returned rather than appended so the caller decides the child order: `w:zOrder="back"` puts
 * this before `.docx-page-content` and `"front"` after it, which is the whole of the z-order
 * rule and needs no stacking context of its own.
 *
 * `pointer-events: none` throughout — the frame is a picture of the document's chrome, and a
 * click that landed on it instead of the text under it would break caret placement in the
 * margins. It is `aria-hidden` for the same reason the painted page is.
 */
export function paintPageBorderFrame(
  document: Document,
  frame: PageBorderFrameRecord,
  scale: number
): HTMLElement {
  const layer = document.createElement('div');
  layer.className = 'docx-page-borders';
  layer.setAttribute('aria-hidden', 'true');
  layer.setAttribute('contenteditable', 'false');
  layer.style.position = 'absolute';
  layer.style.inset = '0';
  layer.style.pointerEvents = 'none';
  for (const stroke of frame.strokes) {
    layer.append(paintPageBorderStroke(document, stroke, scale));
  }
  return layer;
}
