// The `text.link` slot as a menu row.
//
// `text.link` runs no engine command: a link needs a target, and only a link UI can supply
// one. The engine answers the slot like any other: it is enabled while the selection could
// become a link AND a link UI is registered, and running it asks that UI to open, which is
// what `Toolbar.Link` and Ctrl/Cmd+K do. `MenuItem` routes `slotId="text.link"` here, so the
// context menu's packaged row, `<ContextMenu.Slot slotId="text.link" />` and
// `<Menu.Item slotId="text.link" />` are all the same working row.

import { runToolbarCommand, toolbarCommandState } from '@docx-editor.dev/core/editor';
import { localizeDisabledReason } from '@docx-editor.dev/i18n';
import { useDocxEditor } from '../context';
import { useEditorState } from '../useEditorState';
import { chromeControlForSlot, chromeIcon } from '../toolbar/ToolbarButton';
import { useMenuContext, useMenuLabel } from './menu-context';
import { MenuRow, type MenuItemBaseProps } from './parts';

// Mounted only while its menu is open, so following every snapshot costs nothing.
const wholeSnapshot = <T,>(snapshot: T): T => snapshot;

/**
 * Insert link, or Edit link when the caret is inside a link.
 *
 * The label follows what the row opens: on an existing link the popover opens in edit mode,
 * so a row that said "Insert link" there promised something else. A field-result link opens
 * the read-only panel, which offers no editing, so it keeps the insert label.
 *
 * @internal
 */
export function MenuLinkRow({ labelKey, shortcutKey, className, hidden }: MenuItemBaseProps) {
  const editor = useDocxEditor();
  const menu = useMenuContext();
  const label = useMenuLabel();
  // The label and the enabled state both depend on where the caret is. A link UI that
  // registers or goes away moves the snapshot too.
  useEditorState(wholeSnapshot);
  if (hidden) return null;
  const state = toolbarCommandState(editor, 'text.link');
  const reason = localizeDisabledReason(state.disabledReason, label);
  const control = chromeControlForSlot('text.link');
  const onLink = editor?.surface?.hyperlinks.linkAtCaret() != null;
  const text = label(labelKey ?? (onLink ? 'hyperlinkPopup.editLink' : 'formattingBar.insertLink'));
  return (
    <MenuRow
      icon={chromeIcon(control?.paths)}
      slot="text.link"
      {...(shortcutKey ? { shortcut: label(shortcutKey) } : {})}
      disabled={!state.enabled}
      title={reason ?? undefined}
      onSelect={() => {
        // Close first: closing puts focus back in the document, and the popover then moves
        // it to its URL field. The other order would take focus away from the open panel.
        menu.setOpenMenu(null);
        runToolbarCommand(editor, 'text.link');
      }}
      {...(className ? { className } : {})}
    >
      {text}
    </MenuRow>
  );
}
