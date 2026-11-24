// `pagesOwnSelection` reads focus from the pages' own tree, so an editor mounted in a shadow
// root still owns its selection, and a menu focused inside another shadow root still does not.
import { afterEach, expect, test } from 'bun:test';
import { pagesOwnSelection } from '../surface-selection-owner.ts';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function shadowHost(): ShadowRoot {
  const host = document.createElement('div');
  document.body.append(host);
  cleanups.push(() => host.remove());
  return host.attachShadow({ mode: 'open' });
}

function pagesIn(parent: Node): { pages: HTMLElement; text: HTMLElement } {
  const pages = document.createElement('div');
  const text = document.createElement('span');
  text.tabIndex = 0;
  text.textContent = 'Teh cat.';
  pages.append(text);
  parent.appendChild(pages);
  return { pages, text };
}

test('pages inside a shadow root own the selection while focus is in them', () => {
  const { pages, text } = pagesIn(shadowHost());
  text.focus();
  expect(pagesOwnSelection(pages)).toBe(true);

  const outside = document.createElement('input');
  document.body.append(outside);
  cleanups.push(() => outside.remove());
  outside.focus();
  expect(pagesOwnSelection(pages)).toBe(false);
});

test('focus inside another shadow root does not belong to the pages', () => {
  const { pages, text } = pagesIn(document.body);
  cleanups.push(() => pages.remove());
  text.focus();
  expect(pagesOwnSelection(pages)).toBe(true);

  const menu = document.createElement('button');
  shadowHost().append(menu);
  menu.focus();
  expect(pagesOwnSelection(pages)).toBe(false);
});
