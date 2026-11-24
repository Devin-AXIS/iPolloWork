// The engine-owned paginated surface (task 8.1).
//
// Painted pages plus semantic interaction, with no contenteditable holding the document.
//
// Editing and interaction: what a keystroke, a caret, an undo and a paste do to the document.
// The layout side of the same surface — incremental reuse, page materialization, geometry and
// measurement — is in `paginated-surface-layout.test.ts`.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test, afterEach, spyOn } from 'bun:test';
import { mountPaginatedSurface } from '../paginated-surface.ts';
import { mount, paragraph, putCaret } from './paginated-surface-fixtures.ts';

afterEach(() => {
  document.getSelection()?.removeAllRanges();
});

describe('painted pages, semantic interaction', () => {
  test('it paints pages and exposes the layout revision', () => {
    const { surface, container } = mount(paragraph('hello world'));
    expect(container.querySelectorAll('.docx-page').length).toBeGreaterThan(0);
    expect(surface.state().pageCount).toBeGreaterThan(0);
    expect(surface.layout().revision).toBe(0);
  });

  test('the painted pages are the editable surface, and the only one', () => {
    // The pages hold focus so the browser has ONE place for selection, caret, highlight,
    // keystrokes and IME. An offscreen host cannot coexist with a selection on the page:
    // focusing it destroys the page's selection, and a focused editable with no selection
    // inside it stops firing `beforeinput` at all.
    const { container } = mount(paragraph('hello'));
    const editable = [...container.querySelectorAll('[contenteditable="true"]')];
    expect(editable).toHaveLength(1);
    expect(editable[0]!.className).toBe('docx-pages');
  });

  test('the DOM is still a picture: a direct edit to it does not become the document', () => {
    // Editable for INPUT, never authoritative. This is the property the old
    // no-contenteditable assertion was protecting, and it has to survive the change.
    const { surface, container } = mount(paragraph('hello'));
    const span = container.querySelector('[data-start]')!;
    span.textContent = 'tampered';
    expect(surface.session.bodyText()).toBe('hello');
    // The next commit repaints from layout records, discarding the tampering.
    putCaret(surface, 0);
    surface.type('!');
    expect(container.querySelector('[data-start]')!.textContent).not.toBe('tampered');
    expect(surface.session.bodyText()).toBe('!hello');
  });

  test('the model selection is mirrored into the browser selection', () => {
    // The caret and the highlight are the browser's, so they follow real glyph shapes
    // instead of a hand-drawn band. That only works if model moves reach the DOM.
    const { surface, container } = mount(paragraph('hello world'));
    putCaret(surface, 0);
    surface.navigate('right');
    surface.navigate('right');
    const domSelection = container.ownerDocument.getSelection()!;
    expect(domSelection.rangeCount).toBeGreaterThan(0);
    expect(container.contains(domSelection.anchorNode!)).toBe(true);
  });

  test('clicking moves the caret to the hit position', () => {
    const { surface } = mount(paragraph('abcdef'));
    // 6pt per character at scale 1; x=18 is the boundary after three characters.
    putCaret(surface, 3);
    expect(surface.state().selection.head.offset).toBe(3);
  });

  test('typing commits through the session and repaints', () => {
    const { surface, container } = mount(paragraph('hello'));
    putCaret(surface, 0);
    surface.type('X');
    expect(surface.session.bodyText()).toBe('Xhello');
    expect(surface.state().revision).toBe(1);
    expect(container.textContent).toContain('Xhello');
  });

  test('typing replaces a selection', () => {
    const { surface } = mount(paragraph('hello'));
    putCaret(surface, 0);
    surface.navigate('right', true);
    surface.navigate('right', true);
    surface.type('Y');
    expect(surface.session.bodyText()).toBe('Yllo');
  });

  test('backspace deletes the character before the caret', () => {
    const { surface } = mount(paragraph('hello'));
    putCaret(surface, 5);
    surface.deleteBackward();
    expect(surface.session.bodyText()).toBe('hell');
  });

  test('Enter splits and the caret lands in the new paragraph', () => {
    const { surface } = mount(paragraph('hello'));
    putCaret(surface, 3);
    surface.splitParagraph();
    expect(surface.session.paragraphIds()).toHaveLength(2);
    expect(surface.session.bodyText()).toBe('hel\nlo');
    // The caret is in the tail, ready for the next keystroke.
    expect(surface.state().selection.head.paragraphId).toBe(surface.session.paragraphIds()[1]);
    expect(surface.state().selection.head.offset).toBe(0);
  });

  test('repeated Enter locates the new caret without enumerating story paragraphs', () => {
    const { surface } = mount(paragraph('hello') + paragraph('untouched'));
    putCaret(surface, 3);
    const reads = spyOn(surface.session, 'paragraphIdsIn');
    try {
      for (let index = 0; index < 3; index++) {
        surface.splitParagraph();
        expect(surface.state().selection.head.paragraphId).toBe(
          surface.session.paragraphIds()[index + 1]
        );
      }
      expect(reads).not.toHaveBeenCalled();
    } finally {
      reads.mockRestore();
      surface.destroy();
    }
  });

  test('navigation moves the caret without touching the document', () => {
    const { surface } = mount(paragraph('hello') + paragraph('world'));
    putCaret(surface, 0);
    surface.navigate('documentEnd');
    expect(surface.state().selection.head.paragraphId).toBe(surface.session.paragraphIds()[1]);
    expect(surface.state().revision).toBe(0); // navigation is not an edit
  });

  test('plain horizontal arrows collapse a range to the selected edge', () => {
    const { surface } = mount(paragraph('hello'));
    const paragraphId = surface.session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId, offset: 1 },
      head: { paragraphId, offset: 4 },
    });

    surface.navigate('right');
    expect(surface.state().selection).toEqual({
      anchor: { paragraphId, offset: 4 },
      head: { paragraphId, offset: 4 },
    });

    surface.setSelection({
      anchor: { paragraphId, offset: 4 },
      head: { paragraphId, offset: 1 },
    });
    surface.navigate('left');
    expect(surface.state().selection).toEqual({
      anchor: { paragraphId, offset: 1 },
      head: { paragraphId, offset: 1 },
    });
  });

  test('extending a selection reaches the browser selection as a real range', () => {
    const { surface, container } = mount(paragraph('hello world'));
    putCaret(surface, 0);
    surface.navigate('lineEnd', true);
    const state = surface.state().selection;
    expect(state.head.offset).toBeGreaterThan(state.anchor.offset);
    const domSelection = container.ownerDocument.getSelection()!;
    expect(domSelection.isCollapsed).toBe(false);
  });

  test('save round-trips through the tree after painted editing', () => {
    const { surface } = mount(paragraph('hello'));
    putCaret(surface, 5);
    surface.type('!');
    const bytes = surface.session.save();
    const reopened = mountPaginatedSurface(document.createElement('div'), bytes, { scale: 1 });
    if (!reopened.ok) throw new Error(reopened.reason);
    expect(reopened.surface.session.bodyText()).toBe('hello!');
  });

  test('a malformed package is a typed rejection, not a throw', () => {
    const result = mountPaginatedSurface(
      document.createElement('div'),
      new Uint8Array([1, 2, 3]),
      {}
    );
    expect(result.ok).toBe(false);
  });

  test('unknown content is preserved through painted editing', () => {
    const { surface } = mount(
      '<w:p><w:r><w:t>a</w:t></w:r><w:r><w:drawing><x/></w:drawing></w:r>' +
        '<w:r><w:t>b</w:t></w:r></w:p>'
    );
    putCaret(surface, 0);
    surface.type('Z');
    const reopened = mountPaginatedSurface(
      document.createElement('div'),
      surface.session.save(),
      {}
    );
    if (!reopened.ok) throw new Error(reopened.reason);
    expect(reopened.surface.session.bodyText()).toBe('Zab');
  });
});

describe("relayout is driven by the store's own account of a commit (task 9.1)", () => {
  test('the painted layout always carries the revision the session is at', () => {
    const { surface } = mount(`<w:p><w:r><w:t>hello</w:t></w:r></w:p>`);
    putCaret(surface, 0);
    surface.type('a');
    expect(surface.layout().revision).toBe(surface.session.revision());
    surface.type('b');
    expect(surface.layout().revision).toBe(surface.session.revision());
  });

  test('reading the layout without an intervening commit does not lay out again', () => {
    // Identity, not equality: nothing committed, so the records in hand are already current
    // and recomputing them would be pure waste on every caret move and repaint.
    const { surface } = mount(`<w:p><w:r><w:t>hello</w:t></w:r></w:p>`);
    const first = surface.layout();
    expect(surface.layout()).toBe(first);
    surface.navigate('right');
    expect(surface.layout()).toBe(first);
  });

  test('a commit replaces the layout, and undo replaces it back', () => {
    const { surface } = mount(`<w:p><w:r><w:t>hello</w:t></w:r></w:p>`);
    putCaret(surface, 0);
    const before = surface.layout();
    surface.type('a');
    const after = surface.layout();
    expect(after).not.toBe(before);
    expect(after.revision).toBeGreaterThan(before.revision);
    // Undo is a commit like any other, so it reaches layout by the same route.
    surface.session.undo();
    expect(surface.layout()).not.toBe(after);
    expect(surface.session.bodyText()).toBe('hello');
  });

  test('a structural edit relays out and the new paragraph is painted', () => {
    const { surface, container } = mount(`<w:p><w:r><w:t>hello</w:t></w:r></w:p>`);
    putCaret(surface, 0);
    surface.navigate('lineEnd');
    surface.splitParagraph();
    expect(surface.session.paragraphIds().length).toBe(2);
    // Painted, not merely modeled: a split that never reached layout would leave one
    // fragment on screen while the model held two.
    expect(container.querySelectorAll('.docx-paragraph-fragment').length).toBe(2);
  });
});

describe('undo restores the caret the edit was made at (task 9.1 follow-through)', () => {
  test('undoing a typed character puts the caret back where it was typed', () => {
    const { surface } = mount(`<w:p><w:r><w:t>hello world</w:t></w:r></w:p>`);
    putCaret(surface, 0);
    surface.navigate('right');
    surface.navigate('right');
    surface.navigate('right');
    expect(surface.state().selection.head.offset).toBe(3);
    surface.type('X');
    expect(surface.state().selection.head.offset).toBe(4);

    surface.undo();
    expect(surface.session.bodyText()).toBe('hello world');
    // Not offset 4, which is past where the character now is, and not 0: the caret returns
    // to where the user was typing.
    expect(surface.state().selection.head.offset).toBe(3);
  });

  test('undoing a split puts the caret back at the split point', () => {
    const { surface } = mount(`<w:p><w:r><w:t>hello world</w:t></w:r></w:p>`);
    putCaret(surface, 0);
    for (let step = 0; step < 5; step += 1) surface.navigate('right');
    surface.splitParagraph();
    expect(surface.session.paragraphIds().length).toBe(2);

    surface.undo();
    expect(surface.session.paragraphIds().length).toBe(1);
    const head = surface.state().selection.head;
    expect(head.paragraphId).toBe(surface.session.paragraphIds()[0]!);
    expect(head.offset).toBe(5);
  });

  test('undo with an empty history leaves the caret alone', () => {
    const { surface } = mount(`<w:p><w:r><w:t>hello</w:t></w:r></w:p>`);
    putCaret(surface, 0);
    surface.navigate('right');
    surface.undo();
    expect(surface.state().selection.head.offset).toBe(1);
  });
});

describe('the keymap covers what an editor is expected to do', () => {
  const twoParagraphs = `${paragraph('hello world')}${paragraph('second line')}`;

  test('Backspace at the start of a paragraph joins it to the previous one', () => {
    // Refusing here made the key look broken: a caret at the paragraph start is exactly
    // where a user presses Backspace to merge.
    const { surface } = mount(twoParagraphs);
    const [first, second] = surface.session.paragraphIds();
    putCaret(surface, 0);
    surface.navigate('documentEnd');
    surface.navigate('lineStart');
    expect(surface.state().selection.head.paragraphId).toBe(second!);
    surface.deleteBackward();
    expect(surface.session.paragraphIds()).toEqual([first!]);
    expect(surface.session.bodyText()).toBe('hello worldsecond line');
    // The caret lands at the seam, not at the start of the merged paragraph.
    expect(surface.state().selection.head.offset).toBe('hello world'.length);
  });

  test('Delete at the end of a paragraph pulls the next one up', () => {
    const { surface } = mount(twoParagraphs);
    putCaret(surface, 0);
    surface.navigate('lineEnd');
    surface.deleteForward();
    expect(surface.session.bodyText()).toBe('hello worldsecond line');
  });

  test('Delete inside a paragraph removes the character after the caret', () => {
    const { surface } = mount(paragraph('hello'));
    putCaret(surface, 0);
    surface.deleteForward();
    expect(surface.session.bodyText()).toBe('ello');
  });

  test('select all covers the whole document, and typing replaces it', () => {
    const { surface } = mount(twoParagraphs);
    surface.selectAll();
    expect(surface.selectedText()).toBe('hello world\nsecond line');
    surface.type('fresh');
    expect(surface.session.bodyText()).toBe('fresh');
    expect(surface.session.paragraphIds().length).toBe(1);
  });

  test('deleting a selection that spans paragraphs joins what is left', () => {
    const { surface } = mount(`${paragraph('one two')}${paragraph('three four')}`);
    const [first, second] = surface.session.paragraphIds();
    surface.setSelection({
      anchor: { paragraphId: first!, offset: 4 },
      head: { paragraphId: second!, offset: 6 },
    });
    expect(surface.deleteSelection()).toBe(true);
    expect(surface.session.bodyText()).toBe('one four');
    expect(surface.session.paragraphIds().length).toBe(1);
  });

  test('word-wise motion walks words rather than characters', () => {
    const { surface } = mount(paragraph('alpha beta gamma'));
    putCaret(surface, 0);
    surface.navigate('wordRight');
    expect(surface.state().selection.head.offset).toBe(5);
    surface.navigate('wordRight');
    expect(surface.state().selection.head.offset).toBe(10);
    surface.navigate('wordLeft');
    expect(surface.state().selection.head.offset).toBe(6);
  });

  test('a tab is a w:tab element, not a literal tab character in the run', () => {
    const { surface } = mount(paragraph('ab'));
    putCaret(surface, 0);
    surface.insertTab();
    expect(surface.session.bodyText()).toBe('\tab');
    const xml = JSON.stringify(surface.session.part());
    expect(xml).toContain('"tab"');
  });

  test('a line break stays inside the paragraph', () => {
    const { surface } = mount(paragraph('ab'));
    putCaret(surface, 0);
    surface.insertLineBreak();
    expect(surface.session.paragraphIds().length).toBe(1);
    expect(surface.session.bodyText()).toContain('\n');
  });

  test('toggling bold twice writes an explicit off rather than dropping the property', () => {
    // The property may be inherited from a style, so removing the local override would let
    // the inherited value come back instead of turning bold off.
    const { surface } = mount(paragraph('hello'));
    const id = surface.session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId: id, offset: 0 },
      head: { paragraphId: id, offset: 5 },
    });
    surface.toggleRunProperty('b');
    expect(JSON.stringify(surface.session.part())).toContain('"b"');
    surface.toggleRunProperty('b');
    expect(JSON.stringify(surface.session.part())).toContain('"0"');
  });

  test('a collapsed caret is not formatted, because there is no range to format', () => {
    const { surface } = mount(paragraph('hello'));
    putCaret(surface, 0);
    const before = surface.session.revision();
    surface.toggleRunProperty('b');
    expect(surface.session.revision()).toBe(before);
  });

  test('selected text across paragraphs is newline separated', () => {
    const { surface } = mount(`${paragraph('one')}${paragraph('two')}${paragraph('three')}`);
    const ids = surface.session.paragraphIds();
    surface.setSelection({
      anchor: { paragraphId: ids[0]!, offset: 1 },
      head: { paragraphId: ids[2]!, offset: 2 },
    });
    expect(surface.selectedText()).toBe('ne\ntwo\nth');
  });
});

describe('undo never strands the caret (review regressions)', () => {
  test('select all, type, undo leaves the editor still editable', () => {
    // A cross-paragraph edit records no selection mark, because a mark addresses ONE
    // paragraph. Leaving the caret alone left it past the end of the restored paragraph and
    // every later keystroke was refused — Ctrl+A, type, Ctrl+Z froze the editor.
    const { surface } = mount(`${paragraph('hi')}${paragraph('second line')}`);
    surface.selectAll();
    surface.type('fresh');
    surface.undo();

    const head = surface.state().selection.head;
    expect(surface.session.paragraphIds()).toContain(head.paragraphId);
    surface.type('X');
    expect(surface.session.bodyText()).toContain('X');
    expect(surface.state().lastRejection).toBeNull();
  });

  test('undoing a split does not leave the caret on the removed paragraph', () => {
    const { surface } = mount(`${paragraph('hello world')}${paragraph('next')}`);
    const [first, second] = surface.session.paragraphIds();
    surface.setSelection({
      anchor: { paragraphId: first!, offset: 2 },
      head: { paragraphId: second!, offset: 3 },
    });
    surface.splitParagraph();
    surface.undo();

    const head = surface.state().selection.head;
    expect(surface.session.paragraphIds()).toContain(head.paragraphId);
    surface.type('Y');
    expect(surface.state().lastRejection).toBeNull();
  });

  test('Enter over a selection replaces it and splits at its start', () => {
    const { surface } = mount(paragraph('hello world'));
    const id = surface.session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId: id, offset: 0 },
      head: { paragraphId: id, offset: 5 },
    });
    surface.splitParagraph();
    // Word replaces the selection; leaving it in place and cutting at the head put the
    // selected text on the wrong side of the break.
    expect(surface.session.bodyText()).toBe('\n world');
  });
});

describe('paste is one commit, whatever the clipboard holds', () => {
  function paste(container: HTMLElement, text: string): void {
    const layer = container.querySelector('.docx-pages') as HTMLElement;
    const data = new DataTransfer();
    data.setData('text/plain', text);
    layer.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
    );
  }

  test('a multi-line paste bumps the revision exactly once', () => {
    // Committing per line laid out and repainted a growing document once per pasted
    // paragraph — quadratic, and the reason paste lagged long before typing did. One
    // revision for the whole paste is the observable form of "one commit, one layout".
    const { surface, container } = mount(paragraph('hello'));
    putCaret(surface, 5);
    paste(container, 'one\ntwo\nthree\nfour');
    expect(surface.state().revision).toBe(1);
    expect(surface.session.bodyText()).toBe('helloone\ntwo\nthree\nfour');
  });

  test('one undo reverses the whole paste', () => {
    // The flip side of one commit: undo after paste must not peel off one line at a time.
    const { surface, container } = mount(paragraph('hello'));
    putCaret(surface, 5);
    paste(container, 'one\ntwo\nthree');
    surface.undo();
    expect(surface.session.bodyText()).toBe('hello');
  });

  test('pasting into the middle keeps the suffix attached to the last line', () => {
    const { surface, container } = mount(paragraph('headtail'));
    putCaret(surface, 4);
    paste(container, 'A\nB');
    expect(surface.session.bodyText()).toBe('headA\nBtail');
  });

  test('the caret lands at the end of the pasted text', () => {
    const { surface, container } = mount(paragraph('headtail'));
    putCaret(surface, 4);
    paste(container, 'A\nBB');
    const head = surface.state().selection.head;
    // In the paragraph holding 'BBtail', right after the pasted 'BB'.
    expect(head.offset).toBe(2);
    expect(surface.session.paragraphIds().indexOf(head.paragraphId)).toBe(1);
  });

  test('a paste replaces the selection', () => {
    const { surface, container } = mount(paragraph('hello world'));
    const paragraphId = surface.session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 5 },
    });
    paste(container, 'goodbye');
    expect(surface.session.bodyText()).toBe('goodbye world');
    expect(surface.state().revision).toBe(1);
  });

  test('a trailing newline splits, leaving the suffix in its own paragraph', () => {
    const { surface, container } = mount(paragraph('headtail'));
    putCaret(surface, 4);
    paste(container, 'A\n');
    expect(surface.session.bodyText()).toBe('headA\ntail');
    // Caret at the START of the suffix paragraph: the last pasted line is empty.
    expect(surface.state().selection.head.offset).toBe(0);
  });

  test('CRLF and lone CR both mean a paragraph break, never a control character', () => {
    const { surface, container } = mount(paragraph(''));
    putCaret(surface, 0);
    paste(container, 'a\r\nb\rc');
    expect(surface.session.bodyText()).toBe('a\nb\nc');
  });

  test('Select All + Delete clears a document that contains a table', () => {
    // The join chain used to run across every selected paragraph; a join across a table is
    // rightly refused by the store, and that one refusal vetoed the whole atomic delete —
    // clearing a document with a table in it deleted nothing. Joins now stay within runs
    // of consecutive sibling paragraphs; the table itself is not this lane's to remove.
    const body =
      paragraph('before table') +
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
      paragraph('after table') +
      paragraph('last line');
    const { surface } = mount(body);
    surface.selectAll();
    surface.deleteSelection();
    expect(surface.state().lastRejection).toBeNull();
    expect(surface.state().revision).toBe(1);
    // Every selected paragraph's text is gone; the run after the table joined into one.
    expect(surface.session.bodyText()).not.toContain('before table');
    expect(surface.session.bodyText()).not.toContain('after table');
    expect(surface.session.bodyText()).not.toContain('last line');
  });

  test('blank lines paste as empty paragraphs, not a refusal', () => {
    // A blank line is two consecutive paragraph marks — a repeated split offset. Requiring
    // strictly ascending offsets refused the whole paste of any text containing "\n\n",
    // which is most text anyone copies from anywhere.
    const { surface, container } = mount(paragraph('seed'));
    putCaret(surface, 4);
    paste(container, 'one\n\ntwo\n\n\nthree');
    expect(surface.state().lastRejection).toBeNull();
    expect(surface.session.bodyText()).toBe('seedone\n\ntwo\n\n\nthree');
    expect(surface.state().revision).toBe(1);
  });
});

describe('redo restores the caret it left, not the one undo restored', () => {
  test('undo then redo leaves the editor editable', () => {
    // `selectionAfter` was never recorded by any caller, so redo restored nothing and left
    // the caret addressing the tree undo had discarded — offsets past the end of a paragraph
    // it had just re-shortened, after which every keystroke was refused.
    const { surface } = mount(paragraph('hello world'));
    const id = surface.session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId: id, offset: 0 },
      head: { paragraphId: id, offset: 11 },
    });
    surface.type('Z');
    expect(surface.session.bodyText()).toBe('Z');

    surface.undo();
    expect(surface.session.bodyText()).toBe('hello world');
    surface.redo();
    expect(surface.session.bodyText()).toBe('Z');

    // The caret must be inside the redone document, not at offset 11 of a 1-character one.
    const head = surface.state().selection.head;
    expect(head.offset).toBeLessThanOrEqual(surface.session.bodyText().length);
    surface.type('!');
    expect(surface.state().lastRejection).toBeNull();
    expect(surface.session.bodyText()).toContain('!');
  });
});

describe('a hard break occupies a model offset in layout too', () => {
  const withBreak = '<w:p><w:r><w:t>ab</w:t><w:br/><w:t>cd</w:t></w:r></w:p>';

  test('select all covers the break, so typing over it leaves no residue', () => {
    // Layout emitted no span for a break, so the text rebuilt from the records was shorter
    // than the model and Select All stopped short of the end.
    const { surface } = mount(withBreak);
    surface.selectAll();
    surface.type('Q');
    expect(surface.session.bodyText()).toBe('Q');
  });

  test('copied text keeps the break instead of turning it into a space', () => {
    const { surface } = mount(withBreak);
    surface.selectAll();
    expect(surface.selectedText()).toContain('\n');
  });

  test('a trailing break still paints, rather than costing a line', () => {
    const { surface } = mount('<w:p><w:r><w:t>ab</w:t><w:br/></w:r></w:p>');
    expect(surface.session.bodyText()).toBe('ab\n');
  });

  test('a commit made outside this surface still reaches the screen', async () => {
    // The shape an undo from another editor sharing the store takes, or a host writing
    // straight to the session: nothing calls the surface's own `commit`, so the only route
    // to the pages is the scheduler publishing on its own. Without a `schedule` there was
    // no such route — the model moved and the painted pages kept the old revision for good.
    const { surface, container } = mount(paragraph('ORIGINAL'));
    const paragraphId = surface.session.paragraphIds()[0]!;
    surface.session.applyTreeOps([{ op: 'insertText', paragraphId, offset: 0, text: 'EXT-' }]);
    expect(surface.session.bodyText()).toContain('EXT-ORIGINAL');

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.textContent).toContain('EXT-ORIGINAL');
    surface.destroy();
  });
});
