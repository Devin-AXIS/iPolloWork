// Opening a pop-out window for the editor: the boilerplate every host would otherwise copy.
//
// A pop-out starts with no styles, needs a mount point, and goes away when the user closes
// it, at which point the editor has to be somewhere else already. This module opens the
// window, mirrors the opener's stylesheets into it (including ones added later), makes the
// mount point, and reports the close while the window's document still exists.

/** Options for {@link openEditorWindow}. @public */
export interface OpenEditorWindowOptions {
  /**
   * A same-origin page to open. Defaults to `about:blank`, which needs no file on your server.
   * A served page (an empty HTML file) gives the window a real URL and lets it load its own
   * scripts or fonts first.
   */
  readonly url?: string;
  /**
   * The window name passed to `window.open`. Defaults to `docx-editor`. Windows opened with
   * the same name are one browser window, so give each editor its own name.
   */
  readonly name?: string;
  /** The `window.open` features. Defaults to `popup,width=1000,height=900`. */
  readonly features?: string;
  /** The pop-out's title. */
  readonly title?: string;
  /**
   * Copy the opener's stylesheets, and keep copying the ones it adds later. Defaults to `true`.
   * Pass `false` to style the window yourself, or a function that copies and returns a stop.
   */
  readonly styles?: boolean | ((from: Document, to: Document) => () => void);
}

/** A pop-out window opened by {@link openEditorWindow}. @public */
export interface EditorWindow {
  /** The pop-out window. */
  readonly window: Window;
  /** The mount point: attach the editor, or render the editor panel, here. */
  readonly element: HTMLElement;
  /**
   * Run `listener` once when the window goes away: the user closed it, or you called
   * `close()`. It runs while the window's document still exists, so move the editor back
   * from here. Returns a function that removes the listener.
   */
  onClose(listener: () => void): () => void;
  /** Close the window. Runs the `onClose` listeners first. */
  close(): void;
}

const DEFAULT_FEATURES = 'popup,width=1000,height=900';
/** Attributes on `<html>` that themes and dark modes key on. */
const ROOT_ATTRIBUTES = ['class', 'style', 'data-theme', 'data-color-mode', 'dir', 'lang'];

/**
 * Open a pop-out window ready for the editor: same origin, styled like this page, with an
 * empty mount point that fills it.
 *
 * Resolves to `null` when the browser blocks the window, so call it from a user gesture such
 * as a button click. The React `DocxEditor.Window` and Vue `DocxEditorWindow` components use
 * it; call it directly when you mount the editor without an adapter.
 *
 * @example
 * ```ts
 * const popup = await openEditorWindow({ title: 'Contract' });
 * if (popup) {
 *   editor.attach(popup.element);
 *   popup.onClose(() => editor.attach(homeElement));
 * }
 * ```
 *
 * @public
 */
export async function openEditorWindow(
  options: OpenEditorWindowOptions = {}
): Promise<EditorWindow | null> {
  const opener = globalThis.window as (Window & typeof globalThis) | undefined;
  if (!opener?.open) return null;
  const url = options.url ?? 'about:blank';
  const view = opener.open(
    url,
    options.name ?? 'docx-editor',
    options.features ?? DEFAULT_FEATURES
  );
  if (!view) return null;
  if (url !== 'about:blank') await loaded(view);
  const doc = view.document;
  if (options.title) doc.title = options.title;
  doc.body.style.margin = '0';
  const element = doc.createElement('div');
  element.style.height = '100vh';
  doc.body.append(element);

  const styles = options.styles ?? true;
  const stopStyles =
    styles === false
      ? () => {}
      : styles === true
        ? copyEditorStyles(opener.document, doc)
        : styles(opener.document, doc);

  const listeners = new Set<() => void>();
  let closed = false;
  const finish = (): void => {
    if (closed) return;
    closed = true;
    view.removeEventListener('pagehide', finish);
    opener.removeEventListener('pagehide', closeWindow);
    stopStyles();
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        console.error(error);
      }
    }
    listeners.clear();
  };
  const closeWindow = (): void => {
    finish();
    view.close();
  };
  view.addEventListener('pagehide', finish);
  // Leaving the page takes the pop-out with it: nothing could move the editor back later.
  opener.addEventListener('pagehide', closeWindow);

  return {
    window: view,
    element,
    onClose(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close: closeWindow,
  };
}

/** Resolve once `view` has loaded the page it was opened on. */
function loaded(view: Window): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    view.addEventListener('load', finish, { once: true });
    // Already loaded (a cached page, or a window that was open before) fires no `load`.
    try {
      if (view.document.readyState === 'complete' && view.location.href !== 'about:blank') {
        finish();
      }
    } catch {
      // Not readable yet: wait for `load`.
    }
  });
}

/**
 * Copy every stylesheet of `from` into `to`, and keep copying the ones `from` adds later.
 *
 * Covers `<link rel="stylesheet">` and `<style>` elements added, changed or removed at any
 * time; rules inserted into a same-origin `<style>` through the CSSOM (CSS-in-JS libraries in
 * production), checked every 250 ms on the pop-out's own clock while it is open; constructed
 * `adoptedStyleSheets`, checked the same way; and the theme attributes on `<html>` such as `class` and `data-theme`. Rules
 * inserted into a `<link>` sheet, or any sheet of another origin, are not copied. Returns a
 * function that stops the mirroring.
 *
 * @example
 * ```ts
 * const stop = copyEditorStyles(document, popup.document);
 * // Later, when the pop-out closes:
 * stop();
 * ```
 *
 * @public
 */
export function copyEditorStyles(from: Document, to: Document): () => void {
  const copies = new Map<Node, Node>();
  const copySheet = (node: Element): void => {
    if (copies.has(node)) return;
    const copy = to.importNode(node, true) as Element;
    // A `<style>` filled through `insertRule` has no text to clone: copy its live rules.
    const sheet = (node as HTMLStyleElement).sheet;
    if (node.localName === 'style' && sheet && !(node.textContent ?? '').trim()) {
      copy.textContent = rulesOf(sheet);
    }
    to.head.append(copy);
    copies.set(node, copy);
  };
  const isSheet = (node: Node): node is Element =>
    node.nodeType === 1 &&
    ((node as Element).localName === 'style' ||
      ((node as Element).localName === 'link' &&
        ((node as Element).getAttribute('rel') ?? '').split(/\s+/).includes('stylesheet')));
  for (const node of Array.from(from.querySelectorAll('link[rel~="stylesheet"], style'))) {
    copySheet(node);
  }
  // Constructed sheets have no element to clone: one `<style>` carries their rules.
  const adoptedCopy = to.createElement('style');
  adoptedCopy.dataset.docxAdopted = '';
  to.head.append(adoptedCopy);
  let adoptedKey = '';
  const copyAdopted = (): void => {
    const sheets =
      (from as Document & { adoptedStyleSheets?: CSSStyleSheet[] }).adoptedStyleSheets ?? [];
    const key = sheets.map((sheet) => ruleCount(sheet)).join(',');
    if (key === adoptedKey) return;
    adoptedKey = key;
    adoptedCopy.textContent = sheets.map(rulesOf).join('\n');
  };
  copyAdopted();
  const copyRootAttributes = (): void => {
    for (const name of ROOT_ATTRIBUTES) {
      const value = from.documentElement.getAttribute(name);
      if (value === null) to.documentElement.removeAttribute(name);
      else to.documentElement.setAttribute(name, value);
    }
  };
  copyRootAttributes();

  // Rules inserted through the CSSOM after the copy (CSS-in-JS adds them as components first
  // render) change no DOM, so no observer reports them: compare rule counts a few times a
  // second, on the pop-out's own clock, and copy a sheet again when its count moved.
  const counts = new Map<Element, number>();
  const pollRules = (): void => {
    for (const [source, copy] of copies) {
      const sheet = (source as HTMLStyleElement).sheet;
      if ((source as Element).localName !== 'style' || !sheet) continue;
      const count = ruleCount(sheet);
      if (counts.get(source as Element) === count) continue;
      const first = !counts.has(source as Element);
      counts.set(source as Element, count);
      // The first look only records: the copy already has the element's text or rules.
      if (!first) copy.textContent = rulesOf(sheet);
    }
    copyAdopted();
  };
  pollRules();
  const poll = to.defaultView?.setInterval(pollRules, CSSOM_POLL_MS);
  const stopPolling = (): void => {
    if (poll !== undefined) to.defaultView?.clearInterval(poll);
  };

  const View = from.defaultView?.MutationObserver;
  if (typeof View !== 'function') return stopPolling;
  const observer = new View((records) => {
    for (const record of records) {
      if (record.type === 'attributes') {
        copyRootAttributes();
        continue;
      }
      for (const node of Array.from(record.addedNodes)) {
        if (isSheet(node)) copySheet(node);
        else if (node.nodeType === 1) {
          for (const inner of Array.from((node as Element).querySelectorAll('style, link'))) {
            if (isSheet(inner)) copySheet(inner);
          }
        }
      }
      for (const node of Array.from(record.removedNodes)) {
        const copy = copies.get(node);
        if (!copy) continue;
        copies.delete(node);
        copy.parentNode?.removeChild(copy);
      }
      // A `<style>` whose text changed in place (a dev server's hot update).
      const target = record.target as Element;
      if (record.type === 'characterData' || (target.localName === 'style' && copies.has(target))) {
        const owner =
          record.type === 'characterData' ? (record.target.parentNode as Element) : target;
        const copy = owner && copies.get(owner);
        if (copy) copy.textContent = owner.textContent;
      }
    }
  });
  observer.observe(from.head, { childList: true, subtree: true, characterData: true });
  observer.observe(from.documentElement, { attributes: true, attributeFilter: ROOT_ATTRIBUTES });
  return () => {
    observer.disconnect();
    stopPolling();
  };
}

/** How often {@link copyEditorStyles} looks for rules inserted through the CSSOM. */
const CSSOM_POLL_MS = 250;

/** How many rules a stylesheet has, or -1 when another origin keeps them private. */
function ruleCount(sheet: CSSStyleSheet): number {
  try {
    return sheet.cssRules.length;
  } catch {
    return -1;
  }
}

/** The text of a stylesheet's rules, or empty when another origin keeps them private. */
function rulesOf(sheet: CSSStyleSheet): string {
  try {
    return Array.from(sheet.cssRules, (rule) => rule.cssText).join('\n');
  } catch {
    return '';
  }
}
