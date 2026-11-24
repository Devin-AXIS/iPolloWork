// With balanced single-byte and double-byte widths (`w:balanceSingleByteDoubleByteWidth`), a
// space beside East Asian text, and each space of a run of spaces, takes the balanced width:
// half the font size beside a face that holds East Asian glyphs, otherwise the average
// character width of the space's face. The rule holds in every compatibility mode.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { loadBody } from './float-over-table-harness.ts';
import { readOoxmlPart } from '../../store/index.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf } from '../semantic-records.ts';
import { caretAt } from '../semantic-interaction.ts';
import type { StyleSpanRecord, TextMeasurer } from '../semantic-records.ts';
import { automaticTextGap } from '../cjk-automatic-spacing.ts';
import { resolveCjkTypography } from '../cjk-typography.ts';
import { DEFAULT_RUN_STYLE } from '../run-style.ts';
import { createFixedMeasurer } from '../index.ts';
import {
  createFontResourceSnapshot,
  FontResolutionError,
  sha256FontBytes,
} from '../font-resource.ts';
import {
  createHarfBuzzTextShaper,
  HARFBUZZ_SHAPING_LIBRARY,
  harfBuzzFontValidator,
  initializeHarfBuzz,
} from '../harfbuzz-shaper.ts';
import { createShapedMeasurer } from '../shaped-measurer.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const LATIN_ONLY = 'Times New Roman';
// Every character is 10 pt and a space 4 pt, plus the style's character spacing. A face named
// `Times New Roman` holds no East Asian glyphs.
const measurer: TextMeasurer = {
  measure: (text, style) =>
    [...text].reduce((n, c) => n + (c === ' ' ? 4 : 10) + style.characterSpacingPt, 0),
  lineMetrics: () => ({ height: 14, baseline: 11 }),
  faceCovers: (text, style) =>
    !/[\u3040-\u30ff\u3130-\u318f\u4e00-\u9fff\uac00-\ud7a3]/u.test(text) ||
    (style.fontFamily ?? '') !== LATIN_ONLY,
};
function part(name: string, xml: string) {
  const read = readOoxmlPart(xml, { name, contentType: 'application/xml' });
  if (!read.ok) throw Error(read.reason);
  return read.part;
}
const cascade = (balanced: boolean, mode: number, runDefaults = false) =>
  buildStyleCascadeTable(
    part(
      '/word/styles.xml',
      `<w:styles xmlns:w="${W}">${runDefaults ? '<w:docDefaults><w:rPrDefault/></w:docDefaults>' : ''}</w:styles>`
    ).root,
    undefined,
    part(
      '/word/settings.xml',
      `<w:settings xmlns:w="${W}"><w:compat>` +
        (balanced ? '<w:balanceSingleByteDoubleByteWidth/>' : '') +
        '<w:compatSetting w:name="compatibilityMode" ' +
        `w:uri="http://schemas.microsoft.com/office/word" w:val="${mode}"/></w:compat></w:settings>`
    ).root
  );
type Run =
  string | { text: string; size?: number; font?: string; spacing?: number; scale?: number };
const run = (item: Run) => {
  const {
    text,
    size = 11,
    font = 'Batang',
    spacing = 0,
    scale = 100,
  } = typeof item === 'string' ? { text: item } : item;
  return (
    `<w:r><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}"/>` +
    `<w:sz w:val="${size * 2}"/><w:spacing w:val="${spacing * 20}"/><w:w w:val="${scale}"/></w:rPr>` +
    text
      .split('\t')
      .map((piece) => `<w:t xml:space="preserve">${piece}</w:t>`)
      .join('<w:tab/>') +
    '</w:r>'
  );
};
function layout(
  runs: Run | readonly Run[],
  {
    balanced = true,
    mode = 15,
    jc = 'left',
    width = 400,
    measure = measurer,
    runDefaults = false,
  } = {}
) {
  return layoutSemanticDocument(
    loadBody(
      `<w:p><w:pPr><w:jc w:val="${jc}"/></w:pPr>${[runs].flat().map(run).join('')}</w:p>` +
        `<w:sectPr><w:pgSz w:w="${(width + 50) * 20}" w:h="6000"/>` +
        '<w:pgMar w:left="500" w:right="500" w:top="500" w:bottom="500"/></w:sectPr>'
    ),
    1,
    {
      measurer: measure,
      compatibilityMode: mode,
      styleCascade: cascade(balanced, mode, runDefaults),
    }
  );
}
/** The advance of each space before the line end on the first line, in order. */
function spaceAdvances(result: ReturnType<typeof layout>): number[] {
  const spans: readonly StyleSpanRecord[] = linesOf(result)[0]!.spans;
  const advances: number[] = [];
  spans.forEach((span, index) => {
    const next = spans[index + 1];
    if (!next || span.text.trim() !== '' || !span.text.includes(' ')) return;
    const each = Math.round(((next.box.x - span.box.x) / span.text.length) * 1000) / 1000;
    for (const _ of span.text) advances.push(each);
  });
  return advances;
}

describe('which spaces take the balanced width', () => {
  test('a space beside Hangul takes half the font size; one between Latin words keeps its own', () => {
    const text = '가가 나나 ab cd 다다 12 34 라라';
    // 가가|나나, 나나|ab, ab|cd, cd|다다, 다다|12, 12|34, 34|라라.
    expect(spaceAdvances(layout(text))).toEqual([5.5, 5.5, 4, 5.5, 5.5, 4, 5.5]);
    expect(spaceAdvances(layout(text, { balanced: false }))).toEqual([4, 4, 4, 4, 4, 4, 4]);
  });

  test('a space beside an ideograph or kana takes it too', () => {
    expect(spaceAdvances(layout('ab 漢字 漢字 かな cd'))).toEqual([5.5, 5.5, 5.5, 5.5]);
  });

  test('every space of a run of spaces takes it, between Latin words too', () => {
    expect(spaceAdvances(layout('ab  cd   ef'))).toEqual([5.5, 5.5, 5.5, 5.5, 5.5]);
    const cd = (balanced: boolean) =>
      linesOf(layout('ab  cd', { balanced }))[0]!.spans.find((span) => span.text === 'cd')!.box.x;
    expect([cd(true), cd(false)]).toEqual([31, 28]);
  });

  test('the no-break space and the tab keep their advances', () => {
    const line = linesOf(layout('가가\u00a0나나'))[0]!;
    expect(line.spans.map((span) => span.box.width).reduce((a, b) => a + b, 0)).toBe(50);
    const tabbed = linesOf(layout('가가\t나나'))[0]!.spans;
    const balancedTab = tabbed.find((span) => span.text === '나나')!.box.x;
    const plainTab = linesOf(layout('가가\t나나', { balanced: false }))[0]!.spans.find(
      (span) => span.text === '나나'
    )!.box.x;
    expect(balancedTab).toBe(plainTab);
  });

  test('a space in its own run takes the width of its own font size', () => {
    expect(spaceAdvances(layout(['가가', ' ', '나나']))).toEqual([5.5]);
    const small = { text: ' ', size: 9 };
    expect(
      spaceAdvances(layout([{ text: '가가', size: 16 }, small, { text: '나나', size: 16 }]))
    ).toEqual([4.5]);
  });

  test('legacy compatibility modes balance spaces the same way', () => {
    expect(spaceAdvances(layout('가가 나나 ab cd', { mode: 14 }))).toEqual([5.5, 5.5, 4]);
  });

  test('a face without East Asian glyphs widens only runs of spaces, to its average width', () => {
    const latin = (text: string) => ({ text, font: LATIN_ONLY });
    // Hangul in that face is a fallback glyph: a single space beside it keeps its advance.
    expect(spaceAdvances(layout(latin('가가 나나')))).toEqual([4]);
    // The average character width of the face is 821/2048 em: 4.41 pt at 11 pt.
    expect(spaceAdvances(layout(latin('ab  cd')))).toEqual([4.41, 4.41]);
    // A space in that face beside Hangul in an East Asian face takes the average width.
    expect(spaceAdvances(layout(['가가', latin(' '), '나나']))).toEqual([4.41]);
  });
});

describe('balanced spaces with authored character spacing and scaling', () => {
  // Like `measurer`, with `w:w` scaling each advance before the character spacing.
  const scaled: TextMeasurer = {
    ...measurer,
    measure: (text, style) =>
      [...text].reduce(
        (n, c) =>
          n +
          ((c === ' ' ? 4 : 10) * style.horizontalScalePercent) / 100 +
          style.characterSpacingPt,
        0
      ),
  };

  test('the character spacing of a widened space counts twice', () => {
    // 가가|나나 and 나나|ab widen to 5.5 + 2 * spacing; ab|cd keeps 4 + spacing.
    expect(spaceAdvances(layout({ text: '가가 나나 ab cd', spacing: -0.4 }))).toEqual([
      4.7, 4.7, 3.6,
    ]);
    expect(spaceAdvances(layout({ text: '가가 나나 ab cd', spacing: 1 }))).toEqual([7.5, 7.5, 5]);
    // Each space of a run of spaces, between Latin words too.
    expect(spaceAdvances(layout({ text: 'ab  cd', spacing: -1 }))).toEqual([3.5, 3.5]);
  });

  test('scaling scales the balanced width before the spacing is added', () => {
    const at = (properties: { spacing?: number; scale: number }) =>
      spaceAdvances(layout({ text: '가가 나나 ab cd', ...properties }, { measure: scaled }));
    expect(at({ scale: 80 })).toEqual([4.4, 4.4, 3.2]);
    expect(at({ scale: 150 })).toEqual([8.25, 8.25, 6]);
    expect(at({ scale: 80, spacing: 1 })).toEqual([6.4, 6.4, 4.2]);
  });

  test("only the space's own run spacing counts", () => {
    expect(spaceAdvances(layout(['가가', { text: ' ', spacing: 2 }, '나나']))).toEqual([9.5]);
    const spacedWords = [{ text: '가가', spacing: 2 }, ' ', { text: '나나', spacing: 2 }];
    expect(spaceAdvances(layout(spacedWords))).toEqual([5.5]);
  });

  test('legacy compatibility modes widen spaced spaces the same way', () => {
    expect(spaceAdvances(layout({ text: '가가 나나', spacing: -0.4 }, { mode: 14 }))).toEqual([
      4.7,
    ]);
  });

  test('a face without East Asian glyphs keeps its spaced or scaled spaces', () => {
    const cd = (run: Run, measure = measurer) =>
      linesOf(layout(run, { measure }))[0]!.spans.find((span) => span.text.endsWith('cd'))!;
    const latin = { text: 'ab  cd', font: LATIN_ONLY };
    // `ab` is 22 pt with 1 pt spacing, then two spaces of 5 pt (4 pt and the spacing).
    expect(cd({ ...latin, spacing: 1 }).box.x).toBe(32);
    // `ab` is 16 pt at 80 percent, then two spaces of 3.2 pt.
    expect(cd({ ...latin, scale: 80 }, scaled).box.x).toBeCloseTo(22.4, 6);
  });

  test('without balanced widths, spaced spaces keep their advance plus spacing', () => {
    const text = { text: '가가 나나 ab cd', spacing: -0.4 };
    expect(spaceAdvances(layout(text, { balanced: false }))).toEqual([3.6, 3.6, 3.6]);
  });

  test('wider spaced spaces wrap a word that fits with natural spaces', () => {
    // Four words of 19.2 pt and three spaces: 3.6 pt natural (87.6 pt), 4.7 pt balanced (90.9 pt).
    const text = { text: '가가 나나 다다 라라', spacing: -0.4 };
    const lines = (balanced: boolean) =>
      linesOf(layout(text, { width: 89, balanced })).map((line) =>
        line.spans
          .map((span) => span.text)
          .join('')
          .trim()
      );
    expect(lines(false)).toEqual(['가가 나나 다다 라라']);
    expect(lines(true)).toEqual(['가가 나나 다다', '라라']);
  });

  test('the caret after a spaced widened space stands where the next word starts', () => {
    const result = layout({ text: 'ab 가가', spacing: -0.4 });
    const line = linesOf(result)[0]!;
    const word = line.spans.find((span) => span.text === '가가')!;
    const at = (offset: number) =>
      caretAt(result, { paragraphId: word.range.paragraphId, offset }, measurer)!.x;
    expect(at(3) - at(2)).toBeCloseTo(4.7, 6);
    expect(at(3) - line.spans[0]!.box.x).toBeCloseTo(word.box.x - line.spans[0]!.box.x, 6);
  });
});

test('an AutoFit cell is as wide as its text with balanced spaces', () => {
  const table = (balanced: boolean, item: Run = '가가 나나 다다') =>
    layoutSemanticDocument(
      loadBody(
        '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblLayout w:type="autofit"/>' +
          '<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/>' +
          '</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="400"/></w:tblGrid><w:tr><w:tc>' +
          `<w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr><w:p>${run(item)}</w:p>` +
          '</w:tc></w:tr></w:tbl><w:p/>' +
          '<w:sectPr><w:pgSz w:w="9000" w:h="6000"/>' +
          '<w:pgMar w:left="500" w:right="500" w:top="500" w:bottom="500"/></w:sectPr>'
      ),
      1,
      { measurer, compatibilityMode: 15, styleCascade: cascade(balanced, 15) }
    );
  // 60 pt of syllables and two spaces of 5.5 pt: the text keeps one line in its cell.
  for (const balanced of [true, false]) {
    const lines = linesOf(table(balanced)).filter((line) => line.spans.length > 0);
    expect(lines[0]!.spans.map((span) => span.text).join('')).toBe('가가 나나 다다');
  }
  // With -0.4 pt spacing, the cell fits 57.6 pt of syllables and two 4.7 pt spaces.
  const spaced = linesOf(table(true, { text: '가가 나나 다다', spacing: -0.4 })).filter(
    (line) => line.spans.length > 0
  );
  expect(spaced[0]!.spans.map((span) => span.text).join('')).toBe('가가 나나 다다');
  const last = spaced[0]!.spans.at(-1)!;
  expect(last.box.x + last.box.width).toBeCloseTo(67, 6);
});

test('the caret after a widened space stands where the next word starts', () => {
  const result = layout('ab 가가 cd');
  const line = linesOf(result)[0]!;
  const word = line.spans.find((span) => span.text === '가가')!;
  // Offsets 0-2 are `ab `; the caret at 3 sits before `가가`, after the 5.5 pt space.
  const caret = caretAt(result, { paragraphId: word.range.paragraphId, offset: 3 }, measurer)!;
  expect(
    caret.x - caretAt(result, { paragraphId: word.range.paragraphId, offset: 2 }, measurer)!.x
  ).toBeCloseTo(5.5, 6);
  expect(word.box.x).toBe(25.5);
});

describe('justified lines with balanced spaces', () => {
  // The first line `aa bb 가가 cc 나나 dd` is 146 pt: six words, one Latin space (4 pt) and
  // four spaces beside Hangul (5.5 pt). `ee` wraps.
  const text = 'aa bb 가가 cc 나나 dd ee';
  test('the narrower spaces stretch first, up to the balanced width', () => {
    expect(spaceAdvances(layout(text, { jc: 'both', width: 147 }))).toEqual([
      5, 5.5, 5.5, 5.5, 5.5,
    ]);
  });

  test('once every space is as wide, they stretch together', () => {
    // 6 pt of slack: 1.5 pt brings the Latin space to 5.5 pt, and each space takes 0.9 pt more.
    expect(spaceAdvances(layout(text, { jc: 'both', width: 152 }))).toEqual([
      6.4, 6.4, 6.4, 6.4, 6.4,
    ]);
  });

  test('without balanced widths, every space stretches by the same amount', () => {
    // 140 pt of text on a 152 pt measure: 12 pt over five spaces.
    expect(spaceAdvances(layout(text, { jc: 'both', width: 152, balanced: false }))).toEqual([
      6.4, 6.4, 6.4, 6.4, 6.4,
    ]);
  });
});

test('the gap after Latin text before East Asian text is a quarter of the font size', () => {
  const settings = resolveCjkTypography([], {
    before: {},
    after: {},
    compression: 'doNotCompress',
    balancedWidths: true,
  } as never);
  const latin = { ...DEFAULT_RUN_STYLE, fontFamily: LATIN_ONLY, fontSizePt: 11 };
  const hangul = { ...DEFAULT_RUN_STYLE, fontFamily: 'Batang', fontSizePt: 11 };
  const gap = (policy: typeof settings) =>
    automaticTextGap({ text: 'a', style: latin }, { text: '가', style: hangul }, policy);
  expect(gap(settings)).toBe(2.75);
  // Without balanced widths it is half the Latin face's average width.
  expect(gap(resolveCjkTypography([]))).toBeCloseTo((11 * 821) / 2048 / 2, 6);
});

test('a shaped East Asian face: the widened space reads half an em, the Latin space its own', async () => {
  // The Noto Sans CJK JP subset: ideographs one em wide, a space of 224/1000 em.
  await initializeHarfBuzz();
  const bytes = new Uint8Array(
    readFileSync(new URL('./fixtures/fonts/NotoSansCJKjp-kana.subset.otf', import.meta.url))
  );
  const request = { family: 'Noto Sans CJK JP', weight: 400, style: 'normal' as const };
  const font = createFontResourceSnapshot({
    epoch: 0,
    maxFontBytes: 2_000_000,
    validateFont: harfBuzzFontValidator,
    resources: [{ id: 'cjk', request, bytes, hash: sha256FontBytes(bytes), faceIndex: 0 }],
  }).resolve(request);
  if (font instanceof FontResolutionError) throw font;
  const shaped = createShapedMeasurer({
    shaper: createHarfBuzzTextShaper(),
    resolveFont: () => font,
    fallback: createFixedMeasurer(),
    shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
    unicodeDataVersion: '15.1',
  });
  const text = { text: '漢字 国 AVA To', font: 'Noto Sans CJK JP' };
  // 漢字|国 and 国|AVA beside ideographs, AVA|To between Latin words.
  expect(spaceAdvances(layout(text, { measure: shaped }))).toEqual([5.5, 5.5, 2.464]);
  expect(spaceAdvances(layout(text, { measure: shaped, balanced: false }))).toEqual([
    2.464, 2.464, 2.464,
  ]);
});

describe('distributed characters with balanced spaces', () => {
  const narrowSpace: TextMeasurer = {
    ...measurer,
    measure: (text, style) =>
      [...text].reduce((n, c) => n + (c === ' ' ? 3 : 10) + style.characterSpacingPt, 0),
  };
  const settings = { jc: 'distribute', width: 60, runDefaults: true, measure: narrowSpace };
  const positions = (runs: Run | readonly Run[], balanced = true) =>
    linesOf(layout(runs, { ...settings, balanced }))[0]!
      .spans.filter((span) => span.text.trim())
      .map((span) => [span.text, span.box.x] as const);

  test('a balanced space uses the original advance for its character-distribution share', () => {
    // Four letters use 40 pt. The space first takes 1.45 * 3 = 4.35 pt.
    // Four character gaps share the remaining 15.65 pt, even though the balanced space is 5.5 pt.
    const result = positions('가나 다라');
    expect(result.map(([text]) => text)).toEqual(['가', '나', '다', '라']);
    expect(result.map(([, x]) => x)).toEqual([0, 13.9125, 36.0875, 50]);
    expect(result).toEqual(positions('가나 다라', false));
    expect(result).toEqual(positions(['가나', ' ', '다라']));
  });

  test('mixed balanced and natural spaces keep the same distributed character positions', () => {
    for (const text of ['가 a 나', '가  나', 'a b c']) {
      const actual = positions(text);
      const plain = positions(text, false);
      expect(actual.map(([text]) => text)).toEqual(plain.map(([text]) => text));
      for (let index = 0; index < actual.length; index += 1)
        expect(actual[index]![1]).toBeCloseTo(plain[index]![1], 8);
    }
  });

  test('a zero total space share still spreads the character gaps', () => {
    // One balanced and one natural space: (1.45 * natural - 5.5) + 0.45 * natural = 0.
    const natural = 5.5 / 1.9;
    const measure: TextMeasurer = {
      ...measurer,
      measure: (text, style) =>
        [...text].reduce((n, c) => n + (c === ' ' ? natural : 10) + style.characterSpacingPt, 0),
    };
    const spans = (balanced: boolean) =>
      linesOf(
        layout('가 a b', {
          ...settings,
          measure,
          balanced,
        })
      )[0]!.spans.filter((span) => span.text.trim());
    const balanced = spans(true),
      plain = spans(false);
    expect(balanced.map((span) => span.text)).toEqual(['가', 'a', 'b']);
    for (let index = 0; index < balanced.length; index += 1)
      expect(balanced[index]!.box.x).toBeCloseTo(plain[index]!.box.x, 8);
  });

  test('a full line keeps its balanced space without character distribution', () => {
    const result = layout('가나 다라', { ...settings, width: 45.5 });
    const line = linesOf(result)[0]!;
    expect(line.spans.map((span) => span.text).join('')).toBe('가나 다라');
    expect(spaceAdvances(result)).toEqual([5.5]);
    expect(linesOf(layout('가나 다라', { ...settings, width: 44 }))).toHaveLength(2);
  });

  test('spaced and scaled characters keep their distributed positions with balanced spaces', () => {
    for (const properties of [{ spacing: 1 }, { scale: 120 }]) {
      const run = { text: '가나 다라', ...properties };
      expect(positions(run)).toEqual(positions(run, false));
    }
    // The spaced space itself carries the widened advance, 5.5 pt and twice the spacing.
    const space = linesOf(
      layout({ text: '가나 다라', spacing: 1 }, { ...settings, width: 100 })
    )[0]!.spans.find((span) => span.text === ' ');
    expect(space?.box.width).toBeCloseTo(7.5, 6);
  });

  test('the caret follows the distributed glyph positions after a balanced space', () => {
    const result = layout('가나 다라', settings);
    const line = linesOf(result)[0]!;
    const after = line.spans.find((span) => span.text === '다')!;
    const caret = caretAt(
      result,
      { paragraphId: after.range.paragraphId, offset: 3 },
      narrowSpace
    )!;
    const origin = caretAt(
      result,
      { paragraphId: after.range.paragraphId, offset: 0 },
      narrowSpace
    )!;
    expect(caret.x - origin.x).toBeCloseTo(after.box.x, 8);
  });
});
