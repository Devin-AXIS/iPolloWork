// Editing the text of a comment through the editor: the card shows the new text, Undo restores the
// old one in one step, and the refusals name their cause.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { collectReviewItems, findNode, revisionItemsOf } from '@docx-editor.dev/core/store';
import type { EditorModule } from '../../contracts/modules.ts';
import type { ReviewItemPlacement } from '../contracts/editor.ts';
import { createReviewWrites, type ReviewWriteDeps } from '../docx-editor-review-writes.ts';
import type { PaginatedSurface } from '../paginated-surface-contract.ts';
import { writeOoxmlPackage } from '../../store/package/ooxml-package.ts';
import {
  W14,
  W15,
  loadCommentFixture,
  markedComment,
} from '../../store/__tests__/comment-lifecycle-test-support.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const DATE = '2026-01-01T00:00:00Z';

const BODY =
  '<w:p><w:r><w:t xml:space="preserve">Payment is due in </w:t></w:r>' +
  `<w:ins w:id="1" w:author="Counterparty" w:date="${DATE}"><w:r><w:t>30</w:t></w:r></w:ins>` +
  '<w:r><w:t xml:space="preserve"> days.</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>Delivery is free.</w:t></w:r></w:p>';

function docx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${BODY}</w:body></w:document>`
    ),
  });
}

function reviewModule(): EditorModule {
  return {
    id: 'review',
    review: {
      displayModes: ['all-markup', 'proposed', 'original'],
      collectReviewItems,
      revisionItemsOfParagraph: (part, paragraphId) => {
        const paragraph = findNode(part, paragraphId);
        if (!paragraph || paragraph.kind !== 'paragraph') return [];
        return revisionItemsOf({ ...part, root: paragraph });
      },
    },
  };
}

function withEditor(
  run: (editor: DocxEditorInstance) => Promise<void> | void,
  bytes: () => Uint8Array = docx
) {
  return async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({
      container,
      document: bytes(),
      author: 'Reviewer',
      modules: [reviewModule()],
    });
    if (!editor.surface) throw new Error('surface failed to mount');
    try {
      await run(editor);
    } finally {
      editor.destroy();
      container.remove();
    }
  };
}

async function savedComments(editor: DocxEditorInstance): Promise<string> {
  const files = unzipSync(new Uint8Array(await editor.save()));
  const comments = files['word/comments.xml'];
  return comments ? strFromU8(comments) : '';
}

/** Comment the second paragraph, and answer the comment's card key. */
function commentOnDelivery(editor: DocxEditorInstance): string {
  const id = editor.surface!.session.paragraphIds()[1]!;
  editor.surface!.setSelection({
    anchor: { paragraphId: id, offset: 0 },
    head: { paragraphId: id, offset: 8 },
  });
  expect(editor.addComment('Is delivery free everywhere?').ok).toBe(true);
  const comment = editor.getReviewItems().find((item) => item.kind === 'comment');
  if (!comment) throw new Error('no comment card');
  return comment.key;
}

const textOf = (editor: DocxEditorInstance, key: string) =>
  editor.getReviewItems().find((item) => item.key === key)?.text;

describe('setCommentText', () => {
  test(
    'replaces the text of the card and of the saved comment, and Undo restores it',
    withEditor(async (editor) => {
      const key = commentOnDelivery(editor);
      const before = await savedComments(editor);

      expect(editor.setCommentText(key, 'Is delivery free in every state?')).toEqual({
        ok: true,
        changed: true,
      });
      expect(textOf(editor, key)).toBe('Is delivery free in every state?');
      expect(await savedComments(editor)).toContain('Is delivery free in every state?');

      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(textOf(editor, key)).toBe('Is delivery free everywhere?');
      expect(await savedComments(editor)).toBe(before);
    })
  );

  test(
    'the same text succeeds without a change',
    withEditor((editor) => {
      const key = commentOnDelivery(editor);
      expect(editor.setCommentText(key, 'Is delivery free everywhere?')).toEqual({
        ok: true,
        changed: false,
      });
    })
  );

  test(
    'refuses blank text, a revision card, an unknown key, and viewing mode',
    withEditor((editor) => {
      const key = commentOnDelivery(editor);
      expect(editor.setCommentText(key, '   ')).toMatchObject({ ok: false, code: 'invalidArgs' });
      const revision = editor.getReviewItems().find((item) => item.kind === 'revision');
      expect(editor.setCommentText(revision!.key, 'text')).toMatchObject({
        ok: false,
        code: 'kindMismatch',
      });
      expect(editor.setCommentText('nope', 'text')).toMatchObject({ ok: false, code: 'notFound' });
      editor.exec({ type: 'setEditingMode', mode: 'viewing' });
      expect(editor.setCommentText(key, 'text')).toMatchObject({ ok: false, code: 'locked' });
      expect(textOf(editor, key)).toBe('Is delivery free everywhere?');
    })
  );
});

/** Comment 1 is resolved and has a reply (2), as Word writes a thread. */
function thread(comments: string): () => Uint8Array {
  return () =>
    writeOoxmlPackage(
      loadCommentFixture({
        body:
          '<w:p><w:commentRangeStart w:id="1"/><w:commentRangeStart w:id="2"/>' +
          '<w:r><w:t>Delivery</w:t></w:r><w:commentRangeEnd w:id="1"/><w:commentRangeEnd w:id="2"/>' +
          '<w:r><w:commentReference w:id="1"/></w:r><w:r><w:commentReference w:id="2"/></w:r></w:p>' +
          markedComment('Payment', '7'),
        comments: `<w:comments xmlns:w="${W}" xmlns:w14="${W14}">${comments}</w:comments>`,
        extended:
          `<w15:commentsEx xmlns:w15="${W15}">` +
          `<w15:commentEx w15:paraId="11111111" w15:done="1"/>` +
          `<w15:commentEx w15:paraId="22222222" w15:paraIdParent="11111111" w15:done="1"/>` +
          `</w15:commentsEx>`,
      })
    );
}

const THREAD =
  '<w:comment w:id="1" w:author="Ada"><w:p w14:paraId="11111111"><w:r><w:t>Is it free?</w:t></w:r></w:p></w:comment>' +
  '<w:comment w:id="2" w:author="Grace"><w:p w14:paraId="22222222"><w:r><w:t>Yes</w:t></w:r></w:p></w:comment>';

describe('setCommentText on a loaded document', () => {
  test(
    'editing a reply keeps it under its comment and the thread resolved, through save and reopen',
    withEditor(
      async (editor) => {
        const comments = () => editor.getReviewItems().filter((item) => item.kind === 'comment');
        const reply = comments().find((item) => item.parentId !== undefined)!;
        const root = comments().find((item) => item.parentId === undefined)!;
        editor.setAuthor('Grace');
        expect(editor.setCommentText(reply.key, 'Yes, in every state')).toEqual({
          ok: true,
          changed: true,
        });
        for (const reopen of [false, true]) {
          if (reopen) editor.load(await editor.save());
          const [first, second] = [root, reply].map((card) =>
            comments().find((item) => item.id === card.id)!
          );
          expect(first).toMatchObject({ text: 'Is it free?', resolved: true });
          expect(second).toMatchObject({
            text: 'Yes, in every state',
            parentId: root.id,
            resolved: true,
          });
        }
      },
      thread(
        THREAD +
          '<w:comment w:id="7" w:author="Ada"><w:p><w:r><w:t>Due?</w:t></w:r></w:p></w:comment>'
      )
    )
  );

  test(
    'two records with one id are refused as ambiguous, and neither changes',
    withEditor(
      async (editor) => {
        const before = await savedComments(editor);
        const card = editor.getReviewItems().find((item) => item.id === '7')!;
        expect(editor.setCommentText(card.key, 'Which one?')).toMatchObject({
          ok: false,
          code: 'ambiguous',
        });
        expect(await savedComments(editor)).toBe(before);
      },
      thread(
        THREAD +
          '<w:comment w:id="7" w:author="Ada"><w:p><w:r><w:t>First</w:t></w:r></w:p></w:comment>' +
          '<w:comment w:id="7" w:author="Ada"><w:p><w:r><w:t>Second</w:t></w:r></w:p></w:comment>'
      )
    )
  );
});

describe('setCommentText reports what the session wrote', () => {
  /** The editor's review writes over a session that answers `ok` and moves the revision or not. */
  function writes(moves: boolean) {
    let revision = 0;
    let bumps = 0;
    const item = {
      kind: 'comment',
      id: '7',
      comment: { author: 'Reviewer', blocks: [] },
      range: null,
      resolved: false,
      replyIds: [],
      orphaned: false,
    };
    const placement = { key: 'comment-7', id: '7', kind: 'comment', text: 'Old', item };
    const surface = {
      commitReviewOps(run: (token: unknown) => unknown) {
        run(undefined);
      },
      session: {
        setCommentText: () => {
          if (moves) revision += 1;
          return true;
        },
        packageRevision: () => revision,
        currentPackage: () => ({
          mainDocumentPart: '/word/document.xml',
          parts: new Map(),
          relationships: new Map(),
        }),
      },
    } as unknown as PaginatedSurface;
    const deps = {
      reviewEnabled: true,
      author: () => 'Reviewer',
      historyGroups: {
        validate: () => null,
        run: (_surface: unknown, _command: unknown, _options: unknown, write: () => unknown) =>
          write(),
      },
      surface: () => surface,
      editingMode: () => 'editing',
      placements: () => [placement as unknown as ReviewItemPlacement],
      bump: () => {
        bumps += 1;
      },
    } as unknown as ReviewWriteDeps;
    return { edit: createReviewWrites(deps).setCommentText, bumps: () => bumps };
  }

  test('a write that leaves the package as it was is no change, and repaints nothing', () => {
    const { edit, bumps } = writes(false);
    expect(edit('comment-7', 'New')).toEqual({ ok: true, changed: false });
    expect(bumps()).toBe(0);
  });

  test('a write that moves the package is a change, and repaints once', () => {
    const { edit, bumps } = writes(true);
    expect(edit('comment-7', 'New')).toEqual({ ok: true, changed: true });
    expect(bumps()).toBe(1);
  });
});

test(
  'only the configured author edits a comment, and stale drafts do not overwrite it',
  withEditor((editor) => {
    const key = commentOnDelivery(editor);
    editor.setAuthor('Another reviewer');
    expect(editor.setCommentText(key, 'Not mine')).toMatchObject({ ok: false, code: 'locked' });
    editor.setAuthor(undefined);
    expect(editor.setCommentText(key, 'Unknown author')).toMatchObject({
      ok: false,
      code: 'locked',
    });
    editor.setAuthor('Reviewer');
    expect(
      editor.setCommentText(key, 'Newer version', { expectedText: 'Is delivery free everywhere?' })
    ).toEqual({ ok: true, changed: true });
    expect(
      editor.setCommentText(key, 'Stale draft', { expectedText: 'Is delivery free everywhere?' })
    ).toEqual({ ok: false, code: 'invalidArgs', reason: 'comment-text-changed' });
    expect(textOf(editor, key)).toBe('Newer version');
    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    expect(textOf(editor, key)).toBe('Is delivery free everywhere?');
  })
);
