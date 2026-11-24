import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/index.ts';
import { createCjkOpticalFitter, createParagraphCjkOpticalFitter } from '../cjk-optical-fit.ts';
import { cjkParagraphBreaks } from '../cjk-paragraph-breaks.ts';
import { DEFAULT_CJK_TYPOGRAPHY, type CjkParagraphTypography } from '../cjk-typography.ts';
import type { FieldAwarePiece } from '../field-pieces.ts';
import type { PendingLine } from '../pending-line.ts';
import { DEFAULT_RUN_STYLE, NO_THEME_FONTS, measureDisplayText } from '../run-style.ts';
import { layoutDerivedSpacingStyleForEditing } from '../layout-derived-spacing.ts';
import { styleForFontSlot } from '../script-itemization.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { createLayoutSession } from '../layout-session.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { hitTestPage } from '../semantic-hit-test.ts';
import { linesOf, type StyleSpanRecord, type TextMeasurer } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const advance = (text: string) =>
  [...text].reduce(
    (sum, char) => sum + (/[A-Za-z0-9]/u.test(char) ? 7 : /[‘’“”]/u.test(char) ? 6 : 12),
    0
  ) -
  (text.match(/AV/gu)?.length ?? 0) * 4 -
  (text.match(/fi/gu)?.length ?? 0) * 6;
const shapeCalls: string[] = [];
const measurer: TextMeasurer = {
  measure: (text, style) =>
    (advance(text) * style.horizontalScalePercent) / 100 + text.length * style.characterSpacingPt,
  lineMetrics: () => ({ height: 16, baseline: 12 }),
  hasResolvedFont: () => true,
  inkBounds(text) {
    if ([...text].length !== 1) return undefined;
    if (text === '（') return { left: 8, right: 10 };
    if (text === '）') return { left: 2, right: 4 };
    if (text === '、') return { left: 1, right: 4 };
    return { left: 0.6, right: 11.4 };
  },
  textOutline(text) {
    shapeCalls.push(text);
    return { path: null, ink: { left: 0.4, right: advance(text) - 0.3, top: -10, bottom: 2 } };
  },
};
const policy: CjkParagraphTypography = {
  ...DEFAULT_CJK_TYPOGRAPHY,
  overflowPunctuation: false,
  settings: {
    strict: false,
    compression: 'compressPunctuation',
    punctuationKerning: true,
    sourceEastAsianFont: true,
    before: {},
    after: {},
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

/** One actual fitter call. Full layout can legitimately try several candidate groups. */
function fitWord(
  word = 'AV',
  measure = measurer,
  options: { allow?: boolean; style?: typeof style } = {}
) {
  let start = 0;
  const pieces: FieldAwarePiece[] = ['XYZ', '甲', '）', word, '（', '乙'].map((text, index) => {
    const value: FieldAwarePiece = {
      text,
      start,
      end: start + text.length,
      props: [],
      style: options.style ?? style,
      fontSlot: index === 0 || index === 3 ? 'ascii' : 'eastAsia',
    };
    start = value.end;
    return value;
  });
  let x = 0;
  const spans: StyleSpanRecord[] = pieces.slice(0, -1).map((piece) => {
    const width = measureDisplayText(
      piece.text,
      styleForFontSlot(piece.style, piece.fontSlot),
      measure
    );
    const span: StyleSpanRecord = {
      text: piece.text,
      props: piece.props,
      style: piece.style,
      fontSlot: piece.fontSlot,
      range: { paragraphId: 'p', start: piece.start, end: piece.end },
      box: { x, y: 0, width, height: 16 },
    };
    x += width;
    return span;
  });
  const untouched = spans.map((span) => ({ ...span, box: { ...span.box } }));
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
  const piece = pieces.at(-1)!;
  const candidateWidth = measureDisplayText(
    piece.text,
    styleForFontSlot(piece.style, piece.fontSlot),
    measure
  );
  const available = x + candidateWidth - 6;
  const fit = createCjkOpticalFitter(pieces, cjkParagraphBreaks(pieces, policy), measure, {
    hangingPunctuation: false,
    requireLocalQualification: true,
  });
  shapeCalls.length = 0;
  const result = fit(
    line,
    pieces.length - 1,
    piece.text,
    { paragraphId: 'p', start: piece.start, end: piece.end },
    candidateWidth,
    x,
    available,
    options.allow !== false
  );
  return { result, line, untouched, pieces, available, candidateWidth };
}

test('one fit shares the whole shaped word outline between both EA seams', () => {
  for (const word of ['AV', 'fi', '12']) {
    const actual = fitWord(word);
    expect(actual.result).toBeDefined();
    expect(shapeCalls).toEqual([word]);
    expect(actual.line.width + actual.result!.width).toBe(actual.available);
    const reductions = actual.line.spans.filter((span) => span.style.characterSpacingPt < 0);
    expect(reductions.map((span) => span.text)).toEqual(['）', '（']);
    expect(reductions.reduce((sum, span) => sum - span.style.characterSpacingPt, 0)).toBe(6);
    for (const span of actual.line.spans.filter((span) => span.fontSlot !== 'eastAsia')) {
      const natural = actual.untouched.find((before) => before.range.start === span.range.start)!;
      expect(span.text).toBe(natural.text);
      expect(span.range).toEqual(natural.range);
      expect(span.style).toBe(natural.style);
      expect(span.box.width).toBe(natural.box.width);
      expect(span.glyphOffsetPt).toBe(natural.glyphOffsetPt);
    }
    expect(actual.line.spans.filter((span) => span.text === word)).toHaveLength(1);
  }
});

test('each new fit measures its own word and unrelated ASCII never asks for an outline', () => {
  fitWord();
  expect(shapeCalls).toEqual(['AV']);
  fitWord();
  expect(shapeCalls).toEqual(['AV']);
  expect(shapeCalls).not.toContain('XYZ');
});

test('missing whole-word ink is cached within a fit and cannot be replaced by its advance', () => {
  const missing: TextMeasurer = {
    ...measurer,
    textOutline(text) {
      shapeCalls.push(text);
      return undefined;
    },
  };
  const actual = fitWord('AV', missing);
  expect(actual.result).toBeUndefined();
  expect(shapeCalls).toEqual(['AV']);
  expect(actual.line.spans).toEqual(actual.untouched);
  const absent = fitWord('AV', { ...measurer, textOutline: undefined });
  expect(absent.result).toBeUndefined();
  expect(absent.line.spans).toEqual(absent.untouched);
});

test('nonfinite and inverted whole-word bounds preserve the untouched line', () => {
  for (const ink of [
    { left: NaN, right: 10, top: -10, bottom: 2 },
    { left: 11, right: 2, top: -10, bottom: 2 },
  ]) {
    const actual = fitWord('AV', {
      ...measurer,
      textOutline(text) {
        shapeCalls.push(text);
        return { path: null, ink };
      },
    });
    expect(actual.result).toBeUndefined();
    expect(shapeCalls).toEqual(['AV']);
    expect(actual.line.spans).toEqual(actual.untouched);
  }
});

test('a whole-word ink protrusion cannot create a negative opening advance', () => {
  const actual = fitWord('AV', {
    ...measurer,
    textOutline(text) {
      shapeCalls.push(text);
      return { path: null, ink: { left: 0.4, right: 40, top: -10, bottom: 2 } };
    },
  });
  expect(actual.result).toBeDefined();
  const opening = actual.line.spans.find((span) => span.range.start === actual.pieces[4]!.start)!;
  expect(opening.style.characterSpacingPt).toBe(0);
  expect(opening.glyphOffsetPt ?? 0).toBe(0);
  expect(actual.line.spans.find((span) => span.text === 'AV')!.box.width).toBe(advance('AV'));
});

test('unresolved faces and authored tracking scaling or complex shaping reject the local path', () => {
  for (const measure of [
    { ...measurer, hasResolvedFont: undefined },
    { ...measurer, hasResolvedFont: () => false },
  ]) {
    const actual = fitWord('AV', measure);
    expect(actual.result).toBeUndefined();
    expect(shapeCalls).toEqual([]);
  }
  for (const change of [
    { characterSpacingPt: 0.2 },
    { horizontalScalePercent: 90 },
    { shaping: { script: 'Latn', direction: 'ltr' as const, level: 0, baseLevel: 0 } },
  ]) {
    const actual = fitWord('AV', measurer, { style: { ...style, ...change } });
    expect(actual.result).toBeUndefined();
    expect(shapeCalls).toEqual([]);
  }
});

test('a Latin-face quoted word guards its neighbouring seams like any other word', () => {
  expect(fitWord('“AV”').result).toBeDefined();
});

test('unknown scripts and a non-demand call do not grant new word seams', () => {
  for (const word of ['AΩ', 'Aب']) {
    const actual = fitWord(word);
    expect(actual.result).toBeUndefined();
    expect(shapeCalls).toEqual([]);
  }
  const actual = fitWord('AV', measurer, { allow: false });
  expect(actual.result).toBeUndefined();
  expect(shapeCalls).toEqual([]);
});

test('paragraph factory keeps source switches float passages and colon policy conservative', () => {
  const { pieces } = fitWord();
  const breaks = cjkParagraphBreaks(pieces, policy);
  for (const settings of [
    undefined,
    { ...policy.settings!, compression: 'doNotCompress' as const },
    { ...policy.settings!, sourceEastAsianFont: false },
    { ...policy.settings!, punctuationKerning: false },
  ]) {
    const actual = createParagraphCjkOpticalFitter(
      pieces,
      pieces,
      breaks,
      measurer,
      { ...policy, settings },
      false,
      false,
      true
    );
    expect(actual.opticalParagraph).toBe(false);
    expect(actual.opticalCompression).toBe(false);
  }
  expect(
    createParagraphCjkOpticalFitter(pieces, pieces, breaks, measurer, policy, true, false, true)
      .opticalCompression
  ).toBe(false);
  expect(
    createParagraphCjkOpticalFitter(pieces, pieces, breaks, measurer, policy, false, true, true)
      .opticalCompression
  ).toBe(false);
  expect(
    createParagraphCjkOpticalFitter(pieces, pieces, breaks, measurer, policy, false, false, true)
      .opticalCompression
  ).toBe(true);
  // A paragraph that is not justified keeps natural punctuation widths.
  expect(
    createParagraphCjkOpticalFitter(pieces, pieces, breaks, measurer, policy, false, false, false)
      .opticalCompression
  ).toBe(false);
});

function part(xml: string) {
  const parsed = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'application/xml' });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}
interface Options {
  split?: number;
  compression?: boolean;
  runProps?: string;
  settings?: string;
  measure?: TextMeasurer;
  field?: boolean;
  sourceEastAsia?: boolean;
  session?: ReturnType<typeof createLayoutSession>;
  source?: ReturnType<typeof part>;
  styleCascade?: ReturnType<typeof buildStyleCascadeTable>;
}
function layout(text: string, width: number, options: Options = {}) {
  const run = (value: string) =>
    `<w:r><w:rPr><w:rFonts w:ascii="Test Latin" w:hAnsi="Test Latin" w:eastAsia="Test CJK"/><w:sz w:val="24"/><w:kern w:val="2"/>${options.runProps ?? ''}</w:rPr><w:t xml:space="preserve">${value}</w:t></w:r>`;
  const split = options.split ?? text.length;
  const content = options.field
    ? run(text.slice(0, 2)) +
      `<w:fldSimple w:instr="PAGE">${run('AV')}</w:fldSimple>` +
      run(text.slice(4))
    : run(text.slice(0, split)) + run(text.slice(split));
  const source =
    options.source ??
    part(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:jc w:val="both"/><w:overflowPunct w:val="0"/><w:autoSpaceDE w:val="0"/><w:autoSpaceDN w:val="0"/></w:pPr>${content}</w:p></w:body></w:document>`
    );
  const before = serializeOoxmlPart(source);
  const styles = part(
    `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr>${options.sourceEastAsia === false ? '' : '<w:rFonts w:eastAsia="Test CJK"/>'}</w:rPr></w:rPrDefault></w:docDefaults></w:styles>`
  );
  const settings = part(
    `<w:settings xmlns:w="${W}"><w:characterSpacingControl w:val="${options.compression === false ? 'doNotCompress' : 'compressPunctuation'}"/>${options.settings ?? ''}</w:settings>`
  );
  const styleCascade =
    options.styleCascade ??
    buildStyleCascadeTable(
      styles.root,
      { ...NO_THEME_FONTS, eastAsianFontTableFaces: ['test cjk'] },
      settings.root
    );
  const document = layoutSemanticDocument(source, 0, {
    measurer: options.measure ?? measurer,
    session: options.session,
    styleCascade,
    geometry: {
      width: width + 20,
      height: 500,
      margin: { top: 10, bottom: 10, left: 10, right: 10 },
    },
  });
  return { source, before, styleCascade, document, lines: linesOf(document) };
}
const lineText = (line: ReturnType<typeof layout>['lines'][number]) =>
  line.spans.map((span) => span.text).join('');
const geometry = (value: ReturnType<typeof layout>) =>
  value.lines.map((line) =>
    line.spans.map((span) => ({
      text: span.text,
      range: span.range,
      box: span.box,
      style: span.style,
      fontSlot: span.fontSlot,
    }))
  );
function characters(value: ReturnType<typeof layout>) {
  return value.lines[0]!.spans.flatMap((span) =>
    [...span.text].map((text, index) => {
      const face = styleForFontSlot(span.style, span.fontSlot);
      const prefix = measureDisplayText(span.text.slice(0, index), face, measurer);
      return {
        text,
        start: span.range.start + index,
        end: span.range.start + index + 1,
        x: span.box.x + prefix,
        width: measureDisplayText(span.text.slice(0, index + 1), face, measurer) - prefix,
      };
    })
  );
}

test('a later Latin word does not veto an earlier qualified pure CJK line', () => {
  const prefix = '甲乙（丙丁）戊己';
  const pure = layout(prefix, 90),
    mixed = layout(prefix + 'XYZ', 90);
  expect(mixed.lines.map(lineText)).toEqual([prefix, 'XYZ']);
  expect(characters(mixed)).toEqual(characters(pure));
  expect(serializeOoxmlPart(mixed.source)).toBe(mixed.before);
});

test('mixed lines preserve complete natural words and only EA punctuation loses advance', () => {
  for (const word of ['AV', 'fi', '12']) {
    const text = `甲）${word}（乙`,
      width = advance(text) - 6;
    const actual = layout(text + '末', width),
      natural = layout(text + '末', width, { compression: false });
    expect(actual.lines.map(lineText)).toEqual([text, '末']);
    const opaque = actual.lines[0]!.spans.find((span) => span.text === word)!;
    const untouched = natural.lines
      .flatMap((line) => line.spans)
      .find(
        (span) =>
          span.range.start === opaque.range.start &&
          span.range.end === opaque.range.end &&
          span.fontSlot === opaque.fontSlot
      )!;
    expect(opaque.style).toEqual(untouched.style);
    expect(opaque.range).toEqual(untouched.range);
    expect(opaque.box.width).toBe(untouched.box.width);
    expect(layoutDerivedSpacingStyleForEditing(opaque.style)).toBe(opaque.style);
    expect(
      actual.lines[0]!.spans.filter((span) => span.style.characterSpacingPt < 0).every(
        (span) => span.fontSlot === 'eastAsia'
      )
    ).toBe(true);
    expect(serializeOoxmlPart(actual.source)).toBe(actual.before);
  }
});

test('all source seams preserve per-character model ranges and measured positions', () => {
  // Digits have additive advances, so authored seams do not change this natural oracle.
  const text = '甲）12（乙末',
    width = advance('甲）12（乙') - 6;
  const expected = characters(layout(text, width));
  expect(expected.map((char) => [char.start, char.end])).toEqual(
    [...text.slice(0, -1)].map((_, index) => [index, index + 1])
  );
  for (let split = 0; split <= text.length; split++) {
    const actual = layout(text, width, { split });
    expect(actual.lines.map(lineText).join('')).toBe(text);
    const chars = characters(actual);
    expect(chars.map((char) => [char.text, char.start, char.end])).toEqual(
      expected.map((char) => [char.text, char.start, char.end])
    );
    chars.forEach((char, index) => {
      expect(char.x).toBeCloseTo(expected[index]!.x, 9);
      expect(char.width).toBeCloseTo(expected[index]!.width, 9);
    });
    expect(serializeOoxmlPart(actual.source)).toBe(actual.before);
  }
  // LTR shaping across different authored runs is an existing, separate contract.
  // Compare each AV/fi seam to that exact source's untouched natural layout.
  for (const word of ['AV', 'fi']) {
    const value = `甲）${word}（乙末`,
      measure = advance(`甲）${word}（乙`) - 6;
    for (let split = 0; split <= value.length; split++) {
      const actual = layout(value, measure, { split });
      const natural = layout(value, measure, { split, compression: false });
      const spans = actual.lines.flatMap((line) => line.spans);
      expect(actual.lines.map(lineText).join('')).toBe(value);
      expect(
        spans.flatMap((span) => [...span.text].map((_, index) => span.range.start + index))
      ).toEqual([...value].map((_, index) => index));
      for (const span of spans.filter((span) => span.fontSlot !== 'eastAsia')) {
        const counterpart = natural.lines
          .flatMap((line) => line.spans)
          .find(
            (before) =>
              before.range.start === span.range.start &&
              before.range.end === span.range.end &&
              before.fontSlot === span.fontSlot
          )!;
        expect(counterpart).toBeDefined();
        expect(span.text).toBe(counterpart.text);
        expect(span.range).toEqual(counterpart.range);
        expect(span.style).toEqual(counterpart.style);
        expect(span.box.width).toBe(counterpart.box.width);
        expect(span.glyphOffsetPt).toBe(counterpart.glyphOffsetPt);
      }
      expect(serializeOoxmlPart(actual.source)).toBe(actual.before);
    }
  }
});

test('word caret positions use each character measured box rather than an entire span fraction', () => {
  const actual = layout('甲）AV（乙末', advance('甲）AV（乙') - 6);
  for (const span of actual.lines[0]!.spans.filter((span) => span.fontSlot !== 'eastAsia')) {
    const face = styleForFontSlot(span.style, span.fontSlot);
    for (let index = 0; index < span.text.length; index++) {
      const left = measureDisplayText(span.text.slice(0, index), face, measurer);
      const right = measureDisplayText(span.text.slice(0, index + 1), face, measurer);
      for (const [fraction, offset] of [
        [0.05, span.range.start + index],
        [0.95, span.range.start + index + 1],
      ] as const) {
        const hit = hitTestPage(
          actual.document,
          0,
          { x: span.box.x + left + (right - left) * fraction, y: actual.lines[0]!.box.y + 8 },
          { measurer }
        );
        expect(hit?.position.offset).toBe(offset);
        expect(hit?.position.paragraphId).toBe(span.range.paragraphId);
      }
    }
  }
});

test('unsupported fields authored spacing scale decoration and unknown text keep natural geometry', () => {
  const text = '甲）AV（乙末',
    width = advance('甲）AV（乙') - 6;
  for (const options of [
    { field: true },
    { runProps: '<w:spacing w:val="4"/>' },
    { runProps: '<w:w w:val="90"/>' },
    { runProps: '<w:u w:val="single"/>' },
    { settings: '<w:noPunctuationKerning/>' },
    { sourceEastAsia: false },
  ]) {
    expect(geometry(layout(text, width, options))).toEqual(
      geometry(layout(text, width, { ...options, compression: false }))
    );
  }
  for (const word of ['AΩ', 'Aب']) {
    const value = text.replace('AV', word);
    expect(geometry(layout(value, width))).toEqual(
      geometry(layout(value, width, { compression: false }))
    );
  }
});

test('layout reuse width changes and save retain source text and authored formatting', () => {
  const text = '甲）AV（乙末',
    width = advance('甲）AV（乙') - 6,
    session = createLayoutSession();
  const narrow = layout(text, width, { session });
  const expected = geometry(narrow);
  const context = { session, source: narrow.source, styleCascade: narrow.styleCascade };
  const wide = layout(text, 200, context);
  expect(wide.source).toBe(narrow.source);
  expect(wide.styleCascade).toBe(narrow.styleCascade);
  expect(wide.lines.map(lineText)).toEqual([text]);
  const restored = layout(text, width, context);
  expect(restored.source).toBe(narrow.source);
  expect(restored.styleCascade).toBe(narrow.styleCascade);
  expect(geometry(restored)).toEqual(expected);
  expect(serializeOoxmlPart(narrow.source)).toBe(narrow.before);
  expect(narrow.before).not.toContain('w:spacing');
});
