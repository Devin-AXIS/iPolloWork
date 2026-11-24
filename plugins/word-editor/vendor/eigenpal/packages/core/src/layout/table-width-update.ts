import { rememberRowPlacement } from './table-row-placement-reuse.ts';
import {
  captureDeferredWidthRecipe,
  deferredWidthRecipe,
  deferredWidthRecipeHolds,
  deferredWidthFragment,
  rememberDeferredWidthRecipe,
  sameWidthHeaderInsets,
  type WidthHeaderPlacement,
} from './table-deferred-width-fragment.ts';
// Re-placing a table whose AutoFit column widths changed, without paginating it again.
//
// Typing into an AutoFit cell can move every column edge of the table. When each row keeps
// its vertical geometry, every pagination decision stays the same: the paginator decides
// from row heights, line counts and line heights, never from x. So each page fragment is
// placed again at its old row tops with the new widths and the placement each row had
// (fragment-first insets, the terminal row's own bottom edge, header merge plans).
//
// The result is accepted only when every row, cell, paragraph, line and border stroke has
// the same vertical geometry as before. A row split across pages is placed on each page as
// the paginator places it (`table-width-split-rows.ts`). Anything else (a row that wraps
// differently, a split row that shape does not cover, a merge outside the header group,
// floats, drawings, RTL or nested tables) returns null and the caller runs the full table
// layout instead.

import { carryBodyReviewAnchors } from './body-review-anchors.ts';
import { carryBlockMetadataIdentity } from './block-metadata-identity.ts';
import { markTableWithoutListMarkers } from './list-marker-reuse.ts';
import { tableWidthReuseScope } from './table-width-reuse-scope.ts';
import {
  createBodyWidthGroup,
  materializeBodyWidthGroup,
  type BodyWidthGroup,
} from './table-body-width-group.ts';
import type { CellWidthPlacement } from './table-cell-width-placement.ts';
import { editableTableParagraph } from './table-ordinary-paragraph.ts';
import { noteRowFactRead, rowFacts } from './table-row-facts.ts';
import { firstRowContentDeps, lastRowContentDeps } from './table-fragment-content-insets.ts';
import { bodyLineId } from './body-line-id.ts';
import {
  tableOriginX,
  type SemanticTableRow,
  type SemanticTableStructure,
} from './semantic-table.ts';
import { layoutRowFragment, type TableFlowDeps } from './semantic-table-layout.ts';
import { finalizeTableRows } from './table-fragment-finalize.ts';
import { hasTableMerge } from './table-border-probe.ts';
import { planFixedHeaderGroup, type HeaderGroupPlan } from './table-header-vmerge.ts';
import { createRowProbeReuse } from './table-row-probe-reuse.ts';
import { withoutAnchorSinks } from './table-probe-deps.ts';
import { annotateTableFragmentGeometry } from './semantic-table-interaction.ts';
import { registerTableCellBreakKeys } from './layout-cache.ts';
import { isOutOfFlowFragment } from './fragment-flow.ts';
import { finalizedWithHeadroom, withBudgetProof } from './table-budget-proof.ts';
import { moveRowToWidths } from './table-row-geometry-reuse.ts';
import { createRepeatedHeaderPlacements } from './table-header-repeat-reuse.ts';
import { shareTableFragmentFacts } from './table-fragment-facts.ts';
import { markHorizontalTableFragment } from './table-cell-text-direction.ts';
import { createSplitRowPlacements, markTableWithoutSplitRows } from './table-width-split-rows.ts';
import {
  closeGrownRow,
  growthBandOf,
  nextFragmentOpening,
  nextRowMovesAt,
  rowGrowthKeepsNothing,
  rowLineCount,
  sameRowMembership,
} from './table-row-growth.ts';
import type { CellContentInsets } from './table-cell-geometry.ts';
import type { TableBorderStrokeRecord } from './table-borders.ts';
import type { OoxmlElement } from '@docx-editor.dev/core/store';
import type {
  BlockFragmentRecord,
  LineRecord,
  PageRecord,
  TableCellFragmentRecord,
  TableFragmentRecord,
  TableRowFragmentRecord,
} from './semantic-records.ts';

type TableFragment = Extract<BlockFragmentRecord, { kind: 'table' }>;

const bodyWidthGroups = new WeakMap<TableFragment, BodyWidthGroup>();

/** Same result shape as `updateTableText`. */
export interface TableWidthUpdate {
  readonly paragraphPagesUnchanged: true;
  readonly pages: readonly PageRecord[];
  readonly lineDelta: number;
  readonly replacements: ReadonlyMap<BlockFragmentRecord, BlockFragmentRecord>;
}

/**
 * Structural eligibility of one resolved table, memoized per immutable structure. A text
 * edit gives the table a new structure that shares every unchanged row object, so the row
 * answers are kept per row as well, in the record its side-rule copies share
 * (`table-row-facts.ts`).
 */
const eligibleStructures = new WeakMap<SemanticTableStructure, boolean>();
const listFreeStructures = new WeakMap<SemanticTableStructure, number>();
const listIdentities = new WeakMap<NonNullable<TableFlowDeps['listItems']>, number>();
let nextListIdentity = 1;

function listIdentity(items: NonNullable<TableFlowDeps['listItems']>): number {
  let identity = listIdentities.get(items);
  if (identity === undefined) listIdentities.set(items, (identity = nextListIdentity++));
  return identity;
}

function eligibleRow(row: SemanticTableRow): boolean {
  const facts = rowFacts(row);
  if (facts.eligible === undefined) {
    noteRowFactRead('eligible');
    facts.eligible = row.cells.every(
      (cell) =>
        cell.logicalGridColumn === undefined &&
        cell.textDirection === 'horizontal' &&
        // A merge is planned here only inside the leading header group.
        (!cell.vMergeContinue || row.isHeader) &&
        cell.blocks.every((block) => block.kind === 'paragraph' && editableTableParagraph(block))
    );
  }
  return facts.eligible;
}

function listFreeRow(
  row: SemanticTableRow,
  listItems: NonNullable<TableFlowDeps['listItems']>,
  identity: number
) {
  const facts = rowFacts(row);
  if (facts.listFree === identity) return true;
  noteRowFactRead('listFree');
  const listFree = row.cells.every((cell) =>
    cell.blocks.every((block) => !listItems.has(block.id))
  );
  if (listFree) facts.listFree = identity;
  return listFree;
}

function eligibleStructure(structure: SemanticTableStructure, deps: TableFlowDeps): boolean {
  let known = eligibleStructures.get(structure);
  if (known === undefined) {
    known =
      !structure.float &&
      !structure.bidiVisual &&
      structure.cellSpacingPt === 0 &&
      structure.rows.every(eligibleRow);
    eligibleStructures.set(structure, known);
  }
  // List markers depend on the body counter stream, which this lane does not walk.
  const listItems = deps.listItems;
  if (!known || !listItems?.size) return known;
  const identity = listIdentity(listItems);
  if (listFreeStructures.get(structure) === identity) return true;
  const listFree = structure.rows.every((row) => listFreeRow(row, listItems, identity));
  if (listFree) listFreeStructures.set(structure, identity);
  return listFree;
}

/** True when the two structures describe the same rows and cells. */
function sameGrid(a: SemanticTableStructure, b: SemanticTableStructure): boolean {
  if (a.rows.length !== b.rows.length || a.columnWidthsPt.length !== b.columnWidthsPt.length)
    return false;
  for (let index = 0; index < a.rows.length; index += 1) {
    const left = a.rows[index]!;
    const right = b.rows[index]!;
    if (left.id !== right.id || left.isHeader !== right.isHeader) return false;
    if (left.cells.length !== right.cells.length) return false;
    for (let cell = 0; cell < left.cells.length; cell += 1) {
      const x = left.cells[cell]!;
      const y = right.cells[cell]!;
      if (x.id !== y.id || x.gridColumn !== y.gridColumn || x.gridSpan !== y.gridSpan) return false;
      if (x.vMergeContinue !== y.vMergeContinue) return false;
    }
  }
  return true;
}

/** The page occurrence a repeated header row's line ids were stamped with. */
function headerOccurrence(row: TableRowFragmentRecord): string | undefined {
  for (const cell of row.cells)
    for (const block of cell.blocks) {
      if (block.kind !== 'paragraph') continue;
      for (const line of block.lines) {
        const at = line.id.lastIndexOf(':occ:');
        if (at >= 0) return line.id.slice(at + ':occ:'.length);
      }
    }
  return undefined;
}

function sameLineHeights(a: LineRecord, b: LineRecord): boolean {
  return (
    a.box.y === b.box.y &&
    a.box.height === b.box.height &&
    a.baseline === b.baseline &&
    a.leading === b.leading &&
    a.trailingSpacing === b.trailingSpacing &&
    !a.drawings?.length &&
    !b.drawings?.length
  );
}

function sameBlockHeights(a: BlockFragmentRecord, b: BlockFragmentRecord): boolean {
  if (a.kind !== 'paragraph' || b.kind !== 'paragraph') return false;
  if (
    a.paragraphId !== b.paragraphId ||
    a.fragmentIndex !== b.fragmentIndex ||
    a.box.y !== b.box.y ||
    a.box.height !== b.box.height ||
    a.spacing.before !== b.spacing.before ||
    a.spacing.after !== b.spacing.after ||
    a.lines.length !== b.lines.length
  )
    return false;
  for (let index = 0; index < a.lines.length; index += 1)
    if (!sameLineHeights(a.lines[index]!, b.lines[index]!)) return false;
  return true;
}

/**
 * `sameBlockHeights(a, moved)` for the one block `moveRowToWidths` built from `a`. The move
 * copies every compared field and gives the block one line, so only a second line, a drawing
 * or a NaN (`x === x` fails for NaN alone) can still fail.
 */
function sameMovedBlockHeights(a: BlockFragmentRecord): boolean {
  if (a.kind !== 'paragraph' || a.lines.length !== 1) return false;
  const line = a.lines[0]!;
  const { box, spacing } = a;
  return (
    !line.drawings?.length &&
    a.fragmentIndex === a.fragmentIndex &&
    box.y === box.y &&
    box.height === box.height &&
    spacing.before === spacing.before &&
    spacing.after === spacing.after &&
    line.box.y === line.box.y &&
    line.box.height === line.box.height &&
    line.baseline === line.baseline &&
    line.leading === line.leading &&
    line.trailingSpacing === line.trailingSpacing
  );
}

const NO_STROKES: readonly TableBorderStrokeRecord[] = [];

/** Index of the next top, bottom or `between` rule at or after `index`. */
function nextHorizontalRule(strokes: readonly TableBorderStrokeRecord[], index: number): number {
  while (index < strokes.length) {
    const side = strokes[index]!.side;
    if (side !== 'left' && side !== 'right') break;
    index += 1;
  }
  return index;
}

/**
 * The horizontal rules of two cells, in publication order, compared pairwise.
 *
 * Only top, bottom and `between` rules carry occurrence facts: the bottom rule's placement
 * follows the inset the row was finalized with. Side rules run the cell box (compared
 * separately), and whether a cell publishes its leading side rule follows the table's
 * side-rule geometry, which a width change may switch without moving anything vertically.
 */
function sameStrokeHeights(a: TableCellFragmentRecord, b: TableCellFragmentRecord): boolean {
  const before = a.borders?.strokes ?? NO_STROKES;
  const after = b.borders?.strokes ?? NO_STROKES;
  let left = nextHorizontalRule(before, 0);
  let right = nextHorizontalRule(after, 0);
  while (left < before.length && right < after.length) {
    const x = before[left]!;
    const y = after[right]!;
    if (x.side !== y.side || x.role !== y.role || x.y !== y.y || x.height !== y.height)
      return false;
    left = nextHorizontalRule(before, left + 1);
    right = nextHorizontalRule(after, right + 1);
  }
  return left === before.length && right === after.length;
}

let rowComparisonObserver: RowComparisonCounts | null = null;

interface RowComparisonCounts {
  accepted: number;
  refused: number;
  /** Cells whose block walk the move's construction replaced. */
  movedCells: number;
  /** Comparisons where the full walk would decide differently. */
  disagreements: number;
}

/**
 * @internal Counts comparisons of moved rows and checks each against the full walk, for
 * tests that must see the shorter comparison decide like the full one.
 */
export function movedRowComparisonTestRecorder(): Readonly<RowComparisonCounts> & {
  dispose(): void;
} {
  const observer: RowComparisonCounts = {
    accepted: 0,
    refused: 0,
    movedCells: 0,
    disagreements: 0,
  };
  rowComparisonObserver = observer;
  return {
    get accepted() {
      return observer.accepted;
    },
    get refused() {
      return observer.refused;
    },
    get movedCells() {
      return observer.movedCells;
    },
    get disagreements() {
      return observer.disagreements;
    },
    dispose() {
      if (rowComparisonObserver === observer) rowComparisonObserver = null;
    },
  };
}

/**
 * Every vertical measurement of a finalized row, plus the facts pagination keyed on.
 *
 * `moved` is the record `moveRowToWidths` built from `a`, when `b` was finalized from it.
 * Finalize and annotation keep a cell's `blocks` array unless they shift its content, so a
 * cell of `b` that still holds the move's array holds the move's block.
 *
 * @internal Exported for the comparison tests.
 */
export function sameRowHeights(
  a: TableRowFragmentRecord,
  b: TableRowFragmentRecord,
  moved?: TableRowFragmentRecord
): boolean {
  if (!moved || !rowComparisonObserver) return compareRowHeights(a, b, moved);
  const observer = rowComparisonObserver;
  const decision = compareRowHeights(a, b, moved, observer);
  if (decision) observer.accepted += 1;
  else observer.refused += 1;
  if (decision !== compareRowHeights(a, b, undefined)) observer.disagreements += 1;
  return decision;
}

function compareRowHeights(
  a: TableRowFragmentRecord,
  b: TableRowFragmentRecord,
  moved: TableRowFragmentRecord | undefined,
  observer?: RowComparisonCounts
): boolean {
  if (
    a.id !== b.id ||
    a.rowIndex !== b.rowIndex ||
    a.isHeaderRow !== b.isHeaderRow ||
    a.isHeaderRepeat !== b.isHeaderRepeat ||
    !!a.isContinuation !== !!b.isContinuation ||
    !!a.hasContinuation !== !!b.hasContinuation ||
    a.box.y !== b.box.y ||
    a.box.height !== b.box.height ||
    a.cells.length !== b.cells.length
  )
    return false;
  for (let index = 0; index < a.cells.length; index += 1) {
    const x = a.cells[index]!;
    const y = b.cells[index]!;
    if (
      x.id !== y.id ||
      x.rowSpan !== y.rowSpan ||
      x.vMergeContinue !== y.vMergeContinue ||
      !!x.paintInert !== !!y.paintInert ||
      x.box.y !== y.box.y ||
      x.box.height !== y.box.height ||
      x.blocks.length !== y.blocks.length ||
      !sameStrokeHeights(x, y)
    )
      return false;
    if (
      moved &&
      y.blocks === moved.cells[index]?.blocks &&
      x.blocks[0]?.kind === 'paragraph' &&
      x.blocks[0].lines.length === 1
    ) {
      if (observer) observer.movedCells += 1;
      if (!sameMovedBlockHeights(x.blocks[0]!)) return false;
      continue;
    }
    for (let block = 0; block < x.blocks.length; block += 1)
      if (!sameBlockHeights(x.blocks[block]!, y.blocks[block]!)) return false;
  }
  return true;
}

/** Rows whose cell content changed between the two structures. */
function editedRows(a: SemanticTableStructure, b: SemanticTableStructure): Set<string> {
  const edited = new Set<string>();
  for (let index = 0; index < b.rows.length; index += 1) {
    const before = a.rows[index]!;
    const after = b.rows[index]!;
    if (before === after) continue;
    const changed = after.cells.some((cell, at) => {
      const blocks = before.cells[at]!.blocks;
      return (
        cell.blocks.length !== blocks.length ||
        cell.blocks.some((block, position) => block !== blocks[position])
      );
    });
    if (changed) edited.add(after.id);
  }
  return edited;
}

interface RowPlacement {
  readonly record: TableRowFragmentRecord;
  readonly insets: ReadonlyMap<string, CellContentInsets> | undefined;
  /** Moved from the old finalized row: only its borders are resolved again. */
  readonly moved?: true;
}

/** The record a move built from the old row at the same index, for `sameRowHeights`. */
const movedOf = (placement: RowPlacement): TableRowFragmentRecord | undefined =>
  placement.moved ? placement.record : undefined;

/**
 * The paginator's body band for the page at an index of the pages being updated, note
 * reserve included. Without it, no row may grow.
 */
export type TablePageBand = (pageIndex: number) => number;

/**
 * Place every fragment of `after` again at its old row tops under the new column widths.
 * Returns null unless the whole table keeps its vertical geometry on every page, except a
 * last row that grows within `pageBand` (`table-row-growth.ts`).
 */
export function updateTableWidths(
  after: OoxmlElement,
  oldStructure: SemanticTableStructure,
  structure: SemanticTableStructure,
  pages: readonly PageRecord[],
  width: number,
  deps: TableFlowDeps,
  pageBand?: TablePageBand
): TableWidthUpdate | null {
  const widthScope = tableWidthReuseScope(deps);
  const metadataUnchanged = new Set<BlockFragmentRecord>();
  if (!sameGrid(oldStructure, structure)) return null;
  if (!eligibleStructure(structure, deps) || !eligibleStructure(oldStructure, deps)) return null;
  // Single-column sections only reach this lane, so the column starts at 0.
  const oldLeft = tableOriginX(oldStructure, width);
  const left = tableOriginX(structure, width);
  if (!Number.isFinite(left)) return null;
  const columnWidthsPt = structure.columnWidthsPt;
  const tableWidth = columnWidthsPt.reduce((sum, columnWidth) => sum + columnWidth, 0);
  const sources = new Map<string, SemanticTableRow>();
  const ordinals = new Map<string, number>();
  for (const [index, row] of structure.rows.entries()) {
    sources.set(row.id, row);
    ordinals.set(row.id, index);
  }
  const headers: SemanticTableRow[] = [];
  for (const row of structure.rows) {
    if (!row.isHeader) break;
    headers.push(row);
  }
  const headerMerges = headers.some((row) => row.cells.some((cell) => cell.vMergeContinue));
  // The terminal row's own bottom edge is measured only for tables the paginator probes.
  const terminalRows = !hasTableMerge(structure);
  // Recorded like the full pass records them: every key a placement reports, in order.
  const keys: string[] = [];
  const base: TableFlowDeps = {
    ...withoutAnchorSinks(deps),
    pageExclusionZones: undefined,
    nextLineId: bodyLineId,
    onCellBreakKey: (key) => void keys.push(key),
  };
  const rowProbes = createRowProbeReuse(columnWidthsPt, 0);
  const rowHeightOf = (row: SemanticTableRow, top: number, rowDeps: TableFlowDeps): number =>
    rowProbes.measure(row, left, top, rowDeps);
  const headerPlans = new Map<number, HeaderGroupPlan>();
  // A pure function of the structure, its first header row and `base`, so every fragment
  // shares one object; repeated header placements are reused only under the same deps.
  const headerDeps = headers.length > 0 ? firstRowContentDeps(structure, headers[0]!, base) : base;
  const headerRepeats = createRepeatedHeaderPlacements();

  const fragments: TableFragment[] = [];
  const pageIndexOf = new Map<TableFragment, number>();
  for (const [pageIndex, page] of pages.entries()) {
    const own = page.fragments.filter(
      (fragment): fragment is TableFragment =>
        fragment.kind === 'table' && fragment.tableId === after.id
    );
    if (own.length === 0) continue;
    // Anchored drawings and floating tables publish wrap bands that can reach any cell.
    if (
      page.anchoredDrawings?.length ||
      page.fragments.some(
        (fragment) =>
          fragment.kind === 'table' && (!!fragment.floatingWrap || isOutOfFlowFragment(fragment))
      )
    )
      return null;
    // Finalize below runs without the pass budgets; a fragment cut by a spent one would differ.
    if (!own.every(finalizedWithHeadroom)) return null;
    for (const fragment of own) pageIndexOf.set(fragment, pageIndex);
    fragments.push(...own);
  }
  if (fragments.length === 0) return null;
  // A row split across pages is placed again on all its pages together (table-width-split-rows.ts).
  const splitRow = createSplitRowPlacements({
    fragments,
    pageIndexOf,
    pages,
    pageBand,
    structure,
    sources,
    ordinals,
    headerCount: headers.length,
    left,
    base,
  });
  let lineDelta = 0;

  /**
   * The band the fragment's last row may grow into, when the table continues at the top of
   * the next page and the paginator would still move that row's successor there.
   */
  const growthOf = (fragment: TableFragment) => {
    const at = fragments.indexOf(fragment);
    const pageIndex = pageIndexOf.get(fragment)!;
    const next = fragments[at + 1];
    const page = pages[pageIndex]!;
    // The band is addressed by the index the pass filled the page at.
    if (!pageBand || page.index !== pageIndex) return null;
    if (!next || pageIndexOf.get(next) !== pageIndex + 1) return null;
    const band = growthBandOf(page, fragment, next, pageBand(pageIndex));
    const opening = band === null ? null : nextFragmentOpening(next);
    return band === null || !opening ? null : { band, opening };
  };

  const placeHeaders = (rows: readonly TableRowFragmentRecord[]): WidthHeaderPlacement[] | null => {
    const placed: WidthHeaderPlacement[] = [];
    let plan: HeaderGroupPlan | undefined;
    for (const [index, old] of rows.entries()) {
      const source = headers[index];
      if (!source || source.id !== old.id || old.isContinuation || old.hasContinuation) return null;
      let placementDeps = headerDeps;
      const occurrence = old.isHeaderRepeat ? headerOccurrence(old) : undefined;
      if (old.isHeaderRepeat && occurrence === undefined) return null;
      if (occurrence !== undefined)
        placementDeps = { ...headerDeps, pageOccurrenceKey: () => occurrence };
      if (headerMerges && index === 0) {
        plan = headerPlans.get(old.box.y);
        if (!plan) {
          plan = planFixedHeaderGroup(structure, headers, left, old.box.y, base, rowHeightOf);
          headerPlans.set(old.box.y, plan);
        }
      }
      const options = plan?.optionsAt(index, old.box.y);
      const repeat =
        occurrence !== undefined
          ? { index, source, top: old.box.y, deps: headerDeps, options, occurrence }
          : undefined;
      const reused = repeat && headerRepeats.take(repeat);
      if (reused) {
        placed.push({ record: reused, insets: headerDeps.cellContentInsets });
        continue;
      }
      const reported = keys.length;
      const result = layoutRowFragment(
        source,
        columnWidthsPt,
        left,
        old.box.y,
        old.isHeaderRepeat,
        0,
        placementDeps,
        0,
        options
      );
      if (result.remainder !== null) return null;
      if (repeat) headerRepeats.remember(repeat, result.record, keys.slice(reported));
      placed.push({ record: result.record, insets: headerDeps.cellContentInsets });
    }
    return placed;
  };

  const replaceFragment = (fragment: TableFragment): TableFragmentRecord | null => {
    if (fragment.nestingDepth !== 0 || fragment.box.x !== oldLeft) return null;
    const deferred = deferredWidthRecipe(fragment);
    if (
      deferred &&
      widthScope &&
      !terminalRows &&
      deferredWidthRecipeHolds(deferred, sources, structure, left, widthScope)
    ) {
      const reported = keys.length;
      const nextHeaders = placeHeaders(deferred.headers.map((header) => header.record));
      if (
        nextHeaders &&
        nextHeaders.every(
          (header, index) =>
            sameWidthHeaderInsets(deferred.headers[index]!, header) &&
            sameRowHeights(deferred.headers[index]!.record, header.record)
        )
      ) {
        const candidate = deferredWidthFragment({
          recipe: deferred,
          headers: nextHeaders,
          structure: { ...structure, rows: [] },
          left,
          scope: widthScope,
          id: fragment.id,
          tableId: fragment.tableId,
          fragmentIndex: fragment.fragmentIndex,
          top: fragment.box.y,
          height: fragment.box.height,
        });
        for (const row of deferred.body.rows)
          for (const cell of row.cells) if (cell.breakKey) keys.push(cell.breakKey);
        bodyWidthGroups.set(candidate, deferred.body);
        rememberDeferredWidthRecipe(candidate, deferred);
        markTableWithoutSplitRows(candidate);
        shareTableFragmentFacts(fragment, candidate);
        metadataUnchanged.add(fragment);
        return candidate;
      }
      keys.length = reported;
    }
    const rows = fragment.rows;
    if (rows.length === 0) return null;
    const leadingHeaders = rows.findIndex(
      (row) => !row.isHeaderRow || !sources.get(row.id)?.isHeader
    );
    const headerCount = leadingHeaders < 0 ? rows.length : leadingHeaders;
    // A header group is placed whole; anything else was laid out as body rows.
    if (headerCount !== 0 && headerCount !== headers.length) return null;
    const bodySources = widthScope
      ? rows.slice(headerCount).map((row) => sources.get(row.id)!)
      : [];
    const knownGroup = widthScope ? bodyWidthGroups.get(fragment) : undefined;
    const cachedRows =
      knownGroup && widthScope
        ? materializeBodyWidthGroup(knownGroup, bodySources, columnWidthsPt, left, widthScope)
        : null;
    const captured = widthScope ? new Map<string, readonly CellWidthPlacement[]>() : null;
    let groupEligible = widthScope !== undefined;
    const preparedHeaders = placeHeaders(rows.slice(0, headerCount));
    if (!preparedHeaders) return null;
    const placed: RowPlacement[] = [];
    let terminal: RowPlacement | undefined;
    const place = (index: number, rowDeps: TableFlowDeps): RowPlacement | null => {
      const old = rows[index]!;
      const source = sources.get(old.id);
      if (!source) return null;
      if (old.isContinuation || old.hasContinuation) {
        if (index < headerCount) return null;
        return splitRow(old);
      }
      const header = index < headerCount;
      if (header) return preparedHeaders[index]!;
      // Most rows only move: same lines, same heights, new x. See table-row-geometry-reuse.ts.
      const plainOccurrence =
        !rowDeps.cellContentInsets &&
        !rowDeps.cellMinimumContentInsets &&
        !rowDeps.exactTerminalBorder &&
        !rowDeps.exactOpeningExtension;
      if (!header && !plainOccurrence) groupEligible = false;
      if (!header && plainOccurrence && cachedRows) {
        for (const recipe of knownGroup!.rows[index - headerCount]!.cells)
          if (recipe.breakKey) keys.push(recipe.breakKey);
        return { record: cachedRows[index - headerCount]!, insets: undefined, moved: true };
      }
      const recipes: (CellWidthPlacement | null)[] | null =
        groupEligible && plainOccurrence ? [] : null;
      const moved = header
        ? null
        : moveRowToWidths(
            source,
            old,
            columnWidthsPt,
            left,
            rowDeps,
            recipes ? (recipe) => recipes.push(recipe) : undefined
          );
      if (!header) {
        if (
          moved &&
          recipes &&
          recipes.length === old.cells.length &&
          recipes.every((recipe) => recipe !== null)
        )
          captured!.set(old.id, recipes as CellWidthPlacement[]);
        else groupEligible = false;
      }
      if (moved) return { record: moved, insets: rowDeps.cellContentInsets, moved: true };
      let placementDeps = rowDeps;
      if (old.isHeaderRepeat) {
        const stamp = headerOccurrence(old);
        if (stamp === undefined) return null;
        placementDeps = { ...rowDeps, pageOccurrenceKey: () => stamp };
      }
      const result = layoutRowFragment(
        source,
        columnWidthsPt,
        left,
        old.box.y,
        old.isHeaderRepeat,
        0,
        placementDeps,
        0
      );
      if (result.remainder !== null) return null;
      rememberRowPlacement(source, result, old.box.y, placementDeps);
      return { record: result.record, insets: rowDeps.cellContentInsets };
    };
    let grown = false;
    for (let index = 0; index < rows.length; index += 1) {
      const old = rows[index]!;
      const source = sources.get(old.id);
      if (!source) return null;
      const rowDeps =
        index < headerCount
          ? headerDeps
          : index === 0
            ? firstRowContentDeps(structure, source, base)
            : base;
      const result = place(index, rowDeps);
      if (!result) return null;
      placed.push(result);
      // The paginator gives a split row's occurrences no terminal edge of their own.
      if (
        index === rows.length - 1 &&
        terminalRows &&
        !old.isContinuation &&
        !old.hasContinuation
      ) {
        const ownEdge = lastRowContentDeps(structure, source, rowDeps);
        if (ownEdge !== rowDeps) {
          terminal = place(index, ownEdge) ?? undefined;
          if (!terminal) return null;
        }
      }
      // Finalize never changes a row box: a different height already decides the outcome.
      if (
        result.record.box.height !== old.box.height &&
        terminal?.record.box.height !== old.box.height
      ) {
        // Only the last row of a fragment may grow; see table-row-growth.ts.
        if (index !== rows.length - 1 || result.moved) return null;
        grown = true;
      }
    }
    if (grown) return growLastRow(fragment, rows, placed);
    // The paginator measures the terminal row with its own bottom edge whenever that probe
    // fits; the vertical comparison tells which placement it kept.
    const candidates = terminal ? [[...placed.slice(0, -1), terminal], placed] : [placed];
    for (const chosen of candidates) {
      const records = chosen.map((entry) => entry.record);
      const insets = new Map<TableRowFragmentRecord, ReadonlyMap<string, CellContentInsets>>();
      const settled = new Set<TableRowFragmentRecord>();
      for (const entry of chosen) {
        if (entry.insets) insets.set(entry.record, entry.insets);
        if (entry.moved) settled.add(entry.record);
      }
      const finalized = finalizeTableRows(
        records,
        structure,
        records.map((record) => sources.get(record.id)!),
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        insets,
        settled
      );
      const candidate = annotateTableFragmentGeometry(
        {
          kind: 'table',
          id: fragment.id,
          tableId: fragment.tableId,
          fragmentIndex: fragment.fragmentIndex,
          rows: finalized,
          box: { x: left, y: fragment.box.y, width: tableWidth, height: fragment.box.height },
        },
        columnWidthsPt,
        0,
        ordinals
      );
      if (
        candidate.rows.every((row, index) =>
          sameRowHeights(rows[index]!, row, movedOf(chosen[index]!))
        )
      ) {
        // Row for row: same ids, header repeats, cells, paragraph ids and line counts, and
        // paragraphs only. So the fragment holds what it held.
        shareTableFragmentFacts(fragment, candidate);
        if (groupEligible && widthScope) {
          const group = cachedRows
            ? knownGroup
            : createBodyWidthGroup(
                rows.slice(headerCount).map((baseline, index) => ({
                  source: bodySources[index]!,
                  baseline,
                  cells: captured!.get(baseline.id) ?? [],
                })),
                columnWidthsPt.length,
                widthScope
              );
          if (group) {
            bodyWidthGroups.set(candidate, group);
            markTableWithoutSplitRows(candidate);
            captureDeferredWidthRecipe(
              candidate,
              group,
              chosen.slice(0, headerCount),
              headers,
              structure
            );
            // Cached body recipes preserve attribution order and contain no drawings.
            // Repeated headers omit text attribution; unchanged sources preserve their
            // cell attribution. First header occurrences keep the ordinary metadata walk.
            if (
              cachedRows &&
              rows.every((row, index) => {
                const ordinal = ordinals.get(row.id)!;
                return (
                  oldStructure.rows[ordinal] === structure.rows[ordinal] &&
                  (index >= headerCount || row.isHeaderRepeat)
                );
              })
            )
              metadataUnchanged.add(fragment);
          }
        }
        return candidate;
      }
    }
    return null;
  };

  /** Replace a fragment whose last body row grew below every unchanged row above it. */
  const growLastRow = (
    fragment: TableFragment,
    rows: readonly TableRowFragmentRecord[],
    placed: readonly RowPlacement[]
  ): TableFragmentRecord | null => {
    const index = rows.length - 1;
    const old = rows[index]!;
    const before = rows[index - 1];
    const source = sources.get(old.id)!;
    const ordinal = ordinals.get(old.id)!;
    const previousSource = before && sources.get(before.id);
    const nextSource = structure.rows[ordinal + 1];
    const growth = growthOf(fragment);
    const grownRow = placed[index]!.record;
    if (
      !growth ||
      !before ||
      !previousSource ||
      !nextSource ||
      source.isHeader ||
      // The row follows body content on its page, so the paginator places it mid-page.
      before.isHeaderRow ||
      before.isHeaderRepeat ||
      growth.opening.id !== nextSource.id ||
      grownRow.box.height <= old.box.height ||
      grownRow.box.y + grownRow.box.height > growth.band + 0.001 ||
      !rowGrowthKeepsNothing(source, previousSource, deps) ||
      !nextRowMovesAt(
        structure,
        nextSource,
        left,
        grownRow.box.y + grownRow.box.height,
        growth.band,
        base,
        rowHeightOf
      )
    )
      return null;
    const closed = closeGrownRow(
      structure,
      source,
      grownRow,
      placed[index]!.insets,
      left,
      growth.band,
      base
    );
    const chosen: RowPlacement[] = [...placed.slice(0, index), closed];
    const records = chosen.map((entry) => entry.record);
    const insets = new Map<TableRowFragmentRecord, ReadonlyMap<string, CellContentInsets>>();
    const settled = new Set<TableRowFragmentRecord>();
    for (const entry of chosen) {
      if (entry.insets) insets.set(entry.record, entry.insets);
      if (entry.moved) settled.add(entry.record);
    }
    const finalized = finalizeTableRows(
      records,
      structure,
      records.map((record) => sources.get(record.id)!),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      insets,
      settled
    );
    const last = finalized[index]!;
    const candidate = annotateTableFragmentGeometry(
      {
        kind: 'table',
        id: fragment.id,
        tableId: fragment.tableId,
        fragmentIndex: fragment.fragmentIndex,
        rows: finalized,
        box: {
          x: left,
          y: fragment.box.y,
          width: tableWidth,
          height: last.box.y + last.box.height - fragment.box.y,
        },
      },
      columnWidthsPt,
      0,
      ordinals
    );
    const grownLast = candidate.rows[index]!;
    if (
      !candidate.rows.every(
        (row, at) => at === index || sameRowHeights(rows[at]!, row, movedOf(chosen[at]!))
      ) ||
      !sameRowMembership(old, grownLast) ||
      grownLast.box.y + grownLast.box.height > growth.band + 0.001
    )
      return null;
    lineDelta += rowLineCount(grownLast) - rowLineCount(old);
    return candidate;
  };

  // The edited rows decide most refusals, so their fragments go first.
  const edited = editedRows(oldStructure, structure);
  const holdsEditedRow = (fragment: TableFragment) => {
    const recipe = deferredWidthRecipe(fragment);
    return (recipe?.sources ?? fragment.rows).some((row) => edited.has(row.id));
  };
  const order = [
    ...fragments.filter(holdsEditedRow),
    ...fragments.filter((fragment) => !holdsEditedRow(fragment)),
  ];
  const replacements = new Map<BlockFragmentRecord, BlockFragmentRecord>();
  for (const fragment of order) {
    const replacement = replaceFragment(fragment);
    if (!replacement) return null;
    // Both structures passed `eligibleStructure`: every cell, header rows included, is
    // horizontal and holds paragraphs only, so no row of the replacement reads bottom to top.
    markHorizontalTableFragment(replacement);
    markTableWithoutListMarkers(replacement);
    replacements.set(fragment, withBudgetProof(replacement, true));
  }
  registerTableCellBreakKeys(after, keys);
  return {
    // sameRowHeights rejects changed block heights, line counts, and vertical positions,
    // except in a grown last row, which keeps its paragraphs on its page. Each replacement
    // keeps the original rows on their original page fragments.
    paragraphPagesUnchanged: true,
    lineDelta,
    pages: pages.map((page) => {
      if (!page.fragments.some((fragment) => replacements.has(fragment))) return page;
      const fragments = page.fragments.map((fragment) => replacements.get(fragment) ?? fragment);
      const replacement = { ...page, fragments };
      if (
        page.fragments.every(
          (fragment) => !replacements.has(fragment) || metadataUnchanged.has(fragment)
        )
      ) {
        carryBlockMetadataIdentity(page.fragments, fragments);
        carryBodyReviewAnchors(page, replacement);
      }
      return replacement;
    }),
    replacements,
  };
}
