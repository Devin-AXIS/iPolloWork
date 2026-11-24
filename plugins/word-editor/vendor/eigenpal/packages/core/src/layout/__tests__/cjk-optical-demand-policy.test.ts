import { expect, test } from 'bun:test';
import { DEFAULT_RUN_STYLE, type ResolvedRunStyle } from '../run-style.ts';
import { createParagraphCjkOpticalFitter } from '../cjk-optical-fit.ts';
import { cjkParagraphBreaks } from '../cjk-paragraph-breaks.ts';
import { compressCjkPieces } from '../cjk-spacing.ts';
import { isRunKerningEnabled } from '../run-kerning.ts';
import type { FieldAwarePiece } from '../field-pieces.ts';
import type { PendingLine } from '../pending-line.ts';
import type { CjkParagraphTypography } from '../cjk-typography.ts';

import { readOoxmlPart, serializeOoxmlPart } from '../../store/index.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { NO_THEME_FONTS } from '../run-style.ts';
import { linesOf, type TextMeasurer } from '../semantic-records.ts';
import { createLayoutSession } from '../layout-session.ts';
import { layoutDerivedSpacingStyleForEditing } from '../layout-derived-spacing.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
// Entirely synthetic text and conservative bounds; no report or font files are read.
const prefix = '甲'.repeat(15) + '，' + '乙'.repeat(14);
const mixed = prefix + 'Latin';
const measurer: TextMeasurer = {
  measure(text, style) {
    return (
      ([...text].reduce((sum, c) => sum + (c === '\n' ? 0 : /[A-Za-z0-9]/.test(c) ? 7 : 14), 0) *
        style.horizontalScalePercent) /
        100 +
      text.length * style.characterSpacingPt
    );
  },
  lineMetrics: () => ({ height: 18.2, baseline: 14.13 }),
  inkBounds(text, style) {
    const em = (14 * style.horizontalScalePercent) / 100;
    return text === '，'
      ? { left: em * 0.08, right: em * 0.3 }
      : { left: em * 0.05, right: em * 0.95 };
  },
  hasResolvedFont: () => true,
};
function part(xml: string) {
  const result = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'application/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}
interface ProbeOptions {
  runProps?: string;
  extraSettings?: string;
  compression?: 'compressPunctuation' | 'doNotCompress';
  eastAsianDefaults?: boolean;
  kern?: number;
  measurer?: TextMeasurer;
  split?: number;
  width?: number;
  session?: ReturnType<typeof createLayoutSession>;
}
function probe(text = mixed, options: ProbeOptions = {}) {
  const run = (value: string) =>
    `<w:r><w:rPr><w:rFonts w:ascii="Test Latin" w:hAnsi="Test Latin" w:eastAsia="Test CJK"/><w:sz w:val="28"/><w:kern w:val="${options.kern ?? 2}"/>${options.runProps ?? ''}</w:rPr><w:t xml:space="preserve">${value}</w:t></w:r>`;
  const split = options.split ?? text.length;
  const source = part(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:jc w:val="both"/><w:overflowPunct w:val="0"/><w:autoSpaceDE w:val="0"/><w:autoSpaceDN w:val="0"/><w:ind w:firstLine="559"/></w:pPr>${run(text.slice(0, split))}${run(text.slice(split))}</w:p></w:body></w:document>`
  );
  const styles = part(
    `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr>${options.eastAsianDefaults === false ? '' : '<w:rFonts w:eastAsia="Test CJK"/>'}</w:rPr></w:rPrDefault></w:docDefaults></w:styles>`
  );
  const settings = part(
    `<w:settings xmlns:w="${W}"><w:characterSpacingControl w:val="${options.compression ?? 'compressPunctuation'}"/>${options.extraSettings ?? ''}</w:settings>`
  );
  const before = serializeOoxmlPart(source);
  const layout = layoutSemanticDocument(source, 0, {
    measurer: options.measurer ?? measurer,
    session: options.session,
    styleCascade: buildStyleCascadeTable(
      styles.root,
      { ...NO_THEME_FONTS, eastAsianFontTableFaces: ['test cjk'] },
      settings.root
    ),
    geometry: {
      width: (options.width ?? 442.3) + 20,
      height: 500,
      margin: { top: 10, bottom: 10, left: 10, right: 10 },
    },
  });
  return { source, before, layout, lines: linesOf(layout) };
}
const lineText = (line: ReturnType<typeof probe>['lines'][number]) =>
  line.spans.map((s) => s.text).join('');
const first = (p: ReturnType<typeof probe>) => lineText(p.lines[0]!);
const firstGeometry = (p: ReturnType<typeof probe>) =>
  p.lines[0]!.spans.map((s) => ({
    text: s.text,
    from: s.range.start,
    to: s.range.end,
    x: s.box.x,
    width: s.box.width,
    spacing: s.style.characterSpacingPt,
  }));

// Generic ink/shape controls, not a report-specific fit prescription.
const low: ResolvedRunStyle = {
  ...DEFAULT_RUN_STYLE,
  fontFamily: 'Synthetic Latin',
  fontFamilyEastAsia: 'Synthetic EA',
  fontSizePt: 14,
  kerningEnabled: true,
  kerningMinPt: 22,
};
const policy: CjkParagraphTypography = {
  kinsoku: true,
  overflowPunctuation: false,
  characterWrap: false,
  settings: {
    strict: false,
    compression: 'compressPunctuation',
    punctuationKerning: true,
    sourceEastAsianFont: true,
    before: {},
    after: {},
  },
};
type FitOptions = {
  word?: string;
  style?: ResolvedRunStyle;
  opaqueInk?: boolean;
  noInk?: boolean;
  unresolved?: boolean;
  policy?: CjkParagraphTypography;
  exclusions?: boolean;
  preserveColon?: boolean;
  deficit?: number;
  candidate?: string[];
  remaining?: number;
  unsafe?: string;
};
function fit(o: FitOptions = {}) {
  const word = o.word ?? 'AV',
    style = o.style ?? low,
    texts = ['甲', '）', word, '（', '123', '）', '乙', '，', '丙'],
    tail = o.candidate ?? ['12', '。'];
  const calls: { text: string; style: ResolvedRunStyle }[] = [];
  const natural = (text: string, s: ResolvedRunStyle) =>
    text === 'AV'
      ? isRunKerningEnabled(s)
        ? 16.125
        : 18.125
      : text === 'fi'
        ? 9.375
        : [...text].reduce((sum, c) => sum + (/^[A-Za-z0-9.]$/.test(c) ? 7 : 14), 0);
  const m: TextMeasurer = {
    measure: (text, s) =>
      (natural(text, s) * s.horizontalScalePercent) / 100 + text.length * s.characterSpacingPt,
    lineMetrics: () => ({ height: 18.2, baseline: 14.13 }),
    hasResolvedFont: () => !o.unresolved,
    inkBounds: o.noInk
      ? undefined
      : (text) =>
          text === '）' || text === '。'
            ? { left: 2, right: 4 }
            : text === '（'
              ? { left: 8, right: 12 }
              : text === '，'
                ? { left: 1, right: 4 }
                : { left: 0.5, right: 13.5 },
    textOutline: (text, s) => {
      calls.push({ text, style: { ...s } });
      return o.opaqueInk === false
        ? undefined
        : ({ ink: { left: 0.5, right: natural(text, s) - 0.5 } } as never);
    },
  };
  const pieces: FieldAwarePiece[] = [],
    spans: import('../semantic-records.ts').StyleSpanRecord[] = [];
  let start = 0,
    x = 0;
  for (const [index, text] of [...texts, ...tail].entries()) {
    const from = start;
    start += text.length;
    const slot = /^[A-Za-z0-9.]+$/u.test(text) ? {} : { fontSlot: 'eastAsia' as const };
    pieces.push({ text, start: from, end: start, style, props: [], ...slot });
    if (index >= texts.length) continue;
    const width = m.measure(text, style);
    spans.push({
      text,
      range: { paragraphId: 'synthetic-demand-kerning', start: from, end: start },
      style,
      props: [],
      ...slot,
      box: { x, y: 0, width, height: 18.2 },
    });
    x += width;
  }
  if (o.unsafe) {
    const index = 2,
      span = spans[index]!;
    if (o.unsafe === 'field') spans[index] = { ...span, fieldAtom: {} as never };
    if (o.unsafe === 'projected') spans[index] = { ...span, projected: true };
    if (o.unsafe === 'caret') spans[index] = { ...span, caretEdges: [] };
    if (o.unsafe === 'revision') spans[index] = { ...span, revisions: [{} as never] };
    if (o.unsafe === 'unknown')
      spans[index] = { ...span, text: 'Ж', range: { ...span.range, end: span.range.start + 1 } };
  }
  const line: PendingLine = {
    spans,
    drawings: [],
    start: 0,
    end: pieces[texts.length]!.start,
    width: x,
    height: 18.2,
    baseline: 14.13,
    leading: 0,
    trailingSpacing: 0,
  };
  const before = structuredClone(line),
    p = o.policy ?? policy,
    breaks = cjkParagraphBreaks(pieces, p);
  const paragraph = createParagraphCjkOpticalFitter(
    pieces,
    pieces,
    breaks,
    m,
    p,
    !!o.exclusions,
    !!o.preserveColon,
    true
  );
  const tailWidth = tail.reduce((sum, text) => sum + m.measure(text, style), 0);
  const available =
    o.remaining !== undefined
      ? line.width + o.remaining
      : line.width + tailWidth - (o.deficit ?? 22);
  const fitter = paragraph.fitCjkOptically;
  const result = paragraph.opticalCompression
    ? fitter(
        line,
        texts.length,
        tail[0]!,
        {
          paragraphId: 'synthetic-demand-kerning',
          start: pieces[texts.length]!.start,
          end: pieces[texts.length]!.end,
        },
        m.measure(tail[0]!, style),
        line.width,
        available,
        true
      )
    : undefined;
  const drainQueued = () =>
    tail.slice(1).map((text, offset) => {
      const index = texts.length + offset + 1,
        piece = pieces[index]!;
      return fitter(
        line,
        index,
        text,
        { paragraphId: 'synthetic-demand-kerning', start: piece.start, end: piece.end },
        m.measure(text, style),
        line.width,
        available,
        true
      );
    });
  return { line, before, result, calls, pieces, m, paragraph, available, tailWidth, drainQueued };
}
function reject(o: FitOptions) {
  const x = fit(o);
  expect(x.result).toBeUndefined();
  expect(x.line).toEqual(x.before);
  return x;
}

test('explicit document compression stays local when font pair kerning is below its threshold', () => {
  const pure = probe(prefix, { kern: 44 }),
    mixed = probe(prefix + 'Latin', { kern: 44 });
  expect(first(pure)).toBe(prefix);
  expect(first(mixed)).toBe(prefix);
  expect(firstGeometry(mixed)).toEqual(firstGeometry(pure));
  expect(serializeOoxmlPart(mixed.source)).toBe(mixed.before);
  for (const span of mixed.lines[0]!.spans) {
    expect(span.style.kerningMinPt).toBe(22);
    expect(isRunKerningEnabled(span.style)).toBe(false);
    expect(layoutDerivedSpacingStyleForEditing(span.style).characterSpacingPt).toBe(0);
  }
});
test('low-threshold AV and fi keep original whole shaping style and advance while only EA punctuation loses width', () => {
  for (const word of ['AV', 'fi']) {
    const x = fit({ word });
    expect(x.result).toBeDefined();
    const old = x.before.spans.find((s) => s.text === word)!,
      held = x.line.spans.filter((s) => s.text === word);
    expect(held).toHaveLength(1);
    expect(held[0]!.box.width).toBe(old.box.width);
    expect(held[0]!.range).toEqual(old.range);
    expect(held[0]!.style).toEqual(old.style);
    expect(held[0]!.fontSlot).toBe(old.fontSlot);
    expect(x.calls).toHaveLength(1);
    expect(x.calls[0]!.text).toBe(word);
    expect(x.calls[0]!.style.fontSizePt).toBe(14);
    expect(x.calls[0]!.style.kerningMinPt).toBe(22);
    expect(isRunKerningEnabled(x.calls[0]!.style)).toBe(false);
    for (const span of x.line.spans)
      if (
        span.box.width !==
        x.before.spans.find((old) => old.range.start === span.range.start)!.box.width
      )
        expect(/^[）（，]$/u.test(span.text)).toBe(true);
    const queued = x.drainQueued();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toBeDefined();
    expect(queued[0]!.candidate.map((span) => span.text).join('')).toBe('。');
    expect(queued[0]!.candidate[0]!.range.end).toBe(x.pieces.at(-1)!.end);
    const completeWidth = x.result!.width + queued.reduce((sum, item) => sum + item!.width, 0);
    expect(x.line.width + completeWidth).toBeCloseTo(x.available, 10);
  }
});

test('explicitly disabled font kerning remains disabled during independent demand compression', () => {
  const style = { ...low, kerningEnabled: false, kerningMinPt: 0 },
    x = fit({ style });
  expect(x.result).toBeDefined();
  expect(x.calls).toHaveLength(1);
  expect(x.calls[0]!.style.kerningEnabled).toBe(false);
  expect(x.calls[0]!.style.kerningMinPt).toBe(0);
  expect(isRunKerningEnabled(x.calls[0]!.style)).toBe(false);
  for (const span of [...x.line.spans, ...x.result!.candidate]) {
    expect(span.style.kerningEnabled).toBe(false);
    expect(span.style.kerningMinPt).toBe(0);
  }
});
test('missing or disabled compression policy noPunctuationKerning sourceEA exclusions and colon preservation keep natural lines', () => {
  reject({ policy: { ...policy, settings: undefined } });
  for (const settings of [
    { ...policy.settings!, compression: 'doNotCompress' as const },
    { ...policy.settings!, punctuationKerning: false },
    { ...policy.settings!, sourceEastAsianFont: false },
  ])
    reject({ policy: { ...policy, settings } });
  reject({ exclusions: true });
  reject({ preserveColon: true });
});
test('finite EA capacity alone cannot borrow missing whole opaque ink or mutate a rejected line', () => {
  const rejected = reject({ opaqueInk: false, deficit: 22 });
  expect(rejected.calls).toHaveLength(1);
  const accepted = fit({ opaqueInk: true, deficit: 22 });
  expect(accepted.result).toBeDefined();
  reject({ noInk: true });
  reject({ opaqueInk: true, deficit: 36 });
});
test('a short CJK remnant fits only when its compression share stays within the expansion it saves', () => {
  // Four blank sides give 28pt. Leaving the 14pt glyph off spreads its room r over the 123.125pt
  // of advances before the line's last glyph. The glyph fits when (14 - r) / 28 <= r * 64 /
  // 123.125, that is r >= 0.9001pt.
  for (const remaining of [0, 0.5, 0.89]) {
    const x = reject({ candidate: ['丁'], remaining });
    // The bound on the blank sides refuses before any word is shaped for its ink.
    expect(x.calls).toHaveLength(0);
  }
  for (const remaining of [0.91, 3.8, 7])
    expect(fit({ candidate: ['丁'], remaining }).result).toBeDefined();
});
test('manual spacing scale complex shaping unqualified faces fields and unsupported ownership retain all guards', () => {
  for (const delta of [
    { characterSpacingPt: 0.2 },
    { characterSpacingPt: -0.2 },
    { horizontalScalePercent: 90 },
    { shaping: { script: 'Latn', direction: 'ltr', level: 0, baseLevel: 0 } },
    { shaping: { script: 'Arab', direction: 'rtl', level: 1, baseLevel: 1 } },
  ] as Partial<ResolvedRunStyle>[])
    reject({ style: { ...low, ...delta } });
  reject({ unresolved: true });
  for (const unsafe of ['field', 'projected', 'caret', 'revision', 'unknown']) reject({ unsafe });
});
test('punctuation pair compression still obeys the source font kern threshold', () => {
  const pair = (style: ResolvedRunStyle): FieldAwarePiece[] =>
    ['）', '）'].map((text, index) => ({
      text,
      start: index,
      end: index + 1,
      style,
      props: [],
      fontSlot: 'eastAsia',
    }));
  const x = fit(),
    below = pair(low),
    off = pair({ ...low, kerningEnabled: false, kerningMinPt: 0 });
  expect(compressCjkPieces(below, policy, x.m)).toEqual(below);
  expect(compressCjkPieces(off, policy, x.m)).toEqual(off);
  const enabled = compressCjkPieces(pair({ ...low, kerningMinPt: 1 }), policy, x.m);
  expect(enabled.some((piece) => piece.style.characterSpacingPt < 0)).toBe(true);
});
