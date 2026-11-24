// Row insertion across vertical-merge chains (issue #57).
//
// Word grows the covering cell when a row lands inside a `w:vMerge` span. The store repeats
// `w:vMerge` for exactly the cells whose chain crosses the insertion boundary, and leaves
// every other cell of the new row unmerged.

import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { applyTreeOp } from '../store/tree-ops.ts';
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
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return found;
}

function firstTable(part: OoxmlPart): OoxmlElement {
  const tables = collectByKind(part.root, 'table');
  if (tables.length === 0) throw new Error('no table');
  return tables[0]!;
}

function rowIds(part: OoxmlPart, tableId: string): string[] {
  const table = collectByKind(part.root, 'table').find((t) => t.id === tableId);
  if (!table) throw new Error('table missing');
  return table.children.filter((c) => c.kind === 'tableRow').map((c) => c.id);
}

function insertedRow(result: {
  part: OoxmlPart;
  effect: { created: readonly string[] };
}): OoxmlElement {
  return collectByKind(result.part.root, 'tableRow').find((row) =>
    result.effect.created.includes(row.id)
  )!;
}

/** `w:vMerge` state of each direct `w:tc`, in cell order: absent, `restart`, or continue. */
function vMergeKinds(row: OoxmlElement): (string | null)[] {
  return row.children
    .filter((child) => child.kind === 'tableCell')
    .map((cell) => {
      const tcPr = wmlChildNamed(cell as OoxmlElement, 'tcPr');
      const marker = tcPr && wmlChildNamed(tcPr, 'vMerge');
      if (!marker) return null;
      const val = marker.attributes.find(
        (attribute) => attribute.namespaceUri === W && attribute.localName === 'val'
      );
      return val ? val.value : 'continue';
    });
}

const CELL = (text: string): string =>
  `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>` +
  `<w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;

const ROW = (...cells: string[]): string => `<w:tr>${cells.join('')}</w:tr>`;

const TABLE = (...rows: string[]): string =>
  `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>${rows.join('')}</w:tbl>`;

describe('insertTableRow across vertical merges', () => {
  test('extends an active vertical-merge chain through the inserted row', () => {
    const part = load(
      TABLE(
        ROW(`<w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p/></w:tc>`, CELL('a')),
        ROW(`<w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc>`, CELL('b'))
      )
    );
    const table = firstTable(part);
    const [first, second] = rowIds(part, table.id);

    const above = applyTreeOp(part, {
      op: 'insertTableRow',
      tableId: table.id,
      rowId: second!,
      where: 'above',
    });
    expect(above.ok).toBe(true);
    if (!above.ok) return;
    expect(rowIds(above.part, table.id)).toHaveLength(3);
    expect(vMergeKinds(insertedRow(above))).toEqual(['continue', null]);

    const below = applyTreeOp(part, {
      op: 'insertTableRow',
      tableId: table.id,
      rowId: first!,
      where: 'below',
    });
    expect(below.ok).toBe(true);
    if (!below.ok) return;
    expect(vMergeKinds(insertedRow(below))).toEqual(['continue', null]);
    // The restart stays on the original top row; only the continuation count grows.
    const rows = collectByKind(below.part.root, 'tableRow');
    expect(rows.map((row) => vMergeKinds(row)[0])).toEqual(['restart', 'continue', 'continue']);
  });

  test('leaves the caret in the first cell outside the merge', () => {
    const part = load(
      TABLE(
        ROW(`<w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p/></w:tc>`, CELL('a')),
        ROW(`<w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc>`, CELL('b'))
      )
    );
    const table = firstTable(part);
    const [, second] = rowIds(part, table.id);

    const result = applyTreeOp(part, {
      op: 'insertTableRow',
      tableId: table.id,
      rowId: second!,
      where: 'above',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const row = insertedRow(result);
    const cells = row.children.filter((child) => child.kind === 'tableCell');
    const secondCellParagraph = cells[1]!.children.find((child) => child.kind === 'paragraph')!;
    expect(result.effect.caret?.paragraphId).toBe(secondCellParagraph.id);
  });

  test('omits the caret when every cell of the inserted row continues a merge', () => {
    const part = load(
      TABLE(
        ROW(
          `<w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p/></w:tc>`,
          `<w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p/></w:tc>`
        ),
        ROW(
          `<w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc>`,
          `<w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc>`
        )
      )
    );
    const table = firstTable(part);
    const [, second] = rowIds(part, table.id);

    const result = applyTreeOp(part, {
      op: 'insertTableRow',
      tableId: table.id,
      rowId: second!,
      where: 'above',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(vMergeKinds(insertedRow(result))).toEqual(['continue', 'continue']);
    expect(result.effect.caret).toBeUndefined();
  });

  test('allows insertion beside unrelated horizontal merges', () => {
    const part = load(
      TABLE(
        ROW(`<w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p/></w:tc>`),
        ROW(CELL('a'), CELL('b'))
      )
    );
    const table = firstTable(part);
    const [, second] = rowIds(part, table.id);

    const result = applyTreeOp(part, {
      op: 'insertTableRow',
      tableId: table.id,
      rowId: second!,
      where: 'above',
    });
    expect(result.ok).toBe(true);
  });

  test('continues only the grid interval the merge covers', () => {
    const part = load(
      TABLE(
        ROW(
          `<w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p/></w:tc>`,
          `<w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p/></w:tc>`
        ),
        ROW(CELL('a'), CELL('b'), `<w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc>`)
      )
    );
    const table = firstTable(part);
    const [, second] = rowIds(part, table.id);

    const result = applyTreeOp(part, {
      op: 'insertTableRow',
      tableId: table.id,
      rowId: second!,
      where: 'above',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Source row is the lower one: cells at grid columns 0 and 1 are outside the chain.
    expect(vMergeKinds(insertedRow(result))).toEqual([null, null, 'continue']);
  });

  test('continues a merge across a gridBefore-shifted boundary', () => {
    const part = load(
      TABLE(
        ROW(
          `<w:trPr><w:gridBefore w:val="1"/></w:trPr>` +
            `<w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p/></w:tc>`,
          CELL('top')
        ),
        ROW(
          `<w:trPr><w:gridBefore w:val="1"/></w:trPr>` +
            `<w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc>`,
          CELL('bottom')
        )
      )
    );
    const table = firstTable(part);
    const [, second] = rowIds(part, table.id);

    const result = applyTreeOp(part, {
      op: 'insertTableRow',
      tableId: table.id,
      rowId: second!,
      where: 'above',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const row = insertedRow(result);
    expect(wmlChildNamed(row, 'trPr')?.children.some((c) => c.localName === 'gridBefore')).toBe(
      true
    );
    expect(vMergeKinds(row)).toEqual(['continue', null]);
  });

  test('never matches columns clamped past the grid ceiling', () => {
    // Four cells of `w:gridSpan="1000"` push every cell past cell 1 onto the same clamped
    // zero-width interval. A hostile file must not steer `w:vMerge` into an unrelated column.
    const wide = (extra = '') =>
      `<w:tc><w:tcPr><w:gridSpan w:val="1000"/>${extra}</w:tcPr><w:p/></w:tc>`;
    const part = load(
      TABLE(
        ROW(wide(), wide(), wide('<w:vMerge w:val="restart"/>'), wide()),
        ROW(wide(), wide(), wide(), wide('<w:vMerge/>'))
      )
    );
    const table = firstTable(part);
    const [, second] = rowIds(part, table.id);

    const result = applyTreeOp(part, {
      op: 'insertTableRow',
      tableId: table.id,
      rowId: second!,
      where: 'above',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(vMergeKinds(insertedRow(result))).toEqual([null, null, null, null]);
  });

  test('refuses a row whose cell hides inside a cell-level content control', () => {
    // `w:sdt` is a direct child of `w:tr` here, so the cell it holds never advances the grid
    // cursor. Writing `w:vMerge` from that mapping would mark a column that carries no chain.
    const wrapped = `<w:sdt><w:sdtPr/><w:sdtContent>${CELL('held')}</w:sdtContent></w:sdt>`;
    const part = load(
      TABLE(
        ROW(CELL('a'), wrapped, `<w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p/></w:tc>`),
        ROW(CELL('b'), CELL('c'), `<w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc>`)
      )
    );
    const table = firstTable(part);
    const [first] = rowIds(part, table.id);

    const result = applyTreeOp(part, {
      op: 'insertTableRow',
      tableId: table.id,
      rowId: first!,
      where: 'below',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('row-hides-cell');
  });

  test('allows a row carrying many benign leaf annotations', () => {
    // The wrapper scan budget is per direct child. One shared budget would refuse a plain
    // insertion on any row with more than a few dozen bookmarks.
    const marks = Array.from(
      { length: 80 },
      (_, index) => `<w:bookmarkStart w:id="${index}" w:name="b${index}"/>`
    ).join('');
    const part = load(TABLE(ROW(marks, CELL('a'), CELL('b')), ROW(CELL('c'), CELL('d'))));
    const table = firstTable(part);
    const [first] = rowIds(part, table.id);

    const result = applyTreeOp(part, {
      op: 'insertTableRow',
      tableId: table.id,
      rowId: first!,
      where: 'below',
    });
    expect(result.ok).toBe(true);
  });

  test('refuses when a wrapper hides a row between the boundary rows', () => {
    // `topology.rows` skips the wrapped `w:tr`, so rows 0 and 2 read as adjacent while the
    // new row is spliced in before the wrapper. The merge marker would name the wrong chain.
    const wrappedRow = `<w:sdt><w:sdtPr/><w:sdtContent>${ROW(CELL('held'), CELL('held2'))}</w:sdtContent></w:sdt>`;
    const part = load(
      '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>' +
        ROW(`<w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p/></w:tc>`, CELL('a')) +
        wrappedRow +
        ROW(`<w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc>`, CELL('b')) +
        '</w:tbl>'
    );
    const table = firstTable(part);
    const [first] = rowIds(part, table.id);

    const result = applyTreeOp(part, {
      op: 'insertTableRow',
      tableId: table.id,
      rowId: first!,
      where: 'below',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('row-hides-cell');
  });

  test('finds a cell nested deep inside stacked wrappers', () => {
    // A depth cap would answer "not wrapped" here and let the mis-mapped grid drive the
    // write. The scan is budget-bounded instead, so depth cannot buy an attacker a pass.
    const deep = (inner: string, levels: number): string =>
      levels === 0
        ? inner
        : `<w:sdt><w:sdtPr/><w:sdtContent>${deep(inner, levels - 1)}</w:sdtContent></w:sdt>`;
    const part = load(
      TABLE(
        ROW(
          CELL('a'),
          deep(CELL('held'), 4),
          `<w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p/></w:tc>`
        ),
        ROW(CELL('b'), CELL('c'), `<w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc>`)
      )
    );
    const table = firstTable(part);
    const [first] = rowIds(part, table.id);

    const result = applyTreeOp(part, {
      op: 'insertTableRow',
      tableId: table.id,
      rowId: first!,
      where: 'below',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('row-hides-cell');
  });

  test('lets a merge-free table insert beside a wrapped neighbour row', () => {
    // No `w:vMerge` is in reach, so no grid mapping is ever read for a marker and the wrapper
    // cannot steer anything. Refusing here would be a plain regression.
    const wrapped = `<w:sdt><w:sdtPr/><w:sdtContent>${CELL('held')}</w:sdtContent></w:sdt>`;
    const part = load(
      TABLE(ROW(CELL('a'), wrapped), ROW(CELL('b'), CELL('c')), ROW(CELL('d'), CELL('e')))
    );
    const table = firstTable(part);
    const [, second] = rowIds(part, table.id);

    const result = applyTreeOp(part, {
      op: 'insertTableRow',
      tableId: table.id,
      rowId: second!,
      where: 'below',
    });
    expect(result.ok).toBe(true);
  });

  test('writes no marker when only one side of the boundary carries a merge', () => {
    // The upper row merges but nothing continues it below, so the chain ends there and the
    // new row joins nothing. A one-sided marker must not manufacture a continuation.
    const part = load(
      TABLE(
        ROW(`<w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p/></w:tc>`, CELL('a')),
        ROW(CELL('b'), CELL('c'))
      )
    );
    const table = firstTable(part);
    const [first] = rowIds(part, table.id);

    const result = applyTreeOp(part, {
      op: 'insertTableRow',
      tableId: table.id,
      rowId: first!,
      where: 'below',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(vMergeKinds(insertedRow(result))).toEqual([null, null]);
  });

  test('refuses when the covering marker itself hides inside a wrapper', () => {
    // The restart is wrapped, so a check that reads only DIRECT cells would call the
    // boundary merge-free, skip the guard, and sever the chain without telling anyone.
    const wrappedRestart =
      `<w:sdt><w:sdtPr/><w:sdtContent>` +
      `<w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p/></w:tc>` +
      `</w:sdtContent></w:sdt>`;
    const part = load(
      TABLE(
        ROW(wrappedRestart, CELL('a')),
        ROW(`<w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc>`, CELL('b'))
      )
    );
    const table = firstTable(part);
    const [first] = rowIds(part, table.id);

    const result = applyTreeOp(part, {
      op: 'insertTableRow',
      tableId: table.id,
      rowId: first!,
      where: 'below',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('row-hides-cell');
  });

  test('refuses a demoted w:tc the grid walk does not count', () => {
    // A `w:tc` holding a bare `w:r` demotes to a generic node and stays a direct child of the
    // row. Matching on node kind alone would miss it, and the grid cursor never advances.
    const demoted = `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr><w:r><w:t>x</w:t></w:r></w:tc>`;
    const part = load(
      TABLE(
        ROW(`<w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p/></w:tc>`, CELL('a')),
        ROW(demoted, `<w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc>`)
      )
    );
    const table = firstTable(part);
    const [, second] = rowIds(part, table.id);

    const result = applyTreeOp(part, {
      op: 'insertTableRow',
      tableId: table.id,
      rowId: second!,
      where: 'above',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('row-hides-cell');
  });

  test('inserts at the table edges even when the row shape is unreadable', () => {
    // Above the first row and below the last there is no boundary, so no marker is written
    // and the guard has nothing to protect. Refusing there would be pure loss. The inserted
    // row is still short by the wrapped cell, which is the older gap this change leaves as
    // it found it: a wrapped cell is never copied into a new row on any path.

    const wrapped = `<w:sdt><w:sdtPr/><w:sdtContent>${CELL('held')}</w:sdtContent></w:sdt>`;
    const part = load(
      TABLE(
        ROW(`<w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p/></w:tc>`, CELL('a')),
        ROW(`<w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc>`, wrapped)
      )
    );
    const table = firstTable(part);
    const [first, second] = rowIds(part, table.id);

    expect(
      applyTreeOp(part, {
        op: 'insertTableRow',
        tableId: table.id,
        rowId: first!,
        where: 'above',
      }).ok
    ).toBe(true);
    expect(
      applyTreeOp(part, {
        op: 'insertTableRow',
        tableId: table.id,
        rowId: second!,
        where: 'below',
      }).ok
    ).toBe(true);
  });

  test('reads a wide merge-free row without calling it merged', () => {
    // The scan budget must clear a legitimately wide row. A budget the row's own cells can
    // exhaust reads "merged", which then refuses an insert no marker would ever touch.
    const columns = 600;
    const grid = '<w:gridCol w:w="20"/>'.repeat(columns);
    const plain = '<w:tc><w:tcPr><w:tcW w:w="20" w:type="dxa"/></w:tcPr><w:p/></w:tc>';
    const wrapped = `<w:sdt><w:sdtPr/><w:sdtContent>${plain}</w:sdtContent></w:sdt>`;
    const part = load(
      `<w:tbl><w:tblGrid>${grid}</w:tblGrid>` +
        `<w:tr>${plain.repeat(columns - 1)}${wrapped}</w:tr>` +
        `<w:tr>${plain.repeat(columns)}</w:tr>` +
        `<w:tr>${plain.repeat(columns)}</w:tr></w:tbl>`
    );
    const table = firstTable(part);
    const [first] = rowIds(part, table.id);

    // The wide, wrapped row is the boundary's upper side, so a false "merged" reading here
    // is what turns its wrapper into a refusal.
    const result = applyTreeOp(part, {
      op: 'insertTableRow',
      tableId: table.id,
      rowId: first!,
      where: 'below',
    });
    expect(result.ok).toBe(true);
  });

  test('allows a wrapper that holds no cell of its own', () => {
    // A control INSIDE a `w:tc` leaves the row's direct cells intact, so it stays editable.
    const held =
      `<w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr>` +
      `<w:sdt><w:sdtPr/><w:sdtContent><w:p/></w:sdtContent></w:sdt></w:tc>`;
    const part = load(
      TABLE(ROW(held, CELL('a')), ROW(`<w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc>`, CELL('b')))
    );
    const table = firstTable(part);
    const [first] = rowIds(part, table.id);

    const result = applyTreeOp(part, {
      op: 'insertTableRow',
      tableId: table.id,
      rowId: first!,
      where: 'below',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(vMergeKinds(insertedRow(result))).toEqual(['continue', null]);
  });

  test('allows adjacent restart below an upper merge', () => {
    const part = load(
      TABLE(
        ROW(`<w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p/></w:tc>`, CELL('a')),
        ROW(`<w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p/></w:tc>`, CELL('b'))
      )
    );
    const table = firstTable(part);
    const [, second] = rowIds(part, table.id);

    const result = applyTreeOp(part, {
      op: 'insertTableRow',
      tableId: table.id,
      rowId: second!,
      where: 'above',
    });
    expect(result.ok).toBe(true);
  });

  test('allows insertion beside unrelated merge in another column', () => {
    const part = load(
      TABLE(
        ROW(`<w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p/></w:tc>`, CELL('a')),
        ROW(CELL('x'), `<w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc>`)
      )
    );
    const table = firstTable(part);
    const [, second] = rowIds(part, table.id);

    const result = applyTreeOp(part, {
      op: 'insertTableRow',
      tableId: table.id,
      rowId: second!,
      where: 'above',
    });
    expect(result.ok).toBe(true);
  });

  test('allows irregular row widths when no merge chain crosses the boundary', () => {
    const part = load(TABLE(ROW(CELL('wide-only')), ROW(CELL('a'), CELL('b'))));
    const table = firstTable(part);
    const [, second] = rowIds(part, table.id);

    const result = applyTreeOp(part, {
      op: 'insertTableRow',
      tableId: table.id,
      rowId: second!,
      where: 'above',
    });
    expect(result.ok).toBe(true);
  });

  test('allows partial-overlap merge intervals without exact column match', () => {
    const part = load(
      TABLE(
        ROW(
          `<w:tc><w:tcPr><w:gridSpan w:val="2"/><w:vMerge w:val="restart"/></w:tcPr><w:p/></w:tc>`
        ),
        ROW(CELL('a'), `<w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc>`)
      )
    );
    const table = firstTable(part);
    const [, second] = rowIds(part, table.id);

    const result = applyTreeOp(part, {
      op: 'insertTableRow',
      tableId: table.id,
      rowId: second!,
      where: 'above',
    });
    expect(result.ok).toBe(true);
  });

  test('allows mismatched-span merge intervals at the same start column', () => {
    const part = load(
      TABLE(
        ROW(`<w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p/></w:tc>`),
        ROW(`<w:tc><w:tcPr><w:gridSpan w:val="2"/><w:vMerge/></w:tcPr><w:p/></w:tc>`, CELL('b'))
      )
    );
    const table = firstTable(part);
    const [, second] = rowIds(part, table.id);

    const result = applyTreeOp(part, {
      op: 'insertTableRow',
      tableId: table.id,
      rowId: second!,
      where: 'above',
    });
    expect(result.ok).toBe(true);
  });
});
