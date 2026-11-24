// A table edit first merges the property containers a concurrent merge repeated.
//
// Two collaborators who each give one row a property at once each write a `w:trPr` when it
// had none, and every replica shows both. Table edits refuse a row with two (`readEditable-
// TableTopology`), so without this no peer could edit that table again until a reopen. The
// edit that next names the table merges them first, by the rule a save and a read use, with
// ordinary writes every replica already applies: the merged container replaces the first
// copy, and the later copies go. Nodes a later copy held are written anew, under fresh ids.
//
// Two peers who heal at once each write the merge, and the shared list can then hold a
// property twice inside the one container left. A save keeps the later one, as it does for
// any repeat. A repeat of revision markup is never merged: the edit refuses it as before.

import { isCanonicalPrimitiveCaptureActive } from '../package/canonical-primitive-capture.ts';
import {
  createNodeIdAllocator,
  findNode,
  removeNode,
  replaceNode,
  type EditOptions,
} from '../package/ooxml-edit.ts';
import {
  mergedPropertyContainers,
  withoutRepeatedProperties,
} from '../package/ooxml-property-order.ts';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import type { TreeDocOp, TreeOpRejection } from './tree-op-types.ts';
import { WML_NAMESPACE_URI, isWmlElement } from './tree-op-table-shared.ts';

type Write =
  | { readonly kind: 'replace'; readonly id: string; readonly node: OoxmlNode }
  | { readonly kind: 'remove'; readonly id: string };

/** The ids of `node` and everything below it. */
function idsBelow(node: OoxmlNode, into: Set<string>): Set<string> {
  into.add(node.id);
  if (node.kind !== 'textValue') for (const child of node.children) idsBelow(child, into);
  return into;
}

/** `node` with every id outside `kept` minted anew. */
function withFreshIds(node: OoxmlNode, kept: ReadonlySet<string>, nextId: () => string): OoxmlNode {
  const id = kept.has(node.id) ? node.id : nextId();
  if (node.kind === 'textValue') return id === node.id ? node : { ...node, id };
  const children = node.children.map((child) => withFreshIds(child, kept, nextId));
  return { ...node, id, children } as OoxmlElement;
}

/** The writes that leave `parent` (a row or a cell) with one of each property container. */
function containerWrites(parent: OoxmlElement, nextId: () => string, writes: Write[]): void {
  const merged = mergedPropertyContainers(parent.localName, parent.children);
  if (merged === parent.children) return;
  const kept = new Set(merged);
  for (const child of parent.children) {
    if (kept.has(child)) continue;
    const replacement = merged.find((node) => node.id === child.id);
    if (replacement) {
      writes.push({
        kind: 'replace',
        id: child.id,
        node: withFreshIds(replacement, idsBelow(child, new Set()), nextId),
      });
    } else {
      writes.push({ kind: 'remove', id: child.id });
    }
  }
}

/** The writes that drop the earlier copies of a property a cell's `w:tcPr` repeats. */
function repeatWrites(cell: OoxmlElement, writes: Write[]): void {
  const tcPr = cell.children.find((child) => isWmlElement(child, 'tcPr'));
  if (!tcPr || tcPr.kind === 'textValue') return;
  const kept = withoutRepeatedProperties('tcPr', tcPr.children);
  if (kept === tcPr.children) return;
  const keep = new Set(kept);
  for (const child of tcPr.children) {
    if (!keep.has(child)) writes.push({ kind: 'remove', id: child.id });
  }
}

/** The table an op names, or null for an op that names none. */
export function tableIdOf(op: TreeDocOp): string | null {
  // Automation names the table it edits inside its action.
  const owner: object =
    op.op === 'authorTable' && typeof op.action === 'object' && op.action !== null ? op.action : op;
  if (!Object.hasOwn(owner, 'tableId')) return null;
  const id = (owner as { readonly tableId?: unknown }).tableId;
  return typeof id === 'string' ? id : null;
}

// Tables, and rows, whose rows and cells repeat no property container. Nodes never change in
// place, so the answer holds for as long as the node does. An edit makes new nodes only on its
// path: typing in one cell makes a new table and a new row, and the other rows keep theirs.
// Without these, every check of a table edit scans every row: a toolbar asks about each of
// its table controls whenever the caret enters another cell.
const tablesWithoutRepeats = new WeakSet<OoxmlElement>();
const rowsWithoutRepeats = new WeakSet<OoxmlElement>();

/**
 * `part` with the rows and cells of table `tableId` merged to one of each property container,
 * `part` itself when none repeats or the table is not found, or null when a write fails. A
 * write that failed may already be recorded for collaboration, so the caller refuses the op.
 */
export function healedTableProperties(
  part: OoxmlPart,
  tableId: string,
  options?: EditOptions
): OoxmlPart | null {
  const table = findNode(part, tableId);
  if (!table || table.kind === 'textValue' || table.namespaceUri !== WML_NAMESPACE_URI) {
    return part;
  }
  if (tablesWithoutRepeats.has(table)) return part;
  let nextId: (() => string) | null = null;
  const mint = () => (nextId ??= createNodeIdAllocator(part, 'new'))();
  const writes: Write[] = [];
  // Rows that need no container write; each keeps its node, so the repeat pass meets it again.
  const merged = new Set<OoxmlElement>();
  for (const row of table.children) {
    if (!isWmlElement(row, 'tr') || rowsWithoutRepeats.has(row)) continue;
    const before = writes.length;
    containerWrites(row, mint, writes);
    for (const cell of row.children) {
      if (!isWmlElement(cell, 'tc')) continue;
      containerWrites(cell, mint, writes);
    }
    if (writes.length === before) merged.add(row);
  }
  // A cell's repeats are read after its containers merge, so they follow those writes.
  let healed = part;
  for (const write of writes) {
    const result =
      write.kind === 'replace'
        ? replaceNode(healed, write.id, write.node, options)
        : removeNode(healed, write.id, options);
    if (!result.ok) return null;
    healed = result.part;
  }
  const after = findNode(healed, tableId);
  if (!after || after.kind === 'textValue') return null;
  const repeats: Write[] = [];
  for (const row of after.children) {
    if (!isWmlElement(row, 'tr') || rowsWithoutRepeats.has(row)) continue;
    const before = repeats.length;
    for (const cell of row.children) if (isWmlElement(cell, 'tc')) repeatWrites(cell, repeats);
    if (repeats.length === before && merged.has(row)) rowsWithoutRepeats.add(row);
  }
  if (writes.length === 0 && repeats.length === 0) {
    tablesWithoutRepeats.add(table);
    return part;
  }
  for (const write of repeats) {
    const result = removeNode(healed, write.id, options);
    if (!result.ok) return null;
    healed = result.part;
  }
  return healed;
}

/**
 * `validate` run on the table a table edit's heal leaves, or undefined when the heal changes
 * nothing, so the caller validates `part` itself. A toolbar asking whether an edit may run
 * then gets the answer the run gives. Inside a recorded transaction the edit heals itself
 * before it validates, and a heal here would be recorded twice, so none runs there.
 */
export function judgedOnHealedTable(
  part: OoxmlPart,
  op: TreeDocOp,
  validate: (healed: OoxmlPart) => TreeOpRejection | null
): TreeOpRejection | null | undefined {
  const tableId = tableIdOf(op);
  if (tableId === null || isCanonicalPrimitiveCaptureActive()) return undefined;
  const healed = healedTableProperties(part, tableId);
  if (healed === null) return 'tree-invariant';
  return healed === part ? undefined : validate(healed);
}

/** `children` of a row or a cell as its heal leaves them, built as plain objects. */
function healedChildren(parent: OoxmlElement): readonly OoxmlNode[] {
  const merged = mergedPropertyContainers(parent.localName, parent.children);
  if (parent.localName !== 'tc') return merged;
  const at = merged.findIndex((child) => isWmlElement(child, 'tcPr'));
  const tcPr = merged[at];
  if (!tcPr || tcPr.kind === 'textValue') return merged;
  const kept = withoutRepeatedProperties('tcPr', tcPr.children);
  if (kept === tcPr.children) return merged;
  const children = [...merged];
  children[at] = { ...tcPr, children: kept } as OoxmlElement;
  return children;
}

/**
 * `table` as a table edit's heal leaves it, or `table` itself when no row or cell repeats a
 * property container. Built as plain objects, with every row and cell keeping its id, it
 * records nothing, so a reader outside an edit (a command plan, automation, a resize drag)
 * sees the table the edit will act on, and layout shows what a save writes. A repeat the
 * heal cannot merge stays, for the reader's own refusal.
 *
 * @internal
 */
export function healedTableView<Table extends OoxmlElement>(table: Table): Table {
  let rows: OoxmlNode[] | null = null;
  table.children.forEach((row, rowAt) => {
    if (!isWmlElement(row, 'tr')) return;
    const healed = healedRow(row);
    if (healed === row) return;
    rows ??= [...table.children];
    rows[rowAt] = healed;
  });
  return rows ? ({ ...table, children: rows } as Table) : table;
}

/** `row` with its containers and its cells' containers healed, or `row` itself. */
function healedRow(row: OoxmlElement): OoxmlElement {
  const own = healedChildren(row);
  let children: OoxmlNode[] | null = own === row.children ? null : [...own];
  own.forEach((cell, at) => {
    if (!isWmlElement(cell, 'tc')) return;
    const cellChildren = healedChildren(cell);
    if (cellChildren === cell.children) return;
    children ??= [...own];
    children[at] = { ...cell, children: cellChildren } as OoxmlElement;
  });
  return children ? ({ ...row, children } as OoxmlElement) : row;
}
