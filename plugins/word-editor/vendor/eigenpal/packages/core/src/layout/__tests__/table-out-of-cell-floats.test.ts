import { describe, expect, test } from 'bun:test';
import { load, layoutContext, squareAnchorInCell } from './anchored-drawing-test-fixtures.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { TableFragmentRecord } from '../semantic-records.ts';

const measurer = createFixedMeasurer(6, 14);
const TEXT = 'word '.repeat(60);

function layout(options: Parameters<typeof squareAnchorInCell>[0], compatibilityMode: number) {
  const part = load(squareAnchorInCell(options));
  const page = layoutSemanticDocument(part, 1, {
    measurer,
    inlineDrawingLayout: layoutContext(part),
    compatibilityMode,
  }).pages[0]!;
  const table = page.fragments.find((fragment) => fragment.kind === 'table') as
    TableFragmentRecord | undefined;
  expect(table).toBeDefined();
  const drawing = page.anchoredDrawings?.[0];
  expect(drawing).toBeDefined();
  return { table: table!, drawing: drawing! };
}

// Word 16.113, mode 14: a float a cell anchors with `layoutInCell="0"` wraps like a body float.
// It stays where the unpushed table puts it, and the table's rows move below it, whether or
// not they overlap it horizontally. From mode 15 the float is in the cell and nothing moves.
describe('out-of-cell floats push the table rows (mode 14)', () => {
  for (const wrap of ['square', 'topAndBottom'] as const) {
    test(`a ${wrap} float moves the table below it and stays put`, () => {
      const { table, drawing } = layout(
        { text: TEXT, layoutInCell: '0', tableIndent: 2880, wrap },
        14
      );
      expect(drawing.layoutInCell).toBe(false);
      // The float keeps the unpushed table top (y 0, the first paragraph's top).
      expect(drawing.y).toBeCloseTo(0, 3);
      // The table starts below the float's bottom.
      expect(table.box.y).toBeGreaterThanOrEqual(drawing.y + drawing.height - 0.001);
      // Its first line starts at the cell's own inset: nothing inside the cell pushes it.
      const firstLineY = (table.rows[0]!.cells[0]!.blocks[0] as { lines: { box: { y: number } }[] })
        .lines[0]!.box.y;
      expect(firstLineY - table.box.y).toBeLessThan(10);
    });
  }

  test('a behind-text square float moves the table like an in-front one', () => {
    const tableTop = (behindDoc: '0' | '1') => {
      const xml = squareAnchorInCell({
        text: TEXT,
        layoutInCell: '0',
        tableIndent: 2880,
      });
      const part = load(xml.replace('behindDoc="0"', `behindDoc="${behindDoc}"`));
      const page = layoutSemanticDocument(part, 1, {
        measurer,
        inlineDrawingLayout: layoutContext(part),
        compatibilityMode: 14,
      }).pages[0]!;
      expect(page.anchoredDrawings?.[0]?.behindDocument).toBe(behindDoc === '1');
      const table = page.fragments.find((fragment) => fragment.kind === 'table') as
        TableFragmentRecord | undefined;
      expect(table).toBeDefined();
      return table!.box.y;
    };
    expect(tableTop('1')).toBeGreaterThan(0);
    expect(tableTop('1')).toBeCloseTo(tableTop('0'), 3);
  });

  test('an in-cell float in mode 15 moves nothing', () => {
    const { table, drawing } = layout(
      { text: TEXT, layoutInCell: '0', tableIndent: 2880, wrap: 'topAndBottom' },
      15
    );
    expect(drawing.layoutInCell).toBe(true);
    expect(table.box.y).toBeCloseTo(0, 3);
  });

  test('a row ending where a float in the next row begins moves below it too', () => {
    const single = squareAnchorInCell({ text: 'word', layoutInCell: '0', wrap: 'topAndBottom' });
    const anchorRow = single.slice(single.indexOf('<w:tr>'), single.indexOf('</w:tr>') + 7);
    const firstRow =
      '<w:tr><w:tc><w:tcPr><w:tcW w:w="8800" w:type="dxa"/></w:tcPr>' +
      '<w:p><w:r><w:t>row one</w:t></w:r></w:p></w:tc></w:tr>';
    const rules =
      '<w:tblBorders><w:top w:val="single" w:sz="8"/><w:bottom w:val="single" w:sz="8"/>' +
      '<w:insideH w:val="single" w:sz="8"/></w:tblBorders>';
    for (const borders of ['', rules]) {
      const part = load(
        single
          .replace(anchorRow, firstRow + anchorRow)
          .replace('<w:tblLayout w:type="fixed"/>', `${borders}<w:tblLayout w:type="fixed"/>`)
      );
      const page = layoutSemanticDocument(part, 1, {
        measurer,
        inlineDrawingLayout: layoutContext(part),
        compatibilityMode: 14,
      }).pages[0]!;
      const table = page.fragments[0] as TableFragmentRecord;
      const drawing = page.anchoredDrawings![0]!;
      // The float keeps row two's unpushed top, just below row one.
      expect(drawing.y).toBeLessThan(20);
      // Both rows, the first included, start below it.
      expect(table.rows[0]!.box.y).toBeGreaterThanOrEqual(drawing.y + drawing.height - 0.001);
    }
  });

  const withRows = (
    options: Parameters<typeof squareAnchorInCell>[0],
    edit: (xml: string, anchorRow: string) => string
  ) => {
    const single = squareAnchorInCell(options);
    const anchorRow = single.slice(single.indexOf('<w:tr>'), single.indexOf('</w:tr>') + 7);
    const part = load(edit(single, anchorRow));
    return layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
      compatibilityMode: 14,
    });
  };

  test('a header row that touches the float moves below it with the body', () => {
    const header =
      '<w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:tcPr><w:tcW w:w="8800" w:type="dxa"/></w:tcPr>' +
      '<w:p><w:r><w:t>header</w:t></w:r></w:p></w:tc></w:tr>';
    const page = withRows({ text: 'word', layoutInCell: '0', wrap: 'topAndBottom' }, (xml, row) =>
      xml.replace(row, header + row)
    ).pages[0]!;
    const table = page.fragments[0] as TableFragmentRecord;
    const drawing = page.anchoredDrawings![0]!;
    expect(drawing.y).toBeLessThan(20);
    expect(table.rows[0]!.box.y).toBeGreaterThanOrEqual(drawing.y + drawing.height - 0.001);
  });

  test('a row pushed onto the next page takes its float with it', () => {
    const filler = '<w:p><w:r><w:t>line</w:t></w:r></w:p>'.repeat(45);
    const layout = withRows({ text: 'word', layoutInCell: '0', wrap: 'topAndBottom' }, (xml) =>
      xml.replace('<w:body>', `<w:body>${filler}`)
    );
    const drawings = layout.pages.flatMap((page) => page.anchoredDrawings ?? []);
    expect(drawings).toHaveLength(1);
    // Never pinned up off its sheet by a push that the page break superseded.
    expect(drawings[0]!.y).toBeGreaterThanOrEqual(0);
  });

  test('a vertically aligned cell keeps the cell-flow handling', () => {
    const page = withRows(
      { text: TEXT, layoutInCell: '0', wrap: 'topAndBottom', centred: true },
      (xml) => xml
    ).pages[0]!;
    const table = page.fragments[0] as TableFragmentRecord;
    // Not pushed: the table stays at the top, and the cell text still clears the float.
    expect(table.box.y).toBeCloseTo(0, 3);
    const drawing = page.anchoredDrawings![0]!;
    const firstLine = (table.rows[0]!.cells[0]!.blocks[0] as { lines: { box: { y: number } }[] })
      .lines[0]!;
    expect(firstLine.box.y).toBeGreaterThanOrEqual(drawing.y + drawing.height - 0.001);
  });

  test('a repeated header row does not take the first page push', () => {
    const single = squareAnchorInCell({ text: 'word', layoutInCell: '0', wrap: 'topAndBottom' });
    const anchorRow = single.slice(single.indexOf('<w:tr>'), single.indexOf('</w:tr>') + 7);
    const headerRow = anchorRow.replace('<w:tr>', '<w:tr><w:trPr><w:tblHeader/></w:trPr>');
    const bodyRow =
      '<w:tr><w:tc><w:tcPr><w:tcW w:w="8800" w:type="dxa"/></w:tcPr>' +
      '<w:p><w:r><w:t>body</w:t></w:r></w:p></w:tc></w:tr>';
    const part = load(single.replace(anchorRow, headerRow + bodyRow.repeat(80)));
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
      compatibilityMode: 14,
    });
    expect(layout.pages.length).toBeGreaterThan(1);
    const drawings = layout.pages.flatMap((page) => page.anchoredDrawings ?? []);
    expect(drawings.length).toBeGreaterThan(0);
    for (const drawing of drawings) expect(drawing.y).toBeGreaterThanOrEqual(0);
  });

  test('a margin-framed float in a pushed row stays at its margin position', () => {
    const page = withRows(
      { text: 'word', layoutInCell: '0', wrap: 'topAndBottom', verticalFrame: 'margin' },
      (xml, row) =>
        xml.replace(
          row,
          '<w:tr><w:tc><w:tcPr><w:tcW w:w="8800" w:type="dxa"/></w:tcPr>' +
            '<w:p><w:r><w:t>row one</w:t></w:r></w:p></w:tc></w:tr>' +
            row
        )
    ).pages[0]!;
    const drawing = page.anchoredDrawings![0]!;
    // Offset 0 from the top margin: the content top, whatever the rows did.
    expect(drawing.y).toBeCloseTo(0, 3);
    const table = page.fragments[0] as TableFragmentRecord;
    expect(table.rows[0]!.box.y).toBeGreaterThanOrEqual(drawing.y + drawing.height - 0.001);
  });

  const fillerRow =
    '<w:tr><w:tc><w:tcPr><w:tcW w:w="8800" w:type="dxa"/></w:tcPr>' +
    '<w:p><w:r><w:t>filler</w:t></w:r></w:p></w:tc></w:tr>';

  test('a float whose row lands on a later page pushes nothing on this one', () => {
    const layout = withRows(
      { text: 'word', layoutInCell: '0', wrap: 'topAndBottom', verticalFrame: 'margin' },
      (xml, row) => xml.replace(row, fillerRow.repeat(60) + row)
    );
    expect(layout.pages.length).toBeGreaterThan(1);
    const first = layout.pages[0]!.fragments[0] as TableFragmentRecord;
    expect(first.box.y).toBeCloseTo(0, 3);
    expect(layout.pages[0]!.anchoredDrawings ?? []).toHaveLength(0);
  });

  test('a push that sends a later float row to the next page leaves no gap before it', () => {
    const layout = withRows({ text: 'word', layoutInCell: '0', wrap: 'topAndBottom' }, (xml, row) =>
      xml.replace(row, row + fillerRow.repeat(45) + row.replace(/id="1"/g, 'id="2"'))
    );
    const rows = (layout.pages[0]!.fragments[0] as TableFragmentRecord).rows;
    // After row one's own push, the rows run on without another gap.
    for (let index = 2; index < rows.length; index += 1)
      expect(rows[index]!.box.y).toBeCloseTo(
        rows[index - 1]!.box.y + rows[index - 1]!.box.height,
        3
      );
  });

  test('a float whose own push would carry its row off the page leaves no gap', () => {
    const layout = withRows({ text: 'word', layoutInCell: '0', wrap: 'topAndBottom' }, (xml, row) =>
      xml.replace(row, fillerRow.repeat(44) + row + fillerRow.repeat(4))
    );
    const rows = (layout.pages[0]!.fragments[0] as TableFragmentRecord).rows;
    for (let index = 1; index < rows.length; index += 1)
      expect(rows[index]!.box.y).toBeCloseTo(
        rows[index - 1]!.box.y + rows[index - 1]!.box.height,
        3
      );
    const drawings = layout.pages.flatMap((page) => page.anchoredDrawings ?? []);
    expect(drawings).toHaveLength(1);
    expect(drawings[0]!.y).toBeGreaterThanOrEqual(0);
  });

  test('two floats at a row top near the page bottom leave no gap in the rows', () => {
    const layout = withRows(
      { text: 'word', layoutInCell: '0', wrap: 'topAndBottom' },
      (xml, row) => {
        const run = row.slice(
          row.indexOf('<w:r><w:drawing>'),
          row.indexOf('</w:drawing></w:r>') + 18
        );
        // Both floats sit at the row top; the second is taller and overflows the page.
        const lower = run.replace(/id="1"/g, 'id="2"').replace(/cy="914400"/g, 'cy="1397000"');
        return xml.replace(row, fillerRow.repeat(42) + row.replace(run, run + lower));
      }
    );
    const rows = (layout.pages[0]!.fragments[0] as TableFragmentRecord).rows;
    for (let index = 1; index < rows.length; index += 1)
      expect(rows[index]!.box.y).toBeCloseTo(
        rows[index - 1]!.box.y + rows[index - 1]!.box.height,
        3
      );
  });
});
