// An inline content control is a run CONTAINER, so its text is the paragraph's text.
//
// While `w:sdt` was opaque, the characters inside an inline control existed in the file, were
// painted by nothing, and occupied no model offsets — the same class of defect `w:hyperlink`
// had: a paragraph whose text a caller reads is shorter than the one on screen, so every
// offset after the control addresses different characters than the reader is looking at.

import { describe, expect, test } from 'bun:test';
import {
  MAX_CONTENT_CONTROL_NESTING,
  paragraphTextOf,
  readOoxmlPart,
  storyParagraphs,
  type OoxmlNode,
  type OoxmlParagraphNode,
  type OoxmlPart,
} from '../index.ts';
import { paragraphLength, segmentsOf } from '../store/tree-op-segments.ts';
import { TreeDocumentStore } from '../store/tree-store.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const docMeta = {
  name: '/word/document.xml',
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
};

function parseDoc(bodyInner: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${bodyInner}</w:body></w:document>`,
    docMeta
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function firstParagraph(part: OoxmlPart): OoxmlParagraphNode {
  const body = part.root.children.find((child: OoxmlNode) => child.kind === 'body');
  if (!body || body.kind !== 'body') throw new Error('missing body');
  const found = storyParagraphs(body)[0];
  if (!found || found.kind !== 'paragraph') throw new Error('missing paragraph');
  return found;
}

const INLINE_CONTROL =
  `<w:p><w:r><w:t>A</w:t></w:r>` +
  `<w:sdt><w:sdtPr><w:tag w:val="inline"/></w:sdtPr>` +
  `<w:sdtContent><w:r><w:t>BC</w:t></w:r></w:sdtContent></w:sdt>` +
  `<w:r><w:t>Z</w:t></w:r></w:p>`;

describe('an inline control contributes its characters to the paragraph', () => {
  test('paragraph text reads through the control', () => {
    const part = parseDoc(INLINE_CONTROL);
    const paragraph = firstParagraph(part);
    expect(paragraphTextOf(part, paragraph.id)).toBe('ABCZ');
    expect(paragraphLength(paragraph)).toBe(4);
  });

  test('the control text is segmented in document order', () => {
    const paragraph = firstParagraph(parseDoc(INLINE_CONTROL));
    expect(segmentsOf(paragraph).map((segment) => [segment.start, segment.end] as const)).toEqual([
      [0, 1],
      [1, 3],
      [3, 4],
    ]);
  });

  test('an insertion inside the control lands in the control, not beside it', () => {
    const part = parseDoc(INLINE_CONTROL);
    const store = new TreeDocumentStore(part);
    const paragraph = firstParagraph(part);
    const applied = store.transact(({ apply }) =>
      apply({ op: 'insertText', paragraphId: paragraph.id, offset: 2, text: 'x' })
    );
    expect(applied.ok).toBe(true);
    const after = firstParagraph(store.part);
    expect(paragraphTextOf(store.part, after.id)).toBe('ABxCZ');
    // The character went INSIDE the control's own content, not into the paragraph beside it.
    const control = after.children.find((child) => child.kind === 'contentControl');
    expect(control).toBeDefined();
    const text = JSON.stringify(control);
    expect(text.includes('Bx') || text.includes('"x"')).toBe(true);
  });

  test('a nested inline control is addressed too', () => {
    const part = parseDoc(
      `<w:p><w:sdt><w:sdtContent>` +
        `<w:sdt><w:sdtContent><w:r><w:t>deep</w:t></w:r></w:sdtContent></w:sdt>` +
        `</w:sdtContent></w:sdt></w:p>`
    );
    expect(paragraphTextOf(part, firstParagraph(part).id)).toBe('deep');
  });

  test('nesting past the bound stops the walk without losing the content', () => {
    const depth = MAX_CONTENT_CONTROL_NESTING + 4;
    const open = '<w:sdt><w:sdtContent>'.repeat(depth);
    const close = '</w:sdtContent></w:sdt>'.repeat(depth);
    const part = parseDoc(`<w:p>${open}<w:r><w:t>buried</w:t></w:r>${close}</w:p>`);
    const paragraph = firstParagraph(part);
    // Bounded: the reader stops descending rather than recursing as deep as a file asks.
    expect(paragraphTextOf(part, paragraph.id)).toBe('');
    // Preserved: the text is still in the tree, and a save writes it back.
    expect(JSON.stringify(paragraph).includes('buried')).toBe(true);
  });
});
