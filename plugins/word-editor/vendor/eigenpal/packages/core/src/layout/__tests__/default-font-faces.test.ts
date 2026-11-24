// Each expectation names the anonymous probe in local/evidence/hansi-font-slots that measured
// it against reference output.

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { readOoxmlPart, type OoxmlElement } from '../../store/package/ooxml-tree.ts';
import { collectThemeSchemeFaces } from '../../store/package/theme-font-scheme.ts';
import {
  fontTableChineseFaces,
  fontTableEastAsianFaces,
  isChineseFace,
  isDefaultEastAsianFace,
  isEastAsianFace,
  isEastAsianFontFamily,
} from '../../store/package/default-font-faces.ts';
import { openHeadlessDocument } from '../../store/headless-document-view.ts';
import { applyEastAsiaFontSlots, type FieldAwarePiece } from '../field-pieces.ts';
import { resolveRunStyle } from '../run-style.ts';
import { COMPRESSED_LEGACY_SPACE_SHRINK, resolveSpaceShrinkRule } from '../space-shrink-rule.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import type { OoxmlProperty } from '../../store/store/tree-op-types.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';

function root(xml: string, name: string): OoxmlElement {
  const parsed = readOoxmlPart(xml, { name, contentType: 'application/xml' });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part.root;
}
const settings = (language: string) =>
  root(
    `<w:settings xmlns:w="${W}"><w:themeFontLang w:eastAsia="${language}"/></w:settings>`,
    '/word/settings.xml'
  );
const emptyTheme = root(
  `<a:theme xmlns:a="${A}"><a:themeElements><a:fontScheme name="T">` +
    '<a:majorFont><a:latin typeface="Major"/><a:ea typeface=""/></a:majorFont>' +
    '<a:minorFont><a:latin typeface="Minor"/><a:ea typeface=""/></a:minorFont>' +
    '</a:fontScheme></a:themeElements></a:theme>',
  '/word/theme/theme1.xml'
);
const fontTable = (entries: string) =>
  root(`<w:fonts xmlns:w="${W}">${entries}</w:fonts>`, '/word/fontTable.xml');

describe('empty East Asian theme slots', () => {
  test.each([
    // [theme language, minor, major]: probes e01/m01, p-minor-*, p-major-*.
    [undefined, 'SimSun', 'SimHei'],
    ['zh-CN', 'SimSun', 'SimHei'],
    ['zh-TW', 'PMingLiU', 'MingLiU'],
    ['ja-JP', 'MS Mincho', 'MS Gothic'],
    ['ko-KR', 'Batang', 'Dotum'],
  ])('a theme part with language %s', (language, minor, major) => {
    const fonts = collectThemeSchemeFaces(emptyTheme, language ? settings(language) : null);
    expect([fonts.minorEastAsia, fonts.majorEastAsia]).toEqual([minor, major]);
  });

  test.each([
    // [theme language, minor, major]: probes x02/m06, z08/p-major-notheme-*, m04, m05.
    [undefined, 'DengXian', 'DengXian Light'],
    ['ja-JP', 'Yu Mincho', 'Yu Gothic Light'],
    ['zh-TW', 'PMingLiU', 'PMingLiU'],
    ['ko-KR', 'Malgun Gothic', 'Malgun Gothic'],
  ])('no theme part with language %s uses the built-in theme', (language, minor, major) => {
    const fonts = collectThemeSchemeFaces(null, language ? settings(language) : null);
    expect([fonts.minorEastAsia, fonts.majorEastAsia]).toEqual([minor, major]);
  });

  test('the run language selects no theme face (probes e03, x07, z02, m03)', () => {
    const run = (language: string): OoxmlProperty[] => [
      { localName: 'rFonts', attributes: { eastAsiaTheme: 'majorEastAsia' } },
      { localName: 'lang', attributes: { eastAsia: language } },
    ];
    const builtIn = collectThemeSchemeFaces(null);
    expect(resolveRunStyle(run('ja-JP'), builtIn).fontFamilyEastAsia).toBe('DengXian Light');
    const themed = collectThemeSchemeFaces(emptyTheme);
    expect(resolveRunStyle(run('ko-KR'), themed).fontFamilyEastAsia).toBe('SimHei');
  });
});

describe('Chinese fonts for the East Asian hint', () => {
  test.each([
    // Installed faces answer by their own character set (c04, c05, c08, c09, c10, c15-c17).
    ['STKaiti', [], true],
    ['华文楷体', [], true],
    ['KaiTi', [], true],
    ['Songti SC', [], true],
    ['Meiryo', [], false],
    ['Meiryo', ['meiryo'], false],
    ['Verdana', ['verdana'], false],
    ['SimSun', [], true],
    // Other faces answer by the font table charset (c01-c03, c11-c14, c18).
    ['Noto Sans SC', [], false],
    ['Noto Sans SC', ['noto sans sc'], true],
    ['Unknown Face', [], false],
    // Spaces do not count; a vertical-writing name is not Chinese (c06, c07).
    [' SimSun ', [], true],
    ['@SimSun', [], false],
  ] as const)('%s with table %j is Chinese: %s', (face, table, chinese) => {
    expect(isChineseFace(face, table)).toBe(chinese);
  });

  test('the font table names GB2312 and Big5 faces only', () => {
    const table = fontTable(
      '<w:font w:name="Gb Face"><w:charset w:val="86"/></w:font>' +
        '<w:font w:name="Big5 Face "><w:charset w:val="88"/></w:font>' +
        '<w:font w:name="Jis Face"><w:charset w:val="80"/></w:font>' +
        '<w:font w:name="Panose Face"><w:panose1 w:val="02010600030101010101"/></w:font>'
    );
    expect(fontTableChineseFaces(table)).toEqual(['gb face', 'big5 face']);
  });
  test('a font table charset makes an unavailable face Chinese for the hint (probe c02)', () => {
    const fonts = collectThemeSchemeFaces(
      emptyTheme,
      null,
      fontTable('<w:font w:name="Noto Sans SC"><w:charset w:val="86"/></w:font>')
    );
    const props: OoxmlProperty[] = [
      {
        localName: 'rFonts',
        attributes: {
          ascii: 'Georgia',
          hAnsi: 'Tahoma',
          eastAsia: 'Noto Sans SC',
          hint: 'eastAsia',
        },
      },
      { localName: 'lang', attributes: { eastAsia: 'ja-JP' } },
    ];
    const eastAsian = (themeFonts: typeof fonts) => {
      const piece: FieldAwarePiece = {
        text: 'aąa',
        props,
        start: 0,
        end: 3,
        style: resolveRunStyle(props, themeFonts),
      };
      return applyEastAsiaFontSlots([piece], themeFonts)
        .filter((p) => p.fontSlot === 'eastAsia')
        .map((p) => p.text)
        .join('');
    };
    expect(eastAsian(fonts)).toBe('ą');
    expect(eastAsian(collectThemeSchemeFaces(emptyTheme))).toBe('');
  });

  test('an opened package carries its font table charsets into layout', () => {
    const files = {
      '[Content_Types].xml':
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/></Types>',
      '_rels/.rels':
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      'word/_rels/document.xml.rels':
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="f" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/></Relationships>',
      'word/document.xml': `<w:document xmlns:w="${W}"><w:body><w:p/></w:body></w:document>`,
      'word/fontTable.xml': `<w:fonts xmlns:w="${W}"><w:font w:name="Noto Sans SC"><w:charset w:val="86"/></w:font></w:fonts>`,
    };
    const opened = openHeadlessDocument(
      zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])))
    );
    if (!opened.ok) throw new Error(opened.reason);
    expect(opened.view.documentThemeFonts().chineseFontTableFaces).toEqual(['noto sans sc']);
  });
});

describe('East Asian default faces for punctuation compression', () => {
  const legacyCompression = root(
    `<w:settings xmlns:w="${W}"><w:characterSpacingControl w:val="compressPunctuation"/>` +
      '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="14"/></w:compat></w:settings>',
    '/word/settings.xml'
  );
  const modernCompression = root(
    `<w:settings xmlns:w="${W}"><w:characterSpacingControl w:val="compressPunctuation"/>` +
      '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>',
    '/word/settings.xml'
  );
  const cascade = (face: string, table: readonly string[] = [], settings = legacyCompression) =>
    buildStyleCascadeTable(
      root(
        `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr>` +
          `<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="${face}"/>` +
          '</w:rPr></w:rPrDefault></w:docDefaults></w:styles>',
        '/word/styles.xml'
      ),
      { major: null, minor: null, eastAsianFontTableFaces: table },
      settings
    );

  test('a known default face shrinks justified spaces in a legacy mode with compression', () => {
    const justified = [{ localName: 'jc', attributes: { val: 'both' } }];
    const typography = cascade('Noto Sans CJK JP').typography;
    expect(typography?.sourceEastAsianFont).toBe(true);
    expect(resolveSpaceShrinkRule(14, justified, typography)).toBe(COMPRESSED_LEGACY_SPACE_SHRINK);
    const natural = cascade('Noto Sans CJK SC').typography;
    expect(natural?.sourceEastAsianFont).toBe(false);
    expect(resolveSpaceShrinkRule(14, justified, natural)).toBeUndefined();
    expect(cascade('Noto Sans CJK SC', ['noto sans cjk sc']).typography?.sourceEastAsianFont).toBe(
      true
    );
  });

  test.each([
    ['Yu Mincho', [], true],
    ['MS Gothic', [], true],
    ['SimSun', [], true],
    ['PMingLiU', [], true],
    ['Batang', [], true],
    ['Malgun Gothic', [], true],
    ['Arial', [], false],
    ['Times New Roman', [], false],
    ['Arial', ['arial'], false],
    ['Unknown Face', [], false],
    ['Unknown Face', ['unknown face'], true],
    ['@Yu Mincho', [], false],
    // A face that is not installed still counts by name.
    ['Noto Sans CJK JP', [], true],
    ['Noto Sans CJK SC', [], false],
    ['Noto Sans CJK SC', ['noto sans cjk sc'], true],
    ['Songti SC', [], true],
    ['Kaiti TC', [], true],
    ['STHeiti', [], true],
    ['Apple SD Gothic Neo', [], true],
  ] as const)('%s with table %j is East Asian: %s', (face, table, eastAsian) => {
    expect(isEastAsianFace(face, table)).toBe(eastAsian);
  });

  // Probe set p1725 (no font table, modes 14 and 15 alike): the default East Asian face that
  // turns compression on.
  test.each([
    ['MS Mincho', true],
    ['Noto Sans CJK JP', true],
    ['Osaka', true],
    ['Osaka-Mono', true],
    ['Nanum Gothic', true],
    ['NanumGothic', true],
    // A full-width at sign is not a vertical-writing name; its full-width character counts.
    ['＠MS Mincho', true],
    ['ＰｉｎｇＦａｎｇ ＳＣ', true],
    ['Ｈｉｒａｇｉｎｏ Ｓａｎｓ', true],
    ['Songti SC', true],
    ['STHeiti', true],
    ['Microsoft YaHei', true],
    ['Apple SD Gothic Neo', true],
    ['Foo 明朝', true],
    ['未知書体', true],
    ['미지글꼴', true],
    ['Ｆｏｏ', true],
    ['ヒラギノ角ゴシック', true],
    ['Hiragino Sans', false],
    ['Hiragino Mincho ProN', false],
    ['Hiragino Kaku Gothic ProN', false],
    ['Hiragino Sans GB', false],
    ['PingFang SC', false],
    ['PingFang HK', false],
    ['Heiti TC', false],
    ['Noto Sans CJK SC', false],
    ['Foo Sans', false],
    ['Foo Mincho', false],
    ['Arial', false],
    ['@MS Mincho', false],
    // The family name alone does not count; its face names do.
    ['Klee', false],
    ['Klee Medium', true],
    ['Klee One', true],
  ] as const)('default face %s counts: %s', (face, counts) => {
    expect(isDefaultEastAsianFace(face, [])).toBe(counts);
    expect(cascade(face).typography?.sourceEastAsianFont).toBe(counts);
    expect(cascade(face, [], modernCompression).typography?.sourceEastAsianFont).toBe(counts);
  });

  test('the font table still makes an uncounted system family count', () => {
    expect(isDefaultEastAsianFace('  HIRAGINO SANS ', [])).toBe(false);
    expect(isDefaultEastAsianFace('OSAKA', [])).toBe(true);
    expect(cascade('PingFang SC', ['pingfang sc']).typography?.sourceEastAsianFont).toBe(true);
    expect(isDefaultEastAsianFace('PingFang SC', ['pingfang sc'])).toBe(true);
    expect(isDefaultEastAsianFace('Hiragino Sans', ['hiragino sans'])).toBe(true);
    expect(isDefaultEastAsianFace('Arial', ['arial'])).toBe(false);
  });

  test('a Korean or Japanese face is never Chinese by the font table', () => {
    expect(isChineseFace('Nanum Gothic', ['nanum gothic'])).toBe(false);
    expect(isChineseFace('Osaka', ['osaka'])).toBe(false);
    expect(isChineseFace('Klee Medium', ['klee medium'])).toBe(false);
  });

  test('the system families still count as East Asian for a font pick', () => {
    for (const family of ['Hiragino Sans', 'PingFang SC', 'Heiti SC', 'Osaka'])
      expect(isEastAsianFontFamily(family)).toBe(true);
  });

  test('the font table names Shift JIS, Hangul, GB2312, and Big5 faces', () => {
    const table = fontTable(
      '<w:font w:name="Jis Face"><w:charset w:val="80"/></w:font>' +
        '<w:font w:name="Hangul Face"><w:charset w:val="81"/></w:font>' +
        '<w:font w:name="Gb Face"><w:charset w:val="86"/></w:font>' +
        '<w:font w:name="Big5 Face"><w:charset w:val="88"/></w:font>' +
        '<w:font w:name="Ansi Face"><w:charset w:val="00"/></w:font>'
    );
    expect(fontTableEastAsianFaces(table)).toEqual([
      'jis face',
      'hangul face',
      'gb face',
      'big5 face',
    ]);
    expect(collectThemeSchemeFaces(null, null, table).eastAsianFontTableFaces).toEqual(
      fontTableEastAsianFaces(table)
    );
  });
});
