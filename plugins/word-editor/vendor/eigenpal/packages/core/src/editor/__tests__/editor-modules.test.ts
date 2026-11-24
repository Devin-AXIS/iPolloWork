// The module seam's FREE-TIER contract (pro-review-and-custom-nodes, task 1.6).
//
// A bare `createDocxEditor` — no modules — must: render a tracked-changes document
// in its final-state projection, round-trip the revisions losslessly on save,
// publish `hasReviewContent` so a host can say "there is more here", and refuse
// every review write with the engine's own pro reason. Registering the review
// module restores the full behavior the review-facade tests pin down.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { toolbarCommandState } from '../toolbar-commands.ts';
import { stubReviewModule } from './review-test-module.ts';
import { stubCollaborationModule, stubCollaborationSession } from './collaboration-test-module.ts';
import type { EditorModule } from '../../contracts/modules.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

/** One paragraph: "Kept " + tracked insertion "added " + tracked deletion "gone ". */
const TRACKED =
  `<w:p><w:r><w:t xml:space="preserve">Kept </w:t></w:r>` +
  `<w:ins w:id="1" w:author="Ada" w:date="2024-01-01T00:00:00Z">` +
  `<w:r><w:t xml:space="preserve">added </w:t></w:r></w:ins>` +
  `<w:del w:id="2" w:author="Ada" w:date="2024-01-01T00:00:00Z">` +
  `<w:r><w:delText xml:space="preserve">gone </w:delText></w:r></w:del>` +
  `<w:r><w:t>end.</w:t></w:r></w:p>`;

const PLAIN = `<w:p><w:r><w:t>Nothing tracked here.</w:t></w:r></w:p>`;

function mount(body: string, modules?: readonly EditorModule[]) {
  const container = document.createElement('div');
  const editor: DocxEditorInstance = createDocxEditor({
    container,
    document: docx(body),
    author: 'Grace Hopper',
    ...(modules ? { modules } : {}),
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  return { editor, container };
}

describe('free tier: no modules registered', () => {
  test('a tracked-changes document renders its final state', () => {
    const { container } = mount(TRACKED);
    const painted = container.textContent ?? '';
    expect(painted).toContain('added');
    expect(painted).not.toContain('gone');
  });

  test('the revisions round-trip losslessly on save', async () => {
    const { editor } = mount(TRACKED);
    const saved = new Uint8Array(await editor.save());
    const body = strFromU8(unzipSync(saved)['word/document.xml']!);
    expect(body).toContain('<w:ins ');
    expect(body).toContain('<w:del ');
    expect(body).toContain('gone ');
  });

  test('hasReviewContent is true for tracked changes, false for a plain document', () => {
    expect(mount(TRACKED).editor.snapshot().hasReviewContent).toBe(true);
    expect(mount(PLAIN).editor.snapshot().hasReviewContent).toBe(false);
  });

  test('the review queue is the typed empty value', () => {
    expect(mount(TRACKED).editor.getReviewItems()).toEqual([]);
  });

  test('review writes are refused with the pro reason', () => {
    const { editor } = mount(TRACKED);
    const accept = editor.acceptReviewItem('any-key');
    expect(accept.ok).toBe(false);
    if (!accept.ok) expect(accept.reason).toContain('pro');
    const reply = editor.replyToReviewItem('any-key', 'text');
    expect(reply.ok).toBe(false);
    // Comment AUTHORING is a review write too — the one the first gating pass missed.
    const comment = editor.addComment('new comment');
    expect(comment.ok).toBe(false);
    if (!comment.ok) expect(comment.reason).toContain('pro');
    const pane = editor.exec({ type: 'toggleReviewPane' });
    expect(pane.ok).toBe(false);
    const suggest = editor.can({ type: 'setEditingMode', mode: 'suggesting' });
    expect(suggest.ok).toBe(false);
    // Editing and viewing are still the reader's to choose.
    expect(editor.can({ type: 'setEditingMode', mode: 'viewing' }).ok).toBe(true);
  });

  test('review chrome slots disable with the engine reason', () => {
    const { editor } = mount(TRACKED);
    const comments = toolbarCommandState(editor, 'review.comments');
    expect(comments.enabled).toBe(false);
    expect(comments.disabledReason).toContain('pro');
    // The pill itself stays live — Viewing is still the reader's — and the refusal sits on
    // the Suggesting item, which is what `can` answers for that mode.
    const pill = toolbarCommandState(editor, 'review.editingMode');
    expect(pill.enabled).toBe(true);
    const suggesting = editor.can({ type: 'setEditingMode', mode: 'suggesting' });
    expect(suggesting.ok).toBe(false);
    if (!suggesting.ok) expect(suggesting.reason).toContain('pro');
    const authors = toolbarCommandState(editor, 'review.authors');
    expect(authors.enabled).toBe(false);
    expect(authors.disabledReason).toContain('pro');
    editor.setReviewAuthorVisible('Ada', false);
    expect(editor.isReviewAuthorVisible('Ada')).toBe(true);
    expect(editor.snapshot().hiddenReviewAuthors).toEqual([]);
  });

  test('a document declaring w:trackRevisions still opens editable, untracked', () => {
    const { editor } = mount(TRACKED);
    expect(editor.getEditingMode()).toBe('editing');
  });
});

describe('with a review module registered', () => {
  // The seam's mechanics only: a STUB module flips the gates. What the real
  // derivation produces is pinned by @docx-editor.dev/pro's own tests.
  test('markup rendering and the review gates come back', () => {
    const { editor, container } = mount(TRACKED, [stubReviewModule()]);
    const painted = container.textContent ?? '';
    // All-markup: the deletion is struck, not hidden.
    expect(painted).toContain('gone');
    expect(editor.can({ type: 'setEditingMode', mode: 'suggesting' }).ok).toBe(true);
    expect(editor.exec({ type: 'toggleReviewPane' }).ok).toBe(true);
  });
});

describe('free tier: no collaboration module', () => {
  test('collaborationStatus is inactive and local undo stays the authority', () => {
    const { editor } = mount(PLAIN);
    expect(editor.snapshot().collaborationStatus).toBe('inactive');
    editor.surface!.type('x');
    expect(editor.snapshot().canUndo).toBe(true);
    editor.surface!.undo();
    expect(editor.surface!.session.bodyText()).toContain('Nothing tracked here');
  });
});

describe('with a collaboration module registered', () => {
  test('the registered session attaches and takes over undo', () => {
    const session = stubCollaborationSession();
    const { editor } = mount(PLAIN, [stubCollaborationModule(session)]);
    expect(session.attached).toBe(true);
    expect(editor.snapshot().collaborationStatus).toBe('ready');
    expect(editor.snapshot().canUndo).toBe(true);
    editor.surface!.undo();
    expect(session.undoCalls).toBe(1);
  });

  test('the first of two collaboration modules wins', () => {
    const first = stubCollaborationSession();
    const second = stubCollaborationSession();
    const { editor } = mount(PLAIN, [
      stubCollaborationModule(first),
      stubCollaborationModule(second),
    ]);
    expect(first.attached).toBe(true);
    expect(second.attached).toBe(false);
    expect(editor.snapshot().collaborationStatus).toBe('ready');
  });

  test('review and collaboration register together', () => {
    const session = stubCollaborationSession();
    const { editor } = mount(TRACKED, [stubReviewModule(), stubCollaborationModule(session)]);
    expect(session.attached).toBe(true);
    expect(editor.can({ type: 'setEditingMode', mode: 'suggesting' }).ok).toBe(true);
  });
});
