// The anchors a paragraph break synthesizes wrap for from its own text, by wrap kind, and
// the page-fit bottom of the wrapping anchors each line holds.
//
// Page fit (`wrappedAnchorsEndAtBottomMargin`), in three steps across the body flow:
// - placement lifts an object that can end at the margin (`wrappedParagraphAnchorBottomTop`);
// - `createOwnAnchorPageFit` tells the flow when an object still crosses, so its line moves to
//   the next column, or the page ends after a line already at the top;
// - each fragment publishes the anchors its lines hold, framed by its own top
//   (`fragmentAnchorFrame`), so a moved object travels with its line.
//
// DOM-free. The break-time wrap synthesis follows the published records: a drawing the display
// mode resolves away publishes no record, so it reserves no line top and carves no hole.

import type { OoxmlNode } from '../store/package/ooxml-tree.ts';
import {
  anchoredDrawingAtomsInParagraph,
  drawingModelOffsetsInParagraph,
  measureInlineDrawing,
  resolveAnchoredDrawingPosition,
  type InlineDrawingLayoutContext,
} from './drawing-layout.ts';
import { wrapsText } from './anchor-content-top.ts';
import type { DrawingProjection } from '../store/package/drawing-projection.ts';
import type { BodyAnchorFrameBase } from './body-flow-helpers.ts';
import { placedTextboxProjection } from './drawing-exclusion.ts';
import type { TextboxStoryLayouter } from './inline-textbox-flow.ts';
import { revisionMarkupHidesDrawing } from './revision-markup-projection.ts';
import {
  revisionsVisible,
  type RevisionAuthorFilter,
  type RevisionDisplayMode,
} from './revision-projection.ts';

export interface ParagraphOwnAnchorStarts {
  /** Model offsets of the `wp:wrapTopAndBottom` anchors. */
  readonly topAndBottom: ReadonlySet<number>;
  /**
   * The subset of {@link topAndBottom} whose band a `paragraph` frame places at a zero or
   * positive offset. That band starts from the paragraph's top, not from the anchor line, so it
   * can reach earlier lines. A band above the paragraph's top is left out.
   */
  readonly paragraphFramedTopAndBottom: ReadonlySet<number>;
  /** Model offsets of the anchors that wrap text beside them (square, tight, through). */
  readonly wrap: ReadonlySet<number>;
}

const NO_STARTS: ParagraphOwnAnchorStarts = Object.freeze({
  topAndBottom: new Set<number>(),
  paragraphFramedTopAndBottom: new Set<number>(),
  wrap: new Set<number>(),
});

/**
 * A remainder re-broken on a later page (`startOffset`) holds only the anchors in its own text.
 * A float anchored before it stays with the earlier lines; its band reaches this page only
 * through the zones the page publishes.
 */
export function paragraphOwnAnchorStarts(options: {
  readonly paragraph: OoxmlNode;
  readonly drawingLayout: InlineDrawingLayoutContext | undefined;
  readonly startOffset: number;
  readonly displayMode: RevisionDisplayMode;
  readonly revisionAuthorFilter: RevisionAuthorFilter | undefined;
}): ParagraphOwnAnchorStarts {
  if (!options.drawingLayout) return NO_STARTS;
  const topAndBottom = new Set<number>();
  const paragraphFramedTopAndBottom = new Set<number>();
  const wrap = new Set<number>();
  const offsets = drawingModelOffsetsInParagraph(options.paragraph);
  const { displayMode, revisionAuthorFilter } = options;
  for (const atom of anchoredDrawingAtomsInParagraph(options.paragraph, options.drawingLayout)) {
    if (
      !revisionsVisible(atom.revisions, displayMode, revisionAuthorFilter) ||
      revisionMarkupHidesDrawing(atom.revisions, displayMode, revisionAuthorFilter)
    )
      continue;
    const kind = atom.projection.wrap;
    if (kind === 'inline' || kind === 'behind' || kind === 'inFront') continue;
    const modelStart = offsets.get(atom.atomId);
    if (modelStart === undefined || modelStart < options.startOffset) continue;
    if (kind !== 'topAndBottom') {
      wrap.add(modelStart);
      continue;
    }
    topAndBottom.add(modelStart);
    const vertical = atom.projection.position?.vertical;
    if (
      vertical?.relativeFrom === 'paragraph' &&
      vertical.align === null &&
      (vertical.offsetEmu ?? 0) >= 0
    )
      paragraphFramedTopAndBottom.add(modelStart);
  }
  return { topAndBottom, paragraphFramedTopAndBottom, wrap };
}

/** The range and height of a broken line, as the page-fit rule reads it. */
interface AnchorLine {
  readonly start: number;
  readonly end: number;
  readonly height: number;
}

/** The display and story inputs that select a paragraph's own page-fit anchors. */
export interface OwnAnchorScope {
  readonly drawingLayout: InlineDrawingLayoutContext | undefined;
  readonly displayMode: RevisionDisplayMode;
  readonly revisionAuthorFilter: RevisionAuthorFilter | undefined;
  readonly layoutTextboxStory: TextboxStoryLayouter | undefined;
}

interface OwnAnchor {
  readonly start: number;
  readonly frame: 'paragraph' | 'line';
  readonly projection: DrawingProjection;
}

/** Points a bottom may pass the margin by and still count as ending on it (float rounding). */
const BOTTOM_TOLERANCE = 0.01;

/**
 * The objects that `wrappedAnchorsEndAtBottomMargin` applies to: visible, published objects
 * that wrap text and take their vertical position from their paragraph or line. The same
 * filters as publishing, so a hidden or resolved-away object never moves a line.
 */
function ownPageFitAnchors(paragraph: OoxmlNode, scope: OwnAnchorScope): readonly OwnAnchor[] {
  const { drawingLayout, displayMode, revisionAuthorFilter } = scope;
  if (!drawingLayout) return [];
  const offsets = drawingModelOffsetsInParagraph(paragraph);
  if (offsets.size === 0) return [];
  const anchors: OwnAnchor[] = [];
  for (const atom of anchoredDrawingAtomsInParagraph(paragraph, drawingLayout)) {
    const start = offsets.get(atom.atomId);
    const frame = atom.projection.position?.vertical.relativeFrom;
    if (
      start === undefined ||
      (frame !== 'paragraph' && frame !== 'line') ||
      atom.projection.hidden ||
      atom.projection.anchor?.simplePos ||
      !wrapsText(atom.projection.wrap) ||
      !revisionsVisible(atom.revisions, displayMode, revisionAuthorFilter) ||
      revisionMarkupHidesDrawing(atom.revisions, displayMode, revisionAuthorFilter)
    )
      continue;
    const projection = placedTextboxProjection(atom.projection, scope.layoutTextboxStory);
    anchors.push({ start, frame, projection });
  }
  return anchors;
}

const onLine = (start: number, line: AnchorLine, lastLine: boolean): boolean =>
  start >= line.start && (start < line.end || (lastLine && start === line.end));

/** Where one paragraph's lines meet `wrappedAnchorsEndAtBottomMargin`. */
export interface OwnAnchorPageFit {
  /**
   * Whether an object the line anchors still crosses the bottom margin where it publishes
   * when the line sits at `lineY` in a paragraph whose anchors publish against `paragraphY()`
   * (read only for a line that holds such an object).
   * Placement already moved up every object that can end at the margin
   * (`wrappedParagraphAnchorBottomTop`), so a crossing object cannot end there without rising
   * above its line: the line moves to the next page, and an object that still crosses the
   * margin there ends the page.
   */
  crosses(line: AnchorLine, lastLine: boolean, paragraphY: () => number, lineY: number): boolean;
}

/** The page-fit test for one body paragraph, in modern modes only. */
export function createOwnAnchorPageFit(
  paragraph: OoxmlNode,
  scope: OwnAnchorScope & {
    readonly frameBase: () => BodyAnchorFrameBase;
    readonly column: () => { readonly x: number; readonly width: number };
  }
): OwnAnchorPageFit {
  const anchors = ownPageFitAnchors(paragraph, scope);
  if (anchors.length === 0) return { crosses: () => false };
  return {
    crosses(line, lastLine, paragraphY, lineY) {
      if (!anchors.some((anchor) => onLine(anchor.start, line, lastLine))) return false;
      const frameBase = scope.frameBase();
      if (frameBase.wrappedParagraphAnchorBottom !== 'margin') return false;
      const { x, width } = scope.column();
      const top = paragraphY();
      const box = (y: number) => ({ x, y, width, height: line.height });
      for (const anchor of anchors) {
        if (!onLine(anchor.start, line, lastLine)) continue;
        const resolved = resolveAnchoredDrawingPosition(anchor.projection, {
          ...frameBase,
          paragraphBox: box(top),
          anchorLineBox: box(lineY),
          anchorCharacterX: x,
          columnBox: box(top),
          cellBox: null,
          layoutInCell: false,
        });
        const bottom = resolved.y + measureInlineDrawing(anchor.projection).height;
        if (!resolved.layoutFallback && bottom > frameBase.contentHeight + BOTTOM_TOLERANCE)
          return true;
      }
      return false;
    },
  };
}

/**
 * The paragraph's lines with each line's height raised to the room its own objects need below
 * its top, for `w:keepNext` pricing. A line fits with an object of height `h` when the object
 * ends above the margin where it is, or when `h` fits below the line top (the object then moves
 * up). `opening` gives the space and top border above the first line, which a paragraph-relative
 * offset counts from. Modern modes only (`modern`); other modes return the lines unchanged.
 */
export function linesWithOwnAnchorNeeds<T extends AnchorLine>(
  paragraph: OoxmlNode,
  lines: readonly T[],
  scope: OwnAnchorScope & { readonly modern: () => boolean; readonly opening: () => number }
): readonly T[] {
  const anchors = ownPageFitAnchors(paragraph, scope);
  if (anchors.length === 0 || !scope.modern()) return lines;
  let fromParagraphTop = scope.opening();
  return lines.map((line, index) => {
    const lineTop = fromParagraphTop;
    fromParagraphTop += line.height;
    let need = line.height;
    for (const anchor of anchors) {
      if (!onLine(anchor.start, line, index === lines.length - 1)) continue;
      const vertical = anchor.projection.position!.vertical;
      const offset = vertical.align === null ? (vertical.offsetEmu ?? 0) / 12_700 : 0;
      // A first-line frame starts at the paragraph top, above the opening space and border.
      const belowLine = anchor.frame === 'line' && index > 0 ? offset : offset - lineTop;
      const height = measureInlineDrawing(anchor.projection).height;
      need = Math.max(need, Math.min(height, belowLine + height));
    }
    return need === line.height ? line : { ...line, height: need };
  });
}
