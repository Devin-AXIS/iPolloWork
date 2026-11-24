import type { DocxEditorChildren } from '../../docx-editor-children';
// The context menu's rows.
//
// THE ROWS ARE THE MENU BAR'S ROWS. `MenuRow` (presentation), `MenuItem` (a chrome slot as
// a live row), `MenuSubmenu` and `MenuSeparator` are re-exported here rather than
// reimplemented: a right-click row and a menu-bar row are the same object down to the
// `aria-disabled`-with-the-engine's-reason treatment, and a second implementation would be
// a second place for that to drift. What this file adds is the one kind of row the menu bar
// has no need for — a row bound to an `EditorCommand` that no chrome slot names.
//
// WHY NOT SLOTS. Cut, Copy, Paste, Delete and Select All are not in `CHROME_GROUPS`, and
// putting them there would place five controls in the default toolbar arrangement that
// nothing renders. They pass a fixed `EditorCommand` to `useEditorCommand` instead, which
// takes either form — the slot arm asks `toolbarCommandState`, the command arm asks
// `Editor.can`/`isActive` directly, and both end at the same authority.

import { useMemo, useCallback } from 'react';
import type { EditorCommand } from '@docx-editor.dev/core/contracts/editor';
import { hostWindowOf, tableChromeIconPaths } from '@docx-editor.dev/core/editor';
import { useDocxEditor } from '../context';
import { useEditorCommand } from '../useEditorCommand';
import { useEditorState } from '../useEditorState';
import { MenuRow } from '../menu/parts';
import { useDialogHost } from '../dialog-host';
import { useMenuLabel } from '../menu/menu-context';
import { useContextMenuContext } from './contextmenu-context';
import { useNavigationViewportElement } from '../navigation/navigation-layout';
import {
  COPY_PATHS,
  CUT_PATHS,
  DELETE_PATHS,
  PASTE_PATHS,
  SELECT_ALL_PATHS,
  REFRESH_TOC_PATHS,
  REFRESH_TOC_PAGE_NUMBERS_PATHS,
} from './contextmenu-icons';
import { chromeControlForSlot, chromeIcon } from '../toolbar/ToolbarButton';

// ─────────────────────────────────────────────────────────────────────────────
// The generic command row
// ─────────────────────────────────────────────────────────────────────────────

/** Props for a packaged context-menu row. @public */
export interface ContextMenuCommandProps {
  /** Icon override. Defaults to the row's own Material Symbol. */
  icon?: DocxEditorChildren;
  /** i18n key for the label, overriding the packaged one. */
  labelKey?: string;
  /** i18n key for the shortcut column, overriding the packaged one. */
  shortcutKey?: string;
  className?: string;
  /** Render nothing — inside the default set this removes the row. */
  hidden?: boolean;
}

/**
 * Define a row bound to a fixed command.
 *
 * The `docxRow` static is the marker the default set's in-place override reads, the same
 * way the toolbar reads `docxSlot` and the menu bar reads `docxMenuRow`. Never
 * `displayName`, which minifies away.
 */
function defineCommandRow(
  rowId: string,
  command: EditorCommand,
  defaults: { labelKey: string; shortcutKey: string; paths: readonly string[] }
) {
  const Part = ({ icon, labelKey, shortcutKey, className, hidden }: ContextMenuCommandProps) => {
    const editor = useDocxEditor();
    const { close } = useContextMenuContext();
    const label = useMenuLabel();
    const { isEnabled, disabledReason } = useEditorCommand(command);
    if (hidden) return null;
    return (
      <MenuRow
        slot={rowId}
        icon={icon ?? chromeIcon(defaults.paths)}
        shortcut={label(shortcutKey ?? defaults.shortcutKey)}
        disabled={!isEnabled}
        {...(disabledReason ? { title: disabledReason } : {})}
        onSelect={() => {
          editor?.exec(command);
          close(true);
        }}
        {...(className ? { className } : {})}
      >
        {label(labelKey ?? defaults.labelKey)}
      </MenuRow>
    );
  };
  return Object.assign(Part, { docxRow: rowId });
}

/** Cut the selection to the clipboard. Disabled with the engine's reason when nothing is selected. @public */
export const ContextMenuCut = defineCommandRow(
  'edit.cut',
  { type: 'cut' },
  { labelKey: 'contextMenu.cut', shortcutKey: 'contextMenu.cutShortcut', paths: CUT_PATHS }
);

/** Copy the selection. Stays available in a read-only document. @public */
export const ContextMenuCopy = defineCommandRow(
  'edit.copy',
  { type: 'copy' },
  { labelKey: 'contextMenu.copy', shortcutKey: 'contextMenu.copyShortcut', paths: COPY_PATHS }
);

/** Delete the selection. @public */
export const ContextMenuDelete = defineCommandRow(
  'edit.delete',
  { type: 'deleteText' },
  { labelKey: 'contextMenu.delete', shortcutKey: 'contextMenu.deleteShortcut', paths: DELETE_PATHS }
);

/** Select the whole body. @public */
export const ContextMenuSelectAll = defineCommandRow(
  'edit.selectAll',
  { type: 'selectAll' },
  {
    labelKey: 'contextMenu.selectAll',
    shortcutKey: 'contextMenu.selectAllShortcut',
    paths: SELECT_ALL_PATHS,
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Paste — the one row that reaches outside the engine
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Paste the clipboard's text at the selection.
 *
 * THE ROW READS THE CLIPBOARD, not the engine. `exec` is synchronous and clipboard read is
 * not — it prompts in Chrome and is refused outright by Firefox and Safari — so the read
 * happens here, inside the click that asked for it, where the permission gesture belongs,
 * and the text goes to the engine as an argument.
 *
 * Nothing can know whether the read will succeed BEFORE it is attempted, so the row starts
 * enabled (when the engine would accept a paste at all) and disables itself, with the
 * browser's own reason, once a read has actually been refused. Guessing the answer up front
 * would either grey out a working Paste on Chrome or advertise a dead one on Safari.
 *
 * @public
 */
export function ContextMenuPaste({
  icon,
  labelKey,
  shortcutKey,
  className,
  hidden,
}: ContextMenuCommandProps) {
  const editor = useDocxEditor();
  const { close, clipboardRefusal, reportClipboardRefusal } = useContextMenuContext();
  const viewport = useNavigationViewportElement();
  const label = useMenuLabel();
  // A single space probes the SHAPE and the mode — is a paste admissible here at all —
  // without claiming to know what the clipboard holds. NOT the empty string: `paste` with
  // no text still replaces the selection, so an empty probe asks about a destructive edit.
  const probe = useMemo((): EditorCommand => ({ type: 'paste', text: ' ' }), []);
  const { isEnabled, disabledReason } = useEditorCommand(probe);
  if (hidden) return null;
  const blocked = clipboardRefusal !== null;
  return (
    <MenuRow
      slot="edit.paste"
      icon={icon ?? chromeIcon(PASTE_PATHS)}
      shortcut={label(shortcutKey ?? 'contextMenu.pasteShortcut')}
      disabled={!isEnabled || blocked}
      {...((clipboardRefusal ?? disabledReason)
        ? { title: clipboardRefusal ?? disabledReason ?? '' }
        : {})}
      onSelect={() => {
        // Close first: the read can wait on a browser permission prompt, and a menu
        // left open over it looks stuck. The read still starts inside this click.
        close(true);
        void (async () => {
          try {
            const { text, html } = await readClipboardPayload(viewport);
            // An empty clipboard is not a refusal — there is simply nothing to insert.
            if (text || html) {
              editor?.exec({ type: 'paste', text, ...(html ? { html } : {}) });
            }
          } catch (error) {
            reportClipboardRefusal(
              error instanceof Error ? error.message : 'the clipboard is not readable'
            );
          }
        })();
      }}
      {...(className ? { className } : {})}
    >
      {label(labelKey ?? 'contextMenu.paste')}
    </MenuRow>
  );
}

ContextMenuPaste.docxRow = 'edit.paste' as const;

/**
 * Both clipboard flavours where the async read allows it, plain text where it does not.
 *
 * Some engines strip attributes from async-read HTML, which can drop the embedded
 * fragment — the engine's paste router degrades to the remaining flavours, so the read
 * never has to guess what survived.
 */
async function readClipboardPayload(
  owner: Node | null
): Promise<{ text: string; html: string | null }> {
  // The editor's window: an unfocused opener's clipboard refuses the read.
  const win = hostWindowOf(owner);
  const clipboard = win.navigator.clipboard;
  if (typeof clipboard.read === 'function' && typeof win.ClipboardItem !== 'undefined') {
    try {
      const items = await clipboard.read();
      let text = '';
      let html: string | null = null;
      for (const item of items) {
        if (item.types.includes('text/plain')) {
          text = await (await item.getType('text/plain')).text();
        }
        if (item.types.includes('text/html')) {
          html = await (await item.getType('text/html')).text();
        }
      }
      if (text || html) return { text, html };
    } catch {
      // Fall through to the plain read; a refusal there is the one reported.
    }
  }
  return { text: await clipboard.readText(), html: null };
}

/**
 * Paste the clipboard's plain text as if typed, whatever richer flavours it holds.
 *
 * The Cmd+Shift+V twin as a menu row: same clipboard-read contract as
 * {@link ContextMenuPaste}, routed through the `pasteWithoutFormatting` command.
 *
 * @public
 */
export function ContextMenuPasteWithoutFormatting({
  icon,
  labelKey,
  shortcutKey,
  className,
  hidden,
}: ContextMenuCommandProps) {
  const editor = useDocxEditor();
  const { close, clipboardRefusal, reportClipboardRefusal } = useContextMenuContext();
  const viewport = useNavigationViewportElement();
  const label = useMenuLabel();
  const probe = useMemo((): EditorCommand => ({ type: 'pasteWithoutFormatting', text: ' ' }), []);
  const { isEnabled, disabledReason } = useEditorCommand(probe);
  if (hidden) return null;
  const blocked = clipboardRefusal !== null;
  return (
    <MenuRow
      slot="edit.pasteWithoutFormatting"
      icon={icon ?? chromeIcon(PASTE_PATHS)}
      shortcut={label(shortcutKey ?? 'contextMenu.pasteWithoutFormattingShortcut')}
      disabled={!isEnabled || blocked}
      {...((clipboardRefusal ?? disabledReason)
        ? { title: clipboardRefusal ?? disabledReason ?? '' }
        : {})}
      onSelect={() => {
        // Close first: the read can wait on a browser permission prompt, and a menu
        // left open over it looks stuck. The read still starts inside this click.
        close(true);
        void (async () => {
          try {
            const text = await hostWindowOf(viewport).navigator.clipboard.readText();
            if (text) editor?.exec({ type: 'pasteWithoutFormatting', text });
          } catch (error) {
            reportClipboardRefusal(
              error instanceof Error ? error.message : 'the clipboard is not readable'
            );
          }
        })();
      }}
      {...(className ? { className } : {})}
    >
      {label(labelKey ?? 'contextMenu.pasteWithoutFormatting')}
    </MenuRow>
  );
}

ContextMenuPasteWithoutFormatting.docxRow = 'edit.pasteWithoutFormatting' as const;

/**
 * The chrome registry's paintbrush, so the rows and the toolbar button draw one glyph.
 *
 * Read from the registry rather than copied into `contextmenu-icons.ts`: unlike Cut and
 * Paste, the painter IS a chrome slot (`format.painter`), and a second copy of its path
 * data is a silent visual drift the day the registry's changes.
 */
const FORMAT_PAINTER_PATHS: readonly string[] = chromeControlForSlot('format.painter')?.paths ?? [];

/**
 * Copy the formatting at the selection — the Format Painter's read half.
 *
 * Stays available in a read-only document, like Copy: it writes nothing.
 *
 * @public
 */
export const ContextMenuCopyFormatting = defineCommandRow(
  'format.copyFormatting',
  { type: 'copyFormatting' },
  {
    labelKey: 'contextMenu.copyFormatting',
    shortcutKey: 'contextMenu.copyFormattingShortcut',
    paths: FORMAT_PAINTER_PATHS,
  }
);

/**
 * Apply the copied formatting to the selection.
 *
 * Disabled with the engine's own reason until something has been copied, so the row says
 * why rather than looking live and doing nothing.
 *
 * @public
 */
export const ContextMenuPasteFormatting = defineCommandRow(
  'format.pasteFormatting',
  { type: 'pasteFormatting' },
  {
    labelKey: 'contextMenu.pasteFormatting',
    shortcutKey: 'contextMenu.pasteFormattingShortcut',
    paths: FORMAT_PAINTER_PATHS,
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Table context rows — fixed commands, not chrome slots
// ─────────────────────────────────────────────────────────────────────────────

/** Props for packaged table context-menu rows. @public */
export interface ContextMenuTableRowProps extends ContextMenuCommandProps {
  /** When true, the row uses the destructive treatment. */
  destructive?: boolean;
}

function defineTableCommandRow(
  rowId: string,
  command: EditorCommand,
  defaults: { labelKey: string; paths: readonly string[]; destructive?: boolean }
) {
  const Part = ({ icon, labelKey, className, hidden, destructive }: ContextMenuTableRowProps) => {
    const { close } = useContextMenuContext();
    const label = useMenuLabel();
    const tableVisible = useTableContextMenuVisible();
    const { isEnabled, disabledReason, execute } = useEditorCommand(command);
    if (hidden || !tableVisible) return null;
    return (
      <MenuRow
        slot={rowId}
        icon={icon ?? chromeIcon(defaults.paths)}
        disabled={!isEnabled}
        {...(disabledReason ? { title: disabledReason } : {})}
        className={`${(destructive ?? defaults.destructive) ? 'docx-table-chrome__destructive-row' : ''}${className ? ` ${className}` : ''}`}
        onSelect={() => {
          if (execute()) close(true);
        }}
      >
        {label(labelKey ?? defaults.labelKey)}
      </MenuRow>
    );
  };
  return Object.assign(Part, { docxRow: rowId });
}

/** Select every cell of the table at the selection. @public */
export const ContextMenuSelectTable = defineTableCommandRow(
  'table.selectTable',
  { type: 'selectTableRegion', region: 'table' },
  { labelKey: 'table.selectTable', paths: tableChromeIconPaths('select_all') }
);

/** Insert a row above the current table row. @public */
export const ContextMenuInsertRowAbove = defineTableCommandRow(
  'table.insertRowAbove',
  { type: 'insertRow', where: 'above' },
  { labelKey: 'table.insertRowAbove', paths: tableChromeIconPaths('table_rows') }
);

/** Insert a row below the current table row. @public */
export const ContextMenuInsertRowBelow = defineTableCommandRow(
  'table.insertRowBelow',
  { type: 'insertRow', where: 'below' },
  { labelKey: 'table.insertRowBelow', paths: tableChromeIconPaths('table_rows') }
);

/** Insert a column to the left of the current column. @public */
export const ContextMenuInsertColumnLeft = defineTableCommandRow(
  'table.insertColumnLeft',
  { type: 'insertColumn', where: 'left' },
  { labelKey: 'table.insertColumnLeft', paths: tableChromeIconPaths('view_column') }
);

/** Insert a column to the right of the current column. @public */
export const ContextMenuInsertColumnRight = defineTableCommandRow(
  'table.insertColumnRight',
  { type: 'insertColumn', where: 'right' },
  { labelKey: 'table.insertColumnRight', paths: tableChromeIconPaths('view_column') }
);

/** Merge the selected cells into one cell. @public */
export const ContextMenuMergeCells = defineTableCommandRow(
  'table.mergeCells',
  { type: 'mergeCells' },
  { labelKey: 'table.mergeCells', paths: tableChromeIconPaths('call_merge') }
);

/** Open the Split cells dialog for the cell at the selection. @public */
export const ContextMenuSplitCell = Object.assign(
  ({ icon, labelKey, className, hidden }: ContextMenuCommandProps) => {
    const { close } = useContextMenuContext();
    const label = useMenuLabel();
    const tableVisible = useTableContextMenuVisible();
    const dialogs = useDialogHost();
    // The slot's probe answers whether the cell splits; the dialog picks the counts.
    const { isEnabled, disabledReason } = useEditorCommand('table.splitCell');
    if (hidden || !tableVisible || !dialogs) return null;
    return (
      <MenuRow
        slot="table.splitCell"
        icon={icon ?? chromeIcon(tableChromeIconPaths('call_split'))}
        disabled={!isEnabled}
        {...(disabledReason ? { title: disabledReason } : {})}
        {...(className ? { className } : {})}
        onSelect={() => {
          // Focus goes back to the document first, so closing the dialog returns it there.
          close(true);
          dialogs.open('splitCell');
        }}
      >
        {label(labelKey ?? 'table.splitCell')}
      </MenuRow>
    );
  },
  { docxRow: 'table.splitCell' }
);

/** Delete the current table row. @public */
export const ContextMenuDeleteTableRow = defineTableCommandRow(
  'table.deleteRow',
  { type: 'deleteRow' },
  {
    labelKey: 'table.deleteRow',
    paths: tableChromeIconPaths('delete_sweep'),
    destructive: true,
  }
);

/** Delete the current table column. @public */
export const ContextMenuDeleteTableColumn = defineTableCommandRow(
  'table.deleteColumn',
  { type: 'deleteColumn' },
  {
    labelKey: 'table.deleteColumn',
    paths: tableChromeIconPaths('view_column'),
    destructive: true,
  }
);

/** Delete the entire table. @public */
export const ContextMenuDeleteTable = defineTableCommandRow(
  'table.deleteTable',
  { type: 'deleteTable' },
  {
    labelKey: 'table.deleteTable',
    paths: tableChromeIconPaths('delete'),
    destructive: true,
  }
);

const CELL_VERTICAL_ALIGNMENT_COMMANDS = [
  {
    alignment: 'top',
    labelKey: 'tableAdvanced.top',
    icon: 'vertical_align_top',
  },
  {
    alignment: 'center',
    labelKey: 'tableAdvanced.middle',
    icon: 'vertical_align_center',
  },
  {
    alignment: 'bottom',
    labelKey: 'tableAdvanced.bottom',
    icon: 'vertical_align_bottom',
  },
] as const;

/** Compact vertical-alignment picker for selected table cells. @public */
export function ContextMenuCellVerticalAlignment({ hidden }: ContextMenuCommandProps) {
  const { close } = useContextMenuContext();
  const label = useMenuLabel();
  const tableVisible = useTableContextMenuVisible();
  const top = useEditorCommand({
    type: 'setTableCellVerticalAlignment',
    alignment: 'top',
  });
  const center = useEditorCommand({
    type: 'setTableCellVerticalAlignment',
    alignment: 'center',
  });
  const bottom = useEditorCommand({
    type: 'setTableCellVerticalAlignment',
    alignment: 'bottom',
  });
  const states = [top, center, bottom] as const;
  if (hidden || !tableVisible) return null;
  return (
    <div className="docx-contextmenu__table-align">
      <span className="docx-contextmenu__table-align-label">
        {label('tableAdvanced.verticalAlignment')}
      </span>
      <div
        className="docx-contextmenu__table-align-buttons"
        role="group"
        aria-label={label('tableAdvanced.verticalAlignment')}
      >
        {CELL_VERTICAL_ALIGNMENT_COMMANDS.map((item, index) => {
          const state = states[index]!;
          return (
            <button
              key={item.alignment}
              type="button"
              role="menuitemradio"
              aria-checked={false}
              aria-label={label(item.labelKey)}
              title={state.disabledReason ?? label(item.labelKey)}
              aria-disabled={!state.isEnabled}
              className="docx-contextmenu__table-align-button"
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={() => {
                if (state.execute()) close(true);
              }}
            >
              {chromeIcon(tableChromeIconPaths(item.icon))}
            </button>
          );
        })}
      </div>
    </div>
  );
}

ContextMenuCellVerticalAlignment.docxRow = 'table.cellVerticalAlignment' as const;

// ─────────────────────────────────────────────────────────────────────────────
// Table of contents
// ─────────────────────────────────────────────────────────────────────────────

/** The right-clicked table of contents in a command; without an id, the engine picks one. */
const withToc = (tocId: string | null) => (tocId ? { tocId } : {});
const refreshToc =
  (mode: 'entire' | 'pageNumbers') =>
  (tocId: string | null): EditorCommand => ({ type: 'refreshToc', mode, ...withToc(tocId) });
const removeToc = (tocId: string | null): EditorCommand => ({
  type: 'removeToc',
  ...withToc(tocId),
});

/**
 * Define a row that only exists while the right-click landed on a table of contents.
 *
 * Contextual the same way the table rows are, but keyed on the TOC the OPEN captured
 * rather than on the caret: a generated TOC refuses the caret outright, so a right-click on
 * it leaves the caret where it was, and the pointed-at table of contents is the only thing
 * that can say these rows apply. The row also carries that id into the command, so a document with two
 * tables of contents refreshes the one the user pointed at.
 */
function defineTocCommandRow(
  rowId: string,
  commandOf: (tocId: string | null) => EditorCommand,
  defaults: { labelKey: string; paths: readonly string[] }
) {
  const Part = ({ icon, labelKey, className, hidden }: ContextMenuCommandProps) => {
    const editor = useDocxEditor();
    const { close, tocId } = useContextMenuContext();
    const label = useMenuLabel();
    const command = useMemo(() => commandOf(tocId), [tocId]);
    const { isEnabled, disabledReason } = useEditorCommand(command);
    if (hidden || tocId === null) return null;
    return (
      <MenuRow
        slot={rowId}
        icon={icon ?? chromeIcon(defaults.paths)}
        disabled={!isEnabled}
        {...(disabledReason ? { title: disabledReason } : {})}
        onSelect={() => {
          editor?.exec(command);
          close(true);
        }}
        {...(className ? { className } : {})}
      >
        {label(labelKey ?? defaults.labelKey)}
      </MenuRow>
    );
  };
  return Object.assign(Part, { docxRow: rowId });
}

/** Rebuild the pointed-at table of contents from the document's headings. @public */
export const ContextMenuRefreshToc = defineTocCommandRow('toc.refresh', refreshToc('entire'), {
  labelKey: 'toc.refresh',
  paths: REFRESH_TOC_PATHS,
});

/** Re-resolve only the page numbers of the pointed-at table of contents. @public */
export const ContextMenuRefreshTocPageNumbers = defineTocCommandRow(
  'toc.refreshPageNumbers',
  refreshToc('pageNumbers'),
  { labelKey: 'toc.refreshPageNumbers', paths: REFRESH_TOC_PAGE_NUMBERS_PATHS }
);

/** Remove the pointed-at table of contents, with its control and heading. @public */
export const ContextMenuRemoveToc = defineTocCommandRow('toc.remove', removeToc, {
  labelKey: 'toc.remove',
  paths: DELETE_PATHS,
});

/** Fixed table-of-contents context rows, in menu order. @internal */
export const TOC_CONTEXT_ROWS = [
  ContextMenuRefreshToc,
  ContextMenuRefreshTocPageNumbers,
  ContextMenuRemoveToc,
] as const;

/** Whether table context rows should render for the current selection. @internal */
export function useTableContextMenuVisible(): boolean {
  return useEditorState(
    useCallback((snapshot) => snapshot.table != null, []),
    (a, b) => a === b
  );
}

/** Fixed table context rows in registry order. @internal */
export const TABLE_CONTEXT_ROWS = [
  ContextMenuSelectTable,
  ContextMenuInsertRowAbove,
  ContextMenuInsertRowBelow,
  ContextMenuInsertColumnLeft,
  ContextMenuInsertColumnRight,
  ContextMenuDeleteTableRow,
  ContextMenuDeleteTableColumn,
  ContextMenuDeleteTable,
  ContextMenuCellVerticalAlignment,
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// The host's own row
// ─────────────────────────────────────────────────────────────────────────────

/** Props for `DocxEditor.ContextMenu.Item`: a host-owned row. @public */
export interface ContextMenuItemProps {
  /**
   * Label, as a resolved STRING rather than an i18n key — the row belongs to the host's own
   * action, so the host's own catalogue resolves it. The packaged rows go the other way.
   */
  label: string;
  icon?: DocxEditorChildren;
  /** Right-aligned shortcut text, already resolved. */
  shortcut?: string;
  disabled?: boolean;
  /** Tooltip when disabled. Say why — never invent a reason the engine did not give. */
  disabledReason?: string;
  /** Checked state, for a row that toggles. Leave undefined on a row that just acts. */
  active?: boolean;
  onSelect?: () => void;
  className?: string;
}

/**
 * A host-owned context-menu row, styled and behaved like the packaged ones.
 *
 * The toolbar's `Action` for the right-click surface: no slot, no command, no engine wiring
 * — enabled state and the action are the host's, because the engine has no opinion about an
 * action it does not model. Selecting it closes the menu.
 *
 * @public
 */
export function ContextMenuItem({
  label,
  icon,
  shortcut,
  disabled,
  disabledReason,
  active,
  onSelect,
  className,
}: ContextMenuItemProps) {
  const { close } = useContextMenuContext();
  return (
    <MenuRow
      {...(icon ? { icon } : {})}
      {...(shortcut ? { shortcut } : {})}
      {...(disabled ? { disabled } : {})}
      {...(disabled && disabledReason ? { title: disabledReason } : {})}
      {...(active !== undefined ? { active } : {})}
      onSelect={() => {
        // Close first: `close(true)` returns focus to the document, and a host row that
        // opens a dialog must keep the focus that dialog takes.
        close(true);
        onSelect?.();
      }}
      {...(className ? { className } : {})}
    >
      {label}
    </MenuRow>
  );
}

/** Props for `DocxEditor.ContextMenu.Start`. @public */
export interface ContextMenuStartProps {
  children?: DocxEditorChildren;
}
