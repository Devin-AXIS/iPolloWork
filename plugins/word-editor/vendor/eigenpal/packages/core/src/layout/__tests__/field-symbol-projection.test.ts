// The SYMBOL field paints from its instruction (§17.16.5.60).
//
// Real files carry NO cached result for SYMBOL — Word always renders from the instruction —
// so layout synthesizes the glyph over the field's single reserved model unit. Every hostile
// instruction falls back to the previous behavior (cached text or nothing), never a throw.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlNode, type OoxmlPart } from '@docx-editor.dev/core/store';
import { piecesOfParagraph } from '../field-projection.ts';
import { styleForFontSlot } from '../script-itemization.ts';
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

/** A complete complex field around one instruction, with an optional cached result. */
function complexField(instr: string, result = '', chromeRpr = ''): string {
  return (
    `<w:r>${chromeRpr}<w:fldChar w:fldCharType="begin"/></w:r>` +
    `<w:r>${chromeRpr}<w:instrText>${instr}</w:instrText></w:r>` +
    `<w:r>${chromeRpr}<w:fldChar w:fldCharType="separate"/></w:r>` +
    result +
    `<w:r>${chromeRpr}<w:fldChar w:fldCharType="end"/></w:r>`
  );
}

describe('a complex SYMBOL field', () => {
  test('an explicit font survives neighboring Han while an inherited font follows its slot', () => {
    const props = '<w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="SimSun"/></w:rPr>';
    for (const explicit of [false, true]) {
      const instruction = ` SYMBOL 10003 ${explicit ? '\\f "Segoe UI Symbol" ' : ''}\\u `;
      for (const leading of [false, true]) {
        const han = `<w:r>${props}<w:t>中</w:t></w:r>`;
        const field = complexField(instruction, '', props);
        const pieces = project(`<w:p>${leading ? field + han : han + field}</w:p>`);
        const symbol = pieces.find((piece) => piece.text === '✓')!;
        expect(styleForFontSlot(symbol.style, symbol.fontSlot).fontFamily).toBe(
          explicit ? 'Segoe UI Symbol' : 'SimSun'
        );
      }
    }
  });

  test('keeps an explicit Unicode symbol face under an inherited East Asian hint', () => {
    const props =
      '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="SimSun" w:hint="eastAsia"/></w:rPr>';
    const pieces = project(
      `<w:p>${complexField(' SYMBOL 10003 \\f "Segoe UI Symbol" \\u ', '', props)}</w:p>`
    );
    expect(pieces).toHaveLength(1);
    expect(pieces[0]).toMatchObject({ text: '✓', projected: true });
    expect(pieces[0]!.style.fontFamily).toBe('Segoe UI Symbol');
    expect(pieces[0]!.fontSlot).toBeUndefined();
  });

  test('paints the mapped glyph over one atom unit with the \\f family', () => {
    const pieces = project(
      '<w:p><w:r><w:t>A</w:t></w:r>' +
        complexField(' SYMBOL 0xF0FC \\f "Wingdings" ') +
        '<w:r><w:t>B</w:t></w:r></w:p>'
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['A', '✔', 'B']);
    const glyph = pieces[1]!;
    expect(glyph).toMatchObject({ start: 1, end: 2, projected: true });
    expect(glyph.style.fontFamily).toBe('Wingdings');
    expect(glyph.fieldAtom).toEqual({ formField: false });
    expect(pieces[2]).toMatchObject({ start: 2, end: 3 });
  });

  test('a decimal code on a symbol font normalizes onto the 0xF000 page', () => {
    const pieces = project(`<w:p>${complexField(' SYMBOL 183 \\f "Symbol" ')}</w:p>`);
    expect(pieces.map((piece) => piece.text)).toEqual(['•']);
  });

  test('\\u renders the codepoint directly and \\s sets whole points', () => {
    const pieces = project(`<w:p>${complexField(' SYMBOL 8226 \\u \\s 24 ')}</w:p>`);
    expect(pieces.map((piece) => piece.text)).toEqual(['•']);
    expect(pieces[0]!.style.fontSizePt).toBe(24);
  });

  test('an unquoted \\f token works', () => {
    const pieces = project(`<w:p>${complexField(' SYMBOL 0xF06C \\f Wingdings ')}</w:p>`);
    expect(pieces.map((piece) => piece.text)).toEqual(['●']);
    expect(pieces[0]!.style.fontFamily).toBe('Wingdings');
  });

  test('the instruction wins over a stale cached result', () => {
    const pieces = project(
      `<w:p>${complexField(' SYMBOL 0xF0FC \\f "Wingdings" ', '<w:r><w:t>OLD</w:t></w:r>')}</w:p>`
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['✔']);
    expect(pieces[0]).toMatchObject({ start: 0, end: 1, projected: true });
  });

  test('the begin/instr/end shape without separate still paints', () => {
    const pieces = project(
      '<w:p><w:r><w:t>A</w:t></w:r>' +
        '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
        '<w:r><w:instrText> SYMBOL 0xF0FC \\f "Wingdings" </w:instrText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
        '<w:r><w:t>B</w:t></w:r></w:p>'
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['A', '✔', 'B']);
    expect(pieces[1]).toMatchObject({ start: 1, end: 2, projected: true });
  });

  test('hidden chrome runs paint nothing but keep the unit', () => {
    const pieces = project(
      '<w:p><w:r><w:t>A</w:t></w:r>' +
        complexField(' SYMBOL 0xF0FC \\f "Wingdings" ', '', '<w:rPr><w:vanish/></w:rPr>') +
        '<w:r><w:t>B</w:t></w:r></w:p>'
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['A', 'B']);
    expect(pieces[1]).toMatchObject({ start: 2, end: 3 });
  });

  test('a tracked-deleted SYMBOL is gone from the proposed result', () => {
    const pieces = project(
      `<w:p><w:del w:id="1" w:author="A">${complexField(' SYMBOL 0xF0FC \\f "Wingdings" ')}</w:del></w:p>`,
      'proposed'
    );
    expect(pieces.map((piece) => piece.text)).toEqual([]);
  });

  test('hostile instructions stay inert without throwing', () => {
    for (const instr of [
      ' SYMBOL 999999999999 ',
      ' SYMBOL 0xD800 ',
      ' SYMBOL 0xFFFC ',
      ' SYMBOL ',
    ]) {
      // Previous behavior: the cached result paints; the instruction never does.
      const pieces = project(`<w:p>${complexField(instr, '<w:r><w:t>cached</w:t></w:r>')}</w:p>`);
      expect(pieces.map((piece) => piece.text)).toEqual(['cached']);
      // And with an empty result the unit stays empty.
      const empty = project(`<w:p>${complexField(instr)}<w:r><w:t>B</w:t></w:r></w:p>`);
      expect(empty.map((piece) => piece.text)).toEqual(['B']);
      expect(empty[0]).toMatchObject({ start: 1, end: 2 });
    }
  });

  test('garbage switches never fail the parse', () => {
    const pieces = project(`<w:p>${complexField(' SYMBOL 65 \\zz \\h \\j "stray" ')}</w:p>`);
    expect(pieces.map((piece) => piece.text)).toEqual(['A']);
  });

  test('instruction text split across several instrText runs still parses', () => {
    const pieces = project(
      '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
        '<w:r><w:instrText> SYM</w:instrText></w:r>' +
        '<w:r><w:instrText>BOL 0xF0</w:instrText></w:r>' +
        '<w:r><w:instrText>FC \\f "Wingdings" </w:instrText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['✔']);
    expect(pieces[0]!.style.fontFamily).toBe('Wingdings');
  });

  test('a decimal code with an unquoted symbol font maps like the hex form', () => {
    const pieces = project(`<w:p>${complexField(' SYMBOL 61692 \\f Wingdings ')}</w:p>`);
    // 61692 = 0xF0FC, Wingdings check mark.
    expect(pieces.map((piece) => piece.text)).toEqual(['✔']);
  });

  test("a nested inner field's instruction never leaks into the outer capture", () => {
    // The inner PAGE must neither corrupt the outer SYMBOL nor paint its own text; the outer
    // instruction is its OWN level-1 fragments, rejoined around the inner field.
    const pieces = project(
      '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
        '<w:r><w:instrText> SYMBOL </w:instrText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
        '<w:r><w:instrText> PAGE </w:instrText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
        '<w:r><w:instrText> 0xF0FC \\f "Wingdings" </w:instrText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
        '<w:r><w:t>cached</w:t></w:r>' +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['✔']);
  });

  test('\\f beats a theme-resolved run font when themeFonts are supplied', () => {
    const pieces = piecesOfParagraph(
      paragraphOf(
        '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
          '<w:r><w:instrText> SYMBOL 65 \\u \\f "Courier New" </w:instrText></w:r>' +
          '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
          '<w:r><w:rPr><w:rFonts w:asciiTheme="minorHAnsi"/></w:rPr><w:t>x</w:t></w:r>' +
          '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'
      ),
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      'all-markup',
      undefined,
      undefined,
      { major: 'Georgia', minor: 'Calibri' }
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['A']);
    expect(pieces[0]!.style.fontFamily).toBe('Courier New');
  });

  test('hostile >4-deep nesting refuses SYMBOL synthesis from outer fragments', () => {
    const deep =
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>'.repeat(5) +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r>'.repeat(5);
    const pieces = project(
      '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
        '<w:r><w:instrText> SYMBOL 0xF0FC \\f "Wingdings" </w:instrText></w:r>' +
        deep +
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'
    );
    expect(pieces.map((piece) => piece.text)).toEqual([]);
  });

  test('a result made of one w:sym donates style and revision attribution', () => {
    // The sym is the FIRST visible result content, so it captures like ordinary text: the
    // atom carries the deletion in all-markup instead of painting as unchanged text.
    const pieces = project(
      '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
        '<w:r><w:instrText> DATE </w:instrText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
        '<w:del w:id="1" w:author="A"><w:r><w:sym w:font="Wingdings" w:char="F0FC"/></w:r></w:del>' +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['✔']);
    expect(pieces[0]!.revisions?.map((revision) => revision.kind)).toEqual(['delete']);
    // And the deletion resolves away in the proposed result.
    const proposed = project(
      '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
        '<w:r><w:instrText> DATE </w:instrText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
        '<w:del w:id="1" w:author="A"><w:r><w:sym w:font="Wingdings" w:char="F0FC"/></w:r></w:del>' +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
      'proposed'
    );
    expect(proposed.map((piece) => piece.text)).toEqual([]);
  });

  test("a demoted field's result w:sym paints as a projected glyph over one offset", () => {
    // No end marker: the field demotes and its result is ordinary content — the sym must
    // paint exactly as it does in an ordinary run instead of vanishing with the atomic skips.
    const pieces = project(
      '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
        '<w:r><w:instrText> DATE </w:instrText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
        '<w:r><w:t>be</w:t><w:sym w:font="Wingdings" w:char="F0FC"/><w:t>fore</w:t></w:r></w:p>'
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['be', '✔', 'fore']);
    const glyph = pieces[1]!;
    expect(glyph).toMatchObject({ start: 2, end: 3, projected: true });
    expect(glyph.style.fontFamily).toBe('Wingdings');
    expect(glyph.fieldAtom).toEqual({ formField: false });
    // Surrounding demoted result text keeps its literal offsets.
    expect(pieces[2]).toMatchObject({ start: 3, end: 7 });
  });
});

describe('a simple SYMBOL field', () => {
  test('paints the glyph over its reserved unit', () => {
    const pieces = project(
      '<w:p><w:r><w:t>A</w:t></w:r>' +
        '<w:fldSimple w:instr=" SYMBOL 0xF0FC \\f &quot;Wingdings&quot; "/>' +
        '<w:r><w:t>B</w:t></w:r></w:p>'
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['A', '✔', 'B']);
    const glyph = pieces[1]!;
    expect(glyph).toMatchObject({ start: 1, end: 2, projected: true });
    expect(glyph.style.fontFamily).toBe('Wingdings');
    expect(glyph.fieldAtom).toEqual({ formField: false });
  });

  test('the instruction wins over the cached result', () => {
    const pieces = project(
      '<w:p><w:fldSimple w:instr=" SYMBOL 183 \\f Symbol ">' +
        '<w:r><w:t>OLD</w:t></w:r></w:fldSimple></w:p>'
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['•']);
  });

  test('a hostile instruction falls back to the cached result', () => {
    const pieces = project(
      '<w:p><w:fldSimple w:instr=" SYMBOL 0xD800 ">' +
        '<w:r><w:t>cached</w:t></w:r></w:fldSimple></w:p>'
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['cached']);
  });

  test('a tracked-deleted simple SYMBOL is gone from the proposed result', () => {
    const pieces = project(
      '<w:p><w:del w:id="1" w:author="A">' +
        '<w:fldSimple w:instr=" SYMBOL 0xF0FC \\f &quot;Wingdings&quot; "/></w:del>' +
        '<w:r><w:t>B</w:t></w:r></w:p>',
      'proposed'
    );
    // The atom's unit is kept — B stays at offset 1 — but nothing paints for it.
    expect(pieces.map((piece) => piece.text)).toEqual(['B']);
    expect(pieces[0]).toMatchObject({ start: 1, end: 2 });
  });

  test('a hidden cached result does not hide the synthesized glyph', () => {
    // SYMBOL is instruction-authoritative: the vanish belongs to the CACHED result run, and
    // that run donates nothing. Only a hidden glyph style itself suppresses the paint.
    const pieces = project(
      '<w:p><w:fldSimple w:instr=" SYMBOL 0xF0FC \\f &quot;Wingdings&quot; ">' +
        '<w:r><w:rPr><w:vanish/></w:rPr><w:t>old</w:t></w:r></w:fldSimple>' +
        '<w:r><w:t>B</w:t></w:r></w:p>'
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['✔', 'B']);
  });
});
