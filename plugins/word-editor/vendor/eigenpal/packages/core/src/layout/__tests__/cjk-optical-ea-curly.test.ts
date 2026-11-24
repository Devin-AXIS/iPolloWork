import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { DEFAULT_RUN_STYLE, NO_THEME_FONTS, type ResolvedRunStyle } from '../run-style.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf, type StyleSpanRecord, type TextMeasurer } from '../semantic-records.ts';
import { canFitCjkOptically, createCjkOpticalFitter } from '../cjk-optical-fit.ts';
import { cjkParagraphBreaks } from '../cjk-paragraph-breaks.ts';
import { DEFAULT_CJK_TYPOGRAPHY } from '../cjk-typography.ts';
import type { FieldAwarePiece } from '../field-pieces.ts';
import type { PendingLine } from '../pending-line.ts';

// Invented advances and bearings. No installed font or reported document is required.
const measure: TextMeasurer = {
  measure: (text, style) =>
    (text.length * 12 * style.horizontalScalePercent) / 100 +
    text.length * style.characterSpacingPt,
  lineMetrics: () => ({ height: 16, baseline: 12 }),
  hasResolvedFont: () => true,
  inkBounds: (text) =>
    /^[“‘]$/u.test(text)
      ? { left: 9, right: 11 }
      : /^[。：”’]$/u.test(text)
        ? { left: 1, right: 3 }
        : { left: 1, right: 11 },
};
const style: ResolvedRunStyle = {
  ...DEFAULT_RUN_STYLE,
  fontSizePt: 12,
  fontFamily: 'Fixture Latin',
  fontFamilyEastAsia: 'Fixture EA',
};
function attempt(
  options: {
    prefix?: string;
    suffix?: string;
    slot?: StyleSpanRecord['fontSlot'];
    style?: ResolvedRunStyle;
    measurer?: TextMeasurer;
    localQualification?: boolean;
    available?: number;
    spanFlags?: Partial<StyleSpanRecord>;
  } = {}
) {
  const prefix = options.prefix ?? '甲。乙“';
  const suffix = options.suffix ?? '丙”丁';
  const slot = options.slot ?? 'eastAsia';
  const s = options.style ?? style;
  const m = options.measurer ?? measure;
  const width = m.measure(prefix, s);
  const pieces: FieldAwarePiece[] = [prefix, suffix].map((text, index) => ({
    text,
    start: index ? prefix.length : 0,
    end: index ? prefix.length + suffix.length : prefix.length,
    style: s,
    props: [],
    fontSlot: slot,
  }));
  const span: StyleSpanRecord = {
    text: prefix,
    range: { paragraphId: 'generic', start: 0, end: prefix.length },
    style: s,
    props: [],
    fontSlot: slot,
    box: { x: 0, y: 0, width, height: 16 },
    ...options.spanFlags,
  };
  const before = { ...span, box: { ...span.box } };
  const line: PendingLine = {
    spans: [span],
    drawings: [],
    start: 0,
    end: prefix.length,
    width,
    height: 16,
    baseline: 12,
    leading: 0,
    trailingSpacing: 0,
  };
  const available = options.available ?? 70;
  const result = createCjkOpticalFitter(
    pieces,
    cjkParagraphBreaks(pieces, DEFAULT_CJK_TYPOGRAPHY),
    m,
    { hangingPunctuation: false, requireLocalQualification: options.localQualification ?? true }
  )(
    line,
    1,
    suffix,
    { paragraphId: 'generic', start: prefix.length, end: prefix.length + suffix.length },
    m.measure(suffix, s),
    width,
    available,
    true
  );
  return { result, line, before, width, pieces, available };
}
function unchanged(value: ReturnType<typeof attempt>) {
  expect(value.result).toBeUndefined();
  expect(value.line.spans).toEqual([value.before]);
  expect(value.line.width).toBe(value.width);
}

test('explicit EA curly bearings join an existing CJK punctuation fitting window', () => {
  const a = attempt();
  // The paragraph-wide gate refuses curly quotes; the qualified local path fits them.
  expect(canFitCjkOptically(a.pieces)).toBe(false);
  expect(a.result).toBeDefined();
  expect(a.line.width + a.result!.width).toBeCloseTo(70, 8);
  const spans = [...a.line.spans, ...a.result!.candidate];
  expect(spans.map((x) => x.text).join('')).toBe('甲。乙“丙”丁');
  expect(spans.map((x) => [x.range.start, x.range.end])).toEqual([
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 4],
    [4, 5],
    [5, 6],
    [6, 7],
  ]);
  for (const span of spans.filter((x) => /^[甲乙丙丁]$/u.test(x.text)))
    expect(span.box.width).toBe(12);
  expect(spans.filter((x) => /^[“”]$/u.test(x.text)).every((x) => x.box.width < 12)).toBe(true);
});

test('curly-only windows keep the existing punctuation-presence gate', () => {
  unchanged(attempt({ prefix: '甲“乙', suffix: '”丙', available: 50 }));
});

test('the paragraph-wide path leaves curly quotes unchanged', () => {
  unchanged(attempt({ localQualification: false }));
});

test('an opening curly quote after a Latin word gives up its outer blank side', () => {
  // The Latin word has an outline, so the quote's left side faces measured ink.
  const outlined: TextMeasurer = {
    ...measure,
    textOutline: (text) => ({
      path: null,
      ink: { left: 0.4, right: 12 * text.length - 0.3, top: -10, bottom: 2 },
    }),
  };
  const texts: [string, StyleSpanRecord['fontSlot']][] = [
    ['甲。', 'eastAsia'],
    ['AB', 'hAnsi'],
    ['“', 'eastAsia'],
  ];
  let start = 0;
  let x = 0;
  const spans: StyleSpanRecord[] = texts.map(([text, fontSlot]) => {
    const width = outlined.measure(text, style);
    const span: StyleSpanRecord = {
      text,
      range: { paragraphId: 'generic', start, end: start + text.length },
      style,
      props: [],
      fontSlot,
      box: { x, y: 0, width, height: 16 },
    };
    start += text.length;
    x += width;
    return span;
  });
  const suffix = '丙”丁';
  const pieces: FieldAwarePiece[] = [];
  for (const [text, fontSlot] of [...texts, [suffix, 'eastAsia'] as const]) {
    const from = pieces.at(-1)?.end ?? 0;
    pieces.push({ text, start: from, end: from + text.length, style, props: [], fontSlot });
  }
  const line: PendingLine = {
    spans,
    drawings: [],
    start: 0,
    end: start,
    width: x,
    height: 16,
    baseline: 12,
    leading: 0,
    trailingSpacing: 0,
  };
  const result = createCjkOpticalFitter(
    pieces,
    cjkParagraphBreaks(pieces, DEFAULT_CJK_TYPOGRAPHY),
    outlined,
    { hangingPunctuation: false, requireLocalQualification: true }
  )(
    line,
    spans.length,
    suffix,
    { paragraphId: 'generic', start, end: start + suffix.length },
    outlined.measure(suffix, style),
    x,
    x + 36 - 4,
    true
  );
  expect(result).toBeDefined();
  const quote = [...line.spans, ...(result?.candidate ?? [])].find((span) => span.text === '“');
  // Three blank sides share the 4pt: the full stop, the opening quote, and the closing quote.
  expect(quote?.box.width).toBeCloseTo(12 - 4 / 3, 8);
});

test('EA curly fitting requires resolved, untracked, unscaled, simple shaping', () => {
  for (const s of [
    { ...style, characterSpacingPt: 1 },
    { ...style, horizontalScalePercent: 90 },
    { ...style, shaping: { direction: 'rtl' as const } },
  ])
    unchanged(attempt({ style: s }));
  unchanged(attempt({ measurer: { ...measure, hasResolvedFont: undefined } }));
  unchanged(attempt({ measurer: { ...measure, hasResolvedFont: () => false } }));
  unchanged(attempt({ measurer: { ...measure, inkBounds: () => undefined } }));
});

test('decorated, projected and noncontiguous spans retain their original geometry', () => {
  unchanged(attempt({ style: { ...style, underline: { variant: 'single', color: null } } }));
  unchanged(attempt({ spanFlags: { projected: true } }));
  unchanged(attempt({ spanFlags: { range: { paragraphId: 'generic', start: 0, end: 3 } } }));
});

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function part(xml: string) {
  const p = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'application/xml' });
  if (!p.ok) throw new Error(p.reason);
  return p.part;
}
function layout(
  noPunctuationKerning = false,
  hint = 'eastAsia',
  text = '甲。乙“丙”丁',
  width = 78,
  measurer = measure
) {
  const doc = part(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:jc w:val="both"/><w:overflowPunct w:val="0"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Fixture Latin" w:hAnsi="Fixture Latin" w:eastAsia="Fixture EA" w:hint="${hint}"/><w:sz w:val="24"/></w:rPr><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`
  );
  const styles = part(
    `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:eastAsia="Fixture EA"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`
  );
  const settings = part(
    `<w:settings xmlns:w="${W}"><w:characterSpacingControl w:val="compressPunctuation"/>${noPunctuationKerning ? '<w:noPunctuationKerning/>' : ''}</w:settings>`
  );
  const cascade = buildStyleCascadeTable(
    styles.root,
    { ...NO_THEME_FONTS, eastAsianFontTableFaces: ['fixture ea'] },
    settings.root
  );
  const lines = linesOf(
    layoutSemanticDocument(doc, 0, {
      measurer,
      styleCascade: cascade,
      geometry: {
        width: width + 20,
        height: 500,
        margin: { top: 10, right: 10, bottom: 10, left: 10 },
      },
    })
  );
  return { lines, cascade };
}
test('real paragraph flow supplies the source policy and retains source ranges', () => {
  // The natural six-character prefix uses 72pt of 78pt; the next 12pt glyph has 6pt.
  // This meets the existing half-glyph gate and needs 6pt of measured bearings.
  const a = layout();
  expect(a.lines).toHaveLength(1);
  expect(
    a.lines
      .flatMap((x) => x.spans)
      .map((x) => x.text)
      .join('')
  ).toBe('甲。乙“丙”丁');
  expect(a.lines.flatMap((x) => x.spans).at(-1)!.range.end).toBe(7);
});
test('a legal settings-level noPunctuationKerning flag prevents EA curly fitting', () => {
  expect(layout(true).lines.length).toBeGreaterThan(1);
});
test('unhinted curly quotes keep their advances while other seams fit the line', () => {
  const spans = layout(false, 'default').lines.flatMap((x) => x.spans);
  const quotes = spans.filter((x) => /^[“”]$/u.test(x.text));
  expect(quotes).toHaveLength(2);
  for (const quote of quotes) expect(quote.box.width).toBe(12);
});

const spansOf = (text: string, width: number, hint = 'eastAsia', measurer = measure) =>
  layout(false, hint, text, width, measurer).lines.map((line) => line.spans);
// Latin-face quotes are whole words; their outline supplies the ink a blank side faces.
const outlined: TextMeasurer = {
  ...measure,
  textOutline: (text) => ({
    path: null,
    ink: { left: 1, right: 12 * text.length - 1, top: -10, bottom: 2 },
  }),
};
const widthOf = (spans: readonly { text: string; box: { width: number } }[], text: string) =>
  spans.find((span) => span.text === text)?.box.width;
test('a final closing curly quote after an ideograph loses its trailing bearing', () => {
  const hinted = spansOf('甲乙。丙”', 54);
  expect(hinted).toHaveLength(1);
  expect(widthOf(hinted[0]!, '”')).toBe(6);
  const unhinted = spansOf('甲乙。丙”', 54, 'default');
  expect(unhinted).toHaveLength(1);
  expect(widthOf(unhinted[0]!, '”')).toBe(12);
  expect(widthOf(unhinted[0]!, '。')).toBe(6);
});
test('a final closing curly quote after a Latin word loses its trailing bearing', () => {
  const lines = spansOf('甲乙丙。AB”', 78);
  expect(lines).toHaveLength(1);
  expect(widthOf(lines[0]!, '”')).toBe(6);
  // Nothing else compresses: the other glyphs keep their 72pt.
  expect(lines[0]!.reduce((sum, s) => sum + s.box.width, 0)).toBe(78);
});
test('a colon before an opening curly quote shares the fit over both blank sides', () => {
  const hinted = spansOf('甲乙：“丙丁', 66);
  expect(hinted).toHaveLength(1);
  expect(widthOf(hinted[0]!, '：')).toBeCloseTo(9, 8);
  expect(widthOf(hinted[0]!, '“')).toBeCloseTo(9, 8);
});
test('a colon before a Latin-face curly quote gives up its own blank side', () => {
  const unhinted = spansOf('甲乙：“丙丁', 66, 'default', outlined);
  expect(unhinted).toHaveLength(1);
  expect(widthOf(unhinted[0]!, '：')).toBe(6);
  expect(widthOf(unhinted[0]!, '“')).toBe(12);
});
test('curly quotes share the fit with adjacent punctuation', () => {
  const opening = spansOf('甲乙。“丙丁', 66);
  expect(opening).toHaveLength(1);
  expect(widthOf(opening[0]!, '。')).toBeCloseTo(9, 8);
  expect(widthOf(opening[0]!, '“')).toBeCloseTo(9, 8);
  // A final quote after a full stop drops its trailing blank before anything else compresses.
  const final = spansOf('甲乙丙。”', 54);
  expect(final).toHaveLength(1);
  expect(widthOf(final[0]!, '”')).toBe(6);
  expect(final[0]!.reduce((sum, s) => sum + s.box.width, 0)).toBe(54);
  const closing = spansOf('甲乙丙”。丁', 66).flat();
  expect(widthOf(closing, '”')).toBeCloseTo(9, 8);
  expect(widthOf(closing, '。')).toBeCloseTo(9, 8);
});
test('a curly quote fits only on the side that faces an East Asian character', () => {
  const hinted = spansOf('甲“OK”就。', 72);
  expect(hinted).toHaveLength(1);
  expect(widthOf(hinted[0]!, '“')).toBe(9);
  expect(widthOf(hinted[0]!, 'OK')).toBe(24);
  expect(widthOf(hinted[0]!, '”')).toBe(9);
  expect(spansOf('甲“OK”就。', 72, 'default')).toHaveLength(2);
});
test('a qualified quote gives its whole half-em even where its ink crosses the middle', () => {
  const wide: TextMeasurer = {
    ...measure,
    inkBounds: (text, style) =>
      text === '“'
        ? { left: 5, right: 11 }
        : text === '”'
          ? { left: 1, right: 7 }
          : measure.inkBounds!(text, style),
  };
  // The opening quote's left side and the final full stop give 6pt each.
  const opening = spansOf('甲乙“丙丁。', 60, 'eastAsia', wide);
  expect(opening).toHaveLength(1);
  expect(widthOf(opening[0]!, '“')).toBe(6);
  // The final closing quote drops its whole trailing half.
  const closing = spansOf('甲乙。丙”', 48, 'eastAsia', wide);
  expect(closing).toHaveLength(1);
  expect(widthOf(closing[0]!, '”')).toBe(6);
});
