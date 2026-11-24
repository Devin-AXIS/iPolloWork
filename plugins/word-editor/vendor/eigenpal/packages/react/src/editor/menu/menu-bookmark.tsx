// Insert › Bookmark. Kept in its own file, so the menu parts file stays under its line cap.

import { isApplePlatform } from '@docx-editor.dev/i18n';
import type { EditorCommand } from '@docx-editor.dev/core/contracts/editor';
import { useEditorCommand } from '../useEditorCommand';
import { MenuItem, type MenuActionProps } from './parts';

/** The Go To chord's request: refused while the Go To UI turned its shortcut off. */
const GO_TO_CHORD: EditorCommand = { type: 'openGoTo', fromShortcut: true };

/**
 * Insert › Go To Bookmark…, with the Go To chord in the shortcut column while the chord opens
 * Go To: Ctrl+G, or Cmd+Option+G on macOS. A host that turned the shortcut off gets no chord
 * printed, because pressing it would do nothing.
 *
 * @internal
 */
export function MenuGoToBookmarkRow() {
  const chord = useEditorCommand(GO_TO_CHORD);
  const shortcutKey = isApplePlatform()
    ? 'toolbar.goToBookmarkShortcutApple'
    : 'toolbar.goToBookmarkShortcut';
  return <MenuItem slotId="insert.goToBookmark" {...(chord.isEnabled ? { shortcutKey } : {})} />;
}

function MenuBookmarkImpl({ className, hidden }: MenuActionProps) {
  return (
    <MenuItem
      slotId="insert.bookmark"
      shortcutKey="toolbar.bookmarkShortcut"
      {...(className ? { className } : {})}
      {...(hidden ? { hidden } : {})}
    />
  );
}

/**
 * Insert › Bookmark, so a host can hide it or place it elsewhere by name.
 *
 * An ordinary command row: the slot runs `openBookmarkDialog`, which opens the `bookmark`
 * popup through the editor, the same request Ctrl/Cmd+Shift+F5 sends. The row is disabled
 * while no bookmark dialog is registered, for example when the popup is `false`.
 *
 * @public
 */
export const MenuBookmark = Object.assign(MenuBookmarkImpl, {
  docxSlot: 'insert.bookmark' as const,
});
