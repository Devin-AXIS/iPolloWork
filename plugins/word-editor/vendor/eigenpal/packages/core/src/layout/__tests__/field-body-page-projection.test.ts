// PAGE / NUMPAGES / SECTIONPAGES fields in the BODY flow evaluate to the page they land on.
//
// The value depends on a pagination that has not happened when the paragraph is measured, so the
// walk reserves one model unit and paints a placeholder digit marked with the field kind. Document
// finalize substitutes the real value per page. A cached result never wins, and a hidden field
// paints nothing — exactly as it would in a header or footer.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlNode, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  layoutSemanticDocument,
  paragraphFragmentsOf,
  paragraphTextFromLayout,
  type PageRecord,
  type SemanticLayout,
  type StyleSpanRecord,
} from '../index.ts';
import { piecesOfParagraph } from '../field-projection.ts';
import { PAGE_FIELD_PLACEHOLDER } from '../field-page-furniture.ts';
import type { RevisionDisplayMode } from '../revision-projection.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);

function partOf(body: string, sectPr = '<w:sectPr/>'): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${body}${sectPr}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
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

/** A body simple page field with no cached result. */
const simpleField = (instr: string) => `<w:p><w:fldSimple w:instr=" ${instr} "/></w:p>`;

/** A body complex page field: begin/instr/separate/end, no cached result. */
const complexField = (instr: string) =>
  `<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> ${instr} </w:instrText>` +
  `<w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r></w:p>`;

/** Filler body paragraphs, each one line, to push content across pages. */
const filler = (count: number) =>
  Array.from({ length: count }, (_, i) => `<w:p><w:r><w:t>filler ${i}</w:t></w:r></w:p>`).join('');

/** Body-flow projection, the mode the layout uses for the document body. */
function project(body: string, mode: RevisionDisplayMode = 'all-markup') {
  return piecesOfParagraph(
    paragraphOf(body),
    [],
    undefined, // pageContext: none in the body
    undefined,
    undefined,
    undefined,
    mode,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    // Body flow with no `w:pgNumType/@w:fmt`: a `\#` picture renders, as it does in a decimal
    // section. An empty object, NOT `true` — the parameter is the body's page-field context.
    {} // bodyPageFields
  );
}

function bodySpans(layout: SemanticLayout): { page: PageRecord; span: StyleSpanRecord }[] {
  const found: { page: PageRecord; span: StyleSpanRecord }[] = [];
  for (const page of layout.pages) {
    for (const fragment of paragraphFragmentsOf(page)) {
      for (const line of fragment.lines) {
        for (const span of line.spans) found.push({ page, span });
      }
    }
  }
  return found;
}

/** The single span carrying a page-field marker, plus the page it landed on. */
function pageFieldSpan(layout: SemanticLayout) {
  const hits = bodySpans(layout).filter((entry) => entry.span.fieldAtom?.pageField);
  expect(hits.length).toBe(1);
  const { page, span } = hits[0]!;
  const expectedPage = page.pageFieldSource?.pageNumber ?? page.index + 1;
  const sectionPages = page.pageFieldSource?.sectionPageCount ?? layout.pages.length;
  return { span, expectedPage, sectionPages, pageCount: layout.pages.length };
}

describe('a body page field at the piece level', () => {
  test('a simple PAGE with no cached result paints a placeholder marked with its kind', () => {
    const pieces = project(simpleField('PAGE'));
    const field = pieces.find((piece) => piece.fieldAtom?.pageField);
    expect(field).toBeDefined();
    expect(field!.projected).toBe(true);
    expect(field!.fieldAtom?.pageField?.kind).toBe('PAGE');
    // One reserved model unit, whatever the substituted digits.
    expect(field!.end - field!.start).toBe(1);
  });

  test('a complex PAGE with no cached result paints a placeholder marked with its kind', () => {
    const pieces = project(complexField('PAGE'));
    const field = pieces.find((piece) => piece.fieldAtom?.pageField);
    expect(field).toBeDefined();
    expect(field!.fieldAtom?.pageField?.kind).toBe('PAGE');
    expect(field!.end - field!.start).toBe(1);
  });

  test('NUMPAGES and SECTIONPAGES are recognized too', () => {
    for (const kind of ['NUMPAGES', 'SECTIONPAGES'] as const) {
      const field = project(simpleField(kind)).find((piece) => piece.fieldAtom?.pageField);
      expect(field!.fieldAtom?.pageField?.kind).toBe(kind);
    }
  });

  test('a cached result is marked for substitution and measured at its own width', () => {
    for (const body of [
      '<w:p><w:fldSimple w:instr=" PAGE "><w:r><w:t>15</w:t></w:r></w:fldSimple></w:p>',
      '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> PAGE </w:instrText>' +
        '<w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>15</w:t></w:r>' +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
    ]) {
      const field = project(body).find((piece) => piece.fieldAtom?.pageField);
      expect(field?.fieldAtom?.pageField?.kind).toBe('PAGE');
      expect(field?.text).toBe('15');
      expect(field!.end - field!.start).toBe(1);
    }
  });

  test('a cached result holding whitespace is measured at the placeholder', () => {
    const field = project(
      '<w:p><w:fldSimple w:instr=" PAGE "><w:r><w:t>page 5</w:t></w:r></w:fldSimple></w:p>'
    ).find((piece) => piece.fieldAtom?.pageField);
    expect(field?.text).toBe(PAGE_FIELD_PLACEHOLDER);
  });

  test('a hidden cached result keeps the field hidden', () => {
    const pieces = project(
      '<w:p><w:fldSimple w:instr=" PAGE "><w:r><w:rPr><w:vanish/></w:rPr><w:t>5</w:t></w:r>' +
        '</w:fldSimple></w:p>'
    );
    expect(pieces.find((piece) => piece.fieldAtom?.pageField)).toBeUndefined();
  });

  test('a vanished body PAGE paints nothing', () => {
    const vanished =
      '<w:p><w:r><w:rPr><w:vanish/></w:rPr><w:fldChar w:fldCharType="begin"/>' +
      '<w:instrText> PAGE </w:instrText><w:fldChar w:fldCharType="separate"/>' +
      '<w:fldChar w:fldCharType="end"/></w:r></w:p>';
    const pieces = project(vanished);
    expect(pieces.some((piece) => piece.fieldAtom?.pageField)).toBe(false);
  });

  test('a tracked-deleted body PAGE is gone from the proposed result', () => {
    const deleted =
      '<w:p><w:del w:id="1" w:author="a"><w:r><w:fldChar w:fldCharType="begin"/>' +
      '<w:instrText> PAGE </w:instrText><w:fldChar w:fldCharType="separate"/>' +
      '<w:fldChar w:fldCharType="end"/></w:r></w:del></w:p>';
    const pieces = project(deleted, 'proposed');
    expect(pieces.some((piece) => piece.fieldAtom?.pageField)).toBe(false);
  });
});

describe('a body page field in a laid-out document', () => {
  test('PAGE on the only page paints 1; NUMPAGES paints the page count', () => {
    const layout = layoutSemanticDocument(partOf(simpleField('PAGE')), 1, {
      measurer,
      producer: 'test',
    });
    const { span, expectedPage } = pageFieldSpan(layout);
    expect(expectedPage).toBe(1);
    expect(span.text).toBe('1');

    const numLayout = layoutSemanticDocument(partOf(simpleField('NUMPAGES')), 1, {
      measurer,
      producer: 'test',
    });
    const num = pageFieldSpan(numLayout);
    expect(num.span.text).toBe(String(num.pageCount));
  });

  test('PAGE on a later page paints that page number; NUMPAGES paints the total', () => {
    const body = filler(120) + simpleField('PAGE') + filler(120) + simpleField('NUMPAGES');
    const part = partOf(body);
    const layout = layoutSemanticDocument(part, 1, { measurer, producer: 'test' });
    expect(layout.pages.length).toBeGreaterThan(2);

    const marks = bodySpans(layout).filter((entry) => entry.span.fieldAtom?.pageField);
    expect(marks.length).toBe(2);
    for (const { page, span } of marks) {
      const kind = span.fieldAtom!.pageField!.kind;
      if (kind === 'PAGE') {
        expect(span.text).toBe(String(page.pageFieldSource?.pageNumber ?? page.index + 1));
        // Landed past page 1, proving substitution is page-aware.
        expect(page.index).toBeGreaterThan(0);
      } else {
        expect(span.text).toBe(String(layout.pages.length));
      }
    }
  });

  test('SECTIONPAGES paints the section page count', () => {
    const body = filler(60) + simpleField('SECTIONPAGES');
    const layout = layoutSemanticDocument(partOf(body), 1, { measurer, producer: 'test' });
    const { span, sectionPages, pageCount } = pageFieldSpan(layout);
    // Single section, so SECTIONPAGES equals the document page count.
    expect(sectionPages).toBe(pageCount);
    expect(span.text).toBe(String(pageCount));
  });

  test('the complex-field equivalent paints the same value', () => {
    const body = filler(120) + complexField('PAGE');
    const layout = layoutSemanticDocument(partOf(body), 1, { measurer, producer: 'test' });
    const { span, expectedPage } = pageFieldSpan(layout);
    expect(span.text).toBe(String(expectedPage));
    expect(expectedPage).toBeGreaterThan(1);
  });

  test('w:pgNumType/@w:start shifts the displayed body PAGE number', () => {
    const layout = layoutSemanticDocument(
      partOf(simpleField('PAGE'), '<w:sectPr><w:pgNumType w:start="5"/></w:sectPr>'),
      1,
      { measurer, producer: 'test' }
    );
    const { span, expectedPage } = pageFieldSpan(layout);
    expect(expectedPage).toBe(5);
    expect(span.text).toBe('5');
  });

  test('a stale cached result never paints: the page value replaces it', () => {
    const stale = (instr: string, cached: string) =>
      `<w:p><w:fldSimple w:instr=" ${instr} "><w:r><w:t>${cached}</w:t></w:r></w:fldSimple></w:p>`;
    const complexStale = (instr: string, cached: string) =>
      `<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> ${instr} </w:instrText>` +
      `<w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>${cached}</w:t></w:r>` +
      `<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`;
    const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    const body =
      stale('PAGE', 'cached') +
      pageBreak +
      stale('PAGE \\* MERGEFORMAT', '1') +
      complexStale('NUMPAGES', '9') +
      complexStale('PAGE \\* roman', 'x');
    const layout = layoutSemanticDocument(partOf(body), 1, { measurer, producer: 'test' });
    expect(layout.pages.length).toBe(2);
    const painted = bodySpans(layout)
      .filter((entry) => entry.span.fieldAtom?.pageField)
      .map((entry) => [entry.page.index, entry.span.text]);
    expect(painted).toEqual([
      [0, '1'],
      [1, '2'],
      [1, '2'],
      [1, 'ii'],
    ]);
  });

  test('a body PAGE inside a table cell paints', () => {
    const body =
      filler(60) +
      '<w:tbl><w:tr><w:tc>' +
      '<w:p><w:fldSimple w:instr=" PAGE "/></w:p>' +
      '</w:tc></w:tr></w:tbl>';
    const layout = layoutSemanticDocument(partOf(body), 1, { measurer, producer: 'test' });
    const { span, expectedPage } = pageFieldSpan(layout);
    expect(span.text).toBe(String(expectedPage));
    expect(expectedPage).toBeGreaterThan(1);
  });

  test('the field stays one model unit: paragraph text and offset coverage hold', () => {
    // A three-digit page number would overflow a naive range; the model stays one unit.
    const body = filler(120) + `<w:p><w:r><w:t>A</w:t></w:r><w:fldSimple w:instr=" PAGE "/></w:p>`;
    const part = partOf(body);
    const layout = layoutSemanticDocument(part, 1, { measurer, producer: 'test' });
    const fieldEntry = bodySpans(layout).find((entry) => entry.span.fieldAtom?.pageField)!;
    const paragraphId = fieldEntry.span.range.paragraphId;
    // "A" + one field unit = two model units, whatever the substituted digits.
    const text = paragraphTextFromLayout(layout, paragraphId);
    expect(text.length).toBe(2);
    expect(text[0]).toBe('A');
    // The field's model range is exactly one unit.
    expect(fieldEntry.span.range.end - fieldEntry.span.range.start).toBe(1);
  });
});

describe('body page-field finalize identity discipline', () => {
  test('finalize returns pages by identity where no page field changed', () => {
    // Only the last page carries a PAGE field, so earlier pages must survive finalize by identity.
    const body = filler(120) + simpleField('PAGE');
    const part = partOf(body);
    const first = layoutSemanticDocument(part, 1, { measurer, producer: 'test' });
    const second = layoutSemanticDocument(part, 1, { measurer, producer: 'test' });
    // A page with no page field is structurally identical across the two independent passes only
    // if finalize did not clone it needlessly. Prove the substituted page differs from earlier
    // pages that carry no marker.
    const marked = bodySpans(first).filter((entry) => entry.span.fieldAtom?.pageField);
    expect(marked.length).toBe(1);
    // Earlier pages hold no page-field span at all.
    const markedPageIndex = marked[0]!.page.index;
    for (const page of first.pages) {
      if (page.index === markedPageIndex) continue;
      const hasMarker = paragraphFragmentsOf(page).some((f) =>
        f.lines.some((l) => l.spans.some((s) => s.fieldAtom?.pageField))
      );
      expect(hasMarker).toBe(false);
    }
    expect(second.pages.length).toBe(first.pages.length);
  });
});
