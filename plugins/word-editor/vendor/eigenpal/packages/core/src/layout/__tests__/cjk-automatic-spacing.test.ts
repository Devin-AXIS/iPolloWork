import { withAuthoredCjkGapMetric } from '../cjk-auto-spacing-metric-port.ts';
import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '@docx-editor.dev/core/store';
import {
  buildStyleCascadeTable,
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '@docx-editor.dev/core/layout';
import { caretAt } from '../semantic-interaction.ts';
import { paintSemanticLayout } from '../../output/semantic-paint.ts';
import { automaticTextGap } from '../cjk-automatic-spacing.ts';
import { DEFAULT_RUN_STYLE } from '../run-style.ts';
import { resolveCjkTypography } from '../cjk-typography.ts';
import { piecesOfParagraph } from '../field-projection.ts';
import { cjkParagraphBreaks } from '../cjk-paragraph-breaks.ts';
import { anchorLineStartsByModelOffset } from '../anchor-line-probe.ts';
import { breakParagraph } from '../paragraph-flow.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
// This deterministic fixture explicitly supplies an authored reverse metric.
const measurer = withAuthoredCjkGapMetric(
  createFixedMeasurer(6, 14),
  (style) => style.fontSizePt / 4
);
const geometry = (width = 160) => ({
  width: width + 20,
  height: 500,
  margin: { left: 10, right: 10, top: 10, bottom: 10 },
});
function part(xml: string, name = '/word/document.xml') {
  const read = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!read.ok) throw new Error(read.reason);
  return read.part;
}
const run = (text: string, props = '') =>
  `<w:r><w:rPr><w:sz w:val="22"/>${props}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
const doc = (body: string, pPr = '') =>
  part(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr>${pPr}</w:pPr>${body}</w:p></w:body></w:document>`
  );
function layout(body: string, pPr = '', width = 160) {
  return layoutSemanticDocument(doc(body, pPr), 0, { measurer, geometry: geometry(width) });
}
const line = (value: ReturnType<typeof layout>) => value.pages[0]!.fragments[0]!.lines[0]!;
function gap(value: ReturnType<typeof layout>) {
  const s = line(value).spans;
  expect(s).toHaveLength(2);
  return s[1]!.box.x - s[0]!.box.x - s[0]!.box.width;
}
function geometryRows(value: ReturnType<typeof layout>) {
  return value.pages.flatMap((p) =>
    p.fragments.flatMap((f) =>
      f.lines.map((l) => ({
        text: l.spans.map((s) => s.text).join(''),
        spans: l.spans.map((s) => ({
          text: s.text,
          range: s.range,
          box: s.box,
          wrap: s.wrapAdvanceBefore ?? null,
        })),
      }))
    )
  );
}

test('automatic number spacing defaults on and changes real advance only', () => {
  const value = layout(run('1汉'));
  expect(gap(value)).toBeCloseTo(2.75, 8);
  const spans = line(value).spans;
  expect(spans.map((s) => s.text).join('')).toBe('1汉');
  expect(spans.map((s) => [s.range.start, s.range.end])).toEqual([
    [0, 1],
    [1, 2],
  ]);
  expect(spans[1]!.wrapAdvanceBefore).toBeUndefined();
});

test('automatic Latin spacing defaults on independently of number spacing', () => {
  expect(gap(layout(run('A汉')))).toBeCloseTo(2.75, 8);
  expect(gap(layout(run('1汉'), '<w:autoSpaceDN w:val="0"/>'))).toBeCloseTo(0, 8);
  expect(gap(layout(run('A汉'), '<w:autoSpaceDN w:val="0"/>'))).toBeCloseTo(2.75, 8);
  expect(gap(layout(run('A汉'), '<w:autoSpaceDE w:val="false"/>'))).toBeCloseTo(0, 8);
  expect(gap(layout(run('1汉'), '<w:autoSpaceDE w:val="false"/>'))).toBeCloseTo(2.75, 8);
});

test('source run seams do not add or lose automatic advances', () => {
  const a = layout(run('1汉2'));
  const b = layout(run('1') + run('汉') + run('2'));
  expect(geometryRows(b)).toEqual(geometryRows(a));
  expect(
    line(a).spans.at(-1)!.box.x + line(a).spans.at(-1)!.box.width - line(a).spans[0]!.box.x
  ).toBeCloseTo(23.5, 8);
});

test('automatic spacing participates in line fit without leading or trailing gaps', () => {
  const value = layout(run('1汉'), '', 14);
  const lines = value.pages[0]!.fragments[0]!.lines;
  expect(lines.map((l) => l.spans.map((s) => s.text).join(''))).toEqual(['1', '汉']);
  expect(value.pages[0]!.contentBox.x).toBe(10);
  expect(lines.map((l) => l.box.width)).toEqual([14, 14]);
  expect(lines.map((l) => l.spans[0]!.box.x - l.box.x)).toEqual([0, 0]);
  expect(
    lines.map((l) => l.spans.at(-1)!.box.x + l.spans.at(-1)!.box.width - l.spans[0]!.box.x)
  ).toEqual([6, 6]);
  expect(
    line(layout(run('1汉'), '<w:autoSpaceDN w:val="0"/>', 14))
      .spans.map((s) => s.text)
      .join('')
  ).toBe('1汉');
});

test('an inherited false remains false and a direct true overrides it', () => {
  const styles = part(
    `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="Base"><w:pPr><w:autoSpaceDN w:val="0"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Child"><w:basedOn w:val="Base"/></w:style></w:styles>`,
    '/word/styles.xml'
  );
  const cascade = buildStyleCascadeTable(styles.root);
  const first = layoutSemanticDocument(doc(run('1汉'), '<w:pStyle w:val="Child"/>'), 0, {
    measurer,
    geometry: geometry(),
    styleCascade: cascade,
  });
  const second = layoutSemanticDocument(
    doc(run('1汉'), '<w:pStyle w:val="Child"/><w:autoSpaceDN/>'),
    0,
    { measurer, geometry: geometry(), styleCascade: cascade }
  );
  expect(gap(first)).toBeCloseTo(0, 8);
  expect(gap(second)).toBeCloseTo(2.75, 8);
});

test('docDefaults false reaches paragraphs without a direct style', () => {
  const styles = part(
    `<w:styles xmlns:w="${W}"><w:docDefaults><w:pPrDefault><w:pPr><w:autoSpaceDE w:val="off"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>`,
    '/word/styles.xml'
  );
  const value = layoutSemanticDocument(doc(run('A汉')), 0, {
    measurer,
    geometry: geometry(),
    styleCascade: buildStyleCascadeTable(styles.root),
  });
  expect(gap(value)).toBeCloseTo(0, 8);
});

test('manual character spacing retains its authored advance without automatic stacking', () => {
  for (const spacing of [-20, 20]) {
    const body = run('1汉', `<w:spacing w:val="${spacing}"/>`);
    expect(geometryRows(layout(body))).toEqual(
      geometryRows(layout(body, '<w:autoSpaceDN w:val="0"/>'))
    );
  }
});

test('authored spaces and tabs remain source characters without automatic stacking', () => {
  for (const body of [run('1 汉'), run('1') + '<w:r><w:tab/></w:r>' + run('汉')]) {
    expect(geometryRows(layout(body))).toEqual(
      geometryRows(layout(body, '<w:autoSpaceDN w:val="0"/>'))
    );
  }
});

test('math, projections, fullwidth forms and complex scripts do not acquire automatic gaps', () => {
  const style = { ...DEFAULT_RUN_STYLE, fontSizePt: 11 };
  const east = { text: '汉', style };
  const policy = resolveCjkTypography([]);
  for (const text of ['α', '١', 'א', 'Ａ', '１', '。', '😀'])
    expect(automaticTextGap({ text, style }, east, policy)).toBe(0);
  for (const extra of [{ equation: {} }, { projected: true }, { fieldAtom: {} }, { noteNav: {} }])
    expect(automaticTextGap({ text: '1', style, ...extra }, east, policy)).toBe(0);
  expect(
    automaticTextGap(
      {
        text: '1',
        style: { ...style, shaping: { direction: 'rtl', script: 'Arab', level: 1, baseLevel: 1 } },
      },
      east,
      policy
    )
  ).toBe(0);
});

test('a combining sequence stays one source cluster at a Latin boundary', () => {
  expect(gap(layout(run('a\u0301汉')))).toBeCloseTo(2.75, 8);
  expect(line(layout(run('a\u0301汉'))).spans.map((s) => [s.range.start, s.range.end])).toEqual([
    [0, 2],
    [2, 3],
  ]);
});

test('paint and caret use the published automatic gap without a source space', () => {
  const value = layout(run('1汉'));
  const current = line(value).spans[1]!;
  const caret = caretAt(value, { paragraphId: current.range.paragraphId, offset: 1 }, measurer);
  expect(caret!.x).toBeCloseTo(current.box.x, 8);
  const host = document.createElement('div');
  paintSemanticLayout(host, value, { scale: 1 });
  const painted = [...host.querySelectorAll<HTMLElement>('.docx-line [data-start]')];
  expect(painted.map((s) => s.textContent).join('')).toBe('1汉');
  // The gap paints as letter spacing on the digit, not as a margin on the ideograph.
  expect(painted[1]!.style.marginLeft).toBe('');
  expect(parseFloat(painted[0]!.style.letterSpacing)).toBeCloseTo(2.75, 8);
});

test('layout and paint leave the original OOXML serialization unchanged', () => {
  const source = doc(run('1汉A'));
  const before = serializeOoxmlPart(source);
  const value = layoutSemanticDocument(source, 0, { measurer, geometry: geometry() });
  paintSemanticLayout(document.createElement('div'), value, { scale: 1 });
  expect(serializeOoxmlPart(source)).toEqual(before);
  expect(
    line(value)
      .spans.map((s) => s.text)
      .join('')
  ).toBe('1汉A');
});

test('typography changes invalidate a warm layout without a document edit', () => {
  const source = doc(run('1汉'));
  const session = createLayoutSession();
  const styles = part(
    `<w:styles xmlns:w="${W}"><w:docDefaults><w:pPrDefault><w:pPr><w:autoSpaceDN w:val="0"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>`,
    '/word/styles.xml'
  );
  const first = layoutSemanticDocument(source, 0, {
    session,
    measurer,
    geometry: geometry(),
    styleCascade: buildStyleCascadeTable(null),
  });
  const second = layoutSemanticDocument(source, 0, {
    session,
    measurer,
    geometry: geometry(),
    styleCascade: buildStyleCascadeTable(styles.root),
  });
  expect(gap(first)).toBeCloseTo(2.75, 8);
  expect(gap(second)).toBeCloseTo(0, 8);
  expect(second.revision).toBe(first.revision);
  expect(second.pages).not.toBe(first.pages);
});

test('justification keeps automatic advances separate from float wrap passages', () => {
  // Three 6pt glyphs plus two 2.75pt fixture gaps need 23.5pt before justification.
  const value = layout(run('汉1汉汉'), '<w:jc w:val="both"/>', 24);
  const first = line(value);
  expect(first.spans.map((s) => s.text).join('')).toBe('汉1汉');
  expect(first.spans.every((s) => s.wrapAdvanceBefore === undefined)).toBe(true);
  expect(value.pages[0]!.contentBox.x).toBe(10);
  expect(first.box.width).toBe(24);
  expect(first.spans.at(-1)!.box.x + first.spans.at(-1)!.box.width - first.box.x).toBeCloseTo(
    24,
    8
  );
  for (const span of first.spans) {
    const caret = caretAt(
      value,
      { paragraphId: span.range.paragraphId, offset: span.range.start },
      measurer
    );
    expect(caret!.x).toBeCloseTo(span.box.x, 8);
  }
});

test('anchor line prediction and placement include the same boundary advances', () => {
  const source = doc(run('1汉2'));
  const paragraph = source.root.children[0]!.children.find((x) => x.kind === 'paragraph')!;
  const pieces = piecesOfParagraph(paragraph);
  const policy = resolveCjkTypography([]);
  const prediction = anchorLineStartsByModelOffset({
    pieces,
    measurer,
    available: 14,
    firstLineOffset: 0,
    anchorStarts: [1, 2],
    equationLayoutOf: () => null,
    typography: policy,
    cjkBreaks: cjkParagraphBreaks(pieces, policy),
  });
  const placed = breakParagraph(paragraph, 'p', 0, 14, measurer, undefined, null);
  expect(placed.map((l) => l.spans.map((s) => s.text).join(''))).toEqual(['1', '汉', '2']);
  expect(prediction.get(1)).toBe(1);
  expect(prediction.get(2)).toBe(2);
});

test('a reverse advance inside a group uses the drawn font slot face', () => {
  // A hinted pinyin letter draws in the East Asian face, which alone supplies the metric.
  const slotMeasurer = withAuthoredCjkGapMetric(createFixedMeasurer(6, 14), (style) =>
    style.fontFamily === 'SimSun' ? 3 : undefined
  );
  const fonts =
    '<w:rFonts w:ascii="Unrecorded Latin" w:hAnsi="Unrecorded Latin" w:eastAsia="SimSun" w:hint="eastAsia"/>';
  const value = layoutSemanticDocument(doc(run('ā中', fonts + '<w:lang w:eastAsia="zh-CN"/>')), 0, {
    measurer: slotMeasurer,
    geometry: geometry(),
    styleCascade: {
      ...buildStyleCascadeTable(null),
      typography: {
        strict: false,
        compression: 'doNotCompress',
        before: { 'zh-cn': '中' },
        after: {},
      },
    },
  });
  const [letter, ideograph] = line(value).spans;
  expect([letter!.text, ideograph!.text]).toEqual(['ā', '中']);
  expect(ideograph!.box.x - letter!.box.x - letter!.box.width).toBeCloseTo(3, 8);
});

test('a group that cannot break carries to the next line with its advance', () => {
  const value = layoutSemanticDocument(
    doc(run('前文3ヵ月後に', '<w:lang w:eastAsia="ja-JP"/>')),
    0,
    {
      measurer,
      geometry: geometry(20),
      styleCascade: {
        ...buildStyleCascadeTable(null),
        typography: { strict: true, compression: 'doNotCompress', before: {}, after: {} },
      },
    }
  );
  const lines = value.pages[0]!.fragments[0]!.lines;
  expect(lines.map((l) => l.spans.map((s) => s.text).join(''))).toEqual(['前文', '3ヵ', '月後に']);
  const [digit, kana] = lines[1]!.spans;
  expect(kana!.box.x - digit!.box.x - digit!.box.width).toBeCloseTo(2.75, 8);
});

test('line layout draws the advance inside a group that cannot break', () => {
  const cases = [
    {
      text: '甲A乙',
      lang: '<w:lang w:eastAsia="zh-CN"/>',
      typography: {
        strict: false,
        compression: 'doNotCompress' as const,
        before: { 'zh-cn': 'A乙' },
        after: { 'zh-cn': '甲A' },
      },
      spans: ['甲', 'A', '乙'],
      // 6 + 2.75 + 6 + 2.75 + 6 = 23.5 pt.
      narrowWidth: 24,
      narrow: ['甲', 'A', '乙'],
    },
    {
      text: '3ヵ月',
      lang: '<w:lang w:eastAsia="ja-JP"/>',
      typography: { strict: true, compression: 'doNotCompress' as const, before: {}, after: {} },
      spans: ['3', 'ヵ月'],
      // 6 + 2.75 + 6 = 14.75 pt; a narrower line cuts the group (kinsoku-oversized-group).
      narrowWidth: 15,
      narrow: ['3', 'ヵ'],
    },
  ];
  for (const { text, lang, typography, spans, narrowWidth, narrow } of cases) {
    for (const width of [160, narrowWidth]) {
      const value = layoutSemanticDocument(doc(run(text, lang)), 0, {
        measurer,
        geometry: geometry(width),
        styleCascade: { ...buildStyleCascadeTable(null), typography },
      });
      const placed = line(value).spans;
      // The group stays on one line, and every script boundary carries its advance.
      expect(placed.map((span) => span.text)).toEqual(width === narrowWidth ? narrow : spans);
      for (let index = 1; index < placed.length; index += 1) {
        const previous = placed[index - 1]!;
        expect(placed[index]!.box.x - previous.box.x - previous.box.width).toBeCloseTo(2.75, 8);
        const caret = caretAt(
          value,
          { paragraphId: placed[index]!.range.paragraphId, offset: placed[index]!.range.start },
          measurer
        );
        expect(caret!.x).toBeCloseTo(placed[index]!.box.x, 8);
      }
    }
  }
});
