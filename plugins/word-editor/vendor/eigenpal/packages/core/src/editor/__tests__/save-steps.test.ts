// Saving runs in short tasks so a long document saves without freezing the page. These tests
// cover the slice driver and the snapshot rule: a save describes the document as it was when
// the save was requested, whatever happens while it runs.
import { expect, test } from 'bun:test';
import { createDocxEditor } from '../docx-editor.ts';
import { queueTask, runStepsInSlices } from '../sliced-steps.ts';
import { docx } from './paginated-surface-fixtures.ts';

const anyWindow = globalThis as unknown as Window;

function* busySteps(count: number, stepMs: number): Generator<void, string> {
  for (let index = 0; index < count; index += 1) {
    const end = performance.now() + stepMs;
    while (performance.now() < end) {
      // Stand-in for a slice of serialization.
    }
    yield;
  }
  return 'done';
}

test('long work gives queued tasks a turn before it finishes', async () => {
  const events: string[] = [];
  const work = runStepsInSlices(busySteps(12, 2), null, 4).then((value) => {
    events.push(value);
  });
  queueTask(() => events.push('task'), anyWindow);
  await work;
  expect(events).toEqual(['task', 'done']);
});

test('work that fits in one slice finishes without waiting for a task', async () => {
  const events: string[] = [];
  const work = runStepsInSlices(busySteps(2, 0), null, 1000).then((value) => {
    events.push(value);
  });
  queueTask(() => events.push('task'), anyWindow);
  await work;
  expect(events).toEqual(['done']);
});

test('a step that throws rejects the work', async () => {
  function* failing(): Generator<void, never> {
    yield;
    throw new Error('step failed');
  }
  await expect(runStepsInSlices(failing(), null, 0)).rejects.toThrow('step failed');
});

function open(body: string) {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: docx(body) });
  return {
    editor,
    text: () => editor.surface!.session.bodyText(),
    dispose() {
      editor.destroy();
      container.remove();
    },
  };
}

test('a save in progress keeps the document it captured while editing continues', async () => {
  const host = open('<w:p><w:r><w:t>before</w:t></w:r></w:p>');
  try {
    const surface = host.editor.surface!;
    const steps = surface.saveSteps();
    steps.next();
    const paragraphId = surface.session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId, offset: 6 },
      head: { paragraphId, offset: 6 },
    });
    surface.pasteRich(' after', null);
    expect(host.text()).toBe('before after');

    let next = steps.next();
    while (!next.done) next = steps.next();
    const later = await host.editor.save();

    host.editor.load(next.value);
    expect(host.text()).toBe('before');
    host.editor.load(new Uint8Array(later));
    expect(host.text()).toBe('before after');
  } finally {
    host.dispose();
  }
});
