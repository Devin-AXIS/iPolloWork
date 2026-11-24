import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';
import {
  buildStyleCascadeTable,
  cascadeParagraphFormatting,
  cascadeRunProperties,
} from '../style-cascade.ts';
import { isRunKerningEnabled } from '../run-kerning.ts';
import { resolveRunStyle } from '../run-style.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function cascade(defaults: string, extra = '') {
  const parsed = readOoxmlPart(`<w:styles xmlns:w="${W}">${defaults}${extra}</w:styles>`, {
    name: '/word/styles.xml',
    contentType: 'app/xml',
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  const before = serializeOoxmlPart(parsed.part);
  const table = buildStyleCascadeTable(parsed.part.root);
  expect(serializeOoxmlPart(parsed.part)).toBe(before);
  return table;
}

test('missing run defaults receive application kerning, explicit empty defaults suppress it', () => {
  const missingPart = buildStyleCascadeTable(null);
  expect(missingPart.docDefaultsRun).toEqual(cascade('').docDefaultsRun);
  expect(isRunKerningEnabled(resolveRunStyle(missingPart.docDefaultsRun))).toBe(true);
  for (const xml of ['', '<w:docDefaults/>', '<w:docDefaults><w:pPrDefault/></w:docDefaults>']) {
    const table = cascade(xml);
    expect(table.docDefaultsRun).toEqual([
      { localName: 'kern', attributes: { val: '2' } },
      { localName: 'sz', attributes: { val: '24' } },
      { localName: 'szCs', attributes: { val: '24' } },
      {
        localName: 'runFontDefaults',
        attributes: { hAnsiTheme: 'minorHAnsi', eastAsiaTheme: 'minorEastAsia' },
      },
    ]);
    expect(isRunKerningEnabled(resolveRunStyle(table.docDefaultsRun))).toBe(true);
  }
  for (const xml of ['<w:rPrDefault/>', '<w:rPrDefault><w:rPr/></w:rPrDefault>']) {
    const table = cascade(`<w:docDefaults>${xml}</w:docDefaults>`);
    // An authored rPrDefault keeps the format defaults: no kerning, and the format faces
    // (probes d04, d06, d07, z06 and z09-z12 in local/evidence/hansi-font-slots).
    expect(table.docDefaultsRun).toEqual([
      {
        localName: 'runFontDefaults',
        attributes: { ascii: 'Times New Roman', hAnsi: 'Times New Roman', eastAsia: 'SimSun' },
      },
    ]);
    expect(isRunKerningEnabled(resolveRunStyle(table.docDefaultsRun))).toBe(false);
    expect(table.cacheToken).not.toBe(cascade('').cacheToken);
  }
});

test('authored defaults, paragraph/character styles and direct zero retain kerning precedence', () => {
  const style =
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:rPr><w:kern w:val="28"/></w:rPr></w:style>';
  const character =
    '<w:style w:type="character" w:styleId="NoKern"><w:rPr><w:kern w:val="0"/></w:rPr></w:style>';
  const table = cascade('', style + character);
  const inherited = cascadeParagraphFormatting(table, undefined).runProperties;
  const small = resolveRunStyle([...inherited, { localName: 'sz', attributes: { val: '22' } }]);
  expect(small.kerningMinPt).toBe(14);
  expect(isRunKerningEnabled(small)).toBe(false);
  expect(isRunKerningEnabled({ ...small, fontSizePt: 18 })).toBe(true);
  for (const direct of [
    [{ localName: 'kern', attributes: { val: '0' } }],
    [{ localName: 'rStyle', attributes: { val: 'NoKern' } }],
  ]) {
    const run = resolveRunStyle(cascadeRunProperties(inherited, direct, table));
    expect(run.kerningMinPt).toBe(0);
    expect(isRunKerningEnabled({ ...run, fontSizePt: 18 })).toBe(false);
  }
  const authored = cascade(
    '<w:docDefaults><w:rPrDefault><w:rPr><w:kern w:val="40"/></w:rPr></w:rPrDefault></w:docDefaults>'
  );
  expect(resolveRunStyle(authored.docDefaultsRun).kerningMinPt).toBe(20);
});

test('slots no level names take the format faces, or the theme under the application profile', () => {
  const theme = { major: 'Heading', minor: 'Body', majorEastAsia: null, minorEastAsia: 'Body EA' };
  const parsed = readOoxmlPart(
    `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="24"/>` +
      '</w:rPr></w:rPrDefault></w:docDefaults></w:styles>',
    { name: '/word/styles.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const authored = buildStyleCascadeTable(parsed.part.root, theme);
  // Probes d06, d07 and z09-z12: every unnamed slot takes the format face, not the theme.
  const formatted = resolveRunStyle(authored.docDefaultsRun, theme);
  expect([formatted.fontFamily, formatted.fontFamilyEastAsia]).toEqual([
    'Times New Roman',
    'SimSun',
  ]);
  // Probe d09: without an rPrDefault the application profile uses the theme body faces.
  const profiled = resolveRunStyle(buildStyleCascadeTable(null, theme).docDefaultsRun, theme);
  expect([profiled.fontFamily, profiled.fontFamilyEastAsia]).toEqual(['Body', 'Body EA']);
});
