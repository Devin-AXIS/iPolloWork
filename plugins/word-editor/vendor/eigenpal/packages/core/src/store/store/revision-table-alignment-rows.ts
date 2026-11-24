import {
  createNodeIdAllocator,
  findNode,
  parentNodeOf,
  replaceChildren,
  type EditOptions,
} from '../package/ooxml-edit.ts';
import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { patchPropertyChild, patchTblPrChild, patchTrPrChild } from './tree-op-table-properties.ts';
import { cloneWithNewIds } from './tree-op-nodes.ts';
import { wmlElement } from './tree-op-content-controls.ts';
import { nextRevisionId } from './tree-op-revision-ids.ts';
import { boundTableAlignments } from './revision-table-unbound-history.ts';
import type { RevisionSite } from './tree-op-revisions.ts';

/** `CT_TblPrExBase` child order (17.4.61), plus the trailing change record. */
const CT_TBLPREX_SEQUENCE: readonly string[] = [
  'tblW',
  'jc',
  'tblCellSpacing',
  'tblInd',
  'tblBorders',
  'shd',
  'tblLayout',
  'tblCellMar',
  'tblLook',
  'tblPrExChange',
];

/** Row and cell history: what makes a table alignment change apply to a row. */
const ROW_RECORDS: ReadonlySet<string> = new Set(['trPrChange', 'tcPrChange', 'tblPrExChange']);

const isW = (node: OoxmlNode, name: string): boolean =>
  node.kind !== 'textValue' && node.namespaceUri === WML_NAMESPACE_URI && node.localName === name;
function elements(node: OoxmlElement, name: string): OoxmlElement[] {
  const found: OoxmlElement[] = [];
  for (const child of node.children) if (isW(child, name)) found.push(child as OoxmlElement);
  return found;
}
const attribute = (node: OoxmlElement, name: string) =>
  node.attributes.find((a) => a.namespaceUri === WML_NAMESPACE_URI && a.localName === name)?.value;

/** The row's own history records, without those of tables nested in its cells. */
function rowRecords(row: OoxmlElement): OoxmlElement[] {
  const found: OoxmlElement[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue' || isW(node, 'tbl')) return;
    if (node.namespaceUri === WML_NAMESPACE_URI && ROW_RECORDS.has(node.localName))
      found.push(node as OoxmlElement);
    for (const child of node.children) visit(child);
  };
  for (const child of row.children) visit(child);
  return found;
}

interface AlignedTable {
  readonly history: string;
  readonly tableId: string;
  readonly value: string;
  /** Each row with the history records it held before the decision. */
  readonly rows: readonly { readonly id: string; readonly records: readonly OoxmlElement[] }[];
}

function alignedTables(part: OoxmlPart, sites: readonly RevisionSite[]): AlignedTable[] {
  const result: AlignedTable[] = [];
  for (const history of boundTableAlignments(part, sites)) {
    const tblPr = parentNodeOf(part, history);
    const table = tblPr && parentNodeOf(part, tblPr.id);
    const jc = tblPr && elements(tblPr, 'jc')[0];
    const value = jc && attribute(jc, 'val');
    if (!table || table.kind !== 'table' || !value) continue;
    const rows = elements(table, 'tr').map((row) => ({ id: row.id, records: rowRecords(row) }));
    result.push({ history, tableId: table.id, value, rows });
  }
  return result;
}

/**
 * A table alignment change applies only to the rows that hold row or cell history.
 *
 * Deciding a removed cell takes that history from its row, and the row then keeps an
 * unchanged row snapshot so the alignment stays pending for it. Rejecting the alignment
 * restores the old alignment in those rows and keeps the current one in the others: the
 * table states the first row's alignment and each other row states its own exception.
 */
export function keepAlignmentRows(
  before: OoxmlPart,
  sites: readonly RevisionSite[],
  decided: ReadonlySet<string>,
  action: 'accept' | 'reject',
  after: OoxmlPart,
  options?: EditOptions
): OoxmlPart | null {
  const tables = alignedTables(before, sites);
  if (!tables.length) return after;
  let part = after;
  const mint = createNodeIdAllocator(after);
  let revisionIds: (() => string) | undefined;
  const write = (id: string, children: readonly OoxmlNode[]): boolean => {
    const result = replaceChildren(part, id, children, options);
    if (!result.ok) return false;
    part = result.part;
    return true;
  };
  for (const table of tables) {
    if (!decided.has(table.history)) {
      if (!findNode(part, table.history)) continue;
      for (const { id, records } of table.rows) {
        const row = findNode(part, id);
        if (!records.length || !row || row.kind === 'textValue' || rowRecords(row).length) continue;
        const source = records.at(-1)!;
        revisionIds ??= options?.revisionIds ?? nextRevisionId(part);
        const current = elements(row, 'trPr')[0];
        const snapshot = wmlElement(mint, 'trPrChange', {
          attributes: [
            ['id', revisionIds()],
            ...(['author', 'date'] as const).flatMap((name) => {
              const value = attribute(source, name);
              return value === undefined ? [] : [[name, value] as const];
            }),
          ],
          children: [
            wmlElement(mint, 'trPr', {
              // A row's own insertion or deletion is not a property it had before.
              children: (current?.children ?? [])
                .filter((child) => !isW(child, 'ins') && !isW(child, 'del'))
                .map((child) => cloneWithNewIds(child, mint)),
            }),
          ],
        });
        const properties = current
          ? patchTrPrChild(current, snapshot)
          : { ok: true as const, container: wmlElement(mint, 'trPr', { children: [snapshot] }) };
        if (!properties.ok) return null;
        const children = current
          ? row.children.map((child) => (child === current ? properties.container : child))
          : [
              ...row.children.filter((child) => isW(child, 'tblPrEx')),
              properties.container,
              ...row.children.filter((child) => !isW(child, 'tblPrEx')),
            ];
        if (!write(id, children)) return null;
      }
      continue;
    }
    // A left alignment is what every row returns to, so no row keeps anything else.
    if (action !== 'reject' || ['left', 'start'].includes(table.value)) continue;
    const kept = table.rows.filter((row) => !row.records.length);
    if (!kept.length) continue;
    // Rows the decision removed state nothing. A kept row that already states its own
    // alignment is outside what this rule knows.
    const rows = table.rows.flatMap(({ id, records }) => {
      const row = findNode(part, id);
      return row && row.kind !== 'textValue' ? [{ id, records, row }] : [];
    });
    if (
      !rows.length ||
      rows.some(
        ({ row, records }) =>
          !records.length &&
          (elements(row, 'tblPrEx').length ||
            elements(row, 'trPr').some((trPr) => elements(trPr, 'jc').length))
      )
    )
      continue;
    const alignmentOf = (records: readonly OoxmlElement[]) =>
      records.length ? 'left' : table.value;
    const first = alignmentOf(rows[0]!.records);
    const jc = (value: string) => wmlElement(mint, 'jc', { attributes: [['val', value]] });
    if (first !== 'left') {
      const tableNode = findNode(part, table.tableId);
      const tblPr = tableNode && tableNode.kind !== 'textValue' && elements(tableNode, 'tblPr')[0];
      if (!tblPr) return null;
      const patched = patchTblPrChild(tblPr, jc(first));
      if (!patched.ok || !write(tblPr.id, patched.container.children)) return null;
    }
    for (const { id, records, row } of rows) {
      const value = alignmentOf(records);
      if (value === first) continue;
      // A row holds one `w:tblPrEx`: the alignment joins one the row already has, and a row
      // whose exception already states an alignment keeps its own.
      const existing = elements(row, 'tblPrEx')[0];
      if (existing && elements(existing, 'jc').length) continue;
      const patchedException = existing
        ? patchPropertyChild(existing, jc(value), CT_TBLPREX_SEQUENCE, 'jc')
        : null;
      if (patchedException && !patchedException.ok) return null;
      const exception = patchedException?.ok
        ? patchedException.container
        : wmlElement(mint, 'tblPrEx', { children: [jc(value)] });
      let children = existing
        ? row.children.map((child) => (child === existing ? exception : child))
        : [exception, ...row.children];
      if (value !== 'left') {
        const current = elements(row, 'trPr')[0];
        const patched = patchTrPrChild(current ?? wmlElement(mint, 'trPr'), jc(value));
        if (!patched.ok) return null;
        children = current
          ? children.map((child) => (child === current ? patched.container : child))
          : [exception, patched.container, ...row.children.filter((child) => child !== existing)];
      }
      if (!write(id, children)) return null;
    }
  }
  return part;
}
