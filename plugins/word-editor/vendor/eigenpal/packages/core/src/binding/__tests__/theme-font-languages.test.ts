import { expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement } from '../../store/package/ooxml-tree.ts';
import {
  collectThemeSchemeFaces,
  themeFontFamilyOf,
} from '../../store/package/theme-font-scheme.ts';
import { collectDocumentFonts } from '../document-catalog.ts';
import {
  collectRenderedFontFamilies,
  collectRenderedFontFamilyCandidates,
} from '../../store/package/rendered-fonts.ts';
import { resolveRunStyle } from '../../layout/run-style.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
function root(xml: string, name = '/word/styles.xml'): OoxmlElement {
  const parsed = readOoxmlPart(xml, { name, contentType: 'application/xml' });
  if (!parsed.ok) throw Error(parsed.reason);
  return parsed.part.root;
}
const theme = root(
  `<a:theme xmlns:a="${A}"><a:themeElements><a:fontScheme name="Languages">` +
    '<a:majorFont><a:latin typeface="Latin Heading"/><a:ea typeface="EA Heading"/><a:cs typeface="CS Heading"/>' +
    '<a:font script="Arab" typeface="Times New Roman"/><a:font script="Jpan" typeface="Japanese Heading"/></a:majorFont>' +
    '<a:minorFont><a:latin typeface="Latin Body"/><a:ea typeface=""/><a:cs typeface="CS Body"/>' +
    '<a:font script="Arab" typeface="Arial"/><a:font script="Hebr" typeface="Hebrew Body"/>' +
    '<a:font script="Jpan" typeface="Japanese Body"/><a:font script="Hans" typeface="Chinese Body"/></a:minorFont>' +
    '</a:fontScheme></a:themeElements></a:theme>',
  '/word/theme/theme1.xml'
);
const settings = (attributes: string) =>
  root(
    `<w:settings xmlns:w="${W}"><w:themeFontLang ${attributes}/></w:settings>`,
    '/word/settings.xml'
  );

test('document language selects each theme token independently of its run font attribute', () => {
  const fonts = collectThemeSchemeFaces(
    theme,
    settings('w:val="ja-JP" w:eastAsia="zh-CN" w:bidi="ar-SA"')
  );
  expect(themeFontFamilyOf('majorHAnsi', fonts)).toBe('Japanese Heading');
  expect(themeFontFamilyOf('minorAscii', fonts)).toBe('Japanese Body');
  expect(themeFontFamilyOf('minorEastAsia', fonts, 'ja-JP')).toBe('Chinese Body');
  expect(themeFontFamilyOf('majorBidi', fonts)).toBe('Times New Roman');
  expect(themeFontFamilyOf('minorBidi', fonts)).toBe('Arial');
  expect(
    resolveRunStyle(
      [{ localName: 'rFonts', attributes: { ascii: 'Legacy', asciiTheme: 'majorBidi' } }],
      fonts
    ).fontFamily
  ).toBe('Times New Roman');
});

test('absent theme languages retain regional defaults; the run language picks no face', () => {
  const fonts = collectThemeSchemeFaces(theme);
  expect(themeFontFamilyOf('majorBidi', fonts)).toBe('CS Heading');
  expect(themeFontFamilyOf('minorBidi', fonts)).toBe('CS Body');
  expect(themeFontFamilyOf('minorHAnsi', fonts)).toBe('Latin Body');
  // Without a theme language the empty East Asian slot takes the Simplified Chinese face,
  // whatever language the run declares (probes z01-z04 in local/evidence/hansi-font-slots).
  expect(themeFontFamilyOf('minorEastAsia', fonts, 'ja-JP')).toBe('Chinese Body');
  const bidiOnly = collectThemeSchemeFaces(theme, settings('w:bidi="ar-SA"'));
  expect(themeFontFamilyOf('minorEastAsia', bidiOnly, 'ja-JP')).toBe('Chinese Body');
});

test.each(['ar-SA', 'fa-IR', 'ur-PK', 'und-Arab', 'az-Arab'])(
  '%s selects the authored Arabic supplemental face',
  (language) => {
    const fonts = collectThemeSchemeFaces(theme, settings(`w:bidi="${language}"`));
    expect(themeFontFamilyOf('majorBidi', fonts)).toBe('Times New Roman');
  }
);

test('explicit script overrides the usual language script and unavailable scripts retain the regional face', () => {
  expect(collectThemeSchemeFaces(theme, settings('w:bidi="ar-Hebr"')).minorBidi).toBe(
    'Hebrew Body'
  );
  for (const language of ['ar-Latn', 'en-US', '__proto__', 'xx-' + 'x'.repeat(90)]) {
    expect(collectThemeSchemeFaces(theme, settings(`w:bidi="${language}"`)).minorBidi).toBe(
      'CS Body'
    );
  }
});

test('font catalogs and rendered style indexes invalidate when only the bidi face changes', () => {
  const body = root(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:rPr><w:rFonts w:asciiTheme="majorBidi"/></w:rPr><w:t>Text</w:t></w:r></w:p></w:body></w:document>`,
    '/word/document.xml'
  );
  const bareBody = root(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Text</w:t></w:r></w:p></w:body></w:document>`,
    '/word/document.xml'
  );
  const styles = root(
    `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="majorBidi"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`
  );
  const before = collectThemeSchemeFaces(theme);
  const after = collectThemeSchemeFaces(theme, settings('w:bidi="ar-SA"'));
  for (const [fonts, family] of [
    [before, 'CS Heading'],
    [after, 'Times New Roman'],
  ] as const) {
    expect(collectDocumentFonts([body], fonts)).toEqual([family]);
    // Default candidates remain visible even when a direct run font shadows them.
    expect(collectRenderedFontFamilyCandidates([body], null, fonts)).toEqual({
      direct: [family],
      inherited: ['Latin Body'],
    });
    // The notice's answer is what text renders in: the direct face shadows the default.
    expect(collectRenderedFontFamilies([body], null, fonts)).toEqual([family]);
    expect(collectRenderedFontFamilies([bareBody], styles, fonts)).toEqual([family]);
  }
});

test('an omitted East Asian slot uses the document body face after every authored style', () => {
  const fonts = collectThemeSchemeFaces(theme, settings('w:val="ja-JP" w:eastAsia="zh-CN"'));
  for (const attributes of [
    {},
    { ascii: 'Arial' },
    { asciiTheme: 'majorHAnsi' },
    { asciiTheme: 'minorHAnsi' },
  ]) {
    expect(resolveRunStyle([{ localName: 'rFonts', attributes }], fonts).fontFamilyEastAsia).toBe(
      'Chinese Body'
    );
  }
  expect(
    resolveRunStyle([{ localName: 'rFonts', attributes: { eastAsia: 'Explicit EA' } }], fonts)
      .fontFamilyEastAsia
  ).toBe('Explicit EA');
  expect(
    resolveRunStyle(
      [
        { localName: 'rFonts', attributes: { eastAsia: 'Inherited EA' } },
        { localName: 'rFonts', attributes: { ascii: 'Arial' } },
      ],
      fonts
    ).fontFamilyEastAsia
  ).toBe('Inherited EA');
  expect(
    resolveRunStyle(
      [{ localName: 'rFonts', attributes: { eastAsiaTheme: 'majorEastAsia' } }],
      fonts
    ).fontFamilyEastAsia
  ).toBe('EA Heading');
  expect(
    resolveRunStyle([], collectThemeSchemeFaces(null, settings('w:eastAsia="zh-CN"')))
      .fontFamilyEastAsia
  ).toBe('DengXian'); // No theme part: the built-in theme's face (probes x01, x02, z07).
});
