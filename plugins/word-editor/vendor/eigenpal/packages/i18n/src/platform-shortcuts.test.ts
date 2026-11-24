import { describe, expect, test } from 'bun:test';
import { platformShortcut } from './platform-shortcuts';

/** The Apple branch, without depending on the machine the suite happens to run on. */
function onApple<T>(run: () => T): T {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { platform: 'MacIntel' },
  });
  try {
    return run();
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else delete (globalThis as { navigator?: unknown }).navigator;
  }
}

describe('platformShortcut', () => {
  test('names the Mac keys on an Apple platform', () => {
    onApple(() => {
      expect(platformShortcut('Ctrl+Alt+C')).toBe('⌘+Option+C');
      expect(platformShortcut('Bold (Ctrl+B)')).toBe('Bold (⌘+B)');
      expect(platformShortcut('Ctrl+Shift+V')).toBe('⌘+Shift+V');
    });
  });

  // A LABEL, not a shortcut. This runs over every control name, so a rule that rewrote the
  // bare word turned English "Alt text" into "Option text" and Turkish "Altı çizili"
  // ("underlined") into "Optionı çizili" — `\b` treats the dotless `ı` as a non-word
  // character, so a word boundary alone does not save it. Only a chord is rewritten.
  test('leaves a modifier-shaped WORD alone', () => {
    onApple(() => {
      expect(platformShortcut('Alt text')).toBe('Alt text');
      expect(platformShortcut('Alt simge')).toBe('Alt simge');
      expect(platformShortcut('Altı çizili')).toBe('Altı çizili');
      expect(platformShortcut('Control')).toBe('Control');
    });
  });

  test('changes nothing off an Apple platform', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { platform: 'Win32' },
    });
    try {
      expect(platformShortcut('Ctrl+Alt+C')).toBe('Ctrl+Alt+C');
    } finally {
      if (original) Object.defineProperty(globalThis, 'navigator', original);
      else delete (globalThis as { navigator?: unknown }).navigator;
    }
  });

  test('survives a server render, where there is no navigator at all', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    delete (globalThis as { navigator?: unknown }).navigator;
    try {
      expect(platformShortcut('Ctrl+Alt+C')).toBe('Ctrl+Alt+C');
    } finally {
      if (original) Object.defineProperty(globalThis, 'navigator', original);
    }
  });
});
