// Vertical-merge geometry for canonical table rows.
//
// Maps each `w:tc` of a row onto the grid interval it occupies, then reports which of a
// source row's cells sit inside a merge chain that continues across an insertion boundary.
// A row inserted at that boundary repeats `w:vMerge` for exactly those cells, so the
// covering cell grows by one row instead of the chain being severed.

import {
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlTableRowNode,
} from '../package/ooxml-tree.ts';
import { MAX_TABLE_COLUMNS } from './table-constraints.ts';
import { isWmlElement, wmlAttributeValue, wmlChildNamed } from './tree-op-table-shared.ts';
import { type EditableTableTopology } from './tree-op-table-topology.ts';

export type VerticalMergeKind = 'none' | 'restart' | 'continue';

export interface GridCellSlot {
  readonly startCol: number;
  readonly span: number;
  readonly vMergeKind: VerticalMergeKind;
}

const NO_CONTINUATIONS: ReadonlySet<number> = new Set<number>();

function readGridSpan(cellProperties: OoxmlElement | undefined): number {
  const raw = cellProperties && wmlChildNamed(cellProperties, 'gridSpan');
  const value = raw && wmlAttributeValue(raw, 'val');
  if (!value || !/^\d{1,7}$/.test(value)) return 1;
  const span = Number(value);
  return Number.isInteger(span) && span > 1 ? Math.min(span, MAX_TABLE_COLUMNS) : 1;
}

function readGridSkip(rowProperties: OoxmlElement | undefined, localName: string): number {
  const raw = rowProperties && wmlChildNamed(rowProperties, localName);
  const value = raw && wmlAttributeValue(raw, 'val');
  if (!value || !/^\d{1,7}$/.test(value)) return 0;
  const count = Number(value);
  return Number.isInteger(count) && count > 0 ? Math.min(count, MAX_TABLE_COLUMNS) : 0;
}

export function readVMergeKind(cellProperties: OoxmlElement | undefined): VerticalMergeKind {
  const vMerge = cellProperties && wmlChildNamed(cellProperties, 'vMerge');
  if (!vMerge) return 'none';
  return wmlAttributeValue(vMerge, 'val') === 'restart' ? 'restart' : 'continue';
}

/** Grid intervals the row's direct `w:tc` children occupy, in cell order. */
export function buildRowGridSlots(row: OoxmlTableRowNode): readonly GridCellSlot[] {
  return buildCellGridSlots(
    row,
    row.children.filter((child) => child.kind === 'tableCell')
  );
}

/** Grid intervals `cells` occupy, in order, after the row's `w:gridBefore`. */
export function buildCellGridSlots(
  row: OoxmlTableRowNode,
  cells: readonly OoxmlNode[]
): readonly GridCellSlot[] {
  const trPr = wmlChildNamed(row, 'trPr');
  const gridBefore = readGridSkip(trPr, 'gridBefore');
  let cursor = gridBefore;
  const slots: GridCellSlot[] = [];
  for (const child of cells) {
    if (child.kind === 'textValue') continue;
    const tcPr = wmlChildNamed(child, 'tcPr');
    const startCol = Math.min(cursor, MAX_TABLE_COLUMNS);
    const span = Math.min(readGridSpan(tcPr), MAX_TABLE_COLUMNS - startCol);
    slots.push({ startCol, span, vMergeKind: readVMergeKind(tcPr) });
    cursor = startCol + span;
  }
  return slots;
}

/**
 * Node ceiling for one wrapper scan. Exhausting it — by node count or by breadth — reads as
 * "hides one", so an unreadable subtree refuses the edit instead of slipping past the scan.
 *
 * Sized well clear of {@link MAX_TABLE_COLUMNS} so a legitimately wide row cannot exhaust it
 * on its own cells and read as unreadable.
 */
const WRAPPED_SCAN_NODES = MAX_TABLE_COLUMNS * 4;

/**
 * True for a `w:tc` the grid walk does not count, typed or demoted.
 *
 * A `w:tc` holding content the canonical tree does not admit demotes to `generic` and stays a
 * direct child of the row, so matching on kind alone would miss the very cell that stops the
 * grid cursor. The expanded name is what the walk should have counted, so it is what these
 * ask for. The same holds one level up for `w:tr`.
 */
function isCellLike(node: OoxmlNode): boolean {
  return node.kind === 'tableCell' || isWmlElement(node, 'tc');
}

function isRowLike(node: OoxmlNode): boolean {
  return node.kind === 'tableRow' || isWmlElement(node, 'tr');
}

/** Iterative, budgeted, fail-closed search for a cell or row anywhere under `root`. */
export function subtreeHolds(root: OoxmlNode, want: 'cell' | 'row'): boolean {
  const matches = want === 'cell' ? isCellLike : isRowLike;
  const stack: OoxmlNode[] = [root];
  let budget = WRAPPED_SCAN_NODES;
  while (stack.length > 0) {
    if (budget <= 0 || stack.length > WRAPPED_SCAN_NODES) return true;
    budget -= 1;
    const node = stack.pop()!;
    if (matches(node)) return true;
    if (node.kind === 'textValue') continue;
    for (const child of node.children) stack.push(child);
  }
  return false;
}

/**
 * True when the row holds a `w:tc` inside a cell-level wrapper such as `w:sdt`.
 *
 * {@link buildRowGridSlots} walks direct `w:tc` children only, so a wrapped cell never
 * advances the grid cursor and every later cell maps one column too far left. Callers refuse
 * rather than write a merge marker into a column that carries no chain. The scan has no depth
 * cap — a depth cap would answer "not wrapped" for the one shape it cannot see, which is the
 * wrong way for an attacker-controlled tree to fail. The budget is per direct child, so a row
 * carrying many benign leaf annotations such as `w:bookmarkStart` still inserts.
 */
export function rowHidesCellInWrapper(row: OoxmlTableRowNode): boolean {
  for (const child of row.children) {
    // Only a TYPED cell advances the grid cursor, so a demoted `w:tc` counts as hidden.
    if (child.kind === 'tableCell') continue;
    if (subtreeHolds(child, 'cell')) return true;
  }
  return false;
}

/**
 * True when any cell of the row carries `w:vMerge`, wrapped or not.
 *
 * Reading a marker does not need the grid mapping, so this stays trustworthy on a row whose
 * shape {@link rowHidesCellInWrapper} rejects — which is the point: a hidden marker must not
 * let the boundary read as merge-free. A cell's own children are never walked, so a nested
 * table's merges stay its own. An exhausted budget reads as "merged", fail-closed.
 */
export function rowHasVerticalMerge(
  row: OoxmlTableRowNode,
  only: VerticalMergeKind | 'any' = 'any'
): boolean {
  // Seeded with the row, not its children: a spread would let the breadth check fire before
  // a single node is examined, so a wide row would report "merged" without being read.
  const stack: OoxmlNode[] = [row];
  let budget = WRAPPED_SCAN_NODES;
  while (stack.length > 0) {
    if (budget <= 0 || stack.length > WRAPPED_SCAN_NODES) return true;
    budget -= 1;
    const node = stack.pop()!;
    if (node.kind === 'textValue') continue;
    if (isCellLike(node)) {
      const tcPr = wmlChildNamed(node, 'tcPr');
      const kind = readVMergeKind(tcPr);
      if (kind !== 'none' && (only === 'any' || only === kind)) return true;
      continue;
    }
    for (const child of node.children) stack.push(child);
  }
  return false;
}

/**
 * True when a wrapper hiding a `w:tr` sits between the two rows an insertion reads as
 * adjacent.
 *
 * `EditableTableTopology` lists direct `w:tr` children only, but the new row is spliced by
 * sibling index. A `w:sdt` wrapping a row between them makes the boundary look tighter than
 * it is, so `w:vMerge` would be written against a chain the new row does not actually touch.
 */
export function tableHidesRowBetween(
  table: OoxmlElement,
  upperRowId: string,
  lowerRowId: string
): boolean {
  const upper = table.children.findIndex((child) => child.id === upperRowId);
  const lower = table.children.findIndex((child) => child.id === lowerRowId);
  if (upper === -1 || lower === -1 || lower <= upper + 1) return false;
  for (let index = upper + 1; index < lower; index += 1) {
    if (subtreeHolds(table.children[index]!, 'row')) return true;
  }
  return false;
}

export function gridIntervalsMatchExactly(
  aStart: number,
  aSpan: number,
  bStart: number,
  bSpan: number
): boolean {
  // A file-supplied `w:gridSpan` can push `startCol` to the column ceiling, where the clamp
  // leaves every further cell the same zero-width interval. Those must never match, or a
  // hostile grid steers `w:vMerge` into a column that carries no chain.
  if (aSpan <= 0 || bSpan <= 0) return false;
  return aStart === bStart && aSpan === bSpan;
}

function coveredAcrossBoundary(
  slot: GridCellSlot,
  otherSlots: readonly GridCellSlot[],
  side: 'upper' | 'lower'
): boolean {
  if (side === 'upper') {
    if (slot.vMergeKind === 'none') return false;
    return otherSlots.some(
      (other) =>
        other.vMergeKind === 'continue' &&
        gridIntervalsMatchExactly(slot.startCol, slot.span, other.startCol, other.span)
    );
  }
  if (slot.vMergeKind !== 'continue') return false;
  return otherSlots.some(
    (other) =>
      other.vMergeKind !== 'none' &&
      gridIntervalsMatchExactly(slot.startCol, slot.span, other.startCol, other.span)
  );
}

/**
 * Indexes (in source-row cell order) whose vertical-merge chain spans the insertion
 * boundary. A row inserted there repeats `w:vMerge` for those cells and only those.
 */
export function verticalMergeContinuationCells(
  topology: EditableTableTopology,
  rowIndex: number,
  where: 'above' | 'below'
): ReadonlySet<number> {
  const boundaryIndex = where === 'above' ? rowIndex : rowIndex + 1;
  if (boundaryIndex <= 0 || boundaryIndex >= topology.rows.length) return NO_CONTINUATIONS;
  const upperSlots = buildRowGridSlots(topology.rows[boundaryIndex - 1]!.row);
  const lowerSlots = buildRowGridSlots(topology.rows[boundaryIndex]!.row);
  // The source row is always the boundary's own side: `above` inserts before it, `below` after.
  const side = where === 'above' ? 'lower' : 'upper';
  const sourceSlots = side === 'lower' ? lowerSlots : upperSlots;
  const otherSlots = side === 'lower' ? upperSlots : lowerSlots;
  const continuations = new Set<number>();
  for (let index = 0; index < sourceSlots.length; index += 1) {
    if (coveredAcrossBoundary(sourceSlots[index]!, otherSlots, side)) continuations.add(index);
  }
  return continuations.size === 0 ? NO_CONTINUATIONS : continuations;
}
