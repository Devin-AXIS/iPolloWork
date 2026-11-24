// Context-fed ruler parts: `DocxEditor.HorizontalRuler` / `DocxEditor.VerticalRuler`.
//
// Thin wrappers over the props-driven `HorizontalRuler` / `VerticalRuler` components
// (which stay exported unchanged): the wrappers read the page setup and zoom REACTIVELY
// off the snapshot via `usePageSetup` and feed them in.
//
// Margin drags are LIVE but commit ONCE: while a drag is in flight the wrapper previews
// the pending margin locally (the gray zone follows the cursor), and only the release
// writes through the engine's `setPageSetup` command — one transaction, one undo entry,
// no relayout storm at mousemove frequency. Editability follows what the engine reports
// (`usePageSetup().isEnabled`), so against a read-only document the handles stay inert.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import type { RulerIndent } from '@docx-editor.dev/core/editor';
import { HorizontalRuler, type RulerPageSetup } from '../components/ui/HorizontalRuler';
import { VerticalRuler } from '../components/ui/VerticalRuler';
import { twipsToPixels } from '../lib/units';
import { useDocxEditor } from './context';
// A ruler MEASURES the page, and while the document is absent there is no page — the
// primitive fell back to drawing default Letter ticks over a document that was not
// there. Render nothing instead; a host that wants the bar to hold its height sizes the
// row it put the ruler in.
import { selectDocumentAbsent } from './document-presence';
import { useEditorState } from './useEditorState';
import { usePageSetup } from './usePageSetup';
import { useParagraphIndent } from './useParagraphIndent';
import { useNavigationShift, useNavigationViewportElement } from './navigation/navigation-layout';
// The gutter the review pane reserves. Read from the shared measurement rather than a
// local constant, because the ruler and the scroller must agree: two components deciding
// independently is how a ruler ends up an inch off the page it is measuring.
import {
  physicalReviewGutter,
  useReviewColumnSide,
  useReviewGutter,
  useViewportClientWidth,
} from './review-gutter';

const selectZoom = (snapshot: EditorSnapshot): number => snapshot.zoom;
const selectOpening = (snapshot: EditorSnapshot): boolean => snapshot.isOpening === true;

/** Props for the context-fed ruler parts. @public */
export interface DocxEditorRulerProps {
  /** Measurement unit for tick labels. Defaults to inches. */
  unit?: 'inch' | 'cm';
  className?: string;
  style?: CSSProperties;
}

type PendingMargins = Partial<Record<'top' | 'right' | 'bottom' | 'left', number>>;

/** The page setup with any in-flight drag preview folded in. */
function previewed(
  pageSetup: RulerPageSetup | null,
  pending: PendingMargins
): RulerPageSetup | null {
  if (!pageSetup || Object.keys(pending).length === 0) return pageSetup;
  return { ...pageSetup, marginsTwips: { ...pageSetup.marginsTwips, ...pending } };
}

function useMarginDrag(): {
  pending: PendingMargins;
  preview: (side: keyof PendingMargins) => (twips: number) => void;
  commit: () => void;
} {
  const { apply } = usePageSetup();
  const [pending, setPending] = useState<PendingMargins>({});
  // The ref mirrors the state so `commit` can read the latest drag value WITHOUT doing
  // work inside a setState updater — updaters must stay pure (StrictMode double-invokes
  // them, which would commit two undo entries per drag).
  const pendingRef = useRef<PendingMargins>({});
  const preview = useCallback(
    (side: keyof PendingMargins) => (twips: number) => {
      pendingRef.current = { ...pendingRef.current, [side]: Math.round(twips) };
      setPending(pendingRef.current);
    },
    []
  );
  const commit = useCallback(() => {
    const current = pendingRef.current;
    pendingRef.current = {};
    setPending({});
    if (Object.keys(current).length === 0) return;
    // A ruler drag is Word's "this section" gesture: dragging the margin of a landscape
    // section must not reshape the portrait sections around it.
    apply({
      ...(current.top !== undefined ? { marginTopTwips: current.top } : {}),
      ...(current.right !== undefined ? { marginRightTwips: current.right } : {}),
      ...(current.bottom !== undefined ? { marginBottomTwips: current.bottom } : {}),
      ...(current.left !== undefined ? { marginLeftTwips: current.left } : {}),
      scope: 'section',
    });
  }, [apply]);
  return { pending, preview, commit };
}

/** What the ruler needs to drive the four indent handles. */
interface IndentDrag {
  /** The paragraph's indent with any in-flight drag folded in; null hides the handles. */
  readonly indent: RulerIndent | null;
  readonly isEnabled: boolean;
  readonly preview: (next: RulerIndent) => void;
  readonly commit: () => void;
}

/** The selection as a comparable key, for noticing that it moved under a drag. */
function selectionKey(editor: ReturnType<typeof useDocxEditor>): string {
  const selection = editor?.snapshot().selection ?? null;
  return selection ? JSON.stringify(selection) : '';
}

/**
 * Indent drags: preview locally, commit ONCE on release, like the margin drags above.
 *
 * `snapshot().formatting` is reference-stable across ticks that did not change it (the
 * engine's own value-equality cache), so the nested `indent` is too and the default
 * comparator is enough — no fresh object reaches a subscriber on every keystroke.
 */
function useIndentDrag(): IndentDrag {
  const editor = useDocxEditor();
  // The READ and the WRITE both come from the public hook, so the ruler is exactly the
  // chrome a host could build itself — no privileged path.
  const { indent: stored, isEnabled, apply } = useParagraphIndent();
  const [pending, setPending] = useState<RulerIndent | null>(null);
  const pendingRef = useRef<RulerIndent | null>(null);
  // The selection the drag STARTED against.
  const anchorRef = useRef<string | null>(null);

  const preview = useCallback(
    (next: RulerIndent) => {
      if (anchorRef.current === null) anchorRef.current = selectionKey(editor);
      pendingRef.current = next;
      setPending(next);
    },
    [editor]
  );

  const commit = useCallback(() => {
    const next = pendingRef.current;
    const anchor = anchorRef.current;
    pendingRef.current = null;
    anchorRef.current = null;
    setPending(null);
    if (!next) return;
    // A drag describes the paragraphs that were selected when it began, and `setIndent`
    // carries no target — it writes wherever the selection is NOW. An agent write or a
    // layout catch-up between press and release would otherwise land the drag on somebody
    // else's paragraphs.
    if (anchor !== null && anchor !== selectionKey(editor)) return;
    apply({ left: next.left, right: next.right, firstLine: next.firstLine });
  }, [editor, apply]);

  const indent = useMemo(
    () =>
      pending ??
      (stored
        ? {
            left: stored.left,
            right: stored.right,
            firstLine: stored.firstLine,
            // A right-to-left paragraph's handles sit on the mirrored axis.
            ...(stored.rtl ? { rtl: true } : {}),
          }
        : null),
    [pending, stored]
  );

  return useMemo(
    () => ({ indent, isEnabled, preview, commit }),
    [indent, isEnabled, preview, commit]
  );
}

/** Horizontal viewport movement shared by the painted page and the ruler above it. */
function useViewportScrollLeft(): number {
  const viewport = useNavigationViewportElement();
  const [scrollLeft, setScrollLeft] = useState(0);

  useEffect(() => {
    if (!viewport) {
      setScrollLeft(0);
      return undefined;
    }
    const sync = () => setScrollLeft(viewport.scrollLeft);
    sync();
    viewport.addEventListener('scroll', sync, { passive: true });
    return () => viewport.removeEventListener('scroll', sync);
  }, [viewport]);

  return scrollLeft;
}

/**
 * The horizontal ruler as a context-fed part (`DocxEditor.HorizontalRuler`): page
 * width, margins and zoom straight from the editor. Left/right margin handles are
 * draggable when the engine supports page-setup writes; the drag previews locally and
 * commits one undoable step on release.
 *
 * Renders nothing while the editor holds no document — see
 * {@link selectDocumentAbsent}.
 *
 * @public
 */
export function DocxEditorHorizontalRuler(props: DocxEditorRulerProps): ReactElement | null {
  const documentAbsent = useEditorState(selectDocumentAbsent);
  const opening = useEditorState(selectOpening);
  const { pageSetup, isEnabled } = usePageSetup();
  const zoom = useEditorState(selectZoom);
  const { pending, preview, commit } = useMarginDrag();
  const indentDrag = useIndentDrag();
  // The ruler measures the page, so it has to move with the page — and BOTH panes move it.
  // The ruler sits ABOVE the scroll container, so it has to be told about each: the
  // navigation pane displaces the page from the left, the review pane reserves a gutter on
  // the right. Same values, same easing, so the ticks stay over the page they measure.
  const shift = useNavigationShift();
  const side = useReviewColumnSide();
  const rtl = side === 'left';
  const reserved = physicalReviewGutter(useReviewGutter(), side);
  const scrollLeft = useViewportScrollLeft();
  if (documentAbsent) return null;
  return (
    // The wrapper carries the pane geometry as PADDING so the ruler's own margins stay
    // `auto` (the primitive's clamp-safe centring — see `HorizontalRuler`): the navigation
    // pane displaces the page from the left, the review pane reserves a gutter on the
    // right, and padding an edge by S moves the centred ruler by S/2 — the same halves
    // the viewport's own padding moves the centred page by. The class carries the glide
    // (and its reduced-motion opt-out) so the ruler moves with the page rather than snaps.
    <div
      className={`docx-ruler-frame${opening ? ' docx-ruler-frame--opening' : ''}`}
      {...(rtl ? { 'data-chrome-dir': 'rtl' } : {})}
      style={{
        // PHYSICAL sides, like the scroll container they mirror: it adds the navigation
        // shift on the pane's side (the right in a right-to-left interface), and pads the
        // review column's side by the full reservation.
        paddingLeft: (rtl ? 0 : shift) + reserved.left,
        paddingRight: (rtl ? shift : 0) + reserved.right,
      }}
    >
      <HorizontalRuler
        pageSetup={previewed(pageSetup, pending)}
        zoom={zoom}
        editable={isEnabled}
        onLeftMarginChange={preview('left')}
        onRightMarginChange={preview('right')}
        onMarginDragEnd={commit}
        showIndentHandles={indentDrag.indent !== null}
        indent={indentDrag.indent}
        indentEditable={indentDrag.isEnabled}
        onIndentChange={indentDrag.preview}
        onIndentDragEnd={indentDrag.commit}
        unit={props.unit ?? 'inch'}
        className={props.className ?? ''}
        style={{
          ...props.style,
          // The ruler lives above the scroller, so mirror its horizontal movement explicitly.
          transform: `${props.style?.transform ? `${props.style.transform} ` : ''}translateX(${-scrollLeft}px)`,
          // Navigation is below this row and cannot physically cover the ruler. Clip the
          // scrolled portion at the same boundary so ticks never show above the pane: on
          // the right in a right-to-left interface, whose scroller counts below zero.
          clipPath:
            shift > 0 && scrollLeft !== 0
              ? scrollLeft > 0
                ? `inset(0 0 0 ${scrollLeft}px)`
                : `inset(0 ${-scrollLeft}px 0 0)`
              : props.style?.clipPath,
        }}
      />
    </div>
  );
}

/**
 * The vertical ruler as a context-fed part (`DocxEditor.VerticalRuler`): page height,
 * margins and zoom straight from the editor. Top/bottom margin handles are draggable
 * when the engine supports page-setup writes, committing one undoable step on release.
 *
 * Renders nothing while the editor holds no document — see
 * {@link selectDocumentAbsent} — and nothing while the page is wider than the
 * viewport: the ruler rides the scroller at content x=0, so a horizontal scroll
 * would carry it out of view, and pinning it instead would paint ticks over page
 * text. Word's web peers drop it on cramped viewports; so does this part, and it
 * returns as soon as the page fits again.
 *
 * @public
 */
export function DocxEditorVerticalRuler(props: DocxEditorRulerProps): ReactElement | null {
  const documentAbsent = useEditorState(selectDocumentAbsent);
  const { pageSetup, isEnabled } = usePageSetup();
  const zoom = useEditorState(selectZoom);
  const { pending, preview, commit } = useMarginDrag();
  // The same reservations the scroller pads by: what is left after them is the room the
  // page actually has, so ruler and page agree about "cramped" at every pane state.
  const shift = useNavigationShift();
  const reserved = useReviewGutter();
  const viewportWidth = useViewportClientWidth();
  if (documentAbsent) return null;
  // `> 0` guards unlaid-out environments (a hidden host, DOM test doubles), which report
  // a zero width that means "unmeasured", not "no room".
  if (viewportWidth !== null && viewportWidth > 0 && pageSetup) {
    const pageWidthPx = twipsToPixels(pageSetup.pageWidthTwips) * zoom;
    if (pageWidthPx > viewportWidth - shift - reserved.inlineStart - reserved.inlineEnd) {
      return null;
    }
  }
  return (
    <VerticalRuler
      pageSetup={previewed(pageSetup, pending)}
      zoom={zoom}
      editable={isEnabled}
      onTopMarginChange={preview('top')}
      onBottomMarginChange={preview('bottom')}
      onMarginDragEnd={commit}
      unit={props.unit ?? 'inch'}
      className={props.className ?? ''}
      style={props.style}
    />
  );
}
