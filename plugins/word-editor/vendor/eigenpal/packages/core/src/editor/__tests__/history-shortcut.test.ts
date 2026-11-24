import { describe, expect, test } from 'bun:test';
import { historyShortcutOf } from '../history-shortcut.ts';

const keys = (key: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'shiftKey', boolean>>) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  ...mods,
});

describe('historyShortcutOf', () => {
  test('Cmd+Z and Ctrl+Z undo', () => {
    expect(historyShortcutOf(keys('z', { metaKey: true }))).toBe('undo');
    expect(historyShortcutOf(keys('z', { ctrlKey: true }))).toBe('undo');
  });

  test('Shift+Z and Y redo, whatever the letter case', () => {
    expect(historyShortcutOf(keys('Z', { metaKey: true, shiftKey: true }))).toBe('redo');
    expect(historyShortcutOf(keys('y', { ctrlKey: true }))).toBe('redo');
    expect(historyShortcutOf(keys('Y', { ctrlKey: true, shiftKey: true }))).toBe('redo');
  });

  test('other keys, and Z without a modifier, are not history keys', () => {
    expect(historyShortcutOf(keys('z', {}))).toBeNull();
    expect(historyShortcutOf(keys('z', { shiftKey: true }))).toBeNull();
    expect(historyShortcutOf(keys('x', { metaKey: true }))).toBeNull();
  });
});
