// Row removal across vertical-merge chains (issue #1069).
//
// A `restart` cell leaves with its row, content included. The cell below it at the same grid
// interval becomes the new `restart` when the chain goes on, or loses `w:vMerge` when it was
// the last row of the chain. Its own content stays, and no further row changes.

import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { validateOoxmlPart } from '../package/ooxml-validate.ts';
import { applyTreeOp, validateTreeOp } from '../store/tree-ops.ts';
import type { TreeDocOp } from '../store/tree-op-types.ts';
import { wmlChildNamed } from '../store/tree-op-table-shared.ts';

const W = WML_NAMESPACE_URI;

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function collectByKind(root: OoxmlNode, kind: OoxmlElement['kind']): OoxmlElement[] {
  const found: OoxmlElement[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === kind) found.push(node);
    for (const child of node.children) visit(child);
  };
  visit(root);
  return found;
}

function textOf(node: OoxmlNode): string {
  if (node.kind === 'textValue') return node.value;
  return node.children.map(textOf).join('');
}

/**
 * Each row as `marker:text` per cell, where marker is `-`, `restart` or `continue`. Rows and
 * cells inside wrappers count where they stand.
 */
function rows(part: OoxmlPart): string[][] {
  const table = collectByKind(part.root, 'table')[0]!;
  return collectByKind(table, 'tableRow').map((row) =>
    collectByKind(row, 'tableCell').map((cell) => {
      const tcPr = wmlChildNamed(cell as OoxmlElement, 'tcPr');
      const marker = tcPr && wmlChildNamed(tcPr, 'vMerge');
      const val = marker?.attributes.find(
        (attribute) => attribute.namespaceUri === W && attribute.localName === 'val'
      )?.value;
      const kind = !marker ? '-' : val === 'restart' ? 'restart' : 'continue';
      return `${kind}:${textOf(cell)}`;
    })
  );
}

const tcPr = (merge: 'restart' | 'continue' | null, span = 1): string =>
  `<w:tcPr><w:tcW w:w="${2400 * span}" w:type="dxa"/>` +
  (span > 1 ? `<w:gridSpan w:val="${span}"/>` : '') +
  (merge === 'restart' ? `<w:vMerge w:val="restart"/>` : merge ? `<w:vMerge/>` : '') +
  `</w:tcPr>`;

const CELL = (text: string, merge: 'restart' | 'continue' | null = null, span = 1): string =>
  `<w:tc>${tcPr(merge, span)}${text ? `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>` : '<w:p/>'}</w:tc>`;

const ROW = (...cells: string[]): string => `<w:tr>${cells.join('')}</w:tr>`;

const TABLE = (columns: number, ...body: string[]): string =>
  `<w:tbl><w:tblGrid>${'<w:gridCol w:w="2400"/>'.repeat(columns)}</w:tblGrid>${body.join('')}</w:tbl>`;

const HEADER = ROW(CELL('Party'), CELL('Amount'));

function rowId(part: OoxmlPart, index: number): string {
  return collectByKind(part.root, 'tableRow')[index]!.id;
}

function tableId(part: OoxmlPart): string {
  return collectByKind(part.root, 'table')[0]!.id;
}

type Removal = 'deleteTableRow' | 'deleteBlock';

function removeRow(part: OoxmlPart, index: number, via: Removal): OoxmlPart {
  const op: TreeDocOp =
    via === 'deleteTableRow'
      ? { op: 'deleteTableRow', tableId: tableId(part), rowId: rowId(part, index) }
      : { op: 'deleteBlock', blockId: rowId(part, index) };
  expect(validateTreeOp(part, op)).toBeNull();
  const result = applyTreeOp(part, op);
  if (!result.ok) throw new Error(result.reason);
  expect(validateOoxmlPart(result.part).ok).toBe(true);
  return result.part;
}

describe.each(['deleteTableRow', 'deleteBlock'] as const)('%s across vertical merges', (via) => {
  test('a two-row merge ends: the row below loses its continuation marker', () => {
    const part = load(
      TABLE(
        2,
        HEADER,
        ROW(CELL('Supplier', 'restart'), CELL('USD 100')),
        ROW(CELL('', 'continue'), CELL('USD 200'))
      )
    );
    expect(rows(removeRow(part, 1, via))).toEqual([
      ['-:Party', '-:Amount'],
      ['-:', '-:USD 200'],
    ]);
  });

  test('a longer merge restarts in the row below and keeps its later rows', () => {
    const part = load(
      TABLE(
        2,
        HEADER,
        ROW(CELL('Supplier', 'restart'), CELL('USD 100')),
        ROW(CELL('', 'continue'), CELL('USD 200')),
        ROW(CELL('Tail', 'continue'), CELL('USD 300'))
      )
    );
    expect(rows(removeRow(part, 1, via))).toEqual([
      ['-:Party', '-:Amount'],
      ['restart:', '-:USD 200'],
      ['continue:Tail', '-:USD 300'],
    ]);
  });

  test('the promoted cell keeps its own content', () => {
    const part = load(
      TABLE(
        2,
        HEADER,
        ROW(CELL('Supplier', 'restart'), CELL('USD 100')),
        ROW(CELL('Mid', 'continue'), CELL('USD 200')),
        ROW(CELL('', 'continue'), CELL('USD 300'))
      )
    );
    expect(rows(removeRow(part, 1, via))).toEqual([
      ['-:Party', '-:Amount'],
      ['restart:Mid', '-:USD 200'],
      ['continue:', '-:USD 300'],
    ]);
  });

  test('an unmerged last cell keeps its own content', () => {
    const part = load(
      TABLE(
        2,
        HEADER,
        ROW(CELL('Supplier', 'restart'), CELL('USD 100')),
        ROW(CELL('Hidden', 'continue'), CELL('USD 200'))
      )
    );
    expect(rows(removeRow(part, 1, via))).toEqual([
      ['-:Party', '-:Amount'],
      ['-:Hidden', '-:USD 200'],
    ]);
  });

  test('removing a continuation row leaves the chain alone', () => {
    const part = load(
      TABLE(
        2,
        HEADER,
        ROW(CELL('Supplier', 'restart'), CELL('USD 100')),
        ROW(CELL('', 'continue'), CELL('USD 200')),
        ROW(CELL('', 'continue'), CELL('USD 300'))
      )
    );
    expect(rows(removeRow(part, 2, via))).toEqual([
      ['-:Party', '-:Amount'],
      ['restart:Supplier', '-:USD 100'],
      ['continue:', '-:USD 300'],
    ]);
  });

  test('repairs only continuations on the same grid interval', () => {
    const part = load(
      TABLE(
        3,
        ROW(CELL('A'), CELL('B'), CELL('C')),
        ROW(CELL('M1', 'restart', 2), CELL('M2', 'restart')),
        ROW(CELL('', 'continue', 2), CELL('', 'continue')),
        ROW(CELL('', 'continue', 2), CELL('x'))
      )
    );
    expect(rows(removeRow(part, 1, via))).toEqual([
      ['-:A', '-:B', '-:C'],
      ['restart:', '-:'],
      ['continue:', '-:x'],
    ]);
  });

  test('leaves a continuation on a different grid interval alone', () => {
    const part = load(
      TABLE(2, HEADER, ROW(CELL('Wide', 'restart', 2)), ROW(CELL('', 'continue'), CELL('USD 200')))
    );
    expect(rows(removeRow(part, 1, via))).toEqual([
      ['-:Party', '-:Amount'],
      ['continue:', '-:USD 200'],
    ]);
  });

  test('a continuation under another merge joins it', () => {
    const part = load(
      TABLE(
        2,
        HEADER,
        ROW(CELL('A', 'restart'), CELL('1')),
        ROW(CELL('B', 'continue'), CELL('2')),
        ROW(CELL('C', 'restart'), CELL('3')),
        ROW(CELL('D', 'continue'), CELL('4'))
      )
    );
    expect(rows(removeRow(part, 3, via))).toEqual([
      ['-:Party', '-:Amount'],
      ['restart:A', '-:1'],
      ['continue:B', '-:2'],
      ['continue:D', '-:4'],
    ]);
  });

  test('repairs a continuation in a wrapped row below', () => {
    const part = load(
      TABLE(
        2,
        HEADER,
        ROW(CELL('Supplier', 'restart'), CELL('USD 100')),
        `<w:sdt><w:sdtContent>${ROW(CELL('', 'continue'), CELL('USD 200'))}</w:sdtContent></w:sdt>`
      )
    );
    expect(rows(removeRow(part, 1, via))).toEqual([
      ['-:Party', '-:Amount'],
      ['-:', '-:USD 200'],
    ]);
  });

  test('repairs a continuation below a wrapped removed row', () => {
    // `deleteTableRow` addresses direct rows only; `deleteBlock` reaches a wrapped one.
    if (via === 'deleteTableRow') return;
    const part = load(
      TABLE(
        2,
        HEADER,
        `<w:sdt><w:sdtContent>` +
          ROW(CELL('Lead'), CELL('USD 50')) +
          ROW(CELL('Supplier', 'restart'), CELL('USD 100')) +
          `</w:sdtContent></w:sdt>`,
        ROW(CELL('', 'continue'), CELL('USD 200')),
        ROW(CELL('', 'continue'), CELL('USD 300'))
      )
    );
    expect(rows(removeRow(part, 2, via))).toEqual([
      ['-:Party', '-:Amount'],
      ['-:Lead', '-:USD 50'],
      ['restart:', '-:USD 200'],
      ['continue:', '-:USD 300'],
    ]);
  });

  test('reads wrapped cells in other columns', () => {
    const wrapped = (inner: string): string =>
      `<w:sdt><w:sdtContent>${inner}</w:sdtContent></w:sdt>`;
    const part = load(
      TABLE(
        2,
        HEADER,
        ROW(CELL('Supplier', 'restart'), wrapped(CELL('USD 100'))),
        ROW(wrapped(CELL('', 'continue')), CELL('USD 200')),
        ROW(CELL('', 'continue'), wrapped(CELL('USD 300')))
      )
    );
    expect(rows(removeRow(part, 1, via))).toEqual([
      ['-:Party', '-:Amount'],
      ['restart:', '-:USD 200'],
      ['continue:', '-:USD 300'],
    ]);
  });

  test.each([
    ['an unknown element', (row: string) => `<x:wrap xmlns:x="urn:example">${row}</x:wrap>`],
    ['custom XML', (row: string) => `<w:customXml w:element="row">${row}</w:customXml>`],
  ])('refuses without mutation when %s hides the row below', (_name, wrap) => {
    const part = load(
      TABLE(
        2,
        HEADER,
        ROW(CELL('Supplier', 'restart'), CELL('USD 100')),
        wrap(ROW(CELL('', 'continue'), CELL('USD 200')))
      )
    );
    const before = serializeOoxmlPart(part);
    const op: TreeDocOp =
      via === 'deleteTableRow'
        ? { op: 'deleteTableRow', tableId: tableId(part), rowId: rowId(part, 1) }
        : { op: 'deleteBlock', blockId: rowId(part, 1) };
    expect(validateTreeOp(part, op)).toBe('row-hides-cell');
    expect(applyTreeOp(part, op)).toMatchObject({ ok: false, reason: 'row-hides-cell' });
    expect(serializeOoxmlPart(part)).toBe(before);
  });

  test('a row holding only continuations deletes beside an unreadable row', () => {
    const part = load(
      TABLE(
        2,
        HEADER,
        ROW(CELL('Supplier', 'restart'), CELL('USD 100')),
        ROW(CELL('', 'continue'), CELL('USD 200')),
        ROW(CELL('', 'continue'), CELL('USD 300')),
        `<w:customXml w:element="row">${ROW(CELL('Other'), CELL('USD 400'))}</w:customXml>`
      )
    );
    expect(rows(removeRow(part, 2, via))).toEqual([
      ['-:Party', '-:Amount'],
      ['restart:Supplier', '-:USD 100'],
      ['continue:', '-:USD 300'],
      ['-:Other', '-:USD 400'],
    ]);
  });

  test('a merge start deletes when an unreadable row is out of reach', () => {
    const part = load(
      TABLE(
        2,
        HEADER,
        ROW(CELL('Supplier', 'restart'), CELL('USD 100')),
        ROW(CELL('', 'continue'), CELL('USD 200')),
        ROW(CELL('Plain'), CELL('USD 300')),
        `<w:customXml w:element="row">${ROW(CELL('Other'), CELL('USD 400'))}</w:customXml>`
      )
    );
    expect(rows(removeRow(part, 1, via))).toEqual([
      ['-:Party', '-:Amount'],
      ['-:', '-:USD 200'],
      ['-:Plain', '-:USD 300'],
      ['-:Other', '-:USD 400'],
    ]);
  });

  test('a continuation-only row deletes when one of its cells is unreadable', () => {
    const part = load(
      TABLE(
        2,
        HEADER,
        ROW(CELL('Supplier', 'restart'), CELL('USD 100')),
        ROW(CELL('', 'continue'), `<w:customXml w:element="cell">${CELL('USD 200')}</w:customXml>`),
        ROW(CELL('Plain'), CELL('USD 300'))
      )
    );
    expect(rows(removeRow(part, 2, via))[2]).toEqual(['-:Plain', '-:USD 300']);
  });

  test('a merged cell above joins only on the same grid interval', () => {
    const part = load(
      TABLE(
        2,
        ROW(CELL('Wide', 'restart', 2)),
        ROW(CELL('Narrow', 'restart'), CELL('x')),
        ROW(CELL('', 'continue'), CELL('y'))
      )
    );
    expect(rows(removeRow(part, 1, via))).toEqual([['restart:Wide'], ['-:', '-:y']]);
  });

  test('a continuation that joins the merge above needs no later row', () => {
    const part = load(
      TABLE(
        2,
        HEADER,
        ROW(CELL('A', 'restart'), CELL('1')),
        ROW(CELL('C', 'restart'), CELL('3')),
        ROW(CELL('D', 'continue'), CELL('4')),
        `<w:customXml w:element="row">${ROW(CELL('Other'), CELL('5'))}</w:customXml>`
      )
    );
    expect(rows(removeRow(part, 2, via)).slice(1, 3)).toEqual([
      ['restart:A', '-:1'],
      ['continue:D', '-:4'],
    ]);
  });

  test('a merge start with an unreadable cell deletes when nothing continues below', () => {
    const part = load(
      TABLE(
        2,
        HEADER,
        ROW(CELL('Plain'), CELL('USD 100')),
        ROW(CELL('Last', 'restart'), `<w:customXml w:element="cell">${CELL('X')}</w:customXml>`)
      )
    );
    expect(rows(removeRow(part, 2, via))).toEqual([
      ['-:Party', '-:Amount'],
      ['-:Plain', '-:USD 100'],
    ]);
  });

  test('a merge-free row with a wrapped neighbour still deletes', () => {
    const part = load(
      TABLE(
        2,
        HEADER,
        ROW(CELL('one'), CELL('two')),
        `<w:sdt><w:sdtContent>${ROW(CELL('three'), CELL('four'))}</w:sdtContent></w:sdt>`
      )
    );
    expect(rows(removeRow(part, 1, via))).toEqual([
      ['-:Party', '-:Amount'],
      ['-:three', '-:four'],
    ]);
  });
});

describe('tracked row deletion across vertical merges', () => {
  test('keeps the merge intact until the deletion is accepted', () => {
    const part = load(
      TABLE(
        2,
        HEADER,
        ROW(CELL('Supplier', 'restart'), CELL('USD 100')),
        ROW(CELL('', 'continue'), CELL('USD 200'))
      )
    );
    const result = applyTreeOp(part, {
      op: 'deleteTableRow',
      tableId: tableId(part),
      rowId: rowId(part, 1),
      revision: { author: 'Writer', date: '2026-10-03T00:00:00Z' },
    });
    if (!result.ok) throw new Error(result.reason);
    expect(rows(result.part)).toEqual(rows(part));
  });
});
