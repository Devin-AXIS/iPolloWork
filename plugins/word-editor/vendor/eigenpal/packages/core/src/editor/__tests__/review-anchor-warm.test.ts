// The review rail's paragraph anchors are warmed in idle time after a publish, so the next
// keystroke does not re-anchor every page. One warm runs at a time per surface.

import { expect, test } from 'bun:test';
import { warmAnchorsWhenIdle } from '../docx-editor-anchors.ts';

function idleWindow() {
  const queued: (() => void)[] = [];
  const view = {
    requestIdleCallback: (run: () => void) => {
      queued.push(run);
      return queued.length;
    },
    setTimeout: () => 0,
  } as unknown as Window;
  return { view, runIdle: () => queued.splice(0).forEach((run) => run()) };
}

test('warms once per idle period, however many publishes asked', () => {
  const { view, runIdle } = idleWindow();
  const surface = {};
  let warms = 0;
  for (let publish = 0; publish < 5; publish += 1)
    warmAnchorsWhenIdle(surface, view, () => warms++);
  expect(warms).toBe(0);
  runIdle();
  expect(warms).toBe(1);
  // A publish after the warm ran asks for the next one.
  warmAnchorsWhenIdle(surface, view, () => warms++);
  runIdle();
  expect(warms).toBe(2);
});

test('without idle callbacks, a timer runs the warm', () => {
  const timers: (() => void)[] = [];
  const view = {
    setTimeout: (run: () => void) => {
      timers.push(run);
      return 1;
    },
  } as unknown as Window;
  let warms = 0;
  warmAnchorsWhenIdle({}, view, () => warms++);
  timers.splice(0).forEach((run) => run());
  expect(warms).toBe(1);
});
