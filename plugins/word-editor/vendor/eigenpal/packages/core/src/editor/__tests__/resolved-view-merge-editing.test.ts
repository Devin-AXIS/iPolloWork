// Editing a document whose paragraphs a resolved view has merged.
//
// `proposed` is not a preview: it is what the free engine renders by default, and that surface
// is fully editable. So the merged half has to keep addressing its own paragraph — an edit
// there must land where the DOCUMENT holds those characters, not where the page draws them.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { mountPaginatedSurface } from '../paginated-surface.ts';
import { paragraphTextOf } from '../../store/store/tree-op-apply.ts';
import { docx } from './paginated-surface-fixtures.ts';

const DELETED_MARK =
  '<w:p><w:pPr><w:rPr><w:del w:id="1" w:author="A"/></w:rPr></w:pPr>' +
  '<w:r><w:t xml:space="preserve">Hello </w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>world</w:t></w:r></w:p>';

function mountMerged() {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, docx(DELETED_MARK), {
    revisionDisplayMode: 'proposed',
  });
  if (!opened.ok) throw new Error(opened.reason);
  return {
    surface: opened.surface,
    dispose: () => {
      opened.surface.destroy();
      container.remove();
    },
  };
}

describe('editing across a merged paragraph break', () => {
  test('the two paragraphs are drawn as one and remain two', () => {
    const { surface, dispose } = mountMerged();
    try {
      // One line on the page, two paragraphs in the document. Both halves of that sentence
      // matter: the first is the merge, the second is what makes it safe.
      const lines = surface
        .layout()
        .pages.flatMap((page) =>
          page.fragments.flatMap((fragment) =>
            fragment.kind === 'paragraph' ? fragment.lines : []
          )
        );
      expect(lines).toHaveLength(1);
      expect(lines[0]!.spans.map((span) => span.text).join('')).toBe('Hello world');
      expect(surface.session.paragraphIds()).toHaveLength(2);
    } finally {
      dispose();
    }
  });

  test('typing at the join lands in the paragraph that holds the caret', () => {
    const { surface, dispose } = mountMerged();
    try {
      const [first, second] = surface.session.paragraphIds();
      surface.setSelection({
        anchor: { paragraphId: first!, offset: 6 },
        head: { paragraphId: first!, offset: 6 },
      });
      surface.type('!');
      expect(paragraphTextOf(surface.session.part(), first!)).toBe('Hello !');
      expect(paragraphTextOf(surface.session.part(), second!)).toBe('world');
    } finally {
      dispose();
    }
  });

  test('typing at the start of the second half stays in the second paragraph', () => {
    const { surface, dispose } = mountMerged();
    try {
      const [first, second] = surface.session.paragraphIds();
      surface.setSelection({
        anchor: { paragraphId: second!, offset: 0 },
        head: { paragraphId: second!, offset: 0 },
      });
      surface.type('W');
      expect(paragraphTextOf(surface.session.part(), first!)).toBe('Hello ');
      expect(paragraphTextOf(surface.session.part(), second!)).toBe('Wworld');
    } finally {
      dispose();
    }
  });

  test('Backspace at the join deletes a character, not the paragraph break', () => {
    // The break between two merged members is not one the reader can see, so it is not one
    // they can delete. Joining here also carried the first paragraph's `w:del` onto a mark
    // nobody edited — and the last mark of a body, which Word cannot write.
    const { surface, dispose } = mountMerged();
    try {
      const [first, second] = surface.session.paragraphIds();
      surface.setSelection({
        anchor: { paragraphId: second!, offset: 0 },
        head: { paragraphId: second!, offset: 0 },
      });
      surface.deleteBackward();
      expect(paragraphTextOf(surface.session.part(), first!)).toBe('Hello');
      expect(paragraphTextOf(surface.session.part(), second!)).toBe('world');
      expect(surface.session.paragraphIds()).toHaveLength(2);
    } finally {
      dispose();
    }
  });

  test('Backspace at the START of the group still joins with what precedes it', () => {
    // The group's own first break IS visible, so it behaves as it always did.
    const container = document.createElement('div');
    document.body.append(container);
    const opened = mountPaginatedSurface(
      container,
      docx('<w:p><w:r><w:t>before</w:t></w:r></w:p>' + DELETED_MARK),
      { revisionDisplayMode: 'proposed' }
    );
    if (!opened.ok) throw new Error(opened.reason);
    try {
      const ids = opened.surface.session.paragraphIds();
      opened.surface.setSelection({
        anchor: { paragraphId: ids[1]!, offset: 0 },
        head: { paragraphId: ids[1]!, offset: 0 },
      });
      opened.surface.deleteBackward();
      expect(opened.surface.session.paragraphIds()).toHaveLength(2);
      expect(paragraphTextOf(opened.surface.session.part(), ids[0]!)).toBe('beforeHello ');
    } finally {
      opened.surface.destroy();
      container.remove();
    }
  });

  test('copying across the join copies one line, not two paragraphs', () => {
    // The reader sees one line. A newline in the clipboard pasted two paragraphs out of it.
    const { surface, dispose } = mountMerged();
    try {
      const [first, second] = surface.session.paragraphIds();
      surface.setSelection({
        anchor: { paragraphId: first!, offset: 0 },
        head: { paragraphId: second!, offset: 5 },
      });
      expect(surface.selectedText()).toBe('Hello world');
    } finally {
      dispose();
    }
  });

  test('Home and End reach the ends of the line a reader sees', () => {
    // One paragraph's stops describe the line only while the line holds one paragraph. On a
    // merged line they stopped at the member boundary, in the middle of the visible text.
    const { surface, dispose } = mountMerged();
    try {
      const [first, second] = surface.session.paragraphIds();
      surface.setSelection({
        anchor: { paragraphId: second!, offset: 2 },
        head: { paragraphId: second!, offset: 2 },
      });
      surface.navigate('lineStart');
      expect(surface.state().selection.head).toEqual({ paragraphId: first!, offset: 0 });
      surface.navigate('lineEnd');
      expect(surface.state().selection.head).toEqual({ paragraphId: second!, offset: 5 });
    } finally {
      dispose();
    }
  });

  test('Delete at the end of the first half takes a character, not the paragraph', () => {
    // The mirror of Backspace at the join. Joining here resolved a tracked decision the
    // keypress never named — and because the survivor then still carried the mark, the
    // paragraph AFTER it merged in as well.
    const { surface, dispose } = mountMerged();
    try {
      const [first, second] = surface.session.paragraphIds();
      surface.setSelection({
        anchor: { paragraphId: first!, offset: 6 },
        head: { paragraphId: first!, offset: 6 },
      });
      surface.deleteForward();
      expect(paragraphTextOf(surface.session.part(), first!)).toBe('Hello ');
      expect(paragraphTextOf(surface.session.part(), second!)).toBe('orld');
      expect(surface.session.paragraphIds()).toHaveLength(2);
    } finally {
      dispose();
    }
  });
});
