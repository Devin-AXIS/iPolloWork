// Cell merge and split through the tree ops.

import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { findNode } from '../package/ooxml-edit.ts';
import { applyTreeOp } from '../store/tree-ops.ts';
import { wmlAttributeValue, wmlChildNamed } from '../store/tree-op-table-shared.ts';
import { TreeDocumentStore } from '../store/tree-store.ts';
import type { TreeDocOp } from '../store/tree-op-types.ts';

const W = WML_NAMESPACE_URI;

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const P = (text: string): string => (text ? `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>` : '<w:p/>');
const CELL = (text: string, tcPr = ''): string =>
  `<w:tc>${tcPr ? `<w:tcPr>${tcPr}</w:tcPr>` : ''}${P(text)}</w:tc>`;
const ROW = (...cells: string[]): string => `<w:tr>${cells.join('')}</w:tr>`;
const GRID = (...widths: number[]): string =>
  `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`;
const TABLE = (grid: string, ...rows: string[]): string =>
  `<w:tbl><w:tblPr/>${grid}${rows.join('')}</w:tbl><w:p/>`;

function all(root: OoxmlNode, kind: OoxmlElement['kind']): OoxmlElement[] {
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

/** Rows of `text/span^` (`^` restart, `|` continue), paragraphs joined by `+`. */
function shape(part: OoxmlPart): string[] {
  const table = all(part.root, 'table')[0]!;
  return table.children
    .filter((child) => child.kind === 'tableRow')
    .map((row) =>
      (row as OoxmlElement).children
        .filter((child) => child.kind === 'tableCell')
        .map((cell) => {
          const tcPr = wmlChildNamed(cell as OoxmlElement, 'tcPr');
          const span = tcPr && wmlChildNamed(tcPr, 'gridSpan');
          const vMerge = tcPr && wmlChildNamed(tcPr, 'vMerge');
          const text = (cell as OoxmlElement).children
            .filter((child) => child.kind === 'paragraph')
            .map(textOf)
            .join('+');
          return (
            (text || '_') +
            (span ? `/${wmlAttributeValue(span, 'val')}` : '') +
            (vMerge ? (wmlAttributeValue(vMerge, 'val') === 'restart' ? '^' : '|') : '')
          );
        })
        .join(' ')
    );
}

function gridOf(part: OoxmlPart): string[] {
  const grid = wmlChildNamed(all(part.root, 'table')[0]!, 'tblGrid')!;
  return grid.children.map((col) => wmlAttributeValue(col as OoxmlElement, 'w') ?? '');
}

function cellIds(part: OoxmlPart): string[][] {
  return all(part.root, 'tableRow').map((row) =>
    row.children.filter((child) => child.kind === 'tableCell').map((cell) => cell.id)
  );
}

function tableId(part: OoxmlPart): string {
  return all(part.root, 'table')[0]!.id;
}

function apply(part: OoxmlPart, op: TreeDocOp): OoxmlPart {
  const result = applyTreeOp(part, op);
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function reopen(part: OoxmlPart): OoxmlPart {
  const result = readOoxmlPart(serializeOoxmlPart(part), {
    name: part.name,
    contentType: part.contentType,
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const THREE_BY_THREE = TABLE(
  GRID(1000, 2000, 3000),
  ROW(CELL('a'), CELL('b'), CELL('c')),
  ROW(CELL('d'), CELL(''), CELL('f')),
  ROW(CELL('g'), CELL('h'), CELL('i'))
);

describe('mergeTableCells', () => {
  test('merges a row into one spanning cell, content in reading order', () => {
    const part = load(THREE_BY_THREE);
    const ids = cellIds(part);
    const merged = apply(part, { op: 'mergeTableCells', tableId: tableId(part), cellIds: ids[0]! });
    expect(shape(merged)).toEqual(['a+b+c/3', 'd _ f', 'g h i']);
    // The head keeps its id; the moved paragraphs keep theirs.
    expect(cellIds(merged)[0]).toEqual([ids[0]![0]!]);
    const before = all(part.root, 'paragraph')
      .slice(0, 3)
      .map((p) => p.id);
    const after = all(merged.root, 'paragraph')
      .slice(0, 3)
      .map((p) => p.id);
    expect(after).toEqual(before);
    const tcW = wmlChildNamed(wmlChildNamed(all(merged.root, 'tableCell')[0]!, 'tcPr')!, 'tcW')!;
    expect(wmlAttributeValue(tcW, 'w')).toBe('6000');
    expect(shape(reopen(merged))).toEqual(shape(merged));
  });

  test('merges a column into a vertical merge and skips blank cells', () => {
    const part = load(THREE_BY_THREE);
    const ids = cellIds(part);
    const merged = apply(part, {
      op: 'mergeTableCells',
      tableId: tableId(part),
      cellIds: [ids[0]![1]!, ids[1]![1]!, ids[2]![1]!],
    });
    expect(shape(merged)).toEqual(['a b+h^ c', 'd _| f', 'g _| i']);
    // The blank middle cell keeps its own paragraph; the emptied bottom cell gets a fresh one.
    expect(cellIds(merged)[1]![1]).toBe(ids[1]![1]!);
  });

  test('a paragraph a vertical merge moves up stays addressable', () => {
    const part = load(THREE_BY_THREE);
    const ids = cellIds(part);
    const moved = all(part.root, 'paragraph')[7]!.id;
    // Look up first, so the merge patches an index instead of building a fresh one.
    expect(findNode(part, moved)).not.toBeNull();
    const merged = apply(part, {
      op: 'mergeTableCells',
      tableId: tableId(part),
      cellIds: [ids[0]![1]!, ids[1]![1]!, ids[2]![1]!],
    });
    expect(findNode(merged, moved)?.kind).toBe('paragraph');
    const head = all(merged.root, 'paragraph')[1]!.id;
    const joined = apply(merged, { op: 'joinParagraphs', firstId: head, secondId: moved });
    expect(shape(joined)).toEqual(['a bh^ c', 'd _| f', 'g _| i']);
  });

  test('merges a rectangle and names a merged cell by any part', () => {
    let part = load(THREE_BY_THREE);
    const ids = cellIds(part);
    part = apply(part, {
      op: 'mergeTableCells',
      tableId: tableId(part),
      cellIds: [ids[0]![0]!, ids[0]![1]!, ids[1]![0]!, ids[1]![1]!],
    });
    expect(shape(part)).toEqual(['a+b+d/2^ c', '_/2| f', 'g h i']);
    // The continuation alone names the whole merged cell.
    const next = cellIds(part);
    part = apply(part, {
      op: 'mergeTableCells',
      tableId: tableId(part),
      cellIds: [next[1]![0]!, next[1]![1]!],
    });
    expect(shape(part)).toEqual(['a+b+d+c+f/3^', '_/3|', 'g h i']);
  });

  test('refuses ragged, single, and unknown selections', () => {
    let part = load(THREE_BY_THREE);
    const ids = cellIds(part);
    const refuse = (cells: string[]) =>
      applyTreeOp(part, { op: 'mergeTableCells', tableId: tableId(part), cellIds: cells });
    expect(refuse([ids[0]![0]!])).toMatchObject({ ok: false, reason: 'cells-not-rectangle' });
    expect(refuse([ids[0]![0]!, 'nope'])).toMatchObject({ ok: false, reason: 'invalidArgs' });
    expect(refuse([])).toMatchObject({ ok: false, reason: 'invalidArgs' });
    part = apply(part, {
      op: 'mergeTableCells',
      tableId: tableId(part),
      cellIds: [ids[0]![1]!, ids[1]![1]!],
    });
    // d and h span rows 1 to 2, but the merged b cell there reaches up into row 0.
    const next = cellIds(part);
    expect(
      applyTreeOp(part, {
        op: 'mergeTableCells',
        tableId: tableId(part),
        cellIds: [next[1]![0]!, next[2]![1]!],
      })
    ).toMatchObject({ ok: false, reason: 'cells-not-rectangle' });
  });

  test('refuses tracked cell revisions and legacy horizontal merges', () => {
    const tracked = load(
      TABLE(GRID(1000, 1000), ROW(CELL('a', '<w:cellIns w:id="1" w:author="x"/>'), CELL('b')))
    );
    expect(
      applyTreeOp(tracked, {
        op: 'mergeTableCells',
        tableId: tableId(tracked),
        cellIds: cellIds(tracked)[0]!,
      })
    ).toMatchObject({ ok: false, reason: 'cell-has-revision' });
    const legacy = load(
      TABLE(
        GRID(1000, 1000, 1000),
        ROW(CELL('a', '<w:hMerge w:val="restart"/>'), CELL('', '<w:hMerge/>'), CELL('c'))
      )
    );
    expect(
      applyTreeOp(legacy, {
        op: 'mergeTableCells',
        tableId: tableId(legacy),
        cellIds: cellIds(legacy)[0]!,
      })
    ).toMatchObject({ ok: false, reason: 'table-has-merge' });
  });

  test('undo restores the table and redo replays it', () => {
    const part = load(THREE_BY_THREE);
    const store = new TreeDocumentStore(part);
    const ids = cellIds(part);
    const result = store.transact((tx) => {
      tx.apply({ op: 'mergeTableCells', tableId: tableId(part), cellIds: ids[2]! });
    });
    expect(result.ok).toBe(true);
    expect(shape(store.part)).toEqual(['a b c', 'd _ f', 'g+h+i/3']);
    store.undo();
    expect(store.part).toBe(part);
    store.redo();
    expect(shape(store.part)).toEqual(['a b c', 'd _ f', 'g+h+i/3']);
  });
});

describe('splitTableCell', () => {
  test('splits a cell into columns, cutting the grid and widening other rows', () => {
    const part = load(
      TABLE(GRID(3000, 3000), ROW(CELL('a'), CELL('b')), ROW(CELL('c'), CELL('d')))
    );
    const ids = cellIds(part);
    const split = apply(part, {
      op: 'splitTableCell',
      tableId: tableId(part),
      cellId: ids[0]![0]!,
      rows: 1,
      columns: 2,
    });
    expect(shape(split)).toEqual(['a _ b', 'c/2 d']);
    expect(gridOf(split)).toEqual(['1500', '1500', '3000']);
    expect(cellIds(split)[0]![0]).toBe(ids[0]![0]!);
    expect(shape(reopen(split))).toEqual(shape(split));
  });

  test('a merged cell splits back along its own columns', () => {
    let part = load(THREE_BY_THREE);
    const ids = cellIds(part);
    part = apply(part, {
      op: 'mergeTableCells',
      tableId: tableId(part),
      cellIds: ids[0]!.slice(0, 2),
    });
    expect(shape(part)).toEqual(['a+b/2 c', 'd _ f', 'g h i']);
    // 3000 split in two lands 1500, which is not a grid boundary (1000), so it cuts.
    const split = apply(part, {
      op: 'splitTableCell',
      tableId: tableId(part),
      cellId: ids[0]![0]!,
      rows: 1,
      columns: 3,
    });
    expect(gridOf(split)).toEqual(['1000', '1000', '1000', '3000']);
    expect(shape(split)).toEqual(['a+b _ _ c', 'd _/2 f', 'g h/2 i']);
  });

  test('splits a one-row cell into rows; other cells continue through them', () => {
    const part = load(
      TABLE(GRID(2000, 2000), ROW(CELL('a'), CELL('b')), ROW(CELL('c'), CELL('d')))
    );
    const ids = cellIds(part);
    const split = apply(part, {
      op: 'splitTableCell',
      tableId: tableId(part),
      cellId: ids[0]![1]!,
      rows: 3,
      columns: 1,
    });
    expect(shape(split)).toEqual(['a^ b', '_| _', '_| _', 'c d']);
    expect(shape(reopen(split))).toEqual(shape(split));
  });

  test('splits a vertical merge into bands and refuses a non-divisor', () => {
    let part = load(THREE_BY_THREE);
    const ids = cellIds(part);
    part = apply(part, {
      op: 'mergeTableCells',
      tableId: tableId(part),
      cellIds: [ids[0]![0]!, ids[1]![0]!],
    });
    expect(shape(part)).toEqual(['a+d^ b c', '_| _ f', 'g h i']);
    expect(
      applyTreeOp(part, {
        op: 'splitTableCell',
        tableId: tableId(part),
        cellId: ids[0]![0]!,
        rows: 3,
        columns: 1,
      })
    ).toMatchObject({ ok: false, reason: 'split-rows-not-divisor' });
    // The continuation is a fresh cell, because its content moved into the merged cell.
    const split = apply(part, {
      op: 'splitTableCell',
      tableId: tableId(part),
      cellId: cellIds(part)[1]![0]!,
      rows: 2,
      columns: 1,
    });
    expect(shape(split)).toEqual(['a+d b c', '_ _ f', 'g h i']);
  });

  test('splits rows and columns at once', () => {
    const part = load(TABLE(GRID(4000), ROW(CELL('x'))));
    const split = apply(part, {
      op: 'splitTableCell',
      tableId: tableId(part),
      cellId: cellIds(part)[0]![0]!,
      rows: 2,
      columns: 2,
    });
    expect(shape(split)).toEqual(['x _', '_ _']);
    expect(gridOf(split)).toEqual(['2000', '2000']);
  });

  test('refuses bad counts and narrow cells', () => {
    const part = load(TABLE(GRID(500, 3000), ROW(CELL('a'), CELL('b'))));
    const cell = cellIds(part)[0]![0]!;
    const refuse = (rows: number, columns: number) =>
      applyTreeOp(part, {
        op: 'splitTableCell',
        tableId: tableId(part),
        cellId: cell,
        rows,
        columns,
      });
    expect(refuse(1, 1)).toMatchObject({ ok: false, reason: 'invalidArgs' });
    expect(refuse(0, 2)).toMatchObject({ ok: false, reason: 'invalidArgs' });
    expect(refuse(1, 64)).toMatchObject({ ok: false, reason: 'invalidArgs' });
    expect(refuse(1, 1.5)).toMatchObject({ ok: false, reason: 'invalidArgs' });
    expect(refuse(1, 2)).toMatchObject({ ok: false, reason: 'cell-too-narrow' });
  });

  test('without a grid, splits only along whole columns', () => {
    const part = load(
      `<w:tbl><w:tblPr/>${ROW(CELL('a', '<w:gridSpan w:val="2"/>'), CELL('b'))}${ROW(CELL('c'), CELL('d'), CELL('e'))}</w:tbl><w:p/>`
    );
    const cell = cellIds(part)[0]![0]!;
    const split = apply(part, {
      op: 'splitTableCell',
      tableId: tableId(part),
      cellId: cell,
      rows: 1,
      columns: 2,
    });
    expect(shape(split)).toEqual(['a _ b', 'c d e']);
    expect(
      applyTreeOp(part, {
        op: 'splitTableCell',
        tableId: tableId(part),
        cellId: cell,
        rows: 1,
        columns: 3,
      })
    ).toMatchObject({ ok: false, reason: 'split-needs-grid' });
  });
});

describe('column edits in a table with merged cells', () => {
  const gridIds = (part: OoxmlPart): string[] =>
    wmlChildNamed(all(part.root, 'table')[0]!, 'tblGrid')!.children.map((col) => col.id);

  function mergedHeader(): OoxmlPart {
    const part = load(THREE_BY_THREE);
    return apply(part, {
      op: 'mergeTableCells',
      tableId: tableId(part),
      cellIds: cellIds(part)[0]!,
    });
  }

  test('an insert inside a merged span widens it; other rows gain a cell', () => {
    const part = mergedHeader();
    const next = apply(part, {
      op: 'insertTableColumn',
      tableId: tableId(part),
      where: 'right',
      gridColumnId: gridIds(part)[0]!,
    });
    expect(shape(next)).toEqual(['a+b+c/4', 'd _ _ f', 'g _ h i']);
    expect(gridOf(next)).toEqual(['1000', '1000', '2000', '3000']);
    const tcW = wmlChildNamed(wmlChildNamed(all(next.root, 'tableCell')[0]!, 'tcPr')!, 'tcW')!;
    expect(wmlAttributeValue(tcW, 'w')).toBe('7000');
    expect(shape(reopen(next))).toEqual(shape(next));
  });

  test('an insert at the edge of a merged span adds a cell beside it', () => {
    const part = mergedHeader();
    const next = apply(part, {
      op: 'insertTableColumn',
      tableId: tableId(part),
      where: 'right',
      gridColumnId: gridIds(part)[2]!,
    });
    expect(shape(next)).toEqual(['a+b+c/3 _', 'd _ f _', 'g h i _']);
  });

  test('a new column beside a vertical merge is merged the same way', () => {
    let part = load(THREE_BY_THREE);
    const ids = cellIds(part);
    part = apply(part, {
      op: 'mergeTableCells',
      tableId: tableId(part),
      cellIds: [ids[0]![0]!, ids[1]![0]!],
    });
    const next = apply(part, {
      op: 'insertTableColumn',
      tableId: tableId(part),
      where: 'left',
      gridColumnId: gridIds(part)[0]!,
    });
    expect(shape(next)).toEqual(['_^ a+d^ b c', '_| _| _ f', '_ g h i']);
  });

  test('a delete narrows a merged span and removes single cells', () => {
    const part = mergedHeader();
    const next = apply(part, {
      op: 'deleteTableColumn',
      tableId: tableId(part),
      gridColumnId: gridIds(part)[1]!,
    });
    expect(shape(next)).toEqual(['a+b+c/2', 'd f', 'g i']);
    expect(gridOf(next)).toEqual(['1000', '3000']);
    const tcW = wmlChildNamed(wmlChildNamed(all(next.root, 'tableCell')[0]!, 'tcPr')!, 'tcW')!;
    expect(wmlAttributeValue(tcW, 'w')).toBe('4000');
  });

  test('undo of a merged-table column insert restores the table', () => {
    const part = mergedHeader();
    const store = new TreeDocumentStore(part);
    const result = store.transact((tx) => {
      tx.apply({
        op: 'insertTableColumn',
        tableId: tableId(part),
        where: 'left',
        gridColumnId: gridIds(part)[1]!,
      });
    });
    expect(result.ok).toBe(true);
    store.undo();
    expect(store.part).toBe(part);
  });

  test('a narrowed cell takes its width from the grid, not a declared width that disagrees', () => {
    const part = load(
      TABLE(
        GRID(3000, 3000),
        ROW(CELL('a', '<w:tcW w:w="1000" w:type="dxa"/><w:gridSpan w:val="2"/>')),
        ROW(CELL('c'), CELL('d'))
      )
    );
    const next = apply(part, {
      op: 'deleteTableColumn',
      tableId: tableId(part),
      gridColumnId: gridIds(part)[1]!,
    });
    const tcW = wmlChildNamed(wmlChildNamed(all(next.root, 'tableCell')[0]!, 'tcPr')!, 'tcW')!;
    expect(wmlAttributeValue(tcW, 'w')).toBe('3000');
  });

  test('a row that ends early keeps ending there through column edits', () => {
    // Concurrent structure edits can leave a row short of the grid.
    const part = load(
      TABLE(
        GRID(1000, 1000, 1000),
        ROW(CELL('a', '<w:gridSpan w:val="2"/>'), CELL('c')),
        ROW(CELL('d'), CELL('e'))
      )
    );
    const grid = gridIds(part);
    const inserted = apply(part, {
      op: 'insertTableColumn',
      tableId: tableId(part),
      where: 'right',
      gridColumnId: grid[2]!,
    });
    expect(shape(inserted)).toEqual(['a/2 c _', 'd e']);
    const deleted = apply(part, {
      op: 'deleteTableColumn',
      tableId: tableId(part),
      gridColumnId: grid[2]!,
    });
    expect(shape(deleted)).toEqual(['a/2', 'd e']);
    expect(gridOf(deleted)).toEqual(['1000', '1000']);
  });

  test('authored row gaps and broken vertical merges refuse as a table the grid cannot place', () => {
    const gap = load(
      TABLE(
        GRID(1000, 1000),
        `<w:tr><w:trPr><w:gridAfter w:val="1"/></w:trPr>${CELL('a', '<w:vMerge w:val="restart"/>')}</w:tr>`,
        ROW(CELL('', '<w:vMerge/>'), CELL('d'))
      )
    );
    expect(
      applyTreeOp(gap, {
        op: 'insertTableColumn',
        tableId: tableId(gap),
        where: 'left',
        gridColumnId: gridIds(gap)[0]!,
      })
    ).toMatchObject({ ok: false, reason: 'row-hides-cell' });
    const broken = load(
      TABLE(GRID(1000, 1000), ROW(CELL('a'), CELL('b')), ROW(CELL('', '<w:vMerge/>'), CELL('d')))
    );
    expect(
      applyTreeOp(broken, {
        op: 'mergeTableCells',
        tableId: tableId(broken),
        cellIds: cellIds(broken)[0]!,
      })
    ).toMatchObject({ ok: false, reason: 'row-hides-cell' });
  });
});
