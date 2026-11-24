// Vertical-merge repair for a removed table row.
//
// A `w:vMerge w:val="restart"` cell leaves with its row, content included. The cell below it
// at the same grid interval is then a continuation under a new neighbour. If that neighbour
// has a merged cell on the same grid interval, the continuation joins it and nothing
// changes. Otherwise it continues nothing: it becomes the new `restart` when the chain goes
// on past it, and loses `w:vMerge` when it was the chain's last row. Its own content stays,
// and no row further down changes. Layout reads a continuation by the same rule.
//
// Rows and cells inside content controls count where they stand, as they do for layout.

import {
  findNode,
  removeNode,
  replaceNode,
  type EditOptions,
  type OoxmlEditResult,
} from '../package/ooxml-edit.ts';
import {
  WML_NAMESPACE_URI,
  type OoxmlAttribute,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
  type OoxmlTableRowNode,
} from '../package/ooxml-tree.ts';
import { wmlFreshNamespaceContextAt } from '../package/wml-namespace.ts';
import { flattenContentControls } from '../package/content-control-nodes.ts';
import { tableAncestorOf, wmlChildNamed } from './tree-op-table-shared.ts';
import {
  buildCellGridSlots,
  gridIntervalsMatchExactly,
  rowHasVerticalMerge,
  subtreeHolds,
  type GridCellSlot,
} from './tree-op-table-vmerge.ts';
import type { TreeOpRejection } from './tree-op-types.ts';

export interface VerticalMergeHeadRepair {
  readonly rowId: string;
  readonly cellId: string;
  /** The orphaned continuation marker. */
  readonly marker: OoxmlElement;
  /** `restart` when the chain goes on below the cell; otherwise the marker is removed. */
  readonly becomes: 'restart' | 'unmerged';
}

export type VerticalMergeHeadRepairPlan =
  | { readonly ok: true; readonly repairs: readonly VerticalMergeHeadRepair[] }
  | { readonly ok: false; readonly reason: TreeOpRejection };

const NO_REPAIRS: VerticalMergeHeadRepairPlan = { ok: true, repairs: [] };

/**
 * Typed rows or cells of `root` in document order. Content controls unwrap as they do for
 * layout, so both read the same grid. Any other element holding a row or cell, such as
 * `w:customXml`, stands in the sequence as `null`: a place the walk cannot read.
 */
function flatten<T extends OoxmlNode>(root: OoxmlElement, want: 'row' | 'cell'): (T | null)[] {
  const kind = want === 'row' ? 'tableRow' : 'tableCell';
  const items: (T | null)[] = [];
  for (const node of flattenContentControls(root.children)) {
    if (node.kind === kind) items.push(node as T);
    else if (node.kind !== 'textValue' && subtreeHolds(node, want)) items.push(null);
  }
  return items;
}

interface ReadRow {
  readonly row: OoxmlTableRowNode;
  readonly cells: readonly OoxmlElement[];
  readonly slots: readonly GridCellSlot[];
}

/** The row's grid, or null when a cell hides where the walk cannot read it. */
function readRow(row: OoxmlTableRowNode | null): ReadRow | null {
  if (!row) return null;
  const cells = flatten<OoxmlElement>(row, 'cell');
  if (cells.includes(null)) return null;
  const typed = cells as OoxmlElement[];
  return { row, cells: typed, slots: buildCellGridSlots(row, typed) };
}

function sameInterval(a: GridCellSlot, b: GridCellSlot): boolean {
  return gridIntervalsMatchExactly(a.startCol, a.span, b.startCol, b.span);
}

/**
 * The continuation markers that removing `rowId` would orphan, and what each becomes.
 * Refuses `row-hides-cell` when the tree hides a cell or row the answer depends on, because
 * a guessed grid would write the marker into a column with no chain.
 */
export function planVerticalMergeHeadRepairs(
  part: OoxmlPart,
  rowId: string
): VerticalMergeHeadRepairPlan {
  const target = findNode(part, rowId);
  // Only a removed `restart` leaves a continuation behind, wrapped or not.
  if (!target || target.kind !== 'tableRow' || !rowHasVerticalMerge(target, 'restart')) {
    return NO_REPAIRS;
  }
  const table = tableAncestorOf(part, rowId);
  if (!table) return NO_REPAIRS;
  // Only the rows next to the removed one decide the repair, so only they must be readable.
  const rows = flatten<OoxmlTableRowNode>(table, 'row');
  const index = rows.findIndex((row) => row !== null && row.id === rowId);
  if (index === -1) return { ok: false, reason: 'row-hides-cell' };
  // Nothing continues below: no repair, whatever the removed row's own shape.
  if (index + 1 >= rows.length) return NO_REPAIRS;
  const belowRow = rows[index + 1] ?? null;
  if (belowRow && !rowHasVerticalMerge(belowRow, 'continue')) return NO_REPAIRS;
  const removed = readRow(target);
  const below = readRow(belowRow);
  if (!removed || !below) return { ok: false, reason: 'row-hides-cell' };
  const heads = removed.slots.filter((slot) => slot.vMergeKind === 'restart');
  const candidates = below.slots.flatMap((slot, cellIndex) =>
    slot.vMergeKind === 'continue' && heads.some((head) => sameInterval(head, slot))
      ? [{ slot, cell: below.cells[cellIndex]! }]
      : []
  );
  if (candidates.length === 0) return NO_REPAIRS;

  // Each neighbour is read only when a candidate needs it, and must then be readable.
  const neighbour = (offset: number): ReadRow | 'none' | 'unreadable' => {
    const at = index + offset;
    if (at < 0 || at >= rows.length) return 'none';
    return readRow(rows[at] ?? null) ?? 'unreadable';
  };
  const above = neighbour(-1);
  if (above === 'unreadable') return { ok: false, reason: 'row-hides-cell' };
  let next: ReadRow | 'none' | 'unreadable' | undefined;

  const repairs: VerticalMergeHeadRepair[] = [];
  for (const { slot, cell } of candidates) {
    // A merged cell above on the same grid interval takes the continuation over. The exact
    // interval is what the store's merge chains match on, so the result stays a valid chain.
    const joins =
      above !== 'none' &&
      above.slots.some((other) => other.vMergeKind !== 'none' && sameInterval(slot, other));
    if (joins) continue;
    next ??= neighbour(2);
    if (next === 'unreadable') return { ok: false, reason: 'row-hides-cell' };
    const continues =
      next !== 'none' &&
      next.slots.some((other) => other.vMergeKind === 'continue' && sameInterval(slot, other));
    repairs.push({
      rowId: below.row.id,
      cellId: cell.id,
      marker: wmlChildNamed(wmlChildNamed(cell, 'tcPr')!, 'vMerge')!,
      becomes: continues ? 'restart' : 'unmerged',
    });
  }
  return { ok: true, repairs };
}

function restartMarker(part: OoxmlPart, marker: OoxmlElement): OoxmlElement {
  const wml = wmlFreshNamespaceContextAt(part, marker);
  const val: OoxmlAttribute = {
    kind: 'wmlVal',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'val',
    prefix: wml.attributePrefix,
    value: 'restart',
  } as const;
  const kept = marker.attributes.filter(
    (attribute) => attribute.namespaceUri !== WML_NAMESPACE_URI || attribute.localName !== 'val'
  );
  return { ...marker, attributes: [...kept, val] } as OoxmlElement;
}

/**
 * One edit per repair, then the row's own removal, as steps for `applyEdits`. The steps defer
 * validation, because `applyEdits` validates the final part once.
 */
export function rowRemovalEdits(
  repairs: readonly VerticalMergeHeadRepair[],
  rowId: string,
  options?: EditOptions
): ((current: OoxmlPart) => OoxmlEditResult)[] {
  const step: EditOptions = { ...options, deferValidation: true };
  return [
    ...repairs.map(
      ({ marker, becomes }) =>
        (current: OoxmlPart) =>
          becomes === 'restart'
            ? replaceNode(current, marker.id, restartMarker(current, marker), step)
            : removeNode(current, marker.id, step)
    ),
    (current: OoxmlPart) => removeNode(current, rowId, step),
  ];
}

/** Ids a repair touches, for the op's `dirty` list. */
export function verticalMergeHeadRepairDirtyIds(
  repairs: readonly VerticalMergeHeadRepair[]
): string[] {
  return repairs.flatMap(({ rowId, cellId }) => [rowId, cellId]);
}
