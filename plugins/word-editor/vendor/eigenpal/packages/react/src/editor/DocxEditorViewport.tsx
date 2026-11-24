import { useTranslation } from '../i18n';
import type { DocxEditorChildren } from '../docx-editor-children';
// The scroll container around the painted pages.
//
// The class list is LOAD-BEARING, not styling sugar:
// - `docx-editor` scopes every --doc-* token and the library's Tailwind layer;
// - `docx-editor-one-surface docx-editor-one-surface__viewport` carry the one-surface chrome geometry;
// - `docx-editor__scroll-container` is how the engine finds its scroller — the
//   paginated pages locate the nearest ancestor with that class for scroll
//   rematerialization and page-visibility work. Without it the engine falls back to
//   document scrolling and virtualization degrades.

import { useCallback, useContext, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { ReviewRailContext, claimsReviewGutter, useDocxEditor } from './context';
import { useEditorState } from './useEditorState';
import { useNavigationLayoutStore, useNavigationShift } from './navigation/navigation-layout';
import { REVIEW_MARKERS_GUTTER, useReviewColumnSide, useReviewGutter } from './review-gutter';
import { zoomLevelForShortcut } from './zoom-levels';
import { ScopedByAncestorContext } from './scope-context';
import { useChromeScopeClassName } from './color-mode-context';
import { InsideViewportContext } from './viewport-context';
import { isElementNode } from '@docx-editor.dev/core/editor';

const selectPaneOpen = (snapshot: EditorSnapshot): boolean => snapshot.reviewPaneOpen ?? true;
/** Fit modes must not animate nav padding: intermediate widths chase the page forever. */
const selectZoomFitting = (snapshot: EditorSnapshot): boolean => snapshot.zoomMode?.type === 'fit';

/** Props for `DocxEditor.Viewport`. @public */
export interface DocxEditorViewportProps {
  /** Appended after the load-bearing viewport classes (e.g. `dark` for chrome theming). */
  className?: string;
  style?: CSSProperties;
  children?: DocxEditorChildren;
}

/**
 * The sole scroll container for the painted document. Put `DocxEditor.Content` inside
 * it; the engine discovers this element by class and manages scrolling against it.
 *
 * @public
 */
export function DocxEditorViewport({ className, style, children }: DocxEditorViewportProps) {
  const { t } = useTranslation();
  const scopeClassName = useChromeScopeClassName();
  const editor = useDocxEditor();
  // The open pane is given its own gutter rather than allowed to overlap: the page centres
  // inside the padding box, so reserving the rail's width shifts the sheet left by half of
  // it and the two read as one centred pair. Purely presentational — no layout input
  // changes, so the document does not re-paginate when the pane opens.
  // The SNAPSHOT, not the review hook: reading the pane state through `useReview` ran the
  // whole placement derivation — anchors and all — inside the parent of the painted document,
  // on every selection change, to learn one boolean.
  const paneOpen = useEditorState(selectPaneOpen);
  // How wide that gutter may actually be. A fixed reservation shoved the sheet against the
  // viewport's left edge on narrow hosts, with a mostly-empty band standing where the page
  // should be; the measured pair keeps the full column only while the viewport affords it
  // and mirrors the marker strip onto both edges otherwise, so the sheet stays centred.
  // The stylesheet consumes it through `--docx-review-gutter`/`--docx-review-gutter-start`.
  const reviewGutter = useReviewGutter();
  // A right-to-left interface puts the column on the page's left and the navigation pane on
  // its right. The custom properties stay logical (start, end); the stylesheet maps them to
  // physical edges under `data-chrome-dir`, which also turns this scroller right to left.
  const side = useReviewColumnSide();
  const fitting = useEditorState(selectZoomFitting);
  const rail = useContext(ReviewRailContext);
  const reserve = claimsReviewGutter(rail);
  // The navigation pane needs this element's width to decide whether it has to move the
  // page at all, and publishes the answer back as `--docx-nav-shift`. Both directions are
  // no-ops when no pane is mounted: the store stays at 0 and the custom property falls
  // back to 0 in the stylesheet. The two panes compose — one displaces the page from the
  // left, the other reserves a gutter on the right, and a document can have both open.
  const layout = useNavigationLayoutStore();
  const shift = useNavigationShift();
  const element = useRef<HTMLDivElement | null>(null);
  const attach = useCallback(
    (node: HTMLDivElement | null) => {
      element.current = node;
      layout?.setViewport(node);
    },
    [layout]
  );
  // A column that does not fit scrolls sideways. On the left, in a right-to-left interface,
  // the scroller starts at its right end and keeps it as the content grows.
  // CAPTURE, not bubble: the engine's keymap is bound to the painted pages inside this
  // element and binds Word's subscript/superscript to the same Ctrl/Cmd+`=` chord. On the way
  // up it had already scripted the selection by the time zoom ran, so one keystroke both
  // zoomed and rewrote run properties. Zoom wins on these keys, so it claims the event before
  // the pages see it; the keymap fails soft on an event that is already default-prevented.
  const onKeyDownCapture = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!editor || !(event.metaKey || event.ctrlKey) || event.altKey) return;
      const target = event.target;
      if (isElementNode(target) && target.closest('input, textarea, select, [role="dialog"]')) {
        return;
      }
      const next = zoomLevelForShortcut(event.key, editor.getZoom());
      if (next === null) return;
      event.preventDefault();
      editor.setZoom(next);
    },
    [editor]
  );

  return (
    <div
      ref={attach}
      data-testid="docx-editor-scroll"
      tabIndex={0}
      role="region"
      aria-label={t('editor.documentViewport')}
      onKeyDownCapture={onKeyDownCapture}
      {...(reserve ? { 'data-review-pane': paneOpen ? 'open' : 'closed' } : {})}
      {...(side === 'left' ? { 'data-chrome-dir': 'rtl' } : {})}
      {...(reserve && side === 'left' ? { 'data-review-side': 'left' } : {})}
      {...(fitting ? { 'data-zoom-fit': '' } : {})}
      className={`${scopeClassName}docx-editor-one-surface docx-editor-one-surface__viewport docx-editor__scroll-container${
        className ? ` ${className}` : ''
      }`}
      style={
        {
          ...style,
          ['--docx-nav-shift' as string]: `${shift}px`,
          ...(reserve
            ? {
                ['--docx-review-gutter' as string]: `${reviewGutter.inlineEnd}px`,
                ['--docx-review-gutter-start' as string]: `${reviewGutter.inlineStart}px`,
                // What a closed pane reserves on both edges. Under `overflow: 'scroll'`
                // the fit subtracts this in both pane states, so the page keeps one size.
                ['--docx-review-strip' as string]: `${2 * REVIEW_MARKERS_GUTTER}px`,
              }
            : {}),
        } as CSSProperties
      }
    >
      {/* Everything below this div has a scoped ancestor: either the packaged
          wrapper above us, or this element, which scoped itself just now. Say
          so, or parts inside repeat the class under `chrome={false}` and in the
          Root + Viewport composition path. */}
      <ScopedByAncestorContext.Provider value={true}>
        <InsideViewportContext.Provider value={true}>{children}</InsideViewportContext.Provider>
      </ScopedByAncestorContext.Provider>
    </div>
  );
}
