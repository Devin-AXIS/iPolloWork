// Batched typing: `beforeinput` insertText QUEUES and a burst lands as ONE
// transaction — one undo step, one layout flush — when the zero-delay flush
// task runs. These tests pin the batch boundaries: what joins a batch, and
// exactly which other actions land it first.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test, afterEach } from 'bun:test';
import { mountPaginatedSurface } from '../paginated-surface.ts';
import { docx, mount, paragraph, putCaret } from './paginated-surface-fixtures.ts';

afterEach(() => {
  document.getSelection()?.removeAllRanges();
});

function keystroke(container: HTMLElement, data: string): void {
  container.querySelector('.docx-pages')!.dispatchEvent(
    new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data,
    })
  );
}

function flushTypedText(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('batched typing', () => {
  test('a keystroke burst lands as one transaction and one undo step', async () => {
    const { surface, container } = mount(paragraph('tail'));
    putCaret(surface, 0);
    const revisionBefore = surface.state().revision;

    for (const digit of '12345') keystroke(container, digit);
    await flushTypedText();

    expect(surface.session.bodyText()).toBe('12345tail');
    expect(surface.state().selection.head.offset).toBe(5);
    expect(surface.state().revision).toBe(revisionBefore + 1);
    surface.undo();
    expect(surface.session.bodyText()).toBe('tail');
  });

  test("an isolated keystroke lands on the next task with today's semantics", async () => {
    const { surface, container } = mount(paragraph('x'));
    putCaret(surface, 0);
    keystroke(container, 'a');
    await flushTypedText();
    expect(surface.session.bodyText()).toBe('ax');
  });

  test('backspace after buffered keys deletes the last typed character', async () => {
    const { surface, container } = mount(paragraph(''));
    putCaret(surface, 0);
    keystroke(container, 'a');
    keystroke(container, 'b');
    // deleteBackward commits through `commit`, whose head-flush lands 'ab' first.
    surface.deleteBackward();
    await flushTypedText();
    expect(surface.session.bodyText()).toBe('a');
  });

  test('a caret MOVE lands the buffer at the old position first', async () => {
    const { surface, container } = mount(paragraph('world'));
    const id = surface.session.paragraphIds()[0]!;
    putCaret(surface, 5);
    keystroke(container, '!');
    // Click-like move to the paragraph start: '!' belongs where it was typed.
    surface.setSelection({
      anchor: { paragraphId: id, offset: 0 },
      head: { paragraphId: id, offset: 0 },
    });
    keystroke(container, 'A');
    await flushTypedText();
    expect(surface.session.bodyText()).toBe('Aworld!');
  });

  test('a same-position selection echo does not split the batch', async () => {
    const { surface, container } = mount(paragraph('tail'));
    const id = surface.session.paragraphIds()[0]!;
    putCaret(surface, 0);
    const revisionBefore = surface.state().revision;
    keystroke(container, '1');
    // The selection mirror re-adopting the caret it painted echoes the SAME
    // position; that must not force a per-key commit.
    surface.setSelection({
      anchor: { paragraphId: id, offset: 0 },
      head: { paragraphId: id, offset: 0 },
    });
    keystroke(container, '2');
    await flushTypedText();
    expect(surface.session.bodyText()).toBe('12tail');
    expect(surface.state().revision).toBe(revisionBefore + 1);
  });

  test('undo lands the buffer first, so undo removes what was just typed', async () => {
    const { surface, container } = mount(paragraph('base'));
    putCaret(surface, 0);
    keystroke(container, 'z');
    surface.undo();
    expect(surface.session.bodyText()).toBe('base');
    await flushTypedText();
    expect(surface.session.bodyText()).toBe('base');
  });

  test('geometry reads land the buffer', () => {
    const { surface, container } = mount(paragraph('x'));
    putCaret(surface, 0);
    keystroke(container, 'q');
    surface.layout();
    expect(surface.session.bodyText()).toBe('qx');
  });

  test('destroy lands the buffer, so detach-then-save keeps the keystrokes', () => {
    const { surface, container } = mount(paragraph('kept'));
    putCaret(surface, 0);
    keystroke(container, '!');
    surface.destroy();
    expect(surface.session.bodyText()).toBe('!kept');
  });

  test('surface.type stays synchronous for commands and automation', () => {
    const { surface } = mount(paragraph('x'));
    putCaret(surface, 0);
    surface.type('now');
    expect(surface.session.bodyText()).toBe('nowx');
  });

  test('redo restores an undone burst as one step', async () => {
    const { surface, container } = mount(paragraph('tail'));
    putCaret(surface, 0);
    for (const digit of '12345') keystroke(container, digit);
    await flushTypedText();
    surface.undo();
    expect(surface.session.bodyText()).toBe('tail');
    surface.redo();
    expect(surface.session.bodyText()).toBe('12345tail');
    expect(surface.state().selection.head.offset).toBe(5);
  });

  test('a stale selection echo while the buffer is non-empty does not reorder keys', async () => {
    const { surface, container } = mount(paragraph('tail'));
    putCaret(surface, 0);
    keystroke(container, '1');
    await flushTypedText();
    keystroke(container, '2');
    // The browser's late echo of the LAST mirrored caret, arriving mid-batch.
    document.dispatchEvent(new Event('selectionchange'));
    keystroke(container, '3');
    await flushTypedText();
    expect(surface.session.bodyText()).toBe('123tail');
    expect(surface.state().selection.head.offset).toBe(3);
  });

  test('a suggest-mode burst lands as ONE tracked insertion', async () => {
    // Tracked attribution needs an author, like the suggesting-keystrokes suite.
    const container = document.createElement('div');
    document.body.append(container);
    const opened = mountPaginatedSurface(container, docx(paragraph('tail')), {
      scale: 1,
      author: 'Ada Lovelace',
    });
    if (!opened.ok) throw new Error(opened.reason);
    const surface = opened.surface;
    surface.setEditingMode('suggest');
    putCaret(surface, 0);
    for (const digit of '123') keystroke(container, digit);
    await flushTypedText();
    const inserts: string[] = [];
    const walk = (node: { kind: string; children?: readonly unknown[] }): void => {
      if (node.kind === 'revisionInsert') {
        const parts: string[] = [];
        const collect = (child: {
          kind: string;
          value?: string;
          children?: readonly unknown[];
        }) => {
          if (child.kind === 'textValue' && child.value) parts.push(child.value);
          for (const grand of child.children ?? []) collect(grand as never);
        };
        collect(node as never);
        inserts.push(parts.join(''));
      }
      for (const child of node.children ?? []) walk(child as never);
    };
    walk(surface.session.part().root as never);
    expect(inserts).toEqual(['123']);
    surface.destroy();
    container.remove();
  });

  test('compositionstart lands the buffer before the IME takes the DOM', async () => {
    const { surface, container } = mount(paragraph('tail'));
    putCaret(surface, 0);
    keystroke(container, 'a');
    container
      .querySelector('.docx-pages')!
      .dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    expect(surface.session.bodyText()).toBe('atail');
    container
      .querySelector('.docx-pages')!
      .dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }));
    await flushTypedText();
  });

  test('typing over a range replaces it through the buffer', async () => {
    const { surface, container } = mount(paragraph('abcdef'));
    const id = surface.session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId: id, offset: 1 },
      head: { paragraphId: id, offset: 5 },
    });
    keystroke(container, 'X');
    keystroke(container, 'Y');
    await flushTypedText();
    expect(surface.session.bodyText()).toBe('aXYf');
    expect(surface.state().selection.head.offset).toBe(3);
  });

  test('Enter mid-burst splits after the typed text', async () => {
    const { surface, container } = mount(paragraph(''));
    putCaret(surface, 0);
    keystroke(container, 'a');
    keystroke(container, 'b');
    surface.splitParagraph();
    await flushTypedText();
    const ids = surface.session.paragraphIds();
    expect(ids.length).toBe(2);
    // Both typed characters precede the split; the new paragraph is empty.
    expect(surface.session.bodyText().startsWith('ab')).toBe(true);
    expect(surface.state().selection.head.paragraphId).toBe(ids[1]!);
  });
});
