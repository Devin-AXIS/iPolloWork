// The border band a complete body row reserves directly below a repeated header row.
//
// Before mode 15 the row meets the repeated header: it reserves the wider of its own top rule
// and the header row's bottom rule. From mode 15 it keeps the band of the row it was authored
// under, also when that row's bottom rule is the wider one. The shared border plan and the
// ordinary repeat path (here forced by a vertical merge, which the plan refuses) agree.
//
// One column, cell margins 0, 12pt exact lines, so each band is the distance from the row top
// to its text. Per-cell rules: the header's bottom, and every body row's top and bottom.
import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { TableFragmentRecord, TableRowFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const rule = (side: string, pt: number) => `<w:${side} w:val="single" w:sz="${pt * 8}"/>`;
const text = (value: string) =>
  `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr><w:r><w:t>${value}</w:t></w:r></w:p>`;
const cell = (value: string, top: number, bottom: number, extra = '') =>
  `<w:tc><w:tcPr><w:tcW w:w="1600" w:type="dxa"/><w:tcBorders>${rule('top', top)}${rule('bottom', bottom)}</w:tcBorders>${extra}</w:tcPr>${text(value)}</w:tc>`;

interface Shape {
  readonly headerBottom: number;
  readonly bodyTop: number;
  readonly bodyBottom: number;
}

/** A header and 30 body rows; `merged` adds a second column that ends in a vertical merge. */
function fixture(shape: Shape, merged: boolean) {
  const side = (index: number) =>
    !merged
      ? ''
      : cell(
          'side',
          shape.bodyTop,
          shape.bodyBottom,
          index === 28 ? '<w:vMerge w:val="restart"/>' : index === 29 ? '<w:vMerge/>' : ''
        );
  const header = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${cell('H', 0.5, shape.headerBottom)}${merged ? cell('H2', 0.5, shape.headerBottom) : ''}</w:tr>`;
  const body = Array.from(
    { length: 30 },
    (_, index) =>
      `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cell(`B${index}`, shape.bodyTop, shape.bodyBottom)}${side(index)}</w:tr>`
  ).join('');
  const columns = merged ? 2 : 1;
  const xml = `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr><w:tblLayout w:type="fixed"/>
    <w:tblW w:w="${1600 * columns}" w:type="dxa"/><w:tblCellMar>${['top', 'bottom', 'left', 'right'].map((s) => `<w:${s} w:w="0" w:type="dxa"/>`).join('')}</w:tblCellMar>
    </w:tblPr><w:tblGrid>${'<w:gridCol w:w="1600"/>'.repeat(columns)}</w:tblGrid>${header}${body}</w:tbl></w:body></w:document>`;
  const parsed = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}

function bodyRowsBelowRepeats(shape: Shape, merged: boolean, compatibilityMode: number) {
  const result = layoutSemanticDocument(fixture(shape, merged), 0, {
    geometry: { width: 200, height: 100, margin: { top: 10, right: 10, bottom: 10, left: 10 } },
    measurer: createFixedMeasurer(5, 12),
    compatibilityMode,
  });
  const tables = result.pages.flatMap((page) =>
    page.fragments.filter((item): item is TableFragmentRecord => item.kind === 'table')
  );
  return tables
    .filter((table) => table.rows[0]?.isHeaderRepeat)
    .map((table) => table.rows.find((row) => !row.isHeaderRepeat)!);
}

/** Distance from the row's top to its first line: the band the row reserves above its text. */
function topBand(row: TableRowFragmentRecord): number {
  const paragraph = row.cells[0]!.blocks.find((block) => block.kind === 'paragraph');
  if (paragraph?.kind !== 'paragraph') throw new Error('missing paragraph');
  return paragraph.lines[0]!.box.y - row.box.y;
}

describe('the band of a body row below a repeated header', () => {
  // headerBottom / bodyTop / bodyBottom, and the band before and from mode 15.
  const cases: readonly [Shape, number, number][] = [
    // The header's wider bottom rule wins before mode 15 only.
    [{ headerBottom: 2, bodyTop: 0.5, bodyBottom: 0.5 }, 2, 0.5],
    // From mode 15 the row above it in the table wins with its 3pt bottom rule; before mode
    // 15 that row plays no part and the header's 2pt rule wins.
    [{ headerBottom: 2, bodyTop: 0.5, bodyBottom: 3 }, 2, 3],
    // A wider own top rule than the authored neighbor keeps its own width from mode 15.
    [{ headerBottom: 2, bodyTop: 1, bodyBottom: 0.5 }, 2, 1],
    // The row's own wider top rule wins in both.
    [{ headerBottom: 0.5, bodyTop: 2, bodyBottom: 0.5 }, 2, 2],
  ];
  for (const [shape, legacy, modern] of cases) {
    const name = `${shape.headerBottom}/${shape.bodyTop}/${shape.bodyBottom}`;
    for (const [mode, expected] of [
      [14, legacy],
      [15, modern],
    ] as const) {
      test(`mode ${mode}: ${name} reserves ${expected}pt on both repeat paths`, () => {
        const planned = bodyRowsBelowRepeats(shape, false, mode);
        const ordinary = bodyRowsBelowRepeats(shape, true, mode);
        expect(planned.length).toBeGreaterThan(2);
        expect(ordinary.length).toBeGreaterThan(2);
        for (const row of [...planned, ...ordinary]) expect(topBand(row)).toBeCloseTo(expected, 6);
      });
    }
  }
});
