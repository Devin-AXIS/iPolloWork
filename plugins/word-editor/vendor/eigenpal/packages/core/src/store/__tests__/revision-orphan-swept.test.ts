// Rejecting a move destination with no source keeps its content, so a formatting change in it
// stays pending and is not reported as resolved with the move.
import { expect, test } from 'bun:test';
import {
  applyTreeOp,
  planRevisionBatch,
  readOoxmlPart,
  reviewItemKey,
  revisionItemsOf,
} from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const stamp = 'w:author="Au" w:date="2026-07-07T18:18:00Z"';
const body =
  `<w:p><w:r><w:t>Before</w:t></w:r></w:p>` +
  `<w:p><w:moveToRangeStart w:id="1" w:name="m" ${stamp}/><w:moveTo w:id="2" ${stamp}>` +
  `<w:r><w:rPr><w:sz w:val="20"/><w:rPrChange w:id="3" ${stamp}><w:rPr><w:sz w:val="18"/></w:rPr></w:rPrChange></w:rPr><w:t>moved</w:t></w:r>` +
  `</w:moveTo><w:moveToRangeEnd w:id="1"/></w:p><w:p/>`;

test('rejecting a destination with no source leaves the formatting change in it pending', () => {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!read.ok) throw Error(read.reason);
  const move = revisionItemsOf(read.part).find((item) => item.revisionKind === 'moveTo')!;
  const plan = planRevisionBatch(read.part, 'reject', [reviewItemKey(move)], undefined, {
    explicit: true,
  });
  expect(plan.result.skipped).toEqual([]);
  let part = read.part;
  for (const op of plan.ops) {
    const result = applyTreeOp(part, op);
    if (!result.ok) throw Error(result.reason);
    part = result.part;
  }
  const left = revisionItemsOf(part).map(reviewItemKey);
  expect(left.length).toBeGreaterThan(0);
  for (const key of plan.swept ?? []) expect(left).not.toContain(key);
  expect(plan.result.resolved.map((entry) => entry.revisionKind)).not.toContain('format');
});
