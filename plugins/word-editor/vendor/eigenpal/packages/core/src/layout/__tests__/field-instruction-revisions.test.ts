// w:delInstrText NEXT TO live w:instrText — a tracked field-code edit.
//
// The machine buffers deleted and live instruction chunks separately: concatenating them
// produces an instruction nobody authored (" PAGE  NUMPAGES "), which fails the allowlist
// and sends a live field inert. The EFFECTIVE instruction is the live buffer when any live
// element exists, else the deleted buffer, with overflow accounted per buffer.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlNode, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  MAX_FIELD_INSTRUCTION_CHARS,
  detectStoryPageFields,
  piecesOfParagraph,
} from '../field-projection.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function partOf(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function paragraphOf(body: string): OoxmlNode {
  const find = (node: OoxmlNode): OoxmlNode | undefined => {
    if (node.kind === 'paragraph') return node;
    if (node.kind === 'textValue') return undefined;
    for (const child of node.children ?? []) {
      const hit = find(child);
      if (hit) return hit;
    }
    return undefined;
  };
  const paragraph = find(partOf(body).root);
  if (!paragraph) throw new Error('no paragraph');
  return paragraph;
}

/** One complex field whose instruction runs are supplied verbatim. */
const fieldWith = (instructionRuns: string, cached = '9'): string =>
  '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  instructionRuns +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  `<w:r><w:t>${cached}</w:t></w:r>` +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';

describe('w:delInstrText NEXT TO live w:instrText', () => {
  const mixed = fieldWith(
    '<w:r><w:delInstrText> PAGE </w:delInstrText></w:r>' +
      '<w:r><w:instrText> NUMPAGES </w:instrText></w:r>'
  );

  test('the live NUMPAGES stays live — deleted chunks never merge into it', () => {
    const pieces = piecesOfParagraph(paragraphOf(mixed), [], {
      pageNumber: 2,
      pageCount: 7,
    });
    expect(pieces.map((piece) => piece.text)).toEqual(['7']);
    expect(pieces[0]).toMatchObject({ start: 0, end: 1, projected: true });
  });

  test('detection agrees: the story needs NUMPAGES, not PAGE', () => {
    const needs = detectStoryPageFields(partOf(mixed).root);
    expect(needs).toMatchObject({ hasPage: false, hasNumPages: true });
  });

  test('a huge deleted chunk does not overflow a small live instruction', () => {
    const huge = 'X'.repeat(MAX_FIELD_INSTRUCTION_CHARS + 40);
    const pieces = piecesOfParagraph(
      paragraphOf(
        fieldWith(
          `<w:r><w:delInstrText>${huge}</w:delInstrText></w:r>` +
            '<w:r><w:instrText> NUMPAGES </w:instrText></w:r>'
        )
      ),
      [],
      { pageNumber: 2, pageCount: 7 }
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['7']);
  });

  test('a huge LIVE instruction still overflows to inert (cached result paints)', () => {
    const huge = ' NUMPAGES ' + 'X'.repeat(MAX_FIELD_INSTRUCTION_CHARS + 40);
    const pieces = piecesOfParagraph(
      paragraphOf(fieldWith(`<w:r><w:instrText>${huge}</w:instrText></w:r>`)),
      [],
      { pageNumber: 2, pageCount: 7 }
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['9']);
  });

  test('an EMPTY live element beside a deleted instruction goes inert, not deleted-driven', () => {
    // Accepting the deletion leaves exactly the empty live instruction, so the deleted
    // buffer must not answer for it.
    const pieces = piecesOfParagraph(
      paragraphOf(
        fieldWith(
          '<w:r><w:delInstrText> PAGE </w:delInstrText></w:r>' +
            '<w:r><w:instrText></w:instrText></w:r>'
        )
      ),
      [],
      { pageNumber: 2, pageCount: 7 }
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['9']);
  });
});
