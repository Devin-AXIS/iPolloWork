import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer } from '../../layout/fixed-measurer.ts';
import { layoutSemanticDocument } from '../../layout/semantic-layout.ts';
import type {
  HeaderFooterStoryRecord,
  ParagraphFragmentRecord,
  SemanticLayout,
} from '../../layout/semantic-records.ts';
import { createAnchorIndex } from '../docx-editor-anchors.ts';

function fixture(): SemanticLayout {
  const parsed = readOoxmlPart(
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:body><w:p><w:r><w:t>Anchor text</w:t></w:r></w:p></w:body></w:document>',
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw Error(parsed.reason);
  const layout = layoutSemanticDocument(parsed.part, 1, {
    measurer: createFixedMeasurer(),
    producer: 'test',
  });
  const page = layout.pages[0]!;
  const original = page.fragments[0]!;
  if (original.kind !== 'paragraph') throw Error('Expected paragraph');
  const named = (id: string): ParagraphFragmentRecord => ({
    ...original,
    paragraphId: id,
    lines: original.lines.map((line) => ({
      ...line,
      range: { ...line.range, paragraphId: id },
      spans: line.spans.map((span) => ({ ...span, range: { ...span.range, paragraphId: id } })),
    })),
  });
  const header: HeaderFooterStoryRecord = {
    kind: 'header',
    variant: 'default',
    partName: '/word/header1.xml',
    box: { ...page.contentBox, y: 10 },
    fragments: [named('header')],
  };
  return {
    ...layout,
    pages: [
      {
        ...page,
        header,
        footnotes: {
          kind: 'footnotes',
          placement: 'pageBottom',
          box: page.contentBox,
          notes: [
            {
              noteKind: 'footnote',
              noteId: 1,
              scopeId: 'footnote:1',
              mark: '1',
              box: { ...page.contentBox, y: 600 },
              fragments: [named('note')],
            },
          ],
        },
      },
      { ...page, index: 1, fragments: [], header },
    ],
  };
}

test('changed furniture and notes preserve first-occurrence anchors and old layouts', () => {
  const first = fixture();
  const read = createAnchorIndex();
  const original = read(first);
  const originalEntries = [...original];
  const changed: SemanticLayout = {
    ...first,
    revision: 2,
    pages: first.pages.map((page, i) => ({
      ...page,
      header: { ...page.header!, box: { ...page.header!.box, y: 30 + i * 100 } },
      ...(page.footnotes
        ? {
            footnotes: {
              ...page.footnotes,
              notes: page.footnotes.notes.map((note) => ({
                ...note,
                box: { ...note.box, y: 620 },
              })),
            },
          }
        : {}),
    })),
  };
  const carried = read(changed);
  expect([...carried].sort()).toEqual([...createAnchorIndex()(changed)].sort());
  expect(carried.get('header')?.contentY).toBe(30);
  expect(carried.get('header')?.pageIndex).toBe(0);
  expect(carried.get('note')?.contentY).toBe(620);
  expect([...original]).toEqual(originalEntries);

  // Removing the first occurrence makes the second page authoritative.
  const removed: SemanticLayout = {
    ...changed,
    revision: 3,
    pages: changed.pages.map((page, i) => (i === 0 ? { ...page, header: undefined } : page)),
  };
  expect([...read(removed)].sort()).toEqual([...createAnchorIndex()(removed)].sort());
  expect(read(removed).get('header')?.pageIndex).toBe(1);
});
