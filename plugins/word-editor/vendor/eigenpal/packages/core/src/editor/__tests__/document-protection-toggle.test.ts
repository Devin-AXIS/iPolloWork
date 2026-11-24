// Review → Protect Document, and what protection does to the editing modes.
//
// The toggle is a DOCUMENT edit: it writes `w:documentProtection` into `settings.xml`, joins
// the undo history, and reports through the snapshot so the menu row's pressed state and the
// store's refusals read one setting. Word greys Track Changes out under filling-in-forms
// protection, so suggesting is refused there and a suggesting session ends when protection
// goes on. Read-only and comments-only protection refuse content edits outright.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { unzipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import {
  FORMS_PROTECTION_SUGGESTING_REASON,
  READ_ONLY_PROTECTION_REASON,
} from '../opening-editing-mode.ts';
import { toolbarCommandState } from '../toolbar-commands.ts';
import { chromeMenuSlots } from '../chrome-controls.ts';
import { docx, paragraph, trackedDocx } from './paginated-surface-fixtures.ts';
import { stubReviewModule } from './review-test-module.ts';

const FORMS = '<w:documentProtection w:edit="forms" w:enforcement="1"/>';
const PASSWORD =
  '<w:documentProtection w:edit="forms" w:enforcement="1" w:cryptProviderType="rsaAES" ' +
  'w:cryptAlgorithmClass="hash" w:cryptAlgorithmType="typeAny" w:cryptAlgorithmSid="14" ' +
  'w:cryptSpinCount="100000" w:hash="abc=" w:salt="def="/>';

let editors: DocxEditorInstance[] = [];
let containers: HTMLElement[] = [];

afterEach(() => {
  for (const editor of editors) editor.destroy();
  for (const container of containers) container.remove();
  editors = [];
  containers = [];
});

function mount(config: {
  document: Uint8Array | 'blank';
  author?: string;
  mode?: 'edit' | 'view' | 'suggesting';
  review?: boolean;
}): DocxEditorInstance {
  const container = document.createElement('div');
  document.body.append(container);
  containers.push(container);
  const editor = createDocxEditor({
    container,
    document: config.document,
    author: config.author ?? 'Grace Hopper',
    ...(config.mode === undefined ? {} : { mode: config.mode }),
    modules: config.review === false ? [] : [stubReviewModule()],
  });
  editors.push(editor);
  return editor;
}

const TOGGLE = { type: 'toggleDocumentProtection' } as const;
const protection = (editor: DocxEditorInstance) => editor.snapshot().documentProtection;

async function settingsOf(editor: DocxEditorInstance): Promise<string> {
  const files = unzipSync(new Uint8Array(await editor.save()));
  const part = files['word/settings.xml'];
  return part ? new TextDecoder().decode(part) : '';
}

function typeAt(editor: DocxEditorInstance, paragraphIndex: number, offset: number, text: string) {
  const paragraphId = editor.surface!.session.paragraphIds()[paragraphIndex]!;
  const at = { paragraphId, offset };
  editor.surface!.setSelection({ anchor: at, head: at });
  return editor.exec({ type: 'insertText', text });
}

describe('the Review menu row', () => {
  test('sits in the Review menu, off the default toolbar, wired as a toggle', () => {
    expect(chromeMenuSlots()).toContain('review.protectDocument');
    const editor = mount({ document: docx(paragraph('Body')) });
    const state = toolbarCommandState(editor, 'review.protectDocument');
    expect(state.enabled).toBe(true);
    expect(state.active).toBe(false);
    expect(editor.exec(TOGGLE)).toEqual({ ok: true, changed: true });
    expect(toolbarCommandState(editor, 'review.protectDocument').active).toBe(true);
  });
});

describe('toggling protection', () => {
  test('enforces forms protection, reports it, and lifts it again', async () => {
    const editor = mount({ document: docx(paragraph('Body')) });
    expect(protection(editor)).toEqual({ edit: 'none', enforced: false, password: false });
    expect(editor.can(TOGGLE)).toEqual({ ok: true });

    expect(editor.exec(TOGGLE)).toEqual({ ok: true, changed: true });
    expect(protection(editor)).toEqual({ edit: 'forms', enforced: true, password: false });
    expect(editor.isActive(TOGGLE)).toBe(true);
    const saved = await settingsOf(editor);
    expect(saved).toContain('w:edit="forms"');
    expect(saved).toContain('w:enforcement="1"');
    // Both admission and execution report the protection refusal.
    expect(typeAt(editor, 0, 0, 'x')).toMatchObject({ ok: false, code: 'locked' });

    expect(editor.exec(TOGGLE)).toEqual({ ok: true, changed: true });
    expect(protection(editor)).toEqual({ edit: 'forms', enforced: false, password: false });
    expect(editor.isActive(TOGGLE)).toBe(false);
    expect(await settingsOf(editor)).toContain('w:enforcement="0"');
    expect(typeAt(editor, 0, 0, 'x')).toEqual({ ok: true, changed: true });
  });

  test('is one undo step each way', () => {
    const editor = mount({ document: docx(paragraph('Body')) });
    editor.exec(TOGGLE);
    expect(protection(editor)?.enforced).toBe(true);
    expect(editor.snapshot().canUndo).toBe(true);
    editor.exec({ type: 'undo' });
    expect(protection(editor)?.enforced).toBe(false);
    editor.exec({ type: 'redo' });
    expect(protection(editor)?.enforced).toBe(true);
  });

  test('the snapshot field is reference-stable until the setting moves', () => {
    const editor = mount({ document: docx(paragraph('Body')) });
    const before = protection(editor);
    typeAt(editor, 0, 0, 'x');
    expect(protection(editor)).toBe(before);
    editor.exec(TOGGLE);
    expect(protection(editor)).not.toBe(before);
  });

  test('lifts a read-only protection the document arrived with', () => {
    const editor = mount({
      document: trackedDocx('<w:documentProtection w:edit="readOnly" w:enforcement="1"/>'),
    });
    expect(protection(editor)).toEqual({ edit: 'readOnly', enforced: true, password: false });
    expect(editor.exec(TOGGLE)).toEqual({ ok: true, changed: true });
    expect(protection(editor)).toEqual({ edit: 'readOnly', enforced: false, password: false });
    // Lifting restores the mode as well as the write: the document opened viewing because it
    // permitted no edit, and now it permits one.
    expect(editor.setEditingMode('editing').ok).toBe(true);
    expect(typeAt(editor, 0, 0, 'x')).toEqual({ ok: true, changed: true });
  });

  test('refuses to enforce over a document that declares another restriction', () => {
    const editor = mount({
      document: trackedDocx('<w:documentProtection w:edit="readOnly" w:enforcement="0"/>'),
    });
    expect(protection(editor)).toEqual({ edit: 'readOnly', enforced: false, password: false });
    const refusal = editor.can(TOGGLE);
    expect(refusal.ok).toBe(false);
    if (!refusal.ok) expect(refusal.code).toBe('locked');
    expect(editor.exec(TOGGLE).ok).toBe(false);
    expect(toolbarCommandState(editor, 'review.protectDocument').enabled).toBe(false);
  });

  test('lifting clears the reason enforcing published', () => {
    const editor = mount({ document: docx(paragraph('Body')) });
    expect(editor.setEditingMode('suggesting').ok).toBe(true);
    expect(editor.exec(TOGGLE).ok).toBe(true);
    expect(editor.snapshot().lastRejection).toBe(FORMS_PROTECTION_SUGGESTING_REASON);
    expect(editor.exec(TOGGLE).ok).toBe(true);
    expect(editor.snapshot().lastRejection).toBeNull();
  });

  test('refuses to lift a password-protected document, and says why', () => {
    const editor = mount({ document: trackedDocx(PASSWORD) });
    expect(protection(editor)?.password).toBe(true);
    const refusal = editor.can(TOGGLE);
    expect(refusal.ok).toBe(false);
    if (!refusal.ok) expect(refusal.code).toBe('locked');
    expect(editor.exec(TOGGLE).ok).toBe(false);
    expect(toolbarCommandState(editor, 'review.protectDocument').enabled).toBe(false);
    expect(protection(editor)?.enforced).toBe(true);
  });

  test('stays available in viewing mode, so a protected document can be unlocked', () => {
    // A read-only document OPENS viewing because it is protected. Refusing here would leave
    // the reader looking at a lock with no way to open it.
    const viewing = mount({ document: docx(paragraph('Body')) });
    viewing.setEditingMode('viewing');
    expect(viewing.can(TOGGLE)).toEqual({ ok: true });
    expect(viewing.exec(TOGGLE)).toEqual({ ok: true, changed: true });
    expect(protection(viewing)?.enforced).toBe(true);
  });

  test('is refused on a view-only host, with no document, and after destroy', () => {
    const viewOnly = mount({ document: docx(paragraph('Body')), mode: 'view' });
    expect(viewOnly.can(TOGGLE)).toMatchObject({ ok: false, code: 'locked' });

    const detached = createDocxEditor({ document: docx(paragraph('Body')) });
    expect(detached.can(TOGGLE)).toMatchObject({ ok: false, code: 'notFound' });
    detached.destroy();
    expect(detached.can(TOGGLE)).toMatchObject({ ok: false, code: 'notFound' });
    expect(detached.exec(TOGGLE).ok).toBe(false);
  });
});

describe('forms protection and suggesting mode', () => {
  test('setEditingMode(suggesting) is refused, and the toolbar item says why', () => {
    const editor = mount({ document: trackedDocx(FORMS) });
    expect(editor.snapshot().editingMode).toBe('editing');
    const refusal = editor.can({ type: 'setEditingMode', mode: 'suggesting' });
    expect(refusal).toEqual({
      ok: false,
      code: 'locked',
      reason: FORMS_PROTECTION_SUGGESTING_REASON,
    });
    expect(editor.setEditingMode('suggesting')).toEqual(refusal);
    expect(editor.snapshot().editingMode).toBe('editing');
    // Filling the field is still an untracked edit: the mode was refused, not the document.
    expect(editor.can({ type: 'setEditingMode', mode: 'editing' })).toEqual({ ok: true });
  });

  test('a document that asks for tracking AND is protected for forms opens editing', () => {
    const editor = mount({ document: trackedDocx(`<w:trackRevisions/>${FORMS}`) });
    expect(editor.snapshot().editingMode).toBe('editing');
  });

  test('a host that asks for suggesting on a forms-protected document opens editing', () => {
    const editor = mount({ document: trackedDocx(FORMS), mode: 'suggesting' });
    expect(editor.snapshot().editingMode).toBe('editing');
    expect(editor.snapshot().lastRejection).toBe(FORMS_PROTECTION_SUGGESTING_REASON);
  });

  test('enforcing protection ends a suggesting session and publishes the reason', () => {
    const editor = mount({ document: docx(paragraph('Body')) });
    expect(editor.setEditingMode('suggesting').ok).toBe(true);
    expect(editor.snapshot().editingMode).toBe('suggesting');
    expect(editor.exec(TOGGLE)).toEqual({ ok: true, changed: true });
    expect(editor.snapshot().editingMode).toBe('editing');
    expect(editor.snapshot().lastRejection).toBe(FORMS_PROTECTION_SUGGESTING_REASON);
    expect(editor.can({ type: 'setEditingMode', mode: 'suggesting' })).toMatchObject({
      ok: false,
      code: 'locked',
    });
    // Lifting it lets suggesting back in.
    expect(editor.exec(TOGGLE).ok).toBe(true);
    expect(editor.setEditingMode('suggesting').ok).toBe(true);
  });

  test('an author arriving does not complete a suggesting request the document refuses', () => {
    // The request is refused for the AUTHOR first, which arms it; completing it unasked put
    // the editor in a mode its own `can` refuses, with nothing published saying so. The
    // adapters apply `author` from a later effect, so this is the ordinary React/Vue path.
    const container = document.createElement('div');
    document.body.append(container);
    containers.push(container);
    const editor = createDocxEditor({
      container,
      document: trackedDocx(FORMS),
      modules: [stubReviewModule()],
    });
    editors.push(editor);
    expect(editor.setEditingMode('suggesting').ok).toBe(false);
    editor.setAuthor('Grace Hopper');
    expect(editor.snapshot().editingMode).toBe('editing');
    expect(editor.snapshot().lastRejection).toBe(FORMS_PROTECTION_SUGGESTING_REASON);
  });

  test('tracked-changes protection still forces suggesting', () => {
    const editor = mount({
      document: trackedDocx('<w:documentProtection w:edit="trackedChanges" w:enforcement="1"/>'),
    });
    expect(editor.snapshot().editingMode).toBe('suggesting');
    expect(editor.can({ type: 'setEditingMode', mode: 'editing' })).toMatchObject({
      ok: false,
      code: 'locked',
    });
  });
});

describe('read-only and comments-only protection', () => {
  for (const mode of ['readOnly', 'comments'] as const) {
    // The document permits no edit, so it opens VIEWING. An editing pill over a document that
    // refuses every keystroke is the silent-drop shape issue #836 was filed about; the mode
    // pill is where the reader can SEE that the document is protected.
    test(`${mode}: the document opens in its permitted mode`, () => {
      const editor = mount({
        document: trackedDocx(`<w:documentProtection w:edit="${mode}" w:enforcement="1"/>`),
      });
      expect(editor.snapshot().editingMode).toBe(mode === 'comments' ? 'editing' : 'viewing');
      const forbidden =
        mode === 'comments' ? (['suggesting'] as const) : (['editing', 'suggesting'] as const);
      for (const next of forbidden) {
        expect(editor.can({ type: 'setEditingMode', mode: next })).toEqual({
          ok: false,
          code: 'locked',
          reason:
            mode === 'comments'
              ? 'this document is protected for comments only'
              : READ_ONLY_PROTECTION_REASON,
        });
      }
    });

    test(`${mode}: a refused edit says so rather than reporting success`, () => {
      const editor = mount({
        document: trackedDocx(`<w:documentProtection w:edit="${mode}" w:enforcement="1"/>`),
      });
      expect(editor.can({ type: 'insertText', text: 'x' }).ok).toBe(false);
      expect(typeAt(editor, 0, 0, 'x').ok).toBe(false);
      expect(toolbarCommandState(editor, 'text.bold').enabled).toBe(false);
      expect(toolbarCommandState(editor, 'text.bold').disabledReason).not.toBeNull();
      expect(editor.surface!.session.bodyText()).toBe('tracked');
    });

    test(`${mode}: a header cannot be created or removed either`, () => {
      const editor = mount({
        document: trackedDocx(`<w:documentProtection w:edit="${mode}" w:enforcement="1"/>`),
      });
      expect(
        editor.exec({
          type: 'setHeaderFooterOptions',
          sectionIndex: 0,
          titlePage: true,
        }).ok
      ).toBe(false);
    });
  }

  test('the viewing adoption ends with the document that caused it', () => {
    // The mode outlived its document: opening a read-only file and then an ordinary one left
    // the second one read-only, with no reason published and no way back but a manual change.
    const editor = mount({
      document: trackedDocx('<w:documentProtection w:edit="readOnly" w:enforcement="1"/>'),
    });
    expect(editor.snapshot().editingMode).toBe('viewing');
    editor.load(docx(paragraph('Ordinary')));
    expect(editor.snapshot().editingMode).toBe('editing');
    expect(typeAt(editor, 0, 0, 'x')).toEqual({ ok: true, changed: true });
  });

  test('undo of a protection change restores the mode as well as the setting', () => {
    // Undo writes `settings.xml` back, so the mode has to be re-decided: an editing pill over
    // a restored read-only document is the silent drop this gate exists to prevent.
    const editor = mount({
      document: trackedDocx('<w:documentProtection w:edit="readOnly" w:enforcement="1"/>'),
    });
    expect(editor.exec(TOGGLE)).toEqual({ ok: true, changed: true });
    expect(editor.setEditingMode('editing').ok).toBe(true);
    editor.exec({ type: 'undo' });
    expect(protection(editor)?.enforced).toBe(true);
    expect(editor.snapshot().editingMode).toBe('viewing');
    expect(typeAt(editor, 0, 0, 'x').ok).toBe(false);
  });

  test('undo of an enforcement clears the reason it published', () => {
    const editor = mount({ document: docx(paragraph('Body')) });
    expect(editor.setEditingMode('suggesting').ok).toBe(true);
    expect(editor.exec(TOGGLE).ok).toBe(true);
    expect(editor.snapshot().lastRejection).toBe(FORMS_PROTECTION_SUGGESTING_REASON);
    editor.exec({ type: 'undo' });
    expect(protection(editor)?.enforced).toBe(false);
    expect(editor.snapshot().lastRejection).toBeNull();
  });

  test('forms protection refuses a lifecycle command too', () => {
    // Forms protection inverts the rule — editable only inside a form field — and a
    // package-level commit is never inside one.
    const editor = mount({ document: trackedDocx(FORMS) });
    expect(
      editor.exec({ type: 'setHeaderFooterOptions', sectionIndex: 0, titlePage: true }).ok
    ).toBe(false);
    expect(editor.exec({ type: 'insertNote', noteKind: 'footnote' }).ok).toBe(false);
  });

  test('a forms-protected document loaded after a read-only one is fillable', () => {
    // The release has to reach the forms branch too, or the reader is left in the viewing the
    // previous document adopted and cannot fill the fields this protection exists to permit.
    const editor = mount({
      document: trackedDocx('<w:documentProtection w:edit="readOnly" w:enforcement="1"/>'),
    });
    expect(editor.snapshot().editingMode).toBe('viewing');
    editor.load(trackedDocx(FORMS));
    expect(editor.snapshot().editingMode).toBe('editing');
  });

  test('an unenforced protection restricts nothing', () => {
    const editor = mount({
      document: trackedDocx('<w:documentProtection w:edit="readOnly" w:enforcement="0"/>'),
    });
    expect(editor.snapshot().editingMode).toBe('editing');
    expect(typeAt(editor, 0, 0, 'x')).toEqual({ ok: true, changed: true });
  });
});
