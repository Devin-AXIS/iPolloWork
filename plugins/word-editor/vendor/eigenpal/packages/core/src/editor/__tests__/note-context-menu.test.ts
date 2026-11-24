// Which menu a right-click on a note opens, how a floating menu closes, and how its rows take
// focus from the keyboard.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import {
  focusMenuItemForKey,
  listenForMenuDismiss,
  noteMenuScopeOf,
} from '../note-context-menu.ts';

const mounted: HTMLElement[] = [];
afterEach(() => {
  for (const element of mounted.splice(0)) element.remove();
});

function mount(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.append(root);
  mounted.push(root);
  return root;
}

describe('noteMenuScopeOf', () => {
  const root = () =>
    mount(
      '<span data-docx-note-ref="" data-docx-note-scope="footnote:1">1</span>' +
        '<div data-docx-note="" data-docx-note-scope="footnote:1"><span id="one">One</span></div>' +
        '<div data-docx-note="" data-docx-note-scope="footnote:2"><span id="two">Two</span></div>' +
        '<p id="body">Body</p>'
    );

  test('a note that is not being edited opens the note menu', () => {
    const view = root();
    expect(noteMenuScopeOf(view.querySelector('#two'), { kind: 'body' })).toBe('footnote:2');
    expect(noteMenuScopeOf(view.querySelector('#two'), { kind: 'note', id: 'footnote:1' })).toBe(
      'footnote:2'
    );
  });

  test('the note being edited leaves the press to the document menu', () => {
    const view = root();
    expect(noteMenuScopeOf(view.querySelector('#one'), { kind: 'note', id: 'footnote:1' })).toBe(
      null
    );
  });

  test('a reference mark opens the note menu even while its note is edited', () => {
    const view = root();
    const mark = view.querySelector('[data-docx-note-ref]');
    expect(noteMenuScopeOf(mark, { kind: 'note', id: 'footnote:1' })).toBe('footnote:1');
  });

  test('a press outside every note opens no note menu', () => {
    const view = root();
    expect(noteMenuScopeOf(view.querySelector('#body'), null)).toBe(null);
    expect(noteMenuScopeOf(null, null)).toBe(null);
  });
});

describe('listenForMenuDismiss', () => {
  function open() {
    const view = mount('<div id="menu"><button id="row">Row</button></div><p id="out">Out</p>');
    const menu = view.querySelector('#menu')!;
    const closed: boolean[] = [];
    const dispose = listenForMenuDismiss({
      host: menu,
      contains: (node) => menu.contains(node),
      close: (restoreFocus) => closed.push(restoreFocus),
    });
    return { view, closed, dispose };
  }

  test('a press inside keeps the menu, and a press outside closes it', () => {
    const { view, closed, dispose } = open();
    view.querySelector('#row')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(closed).toEqual([]);
    view.querySelector('#out')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(closed).toEqual([false]);
    dispose();
  });

  test('Escape closes with focus restored, and Tab and a scroll close without it', () => {
    const { closed, dispose } = open();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    document.dispatchEvent(new Event('scroll'));
    expect(closed).toEqual([true, false, false]);
    dispose();
  });

  test('the disposer removes every listener', () => {
    const { view, closed, dispose } = open();
    dispose();
    view.querySelector('#out')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(closed).toEqual([]);
  });
});

describe('focusMenuItemForKey', () => {
  test('moves between enabled rows and wraps at the ends', () => {
    const view = mount(
      '<div role="menu"><button role="menuitem" id="a">A</button>' +
        '<button role="menuitem" id="b" disabled>B</button>' +
        '<button role="menuitem" id="c">C</button></div>'
    );
    const menu = view.querySelector('[role="menu"]')!;
    const id = () => (document.activeElement as HTMLElement | null)?.id;
    expect(focusMenuItemForKey(menu, 'Home')).toBe(true);
    expect(id()).toBe('a');
    focusMenuItemForKey(menu, 'ArrowDown');
    expect(id()).toBe('c');
    focusMenuItemForKey(menu, 'ArrowDown');
    expect(id()).toBe('a');
    focusMenuItemForKey(menu, 'ArrowUp');
    expect(id()).toBe('c');
    expect(focusMenuItemForKey(menu, 'x')).toBe(false);
  });
});
