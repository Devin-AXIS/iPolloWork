// A justified line that shrinks its spaces keeps every span's style and natural box, and moves the
// spans after each shrunk space left. Paint draws the overlap inside the span as negative word
// spacing, and the caret after a shrunk space stands where the next span starts.
import { expect, test } from 'bun:test';
import { loadBody } from './float-over-table-harness.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf, type TextMeasurer } from '../semantic-records.ts';
import { caretAt } from '../semantic-interaction.ts';
import { paintSemanticLayout } from '../../output/semantic-paint.ts';
import { paintedGapBetween } from '../../output/semantic-paint-letter-gap.ts';

// Letters are 10 pt and spaces 4 pt. `aa bb cc` needs 68 pt of a 66 pt line: each of the two
// spaces gives up 1 pt.
const measurer: TextMeasurer = {
  measure: (text, style) =>
    [...text].reduce((n, c) => n + (c === ' ' ? 4 + (style.shaping?.wordSpacingPt ?? 0) : 10), 0),
  lineMetrics: () => ({ height: 14, baseline: 11 }),
};
const layout = () =>
  layoutSemanticDocument(
    loadBody(
      `<w:p><w:pPr><w:jc w:val="both"/></w:pPr><w:r><w:t>aa bb cc dd</w:t></w:r></w:p>` +
        `<w:sectPr><w:pgSz w:w="2320" w:h="6000"/>` +
        `<w:pgMar w:left="500" w:right="500" w:top="500" w:bottom="500"/></w:sectPr>`
    ),
    1,
    { measurer, compatibilityMode: 15 }
  );

test('a shrunk space keeps its style and box, and the next span starts inside it', () => {
  const result = layout();
  const spans = linesOf(result)[0]!.spans;
  expect(spans.map((span) => span.text).join('')).toBe('aa bb cc ');
  for (const span of spans) {
    expect(span.style.shaping?.wordSpacingPt).toBeUndefined();
    expect(span.box.width).toBeCloseTo(measurer.measure(span.text, span.style), 6);
  }
  expect(paintedGapBetween(spans[0]!, spans[1]!)).toBeCloseTo(-1, 6);
  expect(paintedGapBetween(spans[1]!, spans[2]!)).toBeCloseTo(-1, 6);
  // The visible text ends at the margin.
  const last = spans.at(-1)!;
  expect(last.box.x + measurer.measure('cc', last.style) - spans[0]!.box.x).toBeCloseTo(66, 6);
});

test('the caret after a shrunk space stands where the next span starts', () => {
  const result = layout();
  const spans = linesOf(result)[0]!.spans;
  const at = (offset: number) =>
    caretAt(result, { paragraphId: spans[0]!.range.paragraphId, offset }, measurer)!.x;
  expect(at(3) - at(0)).toBeCloseTo(spans[1]!.box.x - spans[0]!.box.x, 6);
  expect(at(3) - at(0)).toBeCloseTo(23, 6);
  expect(at(6) - at(0)).toBeCloseTo(46, 6);
});

test('paint draws each shrunk space as negative word spacing inside its span', () => {
  const host = document.createElement('div');
  paintSemanticLayout(host, layout(), { scale: 1 });
  const runs = Array.from(
    host.querySelector('.docx-line')!.querySelectorAll<HTMLElement>('.layout-run-text')
  );
  expect(runs.map((run) => run.textContent)).toEqual(['aa ', 'bb ', 'cc ']);
  expect(runs.map((run) => run.style.wordSpacing)).toEqual(['-1px', '-1px', '']);
  expect(runs.map((run) => run.style.marginLeft)).toEqual(['', '', '']);
});
