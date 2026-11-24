import type { OoxmlElement } from '@docx-editor.dev/core/store';
import type { HeldCellBreak } from './cell-continuation-lines.ts';
import type { TableCellStyleFormatting } from './style-cascade.ts';

/** Placement context for a cell paragraph, including its structural end marker. */
export interface CellParagraphPlacementOptions {
  /** A real `w:tc`, not a header, footer, note or text-box story reusing cell flow. */
  readonly inTableCell?: boolean;
  readonly cellEndMark?: boolean;
  readonly hideEndMark?: boolean;
  /** Final-line admission also reserves the cell marker minimum, excluding bottom padding. */
  readonly cellEndMarkMinBottom?: number;
  readonly lineStart?: number;
  /** Unplaced model suffix; line indices alone do not survive a changed wrap band. */
  readonly startOffset?: number;
  /** The break the cursor carries from the page before; indexed instead of breaking again. */
  readonly heldBreak?: HeldCellBreak;
  readonly fragmentIndex?: number;
  readonly maxBottom?: number;
  /** Keep the visible part of a line inside a fixed, nonmerged cell band. */
  readonly clipOverflow?: boolean;
  /** False for fixed-height or rotated cells, whose bottom is a clip boundary. */
  readonly applyWidowControl?: boolean;
  /** Fail open when moving this paragraph would leave an identical fresh page. */
  readonly aloneOnPage?: boolean;
  /** When false, omit trailing paragraph spacing (more content follows on a later page). */
  readonly includeAfter?: boolean;
  /**
   * This paragraph opens its cell. Auto spacing contributes nothing across a cell boundary:
   * the reference puts its full auto gap BETWEEN two paragraphs inside a cell and nothing at
   * all across a row boundary. See `.cache/pdf/claude-autospacing/`.
   */
  readonly firstInCell?: boolean;
  /** This paragraph closes its cell; the mirror of {@link firstInCell}. */
  readonly lastInCell?: boolean;
  /** When false, omit the bottom border (paragraph continues). */
  readonly includeBottomBorder?: boolean;
  /**
   * The empty `w:p` a cell must end with when its content ends with a `w:tbl`: placed at
   * `top` so it stays addressable, but charged nothing — no spacing, no rules, no line
   * box. That is how the format's producers draw it.
   */
  readonly collapseHeight?: boolean;
  /** The collapsing paragraph is the cell's only content; its paragraph borders keep its line. */
  readonly collapseInEmptyCell?: boolean;
  /**
   * How much flowed content sits above the collapse point inside this cell.
   *
   * The caret for a collapsed terminator is drawn upward from the collapse point, sized off
   * the line's published `baseline`. That ascent comes from the paragraph MARK's own
   * `w:rPr` and has nothing to do with the rows above it, so a 36 pt mark over a 6 pt
   * nested row — or any terminator in a cell shorter than its own ascent — drew a caret
   * that started above the page. Only the caller knows the band, so it passes it and the
   * published baseline is clamped into it.
   */
  readonly collapseBandAbove?: number;
  /** What the table style says about this cell's paragraphs (17.7.6.6). */
  readonly tableCellStyle?: TableCellStyleFormatting;
  /**
   * The blocks either side of this one, for the `w:between` group rule (§17.3.1.24).
   *
   * Passed as NODES rather than resolved keys: a paragraph with no borders of its own is in
   * no group, so it never asks either neighbour anything, and that is nearly every
   * paragraph in a document. Reading them from the block list rather than tracking a
   * running key also keeps the answer right when a row splits across a page and the
   * neighbour was placed on the previous one.
   */
  readonly borderNeighbours?: {
    readonly previous: OoxmlElement | undefined;
    readonly next: OoxmlElement | undefined;
  };
}

/** Keep a partial line only when its top lies inside the fixed cell band. */
/**
 * Where a row's cells stop flowing, and the page bottom their objects must end above
 * (`cellAnchorPageFit`). An exact row clips its content to its authored box; the page bound
 * still applies to objects, so a clipped object in a fixed row never refuses its line.
 */
export function rowFlowBounds(
  maxBottom: number,
  rowTop: number,
  exactHeightPt: number | undefined
): { readonly flowMaxBottom: number; readonly pageBottom: number | undefined } {
  if (exactHeightPt === undefined) return { flowMaxBottom: maxBottom, pageBottom: maxBottom };
  return {
    flowMaxBottom: Math.min(maxBottom, rowTop + Math.max(0, exactHeightPt)),
    pageBottom: undefined,
  };
}

export function cellLineFits(
  requiredBottom: number,
  maxBottom: number,
  lineTop: number,
  collapseHeight: boolean,
  options?: CellParagraphPlacementOptions
): boolean {
  if (requiredBottom > maxBottom + 0.001) {
    return options?.clipOverflow === true && !collapseHeight && lineTop < maxBottom - 0.001;
  }
  return true;
}

/**
 * Page and merged-cell admission happen before fixed horizontal cell clipping. A cell that
 * heads a vertical merge never clips to its own row, whether or not its span was admitted.
 */
export function clipsExactCellRow(
  vertical: boolean,
  exactHeightPt: number | undefined,
  isDetached: boolean,
  headsVerticalMerge: boolean,
  rowTop: number,
  maxBottom: number
): boolean {
  return (
    !vertical &&
    exactHeightPt !== undefined &&
    !isDetached &&
    !headsVerticalMerge &&
    rowTop + exactHeightPt <= maxBottom + 0.001
  );
}
