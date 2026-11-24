// The offerable font catalog: configured families merged with document-declared ones.
//
// What these tests pin down: the catalog is never empty (the default face is always
// offerable), substitution WORD-names are offered while their stand-in faces are not,
// host-registered families join, document fonts merge with configuration-first casing,
// and invalid names drop at this boundary like every other catalog derivation.

import { describe, expect, test } from 'bun:test';
import { availableFontFamilies, configuredDefaultFontFamily } from '../font-catalog.ts';
import { resolveMarkAttr } from '../docx-editor-support.ts';

const face = (family: string, weight = 400, style: 'normal' | 'italic' = 'normal') => ({
  family,
  weight,
  style,
});

const source = (family: string) => ({
  request: face(family),
  id: `test:${family}`,
  bytes: new Uint8Array(0),
  hash: 'x',
  faceIndex: 0,
});

describe('configuredDefaultFontFamily', () => {
  test('answers Word default when nothing is configured', () => {
    expect(configuredDefaultFontFamily(undefined)).toBe('Calibri');
    expect(configuredDefaultFontFamily({})).toBe('Calibri');
  });

  test('answers the configured face, but never an invalid name', () => {
    expect(
      configuredDefaultFontFamily({ defaultFont: { family: 'Aptos', sizeHalfPoints: 24 } })
    ).toBe('Aptos');
    expect(
      configuredDefaultFontFamily({
        defaultFont: { family: 'bad"family;url(', sizeHalfPoints: 24 },
      })
    ).toBe('Calibri');
  });
});

const STANDARD_FONTS = [
  'Arial',
  'Calibri',
  'Cambria',
  'Consolas',
  'Courier New',
  'Garamond',
  'Georgia',
  'Helvetica',
  'Open Sans',
  'Roboto',
  'Times New Roman',
  'Verdana',
];

const withStandardFonts = (...families: string[]) =>
  [...new Set([...STANDARD_FONTS, ...families])].sort();

describe('availableFontFamilies', () => {
  test('blank and populated documents offer the same standard choices', () => {
    expect(availableFontFamilies(undefined, [])).toEqual(STANDARD_FONTS);
    expect(availableFontFamilies(undefined, ['Arial', 'Georgia'])).toEqual(STANDARD_FONTS);
  });

  test('substitution Word-names are offered; their stand-in faces are not', () => {
    const catalog = availableFontFamilies(
      {
        sources: [source('Carlito'), source('Liberation Serif')],
        substitutions: [
          { from: face('Calibri'), to: face('Carlito') },
          { from: face('Times New Roman'), to: face('Liberation Serif') },
        ],
      },
      []
    );
    expect(catalog).toEqual(STANDARD_FONTS);
  });

  test('host-registered families that stand in for nothing are offered', () => {
    expect(availableFontFamilies({ sources: [source('Inter')] }, [])).toEqual(
      withStandardFonts('Inter')
    );
  });

  test('document fonts merge, dedup case-insensitively with configured casing winning', () => {
    const catalog = availableFontFamilies(
      { substitutions: [{ from: face('Arial'), to: face('Liberation Sans') }] },
      ['arial', 'Georgia', 'CALIBRI']
    );
    expect(catalog).toEqual(STANDARD_FONTS);
  });

  test('invalid document names are dropped, never repaired', () => {
    const catalog = availableFontFamilies(undefined, ['Georgia', 'x'.repeat(65), 'bad";name']);
    expect(catalog).toEqual(STANDARD_FONTS);
  });

  test('a face supplied for a symbol is offerable, like every other honoured family', () => {
    // The editor asks the resolver for the face a `w:sym` names. Once an app answers, the
    // editor can honour that family for text too, which is the only question this catalog
    // asks — Word lists installed symbol fonts in its own picker for the same reason. A
    // symbol face nothing supplied never reaches here: `collectDocumentFonts` reads
    // `w:rFonts` declarations, and a `w:sym` face is not one.
    const catalog = availableFontFamilies({ sources: [source('Wingdings')] }, ['Georgia']);
    expect(catalog).toEqual(withStandardFonts('Wingdings'));
  });
});

test('document-only families still join the standard catalog', () => {
  expect(availableFontFamilies(undefined, ['Sagona', 'sagona', 'bad";name'])).toEqual(
    withStandardFonts('Sagona')
  );
});

test('punctuated font references remain one catalog entry', () => {
  const catalog = availableFontFamilies(undefined, ['Georgia;Verdana', 'Georgia,Verdana']);
  expect(catalog).toContain('Georgia;Verdana');
  expect(catalog).toContain('Georgia,Verdana');
  expect(catalog.filter((family) => family === 'Georgia')).toHaveLength(1);
});

test('every listed punctuated name is a valid font family command value', () => {
  const catalog = availableFontFamilies(undefined, [
    'Georgia;Verdana',
    'Georgia,Verdana',
    '宋体;SimSun',
  ]);
  expect(catalog).toContain('宋体;SimSun');
  for (const family of catalog) {
    expect(resolveMarkAttr({ mark: 'fontFamily', value: family })).toEqual({
      ok: true,
      localName: 'rFonts',
      attributes: { ascii: family, hAnsi: family },
    });
  }
  for (const value of ['', ' ', 'A";color:red', 'A\\B', 'A\nB', 'A\u0000B', 'A'.repeat(65), 7]) {
    expect(resolveMarkAttr({ mark: 'fontFamily', value })).toMatchObject({
      ok: false,
      code: 'invalidArgs',
    });
  }
});

describe('standard choices the platform cannot draw', () => {
  const installed = (names: readonly string[]) => (family: string) => names.includes(family);

  test('an unserved standard choice is offered only where it is installed', () => {
    const fonts = availableFontFamilies(undefined, [], installed(['Georgia']));
    expect(fonts).toContain('Georgia');
    expect(fonts).not.toContain('Verdana');
    expect(fonts).not.toContain('Consolas');
    // The default face is always offerable.
    expect(fonts).toContain('Calibri');
  });

  test('a standard choice a configured source serves is offered without being installed', () => {
    const fonts = availableFontFamilies(
      { supportedFamilies: ['Helvetica', 'Times New Roman'] },
      [],
      installed([])
    );
    expect(fonts).toContain('Helvetica');
    expect(fonts).toContain('Times New Roman');
    expect(fonts).not.toContain('Garamond');
  });

  test('a family the document uses is offered whatever the platform has', () => {
    expect(availableFontFamilies(undefined, ['Verdana'], installed([]))).toContain('Verdana');
  });

  test('without an installed check every standard choice stays', () => {
    expect(availableFontFamilies(undefined, [])).toContain('Garamond');
  });
});
