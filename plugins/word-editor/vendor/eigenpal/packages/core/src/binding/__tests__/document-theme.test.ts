// Theme colour derivation: `a:clrScheme` projected for the colour picker.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement } from '../../store/package/ooxml-tree.ts';
import { collectDocumentThemeColors, collectDocumentThemeFonts } from '../document-theme.ts';

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';

function themeRoot(scheme: string): OoxmlElement {
  const xml =
    `<a:theme xmlns:a="${A}"><a:themeElements>` +
    `<a:clrScheme name="Office">${scheme}</a:clrScheme>` +
    `</a:themeElements></a:theme>`;
  const result = readOoxmlPart(xml, { name: '/word/theme/theme1.xml', contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part.root;
}

function fontThemeRoot(scheme: string): OoxmlElement {
  const xml =
    `<a:theme xmlns:a="${A}"><a:themeElements>` +
    `<a:fontScheme name="Office">${scheme}</a:fontScheme>` +
    `</a:themeElements></a:theme>`;
  const result = readOoxmlPart(xml, { name: '/word/theme/theme1.xml', contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part.root;
}

const srgb = (slot: string, hex: string) => `<a:${slot}><a:srgbClr val="${hex}"/></a:${slot}>`;

const FULL_SCHEME =
  `<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>` +
  `<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>` +
  srgb('dk2', '44546A') +
  srgb('lt2', 'E7E6E6') +
  srgb('accent1', '4472C4') +
  srgb('accent2', 'ED7D31') +
  srgb('accent3', 'A5A5A5') +
  srgb('accent4', 'FFC000') +
  srgb('accent5', '5B9BD5') +
  srgb('accent6', '70AD47');

describe('collectDocumentThemeColors', () => {
  test('a full scheme answers ten colours in picker order', () => {
    const colors = collectDocumentThemeColors(themeRoot(FULL_SCHEME));
    expect(colors.map((entry) => entry.slot)).toEqual([
      'lt1',
      'dk1',
      'lt2',
      'dk2',
      'accent1',
      'accent2',
      'accent3',
      'accent4',
      'accent5',
      'accent6',
    ]);
    expect(colors[0]!.hex).toBe('FFFFFF');
    expect(colors[1]!.hex).toBe('000000');
    expect(colors[4]!.hex).toBe('4472C4');
  });

  test('sysClr without lastClr resolves through the known OS colours', () => {
    const scheme = FULL_SCHEME.replace(
      '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>',
      '<a:dk1><a:sysClr val="windowText"/></a:dk1>'
    );
    const colors = collectDocumentThemeColors(themeRoot(scheme));
    expect(colors[1]!.hex).toBe('000000');
  });

  test('an incomplete scheme answers nothing rather than a matrix with holes', () => {
    const scheme = FULL_SCHEME.replace(srgb('accent6', '70AD47'), '');
    expect(collectDocumentThemeColors(themeRoot(scheme))).toEqual([]);
  });

  test('an invalid hex refuses the whole scheme, never repairs', () => {
    const scheme = FULL_SCHEME.replace('4472C4', 'url(x)');
    expect(collectDocumentThemeColors(themeRoot(scheme))).toEqual([]);
  });

  test('no theme root answers nothing', () => {
    expect(collectDocumentThemeColors(null)).toEqual([]);
  });
});

test('theme fonts accept faces only beneath their schema slot', () => {
  const malformed = collectDocumentThemeFonts(
    fontThemeRoot(
      '<a:latin typeface="Injected"/><a:ea typeface="Injected EA"/>' +
        '<a:minorFont><a:latin typeface="Valid Minor"/><a:ea typeface="Valid EA"/></a:minorFont>'
    )
  );

  // An East Asian slot the theme leaves empty takes the Simplified Chinese default face:
  // SimHei for headings (probes m01, p-major-zhcn), SimSun for body text (e01).
  expect(malformed).toMatchObject({
    major: null,
    minor: 'Valid Minor',
    majorEastAsia: 'SimHei',
    minorEastAsia: 'Valid EA',
    majorBidi: null,
    minorBidi: null,
  });
});

test('supplemental CJK theme faces remain independent and validate authored font names', () => {
  const theme = collectDocumentThemeFonts(
    fontThemeRoot(
      '<a:majorFont><a:ea typeface=""/><a:font script="Hans" typeface="Heading"/></a:majorFont>' +
        '<a:minorFont><a:ea typeface=""/><a:font script="Hans" typeface="Body"/><a:font script="Jpan" typeface="ＭＳ 明朝"/>' +
        '<a:font script="Hant" typeface="bad&quot;;face"/><a:font script="__proto__" typeface="Invalid"/></a:minorFont>'
    )
  );
  // Without a theme language, an empty East Asian slot takes the Simplified Chinese
  // supplemental face (probes m02, z01-z04).
  expect(theme.majorEastAsia).toBe('Heading');
  expect(theme.minorEastAsia).toBe('Body');
  expect(theme.majorSupplemental).toEqual({ Hans: 'Heading' });
  expect(theme.minorSupplemental).toEqual({ Hans: 'Body', Jpan: 'ＭＳ 明朝' });
});

test('supplemental theme names retain safe punctuation as one whole family', () => {
  const theme = collectDocumentThemeFonts(
    fontThemeRoot(
      '<a:minorFont><a:font script="Hans" typeface="Georgia;Verdana"/>' +
        '<a:font script="Hant" typeface="Georgia,Verdana"/></a:minorFont>'
    )
  );
  expect(theme.minorSupplemental).toEqual({ Hans: 'Georgia;Verdana', Hant: 'Georgia,Verdana' });
});
