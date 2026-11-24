// COMPOSED TEXT COMMITS AFTER THE FRAME THAT SHOWS IT.
//
// A plain composed insertion at the caret is queued at `compositionend` and lands in the first
// task after the next paint, as one undo step, the way batched typing lands. These tests pin
// when it lands early (anything that reads or moves the selection or the text), that the order
// of what was entered holds, and which compositions still commit at once.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { runWithHistoryGroup } from '../history-group-scope.ts';
import { afterNextPaint } from '../surface-composition-commit.ts';
import { docx, mount as mountDetached, putCaret } from './paginated-surface-fixtures.ts';

const paragraph = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

const mounted: { surface: PaginatedSurface; container: HTMLElement }[] = [];
afterEach(() => {
  for (const { surface, container } of mounted.splice(0)) {
    surface.destroy();
    container.remove();
  }
  document.getSelection()?.removeAllRanges();
});

/** Mounted in the document, so the browser selection the input method writes at exists. */
function mount(body: string): { surface: PaginatedSurface; container: HTMLElement } {
  const opened = mountDetached(body);
  document.body.append(opened.container);
  mounted.push(opened);
  putCaret(opened.surface, 0);
  return opened;
}

function compositionEvent(type: string, data = ''): CompositionEvent {
  const event = new CompositionEvent(type, { bubbles: true });
  Object.defineProperty(event, 'data', { value: data, configurable: true });
  return event;
}

const pagesOf = (container: HTMLElement) => container.querySelector<HTMLElement>('.docx-pages')!;

/**
 * One composition the way a browser drives it: each step replaces the composing string in the
 * text node the caret is in (or the selected text in it), then `input` fires.
 */
function compose(pages: HTMLElement, steps: readonly string[], ends = true): void {
  pages.dispatchEvent(compositionEvent('compositionstart'));
  const selection = document.getSelection()!;
  const node = selection.focusNode as Text;
  const start = Math.min(selection.anchorOffset, selection.focusOffset);
  const end = Math.max(selection.anchorOffset, selection.focusOffset);
  const head = node.data.slice(0, start);
  const tail = node.data.slice(end);
  for (const step of steps) {
    pages.dispatchEvent(compositionEvent('compositionupdate', step));
    node.data = head + step + tail;
    selection.setBaseAndExtent(node, start + step.length, node, start + step.length);
    pages.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: step })
    );
  }
  if (ends) pages.dispatchEvent(compositionEvent('compositionend', steps.at(-1)!));
}

/** The painted run that shows `text`. */
const runOf = (pages: HTMLElement, text: string) =>
  [...pages.querySelectorAll<HTMLElement>('[data-start]')].find(
    (candidate) => candidate.textContent === text
  )!;

/** A selection gesture alone; a pointer event would start the engine's own hit test. */
function gesture(anchor: Node, anchorOffset: number, focus = anchor, focusOffset = anchorOffset) {
  anchor
    .ownerDocument!.querySelector('.docx-pages')!
    .dispatchEvent(new Event('selectstart', { bubbles: true }));
  document.getSelection()!.setBaseAndExtent(anchor, anchorOffset, focus, focusOffset);
  document.dispatchEvent(new Event('selectionchange'));
}

/** A click in the painted run that shows `text`, at `offset` in it. */
const click = (pages: HTMLElement, text: string, offset: number) =>
  gesture(runOf(pages, text).firstChild!, offset);

const THREE_RUNS =
  '<w:p><w:r><w:t xml:space="preserve">ab </w:t></w:r><w:r><w:rPr><w:b/></w:rPr>' +
  '<w:t>cd</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>ef</w:t></w:r></w:p>';

function keystroke(container: HTMLElement, data: string): void {
  pagesOf(container).dispatchEvent(
    new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data,
    })
  );
}

/** The first task after the next frame, where queued composed text lands. */
async function nextPaintTask(): Promise<void> {
  await new Promise((done) => requestAnimationFrame(() => done(undefined)));
  for (let index = 0; index < 3; index += 1) await new Promise((done) => setTimeout(done, 0));
}

function select(surface: PaginatedSurface, from: number, to: number): void {
  const paragraphId = surface.session.paragraphIds()[0]!;
  surface.setSelection({
    anchor: { paragraphId, offset: from },
    head: { paragraphId, offset: to },
  });
}

describe('afterNextPaint', () => {
  function fakeTimers() {
    const timeouts = new Map<number, { run: () => void; ms: number }>();
    const frames = new Map<number, () => void>();
    let next = 1;
    return {
      timeouts,
      frames,
      setTimeout: (run: () => void, ms = 0) => (timeouts.set(next, { run, ms }), next++),
      clearTimeout: (id: number | undefined) => void timeouts.delete(id!),
      requestAnimationFrame: (run: () => void) => (frames.set(next, run), next++),
      cancelAnimationFrame: (id: number) => void frames.delete(id),
    };
  }

  test('runs in a task queued from the next frame, not in the frame', () => {
    const timers = fakeTimers();
    const ran: string[] = [];
    afterNextPaint(timers as never, () => ran.push('task'));
    expect(ran).toEqual([]);
    const [frame] = [...timers.frames.values()];
    frame!();
    // The fallback is gone; the task waits in a zero-delay timeout behind the paint.
    expect(ran).toEqual([]);
    expect([...timers.timeouts.values()].map((timeout) => timeout.ms)).toEqual([0]);
    [...timers.timeouts.values()][0]!.run();
    expect(ran).toEqual(['task']);
  });

  test('a window that paints nothing still runs the task, once', () => {
    const timers = fakeTimers();
    const ran: string[] = [];
    afterNextPaint(timers as never, () => ran.push('task'));
    const [fallback] = [...timers.timeouts.values()];
    expect(fallback!.ms).toBe(100);
    fallback!.run();
    expect(ran).toEqual(['task']);
    expect(timers.frames.size).toBe(0);
  });
});

describe('a composed syllable', () => {
  test('is queued at compositionend and lands after the next paint as one undo step', async () => {
    const { surface, container } = mount(paragraph('우리나라 '));
    putCaret(surface, 5);
    const revision = surface.state().revision;
    compose(pagesOf(container), ['ㅇ', '아']);
    expect(surface.session.bodyText()).toBe('우리나라 ');
    expect(surface.state().revision).toBe(revision);
    expect(pagesOf(container).textContent).toContain('우리나라 아');
    await nextPaintTask();
    expect(surface.session.bodyText()).toBe('우리나라 아');
    expect(surface.state().selection.head.offset).toBe(6);
    surface.undo();
    expect(surface.session.bodyText()).toBe('우리나라 ');
  });

  test('typed text after a queued syllable lands after it', async () => {
    const { surface, container } = mount(paragraph('우리나라 '));
    putCaret(surface, 5);
    compose(pagesOf(container), ['ㅇ', '아']);
    keystroke(container, '!');
    await nextPaintTask();
    expect(surface.session.bodyText()).toBe('우리나라 아!');
  });

  test('a selection move lands it first, where it was composed', () => {
    const { surface, container } = mount(paragraph('우리나라 '));
    putCaret(surface, 5);
    compose(pagesOf(container), ['ㅇ', '아']);
    select(surface, 0, 0);
    expect(surface.session.bodyText()).toBe('우리나라 아');
    expect(surface.state().selection.head.offset).toBe(0);
  });

  test('a command lands it first: Backspace deletes the syllable', () => {
    const { surface, container } = mount(paragraph('우리나라 '));
    putCaret(surface, 5);
    compose(pagesOf(container), ['ㅇ', '아']);
    surface.deleteBackward();
    expect(surface.session.bodyText()).toBe('우리나라 ');
  });

  test('undo lands it first, then undoes it', () => {
    const { surface, container } = mount(paragraph('우리나라 '));
    putCaret(surface, 5);
    compose(pagesOf(container), ['ㅇ', '아']);
    surface.undo();
    expect(surface.session.bodyText()).toBe('우리나라 ');
    surface.redo();
    expect(surface.session.bodyText()).toBe('우리나라 아');
  });

  test('chained syllables each start over the queued text and stay one undo step each', () => {
    const { surface, container } = mount(paragraph('우리나라 '));
    putCaret(surface, 5);
    const pages = pagesOf(container);
    compose(pages, ['ㅇ', '아']);
    compose(pages, ['ㄹ', '르', '름']);
    compose(pages, ['ㄷ', '다']);
    expect(surface.session.bodyText()).toBe('우리나라 ');
    surface.flushPendingInput();
    expect(surface.session.bodyText()).toBe('우리나라 아름다');
    expect(surface.state().selection.head.offset).toBe(8);
    surface.undo();
    expect(surface.session.bodyText()).toBe('우리나라 아름');
    surface.undo();
    expect(surface.session.bodyText()).toBe('우리나라 아');
    surface.undo();
    expect(surface.session.bodyText()).toBe('우리나라 ');
  });
});

describe('compositions that still commit at once', () => {
  test('a candidate that replaces selected text', () => {
    const { surface, container } = mount(paragraph('かんじを'));
    select(surface, 0, 3);
    compose(pagesOf(container), ['漢字']);
    // Not a plain insertion at a collapsed caret: no queue, the model holds it now.
    expect(surface.session.bodyText()).toBe('漢字を');
    surface.undo();
    expect(surface.session.bodyText()).toBe('かんじを');
  });

  test('a candidate composed at the caret queues like a syllable', async () => {
    const { surface, container } = mount(paragraph('を'));
    putCaret(surface, 0);
    compose(pagesOf(container), ['か', 'かん', 'かんじ', '漢字']);
    await nextPaintTask();
    expect(surface.session.bodyText()).toBe('漢字を');
    surface.undo();
    expect(surface.session.bodyText()).toBe('を');
  });

  test('a dead key composes its accented letter', async () => {
    const { surface, container } = mount(paragraph('word'));
    putCaret(surface, 4);
    compose(pagesOf(container), ['´', 'é']);
    await nextPaintTask();
    expect(surface.session.bodyText()).toBe('wordé');
  });
});

describe('what lands the queue, and where', () => {
  test('a click past a queued syllable lands at the clicked character', async () => {
    const { surface, container } = mount(THREE_RUNS);
    putCaret(surface, 3);
    const pages = pagesOf(container);
    compose(pages, ['ㅇ', '아']);
    // The echo guard of the caret's own write clears on a microtask.
    await Promise.resolve();
    expect(surface.session.bodyText()).toBe('ab cdef');
    click(pages, 'ef', 1);
    expect(surface.session.bodyText()).toBe('ab 아cdef');
    // 'ab 아cde|f'
    expect(surface.state().selection.head.offset).toBe(7);
  });

  test('a click that ends a composition over a landed, unpainted syllable', async () => {
    const { surface, container } = mount(THREE_RUNS);
    putCaret(surface, 3);
    const pages = pagesOf(container);
    compose(pages, ['ㅇ', '아']);
    compose(pages, ['ㄹ', '르'], false);
    // A frame passes while the next syllable composes: the first lands, the page stays held.
    await nextPaintTask();
    expect(surface.session.bodyText()).toBe('ab 아cdef');
    pages.dispatchEvent(compositionEvent('compositionend', '르'));
    click(pages, 'ef', 1);
    expect(surface.session.bodyText()).toBe('ab 아르cdef');
    expect(surface.state().selection.head.offset).toBe(8);
  });

  test("the browser's caret echo after the composition leaves it queued", async () => {
    const { surface, container } = mount(paragraph('ab cd'));
    putCaret(surface, 3);
    compose(pagesOf(container), ['ㅇ', '아']);
    document.dispatchEvent(new Event('selectionchange'));
    expect(surface.session.bodyText()).toBe('ab cd');
    await nextPaintTask();
    expect(surface.session.bodyText()).toBe('ab 아cd');
    expect(surface.state().selection.head.offset).toBe(4);
  });

  test('a grouped command after a queued syllable keeps the syllable out of its group', () => {
    const { surface, container } = mount(paragraph('word '));
    putCaret(surface, 5);
    compose(pagesOf(container), ['ㅇ', '아']);
    const gesture = Symbol('gesture');
    runWithHistoryGroup(surface, gesture, () => surface.type('!'));
    runWithHistoryGroup(surface, gesture, () => surface.type('?'));
    expect(surface.session.bodyText()).toBe('word 아!?');
    surface.undo();
    expect(surface.session.bodyText()).toBe('word 아');
    surface.undo();
    expect(surface.session.bodyText()).toBe('word ');
  });

  test('a host that reads the layout on each change cannot put typing between syllables', () => {
    const container = document.createElement('div');
    document.body.append(container);
    let surface: PaginatedSurface | null = null;
    const opened = mountPaginatedSurface(container, docx(paragraph('우리나라 ')), {
      scale: 1,
      onChange: () => void surface?.layout(),
    });
    if (!opened.ok) throw new Error(opened.reason);
    surface = opened.surface;
    mounted.push({ surface, container });
    putCaret(surface, 5);
    const pages = pagesOf(container);
    compose(pages, ['ㅇ', '아']);
    compose(pages, ['ㄹ', '르', '름']);
    // Another writer edits the paragraph first, so each syllable lands with its own publish.
    const id = surface.session.paragraphIds()[0]!;
    surface.session.applyTreeOps([{ op: 'insertText', paragraphId: id, offset: 0, text: 'A' }]);
    keystroke(container, ' ');
    surface.flushPendingInput();
    expect(surface.session.bodyText()).toBe('A우리나라 아름 ');
  });

  test('save writes queued text', () => {
    const { surface, container } = mount(paragraph('우리나라 '));
    putCaret(surface, 5);
    compose(pagesOf(container), ['ㅇ', '아']);
    const reopened = mount(paragraph(''));
    const bytes = surface.save();
    const again = mountPaginatedSurface(reopened.container, bytes, { scale: 1 });
    if (!again.ok) throw new Error(again.reason);
    mounted.push({ surface: again.surface, container: reopened.container });
    expect(again.surface.session.bodyText()).toBe('우리나라 아');
  });

  test('destroy with text queued leaves no task behind', async () => {
    const { surface, container } = mount(paragraph('우리나라 '));
    putCaret(surface, 5);
    compose(pagesOf(container), ['ㅇ', '아']);
    mounted.splice(0);
    surface.destroy();
    container.remove();
    await nextPaintTask();
  });

  test('a drag end on the run the input method wrote into, as an element', async () => {
    const { surface, container } = mount(THREE_RUNS);
    putCaret(surface, 3);
    const pages = pagesOf(container);
    compose(pages, ['ㅇ', '아']);
    await Promise.resolve();
    const run = runOf(pages, '아cd');
    gesture(run, 1);
    expect(surface.session.bodyText()).toBe('ab 아cdef');
    expect(surface.state().selection.head.offset).toBe(6);
  });

  test('the end of the line past the insertion', async () => {
    const { surface, container } = mount(THREE_RUNS);
    putCaret(surface, 3);
    const pages = pagesOf(container);
    compose(pages, ['ㅇ', '아']);
    await Promise.resolve();
    const line = runOf(pages, 'ef').closest('.docx-line')!;
    gesture(line, line.childNodes.length);
    expect(surface.session.bodyText()).toBe('ab 아cdef');
    expect(surface.state().selection.head.offset).toBe(8);
  });

  test('ranges into and out of the composed text', async () => {
    const { surface, container } = mount(THREE_RUNS);
    putCaret(surface, 3);
    const pages = pagesOf(container);
    compose(pages, ['ㅇ', '아']);
    await Promise.resolve();
    gesture(runOf(pages, '아cd').firstChild!, 0, runOf(pages, 'ef').firstChild!, 1);
    const out = surface.state().selection;
    expect([out.anchor.offset, out.head.offset]).toEqual([3, 7]);
    surface.undo();
    putCaret(surface, 3);
    compose(pages, ['ㅇ', '아']);
    await Promise.resolve();
    gesture(runOf(pages, 'ab ').firstChild!, 1, runOf(pages, '아cd').firstChild!, 2);
    const into = surface.state().selection;
    expect([into.anchor.offset, into.head.offset]).toEqual([1, 5]);
  });

  test('a selection change with no gesture that is not the echo is adopted', async () => {
    const { surface, container } = mount(THREE_RUNS);
    putCaret(surface, 3);
    const pages = pagesOf(container);
    compose(pages, ['ㅇ', '아']);
    await Promise.resolve();
    // An assistive technology or host code moves the caret.
    const ab = runOf(pages, 'ab ').firstChild!;
    document.getSelection()!.setBaseAndExtent(ab, 1, ab, 1);
    document.dispatchEvent(new Event('selectionchange'));
    expect(surface.session.bodyText()).toBe('ab 아cdef');
    expect(surface.state().selection.head.offset).toBe(1);
  });
});
