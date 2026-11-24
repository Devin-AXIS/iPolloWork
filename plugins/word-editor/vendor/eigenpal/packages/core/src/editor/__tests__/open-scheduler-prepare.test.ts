// A large open runs in two tasks: one opens the bytes, the next mounts them.
//
// One task that parsed and laid out a long document froze the page for long enough to get it
// reported as unresponsive. These tests pin the order of the two tasks, `flush` on either side
// of the split, a failing first half, and single use of a prepared session.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import { sha256FontBytes } from '../../layout/index.ts';
import { createOpenScheduler, PREPARED_WORK_WAIT_MS } from '../docx-editor-open-scheduler.ts';
import { prepareOpen, takePreparedOpen } from '../docx-editor-prepared-open.ts';
import { createDocxEditor } from '../docx-editor.ts';
import { docx } from './paginated-surface-fixtures.ts';

const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));
const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

function recorder(
  options: {
    readonly failPrepare?: boolean;
    readonly work?: () => Promise<unknown> | (() => Promise<unknown>);
  } = {}
) {
  const events: string[] = [];
  const scheduler = createOpenScheduler({
    mount: () => events.push('mount'),
    prepare: () => {
      events.push('prepare');
      if (options.failPrepare) throw new Error('prepare failed');
      return options.work?.();
    },
    scheduled: () => events.push('scheduled'),
  });
  return { events, scheduler };
}

describe('open scheduler prepare task', () => {
  test('prepares in one task and mounts in a later one', async () => {
    const { events, scheduler } = recorder();
    scheduler.schedule(new Uint8Array(1));
    expect(events).toEqual(['scheduled']);
    await frame();
    await nextTask();
    expect(events).toEqual(['scheduled', 'prepare']);
    expect(scheduler.isScheduled()).toBe(true);
    await nextTask();
    expect(events).toEqual(['scheduled', 'prepare', 'mount', 'scheduled']);
    expect(scheduler.isScheduled()).toBe(false);
  });

  test('a load the mount starts stays scheduled after that mount ends', async () => {
    const events: string[] = [];
    let mounts = 0;
    const scheduler = createOpenScheduler({
      mount: () => {
        events.push('mount');
        mounts += 1;
        if (mounts === 1) scheduler.schedule(new Uint8Array(2));
      },
      scheduled: () => events.push('scheduled'),
    });
    scheduler.schedule(new Uint8Array(1));
    await frame();
    await nextTask();
    expect(mounts).toBe(1);
    // The first open ended at its mount; the second one is still the scheduler's to cancel.
    expect(scheduler.isScheduled()).toBe(true);
    expect(scheduler.cancel()).toEqual(new Uint8Array(2));
    await frame();
    await nextTask();
    expect(mounts).toBe(1);
  });

  test('flush before the prepare task mounts at once and never prepares', async () => {
    const { events, scheduler } = recorder();
    scheduler.schedule(new Uint8Array(1));
    scheduler.flush();
    await frame();
    await nextTask();
    await nextTask();
    expect(events).toEqual(['scheduled', 'mount']);
  });

  test('flush between the two tasks mounts once', async () => {
    const { events, scheduler } = recorder();
    scheduler.schedule(new Uint8Array(1));
    await frame();
    await nextTask();
    scheduler.flush();
    await nextTask();
    await nextTask();
    expect(events).toEqual(['scheduled', 'prepare', 'mount']);
  });

  test('a failing prepare still mounts, so the window cannot stay open', async () => {
    const { events, scheduler } = recorder({ failPrepare: true });
    scheduler.schedule(new Uint8Array(1));
    await frame();
    await nextTask();
    await nextTask();
    expect(events).toEqual(['scheduled', 'prepare', 'mount', 'scheduled']);
    expect(scheduler.isScheduled()).toBe(false);
  });

  test('cancel between the two tasks drops the mount', async () => {
    const { events, scheduler } = recorder();
    const bytes = new Uint8Array(1);
    scheduler.schedule(bytes);
    await frame();
    await nextTask();
    expect(scheduler.cancel()).toBe(bytes);
    await nextTask();
    expect(events).toEqual(['scheduled', 'prepare']);
  });
});

describe('prepared open', () => {
  test('is taken once, for the exact bytes object', () => {
    const bytes = docx('<w:p><w:r><w:t>prepared</w:t></w:r></w:p>');
    prepareOpen(bytes, {});
    expect(takePreparedOpen(bytes.slice()).openedSession).toBeUndefined();
    expect(takePreparedOpen(bytes).openedSession?.ok).toBe(true);
    expect(takePreparedOpen(bytes).openedSession).toBeUndefined();
  });

  test('a mount uses the prepared session instead of opening the bytes again', () => {
    const bytes = docx('<w:p><w:r><w:t>prepared body</w:t></w:r></w:p>');
    prepareOpen(bytes, {});
    const container = document.createElement('div');
    const editor = createDocxEditor({ container, document: bytes });
    expect(takePreparedOpen(bytes).openedSession).toBeUndefined();
    expect(container.textContent).toContain('prepared body');
    editor.destroy();
  });

  test('a prepared failure reports exactly as an unprepared one', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const unprepared = createDocxEditor({
      container: document.createElement('div'),
      document: bytes,
    });
    prepareOpen(bytes, {});
    const prepared = createDocxEditor({
      container: document.createElement('div'),
      document: bytes,
    });
    expect(prepared.snapshot().parseError).toBe(unprepared.snapshot().parseError);
    expect(prepared.snapshot().parseError).not.toBeNull();
    unprepared.destroy();
    prepared.destroy();
  });
});

describe('prepare work the mount waits for', () => {
  test('the mount starts after the work settles', async () => {
    let settle: () => void = () => {};
    const { events, scheduler } = recorder({
      work: () => new Promise<void>((resolve) => (settle = resolve)),
    });
    scheduler.schedule(new Uint8Array(1));
    await frame();
    await nextTask();
    await nextTask();
    expect(events).toEqual(['scheduled', 'prepare']);
    settle();
    await nextTask();
    await nextTask();
    expect(events).toEqual(['scheduled', 'prepare', 'mount', 'scheduled']);
  });

  test('work that never settles delays the mount by the wait limit only', async () => {
    const { events, scheduler } = recorder({ work: () => new Promise(() => {}) });
    scheduler.schedule(new Uint8Array(1));
    await frame();
    await nextTask();
    expect(events).toEqual(['scheduled', 'prepare']);
    await new Promise((resolve) => setTimeout(resolve, PREPARED_WORK_WAIT_MS + 50));
    expect(events).toEqual(['scheduled', 'prepare', 'mount', 'scheduled']);
  });

  test('a follow-up step runs in its own task, and the wait starts after it', async () => {
    // The facade runs its font scan as a follow-up step after the parse. A scan that blocks
    // for longer than the wait must still leave the mount waiting for the work it starts.
    let settle: () => void = () => {};
    const { events, scheduler } = recorder({
      work: () => () => {
        events.push('scan');
        const until = performance.now() + PREPARED_WORK_WAIT_MS + 100;
        while (performance.now() < until) {
          // The scan.
        }
        return new Promise<void>((resolve) => (settle = resolve));
      },
    });
    scheduler.schedule(new Uint8Array(1));
    await frame();
    await nextTask();
    expect(events).toEqual(['scheduled', 'prepare']);
    await nextTask();
    expect(events).toEqual(['scheduled', 'prepare', 'scan']);
    await nextTask();
    await nextTask();
    expect(events).toEqual(['scheduled', 'prepare', 'scan']);
    settle();
    await nextTask();
    await nextTask();
    expect(events).toEqual(['scheduled', 'prepare', 'scan', 'mount', 'scheduled']);
  }, 10_000);

  test('cancel while waiting means the settled work mounts nothing', async () => {
    let settle: () => void = () => {};
    const { events, scheduler } = recorder({
      work: () => new Promise<void>((resolve) => (settle = resolve)),
    });
    scheduler.schedule(new Uint8Array(1));
    await frame();
    await nextTask();
    scheduler.cancel();
    settle();
    await nextTask();
    await nextTask();
    expect(events).toEqual(['scheduled', 'prepare']);
  });
});

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const regularBytes = new Uint8Array(
  readFileSync(new URL('../../layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url))
);
const dejaVu = {
  sources: [
    {
      request: { family: 'DejaVu Sans', weight: 400, style: 'normal' as const },
      id: 'prepared-open-dejavu',
      bytes: regularBytes,
      hash: sha256FontBytes(regularBytes),
      faceIndex: 0,
    },
  ],
};

/** A document in DejaVu Sans whose content is past the open-yield threshold. */
function largeDocument(): Uint8Array {
  const lines: string[] = [];
  for (let line = 1, total = 0; total < 700 * 1024; line += 1) {
    const text = `<l>filler line ${line} carrying a little ordinary sentence text.</l>`;
    lines.push(text);
    total += text.length;
  }
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:rPr><w:rFonts w:ascii="DejaVu Sans" w:hAnsi="DejaVu Sans"/></w:rPr><w:t>shaped body</w:t></w:r></w:p></w:body></w:document>`
    ),
    'customXml/item1.xml': strToU8(`<filler>${lines.join('')}</filler>`),
  });
}

async function until(check: () => boolean, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition not reached in time');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('fonts for a large open', () => {
  test('resolve before the mount, so the document is laid out once, already shaped', async () => {
    const requests: (readonly string[])[] = [];
    const editor = createDocxEditor({
      document: largeDocument(),
      fonts: (request) => {
        requests.push(request.families);
        return dejaVu;
      },
    });
    // Shaped fonts are not reported before the document they belong to is mounted. Checked on
    // every notification, because the window between the two tasks is too short to poll.
    const early: string[] = [];
    editor.on('selectionChange', () => {
      const { measurer } = editor.fontMeasurement();
      if (editor.surface === null && measurer === 'shaped') early.push(measurer);
    });
    const container = document.createElement('div');
    editor.attach(container);
    expect(editor.snapshot().isOpening).toBe(true);
    await until(() => editor.surface !== null && !editor.fontMeasurement().resolving);
    expect(early).toEqual([]);
    expect(editor.fontMeasurement().measurer).toBe('shaped');
    expect(editor.surface!.state().perf.fullPasses).toBe(1);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain('DejaVu Sans');
    expect(container.textContent).toContain('shaped body');
    editor.destroy();
  });

  test('fonts slower than the wait limit still apply after the mount', async () => {
    const editor = createDocxEditor({
      document: largeDocument(),
      fonts: () =>
        new Promise((resolve) => setTimeout(() => resolve(dejaVu), PREPARED_WORK_WAIT_MS + 300)),
    });
    editor.attach(document.createElement('div'));
    await until(() => editor.surface !== null);
    expect(editor.fontMeasurement()).toMatchObject({ measurer: 'fixed', resolving: true });
    await until(() => !editor.fontMeasurement().resolving);
    expect(editor.fontMeasurement().measurer).toBe('shaped');
    expect(editor.surface!.state().perf.fullPasses).toBe(2);
    editor.destroy();
  });
});
