// Move a painted table-cell paragraph to new horizontal geometry without rebuilding it.
//
// When a table's columns change width, every paragraph in the affected cells gets a new box
// and new line origins, but usually the same lines, the same runs and the same vertical
// geometry. Inside a line, runs are placed by inline flow from the line's left edge, so the
// painted run elements depend only on run data and the gaps BETWEEN runs. When those are
// unchanged, moving the paragraph is a few style writes on the paragraph and line elements.
//
// Everything else fails closed: a feature whose painted geometry reads absolute or
// container-width positions (borders, tab leaders, inline drawings, bidi placement, character
// borders, picture bullets) repaints the paragraph, as does any difference in run data,
// line height, line count or the painted structure.

import type { LayoutBox, LineRecord, ParagraphFragmentRecord } from '../layout/semantic-records.ts';
import { paragraphIsRtl } from '../layout/rtl-paragraph.ts';
import { lineTerminatorEdge } from './semantic-paragraph-marks.ts';
import { sameRecordExcept } from './semantic-paint-record-equality.ts';

/** The same fill validation paint applies before it draws a shading band. */
const HEX = /^[0-9A-Fa-f]{6}$/;

const FRAGMENT_GEOMETRY: ReadonlySet<string> = new Set(['box', 'lines', 'shadingBox', 'marker']);
const LINE_GEOMETRY: ReadonlySet<string> = new Set(['box', 'contentX', 'spans']);
const BOX_ONLY: ReadonlySet<string> = new Set(['box']);

/** What the paragraph painter derives beyond the records themselves. */
export interface ParagraphReflowPaint {
  readonly scale: number;
  readonly showParagraphMarks: boolean;
  /** The painted gap before span `index`, exactly as the line painter derives it. */
  readonly gapOf: (line: LineRecord, index: number) => number;
}

/**
 * Write the four positioned-box properties that changed, relative to an origin.
 *
 * The expressions match the cold painters, so a written value is the string a fresh paint
 * would have produced and an unchanged one is left alone.
 */
export function moveRelativeBox(
  style: CSSStyleDeclaration,
  before: LayoutBox,
  beforeOrigin: { readonly x: number; readonly y: number },
  after: LayoutBox,
  afterOrigin: { readonly x: number; readonly y: number },
  scale: number
): void {
  const left = (after.x - afterOrigin.x) * scale;
  if (left !== (before.x - beforeOrigin.x) * scale) style.left = `${left}px`;
  const top = (after.y - afterOrigin.y) * scale;
  if (top !== (before.y - beforeOrigin.y) * scale) style.top = `${top}px`;
  if (after.width !== before.width) style.width = `${after.width * scale}px`;
  if (after.height !== before.height) style.height = `${after.height * scale}px`;
}

function terminatorOffset(line: LineRecord, rtl: boolean): number {
  return lineTerminatorEdge(line, rtl).x - line.contentX;
}

function sameLinePaint(
  before: LineRecord,
  after: LineRecord,
  gapOf: ParagraphReflowPaint['gapOf'],
  terminator: boolean,
  rtl: boolean
): boolean {
  if ((after.drawings?.length ?? 0) > 0) return false;
  if (before.box.height !== after.box.height) return false;
  if (before.spans.length !== after.spans.length) return false;
  if (!sameRecordExcept(before, after, LINE_GEOMETRY)) return false;
  for (let index = 0; index < after.spans.length; index += 1) {
    const a = before.spans[index]!;
    const b = after.spans[index]!;
    if (b.tabLeader || b.noteSeparator || b.style.shaping || b.style.border) return false;
    // A run's x and y are not painted: inline flow places it, from the line's left edge and
    // the gaps checked below. Its width and height are painted.
    if (a.box.width !== b.box.width || a.box.height !== b.box.height) return false;
    if (!sameRecordExcept(a, b, BOX_ONLY)) return false;
    if (index > 0 && gapOf(before, index) !== gapOf(after, index)) return false;
  }
  return !terminator || terminatorOffset(before, rtl) === terminatorOffset(after, rtl);
}

function sameParagraphPaint(
  before: ParagraphFragmentRecord,
  after: ParagraphFragmentRecord,
  paint: ParagraphReflowPaint
): boolean {
  if (after.borders || after.bottomBorder || after.marker?.picture) return false;
  if (before.box.height !== after.box.height) return false;
  if (before.lines.length !== after.lines.length) return false;
  if (!sameRecordExcept(before, after, FRAGMENT_GEOMETRY)) return false;
  if ((before.shadingBox === undefined) !== (after.shadingBox === undefined)) return false;
  if (before.shadingBox && before.shadingBox.height !== after.shadingBox!.height) return false;
  if ((before.marker === undefined) !== (after.marker === undefined)) return false;
  if (before.marker) {
    const marker = after.marker!;
    if (before.marker.box.height !== marker.box.height) return false;
    if (!sameRecordExcept(before.marker, marker, BOX_ONLY)) return false;
  }
  const rtl = paragraphIsRtl(after.props);
  const last = after.lines.length - 1;
  // The same conditions under which the paragraph painter seats a terminator glyph.
  const markOnLast =
    (paint.showParagraphMarks && Boolean(after.paragraphEnd)) ||
    (after.markRevisions?.length ?? 0) > 0;
  for (let index = 0; index <= last; index += 1) {
    const line = after.lines[index]!;
    const terminator =
      (paint.showParagraphMarks && Boolean(line.manualBreakAfter)) ||
      (index === last && markOnLast);
    if (!sameLinePaint(before.lines[index]!, line, paint.gapOf, terminator, rtl)) return false;
  }
  return true;
}

/**
 * Update a painted paragraph element in place for `after`, or refuse.
 *
 * `element` must be the element painted for `before` at the same scale and paint parameters.
 * The paragraph's own box belongs to its container, which places and sizes it after this
 * succeeds; only its height is required to be unchanged.
 * Returns false, without touching the element, when anything painted would differ.
 */
export function reflowParagraph(
  element: HTMLElement,
  before: ParagraphFragmentRecord,
  after: ParagraphFragmentRecord,
  paint: ParagraphReflowPaint
): boolean {
  if (!sameParagraphPaint(before, after, paint)) return false;
  const scale = paint.scale;
  // The painted children, in paint order: shading band, list marker, then one per line. The
  // refused features above are the only other children a paragraph paints.
  const shaded = Boolean(after.shading && HEX.test(after.shading) && after.shadingBox);
  const marked = after.marker !== undefined;
  const first = (shaded ? 1 : 0) + (marked ? 1 : 0);
  const children = element.children;
  if (children.length !== first + after.lines.length) return false;
  for (let index = 0; index < after.lines.length; index += 1) {
    const line = children[first + index] as HTMLElement;
    if (line.dataset.lineId !== after.lines[index]!.id) return false;
  }
  if (shaded && !children[0]!.classList.contains('docx-paragraph-shading')) return false;
  if (marked && !children[first - 1]!.classList.contains('docx-list-marker')) return false;

  if (shaded) {
    const band = children[0] as HTMLElement;
    moveRelativeBox(
      band.style,
      before.shadingBox!,
      before.box,
      after.shadingBox!,
      after.box,
      scale
    );
  }
  if (marked) {
    const marker = children[first - 1] as HTMLElement;
    moveRelativeBox(
      marker.style,
      before.marker!.box,
      before.box,
      after.marker!.box,
      after.box,
      scale
    );
  }
  for (let index = 0; index < after.lines.length; index += 1) {
    const a = before.lines[index]!;
    const b = after.lines[index]!;
    const line = children[first + index] as HTMLElement;
    const top = (b.box.y - after.box.y) * scale;
    if (top !== (a.box.y - before.box.y) * scale) line.style.top = `${top}px`;
    const left = (b.contentX - after.box.x) * scale;
    if (left !== (a.contentX - before.box.x) * scale) line.style.left = `${left}px`;
  }
  return true;
}
