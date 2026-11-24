// `w:fldSimple` paints its cached result.
//
// The simple field (§17.16.19) keeps its instruction in `@w:instr` and its last-computed result
// as child runs — there is no `separate` marker, so none of the complex-field machine applies to
// it. Layout used to advance one model unit past the element and emit nothing, which kept every
// offset correct and painted the result as blank. A document that writes its cross-references
// this way showed empty space where Word shows text.
//
// The single model unit is the part that must not move: it is what keeps `paragraphTextOf`,
// selection and the caret agreeing that a field is one thing.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlNode, type OoxmlPart } from '@docx-editor.dev/core/store';
import { detectStoryPageFields, piecesOfParagraph } from '../field-projection.ts';
import type { RevisionDisplayMode } from '../revision-projection.ts';

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

function project(body: string, mode: RevisionDisplayMode = 'all-markup') {
  return piecesOfParagraph(paragraphOf(body), [], undefined, undefined, undefined, undefined, mode);
}

const SIMPLE =
  '<w:p><w:r><w:t>A</w:t></w:r>' +
  '<w:fldSimple w:instr=" REF _Ref1 \\h "><w:r><w:t>Section 3</w:t></w:r></w:fldSimple>' +
  '<w:r><w:t>B</w:t></w:r></w:p>';

describe('a simple field', () => {
  test('paints its cached result', () => {
    expect(project(SIMPLE).map((piece) => piece.text)).toEqual(['A', 'Section 3', 'B']);
  });

  test('occupies exactly one model unit, however long the result', () => {
    const pieces = project(SIMPLE);
    const field = pieces.find((piece) => piece.text === 'Section 3')!;
    expect(field.start).toBe(1);
    expect(field.end).toBe(2);
    expect(field.projected).toBe(true);
    // The run after it must still start where it did when the field painted nothing.
    expect(pieces.find((piece) => piece.text === 'B')).toMatchObject({ start: 2, end: 3 });
  });

  test('an empty result still occupies its unit', () => {
    const pieces = project(
      '<w:p><w:r><w:t>A</w:t></w:r><w:fldSimple w:instr=" REF x "/><w:r><w:t>B</w:t></w:r></w:p>'
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['A', 'B']);
    expect(pieces[1]).toMatchObject({ start: 2, end: 3 });
  });

  test('the instruction is never displayed', () => {
    // `@w:instr` is the field's CODE. Painting it would put ` REF _Ref1 \h ` on the page, and
    // instructions are attacker-controlled.
    expect(
      project(SIMPLE)
        .map((piece) => piece.text)
        .join('')
    ).not.toContain('REF');
  });

  test('a nested field inside the result contributes no chrome', () => {
    const pieces = project(
      '<w:p><w:fldSimple w:instr=" REF a ">' +
        '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
        '<w:r><w:instrText> PAGE </w:instrText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
        '<w:r><w:t>7</w:t></w:r>' +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
        '</w:fldSimple></w:p>'
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['7']);
  });

  test('a hidden result paints nothing but keeps its unit', () => {
    const pieces = project(
      '<w:p><w:r><w:t>A</w:t></w:r>' +
        '<w:fldSimple w:instr=" REF x "><w:r><w:rPr><w:vanish/></w:rPr><w:t>hidden</w:t></w:r></w:fldSimple>' +
        '<w:r><w:t>B</w:t></w:r></w:p>'
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['A', 'B']);
    expect(pieces[1]).toMatchObject({ start: 2, end: 3 });
  });
});

describe('a simple field inside a hyperlink', () => {
  test('the link keeps both its words and its field', () => {
    // A linked heading followed by its page number is how a contents entry is written. The
    // link's allowed children omitted `w:fldSimple`, so the LINK demoted to generic — and
    // layout drops a generic paragraph child whole, so the entry's words disappeared along
    // with its number.
    const pieces = project(
      '<w:p><w:hyperlink w:anchor="a"><w:r><w:t>Heading</w:t></w:r>' +
        '<w:fldSimple w:instr=" PAGEREF a "><w:r><w:t>7</w:t></w:r></w:fldSimple>' +
        '</w:hyperlink></w:p>'
    );
    expect(pieces.map((piece) => piece.text).join('')).toBe('Heading7');
  });
});

describe('a simple PAGE field', () => {
  const page = '<w:p><w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p>';

  test('evaluates per sheet rather than painting the cached number', () => {
    // The cached result is whatever sheet the producer last saved from. Painting it verbatim
    // put that number on every page — a wrong page number is quieter than a blank one, not
    // smaller.
    for (const [pageNumber, expected] of [
      [1, '1'],
      [2, '2'],
      [7, '7'],
    ] as const) {
      const pieces = piecesOfParagraph(paragraphOf(page), [], { pageNumber, pageCount: 9 });
      expect(pieces.map((piece) => piece.text).join('')).toBe(expected);
    }
  });

  test('a deleted simple PAGE is gone from the proposed result', () => {
    // The live page-field branch does not go through the text collector, so its visibility has
    // to be resolved before it — otherwise a deleted footer number painted straight into the
    // accepted view, evaluated and current, as if nobody had struck it.
    const deleted = `<w:p><w:del w:id="1" w:author="A">${page.slice(5, -6)}</w:del></w:p>`;
    const pieces = piecesOfParagraph(
      paragraphOf(deleted),
      [],
      { pageNumber: 7, pageCount: 9 },
      undefined,
      undefined,
      undefined,
      'proposed'
    );
    expect(pieces.map((piece) => piece.text).join('')).toBe('');
  });

  test('a complex PAGE nested inside a non-page simple field is still found', () => {
    // `STYLEREF` wrapping a `PAGE` is ordinary in a running header. Returning early for every
    // simple field hid the inner one: the story reported no page fields, its context token
    // stayed empty, one layout served every sheet, and the number showed page one everywhere —
    // the same failure this detection exists to prevent, one level down.
    const nested =
      '<w:p><w:fldSimple w:instr=" STYLEREF 1 ">' +
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:instrText> PAGE </w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      '<w:r><w:t>1</w:t></w:r>' +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:fldSimple></w:p>';
    expect(detectStoryPageFields(partOf(nested).root).hasPage).toBe(true);
  });

  test('a complex PAGE nested inside a non-page simple field evaluates per sheet', () => {
    // Detection alone is not enough: projectSimpleField used to concatenate the nested
    // field's cached digits, so every sheet still painted page one after furniture finally
    // supplied a context. Assert the live value under two different page contexts.
    const nested =
      '<w:p><w:fldSimple w:instr=" STYLEREF 1 ">' +
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:instrText> PAGE </w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      '<w:r><w:t>1</w:t></w:r>' +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:fldSimple></w:p>';
    const paragraph = paragraphOf(nested);
    expect(
      piecesOfParagraph(paragraph, [], { pageNumber: 2, pageCount: 9 })
        .map((piece) => piece.text)
        .join('')
    ).toBe('2');
    expect(
      piecesOfParagraph(paragraph, [], { pageNumber: 7, pageCount: 9 })
        .map((piece) => piece.text)
        .join('')
    ).toBe('7');
  });

  test('a simple PAGE nested inside a non-page simple field evaluates per sheet', () => {
    const nested =
      '<w:p><w:fldSimple w:instr=" STYLEREF 1 ">' +
      '<w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple>' +
      '</w:fldSimple></w:p>';
    expect(
      piecesOfParagraph(paragraphOf(nested), [], { pageNumber: 4, pageCount: 9 })
        .map((piece) => piece.text)
        .join('')
    ).toBe('4');
  });

  test('is detected, so furniture gets a per-sheet context at all', () => {
    // Without detection the story's page-field key stays empty and one layout is reused for
    // every sheet, so evaluation never gets the chance to differ.
    expect(detectStoryPageFields(partOf(page).root)).toEqual({
      hasPage: true,
      hasNumPages: false,
      hasSectionPages: false,
    });
  });

  test('falls back to the cached result with no page context', () => {
    expect(
      project(page)
        .map((piece) => piece.text)
        .join('')
    ).toBe('1');
  });
});

describe('a nested simple field inside a tracked complex cache', () => {
  // Everything between a tracked inner field's separate and its end is the REPLACED result.
  // A nested `w:fldSimple PAGE` in that cache used to self-append its live value AND leave
  // the tracked end appending another — the same number painted twice on every sheet. It is
  // noted as replaced content instead: one live value, from the tracked end only.
  const TRACKED_NESTED_SIMPLE =
    '<w:p><w:fldSimple w:instr=" QUOTE x ">' +
    '<w:r><w:t xml:space="preserve">p. </w:t></w:r>' +
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
    '<w:r><w:instrText> PAGE </w:instrText></w:r>' +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
    '<w:fldSimple w:instr=" PAGE "><w:r><w:t>7</w:t></w:r></w:fldSimple>' +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
    '</w:fldSimple></w:p>';

  test('paints exactly ONE live value', () => {
    expect(
      piecesOfParagraph(paragraphOf(TRACKED_NESTED_SIMPLE), [], { pageNumber: 3, pageCount: 9 })
        .map((piece) => piece.text)
        .join('')
    ).toBe('p. 3');
  });

  test('a visible nested-fldSimple result keeps the tracked end appending', () => {
    // The nested simple field's cached run still notes the tracker as VISIBLE replaced
    // content — without that, `seen && !visible` reads as a hidden result and the tracked
    // end appends nothing at all.
    const visible =
      '<w:p><w:fldSimple w:instr=" QUOTE x ">' +
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:instrText> PAGE </w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      '<w:fldSimple w:instr=" REF y "><w:r><w:t>7</w:t></w:r></w:fldSimple>' +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
      '</w:fldSimple></w:p>';
    expect(
      piecesOfParagraph(paragraphOf(visible), [], { pageNumber: 3, pageCount: 9 })
        .map((piece) => piece.text)
        .join('')
    ).toBe('3');

    // Contrast: a nested simple field whose whole cached result the file hides suppresses
    // the live value too — a live number would resurrect a result the file says not to show.
    const hidden =
      '<w:p><w:fldSimple w:instr=" QUOTE x ">' +
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:instrText> PAGE </w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      '<w:fldSimple w:instr=" REF y ">' +
      '<w:r><w:rPr><w:vanish/></w:rPr><w:t>7</w:t></w:r></w:fldSimple>' +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
      '</w:fldSimple></w:p>';
    expect(
      piecesOfParagraph(paragraphOf(hidden), [], { pageNumber: 3, pageCount: 9 })
        .map((piece) => piece.text)
        .join('')
    ).toBe('');
  });
});

describe('a tracked simple field', () => {
  const inserted =
    '<w:p><w:ins w:id="1" w:author="Author" w:date="2026-07-07T20:18:00Z">' +
    '<w:fldSimple w:instr=" REF _Ref1 \\h "><w:r><w:t>Section 9</w:t></w:r></w:fldSimple>' +
    '</w:ins></w:p>';

  test('carries the attribution of the revision around it', () => {
    const piece = project(inserted).find((candidate) => candidate.text === 'Section 9');
    expect(piece?.revisions?.map((revision) => revision.kind)).toEqual(['insert']);
  });

  test('is absent from the original view', () => {
    expect(project(inserted, 'original').map((piece) => piece.text)).toEqual([]);
  });
});
