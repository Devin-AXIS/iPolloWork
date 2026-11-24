// The facade's zoom lane: the scale, where it came from, and the two members that move it.
//
// Kept out of `docx-editor.ts` because that file sits against the max-lines gate, and because
// the three pieces belong together: the number, the mode, and the one path that applies both.
// `zoom-fit.ts` has the arithmetic and `zoom-controller.ts` the measuring; this is the part
// that owns the state and answers the contract.
//
// ONE APPLY PATH is the load-bearing rule here. A fit and a toolbar click are
// indistinguishable downstream — both rescale the surface, both bump the tick, both emit — so
// a host that listens rather than polls sees an automatic refit exactly as it sees a click. An
// earlier shape that only wrote the variable on a refit left every such host showing the old
// percentage.

import type { ExecResult, ZoomMode } from '../contracts/editor.ts';
import type { PaginatedSurface } from './paginated-surface.ts';
import { setPaginatedSurfaceScale } from './surface-scale.ts';
import { createZoomController } from './zoom-controller.ts';
import {
  AUTO_ZOOM_MODE,
  FIXED_ZOOM_MODE,
  ZOOM_MAX,
  ZOOM_MIN,
  isFitMode,
  resolveZoomMode,
  sameZoomMode,
} from './zoom-fit.ts';

/** What the lane reads from, and writes back to, the facade around it. */
export interface ZoomLaneHost {
  /** The element the surface mounted into, or null while detached. */
  container(): HTMLElement | null;
  /** The mounted surface, or null. Read every call — it is rebuilt on load and font remount. */
  surface(): PaginatedSurface | null;
  /** Move the state tick, so `snapshot()` re-derives. */
  bump(): void;
  emitSelectionChange(): void;
  /** Whether the review pane scrolls beside the page instead of shrinking a capped fit (`overflow: 'scroll'`). */
  reviewPaneScrolls?(): boolean;
}

/** The zoom half of `createDocxEditor`. */
export interface ZoomLane {
  zoom(): number;
  mode(): ZoomMode;
  /** Points to CSS pixels: zoom 1 paints at the browser's 96dpi reading of a 72dpi point. */
  scale(): number;
  setZoom(next: number): ExecResult;
  setZoomMode(next: ZoomMode | 'auto'): ExecResult;
  /** Start tracking the viewport, if the mode says to. Called after every mount. */
  attach(): void;
  detach(): void;
  /** Recompute now, for a change to the page's own size. */
  refit(): void;
  /** Recompute only if the page's own width moved. Cheap enough for the commit path. */
  refitIfPageResized(): void;
}

export interface ZoomLaneConfig {
  readonly zoom?: number;
  readonly zoomMode?: ZoomMode | 'auto';
}

export function createZoomLane(config: ZoomLaneConfig, host: ZoomLaneHost): ZoomLane {
  /**
   * A configured scale, or null when there is none the contract would accept.
   *
   * NULL for an out-of-range or non-finite value, and that answer feeds the mode below as
   * well as the scale. Reading only "was a `zoom` key present" made `zoom={42}` open FIXED at
   * 100% — the number thrown away, but the fit thrown away with it, so a bad prop silently
   * opted the editor out of the default. A `zoom` the contract refuses is not a pin.
   */
  const pinnedZoom =
    config.zoom !== undefined &&
    Number.isFinite(config.zoom) &&
    config.zoom >= ZOOM_MIN &&
    config.zoom <= ZOOM_MAX
      ? config.zoom
      : null;
  let zoom = pinnedZoom ?? 1;
  /**
   * Where the scale comes from. A pinned `zoom` and no configured `zoomMode` means the
   * embedder chose a number, so honour it: only an editor that asked for neither gets the
   * `'auto'` default.
   *
   * The lane HOLDS this object and only replaces it when `sameZoomMode` says the value moved,
   * which is what makes `snapshotsEqual`'s identity compare of `zoomMode` correct.
   */
  let mode: ZoomMode =
    resolveZoomMode(config.zoomMode ?? (pinnedZoom !== null ? FIXED_ZOOM_MODE : 'auto')) ??
    AUTO_ZOOM_MODE;

  /**
   * Move the scale, whoever asked. Returns whether the surface accepted it.
   *
   * `alsoCommit` runs after the surface has accepted and before anything is published, so a
   * caller that changes the mode in the same breath does not emit a snapshot carrying the new
   * scale beside the old mode.
   */
  function applyZoom(next: number, alsoCommit?: () => void): boolean {
    if (next === zoom) {
      alsoCommit?.();
      return true;
    }
    const surface = host.surface();
    if (surface && !setPaginatedSurfaceScale(surface, next * (96 / 72))) return false;
    zoom = next;
    alsoCommit?.();
    host.bump();
    host.emitSelectionChange();
    return true;
  }

  /** Stop tracking the viewport and hold the scale where it is. */
  function leaveFit(): void {
    mode = FIXED_ZOOM_MODE;
    controller.detach();
  }

  // Reads `mode` and `zoom` through closures rather than being handed them, so `setZoomMode`
  // takes effect without re-installing the observer.
  const controller = createZoomController({
    container: host.container,
    mode: () => mode,
    // Page ONE, in content pixels at 100%. Every page in a document may have its own size;
    // fitting the first is the same choice the horizontal ruler already makes, and a fit that
    // changed scale as the reader scrolled past a landscape page would be worse than one that
    // does not.
    pageWidthPx: () => {
      const box = host.surface()?.layout().pages[0]?.box;
      return box ? box.width * (96 / 72) : null;
    },
    // Model state, not layout: this is the cheap guard the commit path compares, and reading
    // it must not flush a layout from inside the session's own notification.
    pageWidthTwips: () => host.surface()?.sectionProperties().pageSize.widthTwips ?? null,
    zoom: () => zoom,
    applyZoom: (next) => {
      applyZoom(next);
    },
    reviewPaneScrolls: () => host.reviewPaneScrolls?.() === true,
  });

  return {
    zoom: () => zoom,
    mode: () => mode,
    scale: () => zoom * (96 / 72),
    // Only a fit tracks anything, so only a fit installs an observer. A fixed editor used to
    // get one too and pay a scheduled frame per resize tick to reach an early return.
    attach: () => {
      if (isFitMode(mode)) controller.attach();
    },
    detach: () => controller.detach(),
    refit: () => controller.refit(),
    refitIfPageResized: () => controller.refitIfPageResized(),

    setZoom(next: number): ExecResult {
      // Refused rather than clamped: a caller that asked for
      // 0 or NaN has a bug, and silently substituting 1 hides it.
      if (!Number.isFinite(next) || next < ZOOM_MIN || next > ZOOM_MAX) {
        return {
          ok: false,
          code: 'invalidArgs',
          reason: `zoom must be between ${ZOOM_MIN} and ${ZOOM_MAX}, got ${next}`,
        };
      }
      const wasFit = isFitMode(mode);
      if (next === zoom) {
        if (!wasFit) return { ok: true, changed: false };
        // Zoom: 1 -> 1, mode: fit -> fixed. A picked number ENDS the fit even when it is the
        // number the fit had already landed on — leaving the mode alone meant picking "100%"
        // while auto happened to read 100% did nothing, and the next resize moved the page
        // again. Nothing moved on screen and the whole change is in the snapshot, so this has
        // to publish or a zoom menu keeps "Automatic" ticked.
        leaveFit();
        host.bump();
        host.emitSelectionChange();
        return { ok: true, changed: true };
      }
      // THE SURFACE FIRST, the mode inside the same commit. `applyZoom` fails when the surface
      // refuses the rescale — it catches a throwing relayout, rolls back and returns false —
      // and dropping the mode before finding that out left the editor claiming `fixed` with no
      // observer installed, unpublished, while the refused `ok: false` gave the caller no
      // reason to re-assert anything: a toolbar with "Automatic" ticked over an editor that
      // had silently stopped tracking.
      if (!applyZoom(next, wasFit ? leaveFit : undefined)) {
        return {
          ok: false,
          code: 'unsupported',
          reason: `the mounted surface could not apply zoom ${next}`,
        };
      }
      return { ok: true, changed: true };
    },

    setZoomMode(next: ZoomMode | 'auto'): ExecResult {
      const resolved = resolveZoomMode(next);
      if (!resolved) {
        return {
          ok: false,
          code: 'invalidArgs',
          reason: `unknown zoom mode ${JSON.stringify(next)}`,
        };
      }
      // BY VALUE, and the held object is kept. A host's `zoomMode` prop is an object, and the
      // spelling the docs show — `zoomMode={{ type: 'fit', fit: 'pageWidth' }}` — is a fresh
      // literal on every render. Comparing by identity made each of those a real mode change:
      // the observer was torn down and rebuilt, the document refitted, the tick bumped, and
      // every `useEditorState` consumer re-rendered, on a render that changed nothing.
      if (sameZoomMode(resolved, mode)) return { ok: true, changed: false };
      mode = resolved;
      if (isFitMode(resolved)) {
        // Installs the observer AND fits once, so switching to a fit takes effect on the
        // click rather than on the next window resize.
        controller.attach();
      } else {
        controller.detach();
      }
      // Whether or not the fit moved the scale — `applyZoom` publishes when it does — the MODE
      // moved, and a zoom menu renders its tick from the mode.
      host.bump();
      host.emitSelectionChange();
      return { ok: true, changed: true };
    },
  };
}

/**
 * Points (the layout's unit) to content pixels at 96dpi (every geometry consumer's unit).
 *
 * The engine lays out in points — twips / 20 — and paints at `zoom * 96/72`. This is that
 * same 96/72, applied once, where layout geometry crosses into the public contract.
 */
function toContentPixels(box: { x: number; y: number; width: number; height: number }): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const scale = 96 / 72;
  return {
    x: box.x * scale,
    y: box.y * scale,
    width: box.width * scale,
    height: box.height * scale,
  };
}

/** Zoom-related `Editor` members kept out of `docx-editor.ts` for the max-lines gate. */
export function zoomFacadeMembers(
  zoomLane: ZoomLane,
  surface: () => PaginatedSurface | null
): {
  getZoom: () => number;
  setZoom: (next: number) => ExecResult;
  getZoomMode: () => ZoomMode;
  setZoomMode: (next: ZoomMode | 'auto') => ExecResult;
  getRenderScale: () => number;
  getPageGeometry: () => Array<{
    index: number;
    box: { x: number; y: number; width: number; height: number };
    contentBox: { x: number; y: number; width: number; height: number };
  }>;
} {
  return {
    // The scale and its mode both live in the zoom lane; these four are the contract's view
    // of it. `setZoom` refuses an out-of-range number rather than clamping, and leaves any fit
    // mode; `setZoomMode` refuses a mode it does not know.
    getZoom: () => zoomLane.zoom(),
    setZoom: (next: number) => zoomLane.setZoom(next),
    getZoomMode: () => zoomLane.mode(),
    setZoomMode: (next: ZoomMode | 'auto') => zoomLane.setZoomMode(next),
    getRenderScale: () => zoomLane.scale(),

    /**
     * Page boxes from the LAYOUT, never from the DOM, in CONTENT PIXELS at 96dpi.
     *
     * The unit conversion is the load-bearing part. Layout works in POINTS (twips / 20), and
     * the surface converts at paint with `scale = zoom * 96/72`; every consumer of this
     * member works in content pixels — `ruler-ticks.ts` says so in its header and derives
     * ticks from `PX_PER_INCH = 96`, and React's own ruler computes the same page width
     * through `twipsToPixels`. Handing points straight out made a Letter page measure 612
     * where the painted page is 816, so the Vue ruler drew a strip 25% short of its page and
     * labelled 8.5 inches as six.
     *
     * ZOOM IS NOT APPLIED. These are content pixels at 100%; a caller that scales its own
     * rendering multiplies by `getZoom()`, which is what both rulers already do.
     *
     * `layout()` flushes any pending commit first, so a caller measuring straight after an
     * edit reads the geometry that edit produced rather than the one before it. Virtualized
     * pages are included: a page with no element yet still has a box, and that is usually
     * the page a caller is asking about.
     */
    getPageGeometry: () => {
      const mounted = surface();
      return mounted
        ? mounted.layout().pages.map((page) => ({
            index: page.index,
            box: toContentPixels(page.box),
            contentBox: toContentPixels(page.contentBox),
          }))
        : [];
    },
  };
}
