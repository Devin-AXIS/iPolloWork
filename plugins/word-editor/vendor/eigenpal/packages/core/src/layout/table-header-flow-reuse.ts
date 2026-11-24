// Reusing the repeated header group's plan and rows across pages of one table pagination.
//
// `paginateTableInFlowSteps` repeats the leading header rows on every continuation page. For each
// repeat it builds a header plan at the group's top and places every header row there. Within
// one pagination the structure, the header rows, the deps object and the row probe are fixed,
// so two repeats at the same top and table edge are the same work. Only the page differs, and
// it reaches that work through two channels:
//
// - wrap zones (`pageExclusionZones`), which can cross the header. Nothing is reused unless
//   the page has none, both when a result is kept and when it is used again;
// - the occurrence stamp (`pageOccurrenceKey`), which only `nextLineId` reads. A reused row
//   calls `nextLineId` for each of its lines, in placement order, with this page's stamp, so
//   the ids and the pass's line counter come out as a fresh placement makes them.
//
// Only ordinary header rows are admitted (`ordinaryTableParagraph`: no fields, note
// references, drawings or content controls; horizontal text; no list item), in an in-flow,
// unpositioned table without cell spacing. Their placement then publishes no anchors: the
// anchor sink gets empty lists, which it ignores.
//
// Side effects are replayed. Each break key a kept plan build or row placement reported is
// reported again, then read from the break cache once, as placement reports and reads it. A
// plan build that measured a header row through the row probe clears the probe's kept result
// again (`forget`), as that measurement does. A plan is used again only while it is
// `unchanged()`: no read withdrew a merge and no read measured what the build did not.
// Repeated-header border plans (`candidate`) and the authored first group are never reused.

import { bodyLineId } from './body-line-id.ts';
import { firstRowContentDeps } from './table-fragment-content-insets.ts';
import {
  planHeaderGroup,
  planTrackedHeaderGroup,
  type HeaderGroupPlan,
} from './table-header-vmerge.ts';
import { sameOptions } from './table-header-repeat-reuse.ts';
import { ordinaryTableParagraph } from './table-ordinary-paragraph.ts';
import { withLines } from './table-row-geometry-reuse.ts';
import {
  layoutRowFragment,
  type LayoutRowBoundedResult,
  type TableFlowDeps,
} from './semantic-table-layout.ts';
import type { SemanticTableRow, SemanticTableStructure } from './semantic-table.ts';
import type { RowVMergeLayoutOptions } from './table-vmerge-heights.ts';
import type {
  BlockFragmentRecord,
  LineRecord,
  TableCellFragmentRecord,
  TableRowFragmentRecord,
} from './semantic-records.ts';

interface KeptPlan {
  readonly top: number;
  readonly left: number;
  readonly plan: HeaderGroupPlan;
  readonly keys: readonly string[];
  /** The build measured a header row through the row probe, which clears its kept result. */
  readonly measured: boolean;
}

interface KeptRow {
  readonly source: SemanticTableRow;
  readonly top: number;
  readonly left: number;
  readonly deps: TableFlowDeps;
  readonly options: RowVMergeLayoutOptions | undefined;
  readonly record: TableRowFragmentRecord;
  readonly bottom: number;
  readonly fitted: boolean;
  readonly keys: readonly string[];
}

/** Distinct tops kept per header plan list and per header row. */
const MAX_KEPT = 4;

let observer: {
  plansBuilt: number;
  plansReused: number;
  rowsPlaced: number;
  rowsReused: number;
  disabled: boolean;
} | null = null;

/**
 * @internal Counts header plans and rows built and reused, for tests that must see the reuse.
 * `disabled` builds and places everything, exactly as without the reuse.
 */
export function flowHeaderReuseTestRecorder(disabled = false): {
  readonly plansBuilt: number;
  readonly plansReused: number;
  readonly rowsPlaced: number;
  readonly rowsReused: number;
  dispose(): void;
} {
  const counts = { plansBuilt: 0, plansReused: 0, rowsPlaced: 0, rowsReused: 0, disabled };
  observer = counts;
  return {
    get plansBuilt() {
      return counts.plansBuilt;
    },
    get plansReused() {
      return counts.plansReused;
    },
    get rowsPlaced() {
      return counts.rowsPlaced;
    },
    get rowsReused() {
      return counts.rowsReused;
    },
    dispose() {
      if (observer === counts) observer = null;
    },
  };
}

/** Header rows whose placement reads nothing a page can change but zones and the stamp. */
function ordinaryHeaderRows(rows: readonly SemanticTableRow[], deps: TableFlowDeps): boolean {
  return (
    rows.length > 0 &&
    rows.every((row) =>
      row.cells.every(
        (cell) =>
          cell.textDirection === 'horizontal' &&
          cell.blocks.every(
            (block) =>
              block.kind === 'paragraph' &&
              ordinaryTableParagraph(block) &&
              !deps.listItems?.has(block.id)
          )
      )
    )
  );
}

export interface FlowHeaderReuse {
  /** The header plan at `top`, built or kept. */
  plan(top: number): HeaderGroupPlan;
  /** The deps header rows are placed with when no repeated-header border plan applies. */
  headerDeps(): TableFlowDeps;
  /**
   * Header row `index` placed at `top`, as `layoutRowFragment(row, cols, left, top, asRepeat, 0,
   * deps, cellSpacing, options)` places it. Only a repeat without a repeated-header border plan
   * (`bordered` false) may take a kept placement.
   */
  place(
    asRepeat: boolean,
    bordered: boolean,
    index: number,
    row: SemanticTableRow,
    top: number,
    deps: TableFlowDeps,
    options: RowVMergeLayoutOptions | undefined
  ): LayoutRowBoundedResult;
}

export function createFlowHeaderReuse(input: {
  readonly structure: SemanticTableStructure;
  readonly headerRows: readonly SemanticTableRow[];
  readonly deps: TableFlowDeps;
  readonly left: () => number;
  readonly rowHeightOf: (row: SemanticTableRow, top: number, deps: TableFlowDeps) => number;
  readonly rowProbes: { forget(): void };
  /** Positioned, out-of-flow and pinned tables, and spaced cells, take nothing kept. */
  readonly admitted: boolean;
}): FlowHeaderReuse {
  const { structure, headerRows, deps, left, rowHeightOf, rowProbes } = input;
  const eligible =
    input.admitted && structure.cellSpacingPt === 0 && ordinaryHeaderRows(headerRows, deps);
  const zonesFree = (): boolean => !deps.pageExclusionZones?.().length;
  const replay = (keys: readonly string[]): void => {
    for (const key of keys) {
      deps.onCellBreakKey?.(key);
      deps.cache?.get(key);
    }
  };
  // One sink for plan builds and placements: it records while a kept result is being made.
  let heard: string[] | null = null;
  const recording: TableFlowDeps = eligible
    ? {
        ...deps,
        onCellBreakKey: (key) => {
          heard?.push(key);
          deps.onCellBreakKey?.(key);
        },
      }
    : deps;
  let placementDeps: TableFlowDeps | undefined;
  const plans: KeptPlan[] = [];
  const rows = new Map<number, KeptRow[]>();
  const keep = <T>(list: T[], entry: T): void => {
    if (list.length === MAX_KEPT) list.shift();
    list.push(entry);
  };

  return {
    plan(top) {
      const at = left();
      const reusable = eligible && zonesFree() && !observer?.disabled;
      if (reusable)
        for (const kept of plans)
          if (Object.is(kept.top, top) && Object.is(kept.left, at) && kept.plan.unchanged()) {
            replay(kept.keys);
            if (kept.measured) rowProbes.forget();
            if (observer) observer.plansReused += 1;
            return kept.plan;
          }
      if (observer) observer.plansBuilt += 1;
      // Without the reuse, the plan is built exactly as before.
      if (!reusable) return planHeaderGroup(structure, headerRows, left, top, deps, rowHeightOf);
      let measured = false;
      heard = [];
      const plan = planTrackedHeaderGroup(
        structure,
        headerRows,
        left,
        top,
        recording,
        (row, y, rowDeps) => {
          measured = true;
          return rowHeightOf(row, y, rowDeps);
        }
      );
      const keys = heard;
      heard = null;
      keep(plans, { top, left: at, plan, keys, measured });
      return plan;
    },

    headerDeps() {
      // A pure function of the structure, its first header row and the deps: one object for
      // the whole pagination, so a kept row is used only under the deps it was placed with.
      if (!eligible || observer?.disabled)
        return firstRowContentDeps(structure, headerRows[0]!, deps);
      return (placementDeps ??= firstRowContentDeps(structure, headerRows[0]!, recording));
    },

    place(asRepeat, bordered, index, row, top, rowDeps, options) {
      const fresh = (): LayoutRowBoundedResult =>
        layoutRowFragment(
          row,
          structure.columnWidthsPt,
          left(),
          top,
          asRepeat,
          0,
          rowDeps,
          structure.cellSpacingPt,
          options
        );
      const repeat = asRepeat && !bordered;
      const occurrence = rowDeps.pageOccurrenceKey?.();
      const at = left();
      const reusable =
        eligible &&
        repeat &&
        occurrence !== undefined &&
        rowDeps === placementDeps &&
        zonesFree() &&
        !observer?.disabled;
      if (reusable)
        for (const kept of rows.get(index) ?? []) {
          if (
            kept.source !== row ||
            !Object.is(kept.top, top) ||
            !Object.is(kept.left, at) ||
            kept.deps !== rowDeps ||
            !sameOptions(kept.options, options)
          )
            continue;
          const record = restamped(kept.record, rowDeps, occurrence);
          replay(kept.keys);
          if (observer) observer.rowsReused += 1;
          return {
            record,
            bottom: kept.bottom,
            remainder: null,
            fitted: kept.fitted,
            nestedSplitBlocked: false,
          };
        }
      if (observer) observer.rowsPlaced += 1;
      if (!reusable) return fresh();
      heard = [];
      const placed = fresh();
      const keys = heard;
      heard = null;
      if (placed.remainder === null && stampedAs(placed.record, occurrence)) {
        let list = rows.get(index);
        if (!list) rows.set(index, (list = []));
        keep(list, {
          source: row,
          top,
          left: at,
          deps: rowDeps,
          options,
          record: placed.record,
          bottom: placed.bottom,
          fitted: placed.fitted,
          keys,
        });
      }
      return placed;
    },
  };
}

/** Whether every line id is the body id of its paragraph line with this occurrence stamp. */
function stampedAs(record: TableRowFragmentRecord, occurrence: string): boolean {
  for (const cell of record.cells)
    for (const block of cell.blocks) {
      if (block.kind !== 'paragraph') return false;
      for (let index = 0; index < block.lines.length; index += 1) {
        const line = block.lines[index]!;
        if (line.id !== bodyLineId(line.range.paragraphId, line.range.start, index, occurrence))
          return false;
      }
    }
  return true;
}

/**
 * `record` with each line's id made by `deps.nextLineId` for this occurrence, in placement
 * order: cells, then blocks, then lines, as row placement assigns them.
 */
function restamped(
  record: TableRowFragmentRecord,
  deps: TableFlowDeps,
  occurrence: string
): TableRowFragmentRecord {
  const cells: TableCellFragmentRecord[] = [];
  for (const cell of record.cells) {
    const blocks: BlockFragmentRecord[] = [];
    for (const block of cell.blocks) {
      if (block.kind !== 'paragraph') throw new Error('A kept header row holds only paragraphs');
      const lines: LineRecord[] = [];
      for (let index = 0; index < block.lines.length; index += 1) {
        const line = block.lines[index]!;
        lines.push({
          ...line,
          id: deps.nextLineId(line.range.paragraphId, line.range.start, index, occurrence),
        });
      }
      blocks.push(withLines(block, lines));
    }
    cells.push({ ...cell, blocks });
  }
  return { ...record, cells };
}
