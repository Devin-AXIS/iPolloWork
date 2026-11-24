import { autoScrollDelta } from './surface-drag-autoscroll.ts';
import type { HostTimers } from './host-realm.ts';

/** Bounded edge scrolling for a stationary drop pointer. */
export function createDropAutoScroll(options: {
  scroller(): HTMLElement | null;
  frames: Pick<HostTimers, 'requestAnimationFrame' | 'cancelAnimationFrame'>;
  active(): boolean;
  moved(): void;
}) {
  let frame: number | null = null;
  let x = 0;
  let y = 0;
  let generation = 0;
  function delta(element: HTMLElement): number {
    const box = element.getBoundingClientRect();
    if (x < box.left || x > box.right || y < box.top || y > box.bottom) return 0;
    return autoScrollDelta(box.top, box.bottom, y);
  }
  function tick() {
    frame = null;
    if (!options.active()) return;
    const element = options.scroller();
    if (!element) return;
    const step = delta(element);
    if (step === 0) return;
    const before = element.scrollTop;
    const current = generation;
    element.scrollTop += step;
    // Reaching the end must not keep a frame loop alive.
    if (element.scrollTop === before) return;
    options.moved();
    if (current === generation && options.active())
      frame = options.frames.requestAnimationFrame(tick);
  }
  return {
    follow(clientX: number, clientY: number) {
      x = clientX;
      y = clientY;
      const element = options.scroller();
      if (frame === null && options.active() && element && delta(element) !== 0) {
        frame = options.frames.requestAnimationFrame(tick);
      }
    },
    stop() {
      generation += 1;
      if (frame !== null) options.frames.cancelAnimationFrame(frame);
      frame = null;
    },
  };
}
