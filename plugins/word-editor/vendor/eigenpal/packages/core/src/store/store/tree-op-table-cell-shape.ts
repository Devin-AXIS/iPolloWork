import { createTableReadCache } from './table-read-cache.ts';
// Shared reads and property patches for cell merge and split.
//
// Both operations rebuild one table and publish it with a single `replaceNode`. Cells and
// paragraphs that stay keep their node ids, so the journal records a moved paragraph as a move
// and a peer's typing inside it still lands in it.
//
// The table is read as a placed grid: every direct cell gets its grid columns and, through its
// `w:vMerge` chain, the rows of its visual cell. A table the grid cannot describe is refused,
// never approximated: a legacy `w:hMerge`, a row or cell inside a wrapper element, a broken
// `w:vMerge` chain, or a pending cell revision.

import type { WmlFreshNamespaceContext } from '../package/wml-namespace.ts';
import {
  WML_NAMESPACE_URI,
  type OoxmlAttribute,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
  type OoxmlTableCellNode,
} from '../package/ooxml-tree.ts';
import { readTwipsMeasure } from '../units.ts';
import { resolveTableTopologyLimits, type TableTopologyLimits } from './table-constraints.ts';
import {
  buildPlacedCellIndex,
  validateVMergeChains,
  type PlacedCell,
  type PlacedCellIndex,
} from './tree-op-table-cell-properties.ts';
import { patchTcPrChild, removeTcPrChild } from './tree-op-table-properties.ts';
import { isWmlElement, wmlAttributeValue, wmlChildNamed } from './tree-op-table-shared.ts';
import { readEditableTableTopology, type EditableTableTopology } from './tree-op-table-topology.ts';
import { rowHidesCellInWrapper, subtreeHolds } from './tree-op-table-vmerge.ts';
import { freshWmlElement, mapTopologyRejection } from './tree-op-tables.ts';
import type { TreeOpRejection } from './tree-op-types.ts';

/** The most rows or columns one split creates, the limit the split dialog offers. */
export const MAX_CELL_SPLIT_COUNT = 63;

/** A visual cell: its owning cell and the grid rectangle it covers. */
export interface VisualCell {
  readonly owner: PlacedCell;
  readonly rowFrom: number;
  readonly rowTo: number;
  readonly colFrom: number;
  readonly colTo: number;
}

export interface MergeableTable {
  readonly topology: EditableTableTopology;
  readonly index: PlacedCellIndex;
  readonly limits: ReturnType<typeof resolveTableTopologyLimits>;
  /** Owner cell id to the last row its `w:vMerge` chain reaches. */
  readonly lastRowOf: ReadonlyMap<string, number>;
  /** Grid column widths in twips, or null when the table has no readable `w:tblGrid`. */
  readonly gridWidths: readonly number[] | null;
}

const REVISION_TCPR = ['cellIns', 'cellDel', 'cellMerge', 'tcPrChange'];
const REVISION_TRPR = ['ins', 'del', 'trPrChange'];

function hasLegacyHorizontalMerge(topology: EditableTableTopology): boolean {
  for (const entry of topology.rows) {
    for (const cell of entry.cells) {
      const tcPr = wmlChildNamed(cell, 'tcPr');
      if (tcPr && wmlChildNamed(tcPr, 'hMerge')) return true;
    }
  }
  return false;
}

function hidesStructure(topology: EditableTableTopology): boolean {
  for (const child of topology.table.children) {
    if (child.kind === 'tableRow') continue;
    if (subtreeHolds(child, 'row')) return true;
  }
  return topology.rows.some((entry) => rowHidesCellInWrapper(entry.row));
}

function readGridWidths(topology: EditableTableTopology, columnCount: number): number[] | null {
  if (!topology.grid || topology.gridColumns.length < columnCount) return null;
  const widths: number[] = [];
  for (const column of topology.gridColumns) {
    const width = readTwipsMeasure(wmlAttributeValue(column, 'w'));
    if (width === null || width <= 0) return null;
    widths.push(width);
  }
  return widths;
}

type MergeableTableResult =
  | { readonly ok: true; readonly table: MergeableTable }
  | { readonly ok: false; readonly reason: TreeOpRejection };
const cachedMergeableTable = createTableReadCache<EditableTableTopology, MergeableTableResult>();

/** Read a table for merge or split, or say why its grid cannot be trusted. */
export function readMergeableTable(
  part: OoxmlPart,
  tableId: unknown,
  limits?: TableTopologyLimits
):
  | { readonly ok: true; readonly table: MergeableTable }
  | { readonly ok: false; readonly reason: TreeOpRejection } {
  if (typeof tableId !== 'string' || tableId.length === 0) {
    return { ok: false, reason: 'invalidArgs' };
  }
  const resolved = resolveTableTopologyLimits(limits);
  const read = readEditableTableTopology(part.root, tableId, resolved);
  if (!read.ok) return { ok: false, reason: mapTopologyRejection(read.reason) };
  const { topology } = read;
  return cachedMergeableTable(topology, topology, resolved, () =>
    readMergeableTopology(topology, resolved)
  );
}

function readMergeableTopology(
  topology: EditableTableTopology,
  resolved: TableTopologyLimits
): MergeableTableResult {
  if (topology.rows.length === 0) return { ok: false, reason: 'tree-invariant' };
  if (hidesStructure(topology)) return { ok: false, reason: 'row-hides-cell' };
  if (hasLegacyHorizontalMerge(topology)) return { ok: false, reason: 'table-has-merge' };
  const built = buildPlacedCellIndex(topology, resolved);
  // A continuation with no merge above it is the same broken chain as below.
  if (!built.ok) {
    return {
      ok: false,
      reason: built.reason === 'tree-invariant' ? 'row-hides-cell' : built.reason,
    };
  }
  // A broken chain comes from the file or from concurrent edits; the grid cannot place it.
  if (!validateVMergeChains(built.index)) return { ok: false, reason: 'row-hides-cell' };
  const lastRowOf = new Map<string, number>();
  let columnCount = 0;
  for (const entry of built.index.placed) {
    lastRowOf.set(entry.visualOwner.cell.id, entry.rowIndex);
    columnCount = Math.max(columnCount, entry.endCol + 1);
  }
  return {
    ok: true,
    table: {
      topology,
      index: built.index,
      limits: resolved,
      lastRowOf,
      gridWidths: readGridWidths(topology, columnCount),
    },
  };
}

export function visualCellOf(table: MergeableTable, entry: PlacedCell): VisualCell {
  const owner = entry.visualOwner;
  return {
    owner,
    rowFrom: owner.rowIndex,
    rowTo: table.lastRowOf.get(owner.cell.id) ?? owner.rowIndex,
    colFrom: owner.startCol,
    colTo: owner.endCol,
  };
}

/** Whether a cell or its row carries a pending revision a structural edit would discard. */
export function cellHasRevision(table: MergeableTable, entry: PlacedCell): boolean {
  const tcPr = wmlChildNamed(entry.cell, 'tcPr');
  if (tcPr && REVISION_TCPR.some((name) => wmlChildNamed(tcPr, name))) return true;
  const trPr = wmlChildNamed(table.topology.rows[entry.rowIndex]!.row, 'trPr');
  return trPr !== undefined && REVISION_TRPR.some((name) => wmlChildNamed(trPr, name));
}

/** The cell's block content: every child but `w:tcPr`. */
export function cellBlocks(cell: OoxmlTableCellNode): OoxmlNode[] {
  return cell.children.filter((child) => !isWmlElement(child, 'tcPr'));
}

function runIsBlank(run: OoxmlElement): boolean {
  return run.children.every((child) => isWmlElement(child, 'rPr'));
}

/** One paragraph holding no text, picture, field, bookmark, or other content. */
export function cellIsBlank(cell: OoxmlTableCellNode): boolean {
  const blocks = cellBlocks(cell);
  if (blocks.length !== 1 || blocks[0]!.kind !== 'paragraph') return false;
  return blocks[0]!.children.every(
    (child) =>
      isWmlElement(child, 'pPr') ||
      isWmlElement(child, 'proofErr') ||
      (isWmlElement(child, 'r') && runIsBlank(child))
  );
}

function wmlAttribute(
  localName: string,
  value: string,
  wml: WmlFreshNamespaceContext
): OoxmlAttribute {
  return localName === 'val'
    ? {
        kind: 'wmlVal',
        namespaceUri: WML_NAMESPACE_URI,
        localName,
        prefix: wml.attributePrefix,
        value,
      }
    : {
        kind: 'genericExtension',
        namespaceUri: WML_NAMESPACE_URI,
        localName,
        prefix: wml.attributePrefix,
        value,
      };
}

/** A leaf with exactly these WML attributes, reusing the existing leaf's node id. */
function leafWith(
  existing: OoxmlElement | undefined,
  localName: string,
  values: readonly (readonly [string, string])[],
  nextId: () => string,
  wml: WmlFreshNamespaceContext
): OoxmlElement {
  const attributes = values.map(([name, value]) => wmlAttribute(name, value, wml));
  if (!existing) return freshWmlElement(localName, nextId, wml, attributes);
  const kept = existing.attributes.filter(
    (attribute) =>
      attribute.namespaceUri !== WML_NAMESPACE_URI ||
      !values.some(([name]) => name === attribute.localName)
  );
  const prefixed = attributes.map((attribute) => {
    const previous = existing.attributes.find(
      (candidate) =>
        candidate.namespaceUri === WML_NAMESPACE_URI && candidate.localName === attribute.localName
    );
    return previous ? { ...attribute, prefix: previous.prefix } : attribute;
  });
  return Object.freeze({ ...existing, attributes: [...kept, ...prefixed] }) as OoxmlElement;
}

export interface CellShape {
  readonly span: number;
  readonly vMerge: 'none' | 'restart' | 'continue';
  /** Width in twips for a `dxa` `w:tcW`; null keeps the cell's own width. */
  readonly widthTwips: number | null;
}

function patched(container: OoxmlElement, result: ReturnType<typeof patchTcPrChild>): OoxmlElement {
  return result.ok ? result.container : container;
}

/** `w:tcPr` with the span, vertical merge, and width of `shape`; other properties stay. */
export function cellPropertiesFor(
  base: OoxmlElement | undefined,
  shape: CellShape,
  nextId: () => string,
  wml: WmlFreshNamespaceContext
): OoxmlElement {
  let tcPr = base ?? freshWmlElement('tcPr', nextId, wml, []);
  if (shape.widthTwips !== null) {
    const width = leafWith(
      wmlChildNamed(tcPr, 'tcW'),
      'tcW',
      [
        ['w', String(Math.round(shape.widthTwips))],
        ['type', 'dxa'],
      ],
      nextId,
      wml
    );
    tcPr = patched(tcPr, patchTcPrChild(tcPr, width));
  }
  tcPr =
    shape.span > 1
      ? patched(
          tcPr,
          patchTcPrChild(
            tcPr,
            leafWith(
              wmlChildNamed(tcPr, 'gridSpan'),
              'gridSpan',
              [['val', String(shape.span)]],
              nextId,
              wml
            )
          )
        )
      : patched(tcPr, removeTcPrChild(tcPr, 'gridSpan'));
  if (shape.vMerge === 'none') return patched(tcPr, removeTcPrChild(tcPr, 'vMerge'));
  const existing = wmlChildNamed(tcPr, 'vMerge');
  const vMerge =
    shape.vMerge === 'restart'
      ? leafWith(existing, 'vMerge', [['val', 'restart']], nextId, wml)
      : existing && wmlAttributeValue(existing, 'val') !== 'restart'
        ? existing
        : freshWmlElement('vMerge', nextId, wml, []);
  return patched(tcPr, patchTcPrChild(tcPr, vMerge));
}

/** The cell with `tcPr` as its first child in place of its own. */
export function cellWithProperties(
  cell: OoxmlTableCellNode,
  tcPr: OoxmlElement,
  blocks: readonly OoxmlNode[] = cellBlocks(cell)
): OoxmlTableCellNode {
  return Object.freeze({ ...cell, children: [tcPr, ...blocks] }) as OoxmlTableCellNode;
}

/** Sum of grid widths over `[from, to]`, or null without a readable grid. */
export function gridWidthOver(table: MergeableTable, from: number, to: number): number | null {
  if (!table.gridWidths || to >= table.gridWidths.length) return null;
  let sum = 0;
  for (let col = from; col <= to; col += 1) sum += table.gridWidths[col]!;
  return sum;
}

/** The `dxa` width a cell declares, or null when it declares another unit or none. */
export function declaredDxaWidth(cell: OoxmlTableCellNode): number | null {
  const tcPr = wmlChildNamed(cell, 'tcPr');
  const tcW = tcPr && wmlChildNamed(tcPr, 'tcW');
  if (!tcW) return null;
  const type = wmlAttributeValue(tcW, 'type');
  if (type !== undefined && type !== 'dxa') return null;
  const width = readTwipsMeasure(wmlAttributeValue(tcW, 'w'));
  return width !== null && width > 0 ? width : null;
}
