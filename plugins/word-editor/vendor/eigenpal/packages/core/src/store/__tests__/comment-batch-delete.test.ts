import { expect, test } from 'bun:test';
import { commentBatchFixture } from './comment-batch-fixture.ts';
import {
  deleteCommentBatch,
  deleteCommentBatchWithBudget,
} from '../package/comment-batch-delete.ts';
import { deleteCommentReply, deleteCommentThreadInStory } from '../package/comment-lifecycle.ts';
import { commentDeletionBudget } from '../package/comment-deletion-budget.ts';
import { createCommentScanBudget } from '../package/comment-lifecycle-scan.ts';
import { readOoxmlPart, serializeOoxmlPart, withPart, type OoxmlPackage } from '../index.ts';
import { TreePackageStore } from '../store/tree-package-store.ts';
import { deletePackageComments } from '../store/comment-package-write.ts';
import {
  observeCanonicalPrimitiveJournal,
  flushPendingCanonicalJournals,
} from '../package/canonical-primitive-capture.ts';
import type { CanonicalPrimitiveJournal } from '../package/canonical-primitive-journal.ts';
import {
  loadNestedReplyComments,
  loadSharedNestedReplyComments,
  loadDuplicateBodyHeader,
  loadDuplicateNotes,
  loadIsolatedStoryComments,
  loadWrongTypedConventionalComments,
  commentIds,
  loadCommentFixture,
  markedComment,
  W,
} from './comment-lifecycle-test-support.ts';

type Deletion = { commentId: string; parentCommentId?: string };
function xml(pkg: OoxmlPackage | null): unknown {
  return pkg === null
    ? null
    : [...pkg.parts].map(([name, part]) => [name, serializeOoxmlPart(part)]);
}

function duplicateRecords(): OoxmlPackage {
  return loadCommentFixture({
    body: markedComment('kept', '1'),
    comments: `<w:comments xmlns:w="${W}"><w:comment w:id="1"><w:p><w:r><w:t>first</w:t></w:r></w:p></w:comment><w:comment w:id="1"><w:p><w:r><w:t>second</w:t></w:r></w:p></w:comment></w:comments>`,
  });
}

function markersInsideCommentRecords(): OoxmlPackage {
  return loadCommentFixture({
    body: markedComment('one', '1') + markedComment('two', '2'),
    comments: `<w:comments xmlns:w="${W}"><w:comment w:id="1">${markedComment('nested', '2')}</w:comment><w:comment w:id="2"><w:p><w:r><w:t>second</w:t></w:r></w:p></w:comment></w:comments>`,
  });
}

for (const load of [
  loadNestedReplyComments,
  loadSharedNestedReplyComments,
  loadDuplicateBodyHeader,
  loadDuplicateNotes,
  loadIsolatedStoryComments,
  loadWrongTypedConventionalComments,
  duplicateRecords,
  markersInsideCommentRecords,
]) {
  test(`batch order matches sequential deletion for ${load.name}`, () => {
    const pkg = load();
    const requests: Deletion[] = [
      { commentId: '1' },
      { commentId: '2' },
      { commentId: '4' },
      { commentId: '2', parentCommentId: '1' },
      { commentId: '4', parentCommentId: '2' },
      { commentId: '4', parentCommentId: '1' },
      { commentId: 'missing' },
    ];
    const owners = [...pkg.parts.values()]
      .filter((part) => ['document', 'header', 'footnotes'].includes(part.root.kind))
      .flatMap((part) =>
        part.root.kind === 'footnotes'
          ? [1, 2].map((noteId) => ({ storyPartName: part.name, noteId }))
          : [{ storyPartName: part.name }]
      );
    for (const owner of owners)
      for (const first of requests)
        for (const second of requests) {
          const batch = [first, second, first];
          let sequential: OoxmlPackage | null = pkg;
          for (const item of batch) {
            if (sequential === null) break;
            sequential =
              item.parentCommentId === undefined
                ? deleteCommentThreadInStory(sequential, item.commentId, owner)
                : deleteCommentReply(sequential, item.commentId, item.parentCommentId, owner);
          }
          expect(xml(deleteCommentBatch(pkg, batch, owner))).toEqual(xml(sequential));
        }
  });
}

test('an incomplete batch plan leaves the original package unchanged', () => {
  const pkg = loadNestedReplyComments();
  const before = xml(pkg);
  let completed = false;
  for (let max = 0; max < 256; max += 1) {
    const budget = createCommentScanBudget(max);
    const result = deleteCommentBatchWithBudget(
      pkg,
      [{ commentId: '2', parentCommentId: '1' }, { commentId: '1' }],
      { storyPartName: pkg.mainDocumentPart },
      budget
    );
    if (budget.truncated) expect(result).toBeNull();
    else {
      expect(result).not.toBeNull();
      expect(commentIds(result!, pkg.mainDocumentPart)).toEqual([]);
      completed = true;
    }
    expect(xml(pkg)).toEqual(before);
  }
  expect(completed).toBe(true);
});

test('batch deletion refuses excessive nesting without changing the package', () => {
  const base = loadNestedReplyComments();
  const main = base.parts.get(base.mainDocumentPart)!;
  const parsed = readOoxmlPart(
    serializeOoxmlPart(main)
      .replace('<w:body>', '<w:body>' + '<w:customXml>'.repeat(65))
      .replace('</w:body>', '</w:customXml>'.repeat(65) + '</w:body>'),
    { name: main.name, contentType: main.contentType }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const pkg = withPart(base, parsed.part);
  const before = xml(pkg);
  expect(
    deleteCommentBatch(pkg, [{ commentId: '1' }, { commentId: '2', parentCommentId: '1' }], {
      storyPartName: main.name,
    })
  ).toBeNull();
  expect(xml(pkg)).toEqual(before);
});

test('a large batch journal never removes and reinserts retained comment siblings', () => {
  const pkg = commentBatchFixture(200, 100);
  const store = new TreePackageStore(pkg, pkg.parts.get(pkg.mainDocumentPart)!);
  const journals: CanonicalPrimitiveJournal[] = [];
  const detach = observeCanonicalPrimitiveJournal(store, (journal) => journals.push(journal));
  try {
    const targets = Array.from({ length: 100 }, (_, index) => ({ commentId: String(index * 2) }));
    expect(deletePackageComments(store, targets)).toBe(true);
    flushPendingCanonicalJournals(store);
    expect(journals).toHaveLength(1);
    expect(journals[0]!.effects.length).toBeGreaterThan(0);
    for (const effect of journals[0]!.effects) {
      expect(effect.kind).toBe('spliceChildren');
      if (effect.kind === 'spliceChildren') expect(effect.childLogicalIds).toEqual([]);
    }
    expect(commentIds(store.currentPackage(), pkg.mainDocumentPart)).toEqual(
      Array.from({ length: 100 }, (_, index) => String(index * 2 + 1))
    );
  } finally {
    detach();
  }
});

test('600 threads share the same scan bound as one thread in a large document', () => {
  const ids = Array.from({ length: 600 }, (_, index) => String(index));
  const pkg = commentBatchFixture();
  const owner = { storyPartName: pkg.mainDocumentPart };
  const oneBudget = commentDeletionBudget(pkg);
  expect(deleteCommentBatchWithBudget(pkg, [{ commentId: '0' }], owner, oneBudget)).not.toBeNull();
  const batchBudget = commentDeletionBudget(pkg);
  const result = deleteCommentBatchWithBudget(
    pkg,
    ids.map((commentId) => ({ commentId })),
    owner,
    batchBudget
  );
  expect(result).not.toBeNull();
  expect(commentIds(result!, pkg.mainDocumentPart)).toEqual([]);
  expect(batchBudget.visited).toBeLessThanOrEqual(oneBudget.visited);
  expect(batchBudget.parts).toBe(oneBudget.parts);
});
