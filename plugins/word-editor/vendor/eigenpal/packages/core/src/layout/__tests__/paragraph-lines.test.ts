import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { paragraphLinesFor, paragraphLinesIndex } from '../paragraph-lines.ts';
import { documentOrder } from '../document-order.ts';

function layout(text: string) {
  const read = readOoxmlPart(
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p><w:tbl><w:tblGrid><w:gridCol w:w="1440"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw Error(read.reason);
  return layoutSemanticDocument(read.part, 1, {
    measurer: createFixedMeasurer(6, 14),
    geometry: { width: 100, height: 100, margin: { top: 10, bottom: 10, left: 10, right: 10 } },
  });
}

test('single-paragraph reads retain all page fragments and match the complete index', () => {
  const document = layout('Several words '.repeat(80));
  expect(document.pages.length).toBeGreaterThan(1);
  const ids = documentOrder(document);
  const requested = ids.map((id) => paragraphLinesFor(document, id));
  for (let i = 0; i < ids.length; i++) {
    expect(paragraphLinesFor(document, ids[i]!)).toBe(requested[i]!);
  }
  const complete = paragraphLinesIndex(document);
  for (let i = 0; i < ids.length; i++) expect(requested[i]).toEqual(complete.get(ids[i]!));
  expect(paragraphLinesFor(document, 'absent')).toEqual([]);
});

test('single-paragraph reads do not retain lines from another layout', () => {
  const before = layout('Short');
  const id = documentOrder(before)[0]!;
  const oldLines = paragraphLinesFor(before, id);
  const after = layout('Long text '.repeat(50));
  const newLines = paragraphLinesFor(after, id);
  expect(newLines.length).toBeGreaterThan(oldLines.length);
  expect(paragraphLinesFor(before, id)).toBe(oldLines);
  expect(newLines).toEqual(paragraphLinesIndex(after).get(id));
});
