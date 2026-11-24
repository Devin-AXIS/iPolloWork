// Effective run defaults: style chain + docDefaults + theme fonts.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement } from '../../store/package/ooxml-tree.ts';
import { createRunDefaultsResolver } from '../document-run-defaults.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function stylesRoot(body: string): OoxmlElement {
  const result = readOoxmlPart(`<w:styles xmlns:w="${W}">${body}</w:styles>`, {
    name: '/word/styles.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part.root;
}

const DOC_DEFAULTS =
  '<w:docDefaults><w:rPrDefault><w:rPr>' +
  '<w:rFonts w:ascii="Aptos" w:hAnsi="Aptos"/><w:sz w:val="22"/>' +
  '</w:rPr></w:rPrDefault></w:docDefaults>';

const NO_THEME = { major: null, minor: null };

describe('createRunDefaultsResolver', () => {
  test('no style falls through to docDefaults', () => {
    const resolve = createRunDefaultsResolver(stylesRoot(DOC_DEFAULTS), NO_THEME);
    expect(resolve(null)).toEqual({ fontFamily: 'Aptos', fontSizeHalfPoints: 22 });
  });

  test("a style's own rPr wins over docDefaults", () => {
    const resolve = createRunDefaultsResolver(
      stylesRoot(
        DOC_DEFAULTS +
          '<w:style w:type="paragraph" w:styleId="Title"><w:rPr>' +
          '<w:rFonts w:ascii="Georgia"/><w:sz w:val="52"/></w:rPr></w:style>'
      ),
      NO_THEME
    );
    expect(resolve('Title')).toEqual({ fontFamily: 'Georgia', fontSizeHalfPoints: 52 });
  });

  test('missing pieces resolve through the basedOn chain', () => {
    const resolve = createRunDefaultsResolver(
      stylesRoot(
        DOC_DEFAULTS +
          '<w:style w:type="paragraph" w:styleId="Base"><w:rPr>' +
          '<w:rFonts w:ascii="Cambria"/></w:rPr></w:style>' +
          '<w:style w:type="paragraph" w:styleId="Child"><w:basedOn w:val="Base"/>' +
          '<w:rPr><w:sz w:val="36"/></w:rPr></w:style>'
      ),
      NO_THEME
    );
    // Size from Child, family from Base, nothing left for docDefaults to fill.
    expect(resolve('Child')).toEqual({ fontFamily: 'Cambria', fontSizeHalfPoints: 36 });
  });

  test('a basedOn cycle terminates and still answers docDefaults', () => {
    const resolve = createRunDefaultsResolver(
      stylesRoot(
        DOC_DEFAULTS +
          '<w:style w:type="paragraph" w:styleId="A"><w:basedOn w:val="B"/></w:style>' +
          '<w:style w:type="paragraph" w:styleId="B"><w:basedOn w:val="A"/></w:style>'
      ),
      NO_THEME
    );
    expect(resolve('A')).toEqual({ fontFamily: 'Aptos', fontSizeHalfPoints: 22 });
  });

  test('theme rFonts attributes resolve through the font scheme', () => {
    const resolve = createRunDefaultsResolver(
      stylesRoot(
        '<w:docDefaults><w:rPrDefault><w:rPr>' +
          '<w:rFonts w:asciiTheme="minorHAnsi"/><w:sz w:val="22"/>' +
          '</w:rPr></w:rPrDefault></w:docDefaults>'
      ),
      { major: 'Calibri Light', minor: 'Calibri' }
    );
    expect(resolve(null)).toEqual({ fontFamily: 'Calibri', fontSizeHalfPoints: 22 });
  });

  test('a theme-only run-level rFonts overrides the chain family', () => {
    const resolve = createRunDefaultsResolver(stylesRoot(DOC_DEFAULTS), {
      major: 'Calibri Light',
      minor: 'Calibri',
    });
    const result = resolve(null, [
      { localName: 'rFonts', attributes: { asciiTheme: 'majorHAnsi' } },
    ]);
    expect(result).toEqual({ fontFamily: 'Calibri Light', fontSizeHalfPoints: 22 });
  });

  test('an East Asian token on a Latin slot resolves the a:ea face, never the Latin one', () => {
    // `w:asciiTheme="minorEastAsia"` is legal: Word's "use East Asian fonts also on
    // Latin text". The token decides the face; the attribute that carried it does not.
    const styles = stylesRoot(
      '<w:docDefaults><w:rPrDefault><w:rPr>' +
        '<w:rFonts w:asciiTheme="minorEastAsia"/><w:sz w:val="22"/>' +
        '</w:rPr></w:rPrDefault></w:docDefaults>'
    );
    const withEastAsia = createRunDefaultsResolver(styles, {
      major: 'Calibri Light',
      minor: 'Calibri',
      majorEastAsia: 'MS Gothic',
      minorEastAsia: 'SimSun',
    });
    expect(withEastAsia(null).fontFamily).toBe('SimSun');
    // A theme with no `a:ea` faces answers an honest null, not the Latin face.
    const withoutEastAsia = createRunDefaultsResolver(styles, {
      major: 'Calibri Light',
      minor: 'Calibri',
      majorEastAsia: null,
      minorEastAsia: null,
    });
    expect(withoutEastAsia(null).fontFamily).toBeNull();
  });

  test('an invalid name paints in the unmatched face; an out-of-range size is dropped', () => {
    const resolve = createRunDefaultsResolver(
      stylesRoot(
        '<w:docDefaults><w:rPrDefault><w:rPr>' +
          '<w:rFonts w:ascii="url(javascript:x);"/><w:sz w:val="99999"/>' +
          '</w:rPr></w:rPrDefault></w:docDefaults>'
      ),
      NO_THEME
    );
    // The answer is the engine's own constant, never the file's text.
    expect(resolve(null)).toEqual({ fontFamily: 'Cambria', fontSizeHalfPoints: null });
  });

  test('a name written as a list resolves to its first item', () => {
    const resolve = createRunDefaultsResolver(
      stylesRoot(
        '<w:docDefaults><w:rPrDefault><w:rPr>' +
          '<w:rFonts w:ascii="Verdana, Geneva, sans-serif"/>' +
          '</w:rPr></w:rPrDefault></w:docDefaults>'
      ),
      NO_THEME
    );
    expect(resolve(null).fontFamily).toBe('Verdana');
  });

  test('no styles part answers nulls', () => {
    const resolve = createRunDefaultsResolver(null, NO_THEME);
    expect(resolve('Anything')).toEqual({ fontFamily: null, fontSizeHalfPoints: null });
  });
});
