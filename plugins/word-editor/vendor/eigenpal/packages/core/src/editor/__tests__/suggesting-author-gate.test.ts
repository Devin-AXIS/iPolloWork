import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { serializeOoxmlPart } from '../../store/index.ts';
import type { EditorError } from '../../contracts/editor.ts';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import {
  createSuggestingConfigurationReporter,
  PRO_REVIEW_REASON,
  SUGGESTING_AUTHOR_REASON,
  suggestingModeRefusal,
} from '../opening-editing-mode.ts';
import { toolbarCommandState } from '../toolbar-commands.ts';
import { docx, paragraph, trackedDocx } from './paginated-surface-fixtures.ts';
import { stubReviewModule } from './review-test-module.ts';

// Issue #692: enabling suggesting without an author used to SUCCEED, and then every keystroke
// was refused with a reason nothing showed — the document took focus and typing did nothing.
// The request is a host configuration error, so it is refused with the reason, mirrored by
// `can` (and so by the toolbar's Suggesting item), remembered until an author arrives, and
// raised once through the error channel for a host that never reads the result.

const DOCUMENT_TRACKING_AUTHOR_REASON =
  'this document asks for tracked changes, but no author is configured';

const errors: string[] = [];
const realError = console.error;
let editors: DocxEditorInstance[] = [];
let containers: HTMLElement[] = [];

beforeEach(() => {
  errors.length = 0;
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  };
});

afterEach(() => {
  console.error = realError;
  for (const editor of editors) editor.destroy();
  for (const container of containers) container.remove();
  editors = [];
  containers = [];
});

/** The reporter raises from a task, so the report is observed after one. */
const afterReport = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function mount(config: {
  author?: string;
  mode?: 'edit' | 'view' | 'suggesting';
  document?: Uint8Array;
  review?: boolean;
}): DocxEditorInstance {
  const container = document.createElement('div');
  document.body.append(container);
  containers.push(container);
  const editor = createDocxEditor({
    container,
    document: config.document ?? 'blank',
    ...(config.author === undefined ? {} : { author: config.author }),
    ...(config.mode === undefined ? {} : { mode: config.mode }),
    modules: config.review === false ? [] : [stubReviewModule()],
  });
  editors.push(editor);
  return editor;
}

describe('the decision helpers', () => {
  test('suggestingModeRefusal asks for the module before the author', () => {
    expect(suggestingModeRefusal({ reviewEnabled: false, hasAuthor: false })).toEqual({
      ok: false,
      code: 'unsupported',
      reason: PRO_REVIEW_REASON,
    });
    expect(suggestingModeRefusal({ reviewEnabled: true, hasAuthor: false })).toEqual({
      ok: false,
      code: 'invalidArgs',
      reason: SUGGESTING_AUTHOR_REASON,
    });
    expect(suggestingModeRefusal({ reviewEnabled: true, hasAuthor: true })).toBeNull();
  });

  test('the reporter raises the host error once, deferred, and only the host error', async () => {
    const emitted: EditorError[] = [];
    const lines: string[] = [];
    let missing = true;
    const reporter = createSuggestingConfigurationReporter({
      stillMissing: () => missing,
      emit: (error) => emitted.push(error),
      log: (message) => lines.push(message),
    });
    reporter.report(null);
    reporter.report(PRO_REVIEW_REASON);
    reporter.report(DOCUMENT_TRACKING_AUTHOR_REASON);
    await afterReport();
    expect(emitted).toEqual([]);

    // Resolved before the task runs: nothing to report.
    reporter.report(SUGGESTING_AUTHOR_REASON);
    missing = false;
    await afterReport();
    expect(emitted).toEqual([]);

    // Still missing when the task runs: raised once, on the event AND the console.
    missing = true;
    reporter.report(SUGGESTING_AUTHOR_REASON);
    reporter.report(SUGGESTING_AUTHOR_REASON);
    await afterReport();
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.code).toBe('suggestingNeedsAuthor');
    expect(emitted[0]!.message).toContain(SUGGESTING_AUTHOR_REASON);
    expect(emitted[0]!.message).toContain('setAuthor');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('[@docx-editor.dev/core]');
    reporter.report(SUGGESTING_AUTHOR_REASON);
    await afterReport();
    expect(emitted).toHaveLength(1);

    // Disposed before the task runs: nothing.
    const disposed = createSuggestingConfigurationReporter({
      stillMissing: () => true,
      emit: (error) => emitted.push(error),
      log: (message) => lines.push(message),
    });
    disposed.report(SUGGESTING_AUTHOR_REASON);
    disposed.dispose();
    await afterReport();
    expect(emitted).toHaveLength(1);
  });
});

describe('setEditingMode(suggesting) without an author', () => {
  test('is refused with the configuration reason and the mode stays editing', () => {
    const editor = mount({});
    expect(editor.setEditingMode('suggesting')).toEqual({
      ok: false,
      code: 'invalidArgs',
      reason: SUGGESTING_AUTHOR_REASON,
    });
    expect(editor.getEditingMode()).toBe('editing');
    // Published, so a host watching the snapshot sees why the request waits.
    expect(editor.snapshot().lastRejection).toBe(SUGGESTING_AUTHOR_REASON);
    // Editing still works, untracked: the document is not mute, it is honest about its mode.
    expect(editor.exec({ type: 'insertText', text: 'x' })).toMatchObject({
      ok: true,
      changed: true,
    });
  });

  test('can mirrors the refusal on suggesting alone; the pill stays live for the other modes', () => {
    const editor = mount({});
    expect(editor.can({ type: 'setEditingMode', mode: 'suggesting' })).toEqual({
      ok: false,
      code: 'invalidArgs',
      reason: SUGGESTING_AUTHOR_REASON,
    });
    expect(editor.can({ type: 'setEditingMode', mode: 'viewing' })).toEqual({ ok: true });
    const pill = toolbarCommandState(editor, 'review.editingMode');
    expect(pill.enabled).toBe(true);
    expect(pill.disabledReason).toBeNull();
    expect(pill.value).toBe('editing');
  });

  test('the pill disables with the reason only when no other mode can be entered', () => {
    const editor = mount({ author: 'Grace Hopper', mode: 'view' });
    const pill = toolbarCommandState(editor, 'review.editingMode');
    expect(pill.enabled).toBe(false);
    expect(pill.disabledReason).toBe('this document was opened for viewing');
  });

  test('the module refusal still comes first', async () => {
    const editor = mount({ review: false });
    expect(editor.setEditingMode('suggesting')).toEqual({
      ok: false,
      code: 'unsupported',
      reason: PRO_REVIEW_REASON,
    });
    await afterReport();
    expect(errors).toEqual([]);
  });

  test('is raised once through the error event and once on the console', async () => {
    const editor = mount({});
    const heard: EditorError[] = [];
    editor.on('error', (error) => heard.push(error));
    editor.can({ type: 'setEditingMode', mode: 'suggesting' });
    await afterReport();
    expect(errors).toEqual([]);
    editor.setEditingMode('suggesting');
    editor.setEditingMode('suggesting');
    await afterReport();
    expect(heard).toHaveLength(1);
    expect(heard[0]!.code).toBe('suggestingNeedsAuthor');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(SUGGESTING_AUTHOR_REASON);
  });

  test('a whitespace author is no author', () => {
    const editor = mount({ author: '   ' });
    expect(editor.setEditingMode('suggesting')).toMatchObject({ ok: false, code: 'invalidArgs' });
  });

  test('succeeds once an author is configured', () => {
    const editor = mount({});
    expect(editor.setEditingMode('suggesting').ok).toBe(false);
    editor.setAuthor('Grace Hopper');
    expect(editor.can({ type: 'setEditingMode', mode: 'suggesting' })).toEqual({ ok: true });
    expect(editor.setEditingMode('suggesting')).toEqual({ ok: true, changed: false });
    expect(editor.getEditingMode()).toBe('suggesting');
  });

  test('the refused request is remembered: an author arriving enters suggesting', async () => {
    // The #692 host: `onReady` calls `setEditingMode('suggesting')` and drops the result,
    // and the author is fetched afterwards.
    const editor = mount({});
    editor.setEditingMode('suggesting');
    editor.setAuthor('Grace Hopper');
    expect(editor.getEditingMode()).toBe('suggesting');
    expect(editor.snapshot().lastRejection).toBeNull();
    await afterReport();
    expect(errors).toEqual([]);
  });

  test('the remembered request survives a reload and yields to a later choice', () => {
    const editor = mount({});
    editor.setEditingMode('suggesting');
    editor.load(docx(paragraph('next')));
    expect(editor.snapshot().lastRejection).toBe(SUGGESTING_AUTHOR_REASON);
    expect(editor.setEditingMode('viewing').ok).toBe(true);
    expect(editor.snapshot().lastRejection).toBeNull();
    editor.setAuthor('Grace Hopper');
    expect(editor.getEditingMode()).toBe('viewing');
  });
});

describe('a host request for suggesting with no author', () => {
  test("`mode: 'suggesting'` opens editing, publishes the reason and raises it once", async () => {
    const editor = mount({ mode: 'suggesting' });
    expect(editor.getEditingMode()).toBe('editing');
    expect(editor.snapshot().lastRejection).toBe(SUGGESTING_AUTHOR_REASON);
    expect(errors).toEqual([]);
    await afterReport();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(SUGGESTING_AUTHOR_REASON);
  });

  test('setMode(suggesting) is published and raised the same way', async () => {
    const editor = mount({});
    editor.setMode('suggesting');
    expect(editor.getEditingMode()).toBe('editing');
    expect(editor.snapshot().lastRejection).toBe(SUGGESTING_AUTHOR_REASON);
    await afterReport();
    expect(errors).toHaveLength(1);
  });

  test('an author arriving before the task runs raises nothing', async () => {
    // The adapters apply a later `author` prop from an effect; StrictMode rebuilds first.
    const editor = mount({ mode: 'suggesting' });
    editor.setAuthor('Grace Hopper');
    const rebuilt = mount({ mode: 'suggesting' });
    rebuilt.destroy();
    await afterReport();
    expect(errors).toEqual([]);
  });

  test('an author arriving later enters the requested mode and clears the rejection', () => {
    const editor = mount({ mode: 'suggesting' });
    let changes = 0;
    editor.on('selectionChange', () => changes++);
    editor.setAuthor('Grace Hopper');
    expect(editor.getEditingMode()).toBe('suggesting');
    expect(editor.snapshot().lastRejection).toBeNull();
    expect(editor.snapshot().editingMode).toBe('suggesting');
    expect(changes).toBe(1);
    expect(editor.exec({ type: 'insertText', text: 'x' })).toMatchObject({ ok: true });
  });

  test('the author leaving takes a host-requested suggesting back to editing, published', async () => {
    const editor = mount({ author: 'Grace Hopper', mode: 'suggesting' });
    expect(editor.getEditingMode()).toBe('suggesting');
    editor.setAuthor(undefined);
    expect(editor.getEditingMode()).toBe('editing');
    expect(editor.snapshot().lastRejection).toBe(SUGGESTING_AUTHOR_REASON);
    await afterReport();
    expect(errors).toHaveLength(1);
    editor.setAuthor('Grace Hopper');
    expect(editor.getEditingMode()).toBe('suggesting');
    expect(editor.snapshot().lastRejection).toBeNull();
  });

  test("the reader's own choice outranks the arriving author", () => {
    const editor = mount({ mode: 'suggesting' });
    expect(editor.setEditingMode('viewing').ok).toBe(true);
    editor.setAuthor('Grace Hopper');
    expect(editor.getEditingMode()).toBe('viewing');
  });

  test('an author arriving with no pending request changes nothing', async () => {
    const editor = mount({});
    editor.setAuthor('Grace Hopper');
    expect(editor.getEditingMode()).toBe('editing');
    expect(editor.snapshot().lastRejection).toBeNull();
    await afterReport();
    expect(errors).toEqual([]);
  });
});

describe('a reader-chosen suggesting whose author leaves', () => {
  test('stays in suggesting, refuses writes, and publishes why until the author returns', async () => {
    const editor = mount({ author: 'Grace Hopper' });
    expect(editor.setEditingMode('suggesting').ok).toBe(true);
    editor.setAuthor('');
    expect(editor.getEditingMode()).toBe('suggesting');
    expect(editor.snapshot().lastRejection).toBe(SUGGESTING_AUTHOR_REASON);
    // The surface's own guard refuses the write (a void op, so `exec` reports no change).
    expect(editor.exec({ type: 'insertText', text: 'x' })).toEqual({ ok: true, changed: false });
    expect(editor.surface!.session.bodyText()).toBe('');
    expect(editor.surface!.state().lastRejection).toContain('author');
    // The pill is still the way out.
    expect(toolbarCommandState(editor, 'review.editingMode').enabled).toBe(true);
    await afterReport();
    expect(errors).toHaveLength(1);
    editor.setAuthor('Grace Hopper');
    // The surface retires the refusal that named the missing author.
    expect(editor.snapshot().lastRejection).toBeNull();
    expect(editor.exec({ type: 'insertText', text: 'x' })).toEqual({ ok: true, changed: true });
  });

  test('the published reason survives a reload while the author is still missing', () => {
    const editor = mount({ author: 'Grace Hopper' });
    expect(editor.setEditingMode('suggesting').ok).toBe(true);
    editor.setAuthor('');
    editor.load(docx(paragraph('next')));
    expect(editor.getEditingMode()).toBe('suggesting');
    expect(editor.snapshot().lastRejection).toBe(SUGGESTING_AUTHOR_REASON);
  });
});

describe('a document protected to tracked changes only', () => {
  const PROTECTED =
    '<w:trackRevisions/><w:documentProtection w:edit="trackedChanges" w:enforcement="1"/>';

  test('keeps suggesting when the author leaves, rather than writing untracked', () => {
    const editor = mount({ author: 'Grace Hopper', document: trackedDocx(PROTECTED) });
    expect(editor.getEditingMode()).toBe('suggesting');
    editor.setAuthor(undefined);
    expect(editor.getEditingMode()).toBe('suggesting');
    expect(editor.snapshot().lastRejection).toContain('author');
    editor.exec({ type: 'insertText', text: 'x' });
    expect(editor.surface!.session.bodyText()).toBe('tracked');
    editor.setAuthor('Grace Hopper');
    expect(editor.getEditingMode()).toBe('suggesting');
    expect(editor.snapshot().lastRejection).toBeNull();
  });
});

describe('a document that asks for tracking with no author', () => {
  test('opens editing with the reason published, and is NOT a configuration error', async () => {
    const editor = mount({ document: trackedDocx() });
    expect(editor.getEditingMode()).toBe('editing');
    expect(editor.snapshot().lastRejection).toBe(DOCUMENT_TRACKING_AUTHOR_REASON);
    await afterReport();
    expect(errors).toEqual([]);
  });

  test('enters suggesting when an author arrives', () => {
    const editor = mount({ document: trackedDocx() });
    editor.setAuthor('Grace Hopper');
    expect(editor.getEditingMode()).toBe('suggesting');
    expect(editor.snapshot().lastRejection).toBeNull();
  });

  test('its rejection does not outlive the document', () => {
    const editor = mount({ document: trackedDocx() });
    expect(editor.snapshot().lastRejection).toBe(DOCUMENT_TRACKING_AUTHOR_REASON);
    editor.load(docx(paragraph('plain')));
    expect(editor.snapshot().lastRejection).toBeNull();
    editor.setAuthor('Grace Hopper');
    expect(editor.getEditingMode()).toBe('editing');
  });

  test("an explicit `mode: 'edit'` keeps editing when an author arrives", () => {
    const editor = mount({ document: trackedDocx(), mode: 'edit' });
    editor.setAuthor('Grace Hopper');
    expect(editor.getEditingMode()).toBe('editing');
  });
});

describe('author configuration transitions', () => {
  test('a withdrawn request does not raise a delayed configuration error', async () => {
    const host = mount({ mode: 'suggesting' });
    host.setMode('edit');
    const reader = mount({});
    reader.setEditingMode('suggesting');
    reader.setEditingMode('viewing');
    await afterReport();
    expect(errors).toEqual([]);
    // Withdrawing a request does not consume the later error report.
    host.setMode('suggesting');
    await afterReport();
    expect(errors).toHaveLength(1);
  });

  test('a refused suggesting request takes precedence over an older surface refusal', () => {
    const editor = mount({});
    editor.setEditingMode('viewing');
    editor.surface!.undo();
    expect(editor.snapshot().lastRejection).toContain('viewing');
    editor.setEditingMode('suggesting');
    expect(editor.snapshot().lastRejection).toBe(SUGGESTING_AUTHOR_REASON);
    editor.setAuthor('Ada');
    expect(editor.snapshot().lastRejection).toBeNull();
  });

  test('an author arriving clears a refused explicit proposal', () => {
    const editor = mount({});
    editor.exec({ type: 'proposeInsertion', text: 'x' });
    expect(editor.snapshot().lastRejection).toContain('author');
    editor.setAuthor('Ada');
    expect(editor.snapshot().lastRejection).toBeNull();
  });

  test('removing the author preserves document-adopted tracking and refuses untracked edits', () => {
    const editor = mount({ author: 'Ada', document: trackedDocx() });
    editor.setAuthor(undefined);
    expect(editor.getEditingMode()).toBe('suggesting');
    expect(editor.snapshot().lastRejection).toContain('author');
    editor.exec({ type: 'insertText', text: 'x' });
    expect(editor.surface!.session.bodyText()).toBe('tracked');
    editor.setAuthor('Grace');
    expect(editor.getEditingMode()).toBe('suggesting');
    expect(editor.snapshot().lastRejection).toBeNull();
  });

  test('renaming an author preserves adopted tracking after loading a plain document', () => {
    const editor = mount({ author: 'Ada', document: trackedDocx() });
    editor.load(docx(paragraph('next')));
    expect(editor.getEditingMode()).toBe('suggesting');
    editor.setAuthor('Grace');
    expect(editor.getEditingMode()).toBe('suggesting');
    editor.exec({ type: 'insertText', text: 'x' });
    expect(serializeOoxmlPart(editor.surface!.session.part())).toMatch(
      /<w:ins\b[^>]*w:author="Grace"[^>]*>.*?<w:t>x<\/w:t>.*?<\/w:ins>/
    );
  });

  test('a protected document explains why the host cannot leave viewing without review support', () => {
    const editor = mount({
      review: false,
      document: trackedDocx('<w:documentProtection w:edit="trackedChanges" w:enforcement="1"/>'),
    });
    editor.setMode('view');
    editor.setMode('edit');
    expect(editor.getEditingMode()).toBe('viewing');
    expect(editor.snapshot().lastRejection).toContain('tracked changes');
    expect(editor.exec({ type: 'insertText', text: 'x' }).ok).toBe(false);
  });
});
