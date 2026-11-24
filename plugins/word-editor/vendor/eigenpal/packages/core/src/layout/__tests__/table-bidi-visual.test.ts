import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { hitTestPage } from '../semantic-hit-test.ts';
import { readTableStructure } from '../semantic-table.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { findTableInteractionAt, tableInteractionIndex } from '../semantic-table-interaction.ts';
import { tableAnchorAt, tableContextAt, cellSelectionText } from '../semantic-cell-selection.ts';
import type { TableFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const cell = (text: string, properties = '') =>
  `<w:tc><w:tcPr>${properties}</w:tcPr>${p(text)}</w:tc>`;
const row = (cells: string, properties = '') =>
  `<w:tr><w:trPr>${properties}</w:trPr>${cells}</w:tr>`;
const table = (
  rows = row(cell('first') + cell('second') + cell('third')),
  properties = '<w:bidiVisual/><w:jc w:val="right"/>'
) =>
  `<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/>${properties}</w:tblPr><w:tblGrid><w:gridCol w:w="1200"/><w:gridCol w:w="1800"/><w:gridCol w:w="2400"/></w:tblGrid>${rows}</w:tbl>`;
function part(xml: string, styles = false) {
  const result = readOoxmlPart(
    styles
      ? `<w:styles xmlns:w="${W}">${xml}</w:styles>`
      : `<w:document xmlns:w="${W}"><w:body>${xml}</w:body></w:document>`,
    { name: styles ? '/word/styles.xml' : '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}
function tableNode(xml: string) {
  const doc = part(xml);
  const body = doc.root.children.find(
    (n) => n.kind !== 'textValue' && n.localName === 'body'
  ) as OoxmlElement;
  return body.children.find((n) => n.kind === 'table')!;
}
function layout(xml: string, height = 300) {
  return layoutSemanticDocument(part(xml), 0, {
    measurer: createFixedMeasurer(5, 14),
    geometry: { width: 400, height, margin: { top: 10, bottom: 10, left: 10, right: 10 } },
  });
}
function tables(result: ReturnType<typeof layout>) {
  return result.pages.flatMap((page) =>
    page.fragments.filter((block): block is TableFragmentRecord => block.kind === 'table')
  );
}

describe('w:bidiVisual table grid', () => {
  test('reverses unequal-width columns while preserving document order and canonical edit targets', () => {
    const result = layout(table());
    const t = tables(result)[0]!;
    // A trailing-aligned legacy table puts its last content edge on the text edge, which moves
    // the grid 0.5pt out (`fixedTableContentEdgeOrigin`).
    expect(t.columnEdges).toEqual([0, 120, 210, 270]);
    const [a, b, c] = t.rows[0]!.cells;
    expect([a!.box.x, b!.box.x, c!.box.x]).toEqual([209.5, 119.5, -0.5]);
    expect([a!.box.width, b!.box.width, c!.box.width]).toEqual([60, 90, 120]);
    expect(a!.gridColumn).toBe(2);
    expect(a!.logicalGridColumn).toBe(0);
    const paragraph = a!.blocks[0]!;
    if (paragraph.kind !== 'paragraph') throw new Error('missing paragraph');
    expect(tableContextAt(result, paragraph.paragraphId)?.columnIndex).toBe(0);
    expect(tableAnchorAt(result, paragraph.paragraphId)?.gridColumnIndex).toBe(0);
    expect(paragraph.lines[0]!.box.x).toBeGreaterThanOrEqual(a!.box.x);
    const hit = findTableInteractionAt(
      tableInteractionIndex(result),
      10 + 210,
      10 + a!.box.height / 2,
      result
    );
    expect(hit?.kind).toBe('columnDivider');
    if (hit?.kind !== 'columnDivider') throw new Error('missing divider');
    expect(hit.leftGridColumnId).toBe(b!.gridColumnId!);
    expect(hit.rightGridColumnId).toBe(a!.gridColumnId!);
    // Content coordinates, inside the first cell.
    expect(hitTestPage(result, 0, { x: a!.box.x + 10, y: a!.box.y + 5 })?.cell?.cellId).toBe(a!.id);
  });

  test.each(['0', 'false', 'off'])('explicit %s keeps LTR columns', (value) => {
    const t = tables(layout(table(undefined, `<w:bidiVisual w:val="${value}"/>`)))[0]!;
    expect(t.columnEdges).toEqual([0, 60, 150, 270]);
    expect(t.rows[0]!.cells.map((c) => c.box.x - t.box.x)).toEqual([0, 60, 150]);
  });

  test('inherits table-style bidiVisual, permits direct false, and keeps firstCol styling logical', () => {
    const styles = buildStyleCascadeTable(
      part(
        `<w:style w:type="table" w:styleId="RTL"><w:tblPr><w:bidiVisual/></w:tblPr><w:tblStylePr w:type="firstCol"><w:tcPr><w:shd w:fill="FF0000"/></w:tcPr></w:tblStylePr></w:style>`,
        true
      ).root
    );
    const props = '<w:tblStyle w:val="RTL"/><w:tblLook w:firstColumn="1"/>';
    const rtl = readTableStructure(tableNode(table(undefined, props)), 380, 0, styles)!;
    expect(rtl.rows[0]!.cells[0]!.gridColumn).toBe(2);
    expect(rtl.rows[0]!.cells[0]!.shading).toBe('FF0000');
    const ltr = readTableStructure(
      tableNode(table(undefined, props + '<w:bidiVisual w:val="0"/>')),
      380,
      0,
      styles
    )!;
    expect(ltr.rows[0]!.cells[0]!.gridColumn).toBe(0);
  });

  test('mirrors gridSpan, vMerge, and skipped leading grid slots', () => {
    const result = layout(
      table(
        row(cell('merged', '<w:gridSpan w:val="2"/><w:vMerge w:val="restart"/>') + cell('tail')) +
          row(cell('', '<w:gridSpan w:val="2"/><w:vMerge/>') + cell('tail2')) +
          row(cell('skipped'), '<w:gridBefore w:val="1"/><w:gridAfter w:val="1"/>')
      )
    );
    const [first, second, third] = tables(result)[0]!.rows;
    expect(first!.cells[0]!.box.x).toBe(120);
    expect(first!.cells[0]!.box.width).toBe(150);
    expect(first!.cells[0]!.rowSpan).toBe(2);
    expect(second!.cells[0]!.paintInert).toBe(true);
    expect(third!.cells[0]!.box.x).toBe(120);
    expect(third!.cells[0]!.box.width).toBe(90);
  });

  test('maps start/end borders and margins to physical sides, mirroring explicit left/right', () => {
    const props =
      '<w:bidiVisual/><w:tblBorders><w:start w:val="single" w:sz="8" w:color="AA0000"/><w:end w:val="single" w:sz="8" w:color="0000AA"/></w:tblBorders><w:tblCellMar><w:start w:w="200"/><w:end w:w="40"/></w:tblCellMar>';
    const s = readTableStructure(
      tableNode(
        table(
          row(
            cell(
              'a',
              '<w:tcBorders><w:left w:val="single" w:sz="8" w:color="00AA00"/></w:tcBorders>'
            ) +
              cell('b') +
              cell('c')
          ),
          props
        )
      ),
      380,
      0
    )!;
    expect(s.defaultMargins.left).toBe(2);
    expect(s.defaultMargins.right).toBe(10);
    expect(s.tableBorders.right).toMatchObject({ state: 'edge', color: 'AA0000' });
    expect(s.tableBorders.left).toMatchObject({ state: 'edge', color: '0000AA' });
    expect(s.rows[0]!.cells[0]!.borders.right).toMatchObject({
      state: 'edge',
      color: '00AA00',
    });
  });

  test('uses the same RTL grid on repeated headers and later page fragments', () => {
    const result = layout(
      table(
        row(cell('H1') + cell('H2') + cell('H3'), '<w:tblHeader/>') +
          Array.from({ length: 12 }, (_, i) =>
            row(cell(`a${i}`) + cell(`b${i}`) + cell(`c${i}`))
          ).join('')
      ),
      100
    );
    const fragments = tables(result);
    expect(fragments.length).toBeGreaterThan(1);
    expect(fragments.slice(1).every((t) => t.rows[0]!.isHeaderRepeat)).toBe(true);
    for (const t of fragments)
      for (const r of t.rows) expect(r.cells.map((c) => c.box.x)).toEqual([209.5, 119.5, -0.5]);
  });
  test('mirrors border ownership onto the real perimeter and keeps nested tables independent', () => {
    const border = '<w:tcBorders><w:left w:val="single" w:sz="8" w:color="AA0000"/></w:tcBorders>';
    const result = layout(table(row(cell('a', border) + cell('b') + cell('c'))));
    const cells = tables(result)[0]!.rows[0]!.cells;
    expect(cells[0]!.borders?.right?.color).toBe('AA0000');
    expect(cells[0]!.borders?.left).toBeUndefined();
    expect(cells[1]!.borders?.right).toBeUndefined();
    const nested = table(undefined, '<w:tblW w:w="600" w:type="dxa"/>');
    const outer = tables(
      layout(table(row(`<w:tc>${nested}${p('end')}</w:tc>` + cell('b') + cell('c'))))
    )[0]!;
    const inner = outer.rows[0]!.cells[0]!.blocks.find(
      (b) => b.kind === 'table'
    ) as TableFragmentRecord;
    expect(inner.rows[0]!.cells[0]!.box.x).toBeLessThan(inner.rows[0]!.cells[1]!.box.x);
    expect(inner.box.x).toBeGreaterThanOrEqual(outer.rows[0]!.cells[0]!.box.x);
  });

  test('mirrors table alignment and measures indentation from the right', () => {
    const t = tables(
      layout(table(undefined, '<w:bidiVisual/><w:tblInd w:w="200" w:type="dxa"/>'))
    )[0]!;
    // The stated indent aligns the leading content edge, 0.5pt past the grid edge.
    expect(t.box.x).toBe(100.5);
    expect(t.rows[0]!.cells[0]!.box.x + t.rows[0]!.cells[0]!.box.width).toBe(370.5);
  });
  test.each([false, true])(
    'clipboard keeps logical cell order and span gaps (merged=%s)',
    (merged) => {
      const result = layout(
        table(merged ? row(cell('first', '<w:gridSpan w:val="2"/>') + cell('third')) : undefined)
      );
      const t = tables(result)[0]!;
      expect(
        cellSelectionText(result, {
          kind: 'cells',
          text: {
            anchor: { paragraphId: 'unused', offset: 0 },
            head: { paragraphId: 'unused', offset: 0 },
          },
          tableId: t.tableId,
          cellIds: t.rows[0]!.cells.map((c) => c.id),
          rows: { from: 0, to: 0 },
          columns: { from: 0, to: 2 },
        })
      ).toBe(merged ? 'first\t\tthird' : 'first\tsecond\tthird');
    }
  );
  test('sparse RTL rows report the reached grid with valid logical column indices', () => {
    // Another row reaches the first column; a column no row reaches takes no width or index.
    const result = layout(
      table(
        row(cell('second') + cell('third'), '<w:gridBefore w:val="1"/>') +
          row(cell('a') + cell('b') + cell('c'))
      )
    );
    const t = tables(result)[0]!;
    for (const [index, c] of t.rows[0]!.cells.entries()) {
      const paragraph = c.blocks[0]!;
      if (paragraph.kind !== 'paragraph') throw new Error('missing paragraph');
      expect(tableContextAt(result, paragraph.paragraphId)).toMatchObject({
        columns: 3,
        columnIndex: index + 1,
      });
    }
  });
  test.each([false, true])(
    'horizontal merged tables expose resize handles only for supported direction (RTL=%s)',
    (rtl) => {
      const result = layout(
        table(
          row(cell('merged', '<w:gridSpan w:val="2"/>') + cell('tail')) +
            row(cell('a') + cell('b') + cell('c')),
          rtl ? '<w:bidiVisual/><w:jc w:val="right"/>' : ''
        )
      );
      const t = tables(result)[0]!;
      const index = tableInteractionIndex(result);
      for (const r of t.rows) {
        for (const edge of t.columnEdges!.slice(1)) {
          const hit = findTableInteractionAt(
            index,
            10 + t.box.x + edge,
            10 + r.box.y + r.box.height / 2,
            result
          );
          if (rtl) {
            expect(hit?.kind).not.toBe('columnDivider');
            expect(hit?.kind).not.toBe('rightEdge');
          } else if (r.cells.length === 3) {
            expect(['columnDivider', 'rightEdge']).toContain(hit?.kind);
          }
        }
      }
    }
  );
});
