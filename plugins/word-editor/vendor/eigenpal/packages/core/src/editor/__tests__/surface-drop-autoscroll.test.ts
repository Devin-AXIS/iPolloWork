import { expect, test } from 'bun:test';
import { createDropAutoScroll } from '../surface-drop-autoscroll.ts';

function harness(limit = 100) {
  const pending = new Map<number, (time: number) => void>();
  let next = 0;
  let top = 0;
  let active = true;
  let moved = 0;
  let onMove = () => {};
  const element = {
    get scrollTop() {
      return top;
    },
    set scrollTop(value: number) {
      top = Math.max(0, Math.min(limit, value));
    },
    getBoundingClientRect: () => ({ left: 100, right: 700, top: 50, bottom: 450 }),
  } as HTMLElement;
  const controller = createDropAutoScroll({
    scroller: () => element,
    frames: {
      requestAnimationFrame(run) {
        pending.set(++next, run);
        return next;
      },
      cancelAnimationFrame(id) {
        if (id != null) pending.delete(id);
      },
    },
    active: () => active,
    moved: () => {
      moved++;
      onMove();
    },
  });
  return {
    controller,
    element,
    pending,
    setActive(value: boolean) {
      active = value;
    },
    onMove(run: () => void) {
      onMove = run;
    },
    moved: () => moved,
    frame() {
      const batch = Array.from(pending.values());
      pending.clear();
      for (const run of batch) run(0);
    },
  };
}

test('one pointer event scrolls continuously and re-resolves after every movement', () => {
  const h = harness();
  h.controller.follow(200, 449);
  for (let i = 0; i < 4; i++) h.frame();
  expect(h.element.scrollTop).toBeGreaterThan(40);
  expect(h.moved()).toBe(4);
  expect(h.pending.size).toBe(1);
  h.controller.stop();
  expect(h.pending.size).toBe(0);
});

test('scroll limits end the frame loop', () => {
  const h = harness(25);
  h.controller.follow(200, 449);
  for (let i = 0; i < 10; i++) h.frame();
  expect(h.element.scrollTop).toBe(25);
  expect(h.moved()).toBe(3);
  expect(h.pending.size).toBe(0);
});

test('cancellation during the scroll callback cannot restart the frame loop', () => {
  const h = harness();
  h.onMove(() => h.controller.stop());
  h.controller.follow(200, 449);
  h.frame();
  expect(h.moved()).toBe(1);
  expect(h.pending.size).toBe(0);
});

test('a changed document or mode stops before the next scroll write', () => {
  const h = harness();
  h.controller.follow(200, 449);
  h.setActive(false);
  h.frame();
  expect(h.element.scrollTop).toBe(0);
  expect(h.pending.size).toBe(0);
});

test('center and outside pointers do not start scrolling', () => {
  const h = harness();
  h.controller.follow(200, 200);
  h.controller.follow(50, 449);
  h.controller.follow(800, 449);
  h.controller.follow(200, 500);
  expect(h.pending.size).toBe(0);
});

test('repeated edge events share one pending frame and moving inward stops it', () => {
  const h = harness();
  for (let i = 0; i < 50; i++) h.controller.follow(200, 449);
  expect(h.pending.size).toBe(1);
  h.controller.follow(200, 200);
  h.frame();
  expect(h.element.scrollTop).toBe(0);
  expect(h.pending.size).toBe(0);
});
