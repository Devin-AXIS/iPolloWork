import type { DocxEditorChildren } from '../docx-editor-children';
import type { ReactNode } from 'react';
// The loading surface: what the host shows while there is no document to paint yet.
//
// Derives its answer from the SAME snapshot every other consumer reads, through
// `useEditorState`, so the loading screen and the chrome can never disagree about
// whether a document is ready. Renders nothing once loading ends — it is a conditional
// wrapper, not a container that stays in the tree.
//
// THE CONDITION IS `isLoading || isOpening`. `isLoading` is "no document handed over
// yet, and nothing went wrong" — NOT "nothing painted". That distinction is what makes
// `isLoading` safe to gate a `DocxEditor.Content` on: a definition keyed on painted pages
// would deadlock, since nothing paints until Content mounts and Content would never
// mount while the screen is up. It also means a host that unmounts its viewport does not
// get the loading screen back over a document that is still loaded.
//
// `isOpening` is the second half: a LARGE document mounts behind one painted frame (the
// engine yields so this very screen can paint before the blocking parse+layout), and
// `isOpening` holds for exactly that window. It is OVERLAY state — this part shows for
// it, but a host hand-gating its own mount point must key that on `isLoading` alone,
// because the scheduled mount needs the mount point to stay in the tree.
//
// `when` ORs in what the editor cannot see: the host's own async, the fetch of the DOCX
// bytes and of font faces. It is optional — the default already covers a `Root` mounted
// while its document is still on the way, which is the common shape.
//
// SELF-SUFFICIENT STYLING. The `--doc-*` tokens are defined on `.docx-editor`, and `Root`
// renders no DOM — so a part placed as a sibling of the Viewport would sit outside any
// token scope and paint an unresolved, contrast-free ring. This emits `docx-editor` itself,
// exactly as `DocxEditorViewport` does, so it looks right wherever it is composed.

import {
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { useDocxEditor } from './context';
import { useTranslation } from '../i18n';
import { isDevelopment } from '../lib/is-development';
import { twipsToPixels } from '../lib/units';
import { useEditorState } from './useEditorState';
import { useChromeDark } from './color-mode-context';

/**
 * A scalar slice on purpose: `useEditorState` bails out on `Object.is`, so this part
 * re-renders only when the answer actually flips — not on every keystroke that bumps the
 * snapshot. `isOpening` is optional and additive in the contract; absent reads `false`.
 */
const selectShowLoading = (snapshot: EditorSnapshot) =>
  snapshot.isLoading || snapshot.isOpening === true;

interface LoadingPageSize {
  readonly width: number;
  readonly height: number;
}

const selectLoadingPageSize = (snapshot: EditorSnapshot): LoadingPageSize => ({
  width: twipsToPixels(snapshot.pageSetup?.pageWidthTwips ?? 12_240) * snapshot.zoom,
  height: twipsToPixels(snapshot.pageSetup?.pageHeightTwips ?? 15_840) * snapshot.zoom,
});

const sameLoadingPageSize = (a: LoadingPageSize, b: LoadingPageSize) =>
  a.width === b.width && a.height === b.height;

/** Props for `DocxEditor.Loading`. @public */
export interface DocxEditorLoadingProps {
  /**
   * An extra host-owned condition, OR-ed with the editor's own. OPTIONAL: the default
   * already holds the screen up while the editor has nothing painted, including a
   * `DocxEditor.Root` mounted before its document arrives. Pass this for state the
   * editor cannot see — bytes still downloading, fonts not settled — when you mount the
   * provider only after those resolve.
   */
  when?: boolean;
  /**
   * Render as an opaque overlay pinned over the nearest positioned ancestor, covering
   * the previous document while the next one opens. This is the shape for the big-file
   * case: a large document mounts behind one painted frame, and the overlay is what
   * that frame shows. It carries a short appearance delay, so an open that finishes
   * quickly never flashes it. Compose it INSIDE a positioned box (the packaged frame
   * puts it in the workspace row); without `overlay` the part is an in-flow box that
   * fills whatever the host gives it.
   */
  overlay?: boolean;
  /** Appended after the load-bearing `docx-editor docx-editor__loading` classes. */
  className?: string;
  /** Inline styles for the loading container, as on `DocxEditor.Viewport`. */
  style?: CSSProperties;
  /**
   * Your own loading indicator, in place of the packaged spinner. The packaged screen keeps
   * its page and centers this on it. With `overlay`, it then moves below the laid-out pages
   * while a large document lays out its remaining pages, and scrolls with them.
   *
   * Include text for screen readers, as the packaged indicator does.
   *
   * ```tsx
   * <DocxEditor.Loading overlay indicator={<MyLogoSpinner label="Opening document" />} />
   * ```
   */
  indicator?: DocxEditorChildren;
  /**
   * The whole first loading screen, in place of the packaged page. Compose your own around
   * `DocxEditor.Loading.Spinner` to keep the packaged indicator beside your own copy. To
   * change only the indicator, and keep it below the laid-out pages as the document opens,
   * use `indicator`.
   */
  children?: DocxEditorChildren;
}

/** Props for `DocxEditor.Loading.Spinner`. @public */
export interface DocxEditorLoadingSpinnerProps {
  /** Appended after the load-bearing `docx-editor__loading-spinner` class. */
  className?: string;
}

/**
 * The packaged spinner, on its own. Exposed because `children` replaces the default
 * screen wholesale — a host that wants "spinner plus my own label" would otherwise have
 * to hand-copy an internal class name.
 *
 * Decorative: it carries `aria-hidden`, so the surrounding live region needs its own
 * text. `DocxEditor.Loading` supplies a translated one when you pass no children.
 *
 * @public
 */
export function DocxEditorLoadingSpinner({ className }: DocxEditorLoadingSpinnerProps) {
  return (
    <span
      className={`docx-editor__loading-spinner${className ? ` ${className}` : ''}`}
      aria-hidden="true"
    />
  );
}

let warnedWithoutChrome = false;

/** Warn once that `loadingIndicator` does nothing under `chrome={false}`, in development. */
export function warnLoadingIndicatorWithoutChrome(): void {
  if (warnedWithoutChrome || !isDevelopment()) return;
  warnedWithoutChrome = true;
  console.warn(
    '[docx-editor] loadingIndicator is ignored with chrome={false}, which renders no loading ' +
      'screen. Compose <DocxEditor.Loading overlay indicator={...} /> in a positioned box instead.'
  );
}

/**
 * The element below the laid-out pages that holds the indicator while a large document lays
 * out its remaining pages, or null. Only the overlay registers: the packaged frame has one.
 */
function useOpeningIndicator(enabled: boolean): HTMLElement | null {
  const editor = useDocxEditor();
  const [element, setElement] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!editor || !enabled) return undefined;
    editor.setOpeningIndicatorHost({ publish: setElement });
    return () => {
      editor.setOpeningIndicatorHost(null);
      setElement(null);
    };
  }, [editor, enabled]);
  return element;
}

function DocxEditorLoadingImpl({
  when = false,
  overlay = false,
  className,
  style,
  indicator,
  children,
}: DocxEditorLoadingProps) {
  const showLoading = useEditorState(selectShowLoading);
  const pageSize = useEditorState(selectLoadingPageSize, sameLoadingPageSize);
  const below = useOpeningIndicator(overlay);
  const editor = useDocxEditor();
  // What the last committed render showed, and for which editor.
  const shown = useRef<{ visible: boolean; editor: object | null }>({
    visible: false,
    editor: null,
  });
  const [, recheck] = useReducer((count: number) => count + 1, 0);
  // `Root` replaces the editor when new bytes arrive and attaches it one commit later, so
  // for that commit neither flag holds. The screen stays through it: a new element would
  // replay the overlay's appearance delay, and restart the spinner and any host indicator.
  const bridging = shown.current.visible && shown.current.editor !== editor;
  const visible = below === null && (when || showLoading || bridging);
  useLayoutEffect(() => {
    shown.current = { visible, editor };
    // Read the flags again after this commit's attach, before paint: the hold never
    // outlasts the commit, so an editor that is never attached cannot keep it up.
    if (bridging) recheck();
  }, [visible, editor, bridging]);
  const { t } = useTranslation();
  const chromeDark = useChromeDark();
  const status = indicator ?? (
    <>
      <DocxEditorLoadingSpinner />
      <span className="docx-editor-sr-only">{t('loading.label')}</span>
    </>
  );
  // The first pages show and take input, so the opening state is over; the indicator moves
  // below the laid-out pages until the last one is laid out.
  if (below) return createPortal(status, below);
  if (!visible) return null;

  const classes = `docx-editor${chromeDark ? ' dark' : ''} docx-editor__loading${
    overlay ? ' docx-editor__loading--overlay' : ''
  }${className ? ` ${className}` : ''}`;
  return (
    <div className={classes} style={style} role="status" aria-live="polite">
      {children ?? (
        <div
          className="docx-paginated-surface docx-editor__loading-surface"
          style={{ width: pageSize.width, height: pageSize.height }}
        >
          <div className="docx-pages">
            <div className="docx-page docx-editor__loading-page">
              <div className="docx-editor__loading-page-status">{status}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The loading part with the packaged spinner attached as a static.
 *
 * @public
 */
export interface DocxEditorLoadingComponent {
  /** Renders the loading screen, or nothing once a document is available. */
  (props: DocxEditorLoadingProps): ReactNode;
  /** The packaged indicator, for composing into custom children. */
  readonly Spinner: typeof DocxEditorLoadingSpinner;
}

/**
 * Renders its children while the editor is still waiting for a document, and nothing
 * once one is available. No condition to wire up in the common case:
 *
 * ```tsx
 * <DocxEditor.Root document={bytes}>
 *   <DocxEditor.Loading>
 *     <MySpinner />
 *   </DocxEditor.Loading>
 *   <DocxEditor.Viewport>
 *     <DocxEditor.Content />
 *   </DocxEditor.Viewport>
 * </DocxEditor.Root>
 * ```
 *
 * It covers TWO windows. Before bytes arrive it is the empty-state screen. And while a
 * LARGE document opens — the engine mounts it behind one painted frame precisely so this
 * screen can paint before the blocking parse and layout — it holds until the pages land;
 * pass `overlay` to pin it over the previous document for that window. With `overlay`, once
 * the first pages show, the indicator moves below the laid-out pages until the rest are laid out.
 * Pass `indicator` to replace only the spinner, in both places:
 *
 * ```tsx
 * <DocxEditor.Loading overlay indicator={<MyLogoSpinner label="Opening document" />} />
 * ``` A parse failure
 * clears both, so a broken document never spins forever; report that from
 * `snapshot().parseError` or the `error` event. Add `when` only for async the editor
 * cannot observe, typically a host that mounts the provider after its own fetch.
 *
 * A host gating its own `DocxEditor.Content` must key that on `snapshot().isLoading`,
 * which clears as soon as bytes are handed over — never on `isOpening`, whose scheduled
 * mount needs the mount point to stay in the tree.
 *
 * Rendered OUTSIDE a `DocxEditor.Root` it always shows, because there is no editor to
 * report otherwise — the same rule `useEditorState` documents for a null editor. Place
 * it inside the provider unless a permanently-visible placeholder is what you want.
 *
 * Carries its own `docx-editor`, so the theme tokens resolve wherever it is composed.
 *
 * @public
 */
export const DocxEditorLoading: DocxEditorLoadingComponent = Object.assign(DocxEditorLoadingImpl, {
  Spinner: DocxEditorLoadingSpinner,
});
