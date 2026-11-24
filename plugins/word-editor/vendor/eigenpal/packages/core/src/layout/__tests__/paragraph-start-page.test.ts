// The page a paragraph starts on, when the paragraph opens with a page break.
//
// The break lays out as its own fragment at the end of the previous page and the text starts
// on the next one. Page references name the page of the text, so a heading that opens with a
// page break is listed on the page where it is painted.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { paragraphFragmentsOf, type PageGeometry, type SemanticLayout } from '../index.ts';
import {
  isBreakOnlyFragment,
  leadingBreakTextStarts,
  paragraphStartPages,
  pastLeadingBreaks,
} from '../paragraph-start-page.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);
const GEOMETRY: PageGeometry = {
  width: 200,
  height: 100,
  margin: { top: 10, right: 10, bottom: 10, left: 10 },
};

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const layoutOf = (body: string): SemanticLayout =>
  layoutSemanticDocument(load(body), 1, { measurer, geometry: GEOMETRY });

const PAGE_BREAK = '<w:r><w:br w:type="page"/></w:r>';
const text = (value: string) => `<w:r><w:t xml:space="preserve">${value}</w:t></w:r>`;
const paragraph = (runs: string) => `<w:p>${runs}</w:p>`;
const bookmarked = (runs: string) =>
  `<w:p><w:bookmarkStart w:id="1" w:name="target"/>${runs}<w:bookmarkEnd w:id="1"/></w:p>`;

/** Page index (0-based) on which each body paragraph starts, in document order. */
function startPageIndexes(layout: SemanticLayout): number[] {
  const ids = [
    ...new Set(
      layout.pages.flatMap((page) => paragraphFragmentsOf(page).map((f) => f.paragraphId))
    ),
  ];
  const starts = paragraphStartPages(layout.pages, new Set(ids));
  return ids.map((id) => starts.get(id)!.index);
}

const textsOf = (layout: SemanticLayout): string[] =>
  layout.pages.flatMap((page) =>
    paragraphFragmentsOf(page).map((fragment) =>
      fragment.lines
        .flatMap((line) => line.spans.map((span) => span.text))
        .join('')
        .trim()
    )
  );

describe('paragraphStartPages', () => {
  test('a paragraph that opens with a page break starts on the page of its text', () => {
    const layout = layoutOf(paragraph(text('First')) + paragraph(PAGE_BREAK + text('Second')));
    expect(layout.pages).toHaveLength(2);
    const fragments = layout.pages.flatMap((page) => paragraphFragmentsOf(page));
    // The break fragment sits on page 1 and holds no text.
    expect(fragments.map((fragment) => isBreakOnlyFragment(fragment))).toEqual([
      false,
      true,
      false,
    ]);
    expect(startPageIndexes(layout)).toEqual([0, 1]);
  });

  test('a page break and its text in one run start on the page of the text', () => {
    // The editor writes this shape when Ctrl+Enter splits a run before the heading text.
    const layout = layoutOf(
      paragraph(text('First')) + paragraph('<w:r><w:br w:type="page"/><w:t>Second</w:t></w:r>')
    );
    expect(startPageIndexes(layout)).toEqual([0, 1]);
  });

  test('a space before the break is content, as it is for pagination', () => {
    const layout = layoutOf(
      paragraph(text('First')) + paragraph(text(' ') + PAGE_BREAK + text('Second'))
    );
    expect(startPageIndexes(layout)).toEqual([0, 0]);
  });

  test('a paragraph with text before its page break starts on the page of that text', () => {
    const layout = layoutOf(
      paragraph(text('First')) + paragraph(text('Before') + PAGE_BREAK + text('After'))
    );
    expect(layout.pages).toHaveLength(2);
    expect(startPageIndexes(layout)).toEqual([0, 0]);
  });

  test('a paragraph made only of a page break keeps the page of its first fragment', () => {
    const layout = layoutOf(
      paragraph(text('First')) + paragraph(PAGE_BREAK) + paragraph(text('Last'))
    );
    expect(startPageIndexes(layout)).toEqual([0, 0, 1]);
  });

  test('an unwanted paragraph is not reported', () => {
    const layout = layoutOf(paragraph(text('First')));
    expect(paragraphStartPages(layout.pages, new Set(['missing'])).size).toBe(0);
  });

  test('a column break in a one-column section moves the start like a page break', () => {
    const layout = layoutOf(
      paragraph(text('First')) + paragraph('<w:r><w:br w:type="column"/></w:r>' + text('Second'))
    );
    expect(layout.pages).toHaveLength(2);
    expect(startPageIndexes(layout)).toEqual([0, 1]);
  });

  test('a line break before the text is content, not a leading break', () => {
    const layout = layoutOf(paragraph('<w:r><w:br/></w:r>' + text('Second')));
    expect(leadingBreakTextStarts(layout.pages).size).toBe(0);
  });

  test('the text-start index is built once per page list', () => {
    const layout = layoutOf(paragraph(text('First')) + paragraph(PAGE_BREAK + text('Second')));
    const starts = leadingBreakTextStarts(layout.pages);
    expect([...starts.values()]).toEqual([{ fragmentIndex: 1, offset: 1 }]);
    expect(leadingBreakTextStarts(layout.pages)).toBe(starts);
  });
});

describe('pastLeadingBreaks', () => {
  const lastParagraphId = (layout: SemanticLayout) =>
    paragraphFragmentsOf(layout.pages.at(-1)!).at(-1)!.paragraphId;

  test('moves a position before a leading page break to the start of the text', () => {
    const layout = layoutOf(paragraph(text('First')) + paragraph(PAGE_BREAK + text('Second')));
    const paragraphId = lastParagraphId(layout);
    expect(pastLeadingBreaks(layout.pages, { paragraphId, offset: 0 })).toEqual({
      paragraphId,
      offset: 1,
    });
    // A position already in the text stays where it is.
    expect(pastLeadingBreaks(layout.pages, { paragraphId, offset: 3 })).toEqual({
      paragraphId,
      offset: 3,
    });
  });

  test('keeps a position in a paragraph without a leading break', () => {
    const layout = layoutOf(paragraph(text('Only')));
    const paragraphId = lastParagraphId(layout);
    expect(pastLeadingBreaks(layout.pages, { paragraphId, offset: 0 })).toEqual({
      paragraphId,
      offset: 0,
    });
  });
});

describe('PAGEREF to a paragraph that opens with a page break', () => {
  const pageRef = (cached: string) =>
    paragraph(
      text('page ') +
        '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
        '<w:r><w:instrText> PAGEREF target \\h </w:instrText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
        (cached ? text(cached) : '') +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r>'
    );

  test('an empty cache paints the page of the target text', () => {
    const layout = layoutOf(pageRef('') + bookmarked(PAGE_BREAK + text('Target')));
    expect(layout.pages).toHaveLength(2);
    expect(textsOf(layout)).toContain('page 2');
  });

  test('a cache that names the page of the target text stays live', () => {
    const layout = layoutOf(pageRef('2') + bookmarked(PAGE_BREAK + text('Target')));
    expect(textsOf(layout)).toContain('page 2');
  });
});
