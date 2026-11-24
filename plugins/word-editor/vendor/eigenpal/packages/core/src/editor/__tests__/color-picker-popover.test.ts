import { expect, test } from 'bun:test';
import { alignColorPickerPopover, colorPickHex, focusColorSwatch } from '../color-picker.ts';

test('theme tints and shades use the lumMod and lumOff luminance model', () => {
  const theme = [
    ...['FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4'],
    ...['ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47'],
  ];
  // The palette values of the default theme.
  expect(colorPickHex('accent1:80', theme)).toBe('#DAE3F3');
  expect(colorPickHex('accent1:-25', theme)).toBe('#2F5597');
  expect(colorPickHex('accent2:60', theme)).toBe('#F8CBAD');
});

function grid(left: number, width: number): HTMLElement {
  const element = document.createElement('div');
  element.innerHTML = '<button data-color-swatch aria-pressed="true"></button>';
  element.getBoundingClientRect = () =>
    ({ left, right: left + width, top: 0, bottom: 200, width, height: 200 }) as DOMRect;
  document.body.append(element);
  return element;
}

test('a popover grid past the start edge of the window aligns to the start edge', () => {
  const clipped = grid(-120, 280);
  alignColorPickerPopover(clipped);
  expect(clipped.getAttribute('data-align')).toBe('start');
  const fits = grid(40, 280);
  fits.setAttribute('data-align', 'start');
  alignColorPickerPopover(fits);
  expect(fits.hasAttribute('data-align')).toBe(false);
  clipped.remove();
  fits.remove();
});

test('opening the grid aligns it before the focus moves in', () => {
  const clipped = grid(-10, 280);
  focusColorSwatch(clipped);
  expect(clipped.getAttribute('data-align')).toBe('start');
  expect(document.activeElement).toBe(clipped.querySelector('button'));
  clipped.remove();
});
