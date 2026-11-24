// `w:sym` (§17.3.3.30) paints one glyph without owning any model offset.
//
// The canonical tree keeps `w:sym` generic, and the store's offset authority gives a generic
// run child ZERO model width — `paragraphTextOf` never counts it. So the glyph is a projected
// piece at a zero-width range: it stands at an insertion point, paint emits it as furniture,
// and every surrounding offset stays exactly where the store put it. Both attributes are
// attacker-controlled; anything malformed fails closed to "no glyph".

import { describe, expect, test } from 'bun:test';
import {
  paragraphTextOf,
  readOoxmlPart,
  type OoxmlNode,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import { piecesOfParagraph } from '../field-projection.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { symbolGlyphOf } from '../symbol-run.ts';
import { styleForFontSlot } from '../script-itemization.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function partOf(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function paragraphOf(part: OoxmlPart): OoxmlNode {
  const find = (node: OoxmlNode): OoxmlNode | undefined => {
    if (node.kind === 'paragraph') return node;
    if (node.kind === 'textValue') return undefined;
    for (const child of node.children ?? []) {
      const hit = find(child);
      if (hit) return hit;
    }
    return undefined;
  };
  const paragraph = find(part.root);
  if (!paragraph) throw new Error('no paragraph');
  return paragraph;
}

function project(body: string) {
  return piecesOfParagraph(paragraphOf(partOf(body)), []);
}

const SYM = '<w:sym w:font="Wingdings" w:char="F0FC"/>';

describe('a w:sym between two text nodes', () => {
  const body = `<w:p><w:r><w:t>a</w:t>${SYM}<w:t>b</w:t></w:r></w:p>`;

  test('paints three pieces in order, the glyph mapped from the symbol page', () => {
    const pieces = project(body);
    // Wingdings 0xFC (stored as U+F0FC) has an exact Unicode twin.
    expect(pieces.map((piece) => piece.text)).toEqual(['a', '✔', 'b']);
  });

  test('the glyph is a projected piece over its one model offset', () => {
    const sym = project(body)[1]!;
    expect(sym.projected).toBe(true);
    expect(sym.start).toBe(1);
    expect(sym.end).toBe(2);
  });

  test('the glyph carries the authored symbol family', () => {
    expect(project(body)[1]!.style.fontFamily).toBe('Wingdings');
  });

  test('the model text reads the symbol as "(" and unprojected pieces stay 1:1', () => {
    const part = partOf(body);
    const paragraph = paragraphOf(part);
    expect(paragraphTextOf(part, paragraph.id)).toBe('a(b');
    const pieces = piecesOfParagraph(paragraph, []);
    // No piece claims an offset the paragraph does not have, and ranges never overlap.
    let cursor = 0;
    for (const piece of pieces) {
      expect(piece.start).toBeGreaterThanOrEqual(cursor);
      cursor = piece.end;
      if (!piece.projected) expect(piece.text.length).toBe(piece.end - piece.start);
    }
    expect(cursor).toBe(3);
  });
});

describe('symbol-font encodings', () => {
  test('an explicit font survives neighboring Han while an inherited font follows its slot', () => {
    const props = '<w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="SimSun"/></w:rPr>';
    for (const explicit of [false, true]) {
      const glyph = `<w:sym ${explicit ? 'w:font="Segoe UI Symbol" ' : ''}w:char="2713"/>`;
      for (const leading of [false, true]) {
        const han = '<w:t>中</w:t>';
        const pieces = project(
          `<w:p><w:r>${props}${leading ? glyph + han : han + glyph}</w:r></w:p>`
        );
        const symbol = pieces.find((piece) => piece.text === '✓')!;
        expect(styleForFontSlot(symbol.style, symbol.fontSlot).fontFamily).toBe(
          explicit ? 'Segoe UI Symbol' : 'SimSun'
        );
      }
    }
  });

  test('a bare byte on a symbol font maps like its 0xF000-page twin', () => {
    // Word accepts both `w:char="F046"` and `w:char="46"` for the same Wingdings glyph.
    const bare = project('<w:p><w:r><w:sym w:font="Wingdings" w:char="6C"/></w:r></w:p>');
    const paged = project('<w:p><w:r><w:sym w:font="Wingdings" w:char="F06C"/></w:r></w:p>');
    expect(bare.map((piece) => piece.text)).toEqual(['●']);
    expect(paged.map((piece) => piece.text)).toEqual(['●']);
  });

  test('an unmapped symbol-font code keeps the PUA character and the symbol font', () => {
    // No Unicode twin in the Wingdings table — the shaper may still resolve the PUA glyph.
    const pieces = project('<w:p><w:r><w:sym w:font="Wingdings" w:char="F046"/></w:r></w:p>');
    expect(pieces.map((piece) => piece.text)).toEqual(['\uF046']);
    expect(pieces[0]!.style.fontFamily).toBe('Wingdings');
  });

  test('a non-symbol font renders its code point directly', () => {
    // The exact shape the content-control checkbox writer emits.
    const pieces = project('<w:p><w:r><w:sym w:font="MS Gothic" w:char="2612"/></w:r></w:p>');
    expect(pieces.map((piece) => piece.text)).toEqual(['☒']);
    expect(pieces[0]!.style.fontFamily).toBe('MS Gothic');
  });

  test('a missing w:font keeps the run font', () => {
    const pieces = project(
      '<w:p><w:r><w:rPr><w:rFonts w:ascii="Georgia"/></w:rPr><w:sym w:char="2022"/></w:r></w:p>'
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['•']);
    expect(pieces[0]!.style.fontFamily).toBe('Georgia');
  });
});

describe('malformed w:sym', () => {
  const cases = [
    ['garbage', '<w:sym w:font="Wingdings" w:char="zzzz"/>'],
    ['too long', '<w:sym w:font="Wingdings" w:char="F0FC1"/>'],
    ['empty', '<w:sym w:font="Wingdings" w:char=""/>'],
    ['missing char', '<w:sym w:font="Wingdings"/>'],
    ['surrogate', '<w:sym w:char="D800"/>'],
    ['noncharacter', '<w:sym w:char="FFFF"/>'],
    ['control', '<w:sym w:char="0007"/>'],
  ] as const;

  for (const [label, sym] of cases) {
    test(`${label} renders nothing and does not throw`, () => {
      // It paints no glyph but keeps its one model offset.
      const pieces = project(`<w:p><w:r><w:t>a</w:t>${sym}<w:t>b</w:t></w:r></w:p>`);
      expect(pieces.map((piece) => piece.text)).toEqual(['a', 'b']);
      expect(pieces[1]).toMatchObject({ start: 2, end: 3 });
    });
  }
});

describe('a hidden w:sym', () => {
  test('a vanish run paints no glyph', () => {
    const pieces = project(`<w:p><w:r><w:rPr><w:vanish/></w:rPr>${SYM}</w:r></w:p>`);
    expect(pieces).toEqual([]);
  });
});

describe('w:sym inside field results', () => {
  test('joins a fldSimple cached result when it maps to real Unicode', () => {
    const pieces = project(
      `<w:p><w:fldSimple w:instr=" REF x "><w:r><w:t xml:space="preserve">ok </w:t>${SYM}</w:r></w:fldSimple></w:p>`
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['ok ✔']);
  });

  test('an unmapped PUA glyph is skipped from a fldSimple result', () => {
    // A collected display string cannot carry a font switch, so a glyph that only the symbol
    // font can draw stays out rather than painting tofu in the result font.
    const pieces = project(
      '<w:p><w:fldSimple w:instr=" REF x "><w:r><w:t>ok</w:t>' +
        '<w:sym w:font="Wingdings" w:char="F046"/></w:r></w:fldSimple></w:p>'
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['ok']);
  });

  test('joins a complex field cached result when it maps to real Unicode', () => {
    const pieces = project(
      '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
        '<w:r><w:instrText> REF x </w:instrText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
        `<w:r><w:t xml:space="preserve">ok </w:t>${SYM}</w:r>` +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['ok ✔']);
  });
});

describe('symbolGlyphOf', () => {
  test('rejects an overlong font name', () => {
    const part = partOf(`<w:p><w:r><w:sym w:font="${'A'.repeat(200)}" w:char="F0FC"/></w:r></w:p>`);
    const find = (node: OoxmlNode): OoxmlNode | undefined => {
      if (node.kind !== 'textValue' && node.localName === 'sym') return node;
      if (node.kind === 'textValue') return undefined;
      for (const child of node.children ?? []) {
        const hit = find(child);
        if (hit) return hit;
      }
      return undefined;
    };
    const sym = find(part.root);
    expect(sym).toBeDefined();
    const glyph = symbolGlyphOf(sym!);
    // The code point still renders; the unusable family is dropped.
    expect(glyph).toMatchObject({ text: '\uF0FC', font: null });
  });

  test('is null for anything that is not a w:sym', () => {
    const part = partOf('<w:p><w:r><w:t>a</w:t></w:r></w:p>');
    expect(symbolGlyphOf(part.root)).toBeNull();
  });
});

describe('a w:sym that opens the paragraph', () => {
  // Word writes this shape for a toggled checkbox alone in a cell: the paragraph's only
  // content is the `w:sym` glyph at offset 0. Its zero-width piece sits exactly at the
  // paragraph's start offset, which must not read as "before the visible range".
  const measurer = createFixedMeasurer(6, 14);
  const spansOf = (body: string) => {
    const layout = layoutSemanticDocument(partOf(body), 0, { measurer });
    return layout.pages[0]!.fragments.flatMap((fragment) =>
      fragment.lines.map((line) => line.spans.map((span) => span.text))
    );
  };

  test('lays out the glyph when it is the only content', () => {
    expect(spansOf(`<w:p><w:r>${SYM}</w:r></w:p>`)).toEqual([['✔']]);
  });

  test('keeps a leading glyph before text', () => {
    expect(spansOf(`<w:p><w:r>${SYM}<w:t>a</w:t></w:r></w:p>`)).toEqual([['✔', 'a']]);
  });

  test('lays out a checkbox control whose glyph is alone in the paragraph', () => {
    const body =
      '<w:p><w:sdt><w:sdtPr><w14:checkbox xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">' +
      '<w14:checked w14:val="1"/><w14:checkedState w14:val="2612" w14:font="MS Gothic"/>' +
      '<w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/></w14:checkbox></w:sdtPr>' +
      '<w:sdtContent><w:r><w:sym w:font="MS Gothic" w:char="2612"/></w:r></w:sdtContent></w:sdt></w:p>';
    expect(spansOf(body)).toEqual([['☒']]);
  });
});
