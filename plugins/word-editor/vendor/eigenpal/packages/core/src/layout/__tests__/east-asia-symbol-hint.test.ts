import { expect, test } from 'bun:test';
import {
  hasEastAsiaSymbolHint,
  hasTimesNewRomanEastAsiaException,
  isEastAsiaHintSymbol,
} from '../east-asia-symbol-hint.ts';
import { applyEastAsiaFontSlots, type FieldAwarePiece } from '../field-pieces.ts';
import { resolveRunStyle } from '../run-style.ts';
import { eastAsiaRunsOfSegments } from '../script-itemization.ts';
import { symbolRunStyle } from '../symbol-run.ts';
import { intlGraphemeBoundary, resetGraphemeBoundary, setGraphemeBoundary } from '../grapheme.ts';
import { createFixedMeasurer, layoutSemanticDocument, linesOf } from '../index.ts';
import { readOoxmlPart, type OoxmlProperty } from '@docx-editor.dev/core/store';

const fonts: OoxmlProperty = {
  localName: 'rFonts',
  attributes: { ascii: 'Times New Roman', eastAsia: 'SimSun', hint: 'eastAsia' },
};
function piece(text: string, props: OoxmlProperty[] = [fonts], projected = false): FieldAwarePiece {
  return {
    text,
    props,
    style: resolveRunStyle(props),
    start: 0,
    end: projected ? 1 : text.length,
    ...(projected ? { projected: true } : {}),
  };
}
test('the hint table accepts exactly the unconditional symbols, not accented letters', () => {
  const latin1 = [
    0xa1, 0xa4, 0xa7, 0xa8, 0xaa, 0xad, 0xaf, 0xb0, 0xb1, 0xb2, 0xb3, 0xb4, 0xb6, 0xb7, 0xb8, 0xb9,
    0xba, 0xbc, 0xbd, 0xbe, 0xbf, 0xd7, 0xf7,
  ];
  // Combining marks and format characters stay with their base character, so a grapheme
  // cluster is never split across two faces. The narrow no-break space is a space.
  const excluded = (code: number) =>
    (code >= 0x300 && code <= 0x36f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x2028 && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x206f) ||
    (code >= 0x20d0 && code <= 0x20ff);
  const inTable = (code: number) =>
    !excluded(code) &&
    (latin1.includes(code) ||
      (code >= 0x2b0 && code <= 0x36f) ||
      (code >= 0x370 && code <= 0x3cf) ||
      (code >= 0x400 && code <= 0x4ff) ||
      (code >= 0x2000 && code <= 0x27bf));
  for (let code = 0; code <= 0x2fff; code++) expect(isEastAsiaHintSymbol(code)).toBe(inTable(code));
  expect(isEastAsiaHintSymbol(0x301)).toBe(false);
  expect(isEastAsiaHintSymbol(0x200d)).toBe(false);
  // The private use area belongs to symbol fonts, never to the East Asian face.
  expect(isEastAsiaHintSymbol(0xe000)).toBe(false);
  expect(isEastAsiaHintSymbol(0xf0fc)).toBe(false);
  expect(isEastAsiaHintSymbol(0xf8ff)).toBe(false);
  // Latin presentation forms, up to the first Hebrew ligature.
  expect(isEastAsiaHintSymbol(0xfb00)).toBe(true);
  expect(isEastAsiaHintSymbol(0xfb1c)).toBe(true);
  expect(isEastAsiaHintSymbol(0xfb1d)).toBe(false);
  expect(isEastAsiaHintSymbol(0xdfff)).toBe(false);
  expect(isEastAsiaHintSymbol(0xf900)).toBe(false);
  // CJK radicals are strong East Asian text without any hint, so the table leaves them out.
  expect(eastAsiaRunsOfSegments(['⺀'], [false])).toEqual([{ segment: 0, from: 0, to: 1 }]);
});
test('hinted quotes, dashes and enclosed digits resolve the East Asian slot in layout', () => {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const spansOf = (text: string, hint: string) => {
    const parsed = readOoxmlPart(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:rPr>` +
        `<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="SimSun"${hint}/>` +
        `</w:rPr><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!parsed.ok) throw new Error(parsed.reason);
    const layout = layoutSemanticDocument(parsed.part, 1, { measurer: createFixedMeasurer(6, 14) });
    return linesOf(layout).flatMap((line) => line.spans);
  };
  for (const text of ['“”', '——', '①', '·']) {
    const hinted = spansOf(text, ' w:hint="eastAsia"');
    expect(hinted.map((span) => span.text)).toEqual([text]);
    expect(hinted[0]!.fontSlot).toBe('eastAsia');
    expect(hinted[0]!.style.fontFamily).toBe('Arial');
    const unhinted = spansOf(text, '');
    expect(unhinted[0]!.fontSlot).toBeUndefined();
  }
});
test('the Times New Roman exception needs matching ascii and hAnsi faces', () => {
  const timesNewRoman = (ascii: string, hAnsi: string): OoxmlProperty[] => [
    {
      localName: 'rFonts',
      attributes: { ascii, hAnsi, eastAsia: 'Times New Roman', hint: 'eastAsia' },
    },
  ];
  const distinct = piece('·', timesNewRoman('Arial', 'Calibri'));
  expect(applyEastAsiaFontSlots([distinct])[0]!.fontSlot).toBe('eastAsia');
  const same = piece('·', timesNewRoman('Arial', 'Arial'));
  expect(applyEastAsiaFontSlots([same])[0]).toBe(same);
  expect(
    hasTimesNewRomanEastAsiaException(timesNewRoman('Arial', 'Calibri'), 'Times New Roman')
  ).toBe(false);
  expect(
    hasTimesNewRomanEastAsiaException(timesNewRoman('Arial', 'Arial'), 'Times New Roman')
  ).toBe(true);
  // The face compared is the resolved one; a distinct East Asian face never triggers it.
  expect(hasTimesNewRomanEastAsiaException(timesNewRoman('Arial', 'Arial'), 'SimSun')).toBe(false);
  // Last specified value wins per attribute across the cascade, like the hint itself.
  expect(
    hasTimesNewRomanEastAsiaException(
      [
        ...timesNewRoman('Arial', 'Arial'),
        { localName: 'rFonts', attributes: { hAnsi: 'Calibri' } },
      ],
      'Times New Roman'
    )
  ).toBe(false);
});
test('hinted middle dots keep their East Asian face without changing ASCII or offsets', () => {
  const input = piece('·   · 1×2÷3 20°C'),
    before = JSON.stringify(input);
  const out = applyEastAsiaFontSlots([input]);
  expect(out.map((p) => p.text).join('')).toBe(input.text);
  let offset = 0;
  for (const item of out) {
    expect(item.start).toBe(offset);
    offset = item.end;
    expect(item.style).toBe(input.style);
    expect(item.props).toBe(input.props);
    for (const char of item.text)
      expect(item.fontSlot === 'eastAsia').toBe(isEastAsiaHintSymbol(char.codePointAt(0)!));
  }
  expect(offset).toBe(input.text.length);
  expect(JSON.stringify(input)).toBe(before);
});
test('hint inheritance follows last specified value, not last rFonts element', () => {
  expect(
    hasEastAsiaSymbolHint([fonts, { localName: 'rFonts', attributes: { ascii: 'Arial' } }])
  ).toBe(true);
  expect(
    hasEastAsiaSymbolHint([fonts, { localName: 'rFonts', attributes: { hint: 'default' } }])
  ).toBe(false);
  expect(
    hasEastAsiaSymbolHint([{ localName: 'rFonts', attributes: { hint: 'default' } }, fonts])
  ).toBe(true);
  expect(hasEastAsiaSymbolHint([{ ...fonts, attributes: { hint: 'EastAsia' } }])).toBe(false);
});
test('unhinted Latin symbols and explicitly complex-script runs gain no new slot', () => {
  for (const props of [
    [{ ...fonts, attributes: { ascii: 'Arial', eastAsia: 'SimSun' } }],
    [fonts, { localName: 'rtl' }],
    [fonts, { localName: 'cs', attributes: { val: '1' } }],
  ]) {
    const input = piece('·×÷', props);
    expect(applyEastAsiaFontSlots([input])).toEqual([input]);
  }
  expect(
    hasEastAsiaSymbolHint([
      fonts,
      { localName: 'cs' },
      { localName: 'cs', attributes: { val: '0' } },
    ])
  ).toBe(true);
});
test('projected results retain one model atom; only uniform-symbol projections take the slot', () => {
  const symbol = piece('··', [fonts], true),
    mixed = piece('1·', [fonts], true);
  const out = applyEastAsiaFontSlots([symbol, mixed]);
  expect(out).toHaveLength(2);
  expect(out[0]!.fontSlot).toBe('eastAsia');
  expect(out[0]!.end).toBe(1);
  expect(out[1]).toBe(mixed);
});
test('a hint without a distinct East Asian face leaves the original piece untouched', () => {
  const input = piece('·', [
    { localName: 'rFonts', attributes: { ascii: 'Arial', hint: 'eastAsia' } },
  ]);
  expect(applyEastAsiaFontSlots([input])[0]).toBe(input);
  const fallback = piece('·', [
    {
      localName: 'rFonts',
      attributes: {
        ascii: 'Arial',
        hAnsi: 'Arial',
        eastAsia: 'Times New Roman',
        hint: 'eastAsia',
      },
    },
  ]);
  expect(applyEastAsiaFontSlots([fallback])[0]).toBe(fallback);
});
test('the Times New Roman exception falls back to ignoring the hint when faces cannot compare', () => {
  const rFonts = (attributes: Record<string, string>): OoxmlProperty => ({
    localName: 'rFonts',
    attributes,
  });
  const theme = rFonts({ asciiTheme: 'minorHAnsi', hAnsiTheme: 'minorHAnsi' });
  const override = rFonts({ hAnsi: 'Calibri', eastAsia: 'Times New Roman', hint: 'eastAsia' });
  // One theme slot beside one explicit name and no resolver: Word compares resolved faces,
  // this reader cannot, so it keeps the exception (hint ignored), the behavior before.
  expect(hasTimesNewRomanEastAsiaException([theme, override], 'Times New Roman')).toBe(true);
  expect(applyEastAsiaFontSlots([piece('·', [theme, override])])[0]!.fontSlot).toBeUndefined();
  // With the document's theme fonts the token resolves and the faces compare as Word does.
  const calibri = { major: 'Cambria', minor: 'Calibri' };
  expect(hasTimesNewRomanEastAsiaException([theme, override], 'Times New Roman', calibri)).toBe(
    true
  );
  const arial = rFonts({ ascii: 'Arial', eastAsia: 'Times New Roman', hint: 'eastAsia' });
  expect(hasTimesNewRomanEastAsiaException([theme, arial], 'Times New Roman', calibri)).toBe(false);
  expect(applyEastAsiaFontSlots([piece('·', [theme, arial])], calibri)[0]!.fontSlot).toBe(
    'eastAsia'
  );
  // Two theme tokens compare by the face they stand for: the ascii and hAnsi tokens of one
  // theme face are the same face, and a resolver is not needed to know that.
  expect(hasTimesNewRomanEastAsiaException([theme], 'Times New Roman')).toBe(true);
  expect(
    hasTimesNewRomanEastAsiaException(
      [rFonts({ asciiTheme: 'minorAscii', hAnsiTheme: 'minorHAnsi' })],
      'Times New Roman'
    )
  ).toBe(true);
  // Two different tokens compare only through a resolver; unresolved, the exception stays.
  const majorMinor = [rFonts({ asciiTheme: 'majorHAnsi', hAnsiTheme: 'minorHAnsi' })];
  expect(hasTimesNewRomanEastAsiaException(majorMinor, 'Times New Roman')).toBe(true);
  expect(hasTimesNewRomanEastAsiaException(majorMinor, 'Times New Roman', calibri)).toBe(false);
  expect(
    hasTimesNewRomanEastAsiaException(
      [rFonts({ asciiTheme: 'minorHAnsi', hAnsiTheme: 'minorEastAsia' })],
      'Times New Roman',
      calibri
    )
  ).toBe(true);
  expect(
    hasTimesNewRomanEastAsiaException(
      [rFonts({ ascii: 'arial', hAnsi: 'Arial' })],
      'Times New Roman'
    )
  ).toBe(true);
  // A face left unspecified cannot be compared either.
  expect(hasTimesNewRomanEastAsiaException([rFonts({ ascii: 'Arial' })], 'Times New Roman')).toBe(
    true
  );
});
test('a hinted symbol never lends East Asian strength to an unhinted neighbour', () => {
  // The trademark sign takes the East Asian face under the hint, but the NBSP and © of the
  // next, unhinted run stay in their own face: a hinted symbol is not strong text.
  expect(eastAsiaRunsOfSegments(['Word™', ' © next'], [true, false])).toEqual([
    { segment: 0, from: 4, to: 5 },
  ]);
  expect(eastAsiaRunsOfSegments(['© ', '— x'], [false, true])).toEqual([
    { segment: 1, from: 0, to: 1 },
  ]);
  // Inside one hinted run, a Common character beside a hinted symbol keeps its face too.
  expect(eastAsiaRunsOfSegments(['·©'], [true])).toEqual([{ segment: 0, from: 0, to: 1 }]);
  // Real East Asian text still resolves the Common characters around it, as before.
  expect(eastAsiaRunsOfSegments(['中©'], [false])).toEqual([{ segment: 0, from: 0, to: 2 }]);
  // Leading Common text resolved by later strong text, with a hinted symbol in between,
  // still comes back in document order as one merged range.
  expect(eastAsiaRunsOfSegments(['（—中'], [true])).toEqual([{ segment: 0, from: 0, to: 3 }]);
  const pieces = applyEastAsiaFontSlots([piece('（—中')]);
  expect(pieces.map((item) => item.text).join('')).toBe('（—中');
  expect(pieces.map((item) => [item.start, item.end])).toEqual([[0, 3]]);
  // A combining mark or variation selector stays on the hinted symbol it decorates.
  expect(eastAsiaRunsOfSegments(['°́'], [true])).toEqual([{ segment: 0, from: 0, to: 2 }]);
  expect(eastAsiaRunsOfSegments(['✔️'], [true])).toEqual([{ segment: 0, from: 0, to: 2 }]);
  expect(applyEastAsiaFontSlots([piece('✔️')]).map((item) => item.text)).toEqual(['✔️']);
});
test('a w:sym glyph keeps the font it names under an inherited hint', () => {
  const glyph = { text: '✓', font: 'Segoe UI Symbol', unicode: true };
  const { props, style } = symbolRunStyle([fonts], glyph);
  const sym: FieldAwarePiece = { text: '✓', props, style, start: 0, end: 1 };
  expect(style.fontFamily).toBe('Segoe UI Symbol');
  expect(applyEastAsiaFontSlots([sym])[0]).toBe(sym);
});
test('symbol-encoded faces keep their glyphs under the hint', () => {
  const wingdings = piece('✔', [
    {
      localName: 'rFonts',
      attributes: { ascii: 'Wingdings', hAnsi: 'Wingdings', eastAsia: 'SimSun', hint: 'eastAsia' },
    },
  ]);
  expect(wingdings.style.fontFamily).toBe('Wingdings');
  expect(applyEastAsiaFontSlots([wingdings])[0]).toBe(wingdings);
});
test('combining marks and joiners stay with their base character under the hint', () => {
  const nfd = piece('cafe\u0301 a\u{1F468}\u200D\u{1F469}b');
  const out = applyEastAsiaFontSlots([nfd]);
  expect(out).toHaveLength(1);
  expect(out[0]).toBe(nfd);
});

test('hinted symbols retain combining marks across text segments', () => {
  for (const hints of [
    [true, true],
    [true, false],
  ]) {
    expect(eastAsiaRunsOfSegments(['°', '\u0301x'], hints)).toEqual([
      { segment: 0, from: 0, to: 1 },
      { segment: 1, from: 0, to: 1 },
    ]);
  }
  expect(eastAsiaRunsOfSegments(['✔', '', '\uFE0F', '\u0301© x'], [true])).toEqual([
    { segment: 0, from: 0, to: 1 },
    { segment: 2, from: 0, to: 1 },
    { segment: 3, from: 0, to: 1 },
  ]);
  // ASCII terminates the combining sequence, including the fast path for pure ASCII segments.
  expect(eastAsiaRunsOfSegments(['°', ' ', '\u0301x'], [true])).toEqual([
    { segment: 0, from: 0, to: 1 },
  ]);
});
test('the Times New Roman exception compares explicit fallback faces for unresolved themes', () => {
  const props: OoxmlProperty[] = [
    {
      localName: 'rFonts',
      attributes: {
        asciiTheme: 'minorAscii',
        ascii: 'Arial',
        hAnsiTheme: 'minorHAnsi',
        hAnsi: 'Calibri',
        eastAsia: 'Times New Roman',
        hint: 'eastAsia',
      },
    },
  ];
  expect(resolveRunStyle(props).fontFamily).toBe('Arial');
  expect(hasTimesNewRomanEastAsiaException(props, 'Times New Roman')).toBe(false);
  expect(applyEastAsiaFontSlots([piece('°', props)])[0]!.fontSlot).toBe('eastAsia');
  expect(
    hasTimesNewRomanEastAsiaException(props, 'Times New Roman', {
      major: null,
      minor: null,
    })
  ).toBe(false);
  expect(
    hasTimesNewRomanEastAsiaException(props, 'Times New Roman', {
      major: 'Cambria',
      minor: 'Calibri',
    })
  ).toBe(true);
});
test('the unconditional Greek and Cyrillic hint ranges use the East Asian face', () => {
  const text = 'ΑΩαωАЯая';
  expect(eastAsiaRunsOfSegments([text], [true])).toEqual([
    { segment: 0, from: 0, to: text.length },
  ]);
  expect(eastAsiaRunsOfSegments([text])).toEqual([]);
  expect(eastAsiaRunsOfSegments(['\u03d0\u0500'], [true])).toEqual([]);
});

test('hinted strong text retains its base strength around Common characters and Han', () => {
  for (const strong of ['α', 'я', 'ﬀ', '×']) {
    expect(eastAsiaRunsOfSegments(['中', strong, '©'], [false, true, false])).toEqual([
      { segment: 0, from: 0, to: 1 },
      { segment: 1, from: 0, to: 1 },
    ]);
    expect(eastAsiaRunsOfSegments(['©', strong, '中'], [false, true, false])).toEqual([
      { segment: 1, from: 0, to: 1 },
      { segment: 2, from: 0, to: 1 },
    ]);
    expect(eastAsiaRunsOfSegments(['中' + strong + '\u0301©'], [true])).toEqual([
      { segment: 0, from: 0, to: 3 },
    ]);
  }
});

test('font hints select whole emoji and combining clusters in layout', () => {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  for (const [text, expectedSlot] of [
    ['❤️‍🔥', 'eastAsia'],
    ['👩‍⚕️', undefined],
    ['a\u0483', undefined],
    ['Ԁ\u0483', undefined],
  ] as const) {
    const parsed = readOoxmlPart(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:rPr>` +
        `<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="SimSun" w:hint="eastAsia"/>` +
        `</w:rPr><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!parsed.ok) throw new Error(parsed.reason);
    const spans = linesOf(
      layoutSemanticDocument(parsed.part, 1, { measurer: createFixedMeasurer(6, 14) })
    ).flatMap((line) => line.spans);
    expect(spans.map((span) => span.text)).toEqual([text]);
    expect(spans[0]!.fontSlot).toBe(expectedSlot);
  }
});

test('the cluster base owns its hint across text segments without lending script strength', () => {
  expect(eastAsiaRunsOfSegments(['❤️', '‍', '🔥', '©x'], [true])).toEqual([
    { segment: 0, from: 0, to: 2 },
    { segment: 1, from: 0, to: 1 },
    { segment: 2, from: 0, to: 2 },
  ]);
  expect(eastAsiaRunsOfSegments(['👩', '‍⚕️'], [false, true])).toEqual([]);
  expect(eastAsiaRunsOfSegments(['a', '\u0483'], [false, true])).toEqual([]);
  expect(eastAsiaRunsOfSegments(['❤️', '‍🔥'], [false, true])).toEqual([]);
  expect(eastAsiaRunsOfSegments(['（', '❤️‍🔥', '中'], [false, true])).toEqual([
    { segment: 0, from: 0, to: 1 },
    { segment: 1, from: 0, to: 5 },
    { segment: 2, from: 0, to: 1 },
  ]);
});

test('hinted cluster segmentation runs once and skips ordinary paragraphs', () => {
  const calls: string[] = [];
  setGraphemeBoundary({
    segment(text) {
      calls.push(text);
      return intlGraphemeBoundary.segment(text);
    },
  });
  try {
    eastAsiaRunsOfSegments(['ASCII only'], [true]);
    eastAsiaRunsOfSegments(['中❤️‍🔥'], [false]);
    expect(calls).toHaveLength(0);
    const segments = Array.from({ length: 1000 }, () => '❤️‍🔥');
    eastAsiaRunsOfSegments(
      segments,
      segments.map(() => true)
    );
    expect(calls).toEqual([segments.join('')]);
  } finally {
    resetGraphemeBoundary();
  }
});

test('hinted accented letters follow the East Asian language; Latin Extended also the face', () => {
  // é and ạ need a Chinese or absent East Asian language; ą and ƒ also go East Asian when the
  // face is a Chinese font. À never does.
  const eastAsian = (face: string, language?: string) => {
    const props: OoxmlProperty[] = [
      {
        localName: 'rFonts',
        attributes: { ascii: 'Georgia', hAnsi: 'Tahoma', eastAsia: face, hint: 'eastAsia' },
      },
      ...(language ? [{ localName: 'lang', attributes: { eastAsia: language } }] : []),
    ];
    return applyEastAsiaFontSlots([piece('éạąƒÀ', props)])
      .filter((p) => p.fontSlot === 'eastAsia')
      .map((p) => p.text)
      .join('');
  };
  expect(eastAsian('Meiryo')).toBe('éạąƒ');
  expect(eastAsian('Meiryo', 'zh-TW')).toBe('éạąƒ');
  expect(eastAsian('Meiryo', 'ja-JP')).toBe('');
  expect(eastAsian('Microsoft YaHei', 'ja-JP')).toBe('ąƒ');
  expect(eastAsian('SimSun', 'ko-KR')).toBe('ąƒ');
  expect(eastAsian('Malgun Gothic', 'en-US')).toBe('');
  // Only the East Asian language counts, not the Latin one.
  const latinLanguage = piece('é', [fonts, { localName: 'lang', attributes: { val: 'ja-JP' } }]);
  expect(applyEastAsiaFontSlots([latinLanguage])[0]!.fontSlot).toBe('eastAsia');
});

test('the narrow no-break space follows the hint like the other spaces', () => {
  expect(isEastAsiaHintSymbol(0x202f)).toBe(true);
  expect(isEastAsiaHintSymbol(0x2003)).toBe(true);
  expect(isEastAsiaHintSymbol(0xa0)).toBe(false);
});
