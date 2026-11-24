// The zoom lane against a surface that says no, and against a host that re-asserts.
//
// These are the two cases a mounted editor cannot easily be put into: a rescale the paginated
// surface refuses (it catches a throwing relayout, rolls back and returns false), and a host
// re-sending a value-equal mode object on every render. Both were wrong, and neither is
// reachable from `zoom-controller.test.ts`, so the lane is driven directly here.

import { describe, expect, test } from 'bun:test';
import { createZoomLane, type ZoomLaneHost } from '../docx-editor-zoom.ts';
import { AUTO_ZOOM_MODE } from '../zoom-fit.ts';
import type { PaginatedSurface } from '../paginated-surface.ts';

interface Harness {
  readonly lane: ReturnType<typeof createZoomLane>;
  readonly bumps: () => number;
  readonly emits: () => number;
  /** Whether the surface accepts a rescale, as one that cannot lay out would not. */
  readonly setRescaleAccepted: (accepted: boolean) => void;
  /** The scale the surface was last asked for, so the points-to-pixels factor is pinned. */
  readonly lastScale: () => number | null;
}

/**
 * A lane over a surface stub.
 *
 * `setPaginatedSurfaceScale` calls `surface.setScale`, so returning false from that is exactly
 * what a real refusal looks like from here. No container and no scroller, so the fit itself is
 * inert — which is the point: these tests are about the state transitions, not the arithmetic.
 */
function harness(config: Parameters<typeof createZoomLane>[0] = {}): Harness {
  let bumps = 0;
  let emits = 0;
  let accept = true;
  let lastScale: number | null = null;
  const surface = {
    setScale: (scale: number) => {
      if (!accept) return false;
      lastScale = scale;
      return true;
    },
    layout: () => ({ pages: [] }),
  } as unknown as PaginatedSurface;
  const host: ZoomLaneHost = {
    container: () => null,
    surface: () => surface,
    bump: () => {
      bumps += 1;
    },
    emitSelectionChange: () => {
      emits += 1;
    },
  };
  return {
    lane: createZoomLane(config, host),
    bumps: () => bumps,
    emits: () => emits,
    setRescaleAccepted: (next) => {
      accept = next;
    },
    lastScale: () => lastScale,
  };
}

describe('a rescale the surface refuses', () => {
  // The mode used to be dropped to `fixed` and the observer detached BEFORE the apply, and the
  // failure branch returned without publishing. The editor then reported `fixed` from
  // `getZoomMode()` and `fit` from the snapshot — which nothing had invalidated — so a toolbar
  // kept "Automatic" ticked over an editor that had silently stopped tracking, and the caller
  // had been told `ok: false` so had no reason to re-assert anything.
  test('leaves the mode exactly where it was', () => {
    const { lane, setRescaleAccepted } = harness();
    expect(lane.mode()).toEqual(AUTO_ZOOM_MODE);

    setRescaleAccepted(false);
    const result = lane.setZoom(1.5);

    expect(result).toMatchObject({ ok: false, code: 'unsupported' });
    expect(lane.mode()).toEqual(AUTO_ZOOM_MODE);
    expect(lane.zoom()).toBe(1);
  });

  test('publishes nothing, because nothing changed', () => {
    const { lane, setRescaleAccepted, bumps, emits } = harness();
    setRescaleAccepted(false);

    lane.setZoom(1.5);

    expect(bumps()).toBe(0);
    expect(emits()).toBe(0);
  });

  // The SAME lane recovers. Building a second one proved nothing about the first: what has to
  // hold is that a refusal leaves no residue behind it.
  test('a retry on the same lane succeeds and ends the fit', () => {
    const { lane, setRescaleAccepted } = harness();
    setRescaleAccepted(false);
    expect(lane.setZoom(1.5).ok).toBe(false);

    setRescaleAccepted(true);

    expect(lane.setZoom(1.5)).toEqual({ ok: true, changed: true });
    expect(lane.zoom()).toBe(1.5);
    expect(lane.mode()).toEqual({ type: 'fixed' });
  });

  // Points to CSS pixels at 96dpi. The stub used to ignore its argument, so nothing pinned
  // that the lane converts rather than handing the raw zoom to the surface.
  test('the surface is asked for the CSS scale, not the zoom', () => {
    const { lane, lastScale } = harness();
    lane.setZoom(1.5);
    expect(lastScale()).toBeCloseTo(1.5 * (96 / 72), 10);
  });
});

describe('a mode re-sent by value', () => {
  // The documented prop spelling is an object literal, so a host re-renders with a fresh one
  // every time. Compared by identity, each of those reinstalled the observer, refitted, bumped
  // the tick and re-rendered every snapshot consumer — on a render that changed nothing.
  test('is not a change, however many times it arrives', () => {
    const { lane, bumps, emits } = harness();
    const literal = () => ({ type: 'fit', fit: 'pageWidth', minZoom: 0.5, maxZoom: 1 }) as const;

    expect(lane.setZoomMode(literal())).toEqual({ ok: true, changed: false });
    expect(lane.setZoomMode(literal())).toEqual({ ok: true, changed: false });
    expect(lane.setZoomMode('auto')).toEqual({ ok: true, changed: false });

    expect(bumps()).toBe(0);
    expect(emits()).toBe(0);
  });

  test('the held object survives, so the snapshot stays reference-equal', () => {
    const { lane } = harness();
    const before = lane.mode();

    lane.setZoomMode({ type: 'fit', fit: 'pageWidth', minZoom: 0.5, maxZoom: 1 });

    expect(lane.mode()).toBe(before);
  });

  test('a genuinely different bound IS a change', () => {
    const { lane, bumps } = harness();

    expect(lane.setZoomMode({ type: 'fit', fit: 'pageWidth' })).toEqual({
      ok: true,
      changed: true,
    });
    expect(bumps()).toBe(1);
    expect(lane.mode()).toEqual({ type: 'fit', fit: 'pageWidth' });
  });
});

describe('the default mode', () => {
  test('a configured zoom means the embedder pinned it', () => {
    expect(harness({ zoom: 1.5 }).lane.mode()).toEqual({ type: 'fixed' });
    expect(harness({ zoom: 1.5 }).lane.zoom()).toBe(1.5);
  });

  // The number AND the pin. Reading only "a `zoom` key was present" made `zoom={42}` open
  // fixed at 100%: the bad value discarded, but the default fit discarded with it, so one bad
  // prop silently opted the editor out of fitting altogether.
  test('an out-of-range configured zoom is not a pin, so the default fit still applies', () => {
    for (const zoom of [42, 0, Number.NaN]) {
      const { lane } = harness({ zoom });
      expect(lane.zoom()).toBe(1);
      expect(lane.mode()).toEqual(AUTO_ZOOM_MODE);
    }
  });

  // `Object.is`, not `===`: a bound that arrived as NaN is not equal to itself, so an
  // unchanged prop reported as a change on every render.
  test('a NaN bound does not make an unchanged mode look changed', () => {
    const { lane, bumps } = harness();
    const withNaN = { type: 'fit', fit: 'pageWidth', maxZoom: Number.NaN } as const;

    expect(lane.setZoomMode(withNaN).changed).toBe(true);
    const held = lane.mode();
    expect(lane.setZoomMode({ ...withNaN })).toEqual({ ok: true, changed: false });

    expect(lane.mode()).toBe(held);
    expect(bumps()).toBe(1);
  });
});
