// The toolbar's group policy and room measurement, shared by both adapters.
//
// The DOM cases stub layout (`clientWidth`, `getBoundingClientRect`, Typed OM) on happy-dom
// elements, since happy-dom computes no layout of its own.

import { afterEach, describe, expect, test } from 'bun:test';
import {
  arrangeToolbarGroups,
  collapseOrder,
  toolbarPanelPlacement,
  toolbarPopupLeft,
} from '../toolbar-fit.ts';
import { barRoomWidth, readAvailableWidth } from '../toolbar-measure.ts';

describe('toolbar group policy', () => {
  test('a host priority sorts among the built-in priorities', () => {
    const groups = ['history', 'zoom', 'font', 'nav', 'review-nav'];
    const order = collapseOrder(groups, undefined, new Map([['nav', 75]]));
    // `review-nav` has no priority, so it goes first; `nav` (75) sits between font and history.
    expect(order).toEqual(['review-nav', 'zoom', 'font', 'nav', 'history']);
  });

  test('host groups follow the built-in groups, or the group they name', () => {
    expect(
      arrangeToolbarGroups(
        ['history', 'text', 'review'],
        [
          { id: 'a' },
          { id: 'b', after: 'history' },
          { id: 'c', after: 'history' },
          { id: 'd', after: 'b' },
        ]
      )
    ).toEqual(['history', 'b', 'd', 'c', 'text', 'review', 'a']);
    expect(arrangeToolbarGroups(['history'], [{ id: 'x', after: 'missing' }])).toEqual([
      'history',
      'x',
    ]);
  });

  test('a popup under a bar control stays inside the viewport', () => {
    expect(toolbarPopupLeft({ anchorLeft: 100, popupWidth: 200, viewportWidth: 1000 })).toBe(100);
    expect(toolbarPopupLeft({ anchorLeft: 900, popupWidth: 200, viewportWidth: 1000 })).toBe(792);
    expect(toolbarPopupLeft({ anchorLeft: 0, popupWidth: 200, viewportWidth: 1000 })).toBe(8);
    expect(toolbarPopupLeft({ anchorLeft: 50, popupWidth: 2000, viewportWidth: 1000 })).toBe(8);
  });

  test('the panel lines up with the trigger end, then its start, then clamps', () => {
    const base = { panelWidth: 300, viewportWidth: 1000 };
    expect(toolbarPanelPlacement({ ...base, triggerLeft: 900, triggerRight: 934 })).toEqual({
      left: 634,
      maxWidth: 984,
      anchor: 'end',
    });
    expect(toolbarPanelPlacement({ ...base, triggerLeft: 20, triggerRight: 54 }).anchor).toBe(
      'start'
    );
    const narrow = toolbarPanelPlacement({
      panelWidth: 340,
      viewportWidth: 390,
      triggerLeft: 178,
      triggerRight: 212,
    });
    expect(narrow.anchor).toBe('clamped');
    expect(narrow.left).toBe(8);
    expect(narrow.maxWidth).toBe(374);
  });
});

describe('shrink-wrapped toolbar room', () => {
  test('the room comes from the parent, less siblings and margins, capped by max-width', () => {
    const base = { own: 300, siblings: 0, margins: 0, chrome: 10, maxWidth: null };
    // A bar that fills its container keeps its own measurement.
    expect(barRoomWidth({ ...base, own: 990, parentContent: 1000 })).toBe(990);
    // A shrink-wrapped bar can grow into the parent.
    expect(barRoomWidth({ ...base, parentContent: 1000 })).toBe(990);
    expect(barRoomWidth({ ...base, parentContent: 1000, siblings: 200, margins: 20 })).toBe(770);
    expect(barRoomWidth({ ...base, parentContent: 1000, maxWidth: 600 })).toBe(590);
    // Never less than the box it has, and unknown room keeps the box.
    expect(barRoomWidth({ ...base, parentContent: 100 })).toBe(300);
    expect(barRoomWidth({ ...base, parentContent: 0 })).toBe(300);
  });
});

describe('available width', () => {
  /** A parent with a bar of `own` px; the bar specifies `width` through a Typed OM stub. */
  function layout(options: {
    parent: string;
    parentWidth: number;
    own: number;
    width?: string;
    barStyle?: string;
    margins?: { left: string; right: string };
    siblings?: {
      style: string;
      width: number;
      margins?: [string, string];
      tag?: string;
      text?: string;
      svg?: boolean;
      contents?: boolean;
    }[];
    typedOm?: boolean;
    overflow?: boolean;
    parentText?: string;
  }): HTMLElement {
    const parent = document.createElement('div');
    parent.setAttribute('style', options.parent);
    Object.defineProperty(parent, 'clientWidth', {
      configurable: true,
      get: () => options.parentWidth,
    });
    const bar = document.createElement('div');
    bar.setAttribute('style', `${options.barStyle ?? ''}`);
    Object.defineProperty(bar, 'clientWidth', { configurable: true, get: () => options.own });
    Object.defineProperty(bar, 'offsetWidth', { configurable: true, get: () => options.own });
    bar.getBoundingClientRect = () =>
      ({ left: 0, right: options.own, width: options.own }) as DOMRect;
    if (options.overflow) {
      const control = document.createElement('div');
      control.setAttribute('data-toolbar-group', 'overflowing');
      control.getBoundingClientRect = () =>
        ({ left: 0, right: options.own + 50, width: options.own + 50 }) as DOMRect;
      bar.appendChild(control);
    }
    if (options.parentText) parent.appendChild(document.createTextNode(options.parentText));
    const keywords: Record<string, string> = {};
    if (options.width) keywords.width = options.width;
    if (options.margins?.left === 'auto') keywords['margin-left'] = 'auto';
    if (options.margins?.right === 'auto') keywords['margin-right'] = 'auto';
    if (options.typedOm !== false) {
      (bar as unknown as { computedStyleMap: () => unknown }).computedStyleMap = () => ({
        get: (property: string) =>
          property in keywords ? { value: keywords[property] } : { value: 0, unit: 'px' },
      });
    }
    for (const sibling of options.siblings ?? []) {
      const node: Element = sibling.svg
        ? document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        : document.createElement(sibling.tag ?? 'div');
      node.setAttribute('style', sibling.style);
      if (sibling.text) node.textContent = sibling.text;
      node.getBoundingClientRect = () =>
        ({ left: 0, right: sibling.width, width: sibling.width }) as DOMRect;
      const [left, right] = sibling.margins ?? ['', ''];
      (node as unknown as { computedStyleMap: () => unknown }).computedStyleMap = () => ({
        get: (property: string) =>
          (property === 'margin-left' && left === 'auto') ||
          (property === 'margin-right' && right === 'auto')
            ? { value: 'auto' }
            : { value: 0, unit: 'px' },
      });
      if (sibling.contents) {
        const wrapper = document.createElement('div');
        wrapper.setAttribute('style', 'display: contents');
        wrapper.appendChild(node);
        parent.appendChild(wrapper);
      } else {
        parent.appendChild(node);
      }
    }
    parent.appendChild(bar);
    document.body.appendChild(parent);
    return bar;
  }
  const available = (bar: HTMLElement) => readAvailableWidth(bar, getComputedStyle(bar));

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('a content-sized bar in a flex row gets the parent room', () => {
    const bar = layout({
      parent: 'display: flex',
      parentWidth: 1000,
      own: 300,
      width: 'max-content',
    });
    expect(available(bar)).toBe(1000);
  });

  test('a bar in a grid cell, or with a fixed width, keeps its own box', () => {
    const grid = layout({
      parent: 'display: grid; grid-template-columns: auto 1fr auto',
      parentWidth: 1000,
      own: 300,
      width: 'auto',
    });
    expect(available(grid)).toBe(300);
    document.body.innerHTML = '';
    const fixed = layout({ parent: 'display: flex', parentWidth: 1000, own: 600 });
    expect(available(fixed)).toBe(600);
    document.body.innerHTML = '';
    const inline = layout({
      parent: 'display: block',
      parentWidth: 1000,
      own: 300,
      width: 'auto',
      barStyle: 'display: inline-flex',
    });
    expect(available(inline)).toBe(300);
  });

  test('without Typed OM the bar keeps its own box', () => {
    const bar = layout({ parent: 'display: flex', parentWidth: 1000, own: 300, typedOm: false });
    expect(available(bar)).toBe(300);
  });

  test('equal fixed margins count, auto margins do not', () => {
    const fixed = layout({
      parent: 'display: flex',
      parentWidth: 1000,
      own: 300,
      width: 'max-content',
      barStyle: 'margin: 0 40px',
    });
    expect(available(fixed)).toBe(920);
    document.body.innerHTML = '';
    const centered = layout({
      parent: 'display: block',
      parentWidth: 1000,
      own: 300,
      width: 'max-content',
      barStyle: 'margin: 0 350px',
      margins: { left: 'auto', right: 'auto' },
    });
    expect(available(centered)).toBe(1000);
  });

  test('an unresolved max-width, an overflowing bar, and a floated bar keep their own box', () => {
    const calc = layout({
      parent: 'display: flex',
      parentWidth: 1000,
      own: 300,
      width: 'max-content',
      barStyle: 'max-width: calc(100% - 200px)',
    });
    expect(available(calc)).toBe(300);
    document.body.innerHTML = '';
    const overflowing = layout({
      parent: 'display: flex',
      parentWidth: 1000,
      own: 300,
      width: 'max-content',
      overflow: true,
    });
    expect(available(overflowing)).toBe(300);
    document.body.innerHTML = '';
    const floated = layout({
      parent: 'display: block',
      parentWidth: 1000,
      own: 300,
      width: 'max-content',
      barStyle: 'float: left',
    });
    expect(available(floated)).toBe(300);
  });

  test('a growing sibling with content keeps the bar to its own box', () => {
    const bar = layout({
      parent: 'display: flex',
      parentWidth: 1000,
      own: 300,
      width: 'max-content',
      siblings: [{ style: 'flex: 1 1 0px', width: 600, tag: 'input' }],
    });
    expect(available(bar)).toBe(300);
    document.body.innerHTML = '';
    const titled = layout({
      parent: 'display: flex',
      parentWidth: 1000,
      own: 300,
      width: 'max-content',
      siblings: [{ style: 'flex: 1 1 0px', width: 600, text: 'Quarterly plan' }],
    });
    expect(available(titled)).toBe(300);
  });

  test('the net is sticky: a wrong room does not flicker until the parent width changes', () => {
    const bar = layout({
      parent: 'display: flex',
      parentWidth: 1000,
      own: 300,
      width: 'max-content',
    });
    const control = document.createElement('div');
    control.setAttribute('data-toolbar-group', 'g');
    bar.appendChild(control);
    let right = 200;
    control.getBoundingClientRect = () => ({ left: 0, right, width: right }) as DOMRect;
    bar.getBoundingClientRect = () => ({ left: 0, right: 300, width: 300 }) as DOMRect;
    expect(available(bar)).toBe(1000);
    // Groups came back from that room and overflow: the room was wrong.
    right = 420;
    expect(available(bar)).toBe(300);
    // They collapsed and fit again. The room stays capped, so they do not come back.
    right = 200;
    expect(available(bar)).toBe(300);
    expect(available(bar)).toBe(300);
    // A new parent width is a new question.
    Object.defineProperty(bar.parentElement!, 'clientWidth', {
      configurable: true,
      get: () => 1200,
    });
    expect(available(bar)).toBe(1200);
  });

  test('an open popup past the bar edge is not an overflow', () => {
    const bar = layout({
      parent: 'display: flex',
      parentWidth: 1000,
      own: 300,
      width: 'max-content',
    });
    const popup = document.createElement('div');
    popup.className = 'docx-toolbar__more-panel';
    popup.getBoundingClientRect = () => ({ left: 100, right: 900, width: 800 }) as DOMRect;
    bar.appendChild(popup);
    bar.getBoundingClientRect = () => ({ left: 0, right: 300, width: 300 }) as DOMRect;
    expect(available(bar)).toBe(1000);
  });

  test('every sibling counts: an svg logo, a display: contents wrapper, a min-width', () => {
    const bar = layout({
      parent: 'display: flex',
      parentWidth: 1000,
      own: 300,
      width: 'max-content',
      siblings: [
        { style: '', width: 40, svg: true },
        { style: '', width: 60, contents: true },
        { style: 'flex: 1 1 0px; min-width: 200px', width: 500 },
      ],
    });
    expect(available(bar)).toBe(700);
  });

  test('loose text in the row keeps the bar to its own box', () => {
    const bar = layout({
      parent: 'display: flex',
      parentWidth: 1000,
      own: 300,
      width: 'max-content',
      parentText: 'Draft',
    });
    expect(available(bar)).toBe(300);
  });

  test('a flex: 1 spacer and an auto margin do not take the room', () => {
    const bar = layout({
      parent: 'display: flex',
      parentWidth: 1000,
      own: 300,
      width: 'max-content',
      siblings: [
        { style: 'flex: 1 1 0px', width: 500 },
        { style: 'margin-left: 100px', width: 100, margins: ['auto', ''] },
      ],
    });
    // 1000 less the 100px button; the spacer and the auto margin are free space.
    expect(available(bar)).toBe(900);
  });
});
