import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { buildStyleCascadeTable, cascadeParagraphFormatting } from '../style-cascade.ts';
import { resolveRunStyle } from '../run-style.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';

// Each half of `w:docDefaults` falls back on its own: an omitted `w:rPrDefault` gives 12pt
// runs, an omitted `w:pPrDefault` gives 8pt after and 278/240 auto line spacing. An authored
// empty half keeps the format defaults, and so does an `w:rPrDefault` that omits `w:sz`.

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function part(xml: string, name: string) {
  const parsed = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}
const root = (xml: string, name: string) => part(xml, name).root;
const styles = (inner: string) =>
  root(`<w:styles xmlns:w="${W}">${inner}</w:styles>`, '/word/styles.xml');
const withDefaults = (inner: string) => styles(`<w:docDefaults>${inner}</w:docDefaults>`);
const fonts = '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>';

const cases = [
  ['no styles part', null, 12, 8],
  ['styles part without docDefaults', styles(''), 12, 8],
  ['empty docDefaults', withDefaults(''), 12, 8],
  ['paragraph defaults only', withDefaults('<w:pPrDefault><w:pPr/></w:pPrDefault>'), 12, 0],
  [
    'run defaults without a size',
    withDefaults(`<w:rPrDefault><w:rPr>${fonts}</w:rPr></w:rPrDefault>`),
    10,
    8,
  ],
  ['empty run and paragraph defaults', withDefaults('<w:rPrDefault/><w:pPrDefault/>'), 10, 0],
  [
    'authored size and spacing',
    withDefaults(
      '<w:rPrDefault><w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0"/></w:pPr></w:pPrDefault>'
    ),
    11,
    0,
  ],
] as const;

test.each(cases)(
  '%s resolves the expected run size and paragraph spacing',
  (_, stylesRoot, size, after) => {
    const table = buildStyleCascadeTable(stylesRoot);
    const formatting = cascadeParagraphFormatting(table, undefined);
    const run = resolveRunStyle(formatting.runProperties);
    expect(run.fontSizePt).toBe(size);
    expect(
      resolveRunStyle([...formatting.runProperties, { localName: 'cs', attributes: {} }]).fontSizePt
    ).toBe(size);
    const document = part(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Text</w:t></w:r></w:p><w:p><w:r><w:t>Text</w:t></w:r></w:p></w:body></w:document>`,
      '/word/document.xml'
    );
    const first = layoutSemanticDocument(document, 0, {
      measurer: createFixedMeasurer(6, 12),
      styleCascade: table,
    }).pages[0]!.fragments[0]!;
    if (first.kind !== 'paragraph') throw new Error('paragraph expected');
    expect(first.spacing.after).toBe(after);
    // The fixed measurer's 12pt line describes 11pt text; an omitted pPrDefault adds 278/240.
    const single = (12 * size) / 11;
    expect(first.lines[0]!.box.height).toBeCloseTo(after === 8 ? (single * 278) / 240 : single, 6);
  }
);

test('the compatibility mode does not change the fallback', () => {
  const settings = (mode: number) =>
    root(
      `<w:settings xmlns:w="${W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="${mode}"/></w:compat></w:settings>`,
      '/word/settings.xml'
    );
  const expected = buildStyleCascadeTable(null);
  for (const mode of [11, 12, 14, 15]) {
    const table = buildStyleCascadeTable(null, undefined, settings(mode));
    expect(table.docDefaultsParagraph).toEqual(expected.docDefaultsParagraph);
    expect(resolveRunStyle(table.docDefaultsRun).fontSizePt).toBe(12);
  }
});

test('the missing-part cache token tracks the paragraph fallback', () => {
  expect(buildStyleCascadeTable(null).cacheToken).not.toBe(
    buildStyleCascadeTable(withDefaults('<w:rPrDefault/><w:pPrDefault/>')).cacheToken
  );
});
