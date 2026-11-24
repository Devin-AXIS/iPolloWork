import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { readTableStructure } from '../semantic-table.ts';
import { initialCellCursors, layoutRowFragmentBounded } from '../semantic-table-layout.ts';
import { tableTerminalDeps } from '../table-exact-terminal-border.ts';
import type { TableFlowDeps } from '../semantic-table-layout.ts';
import {
  exactTerminalFixture,
  tableNode,
  type ExactTerminalOptions,
} from './table-exact-terminal-fixtures.ts';

function deps(): TableFlowDeps {
  return {
    measurer: createFixedMeasurer(5, 12),
    producer: 'terminal-reference-test',
    nextLineId: (id, start, index) => `${id}:${start}:${index}`,
  };
}

// The reference keeps the same terminal rule across these authored table shapes.
for (const [name, options] of [
  ['header row', { header: true }],
  ['first-column terminal merge', { rows: 3, terminalMerge: true }],
  ['second-column merge', { rows: 3, otherColumnMerge: true }],
  ['three-row merge', { rows: 4, threeRowMerge: true }],
  ['terminal column span', { terminalSpan: true }],
  ['unequal top and bottom rules', { topWidth: 0.5 }],
  ['five-eighths rule', { width: 0.625 }],
] satisfies [string, ExactTerminalOptions][]) {
  test(`the reference terminal extent includes ${name}`, () => {
    const part = exactTerminalFixture(options);
    const source = serializeOoxmlPart(part);
    const structure = readTableStructure(tableNode(part.root), 464, 0);
    if (!structure) throw new Error('The table is missing');
    const original = deps();
    const actual = tableTerminalDeps(structure, original);
    expect(actual.exactTerminalBorder?.widthPt).toBe(options.width ?? 1.5);
    const result = layoutSemanticDocument(part, 0, { measurer: original.measurer });
    const tables = result.pages.flatMap((page) =>
      page.fragments.filter((fragment) => fragment.kind === 'table')
    );
    expect(tables).toHaveLength(1);
    const last = tables[0]!.rows.at(-1)!;
    expect(last.box.height).toBeCloseTo(19.85 + (options.width ?? 1.5), 6);
    if (options.terminalMerge) {
      const head = tables[0]!.rows[1]!.cells[0]!;
      expect(head.rowSpan).toBe(2);
      // Two authored rows give 39.7pt. The 0.5pt top band stays inside that box.
      expect(head.blocks[0]!.box.y - head.box.y).toBeCloseTo(14.1, 6);
    }
    expect(serializeOoxmlPart(part)).toBe(source);
  });
}

for (const align of ['center', 'bottom'] as const) {
  for (const room of [19.85, 20.5, 100]) {
    test(`${align} text uses the authored bottom with ${room}pt available`, () => {
      const part = exactTerminalFixture({ align });
      const structure = readTableStructure(tableNode(part.root), 464, 0);
      if (!structure) throw new Error('The table is missing');
      const row = structure.rows.at(-1)!;
      const actual = tableTerminalDeps(structure, deps());
      const placed = layoutRowFragmentBounded(
        row,
        structure.columnWidthsPt,
        0,
        0,
        room,
        false,
        false,
        0,
        actual,
        initialCellCursors(row)
      );
      expect(placed.record.box.height).toBeCloseTo(21.35, 6);
      const paragraph = placed.record.cells[0]!.blocks[0];
      if (!paragraph || paragraph.kind !== 'paragraph')
        throw new Error('The cell paragraph is missing');
      // Authored height: 19.85pt; internal top rule: 0.5pt; bottom margin: 0pt.
      // The 1.5pt closing stroke sits below that box and reserves no text space.
      expect(paragraph.box.y).toBeCloseTo(align === 'center' ? 4.175 : 7.85, 6);
      expect(paragraph.box.height).toBeCloseTo(12, 6);
      expect(placed.remainder).toBeNull();
    });
  }
}

test('an authored last row that fits only without its closing rule moves to the next page', () => {
  const part = exactTerminalFixture({ pageHeight: 1800, align: 'bottom' });
  const source = serializeOoxmlPart(part);
  const result = layoutSemanticDocument(part, 0, { measurer: createFixedMeasurer(5, 12) });
  const [first, second] = tablesOnPages(result);
  // 14pt + 19.85pt + 19.85pt = 53.7pt fits the 54pt band. The 1.5pt rule does not.
  expect(first!.page).toBe(0);
  expect(first!.table.rows).toHaveLength(1);
  expect(second!.page).toBe(1);
  const last = second!.table.rows.at(-1)!;
  expect(last.box.y).toBe(0);
  // On the new page the 1.5pt top rule replaces the 0.5pt inside rule; the 1pt difference
  // sits above the authored height, and the closing rule below it.
  expect(last.box.height).toBeCloseTo(1 + 19.85 + 1.5, 6);
  expect(pageOf(result, 'AFTER')).toBe(1);
  expect(serializeOoxmlPart(part)).toBe(source);
});

// Letter page, 1in margins: a 648pt band. A 12pt line and one 19.85pt row come first.
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const line = (text: string, keepNext = false) =>
  `<w:p><w:pPr>${keepNext ? '<w:keepNext/>' : ''}<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
function letterTable(
  rows: readonly number[],
  options: {
    lead?: boolean;
    header?: boolean;
    headers?: number;
    keepFirst?: boolean;
    noBottomRule?: boolean;
  } = {}
) {
  const headers = options.headers ?? (options.header ? 1 : 0);
  const side = (name: string, size: number) => `<w:${name} w:val="single" w:sz="${size}"/>`;
  const borders = ['top', 'bottom', 'left', 'right']
    .map((name) =>
      name === 'bottom' && options.noBottomRule ? '<w:bottom w:val="nil"/>' : side(name, 12)
    )
    .join('');
  const margins = ['top', 'bottom', 'left', 'right']
    .map((name) => `<w:${name} w:w="0" w:type="dxa"/>`)
    .join('');
  let table =
    `<w:tbl><w:tblPr><w:tblW w:w="3600" w:type="dxa"/><w:tblLayout w:type="fixed"/>` +
    `<w:tblBorders>${borders}${side('insideH', 4)}${side('insideV', 4)}</w:tblBorders>` +
    `<w:tblCellMar>${margins}</w:tblCellMar></w:tblPr>` +
    '<w:tblGrid><w:gridCol w:w="1800"/><w:gridCol w:w="1800"/></w:tblGrid>';
  rows.forEach((twips, index) => {
    const header = index < headers ? '<w:tblHeader/>' : '';
    table += `<w:tr><w:trPr><w:cantSplit/>${header}<w:trHeight w:val="${twips}" w:hRule="exact"/></w:trPr>`;
    for (const column of [0, 1])
      table += `<w:tc><w:tcPr><w:tcW w:w="1800" w:type="dxa"/></w:tcPr>${line(`R${index}C${column}`, options.keepFirst && index === 0)}</w:tc>`;
    table += '</w:tr>';
  });
  const section =
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" ' +
    'w:bottom="1440" w:left="1440" w:header="0" w:footer="0"/></w:sectPr>';
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${options.lead === false ? '' : line('LEAD')}` +
      `${table}</w:tbl>${line('AFTER')}${section}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  return read.part;
}

function tablesOnPages(result: ReturnType<typeof layoutSemanticDocument>) {
  return result.pages.flatMap((page, index) =>
    page.fragments.flatMap((table) => (table.kind === 'table' ? [{ page: index, table }] : []))
  );
}

function pageOf(result: ReturnType<typeof layoutSemanticDocument>, text: string): number {
  return result.pages.findIndex((page) =>
    page.fragments.some(
      (fragment) =>
        fragment.kind === 'paragraph' &&
        fragment.lines.some((row) => row.spans.some((span) => span.text === text))
    )
  );
}

const layOut = (part: ReturnType<typeof letterTable>, compatibilityMode?: number) =>
  layoutSemanticDocument(part, 0, { measurer: createFixedMeasurer(5, 12), compatibilityMode });

for (const [authoredBottom, moves] of [
  [646.5, false],
  [647, true],
  [647.5, true],
  [648, true],
] as const) {
  test(`a last row with its authored bottom at ${authoredBottom}pt ${moves ? 'moves' : 'stays'}`, () => {
    const lastTwips = Math.round(authoredBottom * 20) - 240 - 397;
    const part = letterTable([397, lastTwips]);
    const source = serializeOoxmlPart(part);
    const result = layOut(part);
    const placed = tablesOnPages(result);
    const lastPage = placed.at(-1)!;
    const last = lastPage.table.rows.at(-1)!;
    // A moved row opens page 2, where its 1.5pt top rule takes 1pt more than the inside rule.
    expect(last.box.height).toBeCloseTo((moves ? 1 : 0) + lastTwips / 20 + 1.5, 6);
    if (moves) {
      // The row with its rule ends past 648pt, so it starts page 2 instead.
      expect(placed.map((entry) => entry.table.rows.length)).toEqual([1, 1]);
      expect(lastPage.page).toBe(1);
      expect(last.box.y).toBe(0);
      expect(pageOf(result, 'AFTER')).toBe(1);
    } else {
      // The row and its rule end exactly at the bottom margin.
      expect(placed).toHaveLength(1);
      expect(last.box.y + last.box.height).toBeCloseTo(648, 6);
      expect(pageOf(result, 'AFTER')).toBe(1);
    }
    expect(serializeOoxmlPart(part)).toBe(source);
  });
}

test('a last row at the top of a page stays and its rule crosses the bottom margin', () => {
  const result = layOut(letterTable([12950], { lead: false }));
  const placed = tablesOnPages(result);
  expect(placed).toHaveLength(1);
  const last = placed[0]!.table.rows[0]!;
  expect(last.box.y).toBe(0);
  // Authored 647.5pt; moving cannot give the 1.5pt rule more room.
  expect(last.box.y + last.box.height).toBeCloseTo(649, 6);
  expect(pageOf(result, 'AFTER')).toBe(1);
});

for (const compatibilityMode of [undefined, 14]) {
  test(`before mode 15, a last row directly below repeated headers stays (mode ${compatibilityMode})`, () => {
    const part = letterTable([397, 12000, 12553], { header: true });
    const source = serializeOoxmlPart(part);
    const result = layOut(part, compatibilityMode);
    const placed = tablesOnPages(result);
    // Page 1: lead, header, and the 600pt row. Page 2: the repeated header and the last row.
    expect(placed.map((entry) => entry.page)).toEqual([0, 1]);
    const [header, last] = placed[1]!.table.rows;
    expect(header!.isHeaderRepeat).toBe(true);
    expect(last!.box.y).toBeCloseTo(19.85, 6);
    // Authored bottom 647.5pt: the row stays below the headers and its rule ends at 649pt.
    expect(last!.box.y + last!.box.height).toBeCloseTo(649, 6);
    expect(pageOf(result, 'AFTER')).toBe(2);
    expect(serializeOoxmlPart(part)).toBe(source);
  });
}

for (const headers of [1, 2]) {
  test(`mode 15 omits ${headers === 1 ? 'a repeated header row' : 'two repeated header rows'} that leave the last row's rule no room`, () => {
    // Below the headers the 647.5pt bottom fits, but the 1.5pt rule ends at 649pt.
    const rows = headers === 1 ? [397, 12000, 12553] : [397, 397, 11600, 12156];
    const part = letterTable(rows, { headers });
    const source = serializeOoxmlPart(part);
    const result = layOut(part, 15);
    const placed = tablesOnPages(result);
    expect(placed.map((entry) => entry.page)).toEqual([0, 1]);
    expect(placed[0]!.table.rows.filter((row) => row.isHeaderRow)).toHaveLength(headers);
    // Page 2 holds only the last row. It starts the page and its rule fits there.
    const [last, ...rest] = placed[1]!.table.rows;
    expect(rest).toHaveLength(0);
    expect(last!.isHeaderRepeat).toBeFalsy();
    expect(last!.box.y).toBe(0);
    // 1pt of top rule above the authored height, the closing rule below it.
    expect(last!.box.height).toBeCloseTo(1 + rows.at(-1)! / 20 + 1.5, 6);
    // The table's last page left out the repeat, so the paragraph after it starts page 3
    // (`omittedRepeatEndsPage`).
    expect(pageOf(result, 'AFTER')).toBe(2);
    expect(serializeOoxmlPart(part)).toBe(source);
  });
}

test('mode 15 keeps a repeated header when the last row and its rule end at the margin', () => {
  // 19.85pt + 626.65pt + 1.5pt = 648.00pt: equality fits, so the repeat stays.
  const result = layOut(letterTable([397, 12000, 12533], { header: true }), 15);
  const placed = tablesOnPages(result);
  expect(placed.map((entry) => entry.page)).toEqual([0, 1]);
  const [header, last] = placed[1]!.table.rows;
  expect(header!.isHeaderRepeat).toBe(true);
  expect(last!.box.y).toBeCloseTo(19.85, 6);
  expect(last!.box.y + last!.box.height).toBeCloseTo(648, 6);
});

test('mode 15 keeps a repeated header when the last row has no bottom rule', () => {
  const part = letterTable([397, 12000, 12553], { header: true, noBottomRule: true });
  const placed = tablesOnPages(layOut(part, 15));
  expect(placed[1]!.table.rows.map((row) => !!row.isHeaderRepeat)).toEqual([true, false]);
});

for (const compatibilityMode of [14, 15]) {
  test(`a last row whose rule ends at exactly 648.00pt stays (mode ${compatibilityMode})`, () => {
    // 12pt + 19.85pt + 614.65pt = 646.5pt, and the 1.5pt rule ends exactly at the margin.
    const result = layOut(letterTable([397, 12293]), compatibilityMode);
    const placed = tablesOnPages(result);
    expect(placed).toHaveLength(1);
    const last = placed[0]!.table.rows.at(-1)!;
    expect(last.box.y + last.box.height).toBeCloseTo(648, 6);
  });
}

test('a row kept with the last row moves with it when only the rule overflows', () => {
  // Authored bottom 647.5pt: both rows fit the band, but the last row's rule does not.
  const part = letterTable([397, Math.round(647.5 * 20) - 240 - 397], { keepFirst: true });
  const source = serializeOoxmlPart(part);
  const result = layOut(part);
  const placed = tablesOnPages(result);
  expect(placed.map((entry) => [entry.page, entry.table.rows.length])).toEqual([[1, 2]]);
  expect(pageOf(result, 'LEAD')).toBe(0);
  expect(serializeOoxmlPart(part)).toBe(source);
});
