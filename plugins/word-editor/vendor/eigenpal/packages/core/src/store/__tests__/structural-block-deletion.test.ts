// Structural block removal: the op that takes a whole `w:tbl`, `w:tr` or `w:p` out of the
// tree, and the invariants it refuses to break.
//
// Everything else in the vocabulary edits text, runs or properties. Nothing could remove a
// node at all, so a range deletion spanning a table could only empty it — the document kept
// its scaffolding and the user saw pages of blank table skeletons.

import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { applyTreeOp } from '../store/tree-ops.ts';
import { TreeDocumentStore } from '../store/tree-store.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function idsOfKind(part: OoxmlPart, kind: OoxmlNode['kind']): string[] {
  const ids: string[] = [];
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === kind) ids.push(node.id);
    for (const child of node.children) walk(child);
  };
  walk(part.root);
  return ids;
}

function findByKind(part: OoxmlPart, kind: OoxmlNode['kind']): string {
  const [first] = idsOfKind(part, kind);
  if (!first) throw new Error(`no ${kind} in part`);
  return first;
}

const cell = (text: string): string => `<w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
const row = (...texts: string[]): string => `<w:tr>${texts.map(cell).join('')}</w:tr>`;
const TABLE = `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="100"/></w:tblGrid>${row('a1', 'a2')}${row('b1', 'b2')}</w:tbl>`;
const PARAGRAPH = (text: string): string => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const BODY = `${PARAGRAPH('before')}${TABLE}${PARAGRAPH('after')}`;

describe('deleteBlock removes a whole block subtree', () => {
  test('a table leaves the body and its siblings keep their identities', () => {
    const part = load(BODY);
    const tableId = findByKind(part, 'table');
    const paragraphsBefore = idsOfKind(part, 'paragraph');

    const result = applyTreeOp(part, { op: 'deleteBlock', blockId: tableId });
    if (!result.ok) throw new Error(result.reason);

    expect(idsOfKind(result.part, 'table')).toEqual([]);
    expect(idsOfKind(result.part, 'tableRow')).toEqual([]);
    expect(idsOfKind(result.part, 'tableCell')).toEqual([]);
    // The two body paragraphs survive, under exactly the ids they had.
    expect(idsOfKind(result.part, 'paragraph')).toEqual([
      paragraphsBefore[0]!,
      paragraphsBefore[paragraphsBefore.length - 1]!,
    ]);
  });

  test('a row leaves its table', () => {
    const part = load(TABLE);
    const [firstRow, secondRow] = idsOfKind(part, 'tableRow');

    const result = applyTreeOp(part, { op: 'deleteBlock', blockId: firstRow! });
    if (!result.ok) throw new Error(result.reason);

    expect(idsOfKind(result.part, 'tableRow')).toEqual([secondRow!]);
  });

  test('a paragraph leaves its parent', () => {
    const part = load(BODY);
    const [first, ...rest] = idsOfKind(part, 'paragraph');

    const result = applyTreeOp(part, { op: 'deleteBlock', blockId: first! });
    if (!result.ok) throw new Error(result.reason);

    expect(idsOfKind(result.part, 'paragraph')).toEqual(rest);
  });

  test('the effect names the block, every paragraph inside it, and a structural impact', () => {
    const part = load(BODY);
    const tableId = findByKind(part, 'table');
    const cellParagraphs = idsOfKind(part, 'paragraph').slice(1, -1);

    const result = applyTreeOp(part, { op: 'deleteBlock', blockId: tableId });
    if (!result.ok) throw new Error(result.reason);

    expect(result.effect.impact).toBe('flow-structural');
    expect([...result.effect.deleted].sort()).toEqual([tableId, ...cellParagraphs].sort());
    expect(result.effect.created).toEqual([]);
  });
});

describe('deleteBlock refuses what it would break', () => {
  const refusal = (part: OoxmlPart, blockId: string): string => {
    const result = applyTreeOp(part, { op: 'deleteBlock', blockId });
    if (result.ok) throw new Error('expected a rejection');
    return result.reason;
  };

  test('an unknown id', () => {
    expect(refusal(load(BODY), '/word/document.xml#nope')).toBe('unknown-block');
  });

  test('a run, a text value, the body and a properties container are not blocks', () => {
    const part = load(BODY);
    expect(refusal(part, findByKind(part, 'run'))).toBe('not-a-block');
    expect(refusal(part, findByKind(part, 'text'))).toBe('not-a-block');
    expect(refusal(part, findByKind(part, 'body'))).toBe('not-a-block');
    expect(refusal(part, findByKind(part, 'tableProperties'))).toBe('not-a-block');
    expect(refusal(part, part.root.id)).toBe('not-a-block');
  });

  test('the only paragraph in a cell stays', () => {
    const part = load(BODY);
    const cellParagraph = idsOfKind(part, 'paragraph')[1]!;
    expect(refusal(part, cellParagraph)).toBe('block-required');
  });

  test('the only row in a table stays', () => {
    const part = load(`<w:tbl>${row('only')}</w:tbl>${PARAGRAPH('after')}`);
    expect(refusal(part, findByKind(part, 'tableRow'))).toBe('block-required');
  });

  test('the part keeps somewhere to put the caret', () => {
    const part = load(PARAGRAPH('the only one'));
    expect(refusal(part, findByKind(part, 'paragraph'))).toBe('block-required');
  });

  test('removing the last table would leave no paragraph at all', () => {
    // A header keeps a final table as written; a body would read a paragraph after it.
    const read = readOoxmlPart(`<w:hdr xmlns:w="${W}">${TABLE}</w:hdr>`, {
      name: '/word/header1.xml',
      contentType: 'app/xml',
    });
    if (!read.ok) throw new Error(read.reason);
    const part = read.part;
    expect(refusal(part, findByKind(part, 'table'))).toBe('block-required');
  });

  test('the paragraph after a table that ends the body stays, read or authored', () => {
    const read = load(`${PARAGRAPH('before')}${TABLE}`);
    expect(refusal(read, idsOfKind(read, 'paragraph').at(-1)!)).toBe('story-end-paragraph');
    const authored = load(BODY);
    expect(refusal(authored, idsOfKind(authored, 'paragraph').at(-1)!)).toBe('story-end-paragraph');
    // The table itself may go: the paragraph then ends the body on its own.
    expect(
      applyTreeOp(authored, { op: 'deleteBlock', blockId: findByKind(authored, 'table') }).ok
    ).toBe(true);
  });

  test('the last paragraph of a control after a table that ends the body stays', () => {
    const sdt = (inner: string) => `<w:sdt><w:sdtPr/><w:sdtContent>${inner}</w:sdtContent></w:sdt>`;
    const wrapped = load(`${PARAGRAPH('before')}${sdt(`${TABLE}${PARAGRAPH('in')}`)}`);
    expect(refusal(wrapped, idsOfKind(wrapped, 'paragraph').at(-1)!)).toBe('story-end-paragraph');
    // Removing the whole control after a final table needs its content kept.
    const trailing = load(`${PARAGRAPH('before')}${TABLE}${sdt(PARAGRAPH('in'))}`);
    const controlId = findByKind(trailing, 'contentControl');
    const removed = (keepContent: boolean) =>
      applyTreeOp(trailing, { op: 'removeContentControl', controlId, keepContent });
    expect(removed(false)).toMatchObject({ ok: false, reason: 'story-end-paragraph' });
    expect(removed(true).ok).toBe(true);
    // A control left empty, or holding only markers, does not end the story.
    const only = load(`${PARAGRAPH('before')}${TABLE}${sdt(PARAGRAPH('in'))}`);
    expect(refusal(only, idsOfKind(only, 'paragraph').at(-1)!)).toBe('story-end-paragraph');
    const marks = load(`${PARAGRAPH('a')}${TABLE}${sdt('<w:bookmarkStart w:id="1" w:name="m"/>')}`);
    // The read adds the paragraph after the table, before the marker-only control.
    expect(idsOfKind(marks, 'paragraph')).toHaveLength(6);
    const last = idsOfKind(marks, 'paragraph').at(-1)!;
    expect(refusal(marks, last)).toBe('story-end-paragraph');
  });

  test('a paragraph carrying a section mark stays', () => {
    const part = load(
      `<w:p><w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr></w:p>${PARAGRAPH('after')}`
    );
    expect(refusal(part, idsOfKind(part, 'paragraph')[0]!)).toBe('carries-section-mark');
  });

  test('a refused removal leaves the part object-identical', () => {
    const part = load(BODY);
    const result = applyTreeOp(part, { op: 'deleteBlock', blockId: findByKind(part, 'run') });
    expect(result.ok).toBe(false);
    // Validation runs before any tree work, so nothing was rebuilt to hand back.
    expect(applyTreeOp(part, { op: 'deleteBlock', blockId: findByKind(part, 'table') }).ok).toBe(
      true
    );
  });
});

describe('deleteBlock through the store', () => {
  test('a rejection publishes no revision and no history entry', () => {
    const store = new TreeDocumentStore(load(BODY));
    const before = store.part;
    const runId = findByKind(before, 'run');

    const result = store.transact((tx) => {
      tx.apply({ op: 'deleteBlock', blockId: runId });
    });

    expect(result.ok).toBe(false);
    expect(store.part).toBe(before);
    expect(store.revision).toBe(0);
    expect(store.historyDepth).toBe(0);
  });

  test('undo restores the removed subtree, redo removes it again', () => {
    const store = new TreeDocumentStore(load(BODY));
    const tableId = findByKind(store.part, 'table');
    const paragraphsBefore = idsOfKind(store.part, 'paragraph');

    const result = store.transact((tx) => {
      tx.apply({ op: 'deleteBlock', blockId: tableId });
    });
    if (!result.ok) throw new Error(result.reason);
    expect(result.change?.impact).toBe('flow-structural');
    expect(idsOfKind(store.part, 'table')).toEqual([]);

    store.undo();
    expect(idsOfKind(store.part, 'table')).toEqual([tableId]);
    expect(idsOfKind(store.part, 'paragraph')).toEqual(paragraphsBefore);

    store.redo();
    expect(idsOfKind(store.part, 'table')).toEqual([]);
  });
});

describe('removal round-trips through save', () => {
  test('the saved document has lost only the table', () => {
    const part = load(BODY);
    const result = applyTreeOp(part, { op: 'deleteBlock', blockId: findByKind(part, 'table') });
    if (!result.ok) throw new Error(result.reason);

    const xml = serializeOoxmlPart(result.part);
    expect(xml).not.toContain('<w:tbl>');
    expect(xml).toContain('before');
    expect(xml).toContain('after');

    const reopened = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
    if (!reopened.ok) throw new Error(reopened.reason);
    expect(idsOfKind(reopened.part, 'table')).toEqual([]);
    expect(idsOfKind(reopened.part, 'paragraph')).toHaveLength(2);
  });
});
