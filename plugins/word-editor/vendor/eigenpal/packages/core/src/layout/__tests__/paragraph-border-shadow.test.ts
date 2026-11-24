// A shadowed paragraph border: the box moves down by the rule width, and bands of that width
// lie outside the right rule and below the bottom rule.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { paragraphFragmentsOf } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function boxed(shadow: boolean) {
  const edge = (side: string) =>
    `<w:${side} w:val="single" w:sz="12" w:space="1" w:color="000000"${shadow ? ' w:shadow="1"' : ''}/>`;
  const body =
    `<w:p><w:pPr><w:pBdr>${['top', 'left', 'bottom', 'right'].map(edge).join('')}</w:pBdr></w:pPr>` +
    '<w:r><w:t>Boxed</w:t></w:r></w:p><w:p><w:r><w:t>After</w:t></w:r></w:p>';
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  const layout = layoutSemanticDocument(read.part, 1, {
    measurer: createFixedMeasurer(6, 12),
    geometry: { width: 300, height: 400, margin: { top: 0, bottom: 0, left: 20, right: 20 } },
  });
  return paragraphFragmentsOf(layout.pages[0]!);
}

test('a shadow moves the box down and adds a band right of and below it', () => {
  const [plain, plainNext] = boxed(false);
  const [shadowed, shadowedNext] = boxed(true);
  const width = 1.5; // w:sz 12 is 1.5pt
  const rule = (fragment: typeof plain, side: string) =>
    fragment!.borders!.filter((stroke) => stroke.side === side).map((stroke) => stroke.box);
  // The top rule and the text move down by one rule width.
  expect(rule(shadowed, 'top')[0]!.y - rule(plain, 'top')[0]!.y).toBeCloseTo(width, 6);
  // A band of the rule width lies below the bottom rule and right of the right rule.
  const [bottomRule, bottomBand] = rule(shadowed, 'bottom');
  expect(bottomBand!.y).toBeCloseTo(bottomRule!.y + width, 6);
  expect(bottomBand!.height).toBeCloseTo(width, 6);
  const [rightRule, rightBand] = rule(shadowed, 'right');
  expect(rightBand!.x).toBeCloseTo(rightRule!.x + width, 6);
  expect(rightBand!.x + rightBand!.width).toBeCloseTo(bottomBand!.x + bottomBand!.width, 6);
  // The next paragraph moves down by two rule widths: the shifted box and the bottom band.
  const next = (fragment: typeof plain) => fragment!.lines[0]!.box.y;
  expect(next(shadowedNext) - next(plainNext)).toBeCloseTo(2 * width, 6);
});
