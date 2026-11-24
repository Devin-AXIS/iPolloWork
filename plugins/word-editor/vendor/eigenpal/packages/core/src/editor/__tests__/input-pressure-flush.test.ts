// The keystroke flush split at the transact/layout seam under input pressure.
//
// A commit used to be one unyielding task: transact, synchronous layout, paint. When the
// browser reports queued input (`navigator.scheduling.isInputPending`) AND the previous
// layout pass was expensive, the commit tail now leaves layout to the scheduler's own
// `setTimeout(0)` backstop, and `renderPublishedLayout` may defer paint to a third task.
// These tests pin three things: the deferral engages only under both conditions, every
// synchronous reader still sees fresh geometry at its own seam, and the IME lane flushes
// all the way to PAINT before it hands the DOM to a composition.
//
// The pressure stub follows selection-integrity.test.ts; the "expensive layout" half is a
// monotonic `performance.now` stub, so every measured pass reads as 10 ms — above the 8 ms
// deferral floor — without depending on real machine speed.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import type { PaginatedSurface } from '../paginated-surface.ts';
import { mount, paragraph, putCaret } from './paginated-surface-fixtures.ts';

afterEach(() => {
  document.getSelection()?.removeAllRanges();
});

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Queued browser input, for as long as the returned restore has not run. */
function stubInputPending(): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(window.navigator, 'scheduling');
  Object.defineProperty(window.navigator, 'scheduling', {
    configurable: true,
    value: { isInputPending: () => true },
  });
  return () => {
    if (descriptor) Object.defineProperty(window.navigator, 'scheduling', descriptor);
    else delete (window.navigator as Navigator & { scheduling?: unknown }).scheduling;
  };
}

/**
 * Every measured span reads as `stepMs`: the surface computes `now() - began`, and this
 * clock advances one step per call. `0` makes every pass read as free, which pins the
 * synchronous path even under pressure.
 */
function stubClock(stepMs: number): () => void {
  const original = performance.now;
  let tickCount = 0;
  performance.now = () => {
    tickCount += 1;
    return tickCount * stepMs;
  };
  return () => {
    performance.now = original;
  };
}

function paintedText(container: HTMLElement): string {
  return container.querySelector('.docx-pages')?.textContent ?? '';
}

/** The IME rewriting a paragraph's painted spans, the way a browser does mid-composition. */
function repaintParagraphAs(container: HTMLElement, paragraphId: string, text: string): void {
  const spans = [...container.querySelectorAll('[data-paragraph-id][data-start]')].filter(
    (element) => (element as HTMLElement).dataset.paragraphId === paragraphId
  ) as HTMLElement[];
  if (spans.length === 0) throw new Error(`no painted span for ${paragraphId}`);
  spans[0]!.textContent = text;
  for (const extra of spans.slice(1)) extra.textContent = '';
}

function keystroke(container: HTMLElement, data: string): void {
  container.querySelector('.docx-pages')!.dispatchEvent(
    new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data,
    })
  );
}

function withPressureAndExpensiveLayout(
  run: (surface: PaginatedSurface, container: HTMLElement) => void | Promise<void>
): Promise<void> {
  const restorePressure = stubInputPending();
  const restoreClock = stubClock(10);
  const { surface, container } = mount(paragraph('tail'));
  document.body.append(container);
  return Promise.resolve(run(surface, container)).finally(() => {
    surface.destroy();
    container.remove();
    restoreClock();
    restorePressure();
  });
}

describe('commit-tail layout deferral under input pressure', () => {
  test('an expensive commit under pressure defers layout to its own task, then paints', async () => {
    await withPressureAndExpensiveLayout(async (surface, container) => {
      putCaret(surface, 0);
      const revisionBefore = surface.publishedLayout().revision;

      surface.type('a');

      // The model moved; the published layout did not — the flush task ended at the transact.
      expect(surface.session.bodyText()).toBe('atail');
      expect(surface.publishedLayout().revision).toBe(revisionBefore);

      // The scheduler's setTimeout(0) backstop runs layout+publish as its own task.
      await tick();
      expect(surface.publishedLayout().revision).toBeGreaterThan(revisionBefore);

      // Paint may defer to a third task under sustained pressure, but it lands.
      await tick();
      expect(paintedText(container)).toContain('atail');
      expect(surface.state().perf.staleDiscards).toBe(0);
    });
  });

  test('a beforeinput burst under pressure lands in order with a fresh final paint', async () => {
    await withPressureAndExpensiveLayout(async (surface, container) => {
      putCaret(surface, 0);
      for (const digit of '123') keystroke(container, digit);
      await tick(); // type-buffer flush → one transact, layout deferred
      await tick(); // scheduler backstop → publish
      await tick(); // deferred paint
      expect(surface.session.bodyText()).toBe('123tail');
      expect(surface.state().selection.head.offset).toBe(3);
      expect(paintedText(container)).toContain('123tail');
      expect(surface.state().perf.staleDiscards).toBe(0);
    });
  });

  test('geometry readers flush the deferred pass at their own seam', async () => {
    await withPressureAndExpensiveLayout((surface) => {
      putCaret(surface, 0);
      const revisionBefore = surface.publishedLayout().revision;
      surface.type('a');
      expect(surface.publishedLayout().revision).toBe(revisionBefore);

      // `layout()` is the contract's geometry read: it must return the committed revision.
      expect(surface.layout().revision).toBeGreaterThan(revisionBefore);
    });
  });

  test('flushPendingInput lands buffered text AND the deferred layout pass', async () => {
    await withPressureAndExpensiveLayout((surface, container) => {
      putCaret(surface, 0);
      const revisionBefore = surface.publishedLayout().revision;
      keystroke(container, 'z');
      surface.flushPendingInput();
      expect(surface.session.bodyText()).toBe('ztail');
      expect(surface.publishedLayout().revision).toBeGreaterThan(revisionBefore);
    });
  });

  test('navigate reads the layout that includes the deferred edit', async () => {
    await withPressureAndExpensiveLayout((surface) => {
      putCaret(surface, 0);
      surface.type('a'); // caret at offset 1, layout deferred
      surface.navigate('right');
      expect(surface.state().selection.head.offset).toBe(2);
    });
  });

  test('undo after a deferred commit rewinds the document cleanly', async () => {
    await withPressureAndExpensiveLayout(async (surface, container) => {
      putCaret(surface, 0);
      surface.type('a');
      surface.undo();
      expect(surface.session.bodyText()).toBe('tail');
      await tick();
      await tick();
      expect(paintedText(container)).toContain('tail');
      expect(paintedText(container)).not.toContain('atail');
      expect(surface.state().perf.staleDiscards).toBe(0);
    });
  });

  test('compositionstart flushes to PAINT, so the readback diffs against the committed text', async () => {
    await withPressureAndExpensiveLayout((surface, container) => {
      const id = surface.session.paragraphIds()[0]!;
      putCaret(surface, 0);
      surface.type('X'); // deferred: the painted DOM still reads 'tail'
      expect(paintedText(container)).not.toContain('Xtail');

      const pages = container.querySelector('.docx-pages')!;
      pages.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      // The handover flushed buffer, layout and paint: the IME composes over 'Xtail'.
      expect(paintedText(container)).toContain('Xtail');

      // The IME writes at the caret (after 'X') and only then says it is finished.
      repaintParagraphAs(container, id, 'X中tail');
      pages.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
      surface.flushPendingInput();

      // The diff is exactly the composed character — not the deferred 'X' read back twice.
      expect(surface.session.bodyText()).toBe('X中tail');
      expect(surface.state().perf.staleDiscards).toBe(0);
    });
  });
});

describe('refusals and pressure', () => {
  test('a REFUSED commit under pressure still flushes in-task and reports its refusal', async () => {
    const restorePressure = stubInputPending();
    const restoreClock = stubClock(10);
    const container = document.createElement('div');
    document.body.append(container);
    let changes = 0;
    const { mountPaginatedSurface } = await import('../paginated-surface.ts');
    const { docx } = await import('./paginated-surface-fixtures.ts');
    const opened = mountPaginatedSurface(container, docx(paragraph('tail')), {
      scale: 1,
      onChange: () => {
        changes += 1;
      },
    });
    if (!opened.ok) throw new Error(opened.reason);
    const surface = opened.surface;
    try {
      putCaret(surface, 0);
      surface.type('a'); // leaves a deferred pass pending in the shared accumulator
      const revisionBefore = surface.publishedLayout().revision;
      const changesBefore = changes;

      // A staged-ops build that returns null is a refusal that commits nothing. The
      // shared accumulator still holds the typed commit's pass, so without the rejected
      // gate the tail deferred — and the render that reports `lastRejection` with it.
      surface.applyAutomationOps(() => null);

      expect(surface.state().lastRejection).not.toBeNull();
      // The refusal's synchronous flush landed the earlier deferred pass in-task; only
      // the paint may still ride the pre-existing paint deferral one task.
      expect(surface.publishedLayout().revision).toBeGreaterThan(revisionBefore);
      await tick();
      expect(changes).toBeGreaterThan(changesBefore);
      expect(surface.state().lastRejection).not.toBeNull();
    } finally {
      surface.destroy();
      container.remove();
      restoreClock();
      restorePressure();
    }
  });
});

describe('the deferral lane stays off outside its two conditions', () => {
  test('without navigator.scheduling an expensive commit stays fully synchronous', () => {
    const restoreClock = stubClock(10);
    const { surface, container } = mount(paragraph('tail'));
    document.body.append(container);
    try {
      putCaret(surface, 0);
      const revisionBefore = surface.publishedLayout().revision;
      surface.type('a');
      // No scheduling API (happy-dom, servers): layout and paint land inside the commit.
      expect(surface.publishedLayout().revision).toBeGreaterThan(revisionBefore);
      expect(paintedText(container)).toContain('atail');
    } finally {
      surface.destroy();
      container.remove();
      restoreClock();
    }
  });

  test('under pressure a CHEAP layout still flushes synchronously', () => {
    const restorePressure = stubInputPending();
    const restoreClock = stubClock(0);
    const { surface, container } = mount(paragraph('tail'));
    document.body.append(container);
    try {
      putCaret(surface, 0);
      const revisionBefore = surface.publishedLayout().revision;
      surface.type('a');
      // Below the deferral floor the task split costs more than the pass: keep today's chain.
      expect(surface.publishedLayout().revision).toBeGreaterThan(revisionBefore);
    } finally {
      surface.destroy();
      container.remove();
      restoreClock();
      restorePressure();
    }
  });
});
