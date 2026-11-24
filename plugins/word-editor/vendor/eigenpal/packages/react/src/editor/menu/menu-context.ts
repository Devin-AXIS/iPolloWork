import type { ChromeExportFormat } from '@docx-editor.dev/core/editor';
// Menu-scoped context: the translate function and the three host actions the menu bar's
// File rows need, published by the root to its parts.
//
// Open, save and page setup are the rows whose dispatch is NOT an engine command — bytes
// and dialog values cross the host boundary — so the root resolves each to a single
// handler (host override, else the packaged default) and the rows only call it. A row
// never decides policy; it renders what the context gives it.
//
// Like the toolbar context, no user-facing English lives here: labels are i18n keys from
// the chrome registry, resolved through the host's `t` or the active `LocaleContext`
// catalogue — the same default the packaged `<DocxEditor>` uses. The context menu's rows
// resolve through `useMenuLabel` too, so this one fallback covers both surfaces.

import { createContext, useContext } from 'react';
import { useTranslation } from '../../i18n';
import type { TranslationKey } from '../../i18n';
import type { ChromeMenuId } from '@docx-editor.dev/core/editor';
import type { ToolbarTranslate } from '../toolbar/toolbar-context';

/**
 * A menu's identity: one of the registry's five, or a HOST'S OWN.
 *
 * The `(string & {})` arm keeps the registry ids as editor autocomplete while accepting
 * any other string, so a product can add "Review" or "Clauses" without the library having
 * to know about it. Lives here rather than in `parts` because the bar's open/active state
 * is keyed on it and both modules read that state.
 *
 * @public
 */
export type MenuId = ChromeMenuId | (string & {});

export interface MenuContextValue {
  readonly onExport?: (format: ChromeExportFormat) => void;
  readonly onPrint?: () => void;
  /** Whether the print row shows its shortcut: the editor handles it only with a PDF handler. */
  readonly printShortcut?: boolean;
  readonly t: ToolbarTranslate | undefined;
  /** Which menu is open, or null. Owned by the root so only one panel shows at a time. */
  readonly openMenu: MenuId | null;
  readonly setOpenMenu: (id: MenuId | null) => void;
  /**
   * Which trigger holds the bar's single tab stop (the roving tabindex). Separate from
   * `openMenu` because the bar must be tabbable while CLOSED — otherwise a keyboard user
   * cannot reach it at all — and because arrowing along the bar moves the stop without
   * opening anything.
   */
  readonly activeMenu: MenuId | null;
  /** Resolved File-row actions; absent renders the row disabled. */
  readonly onOpen: (() => void) | undefined;
  readonly onSave: (() => void) | undefined;
  readonly onPageSetup: (() => void) | undefined;
  /** Open the Paragraph dialog. Undefined when the host has not composed one. */
  readonly onParagraphDialog: (() => void) | undefined;
  /** Open the Watermark dialog. Undefined before the editor is ready. */
  readonly onWatermarkDialog?: (() => void) | undefined;
  /** Replaces the packaged Help row's handler. */
  readonly onReportIssue: (() => void) | undefined;
  /** `false` drops the packaged Help row, and Help with it. */
  readonly reportIssue: boolean | undefined;
  /**
   * A document is opening. The bar is disabled, like the toolbar: the previous document is
   * still mounted, and a menu command would act on the document about to be replaced.
   */
  readonly opening?: boolean;
}

export const MenuContext = createContext<MenuContextValue>({
  t: undefined,
  openMenu: null,
  setOpenMenu: () => {},
  activeMenu: null,
  onOpen: undefined,
  onSave: undefined,
  onPageSetup: undefined,
  onParagraphDialog: undefined,
  onWatermarkDialog: undefined,
  onReportIssue: undefined,
  reportIssue: undefined,
});

/** The id of the "⋯" menu that holds the menus that do not fit. */
export const MENU_OVERFLOW_ID = 'docx-menubar-more';

/** Which menus moved into the "⋯" menu, and where the reading component renders. */
export interface MenuOverflowValue {
  /** Whether the bar measures its menus. Menus then mark themselves as collapsible. */
  readonly measuring: boolean;
  /** Ids of the menus that render inside the "⋯" menu instead of the bar. */
  readonly overflow: ReadonlySet<string>;
  /** True inside the "⋯" menu's panel, where a menu renders as a submenu row. */
  readonly inMore: boolean;
}

export const MenuOverflowContext = createContext<MenuOverflowValue>({
  measuring: false,
  overflow: new Set<string>(),
  inMore: false,
});

export function useMenuOverflow(): MenuOverflowValue {
  return useContext(MenuOverflowContext);
}

export function useMenuContext(): MenuContextValue {
  return useContext(MenuContext);
}

/** The label for an i18n key: the host's translation, else the locale catalogue. */
export function useMenuLabel(): (key: string) => string {
  const { t } = useMenuContext();
  const { t: catalogT } = useTranslation();
  return (key: string) => t?.(key) ?? catalogT(key as TranslationKey);
}

/** Direct menubar rows participate in Tab navigation; popup rows use arrow keys. */
export const MenuRowTabIndexContext = createContext(-1);
