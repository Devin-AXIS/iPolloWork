// The shared outside-press rule for popups.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { afterEach, describe, expect, test } from 'bun:test';
import { listenForOutsidePress } from '../popup-escape.ts';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** A popup with an item, and painted pages that cancel their own presses. */
function fixture(doc: Document = document) {
  const popup = doc.createElement('div');
  const item = doc.createElement('button');
  popup.append(item);
  const pages = doc.createElement('div');
  pages.className = 'docx-pages';
  const text = doc.createElement('span');
  pages.append(text);
  // The surface cancels the press and keeps it to itself, as the painted pages do.
  pages.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  doc.body.append(popup, pages);
  cleanups.push(() => {
    popup.remove();
    pages.remove();
  });
  return { popup, item, pages, text };
}

function press(target: EventTarget, type = 'pointerdown'): Event {
  const event = new PointerEvent(type, { bubbles: true, cancelable: true, composed: true });
  target.dispatchEvent(event);
  return event;
}

describe('listenForOutsidePress', () => {
  test('a press on the pages closes the popup, even when the pages cancel it', () => {
    const view = fixture();
    let closed = 0;
    cleanups.push(listenForOutsidePress({ popup: view.popup, close: () => (closed += 1) }));
    const event = press(view.text);
    expect(event.defaultPrevented).toBe(true);
    expect(closed).toBe(1);
  });

  test('a press inside the popup keeps it open', () => {
    const view = fixture();
    let closed = 0;
    cleanups.push(listenForOutsidePress({ popup: view.popup, close: () => (closed += 1) }));
    press(view.item);
    press(view.popup);
    expect(closed).toBe(0);
  });

  test('only pointerdown counts, so a press closes the popup once', () => {
    const view = fixture();
    let closed = 0;
    cleanups.push(listenForOutsidePress({ popup: view.popup, close: () => (closed += 1) }));
    view.text.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(closed).toBe(0);
    press(document.body);
    expect(closed).toBe(1);
  });

  test('a custom membership test keeps a separate trigger and menu open', () => {
    const view = fixture();
    const trigger = document.createElement('button');
    document.body.append(trigger);
    cleanups.push(() => trigger.remove());
    let closed = 0;
    cleanups.push(
      listenForOutsidePress({
        popup: trigger,
        contains: (node) => trigger.contains(node) || view.popup.contains(node),
        close: () => (closed += 1),
      })
    );
    press(trigger);
    press(view.item);
    expect(closed).toBe(0);
    press(view.text);
    expect(closed).toBe(1);
  });

  test('a press inside a shadow root that the popup holds keeps it open', () => {
    const view = fixture();
    const host = document.createElement('span');
    view.popup.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const inner = document.createElement('button');
    shadow.append(inner);
    let closed = 0;
    cleanups.push(listenForOutsidePress({ popup: view.popup, close: () => (closed += 1) }));
    press(inner);
    expect(closed).toBe(0);
  });

  test('the listener sits on the popup document, not on the script document', () => {
    const other = document.implementation.createHTMLDocument('pop-out');
    const view = fixture(other);
    let closed = 0;
    cleanups.push(listenForOutsidePress({ popup: view.popup, close: () => (closed += 1) }));
    press(document.body);
    expect(closed).toBe(0);
    press(view.text);
    expect(closed).toBe(1);
  });

  test('the disposer removes the listener', () => {
    const view = fixture();
    let closed = 0;
    const stop = listenForOutsidePress({ popup: view.popup, close: () => (closed += 1) });
    stop();
    press(view.text);
    expect(closed).toBe(0);
  });
});
