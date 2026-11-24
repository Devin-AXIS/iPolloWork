import { afterEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { focusChartSwatch, moveChartSwatchFocus } from '../chart-pane.ts';

let mounted: HTMLElement | null = null;
afterEach(() => {
  mounted?.remove();
  mounted = null;
});

/** A color grid as the panes render it: Automatic, then 20 swatches in rows of ten. */
function grid(pressed = 12): HTMLElement {
  const root = document.createElement('div');
  root.className = 'docx-chart-pane__grid';
  const auto = document.createElement('button');
  auto.className = 'docx-chart-pane__grid-auto';
  root.append(auto);
  for (let i = 0; i < 20; i++) {
    const swatch = document.createElement('button');
    swatch.className = 'docx-chart-pane__swatch';
    swatch.dataset['index'] = String(i);
    swatch.setAttribute('aria-pressed', String(i === pressed));
    root.append(swatch);
  }
  document.body.append(root);
  mounted = root;
  return root;
}

const focused = (): string | undefined => (document.activeElement as HTMLElement).dataset['index'];
const tabStops = (root: HTMLElement): string[] =>
  [...root.querySelectorAll<HTMLElement>('.docx-chart-pane__swatch')]
    .filter((s) => s.tabIndex === 0)
    .map((s) => s.dataset['index']!);

describe('color grid keys', () => {
  test('opens on the current color, with one swatch in the Tab order', () => {
    const root = grid();
    focusChartSwatch(root);
    expect(focused()).toBe('12');
    expect(tabStops(root)).toEqual(['12']);
  });

  test('the arrow keys move by one swatch and by one row', () => {
    const root = grid();
    focusChartSwatch(root);
    expect(moveChartSwatchFocus(root, 'ArrowRight')).toBe(true);
    expect(focused()).toBe('13');
    moveChartSwatchFocus(root, 'ArrowUp');
    expect(focused()).toBe('3');
    moveChartSwatchFocus(root, 'ArrowDown');
    expect(focused()).toBe('13');
    moveChartSwatchFocus(root, 'ArrowLeft');
    expect(focused()).toBe('12');
    expect(tabStops(root)).toEqual(['12']);
  });

  test('Up from the first row goes to Automatic, and Down comes back', () => {
    const root = grid(2);
    focusChartSwatch(root);
    moveChartSwatchFocus(root, 'ArrowUp');
    expect(document.activeElement?.className).toBe('docx-chart-pane__grid-auto');
    moveChartSwatchFocus(root, 'ArrowDown');
    expect(focused()).toBe('0');
  });

  test('Home and End go to the ends; an edge holds the focus; other keys pass', () => {
    const root = grid();
    focusChartSwatch(root);
    moveChartSwatchFocus(root, 'End');
    expect(focused()).toBe('19');
    expect(moveChartSwatchFocus(root, 'ArrowDown')).toBe(true);
    expect(focused()).toBe('19');
    moveChartSwatchFocus(root, 'Home');
    expect(focused()).toBe('0');
    expect(moveChartSwatchFocus(root, 'Tab')).toBe(false);
    expect(moveChartSwatchFocus(root, 'Escape')).toBe(false);
  });
});
