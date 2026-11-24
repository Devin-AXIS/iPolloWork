import type { TableFlowDeps } from './semantic-table-layout.ts';
import type { TableAnchorFrames } from './semantic-table.ts';
import type { TableVerticalAnchorFrames } from './table-float-position.ts';
import type { StyleCascadeTable } from './style-cascade.ts';
import type { RevisionAuthorFilter, RevisionDisplayMode } from './revision-projection.ts';
import type { BlockFragmentRecord } from './semantic-records.ts';

/** The body flow a table is placed into: the cursor it moves, and what it publishes to. */
export interface TableFlowCursor {
  /** The caller admitted a text-anchored table as one object on its anchor sheet. */
  readonly positionTextTable?: boolean;
  /** How far such a table moved right to clear an earlier floating table (`table-float-overlap.ts`). */
  readonly positionShiftX?: number;
  /** The top a table that stacks below another one starts at (`table-float-stack.ts`). */
  readonly stackTop?: number;
  /** Points down the page content box. The paginator both reads and advances it. */
  cursorY: number;
  /** Column being filled in a multi-column section; absent with a single column. */
  readonly flowColumn?: () => number | undefined;
  /** Width of the column being filled. */
  readonly columnWidth: () => number;
  /** Left edge of the column being filled, in page-content coordinates. */
  readonly columnLeft: () => number;
  /** Height available on the page being filled — note reserves already subtracted. */
  readonly contentHeight: () => number;
  /**
   * The same band with any footnote reserve IGNORED. Recovery seam for keep-together rows:
   * a `w:cantSplit` / `hRule=exact` row that exceeds the reserved band on a fresh page takes
   * the full band instead of aborting the layout. The reserve is advisory at this point —
   * the notes pass sizes its area from the body actually placed — so the overlap only
   * pushes that page's footnotes forward. Absent means the two bands are the same.
   */
  readonly unreservedContentHeight?: () => number;
  /** Move to the next column, or the next page when this was the last one. */
  readonly advanceColumn: () => void;
  /** End the page being filled, skipping any columns left on it. */
  readonly advancePage: () => void;
  /** Whether the page being filled holds content above `top`, including earlier columns. */
  readonly pageHoldsContent: (top: number) => boolean;
  /** Top of the column region a column advance opens at. Absent means 0. */
  readonly columnTop?: () => number;
  /** Whether the column being filled holds content above `top`. */
  readonly regionHoldsContent: (top: number) => boolean;
  /** Frames a `w:tblpPr` table positions against. */
  readonly anchorFrames: () => TableAnchorFrames;
  /** Vertical frames a `w:tblpPr` table positions against. */
  readonly verticalAnchorFrames: () => TableVerticalAnchorFrames;
  readonly styleCascade: StyleCascadeTable | undefined;
  readonly displayMode: RevisionDisplayMode;
  readonly revisionAuthorFilter?: RevisionAuthorFilter;
  readonly compatibilityMode?: number;
  readonly deps: TableFlowDeps;
  /**
   * Moves an anchored drawing already published by a placed row, when finalize shifts the
   * paragraph it belongs to. A callback for the same reason `publishFragment` is one: the
   * list it edits is replaced whenever a page completes.
   */
  readonly shiftAnchor: (paragraphId: string, dy: number) => void;
  /**
   * Publishes a finished table fragment onto the page being filled.
   *
   * A sink rather than the array itself: completing a page REPLACES the story loop's
   * fragment list, so a reference taken when the table started would collect the rest of
   * its fragments into an array nobody reads. `wrapsFollowingText` marks the last fragment of a
   * text-anchored table that broke across pages: the text after the table wraps around it.
   */
  readonly publishFragment: (fragment: BlockFragmentRecord, wrapsFollowingText?: boolean) => void;
  /**
   * Opening height of the body content after the table, which a kept last row needs beside
   * it with `room` left (`followingKeepOpening` in `pagination-keeps.ts`). `undefined` when
   * nothing follows; null when it cannot be priced.
   */
  readonly followingKeepOpening?: (room: number) => number | null | undefined;
}

export interface TableFlowPlacementResult {
  /** True when the table paints on the anchor sheet without advancing the body cursor. */
  readonly outOfFlow: boolean;
}
