// The background pass that finds a document's one-pass footnote pagination: it adopts a
// different answer, confirms an equal one, skips a layout it already verified, and never
// publishes for an outdated revision.

import { describe, expect, test } from 'bun:test';
import { createLayoutSession, type LayoutSession } from '../../layout/layout-session.ts';
import type { PageRecord, SemanticLayout } from '../../layout/semantic-records.ts';
import { createCanonicalLayout } from '../surface-canonical-layout.ts';

function layoutOf(pageCount: number): SemanticLayout {
  const pages = Array.from(
    { length: pageCount },
    (_, index) => ({ id: `p${index}`, index, fragments: [] }) as unknown as PageRecord
  );
  return { revision: 1, pages };
}

function harness(options: { liveReserves: ReadonlyMap<number, number> | null }) {
  let time = 0;
  const timers: Array<{ at: number; run: () => void } | null> = [];
  const live = createLayoutSession();
  live.notePageBottomReserves = options.liveReserves;
  const state = {
    revision: 1,
    /** How many more times the live pass reports itself still finishing. */
    busyChecks: 0,
    /** An edit that lands while the background pass runs. */
    editDuringPass: false,
    current: layoutOf(3) as SemanticLayout | null,
    found: new Map<number, number>() as ReadonlyMap<number, number>,
    passes: 0,
    adopted: [] as Array<{ session: LayoutSession; layout: SemanticLayout }>,
    live,
  };
  const canonical = createCanonicalLayout({
    now: () => time,
    schedule: (run, delayMs) => {
      const index = timers.push({ at: time + delayMs, run }) - 1;
      return () => void (timers[index] = null);
    },
    revision: () => state.revision,
    live: () => state.live,
    current: () => state.current,
    busy: () => state.busyChecks-- > 0,
    createSession: createLayoutSession,
    pass: (_revision, session) => {
      state.passes += 1;
      return (function* () {
        time += 5;
        yield;
        if (state.editDuringPass) state.revision += 1;
        time += 5;
        session.notePageBottomReserves = state.found;
        return layoutOf(4);
      })();
    },
    adopt: (session, layout) => {
      state.adopted.push({ session, layout });
      state.live = session;
      state.current = layout;
    },
  });
  /** Run every due timer, advancing the clock, until none is left. */
  const idle = (): void => {
    for (;;) {
      const due = timers
        .map((entry, index) => ({ entry, index }))
        .filter((item) => item.entry !== null)
        .sort((a, b) => a.entry!.at - b.entry!.at)[0];
      if (!due) return;
      timers[due.index] = null;
      time = Math.max(time, due.entry!.at);
      due.entry!.run();
    }
  };
  return { canonical, state, idle };
}

describe('one-pass footnote pagination in the background', () => {
  test('a different answer replaces the live session and layout', () => {
    const { canonical, state, idle } = harness({ liveReserves: new Map([[0, 20]]) });
    state.found = new Map([[0, 30]]);
    canonical.request();
    idle();
    expect(state.passes).toBe(1);
    expect(state.adopted.length).toBe(1);
    expect(state.live).toBe(state.adopted[0]!.session);
    expect(state.current!.pages.length).toBe(4);
    // The adopted layout is verified: asking again lays nothing out.
    canonical.request();
    idle();
    expect(state.passes).toBe(1);
  });

  test('an equal answer keeps the live session, and the same pages are not checked again', () => {
    const { canonical, state, idle } = harness({ liveReserves: new Map([[0, 20]]) });
    state.found = new Map([[0, 20]]);
    const live = state.live;
    canonical.request();
    idle();
    expect(state.adopted).toEqual([]);
    expect(state.live).toBe(live);
    canonical.request();
    idle();
    expect(state.passes).toBe(1);
    // A layout that moved a page start is checked again.
    state.current = layoutOf(5);
    canonical.request();
    idle();
    expect(state.passes).toBe(2);
  });

  test('a newer revision drops the pass without publishing', () => {
    const { canonical, state, idle } = harness({ liveReserves: new Map([[0, 20]]) });
    state.found = new Map([[0, 30]]);
    state.editDuringPass = true;
    canonical.request();
    idle();
    expect(state.passes).toBe(1);
    expect(state.adopted).toEqual([]);
  });

  test('it waits while the live pass is still finishing', () => {
    const { canonical, state, idle } = harness({ liveReserves: new Map([[0, 20]]) });
    state.found = new Map([[0, 30]]);
    state.busyChecks = 3;
    canonical.request();
    idle();
    expect(state.busyChecks).toBeLessThan(0);
    expect(state.passes).toBe(1);
    expect(state.adopted.length).toBe(1);
  });

  test('a document without footnote reserves never runs the pass', () => {
    const { canonical, state, idle } = harness({ liveReserves: null });
    canonical.request();
    idle();
    expect(state.passes).toBe(0);
  });

  test('teardown cancels a waiting pass', () => {
    const { canonical, state, idle } = harness({ liveReserves: new Map([[0, 20]]) });
    canonical.request();
    canonical.cancel();
    idle();
    expect(state.passes).toBe(0);
  });

  test('a layout published after teardown starts nothing', () => {
    const { canonical, state, idle } = harness({ liveReserves: new Map([[0, 20]]) });
    canonical.cancel();
    // The flush teardown runs publishes once more.
    canonical.request();
    idle();
    expect(state.passes).toBe(0);
  });
});
