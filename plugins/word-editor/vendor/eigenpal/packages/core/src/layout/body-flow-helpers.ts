// Small body-flow policies extracted from the story loop.

import type { OoxmlElement } from '@docx-editor.dev/core/store';
import {
  anchoredDrawingAtomsInParagraph,
  type DrawingAnchorFrameContext,
} from './drawing-layout.ts';
import type { InlineDrawingLayoutContext } from './drawing-layout.ts';
import type { PendingLine } from './paragraph-flow.ts';
import { holdsOnlyPageBreak } from './pending-line.ts';
import { drawingModelOffsetsInParagraph } from './drawing-atom-walk.ts';
import { marginInset } from './page-body-margins.ts';
import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';
import { paragraphBorderExtentPt, type ParagraphBorders } from './paragraph-style.ts';
import type { LayoutBox } from './semantic-records.ts';

/** The page and column facts an anchored drawing or table resolves its frame against. */
export type BodyAnchorFrameBase = Omit<
  DrawingAnchorFrameContext,
  'paragraphBox' | 'anchorLineBox' | 'anchorCharacterX' | 'columnBox' | 'cellBox' | 'layoutInCell'
>;

interface BodyAnchorFrameInput {
  readonly pageNumber: number;
  readonly onPageParityRead: () => void;
  readonly geometry: {
    readonly width: number;
    readonly height: number;
    readonly margin: { readonly left: number; readonly right: number; readonly bottom: number };
  };
  readonly insets: { readonly top: number; readonly bottom: number; readonly height: number };
  readonly contentWidth: number;
  readonly contentHeight: number;
  readonly ownerPartName: string;
  readonly compatibilityMode?: number;
}

/** Build the drawing/table anchor facts for the current body sheet. */
export function bodyAnchorFrameBase(input: BodyAnchorFrameInput): BodyAnchorFrameBase {
  const { geometry, insets } = input;
  return Object.freeze({
    pageNumber: input.pageNumber,
    onPageParityRead: input.onPageParityRead,
    pageWidth: geometry.width,
    pageHeight: geometry.height,
    marginLeft: geometry.margin.left,
    marginRight: geometry.margin.right,
    marginBottom: marginInset(geometry.margin.bottom),
    // Effective insets keep page-relative anchors stable when tall furniture moves body text.
    contentInsetTop: insets.top,
    contentInsetBottom: insets.bottom,
    contentWidth: input.contentWidth,
    contentHeight: input.contentHeight,
    contentBandHeight: insets.height,
    ownerPartName: input.ownerPartName,
    storyKind: 'body',
    ...(hasCompatibilityRule(input.compatibilityMode, 'columnAlignmentFollowsIndents')
      ? { columnAlignmentFollowsIndents: true }
      : {}),
    ...(hasCompatibilityRule(input.compatibilityMode, 'wrappedAnchorsStayBelowTopMargin')
      ? { wrappedParagraphAnchorsBelowContentTop: true }
      : {}),
    ...(hasCompatibilityRule(input.compatibilityMode, 'wrappedAnchorsEndAtBottomMargin')
      ? { wrappedParagraphAnchorBottom: 'margin' as const }
      : hasCompatibilityRule(input.compatibilityMode, 'wrappedAnchorsEndOnSheet')
        ? { wrappedParagraphAnchorBottom: 'sheet' as const }
        : {}),
  });
}

interface PaintableParagraph {
  readonly paragraph: OoxmlElement;
  readonly listItem?: unknown;
  readonly shading: string | undefined;
  readonly borders: ParagraphBorders;
}

/** Whether a section-mark paragraph contributes no visible sheet content. */
export function paragraphPaintsNothing(
  entry: PaintableParagraph,
  lines: readonly PendingLine[],
  drawingContext: InlineDrawingLayoutContext | undefined
): boolean {
  return entry.shading === undefined && paragraphHoldsNothing(entry, lines, drawingContext);
}

/**
 * Whether a paragraph holds nothing but its mark: no text, list marker, drawing, break, or
 * border rule. Shading is not content: it only fills the box the paragraph occupies.
 */
export function paragraphHoldsNothing(
  entry: PaintableParagraph,
  lines: readonly PendingLine[],
  drawingContext: InlineDrawingLayoutContext | undefined
): boolean {
  if (entry.listItem !== undefined) return false;
  const { top, bottom, left, right, between, bar } = entry.borders;
  if (top ?? bottom ?? left ?? right ?? between ?? bar) return false;
  if (
    drawingContext &&
    anchoredDrawingAtomsInParagraph(entry.paragraph, drawingContext).length > 0
  ) {
    return false;
  }
  return lines.every(
    (line) =>
      line.drawings.length === 0 &&
      !line.pageBreakAfter &&
      !line.columnBreakAfter &&
      line.spans.every((span) => span.text.length === 0)
  );
}

/** Whether a line holds text or a picture, not just break characters. */
const lineHoldsContent = (line: PendingLine): boolean =>
  line.drawings.length > 0 || line.spans.some((span) => /[^\f\n]/.test(span.text));

/** Whether a line after the opening break holds text, a picture, or a page or column break. */
const lineFollowsBreak = (line: PendingLine): boolean =>
  line.pageBreakAfter === true || line.columnBreakAfter === true || lineHoldsContent(line);

/**
 * Whether a paragraph opens with a page break and has content or another break after it:
 * its first line holds nothing but the break. That line never takes a sheet of its own. It
 * stays at the bottom of the page it starts on, and the break then starts the content on the
 * next sheet.
 *
 * A list marker is not content there: it moves to the first line after the break. Borders,
 * shading, and space before are not either: the break line draws no rule, the space before
 * and the top rule open the text on the next sheet, and shading fills the break line where
 * it would sit. An anchored drawing is content, so those paragraphs keep the ordinary fit
 * rule. So does a paragraph with nothing after the break, and one that anchors floating
 * tables or text frames. A paragraph with only one page break keeps the ordinary fit: after a
 * full page, its break line takes the next sheet and the content after it starts one sheet
 * later. A line that holds only a column break stays even with nothing after it: the break
 * starts the next column, or the next sheet after the last column.
 */
export function opensWithPageBreak(
  entry: PaintableParagraph,
  lines: readonly PendingLine[],
  drawingContext: InlineDrawingLayoutContext | undefined,
  /** Admit a paragraph that holds only the page break: its line fits and stays at the page end. */
  breakOnly = false
): boolean {
  const first = lines[0];
  return (
    first !== undefined &&
    first.start === 0 &&
    (holdsOnlyColumnBreak(first) ||
      (holdsOnlyPageBreak(first) &&
        ((breakOnly && lines.length === 1) ||
          lines.some((line, index) => index > 0 && lineFollowsBreak(line))))) &&
    !(drawingContext && anchoredDrawingAtomsInParagraph(entry.paragraph, drawingContext).length > 0)
  );
}

/** Whether a line holds nothing but the column break that ends it. */
export const holdsOnlyColumnBreak = (line: PendingLine): boolean =>
  line.columnBreakAfter === true &&
  line.drawings.length === 0 &&
  line.spans.every((span) => !/[^\n]/.test(span.text));

/**
 * A kept break line's shading fills where the line would sit, below the band that holds it,
 * and stops at the page edge.
 */
export function atKeptBreakY(
  box: LayoutBox,
  kept: { readonly y: number; readonly clip: LayoutBox } | undefined
): LayoutBox {
  if (kept === undefined) return box;
  const height = Math.min(box.height, kept.clip.y + kept.clip.height - kept.y);
  return { ...box, y: kept.y, height: Math.max(height, 0) };
}

/** Whether the paragraph has a drawing at a model offset from `range.start` up to `range.end`. */
export function holdsDrawingIn(
  paragraph: OoxmlElement,
  range: { readonly start: number; readonly end: number }
): boolean {
  for (const offset of drawingModelOffsetsInParagraph(paragraph).values())
    if (offset >= range.start && offset < range.end) return true;
  return false;
}

/**
 * The authored space and top border above a paragraph's first line. The space before collapses
 * into the space after of the block above unless the document adds the two (`sumAdjacent`).
 */
export function openingAbove(
  paragraph: {
    readonly spacing?: { readonly before: number };
    readonly borders?: ParagraphBorders;
  },
  above: { readonly kind: string; readonly spacing?: { readonly after: number } } | undefined,
  sumAdjacent: boolean | undefined
): number {
  const after = above?.kind === 'paragraph' ? (above.spacing?.after ?? 0) : 0;
  const before = paragraph.spacing?.before ?? 0;
  const lead = sumAdjacent ? before : Math.max(before, after) - after;
  return lead + paragraphBorderExtentPt(paragraph.borders?.top);
}
