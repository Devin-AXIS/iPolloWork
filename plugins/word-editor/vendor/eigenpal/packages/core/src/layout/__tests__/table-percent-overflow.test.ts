import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart, type OoxmlElement } from '@docx-editor.dev/core/store';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { BlockFragmentRecord, TableFragmentRecord } from '../semantic-records.ts';
import { readTableStructure, tableOriginX } from '../semantic-table.ts';
import { readPreferredWidth, readTablePreferredWidth } from '../table-widths.ts';
import { elevenPointDefaults } from './fixtures/eleven-point-defaults.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CONTENT_PT = 300;
const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;

interface Shape {
  readonly width?: string;
  readonly jc?: string;
  readonly layout?: string;
  readonly grid?: readonly number[];
  readonly texts?: readonly string[];
  readonly margin?: number;
}

function table({
  width = '7500',
  jc = 'center',
  layout = 'autofit',
  grid = [4500, 4500],
  texts = ['3141592.65 2718281.83', '1414213.56 1732050.80'],
  margin = 0,
}: Shape = {}) {
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="${width}" w:type="pct"/>` +
    (jc ? `<w:jc w:val="${jc}"/>` : '') +
    `<w:tblLayout w:type="${layout}"/><w:tblCellMar><w:left w:w="${margin}" w:type="dxa"/>` +
    `<w:right w:w="${margin}" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>` +
    grid.map((twips) => `<w:gridCol w:w="${twips}"/>`).join('') +
    '</w:tblGrid><w:tr>' +
    grid
      .map(
        (twips, index) =>
          `<w:tc><w:tcPr><w:tcW w:w="${twips}" w:type="dxa"/></w:tcPr>` +
          `<w:p>${run(texts[index] ?? '')}</w:p></w:tc>`
      )
      .join('') +
    '</w:tr></w:tbl>'
  );
}

const measurer = createFixedMeasurer(6, 12);
const isTable = (block: BlockFragmentRecord): block is TableFragmentRecord =>
  block.kind === 'table';

function shape(fragment: TableFragmentRecord) {
  const cells = fragment.rows[0]!.cells;
  return {
    x: fragment.box.x,
    width: cells.reduce((sum, cell) => sum + cell.box.width, 0),
    widths: cells.map((cell) => Math.round(cell.box.width * 100) / 100),
    lines: cells.map(
      (cell) =>
        cell.blocks.flatMap((block) => (block.kind === 'paragraph' ? block.lines : [])).length
    ),
  };
}

function layOut(body: string, compatibilityMode: number | undefined) {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  const result = layoutSemanticDocument(read.part, 1, {
    measurer,
    styleCascade: elevenPointDefaults(),
    compatibilityMode,
    geometry: { width: CONTENT_PT, height: 400, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
  });
  const fragment = result.pages[0]!.fragments.find(isTable)!;
  return { ...shape(fragment), fragment };
}

function tblW(attributes: string): OoxmlElement {
  const read = readOoxmlPart(`<w:tblW xmlns:w="${W}" ${attributes}/>`, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  return read.part.root;
}

describe('a table percentage above 100 extends the table past the text column', () => {
  test('a centered AutoFit table keeps its width and its numbers on one line', () => {
    const table150 = layOut(table(), 15);
    expect(table150.width).toBeCloseTo(450, 6);
    expect(table150.x).toBeCloseTo(-75, 6);
    expect(table150.lines).toEqual([1, 1]);
  });

  test('left, right and unstated alignment place the wider table at their edge', () => {
    expect(layOut(table({ jc: 'left' }), 15).x).toBeCloseTo(0, 6);
    expect(layOut(table({ jc: '' }), 15).x).toBeCloseTo(0, 6);
    expect(layOut(table({ jc: 'right' }), 15).x).toBeCloseTo(-150, 6);
  });

  test('the percentage, not the grid, sets the width of AutoFit and fixed tables', () => {
    for (const layout of ['autofit', 'fixed']) {
      for (const grid of [
        [3000, 3000],
        [6000, 6000],
      ]) {
        const resolved = layOut(table({ width: '6000', layout, grid }), 15);
        expect(resolved.width).toBeCloseTo(360, 6);
        expect(resolved.widths).toEqual([180, 180]);
      }
    }
  });

  test('an unbroken word widens its column inside the stated width', () => {
    const resolved = layOut(table({ texts: ['x'.repeat(50), 'y'] }), 15);
    expect(resolved.width).toBeCloseTo(450, 6);
    expect(resolved.widths).toEqual([300, 150]);
  });

  for (const mode of [undefined, 11, 12, 14]) {
    test(`mode ${mode} measures the percentage against the content-aligned reference box`, () => {
      // The 300 pt text column plus two 5.4 pt outer cell margins, at 120%.
      const target = (CONTENT_PT + 10.8) * 1.2;
      const twips = Math.round(target * 20);
      const grid = [Math.floor(twips / 2), Math.ceil(twips / 2)];
      const resolved = layOut(table({ width: '6000', grid, margin: 108 }), mode);
      expect(resolved.width).toBeCloseTo(target, 1);
      expect(resolved.x).toBeCloseTo((CONTENT_PT - target) / 2, 1);
      expect(resolved.lines).toEqual([1, 1]);
    });
  }

  test('mode 15 measures the percentage against the text column alone', () => {
    // Authored outer cell margins do not widen the reference box.
    const grid = [3600, 3600];
    const resolved = layOut(table({ width: '6000', grid, margin: 108 }), 15);
    expect(resolved.width).toBeCloseTo(360, 6);
    expect(resolved.x).toBeCloseTo(-30, 6);
  });

  test('a nested AutoFit or fixed table extends past the cell that holds it', () => {
    const outer = (layout: string) =>
      '<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/><w:tblLayout w:type="fixed"/>' +
      '<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>' +
      '</w:tblPr><w:tblGrid><w:gridCol w:w="6000"/></w:tblGrid><w:tr><w:tc><w:tcPr>' +
      `<w:tcW w:w="6000" w:type="dxa"/></w:tcPr>${table({ layout })}<w:p/></w:tc></w:tr></w:tbl>`;
    for (const layout of ['autofit', 'fixed']) {
      const cell = layOut(outer(layout), 15).fragment.rows[0]!.cells[0]!;
      const nested = shape(cell.blocks.find(isTable)!);
      expect(nested.width).toBeCloseTo(450, 6);
      expect(nested.lines).toEqual([1, 1]);
    }
  });

  test('a right-to-left table extends from its leading edge', () => {
    const rtl = (jc: string) => table({ jc }).replace('<w:tblPr>', '<w:tblPr><w:bidiVisual/>');
    const leading = layOut(rtl(''), 15);
    expect(leading.width).toBeCloseTo(450, 6);
    expect(leading.x).toBeCloseTo(-150, 6);
    expect(layOut(rtl('center'), 15).x).toBeCloseTo(-75, 6);
  });

  test('a header table extends past the text column', () => {
    const part = readOoxmlPart(`<w:hdr xmlns:w="${W}">${table()}<w:p/></w:hdr>`, {
      name: '/word/header1.xml',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml',
    });
    if (!part.ok) throw new Error(part.reason);
    const story = layoutHeaderFooterStory(
      part.part,
      CONTENT_PT,
      measurer,
      'test',
      undefined,
      elevenPointDefaults(),
      // Page context, tabs, revision display, drawings and properties keep their defaults.
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { compatibilityMode: 15 }
    );
    const header = shape(story.fragments.find(isTable)!);
    expect(header.width).toBeCloseTo(450, 6);
    expect(header.x).toBeCloseTo(-75, 6);
    expect(header.lines).toEqual([1, 1]);
  });

  test('the percentage stays within its stated range', () => {
    expect(readTablePreferredWidth(tblW('w:w="32767" w:type="pct"'))).toEqual({
      type: 'pct',
      value: 655.34,
    });
    expect(readTablePreferredWidth(tblW('w:w="120%" w:type="pct"'))).toEqual({
      type: 'pct',
      value: 120,
    });
    const read = (width: string) => readTablePreferredWidth(tblW(`w:w="${width}" w:type="pct"`));
    // A bare count is 16 bits wide: it wraps, and past the signed range it states no width.
    for (const width of ['32768', '40000', '65535', '65536'])
      expect(read(width)).toEqual({ type: 'auto', value: 0 });
    expect(read('70000')).toEqual({ type: 'pct', value: 89.28 });
    // A stated percentage past the range lays the table out at its narrowest.
    for (const width of ['656%', '700%']) expect(read(width)).toEqual({ type: 'pct', value: 0.02 });
    // A cell's share of its table keeps the 100% limit.
    expect(readPreferredWidth(tblW('w:w="6000" w:type="pct"'))).toEqual({
      type: 'pct',
      value: 100,
    });
  });
});

describe('a grid-confirmed legacy table above 100%', () => {
  const legacy = (width = '5500', grid = '2438', alignment = 'center') =>
    `<w:tbl><w:tblPr><w:tblW w:type="pct" w:w="${width}"/><w:jc w:val="${alignment}"/>` +
    '<w:tblInd w:w="0" w:type="dxa"/><w:tblLayout w:type="autofit"/><w:tblCellMar><w:left w:type="dxa" w:w="108"/>' +
    '<w:right w:type="dxa" w:w="108"/></w:tblCellMar></w:tblPr>' +
    `<w:tblGrid><w:gridCol w:w="${grid}"/></w:tblGrid><w:tr><w:tc><w:tcPr>` +
    '<w:tcW w:type="pct" w:w="5000"/></w:tcPr><w:p>' +
    run('314159.26') +
    '</w:p></w:tc></w:tr></w:tbl>';
  const structure = (xml: string, mode = 14) => {
    const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${xml}</w:body></w:document>`, {
      name: '/word/document.xml',
      contentType: 'application/xml',
    });
    if (!read.ok) throw new Error(read.reason);
    const body = read.part.root.children.find(
      (node) => node.kind !== 'textValue' && node.localName === 'body'
    ) as OoxmlElement;
    const before = serializeOoxmlPart(read.part);
    const table = body.children.find((node) => node.kind === 'table')!;
    const result = readTableStructure(table, 100, 0, undefined, 'all-markup', undefined, mode)!;
    expect(serializeOoxmlPart(read.part)).toBe(before);
    return result;
  };

  for (const mode of [11, 12, 14]) {
    test(`mode ${mode} keeps the grid and the source width preference`, () => {
      const table = structure(legacy(), mode);
      expect(table.legacyContentAlignment).toBe(true);
      expect(table.columnWidthsPt[0]).toBeCloseTo(121.9, 1);
      expect(tableOriginX(table, 100)).toBeCloseTo(-10.95, 1);
      expect(table.tableWidth).toEqual({ type: 'pct', value: 110 });
    });
  }

  test('the reference box does not depend on the authored grid', () => {
    for (const grid of ['2309', '2308', '1200', '4000']) {
      const table = structure(legacy('5209', grid));
      expect(table.legacyContentAlignment).toBe(true);
      expect(table.columnWidthsPt[0]).toBeCloseTo(115.4, 1);
    }
  });

  test('a left-aligned table aligns its content with the text column', () => {
    const table = structure(legacy('12500', '5540', 'left'));
    expect(table.legacyContentAlignment).toBe(true);
    expect(tableOriginX(table, 100)).toBeCloseTo(-5.4, 8);
  });
});
