import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { TableFragmentRecord } from '../semantic-records.ts';
import { revisionAuthorFilter } from '../revision-projection.ts';
import {
  autofitContextOf,
  autofitColumnWidthsPt,
  widenAutofitColumns,
} from '../table-autofit-widths.ts';
import { readTableStructure } from '../semantic-table.ts';
import { layoutContext } from './anchored-drawing-test-fixtures.ts';
import { elevenPointDefaults } from './fixtures/eleven-point-defaults.ts';

const round = (widths: readonly number[]) => widths.map((width) => Math.round(width * 10) / 10);

describe('widenAutofitColumns', () => {
  // Minimums 25.7 / 301.4 / 31.9 pt: a URL in the middle column, one short word beside it.
  const minimums = [25.7, 301.4, 31.9];

  test('returns columns that already hold their content unchanged', () => {
    const widths = [250, 125, 75];
    expect(widenAutofitColumns(widths, [20, 100, 30], 450, 451.3, { insets: [] })).toBe(widths);
  });

  test('takes the extra width from the other columns in proportion to their slack', () => {
    expect(
      round(widenAutofitColumns([250, 125, 75], minimums, 450, 451.3, { insets: [] }))
    ).toEqual([102, 301.4, 46.6]);
    // A shorter unbroken word takes proportionally less.
    expect(
      round(widenAutofitColumns([250, 125, 75], [25.7, 158.6, 31.9], 450, 451.3, { insets: [] }))
    ).toEqual([221.8, 158.6, 69.6]);
  });

  test('a table without an absolute width settles at the room it has', () => {
    const widths = widenAutofitColumns([250, 125, 75], minimums, 462.1, 462.1, { insets: [] });
    expect(round(widths)).toEqual([112.2, 301.4, 48.5]);
    expect(widths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(462.1, 6);
  });

  test('an automatic width also shrinks to the room an indent leaves', () => {
    // 72 pt of indent leaves 379.3 pt: the authored 450 pt grid gives back the rest too.
    expect(
      round(widenAutofitColumns([250, 125, 75], minimums, 379.3, 379.3, { insets: [] }))
    ).toEqual([42.7, 301.4, 35.2]);
  });

  test('grows past the stated table width once the other columns reach their minimums', () => {
    expect(round(widenAutofitColumns([100, 50, 50], minimums, 200, 451.3, { insets: [] }))).toEqual(
      minimums
    );
  });

  test('scales every minimum down when together they exceed the text column', () => {
    const widths = widenAutofitColumns([150, 150, 150], [301.4, 301.4, 34], 450, 451.3, {
      insets: [],
    });
    expect(round(widths)).toEqual([213.5, 213.5, 24.3]);
    expect(widths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(451.3, 6);
  });
});

describe('autofit layout', () => {
  const NAMESPACES = [
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"',
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
    'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"',
  ].join(' ');
  const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
  const table = (layout: string, middle: string, extraCell = '') =>
    `<w:tbl><w:tblPr><w:tblW w:w="2400" w:type="dxa"/>${layout}<w:tblCellMar><w:left w:w="0" w:type="dxa"/>` +
    '<w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="1200"/><w:gridCol w:w="600"/><w:gridCol w:w="600"/></w:tblGrid><w:tr>' +
    `<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/></w:tcPr><w:p>${run('ab')}</w:p></w:tc>` +
    `<w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/>${extraCell}</w:tcPr><w:p>${middle}</w:p></w:tc>` +
    `<w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/></w:tcPr><w:p>${run('cd')}</w:p></w:tc>` +
    '</w:tr></w:tbl>';
  const lines = (body: string) => columns(body).lines;
  const columns = (body: string, extra: Record<string, unknown> = {}) => {
    const read = readOoxmlPart(`<w:document ${NAMESPACES}><w:body>${body}</w:body></w:document>`, {
      name: '/word/document.xml',
      contentType: 'app/xml',
    });
    if (!read.ok) throw new Error(read.reason);
    const result = layoutSemanticDocument(read.part, 1, {
      measurer: createFixedMeasurer(6, 12),
      styleCascade: elevenPointDefaults(),
      geometry: { width: 300, height: 400, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
      ...(extra.drawings ? { inlineDrawingLayout: layoutContext(read.part) } : {}),
      ...extra,
    });
    const fragment = result.pages[0]!.fragments.find(
      (candidate): candidate is TableFragmentRecord => candidate.kind === 'table'
    )!;
    const row = fragment.rows[0]!;
    return {
      box: fragment.box,
      widths: row.cells.map((cell) => Math.round(cell.box.width * 100) / 100),
      lines: row.cells.map(
        (cell) =>
          cell.blocks.flatMap((block) => (block.kind === 'paragraph' ? block.lines : [])).length
      ),
    };
  };

  const unsized = (tblW: string, texts: readonly string[]) =>
    `<w:tbl><w:tblPr>${tblW}<w:tblCellMar><w:left w:w="0" w:type="dxa"/>` +
    '<w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="1200"/><w:gridCol w:w="600"/><w:gridCol w:w="600"/></w:tblGrid><w:tr>' +
    texts.map((text) => `<w:tc><w:p>${run(text)}</w:p></w:tc>`).join('') +
    '</w:tr></w:tbl>';

  test('cells that state no width size their columns by their content, not the grid', () => {
    // Widest lines 6, 24 and 12 pt share the 120 pt table in that proportion.
    const { widths } = columns(unsized('<w:tblW w:w="2400" w:type="dxa"/>', ['a', 'bbbb', 'cc']));
    expect(widths).toEqual([17.14, 68.57, 34.29]);
  });

  test('a table with no width of its own takes its content’s widths', () => {
    expect(columns(unsized('', ['a', 'bbbb', 'cc'])).widths).toEqual([6, 24, 12]);
  });

  test('a cell spanning two columns widens them to hold its word', () => {
    const spanned =
      '<w:tbl><w:tblPr><w:tblW w:w="2400" w:type="dxa"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/>' +
      '<w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="1200"/><w:gridCol w:w="600"/><w:gridCol w:w="600"/></w:tblGrid><w:tr>' +
      ['1200', '600', '600']
        .map(
          (w, i) =>
            `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/></w:tcPr><w:p>${run(['ab', 'cd', 'ef'][i]!)}</w:p></w:tc>`
        )
        .join('') +
      '</w:tr><w:tr><w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/></w:tcPr><w:p/></w:tc>' +
      `<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/><w:gridSpan w:val="2"/></w:tcPr><w:p>${run('A'.repeat(14))}</w:p></w:tc>` +
      '</w:tr></w:tbl>';
    // The 84 pt word needs both 30 pt columns; equal weights share it, and the first column
    // gives the rest.
    expect(columns(spanned).widths).toEqual([36, 42, 42]);
  });

  const laidOut = (body: string) => {
    const read = readOoxmlPart(`<w:document ${NAMESPACES}><w:body>${body}</w:body></w:document>`, {
      name: '/word/document.xml',
      contentType: 'app/xml',
    });
    if (!read.ok) throw new Error(read.reason);
    const result = layoutSemanticDocument(read.part, 1, {
      measurer: createFixedMeasurer(6, 12),
      styleCascade: elevenPointDefaults(),
      geometry: { width: 300, height: 400, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
    });
    return result.pages[0]!.fragments.find(
      (candidate): candidate is TableFragmentRecord => candidate.kind === 'table'
    )!;
  };
  const lineCount = (cell: TableFragmentRecord['rows'][number]['cells'][number]) =>
    cell.blocks.flatMap((block) => (block.kind === 'paragraph' ? block.lines : [])).length;
  const zeroMargins =
    '<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>';

  test('a nested fixed table paints no wider than the narrowed cell that holds it', () => {
    const nested =
      '<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid>' +
      `<w:tr><w:tc><w:tcPr><w:tcW w:w="1000" w:type="dxa"/></w:tcPr><w:p>${run('n')}</w:p></w:tc></w:tr></w:tbl>`;
    const outer = laidOut(
      `<w:tbl><w:tblPr><w:tblW w:w="2400" w:type="dxa"/>${zeroMargins}</w:tblPr>` +
        '<w:tblGrid><w:gridCol w:w="1200"/><w:gridCol w:w="1200"/></w:tblGrid><w:tr>' +
        `<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/></w:tcPr>${nested}<w:p/></w:tc>` +
        `<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/></w:tcPr><w:p>${run('A'.repeat(14))}</w:p></w:tc>` +
        '</w:tr></w:tbl>'
    );
    const host = outer.rows[0]!.cells[0]!;
    const inner = host.blocks.find((block) => block.kind === 'table')!;
    expect(host.box.width).toBeCloseTo(36, 6);
    expect(inner.box.x + inner.box.width).toBeLessThanOrEqual(host.box.x + host.box.width + 0.01);
  });

  test('a content-sized table with no room left keeps its words whole', () => {
    const table = laidOut(
      `<w:tbl><w:tblPr><w:tblInd w:w="6000" w:type="dxa"/>${zeroMargins}</w:tblPr>` +
        '<w:tblGrid><w:gridCol w:w="1200"/><w:gridCol w:w="1200"/></w:tblGrid><w:tr>' +
        `<w:tc><w:p>${run('hello world')}</w:p></w:tc><w:tc><w:p>${run('abc')}</w:p></w:tc>` +
        '</w:tr></w:tbl>'
    );
    const [first, second] = table.rows[0]!.cells;
    expect(lineCount(first!)).toBeLessThanOrEqual(2);
    expect(lineCount(second!)).toBe(1);
  });

  test('a spanning word keeps its room after the columns settle', () => {
    const cell = (twips: number, text: string, span = '') =>
      `<w:tc><w:tcPr><w:tcW w:w="${twips}" w:type="dxa"/>${span}</w:tcPr><w:p>${run(text)}</w:p></w:tc>`;
    const table = laidOut(
      `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="dxa"/>${zeroMargins}</w:tblPr>` +
        '<w:tblGrid><w:gridCol w:w="1600"/><w:gridCol w:w="1600"/><w:gridCol w:w="1800"/></w:tblGrid>' +
        `<w:tr>${cell(1600, 'a')}${cell(1600, 'b')}${cell(1800, 'C'.repeat(30))}</w:tr>` +
        `<w:tr>${cell(3200, 'S'.repeat(20), '<w:gridSpan w:val="2"/>')}${cell(1800, 'c')}</w:tr>` +
        '</w:tbl>'
    );
    expect(lineCount(table.rows[1]!.cells[0]!)).toBe(1);
    expect(lineCount(table.rows[0]!.cells[2]!)).toBe(1);
  });

  const fixedNested = (grid: readonly number[], rows: readonly string[][], extra = '') =>
    `<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/>${extra}${zeroMargins}</w:tblPr><w:tblGrid>` +
    grid.map((w) => `<w:gridCol w:w="${w}"/>`).join('') +
    '</w:tblGrid>' +
    rows
      .map(
        (row) =>
          '<w:tr>' +
          row
            .map((text, index) =>
              row.length < grid.length
                ? `<w:tc><w:tcPr><w:gridSpan w:val="${grid.length}"/></w:tcPr><w:p>${run(text)}</w:p></w:tc>`
                : `<w:tc><w:tcPr><w:tcW w:w="${grid[index]}" w:type="dxa"/></w:tcPr><w:p>${run(text)}</w:p></w:tc>`
            )
            .join('') +
          '</w:tr>'
      )
      .join('') +
    '</w:tbl>';
  const hostOf = (nested: string, neighbour: string) =>
    laidOut(
      `<w:tbl><w:tblPr><w:tblW w:w="2400" w:type="dxa"/>${zeroMargins}</w:tblPr>` +
        '<w:tblGrid><w:gridCol w:w="1200"/><w:gridCol w:w="1200"/></w:tblGrid><w:tr>' +
        `<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/></w:tcPr>${nested}<w:p/></w:tc>` +
        `<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/></w:tcPr><w:p>${run(neighbour)}</w:p></w:tc>` +
        '</w:tr></w:tbl>'
    ).rows[0]!.cells[0]!;
  const innerOf = (host: TableFragmentRecord['rows'][number]['cells'][number]) =>
    host.blocks.find((block): block is TableFragmentRecord => block.kind === 'table')!;

  test('a narrowed nested fixed table gives way down to each column’s own words', () => {
    const host = hostOf(fixedNested([4000, 400], [['a', 'BBBBBB']]), 'A'.repeat(14));
    const inner = innerOf(host);
    expect(lineCount(inner.rows[0]!.cells[1]!)).toBe(1);
    expect(inner.box.x + inner.box.width).toBeLessThanOrEqual(host.box.x + host.box.width + 0.01);
  });

  test('a nested fixed table’s spanning word reaches the outer column', () => {
    const host = hostOf(fixedNested([3000, 3000], [['a', 'b'], ['W'.repeat(12)]]), 'A'.repeat(18));
    const inner = innerOf(host);
    expect(lineCount(inner.rows[1]!.cells[0]!)).toBe(1);
  });

  test('an indented nested fixed table stays inside its cell', () => {
    const host = hostOf(
      fixedNested([4000], [['n']], '<w:tblInd w:w="400" w:type="dxa"/>'),
      'A'.repeat(14)
    );
    const inner = innerOf(host);
    expect(inner.box.x + inner.box.width).toBeLessThanOrEqual(host.box.x + host.box.width + 0.01);
  });

  const nestedRows = (grid: readonly number[], rows: string, extra = '') =>
    `<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/>${extra}${zeroMargins}</w:tblPr><w:tblGrid>` +
    grid.map((w) => `<w:gridCol w:w="${w}"/>`).join('') +
    `</w:tblGrid>${rows}</w:tbl>`;
  const plain = (twips: number, text: string) =>
    `<w:tc><w:tcPr><w:tcW w:w="${twips}" w:type="dxa"/></w:tcPr><w:p>${run(text)}</w:p></w:tc>`;
  const spanning = (count: number, text: string) =>
    `<w:tc><w:tcPr><w:gridSpan w:val="${count}"/></w:tcPr><w:p>${run(text)}</w:p></w:tc>`;

  test('a narrowed nested fixed table keeps room for its spanning word', () => {
    const nested = nestedRows(
      [2000, 2000, 4000],
      `<w:tr>${plain(2000, 'a')}${plain(2000, 'b')}${plain(4000, 'c')}</w:tr>` +
        `<w:tr>${spanning(2, 'W'.repeat(12))}${plain(4000, 'c')}</w:tr>`
    );
    const inner = innerOf(hostOf(nested, 'A'.repeat(18)));
    expect(lineCount(inner.rows[1]!.cells[0]!)).toBe(1);
  });

  test('a nested fixed column only spanning cells cover asks for no width of its own', () => {
    const nested = nestedRows(
      [400, 3000, 400],
      `<w:tr>${plain(400, 'a')}${spanning(2, 'b')}</w:tr>` +
        `<w:tr>${spanning(2, 'c')}${plain(400, 'd')}</w:tr>`
    );
    const host = hostOf(nested, 'A'.repeat(14));
    expect(host.box.width).toBeLessThan(60);
  });

  test('a spaced nested fixed table narrows with its gaps outside its cells', () => {
    const nested = nestedRows(
      [4000, 400],
      `<w:tr>${plain(4000, 'a')}${plain(400, 'BBBBBB')}</w:tr>`,
      '<w:tblCellSpacing w:w="100" w:type="dxa"/>'
    );
    const inner = innerOf(hostOf(nested, 'A'.repeat(14)));
    expect(lineCount(inner.rows[0]!.cells[1]!)).toBe(1);
  });

  test('a nested column with nothing of its own still keeps the words beside it whole', () => {
    const nested = nestedRows(
      [400, 3000, 400],
      `<w:tr>${plain(400, 'AAAAAAA')}${spanning(2, 'b')}</w:tr>` +
        `<w:tr>${spanning(2, 'c')}${plain(400, 'DDDDDDD')}</w:tr>`
    );
    const inner = innerOf(hostOf(nested, 'A'.repeat(14)));
    expect(lineCount(inner.rows[0]!.cells[0]!)).toBe(1);
    expect(lineCount(inner.rows[1]!.cells[1]!)).toBe(1);
  });

  test('a nested fixed column of vertical text keeps its width', () => {
    const vertical =
      '<w:tc><w:tcPr><w:tcW w:w="800" w:type="dxa"/><w:textDirection w:val="btLr"/></w:tcPr>' +
      `<w:p>${run('vv')}</w:p></w:tc>`;
    for (const below of ['', `<w:tr>${spanning(2, 'c')}</w:tr>`]) {
      // Also when a spanning cell in another row covers the same column.
      const nested = nestedRows([4000, 800], `<w:tr>${plain(4000, 'a')}${vertical}</w:tr>${below}`);
      const inner = innerOf(hostOf(nested, 'A'.repeat(14)));
      expect(inner.rows[0]!.cells[1]!.box.width).toBeCloseTo(40, 6);
    }
  });

  test('a nested vertical-text cell keeps its width when it spans or heads a text column', () => {
    const spanned =
      '<w:tc><w:tcPr><w:gridSpan w:val="2"/><w:textDirection w:val="btLr"/></w:tcPr>' +
      `<w:p>${run('vv')}</w:p></w:tc>`;
    const across = nestedRows([4000, 400, 400], `<w:tr>${plain(4000, 'a')}${spanned}</w:tr>`);
    expect(innerOf(hostOf(across, 'A'.repeat(14))).rows[0]!.cells[1]!.box.width).toBeCloseTo(40, 6);
    const header =
      '<w:tc><w:tcPr><w:tcW w:w="800" w:type="dxa"/><w:textDirection w:val="btLr"/></w:tcPr>' +
      `<w:p>${run('vv')}</w:p></w:tc>`;
    const headed = nestedRows(
      [4000, 800],
      `<w:tr>${plain(4000, 'a')}${header}</w:tr><w:tr>${plain(4000, 'b')}${plain(800, 'x')}</w:tr>`
    );
    expect(innerOf(hostOf(headed, 'A'.repeat(14))).rows[0]!.cells[1]!.box.width).toBeCloseTo(40, 6);
  });

  test('a span the cells’ stated widths hold but the grid does not still widens', () => {
    const table = laidOut(
      `<w:tbl><w:tblPr><w:tblW w:w="2400" w:type="dxa"/>${zeroMargins}</w:tblPr>` +
        '<w:tblGrid><w:gridCol w:w="1200"/><w:gridCol w:w="1200"/></w:tblGrid>' +
        `<w:tr><w:tc><w:tcPr><w:tcW w:w="1600" w:type="dxa"/></w:tcPr><w:p>${run('a')}</w:p></w:tc>` +
        `<w:tc><w:tcPr><w:tcW w:w="1600" w:type="dxa"/></w:tcPr><w:p>${run('b')}</w:p></w:tc></w:tr>` +
        `<w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p>${run('S'.repeat(23))}</w:p></w:tc></w:tr>` +
        '</w:tbl>'
    );
    expect(lineCount(table.rows[1]!.cells[0]!)).toBe(1);
  });

  test('a rotated header row gives its columns no minimum in an autofit table', () => {
    const rotated =
      '<w:tc><w:tcPr><w:tcW w:w="800" w:type="dxa"/><w:textDirection w:val="btLr"/></w:tcPr>' +
      `<w:p>${run('v')}</w:p></w:tc>`;
    const body =
      `<w:tbl><w:tblPr><w:tblW w:w="2400" w:type="dxa"/>${zeroMargins}</w:tblPr>` +
      '<w:tblGrid><w:gridCol w:w="800"/><w:gridCol w:w="800"/><w:gridCol w:w="800"/></w:tblGrid>' +
      `<w:tr>${rotated.repeat(3)}</w:tr>` +
      `<w:tr>${['a', 'A'.repeat(14), 'b'].map((text) => `<w:tc><w:tcPr><w:tcW w:w="800" w:type="dxa"/></w:tcPr><w:p>${run(text)}</w:p></w:tc>`).join('')}</w:tr>` +
      '</w:tbl>';
    expect(columns(body).widths).toEqual([18, 84, 18]);
  });

  test('a column of vertical text with no stated width keeps its resolved width', () => {
    const body =
      `<w:tbl><w:tblPr><w:tblW w:w="2400" w:type="dxa"/>${zeroMargins}</w:tblPr>` +
      '<w:tblGrid><w:gridCol w:w="1200"/><w:gridCol w:w="600"/><w:gridCol w:w="600"/></w:tblGrid><w:tr>' +
      `<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/></w:tcPr><w:p>${run('ab')}</w:p></w:tc>` +
      `<w:tc><w:tcPr><w:textDirection w:val="btLr"/></w:tcPr><w:p>${run('v')}</w:p></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/></w:tcPr><w:p>${run('cd')}</w:p></w:tc>` +
      '</w:tr></w:tbl>';
    expect(columns(body).widths).toEqual([60, 30, 30]);
  });

  test('widens a column to keep a 10-letter word whole', () => {
    // A 60 pt word in a 30 pt column. The others give the 30 pt in proportion to their
    // slack above their 12 pt minimums: 48 and 18 pt.
    const { widths, lines } = columns(table('', run('ABCDEFGHIJ')));
    expect(widths).toEqual([38.18, 60, 21.82]);
    expect(lines).toEqual([1, 1, 1]);
  });

  test('a field result and a hyphenated word count the same way', () => {
    const field =
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> HYPERLINK "https://e/" </w:instrText></w:r>' +
      `<w:r><w:fldChar w:fldCharType="separate"/></w:r>${run('ABCDEFGHIJ')}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
    expect(columns(table('', field)).widths).toEqual([38.18, 60, 21.82]);
    // The hyphen is a break opportunity: the widest piece is `ABCDEFG-` (48 pt).
    expect(columns(table('', run('ABCDEFG-HIJ'))).widths[1]).toBe(48);
  });

  test('spaces split words, so ordinary text keeps the authored widths', () => {
    expect(columns(table('', run('AB CD EF GH IJ'))).widths).toEqual([60, 30, 30]);
  });

  test('a fixed layout and vertical text keep the authored widths', () => {
    expect(columns(table('<w:tblLayout w:type="fixed"/>', run('ABCDEFGHIJ'))).widths).toEqual([
      60, 30, 30,
    ]);
    expect(columns(table('', run('ABCDEFGHIJ'), '<w:textDirection w:val="btLr"/>')).widths).toEqual(
      [60, 30, 30]
    );
  });

  test('a first-line indent counts against the first word in compatibility mode 15', () => {
    const indented = `<w:pPr><w:ind w:firstLine="240"/></w:pPr>${run('ABCDEFGHIJ')}`;
    const modern = columns(table('', indented), { compatibilityMode: 15 });
    expect(modern.widths[1]).toBe(72);
    expect(modern.lines).toEqual([1, 1, 1]);
  });

  test('earlier compatibility modes leave a first-line indent out of the minimum', () => {
    // The word fits the column without the indent, so it breaks on the indented first line.
    const indented = `<w:pPr><w:ind w:firstLine="240"/></w:pPr>${run('ABCDEFGHIJ')}`;
    const legacy = columns(table('', indented));
    expect(legacy.widths[1]).toBe(60);
    expect(legacy.lines[1]).toBe(2);
  });

  test('a widening column keeps the first-line indent of a word after leading spaces', () => {
    // The word alone is wider than the column, so it widens, and the word keeps its indent on
    // the first line. Without the need to widen, the word would start the next line instead.
    const spaced = `<w:pPr><w:ind w:firstLine="240"/></w:pPr>${run(' ABCDEFGHIJ')}`;
    expect(columns(table('', spaced), { compatibilityMode: 15 }).widths[1]).toBe(72);
  });

  test('cell spacing counts against the column', () => {
    const spaced = table('<w:tblCellSpacing w:w="100" w:type="dxa"/>', run('ABCDEFGHIJ'));
    expect(columns(spaced).widths[1]).toBeCloseTo(60, 6);
    expect(lines(spaced)).toEqual([1, 1, 1]);
  });

  test('hidden text joins the visible text around it into one word', () => {
    const hidden = `${run('ABCDE')}<w:r><w:rPr><w:vanish/></w:rPr><w:t>x</w:t></w:r>${run('FGHIJ')}`;
    expect(columns(table('', hidden)).widths[1]).toBe(60);
  });

  test('a dash that ends its run is a break opportunity', () => {
    const split = `${run('ABCDEFG-')}<w:r><w:rPr><w:b/></w:rPr><w:t>HIJ</w:t></w:r>`;
    expect(columns(table('', split)).widths[1]).toBe(48);
  });

  test('a fixed nested table gives up its stated width to the column beside it', () => {
    const nested =
      '<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid>' +
      `<w:tr><w:tc><w:tcPr><w:tcW w:w="1000" w:type="dxa"/></w:tcPr><w:p>${run('n')}</w:p></w:tc></w:tr></w:tbl>`;
    const body =
      '<w:tbl><w:tblPr><w:tblW w:w="2400" w:type="dxa"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/>' +
      '<w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="1200"/><w:gridCol w:w="1200"/></w:tblGrid><w:tr>' +
      `<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/></w:tcPr>${nested}<w:p/></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/></w:tcPr><w:p>${run('A'.repeat(14))}</w:p></w:tc>` +
      '</w:tr></w:tbl>';
    const { widths } = columns(body);
    // The column narrows below the nested table's 50 pt to the content it holds.
    expect(widths[0]).toBeCloseTo(36, 6);
    expect(widths[1]).toBe(84);
  });

  test('an indented automatic-width table grows only to the margin', () => {
    const indented =
      '<w:tbl><w:tblPr><w:tblInd w:w="1200" w:type="dxa"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/>' +
      '<w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="1200"/><w:gridCol w:w="1200"/></w:tblGrid><w:tr>' +
      `<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/></w:tcPr><w:p>${run('ab')}</w:p></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/></w:tcPr><w:p>${run('A'.repeat(40))}</w:p></w:tc>` +
      '</w:tr></w:tbl>';
    const { box } = columns(indented);
    expect(box.x + box.width).toBeLessThanOrEqual(300 + 0.01);
  });

  test('a percentage width grows only to its share of the text column', () => {
    const half =
      '<w:tbl><w:tblPr><w:tblW w:w="2500" w:type="pct"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/>' +
      '<w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="1200"/><w:gridCol w:w="600"/></w:tblGrid><w:tr>' +
      `<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/></w:tcPr><w:p>${run('ab')}</w:p></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/></w:tcPr><w:p>${run('ABCDEFGHIJ')}</w:p></w:tc>` +
      '</w:tr></w:tbl>';
    expect(columns(half).box.width).toBeCloseTo(150, 6);
  });

  const picture = (effectEmu = 0) =>
    '<w:r><w:drawing><wp:inline distL="114300" distR="114300">' +
    `<wp:extent cx="698500" cy="127000"/><wp:effectExtent l="${effectEmu}" t="0" r="${effectEmu}" b="0"/>` +
    '<wp:docPr id="1" name="p"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rId1"/></pic:blipFill><pic:spPr><a:xfrm><a:ext cx="698500" cy="127000"/></a:xfrm>' +
    '<a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  const withPicture = (content: string) =>
    table('', run('ABCDEFGHIJ')).replace(`<w:p>${run('ab')}</w:p>`, `<w:p>${content}</w:p>`);

  test('an inline picture keeps the width it paints at, effect extents included', () => {
    // 55 pt picture: its column keeps 55 pt; side distances do not count for an inline one.
    expect(columns(withPicture(picture()), { drawings: true }).widths[0]).toBeCloseTo(55, 6);
    // 10 pt of effect extent on each side paints it 75 pt wide.
    expect(columns(withPicture(picture(127000)), { drawings: true }).widths[0]).toBeCloseTo(75, 6);
  });

  test('a picture a hidden author deleted sets no minimum', () => {
    const deleted = `<w:del w:id="1" w:author="B" w:date="2026-01-01T00:00:00Z">${picture()}</w:del>${run('ab')}`;
    const view = { drawings: true, revisionAuthorFilter: revisionAuthorFilter(['B']) };
    expect(columns(withPicture(deleted), view).widths[0]).toBeLessThan(55);
  });

  test('text a hidden author deleted sets no minimum', () => {
    const deleted =
      '<w:del w:id="1" w:author="B" w:date="2026-01-01T00:00:00Z"><w:r><w:delText>ABCDEFGHIJ</w:delText></w:r></w:del>' +
      run('ab');
    const filter = { revisionAuthorFilter: revisionAuthorFilter(['B']) };
    expect(columns(table('', deleted), filter).widths).toEqual([60, 30, 30]);
  });

  test('a table wider than the text column keeps its own width while widening', () => {
    const wide =
      '<w:tbl><w:tblPr><w:tblW w:w="7000" w:type="dxa"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/>' +
      '<w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="1000"/><w:gridCol w:w="3000"/></w:tblGrid><w:tr>' +
      `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr><w:p>${run('ab')}</w:p></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="1000" w:type="dxa"/></w:tcPr><w:p>${run('A'.repeat(10))}</w:p></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr><w:p>${run('cd')}</w:p></w:tc>` +
      '</w:tr></w:tbl>';
    expect(columns(wide).box.width).toBeCloseTo(350, 6);
  });

  test('a leading tab uses up the first-line indent', () => {
    const tabbed = `<w:pPr><w:ind w:firstLine="720"/></w:pPr><w:r><w:tab/></w:r>${run('ABCDEFGHIJ')}`;
    expect(columns(table('', tabbed)).widths[1]).toBe(60);
  });

  test('a run that holds only a dash ends the word before it', () => {
    const dashed = `${run('ABCDEFG')}<w:r><w:rPr><w:b/></w:rPr><w:t>-</w:t></w:r>${run('HIJ')}`;
    expect(columns(table('', dashed)).widths[1]).toBe(48);
  });

  test('a hard break ends the first-line indent', () => {
    const broken = `<w:pPr><w:ind w:firstLine="720"/></w:pPr><w:r><w:br/></w:r>${run('ABCDEFGHIJ')}`;
    expect(columns(table('', broken)).widths[1]).toBe(60);
  });

  test('a dash run seam breaks where line breaking does', () => {
    // A dash before another dash does not break, the last dash of the run does, as in one
    // run; a lone dash after a space is its own word.
    expect(
      columns(table('', `${run('ABCDE-')}<w:r><w:rPr><w:b/></w:rPr><w:t>-FGHIJ</w:t></w:r>`))
        .widths[1]
    ).toBe(42);
    expect(columns(table('', run('ABCDE--FGHIJ'))).widths[1]).toBe(42);
    expect(
      columns(table('', `${run('ABCDEFGH -')}<w:r><w:rPr><w:b/></w:rPr><w:t>IJKLMNOP</w:t></w:r>`))
        .widths[1]
    ).toBe(48);
  });

  test('an indent that fills the text column settles at the minimums, not hairlines', () => {
    const crowded =
      '<w:tbl><w:tblPr><w:tblInd w:w="6000" w:type="dxa"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/>' +
      '<w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="1200"/><w:gridCol w:w="600"/><w:gridCol w:w="600"/></w:tblGrid><w:tr>' +
      `<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/></w:tcPr><w:p>${run('ab')}</w:p></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/></w:tcPr><w:p>${run('ABCDEFGHIJ')}</w:p></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/></w:tcPr><w:p>${run('cd')}</w:p></w:tc>` +
      '</w:tr></w:tbl>';
    // With no room left, every column settles at its minimum and every word stays whole.
    const { widths, lines } = columns(crowded);
    expect(widths).toEqual([12, 60, 12]);
    expect(lines).toEqual([1, 1, 1]);
  });

  test('an inline equation keeps its column as wide as it paints', () => {
    const equation = '<m:oMath><m:r><m:t>abcdefghijklmnop</m:t></m:r></m:oMath>';
    const fragment = columns(table('', equation));
    expect(fragment.widths[1]).toBeGreaterThan(30);
    expect(fragment.lines[1]).toBe(1);
  });

  test('a field value that only layout knows sets the minimum it paints', () => {
    // AUTHOR with no cached result paints the document's author.
    const author =
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> AUTHOR </w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>';
    const fragment = columns(table('', author), { documentProperties: { creator: 'ABCDEFGHIJ' } });
    expect(fragment.widths[1]).toBe(60);
    expect(fragment.lines[1]).toBe(1);
  });

  test('words on each side of a page break in a cell are one word', () => {
    const broken = `${run('ABCDE')}<w:r><w:br w:type="page"/></w:r>${run('FGHIJ')}`;
    const fragment = columns(table('', broken));
    expect(fragment.widths[1]).toBe(60);
  });

  test('a new pass with equal field values reuses every measured minimum', () => {
    const read = readOoxmlPart(
      `<w:document ${NAMESPACES}><w:body>${table('', run('ABCDEFGHIJ'))}</w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!read.ok) throw new Error(read.reason);
    const tableNode = read.part.root.children
      .flatMap((node) => ('children' in node ? node.children : []))
      .find((node) => node.kind === 'table')!;
    const base = readTableStructure(tableNode, 300, 0, elevenPointDefaults())!;
    const fixed = createFixedMeasurer(6, 12);
    let measured = 0;
    const measurer = {
      ...fixed,
      measure: (...args: Parameters<typeof fixed.measure>) => (measured++, fixed.measure(...args)),
    };
    const view = {
      styleCascade: elevenPointDefaults(),
      displayMode: 'all-markup' as const,
      authorFilter: undefined,
      readNested: () => null,
    };
    // Each pass builds its own deps and a fresh, frozen page-field context.
    const pass = () =>
      autofitColumnWidthsPt(
        base,
        300,
        autofitContextOf({ measurer, bodyPageFields: Object.freeze({}) }),
        view
      );
    expect(round(pass())).toEqual([38.2, 60, 21.8]);
    const first = measured;
    pass();
    expect(measured).toBe(first);
    // A new producer (renumbered note marks, another view) measures again.
    autofitColumnWidthsPt(
      base,
      300,
      autofitContextOf({ measurer, producer: 'another-pass' }),
      view
    );
    expect(measured).toBeGreaterThan(first);
  });

  test('an empty spacer column with no insets gives its width up', () => {
    const spacer = table('', run('ABCDEFGHIJ')).replace(`<w:p>${run('ab')}</w:p>`, '<w:p/>');
    // Slack 59 and 18 pt (each keeps its hairline) give the 30 pt in proportion.
    expect(columns(spacer).widths).toEqual([37.01, 60, 22.99]);
  });

  test('an anchored drawing in a word takes no width', () => {
    const anchored =
      '<w:r><w:drawing><wp:anchor simplePos="0" relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
      '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
      '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
      '<wp:extent cx="127000" cy="127000"/><wp:wrapNone/><wp:docPr id="2" name="a"/></wp:anchor></w:drawing></w:r>';
    const content = `${run('ABCDE')}${anchored}${run('FGHIJ')}`;
    expect(columns(table('', content), { drawings: true }).widths).toEqual([38.18, 60, 21.82]);
  });

  test('a nested word after leading spaces does not widen the outer column it fits', () => {
    // The nested 65pt column holds the 60pt word on its second line, without the 12pt
    // first-line indent, so neither table widens.
    const nested =
      '<w:tbl><w:tblPr><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/>' +
      '</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="1300"/></w:tblGrid>' +
      `<w:tr><w:tc><w:tcPr><w:tcW w:w="1300" w:type="dxa"/></w:tcPr><w:p><w:pPr><w:ind w:firstLine="240"/></w:pPr>${run(' ABCDEFGHIJ')}</w:p></w:tc></w:tr></w:tbl>`;
    const outer =
      '<w:tbl><w:tblPr><w:tblW w:w="4400" w:type="dxa"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/>' +
      '<w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="1540"/><w:gridCol w:w="1320"/><w:gridCol w:w="1540"/></w:tblGrid><w:tr>' +
      `<w:tc><w:tcPr><w:tcW w:w="1540" w:type="dxa"/></w:tcPr><w:p>${run('ab')}</w:p></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="1320" w:type="dxa"/></w:tcPr>${nested}<w:p/></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="1540" w:type="dxa"/></w:tcPr><w:p>${run('cd')}</w:p></w:tc>` +
      '</w:tr></w:tbl>';
    expect(columns(outer, { compatibilityMode: 15 }).widths[1]).toBe(66);
  });

  test('a nested autofit table passes its own word minimum to the outer column', () => {
    const nested =
      '<w:tbl><w:tblPr><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/>' +
      '</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="600"/></w:tblGrid>' +
      `<w:tr><w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/></w:tcPr><w:p>${run('ABCDEFGHIJ')}</w:p></w:tc></w:tr></w:tbl>`;
    const outer =
      '<w:tbl><w:tblPr><w:tblW w:w="2400" w:type="dxa"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/>' +
      '<w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="600"/><w:gridCol w:w="1800"/></w:tblGrid><w:tr>' +
      `<w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/></w:tcPr>${nested}<w:p/></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="1800" w:type="dxa"/></w:tcPr><w:p>${run('ab')}</w:p></w:tc>` +
      '</w:tr></w:tbl>';
    expect(columns(outer).widths[0]).toBe(60);
  });

  test('spaces that open a paragraph break before its first word', () => {
    // The spaces end the first line, so the column holds only the word, on the second.
    const lead = columns(table('', run('  ABCDEFGHIJ')));
    expect(lead.widths[1]).toBe(60);
    expect(lead.lines[1]).toBe(2);
    // The first-line indent stays on the line the spaces end.
    const indented = `<w:pPr><w:ind w:firstLine="240"/></w:pPr>${run('  ABCDEFGHIJ')}`;
    expect(columns(table('', indented)).widths[1]).toBe(60);
    // A left indent applies to every line, so it still counts.
    const left = `<w:pPr><w:ind w:left="240"/></w:pPr>${run('  ABCDEFGHIJ')}`;
    expect(columns(table('', left)).widths[1]).toBe(72);
  });

  test('an unwrapped cell holds its column at its preferred width', () => {
    // `w:noWrap` keeps the first column at its 60pt preferred width; the wide word in the
    // second column takes its room from the third column alone, and the first still wraps.
    const unwrapped = (noWrap: string) =>
      '<w:tbl><w:tblPr><w:tblW w:w="2400" w:type="dxa"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/>' +
      '<w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="1200"/><w:gridCol w:w="600"/><w:gridCol w:w="600"/></w:tblGrid><w:tr>' +
      `<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/>${noWrap}</w:tcPr><w:p>${run('ab cd ef gh ij kl')}</w:p></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/></w:tcPr><w:p>${run('ABCDEFGHIJ')}</w:p></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/></w:tcPr><w:p>${run('cd')}</w:p></w:tc>` +
      '</w:tr></w:tbl>';
    expect(columns(unwrapped('')).widths).toEqual([38.18, 60, 21.82]);
    const held = columns(unwrapped('<w:noWrap/>'));
    expect(held.widths).toEqual([60, 60, 12]);
    expect(held.lines[0]).toBe(2);
    // An off value is no `w:noWrap` at all.
    expect(columns(unwrapped('<w:noWrap w:val="0"/>')).widths).toEqual([38.18, 60, 21.82]);
  });

  test('unwrapped cells wider than the text column share it', () => {
    // Three 120pt cells hold 360pt in a 300pt text column: each gives up the same share.
    const cell = `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/><w:noWrap/></w:tcPr><w:p>${run('ab')}</w:p></w:tc>`;
    const wide =
      '<w:tbl><w:tblPr><w:tblW w:w="2400" w:type="dxa"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/>' +
      '<w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="800"/><w:gridCol w:w="800"/><w:gridCol w:w="800"/></w:tblGrid>' +
      `<w:tr>${cell}${cell}${cell}</w:tr></w:tbl>`;
    expect(columns(wide).widths).toEqual([100, 100, 100]);
  });

  test('a table wider than its text column grows to hold its cells instead of sharing it', () => {
    // A 350pt table in the 300pt text column: the three held 120pt cells keep their widths and
    // the table grows to 360pt; without them the 240pt grid stretches to the table's 350pt.
    const table = (tcPr: string, grid: number) =>
      '<w:tbl><w:tblPr><w:tblW w:w="7000" w:type="dxa"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/>' +
      '<w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>' +
      `<w:gridCol w:w="${grid}"/>`.repeat(3) +
      '</w:tblGrid><w:tr>' +
      `<w:tc><w:tcPr>${tcPr}</w:tcPr><w:p>${run('ab')}</w:p></w:tc>`.repeat(3) +
      '</w:tr></w:tbl>';
    expect(columns(table('<w:tcW w:w="2400" w:type="dxa"/><w:noWrap/>', 2400)).widths).toEqual([
      120, 120, 120,
    ]);
    const stretched = columns(table('', 1600)).widths;
    expect(stretched.reduce((sum, width) => sum + width, 0)).toBeCloseTo(350, 1);
  });

  test('an empty grid band gains no width when the table scales down', () => {
    const banded =
      '<w:tbl><w:tblPr><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/>' +
      '</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="0"/><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>' +
      '<w:tr><w:trPr><w:gridBefore w:val="1"/></w:trPr>' +
      `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr><w:p>${run('A'.repeat(30))}</w:p></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr><w:p>${run('B'.repeat(30))}</w:p></w:tc>` +
      '</w:tr></w:tbl>';
    // The band keeps the hairline the grid reader gives it; it gains nothing from scaling.
    const { widths, box } = columns(banded);
    expect(widths[0]).toBe(widths[1]!);
    expect(box.width).toBeCloseTo(300, 6);
    expect(300 - widths[0]! - widths[1]!).toBeLessThanOrEqual(1);
  });

  test('an empty zero-inset column keeps a hairline when the minimums overflow', () => {
    const crowded =
      '<w:tbl><w:tblPr><w:tblW w:w="2400" w:type="dxa"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/>' +
      '<w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="800"/><w:gridCol w:w="800"/><w:gridCol w:w="800"/></w:tblGrid><w:tr>' +
      `<w:tc><w:tcPr><w:tcW w:w="800" w:type="dxa"/></w:tcPr><w:p>${run('A'.repeat(30))}</w:p></w:tc>` +
      '<w:tc><w:tcPr><w:tcW w:w="800" w:type="dxa"/></w:tcPr><w:p/></w:tc>' +
      `<w:tc><w:tcPr><w:tcW w:w="800" w:type="dxa"/></w:tcPr><w:p>${run('B'.repeat(30))}</w:p></w:tc>` +
      '</w:tr></w:tbl>';
    const { widths, box } = columns(crowded);
    expect(widths[1]).toBeGreaterThan(0.5);
    expect(widths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(box.width, 6);
  });

  test('a nested percentage table resolves against its cell, not the page', () => {
    const nested =
      '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="300"/><w:gridCol w:w="300"/></w:tblGrid>' +
      `<w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p>${run('ab')}</w:p></w:tc></w:tr></w:tbl>`;
    const outer =
      '<w:tbl><w:tblPr><w:tblW w:w="2400" w:type="dxa"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/>' +
      '<w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="600"/><w:gridCol w:w="1800"/></w:tblGrid><w:tr>' +
      `<w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/></w:tcPr>${nested}<w:p/></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="1800" w:type="dxa"/></w:tcPr><w:p>${run('cd')}</w:p></w:tc>` +
      '</w:tr></w:tbl>';
    expect(columns(outer).widths).toEqual([30, 90]);
  });

  test('a word nested past the nesting limit sets no minimum', () => {
    let inner = `<w:p>${run('ABCDEFGHIJ')}</w:p>`;
    for (let level = 0; level < 30; level += 1)
      inner =
        '<w:tbl><w:tblPr><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/>' +
        '</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="600"/></w:tblGrid>' +
        `<w:tr><w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/></w:tcPr>${inner}<w:p/></w:tc></w:tr></w:tbl>`;
    const outer =
      '<w:tbl><w:tblPr><w:tblW w:w="2400" w:type="dxa"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/>' +
      '<w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="600"/><w:gridCol w:w="1800"/></w:tblGrid><w:tr>' +
      `<w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/></w:tcPr>${inner}<w:p/></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="1800" w:type="dxa"/></w:tcPr><w:p>${run('cd')}</w:p></w:tc>` +
      '</w:tr></w:tbl>';
    expect(columns(outer).widths).toEqual([30, 90]);
  });

  test('spaces after a tab do not count toward the next word', () => {
    const tabbed = `<w:r><w:tab/></w:r>${run('      ABCDEFGHIJ')}`;
    expect(columns(table('', tabbed)).widths[1]).toBe(60);
  });

  test('a word that widens a ruled table stays whole when the rules move', () => {
    const ruled = (letters: number) =>
      '<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="8"/><w:left w:val="single" w:sz="8"/>' +
      '<w:bottom w:val="single" w:sz="8"/><w:right w:val="single" w:sz="8"/>' +
      '<w:insideH w:val="single" w:sz="8"/><w:insideV w:val="single" w:sz="8"/></w:tblBorders>' +
      '<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="1200"/><w:gridCol w:w="600"/><w:gridCol w:w="600"/></w:tblGrid><w:tr>' +
      `<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/></w:tcPr><w:p>${run('ab')}</w:p></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/></w:tcPr><w:p>${run('A'.repeat(letters))}</w:p></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/></w:tcPr><w:p>${run('cd')}</w:p></w:tc>` +
      '</w:tr></w:tbl>';
    for (const letters of [20, 35, 38, 40])
      expect(columns(ruled(letters), { compatibilityMode: 15 }).lines[1]).toBe(1);
  });

  test('a run ending in an em space ends its word', () => {
    const spaced = `${run('ABCDEFGHIJ\u2003')}<w:r><w:rPr><w:b/></w:rPr><w:t>KLMNOPQRST</w:t></w:r>`;
    expect(columns(table('', spaced)).widths[1]).toBeLessThan(70);
  });

  test('a word that already fits its ruled cell does not widen the column', () => {
    const ruled =
      '<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="8"/><w:left w:val="single" w:sz="8"/>' +
      '<w:bottom w:val="single" w:sz="8"/><w:right w:val="single" w:sz="8"/>' +
      '<w:insideH w:val="single" w:sz="8"/><w:insideV w:val="single" w:sz="8"/></w:tblBorders>' +
      '<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="1200"/><w:gridCol w:w="510"/><w:gridCol w:w="600"/></w:tblGrid><w:tr>' +
      `<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/></w:tcPr><w:p>${run('ab')}</w:p></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="510" w:type="dxa"/></w:tcPr><w:p>${run('ABCD')}</w:p></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/></w:tcPr><w:p>${run('cd')}</w:p></w:tc>` +
      '</w:tr></w:tbl>';
    const fragment = columns(ruled, { compatibilityMode: 15 });
    expect(fragment.widths[1]).toBeCloseTo(25.5, 6);
    expect(fragment.lines[1]).toBe(1);
  });

  test('a run that opens with an em space starts a new word', () => {
    const spaced = `${run('ABCDE')}<w:r><w:rPr><w:b/></w:rPr><w:t>\u2003FGHIJ</w:t></w:r>`;
    expect(columns(table('', spaced)).widths[1]).toBe(36);
  });

  test('a centered nested table does not count its indent', () => {
    const nested =
      '<w:tbl><w:tblPr><w:jc w:val="center"/><w:tblInd w:w="1440" w:type="dxa"/><w:tblCellMar>' +
      '<w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="600"/></w:tblGrid>' +
      `<w:tr><w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/></w:tcPr><w:p>${run('ABCDEFGHIJ')}</w:p></w:tc></w:tr></w:tbl>`;
    const outer =
      '<w:tbl><w:tblPr><w:tblW w:w="2400" w:type="dxa"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/>' +
      '<w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="600"/><w:gridCol w:w="1800"/></w:tblGrid><w:tr>' +
      `<w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/></w:tcPr>${nested}<w:p/></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="1800" w:type="dxa"/></w:tcPr><w:p>${run('ab')}</w:p></w:tc>` +
      '</w:tr></w:tbl>';
    expect(columns(outer).widths[0]).toBe(60);
  });

  test('every word of a ruled table stays whole after another column widens it', () => {
    const ruled =
      '<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="8"/><w:left w:val="single" w:sz="8"/>' +
      '<w:bottom w:val="single" w:sz="8"/><w:right w:val="single" w:sz="8"/>' +
      '<w:insideH w:val="single" w:sz="8"/><w:insideV w:val="single" w:sz="8"/></w:tblBorders>' +
      '<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="510"/><w:gridCol w:w="600"/><w:gridCol w:w="3000"/></w:tblGrid><w:tr>' +
      `<w:tc><w:tcPr><w:tcW w:w="510" w:type="dxa"/></w:tcPr><w:p>${run('ABCD')}</w:p></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/></w:tcPr><w:p>${run('A'.repeat(30))}</w:p></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr><w:p>${run('ab')}</w:p></w:tc>` +
      '</w:tr></w:tbl>';
    expect(columns(ruled, { compatibilityMode: 15 }).lines).toEqual([1, 1, 1]);
  });

  test('a fixed nested table keeps room for its indent', () => {
    const nested =
      '<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/><w:tblInd w:w="400" w:type="dxa"/></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="600"/></w:tblGrid>' +
      `<w:tr><w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/></w:tcPr><w:p>${run('n')}</w:p></w:tc></w:tr></w:tbl>`;
    const outer =
      '<w:tbl><w:tblPr><w:tblW w:w="2400" w:type="dxa"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/>' +
      '<w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="600"/><w:gridCol w:w="1800"/></w:tblGrid><w:tr>' +
      `<w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/></w:tcPr>${nested}<w:p/></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="1800" w:type="dxa"/></w:tcPr><w:p>${run('A'.repeat(14))}</w:p></w:tc>` +
      '</w:tr></w:tbl>';
    // Its 20 pt indent and the content it holds, whatever its stated 30 pt.
    expect(columns(outer).widths[0]).toBeGreaterThan(20 + 6);
    expect(columns(outer).widths[0]).toBeLessThan(50 - 0.01);
  });

  const outerWith = (nested: string, second: string) =>
    '<w:tbl><w:tblPr><w:tblW w:w="2400" w:type="dxa"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/>' +
    '<w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="600"/><w:gridCol w:w="1800"/></w:tblGrid><w:tr>' +
    `<w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/></w:tcPr>${nested}<w:p/></w:tc>` +
    `<w:tc><w:tcPr><w:tcW w:w="1800" w:type="dxa"/></w:tcPr><w:p>${second}</w:p></w:tc>` +
    '</w:tr></w:tbl>';

  test('a wide nested grid does not lock or widen the outer column', () => {
    const nested =
      '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid><w:tr>' +
      `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr><w:p>${run('ab')}</w:p></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr><w:p>${run('cd')}</w:p></w:tc>` +
      '</w:tr></w:tbl>';
    expect(columns(outerWith(nested, run('cd'))).widths).toEqual([30, 90]);
  });

  test('a fixed nested table needs only the content it holds', () => {
    const nested =
      '<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol/></w:tblGrid>' +
      `<w:tr><w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/></w:tcPr><w:p>${run('n')}</w:p></w:tc></w:tr></w:tbl>`;
    const { widths } = columns(outerWith(nested, run('A'.repeat(30))));
    expect(widths[0]).toBeGreaterThanOrEqual(6);
    expect(widths[0]).toBeLessThan(60);
  });

  const halfAndHalf = (nested: string, second: string) =>
    '<w:tbl><w:tblPr><w:tblW w:w="2400" w:type="dxa"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/>' +
    '<w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="1200"/><w:gridCol w:w="1200"/></w:tblGrid><w:tr>' +
    `<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/></w:tcPr>${nested}<w:p/></w:tc>` +
    `<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/></w:tcPr><w:p>${second}</w:p></w:tc>` +
    '</w:tr></w:tbl>';
  const twoCellNested = (properties: string) =>
    `<w:tbl><w:tblPr>${properties}</w:tblPr><w:tblGrid><w:gridCol w:w="600"/><w:gridCol w:w="600"/></w:tblGrid><w:tr>` +
    `<w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/></w:tcPr><w:p>${run('ab')}</w:p></w:tc>` +
    `<w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/></w:tcPr><w:p>${run('cd')}</w:p></w:tc>` +
    '</w:tr></w:tbl>';

  test('a nested autofit table with an absolute width keeps the outer column wide enough', () => {
    const nested = twoCellNested('<w:tblW w:w="1200" w:type="dxa"/>');
    expect(columns(halfAndHalf(nested, run('A'.repeat(15)))).widths[0]).toBeGreaterThanOrEqual(60);
  });

  test('a nested percentage table gives its width up with its cell', () => {
    const nested = twoCellNested('<w:tblW w:w="5000" w:type="pct"/><w:tblLayout w:type="fixed"/>');
    const { box } = columns(halfAndHalf(nested, run('A'.repeat(15))));
    expect(box.width).toBeCloseTo(120, 6);
  });
});
