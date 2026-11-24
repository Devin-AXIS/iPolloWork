// A complex PAGE-family field nested inside a complex outer field evaluates per sheet.
//
// `STYLEREF` wrapping `PAGE` is ordinary in a running header. The outer field's cached result
// used to concatenate the inner field's saved digits verbatim, so every sheet painted the
// producer's last saved number — and detection missed the inner field too, so the story's
// page-context key stayed empty and ONE layout served every sheet. Both halves are pinned
// here, mirroring the `w:fldSimple` semantics in `field-simple-result.ts`.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import {
  readOoxmlPackage,
  readOoxmlPart,
  type OoxmlNode,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import {
  detectStoryPageFields,
  MAX_FIELD_INSTRUCTION_CHARS,
  piecesOfParagraph,
} from '../field-projection.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import { createFixedMeasurer } from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

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

const BEGIN = `<w:r><w:fldChar w:fldCharType="begin"/></w:r>`;
const SEPARATE = `<w:r><w:fldChar w:fldCharType="separate"/></w:r>`;
const END = `<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
const instrRun = (instr: string): string =>
  `<w:r><w:instrText xml:space="preserve">${instr}</w:instrText></w:r>`;

/** One complex field: begin / instrText / separate / cached result / end, one run each. */
function complexField(instr: string, cached: string): string {
  return (
    BEGIN +
    instrRun(instr) +
    SEPARATE +
    (cached.length > 0 ? `<w:r><w:t xml:space="preserve">${cached}</w:t></w:r>` : '') +
    END
  );
}

/** The complex-STYLEREF markers around `content`, without the paragraph wrapper. */
function outerMarkers(content: string): string {
  return BEGIN + instrRun(' STYLEREF "Heading 1" ') + SEPARATE + content + END;
}

/** A complex STYLEREF whose cached result holds `content` (runs and nested fields). */
function outerField(content: string): string {
  return `<w:p>${outerMarkers(content)}</w:p>`;
}

const textRun = (text: string): string => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;

const NESTED_PAGE = outerField(textRun('Chapter p. ') + complexField(' PAGE ', '7') + textRun('!'));

describe('a complex PAGE nested inside a complex outer field', () => {
  test('evaluates per sheet inside the outer cached result', () => {
    const paragraph = paragraphOf(NESTED_PAGE);
    const pieces = piecesOfParagraph(paragraph, [], { pageNumber: 3, pageCount: 9 });
    expect(pieces.map((piece) => piece.text)).toEqual(['Chapter p. 3!']);
    // Still one atomic model unit; the inner field donates display text only.
    expect(pieces[0]).toMatchObject({ start: 0, end: 1, projected: true });
    expect(
      piecesOfParagraph(paragraph, [], { pageNumber: 8, pageCount: 9 })
        .map((piece) => piece.text)
        .join('')
    ).toBe('Chapter p. 8!');
  });

  test('without a page context the cached digits stay verbatim', () => {
    expect(
      piecesOfParagraph(paragraphOf(NESTED_PAGE))
        .map((piece) => piece.text)
        .join('')
    ).toBe('Chapter p. 7!');
  });

  test('is detected so the story requests a per-sheet context at all', () => {
    expect(detectStoryPageFields(partOf(NESTED_PAGE).root)).toEqual({
      hasPage: true,
      hasNumPages: false,
      hasSectionPages: false,
    });
  });

  test('inner NUMPAGES and SECTIONPAGES evaluate and are detected', () => {
    const numbers = outerField(
      complexField(' NUMPAGES ', '99') + textRun('/') + complexField(' SECTIONPAGES ', '88')
    );
    expect(
      piecesOfParagraph(paragraphOf(numbers), [], {
        pageNumber: 3,
        pageCount: 26,
        sectionPageCount: 8,
      })
        .map((piece) => piece.text)
        .join('')
    ).toBe('26/8');
    expect(detectStoryPageFields(partOf(numbers).root)).toEqual({
      hasPage: false,
      hasNumPages: true,
      hasSectionPages: true,
    });
  });

  test('an inner non-page field keeps its cached text verbatim', () => {
    const ref = outerField(textRun('see ') + complexField(' REF _Ref9 ', 'Section 4'));
    expect(
      piecesOfParagraph(paragraphOf(ref), [], { pageNumber: 3, pageCount: 9 })
        .map((piece) => piece.text)
        .join('')
    ).toBe('see Section 4');
  });

  test('nesting past MAX_FIELD_NESTING stays inert and verbatim', () => {
    // Levels 1..5: the fifth begin exceeds the cap, the whole outer field demotes, and no
    // level evaluates. The deep PAGE's digits stay ordinary addressable text.
    const depth5 = outerField(
      textRun('A') +
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        `<w:r><w:instrText> REF b </w:instrText></w:r>` +
        `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
        complexField(' PAGE ', '7') +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
        textRun('Z')
    );
    const pieces = piecesOfParagraph(paragraphOf(depth5), [], { pageNumber: 3, pageCount: 9 });
    expect(pieces.map((piece) => piece.text).join('')).toBe('A7Z');
    expect(pieces.every((piece) => !piece.projected)).toBe(true);
    expect(detectStoryPageFields(partOf(depth5).root)).toEqual({
      hasPage: false,
      hasNumPages: false,
      hasSectionPages: false,
    });
  });

  test('an oversize inner instruction leaves that level inert and its sibling live', () => {
    const oversize = ` PAGE ${'X'.repeat(MAX_FIELD_INSTRUCTION_CHARS + 1)} `;
    const mixed = outerField(
      textRun('p. ') + complexField(oversize, '7') + textRun('-') + complexField(' PAGE ', '9')
    );
    expect(
      piecesOfParagraph(paragraphOf(mixed), [], { pageNumber: 3, pageCount: 9 })
        .map((piece) => piece.text)
        .join('')
    ).toBe('p. 7-3');
    expect(detectStoryPageFields(partOf(mixed).root).hasPage).toBe(true);
  });
});

describe('deeper nesting (levels 3 and 4) evaluates at the tracked level', () => {
  // The tracker records the LEVEL whose separate armed it and appends only at that level's
  // matching end. An append gate pinned to level 2 dropped these digits entirely: the inner
  // end fired at level 3, appended nothing, and reset tracking.
  const DEPTH3 = outerField(
    textRun('Ch ') +
      BEGIN +
      instrRun(' REF _Ref9 ') +
      SEPARATE +
      textRun('p. ') +
      complexField(' PAGE ', '7') +
      textRun(' end') +
      END +
      textRun('!')
  );
  const DEPTH4 = outerField(
    BEGIN +
      instrRun(' REF a ') +
      SEPARATE +
      BEGIN +
      instrRun(' REF b ') +
      SEPARATE +
      textRun('p. ') +
      complexField(' PAGE ', '7') +
      END +
      END
  );

  test('a depth-3 PAGE under an inert level-2 REF paints live digits', () => {
    expect(
      piecesOfParagraph(paragraphOf(DEPTH3), [], { pageNumber: 3, pageCount: 9 })
        .map((piece) => piece.text)
        .join('')
    ).toBe('Ch p. 3 end!');
  });

  test('without a page context the depth-3 digits stay verbatim', () => {
    expect(
      piecesOfParagraph(paragraphOf(DEPTH3))
        .map((piece) => piece.text)
        .join('')
    ).toBe('Ch p. 7 end!');
  });

  test('a depth-3 PAGE is detected', () => {
    expect(detectStoryPageFields(partOf(DEPTH3).root).hasPage).toBe(true);
  });

  test('a depth-4 PAGE paints live digits and is detected', () => {
    expect(
      piecesOfParagraph(paragraphOf(DEPTH4), [], { pageNumber: 5, pageCount: 9 })
        .map((piece) => piece.text)
        .join('')
    ).toBe('p. 5');
    expect(detectStoryPageFields(partOf(DEPTH4).root).hasPage).toBe(true);
  });
});

describe('a tracked inner result containing its own begin/end pair', () => {
  // Everything between the tracked PAGE's separate and ITS end — deeper begin/end pairs
  // included — is the replaced result. An unconditional reset at every end cleared tracking
  // at the deeper pair's end, dropped the digits before it and painted the rest verbatim.
  const INNER_PAIR = outerField(
    textRun('p. ') +
      BEGIN +
      instrRun(' PAGE ') +
      SEPARATE +
      textRun('«') +
      BEGIN +
      instrRun(' REF x ') +
      SEPARATE +
      textRun('4') +
      END +
      textRun('»') +
      END +
      textRun('!')
  );

  test('the live value replaces the whole tracked result', () => {
    expect(
      piecesOfParagraph(paragraphOf(INNER_PAIR), [], { pageNumber: 3, pageCount: 9 })
        .map((piece) => piece.text)
        .join('')
    ).toBe('p. 3!');
  });

  test('without a page context the whole cached result stays verbatim', () => {
    expect(
      piecesOfParagraph(paragraphOf(INNER_PAIR))
        .map((piece) => piece.text)
        .join('')
    ).toBe('p. «4»!');
  });
});

describe('a double separate at the tracked level', () => {
  // Malformed but hostile-possible: the second separate answers null (level already
  // separated) and must NOT clear tracking — the matched end still appends the live value.
  const DOUBLE = outerField(
    textRun('p. ') +
      BEGIN +
      instrRun(' PAGE ') +
      SEPARATE +
      textRun('7') +
      SEPARATE +
      textRun('8') +
      END
  );

  test('tracking survives and the end appends the live value', () => {
    expect(
      piecesOfParagraph(paragraphOf(DOUBLE), [], { pageNumber: 3, pageCount: 9 })
        .map((piece) => piece.text)
        .join('')
    ).toBe('p. 3');
  });

  test('without a page context both cached chunks stay verbatim', () => {
    expect(
      piecesOfParagraph(paragraphOf(DOUBLE))
        .map((piece) => piece.text)
        .join('')
    ).toBe('p. 78');
  });
});

describe('a nested PAGE inside the outer INSTRUCTION', () => {
  // `IF « PAGE » = 1 "yes" "no"`: the nested PAGE lives in the outer field's instruction and
  // is never painted, so projection must not evaluate it and detection must not request a
  // per-sheet layout for it.
  const IF_SHAPE =
    `<w:p>` +
    BEGIN +
    instrRun(' IF ') +
    complexField(' PAGE ', '1') +
    instrRun(' = 1 "yes" "no" ') +
    SEPARATE +
    textRun('no') +
    END +
    `</w:p>`;

  test('paints only the outer cached result, with and without a page context', () => {
    expect(
      piecesOfParagraph(paragraphOf(IF_SHAPE), [], { pageNumber: 3, pageCount: 9 })
        .map((piece) => piece.text)
        .join('')
    ).toBe('no');
    expect(
      piecesOfParagraph(paragraphOf(IF_SHAPE))
        .map((piece) => piece.text)
        .join('')
    ).toBe('no');
  });

  test('is NOT detected — projection cannot replace it, so no per-sheet layouts', () => {
    expect(detectStoryPageFields(partOf(IF_SHAPE).root)).toEqual({
      hasPage: false,
      hasNumPages: false,
      hasSectionPages: false,
    });
  });
});

describe('nesting overflow keeps detection aligned with projection', () => {
  const HOSTILE_DEEP =
    textRun('A') +
    BEGIN +
    instrRun(' REF b ') +
    SEPARATE +
    BEGIN +
    SEPARATE +
    BEGIN +
    SEPARATE +
    complexField(' PAGE ', '7') +
    END +
    END +
    END +
    textRun('Z');

  test('a sibling field in the SAME paragraph stays verbatim and undetected (suffix)', () => {
    // The atomic-span parser fails closed for the whole paragraph SUFFIX after hostile
    // nesting, so the sibling demotes and paints its cached digits. Detection agrees, or the
    // story would pay per-sheet layouts for text that never changes.
    const body = `<w:p>${outerMarkers(HOSTILE_DEEP)}${textRun(' | ')}${complexField(' PAGE ', '9')}</w:p>`;
    const pieces = piecesOfParagraph(paragraphOf(body), [], { pageNumber: 3, pageCount: 9 });
    expect(pieces.map((piece) => piece.text).join('')).toBe('A7Z | 9');
    expect(pieces.every((piece) => !piece.projected)).toBe(true);
    expect(detectStoryPageFields(partOf(body).root)).toEqual({
      hasPage: false,
      hasNumPages: false,
      hasSectionPages: false,
    });
  });

  test('a sibling field in the NEXT paragraph is detected and live', () => {
    const body =
      `<w:p>${outerMarkers(HOSTILE_DEEP)}</w:p>` + `<w:p>${complexField(' PAGE ', '9')}</w:p>`;
    const part = partOf(body);
    expect(detectStoryPageFields(part.root)).toEqual({
      hasPage: true,
      hasNumPages: false,
      hasSectionPages: false,
    });
    const paragraphs: OoxmlNode[] = [];
    const gather = (node: OoxmlNode): void => {
      if (node.kind === 'paragraph') {
        paragraphs.push(node);
        return;
      }
      if (node.kind === 'textValue') return;
      for (const child of node.children ?? []) gather(child);
    };
    gather(part.root);
    expect(
      piecesOfParagraph(paragraphs[1]!, [], { pageNumber: 3, pageCount: 9 })
        .map((piece) => piece.text)
        .join('')
    ).toBe('3');
  });

  test('an early nested PAGE before an overflow in the SAME field stays undetected', () => {
    // The level-2 PAGE separates cleanly BEFORE the hostile depth arrives, but the later
    // overflow demotes the whole outer store span, so projection paints the cached digits
    // verbatim. A note taken at separate-time that stood would buy a per-sheet relayout
    // that paints identical text on every sheet; detection buffers notes per outer span
    // and drops them when the span demotes.
    const body = outerField(
      textRun('A') +
        complexField(' PAGE ', '7') +
        BEGIN +
        SEPARATE +
        BEGIN +
        SEPARATE +
        BEGIN +
        SEPARATE +
        BEGIN +
        SEPARATE +
        END +
        END +
        END +
        END +
        textRun('Z')
    );
    const pieces = piecesOfParagraph(paragraphOf(body), [], { pageNumber: 3, pageCount: 9 });
    expect(pieces.map((piece) => piece.text).join('')).toBe('A7Z');
    expect(pieces.every((piece) => !piece.projected)).toBe(true);
    expect(detectStoryPageFields(partOf(body).root)).toEqual({
      hasPage: false,
      hasNumPages: false,
      hasSectionPages: false,
    });
  });

  test('an in-cap PAGE after an overflow in the SAME field stays verbatim and undetected', () => {
    // The overflow demotes the whole outer field, so projection paints the cached digits
    // verbatim. Detection must agree, or every sheet pays a layout for identical text.
    const body = outerField(
      textRun('A') +
        BEGIN +
        SEPARATE +
        BEGIN +
        SEPARATE +
        BEGIN +
        SEPARATE +
        BEGIN +
        SEPARATE +
        END +
        END +
        END +
        END +
        complexField(' PAGE ', '7') +
        textRun('Z')
    );
    const pieces = piecesOfParagraph(paragraphOf(body), [], { pageNumber: 3, pageCount: 9 });
    expect(pieces.map((piece) => piece.text).join('')).toBe('A7Z');
    expect(pieces.every((piece) => !piece.projected)).toBe(true);
    expect(detectStoryPageFields(partOf(body).root)).toEqual({
      hasPage: false,
      hasNumPages: false,
      hasSectionPages: false,
    });
  });
});

describe('a nested field straddling a drawing descend', () => {
  const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
  const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';

  const partWithDrawing = (body: string): OoxmlPart => {
    const result = readOoxmlPart(
      `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:wps="${WPS}">` +
        `<w:body>${body}</w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!result.ok) throw new Error(result.reason);
    return result.part;
  };

  /** Anchored textbox drawing whose story holds `content` (paragraphs). */
  const textboxDrawing = (content: string): string =>
    '<w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0"' +
    ' relativeHeight="1" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="page"><wp:posOffset>3600450</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="page"><wp:posOffset>9000000</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="914400" cy="457200"/>' +
    '<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>' +
    '<wp:docPr id="1" name="TB"/>' +
    `<a:graphic><a:graphicData uri="${WPS}"><wps:wsp>` +
    '<wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>' +
    `<wps:txbx><w:txbxContent>${content}</w:txbxContent></wps:txbx>` +
    '<wps:bodyPr/>' +
    '</wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing>';

  const NUMPAGES_PARA = `<w:p>${complexField(' NUMPAGES ', '99')}</w:p>`;

  // A level-2 PAGE whose instruction is split around a run carrying the drawing: the descend
  // saves the host field state, and the textbox story's paragraph resets must not reach the
  // saved copy. A shallow copy aliased the per-level `inner` captures, so the reset emptied
  // them in the saved state too, the second instruction chunk had no buffer to join, and the
  // nested PAGE went undetected — stale digits on every sheet.
  const STRADDLE = `<w:p>${outerMarkers(
    BEGIN +
      instrRun(' PA') +
      `<w:r>${textboxDrawing(NUMPAGES_PARA)}</w:r>` +
      instrRun('GE ') +
      SEPARATE +
      textRun('7') +
      END
  )}</w:p>`;

  test('keeps the level-2 capture across the descend and detects the textbox field too', () => {
    expect(detectStoryPageFields(partWithDrawing(STRADDLE).root)).toEqual({
      hasPage: true,
      hasNumPages: true,
      hasSectionPages: false,
    });
  });
});

describe('two outer fields in one paragraph, the second nested', () => {
  test('each evaluates independently', () => {
    const body =
      `<w:p>` +
      complexField(' PAGE ', '5') +
      textRun(' of ') +
      outerMarkers(textRun('p. ') + complexField(' PAGE ', '7')) +
      `</w:p>`;
    expect(
      piecesOfParagraph(paragraphOf(body), [], { pageNumber: 3, pageCount: 9 })
        .map((piece) => piece.text)
        .join('')
    ).toBe('3 of p. 3');
  });
});

describe('the skip path donates attribution and links (fldSimple parity with results)', () => {
  const INS_WRAPPED = outerField(
    BEGIN +
      instrRun(' PAGE ') +
      SEPARATE +
      `<w:ins w:id="1" w:author="Reviewer" w:date="2026-08-05T08:12:15Z">` +
      `<w:r><w:t>7</w:t></w:r></w:ins>` +
      END
  );

  test('w:ins-wrapped inner digits attribute the live value as an insertion', () => {
    const pieces = piecesOfParagraph(
      paragraphOf(INS_WRAPPED),
      [],
      { pageNumber: 3, pageCount: 9 },
      undefined,
      undefined,
      undefined,
      'all-markup'
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['3']);
    expect(pieces[0]?.revisions?.map((rev) => `${rev.kind}:${rev.author}`)).toEqual([
      'insert:Reviewer',
    ]);
  });

  test('the ORIGINAL view suppresses the inserted live value entirely', () => {
    const pieces = piecesOfParagraph(
      paragraphOf(INS_WRAPPED),
      [],
      { pageNumber: 3, pageCount: 9 },
      undefined,
      undefined,
      undefined,
      'original'
    );
    expect(pieces.map((piece) => piece.text)).toEqual([]);
  });

  test('w:hyperlink-wrapped inner digits carry the link onto the live value', () => {
    const LINK = Object.freeze({ id: 'stub', kind: 'internal', href: '#top', anchor: 'top' });
    const body = outerField(
      BEGIN +
        instrRun(' PAGE ') +
        SEPARATE +
        `<w:hyperlink w:anchor="top"><w:r><w:t>7</w:t></w:r></w:hyperlink>` +
        END
    );
    const pieces = piecesOfParagraph(
      paragraphOf(body),
      [],
      { pageNumber: 3, pageCount: 9 },
      undefined,
      () => LINK
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['3']);
    expect(pieces[0]?.link).toBe(LINK);
  });
});

describe('the fldSimple lane: a PAGE two machine levels down', () => {
  // A complex REF directly in the `w:fldSimple` cache is machine level 1; the PAGE in ITS
  // cache is level 2. The finish gate used to fire at level 1 only, so the level-2 digits
  // were skipped at the separate and never appended — text loss on every sheet.
  const SIMPLE_DEEP =
    `<w:p><w:fldSimple w:instr=" QUOTE x ">` +
    textRun('p. ') +
    BEGIN +
    instrRun(' REF a ') +
    SEPARATE +
    complexField(' PAGE ', '7') +
    END +
    `</w:fldSimple></w:p>`;

  test('paints live digits with a page context', () => {
    expect(
      piecesOfParagraph(paragraphOf(SIMPLE_DEEP), [], { pageNumber: 3, pageCount: 9 })
        .map((piece) => piece.text)
        .join('')
    ).toBe('p. 3');
  });

  test('stays verbatim without one', () => {
    expect(
      piecesOfParagraph(paragraphOf(SIMPLE_DEEP))
        .map((piece) => piece.text)
        .join('')
    ).toBe('p. 7');
  });

  test('is detected', () => {
    expect(detectStoryPageFields(partOf(SIMPLE_DEEP).root).hasPage).toBe(true);
  });
});

describe('a header/footer story with a complex-nested PAGE', () => {
  const footerPackage = (footerBody: string): Uint8Array =>
    zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/footer" Target="footer1.xml"/></Relationships>`
      ),
      'word/footer1.xml': strToU8(`<w:ftr xmlns:w="${W}">${footerBody}</w:ftr>`),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p>` +
          `<w:sectPr><w:footerReference w:type="default" r:id="rId1"/></w:sectPr>` +
          '</w:body></w:document>'
      ),
    });

  const layoutFooter = (footerBody: string) => {
    const measurer = createFixedMeasurer(6, 14);
    const loaded = readOoxmlPackage(footerPackage(footerBody));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error('package failed to load');
    const footer = [...loaded.package.parts.values()].find((part) =>
      part.name.includes('footer1')
    )!;
    return layoutHeaderFooterStory(footer, 400, measurer, 'test');
  };

  const textOf = (story: ReturnType<typeof layoutFooter>): string =>
    story.fragments
      .flatMap((fragment) =>
        fragment.kind === 'paragraph'
          ? fragment.lines.flatMap((line) => line.spans.map((span) => span.text))
          : []
      )
      .join('');

  test('lays out per-sheet digits end-to-end', () => {
    const baseline = layoutFooter(NESTED_PAGE);
    // Detection must report the nested PAGE, or one layout serves every sheet.
    expect(baseline.pageFieldNeeds).toEqual({
      hasPage: true,
      hasNumPages: false,
      hasSectionPages: false,
    });
    expect(textOf(baseline)).toBe('Chapter p. 7!');
    const page2 = baseline.withPageContext({ pageNumber: 2, pageCount: 26 });
    const page9 = baseline.withPageContext({ pageNumber: 9, pageCount: 26 });
    expect(textOf(page2)).toBe('Chapter p. 2!');
    expect(textOf(page9)).toBe('Chapter p. 9!');
    expect(page9).not.toBe(page2);
    expect(baseline.withPageContext({ pageNumber: 2, pageCount: 26 })).toBe(page2);
  });

  test('a depth-3 PAGE under an inert REF lays out per-sheet digits too', () => {
    const depth3 = outerField(
      textRun('Ch ') +
        BEGIN +
        instrRun(' REF _Ref9 ') +
        SEPARATE +
        textRun('p. ') +
        complexField(' PAGE ', '7') +
        END +
        textRun('!')
    );
    const baseline = layoutFooter(depth3);
    expect(baseline.pageFieldNeeds).toEqual({
      hasPage: true,
      hasNumPages: false,
      hasSectionPages: false,
    });
    expect(textOf(baseline)).toBe('Ch p. 7!');
    expect(textOf(baseline.withPageContext({ pageNumber: 4, pageCount: 26 }))).toBe('Ch p. 4!');
    expect(textOf(baseline.withPageContext({ pageNumber: 11, pageCount: 26 }))).toBe('Ch p. 11!');
  });
});
