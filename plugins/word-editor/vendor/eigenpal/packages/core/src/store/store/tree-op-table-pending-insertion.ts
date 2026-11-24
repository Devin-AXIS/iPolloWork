// Cell merge and split inside an author's own pending table insertion.
//
// A table proposed under tracking is one pending insertion: every row carries `w:trPr/w:ins`
// and every paragraph mark `w:pPr/w:rPr/w:ins`. Merging or splitting its cells only reshapes
// that proposal, so the store allows both when the op names the proposal's author. Every row,
// cell, and paragraph mark the edit adds copies the insertion marker of the row, cell, or
// paragraph it came from. Rejecting the insertion still removes the whole table, and accepting
// it keeps the new shape.

import type {
  OoxmlElement,
  OoxmlNode,
  OoxmlParagraphNode,
  OoxmlTableCellNode,
  OoxmlTableRowNode,
} from '../package/ooxml-tree.ts';
import type { WmlFreshNamespaceContext } from '../package/wml-namespace.ts';
import type { PlacedCell } from './tree-op-table-cell-properties.ts';
import type { MergeableTable } from './tree-op-table-cell-shape.ts';
import { patchTcPrChild, patchTrPrChild } from './tree-op-table-properties.ts';
import { wmlAttributeValue, wmlChildNamed } from './tree-op-table-shared.ts';
import { freshWmlElement } from './tree-op-tables.ts';
import { cloneWithNewIds } from './tree-op-nodes.ts';

const CELL_REVISIONS = ['cellIns', 'cellDel', 'cellMerge', 'tcPrChange'];
const ROW_REVISIONS = ['ins', 'del', 'trPrChange'];

function ownMarker(marker: OoxmlElement | undefined, author: string): boolean {
  return marker !== undefined && wmlAttributeValue(marker, 'author') === author;
}

/**
 * Whether a cell, or its row, carries a pending revision a structural edit would discard.
 *
 * With `ownInsertionAuthor`, the row must be that author's pending insertion, and the only
 * revisions allowed are that author's row and cell insertions. Any other revision still
 * blocks the edit.
 */
export function cellBlocksStructureEdit(
  table: MergeableTable,
  entry: PlacedCell,
  ownInsertionAuthor?: string
): boolean {
  const blocks = (container: OoxmlElement | undefined, name: string, allowed: string): boolean => {
    const marker = container && wmlChildNamed(container, name);
    if (!marker) return false;
    const allowedOwn =
      ownInsertionAuthor !== undefined && name === allowed && ownMarker(marker, ownInsertionAuthor);
    return !allowedOwn;
  };
  const tcPr = wmlChildNamed(entry.cell, 'tcPr');
  if (CELL_REVISIONS.some((name) => blocks(tcPr, name, 'cellIns'))) return true;
  const trPr = wmlChildNamed(table.topology.rows[entry.rowIndex]!.row, 'trPr');
  if (ROW_REVISIONS.some((name) => blocks(trPr, name, 'ins'))) return true;
  if (ownInsertionAuthor === undefined) return false;
  return !ownMarker(trPr && wmlChildNamed(trPr, 'ins'), ownInsertionAuthor);
}

/** A copy of `source`'s row insertion on `row`. A source with none leaves `row` unchanged. */
export function rowJoiningInsertion(
  row: OoxmlTableRowNode,
  source: OoxmlTableRowNode,
  nextId: () => string,
  wml: WmlFreshNamespaceContext
): OoxmlTableRowNode {
  const sourceTrPr = wmlChildNamed(source, 'trPr');
  const marker = sourceTrPr && wmlChildNamed(sourceTrPr, 'ins');
  if (!marker) return row;
  const trPr = wmlChildNamed(row, 'trPr');
  const patched = patchTrPrChild(
    trPr ?? freshWmlElement('trPr', nextId, wml, []),
    cloneWithNewIds(marker, nextId) as OoxmlElement
  );
  if (!patched.ok) return row;
  const children = trPr
    ? row.children.map((child) => (child === trPr ? patched.container : child))
    : [patched.container, ...row.children];
  return Object.freeze({ ...row, children }) as OoxmlTableRowNode;
}

/** A copy of `source`'s cell insertion on `cell`. A source with none leaves `cell` unchanged. */
export function cellJoiningInsertion(
  cell: OoxmlTableCellNode,
  source: OoxmlTableCellNode,
  nextId: () => string,
  wml: WmlFreshNamespaceContext
): OoxmlTableCellNode {
  const sourceTcPr = wmlChildNamed(source, 'tcPr');
  const marker = sourceTcPr && wmlChildNamed(sourceTcPr, 'cellIns');
  if (!marker) return cell;
  const tcPr = wmlChildNamed(cell, 'tcPr');
  const patched = patchTcPrChild(
    tcPr ?? freshWmlElement('tcPr', nextId, wml, []),
    cloneWithNewIds(marker, nextId) as OoxmlElement
  );
  if (!patched.ok) return cell;
  const children = tcPr
    ? cell.children.map((child) => (child === tcPr ? patched.container : child))
    : [patched.container, ...cell.children];
  return Object.freeze({ ...cell, children }) as OoxmlTableCellNode;
}

function markInsertionOf(paragraph: OoxmlNode): OoxmlElement | undefined {
  if (paragraph.kind !== 'paragraph') return undefined;
  const pPr = paragraph.children.find((child) => child.kind === 'paragraphProperties') as
    OoxmlElement | undefined;
  const rPr = pPr && wmlChildNamed(pPr, 'rPr');
  return rPr && wmlChildNamed(rPr, 'ins');
}

/** The mark insertion of the first paragraph in `cell` that has one. */
function cellMarkInsertion(cell: OoxmlTableCellNode): OoxmlElement | undefined {
  for (const child of cell.children) {
    const marker = markInsertionOf(child);
    if (marker) return marker;
  }
  return undefined;
}

/**
 * A copy of the first paragraph mark insertion in `source` on `paragraph`'s mark. A source
 * cell without one leaves the paragraph unchanged.
 */
export function paragraphJoiningInsertion(
  paragraph: OoxmlParagraphNode,
  source: OoxmlTableCellNode,
  nextId: () => string,
  wml: WmlFreshNamespaceContext
): OoxmlParagraphNode {
  const marker = cellMarkInsertion(source);
  if (!marker || markInsertionOf(paragraph)) return paragraph;
  const pPr = paragraph.children.find((child) => child.kind === 'paragraphProperties') as
    OoxmlElement | undefined;
  const rPr = pPr && wmlChildNamed(pPr, 'rPr');
  const runProperties: OoxmlElement = {
    ...(rPr ?? { ...freshWmlElement('rPr', nextId, wml, []), kind: 'runProperties' }),
    children: [cloneWithNewIds(marker, nextId), ...(rPr?.children ?? [])],
  } as OoxmlElement;
  // `w:sectPr` and `w:pPrChange` are the only `CT_PPr` children that follow `w:rPr`.
  const rest = (pPr?.children ?? []).filter((child) => child !== rPr);
  const trailing = (child: OoxmlNode) =>
    child.kind !== 'textValue' && (child.localName === 'sectPr' || child.localName === 'pPrChange');
  const properties: OoxmlElement = {
    ...(pPr ?? { ...freshWmlElement('pPr', nextId, wml, []), kind: 'paragraphProperties' }),
    children: [
      ...rest.filter((child) => !trailing(child)),
      runProperties,
      ...rest.filter(trailing),
    ],
  } as OoxmlElement;
  const children = pPr
    ? paragraph.children.map((child) => (child === pPr ? properties : child))
    : [properties, ...paragraph.children];
  return Object.freeze({ ...paragraph, children }) as OoxmlParagraphNode;
}

/** A fresh cell, and its paragraphs, joining the insertion `source` belongs to. */
export function freshCellJoiningInsertion(
  cell: OoxmlTableCellNode,
  source: OoxmlTableCellNode,
  nextId: () => string,
  wml: WmlFreshNamespaceContext
): OoxmlTableCellNode {
  const joined = cellJoiningInsertion(cell, source, nextId, wml);
  const children = joined.children.map((child) =>
    child.kind === 'paragraph' ? paragraphJoiningInsertion(child, source, nextId, wml) : child
  );
  return Object.freeze({ ...joined, children }) as OoxmlTableCellNode;
}
