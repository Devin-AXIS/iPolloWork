// The document and window an editor is mounted in.
//
// A host can mount the editor in a different document from the one its script runs in: a
// pop-out window opened with `window.open`, or a same-origin iframe. The script's globals
// (`document`, `window`, `setTimeout`, `ResizeObserver`, `HTMLElement`, ...) then belong to
// the OPENER, not to the document the pages paint in. Focus, selection, scroll, resize and
// pointer capture are per document, and the browser throttles an opener's timers and stops
// its animation frames while the opener is hidden. So every DOM-facing editor module resolves
// its realm from a node it owns, at the moment it needs it, never from the script globals and
// never once at construction: a mounted editor can move to another window (`attach`).
//
// `instanceof HTMLElement` is false for an element of another window, whose constructors are
// different objects. The guards below test `nodeType` and the tag name instead.

import type { Editor } from '../contracts/editor.ts';

/** The window type of a realm: its own timers, observers and constructors. */
export type HostWindow = Window & typeof globalThis;

/**
 * The document that owns `node`, or the script's own document when `node` is absent.
 * Without a DOM (server rendering) and without a node, this is `undefined` despite its type:
 * call it from effects and event handlers, not during render.
 *
 * Use it to add document-level listeners (`selectionchange`, `pointerup`, `keydown`) and to
 * read `activeElement` for an editor that may live in another window.
 *
 * @example
 * ```ts
 * const doc = hostDocumentOf(menuElement);
 * doc.addEventListener('pointerdown', onOutsidePress, true);
 * ```
 *
 * @public
 */
export function hostDocumentOf(node: Node | null | undefined): Document {
  if (node) {
    if (node.nodeType === 9) return node as Document;
    if (node.ownerDocument) return node.ownerDocument;
  }
  return globalThis.document;
}

/**
 * The window that owns `node`: its timers, animation frames, observers and viewport size.
 *
 * Falls back to the script's own window when the node's document has no window (an inert
 * document from `DOMParser`, or a window that closed), and to `globalThis` without a DOM.
 *
 * @example
 * ```ts
 * const win = hostWindowOf(anchorElement);
 * const handle = win.setTimeout(close, 300);
 * const maxX = win.innerWidth - menuWidth;
 * ```
 *
 * @public
 */
export function hostWindowOf(node: Node | null | undefined): HostWindow {
  // Optional: without a DOM (server rendering) there is no document to ask.
  const view = (hostDocumentOf(node) as Document | undefined)?.defaultView as
    HostWindow | null | undefined;
  return view ?? (globalThis as unknown as HostWindow);
}

/** The element each editor is mounted in now, registered by the editor itself. */
const editorHosts = new WeakMap<object, () => Element | null>();

/** Let {@link editorHostDocument} answer for `editor`. Called once by the editor factory. */
export function registerEditorHost(editor: object, host: () => Element | null): void {
  editorHosts.set(editor, host);
}

/**
 * The element `editor` is mounted in, or `null` while it is detached or headless.
 *
 * Use it to tell which editor an event belongs to when several share a window.
 *
 * @example
 * ```ts
 * const mine = editorHostElement(editor)?.contains(event.target as Node) ?? false;
 * ```
 *
 * @public
 */
export function editorHostElement(editor: Editor): Element | null {
  return hostElementOfEditor(editor);
}

/** {@link editorHostElement} for internal callers that hold a narrower view of the editor. */
export function hostElementOfEditor(editor: object): Element | null {
  return editorHosts.get(editor)?.() ?? null;
}

/**
 * Why `el` cannot take the editor, or `null` when it can: its document has no window (an
 * inert document from `DOMParser`) or its window has closed. Attaching there would paint
 * into a page nobody sees and bind listeners nothing fires.
 */
export function attachTargetRefusal(el: Element): string | null {
  const view = el.ownerDocument?.defaultView;
  if (!view) return 'attach() needs an element in a document with a window; this one has none';
  if (view.closed) return 'attach() needs an element in an open window; this window has closed';
  return null;
}

/**
 * The document `editor` is mounted in: a pop-out window's or an iframe's when it is
 * attached there. While the editor is detached, the script's own document.
 *
 * Use it in custom chrome that is not inside the editor's own DOM, such as a toolbar
 * popover, to add document listeners and to read focus.
 *
 * @example
 * ```ts
 * const doc = editorHostDocument(editor);
 * doc.addEventListener('keydown', onShortcut);
 * ```
 *
 * @public
 */
export function editorHostDocument(editor: Editor): Document {
  return hostDocumentOf(hostElementOfEditor(editor));
}

/**
 * The window `editor` is mounted in: its timers, frames, viewport size and clipboard.
 * While the editor is detached, the script's own window.
 *
 * @example
 * ```ts
 * const win = editorHostWindow(editor);
 * await win.navigator.clipboard.writeText(text);
 * ```
 *
 * @public
 */
export function editorHostWindow(editor: Editor): HostWindow {
  return hostWindowOf(hostElementOfEditor(editor));
}

/**
 * Whether `value` is a DOM element of any window. Use it instead of `instanceof Element`,
 * which is false for an element of a pop-out window or an iframe.
 *
 * @example
 * ```ts
 * if (isElementNode(event.target)) event.target.closest('[data-docx-hf]');
 * ```
 *
 * @public
 */
export function isElementNode(value: unknown): value is Element {
  return (
    typeof value === 'object' && value !== null && (value as { nodeType?: unknown }).nodeType === 1
  );
}

/**
 * Whether `value` is an HTML (not SVG or MathML) element of any window.
 *
 * @example
 * ```ts
 * if (isHTMLElementNode(event.target)) event.target.focus();
 * ```
 *
 * @public
 */
export function isHTMLElementNode(value: unknown): value is HTMLElement {
  return isElementNode(value) && value.namespaceURI === 'http://www.w3.org/1999/xhtml';
}

/**
 * Whether `value` is a DOM text node of any window.
 *
 * @example
 * ```ts
 * const anchor = selection.anchorNode;
 * const element = isTextNode(anchor) ? anchor.parentElement : anchor;
 * ```
 *
 * @public
 */
export function isTextNode(value: unknown): value is Text {
  return (
    typeof value === 'object' && value !== null && (value as { nodeType?: unknown }).nodeType === 3
  );
}

/**
 * Whether `value` is a DOM node of any window.
 *
 * @example
 * ```ts
 * if (isDomNode(event.target) && panel.contains(event.target)) return;
 * ```
 *
 * @public
 */
export function isDomNode(value: unknown): value is Node {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { nodeType?: unknown }).nodeType === 'number' &&
    typeof (value as { nodeName?: unknown }).nodeName === 'string'
  );
}

/** Whether `value` is an HTML element with the given lower-case tag name, in any window. */
export function isHTMLElementTag<K extends keyof HTMLElementTagNameMap>(
  value: unknown,
  tag: K
): value is HTMLElementTagNameMap[K] {
  return isHTMLElementNode(value) && value.localName === tag;
}

/**
 * Timers that run on the window `node` belongs to, resolved at each call.
 *
 * A handle is cleared on the window that issued it, so a timer set before the editor moved
 * to another window is still cancelled after the move. Handles are this object's own numbers:
 * two windows count their native handles independently, so a native number alone could name
 * a timer in either one. Clear them with this object, never with the global `clearTimeout`.
 *
 * @public
 */
export interface HostTimers {
  setTimeout(run: () => void, delay?: number): number;
  clearTimeout(handle: number | null | undefined): void;
  requestAnimationFrame(run: (time: number) => void): number;
  cancelAnimationFrame(handle: number | null | undefined): void;
  /**
   * Move pending work to the window the node lives in now. Every other call does this first;
   * call it yourself where you only check whether something is pending. A hidden opener runs
   * no frames and fires no `pagehide`, so work left there would wait until it is shown again.
   */
  migrate(): void;
}

/** The script's own window: always alive while this code runs. */
function scriptWindow(): HostWindow {
  return globalThis as unknown as HostWindow;
}

/**
 * {@link HostTimers} bound to whatever window `node()` lives in when each call runs.
 *
 * Use it for debounces and frames in chrome that can end up in a pop-out window: the opener's
 * timers are throttled while it is hidden, and a pop-out's never run once it closes.
 *
 * @example
 * ```ts
 * const timers = hostTimers(() => panelElement);
 * let pending: number | null = null;
 * function schedule() {
 *   timers.clearTimeout(pending);
 *   pending = timers.setTimeout(refresh, 150);
 * }
 * ```
 *
 * @public
 *
 * A window that goes away (a pop-out the user closes) never runs what is pending in it, and a
 * dropped commit, notification or search is worse than a late one. So each window with pending
 * work is watched for `pagehide`, and its pending timers and frames move to the window the node
 * lives in by then, or to the script's own window.
 */
export function hostTimers(node: () => Node | null | undefined): HostTimers {
  interface Pending {
    readonly kind: 'timeout' | 'frame';
    win: HostWindow;
    native: number;
    readonly fire: (time: number) => void;
    readonly dueAt: number;
  }
  let next = 0;
  const pending = new Map<number, Pending>();
  const watched = new Map<HostWindow, () => void>();

  function arm(entry: Pending, win: HostWindow): void {
    entry.win = win;
    entry.native =
      entry.kind === 'frame' && typeof win.requestAnimationFrame === 'function'
        ? win.requestAnimationFrame(entry.fire)
        : (win.setTimeout(
            () => entry.fire(win.performance?.now() ?? Date.now()),
            Math.max(0, entry.dueAt - Date.now())
          ) as unknown as number);
    watch(win);
  }
  function disarm(entry: Pending): void {
    if (entry.kind === 'frame' && typeof entry.win.cancelAnimationFrame === 'function')
      entry.win.cancelAnimationFrame(entry.native);
    else entry.win.clearTimeout(entry.native);
  }
  function watch(win: HostWindow): void {
    if (watched.has(win) || win === scriptWindow()) return;
    const onHide = (): void => {
      unwatch(win);
      const current = hostWindowOf(node());
      const target = current === win ? scriptWindow() : current;
      for (const entry of pending.values()) {
        if (entry.win !== win) continue;
        disarm(entry);
        arm(entry, target);
      }
    };
    win.addEventListener('pagehide', onHide);
    watched.set(win, onHide);
  }
  function unwatch(win: HostWindow): void {
    const onHide = watched.get(win);
    if (!onHide) return;
    watched.delete(win);
    win.removeEventListener('pagehide', onHide);
  }
  function settle(handle: number): void {
    const entry = pending.get(handle);
    if (!entry) return;
    pending.delete(handle);
    for (const other of pending.values()) if (other.win === entry.win) return;
    unwatch(entry.win);
  }
  function migrate(): void {
    if (pending.size === 0) return;
    const current = hostWindowOf(node());
    for (const entry of pending.values()) {
      if (entry.win === current) continue;
      const previous = entry.win;
      disarm(entry);
      arm(entry, current);
      let stillWatched = false;
      for (const other of pending.values()) if (other.win === previous) stillWatched = true;
      if (!stillWatched) unwatch(previous);
    }
  }
  function schedule(kind: Pending['kind'], run: (time: number) => void, delay = 0): number {
    migrate();
    const handle = ++next;
    const entry: Pending = {
      kind,
      win: scriptWindow(),
      native: 0,
      dueAt: Date.now() + delay,
      fire: (time) => {
        settle(handle);
        run(time);
      },
    };
    pending.set(handle, entry);
    arm(entry, hostWindowOf(node()));
    return handle;
  }
  function cancel(handle: number | null | undefined): void {
    if (handle == null) return;
    const entry = pending.get(handle);
    if (!entry) return;
    disarm(entry);
    settle(handle);
  }

  return {
    setTimeout: (run, delay) => schedule('timeout', () => run(), delay),
    clearTimeout: cancel,
    requestAnimationFrame: (run) => schedule('frame', run),
    cancelAnimationFrame: cancel,
    migrate,
  };
}

// Event guards. An event dispatched in another window is an instance of THAT window's event
// classes, so `instanceof KeyboardEvent` is false for a key pressed in a pop-out. They test the
// event's own fields instead.

/**
 * Whether `event` is a keyboard event, from any window.
 *
 * @example
 * ```ts
 * if (isKeyboardEvent(event) && event.key === 'Escape') close();
 * ```
 *
 * @public
 */
export function isKeyboardEvent(event: Event): event is KeyboardEvent {
  return typeof (event as Partial<KeyboardEvent>).key === 'string' && 'repeat' in event;
}

/**
 * Whether `event` is a pointer event, from any window.
 *
 * @example
 * ```ts
 * if (isPointerEvent(event) && event.button !== 0) return;
 * ```
 *
 * @public
 */
export function isPointerEvent(event: Event): event is PointerEvent {
  return typeof (event as Partial<PointerEvent>).pointerId === 'number';
}

/**
 * Whether `event` is a mouse (or pointer) event, from any window.
 *
 * @example
 * ```ts
 * const point = isMouseEvent(event) ? { x: event.clientX, y: event.clientY } : null;
 * ```
 *
 * @public
 */
export function isMouseEvent(event: Event): event is MouseEvent {
  return typeof (event as Partial<MouseEvent>).button === 'number' && 'clientX' in event;
}

/**
 * Whether `event` is an `input` or `beforeinput` event, from any window.
 *
 * @example
 * ```ts
 * if (isInputEvent(event) && event.inputType === 'insertText') track(event.data);
 * ```
 *
 * @public
 */
export function isInputEvent(event: Event): event is InputEvent {
  return typeof (event as Partial<InputEvent>).inputType === 'string';
}
