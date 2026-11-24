import { describe, expect, test } from 'bun:test';
import {
  UnsupportedScriptError,
  itemizeScriptFontSlots,
  type BidiEmbeddingLevels,
} from '../index.ts';
import { eastAsiaRunsOfSegments } from '../script-itemization.ts';

const ltr = (text: string): BidiEmbeddingLevels => ({
  paragraphs: [{ from: 0, to: text.length, level: 0 }],
  levels: new Uint8Array(text.length),
});

describe('deterministic script itemization', () => {
  test.each([
    ['देवनागरी', 'Deva'],
    ['বাংলা', 'Beng'],
    ['ไทย', 'Thai'],
    ['ខ្មែរ', 'Khmr'],
  ] as const)(
    '%s uses the exact HarfBuzz script tag and complex-script font slot',
    (text, script) => {
      expect(itemizeScriptFontSlots(text, 0, ltr(text))).toEqual([
        {
          from: 0,
          to: text.length,
          direction: 'ltr',
          bidiLevel: 0,
          script,
          slot: 'cs',
        },
      ]);
    }
  );

  test('rejects an unimplemented strong script before shaping instead of relabeling it Latin', () => {
    expect(() => itemizeScriptFontSlots('ქართული', 0, ltr('ქართული'))).toThrow(
      expect.objectContaining<UnsupportedScriptError>({
        name: 'UnsupportedScriptError',
        code: 'unsupportedScript',
        codePoint: 0x10e5,
      })
    );
  });

  test.each([
    ['Δοκιμή', 'Grek'],
    ['Кириллица', 'Cyrl'],
  ] as const)('%s retains its supported non-Latin HarfBuzz script tag', (text, script) => {
    expect(itemizeScriptFontSlots(text, 0, ltr(text))).toEqual([
      {
        from: 0,
        to: text.length,
        direction: 'ltr',
        bidiLevel: 0,
        script,
        slot: 'hAnsi',
      },
    ]);
  });

  test('all-Common text uses the HarfBuzz Common tag rather than pretending to be Latin', () => {
    const text = '☐ 😀';
    expect(itemizeScriptFontSlots(text, 0, ltr(text))).toEqual([
      {
        from: 0,
        to: text.length,
        direction: 'ltr',
        bidiLevel: 0,
        script: 'Zyyy',
        slot: 'hAnsi',
      },
    ]);
  });

  test('fullwidth Latin keeps its script but takes the East Asian slot beside Han', () => {
    const text = '漢ＡＺ字';
    expect(
      itemizeScriptFontSlots(text, 0, ltr(text)).map(({ from, to, script, slot }) => ({
        text: text.slice(from, to),
        script,
        slot,
      }))
    ).toEqual([
      { text: '漢', script: 'Hani', slot: 'eastAsia' },
      { text: 'ＡＺ', script: 'Latn', slot: 'eastAsia' },
      { text: '字', script: 'Hani', slot: 'eastAsia' },
    ]);
  });

  test('full-width letters, digits and punctuation take the East Asian slot', () => {
    for (const [text, script, slot] of [
      ['＠', 'Zyyy', 'eastAsia'],
      ['Ａ', 'Latn', 'eastAsia'],
      ['ｚ', 'Latn', 'eastAsia'],
      ['｛', 'Zyyy', 'eastAsia'],
      ['１', 'Zyyy', 'eastAsia'],
      ['｡', 'Zyyy', 'eastAsia'],
      ['￥', 'Zyyy', 'eastAsia'],
    ] as const) {
      expect(itemizeScriptFontSlots(text, 0, ltr(text))[0]).toMatchObject({ script, slot });
    }
  });

  test('FE2E–FE2F are inherited combining marks, never Cyrillic', () => {
    const inherited = 'A\uFE2E\uFE2F';
    expect(itemizeScriptFontSlots(inherited, 0, ltr(inherited))).toEqual([
      {
        from: 0,
        to: inherited.length,
        direction: 'ltr',
        bidiLevel: 0,
        script: 'Latn',
        slot: 'ascii',
      },
    ]);
    expect(itemizeScriptFontSlots('\uFE2E', 0, ltr('\uFE2E'))[0]).toMatchObject({
      script: 'Zyyy',
      slot: 'hAnsi',
    });
  });

  test('retains Latin, Arabic, Hebrew, and Han split invariance around Common characters', () => {
    const text = 'abc,سلام;עברית。漢字';
    expect(
      itemizeScriptFontSlots(text, 0, ltr(text)).map(({ from, to, script, slot }) => ({
        text: text.slice(from, to),
        script,
        slot,
      }))
    ).toEqual([
      { text: 'abc,', script: 'Latn', slot: 'ascii' },
      { text: 'سلام;', script: 'Arab', slot: 'cs' },
      { text: 'עברית', script: 'Hebr', slot: 'cs' },
      { text: '。漢字', script: 'Hani', slot: 'eastAsia' },
    ]);
  });
});

describe('eastAsiaRunsOfSegments — the slot projection for piece splitting', () => {
  const one = (text: string) => eastAsiaRunsOfSegments([text]);

  test('mixed CJK and Latin text answers the merged eastAsia ranges in order', () => {
    expect(one('甲方shall履行')).toEqual([
      { segment: 0, from: 0, to: 2 },
      { segment: 0, from: 7, to: 9 },
    ]);
  });

  test('non-ASCII Common characters inherit the surrounding strong classification', () => {
    // The fullwidth comma (U+FF0C, Common) takes the preceding CJK answer.
    expect(one('甲，方')).toEqual([{ segment: 0, from: 0, to: 3 }]);
    // Leading non-ASCII Common text takes the FOLLOWING strong item, same as itemization.
    expect(one('§甲')).toEqual([{ segment: 0, from: 0, to: 2 }]);
  });

  test('ASCII characters never resolve through the eastAsia slot (ECMA-376 w:ascii)', () => {
    // Word measures the `, ` in `中文, Hello` in the Latin face; inheriting the eastAsia
    // slot painted the same separator at two widths depending on which side it sat.
    expect(one('中文, Hello')).toEqual([{ segment: 0, from: 0, to: 2 }]);
    expect(one('Hello, 中文')).toEqual([{ segment: 0, from: 7, to: 9 }]);
    // An ASCII comma BETWEEN ideographs still stays in the base slots.
    expect(one('甲, 方')).toEqual([
      { segment: 0, from: 0, to: 1 },
      { segment: 0, from: 3, to: 4 },
    ]);
  });

  test('Latin-only text answers no ranges', () => {
    expect(one('shall perform')).toEqual([]);
    expect(one('')).toEqual([]);
    expect(eastAsiaRunsOfSegments([])).toEqual([]);
  });

  test('classification crosses segment boundaries — a weak character alone in its own run', () => {
    // A fullwidth comma alone in its own `w:t` between two CJK runs is East Asian text;
    // per-piece classification saw no strong neighbour and dropped it to the Latin face.
    expect(eastAsiaRunsOfSegments(['甲', '，', '方'])).toEqual([
      { segment: 0, from: 0, to: 1 },
      { segment: 1, from: 0, to: 1 },
      { segment: 2, from: 0, to: 1 },
    ]);
    // A pure-ASCII segment between them keeps its own text Latin and blocks nothing else.
    expect(eastAsiaRunsOfSegments(['中文', ', ', 'Hello'])).toEqual([
      { segment: 0, from: 0, to: 2 },
    ]);
  });

  test('an unsupported code point costs itself the face, not its whole piece', () => {
    // U+0BA4 TAMIL LETTER TA is outside every supported range. Full itemization throws;
    // slot resolution confines the fallback to that one character.
    expect(() => itemizeScriptFontSlots('த甲', 0, ltr('த甲'))).toThrow(UnsupportedScriptError);
    expect(one('甲த文')).toEqual([
      { segment: 0, from: 0, to: 1 },
      { segment: 0, from: 2, to: 3 },
    ]);
  });

  test('surrogate-pair ideographs stay whole', () => {
    // U+20000 (Ext B) is two UTF-16 units; the range must cover both.
    expect(one('\u{20000}a')).toEqual([{ segment: 0, from: 0, to: 2 }]);
  });

  test('agrees with full itemization on strong slot boundaries', () => {
    const text = 'A甲B';
    const slots = itemizeScriptFontSlots(text, 0, ltr(text));
    expect(one(text)).toEqual(
      slots
        .filter((item) => item.slot === 'eastAsia')
        .map(({ from, to }) => ({ segment: 0, from, to }))
    );
  });
});
