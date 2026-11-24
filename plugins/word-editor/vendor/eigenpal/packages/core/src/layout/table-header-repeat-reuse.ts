// Placing a repeated header row once per table width update, then stamping each page.
//
// The width update places the leading header rows again on every continuation page. Each
// such placement is `layoutRowFragment(source, cols, left, top, true, 0, deps, 0, options)`
// with `deps.pageOccurrenceKey` naming the page. Within one update, `cols` and `left` are
// fixed, and the page enters the placement ONLY through that key:
//
// - `layoutRowFragmentBounded` reads `pageOccurrenceKey` in one place, the `nextLineId` it
//   wraps for a header repeat. So the key reaches the record only as the occurrence suffix
//   of each line id (`bodyLineId`, `:occ:<key>`). No other field holds a line id.
// - Everything else the placement reads is the same for every page: the source row, `top`,
//   the deps object (the update's own, without wrap zones or anchor sinks), and the merge
//   options, compared here by value because the plan builds a new object for each read.
// - The width update admits only ordinary paragraphs (`ordinaryTableParagraph`): no fields,
//   note references, drawings, content controls or nested tables. So no page number, note
//   mark or anchor is read.
//
// So a placement for another page, with the same source, top, deps and options, is the
// first placement with every line id given that page's suffix. Its side effects are replayed
// in order: each break key is reported to the update's key list, and read from the break
// cache once, as the placement reports and reads it. A record that does not have the shape
// this assumes (a block that is not a paragraph, a line id without the suffix) is not reused.

import { bodyLineId } from './body-line-id.ts';
import { withLines } from './table-row-geometry-reuse.ts';
import type { SemanticTableRow } from './semantic-table.ts';
import type { TableFlowDeps } from './semantic-table-layout.ts';
import type { RowVMergeLayoutOptions } from './table-vmerge-heights.ts';
import type {
  BlockFragmentRecord,
  LineRecord,
  TableCellFragmentRecord,
  TableRowFragmentRecord,
} from './semantic-records.ts';

/** Everything one repeated-header placement reads, apart from its page. */
export interface RepeatedHeaderPlacement {
  /** Index of the row in the leading header group. */
  readonly index: number;
  readonly source: SemanticTableRow;
  readonly top: number;
  /** The deps the row is placed with, before the page's occurrence key is added. */
  readonly deps: TableFlowDeps;
  readonly options: RowVMergeLayoutOptions | undefined;
  /** The page's occurrence key. */
  readonly occurrence: string;
}

interface Entry extends RepeatedHeaderPlacement {
  readonly record: TableRowFragmentRecord;
  /** Break keys the placement reported, in order. */
  readonly keys: readonly string[];
}

/** Placements of one width update, by header row index. */
export interface RepeatedHeaderPlacements {
  /** The record a fresh placement would give, with its side effects replayed; else undefined. */
  take(placement: RepeatedHeaderPlacement): TableRowFragmentRecord | undefined;
  /** Keep a fresh placement and the break keys it reported. */
  remember(
    placement: RepeatedHeaderPlacement,
    record: TableRowFragmentRecord,
    keys: readonly string[]
  ): void;
}

/** Distinct tops kept per header row; pages normally share one. */
const MAX_ENTRIES_PER_ROW = 4;

const OPTION_KEYS = new Set([
  'detachedSpanHeightPtByCellId',
  'heightFloorPt',
  'coveredFromAbove',
  'clippedSpanCellIds',
]);

function sameIds(a: ReadonlySet<string> | undefined, b: ReadonlySet<string> | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

function sameSpans(
  a: ReadonlyMap<string, number> | undefined,
  b: ReadonlyMap<string, number> | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b || a.size !== b.size) return false;
  const right = b.entries();
  for (const [key, value] of a) {
    const next = right.next();
    if (next.done || next.value[0] !== key || !Object.is(next.value[1], value)) return false;
  }
  return true;
}

/** The same own keys in the same order, each a known option with the same value. */
export function sameOptions(
  a: RowVMergeLayoutOptions | undefined,
  b: RowVMergeLayoutOptions | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const left = Object.keys(a);
  const right = Object.keys(b);
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1)
    if (left[index] !== right[index] || !OPTION_KEYS.has(left[index]!)) return false;
  return (
    Object.is(a.heightFloorPt, b.heightFloorPt) &&
    a.coveredFromAbove === b.coveredFromAbove &&
    sameSpans(a.detachedSpanHeightPtByCellId, b.detachedSpanHeightPtByCellId) &&
    sameIds(a.clippedSpanCellIds, b.clippedSpanCellIds)
  );
}

/**
 * `record` with each line's occurrence suffix `from` replaced by `to`; else undefined.
 * Spans, ranges and boxes stay shared between pages. Their identity-keyed caches must store
 * content-derived data only; page-specific data belongs to the stamped line or its page.
 */
function restamped(
  record: TableRowFragmentRecord,
  from: string,
  to: string
): TableRowFragmentRecord | undefined {
  const before = `:occ:${from}`;
  const after = `:occ:${to}`;
  const cells: TableCellFragmentRecord[] = [];
  for (const cell of record.cells) {
    const blocks: BlockFragmentRecord[] = [];
    for (const block of cell.blocks) {
      if (block.kind !== 'paragraph') return undefined;
      const lines: LineRecord[] = [];
      for (const line of block.lines) {
        if (!line.id.endsWith(before)) return undefined;
        lines.push({ ...line, id: line.id.slice(0, line.id.length - before.length) + after });
      }
      blocks.push(withLines(block, lines));
    }
    cells.push({ ...cell, blocks });
  }
  return { ...record, cells };
}

let observer: { reused: number; placed: number; disabled: boolean } | null = null;

/**
 * @internal Counts repeated header rows reused and placed, for tests that must see the reuse.
 * `disabled` places every row, so a test can compare both paths on the same input.
 */
export function repeatedHeaderReuseTestRecorder(disabled = false): {
  readonly reused: number;
  readonly placed: number;
  dispose(): void;
} {
  const counts = { reused: 0, placed: 0, disabled };
  observer = counts;
  return {
    get reused() {
      return counts.reused;
    },
    get placed() {
      return counts.placed;
    },
    dispose() {
      if (observer === counts) observer = null;
    },
  };
}

export function createRepeatedHeaderPlacements(): RepeatedHeaderPlacements {
  const byIndex = new Map<number, Entry[]>();
  return {
    take(placement) {
      if (observer?.disabled) return undefined;
      const { source, top, deps, options, occurrence } = placement;
      for (const entry of byIndex.get(placement.index) ?? []) {
        if (
          entry.source !== source ||
          !Object.is(entry.top, top) ||
          entry.deps !== deps ||
          !sameOptions(entry.options, options)
        )
          continue;
        const record = restamped(entry.record, entry.occurrence, occurrence);
        if (!record) return undefined;
        for (const key of entry.keys) {
          deps.onCellBreakKey?.(key);
          deps.cache?.get(key);
        }
        if (observer) observer.reused += 1;
        return record;
      }
      return undefined;
    },
    remember(placement, record, keys) {
      if (observer) observer.placed += 1;
      // The suffix is replaced as `bodyLineId` writes it; any other id scheme is not reused.
      if (placement.deps.nextLineId !== bodyLineId) return;
      let entries = byIndex.get(placement.index);
      if (!entries) byIndex.set(placement.index, (entries = []));
      if (entries.length === MAX_ENTRIES_PER_ROW) entries.shift();
      entries.push({ ...placement, record, keys });
    },
  };
}
