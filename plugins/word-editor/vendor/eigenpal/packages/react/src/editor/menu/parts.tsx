import {
  warnDeprecatedSlotProp,
  warnMissingSlotId,
  warnMissingSubmenuLabel,
} from './menu-warnings';
import type { DocxEditorChildren } from '../../docx-editor-children';
import type { ReactNode } from 'react';
// The menu bar's rows.
//
// A row is PRESENTATION over a chrome slot: the icon, the label and the enabled state all
// come from the registry entry the row names, exactly like a toolbar button, so the same
// capability cannot describe itself differently in two places. What differs is the shape
// (icon, label, right-aligned shortcut, submenu caret) and the fact that selecting a row
// closes the menu.
//
// Host actions read their handlers from the menu context. Editing rows use engine commands.

import { isValidElement, useContext, useId, useLayoutEffect, useRef, useState } from 'react';
import { mergeArrangement, unwrapFragment } from '../merge-arrangement';
import {
  CHROME_MENUS,
  chromeProbeForSlot,
  chromeSlotIsToggle,
  commandForSlot,
  hostDocumentOf,
  hostWindowOf,
  placeSubmenu,
  submenuKeys,
  type ChromeMenuEntry,
  type ChromeMenuId,
  type ChromeMenuItemEntry,
  type ChromeSlotId,
} from '@docx-editor.dev/core/editor';
import { useEditorCommand } from '../useEditorCommand';
import { chromeControlForSlot, chromeIcon, guardToolbarMousedown } from '../toolbar/ToolbarButton';
import {
  MENU_OVERFLOW_ID,
  MenuRowTabIndexContext,
  useMenuContext,
  useMenuLabel,
  useMenuOverflow,
  type MenuId,
} from './menu-context';
import { menuOverflowPlacement } from './menu-overflow-state';
import { useMenuPanelPlacement } from './menu-panel-placement';
import { usePlatformShortcut } from '../usePlatformShortcut';
import { focusBy, focusEdge, panelItems } from './menu-keyboard';
import { useImageInsertOptional } from '../images/ImageInsert';
import { MenuTableGrid } from './menu-flyouts';
import { MenuChartPicker } from './menu-chart';
import { MenuWatermark } from './menu-watermark';
import { MenuBookmark, MenuGoToBookmarkRow } from './menu-bookmark';
import { MenuLinkRow } from './menu-link-row';

export { MenuTableGrid, type MenuTableGridProps } from './menu-flyouts';

// ─────────────────────────────────────────────────────────────────────────────
// The generic row
// ─────────────────────────────────────────────────────────────────────────────

/** Props for `DocxEditor.Menu.Row`: one presentational menu row. @public */
export interface MenuRowProps {
  /** Material Symbols paths, rendered as inline SVG in the row's icon column. */
  icon?: DocxEditorChildren;
  /** Right-aligned shortcut text (already resolved). */
  shortcut?: string;
  disabled?: boolean;
  /**
   * Tooltip. Set it for the ENGINE's disabled reason and nothing else — a menu row's text
   * is already visible, so a tooltip repeating it is noise, and inventing a reason for a
   * refusal the engine explained is the thing this codebase does not do.
   */
  title?: string;
  /**
   * Checked state, for a row that TOGGLES (bold on bold text). Leave undefined on a row
   * that just acts: `menuitemcheckbox` with `aria-checked="false"` announces "not
   * selected" on a Page break row, which is a claim about state it does not have.
   */
  active?: boolean;
  /**
   * Present on a row belonging to a MUTUALLY EXCLUSIVE set (the four alignments), which
   * makes it `menuitemradio` rather than `menuitemcheckbox`. Four independent checkboxes
   * is a different claim from one-of-four, and a screen reader reads it as such.
   */
  selected?: true;
  /** Stable marker for hosts, tests and e2e. */
  slot?: string;
  /**
   * What the slot currently SHOWS, for a control whose state is more than pressed-or-not —
   * the format painter's `once` against its `locked`. Declared rather than left to a spread:
   * this component renders only the props it names, so an undeclared attribute is dropped in
   * silence, and the stylesheet rule keyed on it can never match.
   */
  'data-value'?: string;
  /**
   * Vue TSX maps row identity through `rowSlot` because `slot` is reserved.
   * React uses {@link slot} directly.
   */
  rowSlot?: string;
  onSelect?: () => void;
  /**
   * Vue TSX binds row activation through `selectHandler` because `onSelect`
   * is treated as a listener. React uses {@link onSelect} directly.
   */
  selectHandler?: () => void;
  className?: string;
  children?: DocxEditorChildren;
}

/**
 * One menu row: icon column, label, shortcut column.
 *
 * The icon column is reserved even when a row has no icon, so labels line up down the
 * panel the way Word's and Docs' menus do.
 *
 * @public
 */
export function MenuRow(props: MenuRowProps) {
  const { icon, shortcut, disabled, title, active, selected, slot, onSelect, className, children } =
    props;
  const value = props['data-value'];
  const shortcutText = usePlatformShortcut();
  const reasonId = useId();
  const tabIndex = useContext(MenuRowTabIndexContext);
  // `aria-disabled`, NOT the native attribute. A natively-disabled button leaves the tab
  // order and stops firing pointer events, so its `title` never renders and a screen
  // reader walking the menu skips the row entirely — which is the whole "present and
  // disabled, with the reason" design delivering nothing to the users who most need it.
  // The APG says a disabled menu item stays focusable for exactly this reason. The reason
  // itself rides `aria-describedby`, so it is ANNOUNCED rather than hover-only.
  const describe = disabled && title ? reasonId : undefined;
  const role =
    active === undefined
      ? 'menuitem'
      : selected === undefined
        ? 'menuitemcheckbox'
        : 'menuitemradio';
  return (
    <button
      type="button"
      role={role}
      className={`docx-toolbar__menu-item docx-menubar__item${className ? ` ${className}` : ''}`}
      // Popup rows use arrow keys. Direct menubar actions remain reachable by Tab.
      tabIndex={tabIndex}
      {...(slot ? { 'data-slot': slot } : {})}
      {...(value !== undefined ? { 'data-value': value } : {})}
      {...(active ? { 'data-active': '' } : {})}
      {...(disabled ? { 'data-disabled': '', 'aria-disabled': true } : {})}
      {...(active !== undefined ? { 'aria-checked': active } : {})}
      {...(describe ? { 'aria-describedby': describe } : {})}
      {...(title ? { title } : {})}
      onMouseDown={guardToolbarMousedown}
      onClick={disabled ? undefined : onSelect}
    >
      <span className="docx-menubar__item-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="docx-menubar__item-label">{children}</span>
      {/* The chord is one accelerator in the engine (`event.metaKey || event.ctrlKey`), so a
          Mac reader presses ⌘ where a Windows reader presses Ctrl. The catalogue can only
          state one spelling; `platformShortcut` makes the printed one match the keyboard. */}
      {shortcut ? (
        <span className="docx-menubar__item-shortcut">{shortcutText(shortcut)}</span>
      ) : null}
      {describe ? (
        <span id={reasonId} className="docx-editor-sr-only">
          {title}
        </span>
      ) : null}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Grouping
// ─────────────────────────────────────────────────────────────────────────────

/** Props for `DocxEditor.Menu.Group`: a titled section of rows. @public */
export interface MenuGroupProps {
  /** Literal heading, already resolved. Wins over {@link labelKey}. */
  label?: string;
  /** i18n key of the heading. */
  labelKey?: string;
  className?: string;
  hidden?: boolean;
  children?: DocxEditorChildren;
}

/**
 * A named section inside a panel: a visible heading and the rows under it.
 *
 * A separator says rows are apart; a group says what they are, which is what a panel needs
 * once a product adds rows beside the packaged ones. `role="group"` nests legally inside a
 * menu, keeps its rows owned by it, and takes the heading as its accessible name — so the
 * visible heading is decoration and is hidden from the tree.
 *
 * @public
 */
export function MenuGroup({
  label: literal,
  labelKey,
  className,
  hidden,
  children,
}: MenuGroupProps) {
  const label = useMenuLabel();
  if (hidden) return null;
  const text = literal ?? (labelKey === undefined ? undefined : label(labelKey));
  return (
    <div
      role="group"
      className={`docx-menubar__group${className ? ` ${className}` : ''}`}
      {...(text ? { 'aria-label': text } : {})}
    >
      {text ? (
        <div className="docx-menubar__group-label" aria-hidden="true">
          {text}
        </div>
      ) : null}
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Slot-driven row
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Props for `DocxEditor.Menu.Item`: one chrome slot as a menu row. Set `slotId`. A row with
 * neither `slotId` nor the deprecated `slot` renders nothing, with a development warning.
 * An interface, so a host can extend it.
 *
 * @public
 */
export interface MenuItemProps extends MenuItemBaseProps {
  /** The chrome slot this row drives (`'text.bold'`, `'insert.pageBreak'`, …). */
  slotId?: ChromeSlotId;
  /** @deprecated Use `slotId`. Still read in this release, with a development warning. */
  slot?: ChromeSlotId;
}

/** The props every `Menu.Item` takes besides the slot it names. @public */
export interface MenuItemBaseProps {
  /** Plain-label i18n key, overriding the slot's tooltip-shaped one. */
  labelKey?: string;
  /** i18n key of the shortcut shown in the right column. */
  shortcutKey?: string;
  className?: string;
  /**
   * Render nothing: inside a packaged menu this removes the row in place. A named row part
   * with `hidden`, such as `<ContextMenu.Cut hidden />`, is shorthand for this override
   * with that row's `slotId`.
   */
  hidden?: boolean;
}

/** The slot a menu row names: `slotId`, else the deprecated `slot`. @internal */
export function menuItemSlotId(props: {
  readonly slotId?: ChromeSlotId | undefined;
  readonly slot?: ChromeSlotId | undefined;
}): ChromeSlotId | undefined {
  if (props.slotId) return props.slotId;
  if (props.slot) {
    warnDeprecatedSlotProp(props.slot);
    return props.slot;
  }
  warnMissingSlotId();
  return undefined;
}

/**
 * One chrome slot as a live menu row: enabled and active from the engine's
 * can-before-exec answer, labelled and iconed from the registry. Selecting it runs the
 * slot's command and closes the menu.
 *
 * @public
 */
export function MenuItem(props: MenuItemProps) {
  // `text.link` runs no command; it opens the link popover. A separate component, so neither
  // row calls hooks conditionally.
  if ((props.slotId ?? props.slot) === 'text.link') return <MenuLinkRow {...props} />;
  return <MenuCommandItem {...props} />;
}

function MenuCommandItem(props: MenuItemProps) {
  const { labelKey, shortcutKey, className, hidden } = props;
  const slot = menuItemSlotId(props) ?? ('' as ChromeSlotId);
  const { execute, isActive, isEnabled, disabledReason, value } = useEditorCommand(slot);
  const { setOpenMenu } = useMenuContext();
  const label = useMenuLabel();
  if (hidden || !slot) return null;
  const control = chromeControlForSlot(slot);
  const text = label(labelKey ?? control?.labelKey ?? slot);
  // Checked-ness only where it is meaningful — the ENGINE's rule, the same one
  // `ToolbarButton` applies to `aria-pressed`: marks and alignment toggle, a break insert
  // does not, and the format painter does even though no single command describes its press.
  const isToggle = chromeSlotIsToggle(slot);
  // The four alignments are one-of-four, not four independent toggles.
  const isRadio = ['setAlignment', 'setParagraphDirection', 'setReviewDisplayMode'].includes(
    commandForSlot(slot)?.type ?? ''
  );
  return (
    <MenuRow
      slot={slot}
      icon={chromeIcon(control?.paths)}
      {...(shortcutKey ? { shortcut: label(shortcutKey) } : {})}
      disabled={!isEnabled}
      {...(disabledReason ? { title: disabledReason } : {})}
      {...(isToggle ? { active: isActive } : {})}
      {...(isRadio ? { selected: true as const } : {})}
      {...(value !== null ? { 'data-value': value } : {})}
      onSelect={() => {
        execute();
        setOpenMenu(null);
      }}
      {...(className ? { className } : {})}
    >
      {text}
    </MenuRow>
  );
}

// The marker the panel's in-place override reads. `MenuItem` is generic, so its row
// identity is its `slot` PROP; the pinned parts below carry a fixed `docxSlot` static.
// Never displayName, which minifies away.
MenuItem.docxMenuRow = true as const;

// ─────────────────────────────────────────────────────────────────────────────
// The three host-boundary rows: open, save, page setup
// ─────────────────────────────────────────────────────────────────────────────

/** Props for the pinned File rows. @public */
export interface MenuActionProps {
  className?: string;
  hidden?: boolean;
}

/**
 * A row whose action comes from the menu context rather than from a command, with the
 * slot still supplying label, icon and shortcut. Disabled when the root resolved no
 * handler, which is the honest state: the capability exists, this chrome cannot reach it.
 */
function defineActionRow(
  slot: ChromeSlotId,
  labelKey: string | undefined,
  shortcutKey: string | undefined,
  pick: (context: ReturnType<typeof useMenuContext>) => (() => void) | undefined,
  showShortcut: (context: ReturnType<typeof useMenuContext>) => boolean = () => true
) {
  const Part = ({ className, hidden }: MenuActionProps) => {
    const context = useMenuContext();
    const label = useMenuLabel();
    const handler = pick(context);
    const shortcut = shortcutKey && showShortcut(context) ? shortcutKey : undefined;
    if (hidden) return null;
    const control = chromeControlForSlot(slot);
    const text = label(labelKey ?? control?.labelKey ?? slot);
    return (
      <MenuRow
        slot={slot}
        icon={chromeIcon(control?.paths)}
        {...(shortcut ? { shortcut: label(shortcut) } : {})}
        disabled={!handler}
        onSelect={() => {
          handler?.();
          context.setOpenMenu(null);
        }}
        {...(className ? { className } : {})}
      >
        {text}
      </MenuRow>
    );
  };
  return Object.assign(Part, { docxSlot: slot });
}

export const MenuOpen = defineActionRow(
  'file.open',
  'toolbar.open',
  'toolbar.openShortcut',
  (context) => context.onOpen
);
export const MenuSave = defineActionRow(
  'file.save',
  'toolbar.save',
  'toolbar.saveShortcut',
  (context) => context.onSave
);

/** Exports continuous Markdown through the menu handler. @public */
export const MenuExportMarkdown = defineActionRow(
  'file.exportMarkdown',
  undefined,
  undefined,
  (context) => (context.onExport ? () => context.onExport?.('markdown') : undefined)
);
/** Exports PDF through the menu handler. @public */
export const MenuExportPdf = defineActionRow('file.exportPdf', undefined, undefined, (context) =>
  context.onExport ? () => context.onExport?.('pdf') : undefined
);
/** Prints through the menu's PDF handler. @public */
export const MenuPrint = defineActionRow(
  'file.print',
  undefined,
  'toolbar.printShortcut',
  (context) => context.onPrint,
  (context) => context.printShortcut === true
);

/**
 * Page setup. Unlike open and save, the ENGINE has an opinion here — `setPageSetup` is a
 * real command, it just needs the dialog's values — so the row asks through the slot's
 * probe and is disabled with the engine's own words on a document it cannot rewrite.
 */
function MenuPageSetupImpl({ className, hidden }: MenuActionProps) {
  const { isEnabled: engineOk, disabledReason: engineReason } = useEditorCommand(
    chromeProbeForSlot('file.pageSetup')!
  );
  const context = useMenuContext();
  const label = useMenuLabel();
  if (hidden) return null;
  const control = chromeControlForSlot('file.pageSetup');
  const text = label(control?.labelKey ?? 'file.pageSetup');
  const enabled = engineOk && !!context.onPageSetup;
  return (
    <MenuRow
      slot="file.pageSetup"
      icon={chromeIcon(control?.paths)}
      disabled={!enabled}
      {...(engineReason ? { title: engineReason } : {})}
      onSelect={() => {
        context.onPageSetup?.();
        context.setOpenMenu(null);
      }}
      {...(className ? { className } : {})}
    >
      {text}
    </MenuRow>
  );
}

/**
 * The Paragraph dialog, from the menu bar.
 *
 * A second route on purpose. Its natural home is the line-spacing menu, but that control
 * collapses into the toolbar's overflow panel on a narrow window and its submenu opens
 * clipped — so a feature reachable only from there disappears entirely at around 1100px.
 * The menu bar does not collapse.
 *
 * Same shape as page setup: no fixed command to dispatch, so the row asks through the
 * slot's probe and is disabled with the engine's own words on a document it cannot rewrite.
 */
function MenuParagraphDialogImpl({ className, hidden }: MenuActionProps) {
  const { isEnabled: engineOk, disabledReason: engineReason } = useEditorCommand(
    chromeProbeForSlot('paragraph.dialog')!
  );
  const context = useMenuContext();
  const label = useMenuLabel();
  if (hidden) return null;
  const control = chromeControlForSlot('paragraph.dialog');
  const text = label(control?.labelKey ?? 'lineSpacing.options');
  const enabled = engineOk && !!context.onParagraphDialog;
  return (
    <MenuRow
      slot="paragraph.dialog"
      icon={chromeIcon(control?.paths)}
      disabled={!enabled}
      {...(engineReason ? { title: engineReason } : {})}
      onSelect={() => {
        context.onParagraphDialog?.();
        context.setOpenMenu(null);
      }}
      {...(className ? { className } : {})}
    >
      {text}
    </MenuRow>
  );
}

export const MenuParagraphDialog = Object.assign(MenuParagraphDialogImpl, {
  docxSlot: 'paragraph.dialog' as const,
});

export const MenuPageSetup = Object.assign(MenuPageSetupImpl, {
  docxSlot: 'file.pageSetup' as ChromeSlotId,
});

function MenuImageInsertImpl({ className, hidden }: MenuActionProps) {
  // Optional, like every other row's graceful degrade: a menu mounted outside
  // `DocxEditor.Root` (no `ImageInsertProvider`) renders the row present-and-disabled
  // instead of throwing during render.
  const insert = useImageInsertOptional();
  const context = useMenuContext();
  const label = useMenuLabel();
  if (hidden) return null;
  const control = chromeControlForSlot('image.insert');
  const text = label(control?.labelKey ?? 'toolbar.image');
  const isEnabled = insert?.isEnabled ?? false;
  const disabledReason = insert?.disabledReason ?? null;
  return (
    <MenuRow
      slot="image.insert"
      icon={chromeIcon(control?.paths)}
      disabled={!isEnabled}
      {...(disabledReason ? { title: disabledReason } : {})}
      onSelect={() => {
        insert?.openFilePicker();
        context.setOpenMenu(null);
      }}
      {...(className ? { className } : {})}
    >
      {text}
    </MenuRow>
  );
}

export const MenuImageInsert = Object.assign(MenuImageInsertImpl, {
  docxSlot: 'image.insert' as ChromeSlotId,
});

// ─────────────────────────────────────────────────────────────────────────────
// Submenu
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Props for `DocxEditor.Menu.Submenu`. Set `labelKey` or `label`. A submenu with neither has
 * no name, with a development warning. An interface, so a host can extend it.
 *
 * @public
 */
export interface MenuSubmenuProps extends MenuSubmenuBaseProps {
  /** i18n key of the parent row's label. */
  labelKey?: string;
  /** Literal parent row label, already resolved. Wins over `labelKey`. */
  label?: string;
}

/** The props every `Menu.Submenu` takes besides its label. @public */
export interface MenuSubmenuBaseProps {
  /** Material Symbols paths for the parent row's icon. */
  paths?: readonly string[] | null;
  className?: string;
  children?: DocxEditorChildren;
}

/**
 * A row that opens a nested panel to its right (Insert › Break).
 *
 * The parent row runs nothing — disclosure is not a command — so it stays interactive
 * regardless of what its children can do, and each child answers for itself. Opening on
 * hover AND on click is what both Word and Docs do; keyboard users get the same panel
 * through focus.
 *
 * @public
 */
export function MenuSubmenu({
  labelKey,
  label: literal,
  paths,
  className,
  children,
}: MenuSubmenuProps) {
  const label = useMenuLabel();
  const [open, setOpen] = useState(false);
  const parentRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId();
  if (literal === undefined && labelKey === undefined) warnMissingSubmenuLabel();
  const text = literal ?? label(labelKey ?? '');

  // Placed in client space, not with `left: 100%`. The context menu is a scroller
  // (`max-height` plus `overflow-y: auto`, which forces the other axis to `auto` with it), so
  // a panel opening sideways was clipped at the parent's edge — the row highlighted, the panel
  // mounted, and nothing appeared. Measuring also lets a panel near the right edge open
  // leftward, which `left: 100%` could never do.
  const [box, setBox] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) {
      setBox(null);
      return undefined;
    }
    const row = parentRef.current;
    const view = row?.ownerDocument.defaultView;
    if (!row || !view) return undefined;
    const place = (): void => {
      const panel = panelRef.current;
      if (!panel) return;
      // The row's inline-end side first, where its caret points; the other side when the
      // panel would not fit there.
      setBox(
        placeSubmenu(
          row.getBoundingClientRect(),
          { width: panel.offsetWidth, height: panel.offsetHeight },
          { width: view.innerWidth, height: view.innerHeight },
          view.getComputedStyle(row).direction === 'rtl'
        )
      );
    };
    place();
    // A long context menu scrolls inside itself; the panel follows its row.
    const parentPanel = row.closest('[role="menu"]');
    parentPanel?.addEventListener('scroll', place, { passive: true });
    return () => parentPanel?.removeEventListener('scroll', place);
  }, [open]);
  return (
    <div
      role="none"
      className={`docx-menubar__submenu${className ? ` ${className}` : ''}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onKeyDown={(event) => {
        // The APG's submenu keys, and the reason the panel is reachable at all without a
        // pointer: Right opens and steps in, Left and Escape close and come back to the
        // parent row. Escape is stopped so it closes THIS panel rather than the whole bar.
        const keys = submenuKeys(
          hostWindowOf(event.currentTarget).getComputedStyle(event.currentTarget).direction ===
            'rtl'
        );
        if (
          event.key === keys.open &&
          hostDocumentOf(parentRef.current).activeElement === parentRef.current
        ) {
          event.preventDefault();
          setOpen(true);
          queueMicrotask(() => {
            if (panelRef.current) focusEdge(panelItems(panelRef.current), 'first');
          });
        } else if ((event.key === keys.close || event.key === 'Escape') && open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          parentRef.current?.focus();
        }
      }}
      // Focus leaving the whole submenu closes it. Without this, a panel opened by
      // TABBING onto the parent stays open forever — `onMouseLeave` cannot fire for a
      // pointer that never arrived, and it then floats over the rows below it.
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={parentRef}
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        className="docx-toolbar__menu-item docx-menubar__item"
        tabIndex={-1}
        {...(open ? { 'data-open': '' } : {})}
        onMouseDown={guardToolbarMousedown}
        onFocus={() => setOpen(true)}
        // OPENS, never toggles. The pointer that clicked this row is already inside the
        // wrapper, so `onMouseEnter` has set `open` — a toggle would read the state hover
        // just wrote and close the panel the click was meant to open, and no further
        // `mouseEnter` fires while the pointer stays put. Closing is `onMouseLeave`'s and
        // the blur handler's job, which is also how Word and Docs behave.
        onClick={() => setOpen(true)}
      >
        <span className="docx-menubar__item-icon" aria-hidden="true">
          {chromeIcon(paths)}
        </span>
        <span className="docx-menubar__item-label">{text}</span>
        <span className="docx-menubar__item-caret" aria-hidden="true">
          ›
        </span>
      </button>
      {open ? (
        <div
          ref={panelRef}
          id={panelId}
          className="docx-toolbar__menu docx-menubar__menu docx-menubar__submenu-panel"
          role="menu"
          aria-label={text}
          // Hidden for the measuring pass: it must be in the DOM to have a size.
          style={
            box
              ? { position: 'fixed', left: box.left, top: box.top }
              : { position: 'fixed', visibility: 'hidden' }
          }
          onKeyDown={(event) => {
            const panel = panelRef.current;
            if (!panel) return;
            const items = panelItems(panel);
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              event.stopPropagation();
              focusBy(items, hostDocumentOf(panel).activeElement, 1);
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              event.stopPropagation();
              focusBy(items, hostDocumentOf(panel).activeElement, -1);
            }
          }}
        >
          <MenuRowTabIndexContext.Provider value={-1}>{children}</MenuRowTabIndexContext.Provider>
        </div>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The insert-table grid
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The Insert › Table row: the grid behind a disclosure when the engine can insert one, a
 * plain disabled row when it cannot.
 *
 * Disclosure is not a command, so a submenu parent is normally interactive whatever its
 * children can do — but that reasoning only holds when SOMETHING in the panel can act.
 * With every cell refused the caret invites a click that opens a dead grid, and the
 * engine's refusal ends up as body text in the panel, where a developer-facing string
 * ("not wired to an editor command") reads as product copy. Both go where every other
 * refused row puts them: a greyed row whose tooltip carries the engine's words.
 */
function MenuTablePicker({ entry }: { entry: ChromeMenuItemEntry }) {
  const { isEnabled } = useEditorCommand(entry.slot);
  const control = chromeControlForSlot(entry.slot);
  if (!isEnabled) {
    return (
      <MenuItem slotId={entry.slot} {...(entry.labelKey ? { labelKey: entry.labelKey } : {})} />
    );
  }
  return (
    <MenuSubmenu
      labelKey={entry.labelKey ?? control?.labelKey ?? entry.slot}
      paths={control?.paths}
    >
      <MenuTableGrid slot={entry.slot} />
    </MenuSubmenu>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Separator, and the registry-driven entry renderer
// ─────────────────────────────────────────────────────────────────────────────

/** Props for `DocxEditor.Menu.Separator`. @public */
export interface MenuSeparatorProps {
  className?: string;
}

/** A horizontal rule between groups of rows. @public */
export function MenuSeparator({ className }: MenuSeparatorProps) {
  return (
    <div
      role="separator"
      className={`docx-toolbar__menu-separator${className ? ` ${className}` : ''}`}
    />
  );
}

/**
 * One registry entry as its row.
 *
 * Host actions use their pinned parts because they are not editing commands.
 */
export function MenuEntry({ entry, children }: { entry: ChromeMenuEntry; children?: ReactNode }) {
  if (entry.kind === 'separator') return <MenuSeparator />;
  if (entry.kind === 'submenu') {
    return (
      <MenuSubmenu labelKey={entry.labelKey} paths={entry.paths}>
        {children ?? entry.items.map((item, index) => <MenuEntry key={index} entry={item} />)}
      </MenuSubmenu>
    );
  }
  if (entry.slot === 'file.open') return <MenuOpen />;
  if (entry.slot === 'file.save') return <MenuSave />;
  if (entry.slot === 'file.exportMarkdown') return <MenuExportMarkdown />;
  if (entry.slot === 'file.exportPdf') return <MenuExportPdf />;
  if (entry.slot === 'file.print') return <MenuPrint />;
  if (entry.slot === 'file.pageSetup') return <MenuPageSetup />;
  if (entry.slot === 'paragraph.dialog') return <MenuParagraphDialog />;
  if (entry.slot === 'insert.watermark') return <MenuWatermark />;
  if (entry.slot === 'insert.bookmark') return <MenuBookmark />;
  if (entry.slot === 'insert.goToBookmark') return <MenuGoToBookmarkRow />;
  if (entry.slot === 'image.insert') return <MenuImageInsert />;
  if (entry.picker === 'tableGrid') return <MenuTablePicker entry={entry} />;
  if (entry.picker === 'chartType') return <MenuChartPicker entry={entry} />;
  return (
    <MenuItem
      slotId={entry.slot}
      {...(entry.labelKey ? { labelKey: entry.labelKey } : {})}
      {...(entry.shortcutKey ? { shortcutKey: entry.shortcutKey } : {})}
    />
  );
}

/**
 * The ROW a child element replaces, or null for a child that is not a row part.
 *
 * Two shapes, matching how the toolbar recognizes its own parts: a pinned part carries a
 * fixed `docxSlot` static (`Menu.Open`, `Menu.Save`, `Menu.PageSetup`, `Menu.ReportIssue`),
 * and the generic `Menu.Item` carries a `docxMenuRow` marker plus its `slot` PROP. A
 * single-child Fragment unwraps, because `Children.toArray` does not flatten Fragment
 * elements and a host mapping over its overrides will wrap them.
 */
function rowKeyOfChild(child: ReactNode): string | null {
  if (!isValidElement(child)) return null;
  const unwrapped = unwrapFragment(child, rowKeyOfChild);
  if (unwrapped !== null) return unwrapped;
  const type = child.type as { docxSlot?: unknown; docxMenuRow?: unknown };
  if (typeof type !== 'function' && typeof type !== 'object') return null;
  if (typeof type.docxSlot === 'string') return type.docxSlot;
  if (type.docxMenuRow === true) return menuItemSlotId(child.props as MenuItemProps) ?? null;
  return null;
}

/** The row key of one registry entry. Separators and submenus are positional, not keyed. */
function rowKeyOfEntry(entry: ChromeMenuEntry, index: number): string {
  if (entry.kind === 'item') return entry.slot;
  if (entry.kind === 'submenu') return `submenu:${entry.labelKey}`;
  return `separator:${index}`;
}

/**
 * A panel's rows: the registry's arrangement with the host's row children merged IN PLACE.
 *
 * The same contract the toolbar root has, one level down, and for the same reason. Without
 * it, changing ONE row of the Insert menu meant re-listing every row — so a host that
 * wanted a different Image handler inherited responsibility for the break submenu, the
 * table picker and the table-of-contents row forever, and silently stopped tracking the
 * registry the day a row was added.
 *
 * `preset={false}` still renders children verbatim: when the ORDER is the point, stating it
 * is clearer than merging into it.
 */
function mergePanel(
  entries: readonly ChromeMenuEntry[] | undefined,
  children: ReactNode,
  preset: boolean
): ReactNode {
  return mergeArrangement({
    entries: entries ?? [],
    children,
    preset,
    keyOfEntry: rowKeyOfEntry,
    keyOfChild: rowKeyOfChild,
    childrenOfEntry: (entry) => (entry.kind === 'submenu' ? entry.items : undefined),
    renderEntry: (entry, _index, nested) => <MenuEntry entry={entry}>{nested}</MenuEntry>,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// One menu: trigger + panel
// ─────────────────────────────────────────────────────────────────────────────

/** Props for `DocxEditor.Menu.Menu` and the five pinned menu parts. @public */
export interface MenuProps {
  /** Which menu this is. Only one panel in the bar is open at a time, keyed on this. */
  id: MenuId;
  /** i18n key of the trigger label. Defaults to the registry's. */
  labelKey?: string;
  /**
   * Literal trigger label, already resolved. Wins over `labelKey`, and is what a
   * host-defined menu uses — its name is not in our catalogue and never will be.
   */
  label?: string;
  /**
   * Icon shown before the trigger's label.
   *
   * OPT-IN and unset by default, because neither Word nor Docs puts icons on a menu bar and
   * the packaged bar should look like the thing it is imitating. It exists because every
   * other control in this library takes one — toolbar parts, menu rows — and a product with
   * its own visual language should not have to rebuild the trigger to add a glyph to it.
   *
   * Decorative: the label is the accessible name, so the icon is hidden from assistive tech.
   */
  icon?: DocxEditorChildren;
  className?: string;
  /** Render nothing — inside the default bar this removes the menu. */
  hidden?: boolean;
  /**
   * `false` renders `children` verbatim as the whole panel. Default `true`: the panel is
   * the registry's rows for this menu, with a row child REPLACING the row it names in
   * place (`hidden` removes it) and any other child appended. Use `false` when the order
   * matters and you want to state it yourself.
   */
  preset?: boolean;
  /** Panel content. */
  children?: DocxEditorChildren;
}

/**
 * One menu of the bar: a trigger and the panel it opens.
 *
 * Bar behaviour is Docs': a click opens, a second click closes, and while ANY menu is
 * open, moving the pointer over a different trigger switches to it without a click.
 *
 * @public
 */
export function Menu({
  id,
  labelKey,
  label: literal,
  icon,
  className,
  hidden,
  preset = true,
  children,
}: MenuProps) {
  const { openMenu, setOpenMenu, activeMenu, opening } = useMenuContext();
  const menuOverflow = useMenuOverflow();
  const label = useMenuLabel();
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Whether the panel was opened BY KEYBOARD, so focus should move into it. A pointer
  // user's focus must stay put — yanking it into the panel on hover would scroll the page
  // and fight the mouse.
  const openedByKey = useRef(false);
  // Set when HOVER switched the bar to this menu. The click that follows a hover-switch
  // must not toggle: the pointer moved onto a closed trigger, hover opened it, and by the
  // time `onClick` runs the state says "already open" — so a plain toggle would close the
  // menu the user just clicked on, which reads as the bar closing on them. Consumed by
  // the next click; a click on the ALREADY-open menu still closes it.
  const switchedByHover = useRef(false);
  const registry = CHROME_MENUS.find((menu) => menu.id === id);
  const open = openMenu === id;
  // The "⋯" menu's panel is clamped to the viewport like the toolbar's.
  const panelStyle = useMenuPanelPlacement(open && id === MENU_OVERFLOW_ID, triggerRef, panelRef);
  if (hidden) return null;
  const text = literal ?? label(labelKey ?? registry?.labelKey ?? id);
  // A menu that does not fit renders in the "⋯" menu instead of the bar, as a submenu row
  // with the same panel. Inside that menu, every menu that still fits renders nothing.
  const placement = menuOverflowPlacement(menuOverflow, id, activeMenu);
  if (placement.skip) return null;
  if (placement.asSubmenu) {
    return (
      <MenuSubmenu labelKey={labelKey ?? registry?.labelKey ?? id} label={text}>
        {mergePanel(registry?.entries, children, preset)}
      </MenuSubmenu>
    );
  }
  const rows = mergePanel(registry?.entries, children, preset);
  const iconOnly = placement.iconOnly;
  // Closing returns focus to the trigger. Every close path UNMOUNTS the panel, so without
  // this the element holding focus disappears and focus falls to <body> — the user is
  // dumped at the top of the page with no announcement and has to tab back through the
  // whole header.
  const closeToTrigger = () => {
    setOpenMenu(null);
    triggerRef.current?.focus();
  };

  return (
    // `role="none"` on the wrapper: `menubar` must OWN its `menuitem`s, and an unrole'd
    // div between them breaks the relationship AT derives item counts and "x of y" from.
    <div
      role="none"
      className={`docx-menubar__menu-root${className ? ` ${className}` : ''}`}
      data-menu={id}
      // Measured as a unit that can move into the "⋯" menu. The "⋯" menu itself cannot.
      {...placement.rootAttributes}
    >
      <button
        ref={triggerRef}
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        className="docx-menubar__trigger"
        disabled={opening === true}
        // Roving tabindex: the bar is ONE tab stop, and arrows move within it. Without
        // this every trigger is a stop and a keyboard user tabs through four of them to
        // get past the editor's chrome.
        // When the active menu moved into "⋯", the "⋯" trigger holds the stop instead.
        tabIndex={placement.tabStop ? 0 : -1}
        {...(open ? { 'data-open': '' } : {})}
        // The "⋯" trigger shows only its icon, so its name goes on the element.
        {...(iconOnly ? { 'aria-label': text, title: text } : {})}
        onMouseDown={guardToolbarMousedown}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openedByKey.current = true;
            setOpenMenu(id);
          } else if (event.key === 'ArrowUp') {
            // Word and Docs both open UPWARDS-from-the-bottom on ArrowUp.
            event.preventDefault();
            openedByKey.current = true;
            setOpenMenu(id);
          } else if (event.key === 'Escape' && open) {
            event.preventDefault();
            closeToTrigger();
          }
        }}
        onClick={() => {
          if (switchedByHover.current) {
            switchedByHover.current = false;
            return;
          }
          setOpenMenu(open ? null : id);
        }}
        // Docs' bar behaviour: once a menu is open the bar tracks the pointer, so
        // sliding across the triggers browses the menus without further clicks.
        onMouseEnter={() => {
          if (openMenu !== null && openMenu !== id) {
            switchedByHover.current = true;
            setOpenMenu(id);
          }
        }}
        onMouseLeave={() => {
          switchedByHover.current = false;
        }}
      >
        {icon ? (
          <span className="docx-menubar__trigger-icon" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        {iconOnly ? null : text}
      </button>
      {open ? (
        <div
          ref={(node) => {
            panelRef.current = node;
            // Focus the first row when the panel was opened from the keyboard. Done in the
            // ref callback rather than an effect so it lands in the same commit the panel
            // mounts in, with no intermediate frame where focus is nowhere.
            if (node && openedByKey.current) {
              openedByKey.current = false;
              focusEdge(panelItems(node), 'first');
            }
          }}
          id={panelId}
          role="menu"
          aria-label={text}
          style={panelStyle}
          className="docx-toolbar__menu docx-menubar__menu"
          onKeyDown={(event) => {
            const panel = panelRef.current;
            if (!panel) return;
            const items = panelItems(panel);
            const focused = hostDocumentOf(panel).activeElement;
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              focusBy(items, focused, 1);
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              focusBy(items, focused, -1);
            } else if (event.key === 'Home') {
              event.preventDefault();
              focusEdge(items, 'first');
            } else if (event.key === 'End') {
              event.preventDefault();
              focusEdge(items, 'last');
            } else if (event.key === 'Escape') {
              // Stopped here so the root's document listener does not ALSO close the bar
              // and race the focus restore below.
              event.preventDefault();
              event.stopPropagation();
              closeToTrigger();
            } else if (event.key === 'Tab') {
              // Tab leaves the whole widget rather than walking every row: one tab stop.
              setOpenMenu(null);
            }
          }}
        >
          <MenuRowTabIndexContext.Provider value={-1}>{rows}</MenuRowTabIndexContext.Provider>
        </div>
      ) : null}
    </div>
  );
}

/** A menu pinned to one registry id, for `DocxEditor.Menu.File` and friends. @public */
export interface MenuPartComponent {
  (props: Omit<MenuProps, 'id'>): ReactNode;
  readonly docxMenu: ChromeMenuId;
}

function defineMenu(id: ChromeMenuId): MenuPartComponent {
  const Part = (props: Omit<MenuProps, 'id'>) => <Menu id={id} {...props} />;
  return Object.assign(Part, { docxMenu: id });
}

export const MenuFile = defineMenu('file');
export const MenuFormat = defineMenu('format');
export const MenuInsert = defineMenu('insert');
