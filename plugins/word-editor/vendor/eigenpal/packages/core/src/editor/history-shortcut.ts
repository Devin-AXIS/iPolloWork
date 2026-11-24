/** The keys that undo and redo, shared by the text surface and every overlay that takes focus. */

/** Modifier and key state of one keydown, as both DOM and framework key events carry it. */
export interface HistoryShortcutKeys {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
}

/**
 * Which history step a keydown asks for, or `null` for any other key.
 *
 * Ctrl+Y is the Windows redo; Ctrl/Cmd+Shift+Z is the macOS one. Both are accepted on every
 * platform. Focused chrome, such as the picture selection overlay, calls this so history keys
 * reach the editor instead of stopping at the control that holds focus.
 */
export function historyShortcutOf(event: HistoryShortcutKeys): 'undo' | 'redo' | null {
  if (!(event.metaKey || event.ctrlKey)) return null;
  const key = event.key.toLowerCase();
  if (key === 'y') return 'redo';
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  return null;
}
