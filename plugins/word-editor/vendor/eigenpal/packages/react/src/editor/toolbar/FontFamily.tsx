import { usePickerKeyboard } from './usePickerKeyboard';
import type { DocxEditorChildren } from '../../docx-editor-children';
import type { ReactNode } from 'react';
// The font-family picker: a compound toolbar part plus the hook it is built from.
//
// `useFontFamily` is the whole behavior — current value, document-derived options,
// enabled state, and the can-before-exec setter — so a host that wants a completely
// different picker UI takes the hook and ignores the compound parts. The compound
// `FontFamily` (Trigger / Content / Item) is that hook plus open-state plumbing.
//
// Every option string comes from `Editor.getAvailableFonts()` — the configured font
// catalog and standard choices merged with the document's declared families.
// A brand-new document still offers a real list. The derivation validates font names at its boundary
// (length-bounded, control characters dropped), so rendering an option in its own
// typeface via a React `style` object is styling an already-sanitized name — and a
// style OBJECT, never a CSS string sink.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { commandForSlotValue, listenForOutsidePress } from '@docx-editor.dev/core/editor';
import { useDocxEditor } from '../context';
import { useEditorState } from '../useEditorState';
import { useEditorCommand } from '../useEditorCommand';
import { useToolbarLabel } from './toolbar-context';
import { chromeControlForSlot, guardToolbarMousedown } from './ToolbarButton';
import { Slot } from './Slot';

const EMPTY_FONTS: readonly string[] = Object.freeze([]);
const selectFontFamily = (snapshot: EditorSnapshot) => snapshot.formatting?.fontFamily ?? null;
const selectSnapshot = (snapshot: EditorSnapshot) => snapshot;

/** What `useFontFamily` answers. @public */
export interface UseFontFamilyResult {
  /** The selection's agreed family, or null (mixed selection, or no document). */
  readonly value: string | null;
  /** Apply a family through the can-before-exec path; a refusal is a safe no-op. */
  readonly setValue: (family: string) => void;
  /**
   * The offerable font catalog (validated, deduplicated, sorted): the editor's
   * standard and configured families merged with the document's declared ones.
   */
  readonly options: readonly string[];
  /** Whether the engine would honour a font change right now. */
  readonly isEnabled: boolean;
}

/**
 * The font-family picker's behavior, UI-free.
 *
 * @public
 */
export function useFontFamily(): UseFontFamilyResult {
  const editor = useDocxEditor();
  const value = useEditorState(selectFontFamily);
  // OPTIONS SUBSCRIPTION: the options list must follow edits (typing a run with a new
  // `w:rFonts`, undo, load), and the change signal for ALL document state is the
  // version-cached snapshot's IDENTITY. So this selects the snapshot itself — a new
  // reference exactly when observable state moved — and re-reads `getAvailableFonts()`
  // keyed on it. The read is cheap: the session memoizes the document half per
  // revision, so an unchanged document answers from cache. The cost accepted here is a
  // re-render of the consuming component on every state move, which for a single
  // toolbar picker is the right trade against a bespoke second subscription channel.
  const snapshot = useEditorState(selectSnapshot);
  const options = useMemo(
    () => (editor && !snapshot.isLoading ? editor.getAvailableFonts() : EMPTY_FONTS),
    [editor, snapshot]
  );
  const { isEnabled } = useEditorCommand('font.family');
  const setValue = useCallback(
    (family: string) => {
      if (!editor) return;
      const command = commandForSlotValue('font.family', family);
      if (!command) return;
      if (editor.can(command).ok) editor.exec(command);
    },
    [editor]
  );
  return useMemo(
    () => ({ value, setValue, options, isEnabled }),
    [value, setValue, options, isEnabled]
  );
}

interface FontFamilyContextValue extends UseFontFamilyResult {
  readonly open: boolean;
  readonly setOpen: (next: boolean) => void;
}

const FontFamilyContext = createContext<FontFamilyContextValue | null>(null);

function useFontFamilyContext(): FontFamilyContextValue | null {
  return useContext(FontFamilyContext);
}

/** Props for `DocxEditorToolbar.FontFamily` and its sub-parts. @public */
export interface FontFamilyPartProps {
  asChild?: boolean;
  className?: string;
  children?: DocxEditorChildren;
}

/** Props for the compound root. @public */
export interface FontFamilyProps extends FontFamilyPartProps {
  /** Render nothing — inside the default arrangement this removes the slot. */
  hidden?: boolean;
}

/** Props for `FontFamily.Item`. @public */
export interface FontFamilyItemProps extends FontFamilyPartProps {
  /** The family this item applies. */
  value: string;
}

function FontFamilyTrigger({ asChild, className, children }: FontFamilyPartProps) {
  const context = useFontFamilyContext();
  const label = useToolbarLabel();
  if (!context) return null;
  const text = label(chromeControlForSlot('font.family')?.labelKey ?? 'font.family');
  const shared = {
    onClick: () => context.setOpen(!context.open),
    onMouseDown: guardToolbarMousedown,
    disabled: !context.isEnabled,
    className: `docx-toolbar__font-family-trigger${className ? ` ${className}` : ''}`,
    ...(!context.isEnabled ? { 'data-disabled': '' } : {}),
    'aria-haspopup': 'listbox' as const,
    'aria-expanded': context.open,
    'aria-label': children !== undefined ? undefined : `${text}: ${context.value ?? '—'}`,
    title: text,
  };
  // No agreed family (mixed selection / no document) shows an em-dash — never English.
  const display = children ?? <span>{context.value ?? '—'}</span>;
  if (asChild) return <Slot {...shared}>{display}</Slot>;
  return (
    <button type="button" {...shared}>
      {display}
    </button>
  );
}
FontFamilyTrigger.docxToolbarPart = true as const;

/**
 * The chrome spec's static font classification table, PRESENTATION DATA ONLY:
 * lowercase font name → group heading. Document-derived fonts the table does
 * not know fall into a plain trailing unlabelled group.
 */
const FONT_CATEGORY: ReadonlyMap<string, 'sansSerif' | 'serif' | 'monospace'> = new Map([
  ['arial', 'sansSerif'],
  ['calibri', 'sansSerif'],
  ['helvetica', 'sansSerif'],
  ['verdana', 'sansSerif'],
  ['open sans', 'sansSerif'],
  ['roboto', 'sansSerif'],
  ['times new roman', 'serif'],
  ['georgia', 'serif'],
  ['cambria', 'serif'],
  ['garamond', 'serif'],
  ['courier new', 'monospace'],
  ['consolas', 'monospace'],
]);

/** The group heading i18n keys, in the chrome spec's group order. */
const FONT_GROUPS = [
  { category: 'sansSerif', labelKey: 'font.sansSerif' },
  { category: 'serif', labelKey: 'font.serif' },
  { category: 'monospace', labelKey: 'font.monospace' },
  { category: 'other', labelKey: null },
] as const;

function FontFamilyContent({ asChild, className, children }: FontFamilyPartProps) {
  const context = useFontFamilyContext();
  const label = useToolbarLabel();
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (!context?.open) setQuery('');
  }, [context?.open]);
  if (!context || !context.open) return null;
  const shared = {
    role: 'listbox' as const,
    tabIndex: 0,
    'aria-label': label('font.selectAriaLabel'),
    // Anchoring, layering and colors all come from the core stylesheet — the popup
    // must sit in the overlay band, above ambient chrome like the navigation panel.
    className: `docx-toolbar__menu docx-toolbar__font-family-content${className ? ` ${className}` : ''}`,
  };
  // The default menu is the grouped picker: small gray semibold headings for
  // the classified families, a plain trailing group for the rest, ✓ on the current
  // one (the Item renders it). Custom children replace the grouping wholesale.
  let items: ReactNode;
  if (children !== undefined) {
    items = children;
  } else {
    const grouped = FONT_GROUPS.map((group) => ({
      ...group,
      fonts: context.options.filter(
        (option) =>
          option.toLowerCase().includes(query.toLowerCase()) &&
          (FONT_CATEGORY.get(option.toLowerCase()) ?? 'other') === group.category
      ),
    })).filter((group) => group.fonts.length > 0);
    items = grouped.map((group, index) => (
      <div key={group.category} role="group">
        {index > 0 ? <div className="docx-toolbar__menu-separator" aria-hidden="true" /> : null}
        {group.labelKey ? (
          <div className="docx-toolbar__menu-label">{label(group.labelKey)}</div>
        ) : null}
        {group.fonts.map((option) => (
          <FontFamilyItem key={option} value={option} />
        ))}
      </div>
    ));
  }
  if (asChild) return <Slot {...shared}>{items}</Slot>;
  if (children !== undefined) return <div {...shared}>{items}</div>;
  return (
    <div className={shared.className}>
      <input
        type="search"
        className="docx-toolbar__font-search"
        aria-label={label('font.search')}
        placeholder={label('font.search')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div
        role="listbox"
        tabIndex={0}
        aria-label={label('font.selectAriaLabel')}
        className="docx-toolbar__font-options"
      >
        {items}
      </div>
    </div>
  );
}

function FontFamilyItem({ value, asChild, className, children }: FontFamilyItemProps) {
  const editor = useDocxEditor();
  const context = useFontFamilyContext();
  if (!context) return null;
  const selected = context.value === value;
  const shared = {
    role: 'option' as const,
    tabIndex: -1,
    'aria-selected': selected,
    ...(selected ? { 'data-selected': '' } : {}),
    onMouseDown: guardToolbarMousedown,
    onClick: () => {
      context.setValue(value);
      context.setOpen(false);
      editor?.focus();
    },
    className: `docx-toolbar__font-family-item${className ? ` ${className}` : ''}`,
  };
  // The default label renders the family IN its own typeface (a validated name via a
  // style object). Custom children replace the label wholesale.
  const display = children ?? <span style={{ fontFamily: value }}>{value}</span>;
  if (asChild) return <Slot {...shared}>{display}</Slot>;
  return (
    <button type="button" {...shared}>
      {display}
      {/* The selected row's ✓, on the row's right edge. */}
      {selected ? (
        <span className="docx-toolbar__menu-check" aria-hidden="true">
          ✓
        </span>
      ) : null}
    </button>
  );
}

/**
 * The compound font-family picker. With no children it renders Trigger + Content with
 * an Item per selectable font; with children, compose `FontFamily.Trigger`,
 * `FontFamily.Content`, and `FontFamily.Item` yourself around the shared state.
 *
 * @public
 */
export function FontFamilyRoot({ hidden, asChild, className, children }: FontFamilyProps) {
  const state = useFontFamily();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  usePickerKeyboard(rootRef, open, () => setOpen(false));

  // Outside pointer presses close the popup before the surface handles the press.
  // Inside presses stay open so items can handle their click.
  useEffect(() => {
    if (!open) return undefined;
    return listenForOutsidePress({
      popup: rootRef.current,
      close: () => setOpen(false),
    });
  }, [open]);

  const context = useMemo<FontFamilyContextValue>(
    () => ({ ...state, open, setOpen }),
    [state, open]
  );

  if (hidden) return null;
  const shared = {
    // The positioning context for the absolute Content comes from the core stylesheet.
    className: `docx-toolbar__font-family${className ? ` ${className}` : ''}`,
    // Stable slot identity, matching the other parts' `data-slot` markers.
    'data-slot': 'font.family',
  };
  const body = children ?? (
    <>
      <FontFamilyTrigger />
      <FontFamilyContent />
    </>
  );
  return (
    <FontFamilyContext.Provider value={context}>
      {asChild ? (
        <Slot {...shared} ref={rootRef as never}>
          {body}
        </Slot>
      ) : (
        <div ref={rootRef} {...shared}>
          {body}
        </div>
      )}
    </FontFamilyContext.Provider>
  );
}

/** The compound part with its sub-parts attached as statics. @public */
export interface FontFamilyNamespace {
  (props: FontFamilyProps): ReactNode;
  readonly docxSlot: 'font.family';
  readonly Trigger: typeof FontFamilyTrigger;
  readonly Content: typeof FontFamilyContent;
  readonly Item: typeof FontFamilyItem;
}

export const FontFamily: FontFamilyNamespace = Object.assign(FontFamilyRoot, {
  docxSlot: 'font.family' as const,
  Trigger: FontFamilyTrigger,
  Content: FontFamilyContent,
  Item: FontFamilyItem,
});
