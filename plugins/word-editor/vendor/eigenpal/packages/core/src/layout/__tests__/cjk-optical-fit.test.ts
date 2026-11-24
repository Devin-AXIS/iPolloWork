import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { NO_THEME_FONTS } from '../run-style.ts';
import { createLayoutSession } from '../layout-session.ts';
import { linesOf, type TextMeasurer } from '../semantic-records.ts';
import { fittingClusters } from '../cjk-optical-fit.ts';
import { segmentGraphemes } from '../grapheme.ts';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const bounds: Record<string, [number, number]> = {
  '（': [0.662, 0.899],
  '）': [0.135, 0.372],
  '：': [0.193, 0.305],
  '【': [0.579, 0.92],
  '】': [0.08, 0.421],
  '、': [0.099, 0.324],
  '。': [0.08, 0.34],
};
// Songti SC native advances and outline bounds. Font files are not required by this oracle.
const measurer: TextMeasurer = {
  measure(text, style) {
    return (
      ([...text].reduce((sum, c) => sum + (c === ' ' ? 0.25 : 1), 0) *
        style.fontSizePt *
        style.horizontalScalePercent) /
        100 +
      text.length * style.characterSpacingPt
    );
  },
  inkBounds(text, style) {
    const [left, right] = bounds[text] ?? [0.05, 0.95];
    const em = (style.fontSizePt * style.horizontalScalePercent) / 100;
    return { left: left * em, right: right * em };
  },
  lineMetrics: () => ({ height: 16, baseline: 12 }),
};
function part(xml: string) {
  const result = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'application/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}
const settings = part(
  `<w:settings xmlns:w="${W}"><w:characterSpacingControl w:val="compressPunctuation"/></w:settings>`
);
function layout(
  text: string,
  width: number,
  split = text.length,
  measure = measurer,
  runProps = '',
  // Optical fitting needs an East Asian face in the document defaults; every probe names one.
  sourcePolicy: { readonly eastAsianDefaults?: boolean; readonly kern?: number } = {
    eastAsianDefaults: true,
  },
  jc = 'both'
) {
  const run = (value: string) =>
    `<w:r><w:rPr><w:sz w:val="24"/>${sourcePolicy?.kern === undefined ? '' : `<w:kern w:val="${sourcePolicy.kern}"/>`}${runProps}</w:rPr><w:t xml:space="preserve">${value}</w:t></w:r>`;
  const source = part(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:jc w:val="${jc}"/><w:overflowPunct w:val="0"/></w:pPr>${split === -1 ? [...text].map(run).join('') : run(text.slice(0, split)) + run(text.slice(split))}</w:p></w:body></w:document>`
  );
  return linesOf(
    layoutSemanticDocument(source, 0, {
      measurer: measure,
      styleCascade: buildStyleCascadeTable(
        sourcePolicy?.eastAsianDefaults
          ? part(
              `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:eastAsia="Test CJK"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`
            ).root
          : null,
        // The font table gives the probe face an East Asian charset.
        { ...NO_THEME_FONTS, eastAsianFontTableFaces: ['test cjk'] },
        settings.root
      ),
      geometry: {
        width: width + 20,
        height: 500,
        margin: { top: 10, bottom: 10, left: 10, right: 10 },
      },
    })
  );
}
// Positive pair vectors explicitly author EA defaults and kern on both real runs.
const qualifiedLayout = (
  text: string,
  width: number,
  split = text.length,
  measure = measurer,
  runProps = '',
  jc = 'both'
) => layout(text, width, split, measure, runProps, { eastAsianDefaults: true, kern: 2 }, jc);
// Native Word PDFs from three independent width/group experiments, Songti SC 12 pt. The source
// alignment was not recorded. Fitting vectors run justified; the 88 pt vector runs left-aligned
// to keep its natural origins on a wrapped line.
const word: { text: string; width: number; lines: string[]; origins: number[]; jc?: string }[] = [
  {
    text: '甲乙（丙丁）戊己',
    width: 90,
    lines: ['甲乙（丙丁）戊己'],
    origins: [0, 12, 21, 33, 45, 57, 66, 78],
  },
  {
    text: '甲乙（丙丁）戊己',
    width: 88,
    jc: 'left',
    lines: ['甲乙（丙丁）戊', '己'],
    origins: [0, 12, 24, 36, 48, 60, 72],
  },
  {
    text: '甲乙（丙丁戊己',
    width: 78,
    lines: ['甲乙（丙丁戊己'],
    origins: [0, 12, 18, 30, 42, 54, 66],
  },
  {
    text: '甲乙（丙丁）戊己。',
    width: 90,
    lines: ['甲乙（丙丁）戊己。'],
    origins: [0, 12, 18, 30, 42, 54, 60, 72, 84],
  },
  {
    text: '甲乙丙丁、戊己',
    width: 54,
    lines: ['甲乙丙丁、', '戊己'],
    origins: [0, 12, 24, 36, 48],
  },
  {
    text: '原合同（出租方）：【    】（（甲））、乙',
    width: 120,
    lines: ['原合同（出租方）：【    】', '（（甲））、乙'],
    origins: [0, 12, 24, 33, 45, 57, 69, 81, 87, 90, 102, 105, 108, 111, 114],
  },
  {
    text: '甲乙丙丁（（甲））、乙）：【    】',
    width: 96,
    lines: ['甲乙丙丁（（甲））、', '乙）：【    】'],
    origins: [0, 12, 24, 36, 48, 54, 66, 78, 84, 90],
  },
  {
    text: '甲乙（（甲））、乙）：【    】',
    width: 120,
    lines: ['甲乙（（甲））、乙）：【    】'],
    origins: [0, 12, 20, 26, 38, 50, 56, 62, 70, 82, 88, 90, 102, 105, 108, 111, 114],
  },
];
for (const fixture of word)
  test(`Word optical fit at ${fixture.width}${fixture.jc ? ` (${fixture.jc})` : ''}: ${fixture.text}`, () => {
    const lines = qualifiedLayout(
      fixture.text,
      fixture.width,
      undefined,
      undefined,
      '',
      fixture.jc
    );
    expect(lines.map((line) => line.spans.map((span) => span.text).join(''))).toEqual(
      fixture.lines
    );
    const origins = lines[0]!.spans.flatMap((span) =>
      [...span.text].map(
        (_, offset) =>
          span.box.x +
          measurer.measure(span.text.slice(0, offset), span.style) +
          (span.glyphOffsetPt ?? 0)
      )
    );
    expect(origins.length).toBe(fixture.origins.length);
    origins.forEach((value, index) => expect(value).toBeCloseTo(fixture.origins[index]!, 3));
  });

test('optical Word vectors survive each source-run seam', () => {
  for (const fixture of word) {
    for (let split = 0; split <= fixture.text.length; split++) {
      const lines = qualifiedLayout(fixture.text, fixture.width, split, undefined, '', fixture.jc);
      expect({
        text: fixture.text,
        split,
        lines: lines.map((line) => line.spans.map((span) => span.text).join('')),
      }).toEqual({ text: fixture.text, split, lines: fixture.lines });
      const origins = lines[0]!.spans.flatMap((span) =>
        [...span.text].map(
          (_, offset) =>
            span.box.x +
            measurer.measure(span.text.slice(0, offset), span.style) +
            (span.glyphOffsetPt ?? 0)
        )
      );
      origins.forEach((value, index) => expect(value).toBeCloseTo(fixture.origins[index]!, 3));
    }
  }
});

test('unknown and non-finite bounds retain natural line fitting', () => {
  for (const inkBounds of [undefined, () => undefined, () => ({ left: NaN, right: 6 })]) {
    const lines = layout('甲乙（丙丁）戊己', 90, undefined, { ...measurer, inkBounds });
    expect(lines.map((line) => line.spans.map((span) => span.text).join(''))).toEqual([
      '甲乙（丙丁）戊',
      '己',
    ]);
  }
});

test('optical fitting retains decorated and revised glyph geometry', () => {
  for (const props of [
    '<w:u w:val="single"/>',
    '<w:strike/>',
    '<w:dstrike/>',
    '<w:highlight w:val="yellow"/>',
    '<w:shd w:fill="000000"/>',
    '<w:rPrChange w:id="1"><w:rPr><w:b/></w:rPr></w:rPrChange>',
  ]) {
    const lines = layout('甲乙（丙丁）戊己', 90, undefined, measurer, props);
    expect(lines.map((line) => line.spans.map((span) => span.text).join(''))).toEqual([
      '甲乙（丙丁）戊',
      '己',
    ]);
    expect(
      lines.flatMap((line) => line.spans).every((span) => span.glyphOffsetPt === undefined)
    ).toBe(true);
  }
});

test('optical fitting never borrows unavailable ink bearings', () => {
  const noBearings: TextMeasurer = {
    ...measurer,
    inkBounds: (text, style) => ({
      left: 0,
      right: measurer.measure(text, { ...style, characterSpacingPt: 0 }),
    }),
  };
  for (const fixture of word) {
    const lines = layout(fixture.text, fixture.width, undefined, noBearings);
    for (const line of lines) {
      for (const span of line.spans) {
        // Shared-seam compression remains the established advance-only policy.
        // Optical fitting cannot create any further reduction when ink fills the advance.
        expect(span.style.characterSpacingPt === 0 || span.style.characterSpacingPt === -6).toBe(
          true
        );
      }
    }
  }
});

test('repeated optical fits remain independent of source-run boundaries', () => {
  for (const text of [
    '甲（乙）丙、丁：【  】戊己。',
    '甲乙（丙丁）戊己。甲乙（丙丁）戊己。',
    '甲乙（（甲））、乙）：【    】甲乙',
  ]) {
    for (const width of [54, 78, 90, 120]) {
      const geometry = (split: number) =>
        layout(text, width, split).map((line) => ({
          text: line.spans.map((span) => span.text).join(''),
          origins: line.spans.flatMap((span) =>
            [...span.text].map((_, offset) =>
              Math.round(
                (span.box.x +
                  measurer.measure(span.text.slice(0, offset), span.style) +
                  (span.glyphOffsetPt ?? 0)) *
                  1000
              )
            )
          ),
        }));
      const expected = geometry(text.length);
      for (let split = 0; split <= text.length; split++)
        expect({ text, width, split, geometry: geometry(split) }).toEqual({
          text,
          width,
          split,
          geometry: expected,
        });
    }
  }
});

function geometry(lines: ReturnType<typeof layout>) {
  return lines.map((line) => ({
    text: line.spans.map((span) => span.text).join(''),
    origins: line.spans.flatMap((span) =>
      [...span.text].map((_, offset) =>
        Math.round(
          (span.box.x +
            measurer.measure(span.text.slice(0, offset), span.style) +
            (span.glyphOffsetPt ?? 0)) *
            1000
        )
      )
    ),
  }));
}

test('protected and trailing spaces preserve source-run-independent optical geometry', () => {
  for (const [text, width, props] of [
    ['甲丙、乙、戊）：丁）丙。 。', 75, ''],
    ['丁。】甲】）丁（  ', 73, ''],
    ['： 乙【： 】甲戊）乙 】【  】。 、丁） （  】甲', 135, ''],
    ['丁【乙（】）戊。：（ 。丙。】、丙（丙 ： 丁（：、', 37, ''],
    ['乙甲：、 ', 37, '<w:spacing w:val="30"/>'],
    [
      '乙（丁（】【 、乙【乙【丁（：）：【丁。：【戊（ （丙）戊） 、丙、',
      79,
      '<w:spacing w:val="30"/>',
    ],
  ] as const) {
    const expected = geometry(layout(text, width, undefined, measurer, props));
    for (let split = -1; split <= text.length; split++)
      expect(geometry(layout(text, width, split, measurer, props))).toEqual(expected);
  }
});

test('Word colon/closing compression includes authored tracking at wide and narrow measures', () => {
  // Native Word controls: Songti SC12pt, w:spacing=0/30, measures37/200pt.
  const text = '甲：、 ';
  for (const width of [37, 200])
    for (const spacing of [0, 30])
      for (let split = -1; split <= text.length; split++) {
        const lines = qualifiedLayout(
          text,
          width,
          split,
          measurer,
          `<w:spacing w:val="${spacing}"/>`
        );
        expect(geometry(lines)).toEqual([
          { text, origins: spacing ? [0, 13500, 20250, 33750] : [0, 12000, 18000, 30000] },
        ]);
      }
});

test('Word compresses the colon before closing classes with left and centered colon ink', () => {
  // Hiragino Mincho ProN W3 outline x bounds, independently read in 1000-unit font space.
  const hiraginoBounds: Record<string, [number, number]> = {
    '：': [0.429, 0.57],
    '、': [0.059, 0.314],
    '。': [0.059, 0.317],
    '）': [0.067, 0.314],
    '】': [0.066, 0.35],
    '』': [0.067, 0.394],
    '，': [0.059, 0.203],
  };
  const hiragino: TextMeasurer = {
    ...measurer,
    inkBounds(text, style) {
      const [left, right] = hiraginoBounds[text] ?? [0.05, 0.95];
      const em = (style.fontSizePt * style.horizontalScalePercent) / 100;
      return { left: left * em, right: right * em };
    },
  };
  for (const measure of [measurer, hiragino])
    for (const closing of '、。）】』，') {
      const text = `甲：${closing}乙`;
      for (let split = -1; split <= text.length; split++)
        expect(geometry(qualifiedLayout(text, 200, split, measure))).toEqual([
          { text, origins: [0, 12000, 18000, 30000] },
        ]);
    }
});

test('unqualified punctuation pairs keep natural advances', () => {
  for (const sourcePolicy of [
    undefined,
    { kern: 2 },
    { eastAsianDefaults: true },
    { eastAsianDefaults: true, kern: 0 },
    { eastAsianDefaults: true, kern: 60 },
  ])
    for (let split = -1; split <= 4; split++)
      expect(geometry(layout('甲：、乙', 200, split, measurer, '', sourcePolicy))).toEqual([
        { text: '甲：、乙', origins: [0, 12000, 24000, 36000] },
      ]);
});

test('colon/closing pairs retain natural advances without safe measured pair bounds', () => {
  for (const inkBounds of [
    undefined,
    () => undefined,
    () => ({ left: NaN, right: 6 }),
    () => ({ left: -1, right: 6 }),
    () => ({ left: 0, right: 14 }),
  ])
    expect(geometry(layout('甲：、乙', 200, undefined, { ...measurer, inkBounds }))).toEqual([
      { text: '甲：、乙', origins: [0, 12000, 24000, 36000] },
    ]);
});

test('ineligible decorated paragraphs retain the advance-only whitespace path', () => {
  const text = '甲丙、乙、戊）：丁）丙。 。';
  for (const props of [
    '<w:u w:val="single"/>',
    '<w:highlight w:val="yellow"/>',
    '<w:rPrChange w:id="1"><w:rPr><w:b/></w:rPr></w:rPrChange>',
  ]) {
    for (const split of [-1, text.length])
      expect(geometry(layout(text, 75, split, measurer, props))).toEqual(
        geometry(layout(text, 75, split, { ...measurer, inkBounds: undefined }, props))
      );
  }
});

test('optical line geometry remains stable through cached width changes', () => {
  const text = '甲乙（丙丁）戊己';
  const source = part(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:jc w:val="both"/><w:overflowPunct w:val="0"/></w:pPr><w:r><w:rPr><w:sz w:val="24"/></w:rPr><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`
  );
  const session = createLayoutSession();
  const styleCascade = buildStyleCascadeTable(null, undefined, settings.root);
  const draw = (width: number) =>
    geometry(
      linesOf(
        layoutSemanticDocument(source, 0, {
          measurer,
          session,
          styleCascade,
          geometry: {
            width: width + 20,
            height: 500,
            margin: { top: 10, bottom: 10, left: 10, right: 10 },
          },
        })
      )
    );
  const compressed = draw(90);
  expect(draw(90)).toEqual(compressed);
  expect(draw(120)[0]!.origins).toEqual([0, 12000, 24000, 36000, 48000, 60000, 72000, 84000]);
  expect(draw(90)).toEqual(compressed);
});

test('the single-unit cluster fast path agrees with grapheme segmentation', () => {
  const units: string[] = [' ', '\u2018', '\u2019', '\u201c', '\u201d'];
  for (const [from, to] of [
    [0x3000, 0x9fff],
    [0xff00, 0xffef],
  ] as const)
    for (let code = from; code <= to; code += 1) units.push(String.fromCharCode(code));
  let fast = 0;
  for (const unit of units) {
    const text = `甲${unit}${unit}乙`;
    const clusters = fittingClusters(text);
    expect(clusters).toEqual(segmentGraphemes(text));
    if (clusters.length === 4) fast += 1;
  }
  // Combining kana, tone marks, and halfwidth voiced marks take the segmenter path.
  const voiced = 'か' + String.fromCharCode(0x3099);
  expect(fittingClusters(voiced)).toEqual(segmentGraphemes(voiced));
  expect(fittingClusters(voiced)).toHaveLength(1);
  expect(fast).toBeGreaterThan(20_000);
});

test('only a justified paragraph compresses punctuation to fit a line', () => {
  const text = (jc: string) =>
    qualifiedLayout('甲乙（丙丁）戊己', 90, undefined, undefined, '', jc).map((line) =>
      line.spans.map((span) => span.text).join('')
    );
  expect(text('both')).toEqual(['甲乙（丙丁）戊己']);
  expect(text('distribute')).toEqual(['甲乙（丙丁）戊己']);
  for (const jc of ['left', 'center', 'right']) expect(text(jc)).toEqual(['甲乙（丙丁）戊', '己']);
});

test('a document whose defaults name no East Asian face compresses no punctuation to fit', () => {
  const text = (eastAsianDefaults: boolean) =>
    layout('甲乙（丙丁）戊己', 90, undefined, measurer, '', { eastAsianDefaults }).map((line) =>
      line.spans.map((span) => span.text).join('')
    );
  expect(text(true)).toEqual(['甲乙（丙丁）戊己']);
  expect(text(false)).toEqual(['甲乙（丙丁）戊', '己']);
});
