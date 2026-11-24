// A simple field struck in suggesting mode: `w:del` cannot hold a `w:fldSimple`
// (`CT_RunTrackChange` takes `EG_ContentRunContent`), so the field is written in its complex
// form, all of it inside one `w:del`. A desktop word processor writes the same shape.

import { describe, expect, test } from 'bun:test';
import { ADA, apply, paragraphId, part, xml } from './tracked-edit-fixture.ts';

describe('a struck simple field', () => {
  const struckField = (field: string): string => {
    const before = part(`<w:p><w:r><w:t>ab</w:t></w:r>${field}<w:r><w:t>cd</w:t></w:r></w:p>`);
    return xml(
      apply(before, {
        op: 'deleteText',
        paragraphId: paragraphId(before),
        start: 2,
        end: 3,
        revision: ADA,
      })
    );
  };
  const wholeFieldDeletion = (instr: string, result = '') =>
    '<w:r><w:t>ab</w:t></w:r>' +
    '<w:del w:author="Ada Lovelace" w:date="2026-01-02T03:04:05Z" w:id="0">' +
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
    `<w:r><w:delInstrText xml:space="preserve">${instr}</w:delInstrText></w:r>` +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
    result +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:del>' +
    '<w:r><w:t>cd</w:t></w:r>';

  test('a simple field with a result is struck whole, in its complex form', () => {
    const serialized = struckField(
      '<w:fldSimple w:instr=" PAGE "><w:r><w:t>7</w:t></w:r></w:fldSimple>'
    );
    expect(serialized).toContain(
      wholeFieldDeletion(' PAGE ', '<w:r><w:delText>7</w:delText></w:r>')
    );
    expect(serialized).not.toContain('fldSimple');
  });

  test('a simple field with no saved result is struck too', () => {
    // It shows a computed value but holds no run, so striking runs inside it struck nothing
    // and the deletion vanished while the transaction reported success.
    const serialized = struckField('<w:fldSimple w:instr="PAGE"/>');
    expect(serialized).toContain(wholeFieldDeletion('PAGE'));
  });

  test('the field lock, dirty flag and field data move to the struck begin marker', () => {
    const serialized = struckField(
      '<w:fldSimple w:instr="TITLE" w:fldLock="1" w:dirty="1"><w:fldData>AAA=</w:fldData></w:fldSimple>'
    );
    expect(serialized).toMatch(
      /<w:del [^>]*><w:r><w:fldChar w:dirty="1" w:fldCharType="begin" w:fldLock="1"><w:fldData>AAA=<\/w:fldData><\/w:fldChar><\/w:r>/
    );
  });

  test('accepting the struck simple field removes it; rejecting restores the field', () => {
    const before = part(
      `<w:p><w:r><w:t>ab</w:t></w:r><w:fldSimple w:instr="PAGE"/><w:r><w:t>cd</w:t></w:r></w:p>`
    );
    const struck = apply(before, {
      op: 'deleteText',
      paragraphId: paragraphId(before),
      start: 2,
      end: 3,
      revision: ADA,
    });
    const decision = { revision: { id: '0', author: ADA.author, date: ADA.date } } as const;
    const accepted = xml(apply(struck, { op: 'acceptRevision', ...decision }));
    expect(accepted).toContain('<w:p><w:r><w:t>ab</w:t></w:r><w:r><w:t>cd</w:t></w:r></w:p>');
    const rejected = xml(apply(struck, { op: 'rejectRevision', ...decision }));
    expect(rejected).not.toContain('w:del');
    expect(rejected).toContain('<w:instrText xml:space="preserve">PAGE</w:instrText>');
    expect(rejected).toContain('w:fldCharType="end"');
  });

  test("inside the author's own pending insertion the field is taken back, not struck", () => {
    const serialized = struckField(
      `<w:ins w:id="7" w:author="${ADA.author}" w:date="${ADA.date}">` +
        '<w:fldSimple w:instr="PAGE"/></w:ins>'
    );
    expect(serialized).not.toContain('<w:del ');
    expect(serialized).not.toContain('fldSimple');
    expect(serialized).not.toContain('fldChar');
  });
});
