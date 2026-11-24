// Labeled break furniture shown with paragraph marks: "Page break", "Column break" and
// "Section break (…)". Each label sits on a dotted rule that runs from the end of the line's
// content to the far edge of its band, so every break says what it is and where it falls.
//
// Furniture only: no model range, `aria-hidden`, not editable and not hit-testable, so a label
// can never be selected, copied, counted as text or take the caret.

import { appendParagraphBoundary } from './semantic-paragraph-boundary.ts';
import type {
  LineRecord,
  ParagraphFragmentRecord,
  RevisionAttribution,
  SectionBreakType,
  SemanticLayout,
} from '@docx-editor.dev/core/layout';
import { DEFAULT_RUN_STYLE } from '../layout/run-style.ts';
import { paragraphIsRtl } from '../layout/rtl-paragraph.ts';
import { lineContentEdges } from '../layout/pending-line.ts';
import { PAGE_BREAK_CHAR } from '../store/package/hard-break.ts';
import type { ResolvedRevisionMarkup } from '../contracts/revision-markup.ts';
import type { RevisionStyleContext } from './revision-presentation.ts';
import {
  applyBreakRevision,
  lineTerminatorEdge,
  paintParagraphMark,
  seatTerminatorMark,
} from './semantic-paragraph-marks.ts';

/** Localized break labels; adapters supply i18n-backed implementations. */
export interface BreakMarkStrings {
  readonly pageBreak: string;
  readonly columnBreak: string;
  readonly sectionBreakContinuous: string;
  readonly sectionBreakNextPage: string;
  readonly sectionBreakEvenPage: string;
  readonly sectionBreakOddPage: string;
  readonly sectionBreakNextColumn: string;
}

export const DEFAULT_BREAK_MARK_STRINGS: BreakMarkStrings = Object.freeze({
  pageBreak: 'Page break',
  columnBreak: 'Column break',
  sectionBreakContinuous: 'Section break (continuous)',
  sectionBreakNextPage: 'Section break (next page)',
  sectionBreakEvenPage: 'Section break (even page)',
  sectionBreakOddPage: 'Section break (odd page)',
  sectionBreakNextColumn: 'Section break (new column)',
});

const KEYS = Object.keys(DEFAULT_BREAK_MARK_STRINGS) as readonly (keyof BreakMarkStrings)[];

/** Build localized labels from an i18n `t('formattingMarks.*')` callback. */
export function breakMarkStringsFromTranslate(
  t: ((key: string) => string) | undefined
): BreakMarkStrings {
  if (!t) return DEFAULT_BREAK_MARK_STRINGS;
  const strings = {} as Record<keyof BreakMarkStrings, string>;
  for (const key of KEYS) {
    const path = `formattingMarks.${key}`;
    const value = t(path);
    // A host translate that echoes unknown keys must not paint the key itself.
    strings[key] = value && value !== path ? value : DEFAULT_BREAK_MARK_STRINGS[key];
  }
  return Object.freeze(strings);
}

/** A stable token for the paint-reuse key. */
export function breakMarkStringsCacheToken(strings: BreakMarkStrings): string {
  return KEYS.map((key) => strings[key]).join('\0');
}

/** The label for a line break kind. */
export function lineBreakLabel(kind: 'page' | 'column', strings: BreakMarkStrings): string {
  return kind === 'page' ? strings.pageBreak : strings.columnBreak;
}

/** The label for a section break, named by how the next section starts. */
export function sectionBreakLabel(kind: SectionBreakType, strings: BreakMarkStrings): string {
  switch (kind) {
    case 'continuous':
      return strings.sectionBreakContinuous;
    case 'evenPage':
      return strings.sectionBreakEvenPage;
    case 'oddPage':
      return strings.sectionBreakOddPage;
    case 'nextColumn':
      return strings.sectionBreakNextColumn;
    default:
      return strings.sectionBreakNextPage;
  }
}

/** Label size in points; the label is a reading aid, not document text. */
const LABEL_SIZE_PT = 8;

/**
 * Where break labels may run on a line, in page points: from the content end to the far edge
 * of the line's band, on the paragraph's base-direction side. A line with no content, such as
 * an empty section-break paragraph, gives the labels its whole band whatever its alignment.
 */
export function breakMarkExtent(
  line: LineRecord,
  paragraphRtl: boolean
): { readonly left: number; readonly right: number; readonly rtl: boolean } {
  const edge = lineTerminatorEdge(line, paragraphRtl);
  const bandLeft = line.box.x;
  const bandRight = line.box.x + line.box.width;
  if (!lineHoldsContent(line)) {
    return { left: bandLeft, right: bandRight, rtl: edge.rtl };
  }
  return edge.rtl
    ? { left: Math.min(bandLeft, edge.x), right: edge.x, rtl: true }
    : { left: edge.x, right: Math.max(bandRight, edge.x), rtl: false };
}

/** Content other than the zero-width break characters themselves. */
function lineHoldsContent(line: LineRecord): boolean {
  if (!lineContentEdges(line.spans, line.drawings ?? [])) return false;
  if ((line.drawings?.length ?? 0) > 0) return true;
  return line.spans.some(
    (span) =>
      span.box.width > 0 ||
      (span.text !== PAGE_BREAK_CHAR && span.text !== '\n' && span.text !== '')
  );
}

function paintRule(document: Document): HTMLElement {
  const rule = document.createElement('span');
  rule.className = 'docx-break-mark-rule';
  rule.style.flex = '1 1 0';
  rule.style.minWidth = '0';
  rule.style.height = '0';
  rule.style.borderTop = '1px dotted currentColor';
  return rule;
}

/** One label to paint: its text and the revisions of the break it names. */
export interface BreakMarkLabel {
  readonly text: string;
  readonly revisions?: readonly RevisionAttribution[];
}

/**
 * Paint one or more labeled break rules at the end of `lineElement`.
 *
 * Several labels share the extent in equal parts, in reading order: a page break that ends
 * the paragraph holding a section break shows both. Each label takes its break's revision
 * presentation. The rules sit on the line's text, half a label above its baseline. At
 * `boundary` placement, used for a mark paragraph that takes no vertical space, the band is
 * centred on the line's top edge instead, between the blocks around it, so it never runs
 * through the text of the line that shares its position.
 */
export function paintBreakMarks(
  document: Document,
  line: LineRecord,
  lineElement: HTMLElement,
  labels: readonly BreakMarkLabel[],
  options: {
    readonly paragraphRtl: boolean;
    readonly scale: number;
    readonly colors?: RevisionStyleContext;
    readonly boundary?: boolean;
  }
): { readonly left: number; readonly right: number; readonly rtl: boolean } | null {
  if (labels.length === 0) return null;
  const { scale } = options;
  const extent = breakMarkExtent(line, options.paragraphRtl);
  const sizePx = LABEL_SIZE_PT * scale;
  const container = document.createElement('span');
  container.className = 'docx-break-mark';
  container.dataset.docxMarker = '';
  container.setAttribute('aria-hidden', 'true');
  container.setAttribute('contenteditable', 'false');
  container.style.position = 'absolute';
  container.style.left = `${(extent.left - line.contentX) * scale}px`;
  container.style.width = `${Math.max(0, extent.right - extent.left) * scale}px`;
  container.style.height = `${sizePx}px`;
  if (options.boundary) container.style.top = `${-sizePx / 2}px`;
  else container.style.bottom = `${Math.max(0, line.box.height - line.baseline) * scale}px`;
  container.style.display = 'flex';
  container.style.overflow = 'hidden';
  container.style.pointerEvents = 'none';
  container.style.userSelect = 'none';
  container.style.whiteSpace = 'pre';
  container.style.fontFamily = 'Arial, Helvetica, sans-serif';
  container.style.fontSize = `${sizePx}px`;
  container.style.fontWeight = 'normal';
  container.style.fontStyle = 'normal';
  container.style.lineHeight = `${sizePx}px`;
  container.style.color = 'var(--doc-revision-format)';
  if (extent.rtl) container.style.direction = 'rtl';
  for (const { text, revisions } of labels) {
    const segment = document.createElement('span');
    segment.className = 'docx-break-mark-segment';
    segment.style.flex = '1 1 0';
    segment.style.minWidth = '0';
    segment.style.display = 'flex';
    segment.style.alignItems = 'center';
    applyBreakRevision(segment, revisions, options.colors);
    const label = document.createElement('span');
    label.className = 'docx-break-mark-label';
    label.textContent = text;
    // The label is UI text, not document text: it takes the direction of its own language,
    // so a right-to-left label keeps its parentheses in place inside a left-to-right page.
    label.dir = 'auto';
    label.style.unicodeBidi = 'isolate';
    label.style.flex = '0 1 auto';
    label.style.minWidth = '0';
    label.style.overflow = 'hidden';
    label.style.padding = `0 ${sizePx / 2}px`;
    segment.append(paintRule(document), label, paintRule(document));
    container.append(segment);
  }
  lineElement.append(container);
  return extent;
}

/** The revisions of the span holding a line's closing page or column break. */
function breakSpanRevisions(line: LineRecord): readonly RevisionAttribution[] | undefined {
  const text = line.breakAfter === 'page' ? PAGE_BREAK_CHAR : '\n';
  for (let index = line.spans.length - 1; index >= 0; index -= 1) {
    if (line.spans[index]!.text === text) return line.spans[index]!.revisions;
  }
  return undefined;
}

/** Break-label inputs resolved once per paint, from the whole layout. */
export interface BreakMarkPaint {
  readonly strings: BreakMarkStrings;
  /** Section kind by the paragraph id whose mark ends the section. */
  readonly sectionBreaks: ReadonlyMap<string, SectionBreakType>;
  /** Moves whenever a section break's paragraph or kind moves, for the paint-reuse key. */
  readonly token: string;
}

export function breakMarksOfLayout(
  layout: SemanticLayout,
  strings: BreakMarkStrings
): BreakMarkPaint {
  const marks = layout.sectionBreaks ?? [];
  return {
    strings,
    sectionBreaks: new Map(marks.map((mark) => [mark.paragraphId, mark.kind])),
    token: marks.map((mark) => `${mark.paragraphId}:${mark.kind}`).join(','),
  };
}

/**
 * Paint the break labels of one paragraph fragment onto its painted lines.
 *
 * A section label stands in for the paragraph mark, so the caller paints no pilcrow beside it
 * unless the mark carries a tracked change that review chrome reads. When a label occupies the
 * last line's terminator edge, `pilcrowAt` places any pilcrow past the label's far end.
 */
function paintFragmentBreakMarks(
  document: Document,
  fragment: ParagraphFragmentRecord,
  lineElements: readonly HTMLElement[],
  breakMarks: BreakMarkPaint,
  options: {
    readonly paragraphRtl: boolean;
    readonly scale: number;
    readonly colors?: RevisionStyleContext;
  }
): { readonly replacesPilcrow: boolean; readonly pilcrowAt?: { x: number; rtl: boolean } } {
  const lastIndex = fragment.lines.length - 1;
  const section = fragment.paragraphEnd
    ? breakMarks.sectionBreaks.get(fragment.paragraphId)
    : undefined;
  // Out of flow without a frame: an empty section mark that shares its line with the next
  // block, or the empty line kept before a leading page break, which paints nothing.
  const collapsed = fragment.outOfFlow === true && !fragment.positionedFrame;
  let pilcrowAt: { x: number; rtl: boolean } | undefined;
  for (let index = 0; index <= lastIndex; index += 1) {
    const line = fragment.lines[index]!;
    const element = lineElements[index];
    if (!element) continue;
    const labels: BreakMarkLabel[] = [];
    if (line.breakAfter && !collapsed) {
      const revisions = breakSpanRevisions(line);
      labels.push({
        text: lineBreakLabel(line.breakAfter, breakMarks.strings),
        ...(revisions ? { revisions } : {}),
      });
    }
    if (index === lastIndex && section) {
      labels.push({ text: sectionBreakLabel(section, breakMarks.strings) });
    }
    const extent = paintBreakMarks(document, line, element, labels, {
      ...options,
      boundary: collapsed,
    });
    // A boundary label sits off the line's text, so a tracked pilcrow keeps its own seat.
    if (extent && index === lastIndex && !collapsed) {
      pilcrowAt = { x: extent.rtl ? extent.left : extent.right, rtl: extent.rtl };
    }
  }
  return { replacesPilcrow: section !== undefined, ...(pilcrowAt ? { pilcrowAt } : {}) };
}

/**
 * Paint the paragraph-end furniture of one fragment: break labels, then the pilcrow.
 *
 * A pilcrow paints with paragraph marks shown on the fragment that ends the paragraph, and
 * always for a tracked mark, whose attribution review chrome reads. It sits on the last
 * line's baseline after its content, at the mark's own size; with no content it sits at the
 * aligned origin, where the caret goes.
 */
export function paintParagraphEndFurniture(
  document: Document,
  fragment: ParagraphFragmentRecord,
  lineElements: readonly HTMLElement[],
  ctx: {
    readonly showParagraphMarks?: boolean;
    readonly breakMarks?: BreakMarkPaint;
    readonly inertLinks?: boolean;
    readonly revisionStyles?: RevisionStyleContext;
    readonly revisionMarkup?: ResolvedRevisionMarkup;
    readonly revisionKindColors?: boolean;
    /** A paint with no editing identity: nothing reads its text through an input method. */
    readonly unbound?: boolean;
  },
  scale: number
): void {
  if (!ctx.unbound) appendParagraphBoundary(document, fragment, lineElements, scale);
  const rtl = paragraphIsRtl(fragment.props);
  // Furniture stories (headers, footers, text boxes) never break a page or end a section.
  const breaks =
    ctx.breakMarks && !ctx.inertLinks
      ? paintFragmentBreakMarks(document, fragment, lineElements, ctx.breakMarks, {
          paragraphRtl: rtl,
          scale,
          ...(ctx.revisionStyles ? { colors: ctx.revisionStyles } : {}),
        })
      : null;
  const tracked = (fragment.markRevisions?.length ?? 0) > 0;
  const shown = ctx.showParagraphMarks && fragment.paragraphEnd && !breaks?.replacesPilcrow;
  if (!shown && !tracked) return;
  const glyph = paintParagraphMark(
    document,
    fragment.markRevisions ?? [],
    ctx.revisionStyles,
    ctx.revisionMarkup,
    ctx.revisionKindColors
  );
  const last = fragment.lines[fragment.lines.length - 1];
  const lastElement = lineElements[lineElements.length - 1];
  if (!last || !lastElement) return;
  const size =
    fragment.paragraphMarkSizePt ??
    fragment.emptyParagraphStyle?.fontSizePt ??
    last.spans.at(-1)?.style.fontSizePt ??
    DEFAULT_RUN_STYLE.fontSizePt;
  seatTerminatorMark(glyph, lastElement, last, rtl, size, scale, breaks?.pilcrowAt);
}
