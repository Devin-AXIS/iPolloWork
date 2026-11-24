// Undo/redo for table row operations (table-editing task 3).

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlNode, type OoxmlPart } from '../package/ooxml-tree.ts';
import { applyTreeOp } from '../store/tree-ops.ts';
import { TreeDocumentStore, type TreeModelChange } from '../store/tree-store.ts';
import { ORIGIN_IDS } from '../registry/frozen-ids.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function collectByKind(
  root: OoxmlNode,
  kind: string
): { id: string; kind: string; children: readonly OoxmlNode[] }[] {
  const found: { id: string; kind: string; children: readonly OoxmlNode[] }[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === kind) found.push(node);
    for (const child of node.children) visit(child);
  };
  visit(root);
  return found;
}

function paragraphIdsInRow(root: OoxmlNode, rowId: string): string[] {
  const row = collectByKind(root, 'tableRow').find((entry) => entry.id === rowId);
  if (!row) return [];
  const ids: string[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'paragraph') ids.push(node.id);
    if (node.kind === 'textValue') return;
    for (const child of node.children) visit(child);
  };
  for (const child of row.children) visit(child);
  return ids;
}

function sortedIds(ids: readonly string[]): string[] {
  return [...ids].sort();
}

const CELL = (text: string): string => `<w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
const ROW = (...cells: string[]): string => `<w:tr>${cells.join('')}</w:tr>`;
const TABLE = (...rows: string[]): string =>
  `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>${rows.join('')}</w:tbl>`;

describe('table row ops history', () => {
  test('insert row publishes exact flow-structural effect and restores on undo', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2')), ROW(CELL('b1'), CELL('b2'))));
    const store = new TreeDocumentStore(part);
    const partBefore = store.part;
    const table = collectByKind(store.part.root, 'table')[0]!;
    const rowId = collectByKind(store.part.root, 'tableRow')[1]!.id;
    const rowsBefore = collectByKind(store.part.root, 'tableRow').length;
    const changes: TreeModelChange[] = [];
    const unsubscribe = store.subscribe((change) => changes.push(change));

    const result = store.transact((tx) => {
      tx.apply({ op: 'insertTableRow', tableId: table.id, rowId, where: 'above' });
    });
    unsubscribe();

    expect(result.ok).toBe(true);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.impact).toBe('flow-structural');
    const insertedRow = collectByKind(store.part.root, 'tableRow')[1]!;
    expect(sortedIds(changes[0]!.dirty)).toEqual(sortedIds([table.id, insertedRow.id]));
    expect(sortedIds(changes[0]!.created)).toEqual(
      sortedIds([
        insertedRow.id,
        ...insertedRow.children.filter((node) => node.kind === 'tableCell').map((node) => node.id),
        ...paragraphIdsInRow(store.part.root, insertedRow.id),
      ])
    );
    expect(changes[0]!.deleted).toEqual([]);
    expect(collectByKind(store.part.root, 'tableRow').length).toBe(rowsBefore + 1);

    store.undo();
    expect(store.part).toBe(partBefore);
    expect(collectByKind(store.part.root, 'tableRow').length).toBe(rowsBefore);
  });

  test('delete row publishes exact deleted paragraph set and restores on undo', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2')), ROW(CELL('b1'), CELL('b2'))));
    const store = new TreeDocumentStore(part);
    const partBefore = store.part;
    const table = collectByKind(store.part.root, 'table')[0]!;
    const rowId = collectByKind(store.part.root, 'tableRow')[0]!.id;
    const rowsBefore = collectByKind(store.part.root, 'tableRow').length;
    const deletedParagraphs = paragraphIdsInRow(store.part.root, rowId);
    const changes: TreeModelChange[] = [];
    const unsubscribe = store.subscribe((change) => changes.push(change));

    const direct = applyTreeOp(partBefore, { op: 'deleteTableRow', tableId: table.id, rowId });
    expect(direct.ok).toBe(true);
    if (!direct.ok) return;

    const result = store.transact((tx) => {
      tx.apply({ op: 'deleteTableRow', tableId: table.id, rowId });
    });
    unsubscribe();

    expect(result.ok).toBe(true);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.impact).toBe('flow-structural');
    expect(sortedIds(changes[0]!.dirty)).toEqual(sortedIds(direct.effect.dirty));
    expect(sortedIds(changes[0]!.deleted)).toEqual(sortedIds(direct.effect.deleted));
    expect(changes[0]!.created).toEqual([]);
    expect(sortedIds(changes[0]!.deleted)).toEqual(sortedIds([rowId, ...deletedParagraphs]));
    expect(collectByKind(store.part.root, 'tableRow').length).toBe(rowsBefore - 1);

    store.undo();
    expect(store.part).toBe(partBefore);
    expect(collectByKind(store.part.root, 'tableRow').length).toBe(rowsBefore);
  });

  test('delete nested row publishes exact inner-table effect ids', () => {
    const part = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>` +
        `<w:tr><w:tc><w:tbl><w:tblGrid><w:gridCol w:w="1200"/></w:tblGrid>` +
        `<w:tr>${CELL('nested-a')}</w:tr><w:tr>${CELL('nested-b')}</w:tr></w:tbl></w:tc>${CELL('outer')}</w:tr></w:tbl>`
    );
    const store = new TreeDocumentStore(part);
    const inner = collectByKind(store.part.root, 'table')[1]!;
    const innerRowId = collectByKind(store.part.root, 'tableRow').find((row) =>
      inner.children.some((child) => child.id === row.id)
    )!.id;
    const nestedParagraphs = paragraphIdsInRow(store.part.root, innerRowId);

    const direct = applyTreeOp(part, {
      op: 'deleteTableRow',
      tableId: inner.id,
      rowId: innerRowId,
    });
    expect(direct.ok).toBe(true);
    if (!direct.ok) return;

    const result = store.transact((tx) => {
      tx.apply({ op: 'deleteTableRow', tableId: inner.id, rowId: innerRowId });
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(sortedIds(result.change!.dirty)).toEqual(sortedIds(direct.effect.dirty));
    expect(sortedIds(result.change!.deleted)).toEqual(sortedIds(direct.effect.deleted));
    expect(result.change!.created).toEqual([]);
    expect(sortedIds(result.change!.deleted)).toEqual(sortedIds([innerRowId, ...nestedParagraphs]));
  });

  test('redo restores committed part and exact published change', () => {
    const part = load(TABLE(ROW(CELL('only'))));
    const store = new TreeDocumentStore(part);
    const table = collectByKind(store.part.root, 'table')[0]!;
    const rowId = collectByKind(store.part.root, 'tableRow')[0]!.id;

    store.transact((tx) => {
      tx.apply({ op: 'insertTableRow', tableId: table.id, rowId, where: 'below' });
    });

    const partAfterInsert = store.part;
    const rowsAfterInsert = collectByKind(store.part.root, 'tableRow').length;

    store.undo();
    expect(collectByKind(store.part.root, 'tableRow')).toHaveLength(1);

    const redoChange = store.redo();
    expect(store.part).toBe(partAfterInsert);
    expect(collectByKind(store.part.root, 'tableRow').length).toBe(rowsAfterInsert);
    expect(redoChange?.impact).toBe('flow-structural');
    expect(redoChange?.origin).toBe(ORIGIN_IDS.mutationRedo);
    expect(redoChange?.created).toEqual([]);
    expect(redoChange?.deleted).toEqual([]);
    expect(sortedIds(redoChange?.dirty ?? [])).toEqual([]);
  });

  test('failed delete of final row leaves history empty', () => {
    const part = load(TABLE(ROW(CELL('only'))));
    const store = new TreeDocumentStore(part);
    const table = collectByKind(store.part.root, 'table')[0]!;
    const rowId = collectByKind(store.part.root, 'tableRow')[0]!.id;
    const revisionBefore = store.revision;

    const result = store.transact((tx) => {
      tx.apply({ op: 'deleteTableRow', tableId: table.id, rowId });
    });

    expect(result.ok).toBe(false);
    expect(store.revision).toBe(revisionBefore);
    expect(collectByKind(store.part.root, 'tableRow')).toHaveLength(1);
  });
});
