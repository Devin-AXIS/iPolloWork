// MACROBUTTON / GOTOBUTTON fields display everything after their first argument.
//
// Word paints the display text and real files carry no cached result for these fields, so
// without synthesis they paint nothing. The macro / jump target is never executed, resolved,
// or navigated — display only. A cached result, when a file does carry one, wins: it is what
// Word last painted.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlNode, type OoxmlPart } from '@docx-editor.dev/core/store';
import { piecesOfParagraph, type HyperlinkProjector } from '../field-projection.ts';
import type { RevisionDisplayMode } from '../revision-projection.ts';
import type { SpanLinkRecord } from '../semantic-records.ts';

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

function project(
  body: string,
  mode: RevisionDisplayMode = 'all-markup',
  projectLink?: HyperlinkProjector
) {
  return piecesOfParagraph(
    paragraphOf(body),
    [],
    undefined,
    undefined,
    projectLink,
    undefined,
    mode
  );
}

/** A complex field around one instruction: begin/instr[/separate + result]/end. */
function complexField(instr: string, result?: string, chromeRpr = ''): string {
  const middle =
    result === undefined
      ? ''
      : `<w:r>${chromeRpr}<w:fldChar w:fldCharType="separate"/></w:r>` + result;
  return (
    `<w:r>${chromeRpr}<w:fldChar w:fldCharType="begin"/></w:r>` +
    `<w:r>${chromeRpr}<w:instrText>${instr}</w:instrText></w:r>` +
    middle +
    `<w:r>${chromeRpr}<w:fldChar w:fldCharType="end"/></w:r>`
  );
}

describe('a complex MACROBUTTON field', () => {
  test('the no-separate shape paints the display text over one atom unit', () => {
    const pieces = project(
      `<w:p><w:r><w:t>A</w:t></w:r>${complexField(' MACROBUTTON DoThing Click Here ')}<w:r><w:t>B</w:t></w:r></w:p>`
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['A', 'Click Here', 'B']);
    const button = pieces[1]!;
    expect(button).toMatchObject({ start: 1, end: 2, projected: true });
    expect(button.fieldAtom).toEqual({ formField: false });
    expect(pieces[2]).toMatchObject({ start: 2, end: 3 });
  });

  test('with a separate and a cached result, the cache wins', () => {
    const pieces = project(
      `<w:p>${complexField(' MACROBUTTON DoThing Click Here ', '<w:r><w:t>Cached</w:t></w:r>')}</w:p>`
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['Cached']);
    expect(pieces[0]).toMatchObject({ start: 0, end: 1, projected: true });
  });

  test('with a separate and an EMPTY result, the display text fills in', () => {
    const pieces = project(
      `<w:p>${complexField(' GOTOBUTTON bookmark3 Go to section 3 ', '')}</w:p>`
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['Go to section 3']);
    expect(pieces[0]).toMatchObject({ start: 0, end: 1, projected: true });
  });

  test('a cached result that exists but is hidden suppresses the display text', () => {
    // The file cached a result and hid it with w:vanish. Painting the display text there
    // would resurrect what the document hides; only a truly EMPTY cache synthesizes.
    const pieces = project(
      `<w:p>${complexField(
        ' MACROBUTTON DoThing Click Here ',
        '<w:r><w:rPr><w:vanish/></w:rPr><w:t>Hidden cache</w:t></w:r>'
      )}<w:r><w:t>B</w:t></w:r></w:p>`
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['B']);
    expect(pieces[0]).toMatchObject({ start: 1, end: 2 });
  });

  test('hidden chrome paints nothing but keeps the unit', () => {
    const pieces = project(
      '<w:p><w:r><w:t>A</w:t></w:r>' +
        complexField(' MACROBUTTON M Click ', undefined, '<w:rPr><w:vanish/></w:rPr>') +
        '<w:r><w:t>B</w:t></w:r></w:p>'
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['A', 'B']);
    expect(pieces[1]).toMatchObject({ start: 2, end: 3 });
  });

  test('a tracked-deleted button is gone from the proposed result', () => {
    const pieces = project(
      `<w:p><w:del w:id="1" w:author="A">${complexField(' MACROBUTTON M Click ')}</w:del></w:p>`,
      'proposed'
    );
    expect(pieces.map((piece) => piece.text)).toEqual([]);
  });

  test('an enclosing w:hyperlink carries its link onto the display text', () => {
    const link: SpanLinkRecord = Object.freeze({
      id: 'enclosing',
      kind: 'external' as const,
      href: 'https://enclosing.example',
    });
    const pieces = project(
      `<w:p><w:hyperlink w:anchor="a">${complexField(' MACROBUTTON M Click ')}</w:hyperlink></w:p>`,
      'all-markup',
      () => link
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['Click']);
    expect(pieces[0]!.link).toBe(link);
  });
});

describe('a simple MACROBUTTON / GOTOBUTTON field', () => {
  test('empty children paint the display text over one model unit', () => {
    const pieces = project(
      '<w:p><w:r><w:t>A</w:t></w:r>' +
        '<w:fldSimple w:instr=" MACROBUTTON DoThing Click Here "></w:fldSimple>' +
        '<w:r><w:t>B</w:t></w:r></w:p>'
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['A', 'Click Here', 'B']);
    const button = pieces[1]!;
    expect(button).toMatchObject({ start: 1, end: 2, projected: true });
    expect(button.fieldAtom).toEqual({ formField: false });
  });

  test('GOTOBUTTON paints the same way and never navigates — no link record', () => {
    const pieces = project(
      '<w:p><w:fldSimple w:instr=" GOTOBUTTON bookmark3 Go there "></w:fldSimple></w:p>'
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['Go there']);
    expect(pieces[0]!.link).toBeUndefined();
  });

  test('a cached child run wins over the synthesized display', () => {
    const pieces = project(
      '<w:p><w:fldSimple w:instr=" MACROBUTTON M Click "><w:r><w:t>Cached</w:t></w:r></w:fldSimple></w:p>'
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['Cached']);
  });

  test('a tracked-deleted simple button is gone from the proposed result', () => {
    const pieces = project(
      '<w:p><w:del w:id="1" w:author="A">' +
        '<w:fldSimple w:instr=" MACROBUTTON M Click "></w:fldSimple></w:del></w:p>',
      'proposed'
    );
    expect(pieces.map((piece) => piece.text)).toEqual([]);
  });

  test('a hidden cached child run suppresses the display text too', () => {
    // Mirrors the complex-field rule: a result that exists but is hidden stays hidden.
    const pieces = project(
      '<w:p><w:fldSimple w:instr=" MACROBUTTON M Click ">' +
        '<w:r><w:rPr><w:vanish/></w:rPr><w:t>Hidden</w:t></w:r></w:fldSimple>' +
        '<w:r><w:t>B</w:t></w:r></w:p>'
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['B']);
    expect(pieces[0]).toMatchObject({ start: 1, end: 2 });
  });
});

describe('a button whose only cached result is wrapped in w:del', () => {
  // The result exists on paper but the PROPOSED view resolves it away — after accepting,
  // Word shows the display text there. Suppressing synthesis painted nothing at all.
  const DEL = '<w:del w:id="1" w:author="A"><w:r><w:delText>Old</w:delText></w:r></w:del>';

  test('complex: the proposed view synthesizes the display text', () => {
    const pieces = project(`<w:p>${complexField(' MACROBUTTON M Click ', DEL)}</w:p>`, 'proposed');
    expect(pieces.map((piece) => piece.text)).toEqual(['Click']);
    expect(pieces[0]).toMatchObject({ start: 0, end: 1, projected: true });
  });

  test('complex: all-markup keeps the cached content, struck', () => {
    const pieces = project(`<w:p>${complexField(' MACROBUTTON M Click ', DEL)}</w:p>`);
    expect(pieces.map((piece) => piece.text)).toEqual(['Old']);
    expect(pieces[0]!.revisions?.map((revision) => revision.kind)).toEqual(['delete']);
  });

  test('complex: the original view keeps the cached content', () => {
    const pieces = project(`<w:p>${complexField(' MACROBUTTON M Click ', DEL)}</w:p>`, 'original');
    expect(pieces.map((piece) => piece.text)).toEqual(['Old']);
  });

  test('simple: the proposed view synthesizes, other views keep the cache', () => {
    const simple = `<w:p><w:fldSimple w:instr=" MACROBUTTON M Click ">${DEL}</w:fldSimple></w:p>`;
    expect(project(simple, 'proposed').map((piece) => piece.text)).toEqual(['Click']);
    expect(project(simple).map((piece) => piece.text)).toEqual(['Old']);
    expect(project(simple, 'original').map((piece) => piece.text)).toEqual(['Old']);
  });

  test('a vanish-hidden result still suppresses synthesis in every mode', () => {
    // Vanish is the case the flag exists for: the file hid the result on purpose, in
    // every view, and painting the display text over it would resurrect it.
    const hidden = '<w:r><w:rPr><w:vanish/></w:rPr><w:t>Hidden</w:t></w:r>';
    for (const mode of ['all-markup', 'proposed', 'original'] as const) {
      const pieces = project(
        `<w:p>${complexField(' MACROBUTTON M Click ', hidden)}<w:r><w:t>B</w:t></w:r></w:p>`,
        mode
      );
      expect(pieces.map((piece) => piece.text)).toEqual(['B']);
    }
  });
});
