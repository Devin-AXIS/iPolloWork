// The paragraph end, as the browser's text services read the page.
//
// Paragraphs and lines are absolutely positioned, and Chromium's text iterator emits no line
// break around an out-of-flow block. So the text an input method reads around the caret ran
// one paragraph straight into the next ("textВторой"), and a keyboard that keeps its own copy
// of that text composed across paragraphs, aimed Backspace at a paragraph start at the
// previous paragraph's last character, and lost one character of its bookkeeping at every
// join. A `<br>` is a line break to the iterator wherever it is placed, so each paragraph end
// carries one.
//
// It is furniture, and inert to everything else: zero size, no pointer events, hidden from
// assistive technology, outside `contenteditable`, and marked `data-docx-marker`, which the
// composition readback skips and the selection reader resolves to the line's end (see
// `positionFromDomPoint`). It sits where the paragraph mark would, at the line's end, so a
// browser that hit-tests a touch onto it puts the caret where it resolves. It changes no
// measurement: layout never reads the DOM.

import { paragraphIsRtl } from '../layout/rtl-paragraph.ts';
import type { ParagraphFragmentRecord } from '../layout/semantic-records.ts';
import { lineTerminatorEdge } from './semantic-paragraph-marks.ts';

/** The class the selection reader resolves to the end of the line holding it. */
export const PARAGRAPH_BOUNDARY_CLASS = 'docx-paragraph-boundary';

/**
 * Append the paragraph-end line break to the last painted line of `fragment`, when the
 * fragment holds the paragraph end and that line paints text. An empty line paints its own
 * `<br>` composition anchor instead, which the iterator reads the same way.
 */
export function appendParagraphBoundary(
  document: Document,
  fragment: ParagraphFragmentRecord,
  lineElements: readonly HTMLElement[],
  scale: number
): void {
  if (!fragment.paragraphEnd) return;
  const last = fragment.lines[fragment.lines.length - 1];
  const lastElement = lineElements[lineElements.length - 1];
  if (!last || !lastElement || last.spans.length === 0) return;
  const boundary = document.createElement('span');
  boundary.className = PARAGRAPH_BOUNDARY_CLASS;
  boundary.dataset.docxMarker = '';
  boundary.setAttribute('aria-hidden', 'true');
  boundary.setAttribute('contenteditable', 'false');
  const style = boundary.style;
  style.position = 'absolute';
  style.left = `${(lineTerminatorEdge(last, paragraphIsRtl(fragment.props)).x - last.contentX) * scale}px`;
  style.top = '0';
  style.width = '0';
  style.height = '0';
  style.overflow = 'hidden';
  style.fontSize = '0';
  style.lineHeight = '0';
  style.pointerEvents = 'none';
  boundary.append(document.createElement('br'));
  lastElement.append(boundary);
}
