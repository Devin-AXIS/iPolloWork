// Editing the text of a comment: the body changes, and the thread, the anchor and the
// metadata that point at the comment do not.

import { describe, expect, test } from 'bun:test';
import {
  TreeDocumentStore,
  commentsOfPart,
  commentsExtendedPartNameOf,
  serializeOoxmlPart,
  threadStateOfPart,
  type OoxmlPackage,
} from '../index.ts';
import { setCommentText } from '../store/comment-writes.ts';
import {
  W,
  W14,
  W15,
  loadCommentFixture,
  markedComment,
  textOf,
} from './comment-lifecycle-test-support.ts';

function storeOf(pkg: OoxmlPackage): TreeDocumentStore {
  return new TreeDocumentStore(pkg, pkg.mainDocumentPart);
}

// Comment 1 is resolved and has a reply (2). Comment 3 has two paragraphs. Word keys the thread
// state and the reply link by the `w14:paraId` of a comment's LAST paragraph.
function loadThread(): OoxmlPackage {
  return loadCommentFixture({
    body: markedComment('first', '1') + markedComment('second', '3'),
    comments:
      `<w:comments xmlns:w="${W}" xmlns:w14="${W14}">` +
      `<w:comment w:id="1" w:author="Ada" w:initials="AL" w:date="2026-10-29T10:00:00Z">` +
      `<w:p w14:paraId="11111111"><w:r><w:t>Original remark</w:t></w:r></w:p></w:comment>` +
      `<w:comment w:id="2" w:author="Grace" w:date="2026-10-29T11:00:00Z">` +
      `<w:p w14:paraId="22222222"><w:r><w:t>A reply</w:t></w:r></w:p></w:comment>` +
      `<w:comment w:id="3" w:author="Ada">` +
      `<w:p w14:paraId="33333333"><w:r><w:t>Line one</w:t></w:r></w:p>` +
      `<w:p w14:paraId="44444444"><w:r><w:t>Line two</w:t></w:r></w:p></w:comment>` +
      `</w:comments>`,
    extended:
      `<w15:commentsEx xmlns:w15="${W15}">` +
      `<w15:commentEx w15:paraId="11111111" w15:done="1"/>` +
      `<w15:commentEx w15:paraId="22222222" w15:paraIdParent="11111111" w15:done="1"/>` +
      `</w15:commentsEx>`,
  });
}

function record(pkg: OoxmlPackage, id: string) {
  const record = commentsOfPart(pkg.parts.get('/word/comments.xml')!).find((c) => c.id === id);
  if (!record) throw new Error(`no comment ${id}`);
  return { ...record, text: record.blocks.map(textOf).join('\n') };
}

function extendedXml(pkg: OoxmlPackage): string {
  return serializeOoxmlPart(pkg.parts.get(commentsExtendedPartNameOf(pkg, pkg.mainDocumentPart))!);
}

describe('setCommentText', () => {
  test('replaces the body and keeps the author, initials, date, paraId, thread and anchor', () => {
    const store = storeOf(loadThread());
    const extendedBefore = extendedXml(store.package);
    const documentBefore = serializeOoxmlPart(store.part);

    expect(setCommentText(store, '1', 'Edited remark')).toMatchObject({ ok: true, changed: true });

    const edited = record(store.package, '1');
    expect(edited.text).toBe('Edited remark');
    expect(edited).toMatchObject({
      author: 'Ada',
      initials: 'AL',
      date: '2026-10-29T10:00:00Z',
      paraId: '11111111',
    });
    expect(record(store.package, '2').text).toBe('A reply');
    expect(extendedXml(store.package)).toBe(extendedBefore);
    const state = threadStateOfPart(
      store.package.parts.get(
        commentsExtendedPartNameOf(store.package, store.package.mainDocumentPart)
      )!
    );
    expect(state.get('11111111')?.done).toBe(true);
    expect(state.get('22222222')?.parentParaId).toBe('11111111');
    expect(serializeOoxmlPart(store.part)).toBe(documentBefore);
  });

  test('a reply can be edited on its own', () => {
    const store = storeOf(loadThread());
    expect(setCommentText(store, '2', 'A better reply')).toMatchObject({ ok: true, changed: true });
    expect(record(store.package, '2')).toMatchObject({
      text: 'A better reply',
      paraId: '22222222',
    });
    expect(record(store.package, '1').text).toBe('Original remark');
  });

  test('a comment of several paragraphs becomes one, with the paraId of the last', () => {
    const store = storeOf(loadThread());
    expect(setCommentText(store, '3', 'One line').ok).toBe(true);
    const edited = record(store.package, '3');
    expect(edited.blocks).toHaveLength(1);
    expect(edited).toMatchObject({ text: 'One line', paraId: '44444444' });
  });

  test('one undo step restores the original text', () => {
    const store = storeOf(loadThread());
    expect(setCommentText(store, '1', 'Edited remark').ok).toBe(true);
    expect(store.historyDepth).toBe(1);
    expect(store.undo()).not.toBeNull();
    expect(record(store.package, '1').text).toBe('Original remark');
  });

  test('the same text changes nothing and adds no undo step', () => {
    const store = storeOf(loadThread());
    expect(setCommentText(store, '1', 'Original remark')).toEqual({
      ok: true,
      changed: false,
      change: null,
    });
    expect(store.historyDepth).toBe(0);
  });

  test('a paraId the reader refuses is kept, so the state Word keyed by it stays attached', () => {
    // Legal hex at or above 0x80000000, which MS-DOCX rules out. A new id would leave the
    // `w15:commentEx` that names the old one pointing at nothing.
    const store = storeOf(
      loadCommentFixture({
        body: markedComment('first', '1'),
        comments:
          `<w:comments xmlns:w="${W}" xmlns:w14="${W14}"><w:comment w:id="1" w:author="Ada">` +
          `<w:p w14:paraId="8000000A"><w:r><w:t>Old</w:t></w:r></w:p></w:comment></w:comments>`,
        extended:
          `<w15:commentsEx xmlns:w15="${W15}">` +
          `<w15:commentEx w15:paraId="8000000A" w15:done="1"/></w15:commentsEx>`,
      })
    );
    expect(setCommentText(store, '1', 'New').ok).toBe(true);
    expect(record(store.package, '1')).toMatchObject({ text: 'New', paraId: '8000000A' });
  });

  test('the same text is the text the card shows, so a body the card reads differently is rewritten', () => {
    const store = storeOf(
      loadCommentFixture({
        body: markedComment('first', '1') + markedComment('second', '2'),
        comments:
          `<w:comments xmlns:w="${W}" xmlns:w14="${W14}">` +
          `<w:comment w:id="1" w:author="Ada"><w:p w14:paraId="11111111">` +
          `<w:r><w:t>a</w:t><w:noBreakHyphen/><w:t>b</w:t></w:r></w:p></w:comment>` +
          `<w:comment w:id="2" w:author="Ada"><w:p w14:paraId="22222222"><w:r><w:t>Same</w:t></w:r></w:p>` +
          `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:comment>` +
          `</w:comments>`,
      })
    );
    // A non-breaking hyphen reads as U+2011 on the card.
    expect(setCommentText(store, '1', 'a‑b')).toMatchObject({ ok: true, changed: false });
    expect(setCommentText(store, '1', 'ab')).toMatchObject({ ok: true, changed: true });
    expect(record(store.package, '1').text).toBe('ab');
    // The card reads the table's text after the paragraph's.
    expect(setCommentText(store, '2', 'Same')).toEqual({
      ok: false,
      reason: 'unsupported-comment-body',
    });
    expect(record(store.package, '2')).toMatchObject({ text: 'Same\ncell', paraId: '22222222' });
    expect(record(store.package, '2').blocks).toHaveLength(2);
  });

  test('an unknown comment and empty text are refused, and nothing changes', () => {
    const store = storeOf(loadThread());
    const before = serializeOoxmlPart(store.package.parts.get('/word/comments.xml')!);
    expect(setCommentText(store, '9', 'Anything')).toEqual({
      ok: false,
      reason: 'unknown-comment',
    });
    expect(setCommentText(store, '1', '').ok).toBe(false);
    expect(serializeOoxmlPart(store.package.parts.get('/word/comments.xml')!)).toBe(before);
    expect(store.historyDepth).toBe(0);
  });
});

for (const content of [
  '<w:p><w:ins w:id="1" w:author="Ada"><w:r><w:t>Pending</w:t></w:r></w:ins></w:p>',
  '<w:p><w:r><w:rPr><w:rPrChange w:id="1" w:author="Ada"><w:rPr/></w:rPrChange></w:rPr><w:t>Pending</w:t></w:r></w:p>',
  '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText>DATE</w:instrText><w:fldChar w:fldCharType="end"/></w:r></w:p>',
  '<w:p><w:hyperlink w:anchor="target"><w:r><w:t>Link</w:t></w:r></w:hyperlink></w:p>',
  '<w:p><w:r><w:drawing/></w:r></w:p>',
]) {
  test(`refuses unsupported comment data without a write: ${content}`, () => {
    const store = storeOf(
      loadCommentFixture({
        body: markedComment('text', '1'),
        comments: `<w:comments xmlns:w="${W}"><w:comment w:id="1" w:author="Ada">${content}</w:comment></w:comments>`,
      })
    );
    const before = serializeOoxmlPart(store.package.parts.get('/word/comments.xml')!);
    expect(setCommentText(store, '1', 'Replacement')).toEqual({
      ok: false,
      reason: 'unsupported-comment-body',
    });
    expect(serializeOoxmlPart(store.package.parts.get('/word/comments.xml')!)).toBe(before);
    expect(store.undo()).toBeNull();
  });
}
