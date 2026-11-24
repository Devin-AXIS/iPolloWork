import { usePickerKeyboard } from './usePickerKeyboard';
import type { DocxEditorChildren } from '../../docx-editor-children';
import type { ReactNode } from 'react';
// The paragraph-style picker: a compound toolbar part plus the hook it is built from.
//
// `useParagraphStyle` is the whole behavior — the selection's agreed style, the
// document's paragraph-style catalog, enabled state, and the can-before-exec setter —
// so a host that wants a different picker UI takes the hook and ignores the compound
// parts. The compound `ParagraphStyle` (Trigger / Content / Item) is that hook plus
// open-state plumbing, the same shape as `FontFamily`.
//
// Every option comes from `Editor.getDocumentStyles()`, which validates styleIds and
// display names at the derivation boundary (length-bounded, control characters
// dropped), so rendering an option label is rendering an already-sanitized string.

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
import { builtInParagraphStyleLabel, paragraphStyleDisplayName } from '../../lib/stylePreview';
import { useTranslation } from '../../i18n';

/** One pickable paragraph style, as the document defines it. @public */
export interface ParagraphStyleOption {
  readonly styleId: string;
  readonly name: string;
  /**
   * How the style looks, for rendering the row in its own face. Every value arrives
   * already bounded by the engine's derivation (family against the CSS-sink shape, colour
   * against six hex digits), which is what makes it safe to put in a style object.
   */
  readonly preview: {
    readonly fontFamily: string | null;
    readonly fontSizePt: number | null;
    readonly bold: boolean;
    readonly italic: boolean;
    readonly color: string | null;
  };
}

/**
 * The row's own typeface, as a React style OBJECT — never a CSS string.
 *
 * Size is CLAMPED for the menu rather than shown at its document size: a Title at 28pt
 * would push every other row off the screen. The proportions still read (a heading is
 * visibly bigger than body text), which is the whole point of previewing.
 */
function previewStyle(preview: ParagraphStyleOption['preview']): React.CSSProperties {
  const pt = preview.fontSizePt;
  return {
    ...(preview.fontFamily ? { fontFamily: preview.fontFamily } : {}),
    ...(pt ? { fontSize: `${Math.min(Math.max(pt, 9), 20)}px` } : {}),
    ...(preview.bold ? { fontWeight: 700 } : {}),
    ...(preview.italic ? { fontStyle: 'italic' } : {}),
    ...(preview.color ? { color: `#${preview.color}` } : {}),
  };
}

const EMPTY_OPTIONS: readonly ParagraphStyleOption[] = Object.freeze([]);
const selectStyleId = (snapshot: EditorSnapshot) => snapshot.formatting?.styleId ?? null;
const selectSnapshot = (snapshot: EditorSnapshot) => snapshot;

/** What `useParagraphStyle` answers. @public */
export interface UseParagraphStyleResult {
  /** The selection's agreed paragraph styleId, or null (unstyled/default, or mixed). */
  readonly value: string | null;
  /** Apply a paragraph style through the can-before-exec path; a refusal is a safe no-op. */
  readonly setValue: (styleId: string) => void;
  /**
   * The document's paragraph styles — validated ids and display names, in the engine's
   * Word-gallery order (Normal, Title, Subtitle, the headings, then everything else in
   * document order), NOT the order `styles.xml` happens to list them in.
   */
  readonly options: readonly ParagraphStyleOption[];
  /** Whether the engine would honour a style change right now. */
  readonly isEnabled: boolean;
}

/**
 * The paragraph-style picker's behavior, UI-free.
 *
 * @public
 */
export function useParagraphStyle(): UseParagraphStyleResult {
  const editor = useDocxEditor();
  const value = useEditorState(selectStyleId);
  // OPTIONS SUBSCRIPTION: same contract as `useFontFamily` — the change signal for all
  // document state is the version-cached snapshot's identity, and the per-revision
  // memoized derivation makes the re-read cheap.
  const snapshot = useEditorState(selectSnapshot);
  const { t } = useTranslation();
  const options = useMemo(
    () =>
      editor && !snapshot.isLoading
        ? editor
            .getDocumentStyles()
            .filter((style) => style.type === 'paragraph')
            .map((style) => {
              // A built-in style takes its label in the UI language.
              const builtIn = builtInParagraphStyleLabel(style.name);
              return {
                styleId: style.styleId,
                name: builtIn
                  ? t(builtIn.key, builtIn.vars)
                  : paragraphStyleDisplayName(style.name, style.styleId),
                preview: style.preview,
              };
            })
        : EMPTY_OPTIONS,
    [editor, snapshot, t]
  );
  const { isEnabled } = useEditorCommand('styles.style');
  const setValue = useCallback(
    (styleId: string) => {
      if (!editor) return;
      const command = commandForSlotValue('styles.style', styleId);
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

interface ParagraphStyleContextValue extends UseParagraphStyleResult {
  readonly open: boolean;
  readonly setOpen: (next: boolean) => void;
}

const ParagraphStyleContext = createContext<ParagraphStyleContextValue | null>(null);

function useParagraphStyleContext(): ParagraphStyleContextValue | null {
  return useContext(ParagraphStyleContext);
}

/** Props for `DocxEditorToolbar.StylePicker` and its sub-parts. @public */
export interface ParagraphStylePartProps {
  asChild?: boolean;
  className?: string;
  children?: DocxEditorChildren;
}

/** Props for the compound root. @public */
export interface ParagraphStyleProps extends ParagraphStylePartProps {
  /** Render nothing — inside the default arrangement this removes the slot. */
  hidden?: boolean;
}

/** Props for `ParagraphStyle.Item`. @public */
export interface ParagraphStyleItemProps extends ParagraphStylePartProps {
  /** The styleId this item applies. */
  value: string;
}

function ParagraphStyleTrigger({ asChild, className, children }: ParagraphStylePartProps) {
  const context = useParagraphStyleContext();
  const label = useToolbarLabel();
  if (!context) return null;
  const control = chromeControlForSlot('styles.style');
  const text = label(control?.labelKey ?? 'styles.style');
  const shared = {
    onClick: () => context.setOpen(!context.open),
    onMouseDown: guardToolbarMousedown,
    disabled: !context.isEnabled,
    className: `docx-toolbar__style-trigger${className ? ` ${className}` : ''}`,
    ...(!context.isEnabled ? { 'data-disabled': '' } : {}),
    'aria-haspopup': 'listbox' as const,
    'aria-expanded': context.open,

    title: text,
  };
  // No pStyle (the document default) shows the registry's placeholder — "Normal text",
  // via i18n, the way the chrome spec labels the unstyled state. A styleId shows its
  // document-declared display name, falling back to the id itself.
  const current = context.options.find((option) => option.styleId === context.value);
  const display =
    children ??
    (context.value === null ? (
      <span>{control?.valueKey ? label(control.valueKey) : '—'}</span>
    ) : (
      <span>{current?.name ?? context.value}</span>
    ));
  if (asChild) return <Slot {...shared}>{display}</Slot>;
  return (
    <button type="button" {...shared}>
      {display}
    </button>
  );
}
ParagraphStyleTrigger.docxToolbarPart = true as const;

function ParagraphStyleContent({ asChild, className, children }: ParagraphStylePartProps) {
  const label = useToolbarLabel();
  const context = useParagraphStyleContext();
  if (!context || !context.open) return null;
  const shared = {
    role: 'listbox' as const,
    tabIndex: 0,
    'aria-label': label('styles.selectAriaLabel'),
    // Anchoring, layering and colors all come from the core stylesheet — the popup
    // must sit in the overlay band, above ambient chrome like the navigation panel.
    className: `docx-toolbar__menu docx-toolbar__style-content${className ? ` ${className}` : ''}`,
  };
  const items =
    children ??
    context.options.map((option) => (
      <ParagraphStyleItem key={option.styleId} value={option.styleId} />
    ));
  if (asChild) return <Slot {...shared}>{items}</Slot>;
  return <div {...shared}>{items}</div>;
}

function ParagraphStyleItem({ value, asChild, className, children }: ParagraphStyleItemProps) {
  const editor = useDocxEditor();
  const context = useParagraphStyleContext();
  if (!context) return null;
  const selected = context.value === value;
  const option = context.options.find((entry) => entry.styleId === value);
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
    className: `docx-toolbar__style-item${className ? ` ${className}` : ''}`,
  };
  // The default label renders the style's NAME in the style's own face. Custom children
  // replace it wholesale.
  const display = children ?? (
    <span style={option ? previewStyle(option.preview) : undefined}>{option?.name ?? value}</span>
  );
  if (asChild) return <Slot {...shared}>{display}</Slot>;
  return (
    <button type="button" {...shared}>
      {display}
      {selected ? (
        <span className="docx-toolbar__menu-check" aria-hidden="true">
          ✓
        </span>
      ) : null}
    </button>
  );
}

/**
 * The compound paragraph-style picker. With no children it renders Trigger + Content
 * with an Item per document paragraph style; with children, compose
 * `ParagraphStyle.Trigger`, `ParagraphStyle.Content`, and `ParagraphStyle.Item`
 * yourself around the shared state.
 *
 * @public
 */
export function ParagraphStyleRoot({ hidden, asChild, className, children }: ParagraphStyleProps) {
  const state = useParagraphStyle();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  usePickerKeyboard(rootRef, open, () => setOpen(false));

  // Outside pointer presses close the popup, as in the FontFamily compound.
  useEffect(() => {
    if (!open) return undefined;
    return listenForOutsidePress({
      popup: rootRef.current,
      close: () => setOpen(false),
    });
  }, [open]);

  const context = useMemo<ParagraphStyleContextValue>(
    () => ({ ...state, open, setOpen }),
    [state, open]
  );

  if (hidden) return null;
  const shared = {
    // The positioning context for the absolute Content comes from the core stylesheet.
    className: `docx-toolbar__style${className ? ` ${className}` : ''}`,
    'data-slot': 'styles.style',
  };
  const body = children ?? (
    <>
      <ParagraphStyleTrigger />
      <ParagraphStyleContent />
    </>
  );
  return (
    <ParagraphStyleContext.Provider value={context}>
      {asChild ? (
        <Slot {...shared} ref={rootRef as never}>
          {body}
        </Slot>
      ) : (
        <div ref={rootRef} {...shared}>
          {body}
        </div>
      )}
    </ParagraphStyleContext.Provider>
  );
}

/** The compound part with its sub-parts attached as statics. @public */
export interface ParagraphStyleNamespace {
  (props: ParagraphStyleProps): ReactNode;
  readonly docxSlot: 'styles.style';
  readonly Trigger: typeof ParagraphStyleTrigger;
  readonly Content: typeof ParagraphStyleContent;
  readonly Item: typeof ParagraphStyleItem;
}

export const ParagraphStyle: ParagraphStyleNamespace = Object.assign(ParagraphStyleRoot, {
  docxSlot: 'styles.style' as const,
  Trigger: ParagraphStyleTrigger,
  Content: ParagraphStyleContent,
  Item: ParagraphStyleItem,
});
