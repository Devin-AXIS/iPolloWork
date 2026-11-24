// Paint draws the gaps alignment opens between split characters without moving any glyph off
// its layout position: as letter spacing where the box can grow, and as a margin where the box
// has a fixed width (compressed East Asian punctuation).
import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { buildStyleCascadeTable, layoutSemanticDocument } from '@docx-editor.dev/core/layout';
import { linesOf, type LineRecord, type TextMeasurer } from '../../layout/semantic-records.ts';
import { paintSemanticLayout } from '../semantic-paint.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
// One em per character, so compressed punctuation is half an em and every gap is visible.
const measurer: TextMeasurer = {
  measure: (text, style) =>
    text.length *
    ((style.fontSizePt * style.horizontalScalePercent) / 100 + style.characterSpacingPt),
  lineMetrics: () => ({ height: 16, baseline: 12 }),
};
function part(xml: string, name: string) {
  const read = readOoxmlPart(xml, { name, contentType: 'application/xml' });
  if (!read.ok) throw new Error(read.reason);
  return read.part;
}
const cascade = buildStyleCascadeTable(
  part(
    `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:eastAsia="MS Mincho"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`,
    '/word/styles.xml'
  ).root,
  undefined,
  part(
    `<w:settings xmlns:w="${W}"><w:characterSpacingControl w:val="compressPunctuation"/></w:settings>`,
    '/word/settings.xml'
  ).root
);

function paint(text: string, jc: string, width: number) {
  const document_ = part(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:overflowPunct w:val="0"/><w:jc w:val="${jc}"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Hiragino Mincho ProN" w:eastAsia="Hiragino Mincho ProN"/><w:sz w:val="24"/><w:kern w:val="2"/></w:rPr><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
    '/word/document.xml'
  );
  const result = layoutSemanticDocument(document_, 0, {
    measurer,
    styleCascade: cascade,
    geometry: {
      width: width + 20,
      height: 900,
      margin: { top: 10, bottom: 10, left: 10, right: 10 },
    },
  });
  const host = document.createElement('div');
  paintSemanticLayout(host, result, { scale: 1 });
  const elements = Array.from(host.querySelectorAll<HTMLElement>('.docx-line'));
  return linesOf(result).map((line, index) => ({
    line,
    runs: Array.from(elements[index]!.querySelectorAll<HTMLElement>('.layout-run-text')),
  }));
}

/** Where each painted run starts, from the line origin, as inline flow places it. */
function paintedOrigins(line: LineRecord, runs: readonly HTMLElement[]): number[] {
  const spans = line.spans.filter((span) => span.text !== '');
  const origins: number[] = [];
  let x = spans[0]?.box.x ?? 0;
  runs.forEach((run, index) => {
    const span = spans[index]!;
    x += parseFloat(run.style.marginLeft || '0');
    origins.push(x);
    // A fixed width is the painted advance; otherwise the text advance plus extra spacing.
    const spacing = run.style.letterSpacing
      ? parseFloat(run.style.letterSpacing) - span.style.characterSpacingPt
      : 0;
    x += run.style.width ? parseFloat(run.style.width) : span.box.width + spacing;
  });
  return origins;
}

const TEXT = '甲甲甲甲：【乙丙丁甲甲：【乙丙丁甲甲甲：【乙丙）（丁甲甲：「乙丙丁」。甲';

test('compressed punctuation keeps the gap after it as a margin on the next character', () => {
  let found = 0;
  for (let width = 54; width <= 70; width += 1) {
    for (const { line, runs } of paint(TEXT, 'both', width)) {
      const spans = line.spans.filter((span) => span.text !== '');
      for (let index = 0; index + 1 < spans.length; index++) {
        const span = spans[index]!;
        const gap = spans[index + 1]!.box.x - (span.box.x + span.box.width);
        if (span.glyphOffsetPt === undefined || gap <= 0.001) continue;
        // The compressed box has a fixed width and cannot grow, so the gap stays a margin.
        expect(runs[index]!.style.width).not.toBe('');
        // Its letter spacing is its own compression, with no gap added.
        expect(parseFloat(runs[index]!.style.letterSpacing || '0')).toBeCloseTo(
          span.style.characterSpacingPt,
          6
        );
        expect(parseFloat(runs[index + 1]!.style.marginLeft)).toBeCloseTo(gap, 4);
        found += 1;
      }
    }
  }
  expect(found).toBeGreaterThan(0);
});

test('every painted run of a justified East Asian paragraph starts at its layout x', () => {
  let checked = 0;
  for (const jc of ['both', 'distribute']) {
    for (let width = 54; width <= 90; width += 1) {
      for (const { line, runs } of paint(TEXT, jc, width)) {
        const spans = line.spans.filter((span) => span.text !== '');
        expect(runs).toHaveLength(spans.length);
        const origins = paintedOrigins(line, runs);
        spans.forEach((span, index) => {
          expect([jc, width, span.text, origins[index]! - span.box.x]).toEqual([
            jc,
            width,
            span.text,
            expect.closeTo(0, 4),
          ]);
        });
        checked += spans.length;
      }
    }
  }
  expect(checked).toBeGreaterThan(1000);
});
