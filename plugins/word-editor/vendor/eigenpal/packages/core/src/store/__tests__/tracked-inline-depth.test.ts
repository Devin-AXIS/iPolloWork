import { expect, test } from 'bun:test';
import {
  TreeDocumentStore,
  paragraphTextOf,
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlParagraphNode,
} from '../index.ts';
import { MAX_INLINE_CONTAINER_DEPTH } from '../package/ooxml-shared.ts';

function fixture(depth: number, ownInsertion = false) {
  const run = '<w:r><w:t>AB</w:t></w:r>';
  const text = ownInsertion ? `<w:ins w:id="1" w:author="Reviewer">${run}</w:ins>` : run;
  const opened = readOoxmlPart(
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p>${'<w:smartTag>'.repeat(depth)}${text}${'</w:smartTag>'.repeat(depth)}</w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!opened.ok) throw new Error(opened.reason);
  const body = opened.part.root.children[0]!;
  if (body.kind === 'textValue') throw new Error('body');
  const paragraph = body.children[0] as OoxmlParagraphNode;
  return { store: new TreeDocumentStore(opened.part), paragraphId: paragraph.id };
}

for (const deletion of [false, true]) {
  test(`tracked ${deletion ? 'deletion' : 'insertion'} refuses an invisible revision at the depth limit`, () => {
    const { store, paragraphId } = fixture(MAX_INLINE_CONTAINER_DEPTH - 1);
    const before = serializeOoxmlPart(store.part);
    const result = store.transact((ctx) =>
      ctx.apply(
        deletion
          ? { op: 'deleteText', paragraphId, start: 0, end: 1, revision: { author: 'Reviewer' } }
          : {
              op: 'insertText',
              paragraphId,
              offset: 1,
              text: 'X',
              revision: { author: 'Reviewer' },
            }
      )
    );
    expect(result.ok).toBe(false);
    expect(serializeOoxmlPart(store.part)).toBe(before);
    expect(paragraphTextOf(store.part, paragraphId)).toBe('AB');
    expect(store.canUndo).toBe(false);
    expect(store.revision).toBe(0);
    const next = store.transact((ctx) =>
      ctx.apply({
        op: 'insertText',
        paragraphId,
        offset: 0,
        text: 'Y',
        revision: { author: 'Reviewer' },
      })
    );
    expect(next.ok).toBe(true);
    expect(serializeOoxmlPart(store.part)).toMatch(/<w:ins[^>]*w:id="0"/);
  });

  test(`tracked ${deletion ? 'deletion' : 'insertion'} stays visible within the shared depth budget`, () => {
    const { store, paragraphId } = fixture(MAX_INLINE_CONTAINER_DEPTH - 2);
    const result = store.transact((ctx) =>
      ctx.apply(
        deletion
          ? { op: 'deleteText', paragraphId, start: 0, end: 1, revision: { author: 'Reviewer' } }
          : {
              op: 'insertText',
              paragraphId,
              offset: 1,
              text: 'X',
              revision: { author: 'Reviewer' },
            }
      )
    );
    expect(result.ok).toBe(true);
    expect(paragraphTextOf(store.part, paragraphId)).toBe(deletion ? 'AB' : 'AXB');
    expect(serializeOoxmlPart(store.part)).toContain(deletion ? '<w:del ' : '<w:ins ');
  });

  test(`own insertion permits ${deletion ? 'retraction' : 'extension'} without spending another depth level`, () => {
    const { store, paragraphId } = fixture(MAX_INLINE_CONTAINER_DEPTH - 2, true);
    const result = store.transact((ctx) =>
      ctx.apply(
        deletion
          ? { op: 'deleteText', paragraphId, start: 0, end: 1, revision: { author: 'Reviewer' } }
          : {
              op: 'insertText',
              paragraphId,
              offset: 1,
              text: 'X',
              revision: { author: 'Reviewer' },
            }
      )
    );
    expect(result.ok).toBe(true);
    expect(paragraphTextOf(store.part, paragraphId)).toBe(deletion ? 'B' : 'AXB');
  });
}
