// Keeping the moving end of the selection inside the viewport.
//
// Lifted out of the composition root because it owns state — the page the caret was last
// seen on — and because deciding WHEN the paper may move is a question with three answers,
// not a boolean. Geometry comes from layout rather than the DOM: the destination page may
// still be virtualized, so it has no element to measure.

import type { TextMeasurer } from '@docx-editor.dev/core/layout';
import { caretAt, type SemanticLayout, type SemanticSelection } from '@docx-editor.dev/core/layout';

/**
 * Whether the viewport may move to the selection this write leaves behind.
 *
 * - `caret` — the default. Follow a collapsed caret only. A range is somebody dragging or
 *   selecting everything, and snapping to its head would fight the gesture.
 * - `head` — follow the head even in a range: the reader moved it deliberately with a
 *   shift-extended keyboard command, and the text they are selecting has to stay visible.
 * - `none` — a pointer press. The reader picked a point that is already on screen, so the
 *   paper must not move under it.
 */
export type CaretFollowMode = 'caret' | 'head' | 'none';

/** Distance kept between the caret and the viewport edge it is pulled away from, in px. */
const EDGE_PADDING_PX = 24;

export interface CaretViewFollower {
  /**
   * Bring the selection's moving end into view, and record the page it is on.
   *
   * `force` is a deliberate move (a selection write, an edit). Without it — the ordinary
   * repaint — only a caret that layout moved to ANOTHER page is followed, so a scroll never
   * snaps the reader back to a caret that has not moved.
   */
  follow(force: boolean, mode: CaretFollowMode): void;
  /**
   * Run `body` with every follow inside it declined — the record still happens, the scroll
   * does not, however deep the call goes.
   *
   * A press resolves its point by flushing layout, and the pass that lands there paints and
   * follows on its own terms: it never sees the mode the press asked for. Holding the whole
   * scope is what makes `none` mean no scroll rather than no scroll on the way out. Nested
   * calls restore rather than clear, so an inner scope cannot release an outer one.
   */
  without<T>(body: () => T): T;
}

export function createCaretViewFollower(deps: {
  /** True while a header, footer or note is open: furniture scrolling is its own lane. */
  storyScopeOpen(): boolean;
  selection(): SemanticSelection;
  layout(): SemanticLayout;
  measurer(): TextMeasurer;
  /** The page the selection was last painted on, when the same story spans several. */
  preferredPageIndex(): number | undefined;
  preferredLineId?(): string | undefined;
  pagesLayer: HTMLElement;
  /** The surface root, whose offset the scroller's coordinates are relative to. */
  container: HTMLElement;
  scroller(): HTMLElement | null;
  scale(): number;
  /** The destination may have been a shell; build it outside the paint that moved there. */
  scheduleRematerialize(): void;
}): CaretViewFollower {
  let lastCaretPageIndex: number | null = null;
  let held = false;

  return {
    without(body) {
      const outer = held;
      held = true;
      try {
        return body();
      } finally {
        held = outer;
      }
    },

    follow(force, requested) {
      const mode = held ? 'none' : requested;
      if (deps.storyScopeOpen()) return;
      const selection = deps.selection();
      const collapsed =
        selection.anchor.paragraphId === selection.head.paragraphId &&
        selection.anchor.offset === selection.head.offset;
      // Every mode but `head` is about a CARET, so a range is done with here — before
      // `caretAt`, which resolves geometry and sorts a page's lines. A drag reaches this on
      // every pointermove and every autoscroll frame, and its range has no caret page to
      // record: the head is a point the reader is sweeping through, not one they left a
      // caret at, and the only reader of the record compares it against a caret.
      if (!collapsed && mode !== 'head') return;
      // Focus gates the SCROLL. A declined follow still records, whoever holds focus: a caret
      // placed while a host's own list had focus would otherwise read as a page change on the
      // first repaint after focus returns, and scroll then.
      const active = deps.pagesLayer.ownerDocument.activeElement;
      const focused = active === deps.pagesLayer || (!!active && deps.pagesLayer.contains(active));
      if (!focused && mode !== 'none') return;

      const preferredPageIndex = deps.preferredPageIndex();
      const preferredLineId = deps.preferredLineId?.();
      const layout = deps.layout();
      const geometry = caretAt(layout, selection.head, {
        measurer: deps.measurer(),
        ...(preferredPageIndex !== undefined ? { preferredPageIndex } : {}),
        ...(preferredLineId !== undefined ? { preferredLineId } : {}),
      });
      if (!geometry) return;
      const changedPage = lastCaretPageIndex !== null && lastCaretPageIndex !== geometry.pageIndex;
      // Recorded whatever happens next, for everything that reaches here — a caller declines
      // the SCROLL, never the record. This is the only writer, and a stale value tells the
      // next repaint the caret moved to another page when it did not, which scrolls the
      // reader back to a caret they deliberately scrolled away from. A range in `head` mode
      // records its head, which is where the next collapsed write will be.
      lastCaretPageIndex = geometry.pageIndex;
      if (mode === 'none' || (!force && !changedPage)) return;

      const page = layout.pages[geometry.pageIndex];
      const scroller = deps.scroller();
      if (!page || !scroller || scroller.clientHeight <= 0) return;

      const scale = deps.scale();
      const contentTop = page.contentBox.y - page.box.y;
      const top = (page.box.y + contentTop + geometry.y) * scale + deps.container.offsetTop;
      const bottom = top + geometry.height * scale;
      const viewportTop = scroller.scrollTop;
      const viewportBottom = viewportTop + scroller.clientHeight;
      let target = viewportTop;
      if (top < viewportTop + EDGE_PADDING_PX) {
        target = top - EDGE_PADDING_PX;
      } else if (bottom > viewportBottom - EDGE_PADDING_PX) {
        target = bottom + EDGE_PADDING_PX - scroller.clientHeight;
      } else {
        return;
      }

      const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const next = Math.max(0, Math.min(target, maxScroll));
      if (Math.abs(next - scroller.scrollTop) < 0.5) return;
      scroller.scrollTop = next;
      deps.scheduleRematerialize();
    },
  };
}
