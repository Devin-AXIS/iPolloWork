import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement } from '@docx-editor.dev/core/store';
import { alignSpans, breakParagraph } from '../paragraph-flow.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { cjkTypographyFromSettings, resolveCjkTypography } from '../cjk-typography.ts';
import { buildStyleCascadeTable, resolveParagraphLayoutInputs } from '../style-cascade.ts';
import { anchorLineStartsByModelOffset } from '../anchor-line-probe.ts';
import { cjkParagraphBreaks } from '../cjk-paragraph-breaks.ts';
import { compressCjkPieces } from '../cjk-spacing.ts';
import { DEFAULT_RUN_STYLE, NO_THEME_FONTS } from '../run-style.ts';
import type { FieldAwarePiece } from '../field-projection.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);
const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
function root(xml: string): OoxmlElement {
  const read = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!read.ok) throw new Error(read.reason);
  return read.part.root;
}
function paragraph(parts: readonly string[], pPr = '', rPr = ''): OoxmlElement {
  return root(
    `<w:p xmlns:w="${W}"><w:pPr><w:overflowPunct w:val="0"/>${pPr}</w:pPr>${parts.map((text) => `<w:r><w:rPr><w:sz w:val="22"/>${rPr}</w:rPr><w:t xml:space="preserve">${escape(text)}</w:t></w:r>`).join('')}</w:p>`
  );
}
// Mode 15: legacy modes also hang punctuation in left, centered, and right-aligned lines.
const MODERN_MODE =
  '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>';
function layout(
  parts: readonly string[],
  width: number,
  pPr = '',
  rPr = '',
  settings = '',
  sourceDefaults = false
) {
  const p = paragraph(parts, pPr, rPr);
  const settingsRoot = root(`<w:settings xmlns:w="${W}">${MODERN_MODE}${settings}</w:settings>`);
  const cascade = sourceDefaults
    ? buildStyleCascadeTable(
        root(
          `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:eastAsia="Test CJK"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`
        ),
        // The font table gives the probe face an East Asian charset.
        { ...NO_THEME_FONTS, eastAsianFontTableFaces: ['test cjk'] },
        settingsRoot
      )
    : undefined;
  const inputs = resolveParagraphLayoutInputs(p, width, cascade);
  const props = inputs.props;
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
        props,
        cascade?.typography ?? cjkTypographyFromSettings(settingsRoot)
      ),
    }
  );
}
const textLines = (...args: Parameters<typeof layout>) =>
  layout(...args).map((line) => line.spans.map((span) => span.text).join(''));
// Punctuation hangs only when the document defaults name an East Asian face.
const eastAsianLines = (
  parts: readonly string[],
  width: number,
  pPr = '',
  rPr = '',
  settings = ''
) => textLines(parts, width, pPr, rPr, settings, true);

describe('CJK follow-up: protected groups across every run seam', () => {
  // A group that fits its line stays whole across the seam. One wider than the whole line
  // is cut at its last fitting character, the seam included (kinsoku-oversized-group).
  test.each([
    [['月。', '。盈'], 18, ['月。。', '盈'], ['月', '。', '。', '盈']],
    [['月、', '」盈'], 18, ['月、」', '盈'], ['月', '、', '」', '盈']],
    [['（以', '）来'], 18, ['（以）', '来'], ['（', '以', '）', '来']],
    [['「方」', '）盈'], 24, ['「方」）', '盈'], ['「', '方', '」', '）', '盈']],
  ] as const)('%j at %dpt', (parts, width, expected, oneCharacter) => {
    expect(textLines(parts, width)).toEqual([...expected]);
    expect(textLines(parts, 7)).toEqual([...oneCharacter]);
  });

  test('long Latin words wrap after a protected opening or combining seam', () => {
    for (const [parts, expected] of [
      [
        ['（', 'ABCDEFGHIJK'],
        ['（ABC', 'DEFG', 'HIJK'],
      ],
      [
        ['A', '\u0301BCDEFGHIJ中'],
        ['A\u0301BC', 'DEFG', 'HIJ中'],
      ],
    ] as const) {
      const lines = layout(parts, 24, '<w:autoSpaceDE w:val="0"/>');
      expect(lines.map((line) => line.spans.map((span) => span.text).join(''))).toEqual([
        ...expected,
      ]);
      for (const line of lines) expect(line.width).toBeLessThanOrEqual(24);
      expect(textLines([parts.join('')], 24, '<w:autoSpaceDE w:val="0"/>')).toEqual([...expected]);
      const automatic = layout(parts, 24);
      // No authored Latin metric is admitted, so the reverse seam adds no gap.
      const defaultExpected = [...expected];
      expect(automatic.map((line) => line.spans.map((span) => span.text).join(''))).toEqual(
        defaultExpected
      );
      expect(textLines([parts.join('')], 24)).toEqual(defaultExpected);
      for (const line of automatic) {
        expect(line.width).toBeLessThanOrEqual(24);
        for (const span of line.spans)
          expect(span.text).toBe(parts.join('').slice(span.range.start, span.range.end));
      }
      expect(
        automatic
          .flatMap((line) => line.spans)
          .map((span) => span.text)
          .join('')
      ).toBe(parts.join(''));
      expect(automatic.at(-1)!.spans.at(-1)!.range.end).toBe(parts.join('').length);
      if (parts[0] !== '（') {
        // HIJ中 is exactly 24pt. The absent authored metric adds no reverse gap.
        expect(lines.at(-1)!.width).toBeCloseTo(24, 8);
        expect(automatic.at(-2)!.width).toBeCloseTo(24, 8);
        expect(automatic.at(-1)!.width).toBeCloseTo(24, 8);
        expect(automatic.at(-1)!.spans[0]!.box.x).toBeCloseTo(0, 8);
      }
    }
  });

  test('formatting seams cannot change line breaks or lose source offsets', () => {
    for (const text of [
      '甲方（以下简称「买方」）应当按照本合同第３条、第４条之约定，支付０．５％。',
      '甲か\u3099\u309a月𠀋乙',
      '甲👩‍👩‍👧‍👦乙',
      '甲ＡＢＣ乙１２，３４５．６７％丙',
      '（ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      '甲A\u0301BCDEFGHIJKLMNOPQRSTUVWXYZ中',
    ]) {
      for (const width of [7, 13, 25, 36, 60]) {
        const expected = textLines([text], width);
        for (let split = 1; split < text.length; split++) {
          // XML cannot represent an isolated surrogate; split at code-point boundaries.
          if (/[\udc00-\udfff]/u.test(text[split]!)) continue;
          const lines = layout([text.slice(0, split), text.slice(split)], width);
          expect(lines.map((line) => line.spans.map((span) => span.text).join(''))).toEqual(
            expected
          );
          expect(
            lines
              .flatMap((line) => line.spans)
              .map((span) => span.text)
              .join('')
          ).toBe(text);
          let end = 0;
          for (const line of lines)
            for (const span of line.spans) {
              expect(span.range.start).toBe(end);
              expect(span.range.end - span.range.start).toBe(span.text.length);
              end = span.range.end;
            }
          expect(end).toBe(text.length);
        }
      }
    }
  });
});

describe('CJK follow-up: mixed text and figure groups', () => {
  test('non-breaking glue survives every run seam and paragraph wrapping policy', () => {
    for (const glue of ['\u00a0', '\u202f', '\u2060', '\ufeff']) {
      const text = `甲乙A${glue}B丙`;
      for (const pPr of ['', '<w:kinsoku w:val="0"/>', '<w:wordWrap w:val="0"/>']) {
        const expected = textLines([text], 24, pPr);
        expect(expected.some((line) => line.includes(`A${glue}B`))).toBe(true);
        for (let split = 1; split < text.length; split++) {
          expect(textLines([text.slice(0, split), text.slice(split)], 24, pPr)).toEqual(expected);
        }
        // Even an undersized measure cannot split either side of explicit glue.
        expect(textLines([`天${glue}地`], 7, pPr)).toEqual([`天${glue}地`]);
      }
    }
    expect(textLines(['甲乙A B丙'], 24)).not.toEqual(textLines(['甲乙A\u00a0B丙'], 24));
  });
  test('full-width decimal and alphabetic groups move together', () => {
    expect(textLines(['天地０.５日'], 24)).toEqual(['天地', '０.５日']);
    expect(textLines(['天地０．５日'], 24)).toEqual(['天地', '０．５日']);
    expect(textLines(['天地ＡＢＣ日'], 24)).toEqual(['天地', 'ＡＢＣ日']);
  });
  test('Latin words remain whole while boundaries beside CJK become available', () => {
    expect(textLines(['甲ABCD乙'], 25)).toEqual(['甲', 'ABCD', '乙']);
    expect(textLines(['aa bb ℃cccc'], 60)).toEqual(['aa bb ', '℃cccc']);
  });
  test('ASCII punctuation beside CJK stays with its carrier', () => {
    expect(textLines(['天地,月'], 13)).toEqual(['天', '地,', '月']);
    expect(textLines(['天(', '地)月'], 18)).toEqual(['天', '(地)', '月']);
    // Wider than its line, the group is cut where it stops fitting.
    expect(textLines(['天(', '地)月'], 13)).toEqual(['天', '(地', ')月']);
  });
  test('Korean word wrapping is selectable without dividing a syllable', () => {
    expect(textLines(['가나 다라마'], 25)).toEqual(['가나 ', '다라마']);
    expect(textLines(['가나 다라마'], 25, '<w:wordWrap w:val="0"/>')).toEqual(['가나 다', '라마']);
    expect(textLines(['ᄀ', 'ᅡᆨ나'], 7, '<w:wordWrap w:val="0"/>')).toEqual(['각', '나']);
  });
});

describe('CJK follow-up: document and paragraph policy', () => {
  test('kinsoku can be disabled without disabling grapheme safety', () => {
    expect(textLines(['天。地'], 7, '<w:kinsoku w:val="0"/>')).toEqual(['天', '。', '地']);
    expect(textLines(['か', '\u3099月'], 7, '<w:kinsoku w:val="0"/>')).toEqual(['か\u3099', '月']);
  });
  test('Japanese normal and strict kinsoku use different small-kana rules', () => {
    const lang = '<w:lang w:eastAsia="ja-JP"/>';
    expect(textLines(['あいゃう'], 13, '', lang)).toEqual(['あい', 'ゃう']);
    expect(textLines(['あいゃう'], 13, '', lang, '<w:strictFirstAndLastChars/>')).toEqual([
      'あ',
      'いゃ',
      'う',
    ]);
    // A strict group wider than its line is cut like any other.
    expect(textLines(['あゃい'], 7, '', lang, '<w:strictFirstAndLastChars/>')).toEqual([
      'あ',
      'ゃ',
      'い',
    ]);
  });
  test('custom settings replace the specified direction for the specified language', () => {
    const custom = '<w:noLineBreaksBefore w:lang="ja-JP" w:val="甲"/>';
    expect(textLines(['天地甲人'], 13, '', '<w:lang w:eastAsia="ja-JP"/>', custom)).toEqual([
      '天',
      '地甲',
      '人',
    ]);
    expect(textLines(['天地甲人'], 13, '', '<w:lang w:eastAsia="zh-CN"/>', custom)).toEqual([
      '天地',
      '甲人',
    ]);
    expect(
      textLines(
        ['天地甲人'],
        13,
        '',
        '<w:lang w:eastAsia="ja-JP"/>',
        '<w:noLineBreaksAfter w:lang="ja-JP" w:val="地"/>'
      )
    ).toEqual(['天', '地甲', '人']);
  });
  test('style inheritance and settings participate in the cascade fingerprint', () => {
    const styles = root(
      `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="Base" w:default="1"><w:pPr><w:kinsoku w:val="0"/></w:pPr></w:style></w:styles>`
    );
    const before = buildStyleCascadeTable(styles);
    const after = buildStyleCascadeTable(
      styles,
      undefined,
      root(`<w:settings xmlns:w="${W}"><w:strictFirstAndLastChars/></w:settings>`)
    );
    expect(after.cacheToken).not.toBe(before.cacheToken);
    const inherited = resolveParagraphLayoutInputs(paragraph(['天。']), 13, before);
    expect(resolveCjkTypography(inherited.props, before.typography).kinsoku).toBe(false);
    const overridden = resolveParagraphLayoutInputs(
      paragraph(['天。'], '<w:kinsoku/>'),
      13,
      before
    );
    expect(resolveCjkTypography(overridden.props, before.typography).kinsoku).toBe(true);
  });
  test('punctuation overflow follows the paragraph switch and allows only one character', () => {
    // Punctuation hangs only on justified lines.
    const jc = '<w:jc w:val="both"/>';
    expect(eastAsianLines(['天地。人'], 12, `<w:overflowPunct/>${jc}`)).toEqual(['天地。', '人']);
    expect(eastAsianLines(['天地。人'], 12, `<w:overflowPunct w:val="0"/>${jc}`)).toEqual([
      '天',
      '地。',
      '人',
    ]);
    expect(eastAsianLines(['天地。。人'], 12, `<w:overflowPunct/>${jc}`)).toEqual([
      '天',
      '地。。',
      '人',
    ]);
    for (const align of ['left', 'center', 'right'])
      expect(
        eastAsianLines(['天地。人'], 12, `<w:overflowPunct/><w:jc w:val="${align}"/>`)
      ).toEqual(['天', '地。', '人']);
  });
  test('Latin punctuation in an East Asian language run hangs on a justified line', () => {
    const props = '<w:overflowPunct/><w:jc w:val="both"/>';
    const language = '<w:lang w:eastAsia="zh-CN"/>';
    expect(eastAsianLines(['Alpha Beta, Next'], 60, props, language)).toEqual([
      'Alpha Beta,',
      ' Next',
    ]);
    expect(
      eastAsianLines(['Alpha Beta, Next'], 60, props + '<w:overflowPunct w:val="0"/>', language)
    ).toEqual(['Alpha ', 'Beta, Next']);
    expect(eastAsianLines(['Alpha Beta, Next'], 60, props)).toEqual(['Alpha ', 'Beta, Next']);
  });
  test.each(['left', 'center', 'right'])(
    'Latin punctuation in an East Asian language run stays inside a %s-aligned line',
    (alignment) => {
      const props = `<w:overflowPunct/><w:jc w:val="${alignment}"/>`;
      const language = '<w:lang w:eastAsia="zh-CN"/>';
      expect(eastAsianLines(['Alpha Beta, Next'], 60, props, language)).toEqual([
        'Alpha ',
        'Beta, Next',
      ]);
    }
  );
  test('a closing curly quote in a Japanese run hangs only on a justified line', () => {
    const japanese = '<w:lang w:eastAsia="ja-JP"/>';
    const props = (alignment: string) => `<w:overflowPunct/><w:jc w:val="${alignment}"/>`;
    expect(eastAsianLines(['天地人”'], 18, props('both'), japanese)).toEqual(['天地人”']);
    expect(eastAsianLines(['天地人”'], 18, props('left'), japanese)).toEqual(['天地', '人”']);
  });
  test('a document whose defaults name no East Asian face hangs no punctuation', () => {
    const props = '<w:overflowPunct/><w:jc w:val="both"/>';
    expect(textLines(['天地。人'], 12, props)).toEqual(['天', '地。', '人']);
    expect(textLines(['天地人”'], 18, props, '<w:lang w:eastAsia="ja-JP"/>')).toEqual([
      '天地',
      '人”',
    ]);
  });
  test('authored punctuation thresholds act independently of characterSpacingControl', () => {
    const ordinary = layout(['天地。。'], 21);
    expect(ordinary).toHaveLength(2);
    for (const settings of [
      '',
      '<w:characterSpacingControl w:val="doNotCompress"/>',
      '<w:characterSpacingControl w:val="compressPunctuation"/>',
      '<w:characterSpacingControl w:val="compressPunctuationAndJapaneseKana"/>',
    ]) {
      const compressed = layout(['天地。。'], 21, '', '<w:kern w:val="2"/>', settings, true);
      expect(compressed).toHaveLength(1);
      expect(compressed[0]!.width).toBe(21);
      expect(compressed[0]!.spans.map((span) => span.text).join('')).toBe('天地。。');
      expect(compressed[0]!.end).toBe(4);
      expect(layout(['天地。。'], 21, '', '<w:kern w:val="2"/>', settings)).toHaveLength(2);
      for (const kern of [0, 60])
        expect(
          layout(['天地。。'], 21, '', `<w:kern w:val="${kern}"/>`, settings, true)
        ).toHaveLength(2);
      expect(
        layout(
          ['天地。。'],
          21,
          '',
          '<w:kern w:val="2"/>',
          settings + '<w:noPunctuationKerning/>',
          true
        )
      ).toHaveLength(2);
    }
    const kanaSettings = '<w:characterSpacingControl w:val="compressPunctuationAndJapaneseKana"/>';
    expect(layout(['アイ'], 12, '', '', kanaSettings)[0]!.width).toBe(12);
    expect(textLines(['アイ'], 11, '', '', kanaSettings)).toEqual(['ア', 'イ']);
  });
  test('contextual compression preserves the explicit hanging punctuation switch', () => {
    const settings = '<w:characterSpacingControl w:val="compressPunctuation"/>';
    // Punctuation hangs only on justified lines.
    const hang = '<w:overflowPunct/><w:jc w:val="both"/>';
    expect(eastAsianLines(['天地。人'], 12, hang, '', settings)).toEqual(['天地。', '人']);
    expect(eastAsianLines(['天地。人'], 12, '<w:overflowPunct w:val="0"/>', '', settings)).toEqual([
      '天',
      '地。',
      '人',
    ]);
  });
  test('compression preserves grapheme geometry across every formatting seam', () => {
    const settings = '<w:characterSpacingControl w:val="compressPunctuationAndJapaneseKana"/>';
    for (const text of ['か\u3099天地', 'カ\u309a天地', '「か\u3099」天地。']) {
      for (const width of [7, 17, 24, 60]) {
        const expected = layout([text], width, '', '', settings);
        for (let split = 1; split < text.length; split++) {
          const actual = layout([text.slice(0, split), text.slice(split)], width, '', '', settings);
          expect(actual.map((line) => line.spans.map((span) => span.text).join(''))).toEqual(
            expected.map((line) => line.spans.map((span) => span.text).join(''))
          );
          expect(actual.map((line) => line.width)).toEqual(expected.map((line) => line.width));
          const spans = actual.flatMap((line) => line.spans);
          expect(spans.map((span) => span.text).join('')).toBe(text);
          let end = 0;
          for (const span of spans) {
            expect(span.range.start).toBe(end);
            end = span.range.end;
          }
          expect(end).toBe(text.length);
        }
      }
    }
    expect(textLines(['か\u3099天地'], 17, '', '', settings)).toEqual(['か\u3099', '天地']);
  });
  test('compression leaves projected atoms and source properties unchanged', () => {
    const style = Object.freeze({ ...DEFAULT_RUN_STYLE, fontSizePt: 11 });
    const pieces: FieldAwarePiece[] = [
      { text: 'か', start: 0, end: 1, style, props: [] },
      { text: '', start: 1, end: 1, style, props: [], projected: true },
      { text: '\u3099', start: 1, end: 2, style, props: [] },
      { text: '。', start: 2, end: 3, style, props: [], projected: true },
    ];
    pieces.forEach(Object.freeze);
    const settings = cjkTypographyFromSettings(
      root(
        `<w:settings xmlns:w="${W}"><w:characterSpacingControl w:val="compressPunctuationAndJapaneseKana"/></w:settings>`
      )
    );
    const result = compressCjkPieces(pieces, resolveCjkTypography([], settings), measurer);
    expect(result[0]).toBe(pieces[0]!);
    expect(result[1]).toBe(pieces[1]!);
    expect(result[2]).toBe(pieces[2]!);
    expect(result[3]).toBe(pieces[3]!);
    expect(style.characterSpacingPt).toBe(0);
    expect(result[0]!.props).toBe(pieces[0]!.props);
  });
});

describe('CJK follow-up: geometry', () => {
  test('justification fills a shortened line with measured inter-character gaps', () => {
    const line = layout(['天地玄黄'], 60)[0]!;
    const aligned = alignSpans(line.spans, measurer, 0, 30, 'both', false);
    expect(aligned.map((span) => span.box.x)).toEqual([0, 8, 16, 24]);
    expect(aligned.at(-1)!.box.x + aligned.at(-1)!.box.width).toBe(30);
    expect(aligned.map((span) => span.range.start)).toEqual([0, 1, 2, 3]);
    expect(alignSpans(line.spans, measurer, 0, 30, 'both', true)).toBe(line.spans);
  });
  test('anchor probe uses the same protected seams as placement', () => {
    const pieces: FieldAwarePiece[] = [
      {
        text: '天地月',
        start: 0,
        end: 3,
        props: [],
        style: { ...DEFAULT_RUN_STYLE, fontSizePt: 11 },
      },
      {
        text: '、盈',
        start: 3,
        end: 5,
        props: [],
        style: { ...DEFAULT_RUN_STYLE, fontSizePt: 11 },
      },
    ];
    const typography = resolveCjkTypography([
      { localName: 'overflowPunct', attributes: { val: '0' } },
    ]);
    const starts = anchorLineStartsByModelOffset({
      pieces,
      measurer,
      available: 18,
      firstLineOffset: 0,
      anchorStarts: [0, 2, 3],
      equationLayoutOf: () => null,
      typography,
      cjkBreaks: cjkParagraphBreaks(pieces, typography),
    });
    expect(starts.get(3)).toBe(2);
    expect(starts.get(0)).toBe(0);
    expect(starts.get(2)).toBe(2);
  });
});
