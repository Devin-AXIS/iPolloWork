import { expect, test } from 'bun:test';
import { ParagraphFrameFlow } from '../paragraph-frame-flow.ts';
import { readParagraphFrame } from '../paragraph-frame.ts';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { ParagraphFragmentRecord } from '../semantic-records.ts';

function fragment() {
  const parsed = readOoxmlPart(
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:ind w:left="200" w:right="200"/></w:pPr><w:r><w:t>Text</w:t></w:r></w:p></w:body></w:document>',
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  return layoutSemanticDocument(parsed.part, 0, { measurer: createFixedMeasurer() }).pages[0]!
    .fragments[0] as ParagraphFragmentRecord;
}
const frame = readParagraphFrame([
  { localName: 'framePr', attributes: { x: '400', y: '600', w: '2000' } },
])!;
const origins = { page: { x: 0, y: 0 }, margin: { x: 0, y: 0 }, text: { x: 0, y: 0 } };

test('thousands of pending frame checkpoints share prefixes without copying every earlier frame', () => {
  const flow = new ParagraphFrameFlow();
  const paragraph = fragment();
  const checkpoints = [];
  for (let index = 0; index < 2000; index++) {
    flow.add(frame, paragraph, `group-${index}`, index);
    const snapshot = flow.checkpoint()!;
    expect(snapshot.previous).toBe(checkpoints.at(-1));
    checkpoints.push(snapshot);
  }
  const original = flow.checkpoint();
  flow.restore(checkpoints[999]);
  const published = flow.publish(origins, 'anchor', 0);
  expect(published).toHaveLength(1000);
  expect(published[0]!.positionedFrame!.sourceOrder).toBe(0);
  expect(published[999]!.positionedFrame!.sourceOrder).toBe(999);
  expect(flow.checkpoint()).toBeUndefined();
  flow.restore(original);
  expect(flow.same(original)).toBe(true);
  expect(flow.publish(origins, 'anchor', 0)).toHaveLength(2000);
});

test('frame wrap width includes paragraph indent space', () => {
  const flow = new ParagraphFrameFlow();
  const paragraph = fragment();
  flow.add(frame, paragraph);
  const placed = flow.publish(origins, 'anchor', 0)[0]!;
  expect(placed.positionedFrame!.box).toMatchObject({ x: 20, width: 100 });
  expect(placed.box.x).toBe(30);
});
