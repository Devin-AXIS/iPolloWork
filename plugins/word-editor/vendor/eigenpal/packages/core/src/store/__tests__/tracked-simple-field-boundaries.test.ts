import { expect, test } from 'bun:test';
import { TreeDocumentStore } from '../store/tree-store.ts';
import { findNode } from '../package/ooxml-edit.ts';
import { paragraphOffsetIndex } from '../store/tree-op-segments.ts';
import { ADA, paragraphId, part, xml } from './tracked-edit-fixture.ts';

const cached = '<w:r><w:t>cached</w:t></w:r>';
const results = {
  nested: `<w:fldSimple w:instr=" REF inner ">${cached}</w:fldSimple>`,
  hyperlink: `<w:hyperlink w:anchor="bookmark">${cached}</w:hyperlink>`,
  smartTag: `<w:smartTag w:uri="urn:test" w:element="tag">${cached}</w:smartTag>`,
  customXml: `<w:customXml w:uri="urn:test" w:element="tag">${cached}</w:customXml>`,
  dir: `<w:dir w:val="rtl">${cached}</w:dir>`,
  bdo: `<w:bdo w:val="rtl">${cached}</w:bdo>`,
  sdt: `<w:sdt><w:sdtPr/><w:sdtContent>${cached}</w:sdtContent></w:sdt>`,
};

for (const [name, result] of Object.entries(results)) {
  for (const replacement of [false, true]) {
    for (const complexOuter of [false, true]) {
      test(`tracked ${replacement ? 'replacement' : 'deletion'} refuses ${name} inside a ${complexOuter ? 'complex and simple' : 'simple'} field`, () => {
        // A plain result run must not be struck when its sibling cannot be struck.
        const simple = `<w:fldSimple w:instr=" DATE "><w:r><w:t>plain </w:t></w:r>${result}</w:fldSimple>`;
        const field = complexOuter
          ? '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
            '<w:r><w:instrText>DATE</w:instrText></w:r>' +
            '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
            simple +
            '<w:r><w:fldChar w:fldCharType="end"/></w:r>'
          : simple;
        const before = part(`<w:p><w:r><w:t>A</w:t></w:r>${field}<w:r><w:t>Z</w:t></w:r></w:p>`);
        const id = paragraphId(before);
        const paragraph = findNode(before, id);
        if (paragraph?.kind !== 'paragraph') throw new Error('missing paragraph');
        // Include every field atom, plus the prefix, after the staged insertion.
        const end = paragraphOffsetIndex(paragraph).length;
        const store = new TreeDocumentStore(before);
        let notifications = 0;
        const unsubscribe = store.subscribe(() => notifications++);
        const outcome = store.transact((tx) => {
          // Earlier operations in the same transaction must roll back too.
          tx.apply({ op: 'insertText', paragraphId: id, offset: 0, text: 'X', revision: ADA });
          tx.apply({ op: 'deleteText', paragraphId: id, start: 1, end, revision: ADA });
          if (replacement)
            tx.apply({
              op: 'insertText',
              paragraphId: id,
              offset: end,
              text: 'NEW',
              revision: ADA,
            });
        });
        unsubscribe();
        expect(outcome).toMatchObject({ ok: false, reason: 'unsupported' });
        expect(xml(store.part)).toBe(xml(before));
        expect(store.revision).toBe(0);
        expect(store.canUndo).toBe(false);
        expect(notifications).toBe(0);
        // The unsupported result must not block edits beside its field atom.
        expect(
          store.transact((tx) =>
            tx.apply({ op: 'deleteText', paragraphId: id, start: 0, end: 1, revision: ADA })
          ).ok
        ).toBe(true);
      });
    }
  }
}
