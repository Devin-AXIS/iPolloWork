// One review decision, one undo step.
//
// A review UI resolves the counterparty's changes, writes a counter-proposal, and comments on
// it as ONE decision. Each of those writes reaches a different store lane — a bulk resolution
// (an atomic multi-part transaction), a tracked proposal (a story transaction) and a comment
// (a package unit) — and the history group makes them one undo step and one redo step.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { collectReviewItems, findNode, revisionItemsOf } from '@docx-editor.dev/core/store';
import type { EditorModule } from '../../contracts/modules.ts';
import type { HistoryGroup } from '../../contracts/editor.ts';

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

function withEditor(run: (editor: DocxEditorInstance) => Promise<void> | void) {
  return async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({
      container,
      document: docx(),
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

/** The saved document and comments parts, which together are the decision's whole effect. */
async function saved(editor: DocxEditorInstance): Promise<string> {
  const files = unzipSync(new Uint8Array(await editor.save()));
  const comments = files['word/comments.xml'];
  return strFromU8(files['word/document.xml']!) + (comments ? strFromU8(comments) : '');
}

function select(editor: DocxEditorInstance, paragraph: number, start: number, end: number) {
  const id = editor.surface!.session.paragraphIds()[paragraph]!;
  editor.surface!.setSelection({
    anchor: { paragraphId: id, offset: start },
    head: { paragraphId: id, offset: end },
  });
}

/** Resolve, counter-propose, and comment, each as a frame of `group`. */
function decide(editor: DocxEditorInstance, group: HistoryGroup) {
  const results = [
    editor.exec(
      { type: 'resolveAllReviewChanges', action: 'reject', scope: 'document' },
      { historyGroup: group }
    ),
  ];
  select(editor, 0, 18, 18);
  results.push(
    editor.exec({ type: 'proposeInsertion', text: '45', author: 'Reviewer' } as never, {
      historyGroup: group,
    })
  );
  select(editor, 1, 0, 8);
  results.push(editor.addComment('Counter-proposal: 45 days.', undefined, { historyGroup: group }));
  return results;
}

describe('history groups across review writes', () => {
  test(
    'resolve, counter-proposal and comment are one undo step and one redo step',
    withEditor(async (editor) => {
      const before = await saved(editor);
      const decision = editor.beginHistoryGroup();
      const results = decide(editor, decision);
      expect(results.map((result) => (result.ok ? result.history?.kind : result.reason))).toEqual([
        'started',
        'extended',
        'extended',
      ]);
      decision.end();
      const after = await saved(editor);
      expect(after).toContain('45');
      expect(after).toContain('Counter-proposal: 45 days.');
      expect(after).not.toContain('Counterparty');

      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(await saved(editor)).toBe(before);
      expect(editor.snapshot().canUndo).toBe(false);
      expect(editor.exec({ type: 'redo' }).ok).toBe(true);
      expect(await saved(editor)).toBe(after);
      expect(editor.snapshot().canRedo).toBe(false);
    })
  );

  test(
    'card writes join the group: accept, reply, resolve, edit and delete',
    withEditor(async (editor) => {
      const before = await saved(editor);
      const decision = editor.beginHistoryGroup();
      const [card] = editor.getReviewItems();
      expect(
        editor.replyToReviewItem(card!.key, 'Why 30?', { historyGroup: decision })
      ).toMatchObject({ ok: true, history: { kind: 'started' } });
      expect(editor.acceptReviewItem(card!.key, { historyGroup: decision })).toMatchObject({
        ok: true,
        history: { kind: 'extended' },
      });
      const comment = editor.getReviewItems().find((item) => item.kind === 'comment')!;
      expect(
        editor.setCommentResolved(comment.key, true, { historyGroup: decision })
      ).toMatchObject({ ok: true, history: { kind: 'extended' } });
      expect(
        editor.setCommentText(comment.key, 'Why only 30?', { historyGroup: decision })
      ).toMatchObject({ ok: true, history: { kind: 'extended' } });
      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(await saved(editor)).toBe(before);
      expect(editor.snapshot().canUndo).toBe(false);

      const removal = editor.beginHistoryGroup();
      select(editor, 1, 0, 8);
      expect(editor.addComment('Remove me', { historyGroup: removal }).ok).toBe(true);
      // Options built in another window have that window's `Object.prototype`.
      const foreignObjectPrototype = Object.create(null) as object;
      const foreignOptions = Object.assign(Object.create(foreignObjectPrototype), {
        historyGroup: removal,
      }) as { historyGroup: typeof removal };
      expect(editor.addComment('Pop-out', foreignOptions)).toMatchObject({
        ok: true,
        history: { kind: 'extended' },
      });
      // Ambiguous arguments refuse instead of dropping an author or a handle.
      for (const refused of [
        editor.addComment('No', ['Bob'] as never),
        editor.addComment('No', { historyGroup: removal } as never, { historyGroup: removal }),
        editor.replyToReviewItem(card!.key, 'No', new Map() as never),
      ])
        expect(refused).toMatchObject({ ok: false, code: 'invalidArgs' });
      const added = editor.getReviewItems().find((item) => item.kind === 'comment')!;
      expect(editor.deleteReviewItem(added.key, { historyGroup: removal })).toMatchObject({
        ok: true,
        history: { kind: 'extended' },
      });
      expect(editor.rejectReviewItem(card!.key, { historyGroup: removal }).ok).toBe(true);
      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(await saved(editor)).toBe(before);
    })
  );

  test(
    'reattributing changes joins the group',
    withEditor(async (editor) => {
      const before = await saved(editor);
      const decision = editor.beginHistoryGroup();
      expect(
        editor.exec(
          { type: 'setReviewChangesAuthor', author: 'Reviewer', scope: 'document' },
          { historyGroup: decision }
        )
      ).toMatchObject({ ok: true, history: { kind: 'started' } });
      select(editor, 1, 0, 8);
      expect(editor.addComment('Taken over.', undefined, { historyGroup: decision })).toMatchObject(
        { ok: true, history: { kind: 'extended' } }
      );
      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(await saved(editor)).toBe(before);
      expect(editor.snapshot().canUndo).toBe(false);
    })
  );

  test(
    'undo closes the group: the next frame starts a new step',
    withEditor(async (editor) => {
      const decision = editor.beginHistoryGroup();
      expect(
        editor.exec(
          { type: 'resolveAllReviewChanges', action: 'accept', scope: 'document' },
          { historyGroup: decision }
        ).ok
      ).toBe(true);
      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      select(editor, 1, 0, 8);
      expect(editor.addComment('Later', undefined, { historyGroup: decision })).toMatchObject({
        ok: true,
        history: { kind: 'split', reason: 'undo-redo' },
      });
      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(editor.getReviewItems().filter((item) => item.kind === 'comment')).toHaveLength(0);
      expect(editor.getReviewItems()).toHaveLength(1);
    })
  );

  test(
    'another group, or an ungrouped write, closes the group',
    withEditor(async (editor) => {
      const first = editor.beginHistoryGroup();
      editor.exec(
        { type: 'resolveAllReviewChanges', action: 'accept', scope: 'document' },
        { historyGroup: first }
      );
      select(editor, 1, 0, 8);
      editor.addComment('Other', undefined, { historyGroup: editor.beginHistoryGroup() });
      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(editor.getReviewItems().filter((item) => item.kind === 'comment')).toHaveLength(0);
      expect(editor.surface!.session.bodyText()).toContain('30');
      expect(editor.getReviewItems()).toHaveLength(0);
    })
  );

  test(
    'a closed or foreign handle refuses every review write and changes nothing',
    withEditor(async (editor) => {
      const before = await saved(editor);
      const ended = editor.beginHistoryGroup();
      ended.end();
      const [card] = editor.getReviewItems();
      select(editor, 1, 0, 8);
      for (const historyGroup of [ended, Symbol('forged') as unknown as HistoryGroup]) {
        const options = { historyGroup };
        for (const result of [
          editor.addComment('No', undefined, options),
          editor.acceptReviewItem(card!.key, options),
          editor.rejectReviewItem(card!.key, options),
          editor.replyToReviewItem(card!.key, 'No', undefined, options),
          editor.deleteReviewItem(card!.key, options),
          editor.setCommentResolved(card!.key, true, options),
          editor.setCommentText(card!.key, 'No', options),
          editor.exec({ type: 'resolveAllReviewChanges', action: 'accept' }, options),
        ]) {
          expect(result).toMatchObject({ ok: false, code: 'unsupported' });
        }
      }
      expect(await saved(editor)).toBe(before);
      expect(editor.snapshot().canUndo).toBe(false);
    })
  );
});
