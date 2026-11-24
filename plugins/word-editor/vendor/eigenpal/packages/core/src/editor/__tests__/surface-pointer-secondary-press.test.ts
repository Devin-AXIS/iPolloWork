// Secondary presses over the painted pages: a right-click, and a Control-click on Apple
// platforms. Inside the selection the press keeps it, so Cut and Copy act on it; outside,
// the caret moves to the press, so the context menu acts on the text under the pointer.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { mount, offsets, paragraph, press, release } from './surface-pointer-harness.ts';

describe('a secondary press', () => {
  test('a right-click inside a range keeps the range and its native behaviour', () => {
    const mounted = mount(paragraph('hello world'));
    mounted.surface.setSelection({
      anchor: { ...mounted.surface.state().selection.anchor, offset: 0 },
      head: { ...mounted.surface.state().selection.anchor, offset: 11 },
    });
    const event = press(mounted, 30, 5, { button: 2 });
    expect(event.defaultPrevented).toBe(false);
    expect(offsets(mounted.surface)).toEqual([0, 11]);
    mounted.surface.destroy();
  });

  test('a right-click outside the selection moves the caret there without preventing the menu', () => {
    const mounted = mount(paragraph('hello world'));
    press(mounted, -40, 5);
    release(-40, 5);
    expect(offsets(mounted.surface)).toEqual([0, 0]);
    // Inside the content box, right of the last glyph: the end of the line.
    const event = press(mounted, 300, 5, { button: 2 });
    expect(event.defaultPrevented).toBe(false);
    expect(offsets(mounted.surface)).toEqual([11, 11]);
    mounted.surface.destroy();
  });

  describe('a Control-click', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis.navigator, 'platform');
    const withPlatform = (platform: string, run: () => void): void => {
      Object.defineProperty(globalThis.navigator, 'platform', {
        configurable: true,
        value: platform,
      });
      try {
        run();
      } finally {
        if (original) Object.defineProperty(globalThis.navigator, 'platform', original);
        else delete (globalThis.navigator as { platform?: string }).platform;
      }
    };

    test('on Apple platforms keeps a range it lands in, and prevents the native press', () => {
      withPlatform('MacIntel', () => {
        const mounted = mount(paragraph('hello world'));
        mounted.surface.setSelection({
          anchor: { ...mounted.surface.state().selection.anchor, offset: 0 },
          head: { ...mounted.surface.state().selection.anchor, offset: 11 },
        });
        const event = press(mounted, 30, 5, { ctrlKey: true });
        expect(event.defaultPrevented).toBe(true);
        expect(offsets(mounted.surface)).toEqual([0, 11]);
        mounted.surface.destroy();
      });
    });

    test('on Apple platforms moves the caret when it lands outside the selection', () => {
      withPlatform('MacIntel', () => {
        const mounted = mount(paragraph('hello world'));
        press(mounted, -40, 5);
        release(-40, 5);
        const event = press(mounted, 300, 5, { ctrlKey: true });
        expect(event.defaultPrevented).toBe(true);
        expect(offsets(mounted.surface)).toEqual([11, 11]);
        mounted.surface.destroy();
      });
    });

    test('elsewhere is an ordinary press', () => {
      withPlatform('Win32', () => {
        const mounted = mount(paragraph('hello world'));
        mounted.surface.setSelection({
          anchor: { ...mounted.surface.state().selection.anchor, offset: 0 },
          head: { ...mounted.surface.state().selection.anchor, offset: 11 },
        });
        press(mounted, 300, 5, { ctrlKey: true });
        release(300, 5);
        expect(offsets(mounted.surface)).toEqual([11, 11]);
        mounted.surface.destroy();
      });
    });
  });

  test('a middle-button press keeps the current selection', () => {
    const mounted = mount(paragraph('hello world'));
    press(mounted, -40, 5);
    release(-40, 5);
    const event = press(mounted, 500, 5, { button: 1 });
    expect(event.defaultPrevented).toBe(false);
    expect(offsets(mounted.surface)).toEqual([0, 0]);
    mounted.surface.destroy();
  });
});
