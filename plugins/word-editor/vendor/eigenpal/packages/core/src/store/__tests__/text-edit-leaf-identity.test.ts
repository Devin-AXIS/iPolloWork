import { describe, expect, test } from 'bun:test';
import { findNode } from '../package/ooxml-edit.ts';
import { readOoxmlPart, type OoxmlNode } from '../package/ooxml-tree.ts';
import { serializeOoxmlPart } from '../package/ooxml-serialize.ts';
import {
  observeCanonicalPrimitiveJournal,
  runObservedStoreTransaction,
  flushPendingCanonicalJournals,
} from '../package/canonical-primitive-capture.ts';
import type { CanonicalPrimitiveJournal } from '../package/canonical-primitive-journal.ts';
import { applyTreeOp } from '../store/tree-ops.ts';
import type { TreeDocOp } from '../store/tree-op-types.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function load(runs = '<w:r><w:t>Hello</w:t></w:r>') {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:p>${runs}</w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const nodes: OoxmlNode[] = [];
  const walk = (node: OoxmlNode) => {
    nodes.push(node);
    if (node.kind !== 'textValue') node.children.forEach(walk);
  };
  walk(parsed.part.root);
  return {
    part: parsed.part,
    paragraphId: nodes.find((n) => n.kind === 'paragraph')!.id,
    text: nodes.find((n) => n.kind === 'textValue')!,
    owner: nodes.find((n) => n.kind === 'text')!,
  };
}

function apply(part: ReturnType<typeof load>['part'], op: TreeDocOp) {
  const result = applyTreeOp(part, op);
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

describe('text edits retain source leaf identity', () => {
  for (const offset of [0, 2, 5]) {
    test(`plain insertion at ${offset} retains its text leaf and container`, () => {
      const { part, paragraphId, text, owner } = load();
      const next = apply(part, { op: 'insertText', paragraphId, offset, text: ' ' });
      expect(findNode(next, text.id)).toEqual({
        ...text,
        value: 'Hello'.slice(0, offset) + ' ' + 'Hello'.slice(offset),
      });
      expect(findNode(next, owner.id)?.kind).toBe('text');
      expect(serializeOoxmlPart(next)).toContain(
        offset === 2
          ? '<w:t>He llo</w:t>'
          : `<w:t xml:space="preserve">${offset === 0 ? ' Hello' : 'Hello '}</w:t>`
      );
    });
  }

  test('insertion at a formatted boundary extends the left source only', () => {
    const { part, paragraphId, text } = load(
      '<w:r><w:rPr><w:b/></w:rPr><w:t>Hello</w:t></w:r><w:r><w:t>World</w:t></w:r>'
    );
    const next = apply(part, { op: 'insertText', paragraphId, offset: 5, text: '!' });
    expect(findNode(next, text.id)).toEqual({ ...text, value: 'Hello!' });
    expect(serializeOoxmlPart(next)).toContain('<w:rPr><w:b/></w:rPr><w:t>Hello!</w:t>');
  });

  test('right-biased boundary insertion updates the right source without changing its formatting', () => {
    const { part, paragraphId, text } = load(
      '<w:r><w:t>Hello</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>World</w:t></w:r>'
    );
    const next = apply(part, {
      op: 'insertText',
      paragraphId,
      offset: 5,
      text: '!',
      bias: 'right',
    });
    expect(findNode(next, text.id)).toBe(text);
    expect(serializeOoxmlPart(next)).toContain('<w:rPr><w:b/></w:rPr><w:t>!World</w:t>');
  });

  test('successive typing and partial deletion use UTF-16 offsets on the original source', () => {
    const { part, paragraphId, text } = load('<w:r><w:t>A😀B</w:t></w:r>');
    let next = apply(part, { op: 'insertText', paragraphId, offset: 3, text: 'X' });
    next = apply(next, { op: 'insertText', paragraphId, offset: 4, text: 'Y' });
    next = apply(next, { op: 'deleteText', paragraphId, start: 1, end: 4 });
    expect(findNode(next, text.id)).toEqual({ ...text, value: 'AYB' });
    expect(serializeOoxmlPart(next)).toContain('<w:t>AYB</w:t>');
  });

  test('partial deletion retains source identity and existing text attributes', () => {
    const { part, paragraphId, text, owner } = load(
      '<w:r><w:t xml:space="preserve"> Hello </w:t></w:r>'
    );
    const next = apply(part, { op: 'deleteText', paragraphId, start: 2, end: 5 });
    expect(findNode(next, text.id)).toEqual({ ...text, value: ' Ho ' });
    expect(findNode(next, owner.id)?.kind).toBe('text');
    expect(serializeOoxmlPart(next)).toContain('<w:t xml:space="preserve"> Ho </w:t>');
  });

  test('full deletion journals clearing the source before removing its owner', () => {
    const { part, paragraphId, text, owner } = load();
    const store = {};
    const journals: CanonicalPrimitiveJournal[] = [];
    const detach = observeCanonicalPrimitiveJournal(store, (journal) => journals.push(journal));
    try {
      const next = runObservedStoreTransaction(
        store,
        () => apply(part, { op: 'deleteText', paragraphId, start: 0, end: 5 }),
        () => true
      );
      flushPendingCanonicalJournals(store);
      expect(findNode(next, owner.id)).toBeNull();
      expect(serializeOoxmlPart(next)).toContain('<w:p/>');
      const effects = journals.flatMap((journal) => journal.effects);
      expect(effects[0]).toEqual({
        kind: 'spliceText',
        logicalId: text.id,
        utf16Start: 0,
        deleteCount: 5,
        insert: '',
      });
      expect(
        effects
          .slice(1)
          .some((effect) => effect.kind === 'spliceChildren' && effect.deleteCount > 0)
      ).toBe(true);
    } finally {
      detach();
    }
  });

  test('tab insertion still splits text around a tab element', () => {
    const { part, paragraphId } = load();
    expect(serializeOoxmlPart(apply(part, { op: 'insertTab', paragraphId, offset: 2 }))).toContain(
      '<w:t>He</w:t><w:tab/><w:t>llo</w:t>'
    );
  });
});
