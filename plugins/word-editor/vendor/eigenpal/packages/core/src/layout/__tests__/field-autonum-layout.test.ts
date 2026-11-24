// AUTONUM / AUTONUMLGL / AUTONUMOUT fields through full layout: synthesized sequential
// numbers. These fields carry no separator and no cached result — Word computes the number at
// display time and never stores it — so the engine numbers each kind in document order and
// formats through the shared ST_NumberFormat resolver. Unsupported switches paint nothing,
// the fields' historical rendering.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { createLayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { paragraphFragmentsOf, type SemanticLayout } from '../index.ts';
import { parseAutonumInstruction } from '../field-autonum.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

/** A complex AUTONUM-family field: begin / instrText / end — NO separator, NO result runs. */
const autonumField = (instr: string) =>
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  `<w:r><w:instrText>${instr}</w:instrText></w:r>` +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';

const autonumParagraph = (instr: string, text: string) =>
  `<w:p>${autonumField(instr)}<w:r><w:t xml:space="preserve"> ${text}</w:t></w:r></w:p>`;

const textsOf = (layout: SemanticLayout): string[] =>
  layout.pages.flatMap((page) =>
    paragraphFragmentsOf(page).map((fragment) =>
      fragment.lines
        .flatMap((line) => line.spans.map((span) => span.text))
        .join('')
        .trim()
    )
  );

function layoutOf(body: string): SemanticLayout {
  return layoutSemanticDocument(load(body), 1, { measurer });
}

describe('parseAutonumInstruction', () => {
  test('the three keywords parse with their supported switches', () => {
    expect(parseAutonumInstruction(' AUTONUM ')).toEqual({
      kind: 'AUTONUM',
      numFmt: null,
      suppressPeriod: false,
    });
    expect(parseAutonumInstruction(' AUTONUMLGL \\* ALPHABETIC \\e ')).toEqual({
      kind: 'AUTONUMLGL',
      numFmt: 'upperLetter',
      suppressPeriod: true,
    });
    expect(parseAutonumInstruction(' AUTONUMOUT \\* MERGEFORMAT ')).toEqual({
      kind: 'AUTONUMOUT',
      numFmt: null,
      suppressPeriod: false,
    });
    // The switch's own case picks the variant, the way Word reads the general formats.
    expect(parseAutonumInstruction(' AUTONUM \\* alphabetic ')?.numFmt).toBe('lowerLetter');
    expect(parseAutonumInstruction(' AUTONUM \\* roman ')?.numFmt).toBe('lowerRoman');
    expect(parseAutonumInstruction(' AUTONUM \\* ROMAN ')?.numFmt).toBe('upperRoman');
    expect(parseAutonumInstruction(' AUTONUM \\* Arabic ')?.numFmt).toBe('decimal');
  });

  test('anything outside the grammar fails closed', () => {
    expect(parseAutonumInstruction(' AUTONUM \\s 2 ')).toBeNull();
    expect(parseAutonumInstruction(' AUTONUM \\* Upper ')).toBeNull();
    expect(parseAutonumInstruction(' AUTONUM \\* ')).toBeNull();
    expect(parseAutonumInstruction(' AUTONUMBER ')).toBeNull();
    expect(parseAutonumInstruction(' SEQ list ')).toBeNull();
  });
});

describe('AUTONUM-family fields synthesize sequential numbers in layout', () => {
  test('the sampled legal-template shape paints A, B, C', () => {
    const layout = layoutOf(
      autonumParagraph(' AUTONUMLGL \\* ALPHABETIC \\e ', 'first annex') +
        autonumParagraph(' AUTONUMLGL \\* ALPHABETIC \\e ', 'second annex') +
        autonumParagraph(' AUTONUMLGL \\* ALPHABETIC \\e ', 'third annex')
    );
    expect(textsOf(layout)).toEqual(['A first annex', 'B second annex', 'C third annex']);
  });

  test('plain AUTONUM paints the decimal number with its trailing period', () => {
    const layout = layoutOf(
      autonumParagraph(' AUTONUM ', 'one') + autonumParagraph(' AUTONUM ', 'two')
    );
    expect(textsOf(layout)).toEqual(['1. one', '2. two']);
  });

  test('each kind counts independently', () => {
    const layout = layoutOf(
      autonumParagraph(' AUTONUM ', 'a') +
        autonumParagraph(' AUTONUMLGL ', 'b') +
        autonumParagraph(' AUTONUM ', 'c')
    );
    expect(textsOf(layout)).toEqual(['1. a', '1. b', '2. c']);
  });

  test('an unsupported switch paints nothing, the historical rendering', () => {
    const layout = layoutOf(autonumParagraph(' AUTONUM \\s 2 ', 'tail'));
    expect(textsOf(layout)).toEqual(['tail']);
  });

  test('a simple AUTONUM field synthesizes the same way', () => {
    const layout = layoutOf(
      `<w:p><w:fldSimple w:instr=" AUTONUM "/><w:r><w:t xml:space="preserve"> via fldSimple</w:t></w:r></w:p>`
    );
    expect(textsOf(layout)).toEqual(['1. via fldSimple']);
  });

  test('a revision-hidden field does not advance the counter in the resolved views', () => {
    // A `w:del`-wrapped field does not exist in the proposed view: Word after accepting the
    // deletion renumbers the survivors, so the third field must paint 2., not 3. The
    // all-markup view keeps every field and numbers straight through.
    const body =
      autonumParagraph(' AUTONUM ', 'first') +
      `<w:p><w:del w:id="9" w:author="a">${autonumField(' AUTONUM ')}</w:del>` +
      `<w:r><w:t xml:space="preserve"> second</w:t></w:r></w:p>` +
      autonumParagraph(' AUTONUM ', 'third');
    const proposed = layoutSemanticDocument(load(body), 1, {
      measurer,
      displayMode: 'proposed',
    });
    expect(textsOf(proposed)).toEqual(['1. first', 'second', '2. third']);
    const allMarkup = layoutSemanticDocument(load(body), 1, {
      measurer,
      displayMode: 'all-markup',
    });
    expect(textsOf(allMarkup)).toEqual(['1. first', '2. second', '3. third']);
  });

  test('a REF number switch resolves against a bookmarked AUTONUM paragraph', () => {
    const layout = layoutOf(
      `<w:p><w:bookmarkStart w:id="1" w:name="annexB"/>` +
        `${autonumField(' AUTONUMLGL \\* ALPHABETIC \\e ')}` +
        `<w:r><w:t xml:space="preserve"> target</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>` +
        autonumParagraph(' AUTONUMLGL \\* ALPHABETIC \\e ', 'second') +
        `<w:p><w:r><w:t xml:space="preserve">see </w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        `<w:r><w:instrText> REF annexB \\n \\h </w:instrText></w:r>` +
        `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`
    );
    expect(textsOf(layout)).toContain('see A');
  });
});

/**
 * Replace the body's block list while keeping every surviving node BY IDENTITY — the shape a
 * `TreeDocumentStore` commit publishes (the same helper `field-ref-layout.test.ts` uses).
 */
function withBlocks(
  part: OoxmlPart,
  edit: (blocks: readonly OoxmlElement[]) => readonly OoxmlElement[]
): OoxmlPart {
  const body = part.root.children.find(
    (child): child is OoxmlElement => child.kind !== 'textValue' && child.localName === 'body'
  )!;
  const blocks = body.children.filter(
    (child): child is OoxmlElement => child.kind === 'paragraph' || child.kind === 'table'
  );
  const edited = edit(blocks);
  const nextChildren = [
    ...edited,
    ...body.children.filter(
      (child) =>
        child.kind === 'textValue' || (child.kind !== 'paragraph' && child.kind !== 'table')
    ),
  ];
  const nextBody = { ...body, children: nextChildren } as OoxmlElement;
  const nextRoot = {
    ...part.root,
    children: part.root.children.map((child) => (child === body ? nextBody : child)),
  } as OoxmlElement;
  return { ...part, root: nextRoot };
}

describe('a document-order edit renumbers later AUTONUM fields incrementally', () => {
  test('the warm session pass equals the cold oracle after removing the first field', () => {
    const before = load(
      autonumParagraph(' AUTONUM ', 'gone soon') +
        autonumParagraph(' AUTONUM ', 'stays') +
        autonumParagraph(' AUTONUM ', 'tail')
    );
    const options = {
      measurer,
      session: createLayoutSession(),
      cache: createParagraphLayoutCache(),
    };
    const first = layoutSemanticDocument(before, 1, options);
    expect(textsOf(first)).toEqual(['1. gone soon', '2. stays', '3. tail']);

    const after = withBlocks(before, (blocks) => blocks.slice(1));
    const warm = layoutSemanticDocument(after, 2, options);
    const oracle = layoutSemanticDocument(after, 1, { measurer });
    expect(textsOf(warm)).toEqual(textsOf(oracle));
    expect(textsOf(warm)).toEqual(['1. stays', '2. tail']);
  });
});
