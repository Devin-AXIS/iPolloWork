// The table a body flow paginates: its structure at the column width, the page- or
// margin-positioned break that moves it into the flow, and whether it stays out of flow.

import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { readTableStructure, type SemanticTableStructure } from './semantic-table.ts';
import { autofitContextOf } from './table-autofit-widths.ts';
import type { TableFlowCursor } from './table-flow-cursor.ts';
import {
  pinnedBreakAtCursor,
  withSplittableRows,
  type PinnedTableBreak,
} from './table-pinned-break.ts';
import { isInFlowTextTable } from './table-text-float-break.ts';
import { withoutFloatingTableZones } from './table-float-overlap.ts';
import type { TableFlowDeps } from './semantic-table-layout.ts';

export interface FlowTable {
  readonly structure: SemanticTableStructure;
  /** Set when a positioned table reaching below the bottom margin breaks in the body flow. */
  readonly pinnedBreak: PinnedTableBreak | undefined;
  /** A positioned table that keeps its sheet position. */
  readonly outOfFlow: boolean;
  /** A text-anchored table that breaks across pages in the body flow (`table-text-float-break.ts`). */
  readonly textFlow: boolean;
  /** The deps its cells lay out with: the cells of a floating table never wrap around another. */
  readonly cellDeps: TableFlowDeps;
}

/** Read `table` for the flow at its column width; undefined when it has no rows. */
export function readFlowTable(table: OoxmlElement, flow: TableFlowCursor): FlowTable | undefined {
  const authored = readTableStructure(
    table,
    flow.columnWidth(),
    0,
    flow.styleCascade,
    flow.displayMode,
    flow.revisionAuthorFilter,
    flow.compatibilityMode,
    autofitContextOf(flow.deps)
  );
  if (!authored || authored.rows.length === 0) return undefined;
  // A page- or margin-positioned table that reaches below the bottom margin breaks across
  // pages in the body flow instead of keeping its sheet position (`table-pinned-break.ts`).
  const pinnedBreak = flow.positionTextTable
    ? undefined
    : pinnedBreakAtCursor(table, authored, flow);
  const outOfFlow =
    pinnedBreak === undefined &&
    authored.float !== undefined &&
    (authored.float.vertAnchor !== 'text' || flow.positionTextTable === true) &&
    authored.float.ySpec !== 'inline';
  // Both kinds of breaking positioned table may split any row (`table-text-float-break.ts`).
  const textFlow = isInFlowTextTable(authored, outOfFlow);
  const structure = pinnedBreak || textFlow ? withSplittableRows(authored) : authored;
  const flowDeps = outOfFlow || textFlow ? withoutFloatingTableZones(flow.deps) : flow.deps;
  const cellDeps = withParentTableLayout(authored, flowDeps);
  return { structure, pinnedBreak, outOfFlow, textFlow, cellDeps };
}

/**
 * The deps the cells of `structure` lay out with: a fixed table that holds a nested table
 * marks them (`nestedAutofitStructure`); every other table keeps `deps` itself, so the caches
 * keyed by deps identity keep their entries. One stable copy per deps.
 */
export function withParentTableLayout(
  structure: SemanticTableStructure,
  deps: TableFlowDeps
): TableFlowDeps {
  if (deps.parentTableFixed || !structure.layoutFixed || !holdsNestedTable(structure)) {
    return deps.parentTableFixed && !structure.layoutFixed
      ? { ...deps, parentTableFixed: undefined }
      : deps;
  }
  let known = fixedParentDeps.get(deps);
  if (!known) fixedParentDeps.set(deps, (known = { ...deps, parentTableFixed: true }));
  return known;
}
const fixedParentDeps = new WeakMap<TableFlowDeps, TableFlowDeps>();
const nestingStructures = new WeakMap<SemanticTableStructure, boolean>();
function holdsNestedTable(structure: SemanticTableStructure): boolean {
  let known = nestingStructures.get(structure);
  if (known === undefined) {
    known = structure.rows.some((row) =>
      row.cells.some((cell) => cell.blocks.some((block) => block.kind === 'table'))
    );
    nestingStructures.set(structure, known);
  }
  return known;
}
