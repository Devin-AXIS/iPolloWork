import type { DocxEditorChildren } from '../../docx-editor-children';
import type { ReactNode } from 'react';
// The compound context menu: the right-click surface, as a panel of menu rows.
//
// DEFAULT-SET + IN-PLACE OVERRIDE, the same contract the toolbar and the menu bar have.
// With no children it renders the packaged set; a child carrying a `docxRow` static
// REPLACES that row where it stands, `hidden` removes it, other children append, and
// `preset={false}` renders children verbatim.
//
// THE ENGINE DECIDES WHERE A RIGHT-CLICK LEAVES THE CARET, not this component. A right-click
// inside the selection keeps it, so Cut and Copy act on what the user selected. One in body
// text outside it moves the caret to the click, so the rows act on the text under the
// pointer. A position that refuses the caret, such as a generated table of contents, keeps
// the selection the user already had. The menu always acts on the resulting selection.
//
// The panel is `position: fixed`. Client coordinates go straight in with no ancestor
// scroll, transform or offset-parent math, and scrolling closes the panel anyway — so the
// one thing fixed positioning cannot do is the one thing that never happens.

import {
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { warnUnmatchedHiddenRow } from '../menu/menu-warnings';
import { contextMenuRowId } from './row-alias';
import {
  ContextMenuStart,
  StartPlacementContext,
  partitionStartRows,
  warnPackagedRowsIn,
} from './start';
import {
  contextMenuAnchorOf,
  isDocumentContextMenuTarget,
  isKeyboardContextMenu,
} from './menu-target';
import { mergeArrangement, unwrapFragment } from '../merge-arrangement';
import { ReviewRailContext, useDocxEditor } from '../context';
import { useAddCommentState } from '../toolbar/add-comment-state';
import { useChromeDir, useTranslation } from '../../i18n';
import type { TranslationKey } from '../../i18n';
import type { ToolbarTranslate } from '../toolbar/toolbar-context';
import {
  MenuContext,
  useMenuContext,
  useMenuLabel,
  type MenuContextValue,
} from '../menu/menu-context';
import { focusBy, focusEdge, panelItems } from '../menu/menu-keyboard';
import {
  MenuGroup,
  MenuItem,
  MenuRow,
  MenuSeparator,
  MenuSubmenu,
  menuItemSlotId,
  type MenuItemProps,
} from '../menu/parts';
import { ContextMenuContext, type ContextMenuAnchor } from './contextmenu-context';
import {
  ContextMenuCopy,
  ContextMenuCopyFormatting,
  ContextMenuCellVerticalAlignment,
  ContextMenuCut,
  ContextMenuDelete,
  ContextMenuDeleteTable,
  ContextMenuDeleteTableColumn,
  ContextMenuDeleteTableRow,
  ContextMenuInsertColumnLeft,
  ContextMenuInsertColumnRight,
  ContextMenuMergeCells,
  ContextMenuSplitCell,
  ContextMenuSelectTable,
  ContextMenuInsertRowAbove,
  ContextMenuInsertRowBelow,
  ContextMenuItem,
  ContextMenuPaste,
  ContextMenuPasteFormatting,
  ContextMenuPasteWithoutFormatting,
  ContextMenuSelectAll,
  ContextMenuRefreshToc,
  ContextMenuRefreshTocPageNumbers,
  ContextMenuRemoveToc,
  useTableContextMenuVisible,
} from './parts';
import { useChromeScopeClassName } from '../color-mode-context';
import { chromeControlForSlot, chromeIcon } from '../toolbar/ToolbarButton';
import {
  hostDocumentOf,
  hostWindowOf,
  isHTMLElementNode,
  chartPaneAvailable,
  openChartPaneFor,
  placeContextMenu,
  revealMenuItem,
  showInTopLayer,
  shapePaneAvailable,
} from '@docx-editor.dev/core/editor';
import { useEditorCommand } from '../useEditorCommand';
import { useEditorState } from '../useEditorState';
import { MenuLinkRow } from '../menu/menu-link-row';

/** Where the measured panel sits, and the height past which it scrolls. */
type ContextMenuPlacement = ReturnType<typeof placeContextMenu>;

/** Props for `DocxEditor.ContextMenu`. @public */
export interface DocxEditorContextMenuProps {
  /** Appended after the base `docx-contextmenu` class. */
  className?: string;
  /** i18n resolver for row labels; without it the raw keys show (never English). */
  t?: ToolbarTranslate;
  /**
   * `false` renders children verbatim with no default set. Default `true`: a child naming a
   * packaged row overrides it in place, others append.
   */
  preset?: boolean;
  /**
   * `true` suppresses the panel entirely and lets the browser's own menu through. For a
   * host that wants the native menu back on some documents without unmounting the part.
   */
  disabled?: boolean;
  /** Notified whenever the panel opens or closes. */
  onOpenChange?: (open: boolean) => void;
  children?: DocxEditorChildren;
}

/** The packaged set, in order. Separators are positional, so they are part of the list. */
type DefaultEntry =
  | { readonly kind: 'row'; readonly id: string; readonly render: () => ReactElement }
  | { readonly kind: 'separator'; readonly id: string };

function ContextMenuAddComment() {
  const rail = useContext(ReviewRailContext);
  const menu = useMenuContext();
  const label = useMenuLabel();
  // The same slot as `Toolbar.AddComment`, so enabled state and its reason have one source:
  // `toolbarCommandState`. The row needs a mounted review rail to open the draft, so without
  // one it is left out, whatever the engine answers.
  const { isEnabled, reason } = useAddCommentState(label);
  if ((rail?.mounted ?? 0) === 0) return null;
  const control = chromeControlForSlot('review.addComment');
  return (
    <MenuRow
      icon={chromeIcon(control?.paths)}
      slot="review.addComment"
      disabled={!isEnabled}
      title={reason ?? undefined}
      onSelect={() => {
        if (!rail?.requestCommentDraft()) return;
        menu.setOpenMenu(null);
      }}
    >
      {label('comments.addComment')}
    </MenuRow>
  );
}

function ContextMenuEditField() {
  const editor = useDocxEditor();
  const menu = useMenuContext();
  const label = useMenuLabel();
  if (!editor?.can({ type: 'editTextFormField' }).ok) return null;
  return (
    <MenuRow
      slot="field.edit"
      onSelect={() => {
        menu.setOpenMenu(null);
        editor.exec({ type: 'editTextFormField' });
      }}
    >
      {label('textFormField.edit')}
    </MenuRow>
  );
}

const selectChartId = (snapshot: { chart: { drawingNodeId: string } | null }) =>
  snapshot.chart?.drawingNodeId ?? null;

/** Edit chart, on a selected chart: opens the Chart pane, as a double press does. */
function ContextMenuEditChart() {
  const editor = useDocxEditor();
  const menu = useMenuContext();
  const label = useMenuLabel();
  const chartId = useEditorState(selectChartId);
  if (!editor || !chartId || !chartPaneAvailable(editor)) return null;
  return (
    <MenuRow
      slot="image.editChart"
      onSelect={() => {
        menu.setOpenMenu(null);
        openChartPaneFor(editor, chartId);
      }}
    >
      {label('chart.edit')}
    </MenuRow>
  );
}

const selectShapeId = (snapshot: { image: { id: string; shapeFormat: object | null } | null }) =>
  snapshot.image?.shapeFormat ? snapshot.image.id : null;

/**
 * Format shape, on a selected shape, text box, line, or group: opens the Format shape pane.
 * Enabled state and its reason come from the slot (`toolbarCommandState`), as on the toolbar.
 */
function ContextMenuFormatShape() {
  const editor = useDocxEditor();
  const menu = useMenuContext();
  const label = useMenuLabel();
  const shapeId = useEditorState(selectShapeId);
  const { execute, isEnabled, disabledReason } = useEditorCommand('image.formatShape');
  if (!editor || !shapeId || !shapePaneAvailable(editor)) return null;
  return (
    <MenuRow
      icon={chromeIcon(chromeControlForSlot('image.formatShape')?.paths)}
      slot="image.formatShape"
      disabled={!isEnabled}
      {...(disabledReason ? { title: disabledReason } : {})}
      onSelect={() => {
        menu.setOpenMenu(null);
        execute();
      }}
    >
      {label('shape.formatShape')}
    </MenuRow>
  );
}

const BASE_DEFAULT_SET: readonly DefaultEntry[] = [
  { kind: 'row', id: 'field.edit', render: () => <ContextMenuEditField /> },
  { kind: 'row', id: 'image.editChart', render: () => <ContextMenuEditChart /> },
  { kind: 'row', id: 'image.formatShape', render: () => <ContextMenuFormatShape /> },
  { kind: 'row', id: 'edit.cut', render: () => <ContextMenuCut /> },
  { kind: 'row', id: 'edit.copy', render: () => <ContextMenuCopy /> },
  { kind: 'row', id: 'edit.paste', render: () => <ContextMenuPaste /> },
  {
    kind: 'row',
    id: 'edit.pasteWithoutFormatting',
    render: () => <ContextMenuPasteWithoutFormatting />,
  },
  // The Format Painter's two halves, in the clipboard group where a reader looks for
  // "copy this, put it there". The toolbar's painter button is the same capability as one
  // armed gesture; these are the two steps taken apart, which is what a keyboard user and
  // a right-click user each want.
  { kind: 'row', id: 'format.copyFormatting', render: () => <ContextMenuCopyFormatting /> },
  { kind: 'row', id: 'format.pasteFormatting', render: () => <ContextMenuPasteFormatting /> },
  { kind: 'separator', id: 'sep.clipboard' },
  { kind: 'row', id: 'edit.delete', render: () => <ContextMenuDelete /> },
  { kind: 'row', id: 'edit.selectAll', render: () => <ContextMenuSelectAll /> },
  { kind: 'separator', id: 'sep.selection' },
  // PLAIN-LABEL keys, stated rather than inherited. A slot's registry `labelKey` is
  // tooltip-shaped — `text.link` carries "Insert link (Ctrl+K)" — which is right above a
  // toolbar button and wrong on a menu row that already has its own shortcut column. The
  // menu bar states them for the same reason; these two slots are in no registry menu, so
  // there is no entry to inherit from.
  {
    kind: 'row',
    id: 'text.link',
    // The label switches to Edit link on an existing link; see `MenuLinkRow`.
    render: () => <MenuLinkRow shortcutKey="contextMenu.insertLinkShortcut" />,
  },
  {
    kind: 'row',
    id: 'review.addComment',
    render: () => <ContextMenuAddComment />,
  },
];

function tableContextEntries(): readonly DefaultEntry[] {
  return [
    { kind: 'separator', id: 'sep.table' },
    {
      kind: 'row',
      id: ContextMenuSelectTable.docxRow,
      render: () => <ContextMenuSelectTable />,
    },
    {
      kind: 'row',
      id: ContextMenuInsertRowAbove.docxRow,
      render: () => <ContextMenuInsertRowAbove />,
    },
    {
      kind: 'row',
      id: ContextMenuInsertRowBelow.docxRow,
      render: () => <ContextMenuInsertRowBelow />,
    },
    { kind: 'separator', id: 'sep.table.columns' },
    {
      kind: 'row',
      id: ContextMenuInsertColumnLeft.docxRow,
      render: () => <ContextMenuInsertColumnLeft />,
    },
    {
      kind: 'row',
      id: ContextMenuInsertColumnRight.docxRow,
      render: () => <ContextMenuInsertColumnRight />,
    },
    { kind: 'separator', id: 'sep.table.cells' },
    {
      kind: 'row',
      id: ContextMenuMergeCells.docxRow,
      render: () => <ContextMenuMergeCells />,
    },
    {
      kind: 'row',
      id: ContextMenuSplitCell.docxRow,
      render: () => <ContextMenuSplitCell />,
    },
    { kind: 'separator', id: 'sep.table.destructive' },
    {
      kind: 'row',
      id: ContextMenuDeleteTableRow.docxRow,
      render: () => <ContextMenuDeleteTableRow />,
    },
    {
      kind: 'row',
      id: ContextMenuDeleteTableColumn.docxRow,
      render: () => <ContextMenuDeleteTableColumn />,
    },
    { kind: 'row', id: ContextMenuDeleteTable.docxRow, render: () => <ContextMenuDeleteTable /> },
    { kind: 'separator', id: 'sep.table.alignment' },
    {
      kind: 'row',
      id: ContextMenuCellVerticalAlignment.docxRow,
      render: () => <ContextMenuCellVerticalAlignment />,
    },
  ];
}

function tocContextEntries(): readonly DefaultEntry[] {
  return [
    { kind: 'separator', id: 'sep.toc' },
    { kind: 'row', id: ContextMenuRefreshToc.docxRow, render: () => <ContextMenuRefreshToc /> },
    {
      kind: 'row',
      id: ContextMenuRefreshTocPageNumbers.docxRow,
      render: () => <ContextMenuRefreshTocPageNumbers />,
    },
    { kind: 'row', id: ContextMenuRemoveToc.docxRow, render: () => <ContextMenuRemoveToc /> },
  ];
}

/** Build the default set, with the contextual groups the current target earns. @internal */
export function contextMenuDefaultSet(
  tableContextVisible: boolean,
  tocContextVisible = false
): readonly DefaultEntry[] {
  return [
    ...BASE_DEFAULT_SET,
    ...(tableContextVisible ? tableContextEntries() : []),
    ...(tocContextVisible ? tocContextEntries() : []),
  ];
}

/**
 * The row id a child drives, or null when it is the host's own content.
 *
 * Reads EVERY marker a packaged row can carry — `docxRow` on this module's parts,
 * `docxMenuRow` plus the `slot` prop on the menu bar's generic `MenuItem`, and `docxSlot`
 * on its pinned parts — and unwraps a single-child Fragment, because `Children.toArray`
 * does not flatten Fragment elements and a host mapping over its overrides will wrap them.
 * Missing any of those shapes is not a no-op: an unrecognized child APPENDS, so the row it
 * meant to replace renders twice.
 */
function rowOfChild(child: ReactNode): string | null {
  if (!isValidElement(child)) return null;
  const unwrapped = unwrapFragment(child, rowOfChild);
  if (unwrapped !== null) return unwrapped;
  const type = child.type as { docxRow?: unknown; docxMenuRow?: unknown; docxSlot?: unknown };
  if (typeof type !== 'function' && typeof type !== 'object') return null;
  if (typeof type.docxRow === 'string') return type.docxRow;
  if (typeof type.docxSlot === 'string') return type.docxSlot;
  if (type.docxMenuRow === true) {
    const slot = menuItemSlotId(child.props as MenuItemProps);
    if (slot) return slot;
  }
  return null;
}

/**
 * The element this menu listens on: the SCROLL CONTAINER, not the painted surface.
 *
 * The class is the one the engine itself keys on, so a page with two editors gives each
 * menu its own scroller. Listening here rather than on `.docx-paginated-surface` is
 * deliberate: the surface is centred inside the scroller with a margin, and a right-click in
 * the grey gutter beside the page originates on the scroller and never reaches a listener
 * further in. Word opens its menu there too.
 */
function scrollerFor(anchor: HTMLElement | null): HTMLElement | null {
  return anchor?.closest<HTMLElement>('.docx-editor__scroll-container') ?? null;
}

/**
 * The packaged right-click menu over the painted document.
 *
 * Mounted by default inside `DocxEditor.Viewport`; `contextMenu={false}` on `DocxEditor`
 * removes it. Rendered as a child of the viewport so it finds its own surface, but
 * positioned in client space, so it is never clipped by the scroller.
 *
 * @public
 */
export function DocxEditorContextMenu({
  className,
  t,
  preset = true,
  disabled,
  onOpenChange,
  children,
}: DocxEditorContextMenuProps) {
  // Skip the scope class when the packaged wrapper already carries it.
  const scopeClassName = useChromeScopeClassName();
  const chromeDir = useChromeDir();
  const editor = useDocxEditor();
  const { t: catalogT } = useTranslation();
  const tableContextVisible = useTableContextMenuVisible();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [anchor, setAnchor] = useState<ContextMenuAnchor | null>(null);
  // Captured with the anchor, not subscribed to — see `tocId` on the context value.
  const [tocId, setTocId] = useState<string | null>(null);
  // The element the opening press landed on, for contextual rows. Same capture rule.
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const defaultSet = useMemo(
    () => contextMenuDefaultSet(tableContextVisible, tocId !== null),
    [tableContextVisible, tocId]
  );
  // `preset={false}` renders children as written, so Start stays where the host put it.
  const placed = preset ? partitionStartRows(children) : { start: [], rest: children };
  warnPackagedRowsIn(placed.start, rowOfChild);
  // Placement is measured AFTER the panel renders — its size depends on the rows the host
  // composed — so the first paint is at the raw anchor and the flip lands in a layout
  // effect, before the browser paints.
  const [placement, setPlacement] = useState<ContextMenuPlacement | null>(null);

  /**
   * Close the panel.
   *
   * `restoreFocus` only on the paths where the user is FINISHING with the menu — Escape, or
   * selecting a row. On the others (a press elsewhere, a scroll, the window losing focus)
   * the user is already going somewhere else, and calling `editor.focus()` would drag focus
   * back into the document and can scroll the caret into view under them.
   */
  const close = useCallback(
    (restoreFocus = false) => {
      setAnchor(null);
      setPlacement(null);
      setTocId(null);
      setTarget(null);
      if (restoreFocus) editor?.focus();
    },
    [editor]
  );

  // Open on the scroller's contextmenu event.
  useEffect(() => {
    if (disabled) return undefined;
    const scroller = scrollerFor(hostRef.current);
    if (!scroller) return undefined;
    const onContextMenu = (event: MouseEvent) => {
      // A second right-click on the open panel neither moves it nor shows the browser's menu.
      if (panelRef.current?.contains(event.target as Node | null)) {
        event.preventDefault();
        return;
      }
      // Another menu already answered this press, such as the note menu on a note that is
      // not being edited. One press opens one menu.
      if (event.defaultPrevented) return;
      // Chrome in the scroller, such as the link popover, keeps the browser's own menu.
      if (!isDocumentContextMenuTarget(scroller, event.target)) return;
      event.preventDefault();
      const keyboard = isKeyboardContextMenu(event);
      // The engine's own listener sits INSIDE this one and has already recorded which table
      // of contents the press landed on, so reading it here is reading it current.
      setTocId(editor?.snapshot().tocContext?.id ?? null);
      setTarget(keyboard || !isHTMLElementNode(event.target) ? null : event.target);
      setAnchor(contextMenuAnchorOf(event, keyboard, editor, scroller));
    };
    scroller.addEventListener('contextmenu', onContextMenu);
    return () => scroller.removeEventListener('contextmenu', onContextMenu);
  }, [disabled, editor]);

  // `disabled` flipping true closes an OPEN panel, not just the listener. The prop promises
  // the browser's own menu back; leaving ours on screen would be the opposite.
  useEffect(() => {
    if (disabled) close();
  }, [disabled, close]);

  // Close on everything that means "the user moved on": a press outside, Escape, a scroll
  // under the panel, and the window losing focus. Bound only while open, so a closed menu
  // costs nothing.
  useEffect(() => {
    if (!anchor) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node | null)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(true);
      } else if (event.key === 'Tab') {
        // Tab moves focus OUT of the menu, and neither the outside-press listener nor the
        // window blur handler fires for an intra-page focus move — so without this the panel
        // stays open, floating over the document, with nothing focused inside it. The menu
        // bar closes on Tab for the same reason. Not prevented: the user asked to move on.
        close();
      }
    };
    // Capture, because the scroll that matters is the editor's own scroller and scroll
    // events do not bubble to the window from it.
    const onScroll = (event: Event) => {
      // The panel's own scroll, when a long menu scrolls inside, is not the user moving on.
      if (event.type === 'scroll' && panelRef.current?.contains(event.target as Node | null)) {
        return;
      }
      close();
    };
    // The editor's own document and window, which are not the script's globals when the
    // editor renders into a pop-out window or an iframe.
    const doc = hostDocumentOf(hostRef.current ?? panelRef.current);
    const win = hostWindowOf(hostRef.current ?? panelRef.current);
    doc.addEventListener('pointerdown', onPointerDown, true);
    doc.addEventListener('keydown', onKeyDown);
    doc.addEventListener('scroll', onScroll, { capture: true, passive: true });
    win.addEventListener('blur', onScroll);
    win.addEventListener('resize', onScroll);
    return () => {
      doc.removeEventListener('pointerdown', onPointerDown, true);
      doc.removeEventListener('keydown', onKeyDown);
      doc.removeEventListener('scroll', onScroll, true);
      win.removeEventListener('blur', onScroll);
      win.removeEventListener('resize', onScroll);
    };
  }, [anchor, close]);

  // Place the panel inside the window: below the pointer, above it, or moved up, and capped
  // to the window height with a scroll inside when it is taller.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    // The top layer first: a host's stacking context (a docked pane with `isolation`, a
    // header with a higher `z-index`) otherwise paints over the panel whatever its own
    // `z-index`. The panel must also be open there before it can be measured.
    showInTopLayer(panel);
    const { width, height } = panel.getBoundingClientRect();
    const view = hostWindowOf(panel);
    // Right-to-left chrome opens toward the left of the pointer, and flips right instead.
    const rtl = view.getComputedStyle(panel).direction === 'rtl';
    setPlacement(
      placeContextMenu(
        anchor,
        { width, height },
        { width: view.innerWidth, height: view.innerHeight },
        rtl
      )
    );
  }, [anchor]);

  // Focus AFTER placement commits, not in the same effect that computes it.
  //
  // The panel renders `visibility: hidden` until it has been measured, so that it is never
  // seen at the pre-flip position — and a `visibility: hidden` element is not focusable.
  // Calling `focus()` alongside `setPlacement` therefore did nothing at all, which left the
  // whole keyboard layer dead: the arrow-key handler is on the panel, so it never fired.
  useLayoutEffect(() => {
    if (placement) panelRef.current?.focus({ preventScroll: true });
  }, [placement]);

  // Report only real TRANSITIONS.
  //
  // The handler lives in a ref so an unmemoized one — the normal case, and unavoidable via
  // `contextMenu={{ onOpenChange }}`, which is a fresh object every render — cannot make
  // this effect re-run and re-report. Without the previous-value guard it also announced
  // `false` on mount, before the menu had ever existed.
  const openChangeRef = useRef(onOpenChange);
  openChangeRef.current = onOpenChange;
  const wasOpen = useRef(false);
  useEffect(() => {
    const open = anchor !== null;
    if (open === wasOpen.current) return;
    wasOpen.current = open;
    openChangeRef.current?.(open);
  }, [anchor]);

  // The menu bar's rows close their panel through `setOpenMenu(null)`. Publishing a menu
  // context whose `setOpenMenu` closes THIS panel is the whole adapter between the two
  // compounds, and it is what lets the rows be reused rather than reimplemented.
  const menuContext = useMemo<MenuContextValue>(
    () => ({
      t,
      openMenu: null,
      // A row was selected: the user is finished with the menu, so focus goes back.
      setOpenMenu: () => close(true),
      activeMenu: null,
      onOpen: undefined,
      onSave: undefined,
      onPageSetup: undefined,
      onParagraphDialog: undefined,
      onReportIssue: undefined,
      reportIssue: undefined,
    }),
    [t, close]
  );
  // Root-owned, so it survives the panel unmounting when a row is selected.
  const [clipboardRefusal, setClipboardRefusal] = useState<string | null>(null);
  const contextMenuContext = useMemo(
    () => ({
      close,
      anchor,
      tocId,
      target,
      clipboardRefusal,
      reportClipboardRefusal: setClipboardRefusal,
    }),
    [close, anchor, tocId, target, clipboardRefusal]
  );

  const style: CSSProperties = {
    position: 'fixed',
    left: placement?.left ?? anchor?.x ?? 0,
    top: placement?.top ?? anchor?.y ?? 0,
    ...(placement ? { maxWidth: placement.maxWidth, maxHeight: placement.maxHeight } : {}),
    // Hidden until measured, so the panel is never seen at the pre-flip position.
    visibility: placement ? 'visible' : 'hidden',
  };

  return (
    <div ref={hostRef} style={{ display: 'contents' }}>
      {anchor ? (
        <MenuContext.Provider value={menuContext}>
          <ContextMenuContext.Provider value={contextMenuContext}>
            <div
              ref={panelRef}
              role="menu"
              // Resolved through the host's `t` like every row label, else the locale
              // catalogue — matching the rows' own fallback.
              aria-label={
                t?.('contextMenu.ariaLabel') ?? catalogT('contextMenu.ariaLabel' as TranslationKey)
              }
              // One tab stop for the whole panel, which is the menu pattern: rows are
              // reached with the arrows, never with Tab.
              tabIndex={-1}
              className={`${scopeClassName}docx-toolbar__menu docx-contextmenu${className ? ` ${className}` : ''}`}
              dir={chromeDir}
              style={style}
              onKeyDown={(event) => {
                const panel = panelRef.current;
                if (!panel) return;
                const items = panelItems(panel);
                const doc = hostDocumentOf(panel);
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  focusBy(items, doc.activeElement, 1);
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  focusBy(items, doc.activeElement, -1);
                } else if (event.key === 'Home') {
                  event.preventDefault();
                  focusEdge(items, 'first');
                } else if (event.key === 'End') {
                  event.preventDefault();
                  focusEdge(items, 'last');
                } else {
                  return;
                }
                // A menu taller than the window scrolls; keep the focused row in view.
                revealMenuItem(panel, doc.activeElement);
              }}
            >
              <StartPlacementContext.Provider value="hoisted">
                {placed.start}
              </StartPlacementContext.Provider>
              <StartPlacementContext.Provider value={preset ? 'appended' : 'verbatim'}>
                {mergeArrangement({
                  entries: defaultSet,
                  children: placed.rest,
                  preset,
                  keyOfEntry: (entry) => entry.id,
                  keyOfChild: (child) => contextMenuRowId(rowOfChild(child)),
                  renderEntry: (entry) =>
                    entry.kind === 'separator' ? <MenuSeparator /> : entry.render(),
                  onUnmatched: (id, element) => {
                    // An unmatched override is the host's own row, unless it is hidden.
                    if ((element.props as { hidden?: unknown }).hidden) warnUnmatchedHiddenRow(id);
                  },
                })}
              </StartPlacementContext.Provider>
            </div>
          </ContextMenuContext.Provider>
        </MenuContext.Provider>
      ) : null}
    </div>
  );
}

/**
 * `DocxEditor.ContextMenu` with its rows attached as statics.
 *
 * @public
 */
export interface DocxEditorContextMenuNamespace {
  (props: DocxEditorContextMenuProps): ReactElement;
  readonly Cut: typeof ContextMenuCut;
  readonly Copy: typeof ContextMenuCopy;
  readonly Paste: typeof ContextMenuPaste;
  readonly PasteWithoutFormatting: typeof ContextMenuPasteWithoutFormatting;
  readonly Delete: typeof ContextMenuDelete;
  readonly SelectAll: typeof ContextMenuSelectAll;
  readonly SelectTable: typeof ContextMenuSelectTable;
  readonly InsertRowAbove: typeof ContextMenuInsertRowAbove;
  readonly InsertRowBelow: typeof ContextMenuInsertRowBelow;
  readonly InsertColumnLeft: typeof ContextMenuInsertColumnLeft;
  readonly InsertColumnRight: typeof ContextMenuInsertColumnRight;
  readonly MergeCells: typeof ContextMenuMergeCells;
  readonly SplitCell: typeof ContextMenuSplitCell;
  readonly DeleteTableRow: typeof ContextMenuDeleteTableRow;
  readonly DeleteTableColumn: typeof ContextMenuDeleteTableColumn;
  readonly DeleteTable: typeof ContextMenuDeleteTable;
  readonly CellVerticalAlignment: typeof ContextMenuCellVerticalAlignment;
  readonly RefreshToc: typeof ContextMenuRefreshToc;
  readonly RefreshTocPageNumbers: typeof ContextMenuRefreshTocPageNumbers;
  readonly RemoveToc: typeof ContextMenuRemoveToc;
  /** A host-owned row: no slot, no command, the host's own label and action. */
  readonly Item: typeof ContextMenuItem;
  /** Host rows that render above the packaged rows instead of after them. */
  readonly Start: typeof ContextMenuStart;
  /** Any chrome slot as a live row (`<ContextMenu.Slot slotId="text.bold" />`). */
  readonly Slot: typeof MenuItem;
  /** Bare row presentation, for a host building something the parts do not cover. */
  readonly Row: typeof MenuRow;
  /** A named section of rows: a visible heading plus a real ARIA group. */
  readonly Group: typeof MenuGroup;
  readonly Separator: typeof MenuSeparator;
  readonly Submenu: typeof MenuSubmenu;
}

export const ContextMenu: DocxEditorContextMenuNamespace = Object.assign(DocxEditorContextMenu, {
  Cut: ContextMenuCut,
  Copy: ContextMenuCopy,
  Paste: ContextMenuPaste,
  PasteWithoutFormatting: ContextMenuPasteWithoutFormatting,
  Delete: ContextMenuDelete,
  SelectAll: ContextMenuSelectAll,
  SelectTable: ContextMenuSelectTable,
  InsertRowAbove: ContextMenuInsertRowAbove,
  InsertRowBelow: ContextMenuInsertRowBelow,
  InsertColumnLeft: ContextMenuInsertColumnLeft,
  InsertColumnRight: ContextMenuInsertColumnRight,
  MergeCells: ContextMenuMergeCells,
  SplitCell: ContextMenuSplitCell,
  DeleteTableRow: ContextMenuDeleteTableRow,
  DeleteTableColumn: ContextMenuDeleteTableColumn,
  DeleteTable: ContextMenuDeleteTable,
  CellVerticalAlignment: ContextMenuCellVerticalAlignment,
  RefreshToc: ContextMenuRefreshToc,
  RefreshTocPageNumbers: ContextMenuRefreshTocPageNumbers,
  RemoveToc: ContextMenuRemoveToc,
  Item: ContextMenuItem,
  Start: ContextMenuStart,
  Slot: MenuItem,
  Row: MenuRow,
  Group: MenuGroup,
  Separator: MenuSeparator,
  Submenu: MenuSubmenu,
});
