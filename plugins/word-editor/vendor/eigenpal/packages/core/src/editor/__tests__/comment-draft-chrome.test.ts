// The `review.addComment` control and the comment draft chrome behind it: the control is
// enabled only while some chrome is registered to open the draft, and its press reaches that
// chrome.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { runToolbarCommand, toolbarCommandState } from '../toolbar-commands.ts';
import { NO_COMMENT_DRAFT_VIEW } from '../comment-draft-chrome.ts';
import { stubReviewModule } from './review-test-module.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const SOURCE = zipSync({
  '[Content_Types].xml': strToU8(
    `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  ),
  '_rels/.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>hello world</w:t></w:r></w:p></w:body></w:document>`
  ),
});

const editors: DocxEditorInstance[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function mount(withReview = true): DocxEditorInstance {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: SOURCE,
    author: 'Grace Hopper',
    ...(withReview ? { modules: [stubReviewModule()] } : {}),
  });
  editors.push(editor);
  // happy-dom lays nothing out, so the selection has no place on the page by itself.
  (editor as unknown as { getSelectionPlacement: () => unknown }).getSelectionPlacement = () => ({
    anchorY: 10,
  });
  return editor;
}

const settle = (): Promise<void> => new Promise((resolve) => queueMicrotask(resolve));

describe('review.addComment', () => {
  test('is disabled with a reason while no comment draft chrome is registered', () => {
    const editor = mount();
    expect(toolbarCommandState(editor, 'review.addComment')).toEqual({
      id: 'review.addComment',
      enabled: false,
      disabledReason: NO_COMMENT_DRAFT_VIEW,
      active: false,
    });
    expect(runToolbarCommand(editor, 'review.addComment')).toEqual({
      ok: false,
      code: 'unsupported',
      reason: NO_COMMENT_DRAFT_VIEW,
    });
  });

  test('a registration enables it, and the press opens the registered draft', () => {
    const editor = mount();
    let opened = 0;
    const before = editor.stateVersion();
    editor.setCommentDraftChrome({ onRequest: () => (opened += 1) });
    // Published, so chrome that reads the snapshot asks again.
    expect(editor.stateVersion()).toBeGreaterThan(before);
    expect(toolbarCommandState(editor, 'review.addComment').enabled).toBe(true);
    expect(runToolbarCommand(editor, 'review.addComment')).toEqual({ ok: true, changed: false });
    expect(opened).toBe(1);
  });

  test('unregistering disables it again', async () => {
    const editor = mount();
    let opened = 0;
    const off = editor.setCommentDraftChrome({ onRequest: () => (opened += 1) });
    off();
    await settle();
    expect(toolbarCommandState(editor, 'review.addComment').disabledReason).toBe(
      NO_COMMENT_DRAFT_VIEW
    );
    expect(runToolbarCommand(editor, 'review.addComment').ok).toBe(false);
    expect(opened).toBe(0);
  });

  test('the most recent registration receives the press, and disposal restores the previous', () => {
    const editor = mount();
    const calls: string[] = [];
    editor.setCommentDraftChrome({ onRequest: () => calls.push('rail') });
    const off = editor.setCommentDraftChrome({ onRequest: () => calls.push('host') });
    runToolbarCommand(editor, 'review.addComment');
    off();
    runToolbarCommand(editor, 'review.addComment');
    expect(calls).toEqual(['host', 'rail']);
  });

  test('keeps refusing for the engine reasons that come first', () => {
    const free = mount(false);
    let opened = 0;
    free.setCommentDraftChrome({ onRequest: () => (opened += 1) });
    expect(toolbarCommandState(free, 'review.addComment').enabled).toBe(false);
    expect(toolbarCommandState(free, 'review.addComment').disabledReason).not.toBe(
      NO_COMMENT_DRAFT_VIEW
    );

    const viewing = mount();
    viewing.setCommentDraftChrome({ onRequest: () => (opened += 1) });
    expect(viewing.exec({ type: 'setEditingMode', mode: 'viewing' }).ok).toBe(true);
    expect(runToolbarCommand(viewing, 'review.addComment')).toEqual({
      ok: false,
      code: 'unsupported',
      reason: 'the document is open for viewing',
    });
    expect(opened).toBe(0);
  });

  test('refuses a history group, because the press writes nothing', () => {
    const editor = mount();
    editor.setCommentDraftChrome({ onRequest: () => {} });
    const group = editor.beginHistoryGroup();
    expect(runToolbarCommand(editor, 'review.addComment', { historyGroup: group }).ok).toBe(false);
    group.end();
  });
});

describe('review.addComment at a collapsed caret', () => {
  const PID = '/word/document.xml#0.0.0';
  function mountWithRealPlacement(): DocxEditorInstance {
    const editor = mount();
    // A collapsed selection has no comment range, so it has no placement either; a range has one.
    (editor as unknown as { getSelectionPlacement: () => unknown }).getSelectionPlacement = () => {
      const { anchor, head } = editor.surface!.state().selection;
      return anchor.paragraphId === head.paragraphId && anchor.offset === head.offset
        ? null
        : { anchorY: 10 };
    };
    return editor;
  }
  const caretAt = (editor: DocxEditorInstance, offset: number) =>
    editor.surface!.setSelection({
      anchor: { paragraphId: PID, offset },
      head: { paragraphId: PID, offset },
    });

  test('a caret inside a word enables the control, and the press selects that word', () => {
    const editor = mountWithRealPlacement();
    let opened = 0;
    editor.setCommentDraftChrome({ onRequest: () => (opened += 1) });
    caretAt(editor, 2);
    expect(toolbarCommandState(editor, 'review.addComment').enabled).toBe(true);
    expect(runToolbarCommand(editor, 'review.addComment')).toEqual({ ok: true, changed: false });
    expect(opened).toBe(1);
    expect(editor.surface!.state().selection).toEqual({
      anchor: { paragraphId: PID, offset: 0 },
      head: { paragraphId: PID, offset: 5 },
    });
  });

  test('a caret between words still needs a selected range', () => {
    const editor = mountWithRealPlacement();
    editor.setCommentDraftChrome({ onRequest: () => undefined });
    caretAt(editor, 5);
    expect(toolbarCommandState(editor, 'review.addComment')).toMatchObject({
      enabled: false,
      disabledReason: 'a comment needs a selected range',
    });
  });
});
