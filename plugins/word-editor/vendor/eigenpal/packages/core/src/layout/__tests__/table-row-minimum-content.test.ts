import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createLayoutSession } from '../layout-session.ts';
import { layoutSemanticDocument, linesOf } from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const paragraph = (text: string) =>
  `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="200" w:lineRule="exact"/></w:pPr><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;
const cell = (text: string, properties = '') =>
  `<w:tc><w:tcPr>${properties}</w:tcPr>${text}</w:tc>`;
const row = (cells: string, height = 24, properties = '') =>
  `<w:tr><w:trPr><w:trHeight w:val="${height * 20}" w:hRule="atLeast"/>${properties}</w:trPr>${cells}</w:tr>`;
function table(rows: string, border = 0, margin = 0, columns = 1) {
  const edges = ['top', 'bottom', 'left', 'right', 'insideH', 'insideV']
    .map((side) => `<w:${side} w:val="${border ? 'single' : 'nil'}" w:sz="${border * 8}"/>`)
    .join('');
  const margins = ['top', 'bottom', 'left', 'right']
    .map((side) => `<w:${side} w:w="${margin * 20}" w:type="dxa"/>`)
    .join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/><w:tblBorders>${edges}</w:tblBorders><w:tblCellMar>${margins}</w:tblCellMar></w:tblPr><w:tblGrid>${'<w:gridCol w:w="2000"/>'.repeat(columns)}</w:tblGrid>${rows}</w:tbl>`;
}
function layout(body: string, mode?: number, height = 792) {
  const parsed = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  const before = serializeOoxmlPart(parsed.part);
  const options = {
    compatibilityMode: mode,
    session: createLayoutSession(),
    measurer: {
      measure: (text: string) => text.length * 4,
      lineMetrics: () => ({ height: 10, baseline: 8 }),
    },
    geometry: { width: 300, height, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
  };
  const result = layoutSemanticDocument(parsed.part, 0, options);
  expect(layoutSemanticDocument(parsed.part, 0, options).pages).toEqual(result.pages);
  expect(serializeOoxmlPart(parsed.part)).toBe(before);
  return result;
}
const rowsOf = (result: ReturnType<typeof layout>) =>
  result.pages.flatMap((page) =>
    page.fragments.flatMap((fragment) => (fragment.kind === 'table' ? fragment.rows : []))
  );

for (const mode of [undefined, 15]) {
  // A collapsed horizontal band is charged to the row BELOW it, so every row carries its own
  // top rule and none carries a bottom until the table's outer edge. Row heights therefore
  // run minimum + top + 0, and the LAST row alone also carries the outer bottom. The table's
  // total is what the old half-and-half split produced; only the boundaries moved.
  for (const [border, margin, heights] of [
    [0, 0, [24, 24, 24]],
    [0, 3, [30, 30, 30]],
    [1, 0, [25, 25, 26]],
    [1, 3, [31, 31, 32]],
  ] as const) {
    test(`atLeast reserves content plus insets: mode ${mode}, border ${border}, margin ${margin}`, () => {
      const result = layout(
        table([1, 2, 3].map((i) => row(cell(paragraph(`Row ${i}`)))).join(''), border, margin),
        mode
      );
      expect(rowsOf(result).map((placed) => placed.box.height)).toEqual([...heights]);
    });

    test(`minimum-only merged rows retain local padding: mode ${mode}, border ${border}, margin ${margin}`, () => {
      const rows = [0, 1, 2]
        .map((i) =>
          row(
            cell(
              paragraph(i === 0 ? 'Head' : 'Ignored'),
              `<w:vMerge${i === 0 ? ' w:val="restart"' : ''}/>`
            )
          )
        )
        .join('');
      const result = layout(table(rows, border, margin), mode);
      const placed = rowsOf(result);
      expect(placed.map((entry) => entry.box.height)).toEqual([...heights]);
      expect(placed[0]!.cells[0]!.rowSpan).toBe(3);
      expect(placed[0]!.cells[0]!.box.height).toBe(
        heights.reduce((sum, height) => sum + height, 0)
      );
      expect(placed[1]!.cells[0]!.blocks).toEqual([]);
      expect(placed[2]!.cells[0]!.blocks).toEqual([]);
    });
  }

  test(`a detached merged head does not charge its far border to the first row (mode ${mode})`, () => {
    const rows = [60, 120, 80]
      .map((height, i) =>
        row(
          cell(paragraph(`Row ${i}`)) +
            cell(
              i === 0 ? paragraph('Merged head') : paragraph('Ignored'),
              `<w:vMerge${i === 0 ? ' w:val="restart"' : ''}/>`
            ),
          height
        )
      )
      .join('');
    const result = layout(table(rows, 1, 0, 2), mode);
    const placed = rowsOf(result);
    expect(placed.map((entry) => entry.box.height)).toEqual([61, 121, 82]);
    expect(placed[0]!.cells[1]!.rowSpan).toBe(3);
    expect(placed[0]!.cells[1]!.box.height).toBe(264);
    expect(placed[1]!.cells[1]!.blocks).toEqual([]);
  });
}

test('row minimum adds the largest top and bottom clearance even from different cells', () => {
  const properties = (top: number, bottom: number) =>
    `<w:tcMar><w:top w:w="${top * 20}" w:type="dxa"/><w:bottom w:w="${bottom * 20}" w:type="dxa"/></w:tcMar>`;
  const cells = cell(paragraph('A'), properties(10, 0)) + cell(paragraph('B'), properties(0, 10));
  expect(
    rowsOf(layout(table(row(cells) + row(cells), 0, 0, 2))).map((entry) => entry.box.height)
  ).toEqual([44, 44]);
  expect(
    rowsOf(layout(table(row(cells) + row(cells), 1, 0, 2))).map((entry) => entry.box.height)
  ).toEqual([45, 46]);
});

test('a continued row keeps the authored minimum on its final fragment', () => {
  // The padded 30pt minimum fits the 30pt left below the prefix, so the row starts there. Its
  // continuation holds one line but is as tall as the padded minimum.
  const content = Array.from({ length: 3 }, (_, i) => paragraph(`Cell ${i}`)).join('');
  const result = layout(
    paragraph('Prefix 1') + paragraph('Prefix 2') + table(row(cell(content), 24), 0, 3),
    undefined,
    50
  );
  const placed = rowsOf(result);
  expect(result.pages).toHaveLength(2);
  expect(placed.map((entry) => entry.box.height)).toEqual([26, 30]);
  expect(placed[1]!.isContinuation).toBe(true);
  expect(linesOf(result).map((line) => line.spans.map((span) => span.text).join(''))).toEqual([
    'Prefix 1',
    'Prefix 2',
    'Cell 0',
    'Cell 1',
    'Cell 2',
    '',
  ]);
});

test('atomic row admission includes the minimum content box padding', () => {
  const result = layout(
    paragraph('Prefix 1') +
      paragraph('Prefix 2') +
      table(row(cell(paragraph('Row')), 24, '<w:cantSplit/>'), 0, 3),
    undefined,
    45
  );
  expect(result.pages).toHaveLength(2);
  expect(result.pages[0]!.fragments.some((fragment) => fragment.kind === 'table')).toBe(false);
  expect(rowsOf(result)[0]!.box.height).toBe(30);
});
