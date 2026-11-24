// A numbered paragraph that opens with a page break keeps its list marker with its text. The
// break line stays behind on the page it starts on; the marker and the first-line slot move to
// the first line after the break, which opens the next sheet.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';
import { caretAt } from '../semantic-interaction.ts';
import { markerHolding } from '../line-segments.ts';
import { breakParagraph } from '../paragraph-flow.ts';
import { buildNumberingIndex } from '../numbering-index.ts';
import type { ParagraphFragmentRecord, SemanticLayout } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

// numId 1: marker in a 18pt hanging slot, text at 36pt. numId 2: no indent, so the text
// starts at the tab stop after the marker; only the first-line slot puts it there.
const numbering = readOoxmlPart(
  `<w:numbering xmlns:w="${W}">` +
    '<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/>' +
    '<w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>' +
    '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>' +
    '<w:abstractNum w:abstractNumId="2"><w:lvl w:ilvl="0"><w:start w:val="1"/>' +
    '<w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>' +
    '<w:pPr><w:ind w:left="0" w:firstLine="0"/></w:pPr></w:lvl></w:abstractNum>' +
    '<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>' +
    '<w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num></w:numbering>',
  { name: '/word/numbering.xml', contentType: 'app/xml' }
);
if (!numbering.ok) throw new Error(numbering.reason);
const numberingIndex = buildNumberingIndex(numbering.part.root);

const measurer = createFixedMeasurer(6, 14);
const lay = (part: OoxmlPart, session?: ReturnType<typeof createLayoutSession>) =>
  layoutSemanticDocument(part, 1, { measurer, numberingIndex, ...(session ? { session } : {}) });

// 200pt wide, 310pt tall sheets with 10pt margins: a 290pt content box holds fourteen 20pt
// lines and leaves 10pt, less than one more line.
const sect =
  '<w:sectPr><w:pgSz w:w="4000" w:h="6200"/>' +
  '<w:pgMar w:top="200" w:right="200" w:bottom="200" w:left="200" ' +
  'w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>';
const exact = '<w:spacing w:before="0" w:after="0" w:line="400" w:lineRule="exact"/>';
const numPr = (numId: number) =>
  `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr>`;

const paragraph = (text: string, pPr = exact) =>
  `<w:p><w:pPr>${pPr}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const fill = (count: number) =>
  Array.from({ length: count }, (_, line) => paragraph(`line${line}`)).join('');
const br = '<w:r><w:br w:type="page"/></w:r>';
/** A numbered paragraph: `breaks` page breaks, then `text`. */
const numbered = (text: string, breaks = 1, numId = 1, extra = '') =>
  `<w:p><w:pPr>${numPr(numId)}${extra}${exact}</w:pPr>${br.repeat(breaks)}` +
  (text ? `<w:r><w:t>${text}</w:t></w:r>` : '') +
  '</w:p>';

const paragraphsOn = (layout: SemanticLayout, page: number): ParagraphFragmentRecord[] =>
  layout.pages[page]!.fragments.filter(
    (fragment): fragment is ParagraphFragmentRecord => fragment.kind === 'paragraph'
  );
const textOf = (fragment: ParagraphFragmentRecord): string =>
  fragment.lines
    .flatMap((line) => line.spans.map((span) => span.text))
    .join('')
    .replace(/[^\w ]/g, '');
const pageTexts = (layout: SemanticLayout): string[] =>
  layout.pages.map((_, page) =>
    paragraphsOn(layout, page)
      .map(textOf)
      .filter((text) => text !== '')
      .join(' ')
  );
/** Each page's list markers, in order. */
const pageMarkers = (layout: SemanticLayout): string[][] =>
  layout.pages.map((_, page) =>
    paragraphsOn(layout, page).flatMap((fragment) =>
      fragment.marker ? [fragment.marker.text] : []
    )
  );
const lastFill = (count: number) =>
  Array.from({ length: count }, (_, line) => `line${line}`).join(' ');
/** Every placed fragment of the paragraph at a top-level body position (`#0.0.N`). */
const fragmentsAt = (layout: SemanticLayout, position: number) =>
  layout.pages.flatMap((_, page) =>
    paragraphsOn(layout, page)
      .filter((fragment) => fragment.paragraphId.endsWith(`#0.0.${position}`))
      .map((fragment) => ({ fragment, page }))
  );
const firstTextX = (fragment: ParagraphFragmentRecord): number =>
  fragment.lines[0]!.spans.find((span) => /\w/.test(span.text))!.box.x;

describe('a numbered paragraph that opens with a page break', () => {
  test('keeps its marker with its text when the page before is full', () => {
    const layout = lay(load(fill(14) + numbered('heading') + paragraph('body') + sect));
    expect(pageTexts(layout)).toEqual([lastFill(14), 'heading body']);
    expect(pageMarkers(layout)).toEqual([[], ['1.']]);
    const [breakLine, text] = fragmentsAt(layout, 14);
    expect(breakLine!.page).toBe(0);
    expect(breakLine!.fragment.outOfFlow).toBe(true);
    expect(breakLine!.fragment.marker).toBeUndefined();
    expect(text!.page).toBe(1);
    const marker = text!.fragment.marker!;
    const line = text!.fragment.lines[0]!;
    expect(line.box.y).toBe(0);
    expect(marker.box.y).toBe(line.box.y);
    // The marker keeps its slot left of the text.
    expect(marker.box.x + marker.box.width).toBeLessThanOrEqual(firstTextX(text!.fragment));
  });

  test('keeps its marker with its text when the break line fits', () => {
    const layout = lay(load(fill(13) + numbered('heading') + sect));
    expect(pageTexts(layout)).toEqual([lastFill(13), 'heading']);
    expect(pageMarkers(layout)).toEqual([[], ['1.']]);
    const [breakLine] = fragmentsAt(layout, 13);
    expect(breakLine!.page).toBe(0);
    expect(breakLine!.fragment.outOfFlow).toBeUndefined();
  });

  test('numbers the next item after the break without a gap', () => {
    const layout = lay(
      load(numbered('one', 0) + fill(13) + numbered('two') + numbered('three', 0) + sect)
    );
    expect(pageTexts(layout)).toEqual([`one ${lastFill(13)}`, 'two three']);
    expect(pageMarkers(layout)).toEqual([['1.'], ['2.', '3.']]);
  });

  test('places the text where the first-line slot puts it', () => {
    // Without a hanging indent, the text follows the marker at the next tab stop. The
    // continuation indent would put it at the left edge, under the marker.
    for (const count of [13, 14]) {
      const plain = lay(load(fill(count) + numbered('heading', 0, 2) + sect));
      const broken = lay(load(fill(count) + numbered('heading', 1, 2) + sect));
      const expected = fragmentsAt(plain, count)[0]!.fragment;
      const text = fragmentsAt(broken, count)[1]!.fragment;
      expect(firstTextX(text)).toBe(firstTextX(expected));
      expect(firstTextX(text)).toBeGreaterThan(0);
      expect(text.marker!.box).toEqual({
        ...expected.marker!.box,
        y: text.lines[0]!.box.y,
      });
    }
  });

  test('keeps authored repeated breaks as an empty sheet', () => {
    const layout = lay(load(fill(14) + numbered('heading', 2) + sect));
    expect(pageTexts(layout)).toEqual([lastFill(14), '', 'heading']);
    expect(pageMarkers(layout)).toEqual([[], [], ['1.']]);
  });

  test('keeps the empty sheet of a break that opens the document', () => {
    const layout = lay(load(numbered('heading') + paragraph('body') + sect));
    expect(pageTexts(layout)).toEqual(['', 'heading body']);
    expect(pageMarkers(layout)).toEqual([[], ['1.']]);
  });

  test('keeps the empty sheet of a break at the top of a page', () => {
    const layout = lay(load(fill(3) + `<w:p>${br}</w:p>` + numbered('heading') + sect));
    expect(pageTexts(layout)).toEqual([lastFill(3), '', 'heading']);
    expect(pageMarkers(layout)).toEqual([[], [], ['1.']]);
  });

  test('keeps the marker on the break line when nothing follows it', () => {
    const layout = lay(load(fill(3) + numbered('') + paragraph('after') + sect));
    expect(pageTexts(layout)).toEqual([lastFill(3), 'after']);
    expect(pageMarkers(layout)).toEqual([['1.'], []]);
  });

  test('keeps the marker with its text under keepNext', () => {
    const keep = '<w:keepNext/><w:keepLines/>';
    const layout = lay(
      load(
        fill(14) + numbered('heading', 1, 1, keep) + paragraph('body') + paragraph('more') + sect
      )
    );
    expect(pageTexts(layout)).toEqual([lastFill(14), 'heading body more']);
    expect(pageMarkers(layout)).toEqual([[], ['1.']]);
  });

  test('keeps its marker with its text when the paragraph is shaded', () => {
    const shading = '<w:shd w:val="clear" w:color="auto" w:fill="D9D9D9"/>';
    const layout = lay(load(fill(14) + numbered('heading', 1, 1, shading) + sect));
    expect(pageTexts(layout)).toEqual([lastFill(14), 'heading']);
    expect(pageMarkers(layout)).toEqual([[], ['1.']]);
  });

  test('moves with a floating table it anchors, and keeps the marker with its text', () => {
    const floatingTable =
      '<w:tbl><w:tblPr><w:tblpPr w:vertAnchor="text" w:horzAnchor="margin" w:tblpX="0" ' +
      'w:tblpY="0"/><w:tblW w:type="dxa" w:w="1000"/></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid>' +
      ['r0', 'r1'].map((text) => `<w:tr><w:tc>${paragraph(text)}</w:tc></w:tr>`).join('') +
      '</w:tbl>';
    const layout = lay(load(fill(14) + floatingTable + numbered('heading') + sect));
    expect(pageTexts(layout)).toEqual([lastFill(14), '', 'heading']);
    expect(pageMarkers(layout)).toEqual([[], [], ['1.']]);
  });

  test('resolves the marker and the caret on the page of the text', () => {
    const layout = lay(load(fill(14) + numbered('heading') + sect));
    const paragraphId = fragmentsAt(layout, 14)[0]!.fragment.paragraphId;
    expect(markerHolding(layout, paragraphId)?.text).toBe('1.');
    expect(caretAt(layout, { paragraphId, offset: 0 })?.pageIndex).toBe(0);
    expect(caretAt(layout, { paragraphId, offset: 1 })?.pageIndex).toBe(1);
  });

  test('lays out the same through a retained session', () => {
    const part = load(fill(14) + numbered('heading') + fill(3) + sect);
    const session = createLayoutSession();
    const first = lay(part, session);
    const again = lay(part, session);
    expect(again.pages).toEqual(first.pages);
    expect(first.pages).toEqual(lay(part).pages);
  });
});

describe('the first-line slot after leading page breaks', () => {
  const part = (breaks: number, pPr = '') =>
    load(`<w:p><w:pPr>${pPr}</w:pPr>${br.repeat(breaks)}<w:r><w:t>text</w:t></w:r></w:p>`);
  const paragraphOf = (source: OoxmlPart) =>
    source.root.children[0]!.children.find((child) => child.kind === 'paragraph')!;
  const slot = { firstLineOffset: 24, firstLineMarkerAscent: 30 };
  const breakAt = (breaks: number, startOffset: number, carry: boolean) =>
    breakParagraph(
      paragraphOf(part(breaks)),
      'p',
      0,
      180,
      measurer,
      undefined,
      null,
      [],
      undefined,
      undefined,
      undefined,
      {
        ...slot,
        startOffset,
        ...(carry ? { firstLineAfterLeadingBreaks: true } : {}),
      }
    );

  test('passes to the first line that holds content', () => {
    const lines = breakAt(3, 0, true);
    expect(lines.map((line) => line.firstLineOffset)).toEqual([24, 24, 24, 24]);
    expect(lines[3]!.baseline).toBe(30);
    // An unnumbered paragraph passes the first-line indent on as well.
    expect(breakAt(3, 0, false).map((line) => line.firstLineOffset)).toEqual([24, 24, 24, 24]);
  });

  test('stays with a continuation that only leading breaks precede', () => {
    expect(breakAt(1, 1, true)[0]!.firstLineOffset).toBe(24);
    expect(breakAt(1, 1, false)[0]!.firstLineOffset).toBe(24);
    // A continuation inside the text is never a first line.
    expect(breakAt(1, 3, true)[0]!.firstLineOffset).toBeUndefined();
  });

  test('passes after a leading column break too, also when the text resumes in a column', () => {
    const columnBreak = '<w:r><w:br w:type="column"/></w:r>';
    const source = load(`<w:p>${columnBreak}<w:r><w:t>text</w:t></w:r></w:p>`);
    const paragraph = source.root.children[0]!.children.find(
      (child) => child.kind === 'paragraph'
    )!;
    const lines = (startOffset: number) =>
      breakParagraph(
        paragraph,
        'p',
        0,
        180,
        measurer,
        undefined,
        null,
        [],
        undefined,
        undefined,
        undefined,
        {
          firstLineOffset: 24,
          startOffset,
        }
      );
    expect(lines(0).map((line) => line.firstLineOffset)).toEqual([24, 24]);
    expect(lines(1)[0]!.firstLineOffset).toBe(24);
  });

  test('handles many leading breaks in one pass', () => {
    const lines = breakAt(2000, 0, true);
    expect(lines).toHaveLength(2001);
    expect(lines[2000]!.firstLineOffset).toBe(24);
  });

  test('moves an unnumbered first-line indent to the text after the break', () => {
    const indented = `<w:ind w:firstLine="480"/>${exact}`;
    const layout = lay(
      load(fill(3) + `<w:p><w:pPr>${indented}</w:pPr>${br}<w:r><w:t>after</w:t></w:r></w:p>` + sect)
    );
    const [breakLine, text] = fragmentsAt(layout, 3);
    expect(breakLine!.fragment.lines[0]!.contentX).toBe(24);
    expect(firstTextX(text!.fragment)).toBe(24);
  });
});
