// `openEditorWindow` and `copyEditorStyles`: a pop-out ready for the editor, styled like the
// opener and reporting its close while its document still exists.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { copyEditorStyles, openEditorWindow } from '../editor-window.ts';

type HostWindow = Window & typeof globalThis;

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

/** A second window, as `window.open` would give, standing in for the real pop-out. */
function stubOpen(): { opened: () => HostWindow | null; calls: string[] } {
  const calls: string[] = [];
  let view: HostWindow | null = null;
  const original = window.open;
  window.open = ((url?: string | URL) => {
    calls.push(String(url));
    const frame = document.createElement('iframe');
    document.body.append(frame);
    cleanups.push(() => frame.remove());
    view = frame.contentWindow as HostWindow;
    view.close = () => {};
    return view;
  }) as typeof window.open;
  cleanups.push(() => (window.open = original));
  return { opened: () => view, calls };
}

function addStyle(doc: Document, css: string): HTMLStyleElement {
  const style = doc.createElement('style');
  style.textContent = css;
  doc.head.append(style);
  cleanups.push(() => style.remove());
  return style;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('openEditorWindow', () => {
  test('mirrors rules inserted through the CSSOM after the window opened', async () => {
    const style = addStyle(document, '');
    stubOpen();
    const popup = await openEditorWindow();
    const doc = popup!.window.document;
    style.sheet!.insertRule('.css-in-js { color: purple; }');
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(doc.head.textContent).toContain('css-in-js');
    popup!.close();
  });

  test('opens a styled window with a mount point that fills it', async () => {
    addStyle(document, '.docx-editor { color: red; }');
    const stub = stubOpen();
    const popup = await openEditorWindow({ title: 'Contract' });
    expect(popup).not.toBeNull();
    expect(stub.calls).toEqual(['about:blank']);
    const doc = popup!.window.document;
    expect(doc.title).toBe('Contract');
    expect(popup!.element.ownerDocument).toBe(doc);
    expect(popup!.element.style.height).toBe('100vh');
    expect(doc.head.textContent).toContain('.docx-editor { color: red; }');
    popup!.close();
  });

  test('keeps copying stylesheets the opener adds later, until it closes', async () => {
    stubOpen();
    const popup = await openEditorWindow();
    const doc = popup!.window.document;
    addStyle(document, '.late { color: blue; }');
    await flush();
    expect(doc.head.textContent).toContain('.late { color: blue; }');
    popup!.close();
    addStyle(document, '.after-close { color: green; }');
    await flush();
    expect(doc.head.textContent).not.toContain('.after-close');
  });

  test('reports the close once, while the window still exists', async () => {
    const stub = stubOpen();
    const popup = await openEditorWindow();
    const closes: Document[] = [];
    popup!.onClose(() => closes.push(popup!.window.document));
    stub.opened()!.dispatchEvent(new Event('pagehide'));
    popup!.close();
    expect(closes).toEqual([popup!.window.document]);
  });

  test('closing from code runs the close listeners too', async () => {
    stubOpen();
    const popup = await openEditorWindow({ styles: false });
    let closed = 0;
    const stop = popup!.onClose(() => (closed += 1));
    popup!.close();
    expect(closed).toBe(1);
    stop();
  });

  test('a blocked window resolves to null', async () => {
    const original = window.open;
    window.open = (() => null) as typeof window.open;
    cleanups.push(() => (window.open = original));
    expect(await openEditorWindow()).toBeNull();
  });
});

describe('copyEditorStyles', () => {
  test('copies the theme attributes on the root element and follows changes', async () => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    cleanups.push(() => frame.remove());
    const target = frame.contentWindow!.document;
    document.documentElement.setAttribute('data-theme', 'dark');
    cleanups.push(() => document.documentElement.removeAttribute('data-theme'));
    const stop = copyEditorStyles(document, target);
    expect(target.documentElement.getAttribute('data-theme')).toBe('dark');
    document.documentElement.setAttribute('data-theme', 'light');
    await flush();
    expect(target.documentElement.getAttribute('data-theme')).toBe('light');
    stop();
  });
});
