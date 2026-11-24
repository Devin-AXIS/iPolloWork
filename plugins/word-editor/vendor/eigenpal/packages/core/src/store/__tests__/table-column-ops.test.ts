// Column insertion and deletion through TreeDocumentStore (table-editing task 4).

import { describe, expect, test } from 'bun:test';
import {
  canonicalOoxmlFingerprint,
  readOoxmlPart,
  serializeOoxmlPart,
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { applyTreeOp, validateTreeOp } from '../store/tree-ops.ts';
import { validateTableColumnOp } from '../store/tree-op-tables.ts';
import { wmlChildNamed } from '../store/tree-op-table-shared.ts';
import { paragraphIdsWithin } from '../store/tree-op-blocks.ts';
import { isValidParaId, paraIdOf } from '../package/para-id.ts';
import { diffSemanticDigests, semanticDigest } from '../package/ooxml-digest.ts';
import { MAX_TABLE_COLUMNS } from '../store/table-constraints.ts';
import { TreeDocumentStore } from '../store/tree-store.ts';
import { runWithTransactionActor } from '../package/actor-scoped-ids.ts';

const W = WML_NAMESPACE_URI;
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const FOREIGN = 'http://example.com/foreign';

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

function gridColIds(part: OoxmlPart, tableId: string): string[] {
  const table = collectByKind(part.root, 'table').find((t) => t.id === tableId);
  if (!table) throw new Error('table missing');
  const grid = wmlChildNamed(table, 'tblGrid');
  if (!grid) return [];
  return grid.children
    .filter((c) => c.kind !== 'textValue' && c.localName === 'gridCol')
    .map((c) => c.id);
}

function rowCellIds(part: OoxmlPart, rowId: string): string[] {
  const row = collectByKind(part.root, 'tableRow').find((r) => r.id === rowId);
  if (!row) throw new Error('row missing');
  return row.children.filter((c) => c.kind === 'tableCell').map((c) => c.id);
}

function firstParagraphInCell(part: OoxmlPart, cellId: string): OoxmlElement | undefined {
  const cell = collectByKind(part.root, 'tableCell').find((c) => c.id === cellId);
  if (!cell) return undefined;
  return cell.children.find((c) => c.kind === 'paragraph') as OoxmlElement | undefined;
}

function gridColAttributes(
  part: OoxmlPart,
  gridColId: string
): { localName: string; value: string }[] {
  const col = collectByKind(part.root, 'generic').find(
    (n) => n.id === gridColId && n.localName === 'gridCol'
  );
  if (!col) return [];
  return col.attributes.map((a) => ({ localName: a.localName, value: a.value }));
}

function collectParagraphParaIds(part: OoxmlPart): string[] {
  return collectByKind(part.root, 'paragraph')
    .map((p) => paraIdOf(p))
    .filter((id): id is string => id !== null);
}

function directRowsOfTable(table: OoxmlElement): OoxmlElement[] {
  return table.children.filter((c) => c.kind === 'tableRow') as OoxmlElement[];
}

function tableById(part: OoxmlPart, tableId: string): OoxmlElement {
  const table = collectByKind(part.root, 'table').find((t) => t.id === tableId);
  if (!table) throw new Error(`table missing: ${tableId}`);
  return table;
}

/** Expected target-local insert effects from topology and row/grid child differences. */
function expectedInsertColumnEffects(
  before: OoxmlPart,
  after: OoxmlPart,
  tableId: string
): { readonly dirty: string[]; readonly created: string[]; readonly deleted: string[] } {
  const tableBefore = tableById(before, tableId);
  const tableAfter = tableById(after, tableId);
  const gridBefore = wmlChildNamed(tableBefore, 'tblGrid');
  const gridAfter = wmlChildNamed(tableAfter, 'tblGrid');
  const synthesized = gridBefore === undefined;

  const rows = directRowsOfTable(tableAfter);
  const dirty = [tableId, ...rows.map((row) => row.id)];
  if (!synthesized && gridBefore) dirty.push(gridBefore.id);

  const beforeGridColIds = new Set(gridColIds(before, tableId));
  const created: string[] = [];
  if (synthesized && gridAfter) {
    created.push(gridAfter.id, ...gridColIds(after, tableId));
  } else {
    for (const id of gridColIds(after, tableId)) {
      if (!beforeGridColIds.has(id)) created.push(id);
    }
  }

  for (const row of rows) {
    const beforeCellIds = new Set(rowCellIds(before, row.id));
    for (const cellId of rowCellIds(after, row.id)) {
      if (!beforeCellIds.has(cellId)) {
        created.push(cellId);
        const para = firstParagraphInCell(after, cellId);
        if (para) created.push(para.id);
      }
    }
  }

  return {
    dirty: [...dirty].sort(),
    created: [...new Set(created)].sort(),
    deleted: [],
  };
}

/** Expected target-local delete effects from column topology before the edit. */
function expectedDeleteColumnEffects(
  before: OoxmlPart,
  tableId: string,
  columnIndex: number
): { readonly dirty: string[]; readonly created: string[]; readonly deleted: string[] } {
  const table = tableById(before, tableId);
  const grid = wmlChildNamed(table, 'tblGrid');
  if (!grid) throw new Error('grid missing');
  const colId = gridColIds(before, tableId)[columnIndex];
  if (!colId) throw new Error('column missing');
  const rows = directRowsOfTable(table);
  const deletedCells = rows.map((row) => rowCellIds(before, row.id)[columnIndex]!);
  const deletedParagraphs = deletedCells.flatMap((cellId) => {
    const cell = collectByKind(before.root, 'tableCell').find((c) => c.id === cellId);
    return cell ? paragraphIdsWithin(cell) : [];
  });
  return {
    dirty: [tableId, grid.id, ...rows.map((row) => row.id)].sort(),
    created: [],
    deleted: [colId, ...deletedCells, ...deletedParagraphs].sort(),
  };
}

function expectSemanticEffects(
  effect: {
    readonly dirty: readonly string[];
    readonly created: readonly string[];
    readonly deleted: readonly string[];
  },
  expected: {
    readonly dirty: readonly string[];
    readonly created: readonly string[];
    readonly deleted: readonly string[];
  }
): void {
  expect([...effect.dirty].sort()).toEqual([...expected.dirty].sort());
  expect([...effect.created].sort()).toEqual([...expected.created].sort());
  expect([...effect.deleted].sort()).toEqual([...expected.deleted].sort());
}

function outerTableSiblingStructuralIds(part: OoxmlPart, outer: OoxmlElement): Set<string> {
  const ids = new Set<string>(gridColIds(part, outer.id));
  const row = outer.children.find((c) => c.kind === 'tableRow');
  if (row && row.kind !== 'textValue') {
    const cells = row.children.filter((c) => c.kind === 'tableCell');
    const siblingCell = cells[cells.length - 1];
    if (siblingCell && siblingCell.kind !== 'textValue') {
      ids.add(siblingCell.id);
      const para = siblingCell.children.find((c) => c.kind === 'paragraph');
      if (para && para.kind !== 'textValue') ids.add(para.id);
    }
  }
  return ids;
}

const NESTED_TABLE = (): string =>
  `<w:tbl><w:tblGrid><w:gridCol w:w="4800"/><w:gridCol w:w="2400"/></w:tblGrid>` +
  `<w:tr><w:tc>` +
  `<w:tbl><w:tblGrid><w:gridCol w:w="1200"/><w:gridCol w:w="1200"/></w:tblGrid>` +
  `${ROW(CELL('n1'), CELL('n2'))}</w:tbl></w:tc>${CELL('outer')}</w:tr></w:tbl>`;

function gridColWidth(part: OoxmlPart, gridColId: string): string | undefined {
  const attrs = gridColAttributes(part, gridColId);
  return attrs.find((a) => a.localName === 'w')?.value;
}

const CELL = (text: string, width = '2400'): string =>
  `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>` +
  `<w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;

const ROW = (...cells: string[]): string => `<w:tr>${cells.join('')}</w:tr>`;

const TABLE = (...rows: string[]): string =>
  `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>${rows.join('')}</w:tbl>`;

describe('insertTableColumn', () => {
  test('inserts left of the target grid column in grid and row order', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2')), ROW(CELL('b1'), CELL('b2'))));
    const table = firstTable(part);
    const [col1, col2] = gridColIds(part, table.id);
    const rows = collectByKind(part.root, 'tableRow');
    const beforeSecondCells = rowCellIds(part, rows[0]!.id);

    const result = applyTreeOp(part, {
      op: 'insertTableColumn',
      tableId: table.id,
      gridColumnId: col2!,
      where: 'left',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const cols = gridColIds(result.part, table.id);
    expect(cols).toHaveLength(3);
    expect(cols[2]).toBe(col2);
    expect(cols[0]).toBe(col1);
    expect(cols[1]).not.toBe(col1);
    expect(cols[1]).not.toBe(col2);

    const afterFirstCells = rowCellIds(result.part, rows[0]!.id);
    expect(afterFirstCells).toHaveLength(3);
    expect(afterFirstCells[2]).toBe(beforeSecondCells[1]);
    expect(afterFirstCells[1]).not.toBe(beforeSecondCells[0]);
    expect(afterFirstCells[1]).not.toBe(beforeSecondCells[1]);
    expect(afterFirstCells[0]).toBe(beforeSecondCells[0]);
  });

  test('inserts right of the target grid column', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2'))));
    const table = firstTable(part);
    const [col1] = gridColIds(part, table.id);
    const rows = collectByKind(part.root, 'tableRow');
    const beforeCells = rowCellIds(part, rows[0]!.id);

    const result = applyTreeOp(part, {
      op: 'insertTableColumn',
      tableId: table.id,
      gridColumnId: col1!,
      where: 'right',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(gridColIds(result.part, table.id)).toHaveLength(3);
    const afterCells = rowCellIds(result.part, rows[0]!.id);
    expect(afterCells).toHaveLength(3);
    expect(afterCells[0]).toBe(beforeCells[0]);
    expect(afterCells[1]).not.toBe(beforeCells[1]);
    expect(afterCells[2]).toBe(beforeCells[1]);
  });

  test('chooses adjacent gridCol width from the reference column', () => {
    const part = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>` +
        `${ROW(CELL('a1'), CELL('a2'))}</w:tbl>`
    );
    const table = firstTable(part);
    const [, col2] = gridColIds(part, table.id);

    const result = applyTreeOp(part, {
      op: 'insertTableColumn',
      tableId: table.id,
      gridColumnId: col2!,
      where: 'left',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const cols = gridColIds(result.part, table.id);
    const insertedId = cols.find((id) => id !== col2 && gridColWidth(result.part, id) === '3600');
    expect(insertedId).toBeDefined();
    expect(gridColWidth(result.part, cols[1]!)).toBe('3600');
  });

  test('mints one fresh cell and paragraph per row', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2')), ROW(CELL('b1'), CELL('b2'))));
    const table = firstTable(part);
    const [, col2] = gridColIds(part, table.id);
    const beforeIds = new Set<string>();
    const walk = (node: OoxmlNode): void => {
      beforeIds.add(node.id);
      if (node.kind === 'textValue') return;
      for (const child of node.children) walk(child);
    };
    walk(part.root);

    const result = applyTreeOp(part, {
      op: 'insertTableColumn',
      tableId: table.id,
      gridColumnId: col2!,
      where: 'left',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const newCells = result.effect.created.filter((id) =>
      collectByKind(result.part.root, 'tableCell').some((c) => c.id === id)
    );
    expect(newCells).toHaveLength(2);
    for (const id of newCells) expect(beforeIds.has(id)).toBe(false);

    const newParagraphs = result.effect.created.filter((id) =>
      collectByKind(result.part.root, 'paragraph').some((p) => p.id === id)
    );
    expect(newParagraphs).toHaveLength(2);
    for (const id of newParagraphs) expect(beforeIds.has(id)).toBe(false);
  });

  test('projects safe tcPr skeleton from the reference column only', () => {
    const part = load(
      `<w:tbl xmlns:x="${FOREIGN}"><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>` +
        `<w:tr>` +
        `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/><w:shd w:fill="FF0000"/></w:tcPr><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc>` +
        `<w:tc><w:tcPr><w:tcW w:w="3600" w:type="dxa"/><w:shd w:fill="00FF00"/><x:ext/></w:tcPr><w:p><w:r><w:t>b</w:t></w:r></w:p></w:tc>` +
        `</w:tr></w:tbl>`
    );
    const table = firstTable(part);
    const [, col2] = gridColIds(part, table.id);
    const sourceCell = collectByKind(part.root, 'tableCell')[1]!;
    const foreignBefore = wmlChildNamed(sourceCell, 'tcPr')!.children.find(
      (c) => c.kind !== 'textValue' && c.localName === 'ext'
    );

    const result = applyTreeOp(part, {
      op: 'insertTableColumn',
      tableId: table.id,
      gridColumnId: col2!,
      where: 'left',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const insertedCellId = result.effect.created.find((id) =>
      collectByKind(result.part.root, 'tableCell').some((c) => c.id === id)
    )!;
    const insertedCell = collectByKind(result.part.root, 'tableCell').find(
      (c) => c.id === insertedCellId
    )!;
    const tcPr = wmlChildNamed(insertedCell, 'tcPr');
    expect(tcPr).toBeDefined();
    expect(wmlChildNamed(tcPr!, 'shd')).toBeDefined();
    expect(tcPr!.children.some((c) => c.localName === 'ext')).toBe(false);
    expect(foreignBefore).toBeDefined();
    expect(wmlChildNamed(sourceCell, 'tcPr')!.children.some((c) => c === foreignBefore)).toBe(true);
  });

  test('returns caret metadata for the first inserted cell paragraph', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2')), ROW(CELL('b1'), CELL('b2'))));
    const table = firstTable(part);
    const [, col2] = gridColIds(part, table.id);

    const result = applyTreeOp(part, {
      op: 'insertTableColumn',
      tableId: table.id,
      gridColumnId: col2!,
      where: 'left',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.effect.caret).toEqual({ paragraphId: expect.any(String) });
    const paragraph = collectByKind(result.part.root, 'paragraph').find(
      (p) => p.id === result.effect.caret!.paragraphId
    );
    expect(paragraph).toBeDefined();
    expect(result.effect.created).toContain(result.effect.caret!.paragraphId);
  });

  test('synthesizes tblGrid when absent and targets by reference cell id', () => {
    const part = load(`<w:tbl>${ROW(CELL('only', '1800'), CELL('two', '2200'))}</w:tbl>`);
    const table = firstTable(part);
    expect(gridColIds(part, table.id)).toEqual([]);
    const referenceCell = collectByKind(part.root, 'tableCell')[1]!;

    const result = applyTreeOp(part, {
      op: 'insertTableColumn',
      tableId: table.id,
      referenceCellId: referenceCell.id,
      where: 'left',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const cols = gridColIds(result.part, table.id);
    expect(cols).toHaveLength(3);
    expect(collectByKind(result.part.root, 'tableCell')).toHaveLength(3);
    expect(gridColWidth(result.part, cols[1]!)).toBe('2200');
  });

  test('rejects gridColumnId when tblGrid is absent', () => {
    const part = load(`<w:tbl>${ROW(CELL('a'), CELL('b'))}</w:tbl>`);
    const table = firstTable(part);
    const cell = collectByKind(part.root, 'tableCell')[0]!;
    expect(
      validateTableColumnOp(part, {
        op: 'insertTableColumn',
        tableId: table.id,
        gridColumnId: cell.id,
        where: 'left',
      })
    ).toBe('invalidArgs');
  });

  test('rejects referenceCellId when tblGrid exists', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2'))));
    const table = firstTable(part);
    const cell = collectByKind(part.root, 'tableCell')[0]!;
    expect(
      validateTableColumnOp(part, {
        op: 'insertTableColumn',
        tableId: table.id,
        referenceCellId: cell.id,
        where: 'left',
      })
    ).toBe('invalidArgs');
  });

  test('preserves unknown table and row children outside changed cells', () => {
    const part = load(
      `<w:tbl xmlns:x="${FOREIGN}"><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>` +
        `<x:meta/>` +
        `<w:tr><x:note/>${CELL('a1')}${CELL('a2')}</w:tr></w:tbl>`
    );
    const table = firstTable(part);
    const [, col2] = gridColIds(part, table.id);
    const meta = table.children.find((c) => c.localName === 'meta');
    const note = collectByKind(part.root, 'tableRow')[0]!.children.find(
      (c) => c.localName === 'note'
    );

    const result = applyTreeOp(part, {
      op: 'insertTableColumn',
      tableId: table.id,
      gridColumnId: col2!,
      where: 'left',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const editedTable = collectByKind(result.part.root, 'table').find((t) => t.id === table.id)!;
    expect(editedTable.children.find((c) => c === meta)).toBe(meta);
    const editedRow = collectByKind(result.part.root, 'tableRow')[0]!;
    expect(editedRow.children.find((c) => c === note)).toBe(note);
  });

  test('does not mutate nested tables', () => {
    const part = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>` +
        `<w:tr><w:tc><w:tbl><w:tblGrid><w:gridCol w:w="1200"/></w:tblGrid>${ROW(CELL('n'))}</w:tbl></w:tc>${CELL('o')}</w:tr></w:tbl>`
    );
    const outer = firstTable(part);
    const inner = collectByKind(part.root, 'table')[1]!;
    const innerGridBefore = gridColIds(part, inner.id);
    const [, outerCol2] = gridColIds(part, outer.id);

    const result = applyTreeOp(part, {
      op: 'insertTableColumn',
      tableId: outer.id,
      gridColumnId: outerCol2!,
      where: 'left',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(gridColIds(result.part, inner.id)).toEqual(innerGridBefore);
    expect(collectByKind(result.part.root, 'table')).toHaveLength(2);
  });

  test('refuses merged tables with gridSpan', () => {
    const part = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>` +
        `<w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p/></w:tc></w:tr></w:tbl>`
    );
    const table = firstTable(part);
    const [col1] = gridColIds(part, table.id);
    expect(
      validateTableColumnOp(part, {
        op: 'insertTableColumn',
        tableId: table.id,
        gridColumnId: col1!,
        where: 'left',
      })
    ).toBe('table-has-merge');
  });

  test.each([
    ['absent val', '<w:gridSpan/>'],
    ['val=1', '<w:gridSpan w:val="1"/>'],
    ['val=0', '<w:gridSpan w:val="0"/>'],
    ['malformed val', '<w:gridSpan w:val="bogus"/>'],
  ] as const)('refuses gridSpan presence (%s)', (_label, gridSpanMarkup) => {
    const part = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>` +
        `<w:tr><w:tc><w:tcPr>${gridSpanMarkup}</w:tcPr><w:p/></w:tc><w:tc><w:p/></w:tc></w:tr></w:tbl>`
    );
    const table = firstTable(part);
    const [col1] = gridColIds(part, table.id);
    expect(
      validateTableColumnOp(part, {
        op: 'insertTableColumn',
        tableId: table.id,
        gridColumnId: col1!,
        where: 'left',
      })
    ).toBe('table-has-merge');
  });

  test('refuses legacy hMerge tables and accepts vMerge tables', () => {
    const partH = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>` +
        `<w:tr><w:tc><w:tcPr><w:hMerge w:val="1"/></w:tcPr><w:p/></w:tc></w:tr></w:tbl>`
    );
    const tableH = firstTable(partH);
    const [colH] = gridColIds(partH, tableH.id);
    expect(
      validateTreeOp(partH, {
        op: 'insertTableColumn',
        tableId: tableH.id,
        gridColumnId: colH!,
        where: 'left',
      })
    ).toBe('table-has-merge');

    const partV = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>` +
        `<w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p/></w:tc><w:tc><w:p/></w:tc></w:tr>` +
        `<w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc><w:p/></w:tc></w:tr></w:tbl>`
    );
    const tableV = firstTable(partV);
    const [colV] = gridColIds(partV, tableV.id);
    expect(
      validateTreeOp(partV, {
        op: 'insertTableColumn',
        tableId: tableV.id,
        gridColumnId: colV!,
        where: 'left',
      })
    ).toBeNull();
  });

  test('refuses irregular rows and grid/cell count mismatch', () => {
    const irregular = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/><w:gridCol w:w="1200"/></w:tblGrid>` +
        `${ROW(CELL('a1'), CELL('a2'))}${ROW(CELL('b1'), CELL('b2'), CELL('b3'))}</w:tbl>`
    );
    const tableI = firstTable(irregular);
    const [colI] = gridColIds(irregular, tableI.id);
    expect(
      validateTableColumnOp(irregular, {
        op: 'insertTableColumn',
        tableId: tableI.id,
        gridColumnId: colI!,
        where: 'left',
      })
    ).toBe('tree-invariant');

    const mismatch = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/><w:gridCol w:w="1200"/></w:tblGrid>` +
        `${ROW(CELL('a1'), CELL('a2'))}</w:tbl>`
    );
    const tableM = firstTable(mismatch);
    const [colM] = gridColIds(mismatch, tableM.id);
    expect(
      validateTableColumnOp(mismatch, {
        op: 'insertTableColumn',
        tableId: tableM.id,
        gridColumnId: colM!,
        where: 'left',
      })
    ).toBe('tree-invariant');
  });

  test('refuses when max columns would be exceeded', () => {
    const cols = Array.from({ length: MAX_TABLE_COLUMNS }, () => '<w:gridCol w:w="100"/>').join('');
    const cells = Array.from({ length: MAX_TABLE_COLUMNS }, (_, i) => CELL(`c${i}`, '100')).join(
      ''
    );
    const part = load(`<w:tbl><w:tblGrid>${cols}</w:tblGrid><w:tr>${cells}</w:tr></w:tbl>`);
    const table = firstTable(part);
    const gridCols = gridColIds(part, table.id);
    expect(
      validateTableColumnOp(part, {
        op: 'insertTableColumn',
        tableId: table.id,
        gridColumnId: gridCols[0]!,
        where: 'right',
      })
    ).toBe('resource-limit');
  });

  test('insert save/reopen matches edited fingerprint and semantic digest', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2')), ROW(CELL('b1'), CELL('b2'))));
    const table = firstTable(part);
    const [, col2] = gridColIds(part, table.id);

    const result = applyTreeOp(part, {
      op: 'insertTableColumn',
      tableId: table.id,
      gridColumnId: col2!,
      where: 'left',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const serialized = serializeOoxmlPart(result.part);
    const reopened = readOoxmlPart(serialized, {
      name: part.name,
      contentType: part.contentType,
    });
    if (!reopened.ok) throw new Error(reopened.reason);

    expect(canonicalOoxmlFingerprint(reopened.part)).toBe(canonicalOoxmlFingerprint(result.part));
    expect(
      diffSemanticDigests(semanticDigest([result.part]), semanticDigest([reopened.part]))
    ).toEqual([]);
  });
});

describe('deleteTableColumn', () => {
  test('removes one grid column and matching cell from every row', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2')), ROW(CELL('b1'), CELL('b2'))));
    const table = firstTable(part);
    const [, col2] = gridColIds(part, table.id);
    const rows = collectByKind(part.root, 'tableRow');
    const deletedCell = rowCellIds(part, rows[0]!.id)[1]!;

    const result = applyTreeOp(part, {
      op: 'deleteTableColumn',
      tableId: table.id,
      gridColumnId: col2!,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(gridColIds(result.part, table.id)).toHaveLength(1);
    expect(rowCellIds(result.part, rows[0]!.id)).toHaveLength(1);
    expect(result.effect.deleted).toContain(col2);
    expect(result.effect.deleted).toContain(deletedCell);
    expect(result.effect.impact).toBe('flow-structural');
  });

  test('returns nearest surviving caret in the first row', () => {
    const part = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/><w:gridCol w:w="1200"/></w:tblGrid>` +
        `${ROW(CELL('a1'), CELL('a2'), CELL('a3'))}</w:tbl>`
    );
    const table = firstTable(part);
    const [, col2] = gridColIds(part, table.id);
    const survivingCell = rowCellIds(part, collectByKind(part.root, 'tableRow')[0]!.id)[2]!;

    const result = applyTreeOp(part, {
      op: 'deleteTableColumn',
      tableId: table.id,
      gridColumnId: col2!,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.effect.caret?.paragraphId).toBe(
      firstParagraphInCell(result.part, survivingCell)?.id
    );
  });

  test('returns left neighbor caret when deleting the final column', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2'))));
    const table = firstTable(part);
    const [, col2] = gridColIds(part, table.id);
    const leftCell = rowCellIds(part, collectByKind(part.root, 'tableRow')[0]!.id)[0]!;

    const result = applyTreeOp(part, {
      op: 'deleteTableColumn',
      tableId: table.id,
      gridColumnId: col2!,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.effect.caret?.paragraphId).toBe(firstParagraphInCell(result.part, leftCell)?.id);
  });

  test('refuses deleting the final column', () => {
    const part = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>${ROW(CELL('only'))}</w:tbl>`
    );
    const table = firstTable(part);
    const [col] = gridColIds(part, table.id);
    expect(
      validateTableColumnOp(part, {
        op: 'deleteTableColumn',
        tableId: table.id,
        gridColumnId: col!,
      })
    ).toBe('block-required');
  });

  test('refuses deletion without tblGrid', () => {
    const part = load(`<w:tbl>${ROW(CELL('a'), CELL('b'))}</w:tbl>`);
    const table = firstTable(part);
    const cell = collectByKind(part.root, 'tableCell')[0]!;
    expect(
      validateTableColumnOp(part, {
        op: 'deleteTableColumn',
        tableId: table.id,
        gridColumnId: cell.id,
      })
    ).toBe('unknown-grid-column');
  });

  test('refuses merged tables and irregular rows', () => {
    const merged = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>` +
        `<w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p/></w:tc></w:tr></w:tbl>`
    );
    const tableM = firstTable(merged);
    const [colM] = gridColIds(merged, tableM.id);
    expect(
      validateTableColumnOp(merged, {
        op: 'deleteTableColumn',
        tableId: tableM.id,
        gridColumnId: colM!,
      })
    ).toBe('table-has-merge');

    const irregular = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>` +
        `${ROW(CELL('a1'))}${ROW(CELL('b1'), CELL('b2'))}</w:tbl>`
    );
    const tableI = firstTable(irregular);
    const [colI] = gridColIds(irregular, tableI.id);
    expect(
      validateTableColumnOp(irregular, {
        op: 'deleteTableColumn',
        tableId: tableI.id,
        gridColumnId: colI!,
      })
    ).toBe('tree-invariant');
  });

  test('delete save/reopen matches edited fingerprint and semantic digest', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2')), ROW(CELL('b1'), CELL('b2'))));
    const table = firstTable(part);
    const [, col2] = gridColIds(part, table.id);

    const result = applyTreeOp(part, {
      op: 'deleteTableColumn',
      tableId: table.id,
      gridColumnId: col2!,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const serialized = serializeOoxmlPart(result.part);
    const reopened = readOoxmlPart(serialized, {
      name: part.name,
      contentType: part.contentType,
    });
    if (!reopened.ok) throw new Error(reopened.reason);

    expect(canonicalOoxmlFingerprint(reopened.part)).toBe(canonicalOoxmlFingerprint(result.part));
    expect(
      diffSemanticDigests(semanticDigest([result.part]), semanticDigest([reopened.part]))
    ).toEqual([]);
  });
});

describe('table column ops history', () => {
  test('omitted selectionAfter adopts op caret on change and undo/redo metadata', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2'))));
    const store = new TreeDocumentStore(part);
    const table = firstTable(store.part);
    const [, col2] = gridColIds(store.part, table.id);
    const beforeParagraph = collectByKind(part.root, 'paragraph')[0]!;

    const result = store.transact((tx) => {
      tx.selectionBefore({ paragraphId: beforeParagraph.id, start: 0, end: 0 });
      tx.apply({ op: 'insertTableColumn', tableId: table.id, gridColumnId: col2!, where: 'left' });
    });
    expect(result.ok).toBe(true);
    const inserted = collectByKind(store.part.root, 'paragraph')[1]!;
    expect(result.change?.caret).toEqual({
      paragraphId: inserted.id,
      start: 0,
      end: 0,
    });
    expect(store.selectionForUndo()?.paragraphId).toBe(beforeParagraph.id);

    store.undo();
    expect(store.part).toBe(part);
    expect(store.selectionForRedo()).toEqual({
      paragraphId: inserted.id,
      start: 0,
      end: 0,
    });

    store.redo();
    expect(store.selectionForUndo()?.paragraphId).toBe(beforeParagraph.id);
  });

  test('explicit selectionAfter(null) keeps null caret and history selection', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2'))));
    const store = new TreeDocumentStore(part);
    const table = firstTable(store.part);
    const [, col2] = gridColIds(store.part, table.id);

    const result = store.transact((tx) => {
      tx.apply({ op: 'insertTableColumn', tableId: table.id, gridColumnId: col2!, where: 'left' });
      tx.selectionAfter(null);
    });
    expect(result.ok).toBe(true);
    expect(result.change?.caret).toBeUndefined();

    store.undo();
    expect(store.selectionForRedo()).toBeNull();
  });

  test('explicit collapsed selectionAfter overrides op caret on change and redo', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2'))));
    const store = new TreeDocumentStore(part);
    const table = firstTable(store.part);
    const [, col2] = gridColIds(store.part, table.id);
    const overrideParagraph = collectByKind(part.root, 'paragraph')[1]!;

    const result = store.transact((tx) => {
      tx.apply({ op: 'insertTableColumn', tableId: table.id, gridColumnId: col2!, where: 'left' });
      tx.selectionAfter({ paragraphId: overrideParagraph.id, start: 2, end: 2 });
    });
    expect(result.ok).toBe(true);
    expect(result.change?.caret).toEqual({
      paragraphId: overrideParagraph.id,
      start: 2,
      end: 2,
    });

    store.undo();
    expect(store.selectionForRedo()).toEqual({
      paragraphId: overrideParagraph.id,
      start: 2,
      end: 2,
    });
  });

  test('explicit non-collapsed selectionAfter is stored in history but omitted from change caret', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2'))));
    const store = new TreeDocumentStore(part);
    const table = firstTable(store.part);
    const [, col2] = gridColIds(store.part, table.id);
    const ranged = collectByKind(part.root, 'paragraph')[0]!;
    const rangeMark = { paragraphId: ranged.id, start: 0, end: 2 };

    const result = store.transact((tx) => {
      tx.apply({ op: 'insertTableColumn', tableId: table.id, gridColumnId: col2!, where: 'left' });
      tx.selectionAfter(rangeMark);
    });
    expect(result.ok).toBe(true);
    expect(result.change?.caret).toBeUndefined();

    store.undo();
    expect(store.selectionForRedo()).toEqual(rangeMark);
  });

  test('delete column publishes caret and topology-enumerated deleted ids', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2'))));
    const store = new TreeDocumentStore(part);
    const table = firstTable(store.part);
    const [, col2] = gridColIds(store.part, table.id);
    const expected = expectedDeleteColumnEffects(part, table.id, 1);

    const result = store.transact((tx) => {
      tx.apply({ op: 'deleteTableColumn', tableId: table.id, gridColumnId: col2! });
    });
    expect(result.ok).toBe(true);
    expectSemanticEffects(
      {
        dirty: result.change?.dirty ?? [],
        created: result.change?.created ?? [],
        deleted: result.change?.deleted ?? [],
      },
      expected
    );
    expect(result.change?.caret?.paragraphId).toBe(
      firstParagraphInCell(
        store.part,
        rowCellIds(store.part, collectByKind(store.part.root, 'tableRow')[0]!.id)[0]!
      )?.id
    );

    store.undo();
    expect(store.part).toBe(part);
  });
});

describe('insertTableColumn grid attributes', () => {
  test('fresh gridCol carries only w:w and never w:type', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2'))));
    const table = firstTable(part);
    const [, col2] = gridColIds(part, table.id);

    const result = applyTreeOp(part, {
      op: 'insertTableColumn',
      tableId: table.id,
      gridColumnId: col2!,
      where: 'left',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const insertedColId = result.effect.created.find((id) =>
      gridColIds(result.part, table.id).includes(id)
    )!;
    const attrs = gridColAttributes(result.part, insertedColId);
    expect(attrs).toEqual([{ localName: 'w', value: '3600' }]);
  });

  test.each([
    ['dxa', '2400', 'dxa', '2400'],
    ['absent type', '1800', undefined, '1800'],
    ['pct', '2400', 'pct', undefined],
    ['auto', '2400', 'auto', undefined],
    ['malformed w', '2400', 'dxa', undefined],
  ] as const)('synthesizes grid widths from tcW (%s)', (_label, tcW, typeAttr, expectedWidth) => {
    const typeMarkup = typeAttr ? ` w:type="${typeAttr}"` : '';
    const wMarkup = _label === 'malformed w' ? '' : ` w:w="${tcW}"`;
    const part = load(
      `<w:tbl>${ROW(
        `<w:tc><w:tcPr><w:tcW${wMarkup}${typeMarkup}/></w:tcPr><w:p/></w:tc>`,
        `<w:tc><w:tcPr><w:tcW w:w="3600" w:type="dxa"/></w:tcPr><w:p/></w:tc>`
      )}</w:tbl>`
    );
    const table = firstTable(part);
    const referenceCell = collectByKind(part.root, 'tableCell')[1]!;
    const result = applyTreeOp(part, {
      op: 'insertTableColumn',
      tableId: table.id,
      referenceCellId: referenceCell.id,
      where: 'left',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const insertedColId = result.effect.created.find((id) =>
      collectByKind(result.part.root, 'generic').some(
        (n) => n.id === id && n.localName === 'gridCol'
      )
    )!;
    const attrs = gridColAttributes(result.part, insertedColId);
    if (expectedWidth === undefined) expect(attrs).toEqual([]);
    else expect(attrs).toEqual([{ localName: 'w', value: expectedWidth }]);
  });
});

describe('insertTableColumn namespace context', () => {
  test('applies in default-namespace tables with generated attribute binding', () => {
    const opened = readOoxmlPart(
      `<document xmlns="${W}"><body>` +
        `<tbl><tr>` +
        `<tc><tcPr><tcW w="2400" type="dxa"/></tcPr><p/></tc>` +
        `<tc><tcPr><tcW w="3600" type="dxa"/></tcPr><p/></tc>` +
        `</tr></tbl></body></document>`,
      {
        name: '/word/document.xml',
        contentType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
      }
    );
    if (!opened.ok) throw new Error(opened.reason);
    const part = opened.part;
    const table = firstTable(part);
    const referenceCell = collectByKind(part.root, 'tableCell')[1]!;

    const result = applyTreeOp(part, {
      op: 'insertTableColumn',
      tableId: table.id,
      referenceCellId: referenceCell.id,
      where: 'left',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const serialized = serializeOoxmlPart(result.part);
    const reopened = readOoxmlPart(serialized, {
      name: part.name,
      contentType: part.contentType,
    });
    if (!reopened.ok) throw new Error(reopened.reason);
    expect(canonicalOoxmlFingerprint(reopened.part)).toBe(canonicalOoxmlFingerprint(result.part));
    expect(
      diffSemanticDigests(semanticDigest([result.part]), semanticDigest([reopened.part]))
    ).toEqual([]);
  });
});

describe('insertTableColumn tblGrid extensions', () => {
  test('inserts left of target gridCol preserving foreign grid children', () => {
    const part = load(
      `<w:tbl xmlns:x="${FOREIGN}"><w:tblGrid><x:ext/><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>` +
        `${ROW(CELL('a1'), CELL('a2'))}</w:tbl>`
    );
    const table = firstTable(part);
    const grid = wmlChildNamed(table, 'tblGrid')!;
    const ext = grid.children.find((c) => c.localName === 'ext');
    const [, col2] = gridColIds(part, table.id);

    const result = applyTreeOp(part, {
      op: 'insertTableColumn',
      tableId: table.id,
      gridColumnId: col2!,
      where: 'left',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const editedGrid = wmlChildNamed(collectByKind(result.part.root, 'table')[0]!, 'tblGrid')!;
    expect(editedGrid.children[0]).toBe(ext);
    expect(editedGrid.children[1]!.localName).toBe('gridCol');
    expect(editedGrid.children[2]!.localName).toBe('gridCol');
    expect(editedGrid.children[2]!.id).not.toBe(col2);
    expect(editedGrid.children[3]!.id).toBe(col2);
  });
});

describe('insertTableColumn resource limits', () => {
  test('refuses when addressed column skeleton exceeds traversal budget', () => {
    const richTcPr =
      `<w:tcPr>` +
      `<w:tcW w:w="2400" w:type="dxa"/>` +
      `<w:shd w:val="clear" w:fill="FF0000" w:color="auto"/>` +
      `<w:tcBorders><w:top w:val="single" w:sz="4" w:color="auto"/></w:tcBorders>` +
      `</w:tcPr>`;
    const part = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>` +
        `<w:tr><w:tc><w:p/></w:tc><w:tc>${richTcPr}<w:p/></w:tc></w:tr></w:tbl>`
    );
    const table = firstTable(part);
    const [, col2] = gridColIds(part, table.id);
    expect(
      validateTableColumnOp(
        part,
        { op: 'insertTableColumn', tableId: table.id, gridColumnId: col2!, where: 'left' },
        { maxRows: 10_000, maxColumns: 1024, maxTraversalNodes: 8 }
      )
    ).toBe('resource-limit');
  });
});

describe('insertTableColumn exact effects', () => {
  test('existing-grid insert matches topology-enumerated target-local sets', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2'))));
    const table = firstTable(part);
    const [, col2] = gridColIds(part, table.id);

    const result = applyTreeOp(part, {
      op: 'insertTableColumn',
      tableId: table.id,
      gridColumnId: col2!,
      where: 'left',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expectSemanticEffects(result.effect, expectedInsertColumnEffects(part, result.part, table.id));
    expect(result.effect.dirty).not.toContain(part.root.id);
  });

  test('synthesized-grid insert matches topology-enumerated tblGrid and gridCol sets', () => {
    const part = load(`<w:tbl>${ROW(CELL('a1'), CELL('a2'))}</w:tbl>`);
    const table = firstTable(part);
    const referenceCell = collectByKind(part.root, 'tableCell')[1]!;

    const result = applyTreeOp(part, {
      op: 'insertTableColumn',
      tableId: table.id,
      referenceCellId: referenceCell.id,
      where: 'left',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const expected = expectedInsertColumnEffects(part, result.part, table.id);
    expectSemanticEffects(result.effect, expected);
    const editedTable = tableById(result.part, table.id);
    const newGrid = wmlChildNamed(editedTable, 'tblGrid')!;
    expect(expected.created).toContain(newGrid.id);
    for (const id of gridColIds(result.part, table.id)) expect(expected.created).toContain(id);
  });

  test('nested insert exact effects exclude all outer structural ids', () => {
    const part = load(NESTED_TABLE());
    const tables = collectByKind(part.root, 'table');
    const outer = tables[0]!;
    const inner = tables[1]!;
    const outerStructuralIds = outerTableSiblingStructuralIds(part, outer);
    const outerRow = directRowsOfTable(outer)[0]!;
    outerStructuralIds.add(outer.id);
    outerStructuralIds.add(outerRow.id);
    const [, innerCol2] = gridColIds(part, inner.id);

    const result = applyTreeOp(part, {
      op: 'insertTableColumn',
      tableId: inner.id,
      gridColumnId: innerCol2!,
      where: 'left',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expectSemanticEffects(result.effect, expectedInsertColumnEffects(part, result.part, inner.id));
    for (const id of [...result.effect.created, ...result.effect.deleted, ...result.effect.dirty]) {
      expect(outerStructuralIds.has(id)).toBe(false);
    }
  });
});

describe('deleteTableColumn exact effects', () => {
  test('deletion matches topology-enumerated target-local sets', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2'))));
    const table = firstTable(part);
    const [, col2] = gridColIds(part, table.id);

    const result = applyTreeOp(part, {
      op: 'deleteTableColumn',
      tableId: table.id,
      gridColumnId: col2!,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expectSemanticEffects(result.effect, expectedDeleteColumnEffects(part, table.id, 1));
    expect(result.effect.dirty).not.toContain(part.root.id);
  });

  test('nested deletion exact effects exclude all outer structural ids', () => {
    const part = load(NESTED_TABLE());
    const tables = collectByKind(part.root, 'table');
    const outer = tables[0]!;
    const inner = tables[1]!;
    const outerStructuralIds = outerTableSiblingStructuralIds(part, outer);
    const outerRow = directRowsOfTable(outer)[0]!;
    outerStructuralIds.add(outer.id);
    outerStructuralIds.add(outerRow.id);
    const [, innerCol2] = gridColIds(part, inner.id);

    const result = applyTreeOp(part, {
      op: 'deleteTableColumn',
      tableId: inner.id,
      gridColumnId: innerCol2!,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expectSemanticEffects(result.effect, expectedDeleteColumnEffects(part, inner.id, 1));
    for (const id of [...result.effect.created, ...result.effect.deleted, ...result.effect.dirty]) {
      expect(outerStructuralIds.has(id)).toBe(false);
    }
  });
});

describe('insertTableColumn runtime shape', () => {
  test('rejects malformed where and ambiguous targets through validateTreeOp', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2'))));
    const table = firstTable(part);
    const [, col2] = gridColIds(part, table.id);
    const cell = collectByKind(part.root, 'tableCell')[0]!;

    expect(
      validateTreeOp(part, {
        op: 'insertTableColumn',
        tableId: table.id,
        gridColumnId: col2!,
        where: 'middle' as 'left',
      })
    ).toBe('invalidArgs');

    expect(
      validateTreeOp(part, {
        op: 'insertTableColumn',
        tableId: table.id,
        gridColumnId: col2!,
        referenceCellId: cell.id,
        where: 'left',
      } as never)
    ).toBe('invalidArgs');
  });

  test.each([
    ['empty gridColumnId', { gridColumnId: '', where: 'left' as const }],
    ['null gridColumnId', { gridColumnId: null, where: 'left' as const }],
    ['undefined gridColumnId', { gridColumnId: undefined, where: 'left' as const }],
    ['numeric gridColumnId', { gridColumnId: 1, where: 'left' as const }],
    ['empty referenceCellId', { referenceCellId: '', where: 'left' as const }],
    ['null referenceCellId', { referenceCellId: null, where: 'left' as const }],
    ['neither target', { where: 'left' as const }],
  ] as const)('rejects insert runtime shape (%s) through store transact', (_label, fields) => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2'))));
    const store = new TreeDocumentStore(part);
    const table = firstTable(part);
    const base = {
      op: 'insertTableColumn' as const,
      tableId: table.id,
      ...fields,
    };

    const result = store.transact((tx) => {
      tx.apply(base as never);
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalidArgs');
  });

  test('rejects empty tableId through store transact', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2'))));
    const store = new TreeDocumentStore(part);
    const table = firstTable(part);
    const [, col2] = gridColIds(part, table.id);

    const result = store.transact((tx) => {
      tx.apply({
        op: 'insertTableColumn',
        tableId: '',
        gridColumnId: col2!,
        where: 'left',
      });
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalidArgs');
  });

  test('rejects valid target with own malformed extra target through store transact', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2'))));
    const store = new TreeDocumentStore(part);
    const table = firstTable(part);
    const [, col2] = gridColIds(part, table.id);

    const result = store.transact((tx) => {
      tx.apply({
        op: 'insertTableColumn',
        tableId: table.id,
        gridColumnId: col2!,
        referenceCellId: null,
        where: 'left',
      } as never);
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalidArgs');
  });

  test('rejects inherited gridColumnId through validateTreeOp', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2'))));
    const table = firstTable(part);
    const [, col2] = gridColIds(part, table.id);
    const op = Object.assign(Object.create({ gridColumnId: col2, referenceCellId: 'inherited' }), {
      op: 'insertTableColumn',
      tableId: table.id,
      where: 'left',
    });

    expect(validateTreeOp(part, op as never)).toBe('invalidArgs');
  });

  test('rejects inherited tableId through store transact', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2'))));
    const store = new TreeDocumentStore(part);
    const table = firstTable(part);
    const [, col2] = gridColIds(part, table.id);
    const op = Object.assign(Object.create({ tableId: table.id }), {
      op: 'insertTableColumn',
      gridColumnId: col2!,
      where: 'left',
    });

    const result = store.transact((tx) => {
      tx.apply(op as never);
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalidArgs');
  });

  test('rejects inherited where through validateTreeOp', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2'))));
    const table = firstTable(part);
    const [, col2] = gridColIds(part, table.id);
    const op = Object.assign(Object.create({ where: 'left' }), {
      op: 'insertTableColumn',
      tableId: table.id,
      gridColumnId: col2!,
    });

    expect(validateTreeOp(part, op as never)).toBe('invalidArgs');
  });

  test.each([
    ['empty gridColumnId', ''],
    ['null gridColumnId', null],
    ['undefined gridColumnId', undefined],
    ['numeric gridColumnId', 1],
  ] as const)(
    'rejects delete runtime shape (%s) through store transact',
    (_label, gridColumnId) => {
      const part = load(TABLE(ROW(CELL('a1'), CELL('a2'))));
      const store = new TreeDocumentStore(part);
      const table = firstTable(part);

      const result = store.transact((tx) => {
        tx.apply({
          op: 'deleteTableColumn',
          tableId: table.id,
          gridColumnId,
        } as never);
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('invalidArgs');
    }
  );
});

describe('insertTableColumn paraId', () => {
  test('mints valid unique paraIds that survive save/reopen', () => {
    const opened = readOoxmlPart(
      `<w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>${TABLE(ROW(CELL('a1'), CELL('a2')))}</w:body></w:document>`,
      {
        name: '/word/document.xml',
        contentType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
      }
    );
    if (!opened.ok) throw new Error(opened.reason);
    const part = opened.part;
    const table = firstTable(part);
    const [, col2] = gridColIds(part, table.id);
    const beforeParaIds = new Set(collectParagraphParaIds(part));

    const result = applyTreeOp(part, {
      op: 'insertTableColumn',
      tableId: table.id,
      gridColumnId: col2!,
      where: 'left',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const minted = collectParagraphParaIds(result.part).filter((id) => !beforeParaIds.has(id));
    expect(minted).toHaveLength(1);
    expect(isValidParaId(minted[0]!)).toBe(true);

    const serialized = serializeOoxmlPart(result.part);
    const reopened = readOoxmlPart(serialized, {
      name: part.name,
      contentType: part.contentType,
    });
    if (!reopened.ok) throw new Error(reopened.reason);
    expect(collectParagraphParaIds(reopened.part)).toContain(minted[0]!);
    expect(canonicalOoxmlFingerprint(reopened.part)).toBe(canonicalOoxmlFingerprint(result.part));
    expect(
      diffSemanticDigests(semanticDigest([result.part]), semanticDigest([reopened.part]))
    ).toEqual([]);
  });

  test('two actors inserting a column at one place mint different paraIds', () => {
    // The seed comes from the table's structure, so two collaborators inserting the same
    // column from the same snapshot minted one paraId for two paragraphs, and a caret
    // published against it showed on the wrong one.
    const opened = readOoxmlPart(
      `<w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>${TABLE(ROW(CELL('a1'), CELL('a2')))}</w:body></w:document>`,
      {
        name: '/word/document.xml',
        contentType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
      }
    );
    if (!opened.ok) throw new Error(opened.reason);
    const part = opened.part;
    const table = firstTable(part);
    const [col1] = gridColIds(part, table.id);
    const before = new Set(collectParagraphParaIds(part));
    const mintedBy = (actor: string): string[] =>
      runWithTransactionActor(actor, () => {
        const result = applyTreeOp(part, {
          op: 'insertTableColumn',
          tableId: table.id,
          gridColumnId: col1!,
          where: 'right',
        });
        if (!result.ok) throw new Error(result.reason);
        return collectParagraphParaIds(result.part).filter((id) => !before.has(id));
      });
    const alice = mintedBy('alice');
    expect(alice).toHaveLength(1);
    expect(mintedBy('bob')).not.toContain(alice[0]!);
    expect(mintedBy('alice')).toEqual(alice);
  });
});
