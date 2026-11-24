// The shared Escape and focus-leave rules for toolbar popups.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { afterEach, describe, expect, test } from 'bun:test';
import { listenForPopupEscape, listenForPopupFocusLeave } from '../popup-escape.ts';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** An editor: a chrome root with a popup, and an instance container with pages. */
function editorFixture() {
  const instance = document.createElement('div');
  instance.className = 'docx-editor';
  const chrome = document.createElement('div');
  chrome.className = 'docx-editor';
  const popup = document.createElement('div');
  const option = document.createElement('button');
  popup.append(option);
  const chromeButton = document.createElement('button');
  chrome.append(popup, chromeButton);
  const pages = document.createElement('div');
  pages.className = 'docx-pages';
  pages.tabIndex = 0;
  const pane = document.createElement('input');
  instance.append(chrome, pages, pane);
  const host = document.createElement('input');
  document.body.append(instance, host);
  cleanups.push(() => {
    instance.remove();
    host.remove();
  });
  return { instance, chrome, popup, option, chromeButton, pages, pane, host };
}

function escape(target: EventTarget): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
    composed: true,
  });
  target.dispatchEvent(event);
  return event;
}

describe('listenForPopupFocusLeave', () => {
  test('focus in the popup or in the pages keeps it open; focus elsewhere closes it', () => {
    const view = editorFixture();
    let closed = 0;
    cleanups.push(
      listenForPopupFocusLeave({
        popup: view.popup,
        contains: (node) => view.popup.contains(node),
        close: () => {
          closed += 1;
        },
      })
    );
    view.option.focus();
    view.pages.focus();
    expect(closed).toBe(0);
    view.pane.focus();
    expect(closed).toBe(1);
    view.host.focus();
    expect(closed).toBe(2);
  });

  function modal(marked: boolean) {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    if (marked) dialog.setAttribute('data-docx-dialog', 'paragraph');
    const field = document.createElement('input');
    dialog.append(field);
    document.body.append(dialog);
    cleanups.push(() => dialog.remove());
    return field;
  }

  function countCloses(view: ReturnType<typeof editorFixture>) {
    const state = { closed: 0 };
    cleanups.push(
      listenForPopupFocusLeave({
        popup: view.popup,
        contains: (node) => view.popup.contains(node),
        close: () => {
          state.closed += 1;
        },
      })
    );
    return state;
  }

  test("focus that enters the editor's own modal dialog keeps the popup open", () => {
    const view = editorFixture();
    const field = modal(true);
    const state = countCloses(view);
    field.focus();
    expect(state.closed).toBe(0);
  });

  test("focus that enters a host's modal dialog closes the popup", () => {
    const view = editorFixture();
    const field = modal(false);
    const state = countCloses(view);
    field.focus();
    expect(state.closed).toBe(1);
  });

  test("focus in the editor's native showModal dialog keeps the popup open", () => {
    const view = editorFixture();
    const dialog = document.createElement('dialog');
    dialog.setAttribute('data-docx-modal', '');
    const field = document.createElement('input');
    dialog.append(field);
    document.body.append(dialog);
    cleanups.push(() => dialog.remove());
    const state = countCloses(view);
    field.focus();
    expect(state.closed).toBe(0);
  });

  test('a modal dialog inside the editor instance counts as its own', () => {
    const view = editorFixture();
    const dialog = document.createElement('div');
    dialog.setAttribute('aria-modal', 'true');
    const field = document.createElement('input');
    dialog.append(field);
    view.instance.append(dialog);
    const state = countCloses(view);
    field.focus();
    expect(state.closed).toBe(0);
  });
});

describe('listenForPopupEscape', () => {
  function listen(view: ReturnType<typeof editorFixture>, closes: boolean[]) {
    cleanups.push(
      listenForPopupEscape({
        popup: view.popup,
        contains: (node) => view.popup.contains(node),
        chromeRoot: () => view.chrome,
        close: (fromInside) => {
          closes.push(fromInside);
        },
      })
    );
  }

  test('Escape from the chrome root or the pages is this editor’s, and is stopped', () => {
    const view = editorFixture();
    const closes: boolean[] = [];
    listen(view, closes);
    expect(escape(view.chromeButton).defaultPrevented).toBe(true);
    expect(escape(view.pages).defaultPrevented).toBe(true);
    expect(escape(view.option).defaultPrevented).toBe(true);
    expect(closes).toEqual([false, false, true]);
  });

  test('Escape from a host input closes the popup and keeps its default', () => {
    const view = editorFixture();
    const closes: boolean[] = [];
    listen(view, closes);
    expect(escape(view.host).defaultPrevented).toBe(false);
    expect(closes).toEqual([false]);
  });

  test('Escape from inside a shadow root in the popup counts as inside', () => {
    const view = editorFixture();
    const shadowHost = document.createElement('div');
    view.popup.append(shadowHost);
    const shadow = shadowHost.attachShadow({ mode: 'open' });
    const inner = document.createElement('button');
    shadow.append(inner);
    const closes: boolean[] = [];
    listen(view, closes);
    // The event is retargeted to the shadow host at the document; the composed path still
    // starts at the inner button, which the popup's subtree holds through its host.
    expect(escape(inner).defaultPrevented).toBe(true);
    expect(closes.length).toBe(1);
  });

  test("Escape in a host's modal dialog closes the popup and keeps its default", () => {
    const view = editorFixture();
    const dialog = document.createElement('div');
    dialog.setAttribute('aria-modal', 'true');
    const field = document.createElement('input');
    dialog.append(field);
    document.body.append(dialog);
    cleanups.push(() => dialog.remove());
    const closes: boolean[] = [];
    listen(view, closes);
    expect(escape(field).defaultPrevented).toBe(false);
    expect(closes).toEqual([false]);
  });

  test("Escape in the editor's own modal dialog is left to the dialog", () => {
    const view = editorFixture();
    const dialog = document.createElement('div');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('data-docx-dialog', 'paragraph');
    const field = document.createElement('input');
    dialog.append(field);
    document.body.append(dialog);
    cleanups.push(() => dialog.remove());
    const closes: boolean[] = [];
    listen(view, closes);
    expect(escape(field).defaultPrevented).toBe(false);
    expect(closes).toEqual([]);
  });
});
