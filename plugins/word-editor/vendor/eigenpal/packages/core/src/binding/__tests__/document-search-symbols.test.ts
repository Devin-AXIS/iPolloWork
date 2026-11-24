// Find over symbols (`w:sym`): a symbol reads as "(" but search never matches it, in a run or
// inside a field's saved result. A match there would select the whole field, and replacing it
// would delete the field.

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { collectTextMatches } from '../document-search.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const SYM = '<w:sym w:font="Wingdings" w:char="F0FC"/>';

function bodyPart(body: string) {
  const loaded = readOoxmlPackage(
    zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
      ),
    })
  );
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.package.parts.get(loaded.package.mainDocumentPart)!;
}

const count = (body: string, query: string) =>
  collectTextMatches(bodyPart(body), query).matches.length;

const CASES = {
  run: `<w:p><w:r><w:t>a</w:t>${SYM}<w:t>b</w:t></w:r></w:p>`,
  complexField:
    '<w:p><w:r><w:t>x</w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
    '<w:r><w:instrText> REF bm </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
    `<w:r><w:t>a</w:t>${SYM}<w:t>b</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`,
  simpleField:
    '<w:p><w:r><w:t>x</w:t></w:r><w:fldSimple w:instr=" DATE ">' +
    `<w:r><w:t>a</w:t>${SYM}<w:t>b</w:t></w:r></w:fldSimple></w:p>`,
} as const;

describe('search never matches a symbol', () => {
  for (const [label, body] of Object.entries(CASES)) {
    test(`in a ${label}`, () => {
      expect(count(body, '(')).toBe(0);
      expect(count(body, 'a(b')).toBe(0);
      // The symbol is a character: the text on both sides of it is not joined.
      expect(count(body, 'ab')).toBe(0);
      expect(count(body, 'a')).toBe(1);
    });
  }

  test('a typed parenthesis next to a symbol still matches', () => {
    expect(count(`<w:p><w:r><w:t>x(</w:t>${SYM}<w:t>y</w:t></w:r></w:p>`, 'x(')).toBe(1);
  });

  test('match context shows a symbol as its glyph, not as a parenthesis', () => {
    const [match] = collectTextMatches(bodyPart(CASES.run), 'b').matches;
    expect(match?.contextBefore).toBe('a\u2714');
  });
});
