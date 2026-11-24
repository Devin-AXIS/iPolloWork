import { expect, test } from 'bun:test';
import {
  placeContextMenu,
  placeSubmenu,
  showInTopLayer,
  submenuKeys,
} from '../submenu-placement.ts';

const view = { width: 1440, height: 900 };
const panel = { width: 240, height: 200 };

test('a left-to-right submenu opens to the right, and to the left when it does not fit', () => {
  expect(placeSubmenu({ left: 400, right: 600, top: 100 }, panel, view, false)).toEqual({
    left: 600,
    top: 96,
  });
  expect(placeSubmenu({ left: 1100, right: 1300, top: 100 }, panel, view, false).left).toBe(860);
});

test('a right-to-left submenu opens to the left, and to the right when it does not fit', () => {
  expect(placeSubmenu({ left: 830, right: 1050, top: 440 }, panel, view, true).left).toBe(590);
  expect(placeSubmenu({ left: 100, right: 300, top: 440 }, panel, view, true).left).toBe(300);
});

test('a submenu on a low row rises to stay in view', () => {
  expect(placeSubmenu({ left: 400, right: 600, top: 850 }, panel, view, false).top).toBe(692);
});

test('the inline-end arrow opens a submenu', () => {
  expect(submenuKeys(false)).toEqual({ open: 'ArrowRight', close: 'ArrowLeft' });
  expect(submenuKeys(true)).toEqual({ open: 'ArrowLeft', close: 'ArrowRight' });
});

test('a context menu opens below the press, flips above it, or moves up only as far as it must', () => {
  const small = { width: 1000, height: 600 };
  expect(placeContextMenu({ x: 100, y: 100 }, { width: 240, height: 300 }, small, false)).toEqual({
    left: 100,
    top: 100,
    maxWidth: 984,
    maxHeight: 584,
  });
  expect(placeContextMenu({ x: 100, y: 500 }, { width: 240, height: 300 }, small, false).top).toBe(
    200
  );
  expect(placeContextMenu({ x: 100, y: 300 }, { width: 240, height: 400 }, small, false).top).toBe(
    192
  );
});

test('a context menu taller than the window is capped to it, from the top inset', () => {
  const small = { width: 1000, height: 600 };
  for (const y of [20, 300, 590]) {
    const placed = placeContextMenu({ x: 100, y }, { width: 240, height: 900 }, small, false);
    expect(placed).toEqual({ left: 100, top: 8, maxWidth: 984, maxHeight: 584 });
  }
});

test('a keyboard-opened context menu anchored above the window opens from the top inset', () => {
  expect(placeContextMenu({ x: 100, y: -4000 }, { width: 240, height: 300 }, view, false).top).toBe(
    8
  );
});

test('a context menu flips to the free side of the press horizontally', () => {
  expect(placeContextMenu({ x: 1400, y: 100 }, panel, view, false).left).toBe(1160);
  expect(placeContextMenu({ x: 100, y: 100 }, panel, view, true).left).toBe(100);
});

test('a window narrower than the panel keeps both edges in view', () => {
  const narrow = { width: 200, height: 600 };
  expect(placeSubmenu({ left: 60, right: 150, top: 100 }, panel, narrow, true).left).toBe(8);
  expect(placeSubmenu({ left: 60, right: 150, top: 100 }, panel, narrow, false).left).toBe(8);
  const menu = placeContextMenu({ x: 150, y: 100 }, panel, narrow, false);
  expect(menu.left).toBe(8);
  expect(menu.maxWidth).toBe(184);
});

test('the top layer reports a refused popover as not shown', () => {
  const panel = {
    showPopover: () => {
      throw new Error('refused');
    },
    hasAttribute: () => false,
    setAttribute: () => {},
    matches: () => false,
  } as unknown as HTMLElement;
  expect(showInTopLayer(panel)).toBe(false);
});
