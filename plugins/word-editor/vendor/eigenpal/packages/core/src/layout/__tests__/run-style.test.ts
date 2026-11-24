// The accepted run property boundary, resolved for layout (task 7.2).

import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_RUN_STYLE,
  displayText,
  resolveRunStyle,
  runStylesEqual,
  withFontFamily,
} from '../run-style.ts';
import { styleForFontSlot } from '../script-itemization.ts';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { collectThemeSchemeFaces } from '../../store/package/theme-font-scheme.ts';

const resolve = (localName: string, attributes?: Record<string, string>) =>
  resolveRunStyle([attributes ? { localName, attributes } : { localName }]);

describe('every D8 run property resolves', () => {
  test('Word falls back to 10pt when no style level authors a size', () => {
    expect(resolveRunStyle([]).fontSizePt).toBe(10);
  });

  test('font family from ascii, falling back to hAnsi', () => {
    expect(resolve('rFonts', { ascii: 'Calibri' }).fontFamily).toBe('Calibri');
    expect(resolve('rFonts', { hAnsi: 'Georgia' }).fontFamily).toBe('Georgia');
    // Without a theme there is nothing to resolve a theme-only reference against.
    expect(resolve('rFonts', { asciiTheme: 'minorHAnsi' }).fontFamily).toBeNull();
  });

  test('a name written as a list paints in its first item, an unusable one in Cambria', () => {
    expect(resolve('rFonts', { ascii: 'Verdana, Geneva, sans-serif' }).fontFamily).toBe('Verdana');
    // A quoted first item names no face, so the text paints in the unmatched face.
    expect(resolve('rFonts', { ascii: '"Open Sans", sans-serif' }).fontFamily).toBe('Cambria');
    expect(resolve('rFonts', { cs: '"Calibri", Arial' }).complexLane?.fontFamily).toBe('Cambria');
    // Length alone does not change the face: a name past every bound paints in Cambria too.
    expect(resolve('rFonts', { ascii: 'A'.repeat(100) }).fontFamily).toBe('Cambria');
    expect(resolve('rFonts', { ascii: 'A'.repeat(2000) }).fontFamily).toBe('Cambria');
    // A vertical-writing name is read as written.
    expect(resolve('rFonts', { eastAsia: '@MS Gothic' }).fontFamilyEastAsia).toBe('@MS Gothic');
  });

  test('half-point size becomes points', () => {
    expect(resolve('sz', { val: '22' }).fontSizePt).toBe(11);
    expect(resolve('sz', { val: '36' }).fontSizePt).toBe(18);
  });

  test('colour, and auto meaning inherited', () => {
    expect(resolve('color', { val: 'c00000' }).color).toBe('C00000');
    expect(resolve('color', { val: 'auto' }).color).toBeNull();
  });

  test('bold and italic honour toggle semantics', () => {
    expect(resolve('b').bold).toBe(true);
    expect(resolve('b', { val: '0' }).bold).toBe(false);
    expect(resolve('i', { val: 'off' }).italic).toBe(false);
  });

  test('underline keeps its variant and colour', () => {
    // Without `w:val` the element draws no underline of its own, even with a colour.
    expect(resolve('u').underline).toBeNull();
    expect(resolve('u', { color: 'FF00FF' }).underline).toBeNull();
    // A colour-only element over an inherited underline keeps its variant.
    expect(
      resolveRunStyle([
        { localName: 'u', attributes: { val: 'double' } },
        { localName: 'u', attributes: { color: 'FF00FF' } },
      ]).underline
    ).toEqual({ variant: 'double', color: 'FF00FF' });
    expect(resolve('u', { val: 'wave', color: 'FF0000' }).underline).toEqual({
      variant: 'wave',
      color: 'FF0000',
    });
    expect(resolve('u', { val: 'none' }).underline).toBeNull();
  });

  test('fixture underline variants resolve without collapsing thick or double', () => {
    expect(resolve('u', { val: 'thick' }).underline).toEqual({ variant: 'thick', color: null });
    expect(resolve('u', { val: 'double' }).underline).toEqual({ variant: 'double', color: null });
    expect(resolve('u', { val: 'dotted' }).underline).toEqual({ variant: 'dotted', color: null });
    expect(resolve('u', { val: 'dash' }).underline).toEqual({ variant: 'dash', color: null });
  });

  test('strike and double strike are separate properties', () => {
    expect(resolve('strike').strike).toBe(true);
    expect(resolve('dstrike').doubleStrike).toBe(true);
    expect(resolve('strike').doubleStrike).toBe(false);
  });

  test('strike and dstrike can both be present; paint chooses double', () => {
    const style = resolveRunStyle([{ localName: 'strike' }, { localName: 'dstrike' }]);
    expect(style.strike).toBe(true);
    expect(style.doubleStrike).toBe(true);
  });

  test('a hostile underline colour is dropped at resolve', () => {
    expect(resolve('u', { val: 'single', color: 'javascript:alert(1)' }).underline).toEqual({
      variant: 'single',
      color: null,
    });
  });

  test('highlight, and none meaning absent', () => {
    expect(resolve('highlight', { val: 'yellow' }).highlight).toBe('yellow');
    expect(resolve('highlight', { val: 'none' }).highlight).toBeNull();
  });

  test('character shading is a strict hex fill', () => {
    expect(resolve('shd', { val: 'clear', fill: 'FFEEAA' }).shading).toBe('FFEEAA');
    expect(resolve('shd', { val: 'clear', fill: 'auto' }).shading).toBeNull();
    expect(resolve('shd', { val: 'nil', fill: 'FFEEAA' }).shading).toBeNull();
    expect(resolve('shd', { val: 'clear', fill: 'url(x)' }).shading).toBeNull();
  });

  test('vertical alignment and baseline shift', () => {
    expect(resolve('vertAlign', { val: 'superscript' }).verticalAlign).toBe('superscript');
    expect(resolve('vertAlign', { val: 'subscript' }).verticalAlign).toBe('subscript');
    // `w:position` is signed half-points; positive raises.
    expect(resolve('position', { val: '12' }).baselineShiftPt).toBe(6);
    expect(resolve('position', { val: '-8' }).baselineShiftPt).toBe(-4);
  });

  test('caps and small caps', () => {
    expect(resolve('caps').caps).toBe(true);
    expect(resolve('smallCaps').smallCaps).toBe(true);
  });

  test('character spacing in twips, horizontal scaling, kerning', () => {
    expect(resolve('spacing', { val: '20' }).characterSpacingPt).toBe(1);
    expect(resolve('spacing', { val: '-10' }).characterSpacingPt).toBe(-0.5);
    expect(resolve('w', { val: '150' }).horizontalScalePercent).toBe(150);
    expect(resolve('kern', { val: '16' }).kerningMinPt).toBe(8);
  });

  test('an unresolvable value leaves the default rather than guessing', () => {
    // A wrong measurement moves every glyph after it; a missing one is visible at once.
    expect(resolve('sz', { val: 'large' }).fontSizePt).toBe(DEFAULT_RUN_STYLE.fontSizePt);
    expect(resolve('w', { val: '0' }).horizontalScalePercent).toBe(100);
    expect(resolve('color', { val: 'notacolour' }).color).toBeNull();
  });

  test('later properties win, as a single rPr is read in order', () => {
    const style = resolveRunStyle([
      { localName: 'sz', attributes: { val: '22' } },
      { localName: 'sz', attributes: { val: '44' } },
    ]);
    expect(style.fontSizePt).toBe(22);
  });
});

describe('a w:rFonts theme reference resolves against the theme part', () => {
  // Word writes the body font as `w:asciiTheme="minorHAnsi"`, usually in `w:docDefaults`,
  // so in a themed document EVERY run reaches here with no explicit family. Leaving those
  // unresolved put the whole document on the surface's fallback face.
  const theme = { major: 'Aharoni', minor: 'Grandview' };
  const themed = (attributes: Record<string, string>) =>
    resolveRunStyle([{ localName: 'rFonts', attributes }], theme).fontFamily;

  test('minor is body text, major is headings', () => {
    expect(themed({ asciiTheme: 'minorHAnsi' })).toBe('Grandview');
    expect(themed({ asciiTheme: 'majorHAnsi' })).toBe('Aharoni');
    // The `*Ascii` spellings name the same two slots.
    expect(themed({ asciiTheme: 'minorAscii' })).toBe('Grandview');
    expect(themed({ hAnsiTheme: 'majorAscii' })).toBe('Aharoni');
  });

  test('the theme attribute overrides the explicit name beside it', () => {
    // Word writes both: the concrete name is there for readers that cannot resolve a
    // theme, and following it would ignore a retheme the author can see (§17.3.2.26).
    expect(themed({ ascii: 'Calibri', asciiTheme: 'minorHAnsi' })).toBe('Grandview');
  });

  test('an unresolvable slot falls back to the explicit name, not to nothing', () => {
    // `minorBidi` names the `a:cs` face this lane does not read.
    expect(themed({ ascii: 'Calibri', asciiTheme: 'minorBidi' })).toBe('Calibri');
    // A theme whose slot is empty leaves the run inheriting rather than naming null.
    expect(
      resolveRunStyle([{ localName: 'rFonts', attributes: { asciiTheme: 'minorHAnsi' } }], {
        major: null,
        minor: null,
      }).fontFamily
    ).toBeNull();
  });
});

describe('the w:rFonts eastAsia slot resolves beside the Latin one', () => {
  const theme = {
    major: 'Aharoni',
    minor: 'Grandview',
    majorEastAsia: 'MS Gothic',
    minorEastAsia: 'SimSun',
  };
  const resolved = (attributes: Record<string, string>, themeFonts = theme) =>
    resolveRunStyle([{ localName: 'rFonts', attributes }], themeFonts);

  test('an explicit w:eastAsia resolves without touching the Latin family', () => {
    const style = resolved({ eastAsia: 'SimSun' });
    expect(style.fontFamilyEastAsia).toBe('SimSun');
    expect(style.fontFamily).toBe('Grandview');
  });

  test('a Latin-only rFonts leaves the eastAsia slot inherited', () => {
    expect(
      resolveRunStyle(
        [
          { localName: 'rFonts', attributes: { eastAsia: 'Inherited CJK' } },
          { localName: 'rFonts', attributes: { ascii: 'Arial' } },
        ],
        theme
      ).fontFamilyEastAsia
    ).toBe('Inherited CJK');
    expect(resolved({ ascii: 'Arial' }).fontFamilyEastAsia).toBe('SimSun');
  });

  test('w:eastAsiaTheme resolves against the a:ea typefaces', () => {
    expect(resolved({ eastAsiaTheme: 'minorEastAsia' }).fontFamilyEastAsia).toBe('SimSun');
    expect(resolved({ eastAsiaTheme: 'majorEastAsia' }).fontFamilyEastAsia).toBe('MS Gothic');
  });

  test('the theme attribute overrides the explicit name beside it (§17.3.2.26)', () => {
    expect(
      resolved({ eastAsia: 'PMingLiU', eastAsiaTheme: 'minorEastAsia' }).fontFamilyEastAsia
    ).toBe('SimSun');
  });

  test('an unresolvable theme slot falls back to the explicit name, not to nothing', () => {
    expect(
      resolved(
        { eastAsia: 'PMingLiU', eastAsiaTheme: 'minorEastAsia' },
        { major: null, minor: null }
      ).fontFamilyEastAsia
    ).toBe('PMingLiU');
  });

  test('the East Asian tokens are legal on the LATIN theme attributes too', () => {
    // Word's "use East Asian fonts also on Latin text" writes `w:asciiTheme="minorEastAsia"`;
    // both scripts then paint in the East Asian face rather than Latin falling to the default.
    const style = resolved({ asciiTheme: 'minorEastAsia', eastAsiaTheme: 'minorEastAsia' });
    expect(style.fontFamily).toBe('SimSun');
    expect(style.fontFamilyEastAsia).toBe('SimSun');
  });

  test('styles differing only in the eastAsia face are not equal', () => {
    expect(
      runStylesEqual(resolved({ eastAsia: 'SimSun' }), resolved({ eastAsia: 'MS Mincho' }))
    ).toBe(false);
  });
});

describe('withFontFamily — the one memoized face derivation', () => {
  test('swaps the family and memoizes per (style, family)', () => {
    const style = resolveRunStyle([
      { localName: 'rFonts', attributes: { ascii: 'Arial', eastAsia: 'SimSun' } },
    ]);
    const derived = withFontFamily(style, 'SimSun');
    expect(derived.fontFamily).toBe('SimSun');
    expect(derived.fontFamilyEastAsia).toBe('SimSun');
    expect(derived.fontSizePt).toBe(style.fontSizePt);
    expect(withFontFamily(style, 'SimSun')).toBe(derived);
    expect(withFontFamily(style, 'Cambria Math')).not.toBe(derived);
  });

  test('answers the style itself when the family already matches', () => {
    const same = resolveRunStyle([{ localName: 'rFonts', attributes: { ascii: 'SimSun' } }]);
    expect(withFontFamily(same, 'SimSun')).toBe(same);
  });
});

describe('styleForFontSlot resolves the face a slotted piece measures and paints in', () => {
  test('the eastAsia slot answers the eastAsia face, memoized', () => {
    const style = resolveRunStyle([
      { localName: 'rFonts', attributes: { ascii: 'Arial', eastAsia: 'SimSun' } },
    ]);
    const derived = styleForFontSlot(style, 'eastAsia');
    expect(derived.fontFamily).toBe('SimSun');
    expect(styleForFontSlot(style, 'eastAsia')).toBe(derived);
  });

  test('no slot, no eastAsia face, or a matching face answer the style itself', () => {
    const style = resolveRunStyle([
      { localName: 'rFonts', attributes: { ascii: 'Arial', eastAsia: 'SimSun' } },
    ]);
    expect(styleForFontSlot(style, undefined)).toBe(style);
    expect(styleForFontSlot(DEFAULT_RUN_STYLE, 'eastAsia')).toBe(DEFAULT_RUN_STYLE);
    const same = resolveRunStyle([
      { localName: 'rFonts', attributes: { ascii: 'SimSun', eastAsia: 'SimSun' } },
    ]);
    expect(styleForFontSlot(same, 'eastAsia')).toBe(same);
  });
});

describe('drawn text', () => {
  test('caps uppercases what is measured and painted', () => {
    expect(displayText('hello', resolve('caps'))).toBe('HELLO');
  });

  test('small caps does NOT change the characters', () => {
    // It selects different glyphs; uppercasing here would corrupt what a copy produces.
    expect(displayText('hello', resolve('smallCaps'))).toBe('hello');
  });
});

describe('style equality drives span merging', () => {
  test('identical properties compare equal regardless of order', () => {
    const a = resolveRunStyle([{ localName: 'b' }, { localName: 'i' }]);
    const b = resolveRunStyle([{ localName: 'i' }, { localName: 'b' }]);
    expect(runStylesEqual(a, b)).toBe(true);
  });

  test('a differing underline variant is not equal', () => {
    expect(runStylesEqual(resolve('u', { val: 'single' }), resolve('u', { val: 'double' }))).toBe(
      false
    );
  });

  test('thick underline is not equal to single', () => {
    expect(runStylesEqual(resolve('u', { val: 'single' }), resolve('u', { val: 'thick' }))).toBe(
      false
    );
  });

  test('strike is not equal to double strike', () => {
    expect(runStylesEqual(resolve('strike'), resolve('dstrike'))).toBe(false);
  });
});

// Probes e03, e06-e08, x07 and z01-z03 in local/evidence/hansi-font-slots: the run's
// East Asian language never selects a theme face; the theme language does (e02, e09, x03).
describe('empty East Asian theme faces follow the theme language, not the run language', () => {
  const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const root = (xml: string, name: string) => {
    const parsed = readOoxmlPart(xml, { name, contentType: 'application/xml' });
    if (!parsed.ok) throw new Error(parsed.reason);
    return parsed.part.root;
  };
  const theme = (supplemental = '') =>
    root(
      `<a:theme xmlns:a="${A}"><a:themeElements><a:fontScheme name="T">` +
        `<a:majorFont><a:latin typeface="Cambria"/><a:ea typeface=""/>${supplemental}</a:majorFont>` +
        `<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/>${supplemental}</a:minorFont>` +
        '</a:fontScheme></a:themeElements></a:theme>',
      '/word/theme/theme1.xml'
    );
  const settings = (language: string) =>
    root(
      `<w:settings xmlns:w="${W}"><w:themeFontLang w:eastAsia="${language}"/></w:settings>`,
      '/word/settings.xml'
    );
  const face = (fonts: ReturnType<typeof collectThemeSchemeFaces>, language: string) =>
    resolveRunStyle(
      [
        {
          localName: 'rFonts',
          attributes: { asciiTheme: 'minorHAnsi', eastAsiaTheme: 'minorEastAsia' },
        },
        { localName: 'lang', attributes: { val: 'en-US', eastAsia: language } },
      ],
      fonts
    );
  test.each(['zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'en-US', ''])(
    'a %s run takes the Simplified Chinese default',
    (language) => {
      const style = face(collectThemeSchemeFaces(theme()), language);
      expect(style.fontFamilyEastAsia).toBe('SimSun');
      expect(style.fontFamily).toBe('Calibri');
    }
  );
  test.each([
    ['zh-CN', 'SimSun'],
    ['zh-TW', 'PMingLiU'],
    ['ja-JP', 'MS Mincho'],
    ['ko-KR', 'Batang'],
  ])('a %s theme language selects %s', (language, family) => {
    const fonts = collectThemeSchemeFaces(theme(), settings(language));
    expect(face(fonts, 'en-US').fontFamilyEastAsia).toBe(family);
  });
  test('the Simplified Chinese supplemental face applies whatever the run language', () => {
    const fonts = collectThemeSchemeFaces(
      theme(
        '<a:font script="Hans" typeface="Chinese Body"/><a:font script="Jpan" typeface="Japanese Body"/>'
      )
    );
    expect(face(fonts, 'ja-JP').fontFamilyEastAsia).toBe('Chinese Body');
  });
  test('an empty slot replaces the explicit face beside its token (probe e04)', () => {
    const style = resolveRunStyle(
      [{ localName: 'rFonts', attributes: { eastAsiaTheme: 'minorEastAsia', eastAsia: 'Named' } }],
      collectThemeSchemeFaces(theme())
    );
    expect(style.fontFamilyEastAsia).toBe('SimSun');
  });
});

// Word 16 PDF output is the oracle for every expectation in this block.
describe('complex-script runs use Word complex-script properties', () => {
  const p = (localName: string, attributes?: Record<string, string>) =>
    attributes ? { localName, attributes } : { localName };
  const faces = [p('rFonts', { ascii: 'Courier New', hAnsi: 'Courier New', cs: 'Arial' })];

  test('w:rtl selects the cs face, szCs, bCs, and iCs for the whole run', () => {
    const style = resolveRunStyle([
      ...faces,
      p('sz', { val: '20' }),
      p('szCs', { val: '40' }),
      p('b'),
      p('iCs'),
      p('rtl'),
    ]);
    expect(style.fontFamily).toBe('Arial');
    expect(style.fontSizePt).toBe(20);
    expect(style.bold).toBe(false);
    expect(style.italic).toBe(true);
  });

  test('w:cs forces the complex-script lane without a direction', () => {
    const style = resolveRunStyle([...faces, p('bCs'), p('szCs', { val: '30' }), p('cs')]);
    expect(style).toMatchObject({ fontFamily: 'Arial', fontSizePt: 15, bold: true });
  });

  test('a run without w:rtl or w:cs keeps the Latin properties', () => {
    const style = resolveRunStyle([...faces, p('sz', { val: '40' }), p('szCs', { val: '16' })]);
    expect(style.fontFamily).toBe('Courier New');
    expect(style.fontSizePt).toBe(20);
    expect(resolveRunStyle([...faces, p('rtl', { val: '0' }), p('bCs')]).bold).toBe(false);
  });

  test('unauthored complex-script values use Word defaults, not the Latin ones', () => {
    const style = resolveRunStyle([
      p('rFonts', { ascii: 'Courier New' }),
      p('sz', { val: '40' }),
      p('rtl'),
    ]);
    expect(style.fontFamily).toBe('Times New Roman');
    expect(style.fontSizePt).toBe(10);
  });

  test('cstheme resolves through the theme bidi faces', () => {
    const themed = [p('rFonts', { cstheme: 'minorBidi', cs: 'Arial' }), p('rtl')];
    const theme = { major: null, minor: null };
    expect(resolveRunStyle(themed, { ...theme, minorBidi: 'Tahoma' }).fontFamily).toBe('Tahoma');
    // An empty theme face falls back to the explicit name beside it.
    expect(resolveRunStyle(themed, { ...theme, minorBidi: '' }).fontFamily).toBe('Arial');
  });
});
