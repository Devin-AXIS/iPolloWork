import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { expect, test } from 'bun:test';
import { createContentControlListNavigation } from '../content-control-list-navigation.ts';
import {
  contentControlPopupKeyDown,
  positionContentControlPopup,
  observeContentControlPopup,
} from '../content-control-popup-behavior.ts';

test('list typeahead cycles repeated letters and respects native input keys and composition', () => {
  const root = document.createElement('div');
  document.body.append(root);
  const navigation = createContentControlListNavigation('pl-PL');
  const options = ['Alpha', 'Bravo', 'Blue', 'Charlie'].map((text) => {
    const button = document.createElement('button');
    button.textContent = text;
    button.setAttribute('role', 'option');
    root.append(button);
    return button;
  });
  root.addEventListener('keydown', (event) => navigation.keyDown(event, root));
  const press = (target: HTMLElement, key: string, extra = {}) =>
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra })
    );
  options[0]!.focus();
  press(options[0]!, 'b');
  expect(document.activeElement).toBe(options[1]);
  press(options[1]!, 'b');
  expect(document.activeElement).toBe(options[2]);
  press(options[2]!, 'Home');
  expect(document.activeElement).toBe(options[0]);
  press(options[0]!, 'End');
  expect(document.activeElement).toBe(options[3]);
  press(options[3]!, 'ArrowUp', { isComposing: true });
  expect(document.activeElement).toBe(options[3]);
  const input = document.createElement('input');
  root.append(input);
  input.focus();
  press(input, 'Home');
  expect(document.activeElement).toBe(input);
  press(input, 'ArrowDown');
  expect(document.activeElement).toBe(options[0]);
  expect(root.querySelectorAll('[role=option][tabindex="0"]').length).toBe(1);
  root.remove();
});

test('popup wraps Tab around enabled visible controls and Escape cancels', () => {
  const root = document.createElement('div');
  document.body.append(root);
  const first = document.createElement('button');
  const last = document.createElement('input');
  const hidden = document.createElement('button');
  hidden.hidden = true;
  root.append(first, last, hidden);
  let canceled = false;
  root.addEventListener('keydown', (event) =>
    contentControlPopupKeyDown(root, event, () => {
      canceled = true;
    })
  );
  last.focus();
  last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(first);
  first.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
  );
  expect(document.activeElement).toBe(last);
  last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(canceled).toBe(true);
  root.remove();
});

test('placement flips above, clamps to the sheet, and includes scroller gutters', () => {
  const root = document.createElement('div');
  const sheet = document.createElement('div');
  sheet.className = 'docx-page';
  const anchor = document.createElement('span');
  const panel = document.createElement('div');
  root.append(sheet, panel);
  sheet.append(anchor);
  document.body.append(root);
  const rect = (x: number, y: number, width: number, height: number) =>
    new DOMRect(x, y, width, height);
  root.getBoundingClientRect = () => rect(0, 0, 800, 600);
  sheet.getBoundingClientRect = () => rect(100, 0, 600, 1000);
  anchor.getBoundingClientRect = () => rect(650, window.innerHeight - 30, 20, 20);
  panel.getBoundingClientRect = () => rect(0, 0, 300, 200);
  Object.defineProperty(panel, 'offsetParent', { value: root });
  positionContentControlPopup(panel, anchor);
  expect(panel.style.left).toBe('400px');
  expect(panel.dataset.placement).toBe('top');
  expect(parseFloat(panel.style.top)).toBe(window.innerHeight - 230);
  root.remove();
});

test('a detached anchor reattaches to replacement chrome in the panel editor', () => {
  const root = document.createElement('div');
  root.className = 'docx-editor';
  const layer = document.createElement('div');
  layer.className = 'docx-pages';
  const chrome = document.createElement('div');
  chrome.dataset.docxContentControl = 'departure';
  const anchor = document.createElement('span');
  anchor.className = 'docx-content-control-boundary';
  chrome.append(anchor);
  layer.append(chrome);
  const panel = document.createElement('div');
  root.append(layer, panel);
  document.body.append(root);
  const replacement = chrome.cloneNode(true) as HTMLElement;
  chrome.replaceWith(replacement);
  replacement.firstElementChild!.getBoundingClientRect = () => new DOMRect(120, 100, 80, 20);
  root.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
  panel.getBoundingClientRect = () => new DOMRect(0, 0, 200, 100);
  Object.defineProperty(panel, 'offsetParent', { value: root });
  const cleanup = observeContentControlPopup(panel, anchor);
  try {
    expect(anchor.isConnected).toBe(false);
    expect(panel.style.left).toBe('120px');
    expect(panel.style.top).toBe('120px');
  } finally {
    cleanup();
    root.remove();
  }
});

test('fixed palettes flip within the viewport and follow scrolling without an offset parent', () => {
  const dialog = document.createElement('dialog');
  const anchor = document.createElement('button');
  const panel = document.createElement('div');
  const style = document.createElement('style');
  style.textContent = '.popup-fixed-fixture { position: fixed; max-height: 320px; }';
  panel.className = 'popup-fixed-fixture';
  Object.defineProperty(panel, 'offsetParent', { value: null });
  dialog.style.overflow = 'hidden';
  dialog.append(anchor, panel, style);
  document.body.append(dialog);
  let top = window.innerHeight - 50;
  anchor.getBoundingClientRect = () => new DOMRect(window.innerWidth - 120, top, 100, 24);
  panel.getBoundingClientRect = () => new DOMRect(0, 0, 288, 320);
  const stop = observeContentControlPopup(panel, anchor);
  try {
    expect(panel.offsetParent).toBeNull();
    expect(panel.dataset.placement).toBe('top');
    expect(panel.style.top).toBe(`${top - 4 - 320}px`);
    expect(panel.style.left).toBe(`${window.innerWidth - 8 - 288}px`);
    expect(panel.style.maxHeight).toBe('320px');
    top = 12;
    dialog.dispatchEvent(new Event('scroll', { bubbles: true }));
    expect(panel.dataset.placement).toBe('bottom');
    expect(panel.style.top).toBe('40px');
    stop();
    top = 100;
    dialog.dispatchEvent(new Event('scroll', { bubbles: true }));
    expect(panel.style.top).toBe('40px');
  } finally {
    stop();
    dialog.remove();
  }
});

test('fixed palettes limit their scroll height in a short viewport', () => {
  const descriptor = Object.getOwnPropertyDescriptor(window, 'innerHeight');
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 240 });
  const anchor = document.createElement('button');
  const panel = document.createElement('div');
  panel.style.position = 'fixed';
  anchor.getBoundingClientRect = () => new DOMRect(20, 180, 80, 24);
  panel.getBoundingClientRect = () => new DOMRect(0, 0, 288, 320);
  document.body.append(anchor, panel);
  try {
    positionContentControlPopup(panel, anchor);
    expect(panel.dataset.placement).toBe('top');
    expect(panel.style.maxHeight).toBe('168px');
    expect(panel.style.top).toBe('8px');
  } finally {
    anchor.remove();
    panel.remove();
    if (descriptor) Object.defineProperty(window, 'innerHeight', descriptor);
    else Reflect.deleteProperty(window, 'innerHeight');
  }
});
