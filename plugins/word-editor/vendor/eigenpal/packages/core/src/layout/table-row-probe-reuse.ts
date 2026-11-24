import { ordinaryTableParagraph } from './table-ordinary-paragraph.ts';
import { measuringFlowDeps } from './table-probe-deps.ts';
import {
  layoutRowFragment,
  measureRowHeight,
  type TableFlowDeps,
} from './semantic-table-layout.ts';
import type { SemanticTableRow } from './semantic-table.ts';
import {
  placementFromPrevious,
  rememberRowPlacement,
  previousRowRecord,
  type PreviousRow,
} from './table-row-placement-reuse.ts';
import { withLines } from './table-row-geometry-reuse.ts';
import { noteRowFactRead, rowFacts } from './table-row-facts.ts';

type Placement = ReturnType<typeof layoutRowFragment>;

// Resolved rows are immutable and survive text edits in other rows. The answer is kept in the
// record a row's side-rule copies share (`table-row-facts.ts`).

function sameProbeValue(a: TableFlowDeps, b: TableFlowDeps, key: keyof TableFlowDeps): boolean {
  if (key === 'pageExclusionZones') return true;
  if (key === 'rowAtPageStart') return !!a[key] === !!b[key];
  return a[key] === b[key];
}

/** Compare the union of own keys without allocating arrays and a set for every row. */
function sameProbeDeps(a: TableFlowDeps, b: TableFlowDeps): boolean {
  if (a === b) return true;
  for (const key in a)
    if (Object.hasOwn(a, key) && !sameProbeValue(a, b, key as keyof TableFlowDeps)) return false;
  for (const key in b)
    if (
      Object.hasOwn(b, key) &&
      !Object.hasOwn(a, key) &&
      !sameProbeValue(a, b, key as keyof TableFlowDeps)
    )
      return false;
  return true;
}

/** Keep only the latest ordinary row probe until its placement, without retaining prior rows. */
export function createRowProbeReuse(
  cols: readonly number[],
  cellSpacingPt: number,
  /** The previous layout's rows of this table, offered after a refused table update. */
  previous?: ReadonlyMap<string, PreviousRow>
) {
  let probe:
    | { row: SemanticTableRow; result: Placement; deps: TableFlowDeps; left: number; top: number }
    | undefined;
  const ordinary = (row: SemanticTableRow, deps: TableFlowDeps): boolean => {
    const facts = rowFacts(row);
    if (facts.ordinary === undefined) {
      noteRowFactRead('ordinary');
      facts.ordinary =
        !row.isHeader &&
        row.cells.every(
          (cell) =>
            !cell.vMergeContinue &&
            cell.textDirection === 'horizontal' &&
            cell.blocks.every((b) => b.kind === 'paragraph' && ordinaryTableParagraph(b))
        );
    }
    return (
      facts.ordinary && !row.cells.some((c) => c.blocks.some((b) => deps.listItems?.has(b.id)))
    );
  };
  const reuse = {
    measure(row: SemanticTableRow, left: number, top: number, deps: TableFlowDeps): number {
      probe = undefined;
      const zones = !!deps.pageExclusionZones?.().length;
      if (zones || !ordinary(row, deps)) {
        return measureRowHeight(
          row,
          cols,
          left,
          0,
          deps,
          cellSpacingPt,
          undefined,
          zones ? top : undefined
        );
      }
      // An unchanged row at its old top: the exact probe result, rebuilt for the new widths.
      const before = cellSpacingPt === 0 ? previous?.get(row.id) : undefined;
      const reused = before ? placementFromPrevious(row, before, cols, left, top, deps) : null;
      // Keep the real origin: translating a zero-origin probe changes floating-point geometry.
      const result =
        reused ??
        layoutRowFragment(
          row,
          cols,
          left,
          top,
          false,
          0,
          measuringFlowDeps(deps, false),
          cellSpacingPt
        );
      // A row rebuilt at a new top is remembered there, so the next pass can move it in place.
      if (cellSpacingPt === 0 && (!reused || previousRowRecord(before!).box.y !== top))
        rememberRowPlacement(row, result, top, deps);
      if (result.remainder === null) probe = { row, result, deps, left, top };
      return result.record.box.height;
    },
    /** What a `measure` call that keeps no probe leaves behind: no probe to take. */
    forget(): void {
      probe = undefined;
    },
    /** The kept probe of `row` at `top` as its placement, or null when it does not match. */
    take: takeKept,
    /**
     * `take`, or a new probe at `top` when the kept one missed. A row that opens a page was
     * probed at the old page bottom. The new probe costs what a fresh placement costs, and it
     * records the placement, so the next pass can move the row instead of laying it out again.
     * Null for a row the probes do not cover.
     */
    place(row: SemanticTableRow, left: number, top: number, deps: TableFlowDeps): Placement | null {
      const kept = takeKept(row, left, top, deps);
      if (kept) return kept;
      if (cellSpacingPt !== 0 || deps.pageExclusionZones?.().length || !ordinary(row, deps))
        return null;
      reuse.measure(row, left, top, deps);
      return takeKept(row, left, top, deps);
    },
  };
  function takeKept(
    row: SemanticTableRow,
    left: number,
    top: number,
    deps: TableFlowDeps
  ): Placement | null {
    const known = probe;
    probe = undefined;
    if (
      !known ||
      known.row !== row ||
      known.left !== left ||
      known.top !== top ||
      deps.pageExclusionZones?.().length
    )
      return null;
    if (!sameProbeDeps(deps, known.deps)) return null;
    // A prior finalized row already carries the same paragraph-local line ids. Keep its
    // records when no id changes; remapping must still call nextLineId for every line.
    let cells: (typeof known.result.record.cells)[number][] | undefined;
    for (let cellIndex = 0; cellIndex < known.result.record.cells.length; cellIndex++) {
      const cell = known.result.record.cells[cellIndex]!;
      let blocks: (typeof cell.blocks)[number][] | undefined;
      for (let blockIndex = 0; blockIndex < cell.blocks.length; blockIndex++) {
        const block = cell.blocks[blockIndex]!;
        if (block.kind !== 'paragraph') throw new Error('Ordinary row probe contains a table');
        let lines: (typeof block.lines)[number][] | undefined;
        for (let index = 0; index < block.lines.length; index++) {
          const line = block.lines[index]!;
          const id = deps.nextLineId(line.range.paragraphId, line.range.start, index);
          if (id !== line.id) (lines ??= block.lines.slice())[index] = { ...line, id };
        }
        if (lines) (blocks ??= cell.blocks.slice())[blockIndex] = withLines(block, lines);
      }
      if (blocks) (cells ??= known.result.record.cells.slice())[cellIndex] = { ...cell, blocks };
    }
    return cells ? { ...known.result, record: { ...known.result.record, cells } } : known.result;
  }
  return reuse;
}
