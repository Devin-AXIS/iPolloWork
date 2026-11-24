// Optical fitting and automatic advances share the same canonical layout modules.
import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/index.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { NO_THEME_FONTS, measureDisplayText } from '../run-style.ts';
import { styleForFontSlot } from '../script-itemization.ts';
import { linesOf, type TextMeasurer } from '../semantic-records.ts';
import { automaticTextSpacingBefore } from '../cjk-automatic-spacing.ts';
import { withAuthoredCjkGapMetric } from '../cjk-auto-spacing-metric-port.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const advance = (text: string) =>
  [...text].reduce((sum, char) => sum + (/[A-Za-z0-9]/u.test(char) ? 7 : 12), 0) -
  (text.match(/AV/gu)?.length ?? 0) * 4;
// The authored-font hook supplies the reverse gap, so both boundary directions stay covered.
const measurer: TextMeasurer = withAuthoredCjkGapMetric(
  <TextMeasurer>{
    measure: (text, style) =>
      (advance(text) * style.horizontalScalePercent) / 100 + text.length * style.characterSpacingPt,
    lineMetrics: () => ({ height: 16, baseline: 12 }),
    hasResolvedFont: () => true,
    inkBounds: (text) =>
      text === '（'
        ? { left: 8, right: 10 }
        : text === '）'
          ? { left: 2, right: 4 }
          : { left: 0.6, right: 11.4 },
    textOutline: (text) => ({
      path: null,
      ink: { left: 0.4, right: advance(text) - 0.3, top: -10, bottom: 2 },
    }),
  },
  (style) => style.fontSizePt / 5
);
function part(xml: string) {
  const value = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'application/xml' });
  if (!value.ok) throw Error(value.reason);
  return value.part;
}
function probe(
  text: string,
  width: number,
  options: { automatic?: boolean; split?: number; compression?: boolean } = {}
) {
  const run = (value: string) =>
    `<w:r><w:rPr><w:rFonts w:ascii="Test Latin" w:hAnsi="Test Latin" w:eastAsia="Test CJK"/><w:sz w:val="24"/><w:kern w:val="2"/></w:rPr><w:t>${value}</w:t></w:r>`;
  const split = options.split ?? text.length;
  const source = part(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:jc w:val="both"/><w:overflowPunct w:val="0"/>${options.automatic === false ? '<w:autoSpaceDE w:val="0"/><w:autoSpaceDN w:val="0"/>' : ''}</w:pPr>${run(text.slice(0, split))}${run(text.slice(split))}</w:p></w:body></w:document>`
  );
  const before = serializeOoxmlPart(source);
  const styles = part(
    `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:eastAsia="Test CJK"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`
  );
  const settings = part(
    `<w:settings xmlns:w="${W}"><w:characterSpacingControl w:val="${options.compression === false ? 'doNotCompress' : 'compressPunctuation'}"/></w:settings>`
  );
  const document = layoutSemanticDocument(source, 0, {
    measurer,
    styleCascade: buildStyleCascadeTable(
      styles.root,
      { ...NO_THEME_FONTS, eastAsianFontTableFaces: ['test cjk'] },
      settings.root
    ),
    geometry: {
      width: width + 20,
      height: 500,
      margin: { top: 10, bottom: 10, left: 10, right: 10 },
    },
  });
  return { source, before, lines: linesOf(document) };
}
const textOf = (value: ReturnType<typeof probe>) =>
  value.lines.map((line) => line.spans.map((span) => span.text).join(''));
function withinMeasure(value: ReturnType<typeof probe>, width: number) {
  for (const line of value.lines) {
    const first = line.spans[0];
    if (!first) continue;
    expect(automaticTextSpacingBefore(first)).toBe(0);
    const last = line.spans.at(-1)!;
    expect(last.box.x + last.box.width - first.box.x).toBeLessThanOrEqual(width + 0.001);
    for (let index = 1; index < line.spans.length; index++) {
      const span = line.spans[index]!,
        previous = line.spans[index - 1]!;
      const marker = automaticTextSpacingBefore(span);
      if (marker > 0)
        expect(span.box.x - previous.box.x - previous.box.width).toBeCloseTo(marker, 9);
    }
  }
  expect(serializeOoxmlPart(value.source)).toBe(value.before);
}

test('disabled automatic spacing retains the independent mixed optical geometry', () => {
  const text = '甲）AV（乙末',
    width = advance('甲）AV（乙') - 6;
  const value = probe(text, width, { automatic: false });
  expect(textOf(value)).toEqual(['甲）AV（乙', '末']);
  expect(
    value.lines
      .flatMap((line) => line.spans)
      .every((span) => automaticTextSpacingBefore(span) === 0)
  ).toBe(true);
  withinMeasure(value, width);
});

test('existing same-line automatic gaps retain their own advance and source start', () => {
  const text = '甲A乙）AV（丙末',
    width = 200;
  const value = probe(text, width);
  expect(textOf(value)).toEqual([text]);
  const gaps = value.lines
    .flatMap((line) => line.spans)
    .filter((span) => automaticTextSpacingBefore(span) > 0);
  expect(gaps.map((span) => [span.range.start, automaticTextSpacingBefore(span)])).toEqual([
    [1, 3],
    [2, 2.4],
  ]);
  withinMeasure(value, width);
});

function characters(line: ReturnType<typeof probe>['lines'][number]) {
  return line.spans.flatMap((span) =>
    [...span.text].map((text, index) => {
      const face = styleForFontSlot(span.style, span.fontSlot);
      const prefix = measureDisplayText(span.text.slice(0, index), face, measurer);
      return {
        text,
        start: span.range.start + index,
        end: span.range.start + index + 1,
        x: span.box.x + prefix,
        width: measureDisplayText(span.text.slice(0, index + 1), face, measurer) - prefix,
        style: span.style,
        fontSlot: span.fontSlot,
      };
    })
  );
}

test('the first automatic gap is budgeted before fitting and a moved candidate leaves no compression', () => {
  const prefix = '甲）AV（乙',
    text = prefix + 'A';
  // Natural prefix fits. The following A needs both its natural advance and its DE gap.
  const width = advance(text) - 6;
  expect(advance(prefix)).toBeLessThan(width);
  for (let split = 0; split <= text.length; split++) {
    // Keep AV shaped in one source run for this protected opaque-word case.
    if (split === prefix.indexOf('AV') + 1) continue;
    const natural = probe(text, width, { split, compression: false });
    expect(textOf(natural)).toEqual([prefix, 'A']);
    const value = probe(text, width, { split });
    expect(textOf(value).join('')).toBe(text);
    withinMeasure(value, width);
    const first = textOf(value)[0]!;
    expect([prefix, text]).toContain(first);
    if (first === prefix) {
      expect(textOf(value)).toEqual([prefix, 'A']);
      // A did not stay, so none of the earlier natural prefix may remain compressed.
      expect(characters(value.lines[0]!)).toEqual(characters(natural.lines[0]!));
    } else {
      expect(textOf(value)).toEqual([text]);
      const spans = value.lines[0]!.spans;
      const gaps = spans.reduce((sum, span) => sum + automaticTextSpacingBefore(span), 0);
      expect(gaps).toBe(12 / 4);
      const reduction = spans
        .filter((span) => span.fontSlot === 'eastAsia')
        .reduce((sum, span) => sum + advance(span.text) - span.box.width, 0);
      expect(reduction).toBeCloseTo(advance(text) + gaps - width, 9);
      expect(
        spans
          .filter((span) => span.style.characterSpacingPt < 0)
          .every((span) => /^[（）]+$/u.test(span.text))
      ).toBe(true);
    }
    // AV and A retain the same complete natural spans, even when one changes lines.
    for (const span of value.lines
      .flatMap((line) => line.spans)
      .filter((span) => span.fontSlot !== 'eastAsia')) {
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
      expect(span.style).toEqual(counterpart.style);
      expect(span.box.width).toBe(counterpart.box.width);
      expect(span.glyphOffsetPt).toBe(counterpart.glyphOffsetPt);
    }
    expect(
      value.lines
        .flatMap((line) => line.spans)
        .flatMap((span) => [...span.text].map((_, index) => span.range.start + index))
    ).toEqual([...text].map((_, index) => index));
  }
});
