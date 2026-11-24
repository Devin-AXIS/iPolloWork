// How an anchored object flowing inside a cell box relates to that box.
//
// Cell flow lays out more than table cells: header, footer, note and text-box stories reuse
// it, so "has a cell box" does not mean "is in a table". Every consumer (break-time wrap
// synthesis, record publication) reads one {@link CellAnchorScope} through
// {@link anchorLaidOutInCell}, so the wrap hole and the published object cannot disagree
// about where the object is. Each rule below was printed from Word 16.113 under modes
// absent, 12, 14, 15 and 16.

import type {
  DrawingProjection,
  DrawingVerticalReferenceFrame,
} from '../store/package/drawing-projection.ts';
import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';
import type { LayoutBox } from './semantic-records.ts';

/** What decides how the anchors of one cell-flow paragraph lay out. */
export interface CellAnchorScope {
  /** A real table cell, as opposed to a story box that reuses cell flow. */
  readonly inTableCell: boolean;
  readonly compatibilityMode: number | undefined;
  /**
   * False where Word lays the story's text out as if its anchored objects had no wrap: a
   * header or footer paragraph before mode 15 runs its text straight under every logo,
   * whatever the wrap type. A table cell inside that header still wraps, as in Word. The
   * objects still paint where they are anchored.
   */
  readonly anchorsWrapText: boolean;
  /**
   * True for a paragraph whose out-of-cell floats the table's rows clear instead (see
   * `table-out-of-cell-floats.ts`), so the cell carves no top-and-bottom band for them.
   */
  readonly rowsClearOutOfCellFloats: boolean;
}

/**
 * The scope a cell-flow consumer assumes when its host passes none: a table cell with no
 * declared mode, which reads the authored flag exactly as the engine always has. Both
 * consumers default to this one value so they cannot disagree about an unscoped anchor.
 */
export const LEGACY_CELL_ANCHOR_SCOPE: CellAnchorScope = Object.freeze({
  inTableCell: true,
  compatibilityMode: undefined,
  anchorsWrapText: true,
  rowsClearOutOfCellFloats: false,
});

export function cellAnchorScope(
  inTableCell: boolean | undefined,
  story: {
    readonly compatibilityMode?: number;
    readonly anchorsWrapText?: boolean;
    readonly outOfCellFloatParagraphs?: ReadonlySet<string>;
  },
  paragraphId?: string
): CellAnchorScope {
  return Object.freeze({
    inTableCell: inTableCell === true,
    compatibilityMode: story.compatibilityMode,
    anchorsWrapText: story.anchorsWrapText !== false || inTableCell === true,
    rowsClearOutOfCellFloats:
      paragraphId !== undefined && rowsClearOutOfCellFloats(story, paragraphId),
  });
}

/** Whether rows clear this paragraph's out-of-cell floats; the scope's own reading. */
export function rowsClearOutOfCellFloats(
  story: { readonly outOfCellFloatParagraphs?: ReadonlySet<string> },
  paragraphId: string
): boolean {
  return story.outOfCellFloatParagraphs?.has(paragraphId) === true;
}

/**
 * Whether an anchored object that flows in a cell box is laid out in it.
 *
 * Word reads `layoutInCell="0"` only in a real table cell, and only in compatibility mode 14
 * and below or with no mode declared: the object is then positioned against the page. Even
 * there, an object positioned against its own character or line stays in the cell. From
 * mode 15, and in every header, footer, note or text box, Word ignores the flag and lays the
 * object out in its box, the same as `"1"`. The projection keeps what the file says; this is
 * the layout's reading of it.
 */
export function anchorLaidOutInCell(
  projection: Pick<DrawingProjection, 'anchor' | 'position'>,
  scope: CellAnchorScope
): boolean {
  if (!scope.inTableCell || hasCompatibilityRule(scope.compatibilityMode, 'anchorsLayOutInCell'))
    return true;
  const position = projection.position;
  if (position?.horizontal.relativeFrom === 'character') return true;
  if (position?.vertical.relativeFrom === 'line') return true;
  return projection.anchor?.layoutInCell ?? true;
}

/**
 * An anchor in a table cell that Word lays out against the page instead. It is not part of
 * the cell's flow and carves no side hole in it: Word runs the cell's text straight through
 * it. A top-and-bottom one is skipped only where the table's rows clear it instead (see
 * {@link CellAnchorScope.rowsClearOutOfCellFloats}); elsewhere pushing the cell's text down
 * is the nearer approximation of Word moving the whole table below it.
 */
export function anchoredOutOfCell(
  projection: DrawingProjection,
  options: {
    readonly anchorCellBox?: LayoutBox | null;
    readonly cellAnchorScope?: CellAnchorScope;
  }
): boolean {
  return (
    options.anchorCellBox != null &&
    !anchorLaidOutInCell(projection, options.cellAnchorScope ?? LEGACY_CELL_ANCHOR_SCOPE)
  );
}

/** The anchor frame a cell-flow paragraph breaks against, and the scope that reads it. */
export function cellAnchorFlow(
  width: number,
  available: number,
  scope: CellAnchorScope
): { readonly anchorCellBox: LayoutBox; readonly cellAnchorScope: CellAnchorScope } {
  return {
    anchorCellBox: Object.freeze({ x: 0, y: 0, width, height: Math.max(1, available) }),
    cellAnchorScope: scope,
  };
}

/**
 * Whether a vertical alignment in a table cell resolves to the top of its frame. The reference
 * rendering places an object centered or bottom-aligned on the page, margin or paragraph at the
 * top of that frame, as if top-aligned: the cell's height is not known when the object is
 * placed (ECMA-376 Part 1 §20.4.2.11 positionV, §20.4.3.2 ST_AlignV).
 */
export function alignsToCellFrameTop(
  frame: DrawingVerticalReferenceFrame,
  align: string | null
): boolean {
  if (align !== 'center' && align !== 'bottom') return false;
  return (
    frame === 'page' ||
    frame === 'margin' ||
    frame === 'paragraph' ||
    frame === 'topMargin' ||
    frame === 'bottomMargin'
  );
}
