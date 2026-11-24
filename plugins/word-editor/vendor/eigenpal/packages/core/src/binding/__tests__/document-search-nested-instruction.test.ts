// Find over simple fields nested inside a complex field's instruction.
//
// The nested saved results are input to the outer field and are not displayed, so Find does
// not match them. Matches around the field still address the store's raw offsets, which keep
// one unit for each nested field.

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { collectTextMatches } from '../document-search.ts';
import { openTreeSession } from '../tree-session.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const run = (content: string) => `<w:r>${content}</w:r>`;
const text = (value: string) => run(`<w:t xml:space="preserve">${value}</w:t>`);
const instr = (value: string) => run(`<w:instrText xml:space="preserve">${value}</w:instrText>`);
const marker = (type: string) => run(`<w:fldChar w:fldCharType="${type}"/>`);
const styleRef = (result: string) =>
  `<w:fldSimple w:instr=" STYLEREF Heading ">${result}</w:fldSimple>`;

const BODY =
  text('A') +
  marker('begin') +
  instr(' IF ') +
  styleRef(run('<w:t>S1</w:t><w:cr/>')) +
  instr(' &lt;&gt; "x" ') +
  styleRef(text('S2')) +
  instr(' ') +
  marker('separate') +
  text('R') +
  marker('end') +
  text('Z');

function search(query: string) {
  const bytes = zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p>${BODY}</w:p></w:body></w:document>`
    ),
  });
  const opened = openTreeSession(bytes);
  if (!opened.ok) throw new Error(opened.reason);
  return collectTextMatches(opened.session.part(), query);
}

describe('Find over nested instruction fields', () => {
  test('a nested saved result has no match', () => {
    expect(search('S1').matches).toEqual([]);
    expect(search('S2').matches).toEqual([]);
  });

  test('matches across the field address the raw offsets of every unit', () => {
    const [across] = search('RZ').matches;
    // R is the IF field at raw 1; the nested fields hold raw 2 and 3; Z is raw 4.
    expect(across).toMatchObject({ start: 1, length: 4, text: 'RZ' });
    const [whole] = search('ARZ').matches;
    expect(whole).toMatchObject({ start: 0, length: 5, text: 'ARZ' });
  });
});
