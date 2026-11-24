// The document vocabulary's comment and revision commands (`addComment`, `replyComment`,
// `resolveComment`, `acceptRevision`, `rejectRevision`), and tracked-changes protection, which
// keeps every change pending.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import {
  collectReviewItems as engineCollectReviewItems,
  findNode,
  revisionItemsOf,
  serializeOoxmlPart,
} from '@docx-editor.dev/core/store';
import type { EditorCommand } from '../../contracts/editor.ts';
import type { EditorModule } from '../../contracts/modules.ts';
import { PRO_REVIEW_REASON } from '../opening-editing-mode.ts';
import { TRACKED_CHANGES_DECISION_REASON } from '../command-protection.ts';
import { toolbarCommandState } from '../toolbar-commands.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
const STAMP = 'w:date="2026-01-01T10:00:00Z"';

const ins = (id: number, text: string) =>
  `<w:ins w:id="${id}" w:author="Ada" ${STAMP}><w:r><w:t>${text}</w:t></w:r></w:ins>`;
const del = (id: number, text: string) =>
  `<w:del w:id="${id}" w:author="Ada" ${STAMP}><w:r><w:delText>${text}</w:delText></w:r></w:del>`;
const plain = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const p = (...runs: string[]) => `<w:p>${runs.join('')}</w:p>`;

/** Two body changes, one footnote change with the same `w:id` as a body change, a comment. */
const BODY =
  p(plain('Pay in '), ins(1, '30'), del(2, '60'), plain(' days.')) +
  p(
    '<w:commentRangeStart w:id="7"/>',
    plain('Delivery is free.'),
    '<w:commentRangeEnd w:id="7"/>',
    '<w:r><w:commentReference w:id="7"/></w:r>'
  ) +
  p(plain('Note'), '<w:r><w:footnoteReference w:id="5"/></w:r>');

function docx(settings?: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="${WML}.document.main+xml"/>` +
        `<Override PartName="/word/comments.xml" ContentType="${WML}.comments+xml"/>` +
        `<Override PartName="/word/footnotes.xml" ContentType="${WML}.footnotes+xml"/>` +
        (settings
          ? `<Override PartName="/word/settings.xml" ContentType="${WML}.settings+xml"/>`
          : '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="c" Type="${R}/comments" Target="comments.xml"/>` +
        `<Relationship Id="n" Type="${R}/footnotes" Target="footnotes.xml"/>` +
        (settings ? `<Relationship Id="s" Type="${R}/settings" Target="settings.xml"/>` : '') +
        '</Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${BODY}</w:body></w:document>`
    ),
    'word/comments.xml': strToU8(
      `<w:comments xmlns:w="${W}"><w:comment w:id="7" w:author="Ada" ${STAMP}>${p(plain('Why free?'))}</w:comment></w:comments>`
    ),
    'word/footnotes.xml': strToU8(
      `<w:footnotes xmlns:w="${W}"><w:footnote w:id="5">${p(plain('See '), ins(1, 'annex'))}</w:footnote></w:footnotes>`
    ),
    ...(settings
      ? { 'word/settings.xml': strToU8(`<w:settings xmlns:w="${W}">${settings}</w:settings>`) }
      : {}),
  });
}

/** The engine's own review derivation, wired as a module (core may not import pro). */
function reviewModule(): EditorModule {
  return {
    id: 'review',
    review: {
      displayModes: ['all-markup', 'proposed', 'original'],
      collectReviewItems: engineCollectReviewItems,
      revisionItemsOfParagraph: (part, paragraphId) => {
        const paragraph = findNode(part, paragraphId);
        if (!paragraph || paragraph.kind !== 'paragraph') return [];
        return revisionItemsOf({
          id: part.id,
          name: part.name,
          contentType: part.contentType,
          root: paragraph,
        });
      },
    },
  };
}

function mount(options: { review?: boolean; settings?: string } = {}): DocxEditorInstance {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: docx(options.settings),
    author: 'Grace Hopper',
    modules: options.review === false ? [] : [reviewModule()],
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

const xmlOf = (editor: DocxEditorInstance, name: string) =>
  serializeOoxmlPart(editor.surface!.session.currentPackage().parts.get(name)!)
    .replace(/ xmlns:w14="[^"]*"/g, '')
    .replace(/ w14:(?:paraId|textId)="[^"]*"/g, '');
const bodyXml = (editor: DocxEditorInstance) => xmlOf(editor, '/word/document.xml');
const comments = (editor: DocxEditorInstance) =>
  editor.getReviewItems().filter((entry) => entry.kind === 'comment');

/** Select the first characters of a body paragraph. */
function select(editor: DocxEditorInstance, paragraph: number, end: number) {
  const paragraphId = editor.surface!.session.paragraphIds()[paragraph]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset: 0 },
    head: { paragraphId, offset: end },
  });
}

const COMMANDS: readonly EditorCommand[] = [
  { type: 'addComment', text: 'Check this.' },
  { type: 'replyComment', commentId: '7', text: 'Agreed.' },
  { type: 'resolveComment', commentId: '7' },
  { type: 'acceptRevision', id: 1 },
  { type: 'rejectRevision', id: 2 },
];

describe('document comment and revision commands', () => {
  test('without the review module, each is refused with the Pro reason', () => {
    const editor = mount({ review: false });
    select(editor, 1, 8);
    for (const command of COMMANDS) {
      const expected = { ok: false, code: 'unsupported', reason: PRO_REVIEW_REASON };
      expect(editor.can(command)).toEqual(expected);
      expect(editor.exec(command)).toEqual(expected);
    }
    editor.destroy();
  });

  test('can() admits each one that exec() then runs', () => {
    for (const command of COMMANDS) {
      const editor = mount();
      select(editor, 1, 8);
      expect(editor.can(command)).toEqual({ ok: true });
      expect(editor.exec(command)).toMatchObject({ ok: true, changed: true });
      editor.destroy();
    }
  });

  test('addComment comments on the selection, with an optional author', () => {
    const editor = mount();
    select(editor, 1, 8);
    expect(editor.exec({ type: 'addComment', text: 'Check this.', author: 'Legal' }).ok).toBe(true);
    const added = comments(editor).find(
      (entry) => entry.item.kind === 'comment' && entry.item.comment.author === 'Legal'
    );
    expect(added).toBeDefined();
    editor.destroy();
  });

  test('addComment refuses a collapsed selection and a target, in can() and exec()', () => {
    const editor = mount();
    select(editor, 1, 0);
    const collapsed = { type: 'addComment', text: 'x' } as const;
    expect(editor.can(collapsed)).toMatchObject({ ok: false, code: 'invalidArgs' });
    expect(editor.exec(collapsed)).toMatchObject({ ok: false, code: 'invalidArgs' });
    select(editor, 1, 8);
    const targeted = {
      type: 'addComment',
      text: 'x',
      target: { anchor: { paraId: 'nothing' } },
    } as unknown as EditorCommand;
    expect(editor.can(targeted)).toMatchObject({ ok: false, code: 'unsupported' });
    expect(editor.exec(targeted)).toMatchObject({ ok: false, code: 'unsupported' });
    editor.destroy();
  });

  test('replyComment and resolveComment address the comment by its w:id', () => {
    const editor = mount();
    expect(editor.exec({ type: 'replyComment', commentId: '7', text: 'Agreed.' }).ok).toBe(true);
    expect(xmlOf(editor, '/word/comments.xml')).toContain('Agreed.');
    expect(editor.exec({ type: 'resolveComment', commentId: '7' }).ok).toBe(true);
    const thread = comments(editor).find(
      (entry) => entry.item.kind === 'comment' && entry.item.comment.id === '7'
    );
    expect(thread?.item.kind === 'comment' && thread.item.resolved).toBe(true);
    // Repeating the state succeeds without a change, as `setCommentResolved` does.
    expect(editor.exec({ type: 'resolveComment', commentId: '7' })).toEqual({
      ok: true,
      changed: false,
    });
    editor.destroy();
  });

  test('an unknown comment id is refused with notFound', () => {
    const editor = mount();
    for (const command of [
      { type: 'replyComment', commentId: '99', text: 'x' },
      { type: 'resolveComment', commentId: '99' },
    ] as const) {
      expect(editor.can(command)).toMatchObject({ ok: false, code: 'notFound' });
      expect(editor.exec(command)).toMatchObject({ ok: false, code: 'notFound' });
    }
    editor.destroy();
  });

  test('acceptRevision and rejectRevision decide the body change with that w:id', () => {
    const editor = mount();
    expect(editor.exec({ type: 'acceptRevision', id: 1 }).ok).toBe(true);
    expect(editor.exec({ type: 'rejectRevision', id: 2 }).ok).toBe(true);
    const body = bodyXml(editor);
    expect(body).not.toContain('<w:ins');
    expect(body).not.toContain('<w:del');
    expect(body).toContain('<w:t>60</w:t>');
    // The footnote change with the same w:id stays pending.
    expect(xmlOf(editor, '/word/footnotes.xml')).toContain('<w:ins');
    editor.destroy();
  });

  test('part and noteId address a note change', () => {
    const editor = mount();
    expect(
      editor.can({ type: 'acceptRevision', id: 1, part: 'footnote', noteId: 4 })
    ).toMatchObject({ ok: false, code: 'notFound' });
    expect(editor.exec({ type: 'acceptRevision', id: 1, part: 'footnote', noteId: 5 }).ok).toBe(
      true
    );
    expect(xmlOf(editor, '/word/footnotes.xml')).not.toContain('<w:ins');
    expect(bodyXml(editor)).toContain('<w:ins');
    editor.destroy();
  });

  test('an unknown revision id is notFound, and invalid arguments are invalidArgs', () => {
    const editor = mount();
    expect(editor.exec({ type: 'acceptRevision', id: 42 })).toMatchObject({
      ok: false,
      code: 'notFound',
    });
    for (const command of [
      { type: 'acceptRevision', id: 1.5 },
      { type: 'acceptRevision', id: 1, noteId: 5 },
      { type: 'rejectRevision', id: 1, part: 'header' },
    ] as unknown as EditorCommand[]) {
      expect(editor.can(command)).toMatchObject({ ok: false, code: 'invalidArgs' });
      expect(editor.exec(command)).toMatchObject({ ok: false, code: 'invalidArgs' });
    }
    editor.destroy();
  });

  test('each is refused with locked while viewing', () => {
    const editor = mount();
    select(editor, 1, 8);
    expect(editor.exec({ type: 'setEditingMode', mode: 'viewing' }).ok).toBe(true);
    for (const command of COMMANDS) {
      expect(editor.can(command)).toMatchObject({ ok: false, code: 'locked' });
      expect(editor.exec(command)).toMatchObject({ ok: false, code: 'locked' });
    }
    editor.destroy();
  });

  test('a comment and a revision decision join one history group', () => {
    const editor = mount();
    const before = bodyXml(editor);
    const group = editor.beginHistoryGroup();
    expect(editor.exec({ type: 'acceptRevision', id: 1 }, { historyGroup: group }).ok).toBe(true);
    select(editor, 1, 8);
    expect(editor.exec({ type: 'addComment', text: 'Accepted.' }, { historyGroup: group }).ok).toBe(
      true
    );
    expect(
      editor.exec({ type: 'resolveComment', commentId: '7' }, { historyGroup: group }).ok
    ).toBe(true);
    group.end();
    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    expect(bodyXml(editor)).toBe(before);
    expect(comments(editor)).toHaveLength(1);
    editor.destroy();
  });
});

describe('tracked-changes protection', () => {
  const TRACKED = '<w:documentProtection w:edit="trackedChanges" w:enforcement="1"/>';
  const locked = { ok: false, code: 'locked', reason: TRACKED_CHANGES_DECISION_REASON };

  test('refuses every accept and reject, and writes nothing', () => {
    const editor = mount({ settings: TRACKED });
    const before = bodyXml(editor);
    const decisions: EditorCommand[] = [
      { type: 'acceptAllRevisions' },
      { type: 'rejectAllRevisions' },
      { type: 'resolveAllReviewChanges', action: 'accept' },
      { type: 'resolveAllReviewChanges', action: 'reject', scope: 'document' },
      { type: 'acceptRevision', id: 1 },
      { type: 'rejectRevision', id: 2 },
    ];
    for (const command of decisions) {
      expect(editor.can(command)).toEqual(locked);
      expect(editor.exec(command)).toMatchObject(locked);
    }
    const card = editor
      .getReviewItems({ pairReplacements: false })
      .find((entry) => entry.kind === 'revision')!;
    expect(editor.acceptReviewItem(card.key)).toEqual(locked);
    expect(editor.rejectReviewItem(card.key)).toEqual(locked);
    expect(bodyXml(editor)).toBe(before);
    editor.destroy();
  });

  test('shows the toolbar Accept All and Reject All controls disabled with the reason', () => {
    const editor = mount({ settings: TRACKED });
    for (const id of ['review.acceptAllChanges', 'review.rejectAllChanges'] as const) {
      expect(toolbarCommandState(editor, id)).toMatchObject({
        enabled: false,
        disabledReason: TRACKED_CHANGES_DECISION_REASON,
      });
    }
    editor.destroy();
  });

  test('keeps comments allowed', () => {
    const editor = mount({ settings: TRACKED });
    select(editor, 1, 8);
    expect(editor.exec({ type: 'addComment', text: 'A question.' }).ok).toBe(true);
    expect(editor.exec({ type: 'replyComment', commentId: '7', text: 'Agreed.' }).ok).toBe(true);
    editor.destroy();
  });

  test('control: without protection the toolbar controls are enabled', () => {
    const editor = mount();
    expect(toolbarCommandState(editor, 'review.acceptAllChanges').enabled).toBe(true);
    editor.destroy();
  });
});
