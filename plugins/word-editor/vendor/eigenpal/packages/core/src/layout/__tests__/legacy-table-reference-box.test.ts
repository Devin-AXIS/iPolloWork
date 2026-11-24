import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement } from '@docx-editor.dev/core/store';
import { readTableStructure, tableOriginX } from '../semantic-table.ts';
import { cellContentInsets } from '../table-cell-geometry.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const TEXT_PT = 144;
const MARGIN_PT = 5.4;
const RULE = '<w:{side} w:val="single" w:sz="4" w:space="0" w:color="000000"/>';

interface Shape {
  readonly width?: string;
  readonly jc?: string;
  /** `null` states no indent at all. */
  readonly indent?: number | null;
  readonly layout?: string;
  readonly grid?: readonly number[];
  readonly rtl?: boolean;
  readonly margins?: boolean;
  readonly rules?: boolean;
}

function tableXml({
  width = '5000',
  jc = '',
  indent = 0,
  layout = 'autofit',
  grid = [1200, 1800],
  rtl = false,
  margins = true,
  rules = false,
}: Shape): string {
  const borders = rules
    ? `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
        .map((side) => RULE.replace('{side}', side))
        .join('')}</w:tblBorders>`
    : '';
  return (
    '<w:tbl><w:tblPr>' +
    (rtl ? '<w:bidiVisual/>' : '') +
    (width === 'auto'
      ? '<w:tblW w:w="0" w:type="auto"/>'
      : `<w:tblW w:w="${width}" w:type="pct"/>`) +
    (jc ? `<w:jc w:val="${jc}"/>` : '') +
    (indent === null ? '' : `<w:tblInd w:w="${indent}" w:type="dxa"/>`) +
    borders +
    `<w:tblLayout w:type="${layout}"/>` +
    (margins
      ? '<w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar>'
      : '') +
    '</w:tblPr><w:tblGrid>' +
    grid.map((twips) => `<w:gridCol w:w="${twips}"/>`).join('') +
    '</w:tblGrid><w:tr>' +
    grid.map(() => '<w:tc><w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc>').join('') +
    '</w:tr></w:tbl>'
  );
}

function read(shape: Shape, mode: number | undefined = 14, depth = 0) {
  return readXml(tableXml(shape), mode, depth);
}

function readXml(xml: string, mode: number | undefined = 14, depth = 0) {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${xml}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  const body = result.part.root.children.find(
    (node) => node.kind !== 'textValue' && node.localName === 'body'
  ) as OoxmlElement;
  const table = body.children.find((node) => node.kind === 'table')!;
  const structure = readTableStructure(
    table,
    TEXT_PT,
    depth,
    undefined,
    'all-markup',
    undefined,
    mode
  )!;
  const width = structure.columnWidthsPt.reduce((sum, column) => sum + column, 0);
  return { structure, width, x: tableOriginX(structure, TEXT_PT) };
}

const box = (percent: number) => (percent / 100) * (TEXT_PT + 2 * MARGIN_PT);

describe('the legacy reference box of a percentage-width table', () => {
  for (const mode of [undefined, 11, 12, 14]) {
    test(`mode ${mode} holds for every alignment and indent`, () => {
      const left = read({ width: '7500', jc: 'left' }, mode);
      expect(left.width).toBeCloseTo(box(150), 6);
      expect(left.x).toBeCloseTo(-MARGIN_PT, 6);
      const indented = read({ width: '7500', jc: 'left', indent: 288 }, mode);
      expect(indented.x).toBeCloseTo(14.4 - MARGIN_PT, 6);
      const right = read({ width: '7500', jc: 'right' }, mode);
      expect(right.x + right.width).toBeCloseTo(TEXT_PT + MARGIN_PT, 6);
      const center = read({ width: '7500', jc: 'center' }, mode);
      expect(center.x).toBeCloseTo((TEXT_PT - box(150)) / 2, 6);
    });
  }

  test('the authored grid and the layout do not change the box', () => {
    for (const layout of ['autofit', 'fixed']) {
      for (const grid of [
        [1200, 1800],
        [600, 900],
        [3000, 4000],
      ]) {
        for (const width of ['2500', '5000', '7500']) {
          const { structure, x, width: total } = read({ width, jc: 'left', layout, grid });
          expect(structure.legacyContentAlignment).toBe(true);
          expect(total).toBeCloseTo(box(Number(width) / 50), 6);
          expect(x).toBeCloseTo(-MARGIN_PT, 6);
        }
      }
    }
  });

  test('a right-to-left table aligns its leading cell with the right text edge', () => {
    const leading = read({ width: '7500', rtl: true });
    expect(leading.width).toBeCloseTo(box(150), 6);
    expect(leading.x + leading.width).toBeCloseTo(TEXT_PT + MARGIN_PT, 6);
    const trailing = read({ width: '7500', rtl: true, jc: 'right' });
    expect(trailing.x).toBeCloseTo(-MARGIN_PT, 6);
  });

  test('a table without a usable width shares the box and fits it after its indent', () => {
    const wide = [2000, 3600];
    for (const width of ['auto', '40000']) {
      const shape = { width, grid: wide, jc: 'left' } as const;
      const left = read(shape);
      expect(left.structure.legacyContentAlignment).toBe(true);
      expect(left.x).toBeCloseTo(-MARGIN_PT, 6);
      expect(left.width).toBeCloseTo(box(100), 6);
      const indented = read({ ...shape, indent: 288 });
      expect(indented.x).toBeCloseTo(14.4 - MARGIN_PT, 6);
      expect(indented.width).toBeCloseTo(box(100) - 14.4, 6);
      const right = read({ ...shape, jc: 'right' });
      expect(right.x + right.width).toBeCloseTo(TEXT_PT + MARGIN_PT, 6);
    }
  });

  test('with neither a table style nor an indent, the outer edge meets the text edge', () => {
    const pct = read({ width: '5000', jc: 'left', indent: null });
    expect(pct.structure.legacyContentAlignment).toBe(true);
    expect(pct.x).toBeCloseTo(0, 6);
    expect(pct.width).toBeCloseTo(box(100), 6);
    const auto = read({ width: 'auto', grid: [2000, 3600], jc: 'left', indent: null });
    expect(auto.x).toBeCloseTo(0, 6);
    expect(auto.width).toBeCloseTo(box(100) - MARGIN_PT, 6);
    // Other alignments, and a stated zero indent, keep the content-aligned edge.
    expect(read({ width: '5000', jc: 'right', indent: null }).x + box(100)).toBeCloseTo(
      TEXT_PT + MARGIN_PT,
      6
    );
    expect(read({ width: '5000', jc: 'left', indent: 0 }).x).toBeCloseTo(-MARGIN_PT, 6);
  });

  test('a fixed table without a width aligns its content once', () => {
    for (const grid of [
      [1200, 1800],
      [2000, 3600],
    ]) {
      const { structure, x } = read({ width: 'auto', grid, jc: 'left', layout: 'fixed' });
      expect(x).toBeCloseTo(-MARGIN_PT, 6);
      const first = structure.rows[0]!.cells[0]!;
      const inset = cellContentInsets(first, true).left;
      // The first cell's text starts on the text edge, not a margin further in or out.
      expect(x + inset).toBeCloseTo(0, 6);
    }
  });

  test('rows with their own table exceptions keep the ordinary geometry', () => {
    const exception = (inner: string) =>
      tableXml({ width: '5000', jc: 'left' }).replace(
        '<w:tr>',
        `<w:tr><w:tblPrEx>${inner}</w:tblPrEx>`
      );
    for (const inner of [
      '<w:tblInd w:w="240" w:type="dxa"/>',
      '<w:tblW w:w="4000" w:type="dxa"/>',
      '<w:tblCellMar><w:left w:w="360" w:type="dxa"/></w:tblCellMar>',
    ]) {
      expect(readXml(exception(inner)).structure.legacyContentAlignment).toBeUndefined();
    }
  });

  test('a table without stated outer margins keeps the ordinary geometry', () => {
    const plain = read({ width: '7500', jc: 'left', margins: false });
    expect(plain.structure.legacyContentAlignment).toBeUndefined();
    expect(plain.x).toBe(0);
  });
});

describe('outside the legacy box, a percentage excludes the mean outer rule', () => {
  // 0.5 pt rules: an outer box of p × (container − 0.5) + 0.5.
  const ruled = (percent: number) => (percent / 100) * (TEXT_PT - 0.5) + 0.5;
  // With one rule width on every cell side the rules share the grid lines, so the grid is the
  // share alone and the outer box adds half a rule on each side.
  const SHARED_RULE_PT = 0.5;

  test('mode 15 tables, from below to far above 100%', () => {
    for (const percent of [50, 100, 150, 300]) {
      const { width } = read({ width: String(percent * 50), rules: true }, 15);
      expect(width + SHARED_RULE_PT).toBeCloseTo(ruled(percent), 6);
    }
  });

  test('nested tables in every mode', () => {
    for (const mode of [11, 14, 15]) {
      const { width } = read({ width: '15000', rules: true }, mode, 1);
      expect(width + SHARED_RULE_PT).toBeCloseTo(ruled(300), 6);
    }
  });

  test('a mode-15 table without a width fits the room its indent leaves', () => {
    const { width, x } = read({ width: 'auto', grid: [2000, 3600], jc: 'left', indent: 288 }, 15);
    expect(x).toBeCloseTo(14.4, 6);
    expect(width).toBeCloseTo(TEXT_PT - 14.4, 6);
  });

  test("the outer cells' own rules replace the table's", () => {
    const cellRule = (xml: string, side: string, value: string) =>
      xml.replace(
        '<w:tc>',
        `<w:tc><w:tcPr><w:tcBorders><w:${side} w:val="${value}" w:sz="4"/></w:tcBorders></w:tcPr>`
      );
    // Table rules hidden by the outer cells: the plain share.
    let xml = tableXml({ width: '15000', rules: true });
    xml = cellRule(xml, 'left', 'nil');
    xml = xml.replace(
      /<w:tc>(?![\s\S]*<w:tc>)/,
      '<w:tc><w:tcPr><w:tcBorders><w:right w:val="nil"/></w:tcBorders></w:tcPr>'
    );
    expect(readXml(xml, 15).width).toBeCloseTo(3 * TEXT_PT, 6);
    // Cell rules without table rules: the rule share.
    let own = tableXml({ width: '15000' });
    own = cellRule(own, 'left', 'single');
    own = own.replace(
      /<w:tc>(?![\s\S]*<w:tc>)/,
      '<w:tc><w:tcPr><w:tcBorders><w:right w:val="single" w:sz="4"/></w:tcBorders></w:tcPr>'
    );
    expect(readXml(own, 15).width).toBeCloseTo(ruled(300), 6);
  });

  test('a right-to-left table reads its visual outer sides', () => {
    for (const rtl of [false, true]) {
      const { width } = read({ width: '15000', rules: true, rtl }, 15);
      expect(width + SHARED_RULE_PT).toBeCloseTo(ruled(300), 6);
    }
  });

  test('a table without side rules keeps the plain share', () => {
    expect(read({ width: '15000' }, 15).width).toBeCloseTo(3 * TEXT_PT, 6);
  });
});
