// A table edit over a row or cell that a concurrent merge left with two property containers.
//
// Table edits refuse a row with two `w:trPr`, so without a heal no one could edit that table
// again until a reopen. The edit merges them first, by the rule a save uses, and is judged on
// the merged table, so a toolbar asking whether it may run gets the answer the run gives.

import { expect, test } from 'bun:test';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { applyTreeOp, validateTreeOp, type TreeDocOp } from '../store/tree-ops.ts';
import { withRepeated } from './repeated-node-support.ts';
import { readEditableTableTopology } from '../store/tree-op-table-topology.ts';
import { healedTableView } from '../store/tree-op-table-heal.ts';
import { readTableStructure } from '../../layout/semantic-table.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function opened(row: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>` +
      `</w:tblPr><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid>${row}</w:tbl><w:p/>` +
      '</w:body></w:document>',
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function all(node: OoxmlNode, localName: string, into: OoxmlElement[] = []): OoxmlElement[] {
  if (node.kind === 'textValue') return into;
  if (node.localName === localName) into.push(node);
  for (const child of node.children) all(child, localName, into);
  return into;
}

const CELL = '<w:tc><w:tcPr><w:vAlign w:val="bottom"/></w:tcPr><w:p/></w:tc>';
const ROW = `<w:tr><w:trPr><w:trHeight w:val="400"/></w:trPr>${CELL}</w:tr>`;

function merged(): OoxmlPart {
  return withRepeated(withRepeated(opened(ROW), 'trPr'), 'tcPr');
}

test('an edit over two w:trPr and two w:tcPr merges them, and may run', () => {
  const part = merged();
  const [table] = all(part.root, 'tbl');
  const [row] = all(part.root, 'tr');
  expect(all(part.root, 'trPr')).toHaveLength(2);
  const op: TreeDocOp = {
    op: 'setTableRowHeight',
    tableId: table!.id,
    rowId: row!.id,
    heightTwips: 600,
  };
  expect(validateTreeOp(part, op)).toBeNull();
  const result = applyTreeOp(part, op);
  if (!result.ok) throw new Error(result.reason);
  expect(all(result.part.root, 'trPr')).toHaveLength(1);
  expect(all(result.part.root, 'tcPr')).toHaveLength(1);
  const xml = serializeOoxmlPart(result.part);
  expect(xml).toContain('<w:trHeight w:hRule="exact" w:val="600"/>');
  // The input is untouched: a refused or abandoned edit keeps the part the caller had.
  expect(all(part.root, 'trPr')).toHaveLength(2);
});

test('the heal mints fresh ids for what a later copy held, so no id repeats', () => {
  const part = merged();
  const [table] = all(part.root, 'tbl');
  const [cell] = all(part.root, 'tc');
  const result = applyTreeOp(part, {
    op: 'setTableCellVerticalAlignment',
    tableId: table!.id,
    cellIds: [cell!.id],
    alignment: 'center',
  });
  if (!result.ok) throw new Error(result.reason);
  const ids: string[] = [];
  const visit = (node: OoxmlNode): void => {
    ids.push(node.id);
    if (node.kind !== 'textValue') node.children.forEach(visit);
  };
  visit(result.part.root);
  expect(new Set(ids).size).toBe(ids.length);
  expect(serializeOoxmlPart(result.part)).toContain('<w:tcPr><w:vAlign w:val="center"/></w:tcPr>');
});

test('automation that names the table inside its action heals and runs', () => {
  const part = merged();
  const [table] = all(part.root, 'tbl');
  const op: TreeDocOp = {
    op: 'authorTable',
    action: {
      kind: 'existing',
      tableId: table!.id,
      mutation: { kind: 'addRows', location: 'end', count: 1 },
    },
  };
  expect(validateTreeOp(part, op)).toBeNull();
  const result = applyTreeOp(part, op);
  if (!result.ok) throw new Error(result.reason);
  expect(all(result.part.root, 'tr')).toHaveLength(2);
  const [first] = all(result.part.root, 'tr');
  expect(
    first!.children.filter((child) => child.kind !== 'textValue' && child.localName === 'trPr')
  ).toHaveLength(1);
});

test('a reader outside an edit sees every row and cell of a merged table', () => {
  const part = withRepeated(
    opened(`${ROW}<w:tr><w:trPr><w:trHeight w:val="500"/></w:trPr>${CELL}</w:tr>`),
    'trPr'
  );
  const [table] = all(part.root, 'tbl');
  const topology = readEditableTableTopology(part.root, table!.id);
  if (!topology.ok) throw new Error(topology.reason);
  expect(topology.topology.rows.map((entry) => entry.row.id)).toEqual(
    all(part.root, 'tr').map((row) => row.id)
  );
});

test('a table with no repeated container reads as the part node itself', () => {
  const part = opened(`${ROW}${ROW}`);
  const [table] = all(part.root, 'tbl');
  expect(healedTableView(table!)).toBe(table!);
  const topology = readEditableTableTopology(part.root, table!.id);
  if (!topology.ok) throw new Error(topology.reason);
  expect(topology.topology.table).toBe(table!);
  expect(topology.topology.rows[0]!.row).toBe(all(part.root, 'tr')[0]!);
});

test('Delete Rows over several rows of a merged table removes them all', () => {
  const part = withRepeated(opened(`${ROW}${ROW}${ROW}`), 'trPr');
  const [table] = all(part.root, 'tbl');
  const rows = all(part.root, 'tr');
  let current = part;
  for (const row of rows.slice(0, 2)) {
    const op: TreeDocOp = { op: 'deleteTableRow', tableId: table!.id, rowId: row.id };
    expect(validateTreeOp(current, op)).toBeNull();
    const result = applyTreeOp(current, op);
    if (!result.ok) throw new Error(result.reason);
    current = result.part;
  }
  expect(all(current.root, 'tr').map((row) => row.id)).toEqual([rows[2]!.id]);
});

test('before any edit, layout shows a merged row as a save writes it', () => {
  const part = opened(ROW);
  const [row] = all(part.root, 'tr');
  const [trPr] = all(part.root, 'trPr');
  // A peer's own `w:trPr`, as the merge keeps it after the first copy.
  const theirs = {
    ...trPr!,
    id: `${trPr!.id}-peer`,
    children: [{ ...trPr!.children[0]!, id: `${trPr!.id}-peer-h` }].map((height) =>
      height.kind === 'textValue'
        ? height
        : {
            ...height,
            attributes: height.attributes.map((attribute) =>
              attribute.localName === 'val' ? { ...attribute, value: '900' } : attribute
            ),
          }
    ),
  } as OoxmlElement;
  const swap = (node: OoxmlNode): OoxmlNode => {
    if (node.kind === 'textValue') return node;
    if (node === row) return { ...node, children: [trPr!, theirs, ...node.children.slice(1)] };
    return { ...node, children: node.children.map(swap) };
  };
  const tree = { ...part, root: swap(part.root) as OoxmlElement };
  const [table] = all(tree.root, 'tbl');
  const structure = readTableStructure(table!, 468, 0);
  expect(structure?.rows[0]?.height).toEqual({ rule: 'atLeast', valuePt: 45 });
  expect(serializeOoxmlPart(tree)).toContain('<w:trPr><w:trHeight w:val="900"/></w:trPr>');
});

test('repeated revision markup is not healed, and the edit still refuses', () => {
  const change = '<w:tcPrChange w:id="1" w:author="A"><w:tcPr/></w:tcPrChange>';
  const part = withRepeated(
    opened(`<w:tr><w:tc><w:tcPr>${change}</w:tcPr><w:p/></w:tc></w:tr>`),
    'tcPr'
  );
  const [table] = all(part.root, 'tbl');
  const [cell] = all(part.root, 'tc');
  const op: TreeDocOp = {
    op: 'setTableCellVerticalAlignment',
    tableId: table!.id,
    cellIds: [cell!.id],
    alignment: 'center',
  };
  expect(validateTreeOp(part, op)).toBe('duplicate-property-container');
  expect(applyTreeOp(part, op).ok).toBe(false);
});
