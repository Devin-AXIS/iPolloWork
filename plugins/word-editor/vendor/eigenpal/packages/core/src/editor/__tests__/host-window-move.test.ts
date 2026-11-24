// An editor moved into another window (a pop-out opened with `window.open`, or a same-origin
// iframe) keeps its session and follows that window: focus, selection, scroll, resize, pointer
// release, timers and observers come from the document the pages live in, never from the
// script's globals.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { editorHostDocument, editorHostWindow, hostTimers } from '../host-realm.ts';
import { docx } from './paginated-surface-fixtures.ts';
import { createOpenScheduler } from '../docx-editor-open-scheduler.ts';

const p = (text: string): string => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

type HostWindow = Window & typeof globalThis;

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

/** A second window with its own document and constructors, as `window.open` would give. */
function popout(): HostWindow {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  cleanups.push(() => frame.remove());
  const view = frame.contentWindow as HostWindow | null;
  if (!view || view.document === document) throw new Error('no second window');
  return view;
}

function slotIn(doc: Document): HTMLElement {
  const slot = doc.createElement('div');
  doc.body.append(slot);
  cleanups.push(() => slot.remove());
  return slot;
}

function editorWith(text: string): DocxEditorInstance {
  const editor = createDocxEditor({ document: docx(p(text)) });
  cleanups.push(() => editor.destroy());
  return editor;
}

/** Record the event types added to and removed from `target`. */
function listenerLog(target: EventTarget): { added: string[]; removed: string[] } {
  const log = { added: [] as string[], removed: [] as string[] };
  const add = target.addEventListener.bind(target);
  const remove = target.removeEventListener.bind(target);
  target.addEventListener = ((type: string, ...rest: unknown[]) => {
    log.added.push(type);
    return (add as (...args: unknown[]) => void)(type, ...rest);
  }) as typeof target.addEventListener;
  target.removeEventListener = ((type: string, ...rest: unknown[]) => {
    log.removed.push(type);
    return (remove as (...args: unknown[]) => void)(type, ...rest);
  }) as typeof target.removeEventListener;
  cleanups.push(() => {
    target.addEventListener = add;
    target.removeEventListener = remove;
  });
  return log;
}

describe('moving a live editor to another window', () => {
  test('keeps the session, the undo history and the selection', () => {
    const editor = editorWith('hello');
    const home = slotIn(document);
    editor.attach(home);
    editor.exec({ type: 'insertText', text: 'X' });
    const surface = editor.surface!;
    const selection = editor.snapshot().selection;

    const view = popout();
    const away = slotIn(view.document);
    editor.attach(away);

    expect(editor.surface).toBe(surface);
    expect(editor.snapshot().selection).toEqual(selection);
    expect(away.querySelector('.docx-pages')?.ownerDocument).toBe(view.document);
    expect(away.textContent).toContain('Xhello');
    // The element left behind is an empty, unstyled mount point again.
    expect(home.childNodes.length).toBe(0);
    expect(home.style.width).toBe('');
    expect(home.style.position).toBe('');

    expect(editor.snapshot().canUndo).toBe(true);
    editor.exec({ type: 'undo' });
    expect(editor.surface!.session.bodyText()).toBe('hello');

    editor.attach(home);
    expect(editor.surface).toBe(surface);
    expect(home.textContent).toContain('hello');
    expect(away.childNodes.length).toBe(0);
  });

  test('re-binds document and window listeners to the new window', () => {
    const editor = editorWith('hello');
    const home = slotIn(document);
    editor.attach(home);

    const view = popout();
    const awayDocument = listenerLog(view.document);
    const awayWindow = listenerLog(view);
    const homeDocument = listenerLog(document);
    editor.attach(slotIn(view.document));

    for (const type of ['selectionchange', 'scroll', 'pointermove', 'pointerup', 'pointercancel'])
      expect(awayDocument.added).toContain(type);
    for (const type of ['resize', 'scroll']) expect(awayWindow.added).toContain(type);
    for (const type of ['selectionchange', 'scroll', 'pointerup'])
      expect(homeDocument.removed).toContain(type);
    expect(homeDocument.added).not.toContain('selectionchange');
  });

  test('draws its caret when the pages have focus in the new window', () => {
    const editor = editorWith('hello');
    editor.attach(slotIn(document));
    const view = popout();
    const away = slotIn(view.document);
    editor.attach(away);

    const pages = away.querySelector<HTMLElement>('.docx-pages')!;
    pages.focus();
    expect(view.document.activeElement).toBe(pages);
    editor.surface!.setSelection({
      anchor: { paragraphId: editor.surface!.session.paragraphIds()[0]!, offset: 1 },
      head: { paragraphId: editor.surface!.session.paragraphIds()[0]!, offset: 1 },
    });
    expect(away.querySelector('[data-docx-caret]')).not.toBeNull();
  });

  test("times its work on the new window's clock", () => {
    const editor = editorWith('hello');
    editor.attach(slotIn(document));
    const view = popout();
    editor.attach(slotIn(view.document));

    const awayTimers: number[] = [];
    const set = view.setTimeout.bind(view);
    view.setTimeout = ((run: () => void, delay?: number) => {
      awayTimers.push(delay ?? 0);
      return set(run, delay);
    }) as typeof view.setTimeout;
    cleanups.push(() => (view.setTimeout = set));
    const homeSet = globalThis.setTimeout;
    const homeCallers: string[] = [];
    globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
      homeCallers.push(new Error().stack ?? '');
      return homeSet(...args);
    }) as typeof setTimeout;
    cleanups.push(() => (globalThis.setTimeout = homeSet));

    // A keystroke arms the typing commit and the caret's steady hold.
    editor.surface!.type('Y');
    expect(awayTimers.length).toBeGreaterThan(0);
    // Session diagnostics may keep the script's clock; no editing or painting timer does.
    expect(homeCallers.filter((stack) => !stack.includes('editor-session.ts'))).toEqual([]);
  });

  test('observes the scroller with the new window ResizeObserver', () => {
    const editor = editorWith('hello');
    const view = popout();
    const scroller = view.document.createElement('div');
    scroller.className = 'docx-editor__scroll-container';
    view.document.body.append(scroller);
    cleanups.push(() => scroller.remove());
    const slot = view.document.createElement('div');
    scroller.append(slot);

    const observed: Element[] = [];
    const Original = view.ResizeObserver;
    view.ResizeObserver = class extends Original {
      override observe(target: Element, options?: ResizeObserverOptions): void {
        observed.push(target);
        super.observe(target, options);
      }
    } as typeof ResizeObserver;
    cleanups.push(() => (view.ResizeObserver = Original));

    editor.attach(slot);
    expect(observed).toContain(scroller);
  });

  test('reports the window it lives in to custom chrome', () => {
    const editor = editorWith('hello');
    expect(editorHostWindow(editor)).toBe(window as unknown as HostWindow);
    const view = popout();
    editor.attach(slotIn(view.document));
    expect(editorHostWindow(editor)).toBe(view);
    expect(editorHostDocument(editor)).toBe(view.document);
    editor.detach();
    expect(editorHostDocument(editor)).toBe(document);
  });
});

describe('a detached editor', () => {
  test('keeps working on its document and paints it on the next attach', () => {
    const editor = editorWith('hello');
    const home = slotIn(document);
    editor.attach(home);
    editor.detach();
    expect(editor.surface!.parked()).toBe(true);

    expect(editor.exec({ type: 'insertText', text: 'X' }).ok).toBe(true);
    expect(home.childNodes.length).toBe(0);

    const view = popout();
    const away = slotIn(view.document);
    editor.attach(away);
    expect(editor.surface!.parked()).toBe(false);
    expect(away.textContent).toContain('Xhello');
  });

  test('closes open history groups and refuses selection pins until it is attached', () => {
    const editor = editorWith('hello');
    editor.attach(slotIn(document));
    const group = editor.beginHistoryGroup();
    editor.detach();
    expect(group.state).toBe('closed');
    expect(editor.retainSelection()).toBeNull();
    editor.attach(slotIn(document));
    expect(group.state).toBe('closed');
    expect(editor.retainSelection()).not.toBeNull();
  });

  test('a load while detached replaces the kept document', () => {
    const editor = editorWith('hello');
    editor.attach(slotIn(document));
    const kept = editor.surface;
    editor.detach();
    editor.load(docx(p('other')));
    expect(editor.surface).toBeNull();
    const slot = slotIn(document);
    editor.attach(slot);
    expect(editor.surface).not.toBe(kept);
    expect(slot.textContent).toContain('other');
  });
});

describe('pages a host moved without telling the editor', () => {
  test('re-bind to their new window on the next interaction', () => {
    const editor = editorWith('hello');
    const slot = slotIn(document);
    editor.attach(slot);

    const view = popout();
    const awayDocument = listenerLog(view.document);
    // A Vue `Teleport` retargeted, or a plain `appendChild`: the mount element itself moves.
    view.document.body.append(slot);
    expect(awayDocument.added).not.toContain('selectionchange');

    const pages = slot.querySelector<HTMLElement>('.docx-pages')!;
    pages.dispatchEvent(new view.FocusEvent('focusin', { bubbles: true }));
    expect(awayDocument.added).toContain('selectionchange');
    expect(editorHostWindow(editor)).toBe(view);
  });
});

describe('work pending in a window that closes', () => {
  test('timers and frames move to a live window instead of being lost', async () => {
    const view = popout();
    const node = slotIn(view.document);
    let owner: Node = node;
    // A window about to close: what it is handed never runs.
    view.setTimeout = (() => 1) as unknown as typeof view.setTimeout;
    view.requestAnimationFrame = () => 1;
    const timers = hostTimers(() => owner);
    const ran: string[] = [];
    timers.setTimeout(() => ran.push('timeout'), 30);
    timers.requestAnimationFrame(() => ran.push('frame'));
    // The pages move home, then the pop-out closes before its work runs.
    owner = slotIn(document);
    view.dispatchEvent(new view.Event('pagehide'));
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(ran.sort()).toEqual(['frame', 'timeout']);
  });
});

describe('a move in the middle of an interaction', () => {
  test('copy writes to the clipboard of the window the editor is in', () => {
    const editor = editorWith('hello');
    editor.attach(slotIn(document));
    const view = popout();
    editor.attach(slotIn(view.document));
    const written: string[] = [];
    Object.defineProperty(view.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text: string) => void written.push(text) },
    });
    const paragraphId = editor.surface!.session.paragraphIds()[0]!;
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 5 },
    });
    expect(editor.exec({ type: 'copy' }).ok).toBe(true);
    expect(written).toEqual(['hello']);
  });

  test('a drag in progress stops listening to the window it started in', () => {
    const editor = editorWith('hello');
    const home = slotIn(document);
    editor.attach(home);
    const homeDocument = listenerLog(document);
    const pages = home.querySelector<HTMLElement>('.docx-pages')!;
    pages.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1, clientX: 5 })
    );
    expect(editor.surface!.state()).toBeTruthy();
    const view = popout();
    editor.attach(slotIn(view.document));
    const added = homeDocument.added.filter((type) => type === 'pointerup').length;
    const removed = homeDocument.removed.filter((type) => type === 'pointerup').length;
    expect(added).toBeGreaterThan(0);
    expect(removed).toBeGreaterThanOrEqual(added);
  });

  test('custom chrome hears about a move it did not make', () => {
    const editor = editorWith('hello');
    const slot = slotIn(document);
    editor.attach(slot);
    let notified = 0;
    editor.on('selectionChange', () => (notified += 1));
    const view = popout();
    view.document.body.append(slot);
    slot
      .querySelector('.docx-pages')!
      .dispatchEvent(new view.PointerEvent('pointerenter', { bubbles: false }));
    expect(notified).toBeGreaterThan(0);
    expect(editorHostDocument(editor)).toBe(view.document);
  });
});

test('pages a host moved under a live drag end the drag on the next interaction', () => {
  const editor = editorWith('hello');
  const slot = slotIn(document);
  editor.attach(slot);
  const homeDocument = listenerLog(document);
  const pages = slot.querySelector<HTMLElement>('.docx-pages')!;
  pages.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1, clientX: 5 })
  );
  const view = popout();
  view.document.body.append(slot);
  pages.dispatchEvent(new view.PointerEvent('pointerenter', { bubbles: false }));
  const added = homeDocument.added.filter((type) => type === 'pointermove').length;
  expect(added).toBe(1);
  const removed = homeDocument.removed.filter((type) => type === 'pointermove').length;
  expect(removed).toBeGreaterThanOrEqual(added);
});

test('a commit after an unannounced move repaints once, without re-entering the move', () => {
  const editor = editorWith('hello');
  const slot = slotIn(document);
  editor.attach(slot);
  editor.on('change', () => editor.relayout({ sync: true }));
  const view = popout();
  view.document.body.append(slot);
  expect(editor.exec({ type: 'insertText', text: 'X' }).ok).toBe(true);
  expect(slot.textContent).toContain('Xhello');
  expect(editorHostDocument(editor)).toBe(view.document);
});

test('host highlights follow edits made while the editor is detached', () => {
  const editor = editorWith('one TARGET end');
  const slot = slotIn(document);
  editor.attach(slot);
  expect(editor.setHighlights('terms', editor.findMatches('TARGET')).applied).toBe(1);
  editor.detach();
  const paragraphId = editor.surface!.session.paragraphIds()[0]!;
  const caretAt = (offset: number) =>
    editor.surface!.setSelection({
      anchor: { paragraphId, offset },
      head: { paragraphId, offset },
    });
  caretAt(0);
  editor.surface!.type('AA');
  caretAt(editor.surface!.session.bodyText().length);
  editor.surface!.type('ZZZ');
  editor.attach(slot);
  editor.surface!.flushPendingInput();
  expect(editor.surface!.session.bodyText()).toBe('AAone TARGET endZZZ');
  expect(slot.querySelectorAll('.docx-text-highlight').length).toBe(1);
});

test('content-control hover keeps working after a pending frame dies with its window', () => {
  const view = popout();
  const layer = view.document.createElement('div');
  view.document.body.append(layer);
  const requested: number[] = [];
  view.requestAnimationFrame = () => {
    requested.push(1);
    return 1;
  };
  // Imported lazily so the module reads the patched window.
  return import('../content-control-hover.ts').then(({ createContentControlHover }) => {
    const hover = createContentControlHover(layer);
    layer.dispatchEvent(new view.PointerEvent('pointermove', { clientX: 1, clientY: 1 }));
    expect(requested.length).toBe(1);
    document.body.append(layer);
    view.dispatchEvent(new view.Event('pagehide'));
    let homeFrames = 0;
    const original = window.requestAnimationFrame;
    window.requestAnimationFrame = ((run: FrameRequestCallback) => {
      homeFrames += 1;
      return original(run);
    }) as typeof window.requestAnimationFrame;
    cleanups.push(() => (window.requestAnimationFrame = original));
    return new Promise<void>((resolve) => setTimeout(resolve, 50)).then(() => {
      layer.dispatchEvent(new PointerEvent('pointermove', { clientX: 2, clientY: 2 }));
      expect(homeFrames).toBeGreaterThan(0);
      hover.destroy();
      layer.remove();
    });
  });
});

test('a fit frame pending in the old window never cancels the new window frames', () => {
  const view = popout();
  const observers: (() => void)[] = [];
  class RecordingObserver {
    constructor(callback: () => void) {
      observers.push(callback);
    }
    observe(): void {}
    disconnect(): void {}
  }
  const ownObservers = { home: window.ResizeObserver, away: view.ResizeObserver };
  window.ResizeObserver = view.ResizeObserver = RecordingObserver as never;
  cleanups.push(() => {
    window.ResizeObserver = ownObservers.home;
    view.ResizeObserver = ownObservers.away;
  });
  const scroller = document.createElement('div');
  scroller.className = 'docx-editor__scroll-container';
  Object.defineProperty(scroller, 'clientWidth', { value: 1000 });
  Object.defineProperty(scroller, 'clientHeight', { value: 500 });
  const slot = document.createElement('div');
  scroller.append(slot);
  document.body.append(scroller);
  cleanups.push(() => scroller.remove());
  const body = Array.from(
    { length: 12 },
    (_, i) =>
      `<w:p>${i ? '<w:pPr><w:pageBreakBefore/></w:pPr>' : ''}<w:r><w:t>PAGE${i}</w:t></w:r></w:p>`
  ).join('');
  const editor = createDocxEditor({ container: slot, document: docx(body) });
  cleanups.push(() => editor.destroy());
  // Two windows that number their frames independently, both starting low.
  const home = new Map<number, FrameRequestCallback>();
  const away = new Map<number, FrameRequestCallback>();
  let homeId = 0;
  let awayId = 1;
  const own = {
    request: window.requestAnimationFrame,
    cancel: window.cancelAnimationFrame,
    awayRequest: view.requestAnimationFrame,
    awayCancel: view.cancelAnimationFrame,
  };
  window.requestAnimationFrame = (run) => (home.set(++homeId, run), homeId);
  window.cancelAnimationFrame = (id) => void home.delete(id);
  view.requestAnimationFrame = (run) => (away.set(++awayId, run), awayId);
  view.cancelAnimationFrame = (id) => void away.delete(id);
  cleanups.push(() => {
    window.requestAnimationFrame = own.request;
    window.cancelAnimationFrame = own.cancel;
    view.requestAnimationFrame = own.awayRequest;
    view.cancelAnimationFrame = own.awayCancel;
  });
  for (const observe of [...observers]) observe();
  view.document.body.append(scroller);
  slot
    .querySelector('.docx-pages')!
    .dispatchEvent(new view.PointerEvent('pointerenter', { bubbles: false }));
  scroller.scrollTop = 6000;
  scroller.dispatchEvent(new view.Event('scroll'));
  for (const [id, run] of [...away]) {
    away.delete(id);
    run(0);
  }
  expect(slot.textContent).toContain('PAGE5');
});

test('a save from a change handler succeeds while the editor is detached', async () => {
  const editor = editorWith('hello');
  editor.attach(slotIn(document));
  editor.detach();
  let saved: Promise<number> | null = null;
  editor.on('change', () => {
    saved ??= editor.save().then((bytes) => bytes.byteLength);
  });
  expect(editor.exec({ type: 'insertText', text: 'X' }).ok).toBe(true);
  expect(await saved).toBeGreaterThan(0);
});

test('a frame pending in a hidden opener runs in the new window after a move', async () => {
  const view = popout();
  const home = slotIn(document);
  let owner: Node = home;
  const original = window.requestAnimationFrame;
  // A hidden opener runs no frames, and fires no `pagehide` either.
  window.requestAnimationFrame = () => 1;
  cleanups.push(() => (window.requestAnimationFrame = original));
  const timers = hostTimers(() => owner);
  let ran = 0;
  timers.requestAnimationFrame(() => (ran += 1));
  owner = slotIn(view.document);
  timers.migrate();
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(ran).toBe(1);
});

test('attach() with the same element re-binds when that element moved to another window', async () => {
  const view = popout();
  const scroller = document.createElement('div');
  scroller.className = 'docx-editor__scroll-container';
  let height = 500;
  Object.defineProperty(scroller, 'clientWidth', { get: () => 1000 });
  Object.defineProperty(scroller, 'clientHeight', { get: () => height });
  const slot = document.createElement('div');
  scroller.append(slot);
  document.body.append(scroller);
  cleanups.push(() => scroller.remove());
  const body = Array.from(
    { length: 12 },
    (_, i) =>
      `<w:p>${i ? '<w:pPr><w:pageBreakBefore/></w:pPr>' : ''}<w:r><w:t>PAGE${i}</w:t></w:r></w:p>`
  ).join('');
  const editor = createDocxEditor({ container: slot, document: docx(body) });
  cleanups.push(() => editor.destroy());
  view.document.body.append(scroller);
  height = 6000;
  editor.attach(slot);
  view.dispatchEvent(new view.Event('resize'));
  await new Promise((resolve) => setTimeout(resolve, 70));
  expect(slot.textContent).toContain('PAGE5');
});

test('a deferred open scheduled in a window that closes still mounts', async () => {
  const view = popout();
  // A window about to close: what it is handed never runs.
  view.setTimeout = (() => 1) as unknown as typeof view.setTimeout;
  view.requestAnimationFrame = () => 1;
  let node: Node = slotIn(view.document);
  const mounted: Uint8Array[] = [];
  const scheduler = createOpenScheduler({
    mount: (bytes) => mounted.push(bytes),
    scheduled: () => {},
    node: () => node,
  });
  const bytes = new Uint8Array([1, 2, 3]);
  scheduler.schedule(bytes);
  node = slotIn(document);
  view.dispatchEvent(new view.Event('pagehide'));
  await new Promise((resolve) => setTimeout(resolve, 350));
  expect(mounted).toEqual([bytes]);
});

describe('what the reader sees across a move', () => {
  const twelvePages = Array.from(
    { length: 12 },
    (_, i) =>
      `<w:p>${i ? '<w:pPr><w:pageBreakBefore/></w:pPr>' : ''}<w:r><w:t>PAGE${i}</w:t></w:r></w:p>`
  ).join('');

  function scrollerIn(doc: Document, width = 1000): { scroller: HTMLElement; slot: HTMLElement } {
    const scroller = doc.createElement('div');
    scroller.className = 'docx-editor__scroll-container';
    Object.defineProperty(scroller, 'clientWidth', { value: width });
    Object.defineProperty(scroller, 'clientHeight', { value: 500 });
    const slot = doc.createElement('div');
    scroller.append(slot);
    doc.body.append(scroller);
    cleanups.push(() => scroller.remove());
    return { scroller, slot };
  }

  test('the reading position survives a detach and an attach into another window', () => {
    const home = scrollerIn(document);
    const editor = createDocxEditor({ container: home.slot, document: docx(twelvePages) });
    cleanups.push(() => editor.destroy());
    home.scroller.scrollTop = 3000;
    editor.detach();
    const away = scrollerIn(popout().document);
    editor.attach(away.slot);
    expect(away.scroller.scrollTop).toBe(3000);
  });

  test('the reading position survives a move into a narrower window that refits the zoom', async () => {
    const home = scrollerIn(document);
    const editor = createDocxEditor({ container: home.slot, document: docx(twelvePages) });
    cleanups.push(() => editor.destroy());
    const before = editor.snapshot().zoom;
    home.scroller.scrollTop = 3000;
    const away = scrollerIn(popout().document, 600);
    editor.attach(away.slot);
    await Promise.resolve();
    const after = editor.snapshot().zoom;
    expect(after).toBeLessThan(before);
    // The same point of the document, in layout points, at the new scale.
    expect(away.scroller.scrollTop).toBeCloseTo((3000 / before) * after, 0);
  });

  test('pages that had focus get it back in the new window, with a caret', () => {
    const editor = editorWith('hello');
    const home = slotIn(document);
    editor.attach(home);
    home.querySelector<HTMLElement>('.docx-pages')!.focus();
    editor.detach();
    const view = popout();
    const away = slotIn(view.document);
    editor.attach(away);
    const pages = away.querySelector<HTMLElement>('.docx-pages')!;
    expect(view.document.activeElement).toBe(pages);
    expect(away.querySelector('[data-docx-caret]')).not.toBeNull();
  });

  test('focus: false leaves focus where it is', () => {
    const editor = editorWith('hello');
    const home = slotIn(document);
    editor.attach(home);
    home.querySelector<HTMLElement>('.docx-pages')!.focus();
    const view = popout();
    const away = slotIn(view.document);
    editor.attach(away, { focus: false });
    expect(view.document.activeElement).not.toBe(away.querySelector('.docx-pages'));
  });

  test('an element in a window that has closed is refused, and the editor stays', () => {
    const editor = editorWith('hello');
    const home = slotIn(document);
    editor.attach(home);
    const view = popout();
    const away = view.document.createElement('div');
    Object.defineProperty(view, 'closed', { configurable: true, value: true });
    const errors: { code?: string }[] = [];
    editor.on('error', (error) => errors.push(error));
    editor.attach(away);
    expect(errors.map((error) => error.code)).toEqual(['invalidTarget']);
    expect(home.textContent).toContain('hello');
    expect(away.childNodes.length).toBe(0);
  });
});

test('focus follows a move started from a button that took it a moment before', () => {
  const editor = editorWith('hello');
  const home = slotIn(document);
  editor.attach(home);
  const pages = home.querySelector<HTMLElement>('.docx-pages')!;
  pages.focus();
  // The "Pop out" control takes focus as it is pressed, just before the move.
  const button = document.createElement('button');
  document.body.append(button);
  cleanups.push(() => button.remove());
  button.focus();
  const view = popout();
  const away = slotIn(view.document);
  editor.detach();
  editor.attach(away);
  expect(view.document.activeElement).toBe(away.querySelector('.docx-pages'));
});

test('focus stays in a text field the reader moved to before the move', () => {
  const editor = editorWith('hello');
  const home = slotIn(document);
  editor.attach(home);
  home.querySelector<HTMLElement>('.docx-pages')!.focus();
  const field = document.createElement('input');
  document.body.append(field);
  cleanups.push(() => field.remove());
  field.focus();
  const view = popout();
  const away = slotIn(view.document);
  editor.attach(away);
  expect(view.document.activeElement).not.toBe(away.querySelector('.docx-pages'));
});

test('hostChange reports the new document on a first mount, a move and a detach', () => {
  const editor = editorWith('hello');
  const reported: (Document | null)[] = [];
  editor.on('hostChange', ({ document: doc }) => reported.push(doc));
  editor.attach(slotIn(document));
  const view = popout();
  editor.attach(slotIn(view.document));
  editor.attach(slotIn(view.document));
  editor.detach();
  expect(reported).toEqual([document, view.document, null]);
});
