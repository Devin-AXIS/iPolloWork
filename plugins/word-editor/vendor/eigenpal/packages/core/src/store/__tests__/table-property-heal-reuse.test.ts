// Checking a table edit reads the table's rows once for each version of the table.
//
// A toolbar asks whether each of its table controls may run whenever the caret enters another
// cell. Every check merged property containers over the whole table first, so in a table of
// thousands of rows each caret move between cells took a visible pause.

import { expect, test } from 'bun:test';
import {
  readOoxmlPart,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { applyTreeOp, validateTreeOp } from '../store/tree-ops.ts';
import { healedTableProperties } from '../store/tree-op-table-heal.ts';
import { withRepeated } from './repeated-node-support.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const ROW =
  '<w:tr><w:trPr><w:trHeight w:val="400"/></w:trPr>' +
  '<w:tc><w:tcPr><w:vAlign w:val="bottom"/></w:tcPr><w:p/></w:tc></w:tr>';

function opened(rows: number): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>` +
      `</w:tblPr><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid>${ROW.repeat(rows)}</w:tbl>` +
      '<w:p/></w:body></w:document>',
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

/** `part` with each row counting the reads of its children. */
function countingRowReads(part: OoxmlPart): { part: OoxmlPart; reads: () => number } {
  let reads = 0;
  const visit = (node: OoxmlNode): OoxmlNode => {
    if (node.kind === 'textValue') return node;
    const copy = { ...node, children: node.children.map(visit) } as OoxmlElement;
    if (node.localName !== 'tr') return copy;
    return new Proxy(copy, {
      get(target, key, receiver) {
        if (key === 'children') reads++;
        return Reflect.get(target, key, receiver);
      },
    });
  };
  return { part: { ...part, root: visit(part.root) as OoxmlElement }, reads: () => reads };
}

test('a second check of an unchanged table reads none of its rows', () => {
  const { part, reads } = countingRowReads(opened(200));
  const [table] = all(part.root, 'tbl');
  expect(healedTableProperties(part, table!.id)).toBe(part);
  const first = reads();
  expect(first).toBeGreaterThan(0);
  expect(healedTableProperties(part, table!.id)).toBe(part);
  expect(reads()).toBe(first);
});

test('after typing in one cell, a check reads none of the other rows', () => {
  const { part, reads } = countingRowReads(opened(200));
  const [table] = all(part.root, 'tbl');
  expect(healedTableProperties(part, table!.id)).toBe(part);
  const paragraph = all(part.root, 'p')[100]!;
  const typed = applyTreeOp(part, {
    op: 'insertText',
    paragraphId: paragraph.id,
    offset: 0,
    text: 'X',
  });
  if (!typed.ok) throw new Error(typed.reason);
  const [edited] = all(typed.part.root, 'tbl');
  // The edit made a new table node, so the table-level answer no longer applies.
  expect(edited).not.toBe(table);
  const before = reads();
  expect(healedTableProperties(typed.part, edited!.id)).toBe(typed.part);
  expect(reads()).toBe(before);
});

test('a container that a merge repeats later in a checked table is still merged', () => {
  const part = opened(3);
  const [table] = all(part.root, 'tbl');
  expect(healedTableProperties(part, table!.id)).toBe(part);
  // A concurrent merge writes a second w:trPr: the table is a new node, checked again.
  const repeated = withRepeated(part, 'trPr');
  const [repeatedTable] = all(repeated.root, 'tbl');
  const [row] = all(repeated.root, 'tr');
  expect(all(repeated.root, 'trPr')).toHaveLength(4);
  const op = {
    op: 'setTableRowHeight',
    tableId: repeatedTable!.id,
    rowId: row!.id,
    heightTwips: 600,
  } as const;
  expect(validateTreeOp(repeated, op)).toBeNull();
  const result = applyTreeOp(repeated, op);
  if (!result.ok) throw new Error(result.reason);
  expect(all(result.part.root, 'trPr')).toHaveLength(3);
});
