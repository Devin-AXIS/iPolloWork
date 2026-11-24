import { hasFloatingTables } from '../table-float-exclusion.ts';
import { paragraphDocumentOrderOf } from '../paragraph-document-order.ts';
import { positionedTableAnchors } from '../table-float-position.ts';
import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlElement,
} from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { hitTestPage } from '../semantic-hit-test.ts';
import { readTableStructure, tableOriginX } from '../semantic-table.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const properties =
  '<w:tblW w:type="pct" w:w="5000"/>' +
  '<w:tblLayout w:type="autofit"/><w:tblInd w:type="dxa" w:w="0"/>';
const grid = '<w:tblGrid><w:gridCol w:w="910"/><w:gridCol w:w="3306"/></w:tblGrid>';
const cell = (width: number, text: string, extra = '') =>
  `<w:tc><w:tcPr><w:tcW w:type="pct" w:w="${width}"/>${extra}</w:tcPr>` +
  `<w:p><w:r><w:rPr><w:sz w:val="21"/></w:rPr><w:t>${text}</w:t></w:r></w:p></w:tc>`;
const row = `<w:tr>${cell(1000, '2468.13')}${cell(3500, 'x')}</w:tr>`;
// These grid controls use the traditional authored 108-twip table margins.
// An omitted margin has a separate, smaller application fallback.
const traditionalMargins =
  '<w:tblCellMar><w:left w:type="dxa" w:w="108"/><w:right w:type="dxa" w:w="108"/></w:tblCellMar>';
const fixture = (pr = properties, columns = grid, rows = row) =>
  `<w:tbl><w:tblPr>${pr}${pr.includes('tblCellMar') ? '' : traditionalMargins}</w:tblPr>${columns}${rows}</w:tbl>`;

function open(body = fixture()) {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:foreign="urn:not-word"><w:body>${body}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  const node = result.part.root.children.find(
    (item) => item.kind !== 'textValue' && item.localName === 'body'
  );
  const table = (node as OoxmlElement).children.find((item) => item.kind === 'table')!;
  return { part: result.part, table };
}

function read(xml = fixture(), mode: number | undefined = 11, depth = 0, width = 200) {
  return readTableStructure(
    open(xml).table,
    width,
    depth,
    undefined,
    'all-markup',
    undefined,
    mode
  )!;
}

describe('explicit legacy full-width content alignment', () => {
  for (const mode of [11, 12, 14]) {
    test(`mode ${mode} uses the grid-confirmed outer margins without rewriting preferences`, () => {
      const { part, table } = open();
      const before = serializeOoxmlPart(part);
      const structure = readTableStructure(
        table,
        200,
        0,
        undefined,
        'all-markup',
        undefined,
        mode
      )!;
      expect(structure.legacyContentAlignment).toBe(true);
      expect(structure.columnWidthsPt[0]).toBeCloseTo(45.5, 8);
      expect(structure.columnWidthsPt[1]).toBeCloseTo(165.3, 8);
      expect(tableOriginX(structure, 200)).toBeCloseTo(-5.4, 8);
      expect(structure.tableWidth).toEqual({ type: 'pct', value: 100 });
      expect(structure.layoutFixed).toBe(false);
      expect(structure.rows[0]!.cells[0]!.preferredWidth).toEqual({ type: 'pct', value: 20 });
      expect(serializeOoxmlPart(part)).toBe(before);
    });
  }

  test('the same immutable table cannot reuse geometry after a mode-only change', () => {
    const { table } = open();
    const structure = (mode?: number) =>
      readTableStructure(table, 200, 0, undefined, 'all-markup', undefined, mode)!;
    const legacy = structure(14);
    expect(structure(14)).toBe(legacy);
    for (const mode of [15, 0, 13, 99, NaN, Infinity]) {
      const modern = structure(mode);
      expect(modern.legacyContentAlignment).toBeUndefined();
      expect(modern.columnWidthsPt.reduce((a, b) => a + b, 0)).toBeCloseTo(200, 8);
      expect(tableOriginX(modern, 200)).toBe(0);
      expect(structure(14).columnWidthsPt[0]).toBeCloseTo(45.5, 8);
    }
  });

  // The reference box holds for every alignment, indent, layout and direction, whatever the
  // authored grid states; the grid only reconciles fiftieth-percent rounding when it agrees.
  const referenceShapes: [string, string][] = [
    ['fixed', fixture(properties.replace('autofit', 'fixed'))],
    [
      'automatic width',
      fixture(properties.replace('type="pct" w:w="5000"', 'type="auto" w:w="0"')),
    ],
    ['partial width', fixture(properties.replace('w:w="5000"', 'w:w="4500"'))],
    ['wrapped oversized percentage', fixture(properties.replace('w:w="5000"', 'w:w="999999"'))],
    ['positive indent', fixture(properties.replace('type="dxa" w:w="0"', 'type="dxa" w:w="120"'))],
    ['negative indent', fixture(properties.replace('type="dxa" w:w="0"', 'type="dxa" w:w="-120"'))],
    ['right', fixture(properties + '<w:jc w:val="right"/>')],
    ['RTL', fixture(properties + '<w:bidiVisual/>')],
    ['missing grid', fixture(properties, '')],
    ['different grid total', fixture(properties, grid.replace('3306', '3106'))],
    ['zero column', fixture(properties, grid.replace('910', '0'))],
    ['unbounded column', fixture(properties, grid.replace('910', '999999999'))],
    ['foreign grid attribute', fixture(properties, grid.replace('w:w="910"', 'foreign:w="910"'))],
  ];
  for (const [name, xml] of referenceShapes) {
    test(`${name} uses the content-aligned reference box`, () => {
      const structure = read(xml);
      expect(structure.legacyContentAlignment).toBe(true);
      expect(structure.columnWidthsPt.every((width) => Number.isFinite(width) && width > 0)).toBe(
        true
      );
    });
  }

  const controls: [string, string][] = [
    ['invalid alignment', fixture(properties + '<w:jc w:val="typo"/>')],
    ['floating', fixture(properties + '<w:tblpPr w:horzAnchor="text"/>')],
    ['separated cells', fixture(properties + '<w:tblCellSpacing w:type="dxa" w:w="20"/>')],
    ['foreign width element', fixture(properties.replace('w:tblW', 'foreign:tblW'))],
    ['duplicate width', fixture(properties + '<w:tblW w:type="pct" w:w="5000"/>')],
    ['foreign sibling width', fixture(properties + '<foreign:tblW w:type="auto" w:w="0"/>')],
    [
      'duplicate automatic width',
      fixture(
        properties.replace('w:type="pct"', 'w:type="auto"') + '<w:tblW w:type="auto" w:w="0"/>'
      ),
    ],
    [
      'varying outside margins',
      fixture(
        properties,
        grid,
        row +
          `<w:tr>${cell(1000, 'y', '<w:tcMar><w:left w:w="120" w:type="dxa"/></w:tcMar>')}${cell(3500, 'z')}</w:tr>`
      ),
    ],
  ];
  test('a lone short row aligns its content: the columns it leaves take no width', () => {
    const structure = read(fixture(properties, grid, `<w:tr>${cell(1000, 'x')}</w:tr>`));
    expect(structure.legacyContentAlignment).toBe(true);
    expect(structure.columnWidthsPt).toHaveLength(1);
  });
  for (const [name, xml] of controls) {
    test(`${name} stays on the ordinary width path`, () => {
      const structure = read(xml);
      expect(structure.legacyContentAlignment).toBeUndefined();
      expect(structure.columnWidthsPt.every((width) => Number.isFinite(width) && width > 0)).toBe(
        true
      );
    });
  }

  test('nested tables and invalid available widths are not opted in', () => {
    expect(read(fixture(), 11, 1).legacyContentAlignment).toBeUndefined();
    for (const width of [0, -1, NaN, Infinity, 5000]) {
      expect(read(fixture(), 11, 0, width).legacyContentAlignment).toBeUndefined();
    }
  });

  test('authored margins, not a fixed allowance, define the reference box', () => {
    const xml = fixture(
      properties +
        '<w:tblCellMar><w:left w:w="80" w:type="dxa"/>' +
        '<w:right w:w="160" w:type="dxa"/></w:tblCellMar>',
      grid.replace('3306', '3330')
    );
    const structure = read(xml);
    expect(structure.legacyContentAlignment).toBe(true);
    expect(structure.columnWidthsPt.reduce((a, b) => a + b, 0)).toBeCloseTo(212, 8);
    expect(tableOriginX(structure, 200)).toBe(-4);
  });

  test('a wider cell preference still participates in width reconciliation', () => {
    const structure = read(fixture(properties, grid, row.replace('w:w="1000"', 'w:w="2000"')));
    expect(structure.legacyContentAlignment).toBe(true);
    expect(structure.columnWidthsPt[0]).toBeGreaterThan(45.5);
    expect(structure.columnWidthsPt.reduce((a, b) => a + b, 0)).toBeCloseTo(210.8, 8);
  });

  test('rounding a fiftieth-percent preference does not steal width from other columns', () => {
    const columns =
      '<w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="1000"/><w:gridCol w:w="3240"/></w:tblGrid>';
    const margins =
      '<w:tblCellMar><w:left w:w="120" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar>';
    const rows = `<w:tr>${cell(1603, 'x')}${cell(801, 'y')}${cell(2596, 'z')}</w:tr>`;
    const legacy = read(fixture(properties + margins, columns, rows), 11, 0, 300);
    expect(legacy.columnWidthsPt).toEqual([100, 50, 162]);
    expect(legacy.rows[0]!.cells[0]!.preferredWidth).toEqual({ type: 'pct', value: 32.06 });
    const modern = read(fixture(properties + margins, columns, rows), 15, 0, 300);
    expect(modern.columnWidthsPt.reduce((a, b) => a + b, 0)).toBeCloseTo(300, 8);
    const wider = read(
      fixture(properties + margins, columns, rows.replace('1603', '1610')),
      11,
      0,
      300
    );
    expect(wider.columnWidthsPt[0]).toBeGreaterThan(100);
    const precise = read(
      fixture(properties + margins, columns, rows.replace('w:w="1603"', 'w:w="32.061%"')),
      11,
      0,
      300
    );
    expect(precise.columnWidthsPt[0]).toBeGreaterThan(100);
  });

  for (const margin of [
    '<foreign:left w:w="1000" w:type="dxa"/>',
    '<w:left foreign:w="1000" w:type="dxa"/>',
    '<w:left w:w="1000" w:type="pct"/>',
    '<w:left w:w="1000" w:type="auto"/>',
    '<w:left w:w="1000" foreign:type="dxa"/>',
    '<w:left w:w="1000" w:type="dxa"/><w:start w:w="1000" w:type="dxa"/>',
  ]) {
    test(`unsupported margin cannot supply negative-origin evidence: ${margin}`, () => {
      const columns = grid.replace('3306', '4198');
      const tableMargin = fixture(properties + `<w:tblCellMar>${margin}</w:tblCellMar>`, columns);
      expect(read(tableMargin).legacyContentAlignment).toBeUndefined();
      const cells = `<w:tr>${cell(1000, 'x', `<w:tcMar>${margin}</w:tcMar>`)}${cell(3500, 'y')}</w:tr>`;
      expect(read(fixture(properties, columns, cells)).legacyContentAlignment).toBeUndefined();
    });
  }

  test('pagination, text and hit testing share the shifted grid', () => {
    const { part } = open(fixture(properties, grid, row.repeat(30)));
    const result = layoutSemanticDocument(part, 0, {
      compatibilityMode: 11,
      measurer: createFixedMeasurer(4.9, 15.6),
      geometry: { width: 344, height: 120, margin: { left: 72, right: 72, top: 10, bottom: 10 } },
    });
    expect(result.pages.length).toBeGreaterThan(1);
    let seenRows = 0;
    for (const page of result.pages) {
      for (const table of page.fragments) {
        if (table.kind !== 'table') continue;
        expect(table.box.x).toBeCloseTo(-5.4, 8);
        expect(table.box.width).toBeCloseTo(210.8, 8);
        expect(table.columnEdges[1]).toBeCloseTo(45.5, 8);
        for (const row of table.rows) {
          seenRows += 1;
          const first = row.cells[0]!;
          expect(first.box.x).toBeCloseTo(-5.4, 8);
          const paragraph = first.blocks[0]!;
          expect(paragraph.kind).toBe('paragraph');
          if (paragraph.kind !== 'paragraph') throw new Error('missing paragraph');
          expect(paragraph.lines).toHaveLength(1);
          const line = paragraph.lines[0]!;
          expect(line.spans.map((span) => span.text).join('')).toBe('2468.13');
          expect(line.spans[0]!.box.x).toBeCloseTo(0, 8);
          const hit = hitTestPage(result, page.index, {
            x: line.spans[0]!.box.x + 1,
            y: line.box.y + line.box.height / 2,
          });
          expect(hit?.position.paragraphId).toBe(paragraph.id.replace(/#f\d+$/, ''));
        }
      }
    }
    expect(seenRows).toBe(30);
  });
});

test('document-order and float-anchor probes retain the same table memo in explicit modes', () => {
  for (const mode of [14, 15]) {
    const { table } = open();
    const blocks = [{ kind: 'table' as const, table, key: 'table' }];
    const first = readTableStructure(table, 200, 0, undefined, 'all-markup', undefined, mode);
    hasFloatingTables([table], 200, undefined, 'all-markup', undefined, mode);
    paragraphDocumentOrderOf(blocks, 200, undefined, 'all-markup', undefined, mode);
    positionedTableAnchors(blocks, 200, undefined, 'all-markup', undefined, mode);
    expect(readTableStructure(table, 200, 0, undefined, 'all-markup', undefined, mode)).toBe(first);
  }
});

test('implicit legacy defaults and centered percentages use a grid-confirmed margin basis', () => {
  for (const alignment of ['left', 'center']) {
    for (const pct of [70, 100]) {
      const totalTwips = Math.round(((210.8 * pct) / 100) * 20);
      // A stated zero indent: without it, and without a table style, a left table's outer edge
      // (not its content) meets the text edge.
      const xml = fixture(
        `<w:tblW w:type="pct" w:w="${pct * 50}"/><w:jc w:val="${alignment}"/><w:tblInd w:w="0" w:type="dxa"/>`,
        `<w:tblGrid><w:gridCol w:w="${Math.floor(totalTwips / 2)}"/><w:gridCol w:w="${totalTwips - Math.floor(totalTwips / 2)}"/></w:tblGrid>`,
        `<w:tr>${cell(2500, 'one')}${cell(2500, 'two')}</w:tr>`
      );
      const { table, part } = open(xml);
      const before = serializeOoxmlPart(part);
      const legacy = readTableStructure(table, 200, 0)!;
      const width = legacy.columnWidthsPt.reduce((a, b) => a + b, 0);
      expect(legacy.legacyContentAlignment).toBe(true);
      expect(width).toBeCloseTo((210.8 * pct) / 100, 6);
      expect(tableOriginX(legacy, 200)).toBeCloseTo(
        alignment === 'left' ? -5.4 : (200 - width) / 2,
        6
      );
      const modern = readTableStructure(table, 200, 0, undefined, 'all-markup', undefined, 15)!;
      expect(modern.legacyContentAlignment).toBeUndefined();
      expect(modern.columnWidthsPt.reduce((a, b) => a + b, 0)).toBeCloseTo((200 * pct) / 100, 6);
      expect(serializeOoxmlPart(part)).toBe(before);
    }
  }
});
