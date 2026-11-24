// A `num` tab stop in a paragraph with no list number is an ordinary left stop.

import { expect, test } from 'bun:test';
import { loadBody } from './float-over-table-harness.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf } from '../semantic-records.ts';

test('a tab reaches a num stop when the paragraph has no list number', () => {
  const result = layoutSemanticDocument(
    loadBody(
      '<w:p><w:pPr><w:tabs><w:tab w:val="num" w:pos="360"/></w:tabs></w:pPr>' +
        '<w:r><w:tab/><w:t>A</w:t></w:r></w:p>'
    ),
    1,
    { measurer: createFixedMeasurer(6, 12) }
  );
  const a = linesOf(result)[0]!.spans.find((span) => span.text === 'A')!;
  const origin = linesOf(result)[0]!.box.x;
  expect(a.box.x - origin).toBeCloseTo(18, 6);
});
