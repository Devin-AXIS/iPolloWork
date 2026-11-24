// A selected whole field versus its selected result text, in the editable field-result mode.
//
// Both selections have the same offsets: the result's first and last characters. Deleting the
// result text keeps the field with an empty result. Deleting the whole field, which an editor
// selects with a Backspace after the field, removes the field with its markers.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '../index.ts';
import {
  currentFieldResultsMode,
  wholeFieldDeletion,
  withWholeFieldDeletion,
} from '../package/field-result-mode.ts';
import type { OoxmlPart } from '../package/ooxml-tree.ts';
import { applyTreeOp, paragraphTextOf } from '../store/tree-ops.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const FIELDS = {
  complex:
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
    '<w:r><w:instrText xml:space="preserve"> MERGEFIELD Name </w:instrText></w:r>' +
    `<w:r><w:fldChar w:fldCharType="separate"/></w:r>${run('Name')}` +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>',
  simple: `<w:fldSimple w:instr=" MERGEFIELD Name ">${run('Name')}</w:fldSimple>`,
};

function paragraphWith(field: string): { part: OoxmlPart; id: string } {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:p>${run('ab ')}${field}${run(' cd')}</w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!read.ok) throw Error(read.reason);
  const body = read.part.root.children[0]!;
  if (body.kind === 'textValue') throw Error('no body');
  return { part: read.part, id: body.children[0]!.id };
}

const EDITABLE = { fieldResults: 'editable' } as const;

describe('deleting exactly a saved result', () => {
  for (const [label, field] of Object.entries(FIELDS)) {
    test(`${label}: the result text alone keeps an empty field`, () => {
      const { part, id } = paragraphWith(field);
      const result = applyTreeOp(
        part,
        { op: 'deleteText', paragraphId: id, start: 3, end: 7 },
        EDITABLE
      );
      if (!result.ok) throw Error(result.reason);
      expect(paragraphTextOf(result.part, id, EDITABLE)).toBe('ab \uFFFC cd');
      expect(serializeOoxmlPart(result.part)).toContain('MERGEFIELD');
    });

    test(`${label}: a selected whole field goes with its markers`, () => {
      const { part, id } = paragraphWith(field);
      const result = withWholeFieldDeletion(() =>
        applyTreeOp(part, { op: 'deleteText', paragraphId: id, start: 3, end: 7 }, EDITABLE)
      );
      if (!result.ok) throw Error(result.reason);
      expect(paragraphTextOf(result.part, id, EDITABLE)).toBe('ab  cd');
      expect(serializeOoxmlPart(result.part)).not.toContain('MERGEFIELD');
    });
  }

  test('a range inside the result is still a text edit while a whole field is selected', () => {
    const { part, id } = paragraphWith(FIELDS.complex);
    const result = withWholeFieldDeletion(() =>
      applyTreeOp(part, { op: 'deleteText', paragraphId: id, start: 4, end: 6 }, EDITABLE)
    );
    if (!result.ok) throw Error(result.reason);
    expect(paragraphTextOf(result.part, id, EDITABLE)).toBe('ab Ne cd');
  });

  test('the flag is scoped to the call, also when it throws', () => {
    expect(() =>
      withWholeFieldDeletion(() => {
        expect(wholeFieldDeletion()).toBe(true);
        throw new Error('boom');
      })
    ).toThrow('boom');
    expect(wholeFieldDeletion()).toBe(false);
    expect(currentFieldResultsMode()).toBe('atomic');
  });
});
