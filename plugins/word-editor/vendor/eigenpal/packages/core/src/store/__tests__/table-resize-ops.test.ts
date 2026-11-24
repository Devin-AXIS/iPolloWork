// Column resize through TreeDocumentStore (table-editing task 5).

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
import { diffSemanticDigests, semanticDigest } from '../package/ooxml-digest.ts';
import { readTableStructure } from '../../layout/semantic-table.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../../layout/semantic-layout.ts';
import { applyTreeOp, validateTreeOp } from '../store/tree-ops.ts';
import { validateTableResizeOp } from '../store/tree-op-tables.ts';
import { wmlChildNamed } from '../store/tree-op-table-shared.ts';
import { wmlFreshNamespaceContextAt } from '../package/wml-namespace.ts';
import {
  MAX_TABLE_COLUMN_WIDTH_TWIPS,
  MAX_TABLE_WIDTH_TWIPS,
  MIN_TABLE_COLUMN_WIDTH_TWIPS,
} from '../store/table-constraints.ts';
import { TreeDocumentStore, type TreeModelChange } from '../store/tree-store.ts';

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

function gridColWidth(part: OoxmlPart, gridColId: string): string | undefined {
  const col = collectByKind(part.root, 'generic').find(
    (n) => n.id === gridColId && n.localName === 'gridCol'
  );
  if (!col) return undefined;
  return col.attributes.find((a) => a.localName === 'w')?.value;
}

function cellTcWidth(part: OoxmlPart, cellId: string): string | undefined {
  const cell = collectByKind(part.root, 'tableCell').find((c) => c.id === cellId);
  if (!cell) return undefined;
  const tcPr = wmlChildNamed(cell, 'tcPr');
  const tcW = tcPr && wmlChildNamed(tcPr, 'tcW');
  if (!tcW) return undefined;
  return tcW.attributes.find((a) => a.localName === 'w')?.value;
}

function tblLayoutType(part: OoxmlPart, tableId: string): string | undefined {
  const table = collectByKind(part.root, 'table').find((t) => t.id === tableId);
  if (!table) return undefined;
  const tblPr = wmlChildNamed(table, 'tblPr');
  const layout = tblPr && wmlChildNamed(tblPr, 'tblLayout');
  return layout?.attributes.find((a) => a.localName === 'type')?.value;
}

function tblWidth(part: OoxmlPart, tableId: string): string | undefined {
  const table = collectByKind(part.root, 'table').find((t) => t.id === tableId);
  if (!table) return undefined;
  const tblPr = wmlChildNamed(table, 'tblPr');
  const tblW = tblPr && wmlChildNamed(tblPr, 'tblW');
  return tblW?.attributes.find((a) => a.localName === 'w')?.value;
}

function rowCellIds(part: OoxmlPart, rowId: string): string[] {
  const row = collectByKind(part.root, 'tableRow').find((r) => r.id === rowId);
  if (!row) throw new Error('row missing');
  return row.children.filter((c) => c.kind === 'tableCell').map((c) => c.id);
}

function tableById(part: OoxmlPart, tableId: string): OoxmlElement {
  const table = collectByKind(part.root, 'table').find((t) => t.id === tableId);
  if (!table) throw new Error(`table missing: ${tableId}`);
  return table;
}

function directRowsOfTable(table: OoxmlElement): OoxmlElement[] {
  return table.children.filter((c) => c.kind === 'tableRow') as OoxmlElement[];
}

function foreignChildNamed(
  container: OoxmlElement,
  namespaceUri: string,
  localName: string
): OoxmlElement | undefined {
  for (const child of container.children) {
    if (child.kind === 'textValue') continue;
    if (child.namespaceUri === namespaceUri && child.localName === localName) return child;
  }
  return undefined;
}

function sortedIds(ids: readonly string[]): string[] {
  return [...ids].sort();
}

function assertEditedReopens(part: OoxmlPart, name: string, contentType: string): void {
  const serialized = serializeOoxmlPart(part);
  const reopened = readOoxmlPart(serialized, { name, contentType });
  if (!reopened.ok) throw new Error(reopened.reason);
  expect(canonicalOoxmlFingerprint(reopened.part)).toBe(canonicalOoxmlFingerprint(part));
  expect(diffSemanticDigests(semanticDigest([part]), semanticDigest([reopened.part]))).toEqual([]);
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
  expect(sortedIds(effect.dirty)).toEqual(sortedIds(expected.dirty));
  expect(sortedIds(effect.created)).toEqual(sortedIds(expected.created));
  expect(sortedIds(effect.deleted)).toEqual(sortedIds(expected.deleted));
}

/** Expected target-local resize effects enumerated from fixture topology only. */
function expectedResizeEffects(
  part: OoxmlPart,
  tableId: string
): {
  readonly dirty: readonly string[];
  readonly created: readonly string[];
  readonly deleted: readonly string[];
} {
  const table = tableById(part, tableId);
  const grid = wmlChildNamed(table, 'tblGrid');
  if (!grid) throw new Error('grid missing');
  return {
    dirty: sortedIds([tableId, grid.id, ...directRowsOfTable(table).map((row) => row.id)]),
    created: [],
    deleted: [],
  };
}

const QUALIFIED_GRID_COL = (width: string): string => `<gridCol xmlns:wx="${W}" wx:w="${width}"/>`;

const DEFAULT_NS_TABLE_OPEN = `<document xmlns="${W}"><body><tbl><tblGrid>`;
const DEFAULT_NS_TABLE_CLOSE = `</tblGrid>`;

const TABLE3 = (...rows: string[]): string =>
  `<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2500"/><w:gridCol w:w="1500"/></w:tblGrid>${rows.join('')}</w:tbl>`;

const CELL = (text: string, width = '2400'): string =>
  `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>` +
  `<w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;

const ROW = (...cells: string[]): string => `<w:tr>${cells.join('')}</w:tr>`;

const TABLE = (...rows: string[]): string =>
  `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>${rows.join('')}</w:tbl>`;

describe('setTableColumnWidths', () => {
  test('patches adjacent grid columns and matching tcW while preserving pair total', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2')), ROW(CELL('b1'), CELL('b2'))));
    const table = firstTable(part);
    const [col1, col2] = gridColIds(part, table.id);
    const rows = collectByKind(part.root, 'tableRow');

    const result = applyTreeOp(part, {
      op: 'setTableColumnWidths',
      tableId: table.id,
      leftGridColumnId: col1!,
      rightGridColumnId: col2!,
      leftWidthTwips: 3000,
      rightWidthTwips: 3000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(gridColWidth(result.part, col1!)).toBe('3000');
    expect(gridColWidth(result.part, col2!)).toBe('3000');
    expect(tblLayoutType(result.part, table.id)).toBe('fixed');
    for (const row of rows) {
      const [leftCell, rightCell] = rowCellIds(result.part, row.id);
      expect(cellTcWidth(result.part, leftCell!)).toBe('3000');
      expect(cellTcWidth(result.part, rightCell!)).toBe('3000');
    }
    expect(result.effect.impact).toBe('flow-structural');
    expect(result.effect.created).toEqual([]);
    expect(result.effect.deleted).toEqual([]);
  });

  test('refuses when pair total would change', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2'))));
    const table = firstTable(part);
    const [col1, col2] = gridColIds(part, table.id);

    expect(
      validateTreeOp(part, {
        op: 'setTableColumnWidths',
        tableId: table.id,
        leftGridColumnId: col1!,
        rightGridColumnId: col2!,
        leftWidthTwips: 3000,
        rightWidthTwips: 3100,
      })
    ).toBe('invalidArgs');
  });

  test('refuses widths below minimum or above column maximum', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2'))));
    const table = firstTable(part);
    const [col1, col2] = gridColIds(part, table.id);

    expect(
      validateTreeOp(part, {
        op: 'setTableColumnWidths',
        tableId: table.id,
        leftGridColumnId: col1!,
        rightGridColumnId: col2!,
        leftWidthTwips: MIN_TABLE_COLUMN_WIDTH_TWIPS - 1,
        rightWidthTwips: 6000 - (MIN_TABLE_COLUMN_WIDTH_TWIPS - 1),
      })
    ).toBe('invalidArgs');

    expect(
      validateTreeOp(part, {
        op: 'setTableColumnWidths',
        tableId: table.id,
        leftGridColumnId: col1!,
        rightGridColumnId: col2!,
        leftWidthTwips: MAX_TABLE_COLUMN_WIDTH_TWIPS,
        rightWidthTwips: 6000 - MAX_TABLE_COLUMN_WIDTH_TWIPS,
      })
    ).toBe('invalidArgs');
  });

  test('refuses non-adjacent grid column ids', () => {
    const part = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>` +
        `${ROW(CELL('a1'), CELL('a2'), CELL('a3'))}</w:tbl>`
    );
    const table = firstTable(part);
    const [col1, , col3] = gridColIds(part, table.id);

    expect(
      validateTreeOp(part, {
        op: 'setTableColumnWidths',
        tableId: table.id,
        leftGridColumnId: col1!,
        rightGridColumnId: col3!,
        leftWidthTwips: 2500,
        rightWidthTwips: 1500,
      })
    ).toBe('invalidArgs');
  });

  test('refuses unknown and stale grid column ids', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2'))));
    const table = firstTable(part);
    const [col1, col2] = gridColIds(part, table.id);

    expect(
      validateTreeOp(part, {
        op: 'setTableColumnWidths',
        tableId: table.id,
        leftGridColumnId: 'missing',
        rightGridColumnId: col2!,
        leftWidthTwips: 3000,
        rightWidthTwips: 3000,
      })
    ).toBe('unknown-grid-column');

    const deleted = applyTreeOp(part, {
      op: 'deleteTableColumn',
      tableId: table.id,
      gridColumnId: col2!,
    });
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;

    expect(
      validateTreeOp(deleted.part, {
        op: 'setTableColumnWidths',
        tableId: table.id,
        leftGridColumnId: col1!,
        rightGridColumnId: col2!,
        leftWidthTwips: 3000,
        rightWidthTwips: 3000,
      })
    ).toBe('unknown-grid-column');
  });

  test.each([
    ['gridSpan', '<w:gridSpan w:val="2"/>'],
    ['hMerge', '<w:hMerge w:val="restart"/>'],
    ['vMerge', '<w:vMerge w:val="restart"/>'],
  ] as const)('answers merged tables by their grid (%s)', (_label, mergeMarkup) => {
    const part = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>` +
        `<w:tr><w:tc><w:tcPr>${mergeMarkup}</w:tcPr><w:p/></w:tc><w:tc><w:p/></w:tc></w:tr></w:tbl>`
    );
    const table = firstTable(part);
    const [col1, col2] = gridColIds(part, table.id);
    expect(
      validateTableResizeOp(part, {
        op: 'setTableColumnWidths',
        tableId: table.id,
        leftGridColumnId: col1!,
        rightGridColumnId: col2!,
        leftWidthTwips: 3000,
        rightWidthTwips: 3000,
      })
    ).toBe(
      _label === 'gridSpan' ? 'tree-invariant' : _label === 'hMerge' ? 'table-has-merge' : null
    );
  });

  test('resizes a grid beneath a spanning header and preserves its merged width', () => {
    const part = load(
      '<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>' +
        '<w:tr><w:tc><w:p/></w:tc><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p/></w:tc></w:tr>' +
        '<w:tr><w:tc><w:p/></w:tc><w:tc><w:p/></w:tc><w:tc><w:p/></w:tc></w:tr></w:tbl>'
    );
    const table = firstTable(part);
    const columns = gridColIds(part, table.id);
    const cells = collectByKind(part.root, 'tableCell');
    const resize = applyTreeOp(part, {
      op: 'setTableColumnWidths',
      tableId: table.id,
      leftGridColumnId: columns[0]!,
      rightGridColumnId: columns[1]!,
      leftWidthTwips: 2400,
      rightWidthTwips: 1600,
    });
    expect(resize.ok).toBe(true);
    if (!resize.ok) return;
    expect(cellTcWidth(resize.part, cells[0]!.id)).toBe('2400');
    expect(cellTcWidth(resize.part, cells[1]!.id)).toBe('3600');
    expect(cellTcWidth(resize.part, cells[3]!.id)).toBe('1600');
    const edge = applyTreeOp(resize.part, {
      op: 'setTableRightEdgeWidth',
      tableId: table.id,
      gridColumnId: columns[2]!,
      columnWidthTwips: 2500,
      tableWidthTwips: 6500,
    });
    expect(edge.ok).toBe(true);
    if (!edge.ok) return;
    expect(cellTcWidth(edge.part, cells[1]!.id)).toBe('4100');
    expect(cellTcWidth(edge.part, cells[4]!.id)).toBe('2500');
    const reopened = readOoxmlPart(serializeOoxmlPart(edge.part), {
      name: part.name,
      contentType: part.contentType,
    });
    expect(reopened.ok).toBe(true);
    if (reopened.ok)
      expect(canonicalOoxmlFingerprint(reopened.part)).toBe(canonicalOoxmlFingerprint(edge.part));
  });

  test('refuses missing grid and irregular alignment', () => {
    const noGrid = load(`<w:tbl>${ROW(CELL('a1'), CELL('a2'))}</w:tbl>`);
    const tableNoGrid = firstTable(noGrid);
    const [col1, col2] = gridColIds(noGrid, tableNoGrid.id);
    expect(
      validateTreeOp(noGrid, {
        op: 'setTableColumnWidths',
        tableId: tableNoGrid.id,
        leftGridColumnId: col1 ?? 'x',
        rightGridColumnId: col2 ?? 'y',
        leftWidthTwips: 3000,
        rightWidthTwips: 3000,
      })
    ).toBe('unknown-grid-column');

    const irregular = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>` +
        `${ROW(CELL('a1'))}${ROW(CELL('b1'), CELL('b2'))}</w:tbl>`
    );
    const tableI = firstTable(irregular);
    const [c1, c2] = gridColIds(irregular, tableI.id);
    expect(
      validateTreeOp(irregular, {
        op: 'setTableColumnWidths',
        tableId: tableI.id,
        leftGridColumnId: c1!,
        rightGridColumnId: c2!,
        leftWidthTwips: 3000,
        rightWidthTwips: 3000,
      })
    ).toBe('tree-invariant');
  });

  test('refuses unreadable grid column widths', () => {
    const part = load(
      `<w:tbl><w:tblGrid><w:gridCol/><w:gridCol w:w="3600"/></w:tblGrid>${ROW(CELL('a1'), CELL('a2'))}</w:tbl>`
    );
    const table = firstTable(part);
    const [col1, col2] = gridColIds(part, table.id);
    expect(
      validateTreeOp(part, {
        op: 'setTableColumnWidths',
        tableId: table.id,
        leftGridColumnId: col1!,
        rightGridColumnId: col2!,
        leftWidthTwips: 3000,
        rightWidthTwips: 3000,
      })
    ).toBe('tree-invariant');
  });

  test('refuses unchanged internal divider pair without mutation', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2'))));
    const table = firstTable(part);
    const [col1, col2] = gridColIds(part, table.id);
    const store = new TreeDocumentStore(part);
    const partBefore = store.part;
    const changes: TreeModelChange[] = [];
    const unsubscribe = store.subscribe((change) => changes.push(change));

    const result = store.transact((tx) => {
      tx.apply({
        op: 'setTableColumnWidths',
        tableId: table.id,
        leftGridColumnId: col1!,
        rightGridColumnId: col2!,
        leftWidthTwips: 2400,
        rightWidthTwips: 3600,
      });
    });
    unsubscribe();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalidArgs');
    expect(changes).toHaveLength(0);
    expect(store.part).toBe(partBefore);
    expect(
      validateTreeOp(part, {
        op: 'setTableColumnWidths',
        tableId: table.id,
        leftGridColumnId: col1!,
        rightGridColumnId: col2!,
        leftWidthTwips: 2400,
        rightWidthTwips: 3600,
      })
    ).toBe('invalidArgs');
  });
});

describe('setTableRightEdgeWidth', () => {
  test('requires last grid column and updates tblW total with fixed layout', () => {
    const part = load(
      `<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/></w:tblPr>` +
        `<w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>` +
        `${ROW(CELL('a1'), CELL('a2'))}</w:tbl>`
    );
    const table = firstTable(part);
    const [, col2] = gridColIds(part, table.id);
    const rows = collectByKind(part.root, 'tableRow');

    const result = applyTreeOp(part, {
      op: 'setTableRightEdgeWidth',
      tableId: table.id,
      gridColumnId: col2!,
      columnWidthTwips: 4200,
      tableWidthTwips: 6600,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(gridColWidth(result.part, col2!)).toBe('4200');
    expect(tblWidth(result.part, table.id)).toBe('6600');
    expect(tblLayoutType(result.part, table.id)).toBe('fixed');
    for (const row of rows) {
      const cells = rowCellIds(result.part, row.id);
      expect(cellTcWidth(result.part, cells[1]!)).toBe('4200');
      expect(cellTcWidth(result.part, cells[0]!)).toBe('2400');
    }
  });

  test('refuses when grid column is not last', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2'))));
    const table = firstTable(part);
    const [col1] = gridColIds(part, table.id);
    expect(
      validateTreeOp(part, {
        op: 'setTableRightEdgeWidth',
        tableId: table.id,
        gridColumnId: col1!,
        columnWidthTwips: 3000,
        tableWidthTwips: 6600,
      })
    ).toBe('invalidArgs');
  });

  test('refuses table width above maximum and inconsistent totals', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2'))));
    const table = firstTable(part);
    const [, col2] = gridColIds(part, table.id);

    expect(
      validateTreeOp(part, {
        op: 'setTableRightEdgeWidth',
        tableId: table.id,
        gridColumnId: col2!,
        columnWidthTwips: 3000,
        tableWidthTwips: MAX_TABLE_WIDTH_TWIPS + 1,
      })
    ).toBe('invalidArgs');

    expect(
      validateTreeOp(part, {
        op: 'setTableRightEdgeWidth',
        tableId: table.id,
        gridColumnId: col2!,
        columnWidthTwips: 4200,
        tableWidthTwips: 6500,
      })
    ).toBe('invalidArgs');
  });

  test('refuses unchanged outer-right proposal without mutation', () => {
    const part = load(
      `<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/></w:tblPr>` +
        `<w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>` +
        `${ROW(CELL('a1'), CELL('a2'))}</w:tbl>`
    );
    const table = firstTable(part);
    const [, col2] = gridColIds(part, table.id);
    const store = new TreeDocumentStore(part);
    const partBefore = store.part;
    const changes: TreeModelChange[] = [];
    const unsubscribe = store.subscribe((change) => changes.push(change));

    const result = store.transact((tx) => {
      tx.apply({
        op: 'setTableRightEdgeWidth',
        tableId: table.id,
        gridColumnId: col2!,
        columnWidthTwips: 3600,
        tableWidthTwips: 6000,
      });
    });
    unsubscribe();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalidArgs');
    expect(changes).toHaveLength(0);
    expect(store.part).toBe(partBefore);
    expect(
      validateTreeOp(part, {
        op: 'setTableRightEdgeWidth',
        tableId: table.id,
        gridColumnId: col2!,
        columnWidthTwips: 3600,
        tableWidthTwips: 6000,
      })
    ).toBe('invalidArgs');
  });
});

describe('table resize lossless and history', () => {
  test('preserves foreign nodes and unrelated third column by identity', () => {
    const cell3 =
      `<w:tc><w:tcPr><w:tcW w:w="1500" w:type="dxa"/><w:shd w:val="clear" w:fill="FF0000" w:color="auto"/></w:tcPr>` +
      `<w:p><w:r><w:t>c3</w:t></w:r></w:p></w:tc>`;
    const part = load(
      `<w:tbl xmlns:x="${FOREIGN}"><w:tblPr><x:ext/></w:tblPr>` +
        `<w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2500"/><w:gridCol w:w="1500"/></w:tblGrid>` +
        `${ROW(CELL('a1', '2000'), CELL('a2', '2500'), cell3)}</w:tbl>`
    );
    const table = firstTable(part);
    const [col1, col2, col3] = gridColIds(part, table.id);
    const row = directRowsOfTable(table)[0]!;
    const cellsBefore = rowCellIds(part, row.id);
    const thirdCellBefore = collectByKind(part.root, 'tableCell').find(
      (c) => c.id === cellsBefore[2]!
    )!;
    const thirdTcPrBefore = wmlChildNamed(thirdCellBefore, 'tcPr')!;
    const shdBefore = wmlChildNamed(thirdTcPrBefore, 'shd')!;
    const extBefore = foreignChildNamed(wmlChildNamed(table, 'tblPr')!, FOREIGN, 'ext');
    expect(extBefore).toBeDefined();

    const result = applyTreeOp(part, {
      op: 'setTableColumnWidths',
      tableId: table.id,
      leftGridColumnId: col1!,
      rightGridColumnId: col2!,
      leftWidthTwips: 2200,
      rightWidthTwips: 2300,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const edited = tableById(result.part, table.id);
    const extAfter = foreignChildNamed(wmlChildNamed(edited, 'tblPr')!, FOREIGN, 'ext');
    expect(extAfter).toBe(extBefore);
    expect(gridColIds(result.part, table.id)[2]).toBe(col3);
    expect(gridColWidth(result.part, col3!)).toBe('1500');

    const thirdCellAfter = collectByKind(result.part.root, 'tableCell').find(
      (c) => c.id === cellsBefore[2]!
    )!;
    expect(thirdCellAfter).toBe(thirdCellBefore);
    expect(wmlChildNamed(thirdCellAfter, 'tcPr')).toBe(thirdTcPrBefore);
    expect(wmlChildNamed(wmlChildNamed(thirdCellAfter, 'tcPr')!, 'shd')).toBe(shdBefore);
    expect(cellTcWidth(result.part, cellsBefore[2]!)).toBe('1500');

    expectSemanticEffects(result.effect, expectedResizeEffects(part, table.id));
  });

  test('nested resize isolates outer structural ids', () => {
    const part = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="4800"/><w:gridCol w:w="2400"/></w:tblGrid>` +
        `<w:tr><w:tc><w:tbl><w:tblGrid><w:gridCol w:w="1200"/><w:gridCol w:w="1200"/></w:tblGrid>` +
        `${ROW(CELL('n1'), CELL('n2'))}</w:tbl></w:tc>${CELL('outer')}</w:tr></w:tbl>`
    );
    const tables = collectByKind(part.root, 'table');
    const outer = tables[0]!;
    const inner = tables[1]!;
    const [, innerCol2] = gridColIds(part, inner.id);
    const outerBefore = gridColWidth(part, gridColIds(part, outer.id)[0]!);

    const result = applyTreeOp(part, {
      op: 'setTableColumnWidths',
      tableId: inner.id,
      leftGridColumnId: gridColIds(part, inner.id)[0]!,
      rightGridColumnId: innerCol2!,
      leftWidthTwips: 900,
      rightWidthTwips: 1500,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(gridColWidth(result.part, gridColIds(result.part, outer.id)[0]!)).toBe(outerBefore);
    for (const id of [...result.effect.dirty, ...result.effect.created, ...result.effect.deleted]) {
      expect(id).not.toBe(outer.id);
    }
  });

  test('one undo step restores divider resize', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2'))));
    const store = new TreeDocumentStore(part);
    const partBefore = store.part;
    const table = firstTable(part);
    const [col1, col2] = gridColIds(part, table.id);
    const changes: TreeModelChange[] = [];
    const unsubscribe = store.subscribe((change) => changes.push(change));

    const result = store.transact((tx) => {
      tx.apply({
        op: 'setTableColumnWidths',
        tableId: table.id,
        leftGridColumnId: col1!,
        rightGridColumnId: col2!,
        leftWidthTwips: 3000,
        rightWidthTwips: 3000,
      });
    });
    unsubscribe();

    expect(result.ok).toBe(true);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.impact).toBe('flow-structural');
    store.undo();
    expect(store.part).toBe(partBefore);
  });

  test('save/reopen passes D9 oracles after resize', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2'))));
    const table = firstTable(part);
    const [col1, col2] = gridColIds(part, table.id);

    const result = applyTreeOp(part, {
      op: 'setTableColumnWidths',
      tableId: table.id,
      leftGridColumnId: col1!,
      rightGridColumnId: col2!,
      leftWidthTwips: 2700,
      rightWidthTwips: 3300,
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

  test('one undo step restores outer-right resize with exact effect', () => {
    const part = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>` +
        `${ROW(CELL('a1'), CELL('a2'))}</w:tbl>`
    );
    const store = new TreeDocumentStore(part);
    const partBefore = store.part;
    const table = firstTable(part);
    const [, col2] = gridColIds(part, table.id);
    const changes: TreeModelChange[] = [];
    const unsubscribe = store.subscribe((change) => changes.push(change));
    const edited = applyTreeOp(partBefore, {
      op: 'setTableRightEdgeWidth',
      tableId: table.id,
      gridColumnId: col2!,
      columnWidthTwips: 4200,
      tableWidthTwips: 6600,
    });
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;

    const result = store.transact((tx) => {
      tx.apply({
        op: 'setTableRightEdgeWidth',
        tableId: table.id,
        gridColumnId: col2!,
        columnWidthTwips: 4200,
        tableWidthTwips: 6600,
      });
    });
    unsubscribe();

    expect(result.ok).toBe(true);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.impact).toBe('flow-structural');
    expectSemanticEffects(changes[0]!, expectedResizeEffects(part, table.id));
    store.undo();
    expect(store.part).toBe(partBefore);
    store.redo();
    expect(canonicalOoxmlFingerprint(store.part)).toBe(canonicalOoxmlFingerprint(edited.part));
  });

  test('outer-right save/reopen passes D9 with inserted tblPr and tcPr', () => {
    const opened = readOoxmlPart(
      `${DEFAULT_NS_TABLE_OPEN}${QUALIFIED_GRID_COL('2400')}${QUALIFIED_GRID_COL('3600')}${DEFAULT_NS_TABLE_CLOSE}` +
        `<tr><tc><p/></tc><tc><p/></tc></tr></tbl></body></document>`,
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

    const result = applyTreeOp(part, {
      op: 'setTableRightEdgeWidth',
      tableId: table.id,
      gridColumnId: col2!,
      columnWidthTwips: 4200,
      tableWidthTwips: 6600,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    assertEditedReopens(result.part, part.name, part.contentType);
  });
});

describe('table resize namespace context', () => {
  test.each([
    [
      'default-namespace internal divider',
      `${DEFAULT_NS_TABLE_OPEN}${QUALIFIED_GRID_COL('2400')}${QUALIFIED_GRID_COL('3600')}${DEFAULT_NS_TABLE_CLOSE}` +
        `<tr><tc><tcPr><tcW xmlns:wx="${W}" wx:w="2400" wx:type="dxa"/></tcPr><p/></tc>` +
        `<tc><tcPr><tcW xmlns:wx="${W}" wx:w="3600" wx:type="dxa"/></tcPr><p/></tc></tr></tbl></body></document>`,
      'setTableColumnWidths' as const,
      (table: OoxmlElement, cols: string[]) => ({
        op: 'setTableColumnWidths' as const,
        tableId: table.id,
        leftGridColumnId: cols[0]!,
        rightGridColumnId: cols[1]!,
        leftWidthTwips: 3000,
        rightWidthTwips: 3000,
      }),
    ],
    [
      'default-namespace outer-right',
      `${DEFAULT_NS_TABLE_OPEN}${QUALIFIED_GRID_COL('2400')}${QUALIFIED_GRID_COL('3600')}${DEFAULT_NS_TABLE_CLOSE}` +
        `<tr><tc><tcPr><tcW xmlns:wx="${W}" wx:w="2400" wx:type="dxa"/></tcPr><p/></tc>` +
        `<tc><tcPr><tcW xmlns:wx="${W}" wx:w="3600" wx:type="dxa"/></tcPr><p/></tc></tr></tbl></body></document>`,
      'setTableRightEdgeWidth' as const,
      (table: OoxmlElement, cols: string[]) => ({
        op: 'setTableRightEdgeWidth' as const,
        tableId: table.id,
        gridColumnId: cols[1]!,
        columnWidthTwips: 4200,
        tableWidthTwips: 6600,
      }),
    ],
  ] as const)('applies %s with generated binding and D9 reopen', (_label, xml, _kind, buildOp) => {
    const opened = readOoxmlPart(xml, {
      name: '/word/document.xml',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    });
    if (!opened.ok) throw new Error(opened.reason);
    const part = opened.part;
    const table = firstTable(part);
    const cols = gridColIds(part, table.id);
    const op = buildOp(table, cols);
    expect(validateTreeOp(part, op)).toBeNull();
    const result = applyTreeOp(part, op);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const editedTable = tableById(result.part, table.id);
    expect(editedTable.namespaceBindings.some((b) => b.namespaceUri === W)).toBe(true);
    assertEditedReopens(result.part, part.name, part.contentType);
  });

  test('applies alternate wx alias for internal divider', () => {
    const opened = readOoxmlPart(
      `<wx:document xmlns:wx="${W}"><wx:body>` +
        `<wx:tbl><wx:tblGrid><wx:gridCol wx:w="2400"/><wx:gridCol wx:w="3600"/></wx:tblGrid>` +
        `<wx:tr><wx:tc><wx:tcPr><wx:tcW wx:w="2400" wx:type="dxa"/></wx:tcPr><wx:p/></wx:tc>` +
        `<wx:tc><wx:tcPr><wx:tcW wx:w="3600" wx:type="dxa"/></wx:tcPr><wx:p/></wx:tc></wx:tr>` +
        `</wx:tbl></wx:body></wx:document>`,
      {
        name: '/word/document.xml',
        contentType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
      }
    );
    if (!opened.ok) throw new Error(opened.reason);
    const part = opened.part;
    const table = firstTable(part);
    const [col1, col2] = gridColIds(part, table.id);
    const op = {
      op: 'setTableColumnWidths' as const,
      tableId: table.id,
      leftGridColumnId: col1!,
      rightGridColumnId: col2!,
      leftWidthTwips: 3000,
      rightWidthTwips: 3000,
    };
    expect(validateTreeOp(part, op)).toBeNull();
    const result = applyTreeOp(part, op);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    assertEditedReopens(result.part, part.name, part.contentType);
  });

  test('declares safe alias when hostile w shadows WML on outer-right resize', () => {
    const hostile = 'urn:attacker/wml-shadow';
    const opened = readOoxmlPart(
      `<wx:document xmlns:wx="${W}"><wx:body>` +
        `<wx:tbl xmlns:w="${hostile}"><wx:tblGrid><wx:gridCol wx:w="2400"/><wx:gridCol wx:w="3600"/></wx:tblGrid>` +
        `<wx:tr><wx:tc><wx:tcPr><wx:tcW wx:w="2400" wx:type="dxa"/></wx:tcPr><wx:p/></wx:tc>` +
        `<wx:tc><wx:tcPr><wx:tcW wx:w="3600" wx:type="dxa"/></wx:tcPr><wx:p/></wx:tc></wx:tr></wx:tbl>` +
        `</wx:body></wx:document>`,
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
    const op = {
      op: 'setTableRightEdgeWidth' as const,
      tableId: table.id,
      gridColumnId: col2!,
      columnWidthTwips: 4200,
      tableWidthTwips: 6600,
    };
    expect(validateTreeOp(part, op)).toBeNull();
    const result = applyTreeOp(part, op);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const editedTable = tableById(result.part, table.id);
    if (wmlFreshNamespaceContextAt(part, table).rowBinding) {
      expect(editedTable.namespaceBindings.some((b) => b.namespaceUri === W)).toBe(true);
    }
    const [, lastCellId] = rowCellIds(result.part, directRowsOfTable(editedTable)[0]!.id);
    const lastCell = collectByKind(result.part.root, 'tableCell').find((c) => c.id === lastCellId)!;
    const tcW = wmlChildNamed(wmlChildNamed(lastCell, 'tcPr')!, 'tcW')!;
    expect(tcW.attributes.every((a) => a.prefix === 'wx' && a.namespaceUri === W)).toBe(true);
    assertEditedReopens(result.part, part.name, part.contentType);
  });

  test('refuses resize and preserves empty-namespace gridCol width attribute', () => {
    const part = load(
      `<w:tbl><w:tblGrid><w:gridCol w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>` +
        `${ROW(CELL('a1'), CELL('a2'))}</w:tbl>`
    );
    const table = firstTable(part);
    const [col1, col2] = gridColIds(part, table.id);
    const col1Node = collectByKind(part.root, 'generic').find((n) => n.id === col1)!;
    const malformedBefore = col1Node.attributes.find(
      (a) => a.localName === 'w' && a.namespaceUri === ''
    );
    expect(malformedBefore?.value).toBe('2400');

    const store = new TreeDocumentStore(part);
    const partBefore = store.part;
    const result = store.transact((tx) => {
      tx.apply({
        op: 'setTableColumnWidths',
        tableId: table.id,
        leftGridColumnId: col1!,
        rightGridColumnId: col2!,
        leftWidthTwips: 3000,
        rightWidthTwips: 3000,
      });
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('tree-invariant');
    expect(store.part).toBe(partBefore);
    const col1After = collectByKind(store.part.root, 'generic').find((n) => n.id === col1)!;
    const malformedAfter = col1After.attributes.find(
      (a) => a.localName === 'w' && a.namespaceUri === ''
    );
    expect(malformedAfter).toBe(malformedBefore);
    expect(
      validateTreeOp(part, {
        op: 'setTableColumnWidths',
        tableId: table.id,
        leftGridColumnId: col1!,
        rightGridColumnId: col2!,
        leftWidthTwips: 3000,
        rightWidthTwips: 3000,
      })
    ).toBe('tree-invariant');
  });
});

describe('table resize layout readback', () => {
  test('layout column widths reflect store twips after divider resize', () => {
    const body =
      `<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr>` +
      `<w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>` +
      `${ROW(CELL('a1'), CELL('a2'))}</w:tbl>`;
    const part = load(body);
    const table = firstTable(part);
    const [col1, col2] = gridColIds(part, table.id);

    const result = applyTreeOp(part, {
      op: 'setTableColumnWidths',
      tableId: table.id,
      leftGridColumnId: col1!,
      rightGridColumnId: col2!,
      leftWidthTwips: 3000,
      rightWidthTwips: 3000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const structure = readTableStructure(firstTable(result.part), 468, 0)!;
    expect(structure.columnWidthsPt).toEqual([150, 150]);

    const layout = layoutSemanticDocument(result.part, 0, { measurer: createFixedMeasurer() });
    const fragment = layout.pages[0]!.fragments.find((f) => f.kind === 'table');
    expect(fragment?.kind).toBe('table');
    if (fragment?.kind !== 'table') return;
    expect(fragment.box.width).toBeCloseTo(300, 6);
  });
});

describe('table resize runtime shape', () => {
  test.each([
    ['fractional width', { leftWidthTwips: 3000.5, rightWidthTwips: 3000.5 }],
    ['null grid id', { leftGridColumnId: null }],
  ] as const)('rejects malformed divider op (%s)', (_label, extra) => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2'))));
    const store = new TreeDocumentStore(part);
    const table = firstTable(part);
    const [col1, col2] = gridColIds(part, table.id);
    const base = {
      op: 'setTableColumnWidths' as const,
      tableId: table.id,
      leftGridColumnId: col1!,
      rightGridColumnId: col2!,
      leftWidthTwips: 3000,
      rightWidthTwips: 3000,
    };

    const result = store.transact((tx) => {
      tx.apply({ ...base, ...extra } as never);
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalidArgs');
  });

  test('rejects missing own width key through store transact', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2'))));
    const store = new TreeDocumentStore(part);
    const table = firstTable(part);
    const [col1, col2] = gridColIds(part, table.id);
    const { rightWidthTwips: _drop, ...op } = {
      op: 'setTableColumnWidths' as const,
      tableId: table.id,
      leftGridColumnId: col1!,
      rightGridColumnId: col2!,
      leftWidthTwips: 3000,
      rightWidthTwips: 3000,
    };

    const result = store.transact((tx) => {
      tx.apply(op as never);
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalidArgs');
  });

  test('rejects inherited tableId through store transact', () => {
    const part = load(TABLE(ROW(CELL('a1'), CELL('a2'))));
    const store = new TreeDocumentStore(part);
    const table = firstTable(part);
    const [col1, col2] = gridColIds(part, table.id);
    const op = Object.assign(Object.create({ tableId: table.id }), {
      op: 'setTableColumnWidths',
      leftGridColumnId: col1!,
      rightGridColumnId: col2!,
      leftWidthTwips: 3000,
      rightWidthTwips: 3000,
    });

    const result = store.transact((tx) => {
      tx.apply(op as never);
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalidArgs');
  });
});
