import { describe, expect, test } from 'bun:test';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { paragraphFragmentsOf } from '../semantic-records.ts';
import type { ExclusionZone } from '../drawing-exclusion.ts';
import { topAndBottomSkipBeforeLine } from '../top-and-bottom-clearance.ts';
import { load, layoutContext, squareAnchorAtLeft } from './anchored-drawing-test-fixtures.ts';

const measurer = createFixedMeasurer(6, 14);
const SPACE_BEFORE_12PT = '<w:pPr><w:spacing w:before="240"/></w:pPr>';

/**
 * A `TOP` paragraph, an `ANCHOR` paragraph holding a 3.75pt `wrapTopAndBottom` rule
 * `offsetPt` below its own top, and a `NEXT` paragraph.
 */
function layout(options: {
  readonly offsetPt: number;
  readonly topRun?: string;
  readonly anchorPPr?: string;
  readonly nextPPr?: string;
}) {
  const xml = squareAnchorAtLeft({ text: 'ANCHOR' })
    .replace(/<wp:wrapSquare[^>]*\/>/, '<wp:wrapTopAndBottom/>')
    .replace(
      'relativeFrom="paragraph"><wp:posOffset>0',
      `relativeFrom="paragraph"><wp:posOffset>${Math.round(options.offsetPt * 12_700)}`
    )
    .replaceAll('cy="914400"', 'cy="47625"')
    .replace(
      '<w:body><w:p>',
      `<w:body><w:p>${options.topRun ?? '<w:r><w:t>TOP</w:t></w:r>'}</w:p><w:p>${options.anchorPPr ?? ''}`
    )
    .replace(
      '</w:p></w:body>',
      `</w:p><w:p>${options.nextPPr ?? ''}<w:r><w:t>NEXT</w:t></w:r></w:p></w:body>`
    );
  const part = load(xml);
  const page = layoutSemanticDocument(part, 1, {
    measurer,
    inlineDrawingLayout: layoutContext(part),
  }).pages[0]!;
  const [top, anchor, next] = paragraphFragmentsOf(page).map((fragment) => fragment.lines[0]!.box);
  const rule = page.anchoredDrawings![0]!;
  return { top: top!, anchor: anchor!, next: next!, ruleBottom: rule.y + rule.height, rule };
}

// The rule starts `offsetPt` below the paragraph top, above its spacing before. A line the rule crosses, or whose spacing before it crosses, moves below the
// rule and keeps that spacing.
describe('wrapTopAndBottom and paragraph spacing before', () => {
  test('a rule across the line after the spacing moves the line and keeps the spacing', () => {
    const { top, anchor, rule, ruleBottom } = layout({
      offsetPt: 18,
      anchorPPr: SPACE_BEFORE_12PT,
    });
    expect(rule.y).toBeCloseTo(top.y + top.height + 18, 3);
    expect(anchor.y).toBeCloseTo(ruleBottom + 12, 3);
  });

  test('a rule inside the spacing before moves the line the same way', () => {
    const { anchor, ruleBottom } = layout({ offsetPt: 6, anchorPPr: SPACE_BEFORE_12PT });
    expect(anchor.y).toBeCloseTo(ruleBottom + 12, 3);
  });

  test("a rule inside the next paragraph's spacing before moves that paragraph", () => {
    const clear = layout({ offsetPt: 40 });
    const offsetPt = clear.anchor.height + 2;
    const { anchor, next, ruleBottom } = layout({ offsetPt, nextPPr: SPACE_BEFORE_12PT });
    expect(anchor.y).toBeCloseTo(clear.anchor.y, 3);
    expect(next.y).toBeCloseTo(ruleBottom + 12, 3);
  });

  test('a line that only touches the rule stays, even when its mark is taller', () => {
    // The 8pt run is shorter than the paragraph mark the early estimate measures.
    const { top, anchor, rule, ruleBottom } = layout({
      offsetPt: 0,
      topRun: '<w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t>TOP</w:t></w:r>',
    });
    expect(top.y).toBe(0);
    expect(rule.y).toBeCloseTo(top.height, 3);
    expect(anchor.y).toBeCloseTo(ruleBottom, 3);
  });

  test('a floating table band keeps the plain rule: the line starts at its bottom', () => {
    const band = (sourceKind?: 'table') =>
      ({
        input: { mode: 'topAndBottom' },
        verticalBand: { x: 0, y: 100, width: 400, height: 50 },
        ...(sourceKind ? { sourceKind } : {}),
      }) as unknown as ExclusionZone;
    // A line at 145 with 12pt spacing before it; the band ends at 150.
    expect(topAndBottomSkipBeforeLine(145, 14, [band('table')], 12)).toBeCloseTo(5, 3);
    expect(topAndBottomSkipBeforeLine(145, 14, [band()], 12)).toBeCloseTo(17, 3);
  });
});
