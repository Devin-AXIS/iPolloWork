import type { DocxEditorChildren } from '../docx-editor-children';
import type { ReactNode } from 'react';
// `DocxEditor.HyperLink` — the link popover, on the toolbar's customization ladder.
//
// The arrangement is Google Docs': click a link and a small panel appears under it with the
// target and three actions (copy, edit, unlink); Ctrl/Cmd+K or the toolbar button opens the
// same panel in edit mode with display-text and URL fields.
//
// CUSTOMIZATION LADDER, the same five rungs `DocxEditorToolbar` establishes:
//
//   1. `className` / `data-*`      restyle the default parts with CSS
//   2. `icon`                      swap one part's glyph
//   3. `asChild`                   merge a part's wiring onto your own element. The packaged
//                                  `docx-hyperlink-popup__*` class stays OFF that element, so
//                                  your own styles apply as written; `className` on the part
//                                  still reaches it. The Root is the one exception: its class
//                                  carries the panel's position and stacking, not decoration,
//                                  so an `asChild` panel keeps being a positioned popup.
//   4. in-place part override      a `<HyperLink.Copy>` child replaces that slot;
//                                  `hidden` removes it; `preset={false}` drops the defaults
//   5. `useHyperlinkPopup()`       the raw hook, for a UI with nothing in common with this
//
// EVERY string is an i18n key and every colour a `--doc-*` token, so a consumer never has to
// fork the component to translate or theme it. Test ids are stable and unlocalized
// (`hyperlink-popup`, `-copy`, `-edit`, `-unlink`), because selecting on a `title` attribute
// breaks the moment the locale changes.

import {
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from '../i18n';
import { absolutePointInScroller } from './scroller-geometry.ts';
import {
  HyperlinkPopupContext,
  isFieldLink,
  useHyperlinkPopupView,
  type UseHyperlinkPopupResult,
} from './useHyperlinkPopup';
import { Slot } from './toolbar/Slot';
import { useDocxEditor } from './context';
import { hostDocumentOf, listenForOutsidePress } from '@docx-editor.dev/core/editor';

/** Keeps the caret: a mousedown that bubbles to the editor moves it. Inputs are exempt. */
function guardMousedown(event: React.MouseEvent): void {
  const tag = (event.target as HTMLElement | null)?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  event.preventDefault();
}

/**
 * Give the keyboard back to the document after the panel closes itself.
 *
 * The panel's URL field holds focus while it is open, and unmounting it leaves focus on the
 * page body, so the next keystroke went nowhere until the user clicked the page. Escape,
 * Cancel, Apply and Unlink all end with this call. An outside press does not: that press
 * already put focus where the user wanted it. `editor.focus()` restores the saved model
 * selection rather than moving it, so the caret and the selected words stay where they were.
 */
function useReturnFocus(): () => void {
  const editor = useDocxEditor();
  return useCallback(() => {
    editor?.focus();
  }, [editor]);
}

/** Shared props for every part. @public */
export interface HyperLinkPartProps {
  className?: string;
  /** Merge this part's wiring onto the single child element instead of the default one. */
  asChild?: boolean;
  /** Render nothing — inside the default arrangement this removes the part. */
  hidden?: boolean;
  children?: DocxEditorChildren;
}

/** Props for the action parts, which also take an icon. @public */
export interface HyperLinkActionProps extends HyperLinkPartProps {
  /** Icon override; falls back to `children`, then to the part's default glyph. */
  icon?: DocxEditorChildren;
}

/** Props for `DocxEditor.HyperLink`. @public */
export interface HyperLinkProps extends HyperLinkPartProps {
  /**
   * Render the packaged arrangement. `false` mounts only the popover shell and whatever
   * parts you pass as children — the rung for "I want the wiring, not the layout".
   */
  preset?: boolean;
}

// Inline SVG, like the toolbar's icons: this package ships no icon font.
const icon = (path: string): ReactNode => (
  <svg viewBox="0 -960 960 960" width={16} height={16} aria-hidden="true" focusable="false">
    <path d={path} fill="currentColor" />
  </svg>
);

const COPY_ICON =
  'M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Zm160-240v-480 480Z';
const EDIT_ICON =
  'M200-200h57l391-391-57-57-391 391v57Zm-80 80v-170l528-527q12-11 26.5-17t30.5-6q16 0 31 6t26 18l55 56q12 11 17.5 26t5.5 30q0 16-5.5 30.5T817-647L290-120H120Zm640-584-56-56 56 56Zm-141 85-28-29 57 57-29-28Z';
const UNLINK_ICON =
  'M770-302 656-416l57-57 114 114-57 57ZM603-469 469-603l57-57 134 134-57 57ZM280-280h133v80H280q-83 0-141.5-58.5T80-400q0-83 58.5-141.5T280-600h133v80H280q-50 0-85 35t-35 85q0 50 35 85t85 35Zm40-80v-80h101l80 80H320Zm493-15-57-57q23-11 33.5-32t10.5-36q0-50-35-85t-85-35H547v-80h133q83 0 141.5 58.5T880-400q0 32-11 61.5T813-375ZM792-56 56-792l56-56 736 736-56 56Z';
const OPEN_ICON =
  'M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h280v80H200v560h560v-280h80v280q0 33-23.5 56.5T760-120H200Zm188-212-56-56 372-372H560v-80h280v280h-80v-144L388-332Z';

/**
 * The popover panel.
 *
 * Positioned inside the VIEWPORT (the scroll container), so ordinary CSS keeps it attached to
 * the page while the user scrolls — no scroll listener, no per-frame reposition. The
 * coordinates the engine reports are viewport-relative, so they are converted against the
 * container's own rect once, at open.
 */
function HyperLinkRoot({ className, asChild, hidden, children, preset = true }: HyperLinkProps) {
  // The state is PROVIDED by `DocxEditor.Root`, not created here. The toolbar's link button
  // is a sibling of this panel, not an ancestor of it, so a state owned by the panel would
  // leave the button opening a popover nothing renders — and, worse, the button's own
  // instance would win the engine's chrome registration.
  const popup = useHyperlinkPopup();
  // The panel is what shows the shared state, so link gestures reach it while it is mounted.
  useHyperlinkPopupView();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { state, close } = popup;
  const returnFocus = useReturnFocus();

  // Escape and an outside press both dismiss. Bound only while open, so a closed
  // popover costs nothing and cannot swallow a key the editor wants.
  useEffect(() => {
    if (state.mode === 'closed') return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close();
      returnFocus();
    };
    const doc = hostDocumentOf(panelRef.current);
    doc.addEventListener('keydown', onKeyDown);
    // Membership reads the ref at press time, like the panel's other handlers.
    const stopPress = listenForOutsidePress({
      popup: doc,
      contains: (node) => panelRef.current?.contains(node) === true,
      close,
    });
    return () => {
      doc.removeEventListener('keydown', onKeyDown);
      stopPress();
    };
  }, [state.mode, close, returnFocus]);

  // The engine reports VIEWPORT coordinates; the panel is an absolutely positioned child of
  // the scroll container. Converting once at open — client rect plus the container's current
  // scroll — is what makes ordinary CSS keep the panel attached to the page as it scrolls.
  // Left in viewport coordinates with `position: fixed` it stayed pinned to the browser
  // window while the link moved out from under it.
  const [placement, setPlacement] = useState<CSSProperties | null>(null);
  useLayoutEffect(() => {
    const anchor = state.anchor;
    const panel = panelRef.current;
    if (!anchor || !panel) {
      setPlacement(null);
      return;
    }
    const container = panel.offsetParent as HTMLElement | null;
    if (!container) {
      setPlacement(null);
      return;
    }
    // Same padding-edge correction as scoped story chrome: the popover is absolute inside
    // the scroller, and `scrollbar-gutter: stable both-edges` inflates `clientLeft`.
    const { left, top } = absolutePointInScroller(container, anchor.left, anchor.top);
    // Clamped horizontally so a link near the right edge does not push the panel off it.
    const maxLeft = Math.max(0, container.scrollWidth - panel.offsetWidth);
    setPlacement({ left: Math.max(0, Math.min(left, maxLeft)), top });
  }, [state.anchor]);

  const { t } = useTranslation();
  const title =
    state.mode === 'editing'
      ? t(state.link ? 'hyperlinkPopup.editTitle' : 'hyperlinkPopup.insertTitle')
      : t('hyperlinkPopup.editLink');

  const body = preset ? <HyperLinkPreset>{children}</HyperLinkPreset> : children;

  // `hidden` drops the packaged PANEL only. The engine's gestures stay wired (the Root owns
  // that), so a host that hides this to render its own UI keeps Ctrl/Cmd+K and link clicks.
  // Children still honour the open/closed state — returning them unconditionally rendered a
  // bare `<HyperLink.Edit/>` permanently, since the parts have no mode check of their own.
  if (hidden) return state.mode === 'closed' ? null : <>{children}</>;

  const shared = {
    ref: panelRef,
    className: `docx-hyperlink-popup${className ? ` ${className}` : ''}`,
    'data-testid': 'hyperlink-popup',
    'data-mode': state.mode,
    role: 'dialog' as const,
    'aria-modal': false,
    onMouseDown: guardMousedown,
    // `position: absolute` comes from the stylesheet; only the offsets are inline, and only
    // once the layout effect has converted them. Until then the panel is placed by flow,
    // which is a frame of imprecision rather than a frame in the wrong place.
    style: placement ?? undefined,
    // Named for assistive tech: an unnamed dialog announces as "dialog" and nothing else.
    'aria-label': title,
  };

  if (state.mode === 'closed') return null;
  return asChild ? <Slot {...shared}>{children}</Slot> : <div {...shared}>{body}</div>;
}

/**
 * The packaged arrangement, with in-place part override.
 *
 * A part passed as a child REPLACES the preset's copy of that part rather than appending to
 * it — the toolbar's rule, so `<HyperLink.Unlink hidden />` removes the unlink action from
 * the default panel instead of adding a second hidden one beside it.
 */
function HyperLinkPreset({ children }: { children?: DocxEditorChildren }) {
  const { state } = useHyperlinkPopup();
  const overrides = useMemo(() => partOverrides(children), [children]);
  const take = (key: string, fallback: ReactNode): ReactNode =>
    key in overrides ? overrides[key] : fallback;

  if (state.mode === 'editing') {
    return (
      <>
        {take('Fields', <HyperLinkFields />)}
        {take('Error', <HyperLinkError />)}
        <div className="docx-hyperlink-popup__actions">
          {take('Apply', <HyperLinkApply />)}
          {take('Cancel', <HyperLinkCancel />)}
        </div>
        {overrides.__extra}
      </>
    );
  }
  // Editing actions are absent, not disabled, when they could never do anything: a control
  // that can never work is chrome pretending to be a capability. A read-only document trims
  // both; so does a FIELD link, whose id the typed lane (edit / unlink) can never resolve.
  const editable = state.canEdit && !(state.link && isFieldLink(state.link));
  return (
    <>
      {take('Url', <HyperLinkUrl />)}
      <div className="docx-hyperlink-popup__actions">
        {take('Copy', <HyperLinkCopy />)}
        {editable ? take('Edit', <HyperLinkEdit />) : null}
        {editable ? take('Unlink', <HyperLinkUnlink />) : null}
      </div>
      {overrides.__extra}
    </>
  );
}

/** Map a child's part marker to itself, so the preset can swap it in place. */
function partOverrides(children: ReactNode): Record<string, ReactNode> {
  const found: Record<string, ReactNode> = {};
  const extra: ReactNode[] = [];
  const visit = (node: ReactNode): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== 'object' || !('type' in node)) {
      if (node) extra.push(node);
      return;
    }
    // A FRAGMENT is grouping, not content. Passing two overrides as `<><Copy/><Unlink/></>`
    // is the natural way to write them, and treating the fragment as an unrecognised child
    // put both INSIDE the panel while the preset still rendered its own copies of each —
    // two copy buttons, and a `hidden` that removed nothing.
    if (node.type === Fragment) {
      visit((node.props as { children?: DocxEditorChildren }).children);
      return;
    }
    const marker = (node.type as { docxHyperLinkPart?: string }).docxHyperLinkPart;
    if (marker) found[marker] = node;
    else extra.push(node);
  };
  visit(children);
  if (extra.length > 0) found.__extra = extra;
  return found;
}

/**
 * The popover state the parts read.
 *
 * Parts always render inside `HyperLinkRoot`, which provides it. The inert stand-in is for
 * a part rendered outside the compound by mistake: it should show nothing, not throw in the
 * middle of someone's render.
 */
function useHyperlinkPopup(): UseHyperlinkPopupResult {
  return useContext(HyperlinkPopupContext) ?? INERT_POPUP;
}

const INERT_POPUP: UseHyperlinkPopupResult = {
  state: {
    mode: 'closed',
    link: null,
    anchor: null,
    text: '',
    url: '',
    copied: false,
    error: false,
    canEdit: false,
  },
  open: () => {},
  openAtCaret: () => {},
  close: () => {},
  copy: async () => false,
  beginEdit: () => {},
  setText: () => {},
  setUrl: () => {},
  commitEdit: () => false,
  unlink: () => false,
  openTarget: () => false,
};

/** The target readout, and the action that follows it. @public */
function HyperLinkUrl({ className, asChild, hidden, children }: HyperLinkPartProps) {
  const { state, openTarget } = useHyperlinkPopup();
  const { t } = useTranslation();
  if (hidden || !state.link) return null;
  const inert = !state.link.href;
  const internal = state.link.kind === 'internal';
  const text = internal ? `#${state.link.anchor ?? ''}` : state.link.authored;
  // An address reads left to right in any interface; a bookmark name keeps its own direction.
  const target = <bdi dir={internal ? undefined : 'ltr'}>{text}</bdi>;
  const hint = inert
    ? t('hyperlinkPopup.inertTarget')
    : internal
      ? t('hyperlinkPopup.bookmarkTarget')
      : t('hyperlinkPopup.openLink');
  const shared = {
    className: `docx-hyperlink-popup__url${className ? ` ${className}` : ''}`,
    'data-testid': 'hyperlink-popup-url',
    ...(inert ? { 'data-inert': '' } : {}),
    title: hint,
    onMouseDown: guardMousedown,
    // An inert link is not a button: there is nothing behind it to press.
    ...(inert ? {} : { onClick: () => openTarget(), type: 'button' as const }),
  };
  if (asChild)
    return (
      <Slot {...shared} className={className}>
        {children}
      </Slot>
    );
  if (inert) {
    return (
      <span {...shared}>
        {children ?? target}
        <span className="docx-editor-sr-only">{hint}</span>
      </span>
    );
  }
  return (
    <button {...shared}>
      {children ?? target}
      {icon(OPEN_ICON)}
    </button>
  );
}
HyperLinkUrl.docxHyperLinkPart = 'Url' as const;

/** Copy the sanitized target to the clipboard. @public */
function HyperLinkCopy({
  className,
  asChild,
  hidden,
  children,
  icon: glyph,
}: HyperLinkActionProps) {
  const { state, copy } = useHyperlinkPopup();
  const { t } = useTranslation();
  if (hidden || !state.link?.href) return null;
  const label = state.copied ? t('editor.linkCopied') : t('hyperlinkPopup.copyLink');
  const shared = {
    type: 'button' as const,
    className: `docx-hyperlink-popup__action${className ? ` ${className}` : ''}`,
    'data-testid': 'hyperlink-popup-copy',
    ...(state.copied ? { 'data-copied': '' } : {}),
    'aria-label': label,
    title: label,
    onMouseDown: guardMousedown,
    onClick: () => void copy(),
  };
  if (asChild)
    return (
      <Slot {...shared} className={className}>
        {children}
      </Slot>
    );
  return <button {...shared}>{glyph ?? children ?? icon(COPY_ICON)}</button>;
}
HyperLinkCopy.docxHyperLinkPart = 'Copy' as const;

/** Switch the panel into edit mode. @public */
function HyperLinkEdit({
  className,
  asChild,
  hidden,
  children,
  icon: glyph,
}: HyperLinkActionProps) {
  const { beginEdit } = useHyperlinkPopup();
  const { t } = useTranslation();
  if (hidden) return null;
  const label = t('hyperlinkPopup.editLink');
  const shared = {
    type: 'button' as const,
    className: `docx-hyperlink-popup__action${className ? ` ${className}` : ''}`,
    'data-testid': 'hyperlink-popup-edit',
    'aria-label': label,
    title: label,
    onMouseDown: guardMousedown,
    onClick: () => beginEdit(),
  };
  if (asChild)
    return (
      <Slot {...shared} className={className}>
        {children}
      </Slot>
    );
  return <button {...shared}>{glyph ?? children ?? icon(EDIT_ICON)}</button>;
}
HyperLinkEdit.docxHyperLinkPart = 'Edit' as const;

/** Remove the link, keeping its text. @public */
function HyperLinkUnlink({
  className,
  asChild,
  hidden,
  children,
  icon: glyph,
}: HyperLinkActionProps) {
  const { unlink } = useHyperlinkPopup();
  const returnFocus = useReturnFocus();
  const { t } = useTranslation();
  if (hidden) return null;
  const label = t('hyperlinkPopup.removeLink');
  const shared = {
    type: 'button' as const,
    className: `docx-hyperlink-popup__action${className ? ` ${className}` : ''}`,
    'data-testid': 'hyperlink-popup-unlink',
    'aria-label': label,
    title: label,
    onMouseDown: guardMousedown,
    onClick: () => {
      if (unlink()) returnFocus();
    },
  };
  if (asChild)
    return (
      <Slot {...shared} className={className}>
        {children}
      </Slot>
    );
  return <button {...shared}>{glyph ?? children ?? icon(UNLINK_ICON)}</button>;
}
HyperLinkUnlink.docxHyperLinkPart = 'Unlink' as const;

/** Display-text and URL fields. @public */
function HyperLinkFields({ className, hidden }: HyperLinkPartProps) {
  const { state, setText, setUrl, commitEdit, close } = useHyperlinkPopup();
  const returnFocus = useReturnFocus();
  const { t } = useTranslation();
  const urlRef = useRef<HTMLInputElement | null>(null);
  const textId = useId();
  const urlId = useId();

  // Focus the URL field on open: it is the one field that always needs a value, and Word's
  // dialog does the same. Guarded to edit mode so a re-render in reading mode cannot steal
  // focus back from the document.
  useEffect(() => {
    if (state.mode !== 'editing') return;
    // `preventScroll`: focusing an input scrolls its scroll container to reach it, and this
    // input lives INSIDE the document's scroller. Whenever the panel had not been placed yet
    // — or was placed near the edge — that scroll threw the reader to the top of the
    // document, which is the opposite of what pressing Ctrl/Cmd+K asked for. The panel is
    // already positioned at the caret; nothing needs the browser to go find it.
    urlRef.current?.focus({ preventScroll: true });
    urlRef.current?.select();
  }, [state.mode]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        // A refused draft keeps the panel open, and focus with it, so the value can be fixed.
        if (commitEdit()) returnFocus();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        returnFocus();
      }
    },
    [commitEdit, close, returnFocus]
  );

  if (hidden) return null;
  return (
    <div className={`docx-hyperlink-popup__fields${className ? ` ${className}` : ''}`}>
      <label className="docx-editor-sr-only" htmlFor={textId}>
        {t('hyperlinkPopup.displayTextPlaceholder')}
      </label>
      <input
        id={textId}
        data-testid="hyperlink-popup-text"
        className="docx-hyperlink-popup__input"
        value={state.text}
        dir={state.text ? 'auto' : undefined}
        placeholder={t('hyperlinkPopup.displayTextPlaceholder')}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <label className="docx-editor-sr-only" htmlFor={urlId}>
        {t('hyperlinkPopup.urlLabel')}
      </label>
      <input
        id={urlId}
        ref={urlRef}
        data-testid="hyperlink-popup-url-input"
        className="docx-hyperlink-popup__input"
        value={state.url}
        // An address reads left to right in any interface, as in a browser's address bar.
        dir="ltr"
        placeholder={t('hyperlinkPopup.urlPlaceholder')}
        onChange={(event) => setUrl(event.target.value)}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
HyperLinkFields.docxHyperLinkPart = 'Fields' as const;

/** Commit the draft. @public */
function HyperLinkApply({ className, asChild, hidden, children }: HyperLinkPartProps) {
  const { state, commitEdit } = useHyperlinkPopup();
  const returnFocus = useReturnFocus();
  const { t } = useTranslation();
  if (hidden) return null;
  const label = t('hyperlinkPopup.apply');
  const shared = {
    type: 'button' as const,
    className: `docx-hyperlink-popup__apply${className ? ` ${className}` : ''}`,
    'data-testid': 'hyperlink-popup-apply',
    disabled: state.url.trim().length === 0,
    onMouseDown: guardMousedown,
    onClick: () => {
      if (commitEdit()) returnFocus();
    },
  };
  if (asChild)
    return (
      <Slot {...shared} className={className}>
        {children}
      </Slot>
    );
  return <button {...shared}>{children ?? label}</button>;
}

/**
 * Why the last Apply did nothing.
 *
 * A refusal that closes nothing and says nothing is the worst of both: the panel sits open
 * and the user re-presses the same button. The engine already knows the reason (a scheme it
 * will not write, a selection spanning paragraphs, no text to link); this shows it.
 */
function HyperLinkError({ className, hidden }: HyperLinkPartProps) {
  const { state } = useHyperlinkPopup();
  const { t } = useTranslation();
  if (hidden || !state.error) return null;
  return (
    <div
      className={`docx-hyperlink-popup__error${className ? ` ${className}` : ''}`}
      data-testid="hyperlink-popup-error"
      role="alert"
    >
      {t('hyperlinkPopup.refused')}
    </div>
  );
}
HyperLinkError.docxHyperLinkPart = 'Error' as const;
HyperLinkApply.docxHyperLinkPart = 'Apply' as const;

/** Dismiss without applying. @public */
function HyperLinkCancel({ className, asChild, hidden, children }: HyperLinkPartProps) {
  const { close } = useHyperlinkPopup();
  const returnFocus = useReturnFocus();
  const { t } = useTranslation();
  if (hidden) return null;
  const label = t('hyperlinkPopup.cancel');
  const shared = {
    type: 'button' as const,
    className: `docx-hyperlink-popup__cancel${className ? ` ${className}` : ''}`,
    'data-testid': 'hyperlink-popup-cancel',
    onMouseDown: guardMousedown,
    onClick: () => {
      close();
      returnFocus();
    },
  };
  if (asChild)
    return (
      <Slot {...shared} className={className}>
        {children}
      </Slot>
    );
  return <button {...shared}>{children ?? label}</button>;
}
HyperLinkCancel.docxHyperLinkPart = 'Cancel' as const;

/**
 * The link popover compound.
 *
 * @public
 */
export interface DocxEditorHyperLinkNamespace {
  (props: HyperLinkProps): ReturnType<typeof HyperLinkRoot>;
  readonly Url: typeof HyperLinkUrl;
  readonly Copy: typeof HyperLinkCopy;
  readonly Edit: typeof HyperLinkEdit;
  readonly Unlink: typeof HyperLinkUnlink;
  readonly Fields: typeof HyperLinkFields;
  readonly Error: typeof HyperLinkError;
  readonly Apply: typeof HyperLinkApply;
  readonly Cancel: typeof HyperLinkCancel;
}

export const DocxEditorHyperLink: DocxEditorHyperLinkNamespace = Object.assign(HyperLinkRoot, {
  Url: HyperLinkUrl,
  Copy: HyperLinkCopy,
  Edit: HyperLinkEdit,
  Unlink: HyperLinkUnlink,
  Fields: HyperLinkFields,
  Error: HyperLinkError,
  Apply: HyperLinkApply,
  Cancel: HyperLinkCancel,
});
