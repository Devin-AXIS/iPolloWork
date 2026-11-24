import { takePreviousRows } from './table-row-placement-reuse.ts';
import { createRowProbeReuse } from './table-row-probe-reuse.ts';
import { clippedExactRow, overheightRowError } from './table-exact-row-clip.ts';
// Placing ONE top-level table into the body flow, row by row, across page breaks.
// A table advances the same cursor a paragraph does, but decides per ROW whether to place,
// move, split or fail, and re-emits repeated header rows on every page it runs onto.
//
// The flow arrives as {@link TableFlowCursor}: the cursor, the geometry getters (where the
// column is, how much page is left) and the sinks a placed row publishes into. The story
// loop keeps ownership of the cursor and this module keeps the row rules.

import { positionedTableOriginX } from './table-origin.ts';
import * as terminal from './table-exact-terminal-border.ts';
import type { OoxmlElement } from '@docx-editor.dev/core/store';
import {
  initialCellCursors,
  layoutRowFragment,
  layoutRowFragmentBounded,
  MAX_TABLE_ROW_FRAGMENTS,
  TablePaginationError,
  type CellPlaceCursor,
  type TableFlowDeps,
} from './semantic-table-layout.ts';
import { closingReservePt, placeClosingCellSpacing } from './table-cell-spacing.ts';
import { vMergePlanFor } from './table-vmerge-plan.ts';
import {
  closingEdgePt,
  terminalBorderPlanAt,
  type TerminalRowAt,
} from './table-terminal-border-plan.ts';
import { fragmentRowContentDeps } from './table-fragment-content-insets.ts';
import { probeBodyRowStart, probeRowFragmentProgress } from './table-row-progress-probe.ts';
import { bottomToTopTextKeepsRowWhole } from './table-cell-text-direction.ts';
import {
  headerGroupMoves,
  keptRowGroupMoves,
  onlyRepeatedHeaderRows,
  rowStartsPage,
  tableKeptRowSource,
} from './table-row-keeps.ts';
import { rowMinimumFits, rowMinimumMoves, cutPart } from './table-row-minimum-fit.ts';
import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';
import {
  prepareRepeatedHeaderBorderPlan,
  type RepeatedHeaderBorderPlan,
} from './repeated-header-border-metrics.ts';
import { cellContentInsets, type CellContentInsets } from './table-cell-geometry.ts';
import { admitVMergeSpansAt, type RowVMergeLayoutOptions } from './table-vmerge-heights.ts';
import type { HeaderGroupPlan } from './table-header-vmerge.ts';
import { createFlowHeaderReuse } from './table-header-flow-reuse.ts';
import { headerGroupStart } from './table-header-group-start.ts';
import { createMergedTextCarry, deferMergedTextPastHeadRow } from './table-vmerge-boundary.ts';
import {
  createVMergeFragmentCarry,
  type VMergeFragmentCarry,
} from './table-vmerge-fragment-carry.ts';
import { tableOriginX, type SemanticTableRow } from './semantic-table.ts';
import { readFlowTable } from './table-flow-structure.ts';
import * as textTable from './table-text-float-break.ts';
import { tableFloatOriginY } from './table-float-position.ts';
import { splitHead } from './table-fragment-finalize.ts';
import { closeTableFragmentRows } from './table-fragment-close.ts';
import { planOutOfCellFloats } from './table-out-of-cell-floats.ts';
import { tableFloatClearance } from './table-float-collision.ts';
import type { TableRowFragmentRecord } from './semantic-records.ts';
import { TABLE_ROWS_PER_STEP, type LayoutSteps } from './layout-steps.ts';

import type { TableFlowCursor, TableFlowPlacementResult } from './table-flow-cursor.ts';
export type { TableFlowCursor, TableFlowPlacementResult } from './table-flow-cursor.ts';
import { cachedRowHeights, POSITIONED_TABLE_LAYOUT_BOTTOM_PT } from './table-flow-row-state.ts';

/**
 * Lay out one top-level table with OOXML-aligned row pagination.
 *
 * Preflights the real unsplit row height (not a one-line estimate). Splittable rows use
 * the current remainder, even when they could fit whole on a fresh page. Atomic rows
 * move whole; a `w:cantSplit` row taller than a page moves to a fresh page and splits there,
 * except in a text-anchored table (`table-text-float-break.ts`).
 * Exact rows taller than a page and unsafe nested cuts fail closed via
 * {@link TablePaginationError} instead of overflowing contentHeight().
 * Contiguous leading `w:tblHeader` rows form one atomic repeated group: preflighted and
 * placed together, moved whole when the remainder is too short, re-emitted complete atop
 * each continuation page where the pending row can advance, and treated as ordinary rows
 * when the authored group itself exceeds a fresh content page. Pauses between rows (steps).
 */
export function* paginateTableInFlowSteps(
  table: OoxmlElement,
  flow: TableFlowCursor
): LayoutSteps<TableFlowPlacementResult> {
  const {
    columnWidth,
    columnLeft,
    contentHeight: flowContentHeight,
    advanceColumn,
    anchorFrames,
    verticalAnchorFrames,
    styleCascade,
    deps: flowDeps,
    shiftAnchor,
    publishFragment,
  } = flow;
  const read = readFlowTable(table, flow);
  if (!read) return { outOfFlow: false };
  const { structure, pinnedBreak, outOfFlow, textFlow, cellDeps } = read;
  if (pinnedBreak) flow.cursorY = pinnedBreak.top;
  // Only a table without `w:tblpPr` honors `w:pageBreakBefore` rows (`table-row-page-break.ts`).
  const breaksPages = structure.float === undefined;
  if (
    breaksPages &&
    rowStartsPage(structure, 0, styleCascade, flow.compatibilityMode) &&
    flow.pageHoldsContent(flow.cursorY)
  ) {
    flow.advancePage();
  }
  const bodyCursorY = flow.cursorY;
  const verticalFrames = outOfFlow ? verticalAnchorFrames() : undefined;
  // A breaking positioned table's first fragment is bounded by `firstBottom` (`table-pinned-break.ts`).
  let firstFragmentBottom = pinnedBreak?.firstBottom;
  const pageBottom = outOfFlow
    ? (): number => POSITIONED_TABLE_LAYOUT_BOTTOM_PT
    : (): number => firstFragmentBottom ?? flowContentHeight();
  // A spaced table's row keeps room below it for the gap and frame its fragment closes with.
  let closingReserve = 0;
  const contentHeight = (): number => pageBottom() - closingReserve;
  // `w:tblInd` / `w:jc` place the table in the text column, `w:tblpPr` in a wider anchor box;
  // rows and the fragment box share one origin, so cell geometry and the box cannot drift.
  const originX = (): number =>
    structure.float
      ? positionedTableOriginX(structure, anchorFrames(), flow.compatibilityMode) +
        (outOfFlow ? (flow.positionShiftX ?? 0) : 0)
      : columnLeft() + tableOriginX(structure, columnWidth());
  let tableLeft = originX();
  // A text anchor offsets the current body position. Page and margin anchors are sheet
  // positions, so the table uses a private cursor and the body cursor is restored below.
  if (textFlow) tableLeft = textTable.openTextTable(table, structure, flow, tableLeft, originX);
  else if (outOfFlow && structure.float && verticalFrames) {
    // Alignment needs the final table height. Start at the frame origin, then shift the
    // complete fragment in closeTableFragment once that height is known.
    flow.cursorY = flow.stackTop ?? tableFloatOriginY(structure.float, 0, verticalFrames);
  }
  const rowProbes = createRowProbeReuse(
    structure.columnWidthsPt,
    structure.cellSpacingPt,
    takePreviousRows(table, flowDeps)
  );
  /** One row's natural height at the current table origin, without the terminal rule. */
  const rowHeightOf = (row: SemanticTableRow, top = flow.cursorY, deps = tableDeps): number =>
    rowProbes.measure(row, tableLeft, top, deps) - terminal.exactTerminalBorderPt(row, deps);
  // Out-of-cell floats (`layoutInCell="0"` before mode 15) keep the place the unpushed table
  // gives them and push the rows that touch them; see `table-out-of-cell-floats.ts`. Only
  // an in-flow table's first fragment is pushed: after a break the rows are on another sheet.
  const floats =
    outOfFlow || structure.float
      ? null
      : planOutOfCellFloats(structure, table.id, tableLeft, flow.cursorY, cellDeps);
  const tableDeps = terminal.tableTerminalDeps(structure, floats?.deps ?? cellDeps);
  const headerRows: SemanticTableRow[] = [];
  for (const row of structure.rows) {
    if (row.isHeader) headerRows.push(row);
    else break;
  }
  closingReserve = closingReservePt(structure.cellSpacingPt, headerRows.at(-1), pageBottom());
  // A merge inside the header rows is planned where the group is about to be placed, and the
  // same plan places it (`table-header-vmerge.ts`); a repeat at a kept top reuses both.
  const headers = createFlowHeaderReuse({
    structure,
    headerRows,
    deps: tableDeps,
    left: () => tableLeft,
    rowHeightOf,
    rowProbes,
    admitted: !outOfFlow && !structure.float && !pinnedBreak,
  });
  const headerPlanAt = (top: number): HeaderGroupPlan => headers.plan(top);
  // A header prefix taller than a true fresh page lays out as ordinary rows; a note reservation
  // only shrinks an advisory band and must never split an otherwise valid prefix.
  const initialHeaderPlan = headerPlanAt(flow.cursorY);
  const headerGroupHeight = initialHeaderPlan.heightPt;
  const headerMerged = initialHeaderPlan.planned;
  let initialHeaderGroupDegraded =
    headerGroupHeight > (flow.unreservedContentHeight?.() ?? contentHeight()) + 0.001;
  let repeatsEnabled = !initialHeaderGroupDegraded;
  let fragmentIndex = 0;
  let fragmentTop = flow.cursorY;
  // Where a fragment opened below a band in a column it opens: that column's top for its rows.
  let bandTop = 0;
  let rows: TableRowFragmentRecord[] = [];
  const rowOrdinals = new Map<string, number>();
  // Authored rows backing the open fragment (includes header repeats) for finalize.
  let sourceRows: (typeof structure.rows)[number][] = [];
  let occurrenceInsets = new Map<TableRowFragmentRecord, ReadonlyMap<string, CellContentInsets>>();
  // Merged text a head row left to its next row (`table-vmerge-boundary.ts`).
  const carry = createMergedTextCarry();
  const fragmentCarry: { current?: VMergeFragmentCarry } = {};
  const completeSourceRows = new Set(structure.rows);
  let forceNextFragment = false;
  // Rows clear a wrapping float that crosses the table; see `table-float-collision.ts`.
  const clearance =
    outOfFlow || structure.float
      ? null
      : tableFloatClearance(structure, table.id, tableDeps, {
          flow,
          left: () => tableLeft,
          place: (left) => (tableLeft = left),
          bottom: contentHeight,
          opensRegion: () =>
            rows.every((placed) => placed.isHeaderRepeat) && !flow.regionHoldsContent(fragmentTop),
          moved: (top, opensRegion) => {
            if (rows.length > 0) return;
            fragmentTop = top;
            bandTop = opensRegion ? top : 0;
          },
          heightOf: (row, top) => rowHeightOf(row, top),
        });
  // The authored header rows open the first fragment, with the body rows after them.
  const clearAuthoredHeader = (): void => {
    const groupAt = (top: number) =>
      headerMerged ? headerPlanAt(top).heightPt : headerGroupHeight;
    const fits = (top: number) => top + groupAt(top) <= contentHeight() + 0.001;
    clearance?.clear(clearance.fragment(headerRows.length, fits, groupAt));
  };
  const laterLayout = hasCompatibilityRule(flow.compatibilityMode, 'headerRowsKeepWithBody');
  const repeatKeepsWholeRow = hasCompatibilityRule(flow.compatibilityMode, 'repeatKeepsWholeRow');
  const tallRowStaysWhole = hasCompatibilityRule(flow.compatibilityMode, 'tallRowStaysWhole');
  // The open continuation fragment left out its repeated header rows.
  let repeatOmitted = false;
  let repeatedPlan: RepeatedHeaderBorderPlan | undefined;
  let prepareRepeat: (() => RepeatedHeaderBorderPlan | null | undefined) | undefined;
  const rememberInsets = (record: TableRowFragmentRecord, deps: TableFlowDeps): void => {
    if (deps.cellContentInsets) occurrenceInsets.set(record, deps.cellContentInsets);
  };
  let wrapsBeside = false;
  const closeTableFragment = (): void => {
    const frameBottom = pageBottom();
    bandTop = 0;
    firstFragmentBottom = undefined;
    // Every close is a break or the table's end: rows past it are on another sheet. The end
    // waits for this fragment's finalize, which republishes its floats through the pin.
    if (rows.length === 0) {
      floats?.end();
      return;
    }
    const closed = closeTableFragmentRows({
      structure,
      tableId: table.id,
      fragmentIndex,
      rows,
      sourceRows,
      completeSourceRows,
      occurrenceInsets,
      left: tableLeft,
      top: fragmentTop,
      bottom: contentHeight(),
      frameBottom,
      deps: tableDeps,
      carry,
      fragmentCarry: fragmentCarry.current,
      rowOrdinals,
      shiftAnchor,
      outOfFlow,
      verticalFrames,
      stackTop: flow.stackTop,
    });
    flow.cursorY += closed.cursorDelta;
    publishFragment(closed.fragment, wrapsBeside);
    floats?.end();
    fragmentIndex += 1;
    rows = [];
    sourceRows = [];
    occurrenceInsets = new Map();
    repeatedPlan = undefined;
  };

  /**
   * Place the contiguous leading header rows as one group. Never splits the group across
   * pages; a continuation omits the repeat when it would leave its pending body row stuck.
   */
  const placeHeaderGroup = (
    asRepeat: boolean,
    admitsBodyAfter?: (bodyTop: number) => boolean
  ): void => {
    if (headerRows.length === 0) return;
    const candidate = asRepeat ? prepareRepeat?.() : undefined;
    if (candidate === null) return;
    const planAt = (): HeaderGroupPlan | undefined =>
      headerMerged && !candidate ? headerPlanAt(flow.cursorY) : undefined;
    let plan = planAt();
    let groupHeight = candidate?.headerHeight ?? plan?.heightPt ?? headerGroupHeight;
    // `breakForContinuation` already advanced to the target region before asking for a repeat.
    // If that region cannot carry the group, keep it for the pending body row instead of skipping
    // a usable nonzero-origin continuous-section column.
    if (asRepeat && flow.cursorY + groupHeight > contentHeight() + 0.001) return;
    if (flow.cursorY + groupHeight > contentHeight() + 0.001 && flow.cursorY > 0) {
      closeTableFragment();
      advanceColumn();
      tableLeft = originX();
      // The cursor, not 0: a same-sheet column advance opens at the column REGION top
      // (a continuous section shares its sheet), and a fragment box anchored at 0 would
      // stretch over whatever the earlier section already painted above the region.
      fragmentTop = flow.cursorY;
      clearAuthoredHeader();
      plan = planAt();
      groupHeight = plan?.heightPt ?? groupHeight;
    }

    // A footnote reserve is advisory when it is the only obstruction to the atomic authored
    // prefix. Use the full physical content band; the notes pass will carry displaced notes on.
    const placementBottom =
      !asRepeat && flow.cursorY + groupHeight > contentHeight() + 0.001
        ? (flow.unreservedContentHeight?.() ?? contentHeight())
        : contentHeight();
    if (!asRepeat && flow.cursorY + groupHeight > placementBottom + 0.001) {
      initialHeaderGroupDegraded = true;
      repeatsEnabled = false;
      return;
    }

    // A repeated header is furniture for the pending body row, not a reason to reject that row.
    // Probe at the exact post-header position before committing any repeated lines or drawings.
    // If the row cannot advance there, Word suppresses the repeat on this continuation page.
    if (asRepeat && !candidate && admitsBodyAfter && !admitsBodyAfter(flow.cursorY + groupHeight))
      return;

    const headerDeps = candidate
      ? fragmentRowContentDeps(structure, headerRows[0]!, candidate.deps, [], false)
      : headers.headerDeps();

    for (const [index, headerRow] of headerRows.entries()) {
      const options = plan?.optionsAt(index, flow.cursorY);
      const placed = headers.place(
        asRepeat,
        !!candidate,
        index,
        headerRow,
        flow.cursorY,
        headerDeps,
        options
      );
      if (placed.bottom > placementBottom + 0.001) {
        throw new TablePaginationError(
          'table-row-overheight',
          `Table header row ${headerRow.id} overflowed the page content box`
        );
      }
      rows.push(placed.record);
      rememberInsets(placed.record, headerDeps);
      sourceRows.push(headerRow);
      flow.cursorY = placed.bottom;
    }
    repeatedPlan = candidate;
  };

  /** Start the next fragment; `repeat` false leaves out the header repeat on that page. */
  const breakForContinuation = (
    admitsBodyAfter?: (bodyTop: number) => boolean,
    newPage = false,
    repeat = repeatsEnabled
  ): void => {
    closeTableFragment();
    if (newPage) flow.advancePage();
    else advanceColumn();
    tableLeft = originX();
    // See placeHeaderGroup: the new fragment opens at the advanced cursor, which is the
    // column region top on a shared sheet and 0 only when a fresh page was opened.
    fragmentTop = flow.cursorY;
    clearance?.clearPending(repeat && headerRows.length > 0 ? headerGroupHeight : 0);
    if (repeat) placeHeaderGroup(true, admitsBodyAfter);
    // A fragment opens with only its repeat, so no rows here means the repeat was left out.
    repeatOmitted = repeatsEnabled && headerRows.length > 0 && rows.length === 0;
  };

  /** Whole band of a fresh page: a note reserve yields to a kept row. */
  const pageBand = () => Math.max(contentHeight(), flow.unreservedContentHeight?.() ?? 0);
  /** Kept-row pricing over `candidates` (`table-row-keeps.ts`); `first` overrides one row's height. */
  const keptSource = (
    candidates: readonly SemanticTableRow[],
    first?: [number, number],
    pageHeight = pageBand()
  ) =>
    tableKeptRowSource({
      structure,
      rows: candidates,
      left: tableLeft,
      deps: tableDeps,
      pageHeight,
      fullPageHeight: pageBand(),
      heightOf: cachedRowHeights(candidates, terminal.withRule(rowHeightOf, tableDeps), first),
      following: (room) => flow.followingKeepOpening?.(room),
    });
  const start = headerGroupStart({
    laterLayout,
    breaksPages,
    group: headerRows.length === 0 ? 'none' : initialHeaderGroupDegraded ? 'tall' : 'fits',
    followsContent: flow.regionHoldsContent(fragmentTop),
    top: flow.cursorY,
    room: contentHeight() - flow.cursorY - headerGroupHeight,
  });
  initialHeaderGroupDegraded ||= start === 'ordinary' || start === 'whole-rows';
  repeatsEnabled = !initialHeaderGroupDegraded;
  if (!initialHeaderGroupDegraded && headerRows.length > 0) clearAuthoredHeader();
  const fresh = contentHeight() - headerGroupHeight;
  const room = contentHeight() - flow.cursorY - headerGroupHeight;
  const body = () => keptSource(structure.rows.slice(headerRows.length), undefined, fresh);
  if (
    start === 'ordinary-next-page' ||
    (start === 'kept' && headerGroupMoves(body(), room, fresh))
  ) {
    closeTableFragment();
    advanceColumn();
    tableLeft = originX();
    fragmentTop = flow.cursorY;
  }

  // Initial authored header group (not repeats) — atomic with body-row pagination below.
  if (!initialHeaderGroupDegraded) {
    if (floats) {
      flow.cursorY = floats.clear(
        flow.cursorY,
        (top) => (headerMerged ? headerPlanAt(top).heightPt : headerGroupHeight),
        headerRows,
        contentHeight()
      );
      fragmentTop = flow.cursorY;
    }
    if (headerRows.length > 0) clearAuthoredHeader();
    placeHeaderGroup(false);
  }

  // Plan body merges across their covered rows instead of growing only the head row.
  const bodyRows = structure.rows.slice(initialHeaderGroupDegraded ? 0 : headerRows.length);
  const firstBodyRowIndex = initialHeaderGroupDegraded ? headerRows.length : 0;
  fragmentCarry.current = createVMergeFragmentCarry(
    structure,
    bodyRows,
    tableDeps,
    () => tableLeft
  );
  // Read the current table origin after header placement and column transitions.
  const fragmentFirstRows = new Set<string>();
  const vMergePlan = vMergePlanFor(
    structure,
    () => tableLeft,
    0,
    tableDeps,
    bodyRows,
    (row) => fragmentFirstRows.has(row.id)
  );
  let vMerge: RowVMergeLayoutOptions | undefined;
  let naturalHeight = 0;
  let baselineBodyHeight = 0;
  const admitSpans = (bodyRowIndex: number, probeRow?: SemanticTableRow): void => {
    const row = probeRow ?? bodyRows[bodyRowIndex]!;
    if (rows.length === 0) fragmentFirstRows.add(row.id);
    else fragmentFirstRows.delete(row.id);
    vMerge =
      fragmentCarry.current?.optionsAt(bodyRowIndex, flow.cursorY, contentHeight()) ??
      admitVMergeSpansAt(vMergePlan, bodyRowIndex, flow.cursorY, contentHeight());
    // Keep ordinary admission separate from the repeated border override, and
    // remeasure at the current Y after moving through wrapping exclusions.
    baselineBodyHeight =
      vMerge?.heightFloorPt ??
      rowHeightOf(
        row,
        flow.cursorY,
        fragmentRowContentDeps(structure, row, tableDeps, rows, false)
      );
    naturalHeight =
      vMerge?.heightFloorPt ??
      (repeatedPlan?.bodyRowId === bodyRows[bodyRowIndex]?.id
        ? repeatedPlan.bodyHeight
        : baselineBodyHeight);
  };

  for (const [bodyRowIndex, authoredRow] of bodyRows.entries()) {
    if (bodyRowIndex > 0 && bodyRowIndex % TABLE_ROWS_PER_STEP === 0) yield;
    closingReserve = closingReservePt(structure.cellSpacingPt, authoredRow, pageBottom());
    const row = fragmentCarry.current.rowAt(
      bodyRowIndex,
      carry.rowAt(bodyRowIndex, authoredRow),
      flow.cursorY,
      contentHeight()
    );
    if (initialHeaderGroupDegraded && bodyRowIndex >= headerRows.length) repeatsEnabled = true;
    const cantSplit = row.cantSplit || (start === 'whole-rows' && bodyRowIndex < headerRows.length);
    const forceBreak = forceNextFragment;
    forceNextFragment = false;
    if (floats) {
      const firstDeps =
        rows.length === 0
          ? fragmentRowContentDeps(structure, row, tableDeps, rows, false)
          : undefined;
      const heightAt = (y: number) => rowHeightOf(row, y, firstDeps);
      flow.cursorY = floats.clear(flow.cursorY, heightAt, [row], contentHeight());
      // A table pushed before its first row starts where that row now does.
      if (rows.length === 0) fragmentTop = flow.cursorY;
    }
    admitSpans(bodyRowIndex, row);
    let terminalDeps: TableFlowDeps | undefined;
    let cursors: CellPlaceCursor[] = initialCellCursors(row);
    let isContinuation = false;
    let fragmentsForRow = 0;
    let movedToFreshPage = false;
    const rowDeps = (): TableFlowDeps => ({
      ...(terminalDeps ??
        (repeatedPlan?.bodyRowId === row.id
          ? repeatedPlan.deps
          : fragmentRowContentDeps(structure, row, tableDeps, rows, isContinuation))),
      rowAtPageStart:
        movedToFreshPage ||
        flow.cursorY <= 0.001 ||
        (rows.length > 0 && rows.every((placed) => placed.isHeaderRepeat)),
    });
    // A plan refuses a body row that does not fit below the repeat. A row that overflows
    // there instead takes the ordinary repeat path.
    prepareRepeat = () => {
      if (isContinuation) return undefined;
      const plan = prepareRepeatedHeaderBorderPlan(
        structure,
        headerRows,
        row,
        tableLeft,
        flow.cursorY,
        contentHeight(),
        headerGroupHeight,
        baselineBodyHeight,
        tableDeps
      );
      const below = flow.cursorY + headerGroupHeight;
      return plan === null && (overflowsBelowRepeat() || startMissesBelowRepeat(below))
        ? undefined
        : plan;
    };

    // `w:cantSplit` keeps a row whole only when a page can hold it. The full band counts,
    // because a note reserve yields to a kept row. A wrapping float still reduces that band.
    // A taller row starts on a fresh page and then splits like an ordinary row.
    const pageHoldsRow = (): boolean => naturalHeight <= pageBand() - bandTop + 0.001;
    // `btLr` text takes its line length from the whole row, so such a row also moves whole to
    // a page that can hold it when its authored minimum does not fit the room below `top`
    // (`bottomToTopTextKeepsRowWhole`).
    const keepsWholeAt = (top: number): boolean =>
      cantSplit ||
      bottomToTopTextKeepsRowWhole(
        row,
        contentHeight() - top,
        (cell) =>
          tableDeps.cellContentInsets?.get(cell.id) ??
          cellContentInsets(cell, structure.cellSpacingPt === 0),
        tableDeps.cellMinimumContentInsets
      );
    // Before mode 15, repeated header rows stay above a row that cannot split, fits a fresh
    // page, and does not fit below them. The row then stays whole there and runs past the margin.
    const overflowsBelowRepeat = (top = flow.cursorY): boolean =>
      repeatKeepsWholeRow && pageHoldsRow() && (row.height.rule === 'exact' || keepsWholeAt(top));
    const progressesAt = (top: number): boolean =>
      probeBodyRowStart(
        structure,
        row,
        tableLeft,
        top,
        contentHeight(),
        isContinuation,
        tableDeps,
        cursors
      );
    // Before mode 15, repeated header rows also stay above a row that can split when the first
    // line of a cell, or the first row of a nested table that opens one, does not fit below them.
    // The row then stays whole there, past the margin or the page edge. A continued row keeps
    // the repeat the same way when its next line or nested row does not fit, and its rest
    // stays on that page. Cells ignore widow control in these modes (`tableParagraphWidowControl`).
    const startMissesBelowRepeat = (top: number): boolean =>
      repeatKeepsWholeRow &&
      naturalHeight > contentHeight() - top + 0.001 &&
      vMerge === undefined &&
      row.height.rule !== 'exact' &&
      !keepsWholeAt(top) &&
      !progressesAt(top);

    // A row an accepted span covers below its head, a nested head row included, does not
    // take the whole-row MOVE: alone among the breaks below, that one is an optimization
    // rather than a recovery, and it ends the fragment above merged content already flowed
    // against this page. See the break-site table in `table-vmerge-heights.ts` for why the
    // others stay open to a covered row.
    const heldByOpenSpan = vMerge?.coveredFromAbove === true;

    /**
     * Repeating headers is admissible only when this exact row state can progress below them.
     * Explicitly atomic rows must fit whole; auto/atLeast and continued rows use the same bounded
     * placer as the commit path, but behind a side-effect-free probe. The callback receives the
     * real post-header top after any column advance.
     */
    const admitsRepeatedHeaders = (bodyTop: number, clearingFloat = false): boolean => {
      const pageBottom = contentHeight();
      const remaining = pageBottom - bodyTop;
      if (remaining <= 0.001) return false;
      // Clearance first offers the row the float-free band. Only the optional repeat
      // must leave the authored minimum intact within that fresh band.
      if (!isContinuation && !clearingFloat && laterLayout) {
        const fresh = Math.max(pageBottom, flow.unreservedContentHeight?.() ?? 0) - bandTop;
        if (!rowMinimumFits(row, rowDeps(), structure.cellSpacingPt, fresh, remaining))
          return false;
      }
      // The unsplit commit path consumes a complete row regardless of `fitted`: an empty row's
      // authored box is structural progress even though it places no text. Mirror that path before
      // asking the bounded probe, whose `fitted` flag deliberately means content progress.
      if (!isContinuation && naturalHeight <= remaining + 0.001) return true;
      if (
        !isContinuation &&
        (row.height.rule === 'exact' || (!clearingFloat && keepsWholeAt(bodyTop) && pageHoldsRow()))
      ) {
        // Before mode 15 the repeat stays, and the row runs past the margin below it.
        return !clearingFloat && overflowsBelowRepeat(bodyTop);
      }
      // The header is optional: the probe asks whether the paragraph can honor its widow rule
      // below it. If not, omit the repeat and offer the full page.
      return progressesAt(bodyTop) || (!clearingFloat && startMissesBelowRepeat(bodyTop));
    };

    if (clearance) {
      const from = structure.rows.length - bodyRows.length + bodyRowIndex;
      const continued = () => isContinuation;
      clearance.pending = clearance.fragment(
        from,
        (top) => admitsRepeatedHeaders(top, true),
        undefined,
        continued
      );
      // Only a fragment without rows opens below a band: an open fragment never gets a gap.
      if (rows.length === 0 && clearance.clear(clearance.pending)) admitSpans(bodyRowIndex, row);
    }

    const terminalAt = (): TerminalRowAt => ({
      structure,
      row,
      left: tableLeft,
      top: flow.cursorY,
      bottom: contentHeight(),
      deps: rowDeps(),
    });
    // The room a row that ends the page needs below it for its own closing border.
    let closingEdge = 0;
    const tryTerminalFit = (): void => {
      if (terminalDeps || isContinuation || heldByOpenSpan) return;
      if (naturalHeight <= contentHeight() - flow.cursorY + 0.001) {
        const next = bodyRows[bodyRowIndex + 1];
        closingEdge = closingEdgePt(terminalAt(), naturalHeight, next, tableDeps, rowHeightOf);
        return;
      }
      const plan = terminalBorderPlanAt(terminalAt());
      if (!plan) return;
      terminalDeps = plan.deps;
      naturalHeight = plan.height;
      // This row fits only without its next neighbor. The next row must start a new
      // fragment even if its own standalone measurement would fit the leftover space.
      forceNextFragment = true;
    };
    // A kept predecessor can suppress the authored row break (`rowStartsPage`).
    const startsPage =
      breaksPages &&
      row !== structure.rows[0] &&
      rowStartsPage(
        structure,
        structure.rows.length - bodyRows.length + bodyRowIndex,
        styleCascade,
        flow.compatibilityMode
      ) &&
      (rows.some((placed) => !placed.isHeaderRepeat) || flow.pageHoldsContent(fragmentTop));
    // Only authored legacy headers stay behind; repeated headers already placed the group.
    const keptMoves =
      breaksPages &&
      !forceBreak &&
      !startsPage &&
      !heldByOpenSpan &&
      flow.cursorY > 0.001 &&
      (rows.length === 0 ||
        rows.some((placed) => !placed.isHeaderRow) ||
        (!laterLayout && !rows.some((placed) => placed.isHeaderRepeat)))
        ? keptRowGroupMoves(
            keptSource(bodyRows, [bodyRowIndex, naturalHeight]),
            bodyRowIndex,
            contentHeight() - flow.cursorY,
            pageBand() - (flow.columnTop?.() ?? 0) - (repeatsEnabled ? headerGroupHeight : 0),
            flow.compatibilityMode,
            rows.length > 0 && rows.every((placed) => placed.isHeaderRow)
          )
        : false;
    const deferred =
      forceBreak || startsPage || keptMoves || vMerge !== undefined || row !== authoredRow
        ? null
        : deferMergedTextPastHeadRow({
            plan: vMergePlan,
            rows: bodyRows,
            rowIndex: bodyRowIndex,
            structure,
            left: tableLeft,
            top: flow.cursorY,
            contentBottom: contentHeight(),
            deps: rowDeps(),
            nextDeps: tableDeps,
            compatibilityMode: flow.compatibilityMode,
            positioned: (tableDeps.pageExclusionZones?.().length ?? 0) > 0,
          });
    if (deferred) {
      vMerge = deferred.options;
      naturalHeight = deferred.heightPt;
    }
    if (!forceBreak && !startsPage && !keptMoves) tryTerminalFit();

    // Ordinary rows may break between lines, but their first fragment must have room
    // to start every cell. Otherwise a short label can be orphaned on the previous
    // page while its taller neighboring cell has not started. Probe before publishing.
    // A breaking positioned table moves such a row too, minimum height included. A text-anchored
    // table's opening already holds its first authored body row (`table-text-float-break.ts`).
    if (
      startsPage ||
      forceBreak ||
      keptMoves ||
      ((breaksPages ||
        pinnedBreak !== undefined ||
        (textFlow && bodyRowIndex !== firstBodyRowIndex)) &&
        !heldByOpenSpan &&
        rowMinimumMoves(row, rowDeps(), structure, naturalHeight + closingEdge, !pinnedBreak, {
          top: flow.cursorY,
          columnTop: flow.columnTop?.() ?? 0,
          bottom: contentHeight(),
          band: pageBand(),
          repeat: repeatsEnabled && !laterLayout ? headerGroupHeight : 0,
          belowBandOnly:
            bandTop > 0 &&
            fragmentTop <= bandTop + 0.001 &&
            rows.every((placed) => placed.isHeaderRepeat),
        })) ||
      (!heldByOpenSpan &&
        naturalHeight <= contentHeight() + 0.001 &&
        flow.cursorY + naturalHeight + closingEdge + terminal.ruleRoomPt(row, tableDeps, rowDeps) >
          contentHeight() + 0.001 &&
        flow.cursorY > bandTop &&
        (keepsWholeAt(flow.cursorY) ||
          row.height.rule === 'exact' ||
          !probeRowFragmentProgress(
            row,
            structure.columnWidthsPt,
            tableLeft,
            flow.cursorY,
            contentHeight() - closingEdge,
            false,
            0,
            rowDeps(),
            cursors,
            structure.cellSpacingPt,
            { requireEveryCell: true }
          )))
    ) {
      breakForContinuation(admitsRepeatedHeaders, startsPage);
      movedToFreshPage = true;
      // A merge that did not fit the band it was offered in may fit this fresh page.
      admitSpans(bodyRowIndex, row);
    }

    for (;;) {
      tryTerminalFit();
      fragmentsForRow += 1;
      if (fragmentsForRow > MAX_TABLE_ROW_FRAGMENTS) {
        throw new TablePaginationError(
          'table-row-fragment-limit',
          `Table row ${row.id} exceeded ${MAX_TABLE_ROW_FRAGMENTS} page fragments`
        );
      }

      const remaining = contentHeight() - flow.cursorY;
      if (remaining <= 0.001 && flow.cursorY > 0) {
        if (movedToFreshPage) {
          throw new TablePaginationError(
            'table-row-overheight',
            `Table row ${row.id} cannot fit after repeated header rows`
          );
        }
        breakForContinuation(admitsRepeatedHeaders);
        movedToFreshPage = true;
        admitSpans(bodyRowIndex, row);
        continue;
      }

      // Prefer an unsplit placement when the natural height fits the remaining band. The
      // page bottom goes in for the detached head, whose height this row does not carry
      // and whose overflow the `placed.bottom` check below therefore cannot see.
      if (!isContinuation && naturalHeight <= remaining + 0.001) {
        const placementDeps = rowDeps();
        let placed =
          (!vMerge && !deferred
            ? rowProbes.place(row, tableLeft, flow.cursorY, placementDeps)
            : null) ??
          layoutRowFragment(
            deferred?.headRow ?? row,
            structure.columnWidthsPt,
            tableLeft,
            flow.cursorY,
            false,
            0,
            placementDeps,
            structure.cellSpacingPt,
            vMerge,
            contentHeight()
          );
        placed = fragmentCarry.current.adjustPlacement(bodyRowIndex, placed, contentHeight());
        // A row admitted at a page start keeps its page. Only its outer closing rule can overflow.
        const terminalExtent = terminal.exactTerminalBorderPt(row, placementDeps);
        if (placed.bottom > contentHeight() + terminalExtent + 0.001) {
          throw new TablePaginationError(
            'table-row-overheight',
            `Table row ${row.id} overflowed the page content box after placement`
          );
        }
        // This placement is COMMITTED either way. It ran on the live deps, so it has
        // already published its anchored drawings and spent its line ids; throwing it away
        // to re-place would leave a float positioned by a layout that never happened.
        if (deferred) {
          carry.commit(bodyRowIndex, deferred, placed.record);
          forceNextFragment = true;
        }
        const hasMore = placed.remainder !== null;
        const record = hasMore ? splitHead(placed.record) : placed.record;
        rows.push(record);
        rememberInsets(record, placementDeps);
        sourceRows.push(hasMore ? { ...row } : row);
        flow.cursorY = placed.bottom;
        if (!hasMore) break;
        // A detached head that reached the page bottom owes the rest to the next page.
        cursors = placed.remainder!;
        isContinuation = true;
        movedToFreshPage = false;
        breakForContinuation(admitsRepeatedHeaders);
        continue;
      }

      // Does not fit the remaining band.
      // Exact rows are atomic (Word clips overflow inside the fixed box; they do not
      // continue across pages). Same keep-together path as `w:cantSplit`.
      // Not on a CONTINUATION: this row already split, so `w:cantSplit` was decided an
      // iteration ago. Re-taking it here would reach the throw below on the fresh page.
      const splitStartMisses = onlyRepeatedHeaderRows(rows) && startMissesBelowRepeat(flow.cursorY);
      if (!isContinuation && (cantSplit || row.height.rule === 'exact' || splitStartMisses)) {
        // No page holds this row. Before mode 15 it stays whole on its fresh page and runs past
        // the bottom margin (`tallRowStaysWhole`); later modes split it there.
        const tall = row.height.rule !== 'exact' && !pageHoldsRow();
        const staysWhole =
          tall &&
          tallRowStaysWhole &&
          breaksPages &&
          !pinnedBreak &&
          vMerge === undefined &&
          bandTop === 0 &&
          !tableDeps.pageExclusionZones?.().length &&
          row.cells.every((cell) => cell.blocks.every((block) => block.kind === 'paragraph'));
        const splitsAnyway = tall && !staysWhole;
        // A tall row stays below repeated header rows only, and leaves authored ones. From
        // mode 15 it opens its fresh page without a repeat (`onlyRepeatedHeaderRows`).
        const belowRepeatsOnly = onlyRepeatedHeaderRows(rows);
        if (flow.cursorY > bandTop && !movedToFreshPage && !(tall && belowRepeatsOnly)) {
          const repeat = repeatsEnabled && !(splitsAnyway && laterLayout);
          breakForContinuation(admitsRepeatedHeaders, false, repeat);
          movedToFreshPage = true;
          // Re-offered like every other break that retries this row: a merge starting on a
          // `w:cantSplit` row that did not fit the band it was offered in may fit the fresh
          // page it just moved to, which is the whole point of deciding where a row lands.
          admitSpans(bodyRowIndex, row);
          continue;
        }
        // A fresh page whose band is shrunk by a footnote reserve still owns the full
        // column underneath it. A keep-together row that fits THAT takes it rather than
        // aborting: the reserve is advisory here (the notes pass sizes its area from the
        // body actually placed, so this only pushes the page's footnotes forward), while
        // the throw below rejects the entire document for one row+reserve collision.
        const fullBand = flow.unreservedContentHeight?.() ?? contentHeight();
        // An exact row no band holds fills the rest of this one (`table-exact-row-clip.ts`).
        // A row kept below repeated headers only runs past the margin (`overflowsBelowRepeat`).
        const offer =
          (belowRepeatsOnly && overflowsBelowRepeat()) || staysWhole || splitStartMisses
            ? { row, band: POSITIONED_TABLE_LAYOUT_BOTTOM_PT }
            : fullBand > contentHeight() + 0.001 && naturalHeight <= fullBand - flow.cursorY + 0.001
              ? { row, band: fullBand }
              : clippedExactRow(row, contentHeight(), flow.cursorY);
        if (offer) {
          const placementDeps = rowDeps();
          let placed = layoutRowFragment(
            offer.row,
            structure.columnWidthsPt,
            tableLeft,
            flow.cursorY,
            false,
            0,
            placementDeps,
            structure.cellSpacingPt,
            vMerge,
            offer.band
          );
          placed = fragmentCarry.current.adjustPlacement(bodyRowIndex, placed, offer.band);
          if (placed.bottom <= offer.band + 0.001 && placed.remainder === null) {
            rows.push(placed.record);
            rememberInsets(placed.record, placementDeps);
            sourceRows.push(row);
            flow.cursorY = placed.bottom;
            break;
          }
        }
        // `w:cantSplit` cannot keep a row whole when no page can hold it. The row is now
        // on a fresh page or below header rows only, so it splits from here like an
        // ordinary row instead of discarding the document. An exact height cannot split.
        if (!splitsAnyway && !splitStartMisses) throw overheightRowError(row);
      }

      const part = cutPart(structure, row, rowDeps(), contentHeight(), isContinuation, pinnedBreak);
      const placementDeps = part.deps;
      // A continued row kept below its repeat places its rest past the margin.
      const pastMargin = isContinuation && splitStartMisses;
      let placed = layoutRowFragmentBounded(
        row,
        structure.columnWidthsPt,
        tableLeft,
        flow.cursorY,
        pastMargin ? POSITIONED_TABLE_LAYOUT_BOTTOM_PT : part.bottom,
        false,
        isContinuation,
        0,
        placementDeps,
        cursors,
        structure.cellSpacingPt,
        vMerge
      );
      placed = fragmentCarry.current.adjustPlacement(bodyRowIndex, placed, part.bottom);

      // First attempt on a non-empty page placed nothing useful → move to next page.
      if (!placed.fitted && flow.cursorY > 0 && !movedToFreshPage) {
        breakForContinuation(admitsRepeatedHeaders);
        movedToFreshPage = true;
        admitSpans(bodyRowIndex, row);
        continue;
      }

      // A note reservation can leave an otherwise valid page with less than one line of body
      // space. Do not reject a splittable row solely because that empty reserved band was the
      // table's first offer; advance once to the next physical page and retry under its band.
      const fullBand = flow.unreservedContentHeight?.() ?? contentHeight();
      if (
        !placed.fitted &&
        flow.cursorY <= 0.001 &&
        !movedToFreshPage &&
        fullBand > contentHeight() + 0.001
      ) {
        breakForContinuation(admitsRepeatedHeaders);
        movedToFreshPage = true;
        admitSpans(bodyRowIndex, row);
        continue;
      }

      if (!placed.fitted) {
        throw new TablePaginationError(
          placed.nestedSplitBlocked ? 'table-row-split-unsupported' : 'table-row-overheight',
          placed.nestedSplitBlocked
            ? `Table row ${row.id} contains a nested table taller than the page content box`
            : `Table row ${row.id} has content that cannot fit a page content box`
        );
      }

      if (placed.bottom > contentHeight() + 0.001 && !pastMargin) {
        throw new TablePaginationError(
          'table-row-overheight',
          `Table row ${row.id} overflowed the page content box`
        );
      }

      const hasMore = placed.remainder !== null;
      // A continued cell redraws its edges at the page boundary. Clone partial
      // occurrences so finalization does not remeasure the entire source row.
      const source = isContinuation || hasMore ? { ...row } : row;
      const record = hasMore ? splitHead(placed.record) : placed.record;
      rows.push(record);
      rememberInsets(record, placementDeps);
      sourceRows.push(source);
      flow.cursorY = placed.bottom;
      if (!hasMore) break;
      cursors = placed.remainder!;
      isContinuation = true;
      movedToFreshPage = false;
      breakForContinuation(admitsRepeatedHeaders);
    }
  }
  placeClosingCellSpacing(flow, structure, pageBottom());
  const broken = pinnedBreak !== undefined || (textFlow && fragmentIndex > 0);
  wrapsBeside = broken && fragmentIndex > 0 && textTable.leavesPassage(structure, flow, tableLeft);
  closeTableFragment();
  if (outOfFlow) flow.cursorY = bodyCursorY;
  else if (broken)
    flow.cursorY = textTable.resumeAfterBreak(structure, flow, wrapsBeside, fragmentTop);
  // From mode 15, content after a table whose last page left out the repeated header rows
  // starts on the next page, even where it fits (`omittedRepeatEndsPage`).
  else if (repeatOmitted && hasCompatibilityRule(flow.compatibilityMode, 'omittedRepeatEndsPage'))
    flow.cursorY = flow.contentHeight();
  return { outOfFlow };
}
