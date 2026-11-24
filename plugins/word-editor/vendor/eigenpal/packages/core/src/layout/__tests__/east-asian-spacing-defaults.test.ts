import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { NO_THEME_FONTS } from '../run-style.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf, type LineRecord } from '../semantic-records.ts';
import { loadBody, W } from './float-over-table-harness.ts';

// The document defaults decide whether justified East Asian text spreads between its
// characters and whether automatic spacing opens between East Asian and Latin text. 10pt per
// character at 11pt and a 100pt measure.
const measurer = createFixedMeasurer(10, 14);
const geometry = { width: 120, height: 400, margin: { top: 10, right: 10, bottom: 10, left: 10 } };
const RUN = '<w:rPr><w:rFonts w:eastAsia="MS Mincho"/><w:sz w:val="22"/></w:rPr>';
const paragraph = (text: string, pPr: string) =>
  `<w:p><w:pPr>${pPr}</w:pPr><w:r>${RUN}<w:t>${text}</w:t></w:r></w:p>`;
// A 95pt measure holds nine characters with 5pt of slack on each inner line.
const JUSTIFIED = '<w:ind w:left="0" w:right="100"/><w:jc w:val="both"/>';

function root(xml: string) {
  const result = readOoxmlPart(xml, { name: '/word/part.xml', contentType: 'application/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part.root;
}
/** A cascade with `docDefaults` (null: no styles part) under compatibility `mode`. */
function cascade(docDefaults: string | null, mode = 15) {
  const styles =
    docDefaults === null ? null : root(`<w:styles xmlns:w="${W}">${docDefaults}</w:styles>`);
  const settings = root(
    `<w:settings xmlns:w="${W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="${mode}"/></w:compat></w:settings>`
  );
  return buildStyleCascadeTable(styles, NO_THEME_FONTS, settings);
}
const defaults = (rPr: string) =>
  `<w:docDefaults><w:rPrDefault><w:rPr>${rPr}</w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>`;

const ON = {
  'no styles part': cascade(null),
  'no rPrDefault': cascade('<w:docDefaults><w:pPrDefault/></w:docDefaults>'),
  'an East Asian font in rPrDefault': cascade(defaults('<w:rFonts w:eastAsia="MS Mincho"/>')),
  'an East Asian theme font in rPrDefault': cascade(
    defaults('<w:rFonts w:eastAsiaTheme="minorEastAsia"/>')
  ),
};
const OFF = {
  'an empty rPrDefault': cascade('<w:docDefaults><w:rPrDefault/></w:docDefaults>'),
  'a kerning rPrDefault': cascade(defaults('<w:kern w:val="2"/>')),
  'a Latin font rPrDefault': cascade(
    defaults('<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/>')
  ),
  'an empty rPrDefault in mode 14': cascade('<w:docDefaults><w:rPrDefault/></w:docDefaults>', 14),
};

function lines(body: string, styleCascade: ReturnType<typeof cascade>): LineRecord[] {
  return linesOf(
    layoutSemanticDocument(loadBody(body), 0, { measurer, geometry, styleCascade })
  ) as LineRecord[];
}

/** Each visible character's x on the line, from its span and offset. */
function xs(line: LineRecord) {
  return line.spans.flatMap((span) =>
    [...span.text].map((character, index) => Number((span.box.x + 10 * index).toFixed(4)))
  );
}

const TEXT = '漢字'.repeat(8);
const MIXED = '漢a';

for (const [kind, styleCascade] of Object.entries(ON)) {
  test(`East Asian spacing applies with ${kind}`, () => {
    const [inner] = lines(paragraph(TEXT, JUSTIFIED), styleCascade);
    // Eight gaps share the 5pt of slack.
    expect(xs(inner!)[8]).toBeCloseTo(80 + 5, 4);
    const [mixed] = lines(paragraph(MIXED, ''), styleCascade);
    expect(xs(mixed!)[1]).toBeCloseTo(10 + 11 / 4, 4);
  });
}

for (const [kind, styleCascade] of Object.entries(OFF)) {
  test(`East Asian spacing is off with ${kind}`, () => {
    const [inner] = lines(paragraph(TEXT, JUSTIFIED), styleCascade);
    expect(xs(inner!)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80]);
    const [mixed] = lines(paragraph(MIXED, ''), styleCascade);
    expect(xs(mixed!)).toEqual([0, 10]);
  });
}

test('with East Asian spacing off, a justified East Asian line stretches its spaces', () => {
  const [inner] = lines(paragraph('漢字漢字 漢字漢字 漢字', JUSTIFIED), OFF['an empty rPrDefault']);
  // Eight characters and a space fit: the 5pt of slack goes to the inner space, and the
  // trailing space hangs at 95pt.
  expect(xs(inner!).filter((x, index) => index !== 4)).toEqual([0, 10, 20, 30, 55, 65, 75, 85, 95]);
});

test('with East Asian spacing off, a justified table cell stays at natural spacing', () => {
  const cell = `<w:tbl><w:tblPr><w:tblW w:w="1900" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="1900"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="1900" w:type="dxa"/></w:tcPr>${paragraph(TEXT, '<w:jc w:val="both"/>')}</w:tc></w:tr></w:tbl><w:p/>`;
  const [off] = lines(cell, OFF['an empty rPrDefault']);
  const [on] = lines(cell, ON['no rPrDefault']);
  // 95pt cell: nine characters and 5pt of slack.
  expect(xs(off!)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80].map((x) => x + xs(off!)[0]!));
  expect(xs(on!)[8]! - xs(on!)[0]!).toBeCloseTo(85, 4);
});
