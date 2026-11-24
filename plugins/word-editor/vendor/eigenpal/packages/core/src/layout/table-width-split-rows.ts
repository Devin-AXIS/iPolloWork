// Re-placing a body row that splits across pages, for a table width update.
//
// The paginator places a split row once per page: `layoutRowFragmentBounded` at the row's top,
// bounded by the page's body band, with the cell cursors the previous page left, as a
// continuation after the first page (`table-flow-pagination.ts`). This places every occurrence
// of the row the same way, in page order, at its old top and under the same band, passing the
// cursors on, with the deps the paginator derives for it: the fragment's first-row insets for a
// row that opens its fragment, and `rowAtPageStart` from where the row stands.
//
// When every occurrence then has the old flags, height and remainder state, and the update's
// own comparison finds the same vertical geometry, the paginator makes the same decisions for
// the new widths as for the old ones: each decision it takes here reads the placed lines, the
// band and these deps, and all of those are the same. Decisions that read the row's unsplit
// natural height, which the placed occurrences do not show in full, are refused instead:
// `w:cantSplit` and exact rows, keep-with-next on either side, a row that starts a page, a split
// row opening its fragment below repeated headers (the repeated-header border plan), the first
// body row, and a fragment without the repeated header group in a table that has one, for the
// first occurrence as for every later one. The admission probe that decides whether headers
// repeat above a continuation is run again and must agree.

import { firstRowContentDeps } from './table-fragment-content-insets.ts';
import { cutPart } from './table-row-minimum-fit.ts';
import {
  initialCellCursors,
  layoutRowFragmentBounded,
  type CellPlaceCursor,
  type TableFlowDeps,
} from './semantic-table-layout.ts';
import { probeRowFragmentProgress } from './table-row-progress-probe.ts';
import { rowKeepsWithNext, rowStartsPage } from './table-row-keeps.ts';
import type { SemanticTableRow, SemanticTableStructure } from './semantic-table.ts';
import type { CellContentInsets } from './table-cell-geometry.ts';
import type {
  PageRecord,
  TableFragmentRecord,
  TableRowFragmentRecord,
} from './semantic-records.ts';

/** One occurrence of a split row, placed at the new widths. */
export interface SplitRowPlacement {
  readonly record: TableRowFragmentRecord;
  readonly insets: ReadonlyMap<string, CellContentInsets> | undefined;
}

/** One occurrence of a split row: its fragment, and its row index there. */
export interface SplitRowOccurrence {
  /** The fragment's position in `SplitRowInput.fragments`, not its index in the table. */
  readonly listPosition: number;
  readonly fragment: TableFragmentRecord;
  readonly index: number;
  readonly old: TableRowFragmentRecord;
}

export interface SplitRowInput {
  /** The table's fragments of the pages being updated, in page order. */
  readonly fragments: readonly TableFragmentRecord[];
  readonly pageIndexOf: ReadonlyMap<TableFragmentRecord, number>;
  readonly pages: readonly PageRecord[];
  /** The paginator's body band per page; without it no split row is placed. */
  readonly pageBand: ((pageIndex: number) => number) | undefined;
  readonly structure: SemanticTableStructure;
  readonly sources: ReadonlyMap<string, SemanticTableRow>;
  readonly ordinals: ReadonlyMap<string, number>;
  /** Leading header rows of the structure. */
  readonly headerCount: number;
  readonly left: number;
  /** The update's deps: no wrap zones, no anchor sinks, body line ids, its key sink. */
  readonly base: TableFlowDeps;
}

const completeFragments = new WeakSet<TableFragmentRecord>();

/** The caller proves every row is complete, including repeated headers. */
export function markTableWithoutSplitRows(fragment: TableFragmentRecord): void {
  completeFragments.add(fragment);
}

let observer: { placed: number; refused: number } | null = null;

/** @internal Counts split rows placed again and refused, for tests that must see the lane. */
export function splitRowWidthTestRecorder(): {
  readonly placed: number;
  readonly refused: number;
  dispose(): void;
} {
  const counts = { placed: 0, refused: 0 };
  observer = counts;
  return {
    get placed() {
      return counts.placed;
    },
    get refused() {
      return counts.refused;
    },
    dispose() {
      if (observer === counts) observer = null;
    },
  };
}

/**
 * The placement of each split-row occurrence at the new widths, by its old record; null when
 * the row's occurrences cannot be shown to place as before. Every occurrence of a row is placed
 * together, the first time any of them is asked for.
 */
export function createSplitRowPlacements(
  input: SplitRowInput
): (old: TableRowFragmentRecord) => SplitRowPlacement | null {
  const chains = new Map<string, SplitRowOccurrence[]>();
  for (const [listPosition, fragment] of input.fragments.entries()) {
    if (completeFragments.has(fragment)) continue;
    fragment.rows.forEach((old, index) => {
      if (!old.isContinuation && !old.hasContinuation) return;
      let chain = chains.get(old.id);
      if (!chain) chains.set(old.id, (chain = []));
      chain.push({ listPosition, fragment, index, old });
    });
  }
  const placed = new Map<TableRowFragmentRecord, SplitRowPlacement | null>();
  return (old) => {
    const known = placed.get(old);
    if (known !== undefined) return known;
    const chain = chains.get(old.id) ?? [];
    const results = chain.length > 0 ? placeChain(input, chain) : null;
    if (observer) {
      if (results) observer.placed += 1;
      else observer.refused += 1;
    }
    for (const occurrence of chain)
      placed.set(occurrence.old, results?.get(occurrence.old) ?? null);
    return placed.get(old) ?? null;
  };
}

/**
 * Whether the chain has the shape the paginator gives a split row; see the module comment.
 *
 * @internal Exported for tests of each refused shape.
 */
export function admissibleSplitChain(
  input: Pick<SplitRowInput, 'pageIndexOf' | 'pages' | 'pageBand' | 'headerCount'>,
  chain: readonly SplitRowOccurrence[]
): boolean {
  const { pageIndexOf, pages, pageBand, headerCount } = input;
  const last = chain.length - 1;
  if (last < 1 || !pageBand) return false;
  for (let k = 0; k <= last; k += 1) {
    const { fragment, index, old } = chain[k]!;
    if (!!old.isContinuation !== k > 0 || !!old.hasContinuation !== k < last) return false;
    if (old.isHeaderRow || old.isHeaderRepeat) return false;
    const pageIndex = pageIndexOf.get(fragment);
    if (pageIndex === undefined || pages[pageIndex]?.index !== pageIndex) return false;
    // A split ends its fragment; the next occurrence opens the next fragment, on the next page.
    if (k < last && index !== fragment.rows.length - 1) return false;
    if (k > 0) {
      const previous = chain[k - 1]!.fragment;
      if (chain[k]!.listPosition !== chain[k - 1]!.listPosition + 1) return false;
      if (pageIndex !== pageIndexOf.get(previous)! + 1) return false;
      // Below the whole repeated header group, or at the top when the table has none.
      if (index !== headerCount) return false;
      for (let at = 0; at < index; at += 1) if (!fragment.rows[at]!.isHeaderRepeat) return false;
    } else if (index === 0 && headerCount > 0) {
      // A fragment the row opens without the table's header group: the paginator decided not
      // to repeat the headers with `admitsRepeatedHeaders`, a probe this lane runs again only
      // for later occurrences. Refused rather than inferred from the row's equal lines.
      return false;
    } else if (index > 0 && fragment.rows.slice(0, index).every((row) => row.isHeaderRepeat)) {
      // A row first below repeated headers may take the repeated-header border plan's deps.
      return false;
    }
  }
  return true;
}

function placeChain(
  input: SplitRowInput,
  chain: readonly SplitRowOccurrence[]
): Map<TableRowFragmentRecord, SplitRowPlacement> | null {
  const { structure, sources, ordinals, base, left, headerCount } = input;
  const source = sources.get(chain[0]!.old.id);
  const ordinal = source && ordinals.get(source.id);
  if (!source || ordinal === undefined || source.isHeader || ordinal <= headerCount) return null;
  if (
    source.cantSplit ||
    source.height.rule === 'exact' ||
    source.cells.some((cell) => cell.textDirection !== 'horizontal')
  )
    return null;
  const cascade = base.styleCascade;
  if (
    rowKeepsWithNext(source, cascade) ||
    rowKeepsWithNext(structure.rows[ordinal - 1]!, cascade) ||
    rowStartsPage(structure, ordinal, cascade, base.compatibilityMode)
  )
    return null;
  if (!admissibleSplitChain(input, chain)) return null;
  const cols = structure.columnWidthsPt;
  const last = chain.length - 1;
  const results = new Map<TableRowFragmentRecord, SplitRowPlacement>();
  let cursors: readonly CellPlaceCursor[] = initialCellCursors(source);
  for (let k = 0; k <= last; k += 1) {
    const { fragment, index, old } = chain[k]!;
    const top = old.box.y;
    const bottom = input.pageBand!(input.pageIndexOf.get(fragment)!);
    // The paginator asks whether the continuation progresses below repeated headers before it
    // repeats them; the old page has them, so the answer must still be yes.
    if (
      k > 0 &&
      index > 0 &&
      !probeRowFragmentProgress(
        source,
        cols,
        left,
        top,
        bottom,
        true,
        0,
        { ...base, rowAtPageStart: false },
        cursors,
        0
      )
    )
      return null;
    const opening = index === 0 ? firstRowContentDeps(structure, source, base) : base;
    // Every occurrence ends its page, so it takes the paginator's split-part deps and band. The
    // width lane only serves tables without `w:tblpPr`, never a page-positioned break.
    const part = cutPart(structure, source, opening, bottom, k > 0, undefined);
    const placementDeps: TableFlowDeps = {
      ...part.deps,
      rowAtPageStart:
        top <= 0.001 ||
        (index > 0 && fragment.rows.slice(0, index).every((row) => row.isHeaderRepeat)),
    };
    const placed = layoutRowFragmentBounded(
      source,
      cols,
      left,
      top,
      part.bottom,
      false,
      k > 0,
      0,
      placementDeps,
      cursors,
      0
    );
    if (
      !placed.fitted ||
      (placed.remainder !== null) !== k < last ||
      placed.bottom > bottom + 0.001 ||
      placed.record.box.height !== old.box.height
    )
      return null;
    results.set(old, {
      record: k < last ? { ...placed.record, hasContinuation: true } : placed.record,
      insets: placementDeps.cellContentInsets,
    });
    cursors = placed.remainder ?? [];
  }
  return results;
}
