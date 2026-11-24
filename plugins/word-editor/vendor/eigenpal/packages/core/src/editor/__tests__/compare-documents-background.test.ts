// Compare documents in the background: the dialog session forwards progress, can stop a
// running compare, and never installs a result for a document that changed meanwhile.
//
// The background engine is a stub that answers with the revised bytes, so these tests prove
// the editor's half of the contract.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { collectReviewItems, readOoxmlPackage } from '@docx-editor.dev/core/store';
import type { EditorModule, ReviewModuleContribution } from '../../contracts/modules.ts';
import type { CompareDocumentsDialogSession } from '../../contracts/compare-documents.ts';
import { setPreviewWriteGuard } from '../refresh-write-guard.ts';
import type {
  CompareDocumentsBackgroundEngine,
  CompareDocumentsBackgroundResult,
  CompareDocumentsProgress,
} from '../../contracts/document-compare.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(text: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`
    ),
  });
}

/** A background engine the test finishes by hand. */
function heldEngine() {
  const calls: { original: Uint8Array; signal: AbortSignal; finish: () => void }[] = [];
  const engine: CompareDocumentsBackgroundEngine = (original, revised, _options, control) =>
    new Promise<CompareDocumentsBackgroundResult>((resolve, reject) => {
      control.onProgress({ phase: 'reading', fraction: 0 });
      control.onProgress({ phase: 'comparing', fraction: 0.1 });
      control.signal.addEventListener('abort', () => reject(control.signal.reason));
      calls.push({
        original,
        signal: control.signal,
        finish: () => resolve({ ok: true, bytes: revised, revisionCount: 2, changed: true }),
      });
    });
  return { engine, calls };
}

function reviewModule(review: Partial<ReviewModuleContribution> = {}): EditorModule {
  return {
    id: 'review',
    review: {
      displayModes: ['all-markup', 'proposed', 'original'],
      collectReviewItems,
      revisionItemsOfParagraph: () => [],
      compareDocuments: () => {
        throw new Error('the dialog must use the background engine');
      },
      createCompareDocumentsDialog: () => ({ open() {}, destroy() {} }),
      ...review,
    },
  };
}

let cleanup: () => void = () => {};
afterEach(() => cleanup());

function open(review: Partial<ReviewModuleContribution>): {
  editor: DocxEditorInstance;
  session: CompareDocumentsDialogSession;
  container: HTMLElement;
} {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: docx('Original text'),
    author: 'Reviewer',
    modules: [reviewModule(review)],
  });
  cleanup = () => {
    editor.destroy();
    container.remove();
  };
  let session: CompareDocumentsDialogSession | null = null;
  editor.setCompareDocumentsChrome({ onRequest: (s) => (session = s) });
  editor.exec({ type: 'openCompareDocumentsDialog' });
  return { editor, session: session!, container };
}

const bodyText = (editor: DocxEditorInstance) => editor.surface!.session.bodyText();
const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

test('the session compares in the background, reports each step, and installs one undo step', async () => {
  const { engine, calls } = heldEngine();
  const { editor, session } = open({ compareDocumentsInBackground: engine });
  expect(session.cancelable).toBe(true);
  const steps: CompareDocumentsProgress[] = [];
  const outcome = session.apply(
    { revised: docx('Revised text') },
    { onProgress: (step) => steps.push(step) }
  );
  await settle();
  expect(calls).toHaveLength(1);
  // The engine gets the open document as bytes.
  const original = readOoxmlPackage(calls[0]!.original);
  expect(original.ok).toBe(true);
  calls[0]!.finish();
  expect(await outcome).toEqual({ ok: true, revisionCount: 2, changed: true });
  expect(steps.map((step) => step.phase)).toEqual(['reading', 'comparing', 'applying']);
  expect(bodyText(editor)).toBe('Revised text');
  expect(editor.exec({ type: 'undo' }).ok).toBe(true);
  expect(bodyText(editor)).toBe('Original text');
});

test('cancel stops a running compare and changes nothing', async () => {
  const { engine, calls } = heldEngine();
  const { editor, session } = open({ compareDocumentsInBackground: engine });
  const steps: CompareDocumentsProgress[] = [];
  const outcome = session.apply(
    { revised: docx('Revised text') },
    { onProgress: (step) => steps.push(step) }
  );
  await settle();
  session.cancel();
  expect(calls[0]!.signal.aborted).toBe(true);
  expect(await outcome).toMatchObject({ ok: false, code: 'closed' });
  expect(bodyText(editor)).toBe('Original text');
  expect(editor.can({ type: 'undo' }).ok).toBe(false);
  // No step is reported once the dialog closed.
  expect(steps.every((step) => step.phase !== 'applying')).toBe(true);
});

test('a result for a document that changed meanwhile is not installed', async () => {
  const { engine, calls } = heldEngine();
  const { editor, session } = open({ compareDocumentsInBackground: engine });
  const outcome = session.apply({ revised: docx('Revised text') });
  await settle();
  editor.surface!.session.replacePackage(readOk(docx('Edited meanwhile')));
  calls[0]!.finish();
  // Its own code, so a dialog can say to compare again. The editor never retries by itself.
  expect(await outcome).toMatchObject({ ok: false, code: 'documentChanged' });
  expect(calls).toHaveLength(1);
  expect(bodyText(editor)).toBe('Edited meanwhile');
});

test('a second apply while a background compare runs answers busy', async () => {
  const { engine, calls } = heldEngine();
  const { session } = open({ compareDocumentsInBackground: engine });
  const first = session.apply({ revised: docx('Revised text') });
  await settle();
  expect(await session.apply({ revised: docx('Other text') })).toMatchObject({
    ok: false,
    code: 'busy',
  });
  expect(calls).toHaveLength(1);
  calls[0]!.finish();
  expect(await first).toEqual({ ok: true, revisionCount: 2, changed: true });
});

test('a preview that opens during a background compare blocks the install with busy', async () => {
  const { engine, calls } = heldEngine();
  const { editor, session, container } = open({ compareDocumentsInBackground: engine });
  const outcome = session.apply({ revised: docx('Revised text') });
  await settle();
  setPreviewWriteGuard(container, true);
  calls[0]!.finish();
  expect(await outcome).toMatchObject({ ok: false, code: 'busy' });
  setPreviewWriteGuard(container, false);
  expect(bodyText(editor)).toBe('Original text');
  expect(editor.can({ type: 'undo' }).ok).toBe(false);
});

test('an engine refusal keeps its code', async () => {
  const { session } = open({
    compareDocumentsInBackground: async () => ({
      ok: false,
      code: 'tooLarge',
      message: 'too large',
    }),
  });
  expect(await session.apply({ revised: docx('Revised text') })).toEqual({
    ok: false,
    code: 'tooLarge',
    message: 'too large',
  });
});

test('without a background engine, the session cannot stop a compare and reports no steps', async () => {
  const { session } = open({
    compareDocuments: (original) => ({
      ok: true,
      package: original,
      revisionCount: 0,
      changed: false,
    }),
  });
  expect(session.cancelable).toBe(false);
  const steps: CompareDocumentsProgress[] = [];
  await session.apply({ revised: docx('Revised text') }, { onProgress: (s) => steps.push(s) });
  expect(steps).toEqual([]);
  session.cancel();
});

test('the document takes focus after a compare that changed it, not after one that did not', async () => {
  const results = [
    { ok: true as const, bytes: null, revisionCount: 0, changed: false },
    { ok: true as const, bytes: docx('Revised text'), revisionCount: 2, changed: true },
  ];
  const { editor, session } = open({ compareDocumentsInBackground: async () => results.shift()! });
  let focused = 0;
  const surface = editor.surface!;
  const focus = surface.focus.bind(surface);
  surface.focus = () => {
    focused += 1;
    focus();
  };
  expect(await session.apply({ revised: docx('Original text') })).toMatchObject({ changed: false });
  expect(focused).toBe(0);
  expect(await session.apply({ revised: docx('Revised text') })).toMatchObject({ changed: true });
  expect(focused).toBe(1);
});

test('a worker that never starts falls back to the main thread compare', async () => {
  const { editor, session } = open({
    // A worker whose script is gone fails before its first progress message.
    compareDocumentsInBackground: async () => {
      throw new Error('The compare worker failed to run.');
    },
    compareDocuments: (_original, revised) => ({
      ok: true,
      package: readOk(revised),
      revisionCount: 2,
      changed: true,
    }),
  });
  expect(await session.apply({ revised: docx('Revised text') })).toEqual({
    ok: true,
    revisionCount: 2,
    changed: true,
  });
  expect(bodyText(editor)).toBe('Revised text');
});

test('a worker that fails after it started does not compare again on the main thread', async () => {
  let mainThread = 0;
  const { editor, session } = open({
    compareDocumentsInBackground: async (_original, _revised, _options, control) => {
      control.onProgress({ phase: 'reading', fraction: 0 });
      throw new Error('The compare worker failed to run: out of memory.');
    },
    compareDocuments: (original) => {
      mainThread += 1;
      return { ok: true, package: original, revisionCount: 0, changed: false };
    },
  });
  expect(await session.apply({ revised: docx('Revised text') })).toMatchObject({
    ok: false,
    code: 'failed',
  });
  expect(mainThread).toBe(0);
  expect(bodyText(editor)).toBe('Original text');
});

test('the compareDocuments command stays synchronous with a background engine', () => {
  const { engine, calls } = heldEngine();
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: docx('Original text'),
    modules: [
      reviewModule({
        compareDocumentsInBackground: engine,
        compareDocuments: (_original, revised) => ({
          ok: true,
          package: readOk(revised),
          revisionCount: 2,
          changed: true,
        }),
      }),
    ],
  });
  cleanup = () => {
    editor.destroy();
    container.remove();
  };
  const result = editor.exec({ type: 'compareDocuments', revised: docx('Revised text') });
  expect(result.compareDocuments).toEqual({ ok: true, revisionCount: 2, changed: true });
  expect(calls).toHaveLength(0);
});

function readOk(bytes: Uint8Array) {
  const read = readOoxmlPackage(bytes);
  if (!read.ok) throw new Error(read.reason);
  return read.package;
}
