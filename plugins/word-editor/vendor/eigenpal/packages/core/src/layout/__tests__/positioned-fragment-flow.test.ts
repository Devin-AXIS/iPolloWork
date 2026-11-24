import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { ParagraphFragmentRecord } from '../semantic-records.ts';
import { summarizeFlushedPage } from '../field-page-furniture.ts';
import { hitTestFragments } from '../semantic-hit-test.ts';
import { hasFlowFragments } from '../table-float-position.ts';
import {
  bodyFitBottomPt,
  firstBodyContentTopPt,
  fragmentFlowBottom,
  noteReferenceLineBandPt,
  shiftParagraphFragment,
} from '../note-fragment-geometry.ts';

function fixture() {
  const parsed = readOoxmlPart(
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Frame</w:t></w:r></w:p><w:p><w:r><w:t>Body</w:t></w:r></w:p></w:body></w:document>',
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!parsed.ok) throw Error(parsed.reason);
  const layout = layoutSemanticDocument(parsed.part, 0, { measurer: createFixedMeasurer(6, 14) });
  const page = layout.pages[0]!;
  const frame: ParagraphFragmentRecord = {
    ...shiftParagraphFragment(page.fragments[0] as ParagraphFragmentRecord, 500),
    outOfFlow: true,
  };
  const body = page.fragments[1] as ParagraphFragmentRecord;
  return { layout, page: { ...page, fragments: [frame, body] }, frame, body };
}

test('positioned paragraph ink does not consume note, column, or ordinary story flow', () => {
  const { page, frame, body } = fixture();
  const bottom = body.box.y + body.box.height;
  expect(fragmentFlowBottom(page.fragments)).toBe(bottom);
  expect(bodyFitBottomPt(page)).toBe(bottom - body.spacing.after);
  expect(firstBodyContentTopPt(page)).toBe(body.lines[0]!.box.y);
  expect(summarizeFlushedPage(page.fragments, 0).usedBottom).toBe(bottom);
  expect(hasFlowFragments([frame], 0)).toBe(false);
  expect(hasFlowFragments(page.fragments, 0)).toBe(true);
  expect(fragmentFlowBottom([frame])).toBe(0);
});

test('note reserve cannot evict an absolutely positioned reference by shrinking body flow', () => {
  const { page, frame } = fixture();
  const band = noteReferenceLineBandPt(page, { paragraphId: frame.paragraphId, atomOffset: 0 });
  expect(band.bottom).toBeGreaterThan(500);
  expect(band.evictable).toBe(false);
});

test('overlapping positioned paragraphs follow paint order without forcing frames above anchor text', () => {
  const { layout, frame, body } = fixture();
  const overlaid = shiftParagraphFragment(body, frame.box.y - body.box.y);
  const laterFrame: ParagraphFragmentRecord = { ...overlaid, outOfFlow: true };
  const point = { x: frame.box.x + 2, y: frame.box.y + 2 };
  expect(hitTestFragments(layout, 0, [frame, laterFrame], point)?.position.paragraphId).toBe(
    body.paragraphId
  );
  expect(hitTestFragments(layout, 0, [laterFrame, frame], point)?.position.paragraphId).toBe(
    frame.paragraphId
  );
  expect(hitTestFragments(layout, 0, [frame, overlaid], point)?.position.paragraphId).toBe(
    body.paragraphId
  );
});
