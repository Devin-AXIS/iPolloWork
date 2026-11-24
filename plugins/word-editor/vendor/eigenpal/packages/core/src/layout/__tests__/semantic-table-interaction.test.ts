// Semantic table interaction geometry — authored ordinals, column edges, nested targeting,
// paginated fragments, repeated headers, revision stamps, and coordinate conversion.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '../../store/package/ooxml-tree.ts';
import {
  columnEdgesFromWidths,
  findTableInteractionAt,
  isInteractionIndexFresh,
  pageContentToSheet,
  sheetToPageContent,
  tableInteractionHitIdentity,
  tableInteractionIndex,
  tableInteractionTargetIdentity,
  resolveTableInteractionInsertHit,
} from '../semantic-table-interaction.ts';
import {
  createFixedMeasurer,
  layoutSemanticDocument,
  type BlockFragmentRecord,
  type PageGeometry,
  type SemanticLayout,
  type TableFragmentRecord,
} from '../semantic-layout.ts';
import {
  tableColumnDividerResizeTargetFrom,
  tableColumnOccurrenceTargetFrom,
  tableRowOccurrenceTargetFrom,
  type TableOccurrenceRef,
} from '../table-interaction-targets.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const tc = (content: string, tcPr = '') => `<w:tc>${tcPr}${content}</w:tc>`;
const tr = (cells: string, trPr = '') => `<w:tr>${trPr}${cells}</w:tr>`;
const W2000 = '<w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>';

const GEOMETRY: PageGeometry = {
  width: 400,
  height: 200,
  margin: { top: 10, right: 10, bottom: 10, left: 10 },
};

function layout(part: OoxmlPart, revision = 1): SemanticLayout {
  return layoutSemanticDocument(part, revision, {
    measurer: createFixedMeasurer(6, 14),
    geometry: GEOMETRY,
  });
}

function collectTables(blocks: readonly BlockFragmentRecord[]): TableFragmentRecord[] {
  const found: TableFragmentRecord[] = [];
  for (const block of blocks) {
    if (block.kind !== 'table') continue;
    found.push(block);
    for (const row of block.rows) {
      for (const cell of row.cells) found.push(...collectTables(cell.blocks));
    }
  }
  return found;
}

function tablesOf(result: SemanticLayout): TableFragmentRecord[] {
  return result.pages.flatMap((page) => collectTables(page.fragments));
}

describe('table interaction geometry', () => {
  test('columnEdgesFromWidths resolves cumulative boundaries', () => {
    expect(columnEdgesFromWidths([100, 50, 75])).toEqual([0, 100, 150, 225]);
  });

  test('published fragments carry nestingDepth, columnEdges, and authored rowIndex', () => {
    const part = load(
      `<w:tbl>${tr(tc(p('A1')) + tc(p('B1')))}${tr(tc(p('A2')) + tc(p('B2')))}</w:tbl>`
    );
    const result = layout(part);
    const [table] = tablesOf(result);
    expect(table!.nestingDepth).toBe(0);
    expect(table!.columnEdges.length).toBe(3);
    expect(table!.columnEdges[0]).toBe(0);
    expect(table!.columnEdges.at(-1)).toBeCloseTo(table!.box.width, 5);
    expect(table!.rows[0]!.rowIndex).toBe(0);
    expect(table!.rows[1]!.rowIndex).toBe(1);
  });

  test('nested tables publish deeper nestingDepth and innermost hit wins', () => {
    const part = load(
      `<w:tbl>${tr(
        tc(
          `<w:tbl><w:tblGrid><w:gridCol w:w="1500"/><w:gridCol w:w="1500"/></w:tblGrid>` +
            `${tr(tc(p('inner1')) + tc(p('inner2')))}</w:tbl>${p('outer')}`
        ) + tc(p('right'))
      )}</w:tbl>`
    );
    const result = layout(part);
    const outer = tablesOf(result).find((table) => table.nestingDepth === 0)!;
    const inner = tablesOf(result).find((table) => table.nestingDepth === 1)!;
    expect(outer).toBeDefined();
    expect(inner).toBeDefined();
    const index = tableInteractionIndex(result);
    const dividerX = inner.box.x + inner.columnEdges[1]!;
    const dividerY = inner.box.y + inner.rows[0]!.box.height / 2;
    const sheet = pageContentToSheet(0, dividerX, dividerY, result);
    const hit = findTableInteractionAt(index, sheet.x, sheet.y, result);
    expect(hit?.tableId).toBe(inner.tableId);
    expect(hit?.nestingDepth).toBe(1);
    expect(hit?.kind).toBe('columnDivider');
  });

  test('nested hit uses page-content table.box without accumulating parent origins', () => {
    const part = load(
      `${p('lead')}` +
        `<w:tbl><w:tblPr><w:tblInd w:w="720" w:type="dxa"/></w:tblPr>` +
        `<w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>` +
        `${tr(
          tc(
            `<w:tbl><w:tblGrid><w:gridCol w:w="1500"/><w:gridCol w:w="1500"/></w:tblGrid>` +
              `${tr(tc(p('I1')) + tc(p('I2')))}</w:tbl>` +
              p('after')
          )
        )}</w:tbl>`
    );
    const result = layout(part);
    const outer = tablesOf(result).find((table) => table.nestingDepth === 0)!;
    const inner = tablesOf(result).find((table) => table.nestingDepth === 1)!;
    expect(outer.box.x).toBeGreaterThan(0);
    expect(inner.box.x).toBeGreaterThan(outer.box.x);
    expect(inner.box.x).toBeLessThan(outer.box.x + outer.box.width);
    const index = tableInteractionIndex(result);
    const dividerX = inner.box.x + inner.columnEdges[1]!;
    const dividerY = inner.box.y + inner.rows[0]!.box.height / 2;
    const sheet = pageContentToSheet(0, dividerX, dividerY, result);
    const hit = findTableInteractionAt(index, sheet.x, sheet.y, result);
    expect(hit?.tableId).toBe(inner.tableId);
    expect(hit?.kind).toBe('columnDivider');
  });

  test('nested insert column at furniture band targets inner table only', () => {
    const part = load(
      `${p('lead')}` +
        `<w:tbl><w:tblPr><w:tblInd w:w="720" w:type="dxa"/></w:tblPr>` +
        `<w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="2000"/></w:tblGrid>` +
        `${tr(
          tc(
            `<w:tbl><w:tblGrid><w:gridCol w:w="1500"/><w:gridCol w:w="1500"/></w:tblGrid>` +
              `${tr(tc(p('I1')) + tc(p('I2')))}` +
              `${tr(tc(p('I3')) + tc(p('I4')))}` +
              `${tr(tc(p('I5')) + tc(p('I6')))}</w:tbl>` +
              p('after')
          ) + tc(p('right'))
        )}</w:tbl>`
    );
    const result = layout(part);
    const outer = tablesOf(result).find((table) => table.nestingDepth === 0)!;
    const inner = tablesOf(result).find((table) => table.nestingDepth === 1)!;
    const index = tableInteractionIndex(result);
    const colMidX = inner.box.x + (inner.columnEdges[0]! + inner.columnEdges[1]!) / 2;
    const colY = inner.box.y - 14;
    const sheet = pageContentToSheet(0, colMidX, colY, result);
    const hit = findTableInteractionAt(index, sheet.x, sheet.y, result);
    expect(hit?.kind).toBe('insertColumn');
    expect(hit?.tableId).toBe(inner.tableId);
    expect(hit?.tableId).not.toBe(outer.tableId);
    expect(hit?.nestingDepth).toBe(1);
    if (hit?.kind === 'insertColumn') {
      expect(hit.rowId).toBe(inner.rows[0]!.id);
    }
  });

  test('task12 outer host keeps inner column insert off the outer grid', () => {
    const part = load(
      `<w:tbl><w:tblPr><w:tblInd w:w="720" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblW w:w="6000" w:type="dxa"/></w:tblPr>` +
        `<w:tblGrid><w:gridCol w:w="3600"/><w:gridCol w:w="2400"/></w:tblGrid>` +
        `${tr(
          tc(
            `<w:tbl><w:tblGrid><w:gridCol w:w="1800"/><w:gridCol w:w="1800"/></w:tblGrid>` +
              `${tr(tc(p('INNER-NW')) + tc(p('INNER-NE')))}` +
              `${tr(tc(p('INNER-SW')) + tc(p('INNER-SE')))}` +
              `${tr(tc(p('INNER-3A')) + tc(p('INNER-3B')))}</w:tbl>` +
              p('OUTER-NEST-PAD')
          ) + tc(p('OUTER-TR'))
        )}` +
        `${tr(tc(p('OUTER-BL')) + tc(p('OUTER-BR')))}</w:tbl>`
    );
    const result = layout(part);
    const outer = tablesOf(result).find((table) => table.nestingDepth === 0)!;
    const inner = tablesOf(result).find((table) => table.nestingDepth === 1)!;
    const index = tableInteractionIndex(result);
    const colMidX = inner.box.x + (inner.columnEdges[0]! + inner.columnEdges[1]!) / 2;
    const colY = inner.box.y - 14;
    const sheet = pageContentToSheet(0, colMidX, colY, result);
    const hit = findTableInteractionAt(index, sheet.x, sheet.y, result);
    expect(hit?.kind).toBe('insertColumn');
    expect(hit?.tableId).toBe(inner.tableId);
    expect(hit?.tableId).not.toBe(outer.tableId);
    expect(outer.columnEdges.length - 1).toBe(2);
  });

  test('paginated table fragments each publish geometry with fragmentIndex', () => {
    const header = tr(tc(p('HEAD')), '<w:trPr><w:tblHeader/></w:trPr>');
    const body = Array.from({ length: 40 }, (_, i) => tr(tc(p(`row ${i}`)))).join('');
    const result = layout(load(`<w:tbl>${header}${body}</w:tbl>`));
    expect(result.pages.length).toBeGreaterThan(1);
    const fragments = tablesOf(result);
    expect(fragments.some((fragment) => fragment.fragmentIndex > 0)).toBe(true);
    for (const fragment of fragments) {
      expect(fragment.columnEdges.length).toBeGreaterThan(1);
      expect(fragment.nestingDepth).toBe(0);
    }
  });

  test('repeated header rows are indexed but marked non-editable in the interaction index', () => {
    const header = tr(tc(p('HEAD')), '<w:trPr><w:tblHeader/></w:trPr>');
    const body = Array.from({ length: 40 }, (_, i) => tr(tc(p(`row ${i}`)))).join('');
    const result = layout(load(`<w:tbl>${header}${body}</w:tbl>`));
    const index = tableInteractionIndex(result);
    const repeat = index.occurrences.find((occ) => occ.row.isHeaderRepeat);
    expect(repeat).toBeDefined();
    expect(repeat!.editable).toBe(false);
    expect(repeat!.row.rowIndex).toBe(0);
    const authored = index.occurrences.find(
      (occ) =>
        occ.table.tableId === repeat!.table.tableId &&
        !occ.row.isHeaderRepeat &&
        occ.row.rowIndex === 0
    );
    expect(authored?.editable).toBe(true);
  });

  test('resolveTableInteractionInsertHit refuses non-editable header-repeat occurrences', () => {
    const header = tr(tc(p('HEAD')), '<w:trPr><w:tblHeader/></w:trPr>');
    const body = Array.from({ length: 40 }, (_, i) => tr(tc(p(`row ${i}`)))).join('');
    const result = layout(load(`<w:tbl>${header}${body}</w:tbl>`));
    const index = tableInteractionIndex(result);
    const repeat = index.occurrences.find((occ) => occ.row.isHeaderRepeat)!;
    expect(repeat.editable).toBe(false);
    expect(
      resolveTableInteractionInsertHit(index, {
        kind: 'insertRow',
        pageIndex: repeat.pageIndex,
        sourceRevision: index.sourceRevision,
        tableId: repeat.table.tableId,
        rowId: repeat.row.id,
        isHeaderRepeat: true,
        nestingDepth: repeat.nestingDepth,
      })
    ).toBeNull();
  });

  test('interaction index is a pure WeakMap cache keyed on layout with layout.revision provenance', () => {
    const part = load(`<w:tbl>${tr(tc(p('only')))}</w:tbl>`);
    const result = layout(part, 7);
    const first = tableInteractionIndex(result);
    const second = tableInteractionIndex(result);
    expect(first).toBe(second);
    expect(first.sourceRevision).toBe(7);
    expect(isInteractionIndexFresh(first, result)).toBe(true);
    const newerLayout = layout(part, 8);
    expect(isInteractionIndexFresh(first, newerLayout)).toBe(false);
  });

  test('sheet and page-content conversion round-trips on page 0', () => {
    const part = load(`<w:tbl>${tr(tc(p('x')))}</w:tbl>`);
    const result = layout(part);
    const table = tablesOf(result)[0]!;
    const localX = table.box.x + 12;
    const localY = table.box.y + 18;
    const sheet = pageContentToSheet(0, localX, localY, result);
    const back = sheetToPageContent(result, sheet.x, sheet.y);
    expect(back?.pageIndex).toBe(0);
    expect(back?.x).toBeCloseTo(localX, 5);
    expect(back?.y).toBeCloseTo(localY, 5);
  });

  test('continuation page hit resolves without double-counting page.box', () => {
    const header = tr(tc(p('HEAD')), '<w:trPr><w:tblHeader/></w:trPr>');
    const body = Array.from({ length: 40 }, () => tr(tc(p('a')) + tc(p('b')))).join('');
    const result = layout(
      load(
        `<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>${header}${body}</w:tbl>`
      )
    );
    expect(result.pages.length).toBeGreaterThan(1);
    const pageIndex = result.pages.length - 1;
    const pageTable = tablesOf(result).find((table) => {
      const page = result.pages[pageIndex]!;
      return collectTables(page.fragments).includes(table);
    })!;
    const row = pageTable.rows.find((candidate) => !candidate.isHeaderRepeat)!;
    const localX = pageTable.box.x + pageTable.columnEdges[1]! - 1;
    const localY = pageTable.box.y + (row.box.y - pageTable.box.y) + row.box.height / 2;
    const sheet = pageContentToSheet(pageIndex, localX, localY, result);
    const index = tableInteractionIndex(result);
    const hit = findTableInteractionAt(index, sheet.x, sheet.y, result, 0, pageIndex);
    expect(hit?.kind).toBe('columnDivider');
    expect(hit?.pageIndex).toBe(pageIndex);
  });

  test('mixed-width pageOffsetX is excluded from semantic hit conversion', () => {
    const part = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>` +
        `${tr(tc(p('L')) + tc(p('R')))}</w:tbl>`
    );
    const result = layout(part);
    const table = tablesOf(result)[0]!;
    const index = tableInteractionIndex(result);
    const dividerX = table.box.x + table.columnEdges[1]!;
    const dividerY = table.box.y + table.rows[0]!.box.height / 2;
    const sheet = pageContentToSheet(0, dividerX, dividerY, result);
    const offsetX = 48;
    const hitWithOffset = findTableInteractionAt(
      index,
      sheet.x + offsetX,
      sheet.y,
      result,
      offsetX,
      0
    );
    const hitWithoutOffset = findTableInteractionAt(index, sheet.x, sheet.y, result, 0, 0);
    expect(hitWithOffset?.kind).toBe('columnDivider');
    expect(hitWithoutOffset?.kind).toBe('columnDivider');
    if (hitWithOffset?.kind === 'columnDivider' && hitWithoutOffset?.kind === 'columnDivider') {
      expect(hitWithOffset.leftGridColumnId).toBe(hitWithoutOffset.leftGridColumnId);
    }
  });

  test('zoom conversion scales sheet coordinates', () => {
    const part = load(`<w:tbl>${tr(tc(p('z')))}</w:tbl>`);
    const result = layout(part);
    const sheet = pageContentToSheet(0, 20, 30, result);
    expect(
      sheetToPageContent(result, sheet.x * 1.25, sheet.y * 1.25, () => 0, 1.25)?.x
    ).toBeCloseTo(20, 5);
  });

  test('occurrence factories preserve provenance for resize and insertion targets', () => {
    const part = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>` +
        `${tr(tc(p('a')) + tc(p('b')))}</w:tbl>`
    );
    const result = layout(part, 3);
    const table = tablesOf(result)[0]!;
    const ref: TableOccurrenceRef = { table, row: table.rows[0]!, rowIndex: 0 };
    const left = table.rows[0]!.cells[0]!.gridColumnId!;
    const right = table.rows[0]!.cells[1]!.gridColumnId!;
    expect(tableRowOccurrenceTargetFrom(9, ref).sourceRevision).toBe(9);
    expect(tableColumnOccurrenceTargetFrom(9, ref, table.rows[0]!.cells[0]!)!.gridColumnId).toBe(
      left
    );
    expect(tableColumnDividerResizeTargetFrom(9, ref, left, right).isHeaderRepeat).toBe(false);
  });

  test('divider hit maps adjacent grid column ids from columnEdges', () => {
    const part = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>` +
        `${tr(tc(p('L')) + tc(p('R')))}</w:tbl>`
    );
    const result = layout(part);
    const table = tablesOf(result)[0]!;
    const index = tableInteractionIndex(result);
    const dividerX = table.box.x + table.columnEdges[1]!;
    const dividerY = table.box.y + table.rows[0]!.box.height / 2;
    const sheet = pageContentToSheet(0, dividerX, dividerY, result);
    const hit = findTableInteractionAt(index, sheet.x, sheet.y, result);
    expect(hit?.kind).toBe('columnDivider');
    if (hit?.kind === 'columnDivider') {
      expect(hit.leftGridColumnId).toBeTruthy();
      expect(hit.rightGridColumnId).toBeTruthy();
      expect(hit.sourceRevision).toBe(result.revision);
    }
  });

  test('repeated header rows refuse divider and right-edge hits', () => {
    const header = tr(tc(p('HEAD')), '<w:trPr><w:tblHeader/></w:trPr>');
    const body = Array.from({ length: 40 }, (_, i) => tr(tc(p(`row ${i}`)))).join('');
    const result = layout(load(`<w:tbl>${header}${body}</w:tbl>`));
    const index = tableInteractionIndex(result);
    const repeatOcc = index.occurrences.find((occ) => occ.row.isHeaderRepeat && occ.pageIndex > 0)!;
    expect(repeatOcc).toBeDefined();
    const table = repeatOcc.table;
    const row = repeatOcc.row;
    const dividerX = table.box.x + table.columnEdges[1]!;
    const dividerY = table.box.y + (row.box.y - table.box.y) + row.box.height / 2;
    const sheet = pageContentToSheet(repeatOcc.pageIndex, dividerX, dividerY, result);
    const hit = findTableInteractionAt(index, sheet.x, sheet.y, result, 0, repeatOcc.pageIndex);
    expect(hit?.kind).not.toBe('columnDivider');
    expect(hit?.kind).not.toBe('rightEdge');
  });

  test('hit identity includes sourceRevision and full occurrence fields', () => {
    const part = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>` +
        `${tr(tc(p('a'), W2000) + tc(p('b'), W2000))}${tr(tc(p('c'), W2000) + tc(p('d'), W2000))}</w:tbl>`
    );
    const result = layout(part, 3);
    const table = tablesOf(result)[0]!;
    const index = tableInteractionIndex(result);
    const row0Y = table.rows[0]!.box.y + table.rows[0]!.box.height / 2;
    const row1Y = table.rows[1]!.box.y + table.rows[1]!.box.height / 2;
    const hitRow0 = findTableInteractionAt(
      index,
      pageContentToSheet(0, 4, row0Y, result).x,
      pageContentToSheet(0, 4, row0Y, result).y,
      result
    );
    const result2 = layout(part, 4);
    const index2 = tableInteractionIndex(result2);
    const hitRow0b = findTableInteractionAt(
      index2,
      pageContentToSheet(0, 4, row0Y, result2).x,
      pageContentToSheet(0, 4, row0Y, result2).y,
      result2
    );
    expect(hitRow0?.kind).toBe('insertRow');
    expect(hitRow0b?.kind).toBe('insertRow');
    if (hitRow0?.kind === 'insertRow' && hitRow0b?.kind === 'insertRow') {
      expect(tableInteractionTargetIdentity(hitRow0)).toBe(
        tableInteractionTargetIdentity(hitRow0b)
      );
      expect(tableInteractionHitIdentity(hitRow0)).not.toBe(tableInteractionHitIdentity(hitRow0b));
    }
  });
});
