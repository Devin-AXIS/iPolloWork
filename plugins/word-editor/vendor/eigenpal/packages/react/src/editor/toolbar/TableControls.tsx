import type { DocxEditorChildren } from '../../docx-editor-children';
import type { ReactNode } from 'react';
// Contextual table toolbar parts: border target/color/style/width and cell fill.
//
// Visible only when `snapshot.table` is present. One React-owned draft persists across
// picks; every value routes through `runTableChromeCommand` and core command state.
// Each part is a compound (Trigger / Content / Item) over the shared draft provider.

import {
  createContext,
  useContext,
  useMemo,
  useRef,
  useState,
  Fragment,
  type KeyboardEvent,
} from 'react';
import type { TableBorderStyle } from '@docx-editor.dev/core/contracts/editor';
import {
  TABLE_BORDER_STYLE_OPTIONS,
  TABLE_BORDER_TARGET_OPTIONS,
  TABLE_BORDER_WIDTH_OPTIONS,
  tableChromeIconPaths,
  tableChromeLabelKeyForTarget,
  type TableBorderTargetValue,
  type TableChromeSlotId,
} from '@docx-editor.dev/core/editor';
import { useToolbarLabel } from './toolbar-context';
import { chromeControlForSlot, chromeIcon, guardToolbarMousedown } from './ToolbarButton';
import type { ToolbarSlotPartComponent } from './parts';
import { ToolbarSeparator } from './parts';
import { ToolbarTableMergeCells, ToolbarTableSplitCell } from './TableCellStructure';
import { Slot } from './Slot';
import { ColorPickerPanel } from '../color/ColorPicker';
import { useTableChromeProviderVisible, useTableChromeSlot } from './useTableChrome';
import { useDropdownClose } from './useDropdownClose';
import {
  useTableChromeTriggerA11y,
  useTableDialogKeyboard,
  useTableMenuKeyboard,
  restoreToolbarDocumentFocus,
} from './table-chrome-shared';

function triggerKeyboardToggle(
  enabled: boolean,
  open: boolean,
  setOpen: (open: boolean) => void
): ((event: KeyboardEvent) => void) | undefined {
  if (!enabled) return undefined;
  return (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setOpen(!open);
    }
  };
}

/** Props shared by contextual table toolbar compound parts. @public */
export interface TableChromePartProps {
  /** Appended to the part root class list. */
  className?: string;
  /** When true, the part renders nothing. */
  hidden?: boolean;
  /** Merge props onto the single child element instead of rendering a default host node. */
  asChild?: boolean;
  /** Custom panel body or trigger label; defaults to the packaged control chrome. */
  children?: DocxEditorChildren;
}

/** Props for a value-driven row or swatch inside a table compound menu. @public */
export interface TableChromeItemProps extends TableChromePartProps {
  /** The pick value this item dispatches (target id, style name, width size, or hex without `#`). */
  value: string;
}

/**
 * Shared compound contract for menu-style table chrome parts
 * ({@link TableBorderTargetNamespace}, {@link TableBorderStyleNamespace}, {@link TableBorderWidthNamespace}).
 *
 * @public
 */
export interface TableChromePartComponent extends ToolbarSlotPartComponent {
  /** The chrome slot this compound drives. */
  readonly docxSlot: TableChromeSlotId;
  /** Opens the picker menu or dialog. */
  readonly Trigger: (props: TableChromePartProps) => DocxEditorChildren;
  /** The open menu or dialog panel; omit to use the default item list. */
  readonly Content: (props: TableChromePartProps) => DocxEditorChildren;
  /** One selectable value row or swatch inside {@link Content}. */
  readonly Item: (props: TableChromeItemProps) => DocxEditorChildren;
}

/**
 * Border-target picker compound (`DocxEditor.Toolbar.TableBorderTarget`).
 *
 * @public
 */
export interface TableBorderTargetNamespace extends TableChromePartComponent {
  /** Chrome slot id: `table.borderTarget`. */
  readonly docxSlot: 'table.borderTarget';
  /** Button that opens the border-edge target menu. */
  readonly Trigger: (props: TableChromePartProps) => DocxEditorChildren;
  /** Open menu listing edge scopes and clear. */
  readonly Content: (props: TableChromePartProps) => DocxEditorChildren;
  /** One edge scope or clear row inside the target menu. */
  readonly Item: (props: TableChromeItemProps) => DocxEditorChildren;
}

/**
 * Border-colour split compound with a quick-apply main button and swatch dialog
 * (`DocxEditor.Toolbar.TableBorderColor`).
 *
 * @public
 */
export interface TableBorderColorNamespace extends TableChromePartComponent {
  /** Chrome slot id: `table.borderColor`. */
  readonly docxSlot: 'table.borderColor';
  /** Applies the last swatch without opening the dialog. */
  readonly Main: (props: TableChromePartProps) => DocxEditorChildren;
  /** Button that opens the border-colour swatch dialog. */
  readonly Trigger: (props: TableChromePartProps) => DocxEditorChildren;
  /** Open swatch dialog for the active border target. */
  readonly Content: (props: TableChromePartProps) => DocxEditorChildren;
  /** One colour swatch inside the border-colour dialog. */
  readonly Item: (props: TableChromeItemProps) => DocxEditorChildren;
}

/**
 * Cell-fill split compound (`DocxEditor.Toolbar.TableCellFill`).
 *
 * @public
 */
export interface TableCellFillNamespace extends TableChromePartComponent {
  /** Chrome slot id: `table.cellFill`. */
  readonly docxSlot: 'table.cellFill';
  /** Applies the last swatch without opening the dialog. */
  readonly Main: (props: TableChromePartProps) => DocxEditorChildren;
  /** Button that opens the cell-fill swatch dialog. */
  readonly Trigger: (props: TableChromePartProps) => DocxEditorChildren;
  /** Open swatch dialog for the selected cell(s). */
  readonly Content: (props: TableChromePartProps) => DocxEditorChildren;
  /** One fill swatch inside the cell-fill dialog. */
  readonly Item: (props: TableChromeItemProps) => DocxEditorChildren;
}

/**
 * Border-style menu compound (`DocxEditor.Toolbar.TableBorderStyle`).
 *
 * @public
 */
export interface TableBorderStyleNamespace extends TableChromePartComponent {
  /** Chrome slot id: `table.borderStyle`. */
  readonly docxSlot: 'table.borderStyle';
  /** Button that opens the border line-style menu. */
  readonly Trigger: (props: TableChromePartProps) => DocxEditorChildren;
  /** Open menu listing line styles for the active target. */
  readonly Content: (props: TableChromePartProps) => DocxEditorChildren;
  /** One line-style row inside the style menu. */
  readonly Item: (props: TableChromeItemProps) => DocxEditorChildren;
}

/**
 * Border-width menu compound (`DocxEditor.Toolbar.TableBorderWidth`).
 *
 * @public
 */
export interface TableBorderWidthNamespace extends TableChromePartComponent {
  /** Chrome slot id: `table.borderWidth`. */
  readonly docxSlot: 'table.borderWidth';
  /** Button that opens the border width menu. */
  readonly Trigger: (props: TableChromePartProps) => DocxEditorChildren;
  /** Open menu listing width presets for the active target. */
  readonly Content: (props: TableChromePartProps) => DocxEditorChildren;
  /** One width preset row inside the width menu. */
  readonly Item: (props: TableChromeItemProps) => DocxEditorChildren;
}

function tableIcon(name: Parameters<typeof tableChromeIconPaths>[0]): ReactNode {
  return chromeIcon(tableChromeIconPaths(name));
}

interface TableSlotContextValue {
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
  readonly enabled: boolean;
  readonly disabledReason: string | null;
  readonly apply: (value: unknown) => void;
  readonly draft: ReturnType<typeof useTableChromeSlot>['draft'];
  readonly triggerRef: React.RefObject<HTMLButtonElement | null>;
  readonly lastHex?: string;
  readonly setLastHex?: (hex: string) => void;
}

function createTableSlotContext() {
  return createContext<TableSlotContextValue | null>(null);
}

function useTableSlotContext(
  ctx: ReturnType<typeof createTableSlotContext>
): TableSlotContextValue {
  const value = useContext(ctx);
  if (!value) throw new Error('table chrome compound part used outside its root');
  return value;
}

function buildMenuCompound(slot: TableChromeSlotId, classBase: string, defaultLabelKey: string) {
  const Ctx = createTableSlotContext();

  function Root({ hidden, asChild, className, children }: TableChromePartProps) {
    const { visible, enabled, disabledReason, draft, apply } = useTableChromeSlot(slot);
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    useDropdownClose(open, setOpen, rootRef, hidden || !visible);

    const value = useMemo<TableSlotContextValue>(
      () => ({ open, setOpen, enabled, disabledReason, apply, draft, triggerRef }),
      [open, enabled, disabledReason, apply, draft]
    );

    if (hidden || !visible) return null;

    const shared = {
      className: `${classBase}${className ? ` ${className}` : ''}`,
      'data-slot': slot,
      style: {
        position: 'relative' as const,
        display: 'inline-flex' as const,
        alignItems: 'center' as const,
        verticalAlign: 'middle' as const,
      },
    };
    const body = children ?? (
      <>
        <Trigger />
        <Content />
      </>
    );
    return (
      <Ctx.Provider value={value}>
        {asChild ? (
          <Slot {...shared} ref={rootRef as never}>
            {body}
          </Slot>
        ) : (
          <div ref={rootRef} {...shared}>
            {body}
          </div>
        )}
      </Ctx.Provider>
    );
  }

  function Trigger({ asChild, className, children }: TableChromePartProps) {
    const { open, setOpen, enabled, disabledReason, triggerRef } = useTableSlotContext(Ctx);
    const label = useToolbarLabel();
    const control = chromeControlForSlot(slot);
    const text = label(control?.labelKey ?? defaultLabelKey);
    const { shared, reasonNode } = useTableChromeTriggerA11y({
      enabled,
      disabledReason,
      ariaLabel: text,
    });
    const props = {
      ...shared,
      ref: triggerRef,
      className: `docx-toolbar__button docx-table-chrome__trigger${className ? ` ${className}` : ''}`,
      'aria-haspopup': 'menu' as const,
      'aria-expanded': open,
      onClick: enabled ? () => setOpen(!open) : undefined,
      ...(asChild
        ? {
            tabIndex: enabled ? 0 : -1,
            role: 'button' as const,
            onKeyDown: triggerKeyboardToggle(enabled, open, setOpen),
          }
        : {}),
    };
    const display = children ?? (
      <>
        {chromeIcon(control?.paths)}
        <span className="docx-toolbar__picker-caret" aria-hidden="true">
          ▾
        </span>
      </>
    );
    return asChild ? (
      <>
        <Slot {...props}>{display}</Slot>
        {reasonNode}
      </>
    ) : (
      <button {...props}>
        {display}
        {reasonNode}
      </button>
    );
  }
  Trigger.docxToolbarPart = true as const;

  function Content({ asChild, className, children }: TableChromePartProps) {
    const { open, setOpen, enabled, triggerRef } = useTableSlotContext(Ctx);
    const label = useToolbarLabel();
    const panelRef = useRef<HTMLDivElement | null>(null);
    useTableMenuKeyboard(open && enabled, setOpen, panelRef, triggerRef);
    if (!open || !enabled) return null;
    const control = chromeControlForSlot(slot);
    const text = label(control?.labelKey ?? defaultLabelKey);
    const shared = {
      ref: panelRef,
      role: 'menu' as const,
      'aria-label': text,
      className: `docx-table-chrome__panel${className ? ` ${className}` : ''}`,
      onMouseDown: guardToolbarMousedown,
    };
    return asChild ? <Slot {...shared}>{children}</Slot> : <div {...shared}>{children}</div>;
  }

  return { Root, Trigger, Content, Ctx };
}

// ── Border target ────────────────────────────────────────────────────────────

const targetCompound = buildMenuCompound(
  'table.borderTarget',
  'docx-table-chrome docx-table-chrome--target',
  'table.borders.tooltip'
);

function TableBorderTargetItem({ value, asChild, className, children }: TableChromeItemProps) {
  const { apply, setOpen, draft } = useTableSlotContext(targetCompound.Ctx);
  const label = useToolbarLabel();
  const option = TABLE_BORDER_TARGET_OPTIONS.find((entry) => entry.value === value);
  if (!option) return null;
  const selected = option.value === 'none' ? false : option.value === draft.activeTarget;
  const shared = {
    type: 'button' as const,
    role: 'menuitemradio' as const,
    'aria-checked': selected,
    'data-value': option.value,
    className: `docx-table-chrome__target-btn${className ? ` ${className}` : ''}`,
    ...(selected ? { 'data-active': '' } : {}),
    'aria-label': label(option.labelKey),
    title: label(option.labelKey),
    onMouseDown: guardToolbarMousedown,
    onClick: () => {
      setOpen(false);
      apply(option.value satisfies TableBorderTargetValue);
    },
  };
  const display = children ?? tableIcon(option.icon);
  return asChild ? <Slot {...shared}>{display}</Slot> : <button {...shared}>{display}</button>;
}

function TableBorderTargetContent(props: TableChromePartProps) {
  const { children } = props;
  return (
    <targetCompound.Content {...props}>
      {children ?? (
        <div className="docx-table-chrome__target-grid">
          {TABLE_BORDER_TARGET_OPTIONS.map((option) => (
            <TableBorderTargetItem key={option.value} value={option.value} />
          ))}
        </div>
      )}
    </targetCompound.Content>
  );
}

function TableBorderTargetRoot(props: TableChromePartProps) {
  const { children } = props;
  const body = children ?? (
    <>
      <targetCompound.Trigger />
      <TableBorderTargetContent />
    </>
  );
  return <targetCompound.Root {...props}>{body}</targetCompound.Root>;
}

/**
 * Border-edge target picker compound for contextual table chrome.
 *
 * @public
 */
export const ToolbarTableBorderTarget: TableBorderTargetNamespace = Object.assign(
  TableBorderTargetRoot,
  {
    docxSlot: 'table.borderTarget' as const,
    Trigger: targetCompound.Trigger,
    Content: TableBorderTargetContent,
    Item: TableBorderTargetItem,
  }
);

// ── Border style ─────────────────────────────────────────────────────────────

const styleCompound = buildMenuCompound(
  'table.borderStyle',
  'docx-table-chrome docx-table-chrome--style',
  'table.borders.styleAriaLabel'
);

function TableBorderStyleItem({ value, asChild, className, children }: TableChromeItemProps) {
  const { apply, setOpen, draft } = useTableSlotContext(styleCompound.Ctx);
  const label = useToolbarLabel();
  const option = TABLE_BORDER_STYLE_OPTIONS.find((entry) => entry.value === value);
  if (!option) return null;
  const selected = option.value === draft.spec.style;
  const shared = {
    type: 'button' as const,
    role: 'menuitemradio' as const,
    'aria-checked': selected,
    ...(selected ? { 'data-selected': '' } : {}),
    className: `docx-table-chrome__width-row${className ? ` ${className}` : ''}`,
    onMouseDown: guardToolbarMousedown,
    onClick: () => {
      setOpen(false);
      apply(option.value satisfies TableBorderStyle);
    },
  };
  const display = children ?? (
    <>
      <span className={`docx-table-line ${option.previewClass}`} aria-hidden="true" />
      <span>{label(option.labelKey)}</span>
    </>
  );
  return asChild ? <Slot {...shared}>{display}</Slot> : <button {...shared}>{display}</button>;
}

function TableBorderStyleContent(props: TableChromePartProps) {
  const { children } = props;
  return (
    <styleCompound.Content {...props}>
      {children ??
        TABLE_BORDER_STYLE_OPTIONS.map((option) => (
          <TableBorderStyleItem key={option.value} value={option.value} />
        ))}
    </styleCompound.Content>
  );
}

function TableBorderStyleRoot(props: TableChromePartProps) {
  const body = props.children ?? (
    <>
      <styleCompound.Trigger />
      <TableBorderStyleContent />
    </>
  );
  return <styleCompound.Root {...props}>{body}</styleCompound.Root>;
}

/**
 * Border line-style menu compound for contextual table chrome.
 *
 * @public
 */
export const ToolbarTableBorderStyle: TableBorderStyleNamespace = Object.assign(
  TableBorderStyleRoot,
  {
    docxSlot: 'table.borderStyle' as const,
    Trigger: styleCompound.Trigger,
    Content: TableBorderStyleContent,
    Item: TableBorderStyleItem,
  }
);

// ── Border width ─────────────────────────────────────────────────────────────

const widthCompound = buildMenuCompound(
  'table.borderWidth',
  'docx-table-chrome docx-table-chrome--width',
  'table.borderWidth'
);

function TableBorderWidthItem({ value, asChild, className, children }: TableChromeItemProps) {
  const { apply, setOpen, draft } = useTableSlotContext(widthCompound.Ctx);
  const label = useToolbarLabel();
  const size = Number(value);
  const option = TABLE_BORDER_WIDTH_OPTIONS.find((entry) => entry.size === size);
  if (!option) return null;
  const selected = option.size === draft.spec.size;
  const shared = {
    type: 'button' as const,
    role: 'menuitemradio' as const,
    'aria-checked': selected,
    ...(selected ? { 'data-selected': '' } : {}),
    className: `docx-table-chrome__width-row${className ? ` ${className}` : ''}`,
    onMouseDown: guardToolbarMousedown,
    onClick: () => {
      setOpen(false);
      apply(option.size);
    },
  };
  const display = children ?? (
    <>
      <span
        className="docx-table-line docx-table-line--single"
        style={{ height: `${option.previewThickness}px` }}
        aria-hidden="true"
      />
      <span>{label(option.labelKey)}</span>
    </>
  );
  return asChild ? <Slot {...shared}>{display}</Slot> : <button {...shared}>{display}</button>;
}

function TableBorderWidthContent(props: TableChromePartProps) {
  const { children } = props;
  return (
    <widthCompound.Content {...props}>
      {children ??
        TABLE_BORDER_WIDTH_OPTIONS.map((option) => (
          <TableBorderWidthItem key={option.size} value={String(option.size)} />
        ))}
    </widthCompound.Content>
  );
}

function TableBorderWidthRoot(props: TableChromePartProps) {
  const body = props.children ?? (
    <>
      <widthCompound.Trigger />
      <TableBorderWidthContent />
    </>
  );
  return <widthCompound.Root {...props}>{body}</widthCompound.Root>;
}

/**
 * Border width menu compound for contextual table chrome.
 *
 * @public
 */
export const ToolbarTableBorderWidth: TableBorderWidthNamespace = Object.assign(
  TableBorderWidthRoot,
  {
    docxSlot: 'table.borderWidth' as const,
    Trigger: widthCompound.Trigger,
    Content: TableBorderWidthContent,
    Item: TableBorderWidthItem,
  }
);

// ── Color split controls (border color + cell fill) ─────────────────────────

function buildColorSplitCompound(
  slot: 'table.borderColor' | 'table.cellFill',
  defaultLabelKey: string,
  options?: { clearFill?: boolean; defaultHex?: string }
) {
  const defaultHex = options?.defaultHex ?? 'FF0000';
  const Ctx = createTableSlotContext();

  function Root({ hidden, asChild, className, children }: TableChromePartProps) {
    const { visible, enabled, disabledReason, draft, apply } = useTableChromeSlot(slot);
    const [open, setOpen] = useState(false);
    const [lastHex, setLastHex] = useState(defaultHex);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    useDropdownClose(open, setOpen, rootRef, hidden || !visible);

    const value = useMemo<TableSlotContextValue>(
      () => ({
        open,
        setOpen,
        enabled,
        disabledReason,
        apply,
        draft,
        triggerRef,
        lastHex,
        setLastHex,
      }),
      [open, enabled, disabledReason, apply, draft, lastHex]
    );

    if (hidden || !visible) return null;

    const shared = {
      className: `docx-toolbar__colorsplit docx-table-chrome${className ? ` ${className}` : ''}`,
      'data-slot': slot,
      style: {
        position: 'relative' as const,
        display: 'inline-flex' as const,
        alignItems: 'center' as const,
        verticalAlign: 'middle' as const,
      },
    };
    const body = children ?? (
      <>
        <Main />
        <Trigger />
        <Content clearFill={options?.clearFill ?? false} />
      </>
    );
    return (
      <Ctx.Provider value={value}>
        {asChild ? (
          <Slot {...shared} ref={rootRef as never}>
            {body}
          </Slot>
        ) : (
          <div ref={rootRef} {...shared}>
            {body}
          </div>
        )}
      </Ctx.Provider>
    );
  }

  function Main({ asChild, className, children }: TableChromePartProps) {
    const { enabled, disabledReason, apply, draft, lastHex } = useTableSlotContext(Ctx);
    const label = useToolbarLabel();
    const control = chromeControlForSlot(slot);
    const text = label(control?.labelKey ?? defaultLabelKey);
    const { shared, reasonNode } = useTableChromeTriggerA11y({
      enabled,
      disabledReason,
      ariaLabel: text,
    });
    const barHex =
      slot === 'table.borderColor' && draft.spec.color.kind === 'hex'
        ? draft.spec.color.value
        : (lastHex ?? defaultHex);
    const props = {
      ...shared,
      className: `docx-toolbar__button docx-toolbar__colorsplit-main${className ? ` ${className}` : ''}`,
      onClick: enabled ? () => apply({ kind: 'hex', value: barHex }) : undefined,
    };
    const display = children ?? (
      <>
        {chromeIcon(control?.paths)}
        <span
          className="docx-toolbar__colorsplit-bar"
          style={{ backgroundColor: `#${barHex.toLowerCase()}` }}
          aria-hidden="true"
        />
      </>
    );
    return asChild ? (
      <>
        <Slot {...props}>{display}</Slot>
        {reasonNode}
      </>
    ) : (
      <button {...props}>
        {display}
        {reasonNode}
      </button>
    );
  }
  Main.docxToolbarPart = true as const;

  function Trigger({ asChild, className, children }: TableChromePartProps) {
    const { open, setOpen, enabled, disabledReason, triggerRef } = useTableSlotContext(Ctx);
    const label = useToolbarLabel();
    const control = chromeControlForSlot(slot);
    const text = label(control?.labelKey ?? defaultLabelKey);
    const { shared, reasonNode } = useTableChromeTriggerA11y({
      enabled,
      disabledReason,
      ariaLabel: text,
    });
    const props = {
      ...shared,
      ref: triggerRef,
      className: `docx-toolbar__colorsplit-caret${className ? ` ${className}` : ''}`,
      'aria-haspopup': 'dialog' as const,
      'aria-expanded': open,
      onClick: enabled ? () => setOpen(!open) : undefined,
      ...(asChild
        ? {
            tabIndex: enabled ? 0 : -1,
            role: 'button' as const,
            onKeyDown: triggerKeyboardToggle(enabled, open, setOpen),
          }
        : {}),
    };
    const display = children ?? '▾';
    return asChild ? (
      <>
        <Slot {...props}>{display}</Slot>
        {reasonNode}
      </>
    ) : (
      <button {...props}>
        {display}
        {reasonNode}
      </button>
    );
  }
  Trigger.docxToolbarPart = true as const;

  function Content({
    asChild,
    className,
    children,
    clearFill,
  }: TableChromePartProps & {
    clearFill: boolean;
  }) {
    const { open, setOpen, enabled, apply, draft, triggerRef, lastHex, setLastHex } =
      useTableSlotContext(Ctx);
    const label = useToolbarLabel();
    const dialogRef = useRef<HTMLDivElement | null>(null);
    useTableDialogKeyboard(open && enabled, setOpen, dialogRef, triggerRef);
    if (!open || !enabled) return null;
    const text = label(defaultLabelKey);
    const pickerCurrent =
      slot === 'table.borderColor' && draft.spec.color.kind === 'hex'
        ? draft.spec.color.value
        : (lastHex ?? defaultHex);
    const shared = {
      ref: dialogRef,
      role: 'dialog' as const,
      'aria-label': text,
      className: `docx-toolbar__swatch-popup docx-table-chrome__panel${className ? ` ${className}` : ''}`,
      onMouseDown: guardToolbarMousedown,
    };
    const body = children ?? (
      <>
        {clearFill ? (
          <button
            type="button"
            className="docx-toolbar__swatch-clear"
            onMouseDown={guardToolbarMousedown}
            onClick={() => {
              setOpen(false);
              apply(null);
              restoreToolbarDocumentFocus(triggerRef.current);
            }}
          >
            <span
              className="docx-toolbar__swatch-clear-chip docx-toolbar__swatch-clear-chip--none"
              aria-hidden="true"
            />
            {label('table.clearCellFill')}
          </button>
        ) : null}
        <ColorPickerPanel
          apply={(hex) => {
            setOpen(false);
            setLastHex?.(hex);
            apply({ kind: 'hex', value: hex });
            restoreToolbarDocumentFocus(triggerRef.current);
          }}
          onClose={() => {
            setOpen(false);
            triggerRef.current?.focus();
          }}
          current={pickerCurrent}
        />
      </>
    );
    return asChild ? <Slot {...shared}>{body}</Slot> : <div {...shared}>{body}</div>;
  }

  function Item({
    value,
    css,
    labelKey,
    asChild,
    className,
    children,
  }: TableChromeItemProps & { css?: string; labelKey?: string }) {
    const { apply, setOpen, setLastHex, triggerRef } = useTableSlotContext(Ctx);
    const label = useToolbarLabel();
    const swatchCss = css ?? `#${value.toLowerCase()}`;
    const swatchLabel = labelKey ? label(labelKey) : value;
    const shared = {
      type: 'button' as const,
      className: `docx-toolbar__swatch docx-table-chrome__swatch${className ? ` ${className}` : ''}`,
      style: { backgroundColor: swatchCss },
      'data-value': value,
      'aria-label': swatchLabel,
      title: swatchLabel,
      onMouseDown: guardToolbarMousedown,
      onClick: () => {
        setOpen(false);
        setLastHex?.(value);
        apply({ kind: 'hex', value });
        restoreToolbarDocumentFocus(triggerRef.current);
      },
    };
    if (asChild) return <Slot {...shared}>{children}</Slot>;
    return <button {...shared}>{children}</button>;
  }

  return { Root, Main, Trigger, Content, Item, Ctx };
}

const borderColorCompound = buildColorSplitCompound('table.borderColor', 'table.borderColor', {
  defaultHex: '000000',
});

function TableBorderColorContent(props: TableChromePartProps) {
  return <borderColorCompound.Content {...props} clearFill={false} />;
}

function TableBorderColorItem(props: TableChromeItemProps) {
  return (
    <borderColorCompound.Item
      {...props}
      css={`#${props.value.toLowerCase()}`}
      labelKey="colorPicker.customColor"
    />
  );
}

function TableBorderColorRoot(props: TableChromePartProps) {
  return <borderColorCompound.Root {...props} />;
}

/**
 * Border-colour split compound (quick-apply main button + swatch dialog).
 *
 * @public
 */
export const ToolbarTableBorderColor: TableBorderColorNamespace = Object.assign(
  TableBorderColorRoot,
  {
    docxSlot: 'table.borderColor' as const,
    Trigger: borderColorCompound.Trigger,
    Content: TableBorderColorContent,
    Item: TableBorderColorItem,
    Main: borderColorCompound.Main,
  }
);

const fillCompound = buildColorSplitCompound('table.cellFill', 'table.cellFillColor', {
  clearFill: true,
  defaultHex: 'FFFF00',
});

function TableCellFillContent(props: TableChromePartProps) {
  return <fillCompound.Content {...props} clearFill={true} />;
}

function TableCellFillItem(props: TableChromeItemProps) {
  return (
    <fillCompound.Item
      {...props}
      css={`#${props.value.toLowerCase()}`}
      labelKey="colorPicker.customColor"
    />
  );
}

function TableCellFillRoot(props: TableChromePartProps) {
  return <fillCompound.Root {...props} />;
}

/**
 * Cell background fill split compound (quick-apply main button + swatch dialog).
 *
 * @public
 */
export const ToolbarTableCellFill: TableCellFillNamespace = Object.assign(TableCellFillRoot, {
  docxSlot: 'table.cellFill' as const,
  Trigger: fillCompound.Trigger,
  Content: TableCellFillContent,
  Item: TableCellFillItem,
  Main: fillCompound.Main,
});

/** The five contextual table chrome controls in registry order. @internal */
export function TableChromeGroup({
  overrides = new Map(),
  separator = true,
}: {
  overrides?: ReadonlyMap<string, React.ReactElement>;
  separator?: boolean;
}): ReactNode {
  const visible = useTableChromeProviderVisible();
  if (!visible) return null;

  const entries: readonly TableChromePartComponent[] = [
    ToolbarTableBorderTarget,
    ToolbarTableBorderColor,
    ToolbarTableBorderStyle,
    ToolbarTableBorderWidth,
    ToolbarTableCellFill,
  ];

  return (
    <>
      {separator ? <ToolbarSeparator /> : null}
      {entries.map((Part) => {
        const override = overrides.get(Part.docxSlot);
        if (override) {
          return <Fragment key={Part.docxSlot}>{override}</Fragment>;
        }
        return <Part key={Part.docxSlot} />;
      })}
      {[ToolbarTableMergeCells, ToolbarTableSplitCell].map((Part) => {
        const override = overrides.get(Part.docxSlot);
        return override ? (
          <Fragment key={Part.docxSlot}>{override}</Fragment>
        ) : (
          <Part key={Part.docxSlot} />
        );
      })}
    </>
  );
}

/**
 * Resolved label for the active border target in the shared draft.
 *
 * For custom table chrome that shows the current target name outside the packaged picker.
 *
 * @public
 */
export function useTableBorderTargetLabel(): string {
  const label = useToolbarLabel();
  const { draft } = useTableChromeSlot('table.borderTarget');
  return label(tableChromeLabelKeyForTarget(draft.activeTarget));
}
