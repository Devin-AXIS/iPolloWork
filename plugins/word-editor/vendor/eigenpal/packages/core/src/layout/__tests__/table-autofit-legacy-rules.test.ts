// Column widths of two table shapes, from reference renders of synthetic controls:
//
// - An automatic-width AutoFit table (17.4.53, 17.4.64) before mode 15 sizes each column as its
//   content plus the larger of each cell margin and half its simple side rule. The rule width is
//   not added to the margin, as it is not in mode 15.
// - A fixed-layout table whose percentage width (17.4.63) is narrower than its cell widths
//   shrinks each column above its cell margins, as a table with an absolute width does.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { TableFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const rules = (size: number) =>
  '<w:tblBorders>' +
  ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((edge) => `<w:${edge} w:val="single" w:sz="${size}" w:space="0" w:color="000000"/>`)
    .join('') +
  '</w:tblBorders>';
const margins = (twips: number) =>
  `<w:tblCellMar><w:left w:w="${twips}" w:type="dxa"/>` +
  `<w:right w:w="${twips}" w:type="dxa"/></w:tblCellMar>`;
const cell = (text: string, tcPr = '') =>
  `<w:tc><w:tcPr>${tcPr}</w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;

/** Cell widths of the first row, in points, in a 432pt text column. */
function widths(grid: number[], tblPr: string, cells: string, mode: number | undefined) {
  const cols = grid.map((width) => `<w:gridCol w:w="${width}"/>`).join('');
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr>${tblPr}</w:tblPr>` +
      `<w:tblGrid>${cols}</w:tblGrid><w:tr>${cells}</w:tr></w:tbl><w:p/><w:sectPr>` +
      '<w:pgSz w:w="12240" w:h="15840"/>' +
      '<w:pgMar w:top="1440" w:right="1800" w:bottom="1440" w:left="1800"/></w:sectPr></w:body></w:document>',
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const layout = layoutSemanticDocument(parsed.part, 1, {
    measurer: createFixedMeasurer(6, 14),
    compatibilityMode: mode,
  });
  const table = layout.pages[0]!.fragments.find(
    (fragment): fragment is TableFragmentRecord => fragment.kind === 'table'
  )!;
  return table.rows[0]!.cells.map((placed) => placed.box.width);
}

test('legacy AutoFit columns take the margin, or half a wider rule, but not both', () => {
  const auto = '<w:tblW w:w="0" w:type="auto"/>';
  const cells = cell('abc') + cell('abcdef');
  for (const mode of [undefined, 12, 14, 15]) {
    // 0.5pt and 3pt rules inside 5.4pt margins: the same columns, content plus the margins.
    const thin = widths([1000, 1000], auto + rules(4) + margins(108), cells, mode);
    const wide = widths([1000, 1000], auto + rules(24) + margins(108), cells, mode);
    expect(wide).toEqual(thin);
    // 3pt rules with no margins: content plus half a rule on each side.
    const bare = widths([1000, 1000], auto + rules(24) + margins(0), cells, mode);
    bare.forEach((width, column) => expect(width).toBeCloseTo(wide[column]! - 10.8 + 3, 6));
  }
});

test('a fixed percentage table shrinks its cell widths above their margins', () => {
  const tblPr = '<w:tblW w:w="5000" w:type="pct"/><w:tblLayout w:type="fixed"/>' + margins(108);
  const stated = [85, 407.5, 49.5];
  const cells = stated.map((points) => cell('c', `<w:tcW w:w="${points * 20}" w:type="dxa"/>`));
  const placed = widths([1500, 7200, 876], tblPr, cells.join(''), 15);
  // 542pt of cell widths fit 432pt: each gives up its share of the width above 10.8pt.
  const above = stated.reduce((sum, width) => sum + width - 10.8, 0);
  stated.forEach((width, column) => {
    expect(placed[column]).toBeCloseTo(width - ((542 - 432) * (width - 10.8)) / above, 6);
  });
});
