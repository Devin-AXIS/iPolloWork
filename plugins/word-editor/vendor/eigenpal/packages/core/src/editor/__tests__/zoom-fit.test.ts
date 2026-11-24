// The fit arithmetic, on its own.
//
// Every rule here has a failure mode behind it that is invisible in a screenshot: a fit that
// rounds up paints a page wider than the box it was fitted to; a fit that guesses on an
// unmeasured viewport makes every mount flinch; a fit that does not quantize re-lays out the
// whole document because a scrollbar moved a fractional pixel.

import { describe, expect, test } from 'bun:test';
import {
  AUTO_ZOOM_FLOOR,
  AUTO_ZOOM_MODE,
  FIT_GUTTER_PX,
  FIXED_ZOOM_MODE,
  ZOOM_MAX,
  ZOOM_MIN,
  fitZoom,
  isFitMode,
  resolveZoomMode,
  reviewPaneEntitledZoom,
  sameZoomMode,
} from '../zoom-fit.ts';

/** A US Letter page in content pixels at 96dpi: 8.5in wide. */
const LETTER_PX = 816;

/** The default mode's bounds, spread into a `fitZoom` call. */
const AUTO_BOUNDS = {
  minZoom: AUTO_ZOOM_MODE.type === 'fit' ? AUTO_ZOOM_MODE.minZoom : undefined,
  maxZoom: 1,
};

describe('fitZoom', () => {
  test('fills the room it has, less a gutter on each side', () => {
    const zoom = fitZoom({
      availableWidthPx: LETTER_PX + 2 * FIT_GUTTER_PX,
      pageWidthPx: LETTER_PX,
    });
    expect(zoom).toBe(1);
  });

  test('shrinks a page that does not fit', () => {
    // 700px viewport, 24px gutters: 652 usable / 816 = 0.799…
    expect(fitZoom({ availableWidthPx: 700, pageWidthPx: LETTER_PX })).toBe(0.79);
  });

  test('grows a page with room to spare when nothing caps it', () => {
    expect(fitZoom({ availableWidthPx: 1600, pageWidthPx: LETTER_PX })).toBe(1.9);
  });

  // The whole point of `auto`: a wide window renders exactly as it does today.
  test('maxZoom 1 leaves a wide window at 100% and still shrinks a narrow one', () => {
    expect(fitZoom({ availableWidthPx: 1600, pageWidthPx: LETTER_PX, maxZoom: 1 })).toBe(1);
    expect(fitZoom({ availableWidthPx: 700, pageWidthPx: LETTER_PX, maxZoom: 1 })).toBe(0.79);
  });

  // The other half of `auto`. A phone with the comments rail open leaves the page a sliver;
  // fitting into it trades a scrollbar nobody minds for a document nobody can read. Past the
  // floor the page keeps its size and the container scrolls sideways instead.
  test('auto stops at its floor and lets the container overflow', () => {
    // 420px phone, 316px of it reserved by the open rail: 104px left for an 816px page.
    const withComments = fitZoom({
      availableWidthPx: 104,
      pageWidthPx: LETTER_PX,
      ...AUTO_BOUNDS,
    });
    expect(withComments).toBe(AUTO_ZOOM_FLOOR);
    // Which is wider than the room it has — the container scrolls, by design.
    expect(withComments! * LETTER_PX).toBeGreaterThan(104);
  });

  // Rounding UP would paint a page wider than the box it was fitted to, which is the one
  // outcome fitting exists to prevent.
  test('quantizes DOWN to whole percent', () => {
    const zoom = fitZoom({ availableWidthPx: 860, pageWidthPx: LETTER_PX, gutterPx: 0 })!;
    expect(zoom).toBe(1.05);
    expect(zoom * LETTER_PX).toBeLessThanOrEqual(860);
  });

  test('a sub-percent change in the viewport does not move the answer', () => {
    // Both land inside the 82% band: 672/816 = 0.8235, 674/816 = 0.8259.
    const a = fitZoom({ availableWidthPx: 720, pageWidthPx: LETTER_PX });
    const b = fitZoom({ availableWidthPx: 722, pageWidthPx: LETTER_PX });
    expect(a).toBe(0.82);
    expect(b).toBe(a);
  });

  test('clamps to the contract range rather than refusing — it has no caller to tell', () => {
    expect(fitZoom({ availableWidthPx: 40, pageWidthPx: LETTER_PX })).toBe(ZOOM_MIN);
    expect(fitZoom({ availableWidthPx: 100_000, pageWidthPx: LETTER_PX })).toBe(ZOOM_MAX);
  });

  test('honours a mode that asks for a floor', () => {
    expect(fitZoom({ availableWidthPx: 300, pageWidthPx: LETTER_PX, minZoom: 0.5 })).toBe(0.5);
  });

  // `setZoom(10)` is refused as out of range; the fit must not let the same value in through
  // the other public door. The floor used to be clamped up to ZOOM_MIN but never down to
  // ZOOM_MAX, so `{ minZoom: 10 }` came back as a scale of 10.
  test('a bound outside the contract range is pulled into it, in both directions', () => {
    expect(fitZoom({ availableWidthPx: 1000, pageWidthPx: LETTER_PX, minZoom: 10 })).toBe(ZOOM_MAX);
    expect(
      fitZoom({ availableWidthPx: 1000, pageWidthPx: LETTER_PX, minZoom: 10, maxZoom: 1 })
    ).toBe(ZOOM_MAX);
    expect(fitZoom({ availableWidthPx: 1000, pageWidthPx: LETTER_PX, maxZoom: 0.001 })).toBe(
      ZOOM_MIN
    );
  });

  // Quantizing the CLAMPED value rounded the bound itself: x/100*100 floors down for x = 29,
  // 57, 113 and others, so a caller asking for 0.29 was handed 0.28 — a silent one-percent
  // violation of a bound it had stated.
  test('a bound the caller stated is returned exactly, not quantized past', () => {
    expect(fitZoom({ availableWidthPx: 50, pageWidthPx: LETTER_PX, minZoom: 0.29 })).toBe(0.29);
    expect(fitZoom({ availableWidthPx: 100_000, pageWidthPx: LETTER_PX, maxZoom: 1.13 })).toBe(
      1.13
    );
    expect(fitZoom({ availableWidthPx: 100_000, pageWidthPx: LETTER_PX, maxZoom: 0.57 })).toBe(
      0.57
    );
  });

  test('contradictory bounds resolve to the floor, not to an unreadable page', () => {
    expect(
      fitZoom({ availableWidthPx: 300, pageWidthPx: LETTER_PX, minZoom: 0.8, maxZoom: 0.5 })
    ).toBe(0.8);
  });

  // A viewport this narrow is a phone in a split view. Subtracting the gutters outright would
  // leave nothing to fit into.
  test('gives up the gutters before it gives up the page', () => {
    expect(fitZoom({ availableWidthPx: 30, pageWidthPx: LETTER_PX, gutterPx: 40 })).not.toBeNull();
  });

  // NULL, not 1. Guessing here paints 100% on the first frame and the fitted scale on the
  // second, which is a visible jump on every mount.
  test('answers null when there is nothing to measure', () => {
    expect(fitZoom({ availableWidthPx: 0, pageWidthPx: LETTER_PX })).toBeNull();
    expect(fitZoom({ availableWidthPx: 800, pageWidthPx: 0 })).toBeNull();
    expect(fitZoom({ availableWidthPx: Number.NaN, pageWidthPx: LETTER_PX })).toBeNull();
    expect(fitZoom({ availableWidthPx: 800, pageWidthPx: Number.POSITIVE_INFINITY })).toBeNull();
  });
});

describe('resolveZoomMode', () => {
  test("'auto' is the capped page-width fit", () => {
    expect(resolveZoomMode('auto')).toBe(AUTO_ZOOM_MODE);
    expect(AUTO_ZOOM_MODE).toEqual({ type: 'fit', fit: 'pageWidth', minZoom: 0.5, maxZoom: 1 });
  });

  test('a fixed mode normalizes to the shared constant, so snapshots stay reference-equal', () => {
    expect(resolveZoomMode({ type: 'fixed' })).toBe(FIXED_ZOOM_MODE);
  });

  test('a custom fit is passed through with its bounds intact', () => {
    const mode = { type: 'fit', fit: 'pageWidth', minZoom: 0.4 } as const;
    expect(resolveZoomMode(mode)).toBe(mode);
  });

  test('refuses what it does not know instead of substituting a default', () => {
    expect(resolveZoomMode('page-width' as never)).toBeNull();
    expect(resolveZoomMode({ type: 'fit', fit: 'fullPage' } as never)).toBeNull();
    expect(resolveZoomMode(null as never)).toBeNull();
  });
});

describe('reviewPaneEntitledZoom', () => {
  test('a fixed mode is entitled to the scale in force', () => {
    expect(reviewPaneEntitledZoom(FIXED_ZOOM_MODE, 1.25)).toBe(1.25);
    expect(reviewPaneEntitledZoom(undefined, 0.8)).toBe(0.8);
  });

  test('a capped fit is entitled to its cap, an uncapped one to nothing', () => {
    expect(reviewPaneEntitledZoom(AUTO_ZOOM_MODE, 0.7)).toBe(1);
    expect(reviewPaneEntitledZoom({ type: 'fit', fit: 'pageWidth' }, 1.4)).toBeNull();
  });

  test("under overflow 'shrinkPage' a fit is entitled to its floor, never to the live zoom", () => {
    const mode = { type: 'fit', fit: 'pageWidth', minZoom: 0.35, maxZoom: 1 } as const;
    expect(reviewPaneEntitledZoom(mode, 0.9, 'shrinkPage')).toBe(0.35);
    expect(reviewPaneEntitledZoom(mode, 0.4, 'shrinkPage')).toBe(0.35);
    // No floor stated: the contract floor. An out-of-range floor clamps into the contract.
    expect(reviewPaneEntitledZoom({ type: 'fit', fit: 'pageWidth' }, 1, 'shrinkPage')).toBe(
      ZOOM_MIN
    );
    expect(
      reviewPaneEntitledZoom({ type: 'fit', fit: 'pageWidth', minZoom: 0.01 }, 1, 'shrinkPage')
    ).toBe(ZOOM_MIN);
    // 'float' is the default rule, and a fixed mode ignores the setting.
    expect(reviewPaneEntitledZoom(mode, 0.5, 'float')).toBe(1);
    expect(reviewPaneEntitledZoom(FIXED_ZOOM_MODE, 1.25, 'shrinkPage')).toBe(1.25);
  });
});

describe('sameZoomMode', () => {
  // `snapshotsEqual` compares `zoomMode` by identity, and the documented prop spelling is an
  // object literal — a fresh one on every host render. Without a value comparison behind the
  // setter, each render was a real mode change: observer rebuilt, document refitted, tick
  // bumped, every snapshot consumer re-rendered.
  test('two spellings of one fit are the same mode', () => {
    expect(sameZoomMode({ type: 'fit', fit: 'pageWidth' }, { type: 'fit', fit: 'pageWidth' })).toBe(
      true
    );
    expect(sameZoomMode({ type: 'fixed' }, FIXED_ZOOM_MODE)).toBe(true);
    expect(resolveZoomMode({ type: 'fit', fit: 'pageWidth', minZoom: 0.5, maxZoom: 1 })).toBe(
      AUTO_ZOOM_MODE
    );
  });

  test('a different bound is a different mode', () => {
    expect(
      sameZoomMode({ type: 'fit', fit: 'pageWidth' }, { type: 'fit', fit: 'pageWidth', maxZoom: 1 })
    ).toBe(false);
    expect(sameZoomMode(FIXED_ZOOM_MODE, AUTO_ZOOM_MODE)).toBe(false);
  });
});

describe('isFitMode', () => {
  test('separates the two', () => {
    expect(isFitMode(AUTO_ZOOM_MODE)).toBe(true);
    expect(isFitMode(FIXED_ZOOM_MODE)).toBe(false);
  });
});
