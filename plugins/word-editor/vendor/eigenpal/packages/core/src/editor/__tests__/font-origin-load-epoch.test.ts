import { afterEach, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import type { EditorFontError } from '../../contracts/editor.ts';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { docx } from './paginated-surface-fixtures.ts';

const catalog = ['Pending Public Sans'];
const editors: DocxEditorInstance[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

async function waitFor(check: () => boolean) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw Error('Real editor font-origin lifecycle did not settle');
}

function deferredOrigin(onFontError?: (error: EditorFontError) => void) {
  let rejectPending!: (reason: Error) => void;
  let pendingStarted = false;
  let completedFailure = false;
  const refusal = Error('Public deferred origin refused');
  const reports: EditorFontError[] = [];
  const events: unknown[] = [];
  const fontDiagnostics: unknown[] = [];
  const editor = createDocxEditor({
    document: 'blank',
    container: document.createElement('div'),
    fonts: (request) => {
      if (!request.families.includes(catalog[0]!)) return { supportedFamilies: catalog };
      pendingStarted = true;
      // An actual catalog-only provider enters the editor's composition path.
      // No font bytes, shaper override, or copied implementation is involved.
      return new Promise<never>((_resolve, reject) => {
        rejectPending = reject;
      }).finally(() => {
        completedFailure = true;
      });
    },
    onFontError: (error) => {
      reports.push(error);
      onFontError?.(error);
    },
  });
  editors.push(editor);
  editor.on('error', (error) => events.push(error));
  editor.on('diagnostic', (diagnostic) => {
    if (diagnostic.kind === 'font.failed') fontDiagnostics.push(diagnostic);
  });
  return {
    editor,
    reports,
    events,
    fontDiagnostics,
    async start() {
      await waitFor(() => !editor.fontMeasurement().resolving);
      expect(editor.getAvailableFonts()).toContain(catalog[0]!);
      expect(reports).toEqual([]);
      expect(
        editor.exec({ type: 'setMarkAttr', mark: 'fontFamily', attr: 'family', value: catalog[0]! })
          .ok
      ).toBe(true);
      await waitFor(() => pendingStarted);
      expect(editor.fontMeasurement().resolving).toBe(true);
    },
    async refuse() {
      rejectPending(refusal);
      await waitFor(() => completedFailure);
      // All composition continuations queued by the rejection drain before this
      // next event-loop turn; assertions observe the editor's actual dispatch.
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

function replacement(text: string) {
  return docx(`<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`);
}

async function expectSavedText(editor: DocxEditorInstance, text: string) {
  const files = unzipSync(new Uint8Array(await editor.save()));
  expect(strFromU8(files['word/document.xml']!)).toContain(text);
}

test('a deferred origin failure cannot report into a replacement document', async () => {
  const state = deferredOrigin();
  await state.start();
  state.editor.load(replacement('Replacement source text'));
  await waitFor(() => !state.editor.fontMeasurement().resolving);
  await state.refuse();
  expect(state.reports).toEqual([]);
  expect(state.events).toEqual([]);
  expect(state.fontDiagnostics).toEqual([]);
  expect(state.editor.fontMeasurement().measurer).toBe('fixed');
  expect(state.editor.surface!.session.bodyText()).toContain('Replacement source text');
  await expectSavedText(state.editor, 'Replacement source text');
});

test('a deferred origin failure stays silent after editor destruction', async () => {
  const state = deferredOrigin();
  await state.start();
  state.editor.destroy();
  await state.refuse();
  expect(state.reports).toEqual([]);
  expect(state.events).toEqual([]);
  expect(state.fontDiagnostics).toEqual([]);
  expect(state.editor.surface).toBeNull();
});

test('a current origin failure reports once without disabling editing or save', async () => {
  const state = deferredOrigin();
  await state.start();
  await state.refuse();
  await waitFor(() => !state.editor.fontMeasurement().resolving);
  expect(state.reports).toHaveLength(1);
  expect(state.reports[0]!.message).toContain('Public deferred origin refused');
  expect(state.events).toEqual([state.reports[0]]);
  expect(state.fontDiagnostics).toHaveLength(1);
  expect(state.editor.exec({ type: 'insertText', text: 'Current source text' }).ok).toBe(true);
  await expectSavedText(state.editor, 'Current source text');
  expect(state.reports).toHaveLength(1);
});

test('a callback that replaces the document cannot forward its old error event', async () => {
  let onRefusal = () => {};
  const state = deferredOrigin(() => onRefusal());
  const editor = state.editor;
  onRefusal = () => editor.load(replacement('Callback replacement'));
  await state.start();
  await state.refuse();
  await waitFor(() => !editor.fontMeasurement().resolving);
  expect(state.reports).toHaveLength(1);
  expect(state.events).toEqual([]);
  expect(state.fontDiagnostics).toEqual([]);
  expect(editor.surface!.session.bodyText()).toContain('Callback replacement');
  await expectSavedText(editor, 'Callback replacement');
});

test('a callback that destroys the editor cannot forward an error or revive its surface', async () => {
  let onRefusal = () => {};
  const state = deferredOrigin(() => onRefusal());
  const editor = state.editor;
  onRefusal = () => editor.destroy();
  await state.start();
  await state.refuse();
  expect(state.reports).toHaveLength(1);
  expect(state.events).toEqual([]);
  expect(state.fontDiagnostics).toEqual([]);
  expect(editor.surface).toBeNull();
});

test('a throwing current callback preserves the original diagnostic event', async () => {
  const state = deferredOrigin(() => {
    throw Error('Public observer failure');
  });
  await state.start();
  await state.refuse();
  await waitFor(() => !state.editor.fontMeasurement().resolving);
  expect(state.reports).toHaveLength(1);
  expect(state.events).toEqual([state.reports[0]]);
  expect(state.fontDiagnostics).toHaveLength(1);
  expect(state.reports[0]!.message).toContain('Public deferred origin refused');
  expect(state.editor.exec({ type: 'insertText', text: 'Usable current document' }).ok).toBe(true);
  await expectSavedText(state.editor, 'Usable current document');
});

test('an error listener that replaces the document cannot forward an old font diagnostic', async () => {
  const state = deferredOrigin();
  const editor = state.editor;
  editor.on('error', () => editor.load(replacement('Error listener replacement')));
  await state.start();
  await state.refuse();
  await waitFor(() => !editor.fontMeasurement().resolving);
  expect(state.reports).toHaveLength(1);
  expect(state.events).toEqual([state.reports[0]]);
  expect(state.fontDiagnostics).toEqual([]);
  expect(editor.surface!.session.bodyText()).toContain('Error listener replacement');
  await expectSavedText(editor, 'Error listener replacement');
});

test.each(['load', 'destroy'] as const)(
  'an error listener that calls %s prevents stale delivery to later listeners',
  async (action) => {
    const state = deferredOrigin();
    const later: unknown[] = [];
    state.editor.on('error', () => {
      if (action === 'load') state.editor.load(replacement('Listener replacement'));
      else state.editor.destroy();
    });
    state.editor.on('error', (error) => later.push(error));
    await state.start();
    await state.refuse();
    expect(state.reports).toHaveLength(1);
    expect(state.events).toEqual([state.reports[0]]);
    expect(later).toEqual([]);
    expect(state.fontDiagnostics).toEqual([]);
    if (action === 'load') {
      expect(state.editor.surface!.session.bodyText()).toContain('Listener replacement');
      await expectSavedText(state.editor, 'Listener replacement');
    } else {
      expect(state.editor.surface).toBeNull();
    }
  }
);
