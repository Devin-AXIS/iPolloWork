// Performance summaries: the editor reports how fast it responds as one anonymous summary per
// window, never one event per key press. The sampler tests drive a fake clock; the editor tests
// press keys on a real editor and read the summary a module receives.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import type { EditorDiagnostic, PerformanceDiagnostic } from '../../contracts/diagnostics.ts';
import { createDocxEditor } from '../docx-editor.ts';
import {
  TIMING_BANDS_MS,
  createPerformanceSampler,
  type PerformanceClock,
} from '../editor-performance.ts';

function fakeClock() {
  let time = 1_000;
  const frames: { onFrame: () => void; onPainted: () => void }[] = [];
  let painting: (() => void)[] = [];
  const timers = new Map<number, { at: number; run: () => void }>();
  let nextTimer = 1;
  const clock: PerformanceClock = {
    now: () => time,
    afterNextFrame(onFrame, onPainted) {
      frames.push({ onFrame, onPainted });
      return true;
    },
    setTimer(run, ms) {
      const id = nextTimer++;
      timers.set(id, { at: time + ms, run });
      return id;
    },
    clearTimer: (id) => void timers.delete(id as number),
  };
  return {
    clock,
    advance(ms: number) {
      time += ms;
      for (const [id, timer] of [...timers])
        if (timer.at <= time) {
          timers.delete(id);
          timer.run();
        }
    },
    /** The next frame starts `ms` from now, before it is painted. */
    frameStart(ms = 0) {
      time += ms;
      for (const frame of frames.splice(0)) {
        frame.onFrame();
        painting.push(frame.onPainted);
      }
    },
    /** The started frame is on screen `ms` from now. */
    painted(ms = 0) {
      time += ms;
      const done = painting;
      painting = [];
      for (const onPainted of done) onPainted();
    },
    /** The next frame reaches the screen `ms` from now. */
    frame(ms: number) {
      this.frameStart(ms);
      this.painted();
    },
  };
}

function sampler(enabled = () => true) {
  const sent: Omit<PerformanceDiagnostic, 'schemaVersion' | 'editorSessionId' | 'time'>[] = [];
  const time = fakeClock();
  const instance = createPerformanceSampler({
    deliver: (payload) => sent.push(payload),
    enabled,
    windowMs: 60_000,
    clock: time.clock,
  });
  return { sent, time, instance };
}

describe('performance sampler', () => {
  test('one summary per window, with exact counts, bands, and maximum', () => {
    const { sent, time, instance } = sampler();
    for (const ms of [4, 10, 20, 40, 80, 150, 300, 700, 1500]) instance.timing('layout', ms);
    instance.timing('paint', 12, () => 42);
    expect(sent).toEqual([]);
    time.advance(60_000);
    expect(sent).toHaveLength(1);
    const [summary] = sent;
    expect(summary!.kind).toBe('performance');
    expect(summary!.windowMs).toBe(60_000);
    expect(summary!.pagesBucket).toBe('10-99');
    expect(summary!.layout).toEqual({
      count: 9,
      p50Ms: 80,
      p95Ms: 1500,
      maxMs: 1500,
      bands: [2, 1, 1, 1, 1, 1, 1, 1],
    });
    expect(summary!.paint?.count).toBe(1);
    expect(summary!.interaction).toBeUndefined();
    expect(summary!.code).toBeUndefined();
    expect(summary!.layout!.bands).toHaveLength(TIMING_BANDS_MS.length + 1);
    // Nothing measured since: no second summary.
    time.advance(120_000);
    expect(sent).toHaveLength(1);
  });

  test('a press is timed from its event timestamp to the next frame on screen', () => {
    const { sent, time, instance } = sampler();
    instance.timing('input', 990);
    time.frame(25);
    instance.flush();
    expect(sent[0]!.interaction).toMatchObject({ count: 1, p50Ms: 35, maxMs: 35 });
  });

  test('presses queued behind slow work each count with their full delay', () => {
    const { sent, time, instance } = sampler();
    instance.timing('input', 1_000);
    time.advance(100);
    instance.timing('input', 1_100);
    time.advance(100);
    instance.timing('input', 1_200);
    time.frame(30);
    instance.flush();
    expect(sent[0]!.interaction).toMatchObject({ count: 3, maxMs: 230, p50Ms: 130 });
  });

  test('a press after a frame starts waits for the next frame', () => {
    const { sent, time, instance } = sampler();
    instance.timing('input', 1_000);
    time.frameStart(10);
    instance.timing('input', time.clock.now());
    time.painted(5);
    time.frame(16);
    instance.flush();
    expect(sent[0]!.interaction).toMatchObject({ count: 2, p50Ms: 15, maxMs: 21 });
  });

  test('a press waiting while the page is hidden is dropped, and a later one still counts', () => {
    const { sent, time, instance } = sampler();
    instance.timing('input', 1_000);
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    // An own property shadows the prototype's getter; deleting it leaves `document` as found.
    delete (document as { visibilityState?: unknown }).visibilityState;
    instance.timing('input', time.clock.now());
    time.frame(20_000);
    instance.flush();
    expect(sent.at(-1)!.interaction).toMatchObject({ count: 1, maxMs: 20_000 });
  });

  test('a few slow presses are too few for the slow code', () => {
    const { sent, time, instance } = sampler();
    for (let press = 0; press < 19; press += 1) {
      instance.timing('input', time.clock.now());
      time.frame(400);
    }
    instance.flush();
    expect(sent[0]!.interaction?.p95Ms).toBe(400);
    expect(sent[0]!.code).toBeUndefined();
  });

  test('a slow 95th percentile of presses carries a code with a hint', () => {
    const { sent, time, instance } = sampler();
    for (let press = 0; press < 20; press += 1) {
      instance.timing('input', time.clock.now());
      time.frame(press < 18 ? 20 : 400);
    }
    instance.flush();
    expect(sent[0]!.code).toBe('performance.slow-interaction');
  });

  test('a timestamp from another clock falls back to the time the press was heard', () => {
    const { sent, time, instance } = sampler();
    instance.timing('input', 9_999_999);
    time.frame(16);
    instance.flush();
    expect(sent[0]!.interaction?.maxMs).toBe(16);
  });

  test('nothing is measured while no one listens', () => {
    const { sent, time, instance } = sampler(() => false);
    instance.timing('layout', 10);
    instance.timing('input', 1_000);
    time.frame(20);
    instance.flush();
    expect(sent).toEqual([]);
  });

  test('dispose sends the last summary once and stops', () => {
    const { sent, instance } = sampler();
    instance.timing('paint', 8);
    instance.dispose();
    instance.timing('paint', 8);
    instance.dispose();
    expect(sent).toHaveLength(1);
  });

  test('a long window keeps bounded samples and exact counts', () => {
    const { sent, instance } = sampler();
    for (let pass = 0; pass < 10_000; pass += 1) instance.timing('layout', pass % 100);
    instance.flush();
    const layout = sent[0]!.layout!;
    expect(layout.count).toBe(10_000);
    expect(layout.maxMs).toBe(99);
    expect(layout.bands.reduce((sum, count) => sum + count, 0)).toBe(10_000);
    expect(layout.p50Ms).toBeGreaterThan(30);
    expect(layout.p50Ms).toBeLessThan(70);
  });
});

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const SECRET_TEXT = 'Quarterly figures for the board';

function docx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>${SECRET_TEXT}</w:t></w:r></w:p></w:body></w:document>`
    ),
  });
}

const nextFrame = () => new Promise<void>((resolve) => setTimeout(resolve, 50));

describe('editor performance', () => {
  test('typing on a real editor yields one anonymous summary when it is destroyed', async () => {
    const events: EditorDiagnostic[] = [];
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = createDocxEditor({
      container,
      document: docx(),
      modules: [{ id: 'observer', onDiagnostic: (event) => events.push(event) }],
    });
    try {
      const pages = container.querySelector('[contenteditable="true"]');
      expect(pages).not.toBeNull();
      pages!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
      await nextFrame();
      expect(editor.exec({ type: 'insertText', text: 'x' }).ok).toBe(true);
      expect(events.filter((event) => event.kind === 'performance')).toEqual([]);
    } finally {
      editor.destroy();
      container.remove();
    }
    const summaries = events.filter((event) => event.kind === 'performance');
    expect(summaries).toHaveLength(1);
    const [summary] = summaries as PerformanceDiagnostic[];
    expect(summary!.interaction?.count).toBe(1);
    expect(summary!.layout?.count).toBeGreaterThan(0);
    expect(summary!.paint?.count).toBeGreaterThan(0);
    expect(summary!.pagesBucket).toBe('1');
    expect(JSON.stringify(summaries)).not.toContain(SECRET_TEXT.split(' ')[0]);
    expect(JSON.stringify(summaries)).not.toContain('End');
  });

  test('an editor no one observes measures nothing', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = createDocxEditor({ container, document: docx() });
    const events: EditorDiagnostic[] = [];
    try {
      editor.exec({ type: 'insertText', text: 'x' });
    } finally {
      // A handler added at the end hears the summary only if timings were collected before.
      editor.on('diagnostic', (event) => events.push(event));
      editor.destroy();
      container.remove();
    }
    expect(events).toEqual([]);
  });
});

test('a module that does not want performance turns the measuring off', async () => {
  const events: EditorDiagnostic[] = [];
  const container = document.createElement('div');
  document.body.appendChild(container);
  const editor = createDocxEditor({
    container,
    document: docx(),
    modules: [
      {
        id: 'failures-only',
        onDiagnostic: (event) => events.push(event),
        wantsDiagnostic: (kind) => kind !== 'performance',
      },
    ],
  });
  try {
    container
      .querySelector('[contenteditable="true"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    await nextFrame();
    editor.exec({ type: 'insertText', text: 'x' });
  } finally {
    editor.destroy();
    container.remove();
  }
  expect(events.filter((event) => event.kind === 'performance')).toEqual([]);
  expect(events.some((event) => event.kind === 'document.open')).toBe(true);
});
