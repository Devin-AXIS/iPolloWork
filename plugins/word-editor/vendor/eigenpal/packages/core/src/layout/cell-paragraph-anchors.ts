// The anchored objects of a cell-flow paragraph: their publication, and the room they claim.
//
// A wrapping object laid out in a table cell and positioned from its paragraph or line stays
// inside its cell: a negative offset stops at the cell box top (`anchor-content-top.ts`), and
// the cell grows until it holds the whole object, so the next row starts below it. The text
// after it in the same cell still wraps around it, so only the cell's bottom moves, never
// the paragraph's. An object that does not wrap (`wrapNone`, in front of or behind the
// text) keeps its offset and claims no room.
//
// Near the page bottom (`cellAnchorPageFit`), a line whose object would end below the page
// waits for the row's next page in modern modes; in legacy modes the row moves whole.

import type { OoxmlElement, OoxmlNode } from '@docx-editor.dev/core/store';
import { wrapsText } from './anchor-content-top.ts';
import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';
import {
  anchorLaidOutInCell,
  cellAnchorScope,
  type CellAnchorScope,
} from './cell-anchor-layout.ts';
import {
  anchoredDrawingAtomsInParagraph,
  drawingModelOffsetsInParagraph,
} from './drawing-atom-walk.ts';
import {
  emuToPointsSafe,
  measureInlineDrawing,
  publishAnchoredDrawingsForParagraph,
} from './drawing-layout.ts';
import { revisionMarkupHidesDrawing } from './revision-markup-projection.ts';
import {
  DEFAULT_REVISION_DISPLAY_MODE,
  projectedRevisions,
  type RevisionAttribution,
} from './revision-projection.ts';
import type { DrawingProjection } from '../store/package/drawing-projection.ts';
import type { BlockFragmentRecord, LayoutBox, LineRecord } from './semantic-records.ts';
import type { TableFlowDeps } from './semantic-table-layout.ts';

/** Publish (or defer to the row) the anchored objects of one placed cell paragraph. */
export function publishCellParagraphAnchors(
  deps: TableFlowDeps,
  placed: {
    readonly paragraph: OoxmlNode;
    readonly paragraphId: string;
    readonly paragraphBox: LayoutBox;
    readonly lines: readonly LineRecord[];
    readonly originX: number;
    readonly top: number;
    readonly maxBottom: number;
    readonly cellContentWidth: number;
    readonly anchorScope: CellAnchorScope;
  }
): void {
  if (!deps.inlineDrawingLayout || !deps.anchorFrameBase || !deps.pageContentClip) return;
  const { paragraph, paragraphId, paragraphBox, lines } = placed;
  if (deps.deferAnchoredDrawings) {
    deps.deferAnchoredDrawings({
      paragraph,
      paragraphId,
      paragraphBox,
      lines,
      cellOriginX: placed.originX,
      cellContentWidth: placed.cellContentWidth,
    });
    return;
  }
  if (!deps.collectAnchoredDrawings) return;
  const cellBox = Object.freeze({
    x: placed.originX,
    y: placed.top,
    width: placed.cellContentWidth,
    height: Math.max(0, placed.maxBottom - placed.top),
  });
  deps.collectAnchoredDrawings(
    publishAnchoredDrawingsForParagraph({
      paragraph,
      paragraphId,
      paragraphBox,
      lines,
      drawingLayout: deps.inlineDrawingLayout,
      frameBase: deps.anchorFrameBase(),
      columnBox: deps.columnBoxForParagraph?.(paragraphBox) ?? paragraphBox,
      cellBox,
      cellContentBox: cellBox,
      pageClip: deps.pageContentClip(),
      cellAnchorScope: placed.anchorScope,
      measurer: deps.measurer,
      ...(deps.hostedStory ? { layoutTextboxStory: deps.hostedStory.layoutTextboxStoryFor } : {}),
      ...(deps.displayMode ? { displayMode: deps.displayMode } : {}),
      ...(deps.revisionAuthorFilter ? { revisionAuthorFilter: deps.revisionAuthorFilter } : {}),
    })
  );
}

/**
 * A wrapping object its paragraph or line positions, and how far below that frame's top it
 * ends. `start` is its model offset in the paragraph; `revisions` decide whether a display mode
 * shows it.
 */
interface ParagraphAnchorReach {
  readonly projection: DrawingProjection;
  readonly start: number;
  readonly revisions: readonly RevisionAttribution[];
  readonly frame: 'paragraph' | 'line';
  readonly reach: number;
}

/**
 * Per immutable paragraph node: every layout pass asks this of every cell paragraph, and most
 * hold no object, so the walk runs once per paragraph. The entries hold for every display
 * mode; the caller filters them by revision.
 */
const reachByParagraph = new WeakMap<OoxmlElement, readonly ParagraphAnchorReach[]>();

function paragraphAnchorReaches(
  paragraph: OoxmlElement,
  drawingLayout: NonNullable<TableFlowDeps['inlineDrawingLayout']>
): readonly ParagraphAnchorReach[] {
  const cached = reachByParagraph.get(paragraph);
  if (cached) return cached;
  const reaches: ParagraphAnchorReach[] = [];
  const atoms = anchoredDrawingAtomsInParagraph(paragraph, drawingLayout);
  const offsets = atoms.length > 0 ? drawingModelOffsetsInParagraph(paragraph) : null;
  for (const atom of atoms) {
    const projection = atom.projection;
    const vertical = projection.position?.vertical;
    if (
      projection.hidden ||
      projection.anchor?.simplePos ||
      (vertical?.relativeFrom !== 'paragraph' && vertical?.relativeFrom !== 'line') ||
      vertical.align !== null ||
      !wrapsText(projection.wrap)
    )
      continue;
    const offset = emuToPointsSafe(vertical.offsetEmu ?? 0);
    const start = offsets?.get(atom.atomId);
    if (offset === null || start === undefined) continue;
    const frame = vertical.relativeFrom;
    const height = measureInlineDrawing(projection).height;
    // A negative paragraph offset stops at the cell top; a line offset counts from its line.
    const reach = (frame === 'paragraph' ? Math.max(0, offset) : offset) + height;
    reaches.push({ projection, start, revisions: atom.revisions, frame, reach });
  }
  const frozen = Object.freeze(reaches);
  reachByParagraph.set(paragraph, frozen);
  return frozen;
}

/**
 * The bottom of the lowest wrapping in-cell object this paragraph fragment positions, if any.
 * As in publishing, an object counts only on the line that holds it and only when the display
 * mode shows it, so a split paragraph grows only the cell part that draws the object.
 */
function paragraphAnchorBottom(
  paragraph: OoxmlElement,
  fragment: { readonly box: LayoutBox; readonly lines: readonly LineRecord[] },
  deps: TableFlowDeps,
  scope: CellAnchorScope
): number | undefined {
  if (!deps.inlineDrawingLayout) return undefined;
  const paragraphTop = fragment.box.y;
  let lowest: number | undefined;
  for (const anchor of visibleInCellReaches(paragraph, deps, scope)) {
    const line = fragment.lines.find(
      (candidate) => anchor.start >= candidate.range.start && anchor.start < candidate.range.end
    );
    if (!line) continue;
    const bottom = (anchor.frame === 'line' ? line.box.y : paragraphTop) + anchor.reach;
    if (lowest === undefined || bottom > lowest) lowest = bottom;
  }
  return lowest;
}

/** The paragraph's wrapping objects a display mode shows and the cell lays out in it. */
function visibleInCellReaches(
  paragraph: OoxmlElement,
  deps: TableFlowDeps,
  scope: CellAnchorScope
): readonly ParagraphAnchorReach[] {
  if (!deps.inlineDrawingLayout) return [];
  const displayMode = deps.displayMode ?? DEFAULT_REVISION_DISPLAY_MODE;
  return paragraphAnchorReaches(paragraph, deps.inlineDrawingLayout).filter(
    ({ projection, revisions }) =>
      !revisionMarkupHidesDrawing(revisions, displayMode, deps.revisionAuthorFilter) &&
      projectedRevisions(revisions, displayMode, deps.revisionAuthorFilter) !== null &&
      anchorLaidOutInCell(projection, scope)
  );
}

/**
 * The page-fit test for a table-cell paragraph's lines, or null when no rule or object applies.
 * A line whose object would end below the row's page bottom (`cellPageBottom`) waits for the
 * row's next page in modern modes (`wrappedAnchorsEndAtBottomMargin`), unless nothing of the
 * cell is placed yet on a row at the page top. In legacy modes (`wrappedAnchorsEndOnSheet`) the
 * line stays and the crossing goes to `onCellAnchorCrossing`, so the row-start probe moves the
 * row whole. An exact row has no page bottom here: it clips its content instead. Frames are
 * those publishing uses: the paragraph top, or the top of the line.
 */
export function cellAnchorPageFit(
  paragraph: OoxmlElement,
  deps: TableFlowDeps,
  top: number,
  options: { readonly inTableCell?: boolean; readonly aloneOnPage?: boolean } | undefined
): ((line: AnchorLineRange, lineTop: number, placed: number) => boolean) | null {
  const maxBottom = deps.cellPageBottom;
  if (options?.inTableCell !== true || maxBottom === undefined || !Number.isFinite(maxBottom))
    return null;
  if (!deps.inlineDrawingLayout) return null;
  if (paragraphAnchorReaches(paragraph, deps.inlineDrawingLayout).length === 0) return null;
  const modern = hasCompatibilityRule(deps.compatibilityMode, 'wrappedAnchorsEndAtBottomMargin');
  const reports =
    !modern &&
    deps.onCellAnchorCrossing !== undefined &&
    deps.rowAtPageStart === false &&
    hasCompatibilityRule(deps.compatibilityMode, 'wrappedAnchorsEndOnSheet');
  if (!modern && !reports) return null;
  const anchors = visibleInCellReaches(paragraph, deps, cellAnchorScope(true, deps, paragraph.id));
  if (anchors.length === 0) return null;
  return (line, lineTop, placed) => {
    const crosses = anchors.some(
      (anchor) =>
        anchor.start >= line.start &&
        anchor.start < line.end &&
        (anchor.frame === 'line' ? lineTop : top) + anchor.reach > maxBottom + BOTTOM_TOLERANCE
    );
    if (!crosses) return false;
    if (reports) deps.onCellAnchorCrossing!();
    return modern && !(options.aloneOnPage === true && placed === 0);
  };
}

/** The model range of a broken line. */
interface AnchorLineRange {
  readonly start: number;
  readonly end: number;
}

/** Points a bottom may pass the page by and still count as ending on it (float rounding). */
const BOTTOM_TOLERANCE = 0.01;

/**
 * A table cell's content bottom, grown to hold the wrapping objects its paragraphs lay out
 * in it. Story boxes that reuse cell flow (headers, footers, text boxes) keep their bottom.
 */
export function cellBottomWithAnchors(
  bottom: number,
  blocks: readonly OoxmlElement[],
  fragments: readonly BlockFragmentRecord[],
  deps: TableFlowDeps,
  inTableCell: boolean | undefined
): number {
  if (inTableCell !== true || !deps.inlineDrawingLayout || fragments.length === 0) return bottom;
  let grown = bottom;
  for (const fragment of fragments) {
    if (fragment.kind !== 'paragraph') continue;
    const paragraph = blocks.find((block) => block.id === fragment.paragraphId);
    if (!paragraph || paragraph.kind !== 'paragraph') continue;
    const scope = cellAnchorScope(true, deps, fragment.paragraphId);
    const anchorBottom = paragraphAnchorBottom(paragraph, fragment, deps, scope);
    if (anchorBottom !== undefined && anchorBottom > grown) grown = anchorBottom;
  }
  return grown;
}
