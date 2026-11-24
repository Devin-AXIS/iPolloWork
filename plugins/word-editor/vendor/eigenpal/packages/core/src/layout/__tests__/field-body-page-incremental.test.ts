// Body PAGE / NUMPAGES / SECTIONPAGES stay correct across an incremental re-layout and across
// section boundaries.
//
// Two risks the piece-level tests cannot reach:
//   1. A page reused (or re-laid) in the SAME layout session must never serve a STALE substituted
//      number. When an edit changes the page count, a body NUMPAGES must update to the new total,
//      and a body PAGE on a shifted page must update to the new page number. The `hasBodyPageFields`
//      fast-out must not skip a page that carries a page field.
//   2. In a genuine two-section document, section 2's body PAGE shows section 2's restarted number
//      and its SECTIONPAGES shows section 2's own page count, distinct from the document NUMPAGES.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
  paragraphFragmentsOf,
  type LayoutSession,
  type PageRecord,
  type SemanticLayout,
  type StyleSpanRecord,
} from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);

/** Tight page geometry so a handful of one-line paragraphs already spills across pages. */
const tightSectPr = (extra = '') =>
  `<w:sectPr>${extra}<w:pgSz w:w="6000" w:h="2400"/>` +
  `<w:pgMar w:top="200" w:right="200" w:bottom="200" w:left="200" w:header="100" w:footer="100"/>` +
  `</w:sectPr>`;

function partOf(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const simpleField = (instr: string) => `<w:p><w:fldSimple w:instr=" ${instr} "/></w:p>`;

const filler = (count: number, tag = 'f') =>
  Array.from({ length: count }, (_, i) => `<w:p><w:r><w:t>${tag} ${i}</w:t></w:r></w:p>`).join('');

/** Every page-field span on any page, tagged with the page it landed on. */
function pageFieldSpans(layout: SemanticLayout): { page: PageRecord; span: StyleSpanRecord }[] {
  const found: { page: PageRecord; span: StyleSpanRecord }[] = [];
  for (const page of layout.pages) {
    for (const fragment of paragraphFragmentsOf(page)) {
      for (const line of fragment.lines) {
        for (const span of line.spans) {
          if (span.fieldAtom?.pageField) found.push({ page, span });
        }
      }
    }
  }
  return found;
}

const spanOfKind = (layout: SemanticLayout, kind: string) => {
  const hit = pageFieldSpans(layout).find(
    (entry) => entry.span.fieldAtom?.pageField?.kind === kind
  );
  if (!hit) throw new Error(`no ${kind} span`);
  return hit;
};

const lay = (part: OoxmlPart, revision: number, session?: LayoutSession): SemanticLayout =>
  layoutSemanticDocument(part, revision, {
    measurer,
    producer: 'test',
    ...(session ? { session } : {}),
  });

describe('body page fields across an incremental re-layout in one session', () => {
  test('a page-count change updates NUMPAGES and a shifted PAGE, no stale substituted number', () => {
    // NUMPAGES rides page 1 (unchanged fragments across the edit, the reuse-risk case). A PAGE
    // field sits after a block of filler that the edit grows, so it shifts to a later page.
    const build = (before: number): string =>
      simpleField('NUMPAGES') +
      filler(before, 'a') +
      simpleField('PAGE') +
      filler(6, 'b') +
      tightSectPr();

    const session = createLayoutSession();
    const first = lay(partOf(build(18)), 1, session);
    const firstPages = first.pages.length;
    expect(firstPages).toBeGreaterThan(2);
    // Both fields resolved against the first pagination.
    expect(spanOfKind(first, 'NUMPAGES').span.text).toBe(String(firstPages));
    const firstPageField = spanOfKind(first, 'PAGE');
    const firstPageValue =
      firstPageField.page.pageFieldSource?.pageNumber ?? firstPageField.page.index + 1;
    expect(firstPageField.span.text).toBe(String(firstPageValue));

    // Grow the filler BEFORE the PAGE field, in the SAME session: more pages, PAGE lands later.
    const second = lay(partOf(build(42)), 2, session);
    const secondPages = second.pages.length;
    expect(secondPages).toBeGreaterThan(firstPages);

    // NUMPAGES on page 1 reflects the NEW total, not the stale first-pass count.
    expect(spanOfKind(second, 'NUMPAGES').span.text).toBe(String(secondPages));

    // The PAGE field shifted to a later page and shows that page's number.
    const secondPageField = spanOfKind(second, 'PAGE');
    const secondPageValue =
      secondPageField.page.pageFieldSource?.pageNumber ?? secondPageField.page.index + 1;
    expect(secondPageField.span.text).toBe(String(secondPageValue));
    expect(secondPageValue).toBeGreaterThan(firstPageValue);
  });
});

describe('page fields on section pages the edit did not touch', () => {
  // Both tests run TWO sections so the multi-section publish path (and its per-page memo) is
  // the one under test — single-section fixtures never reach it.
  const twoSections = (s1Filler: number, s2Filler: number, mutate?: (body: string) => string) => {
    const body =
      simpleField('SECTIONPAGES') +
      simpleField('NUMPAGES') +
      filler(s1Filler, 's1') +
      `<w:p><w:pPr>${tightSectPr()}</w:pPr><w:r><w:t>s1 end</w:t></w:r></w:p>` +
      filler(s2Filler, 's2') +
      tightSectPr();
    return partOf(mutate ? mutate(body) : body);
  };

  test('SECTIONPAGES on the section first page updates when the section tail grows', () => {
    // The field's own page is untouched by the edit, so its section-local record is reused
    // and the publish memo answers for it — `sectionPageCount` is the one memo-key component
    // nothing else pins, and dropping it left this exact stale value.
    const session = createLayoutSession();
    const first = lay(twoSections(16, 6), 1, session);
    const firstCount = Number(spanOfKind(first, 'SECTIONPAGES').span.text);
    expect(firstCount).toBeGreaterThan(1);

    const second = lay(twoSections(36, 6), 2, session);
    const secondCount = Number(spanOfKind(second, 'SECTIONPAGES').span.text);
    expect(secondCount).toBeGreaterThan(firstCount);
    expect(secondCount).toBe(
      spanOfKind(second, 'SECTIONPAGES').page.pageFieldSource?.sectionPageCount
    );
  });

  test('NUMPAGES on an untouched section updates with the total, and holds identity without it', () => {
    const session = createLayoutSession();
    const first = lay(twoSections(16, 6), 1, session);
    const firstTotal = first.pages.length;
    expect(spanOfKind(first, 'NUMPAGES').span.text).toBe(String(firstTotal));

    // Grow the OTHER section: the NUMPAGES sheet is untouched, but the total moved, so the
    // substituted text must move with it — through a fresh record, or paint never repaints.
    const second = lay(twoSections(16, 26), 2, session);
    expect(second.pages.length).toBeGreaterThan(firstTotal);
    const grown = spanOfKind(second, 'NUMPAGES');
    expect(grown.span.text).toBe(String(second.pages.length));
    expect(grown.page).not.toBe(spanOfKind(first, 'NUMPAGES').page);

    // A count-stable edit in the other section keeps the NUMPAGES sheet by identity.
    const third = lay(
      twoSections(16, 26, (body) => body.replace('s2 3', 's2 3!')),
      3,
      session
    );
    expect(third.pages.length).toBe(second.pages.length);
    const held = spanOfKind(third, 'NUMPAGES');
    expect(held.span.text).toBe(String(third.pages.length));
    expect(held.page).toBe(grown.page);
  });
});

describe('body page fields in a genuine two-section document', () => {
  test('section 2 PAGE restarts and SECTIONPAGES counts section 2, distinct from NUMPAGES', () => {
    // Section 1: enough one-line paragraphs to fill more than one page, ended by a mid-body sectPr.
    const section1 =
      filler(16, 's1') + `<w:p><w:pPr>${tightSectPr()}</w:pPr><w:r><w:t>s1 end</w:t></w:r></w:p>`;
    // Section 2: restarts page numbering at 1, spans multiple pages, and carries both fields.
    const section2 =
      simpleField('PAGE') +
      filler(16, 's2') +
      simpleField('SECTIONPAGES') +
      tightSectPr('<w:pgNumType w:start="1"/>');

    const layout = lay(partOf(section1 + section2), 1);
    const total = layout.pages.length;
    expect(total).toBeGreaterThan(3);

    const pageField = spanOfKind(layout, 'PAGE');
    const restartedNumber = pageField.page.pageFieldSource?.pageNumber ?? pageField.page.index + 1;
    // Restarted: the section-2 PAGE value is BELOW its physical 1-based page index.
    expect(restartedNumber).toBeLessThan(pageField.page.index + 1);
    expect(pageField.span.text).toBe(String(restartedNumber));

    const sectionPagesField = spanOfKind(layout, 'SECTIONPAGES');
    const sectionCount = sectionPagesField.page.pageFieldSource?.sectionPageCount;
    expect(sectionCount).toBeDefined();
    // SECTIONPAGES counts section 2 only, so it is fewer than the document total.
    expect(sectionCount!).toBeLessThan(total);
    expect(sectionPagesField.span.text).toBe(String(sectionCount));
  });
});
