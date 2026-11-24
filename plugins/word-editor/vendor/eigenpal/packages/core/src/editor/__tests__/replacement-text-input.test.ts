// Smart substitutions (`insertReplacementText`): macOS double-space period, autocorrect,
// dictation. The browser replaces text it targeted itself, so two things must hold:
//
// 1. The substitution REPLACES the targeted characters in the model — matched by their
//    TEXT against the characters before the caret, never by DOM coordinates, which address
//    a paint that can be a commit behind during a typing burst. Double space becomes
//    "word. ", not "word . ".
// 2. The browser's own selection fix-up around the prevented default — it parks its
//    selection over the text it wanted to replace, with no gesture behind it — is
//    re-asserted away, never adopted. Adopting it highlighted a stale range and every
//    keystroke after typed there.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { paragraphTextOf } from '@docx-editor.dev/core/store';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { docx } from './paginated-surface-fixtures.ts';

// The selection belongs to the DOCUMENT, which every suite in this process shares.
afterEach(() => {
  document.getSelection()?.removeAllRanges();
});

/** Attached to the document: the selection sync only writes into a connected tree. */
function mounted(body: string): { surface: PaginatedSurface; container: HTMLElement } {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, docx(body), { scale: 1 });
  if (!opened.ok) throw new Error(opened.reason);
  return { surface: opened.surface, container };
}

function putCaret(surface: PaginatedSurface, offset: number): string {
  const paragraphId = surface.session.paragraphIds()[0]!;
  surface.setSelection({
    anchor: { paragraphId, offset },
    head: { paragraphId, offset },
  });
  return paragraphId;
}

function rangeOver(node: Node, start: number, end: number): unknown {
  return { startContainer: node, startOffset: start, endContainer: node, endOffset: end };
}

function dispatchReplacementRanges(
  container: HTMLElement,
  replacement: string,
  ranges: readonly unknown[]
): void {
  const event = new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    inputType: 'insertReplacementText',
    data: replacement,
  });
  Object.defineProperty(event, 'getTargetRanges', { value: () => ranges });
  container.querySelector('.docx-pages')!.dispatchEvent(event);
}

/**
 * Dispatch `insertReplacementText` the way a browser does: replacement text on the event,
 * the replaced text named by a target range. The range here covers a bare text node — the
 * handler matches range TEXT, never coordinates, so a detached node is the honest shape of
 * what a stale paint gives it.
 */
function dispatchReplacement(
  container: HTMLElement,
  replacement: string,
  replaced: string | null
): void {
  const ranges =
    replaced === null ? [] : [rangeOver(document.createTextNode(replaced), 0, replaced.length)];
  dispatchReplacementRanges(container, replacement, ranges);
}

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

const WORD_SPACE = '<w:p><w:r><w:t xml:space="preserve">word </w:t></w:r></w:p>';

describe('insertReplacementText replaces what the browser targeted', () => {
  test('double-space period replaces the preceding space, not inserts beside it', () => {
    const { surface, container } = mounted(WORD_SPACE);
    try {
      const id = putCaret(surface, 5);
      dispatchReplacement(container, '. ', ' ');
      expect(paragraphTextOf(surface.session.part(), id)).toBe('word. ');
      expect(surface.state().selection.head).toEqual({ paragraphId: id, offset: 6 });
    } finally {
      surface.destroy();
      container.remove();
    }
  });

  test('a substitution mid-burst lands the buffered keys first, then replaces', async () => {
    const { surface, container } = mounted('<w:p/>');
    try {
      const id = putCaret(surface, 0);
      for (const key of ['w', 'o', 'r', 'd', ' ']) keystroke(container, key);
      // Still buffered — the substitution arrives before the zero-delay flush task.
      dispatchReplacement(container, '. ', ' ');
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(paragraphTextOf(surface.session.part(), id)).toBe('word. ');
    } finally {
      surface.destroy();
      container.remove();
    }
  });

  test('an autocorrected word is replaced in place', () => {
    const { surface, container } = mounted(
      '<w:p><w:r><w:t xml:space="preserve">fix teh</w:t></w:r></w:p>'
    );
    try {
      const id = putCaret(surface, 7);
      dispatchReplacement(container, 'the', 'teh');
      expect(paragraphTextOf(surface.session.part(), id)).toBe('fix the');
    } finally {
      surface.destroy();
      container.remove();
    }
  });

  test('a target the model does not show falls back to inserting at the caret', () => {
    // The one wrong thing would be editing text the browser never targeted. When the range
    // text and the model characters before the caret disagree — a paint far enough behind
    // that the browser reasoned about other text — the replacement still lands, at the caret.
    const { surface, container } = mounted(WORD_SPACE);
    try {
      const id = putCaret(surface, 5);
      dispatchReplacement(container, 'the', 'xyz');
      expect(paragraphTextOf(surface.session.part(), id)).toBe('word the');
    } finally {
      surface.destroy();
      container.remove();
    }
  });

  test('an event with no target ranges inserts at the caret', () => {
    const { surface, container } = mounted(WORD_SPACE);
    try {
      const id = putCaret(surface, 5);
      dispatchReplacement(container, 'dictated', null);
      expect(paragraphTextOf(surface.session.part(), id)).toBe('word dictated');
    } finally {
      surface.destroy();
      container.remove();
    }
  });

  test('an armed caret format keeps the caret-insert lane and is not retired', () => {
    // The range selection the match takes would retire the armed format
    // (`reconcilePendingWith`); the armed case must ride `type()` like a plain keystroke.
    const { surface, container } = mounted(WORD_SPACE);
    try {
      const id = putCaret(surface, 5);
      surface.toggleRunProperty('b');
      expect(surface.state().pendingFormat).not.toBeNull();
      dispatchReplacement(container, '. ', ' ');
      expect(paragraphTextOf(surface.session.part(), id)).toBe('word . ');
      // Consumed by the insert, not dropped by a selection move.
      expect(surface.state().pendingFormat).toBeNull();
    } finally {
      surface.destroy();
      container.remove();
    }
  });

  test('more than one target range falls back to inserting at the caret', () => {
    // Concatenating ranges would let 'ab' + 'cd' pass the model match as 'abcd'.
    const { surface, container } = mounted(WORD_SPACE);
    try {
      const id = putCaret(surface, 5);
      dispatchReplacementRanges(container, '. ', [
        rangeOver(document.createTextNode('wor'), 0, 3),
        rangeOver(document.createTextNode('d '), 0, 2),
      ]);
      expect(paragraphTextOf(surface.session.part(), id)).toBe('word . ');
    } finally {
      surface.destroy();
      container.remove();
    }
  });

  test("a connected target in ANOTHER paragraph never matches the caret's", () => {
    // Same characters in the caret's paragraph would be a coincidence, not the target.
    const { surface, container } = mounted(WORD_SPACE + WORD_SPACE);
    try {
      const ids = surface.session.paragraphIds();
      const id = putCaret(surface, 5);
      const otherSpan = container.querySelector<HTMLElement>(
        `span[data-paragraph-id="${ids[1]}"]`
      )!;
      dispatchReplacementRanges(container, '. ', [rangeOver(otherSpan.firstChild!, 4, 5)]);
      expect(paragraphTextOf(surface.session.part(), id)).toBe('word . ');
      expect(paragraphTextOf(surface.session.part(), ids[1]!)).toBe('word ');
    } finally {
      surface.destroy();
      container.remove();
    }
  });

  test("a connected target in the caret's own paragraph still replaces", () => {
    const { surface, container } = mounted(WORD_SPACE);
    try {
      const id = putCaret(surface, 5);
      const span = container.querySelector<HTMLElement>(`span[data-paragraph-id="${id}"]`)!;
      dispatchReplacementRanges(container, '. ', [rangeOver(span.firstChild!, 4, 5)]);
      expect(paragraphTextOf(surface.session.part(), id)).toBe('word. ');
    } finally {
      surface.destroy();
      container.remove();
    }
  });
});

describe("the browser's selection fix-up around a substitution is not a gesture", () => {
  test('a rangeless selection the browser parks after a substitution is re-asserted, not adopted', async () => {
    const { surface, container } = mounted(WORD_SPACE);
    try {
      const id = putCaret(surface, 5);
      dispatchReplacement(container, '. ', ' ');
      expect(surface.state().selection.head).toEqual({ paragraphId: id, offset: 6 });
      // Let the mirror's own `selectionchange` echo guard retire (it clears on a microtask).
      await new Promise((resolve) => setTimeout(resolve, 0));

      // The fix-up: the browser selects the text IT wanted to replace — over whatever paint
      // it was reasoning about — with no pointerdown and no selectstart behind it.
      const span = container.querySelector<HTMLElement>(`span[data-paragraph-id="${id}"]`)!;
      const textNode = span.firstChild!;
      const selection = document.getSelection()!;
      selection.removeAllRanges();
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, 1);
      selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      await new Promise((resolve) => setTimeout(resolve, 0));

      // The model caret stays where the substitution put it, and the next keystroke
      // lands there — not inside the range the browser invented.
      expect(surface.state().selection.head).toEqual({ paragraphId: id, offset: 6 });
      keystroke(container, '!');
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(paragraphTextOf(surface.session.part(), id)).toBe('word. !');
    } finally {
      surface.destroy();
      container.remove();
    }
  });

  test('a real gesture after a substitution still wins', async () => {
    const { surface, container } = mounted(WORD_SPACE);
    try {
      const id = putCaret(surface, 5);
      dispatchReplacement(container, '. ', ' ');
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Same DOM selection, but with pointer provenance: the user clicked.
      const pages = container.querySelector<HTMLElement>('.docx-pages')!;
      pages.dispatchEvent(new Event('selectstart', { bubbles: true }));
      const span = container.querySelector<HTMLElement>(`span[data-paragraph-id="${id}"]`)!;
      const textNode = span.firstChild!;
      const selection = document.getSelection()!;
      selection.removeAllRanges();
      const range = document.createRange();
      range.setStart(textNode, 1);
      range.collapse(true);
      selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(surface.state().selection.head).toEqual({ paragraphId: id, offset: 1 });
    } finally {
      surface.destroy();
      container.remove();
    }
  });
});
