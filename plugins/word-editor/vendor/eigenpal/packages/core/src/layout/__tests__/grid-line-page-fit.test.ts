import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/index.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';

// A snapped line is 31.2pt: two 15.6pt pitches around a 20.699pt glyph band, with 5.2505pt of
// centring space above and below the band. One table row of 20.699pt and five lines come first,
// so the sixth line's band ends at 20.699 + 5 * 31.2 + 5.2505 + 20.699 = 202.6485pt.
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const mark =
  '<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="SimSun"/><w:sz w:val="36"/></w:rPr>';
const run = (text: string) => '<w:r>' + mark + '<w:t>' + text + '</w:t></w:r>';
const paragraph = (text = '', properties = '') =>
  '<w:p><w:pPr>' +
  (properties.includes('<w:spacing') ? '' : '<w:spacing w:before="0" w:after="0"/>') +
  properties +
  mark +
  '</w:pPr>' +
  (text ? run(text) : '') +
  '</w:p>';
const table = (text: string) =>
  '<w:tbl><w:tblPr><w:tblW w:type="dxa" w:w="3600"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="3600"/></w:tblGrid><w:tr><w:tc>' +
  paragraph(text) +
  '</w:tc></w:tr></w:tbl>';
function part(xml: string, name: string) {
  const parsed = readOoxmlPart(xml, { name, contentType: 'application/xml' });
  if (!parsed.ok) throw Error(parsed.reason);
  return parsed.part;
}
const LINES_GRID = '<w:docGrid w:type="lines" w:linePitch="312"/>';
const sixParagraphs = (text: string, properties = '') =>
  Array.from({ length: 6 }, () => paragraph(text, properties)).join('');
function layout(height: number, flow: string, grid = LINES_GRID) {
  const document = part(
    '<w:document xmlns:w="' +
      W +
      '"><w:body>' +
      table('FIRST CONTROL') +
      flow +
      table('SECOND CONTROL') +
      paragraph() +
      '<w:sectPr>' +
      grid +
      '</w:sectPr></w:body></w:document>',
    '/word/document.xml'
  );
  const styles = part(
    '<w:styles xmlns:w="' +
      W +
      '"><w:docDefaults><w:rPrDefault>' +
      mark +
      '</w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>',
    '/word/styles.xml'
  );
  const before = serializeOoxmlPart(document);
  const result = layoutSemanticDocument(document, 0, {
    geometry: {
      width: 240,
      height: height + 40,
      margin: { left: 20, right: 20, top: 20, bottom: 20 },
    },
    styleCascade: buildStyleCascadeTable(styles.root),
    measurer: {
      measure: (text) => text.length * 5,
      lineMetrics: () => ({ height: 20.699, baseline: 16.04 }),
    },
  });
  expect(serializeOoxmlPart(document)).toBe(before);
  return result;
}
type Layout = ReturnType<typeof layout>;
/** The second table's top on page 2: 0 when all six lines fit page 1. */
function secondTableTop(result: Layout): number {
  expect(result.pages.length).toBe(2);
  return result.pages[1]!.fragments.find((f) => f.kind === 'table')!.box.y;
}
function bodyLineHeights(result: Layout): number[] {
  return result.pages.flatMap((page) =>
    page.fragments.flatMap((fragment) =>
      fragment.kind === 'paragraph' ? fragment.lines.map((line) => line.box.height) : []
    )
  );
}

const BREAKS =
  '<w:p><w:pPr><w:spacing w:before="0" w:after="0"/>' +
  mark +
  '</w:pPr>' +
  Array.from({ length: 6 }, () => run('x')).join('<w:r><w:br/></w:r>') +
  '</w:p>';
// Widow control carries two lines of the broken paragraph to the next page.
const flows: ReadonlyArray<readonly [string, string, number]> = [
  ['empty paragraphs', sixParagraphs(''), 31.2],
  ['text paragraphs', sixParagraphs('x'), 31.2],
  ['one paragraph with line breaks', BREAKS, 62.4],
];
for (const [name, flow, moved] of flows) {
  for (const [height, fits] of [
    [180, false],
    [200, false],
    [202.6, false],
    [202.65, true],
    [205, true],
    [218.4, true],
  ] as const) {
    test(`${name}: a grid line fits when its glyph band fits (${height})`, () => {
      const result = layout(height, flow);
      expect(secondTableTop(result)).toBeCloseTo(fits ? 0 : moved, 3);
      // The line keeps its whole box and advance; only the fit test changes.
      for (const lineHeight of bodyLineHeights(result)) expect(lineHeight).toBeCloseTo(31.2, 3);
    });
  }
}

for (const grid of [
  '<w:docGrid w:type="linesAndChars" w:linePitch="312" w:charSpace="0"/>',
  '<w:docGrid w:type="snapToChars" w:linePitch="312" w:charSpace="0"/>',
]) {
  test('every line grid type lets the lower centring space cross the margin ' + grid, () => {
    expect(secondTableTop(layout(202.6, sixParagraphs('x'), grid))).toBeCloseTo(31.2, 3);
    expect(secondTableTop(layout(202.65, sixParagraphs('x'), grid))).toBeCloseTo(0, 3);
  });
}

test('without a grid, a line still needs its whole box', () => {
  // Six 20.699pt lines after the row end at 144.893pt.
  const plain = (height: number) => secondTableTop(layout(height, sixParagraphs(''), ''));
  expect(plain(144.8)).toBeCloseTo(20.699, 3);
  expect(plain(144.9)).toBeCloseTo(0, 3);
});

test('an auto multiple counts in pitches, and its glyphs fit like a single line', () => {
  // Text that takes two pitches keeps them at 1.5 and double spacing.
  for (const line of ['360', '480']) {
    const spaced = sixParagraphs('x', `<w:spacing w:line="${line}" w:lineRule="auto"/>`);
    expect(secondTableTop(layout(202.6, spaced))).toBeCloseTo(31.2, 3);
    expect(secondTableTop(layout(202.65, spaced))).toBeCloseTo(0, 3);
  }
  // Triple spacing takes three pitches with the glyphs centred. The sixth band ends at
  // 20.699 + 5 * 46.8 + (46.8 - 20.699) / 2 + 20.699 = 288.4485pt.
  const triple = sixParagraphs('x', '<w:spacing w:line="720" w:lineRule="auto"/>');
  expect(secondTableTop(layout(288.4, triple))).toBeCloseTo(46.8, 3);
  expect(secondTableTop(layout(288.45, triple))).toBeCloseTo(0, 3);
});

test('an atLeast value under the snapped line fits like a single line', () => {
  const atLeast = sixParagraphs('', '<w:spacing w:line="480" w:lineRule="atLeast"/>');
  expect(secondTableTop(layout(202.6, atLeast))).toBeCloseTo(31.2, 3);
  expect(secondTableTop(layout(202.65, atLeast))).toBeCloseTo(0, 3);
});

test('exact line spacing retains its full fit budget', () => {
  const exact = sixParagraphs('', '<w:spacing w:line="624" w:lineRule="exact"/>');
  expect(secondTableTop(layout(203, exact))).toBeCloseTo(31.2, 3);
});
