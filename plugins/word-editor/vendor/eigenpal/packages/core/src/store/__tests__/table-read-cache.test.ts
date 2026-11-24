import { readMergeableTable } from '../store/tree-op-table-cell-shape.ts';
import { expect, test } from 'bun:test';
import { findNode, replaceNode } from '../package/ooxml-edit.ts';
import { readOoxmlPart, WML_NAMESPACE_URI, type OoxmlElement } from '../package/ooxml-tree.ts';
import { DEFAULT_TABLE_TOPOLOGY_LIMITS as limits } from '../store/table-constraints.ts';
import { readEditableTableTopology } from '../store/tree-op-table-topology.ts';
import { buildPlacedCellIndex } from '../store/tree-op-table-cell-properties.ts';

function fixture(columns = 1) {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${WML_NAMESPACE_URI}"><w:body><w:tbl><w:tblPr/>
    <w:tblGrid>${'<w:gridCol w:w="2400"/>'.repeat(columns)}</w:tblGrid>
    <w:tr><w:tc><w:tcPr/><w:p><w:r><w:t>First</w:t></w:r></w:p></w:tc></w:tr>
    <w:tr><w:tc><w:tcPr/><w:p><w:r><w:t>Second</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!parsed.ok) throw Error(parsed.reason);
  const part = parsed.part;
  const body = part.root.children.find((n) => n.kind === 'body')! as OoxmlElement;
  const table = body.children.find((n) => n.kind === 'table')! as OoxmlElement;
  findNode(part, table.id);
  return { part, table };
}

test('indexed table reads reuse topology and placed cells within one revision', () => {
  const { part, table } = fixture();
  const first = readEditableTableTopology(part.root, table.id);
  expect(first.ok).toBe(true);
  expect(readEditableTableTopology(part.root, table.id)).toBe(first);
  if (!first.ok) return;
  const placed = buildPlacedCellIndex(first.topology, limits);
  expect(buildPlacedCellIndex(first.topology, { ...limits })).toBe(placed);
  expect(placed.ok).toBe(true);
});

test('cached reads preserve stricter resource limits and invalidate their answers', () => {
  const { part, table } = fixture();
  const first = readEditableTableTopology(part.root, table.id);
  expect(first.ok).toBe(true);
  for (const restricted of [
    { ...limits, maxRows: 1 },
    { ...limits, maxTraversalNodes: 1 },
  ]) {
    expect(readEditableTableTopology(part.root, table.id, restricted).ok).toBe(false);
    expect(readEditableTableTopology(part.root, table.id).ok).toBe(true);
  }
  if (!first.ok) return;
  expect(buildPlacedCellIndex(first.topology, limits).ok).toBe(true);
  expect(buildPlacedCellIndex(first.topology, { ...limits, maxRows: 1 }).ok).toBe(false);
  expect(buildPlacedCellIndex(first.topology, limits).ok).toBe(true);
});

test('one topology revision stays cached across an immutable structural edit and undo', () => {
  const { part, table } = fixture();
  const first = readEditableTableTopology(part.root, table.id);
  const changed = {
    ...table,
    children: table.children.filter((n, i) => n.kind !== 'tableRow' || i === 2),
  };
  const edited = replaceNode(part, table.id, changed);
  if (!edited.ok) throw Error(edited.reason);
  findNode(edited.part, table.id);
  const next = readEditableTableTopology(edited.part.root, table.id);
  expect(next.ok).toBe(true);
  if (!next.ok) return;
  expect(next.topology.rows.length).toBe(1);
  expect(readEditableTableTopology(edited.part.root, table.id)).toBe(next);
  findNode(part, table.id);
  const undone = readEditableTableTopology(part.root, table.id);
  expect(undone).toEqual(first);
  expect(undone).not.toBe(first);
  expect(readEditableTableTopology(part.root, table.id)).toBe(undone);
});

test('an unindexed root cannot reuse another root unique-id proof', () => {
  const { part, table } = fixture();
  expect(readEditableTableTopology(part.root, table.id).ok).toBe(true);
  const duplicateRoot = { ...part.root, children: [table, table] } as OoxmlElement;
  expect(readEditableTableTopology(duplicateRoot, table.id)).toMatchObject({
    ok: false,
    reason: 'duplicate-node-id',
  });
});

test('placed-cell cache snapshots mutable caller limits', () => {
  const { part, table } = fixture();
  const read = readEditableTableTopology(part.root, table.id);
  if (!read.ok) throw Error(read.reason);
  const supplied = { ...limits };
  expect(buildPlacedCellIndex(read.topology, supplied).ok).toBe(true);
  supplied.maxRows = 1;
  expect(buildPlacedCellIndex(read.topology, supplied).ok).toBe(false);
});

test('merge and split readers share validation without weakening caller limits', () => {
  const { part, table } = fixture();
  const first = readMergeableTable(part, table.id);
  expect(first.ok).toBe(true);
  expect(readMergeableTable(part, table.id)).toBe(first);
  expect(readMergeableTable(part, table.id, { ...limits, maxRows: 1 }).ok).toBe(false);
  expect(readMergeableTable(part, table.id)).toEqual(first);
});

test('undo history does not retain validation results for every table revision', () => {
  const { part, table } = fixture();
  const previous = (() => {
    const read = readMergeableTable(part, table.id);
    if (!read.ok) throw Error(read.reason);
    return new WeakRef(read.table);
  })();
  const edited = replaceNode(part, table.id, { ...table, children: [...table.children] });
  if (!edited.ok) throw Error(edited.reason);
  findNode(edited.part, table.id);
  expect(readMergeableTable(edited.part, table.id).ok).toBe(true);
  Bun.gc(true);
  expect(previous.deref()).toBeUndefined();
  // Keep the old part alive, as the undo history does.
  expect(part.root.children.length).toBeGreaterThan(0);
});

test('cached topology preserves the column limit', () => {
  const { part, table } = fixture(2);
  expect(readEditableTableTopology(part.root, table.id).ok).toBe(true);
  expect(
    readEditableTableTopology(part.root, table.id, { ...limits, maxColumns: 1 })
  ).toMatchObject({
    ok: false,
    reason: 'resource-limit',
    detail: 'maxColumns',
  });
  expect(readEditableTableTopology(part.root, table.id).ok).toBe(true);
});
