import {
  editorHostElement,
  editorInstanceScope,
  hostDocumentOf,
  hostWindowOf,
  isDomNode,
  listenForOutsidePress,
} from '@docx-editor.dev/core/editor';
import { DocxEditorExportDialog } from '../DocxEditorExportDialog';
import { DocxEditorPrintDialog } from '../DocxEditorPrintDialog';
import { usePopupConfig } from '../popup-config';
import { renderPopup } from '../popup-renderer';
import { useMenuExport } from './useMenuExport';
import { useMenuPrint } from './useMenuPrint';
import type { ChromeExportHandlers } from '@docx-editor.dev/core/editor';
import { DialogPortal, useDialogHost } from '../dialog-host';
import type { DocxEditorChildren } from '../../docx-editor-children';
import type { ReactNode } from 'react';
// The compound menu bar: File · Format · Insert · Review · Help, derived FROM the chrome registry.
//
// DEFAULT-SET + IN-PLACE OVERRIDE, the same contract the toolbar has. With no children
// the bar renders every menu of `CHROME_MENUS` in registry order; a child that is a menu
// part — recognized by its `docxMenu` static, never by displayName — REPLACES its menu in
// place, `hidden` removes it, other children append, and `preset={false}` opts out.
//
// The bar owns three things the rows cannot own individually:
//
// - WHICH menu is open. One panel at a time, so a click on File closes Insert; the state
//   lives here and rows close the bar by setting it to null.
// - THE HOST-BOUNDARY ACTIONS. Open, save and page setup are not engine commands (bytes
//   and dialog values come from outside), so the root resolves each ONCE — the host's
//   handler when given, else the packaged default — and publishes it. A row that finds no
//   handler renders disabled rather than pretending.
// - THE SHORTCUTS IT ADVERTISES. The File rows print Ctrl+O and Ctrl+S, and the engine
//   keymap binds neither, so the bar binds them itself. A shortcut column that names a key
//   combination nothing listens to is the same class of lie as an enabled dead button.

import {
  Children,
  Fragment,
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactElement } from 'react';
import {
  CHROME_MENUS,
  isChromePrintShortcut,
  type ChromeMenuId,
} from '@docx-editor.dev/core/editor';
import { useDocxEditor } from '../context';
import { useEditorState } from '../useEditorState';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { useChromeDir, useTranslation } from '../../i18n';
import type { TranslationKey } from '../../i18n';
import { DocxEditorPageSetupDialog } from '../DocxEditorPageSetup';
import { DocxEditorParagraphDialog } from '../DocxEditorParagraphDialog';
import { DocxEditorWatermarkDialog } from '../DocxEditorWatermark';
import { MenuWatermark } from './menu-watermark';
import { MenuBookmark } from './menu-bookmark';
import type { ToolbarTranslate } from '../toolbar/toolbar-context';
import { chromeIcon, guardToolbarMousedown } from '../toolbar/ToolbarButton';
import {
  MENU_OVERFLOW_ID,
  MenuRowTabIndexContext,
  MenuContext,
  MenuOverflowContext,
  type MenuContextValue,
  type MenuId,
  type MenuOverflowValue,
} from './menu-context';
import { FIXED_ATTRIBUTE, useToolbarGroupOverflow } from '../toolbar/useToolbarOverflow';
import { MORE_PATHS } from '../toolbar/ToolbarOverflow';
import { download, downloadName } from './download';
import { barTriggers, isPoppedOutEditorTarget, restoreExportFocus } from './menu-keyboard';
import { useEditorHostDocument } from '../useEditorHostDocument';
import {
  Menu,
  MenuEntry,
  MenuFile,
  MenuFormat,
  MenuImageInsert,
  MenuInsert,
  MenuItem,
  MenuOpen,
  MenuPageSetup,
  MenuRow,
  MenuSave,
  MenuExportMarkdown,
  MenuExportPdf,
  MenuPrint,
  MenuGroup,
  MenuSeparator,
  MenuSubmenu,
  MenuTableGrid,
  type MenuPartComponent,
} from './parts';
import { MenuHelp, MenuReportIssue } from './menu-help';
import { useChromeScopeClassName } from '../color-mode-context';
import { MenuReview, MenuReviewers } from './Reviewers';
import { usePopupEscape } from '../toolbar/usePopupEscape';

/** The pinned part for each registry menu, so the default bar is derived, not hand-listed. */
const MENU_PARTS: Record<ChromeMenuId, MenuPartComponent> = {
  file: MenuFile,
  format: MenuFormat,
  insert: MenuInsert,
  review: MenuReview,
  help: MenuHelp,
};

/** Props for `DocxEditor.Menu`. @public */
export interface DocxEditorMenuProps {
  /**
   * Converter handlers. Markdown requires docx-to-markdown; PDF requires docx-to-pdf on Node.js.
   * File > Print also uses the PDF handler. Missing handlers show an error.
   */
  exporters?: ChromeExportHandlers;
  /**
   * Whether File > Print first asks which markup to print and whether comments print.
   * Defaults to `true` with the packaged print dialog. A custom `popups.print` component
   * opts in with `true` and renders the `choosing` state, or `DocxEditor.PrintDialog`
   * without children. `popups.print: false` prints the current view without asking.
   */
  printSettings?: boolean;
  /** Appended after the base `docx-menubar` class. */
  className?: string;
  /** i18n resolver for row labels; without it the raw keys show (never English). */
  t?: ToolbarTranslate;
  /**
   * Name for the file the packaged Save writes, without the extension. Ignored when
   * `onSave` is given.
   */
  fileName?: string;
  /**
   * Replaces File › Open. The default opens a file picker and hands the bytes to
   * `Editor.load` — a user-driven file READ, never a fetch.
   */
  onOpen?: () => void;
  /**
   * Fired when the packaged Open reads a file, before its bytes are loaded — so a host can
   * reflect the file's name in its own title chrome. Not fired when `onOpen` replaced the
   * packaged picker: the host is reading the file itself and already holds the name.
   */
  onOpenFile?: (file: File) => void;
  /** Replaces File › Save. The default runs `Editor.save()` and downloads the bytes. */
  onSave?: () => void;
  /** Owns Page Setup opening when `popups.pageSetup` is omitted. Use `popups` to customize its UI. */
  onPageSetup?: () => void;
  /**
   * Replaces Help › Report issue. The default opens THIS project's issue tracker,
   * prefilled with the current page URL and user agent — so a host embedding the editor
   * in its own product should point this at its own support channel, or drop the row with
   * `reportIssue={false}`.
   */
  onReportIssue?: () => void;
  /** `false` removes Help › Report issue, and the Help menu with it. Default `true`. */
  reportIssue?: boolean;
  /**
   * `false` renders children verbatim with no default arrangement. Default `true`: menu
   * children override their menu in place, others append.
   */
  preset?: boolean;
  /**
   * What the bar does when its menus do not fit on one line. Default `true`: the bar stays
   * one line, measures its menus, and moves the ones that do not fit, from the end, into
   * one "⋯" menu, where each becomes a submenu with the same rows. `false` lets the bar
   * wrap onto more lines instead.
   *
   * The bar must be able to shrink for this to work, so give it a bounded width (for
   * example `min-width: 0` in a flex row). Host children that are not menus never move.
   *
   * @example
   * ```tsx
   * <DocxEditor.Menu overflow={false} />
   * ```
   */
  overflow?: boolean;
  children?: DocxEditorChildren;
}

/**
 * The id of any menu element, registry or host: a pinned part's `docxMenu`, or the generic
 * `Menu`'s `id` prop. Null for anything that is not a menu, and for a hidden menu unless
 * `includeHidden` is set.
 */
function anyMenuIdOfChild(child: ReactNode, includeHidden = false): string | null {
  if (!isValidElement(child)) return null;
  if (child.type === Fragment) {
    const inner = Children.toArray((child.props as { children?: DocxEditorChildren }).children);
    const ids = inner
      .map((node) => anyMenuIdOfChild(node, includeHidden))
      .filter((id): id is string => id !== null);
    return ids.length === 1 ? ids[0]! : null;
  }
  const props = child.props as { id?: unknown; hidden?: unknown };
  if (props.hidden === true && !includeHidden) return null;
  const type = child.type as { docxMenu?: unknown };
  if ((typeof type === 'function' || typeof type === 'object') && typeof type.docxMenu === 'string')
    return type.docxMenu;
  if (child.type === Menu && typeof props.id === 'string') return props.id;
  return null;
}

const MENU_IDS = new Set<string>(CHROME_MENUS.map((menu) => menu.id));

/**
 * The menu id one child element drives, or null for a non-menu child.
 *
 * Recognizes THREE shapes, because missing any of them is not a no-op — an unrecognized
 * child is APPENDED, so the bar renders that menu twice and both copies open together
 * (`Menu` keys purely off `openMenu === id`):
 *
 * - a pinned part (`DocxEditor.Menu.File`), by its `docxMenu` static;
 * - the generic `DocxEditor.Menu.Menu` with an `id` prop, which the namespace documents as
 *   "a menu of the bar, addressed by registry id" and which carries no static at all;
 * - either of those wrapped in a Fragment. `Children.toArray` does not flatten Fragment
 *   ELEMENTS, so `child.type` is a symbol and the naive check falls through — which a host
 *   hits the moment it maps over its overrides with a `<>…</>` around them.
 */
function menuOfChild(child: ReactNode): ChromeMenuId | null {
  if (!isValidElement(child)) return null;
  if (child.type === Fragment) {
    // One menu per fragment: a fragment holding two overrides is ambiguous about which
    // slot it replaces, so it appends rather than guessing.
    const inner = Children.toArray((child.props as { children?: DocxEditorChildren }).children);
    const ids = inner.map(menuOfChild).filter((id): id is ChromeMenuId => id !== null);
    return ids.length === 1 ? ids[0]! : null;
  }
  const type = child.type as { docxMenu?: unknown };
  if (typeof type === 'function' || typeof type === 'object') {
    if (typeof type.docxMenu === 'string') return type.docxMenu as ChromeMenuId;
  }
  // The generic `Menu`: identity comparison against the exported component, then its own
  // `id` prop. Compared by reference rather than by name — displayName minifies away.
  if (child.type === Menu) {
    const id = (child.props as { id?: unknown }).id;
    if (typeof id === 'string' && MENU_IDS.has(id)) return id as ChromeMenuId;
  }
  return null;
}

const selectOpening = (snapshot: EditorSnapshot): boolean => snapshot.isOpening === true;

function DocxEditorMenuRoot(props: DocxEditorMenuProps) {
  const dialogs = useDialogHost();
  const popups = usePopupConfig();
  // Skip the scope class when the packaged wrapper already carries it.
  const scopeClassName = useChromeScopeClassName();
  const chromeDir = useChromeDir();
  const {
    className,
    t,
    fileName,
    exporters,
    printSettings,
    onOpen,
    onOpenFile,
    onSave,
    onPageSetup,
    onReportIssue,
    reportIssue,
    preset = true,
    overflow: overflowEnabled = true,
    children,
  } = props;
  const editor = useDocxEditor();
  const { t: catalogT } = useTranslation();
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const opening = useEditorState(selectOpening);
  useEffect(() => {
    if (opening) setOpenMenu(null);
  }, [opening]);
  // The last file the packaged Open read. The default Save names its download after it
  // when the host pinned no `fileName` — opening "contract-v2.docx" and saving must not
  // produce "document.docx".
  const [openedName, setOpenedName] = useState<string | null>(null);
  // The bar's single tab stop. Defaults to the first rendered menu; arrowing along the bar
  // moves it, and opening a menu takes it so Escape returns focus somewhere sensible.
  const exportState = useMenuExport(editor, exporters, fileName ?? openedName ?? undefined);
  const { pending: exportPending, execute: executeExport } = exportState;
  const printState = useMenuPrint(
    editor,
    exporters,
    popups?.print !== false,
    printSettings ?? popups?.print === undefined
  );
  const { active: printActive, execute: executePrint } = printState;
  const printPopupShown = printState.visible && popups?.print !== false;
  const [activeMenu, setActiveMenu] = useState<MenuId | null>(null);
  const [pageSetupOpen, setPageSetupOpen] = useState(false);
  const [paragraphDialogOpen, setParagraphDialogOpen] = useState(false);
  const [watermarkDialogOpen, setWatermarkDialogOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // A pointer press anywhere outside the bar closes it, and Escape does too — the two
  // ways every menu bar closes. Bound only while something is open.
  useEffect(() => {
    if (openMenu === null) return undefined;
    return listenForOutsidePress({ popup: rootRef.current, close: () => setOpenMenu(null) });
  }, [openMenu]);
  // Escape from outside the bar, such as the pages, goes through the shared rule, and a host
  // input keeps its own Escape. Keys inside the bar stay with the menus' own handlers, which
  // close one submenu at a time and return focus to the trigger.
  usePopupEscape(
    openMenu !== null,
    rootRef,
    () => setOpenMenu(null),
    (event) => isDomNode(event.target) && rootRef.current?.contains(event.target) === true
  );

  // Opening a menu also claims the tab stop, so Escape has a trigger to return to and a
  // later Tab leaves from where the user actually was.
  const openMenuAndFocus = useCallback((id: MenuId | null) => {
    setOpenMenu(id);
    if (id !== null) setActiveMenu(id);
  }, []);

  const packagedOpen = useCallback(() => fileInputRef.current?.click(), []);

  const packagedSave = useCallback(() => {
    if (!editor) return;
    // `Editor.save()` REJECTS when there is no document to serialize, and the parser's own
    // refusals (zip bomb, oversized part) surface the same way. Swallowing that leaves the
    // user with no download and no error — they conclude it worked. The rejection is
    // reported through the same channel a host's `onChange` uses.
    void editor
      .save()
      .then((buffer) =>
        download(
          buffer,
          downloadName(fileName ?? openedName ?? undefined),
          undefined,
          rootRef.current
        )
      )
      .catch((error: unknown) => {
        console.error('[docx-editor] save failed', error);
      });
  }, [editor, fileName, openedName]);

  const packagedPageSetup = useCallback(
    () =>
      dialogs
        ? dialogs.open(
            'pageSetup',
            rootRef.current?.querySelector<HTMLElement>('[data-menu="file"] > [role="menuitem"]')
          )
        : setPageSetupOpen(true),
    [dialogs]
  );

  // Explicit popup ownership wins for Page Setup; other actions use their host overrides.
  // Each action is undefined without an editor, which
  // is what disables the row before the document is ready.
  const resolvedOpen = editor ? (onOpen ?? packagedOpen) : undefined;
  const resolvedSave = editor ? (onSave ?? packagedSave) : undefined;
  const hasPdfExporter = !!exporters?.pdf;
  // Unavailable while a print session is open, so the row and Ctrl+P cannot start a second.
  const resolvedPrint = useMemo(
    () =>
      editor && !printActive
        ? () => {
            restoreExportFocus(rootRef.current);
            // The frame goes inside the editor, so a host's modal dialog does not make it inert.
            void executePrint(editorInstanceScope(rootRef.current) ?? rootRef.current ?? undefined);
          }
        : undefined,
    [editor, printActive, executePrint]
  );
  const resolvedPageSetup = editor
    ? dialogs?.ownsPageSetup
      ? packagedPageSetup
      : (onPageSetup ?? packagedPageSetup)
    : undefined;

  // The editor's document: a pop-out window's when the pages live there.
  const hostDocument = useEditorHostDocument();

  // Ctrl/Cmd+O, Ctrl/Cmd+S and Ctrl/Cmd+P, so the shortcut column tells the truth. All are
  // what the browser would otherwise handle (open a local file, save or print the page),
  // and an editor that leaves Cmd+S to the browser is the surprising one. Ctrl/Cmd+P is
  // left to the browser when no PDF handler is configured.
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      const key = event.key.toLowerCase();
      const print = isChromePrintShortcut(event);
      if (key !== 's' && key !== 'o' && !print) return;
      // SCOPED to this editor. A document-level listener that fires wherever focus happens
      // to be means an embedded editor eats the host page's Cmd+S while the user types in
      // an unrelated field, and two mounted editors both answer one keypress. The shortcut
      // belongs to the editor the user is actually in: the chrome, the painted surface, or
      // anything else under this instance's root.
      // `editorInstanceScope` finds the instance container — the `.docx-editor` that holds the
      // painted pages, NOT the bar's own self-emitted styling root — so one containment
      // test covers the bar AND the document. A composition with no such container falls
      // back to the bar's own subtree, which is narrow but never wrong.
      const target = event.target as Node | null;
      const scope = editorInstanceScope(rootRef.current) ?? rootRef.current;
      if (!target) return;
      const inScope =
        (scope?.contains(target) ?? false) ||
        isPoppedOutEditorTarget(
          target,
          hostDocumentOf(rootRef.current),
          editor ? editorHostElement(editor) : null
        );
      if (!inScope) return;
      if (print) {
        // Checked first: on some layouts the P key types a character other than "p".
        if (!hasPdfExporter || !editor) return;
        // Also claimed while the print popup shows, so the browser does not print the editor
        // page under it. Otherwise a busy session leaves the key to the browser.
        if (!resolvedPrint && !printPopupShown) return;
        event.preventDefault();
        resolvedPrint?.();
      } else if (key === 's' && resolvedSave) {
        event.preventDefault();
        resolvedSave();
      } else if (key === 'o' && resolvedOpen) {
        event.preventDefault();
        resolvedOpen();
      }
    };
    // The bar's document, and the editor's when the pages live in another window.
    const barDocument = hostDocumentOf(rootRef.current);
    const docs =
      hostDocument && hostDocument !== barDocument ? [barDocument, hostDocument] : [barDocument];
    for (const doc of docs) doc.addEventListener('keydown', onKeyDown);
    return () => {
      for (const doc of docs) doc.removeEventListener('keydown', onKeyDown);
    };
  }, [
    resolvedOpen,
    resolvedSave,
    resolvedPrint,
    printPopupShown,
    hasPdfExporter,
    editor,
    hostDocument,
  ]);

  const context = useMemo<MenuContextValue>(
    () => ({
      t,
      openMenu,
      setOpenMenu: openMenuAndFocus,
      activeMenu,
      onOpen: resolvedOpen,
      onSave: resolvedSave,
      onExport:
        editor && !exportPending
          ? (format) => {
              restoreExportFocus(rootRef.current);
              return executeExport(format);
            }
          : undefined,
      onPrint: resolvedPrint,
      printShortcut: hasPdfExporter,
      onPageSetup: resolvedPageSetup,
      onParagraphDialog: () =>
        dialogs
          ? dialogs.open(
              'paragraph',
              rootRef.current?.querySelector<HTMLElement>(
                '[data-menu="format"] > [role="menuitem"]'
              )
            )
          : setParagraphDialogOpen(true),
      onWatermarkDialog: editor
        ? () =>
            dialogs
              ? dialogs.open(
                  'watermark',
                  rootRef.current?.querySelector<HTMLElement>(
                    '[data-menu="insert"] > [role="menuitem"]'
                  )
                )
              : setWatermarkDialogOpen(true)
        : undefined,
      onReportIssue,
      reportIssue,
      opening,
    }),
    [
      opening,
      editor,
      exportPending,
      executeExport,
      resolvedPrint,
      hasPdfExporter,
      t,
      openMenu,
      openMenuAndFocus,
      activeMenu,
      resolvedOpen,
      resolvedSave,
      resolvedPageSetup,
      dialogs,
      onReportIssue,
      reportIssue,
    ]
  );

  // The menus in bar order, which is also what can move into the "⋯" menu.
  const kids = Children.toArray(children);
  const menuIds: string[] = [];
  if (preset) {
    const replaced = new Map(kids.map((child) => [menuOfChild(child), child] as const));
    for (const menu of CHROME_MENUS) {
      const override = replaced.get(menu.id);
      if (override === undefined || anyMenuIdOfChild(override) !== null) menuIds.push(menu.id);
    }
    for (const child of kids) {
      if (menuOfChild(child) !== null) continue;
      const id = anyMenuIdOfChild(child);
      if (id !== null) menuIds.push(id);
    }
  } else {
    for (const child of kids) {
      const id = anyMenuIdOfChild(child);
      if (id !== null) menuIds.push(id);
    }
  }
  // The end of the bar leaves first: Help, then Review, and so on toward File.
  const collapseIds = [...menuIds].reverse();
  const { attach, overflow } = useToolbarGroupOverflow(overflowEnabled, menuIds, collapseIds);
  const overflowValue = useMemo<MenuOverflowValue>(
    () => ({ measuring: overflowEnabled, overflow, inMore: false }),
    [overflowEnabled, overflow]
  );
  const moreValue = useMemo<MenuOverflowValue>(
    () => ({ measuring: false, overflow, inMore: true }),
    [overflow]
  );

  // Host children that are not menus stay in the bar at every width. They are wrapped so the
  // fit counts their width, and they never render a second time inside the "⋯" menu.
  const isMenu = (child: ReactNode) => anyMenuIdOfChild(child, true) !== null;
  const hostBlock = (nodes: ReactNode[], key: string) => (
    <div key={key} role="none" className="docx-menubar__host" {...{ [FIXED_ATTRIBUTE]: '' }}>
      {nodes}
    </div>
  );
  // `menus` is what the "⋯" menu renders: menus only, never host children.
  let menus: ReactNode[];
  let content: ReactNode;
  if (!preset) {
    menus = kids.filter(isMenu);
    // Wrapped only while the bar measures: a wrapping bar renders the host's markup as is.
    content = overflowEnabled
      ? kids.map((child, index) => (isMenu(child) ? child : hostBlock([child], `host-${index}`)))
      : children;
  } else {
    const overrides = new Map<ChromeMenuId, ReactElement>();
    const appended: ReactNode[] = [];
    for (const child of kids) {
      const id = menuOfChild(child);
      // Last override for a menu wins, matching how later props win in a spread.
      if (id) overrides.set(id, child as ReactElement);
      else appended.push(child);
    }
    menus = [
      ...CHROME_MENUS.map((menu) => {
        const override = overrides.get(menu.id);
        if (override) return <Fragment key={menu.id}>{override}</Fragment>;
        const Part = MENU_PARTS[menu.id];
        return <Part key={menu.id} />;
      }),
      ...appended.filter(isMenu),
    ];
    const hosts = appended.filter((child) => !isMenu(child));
    content = (
      <>
        {menus}
        {hosts.length > 0 ? hostBlock(hosts, 'host') : null}
      </>
    );
  }

  const moreLabel = t?.('formattingBar.more') ?? catalogT('formattingBar.more' as TranslationKey);

  return (
    <MenuContext.Provider value={context}>
      <div
        ref={(node) => {
          rootRef.current = node;
          attach(node);
          // Seed the tab stop on the first RENDERED menu rather than on the registry's
          // first: a bar whose File menu was hidden would otherwise have its only tab stop
          // on an element that does not exist, and be unreachable by keyboard.
          if (node && activeMenu === null) {
            const first = barTriggers(node)[0]?.closest('[data-menu]')?.getAttribute('data-menu');
            if (first) setActiveMenu(first);
          }
        }}
        role="menubar"
        // Named, because a host page can carry its own menubar beside the editor's and
        // "menu bar" twice tells a screen-reader user nothing about which is which.
        aria-label={
          t?.('titleBar.menuBarAriaLabel') ??
          catalogT('titleBar.menuBarAriaLabel' as TranslationKey)
        }
        data-testid="docx-menubar"
        // One line when the bar measures itself; the stylesheet reads this.
        {...(overflowEnabled ? { 'data-overflow': '' } : {})}
        // `docx-editor` self-emitted so a composed menu bar is styled outside the packaged
        // wrapper, as `DocxEditorLoading` and `DocxEditorViewport` already do.
        className={`${scopeClassName}docx-menubar${className ? ` ${className}` : ''}`}
        dir={chromeDir}
        // Container-level caret guard (CLAUDE.md focus-stealing pitfall): a disabled row
        // never receives mousedown, so per-row handlers cannot cover it.
        onMouseDown={guardToolbarMousedown}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          const bar = rootRef.current;
          if (!bar) return;
          // Only the BAR's own arrows. Inside an open panel, Left/Right belong to the
          // submenu contract and the panel has already stopped them.
          const triggers = barTriggers(bar);
          const index = triggers.indexOf(hostDocumentOf(bar).activeElement as HTMLElement);
          if (index === -1) return;
          event.preventDefault();
          const rtl = hostWindowOf(bar).getComputedStyle(bar).direction === 'rtl';
          const step = (event.key === 'ArrowRight' ? 1 : -1) * (rtl ? -1 : 1);
          const next = triggers[(index + step + triggers.length) % triggers.length];
          const id = next?.closest('[data-menu]')?.getAttribute('data-menu');
          if (!id) return;
          setActiveMenu(id);
          next?.focus();
          // Docs' behaviour: arrowing along an OPEN bar keeps browsing the panels.
          if (openMenu !== null) setOpenMenu(id);
        }}
      >
        <MenuOverflowContext.Provider value={overflowValue}>
          <MenuRowTabIndexContext.Provider value={0}>{content}</MenuRowTabIndexContext.Provider>
          {overflow.size > 0 ? (
            <Menu
              id={MENU_OVERFLOW_ID}
              label={moreLabel}
              icon={chromeIcon(MORE_PATHS)}
              preset={false}
            >
              <MenuOverflowContext.Provider value={moreValue}>{menus}</MenuOverflowContext.Provider>
            </Menu>
          ) : null}
        </MenuOverflowContext.Provider>
      </div>
      <DialogPortal>
        {exportState.visible && popups?.export !== false ? (
          popups?.export ? (
            renderPopup(
              popups.export,
              {
                open: true,
                format: exportState.format,
                pending: exportState.pending,
                error: exportState.error,
                onClose: exportState.dismiss,
              },
              exportState.session
            )
          ) : (
            <DocxEditorExportDialog
              open
              format={exportState.format}
              pending={exportState.pending}
              error={exportState.error}
              onClose={exportState.dismiss}
            />
          )
        ) : null}
        {printState.visible && popups?.print !== false ? (
          popups?.print ? (
            renderPopup(
              popups.print,
              {
                open: true,
                pending: printState.pending,
                error: printState.error,
                url: printState.url,
                onClose: printState.close,
                choosing: printState.choosing,
                settings: printState.settings,
                onSettingsChange: printState.changeSettings,
                onPrint: printState.confirm,
              },
              printState.session
            )
          ) : (
            <DocxEditorPrintDialog
              open
              pending={printState.pending}
              error={printState.error}
              url={printState.url}
              onClose={printState.close}
              choosing={printState.choosing}
              settings={printState.settings}
              onSettingsChange={printState.changeSettings}
              onPrint={printState.confirm}
            />
          )
        ) : null}
      </DialogPortal>
      {/* Opening a document is a FILE READ the user drives — never a fetched URL. Mounted
          even when the host overrode `onOpen`, because the input costs nothing and a host
          that later drops the override keeps working. */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        style={{ display: 'none' }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared so choosing the SAME file twice fires a change event again.
          event.target.value = '';
          if (!file || !editor) return;
          setOpenedName(file.name);
          onOpenFile?.(file);
          // A read or a parse can fail — a revoked file handle, or the package guards
          // refusing a zip bomb. Reporting it beats a silent no-op that leaves the previous
          // document painted and the user believing the new one opened.
          void file
            .arrayBuffer()
            .then((buffer) => editor.load(new Uint8Array(buffer)))
            .catch((error: unknown) => {
              console.error('[docx-editor] could not open the file', error);
            });
        }}
      />
      {/* Fallback for menus mounted without the dialog coordinator. */}
      <DocxEditorPageSetupDialog open={pageSetupOpen} onClose={() => setPageSetupOpen(false)} />
      {/* The menu bar owns its own, the way it owns Page Setup's: it does not collapse, so
          this route survives the narrow window that hides the line-spacing menu. */}
      <DocxEditorParagraphDialog
        open={paragraphDialogOpen}
        onClose={() => setParagraphDialogOpen(false)}
      />
      <DocxEditorWatermarkDialog
        open={watermarkDialogOpen}
        onClose={() => setWatermarkDialogOpen(false)}
      />
    </MenuContext.Provider>
  );
}

/** The menu bar with its parts attached as statics. @public */
export interface DocxEditorMenuNamespace {
  (props: DocxEditorMenuProps): ReactNode;
  /** A menu of the bar, addressed by registry id. */
  readonly Menu: typeof Menu;
  readonly File: MenuPartComponent;
  readonly Format: MenuPartComponent;
  readonly Insert: MenuPartComponent;
  readonly Review: typeof MenuReview;
  readonly Help: MenuPartComponent;
  /** One chrome slot as a live row. */
  readonly Item: typeof MenuItem;
  /** A presentational row, for a host action that is not a chrome slot. */
  readonly Row: typeof MenuRow;
  /** A named section of rows: a visible heading plus a real ARIA group. */
  readonly Group: typeof MenuGroup;
  readonly Separator: typeof MenuSeparator;
  readonly Submenu: typeof MenuSubmenu;
  /** Word's 6×6 insert-table size picker. */
  readonly TableGrid: typeof MenuTableGrid;
  /** One registry entry as its row, for a host arranging registry data itself. */
  readonly Entry: typeof MenuEntry;
  readonly Open: typeof MenuOpen;
  readonly Save: typeof MenuSave;
  readonly ExportMarkdown: typeof MenuExportMarkdown;
  readonly ExportPdf: typeof MenuExportPdf;
  readonly Print: typeof MenuPrint;
  readonly PageSetup: typeof MenuPageSetup;
  /** Insert › Image, so a host can hide it or place it elsewhere by name. */
  readonly ImageInsert: typeof MenuImageInsert;
  /** Insert › Watermark, so a host can hide it or place it elsewhere by name. */
  readonly Watermark: typeof MenuWatermark;
  readonly Bookmark: typeof MenuBookmark;
  /** Review > Markup Options > Reviewers. */
  readonly Reviewers: typeof MenuReviewers;
  /** Help › Report issue, so a host can drop it or point it elsewhere by name. */
  readonly ReportIssue: typeof MenuReportIssue;
}

/**
 * The compound menu bar: `<DocxEditor.Menu/>` for File · Format · Insert · Review · Help, parts as
 * statics for composition.
 *
 * Every actionable row is a chrome slot, so a row and its toolbar twin share one label,
 * one icon, one command and one enabled state. Rows the engine cannot honour yet render
 * present and disabled, carrying the engine's own reason.
 *
 * @public
 */
export const DocxEditorMenu: DocxEditorMenuNamespace = Object.assign(DocxEditorMenuRoot, {
  Menu,
  File: MenuFile,
  Format: MenuFormat,
  Insert: MenuInsert,
  Review: MenuReview,
  Help: MenuHelp,
  Item: MenuItem,
  Row: MenuRow,
  Group: MenuGroup,
  Separator: MenuSeparator,
  Submenu: MenuSubmenu,
  TableGrid: MenuTableGrid,
  Entry: MenuEntry,
  Open: MenuOpen,
  Save: MenuSave,
  ExportMarkdown: MenuExportMarkdown,
  ExportPdf: MenuExportPdf,
  Print: MenuPrint,
  PageSetup: MenuPageSetup,
  ImageInsert: MenuImageInsert,
  Watermark: MenuWatermark,
  Bookmark: MenuBookmark,
  Reviewers: MenuReviewers,
  ReportIssue: MenuReportIssue,
});
