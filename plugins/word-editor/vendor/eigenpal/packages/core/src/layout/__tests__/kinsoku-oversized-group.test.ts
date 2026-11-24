// A group that kinsoku keeps together but that is wider than its whole line.
//
// Measured rule (12 pt and 10.5 pt, ja-JP strict and zh-CN custom lists, automatic spacing on
// and off): such a group first moves to a fresh line, like any word that does not fit. When
// it is wider than that whole line too, it is cut at its last fitting character, as an
// over-long Latin word is, even where the kinsoku sets forbid that cut. The automatic gap
// before a fragment counts toward the fit; the gap at the cut does not. A justified line
// keeps the group whole when it fits with its automatic gaps at half width, and a mark
// that may hang at a justified line end keeps its line whole.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement } from '@docx-editor.dev/core/store';
import { breakParagraph } from '../paragraph-flow.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { withAuthoredCjkGapMetric } from '../cjk-auto-spacing-metric-port.ts';
import { cjkTypographyFromSettings, resolveCjkTypography } from '../cjk-typography.ts';
import { buildStyleCascadeTable, resolveParagraphLayoutInputs } from '../style-cascade.ts';
import { NO_THEME_FONTS } from '../run-style.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
// 6 pt per character at 11 pt; an automatic gap is a quarter of the font size, 2.75 pt.
const measurer = withAuthoredCjkGapMetric(
  createFixedMeasurer(6, 14),
  (style) => style.fontSizePt / 4
);
const STRICT = '<w:strictFirstAndLastChars/>';
const JA = '<w:lang w:eastAsia="ja-JP"/>';
const ZH = '<w:lang w:eastAsia="zh-CN"/>';
// No line break after 甲 or A, and none before A or 乙.
const ZH_LISTS =
  '<w:noLineBreaksAfter w:lang="zh-CN" w:val="甲A"/><w:noLineBreaksBefore w:lang="zh-CN" w:val="A乙"/>';

function root(xml: string): OoxmlElement {
  const read = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!read.ok) throw new Error(read.reason);
  return read.part.root;
}

const runOf = (text: string, rPr: string) =>
  `<w:r><w:rPr><w:sz w:val="22"/>${rPr}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;

// Mode 15: legacy modes also hang punctuation in left, centered, and right-aligned lines.
const MODERN_MODE =
  '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>';
function layout(
  parts: readonly string[],
  width: number,
  {
    pPr = '',
    rPr = '',
    settings = '',
    field = false,
  }: { pPr?: string; rPr?: string; settings?: string; field?: boolean } = {}
) {
  const runs = parts.map((text) => runOf(text, rPr)).join('');
  // A field result is one layout-owned piece that checks its cuts by its own text.
  const body = field ? `<w:fldSimple w:instr=" DATE ">${runs}</w:fldSimple>` : runs;
  const p = root(`<w:p xmlns:w="${W}"><w:pPr>${pPr}</w:pPr>${body}</w:p>`);
  const settingsRoot = root(`<w:settings xmlns:w="${W}">${MODERN_MODE}${settings}</w:settings>`);
  // Document defaults that name an East Asian face, so justified punctuation may hang.
  const cascade = buildStyleCascadeTable(
    root(
      `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:eastAsia="Test CJK"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`
    ),
    { ...NO_THEME_FONTS, eastAsianFontTableFaces: ['test cjk'] },
    settingsRoot
  );
  const inputs = resolveParagraphLayoutInputs(p, width, cascade);
  return breakParagraph(
    p,
    'p',
    0,
    width,
    measurer,
    undefined,
    null,
    inputs.inheritedRunProperties,
    undefined,
    undefined,
    undefined,
    {
      typography: resolveCjkTypography(
        inputs.props,
        cascade.typography ?? cjkTypographyFromSettings(settingsRoot)
      ),
      cjkPunctuationFit: /w:jc w:val="both"/.test(pPr),
    }
  );
}
const textLines = (...args: Parameters<typeof layout>) =>
  layout(...args).map((line) => line.spans.map((span) => span.text).join(''));

describe('a kinsoku group wider than its line', () => {
  test('breaks at its last fitting character, after moving to a fresh line', () => {
    const strict = { rPr: JA, settings: STRICT };
    // 3ヵ is 6 + 2.75 + 6 = 14.75 pt: it fits a 14.75 pt line and is cut on a 14.7 pt one.
    expect(textLines(['3ヵ月'], 14.75, strict)).toEqual(['3ヵ', '月']);
    expect(textLines(['3ヵ月'], 14.7, strict)).toEqual(['3', 'ヵ月']);
    // The group leaves 前文 first, although 前文3 would fit on that line.
    expect(textLines(['前文3ヵ月'], 25, strict)).toEqual(['前文', '3ヵ月']);
    expect(textLines(['前文3ヵ月'], 14.7, strict)).toEqual(['前文', '3', 'ヵ月']);
    // Several small kana in a row: as many as fit, then the rest.
    expect(textLines(['アァァァ月'], 13.2, strict)).toEqual(['アァ', 'ァァ', '月']);
  });

  test('breaks at a forbidden line start or end, and at a run seam', () => {
    for (const parts of [['天。地。人。'], ['天。', '地。人。']]) {
      expect(textLines(parts, 7)).toEqual(['天', '。', '地', '。', '人', '。']);
      expect(textLines(parts, 13.2)).toEqual(['天。', '地。', '人。']);
    }
    expect(textLines(['天。地。人。'], 7, { field: true })).toEqual([
      '天',
      '。',
      '地',
      '。',
      '人',
      '。',
    ]);
    expect(textLines(['（', '以来'], 7)).toEqual(['（', '以', '来']);
    expect(textLines(['（', '以来'], 13.2)).toEqual(['（以', '来']);
    // Authored lists join 甲ABCD乙 into one group; it is cut inside the Latin word too.
    const custom = { rPr: ZH, settings: ZH_LISTS };
    expect(textLines(['前文甲', 'ABCD', '乙后'], 20, custom)).toEqual([
      '前文',
      '甲A',
      'BCD',
      '乙后',
    ]);
  });

  test('counts the automatic gap before a fragment, never the gap at the cut', () => {
    const custom = { rPr: ZH, settings: ZH_LISTS };
    // 甲 + 2.75 + AB is 20.75 pt: without the gap, 甲AB would seem to fit a 20 pt line.
    const lines = layout(['甲', 'ABCD', '乙'], 20, custom);
    expect(lines.map((line) => line.spans.map((span) => span.text).join(''))).toEqual([
      '甲A',
      'BCD',
      '乙',
    ]);
    for (const line of lines) expect(line.width).toBeLessThanOrEqual(20);
    // The gap inside the cut line stays drawn.
    const [ideograph, letter] = lines[0]!.spans;
    expect(letter!.box.x - ideograph!.box.x - ideograph!.box.width).toBeCloseTo(2.75, 8);
    // 甲A is 14.75 pt; the 2.75 pt gap after A falls at the cut, so a 15 pt line holds it.
    expect(textLines(['甲', 'ABCD', '乙'], 15, custom)[0]).toBe('甲A');
  });

  test('stays whole on a justified line when it fits with its gaps at half width', () => {
    const strict = { rPr: JA, settings: STRICT };
    const justified = { ...strict, pPr: '<w:jc w:val="both"/>' };
    // 3ヵ at half gap is 6 + 1.375 + 6 = 13.375 pt.
    expect(textLines(['3ヵ月'], 13.4, justified)).toEqual(['3ヵ', '月']);
    expect(textLines(['3ヵ月'], 13.3, justified)).toEqual(['3', 'ヵ月']);
    expect(textLines(['3ヵ月'], 13.4, strict)).toEqual(['3', 'ヵ月']);
    // 甲ABCD乙 is 41.5 pt, 38.75 pt at half gap: whole on a justified 39 pt line only.
    const custom = { rPr: ZH, settings: ZH_LISTS };
    const justifiedCustom = { ...custom, pPr: '<w:jc w:val="both"/>' };
    expect(textLines(['甲', 'ABCD', '乙'], 39, justifiedCustom)).toEqual(['甲ABCD乙']);
    expect(textLines(['甲', 'ABCD', '乙'], 39, custom)).toEqual(['甲ABCD', '乙']);
    // The slack belongs to the whole group: 甲ABCD (32.75 pt) would fit a 31.5 pt line at
    // half gap, but the group goes on, so it is cut at its last fitting character.
    expect(textLines(['甲', 'ABCD', '乙'], 31.5, justifiedCustom)).toEqual(['甲ABC', 'D乙']);
  });

  test('keeps a mark that hangs at a justified line end on every line', () => {
    const justified = { pPr: '<w:jc w:val="both"/>' };
    expect(textLines(['天。地。人。'], 7, justified)).toEqual(['天。', '地。', '人。']);
    // Without hanging the justified group is cut like any other.
    expect(
      textLines(['天。地。人。'], 7, { pPr: '<w:overflowPunct w:val="0"/><w:jc w:val="both"/>' })
    ).toEqual(['天', '。', '地', '。', '人', '。']);
  });
});
