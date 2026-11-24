import { withAuthoredCjkGapMetric, authoredCjkGapMetric } from '../cjk-auto-spacing-metric-port.ts';
import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart, type OoxmlElement } from '../../store/index.ts';
import {
  automaticTextGap,
  automaticTextSpacingAdvance,
  automaticTextSpacingBefore,
} from '../cjk-automatic-spacing.ts';
import { DEFAULT_CJK_TYPOGRAPHY } from '../cjk-typography.ts';
import { DEFAULT_RUN_STYLE, type ResolvedRunStyle } from '../run-style.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf, type TextMeasurer } from '../semantic-records.ts';
import { paragraphContentWidthsPt } from '../table-autofit-widths.ts';
import { createShapedMeasurer } from '../shaped-measurer.ts';
import {
  createFontResourceSnapshot,
  FontResolutionError,
  sha256FontBytes,
} from '../font-resource.ts';
import { createResolvedCjkAutoSpacingGapMetric } from '../sfnt-auto-spacing-metrics.ts';
import { autoSpacingSfntFixture } from './fixtures/sfnt-auto-spacing-fixture.ts';

const style = (fontSizePt = 14): ResolvedRunStyle => ({
  ...DEFAULT_RUN_STYLE,
  fontFamily: 'Fixture face',
  fontFamilyEastAsia: 'Fixture face',
  fontSizePt,
});
const boundary = (text: string, fontSizePt = 14) => ({ text, style: style(fontSizePt) });
const policy = DEFAULT_CJK_TYPOGRAPHY;
const widthMeasurer: TextMeasurer = {
  measure: (text, value) =>
    [...text].reduce(
      (sum, character) =>
        sum + (/^[A-Za-z0-9]$/u.test(character) ? value.fontSizePt / 2 : value.fontSizePt),
      0
    ) +
    text.length * value.characterSpacingPt,
  lineMetrics: () => ({ height: 18.2, baseline: 14 }),
};
const metricMeasurer = withAuthoredCjkGapMetric(
  { ...widthMeasurer },
  (value) => value.fontSizePt / 4
);
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function source(text = '甲1乙') {
  const value = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:rPr><w:rFonts w:ascii="Fixture face" w:hAnsi="Fixture face" w:eastAsia="Fixture face"/><w:sz w:val="28"/></w:rPr><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!value.ok) throw Error(value.reason);
  return value.part;
}

test('forward gaps use the East Asian size and reverse gaps use the authored metric', () => {
  expect(automaticTextGap(boundary('甲', 20), boundary('A', 10), policy, metricMeasurer)).toBe(5);
  expect(automaticTextGap(boundary('A', 10), boundary('乙', 20), policy, metricMeasurer)).toBe(2.5);
  expect(automaticTextGap(boundary('甲', 20), boundary('A', 10), policy)).toBe(5);
  expect(automaticTextGap(boundary('A', 10), boundary('乙', 20), policy)).toBe(0);
});

test('disabled source flags and explicit spaces do not request font metrics', () => {
  let calls = 0;
  const measurer = withAuthoredCjkGapMetric({ ...widthMeasurer }, () => {
    calls++;
    return 3.5;
  });
  expect(
    automaticTextGap(boundary('甲'), boundary('1'), { ...policy, autoSpaceDN: false }, measurer)
  ).toBe(0);
  expect(
    automaticTextGap(boundary('甲'), boundary('A'), { ...policy, autoSpaceDE: false }, measurer)
  ).toBe(0);
  expect(automaticTextGap(boundary('甲 '), boundary('1'), policy, measurer)).toBe(0);
  expect(calls).toBe(0);
});

test('unavailable invalid and oversized custom metrics add no invented gap', () => {
  for (const gap of [undefined, NaN, -1, Infinity, 14.1])
    expect(
      automaticTextGap(
        boundary('1'),
        boundary('甲'),
        policy,
        withAuthoredCjkGapMetric({ ...widthMeasurer }, () => gap)
      )
    ).toBe(0);
});

test('internal and split source boundaries share the injected metric', () => {
  expect(
    automaticTextSpacingAdvance(
      undefined,
      { ...boundary('甲1乙'), start: 0, end: 3 },
      policy,
      metricMeasurer
    )
  ).toBe(7);
  expect(
    automaticTextSpacingAdvance(
      { ...boundary('甲'), start: 0, end: 1 },
      { ...boundary('1乙'), start: 1, end: 3 },
      policy,
      metricMeasurer
    )
  ).toBe(7);
});

test('paragraph wrapping prices the metric before admission and clears a new line start', () => {
  const part = source();
  const before = serializeOoxmlPart(part);
  const probe = (measurer: TextMeasurer) =>
    linesOf(
      layoutSemanticDocument(part, 0, {
        measurer,
        geometry: { width: 61, height: 500, margin: { left: 10, right: 10, top: 10, bottom: 10 } },
      })
    );
  expect(probe(widthMeasurer).map((line) => line.spans.map((span) => span.text).join(''))).toEqual([
    '甲1乙',
  ]);
  const lines = probe(metricMeasurer);
  expect(lines.map((line) => line.spans.map((span) => span.text).join(''))).toEqual(['甲1', '乙']);
  expect(automaticTextSpacingBefore(lines[0]!.spans[1]!)).toBe(3.5);
  expect(automaticTextSpacingBefore(lines[1]!.spans[0]!)).toBe(0);
  expect(serializeOoxmlPart(part)).toBe(before);
});

/** A cell probe observes public intrinsic widths and the injected metric requests. */
function intrinsicProbe(
  runs: string,
  properties = '',
  metric: (value: ResolvedRunStyle) => number | undefined = () => 3.5
) {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr>${properties}</w:pPr>${runs}</w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!parsed.ok) throw Error(parsed.reason);
  const before = serializeOoxmlPart(parsed.part);
  const paragraph = parsed.part.root.children[0]!.children.find(
    (child) => child.kind === 'paragraph'
  ) as OoxmlElement;
  const requests: { family: string | null; size: number }[] = [];
  const measurer = withAuthoredCjkGapMetric({ ...widthMeasurer }, (value) => {
    requests.push({ family: value.fontFamily, size: value.fontSizePt });
    return metric(value);
  });
  const widths = paragraphContentWidthsPt(paragraph, {
    context: { measurer },
    view: {
      styleCascade: undefined,
      displayMode: 'all-markup',
      authorFilter: undefined,
      readNested: () => null,
    },
    tableCellStyle: undefined,
  });
  expect(serializeOoxmlPart(parsed.part)).toBe(before);
  return { widths, requests };
}
const intrinsicRun = (text: string, size = 14, family = 'Fixture face') =>
  `<w:r><w:rPr><w:rFonts w:ascii="${family}" w:hAnsi="${family}" w:eastAsia="${family}"/><w:sz w:val="${size * 2}"/></w:rPr><w:t>${text}</w:t></w:r>`;

test('AutoFit legal minimum excludes boundary gaps while maximum retains both advances', () => {
  const probe = intrinsicProbe(intrinsicRun('甲1乙'));
  // Legal cuts leave a 14pt ideograph as the minimum. The unwrapped 35pt text keeps 7pt of gaps.
  expect(probe.widths.min).toBeCloseTo(14, 10);
  expect(probe.widths.max).toBeCloseTo(42, 10);
  expect(probe.requests).toEqual([{ family: 'Fixture face', size: 14 }]);
});

test('AutoFit source run seams preserve both metric advances and requests', () => {
  for (const middle of ['A', '1']) {
    const joined = intrinsicProbe(intrinsicRun(`甲${middle}乙`));
    const split = intrinsicProbe(intrinsicRun('甲') + intrinsicRun(middle) + intrinsicRun('乙'));
    expect(joined.widths.min).toBeCloseTo(14, 10);
    expect(joined.widths.max).toBeCloseTo(42, 10);
    expect(split.widths.min).toBeCloseTo(14, 10);
    expect(split.widths.max).toBeCloseTo(42, 10);
    expect(joined.requests).toEqual([{ family: 'Fixture face', size: 14 }]);
    expect(split.requests).toEqual(joined.requests);
  }
});

test('AutoFit metrics belong to each preceding face and size', () => {
  const suppliedGaps = new Map([
    ['Wide face', 5],
    ['Narrow face', 1.25],
    ['Small face', 7],
  ]);
  const probe = intrinsicProbe(
    intrinsicRun('甲', 20, 'Wide face') +
      intrinsicRun('A', 10, 'Narrow face') +
      intrinsicRun('乙', 12, 'Small face'),
    '',
    (value) => suppliedGaps.get(value.fontFamily ?? '')
  );
  // The 20pt ideograph sets the minimum. The 37pt maximum adds 5pt forward and 1.25pt reverse.
  expect(probe.widths.min).toBeCloseTo(20, 10);
  expect(probe.widths.max).toBeCloseTo(43.25, 10);
  expect(probe.requests).toEqual([{ family: 'Narrow face', size: 10 }]);
});

test('AutoFit DN and DE source flags suppress only their metric requests', () => {
  const body = intrinsicRun('甲A乙1丙');
  const all = intrinsicProbe(body);
  const noDN = intrinsicProbe(body, '<w:autoSpaceDN w:val="0"/>');
  const noDE = intrinsicProbe(body, '<w:autoSpaceDE w:val="0"/>');
  const neither = intrinsicProbe(body, '<w:autoSpaceDN w:val="0"/><w:autoSpaceDE w:val="0"/>');
  // Each legal minimum is one 14pt ideograph. The 56pt maximum adds 7pt per enabled kind.
  expect(all.widths.min).toBeCloseTo(14, 10);
  expect(all.widths.max).toBeCloseTo(70, 10);
  expect(noDN.widths.min).toBeCloseTo(14, 10);
  expect(noDN.widths.max).toBeCloseTo(63, 10);
  expect(noDE.widths.min).toBeCloseTo(14, 10);
  expect(noDE.widths.max).toBeCloseTo(63, 10);
  expect(neither.widths.min).toBeCloseTo(14, 10);
  expect(neither.widths.max).toBeCloseTo(56, 10);
  expect(all.requests).toEqual([
    { family: 'Fixture face', size: 14 },
    { family: 'Fixture face', size: 14 },
  ]);
  expect(noDN.requests).toEqual([{ family: 'Fixture face', size: 14 }]);
  expect(noDE.requests).toEqual(noDN.requests);
  expect(neither.requests).toEqual([]);
});

test('shaped measurer shares font resolution with the metric without shaping extra glyphs', () => {
  const bytes = autoSpacingSfntFixture();
  const request = { family: 'Fixture face', weight: 400, style: 'normal' as const };
  const fonts = createFontResourceSnapshot({
    epoch: 1,
    maxFontBytes: 1024,
    resources: [{ request, id: 'fixture-face', bytes, hash: sha256FontBytes(bytes), faceIndex: 0 }],
    validateFont: () => ({ valid: true }),
  });
  const font = fonts.resolve(request);
  if (font instanceof FontResolutionError) throw font;
  let resolves = 0,
    shapes = 0;
  const measurer = createShapedMeasurer({
    resolveFont: () => {
      resolves++;
      return font;
    },
    shaper: {
      shape() {
        shapes++;
        throw Error('Metric must not shape glyphs');
      },
    },
    fallback: widthMeasurer,
    shapingLibrary: { name: 'unused-test-shaper', version: '1' },
    unicodeDataVersion: '15.1',
  });
  const value = style();
  expect(measurer.hasResolvedFont!(value)).toBe(true);
  expect(authoredCjkGapMetric(measurer, value)).toBe(3.5);
  expect(authoredCjkGapMetric(measurer, { ...value, fontSizePt: 20 })).toBe(5);
  expect(resolves).toBe(2);
  expect(shapes).toBe(0);
  expect(createResolvedCjkAutoSpacingGapMetric(() => font)!(value)).toBe(3.5);
});

test('a substitute average cannot enlarge the forward quarter-em boundary', () => {
  let calls = 0;
  const substituted = withAuthoredCjkGapMetric({ ...widthMeasurer }, () => {
    calls++;
    return 9.8;
  });
  expect(automaticTextGap(boundary('甲', 20), boundary('A', 10), policy, substituted)).toBe(5);
  expect(calls).toBe(0);
  expect(automaticTextGap(boundary('A', 10), boundary('乙', 20), policy, metricMeasurer)).toBe(2.5);
});

test('ordinary custom measurers add no reverse gap for an unrecorded family', () => {
  expect(automaticTextGap(boundary('A', 10), boundary('乙', 20), policy, widthMeasurer)).toBe(0);
  expect(automaticTextGap(boundary('1', 20), boundary('乙', 10), policy, widthMeasurer)).toBe(0);
  expect(automaticTextGap(boundary('甲', 20), boundary('1', 10), policy, widthMeasurer)).toBe(5);
});

const authored = (fontFamily: string, fontSizePt: number, bold = false, italic = false) => ({
  text: 'A',
  style: { ...style(fontSizePt), fontFamily, bold, italic },
});

test('a known authored family keeps its recorded reverse gap without its font file', () => {
  const after = boundary('乙', 20);
  expect(automaticTextGap(authored('Times New Roman', 10), after, policy)).toBeCloseTo(2.0044, 4);
  expect(automaticTextGap(authored(' calibri ', 11), after, policy)).toBeCloseTo(2.8655, 4);
  expect(automaticTextGap(authored('Arial', 10, true, true), after, policy)).toBeCloseTo(2.3926, 4);
  // Cambria has four distinct faces, so these pin the bold and italic order.
  for (const [bold, italic, average] of [
    [false, false, 1260],
    [true, false, 1228],
    [false, true, 1111],
    [true, true, 1198],
  ] as const)
    expect(automaticTextGap(authored('Cambria', 10, bold, italic), after, policy)).toBeCloseTo(
      (10 * average) / 4096,
      6
    );
  expect(automaticTextGap(authored('Calibri Light', 10), after, policy)).toBeCloseTo(
    (10 * 1065) / 4096,
    6
  );
  expect(automaticTextGap(authored('Calibri Light', 10, false, true), after, policy)).toBeCloseTo(
    (10 * 1067) / 4096,
    6
  );
  expect(automaticTextGap(authored('Century', 10, true), after, policy)).toBeCloseTo(
    (10 * 951) / 4096,
    6
  );
  expect(automaticTextGap(authored('Unknown face', 10), after, policy)).toBe(0);
  const spaced = authored('Arial', 10);
  expect(
    automaticTextGap(
      { ...spaced, style: { ...spaced.style, characterSpacingPt: 1 } },
      after,
      policy
    )
  ).toBe(0);
});

test('a substituted face uses the authored family value, not the substitute average', () => {
  const bytes = autoSpacingSfntFixture();
  const request = { family: 'Times New Roman', weight: 400, style: 'normal' as const };
  const fonts = createFontResourceSnapshot({
    epoch: 1,
    maxFontBytes: 1024,
    resources: [{ request, id: 'fixture-face', bytes, hash: sha256FontBytes(bytes), faceIndex: 0 }],
    validateFont: () => ({ valid: true }),
  });
  const font = fonts.resolve(request);
  if (font instanceof FontResolutionError) throw font;
  const substituted = { ...font, substitution: { requested: request } } as unknown as typeof font;
  const metric = createResolvedCjkAutoSpacingGapMetric(() => substituted)!;
  const measurer = withAuthoredCjkGapMetric({ ...widthMeasurer }, metric);
  const before = authored('Times New Roman', 10);
  expect(metric(before.style)).toBeUndefined();
  expect(automaticTextGap(before, boundary('乙', 20), policy, measurer)).toBeCloseTo(2.0044, 4);
});

test('table AutoFit counts a recorded family reverse gap when no font metric is available', () => {
  const { widths } = intrinsicProbe(intrinsicRun('A乙', 14, 'Calibri'), '', () => undefined);
  // A at half the size, the ideograph at the full size, then the recorded Calibri gap.
  expect(widths.max).toBeCloseTo(7 + 14 + (14 * 1067) / 4096, 6);
});
