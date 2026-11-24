// Keyboards that delete through the platform's text service (on Android,
// `InputConnection.deleteSurroundingText`) instead of sending Backspace key events (#1896).
//
// Four things went wrong, each reproduced here with the event sequence such a keyboard drives:
//
// 1. A keyboard that falls behind names two or more characters in one `beforeinput`, and the
//    surface deleted one. The rest stayed, and later presses landed mid-word.
// 2. Chromium applies such a deletion to the DOM even though the surface prevented it and
//    applied it to the model, then parks its caret where its own deletion left it. The page
//    showed both deletions, and the parked caret was adopted, so the model caret drifted.
// 3. A composition that erased a whole word removed the word's span; the readback filled the
//    missing range from the model and the word came back.
// 4. Paragraphs paint out of flow, so the text the keyboard reads had no break between them.
//    A paragraph end now paints a `<br>`, which the browser's text services read as one.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { paragraphTextOf } from '@docx-editor.dev/core/store';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { positionFromDomPoint } from '../dom-selection.ts';
import { MAX_IME_DELETION_STEPS } from '../surface-ime-deletion.ts';
import { docx } from './paginated-surface-fixtures.ts';

afterEach(() => {
  document.getSelection()?.removeAllRanges();
});

const p = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

function withSurface(
  body: string,
  run: (surface: PaginatedSurface, container: HTMLElement, ids: readonly string[]) => void
): void {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, docx(body), { scale: 1 });
  if (!opened.ok) throw new Error(opened.reason);
  try {
    run(opened.surface, container, opened.surface.session.paragraphIds());
  } finally {
    opened.surface.destroy();
    container.remove();
  }
}

async function withSurfaceAsync(
  body: string,
  run: (surface: PaginatedSurface, container: HTMLElement, ids: readonly string[]) => Promise<void>
): Promise<void> {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, docx(body), { scale: 1 });
  if (!opened.ok) throw new Error(opened.reason);
  try {
    await run(opened.surface, container, opened.surface.session.paragraphIds());
  } finally {
    opened.surface.destroy();
    container.remove();
  }
}

const pages = (container: HTMLElement) => container.querySelector('.docx-pages') as HTMLElement;
const textOf = (surface: PaginatedSurface, id: string) =>
  paragraphTextOf(surface.session.part(), id);

function caretAt(surface: PaginatedSurface, paragraphId: string, offset: number): void {
  surface.setSelection({ anchor: { paragraphId, offset }, head: { paragraphId, offset } });
}

/** The painted text node holding model `offset` of a paragraph, and the offset inside it. */
function domPoint(container: HTMLElement, paragraphId: string, offset: number): [Text, number] {
  for (const element of pages(container).querySelectorAll<HTMLElement>(
    '[data-paragraph-id][data-start]'
  )) {
    if (element.dataset.paragraphId !== paragraphId) continue;
    const start = Number(element.dataset.start);
    const text = element.firstChild;
    if (!text || text.nodeType !== Node.TEXT_NODE) continue;
    const length = (text as Text).data.length;
    if (offset >= start && offset <= start + length) return [text as Text, offset - start];
  }
  throw new Error(`no painted text at ${paragraphId}:${offset}`);
}

interface RangeEnd {
  readonly node: Node;
  readonly offset: number;
}

/** What a keyboard's deletion looks like to the page: one `beforeinput` naming its range. */
function deleteEvent(
  container: HTMLElement,
  inputType: string,
  from: RangeEnd,
  to: RangeEnd
): InputEvent {
  const event = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType });
  const range = {
    startContainer: from.node,
    startOffset: from.offset,
    endContainer: to.node,
    endOffset: to.offset,
    collapsed: false,
  };
  Object.defineProperty(event, 'getTargetRanges', { value: () => [range] });
  pages(container).dispatchEvent(event);
  return event;
}

function at(container: HTMLElement, paragraphId: string, offset: number): RangeEnd {
  const [node, inner] = domPoint(container, paragraphId, offset);
  return { node, offset: inner };
}

/** Put the browser's own caret somewhere, as Chromium or the keyboard does, with no gesture. */
function parkBrowserCaret(container: HTMLElement, paragraphId: string, offset: number): void {
  const [node, inner] = domPoint(container, paragraphId, offset);
  document.getSelection()!.collapse(node, inner);
  document.dispatchEvent(new Event('selectionchange'));
}

describe('a deletion names its characters', () => {
  test('two characters named at the caret delete both', () => {
    withSurface(p('Hello world'), (surface, container, [id]) => {
      caretAt(surface, id!, 11);
      deleteEvent(
        container,
        'deleteContentBackward',
        at(container, id!, 9),
        at(container, id!, 11)
      );
      expect(textOf(surface, id!)).toBe('Hello wor');
      expect(surface.state().selection.head).toEqual({ paragraphId: id, offset: 9 });
    });
  });

  test('a forward range at the caret deletes what it names', () => {
    withSurface(p('Hello world'), (surface, container, [id]) => {
      caretAt(surface, id!, 0);
      deleteEvent(container, 'deleteContentForward', at(container, id!, 0), at(container, id!, 3));
      expect(textOf(surface, id!)).toBe('lo world');
    });
  });

  test('a range away from the caret deletes one character at the caret', () => {
    // The keyboard's own copy of the caret drifted. The caret the user sees is the model's.
    withSurface(p('Hello world'), (surface, container, [id]) => {
      caretAt(surface, id!, 11);
      deleteEvent(container, 'deleteContentBackward', at(container, id!, 2), at(container, id!, 4));
      expect(textOf(surface, id!)).toBe('Hello worl');
    });
  });

  test('a range across the paragraph break joins the paragraphs once', () => {
    withSurface(p('First') + p('Second'), (surface, container, [first, second]) => {
      caretAt(surface, second!, 0);
      deleteEvent(
        container,
        'deleteContentBackward',
        at(container, first!, 5),
        at(container, second!, 0)
      );
      expect(surface.session.paragraphIds()).toHaveLength(1);
      expect(textOf(surface, surface.session.paragraphIds()[0]!)).toBe('FirstSecond');
    });
  });

  test('a range ending in the previous paragraph, at a paragraph start, joins only', () => {
    // No break in the keyboard's text: it aimed at the previous paragraph's last character.
    withSurface(p('First') + p('Second'), (surface, container, [first, second]) => {
      caretAt(surface, second!, 0);
      deleteEvent(
        container,
        'deleteContentBackward',
        at(container, first!, 4),
        at(container, first!, 5)
      );
      expect(textOf(surface, surface.session.paragraphIds()[0]!)).toBe('FirstSecond');
    });
  });

  test('a range across several breaks deletes every break and character it names', () => {
    // Followed back through the story order: a held Backspace through whole paragraphs.
    withSurface(p('First') + p('Middle') + p('Last'), (surface, container, [first, , last]) => {
      caretAt(surface, last!, 0);
      deleteEvent(
        container,
        'deleteContentBackward',
        at(container, first!, 2),
        at(container, last!, 0)
      );
      const ids = surface.session.paragraphIds();
      expect(ids).toHaveLength(1);
      expect(textOf(surface, ids[0]!)).toBe('FiLast');
    });
  });

  test('an empty paragraph in the range is one more break', () => {
    withSurface(p('First') + '<w:p/>' + p('Last'), (surface, container, [first, , last]) => {
      caretAt(surface, last!, 0);
      deleteEvent(
        container,
        'deleteContentBackward',
        at(container, first!, 5),
        at(container, last!, 0)
      );
      const ids = surface.session.paragraphIds();
      expect(ids).toHaveLength(1);
      expect(textOf(surface, ids[0]!)).toBe('FirstLast');
    });
  });

  test('a range at the browser caret of a paint behind the model still counts', () => {
    // The paint is a commit behind: the browser's caret, and the range, sit at the older
    // offsets. Their distance is the count; the model caret is where it applies.
    withSurface(p('Hello world'), (surface, container, [id]) => {
      caretAt(surface, id!, 11);
      // Synchronously after the model's own selection write, so it is not adopted.
      const [node, inner] = domPoint(container, id!, 9);
      document.getSelection()!.collapse(node, inner);
      deleteEvent(container, 'deleteContentBackward', at(container, id!, 7), at(container, id!, 9));
      expect(textOf(surface, id!)).toBe('Hello wor');
    });
  });

  test('characters that never paint do not add steps', () => {
    // A hidden run lies between the two painted characters: the keyboard named one character.
    const body =
      '<w:p><w:r><w:t>a</w:t></w:r><w:r><w:rPr><w:vanish/></w:rPr><w:t>HIDDEN</w:t></w:r>' +
      '<w:r><w:t>b</w:t></w:r></w:p>';
    withSurface(body, (surface, container, [id]) => {
      caretAt(surface, id!, 7);
      deleteEvent(container, 'deleteContentBackward', at(container, id!, 0), at(container, id!, 7));
      expect(textOf(surface, id!)).toHaveLength(7);
    });
  });

  test('a range the browser shows selected deletes as that selection', () => {
    // A keyboard selected a word and deleted it before the selection reached the model.
    withSurface(p('Hello world'), (surface, container, [id]) => {
      caretAt(surface, id!, 11);
      const from = at(container, id!, 0);
      const to = at(container, id!, 5);
      document.getSelection()!.setBaseAndExtent(from.node, from.offset, to.node, to.offset);
      deleteEvent(container, 'deleteContentBackward', from, to);
      expect(textOf(surface, id!)).toBe(' world');
    });
  });

  test('a long range is bounded, and stops when nothing is left to delete', () => {
    withSurface(p('abc'), (surface, container, [id]) => {
      caretAt(surface, id!, 3);
      deleteEvent(container, 'deleteContentBackward', at(container, id!, 0), at(container, id!, 3));
      expect(textOf(surface, id!)).toBe('');
      expect(MAX_IME_DELETION_STEPS).toBeGreaterThan(3);
    });
  });
});

describe('the browser applies the deletion anyway', () => {
  test('its copy of the edit is repainted away', () => {
    withSurface(p('Hello world'), (surface, container, [id]) => {
      caretAt(surface, id!, 11);
      deleteEvent(
        container,
        'deleteContentBackward',
        at(container, id!, 10),
        at(container, id!, 11)
      );
      expect(textOf(surface, id!)).toBe('Hello worl');
      // Chromium deletes on the freshly painted page as well, and says so with `input`.
      const [node, inner] = domPoint(container, id!, 10);
      node.deleteData(inner - 2, 2);
      pages(container).dispatchEvent(
        new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' })
      );
      expect(textOf(surface, id!)).toBe('Hello worl');
      expect(surface.state().selection.head).toEqual({ paragraphId: id, offset: 10 });
      const painted = [
        ...pages(container).querySelectorAll<HTMLElement>('[data-paragraph-id][data-start]'),
      ]
        .map((element) => element.textContent)
        .join('');
      expect(painted).toBe('Hello worl');
    });
  });

  test('a caret the keyboard parks after its deletion is re-asserted', async () => {
    await withSurfaceAsync(p('Hello world'), async (surface, container, [id]) => {
      caretAt(surface, id!, 11);
      deleteEvent(
        container,
        'deleteContentBackward',
        at(container, id!, 10),
        at(container, id!, 11)
      );
      // On a later task, as the keyboard's correction arrives: past the surface's own echo.
      await new Promise((resolve) => setTimeout(resolve, 0));
      parkBrowserCaret(container, id!, 2);
      expect(surface.state().selection.head).toEqual({ paragraphId: id, offset: 10 });
      // The next press deletes at the caret the user sees, not where the keyboard parked it.
      deleteEvent(container, 'deleteContentBackward', at(container, id!, 1), at(container, id!, 2));
      expect(textOf(surface, id!)).toBe('Hello wor');
    });
  });

  test('a real key ends the window; an input method key does not', async () => {
    await withSurfaceAsync(p('Hello world'), async (surface, container, [first]) => {
      const id = first!;
      caretAt(surface, id, 11);
      deleteEvent(container, 'deleteContentBackward', at(container, id, 10), at(container, id, 11));
      await new Promise((resolve) => setTimeout(resolve, 0));
      const key = (init: KeyboardEventInit) =>
        pages(container).dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
      key({ key: 'Unidentified', keyCode: 229 });
      parkBrowserCaret(container, id, 2);
      expect(surface.state().selection.head).toEqual({ paragraphId: id, offset: 10 });
      await new Promise((resolve) => setTimeout(resolve, 0));
      key({ key: 'Shift' });
      parkBrowserCaret(container, id, 2);
      expect(surface.state().selection.head).toEqual({ paragraphId: id, offset: 2 });
    });
  });

  test('a gesture inside the window is still adopted', async () => {
    await withSurfaceAsync(p('Hello world'), async (surface, container, [first]) => {
      const id = first!;
      caretAt(surface, id, 11);
      deleteEvent(container, 'deleteContentBackward', at(container, id, 10), at(container, id, 11));
      // A tap arrives on a later task than the deletion's own selection write. A touch
      // selection starts with `selectstart`; a pointer press would place the engine's caret.
      await new Promise((resolve) => setTimeout(resolve, 0));
      pages(container).dispatchEvent(new Event('selectstart', { bubbles: true }));
      parkBrowserCaret(container, id, 2);
      expect(surface.state().selection.head).toEqual({ paragraphId: id, offset: 2 });
    });
  });

  test('a prevented deletion fires no input and repaints nothing extra', () => {
    withSurface(p('Hello world'), (surface, container, [id]) => {
      caretAt(surface, id!, 11);
      deleteEvent(
        container,
        'deleteContentBackward',
        at(container, id!, 10),
        at(container, id!, 11)
      );
      const page = pages(container).querySelector('.docx-page');
      pages(container).dispatchEvent(
        new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' })
      );
      expect(pages(container).querySelector('.docx-page')).toBe(page);
    });
  });
});

describe('a composition that erases a whole word', () => {
  test('the word stays erased when the browser removed its span', () => {
    const body =
      '<w:p><w:r><w:t xml:space="preserve">Hello </w:t></w:r>' +
      '<w:r><w:rPr><w:b/></w:rPr><w:t>world</w:t></w:r></w:p>';
    withSurface(body, (surface, container, [id]) => {
      caretAt(surface, id!, 11);
      const layer = pages(container);
      layer.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      const [node] = domPoint(container, id!, 11);
      (node.parentNode as HTMLElement).remove();
      const end = new CompositionEvent('compositionend', { bubbles: true });
      Object.defineProperty(end, 'data', { value: '' });
      layer.dispatchEvent(end);
      expect(textOf(surface, id!)).toBe('Hello ');
    });
  });

  test('text composed over the erased word into a copy of the span before it is kept', () => {
    // Chromium, composing over a selection whose text has another font than the text on both
    // sides of it (Latin between Hangul), removes the selected spans and writes the composed
    // text into a NEW span it copied from the one before — attributes and all — inside a
    // `<font>` that carries the erased text's face.
    const body =
      '<w:p><w:r><w:t>시험번호</w:t></w:r><w:r><w:t>GMEB-26202</w:t></w:r>' +
      '<w:r><w:t xml:space="preserve">의 제출문이다.</w:t></w:r></w:p>';
    withSurface(body, (surface, container, [id]) => {
      surface.setSelection({
        anchor: { paragraphId: id!, offset: 4 },
        head: { paragraphId: id!, offset: 14 },
      });
      const layer = pages(container);
      layer.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      const [before] = domPoint(container, id!, 0);
      const kept = before.parentNode as HTMLElement;
      for (const span of layer.querySelectorAll<HTMLElement>('[data-start]')) {
        const start = Number(span.dataset.start);
        if (start >= 4 && start < 14) span.remove();
      }
      const copy = kept.cloneNode(false) as HTMLElement;
      const face = document.createElement('font');
      face.textContent = '한';
      copy.append(face);
      kept.after(copy);
      const end = new CompositionEvent('compositionend', { bubbles: true });
      Object.defineProperty(end, 'data', { value: '한' });
      layer.dispatchEvent(end);
      expect(textOf(surface, id!)).toBe('시험번호한의 제출문이다.');
    });
  });

  test('a span lost to a repaint, with its line, is not read as erased', () => {
    withSurface(p('Hello world'), (surface, container, [id]) => {
      caretAt(surface, id!, 11);
      const layer = pages(container);
      layer.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      const [node] = domPoint(container, id!, 11);
      const line = (node.parentNode as HTMLElement).closest('.docx-line')!;
      const copy = line.cloneNode(true);
      line.replaceWith(copy);
      const end = new CompositionEvent('compositionend', { bubbles: true });
      Object.defineProperty(end, 'data', { value: '' });
      layer.dispatchEvent(end);
      expect(textOf(surface, id!)).toBe('Hello world');
    });
  });
});

describe('paragraph ends for the browser text services', () => {
  test('each paragraph with text ends in a hidden line break; an empty one has its own', () => {
    withSurface(p('First') + '<w:p/>' + p('Second'), (_surface, container, ids) => {
      const boundaries = [...pages(container).querySelectorAll('.docx-paragraph-boundary')];
      expect(boundaries).toHaveLength(2);
      for (const boundary of boundaries) {
        expect(boundary.getAttribute('aria-hidden')).toBe('true');
        expect(boundary.getAttribute('contenteditable')).toBe('false');
        expect(boundary.querySelector('br')).not.toBeNull();
      }
      const owner = boundaries[0]!.closest<HTMLElement>('[data-paragraph-id]')!;
      expect(owner.dataset.paragraphId).toBe(ids[0]);
      // Where the paragraph mark would sit: at the end of the text, not the line origin.
      expect(parseFloat((boundaries[0] as HTMLElement).style.left)).toBeGreaterThan(0);
    });
  });

  test('a point in the break resolves to the end of its paragraph', () => {
    withSurface(p('First') + p('Second'), (_surface, container, [first]) => {
      const boundary = pages(container).querySelector('.docx-paragraph-boundary')!;
      expect(positionFromDomPoint(boundary, 0, pages(container))).toEqual({
        paragraphId: first,
        offset: 5,
      });
    });
  });

  test('the break never reaches the model through a composition', () => {
    withSurface(p('First') + p('Second'), (surface, container, [first]) => {
      caretAt(surface, first!, 5);
      const layer = pages(container);
      layer.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      const [node] = domPoint(container, first!, 5);
      node.appendData('!');
      layer.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
      surface.flushPendingInput();
      expect(textOf(surface, first!)).toBe('First!');
      expect(surface.session.paragraphIds()).toHaveLength(2);
    });
  });
});
