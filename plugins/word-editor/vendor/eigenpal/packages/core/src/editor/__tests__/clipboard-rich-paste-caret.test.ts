// Where the caret lands after a rich paste (issue #1990).
//
// Word, and the plain-text lane, leave the caret at the END of the pasted content, so
// the next keystroke follows it. The rich lane once left it at the landing position, the
// START of the paste, and the next character landed before the pasted text.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { mountPaginatedSurface } from '../paginated-surface.ts';
import type { PaginatedSurface } from '../paginated-surface-contract.ts';
import { docx, mount, paragraph, putCaret } from './paginated-surface-fixtures.ts';

afterEach(() => {
  document.getSelection()?.removeAllRanges();
});

const mounted: PaginatedSurface[] = [];
afterEach(() => {
  for (const surface of mounted.splice(0)) surface.destroy();
});

function surfaceOf(body: string): PaginatedSurface {
  const { surface } = mount(body);
  mounted.push(surface);
  return surface;
}

/** Rich flavours for `[from, to)` of the first paragraph of `body`. */
function copied(body: string, from: number, to: number): { text: string; html: string | null } {
  const source = surfaceOf(body);
  const paragraphId = source.session.paragraphIds()[0]!;
  source.setSelection({
    anchor: { paragraphId, offset: from },
    head: { paragraphId, offset: to },
  });
  const flavours = source.copyFlavours();
  expect(flavours.html).toContain('data-docx-fragment="');
  return flavours;
}

/** Rich flavours for the whole of `body`, every paragraph mark covered. */
function copiedAll(body: string): { text: string; html: string | null } {
  const source = surfaceOf(body);
  putCaret(source, 0);
  source.selectAll();
  return source.copyFlavours();
}

const TWO_PARAGRAPHS = paragraph('first') + paragraph('second');

describe('the caret after a rich paste', () => {
  test('an inline fragment leaves the caret after the pasted words', () => {
    const flavours = copied(paragraph('alpha beta'), 0, 5);
    const target = surfaceOf(paragraph('helloworld'));
    putCaret(target, 5);
    target.pasteRich(flavours.text, flavours.html);
    target.type('X');
    expect(target.session.bodyText()).toBe('helloalphaXworld');
  });

  test('pasting over a selection leaves the caret after the pasted words', () => {
    const flavours = copied(paragraph('alpha beta gamma'), 6, 10);
    const target = surfaceOf(paragraph('one two three'));
    const paragraphId = target.session.paragraphIds()[0]!;
    target.setSelection({
      anchor: { paragraphId, offset: 4 },
      head: { paragraphId, offset: 7 },
    });
    target.pasteRich(flavours.text, flavours.html);
    target.type('X');
    expect(target.session.bodyText()).toBe('one betaX three');
  });

  test('a multi-paragraph fragment leaves the caret after its last line', () => {
    // A partial copy across both paragraphs: the last paragraph mark is not covered.
    const source = surfaceOf(TWO_PARAGRAPHS);
    const [firstId, secondId] = source.session.paragraphIds();
    source.setSelection({
      anchor: { paragraphId: firstId!, offset: 2 },
      head: { paragraphId: secondId!, offset: 3 },
    });
    const partial = source.copyFlavours();
    expect(partial.html).toContain('data-docx-fragment="');

    const target = surfaceOf(paragraph('helloworld'));
    putCaret(target, 5);
    target.pasteRich(partial.text, partial.html);
    target.type('X');
    expect(target.session.bodyText()).toBe('hellorst\nsecXworld');
  });

  test('a fragment whose last mark is covered leaves the caret before the host text', () => {
    const flavours = copiedAll(TWO_PARAGRAPHS);
    const target = surfaceOf(paragraph('helloworld'));
    putCaret(target, 5);
    target.pasteRich(flavours.text, flavours.html);
    target.type('X');
    expect(target.session.bodyText()).toBe('hellofirst\nsecond\nXworld');
  });

  test('external HTML leaves the caret after the pasted text', () => {
    const target = surfaceOf(paragraph('helloworld'));
    putCaret(target, 5);
    target.pasteRich('ext', '<p><b>ext</b></p>');
    target.type('X');
    expect(target.session.bodyText()).toBe('helloextXworld');
  });

  test('external HTML with two paragraphs leaves the caret after the last line', () => {
    const target = surfaceOf(paragraph('helloworld'));
    putCaret(target, 5);
    target.pasteRich('one\ntwo', '<p>one</p><p>two</p>');
    target.type('X');
    expect(target.session.bodyText()).toBe('helloone\ntwoXworld');
  });

  test('a fragment that ends in a table leaves the caret after the table', () => {
    const target = surfaceOf(paragraph('helloworld'));
    putCaret(target, 5);
    target.pasteRich('cell', '<table><tr><td>cell</td></tr></table>');
    target.type('X');
    expect(target.session.bodyText()).toBe('hello\ncell\nXworld');
  });

  test('suggesting mode leaves the caret after the proposed text', () => {
    const flavours = copied(paragraph('alpha beta'), 0, 5);
    const container = document.createElement('div');
    const result = mountPaginatedSurface(container, docx(paragraph('helloworld')), {
      scale: 1,
      author: 'Reviewer',
      editingMode: 'suggest',
    });
    if (!result.ok) throw new Error(result.reason);
    const target = result.surface;
    mounted.push(target);
    putCaret(target, 5);
    target.pasteRich(flavours.text, flavours.html);
    target.type('X');
    expect(target.session.bodyText()).toBe('helloalphaXworld');
  });

  test('undo after the paste and the next keystroke takes the keystroke back first', () => {
    const flavours = copied(paragraph('alpha beta'), 0, 5);
    const target = surfaceOf(paragraph('helloworld'));
    putCaret(target, 5);
    target.pasteRich(flavours.text, flavours.html);
    target.type('X');
    target.undo();
    expect(target.session.bodyText()).toBe('helloalphaworld');
    target.undo();
    expect(target.session.bodyText()).toBe('helloworld');
  });
});

describe('the caret after redo of a rich paste', () => {
  test('redo leaves the caret at the end of the paste again', () => {
    const inline = surfaceOf(paragraph('helloworld'));
    putCaret(inline, 5);
    inline.pasteRich('ext', '<p><b>ext</b></p>');
    inline.undo();
    inline.redo();
    inline.type('X');
    expect(inline.session.bodyText()).toBe('helloextXworld');

    const structural = surfaceOf(paragraph('helloworld'));
    putCaret(structural, 5);
    structural.pasteRich('one\ntwo', '<p>one</p><p>two</p>');
    structural.undo();
    structural.redo();
    structural.type('X');
    expect(structural.session.bodyText()).toBe('helloone\ntwoXworld');
  });
});
