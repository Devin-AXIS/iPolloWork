// The menu bar's entry shapes: the rows, submenus, and separators that `CHROME_MENUS` in
// `chrome-controls.ts` arranges. Types only, split out of that file to keep it under its
// line cap. `chrome-controls.ts` re-exports every name here.

import type { ChromeSlotId } from './chrome-controls.ts';

/**
 * A row that runs one chrome slot.
 *
 * @public
 */
export interface ChromeMenuItemEntry {
  readonly kind: 'item';
  readonly slot: ChromeSlotId;
  /**
   * Plain-label override for this row.
   *
   * A slot's own `labelKey` is a TOOLTIP key, and several of them fold the shortcut into
   * the text (`formattingBar.boldShortcut` is "Bold (Ctrl+B)"). A menu puts the shortcut
   * in its own right-hand column, so the row needs the bare noun. Both keys already exist
   * in the catalogue — this points at the plain one rather than minting a duplicate.
   */
  readonly labelKey?: string;
  /** i18n key of the shortcut shown right-aligned on the row (`toolbar.saveShortcut`). */
  readonly shortcutKey?: string;
  /**
   * The row opens a size PICKER instead of firing on click — Word's insert-table grid.
   * The slot still owns the label, the icon and the enabled state; only the dispatch
   * differs, and the picked size is what the host sends. `chartType` opens the list of chart
   * types, and the picked type is what the host inserts.
   */
  readonly picker?: 'tableGrid' | 'chartType';
}

/**
 * A row that opens a nested panel of rows (Insert › Break).
 *
 * It carries its own label and icon rather than a slot, because a submenu PARENT has no
 * command: clicking it opens the panel. Giving it a slot would mint a public id for a
 * control that can never be enabled, and `toolbarCommandState` would have to invent an
 * answer about it.
 *
 * @public
 */
export interface ChromeMenuSubmenuEntry {
  readonly kind: 'submenu';
  readonly labelKey: string;
  readonly paths: readonly string[] | null;
  readonly items: readonly ChromeMenuEntry[];
}

/** A horizontal rule between groups of rows. @public */
export interface ChromeMenuSeparatorEntry {
  readonly kind: 'separator';
}

/** One row of a chrome menu. @public */
export type ChromeMenuEntry =
  ChromeMenuItemEntry | ChromeMenuSubmenuEntry | ChromeMenuSeparatorEntry;

/**
 * Every menu id, as a literal union. Stable public API; renaming one is a breaking change,
 * exactly like a group or slot id.
 *
 * @public
 */
export type ChromeMenuId = 'file' | 'format' | 'insert' | 'review' | 'help';

/** One menu of the menu bar. @public */
export interface ChromeMenu {
  readonly id: ChromeMenuId;
  readonly labelKey: string;
  readonly entries: readonly ChromeMenuEntry[];
}
