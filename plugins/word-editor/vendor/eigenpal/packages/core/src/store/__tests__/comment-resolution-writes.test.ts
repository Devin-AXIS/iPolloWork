// Transitive comment-thread resolution: nested metadata, coincident inference, fail-closed scans.

import { describe, expect, test } from 'bun:test';
import {
  TreeDocumentStore,
  collectReviewItems,
  commentsExtendedPartNameOf,
  readOoxmlPackage,
  relationshipsOf,
  serializeOoxmlPart,
  threadStateOfPart,
  writeOoxmlPackage,
  type OoxmlPackage,
} from '../index.ts';
import {
  commentResolutionCommentsRootRewrites,
  commentResolutionExtendedRootRewrites,
  setCommentResolved,
  setCommentResolvedWithBudget,
} from '../store/comment-writes.ts';
import {
  createCommentScanBudget,
  MAX_COMMENT_SCAN_PARTS,
} from '../package/comment-lifecycle-scan.ts';
import {
  W,
  W14,
  W15,
  W16CID,
  loadCommentFixture,
  loadDuplicateBodyHeader,
  loadDuplicateNotes,
  loadNestedReplyComments,
  markedComment,
  prependXmlPadding,
} from './comment-lifecycle-test-support.ts';

function storeOf(pkg: OoxmlPackage): TreeDocumentStore {
  return new TreeDocumentStore(pkg, pkg.mainDocumentPart);
}

function commentsXml(body: string): string {
  return `<w:comments xmlns:w="${W}" xmlns:w14="${W14}" xmlns:w16cid="${W16CID}">${body}</w:comments>`;
}

function comment(id: string, paraId: string, text: string, parentId?: string): string {
  const parent = parentId === undefined ? '' : ` w16cid:parentId="${parentId}"`;
  return (
    `<w:comment w:id="${id}" w:author="Ada"${parent}>` +
    `<w:p w14:paraId="${paraId}"><w:r><w:t>${text}</w:t></w:r></w:p></w:comment>`
  );
}

function extended(entries: string): string {
  return `<w15:commentsEx xmlns:w15="${W15}">${entries}</w15:commentsEx>`;
}

function doneOf(pkg: OoxmlPackage): Map<string, boolean> {
  const name = commentsExtendedPartNameOf(pkg, pkg.mainDocumentPart);
  const part = pkg.parts.get(name);
  return part ? threadStateOfPart(part) : new Map();
}

function expectDone(pkg: OoxmlPackage, paraIds: readonly string[], resolved: boolean): void {
  const state = doneOf(pkg);
  for (const paraId of paraIds) {
    expect(state.get(paraId.toUpperCase())?.done).toBe(resolved);
  }
}

function expectRefused(store: TreeDocumentStore): void {
  const comments = store.package.parts.get('/word/comments.xml')!;
  const before = serializeOoxmlPart(comments);
  const extended = store.package.parts.get('/word/commentsExtended.xml');
  const beforeEx = extended ? serializeOoxmlPart(extended) : null;
  const ids = store.package.parts.get('/word/commentsIds.xml');
  const beforeIds = ids ? serializeOoxmlPart(ids) : null;
  expect(setCommentResolved(store, '1', true)).toEqual({
    ok: false,
    reason: 'unknown-comment',
  });
  expect(serializeOoxmlPart(store.package.parts.get('/word/comments.xml')!)).toBe(before);
  if (beforeEx !== null) {
    expect(serializeOoxmlPart(store.package.parts.get('/word/commentsExtended.xml')!)).toBe(
      beforeEx
    );
  } else {
    expect(store.package.parts.has('/word/commentsExtended.xml')).toBe(false);
  }
  if (beforeIds !== null) {
    expect(serializeOoxmlPart(store.package.parts.get('/word/commentsIds.xml')!)).toBe(beforeIds);
  }
  expect(store.historyDepth).toBe(0);
}

function hexParaId(value: number): string {
  return value.toString(16).padStart(8, '0');
}

function wideThread(count: number): { body: string; comments: string; paraIds: string[] } {
  const ids = Array.from({ length: count }, (_, index) => String(index + 1));
  const paraIds = ids.map((_, index) => hexParaId(index + 1));
  return {
    body: ids.map((id) => markedComment(`c${id}`, id)).join(''),
    comments: commentsXml(
      ids
        .map((id, index) => comment(id, paraIds[index]!, `c${id}`, index === 0 ? undefined : '1'))
        .join('')
    ),
    paraIds,
  };
}

const NESTED_PARA = ['11111111', '22222222', '44444444'] as const;

describe('setCommentResolved walks the whole bounded thread', () => {
  test('nested paraIdParent and parentId descendants resolve and reopen together', () => {
    const store = storeOf(loadNestedReplyComments());
    expect(setCommentResolved(store, '1', true)).toMatchObject({ ok: true, changed: true });
    expectDone(store.package, NESTED_PARA, true);
    expect(store.historyDepth).toBe(1);

    expect(store.undo()).not.toBeNull();
    expectDone(store.package, NESTED_PARA, false);

    expect(setCommentResolved(store, '1', true).ok).toBe(true);
    expect(setCommentResolved(store, '1', false)).toMatchObject({ ok: true, changed: true });
    expectDone(store.package, NESTED_PARA, false);
  });

  test('nested parentId-only descendants resolve together', () => {
    const store = storeOf(
      loadCommentFixture({
        body: `${markedComment('root')}${markedComment('reply', '2')}`,
        comments: commentsXml(
          comment('1', '11111111', 'root') +
            comment('2', '22222222', 'reply', '1') +
            comment('4', '44444444', 'nested', '2')
        ),
      })
    );
    expect(setCommentResolved(store, '1', true).ok).toBe(true);
    expectDone(store.package, NESTED_PARA, true);
  });

  test('nested paraIdParent-only descendants resolve together', () => {
    const store = storeOf(
      loadCommentFixture({
        body: `${markedComment('root')}${markedComment('reply', '2')}`,
        comments: commentsXml(
          comment('1', '11111111', 'root') +
            comment('2', '22222222', 'reply') +
            comment('4', '44444444', 'nested')
        ),
        extended: extended(
          `<w15:commentEx w15:paraId="11111111"/>` +
            `<w15:commentEx w15:paraId="22222222" w15:paraIdParent="11111111"/>` +
            `<w15:commentEx w15:paraId="44444444" w15:paraIdParent="22222222"/>`
        ),
      })
    );
    expect(setCommentResolved(store, '1', true).ok).toBe(true);
    expectDone(store.package, NESTED_PARA, true);
  });

  test('inferred coincident-anchor descendants resolve together', () => {
    const store = storeOf(
      loadCommentFixture({
        body:
          `<w:p><w:commentRangeStart w:id="1"/><w:commentRangeStart w:id="2"/>` +
          `<w:commentRangeStart w:id="4"/><w:r><w:t>same</w:t></w:r>` +
          `<w:commentRangeEnd w:id="4"/><w:commentRangeEnd w:id="2"/>` +
          `<w:commentRangeEnd w:id="1"/><w:r><w:commentReference w:id="1"/></w:r>` +
          `<w:r><w:commentReference w:id="2"/></w:r>` +
          `<w:r><w:commentReference w:id="4"/></w:r></w:p>`,
        comments: commentsXml(
          comment('1', '11111111', 'root') +
            comment('2', '22222222', 'reply') +
            comment('4', '44444444', 'nested')
        ),
      })
    );
    expect(setCommentResolved(store, '1', true).ok).toBe(true);
    expectDone(store.package, NESTED_PARA, true);
  });

  test('one comments.xml record marked in body, header, or notes still resolves', () => {
    for (const pkg of [loadDuplicateBodyHeader(), loadDuplicateNotes()]) {
      const store = storeOf(pkg);
      expect(setCommentResolved(store, '1', true)).toMatchObject({ ok: true, changed: true });
      const state = [...doneOf(store.package).values()];
      expect(state.some((entry) => entry.done)).toBe(true);
    }
  });

  test('duplicate comment records refuse with the package unchanged', () => {
    const pkg = loadCommentFixture({
      body: markedComment('body'),
      comments: commentsXml(comment('1', '11111111', 'first') + comment('1', '22222222', 'dup')),
    });
    const store = storeOf(pkg);
    const before = serializeOoxmlPart(store.package.parts.get('/word/comments.xml')!);
    expect(setCommentResolved(store, '1', true)).toEqual({
      ok: false,
      reason: 'unknown-comment',
    });
    expect(serializeOoxmlPart(store.package.parts.get('/word/comments.xml')!)).toBe(before);
    expect(store.package.parts.has('/word/commentsExtended.xml')).toBe(false);
    expect(store.historyDepth).toBe(0);
  });

  test('a truncated scan refuses without a partial commentsExtended write', () => {
    const store = storeOf(loadNestedReplyComments());
    const before = serializeOoxmlPart(store.package.parts.get('/word/commentsExtended.xml')!);
    const refused = setCommentResolvedWithBudget(store, '1', true, createCommentScanBudget(3));
    expect(refused).toEqual({ ok: false, reason: 'unknown-comment' });
    expect(serializeOoxmlPart(store.package.parts.get('/word/commentsExtended.xml')!)).toBe(before);
    expect(store.historyDepth).toBe(0);
  });

  test('inferred coincident replies persist paraIdParent through save and reopen', () => {
    const store = storeOf(
      loadCommentFixture({
        body:
          `<w:p><w:commentRangeStart w:id="1"/><w:commentRangeStart w:id="2"/>` +
          `<w:r><w:t>same</w:t></w:r>` +
          `<w:commentRangeEnd w:id="2"/><w:commentRangeEnd w:id="1"/>` +
          `<w:r><w:commentReference w:id="1"/></w:r>` +
          `<w:r><w:commentReference w:id="2"/></w:r></w:p>`,
        comments: commentsXml(comment('1', '11111111', 'root') + comment('2', '22222222', 'reply')),
      })
    );
    expect(setCommentResolved(store, '1', true).ok).toBe(true);
    expect(doneOf(store.package).get('22222222')?.parentParaId).toBe('11111111');

    const saved = writeOoxmlPackage(store.package);
    const reopened = readOoxmlPackage(saved);
    if (!reopened.ok) throw new Error(reopened.reason);
    expect(doneOf(reopened.package).get('22222222')?.parentParaId).toBe('11111111');
    const items = collectReviewItems({
      storyPart: reopened.package.parts.get(reopened.package.mainDocumentPart)!,
      commentsPart: reopened.package.parts.get('/word/comments.xml'),
      commentsExtendedPart: reopened.package.parts.get(
        commentsExtendedPartNameOf(reopened.package, reopened.package.mainDocumentPart)
      ),
    });
    const child = items.find((item) => item.kind === 'comment' && item.id === '2');
    expect(child?.kind === 'comment' && child.parentId).toBe('1');
  });

  test('parentId-only replies persist paraIdParent on the authored commentEx', () => {
    const store = storeOf(
      loadCommentFixture({
        body: `${markedComment('root')}${markedComment('reply', '2')}`,
        comments: commentsXml(
          comment('1', '11111111', 'root') + comment('2', '22222222', 'reply', '1')
        ),
      })
    );
    expect(setCommentResolved(store, '1', true).ok).toBe(true);
    expect(doneOf(store.package).get('22222222')?.parentParaId).toBe('11111111');
  });

  test('a resolved root with an unresolved descendant repairs the full thread', () => {
    const store = storeOf(
      loadCommentFixture({
        body: `${markedComment('root')}${markedComment('reply', '2')}`,
        comments: commentsXml(comment('1', '11111111', 'root') + comment('2', '22222222', 'reply')),
        extended: extended(
          `<w15:commentEx w15:paraId="11111111" w15:done="1"/>` +
            `<w15:commentEx w15:paraId="22222222" w15:paraIdParent="11111111" w15:done="0"/>`
        ),
      })
    );
    expect(setCommentResolved(store, '1', true)).toMatchObject({ ok: true, changed: true });
    expectDone(store.package, ['11111111', '22222222'], true);
    expect(store.historyDepth).toBe(1);
  });

  test('every member already matching is a no-op', () => {
    const store = storeOf(
      loadCommentFixture({
        body: `${markedComment('root')}${markedComment('reply', '2')}`,
        comments: commentsXml(comment('1', '11111111', 'root') + comment('2', '22222222', 'reply')),
        extended: extended(
          `<w15:commentEx w15:paraId="11111111" w15:done="1"/>` +
            `<w15:commentEx w15:paraId="22222222" w15:paraIdParent="11111111" w15:done="1"/>`
        ),
      })
    );
    const before = serializeOoxmlPart(store.package.parts.get('/word/commentsExtended.xml')!);
    expect(setCommentResolved(store, '1', true)).toEqual({
      ok: true,
      changed: false,
      change: null,
    });
    expect(serializeOoxmlPart(store.package.parts.get('/word/commentsExtended.xml')!)).toBe(before);
    expect(store.historyDepth).toBe(0);
  });

  test('truncation refuses even when the root already matches', () => {
    const store = storeOf(
      loadCommentFixture({
        body: `${markedComment('root')}${markedComment('reply', '2')}`,
        comments: commentsXml(
          comment('1', '11111111', 'root') +
            comment('2', '22222222', 'reply', '1') +
            comment('4', '44444444', 'nested', '2')
        ),
        extended: extended(`<w15:commentEx w15:paraId="11111111" w15:done="1"/>`),
      })
    );
    const before = serializeOoxmlPart(store.package.parts.get('/word/commentsExtended.xml')!);
    expect(setCommentResolvedWithBudget(store, '1', true, createCommentScanBudget(3))).toEqual({
      ok: false,
      reason: 'unknown-comment',
    });
    expect(serializeOoxmlPart(store.package.parts.get('/word/commentsExtended.xml')!)).toBe(before);
    expect(store.historyDepth).toBe(0);
  });

  test('cycles and self-parenting refuse with the package unchanged', () => {
    for (const comments of [
      commentsXml(comment('1', '11111111', 'a', '2') + comment('2', '22222222', 'b', '1')),
      commentsXml(comment('1', '11111111', 'self', '1')),
      commentsXml(comment('1', '11111111', 'root') + comment('2', '22222222', 'child')),
    ]) {
      const store = storeOf(
        loadCommentFixture({
          body: `${markedComment('a')}${markedComment('b', '2')}`,
          comments,
          ...(comments.includes('child')
            ? {
                extended: extended(
                  `<w15:commentEx w15:paraId="11111111" w15:paraIdParent="22222222"/>` +
                    `<w15:commentEx w15:paraId="22222222" w15:paraIdParent="11111111"/>`
                ),
              }
            : {}),
        })
      );
      const before = serializeOoxmlPart(store.package.parts.get('/word/comments.xml')!);
      expect(setCommentResolved(store, '1', true)).toEqual({
        ok: false,
        reason: 'unknown-comment',
      });
      expect(serializeOoxmlPart(store.package.parts.get('/word/comments.xml')!)).toBe(before);
      expect(store.historyDepth).toBe(0);
    }
  });

  test('duplicate commentEx naming different parents refuse', () => {
    const store = storeOf(
      loadCommentFixture({
        body: `${markedComment('root')}${markedComment('child', '2')}${markedComment('other', '3')}`,
        comments: commentsXml(
          comment('1', '11111111', 'root') +
            comment('2', '22222222', 'child') +
            comment('3', '33333333', 'other')
        ),
        extended: extended(
          `<w15:commentEx w15:paraId="22222222" w15:paraIdParent="11111111"/>` +
            `<w15:commentEx w15:paraId="22222222" w15:paraIdParent="33333333"/>`
        ),
      })
    );
    const before = serializeOoxmlPart(store.package.parts.get('/word/comments.xml')!);
    expect(setCommentResolved(store, '1', true)).toEqual({
      ok: false,
      reason: 'unknown-comment',
    });
    expect(serializeOoxmlPart(store.package.parts.get('/word/comments.xml')!)).toBe(before);
    expect(store.historyDepth).toBe(0);
  });

  test('w15 and w16 naming different parents refuse', () => {
    const store = storeOf(
      loadCommentFixture({
        body: `${markedComment('root')}${markedComment('child', '2')}${markedComment('other', '3')}`,
        comments: commentsXml(
          comment('1', '11111111', 'root') +
            comment('2', '22222222', 'child', '1') +
            comment('3', '33333333', 'other')
        ),
        extended: extended(`<w15:commentEx w15:paraId="22222222" w15:paraIdParent="33333333"/>`),
      })
    );
    const before = serializeOoxmlPart(store.package.parts.get('/word/comments.xml')!);
    expect(setCommentResolved(store, '1', true)).toEqual({
      ok: false,
      reason: 'unknown-comment',
    });
    expect(serializeOoxmlPart(store.package.parts.get('/word/comments.xml')!)).toBe(before);
    expect(store.historyDepth).toBe(0);
  });

  test('a parentId chain deeper than 64 refuses', () => {
    const count = 66;
    const ids = Array.from({ length: count }, (_, index) => String(index + 1));
    const paraIds = ids.map((id) => Number(id).toString(16).padStart(8, '0'));
    const store = storeOf(
      loadCommentFixture({
        body: ids.map((id) => markedComment(`c${id}`, id)).join(''),
        comments: commentsXml(
          ids
            .map((id, index) =>
              comment(id, paraIds[index]!, `c${id}`, index === 0 ? undefined : ids[index - 1])
            )
            .join('')
        ),
      })
    );
    expect(setCommentResolved(store, '1', true)).toEqual({
      ok: false,
      reason: 'unknown-comment',
    });
    expect(store.package.parts.has('/word/commentsExtended.xml')).toBe(false);
    expect(store.historyDepth).toBe(0);
  });

  test('writes the comments-related extended part and does not fork another', () => {
    const store = storeOf(
      loadCommentFixture({
        body: `${markedComment('root')}${markedComment('reply', '2')}`,
        comments: commentsXml(comment('1', '11111111', 'root') + comment('2', '22222222', 'reply')),
        extended: extended(
          `<w15:commentEx w15:paraId="11111111"/>` +
            `<w15:commentEx w15:paraId="22222222" w15:paraIdParent="11111111"/>`
        ),
        extendedFrom: 'comments',
      })
    );
    expect(setCommentResolved(store, '1', true).ok).toBe(true);
    expectDone(store.package, ['11111111', '22222222'], true);
    const extendedParts = [...store.package.parts.keys()].filter((name) =>
      name.endsWith('commentsExtended.xml')
    );
    expect(extendedParts).toEqual(['/word/commentsExtended.xml']);
    const storyRels = relationshipsOf(store.package, store.package.mainDocumentPart);
    expect(storyRels.some((rel) => rel.rawTarget.includes('commentsExtended'))).toBe(false);
    const commentRels = relationshipsOf(store.package, '/word/comments.xml');
    expect(commentRels.some((rel) => rel.rawTarget.includes('commentsExtended'))).toBe(true);
  });

  test('reopen writes done=0 on a transitional commentsExtended content type', () => {
    const store = storeOf(
      loadCommentFixture({
        body: markedComment('hello'),
        comments: commentsXml(comment('1', '11111111', 'Check this.')),
        extended: extended(`<w15:commentEx w15:paraId="11111111" w15:done="0"/>`),
        extendedContentType: 'application/vnd.ms-word.commentsExtended+xml',
      })
    );
    expect(setCommentResolved(store, '1', true)).toMatchObject({ ok: true, changed: true });
    expectDone(store.package, ['11111111'], true);
    expect(setCommentResolved(store, '1', false)).toMatchObject({ ok: true, changed: true });
    expectDone(store.package, ['11111111'], false);
    expect(store.historyDepth).toBe(2);

    const saved = writeOoxmlPackage(store.package);
    const reopened = readOoxmlPackage(saved);
    if (!reopened.ok) throw new Error(reopened.reason);
    expectDone(reopened.package, ['11111111'], false);
  });

  test('duplicate commentEx refuse even when parent and done match', () => {
    expectRefused(
      storeOf(
        loadCommentFixture({
          body: markedComment('hello'),
          comments: commentsXml(comment('1', '11111111', 'root')),
          extended: extended(
            `<w15:commentEx w15:paraId="11111111" w15:done="0"/>` +
              `<w15:commentEx w15:paraId="11111111" w15:done="0"/>`
          ),
        })
      )
    );
  });

  test('duplicate commentsIds keys refuse', () => {
    const idsXml = (entries: string) =>
      `<w16cid:commentsIds xmlns:w16cid="${W16CID}">${entries}</w16cid:commentsIds>`;
    for (const commentsIds of [
      idsXml(
        `<w16cid:commentId w16cid:paraId="11111111" w16cid:durableId="AAAAAAAA"/>` +
          `<w16cid:commentId w16cid:paraId="11111111" w16cid:durableId="BBBBBBBB"/>`
      ),
      idsXml(
        `<w16cid:commentId w16cid:paraId="11111111" w16cid:durableId="AAAAAAAA"/>` +
          `<w16cid:commentId w16cid:paraId="22222222" w16cid:durableId="AAAAAAAA"/>`
      ),
    ]) {
      expectRefused(
        storeOf(
          loadCommentFixture({
            body: `${markedComment('a')}${markedComment('b', '2')}`,
            comments: commentsXml(comment('1', '11111111', 'a') + comment('2', '22222222', 'b')),
            commentsIds,
          })
        )
      );
    }
  });

  test('a paraId scan that exhausts the shared budget refuses before mutation', () => {
    const store = storeOf(
      prependXmlPadding(
        loadCommentFixture({
          body: markedComment('hello'),
          comments: commentsXml(comment('1', '11111111', 'root')),
        }),
        MAX_COMMENT_SCAN_PARTS
      )
    );
    expectRefused(store);
  });

  test('a wide sibling thread resolves in one commentsExtended rewrite', () => {
    const wide = wideThread(24);
    const store = storeOf(loadCommentFixture({ body: wide.body, comments: wide.comments }));
    const before = commentResolutionExtendedRootRewrites();
    expect(setCommentResolved(store, '1', true)).toMatchObject({ ok: true, changed: true });
    expect(commentResolutionExtendedRootRewrites()).toBe(before + 1);
    expectDone(store.package, wide.paraIds, true);
    expect(store.historyDepth).toBe(1);
  });

  test('many missing commentEx entries are inserted in one rewrite and keep extra attrs', () => {
    const wide = wideThread(16);
    const store = storeOf(
      loadCommentFixture({
        body: wide.body,
        comments: wide.comments,
        extended: extended(
          `<w15:commentEx w15:paraId="${wide.paraIds[0]}" w15:done="0" w15:durableId="keep">` +
            `<w15:unknown/></w15:commentEx>`
        ),
      })
    );
    const before = commentResolutionExtendedRootRewrites();
    expect(setCommentResolved(store, '1', true)).toMatchObject({ ok: true, changed: true });
    expect(commentResolutionExtendedRootRewrites()).toBe(before + 1);
    expectDone(store.package, wide.paraIds, true);
    const xml = serializeOoxmlPart(store.package.parts.get('/word/commentsExtended.xml')!);
    expect(xml).toContain('w15:durableId="keep"');
    expect(xml).toContain('w15:unknown');
    expect(store.historyDepth).toBe(1);
  });

  test('a wide thread missing paraIds stamps them in one comments-root rewrite', () => {
    const ids = Array.from({ length: 24 }, (_, index) => String(index + 1));
    const store = storeOf(
      loadCommentFixture({
        body: ids.map((id) => markedComment(`c${id}`, id)).join(''),
        comments: commentsXml(
          ids
            .map((id, index) => {
              const parent = index === 0 ? '' : ' w16cid:parentId="1"';
              return (
                `<w:comment w:id="${id}" w:author="Ada"${parent}>` +
                `<w:p><w:r><w:t>c${id}</w:t></w:r></w:p></w:comment>`
              );
            })
            .join('')
        ),
      })
    );
    const beforeComments = commentResolutionCommentsRootRewrites();
    const beforeExtended = commentResolutionExtendedRootRewrites();
    expect(setCommentResolved(store, '1', true)).toMatchObject({ ok: true, changed: true });
    expect(commentResolutionCommentsRootRewrites()).toBe(beforeComments + 1);
    expect(commentResolutionExtendedRootRewrites()).toBe(beforeExtended + 1);
    const comments = serializeOoxmlPart(store.package.parts.get('/word/comments.xml')!);
    expect(comments.match(/w14:paraId="/g)?.length).toBe(24);
    const state = [...doneOf(store.package).values()];
    expect(state).toHaveLength(24);
    expect(state.every((entry) => entry.done)).toBe(true);
    expect(store.historyDepth).toBe(1);
  });

  test('nested commentEx refuse with the package unchanged', () => {
    expectRefused(
      storeOf(
        loadCommentFixture({
          body: markedComment('hello'),
          comments: commentsXml(comment('1', '11111111', 'root')),
          extended: extended(
            `<w15:wrapper><w15:commentEx w15:paraId="11111111" w15:done="0"/></w15:wrapper>`
          ),
        })
      )
    );
    expectRefused(
      storeOf(
        loadCommentFixture({
          body: `${markedComment('a')}${markedComment('b', '2')}`,
          comments: commentsXml(comment('1', '11111111', 'a') + comment('2', '22222222', 'b')),
          extended: extended(
            `<w15:commentEx w15:paraId="11111111" w15:done="0">` +
              `<w15:commentEx w15:paraId="22222222" w15:done="0"/></w15:commentEx>`
          ),
        })
      )
    );
  });

  test('nested commentId refuse with the package unchanged', () => {
    const idsXml = (entries: string) =>
      `<w16cid:commentsIds xmlns:w16cid="${W16CID}">${entries}</w16cid:commentsIds>`;
    expectRefused(
      storeOf(
        loadCommentFixture({
          body: markedComment('hello'),
          comments: commentsXml(comment('1', '11111111', 'root')),
          commentsIds: idsXml(
            `<w16cid:wrapper>` +
              `<w16cid:commentId w16cid:paraId="11111111" w16cid:durableId="AAAAAAAA"/>` +
              `</w16cid:wrapper>`
          ),
        })
      )
    );
    expectRefused(
      storeOf(
        loadCommentFixture({
          body: markedComment('hello'),
          comments: commentsXml(comment('1', '11111111', 'root')),
          commentsIds: idsXml(
            `<w16cid:commentId w16cid:paraId="11111111" w16cid:durableId="AAAAAAAA">` +
              `<w16cid:commentId w16cid:paraId="22222222" w16cid:durableId="BBBBBBBB"/>` +
              `</w16cid:commentId>`
          ),
        })
      )
    );
  });
});
