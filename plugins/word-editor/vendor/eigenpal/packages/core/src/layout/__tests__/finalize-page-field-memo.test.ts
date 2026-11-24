// `finalizePageFieldProjection` is memoized per (immutable page record, page count).
//
// Contract under test:
//   1. A memo hit returns the identical finalized record — two finalize passes over the SAME
//      page records may not mint fresh projections (that is the incremental-pass cost the memo
//      removes), and finalize over its own output is identity per page.
//   2. A memo hit returns exactly what a recompute would — a finalize of structurally identical
//      records that share nothing by identity deep-equals the memoized result.
//   3. The page count is part of the key: the same page records under a different total must
//      re-project, and flipping back must re-project again (one overwritten memo entry cannot
//      keep answering for the other count).
//
// Pages with a live `pageFieldProjector` are pre-finalize records, which `layoutSemanticDocument`
// never publishes — so the first three tests assemble them the way furniture attach does: a body
// layout's pages plus a footer story record whose projector re-lays the story per context. The
// last test drives the same memo through the public pipeline: one session, a field-bearing
// footer, and an edit that changes the page count.

import { describe, expect, test } from 'bun:test';
import { documentOrder } from '../document-order.ts';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
  type PageFurniture,
  type PageRecord,
  type SemanticLayout,
} from '../index.ts';
import {
  carryStrippedPageFieldProjection,
  finalizePageFieldProjection,
} from '../field-projection.ts';
import {
  completeFurniture,
  pageFurnitureStale,
  withFurnitureLater,
  strippedStoryProjections,
} from '../published-story-projections.ts';
import {
  paragraphLinesFor,
  paragraphLinesIndex,
  paragraphLinesPageTraversals,
} from '../paragraph-lines.ts';
import { paragraphFragmentsOf } from '../semantic-records.ts';
import { layoutHeaderFooterStory, type HeaderFooterStoryLayout } from '../hf-layout.ts';
import type { HeaderFooterStoryRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);
/** Section content width in points: 6000 − 200 − 200 twips. */
const CONTENT_WIDTH = 280;

/** Tight page geometry so a handful of one-line paragraphs already spills across pages. */
const tightSectPr =
  `<w:sectPr><w:pgSz w:w="6000" w:h="2400"/>` +
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

const filler = (count: number, tag = 'f') =>
  Array.from({ length: count }, (_, i) => `<w:p><w:r><w:t>${tag} ${i}</w:t></w:r></w:p>`).join('');

/** Footer part carrying both PAGE and NUMPAGES so every finalize pass has real work. */
function footerPart(): OoxmlPart {
  const field = (instr: string) =>
    `<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>${instr}</w:instrText>` +
    `<w:fldChar w:fldCharType="separate"/><w:t>0</w:t><w:fldChar w:fldCharType="end"/></w:r>`;
  const result = readOoxmlPart(
    `<w:ftr xmlns:w="${W}"><w:p><w:r><w:t xml:space="preserve">Page </w:t></w:r>${field('PAGE')}` +
      `<w:r><w:t xml:space="preserve"> of </w:t></w:r>${field('NUMPAGES')}</w:p></w:ftr>`,
    { name: '/word/footer1.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

/**
 * A pre-finalize footer record: fragments from the baseline story plus the projector furniture
 * attach would install (the same shape `furnitureFor` in `semantic-layout.ts` builds).
 */
function fieldFooterRecord(part: OoxmlPart): HeaderFooterStoryRecord {
  const story = layoutHeaderFooterStory(part, CONTENT_WIDTH, measurer, 'test');
  const place = (laid: HeaderFooterStoryLayout): HeaderFooterStoryRecord => ({
    kind: 'footer',
    variant: 'default',
    partName: laid.partName,
    box: { x: 10, y: 100, width: CONTENT_WIDTH, height: laid.flowHeight },
    fragments: laid.fragments,
  });
  return {
    ...place(story),
    pageFieldProjector: (context) => place(story.withPageContext(context)),
  };
}

function footerText(layout: SemanticLayout, pageIndex: number): string {
  const story = layout.pages[pageIndex]!.footer;
  if (!story) return '';
  return story.fragments
    .flatMap((fragment) =>
      fragment.kind === 'paragraph'
        ? fragment.lines.flatMap((line) => line.spans.map((span) => span.text))
        : []
    )
    .join('');
}

const lay = (part: OoxmlPart, revision: number, session?: ReturnType<typeof createLayoutSession>) =>
  layoutSemanticDocument(part, revision, {
    measurer,
    producer: 'test',
    ...(session ? { session } : {}),
  });

/** Multi-page body pages wearing one pre-finalize field footer each — the finalize input. */
function unfinalizedLayoutOf(
  base: SemanticLayout,
  footer: HeaderFooterStoryRecord
): SemanticLayout {
  return { revision: base.revision, pages: base.pages.map((page) => ({ ...page, footer })) };
}

describe('finalizePageFieldProjection memo', () => {
  test('preserves evolving layout metadata while replacing finalized pages', () => {
    const base = lay(partOf(filler(20) + tightSectPr), 1);
    const tagged: SemanticLayout = {
      ...unfinalizedLayoutOf(base, fieldFooterRecord(footerPart())),
      displayMode: 'proposed',
      controlContextToken: 'metadata-sentinel',
    };

    const finalized = finalizePageFieldProjection(tagged);
    expect(finalized).not.toBe(tagged);
    expect(finalized.displayMode).toBe('proposed');
    expect(finalized.controlContextToken).toBe('metadata-sentinel');
  });

  test('a second finalize over the same page records returns the identical pages', () => {
    const base = lay(partOf(filler(20) + tightSectPr), 1);
    const total = base.pages.length;
    expect(total).toBeGreaterThan(2);
    const unfinalized = unfinalizedLayoutOf(base, fieldFooterRecord(footerPart()));

    const first = finalizePageFieldProjection(unfinalized);
    // The projection really ran: every sheet shows its own PAGE and the shared NUMPAGES.
    expect(footerText(first, 0)).toBe(`Page 1 of ${total}`);
    expect(footerText(first, total - 1)).toBe(`Page ${total} of ${total}`);
    // Projected records lost their projector; the inputs still carry theirs.
    expect(first.pages[0]!.footer?.pageFieldProjector).toBeUndefined();
    expect(unfinalized.pages[0]!.footer?.pageFieldProjector).toBeDefined();

    // The memo hit: without it every projector-bearing page mints a fresh record per pass.
    const second = finalizePageFieldProjection(unfinalized);
    first.pages.forEach((page, index) => expect(second.pages[index]).toBe(page));

    // Finalize over its own output is identity per page (already-final records memo to
    // themselves), which is what lets an incremental pass keep reused sheets stable.
    const third = finalizePageFieldProjection(first);
    first.pages.forEach((page, index) => expect(third.pages[index]).toBe(page));
  });

  test('a memo hit deep-equals a finalize of structurally identical fresh records', () => {
    const bodyXml = filler(20) + tightSectPr;
    const part = partOf(bodyXml);
    const footer = footerPart();
    const unfinalized = unfinalizedLayoutOf(lay(part, 1), fieldFooterRecord(footer));

    const memoized = finalizePageFieldProjection(unfinalized);
    // Warm the memo, then read through it a second time — THIS is the result under suspicion.
    const throughMemo = finalizePageFieldProjection(unfinalized);
    memoized.pages.forEach((page, index) => expect(throughMemo.pages[index]).toBe(page));

    // The clean pass: structuredClone keeps every id and value but shares no object identity,
    // so nothing the WeakMap memoized can leak into it (same discipline as the randomized
    // store-driven oracle).
    const fresh = finalizePageFieldProjection(
      unfinalizedLayoutOf(lay(structuredClone(part), 1), fieldFooterRecord(structuredClone(footer)))
    );
    expect(fresh.pages.length).toBe(throughMemo.pages.length);
    fresh.pages.forEach((page, index) => expect(page).not.toBe(throughMemo.pages[index]));
    expect(JSON.stringify(throughMemo.pages)).toBe(JSON.stringify(fresh.pages));
  });

  test('the same page records under a different page count re-project, both ways', () => {
    const base = lay(partOf(filler(20) + tightSectPr), 1);
    const total = base.pages.length;
    const unfinalized = unfinalizedLayoutOf(base, fieldFooterRecord(footerPart()));

    // Memoize every page under `total`.
    const first = finalizePageFieldProjection(unfinalized);
    expect(footerText(first, 0)).toBe(`Page 1 of ${total}`);

    // The SAME page records plus one extra sheet: sharing records across layouts of different
    // lengths is constructible directly, so this is the strongest form of the invalidation
    // assertion — a memo keyed on the record alone would keep answering `total`. The clone
    // carries its own field source; finalize reads PAGE from it, not from `index`.
    const extra: PageRecord = {
      ...unfinalized.pages[total - 1]!,
      index: total,
      pageFieldSource: { pageNumber: total + 1, sectionPageCount: total + 1 },
    };
    const grown = finalizePageFieldProjection({
      revision: 2,
      pages: [...unfinalized.pages, extra],
    });
    expect(footerText(grown, 0)).toBe(`Page 1 of ${total + 1}`);
    expect(footerText(grown, total)).toBe(`Page ${total + 1} of ${total + 1}`);
    expect(grown.pages[0]).not.toBe(first.pages[0]);

    // Back to the original length: the memo now holds `total + 1` for these records, so it
    // must re-validate and re-project rather than serve the overwritten entry.
    const shrunk = finalizePageFieldProjection(unfinalized);
    expect(footerText(shrunk, 0)).toBe(`Page 1 of ${total}`);
    expect(footerText(shrunk, total - 1)).toBe(`Page ${total} of ${total}`);
  });

  test('a provisional finalize keeps the furniture a prefix laid out; the full finalize projects', () => {
    const base = lay(partOf(filler(20) + tightSectPr), 1);
    const total = base.pages.length;
    const unfinalized = unfinalizedLayoutOf(base, fieldFooterRecord(footerPart()));
    // A prefix of the open keeps the furniture its own pass laid out: projecting it again under
    // every prefix's page count laid each footer out once per prefix.
    const prefix = finalizePageFieldProjection(
      { revision: 1, pages: unfinalized.pages.slice(0, 2) },
      { provisional: true }
    );
    expect(prefix.pages[0]!.footer).toBe(unfinalized.pages[0]!.footer);
    const grown = finalizePageFieldProjection(unfinalized, { provisional: true });
    expect(grown.pages[total - 1]!.footer).toBe(unfinalized.pages[total - 1]!.footer);

    // The full pass that ends the open projects every page under the real count.
    const full = finalizePageFieldProjection(grown);
    for (let index = 0; index < total; index += 1) {
      expect(footerText(full, index)).toBe(`Page ${index + 1} of ${total}`);
    }
  });

  test('through the pipeline: a page-count edit updates NUMPAGES on an unchanged sheet', () => {
    // Two sections, because that is the path where reused sheets still carry projectors at
    // finalize time: the multi-section publish re-finalizes every pass, so a memo entry taken
    // under the old total is what would serve the stale value here. (A single-section resume
    // reuses already-finalized records, whose retained projectors the next describe covers.)
    const furniture: PageFurniture = {
      titlePage: false,
      evenAndOddHeaders: false,
      headers: new Map(),
      footers: new Map([
        ['default', layoutHeaderFooterStory(footerPart(), CONTENT_WIDTH, measurer, 'test')],
      ]),
    };
    const session = createLayoutSession();
    const build = (tail: number) =>
      partOf(
        filler(12, 's0') +
          `<w:p><w:pPr>${tightSectPr}</w:pPr><w:r><w:t>s0 end</w:t></w:r></w:p>` +
          filler(tail, 's1') +
          tightSectPr
      );
    const options = { measurer, session, sectionFurniture: [furniture, furniture] };

    const first = layoutSemanticDocument(build(6), 1, options);
    const firstTotal = first.pages.length;
    expect(firstTotal).toBeGreaterThan(2);
    expect(footerText(first, 0)).toBe(`Page 1 of ${firstTotal}`);

    // Grow section 1: section 0's sheets are untouched, so a memo that ignored the page count
    // would keep serving the stale total on them.
    const second = layoutSemanticDocument(build(26), 2, options);
    expect(second.pages.length).toBeGreaterThan(firstTotal);
    expect(footerText(second, 0)).toBe(`Page 1 of ${second.pages.length}`);

    // A count-stable pass returns the previous pages by identity — the memo hit path.
    const third = layoutSemanticDocument(build(26), 3, options);
    expect(third.pages.length).toBe(second.pages.length);
    third.pages.forEach((page, index) => expect(page).toBe(second.pages[index]!));
    expect(footerText(third, 0)).toBe(`Page 1 of ${third.pages.length}`);
  });
});

describe('single-section incremental reuse re-projects furniture page fields (#441)', () => {
  test('a reused sheet updates NUMPAGES when the page count moves, and holds identity when it does not', () => {
    // Single section, one session. The first pass finalizes and STRIPS every footer's
    // projector; a later pass reuses the finished sheets whole. Without the retained
    // projector, the reused footer kept the first pass's `of Y` text forever.
    const furniture: PageFurniture = {
      titlePage: false,
      evenAndOddHeaders: false,
      headers: new Map(),
      footers: new Map([
        ['default', layoutHeaderFooterStory(footerPart(), CONTENT_WIDTH, measurer, 'test')],
      ]),
    };
    const session = createLayoutSession();
    const build = (count: number) => partOf(filler(count) + tightSectPr);
    const options = { measurer, producer: 'test', session, furniture };

    const first = layoutSemanticDocument(build(18), 1, options);
    const firstTotal = first.pages.length;
    expect(firstTotal).toBeGreaterThan(2);
    expect(footerText(first, 0)).toBe(`Page 1 of ${firstTotal}`);

    // Grow the tail: page 1's flow is untouched, so the resume path carries its finished
    // sheet over by reference — the reuse under suspicion.
    const second = layoutSemanticDocument(build(40), 2, options);
    const secondTotal = second.pages.length;
    expect(secondTotal).toBeGreaterThan(firstTotal);
    expect(session.stats.reusedPages).toBeGreaterThan(0);
    expect(footerText(second, 0)).toBe(`Page 1 of ${secondTotal}`);
    expect(footerText(second, secondTotal - 1)).toBe(`Page ${secondTotal} of ${secondTotal}`);

    // A no-change pass keeps every sheet by identity: the retained projection context still
    // holds, so re-finalize must not mint fresh footers.
    const third = layoutSemanticDocument(build(40), 3, options);
    expect(third.pages.length).toBe(secondTotal);
    third.pages.forEach((page, index) => expect(page).toBe(second.pages[index]!));

    // Shrink back: the same reused sheets re-project down as well.
    const fourth = layoutSemanticDocument(build(18), 4, options);
    expect(fourth.pages.length).toBe(firstTotal);
    expect(footerText(fourth, 0)).toBe(`Page 1 of ${firstTotal}`);
  });

  test('a carried (remap-shifted) published story re-projects at its shifted origin', () => {
    const base = lay(partOf(filler(20) + tightSectPr), 1);
    const total = base.pages.length;
    const unfinalized = unfinalizedLayoutOf(base, fieldFooterRecord(footerPart()));
    const first = finalizePageFieldProjection(unfinalized);
    const published = first.pages[1]!.footer!;

    // What `remapPage` does to a reused published sheet: mint a Y-shifted furniture twin and
    // carry the retained projection onto it, `dy` sheets of stack away.
    const dy = 120;
    const shifted: typeof published = {
      ...published,
      box: { ...published.box, y: published.box.y + dy },
    };
    carryStrippedPageFieldProjection(published, shifted, dy);
    const withShifted = {
      revision: 2,
      pages: first.pages.map((page, index) => (index === 1 ? { ...page, footer: shifted } : page)),
    };

    // Unmoved context: the carried entry keeps the shifted record by identity.
    const held = finalizePageFieldProjection(withShifted);
    expect(held.pages[1]!.footer).toBe(shifted);

    // Moved page count: the carried projector re-projects the text AND lands the box at the
    // SHIFTED origin, not the minting pass's pre-shift one.
    const extra: PageRecord = {
      ...unfinalized.pages[total - 1]!,
      index: total,
      pageFieldSource: { pageNumber: total + 1, sectionPageCount: total + 1 },
    };
    const grown = finalizePageFieldProjection({ revision: 3, pages: [...held.pages, extra] });
    expect(footerText(grown, 1)).toBe(`Page 2 of ${total + 1}`);
    expect(grown.pages[1]!.footer!.box.y).toBe(published.box.y + dy);
  });
});

describe('headers and footers an edit leaves for later', () => {
  test('keep their numbers until completed, and the next pass takes the completed ones', () => {
    const furniture: PageFurniture = {
      titlePage: false,
      evenAndOddHeaders: false,
      headers: new Map(),
      footers: new Map([
        ['default', layoutHeaderFooterStory(footerPart(), CONTENT_WIDTH, measurer, 'test')],
      ]),
    };
    const session = createLayoutSession();
    const build = (count: number) => partOf(filler(count) + tightSectPr);
    const options = { measurer, producer: 'test', session, furniture };
    const first = layoutSemanticDocument(build(30), 1, options);
    const firstTotal = first.pages.length;
    expect(firstTotal).toBeGreaterThan(3);

    // Only page 0 is near the screen.
    const second = withFurnitureLater(
      (index) => index > 0,
      () => layoutSemanticDocument(build(60), 2, options)
    );
    const total = second.pages.length;
    expect(total).toBeGreaterThan(firstTotal);
    expect(footerText(second, 0)).toBe(`Page 1 of ${total}`);
    // A reused sheet away from the screen still shows the total it was projected under.
    expect(footerText(second, 1)).toBe(`Page 2 of ${firstTotal}`);
    expect(pageFurnitureStale(second.pages[1]!, total)).toBe(true);

    const completed = completeFurniture(second);
    completed.pages.forEach((page, index) => {
      expect(footerText(completed, index)).toBe(`Page ${index + 1} of ${total}`);
      expect(pageFurnitureStale(page, total)).toBe(false);
    });
    expect(completeFurniture(completed)).toBe(completed);

    // The session still holds the stale records; the next pass takes the completed stories.
    const third = layoutSemanticDocument(build(60), 3, options);
    third.pages.forEach((_, index) =>
      expect(footerText(third, index)).toBe(`Page ${index + 1} of ${total}`)
    );
    expect(third.pages[1]!.footer).toBe(completed.pages[1]!.footer);
  });

  test('over several sections too, where every sheet arrives with its projector', () => {
    const furniture: PageFurniture = {
      titlePage: false,
      evenAndOddHeaders: false,
      headers: new Map(),
      footers: new Map([
        ['default', layoutHeaderFooterStory(footerPart(), CONTENT_WIDTH, measurer, 'test')],
      ]),
    };
    const session = createLayoutSession();
    const build = (tail: number) =>
      partOf(
        filler(12, 's0') +
          `<w:p><w:pPr>${tightSectPr}</w:pPr><w:r><w:t>s0 end</w:t></w:r></w:p>` +
          filler(tail, 's1') +
          tightSectPr
      );
    const options = { measurer, session, sectionFurniture: [furniture, furniture] };
    const firstTotal = layoutSemanticDocument(build(6), 1, options).pages.length;

    const second = withFurnitureLater(
      (index) => index > 0,
      () => layoutSemanticDocument(build(26), 2, options)
    );
    const total = second.pages.length;
    expect(total).toBeGreaterThan(firstTotal);
    expect(footerText(second, 0)).toBe(`Page 1 of ${total}`);
    expect(second.pages.slice(1).some((page) => pageFurnitureStale(page, total))).toBe(true);
    expect(second.pages.every((page) => !page.footer?.pageFieldProjector)).toBe(true);

    const completed = completeFurniture(second);
    completed.pages.forEach((_, index) =>
      expect(footerText(completed, index)).toBe(`Page ${index + 1} of ${total}`)
    );
    // The next pass at the same count serves every completed story without projecting again.
    const third = layoutSemanticDocument(build(26), 3, options);
    third.pages.forEach((page, index) => {
      expect(footerText(third, index)).toBe(`Page ${index + 1} of ${total}`);
      expect(page.footer).toBe(completed.pages[index]!.footer);
    });
  });
});

test('completed footer projections retain body caret routes without retaining old lines', () => {
  const furniture: PageFurniture = {
    titlePage: false,
    evenAndOddHeaders: false,
    headers: new Map(),
    footers: new Map([
      ['default', layoutHeaderFooterStory(footerPart(), CONTENT_WIDTH, measurer, 'test')],
    ]),
  };
  const session = createLayoutSession();
  const options = { measurer, producer: 'test', session, furniture };
  layoutSemanticDocument(partOf(filler(30) + tightSectPr), 1, options);
  const before = withFurnitureLater(
    () => true,
    () => layoutSemanticDocument(partOf(filler(60) + tightSectPr), 2, options)
  );
  const id = paragraphFragmentsOf(before.pages.at(-1)!)[0]!.paragraphId;
  paragraphLinesFor(before, id);
  const order = documentOrder(before);
  let lineReads = 0;
  const observed = before.pages
    .flatMap((page) => paragraphFragmentsOf(page))
    .map((fragment) => {
      const descriptor = Object.getOwnPropertyDescriptor(fragment, 'lines')!;
      Object.defineProperty(fragment, 'lines', {
        configurable: true,
        enumerable: true,
        get() {
          lineReads++;
          return descriptor.value;
        },
      });
      return { fragment, descriptor };
    });
  let after: typeof before;
  try {
    after = completeFurniture(before);
    expect(documentOrder(after)).toBe(order);
    expect(lineReads).toBe(0);
  } finally {
    for (const { fragment, descriptor } of observed)
      Object.defineProperty(fragment, 'lines', descriptor);
  }
  expect(after).not.toBe(before);
  const visits = paragraphLinesPageTraversals();
  const lines = paragraphLinesFor(after, id);
  expect(paragraphLinesPageTraversals() - visits).toBe(1);
  expect(lines).toEqual(paragraphLinesIndex({ ...after }).get(id));
});

test('a footer projector that moves paragraph membership invalidates caret routes', () => {
  const base = fieldFooterRecord(footerPart());
  const renamed = (id: string): HeaderFooterStoryRecord => ({
    ...base,
    fragments: base.fragments.map((block) => {
      if (block.kind !== 'paragraph') throw Error('Expected paragraph');
      return {
        ...block,
        paragraphId: id,
        range: { ...block.range, paragraphId: id },
        lines: block.lines.map((line) => ({
          ...line,
          range: { ...line.range, paragraphId: id },
          spans: line.spans.map((span) => ({ ...span, range: { ...span.range, paragraphId: id } })),
        })),
      };
    }),
  });
  const a = renamed('footer-a');
  const b = renamed('footer-b');
  const context = { pageNumber: -1, pageCount: -1 };
  strippedStoryProjections.set(a, { context, dy: 0, projector: () => b });
  strippedStoryProjections.set(b, { context, dy: 0, projector: () => a });
  const body = layoutSemanticDocument(partOf(filler(60) + tightSectPr), 1, { measurer });
  expect(body.pages.length).toBeGreaterThan(2);
  const before = {
    ...body,
    pages: body.pages.map((page, index) => ({
      ...page,
      footer: index === 0 ? a : index === 1 ? b : undefined,
    })),
  };
  expect(paragraphLinesFor(before, 'footer-a')[0]!.pageIndex).toBe(0);
  const after = completeFurniture(before);
  expect(paragraphLinesFor(after, 'footer-a')[0]!.pageIndex).toBe(1);
  expect(paragraphLinesFor(after, 'footer-a')).toEqual(
    paragraphLinesIndex({ ...after }).get('footer-a')
  );
});

test('body order first read after footer completion reaches the retained body', () => {
  const furniture: PageFurniture = {
    titlePage: false,
    evenAndOddHeaders: false,
    headers: new Map(),
    footers: new Map([
      ['default', layoutHeaderFooterStory(footerPart(), CONTENT_WIDTH, measurer, 'test')],
    ]),
  };
  const session = createLayoutSession();
  const options = { measurer, producer: 'test', session, furniture };
  layoutSemanticDocument(partOf(filler(30) + tightSectPr), 1, options);
  const retained = withFurnitureLater(
    () => true,
    () => layoutSemanticDocument(partOf(filler(60) + tightSectPr), 2, options)
  );
  const completed = completeFurniture(retained);
  expect(completed).not.toBe(retained);
  const order = documentOrder(completed);
  let reads = 0;
  const observed = retained.pages
    .flatMap((page) => paragraphFragmentsOf(page))
    .map((fragment) => {
      const descriptor = Object.getOwnPropertyDescriptor(fragment, 'lines')!;
      Object.defineProperty(fragment, 'lines', {
        configurable: true,
        enumerable: true,
        get() {
          reads++;
          return descriptor.value;
        },
      });
      return { fragment, descriptor };
    });
  try {
    expect(documentOrder(retained)).toBe(order);
    expect(reads).toBe(0);
  } finally {
    for (const { fragment, descriptor } of observed)
      Object.defineProperty(fragment, 'lines', descriptor);
  }
  const changed = {
    ...retained,
    pages: retained.pages.map((page) => ({
      ...page,
      fragments: [...page.fragments].reverse(),
    })),
  };
  const expected = [
    ...new Set(
      changed.pages.flatMap((page) =>
        paragraphFragmentsOf(page).map((fragment) => fragment.paragraphId)
      )
    ),
  ];
  expect(documentOrder(changed)).toEqual(expected);
  expect(documentOrder(changed)).not.toEqual(order);
});
