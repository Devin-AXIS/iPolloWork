import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/index.ts';
import { createCjkOpticalFitter } from '../cjk-optical-fit.ts';
import { cjkParagraphBreaks } from '../cjk-paragraph-breaks.ts';
import { DEFAULT_CJK_TYPOGRAPHY } from '../cjk-typography.ts';
import type { FieldAwarePiece } from '../field-pieces.ts';
import type { PendingLine } from '../pending-line.ts';
import { DEFAULT_RUN_STYLE, NO_THEME_FONTS, measureDisplayText } from '../run-style.ts';
import { styleForFontSlot } from '../script-itemization.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { caretAt } from '../semantic-interaction.ts';
import { hitTestPage } from '../semantic-hit-test.ts';
import { linesOf, type TextMeasurer, type StyleSpanRecord } from '../semantic-records.ts';

const advance = (text: string) =>
  [...text].reduce(
    (s, c) => s + (/[A-Za-z0-9]/u.test(c) ? 7 : c === ' ' ? 4 : /[.,/%+\-]/u.test(c) ? 5 : 12),
    0
  ) -
  (text.match(/AV/gu)?.length ?? 0) * 4 -
  (text === 'GB 50011' ? 3 : 0);
const outlines: string[] = [];
const measurer: TextMeasurer = {
  measure: (text, s) => advance(text) + text.length * s.characterSpacingPt,
  lineMetrics: () => ({ height: 16, baseline: 12 }),
  hasResolvedFont: () => true,
  inkBounds(text) {
    if ([...text].length !== 1) return undefined;
    if (text === '（') return { left: 8, right: 10 };
    if (text === '）') return { left: 2, right: 4 };
    return { left: 0.6, right: 11.4 };
  },
  textOutline(text) {
    outlines.push(text);
    return { path: null, ink: { left: 0.4, right: advance(text) - 0.3, top: -10, bottom: 2 } };
  },
};
const style = {
  ...DEFAULT_RUN_STYLE,
  fontFamily: 'Test Latin',
  fontFamilyEastAsia: 'Test CJK',
  fontSizePt: 12,
  kerningMinPt: 1,
  kerningEnabled: true,
};
const policy = {
  ...DEFAULT_CJK_TYPOGRAPHY,
  overflowPunctuation: false,
  autoSpaceDE: false,
  autoSpaceDN: false,
  settings: {
    strict: false,
    compression: 'compressPunctuation' as const,
    punctuationKerning: true,
    sourceEastAsianFont: true,
    before: {},
    after: {},
  },
};
function fit(
  word = 'GB 50011',
  options: {
    prefix?: string;
    measure?: TextMeasurer;
    wordStyle?: typeof style;
    allow?: boolean;
  } = {}
) {
  const measure = options.measure ?? measurer;
  let start = 0;
  const pieces: FieldAwarePiece[] = [options.prefix ?? 'XYZ', '甲', '）', word, '（', '乙'].map(
    (text, i) => {
      const p: FieldAwarePiece = {
        text,
        start,
        end: start + text.length,
        props: [],
        style: i === 3 ? (options.wordStyle ?? style) : style,
        fontSlot: i === 0 || i === 3 ? 'ascii' : 'eastAsia',
      };
      start = p.end;
      return p;
    }
  );
  let x = 0;
  const spans: StyleSpanRecord[] = pieces.slice(0, -1).map((p) => {
    const width = measureDisplayText(p.text, styleForFontSlot(p.style, p.fontSlot), measure);
    const span = {
      text: p.text,
      style: p.style,
      props: p.props,
      fontSlot: p.fontSlot,
      range: { paragraphId: 'synthetic', start: p.start, end: p.end },
      box: { x, y: 0, width, height: 16 },
    };
    x += width;
    return span;
  });
  const before = spans.map((s) => ({ ...s, box: { ...s.box } }));
  const line: PendingLine = {
    spans,
    drawings: [],
    start: 0,
    end: pieces.at(-2)!.end,
    width: x,
    height: 16,
    baseline: 12,
    leading: 0,
    trailingSpacing: 0,
  };
  const p = pieces.at(-1)!,
    width = measureDisplayText(p.text, styleForFontSlot(p.style, p.fontSlot), measure),
    available = x + width - 6;
  outlines.length = 0;
  const result = createCjkOpticalFitter(pieces, cjkParagraphBreaks(pieces, policy), measure, {
    hangingPunctuation: false,
    requireLocalQualification: true,
  })(
    line,
    pieces.length - 1,
    p.text,
    { paragraphId: 'synthetic', start: p.start, end: p.end },
    width,
    x,
    available,
    options.allow !== false
  );
  return { result, line, before, available };
}
const unchanged = (a: ReturnType<typeof fit>) => {
  expect(a.result).toBeUndefined();
  expect(a.line.spans).toEqual(a.before);
};
test('printable ASCII words spaces decimals and units remain indivisible while EA seams fit', () => {
  for (const word of ['GB 50011', '3.14 m/s', 'v1.2-3', '50%', 'A+B/C']) {
    const a = fit(word);
    expect(a.result).toBeDefined();
    expect(a.line.width + a.result!.width).toBeCloseTo(a.available, 8);
    const before = a.before[3]!,
      after = a.line.spans.find((s) => s.range.start === before.range.start)!;
    expect(after.text).toBe(word);
    expect(after.range).toEqual(before.range);
    expect(after.style).toBe(before.style);
    expect(after.box.width).toBe(before.box.width);
    expect(after.glyphOffsetPt).toBe(before.glyphOffsetPt);
    expect(outlines).toEqual([word]);
  }
});
test('nonadditive full-group advance is preserved instead of summing its characters', () => {
  const a = fit('GB 50011');
  expect(a.result).toBeDefined();
  const span = a.line.spans.find((s) => s.text === 'GB 50011')!;
  expect(span.box.width).toBe(50);
  expect(span.box.width).not.toBe([...span.text].reduce((sum, c) => sum + advance(c), 0));
  expect(span.style.characterSpacingPt).toBe(0);
  expect(a.line.spans.filter((s) => s.style.characterSpacingPt < 0).map((s) => s.text)).toEqual([
    '）',
    '（',
  ]);
});
test('pure ASCII spaces form a no-ink barrier without vetoing unrelated EA seams', () => {
  const measure: TextMeasurer = {
    ...measurer,
    textOutline(text, s) {
      expect(/^ +$/u.test(text)).toBe(false);
      return measurer.textOutline!(text, s);
    },
  };
  const a = fit('AV', { prefix: '   ', measure });
  expect(a.result).toBeDefined();
  expect(a.line.spans[0]!.box.width).toBe(a.before[0]!.box.width);
  expect(a.line.spans[0]!.style).toBe(a.before[0]!.style);
  expect(outlines).toEqual(['AV']);
  unchanged(fit('   ', { measure }));
  expect(outlines).toEqual([]);
});
test('missing group outlines skip affected seams while unrelated eligible seams still fit', () => {
  const measure: TextMeasurer = {
    ...measurer,
    textOutline(text, s) {
      if (text === 'GB 50011') {
        outlines.push(text);
        return undefined;
      }
      return measurer.textOutline!(text, s);
    },
  };
  unchanged(fit('GB 50011', { measure }));
  expect(outlines).toEqual(['GB 50011']);
  const a = fit('AV', { prefix: 'GB 50011', measure });
  expect(a.result).toBeDefined();
  expect(outlines).toEqual(['AV']);
  expect(a.line.spans[0]!.box.width).toBe(a.before[0]!.box.width);
});
test('TAB controls NBSP and unknown scripts do not enter the printable ASCII path', () => {
  for (const word of ['GB\t50011', 'GB\n50011', 'GB\u000050011', 'GB\u00a050011', 'AΩ', 'Aب']) {
    unchanged(fit(word));
    expect(outlines).toEqual([]);
  }
});
test('face and authored shaping qualification still precede ASCII group admission', () => {
  for (const measure of [
    { ...measurer, hasResolvedFont: undefined },
    { ...measurer, hasResolvedFont: () => false },
  ])
    unchanged(fit('GB 50011', { measure }));
  for (const change of [
    { characterSpacingPt: 0.2 },
    { horizontalScalePercent: 90 },
    { shaping: { script: 'Latn', direction: 'ltr' as const, level: 0, baseLevel: 0 } },
  ])
    unchanged(fit('GB 50011', { wordStyle: { ...style, ...change } }));
  unchanged(fit('GB 50011', { allow: false }));
});
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function part(xml: string) {
  const p = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'application/xml' });
  if (!p.ok) throw Error(p.reason);
  return p.part;
}
function layout(width: number, field = false) {
  const r = (s: string) =>
    `<w:r><w:rPr><w:rFonts w:ascii="Test Latin" w:hAnsi="Test Latin" w:eastAsia="Test CJK"/><w:sz w:val="24"/><w:kern w:val="2"/></w:rPr><w:t xml:space="preserve">${s}</w:t></w:r>`;
  const p = part(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:overflowPunct w:val="0"/><w:autoSpaceDE w:val="0"/><w:autoSpaceDN w:val="0"/></w:pPr>${r('甲）')}${field ? '<w:fldSimple w:instr="PAGE">' + r('GB 50011') + '</w:fldSimple>' : r('GB 50011')}${r('（乙末')}</w:p></w:body></w:document>`
    ),
    before = serializeOoxmlPart(p);
  const styles = part(
      `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:eastAsia="Test CJK"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`
    ),
    settings = part(
      `<w:settings xmlns:w="${W}"><w:characterSpacingControl w:val="compressPunctuation"/></w:settings>`
    ),
    cascade = buildStyleCascadeTable(
      styles.root,
      { ...NO_THEME_FONTS, eastAsianFontTableFaces: ['test cjk'] },
      settings.root
    );
  const document = layoutSemanticDocument(p, 0, {
    measurer,
    styleCascade: cascade,
    geometry: {
      width: width + 20,
      height: 500,
      margin: { top: 10, bottom: 10, left: 10, right: 10 },
    },
  });
  expect(serializeOoxmlPart(p)).toBe(before);
  return { document, lines: linesOf(document), part: p };
}
test('public caret and hit mapping keep each ASCII group offset at its natural internal advance', () => {
  const narrow = layout(advance('甲）GB 50011（乙') - 6),
    wide = layout(300);
  const wordStart = 2,
    wordEnd = 10;
  expect(narrow.lines[0]!.spans.map((s) => s.text).join('')).toContain('GB 50011');
  const id = narrow.lines[0]!.range.paragraphId;
  const a0 = caretAt(narrow.document, { paragraphId: id, offset: wordStart }, measurer)!,
    b0 = caretAt(wide.document, { paragraphId: id, offset: wordStart }, measurer)!;
  expect(a0).toBeDefined();
  expect(b0).toBeDefined();
  for (let offset = wordStart; offset < wordEnd; offset++) {
    const a = caretAt(narrow.document, { paragraphId: id, offset }, measurer)!,
      b = caretAt(wide.document, { paragraphId: id, offset }, measurer)!;
    expect(a.x - a0.x).toBeCloseTo(b.x - b0.x, 8);
    expect(a.height).toBeCloseTo(b.height, 8);
  }
  for (const span of narrow.lines[0]!.spans.filter((s) => s.fontSlot !== 'eastAsia')) {
    for (let i = 0; i < span.text.length; i++) {
      const face = styleForFontSlot(span.style, span.fontSlot),
        left = measureDisplayText(span.text.slice(0, i), face, measurer),
        right = measureDisplayText(span.text.slice(0, i + 1), face, measurer);
      if (right <= left) continue;
      const hit = hitTestPage(
        narrow.document,
        0,
        { x: span.box.x + left + (right - left) * 0.05, y: narrow.lines[0]!.box.y + 8 },
        { measurer }
      );
      expect(hit?.position.paragraphId).toBe(id);
      expect(hit?.position.offset).toBe(span.range.start + i);
    }
  }
});
test('real parsed field atoms retain their protected source range and text', () => {
  const a = layout(advance('甲）GB 50011（乙') - 6, true);
  const spans = a.lines.flatMap((line) => line.spans);
  expect(spans.some((s) => s.fieldAtom)).toBe(true);
  expect(spans.filter((s) => s.fieldAtom).every((s) => s.style.characterSpacingPt === 0)).toBe(
    true
  );
});
