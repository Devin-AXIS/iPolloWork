// Per-section incremental layout: identity reuse, invalidation, and structural work bounds.
//
// Multi-section used to discard the layout session and rebuild every sheet on each edit.
// These tests lock the orchestrator's contract: unchanged sections keep page identity,
// earlier-section repagination remaps later sheets, and incremental shape matches a clean
// pass. Work is asserted with structural counters, never wall-clock timings.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
  type LayoutSession,
  type SemanticLayout,
} from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const measurer = createFixedMeasurer(6, 14);

const paragraph = (text: string, pPr = '') =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;

const sectPr = (extra = '') =>
  `<w:sectPr>${extra}<w:pgSz w:w="6000" w:h="2400"/><w:pgMar w:top="200" w:right="200" w:bottom="200" w:left="200" w:header="100" w:footer="100"/></w:sectPr>`;

/** Two sections, each long enough to span multiple pages under the tight geometry. */
function twoSectionDocument(mutate?: (body: string) => string): string {
  const section0 = Array.from({ length: 12 }, (_, index) =>
    paragraph(`s0p${index} ${'word '.repeat(8)}`, index === 11 ? sectPr() : '')
  ).join('');
  const section1 = Array.from({ length: 12 }, (_, index) =>
    paragraph(`s1p${index} ${'word '.repeat(8)}`)
  ).join('');
  const body =
    section0 +
    section1 +
    `<w:sectPr><w:pgSz w:w="6000" w:h="2400"/><w:pgMar w:top="200" w:right="200" w:bottom="200" w:left="200" w:header="100" w:footer="100"/></w:sectPr>`;
  return mutate ? mutate(body) : body;
}

const lay = (part: OoxmlPart, revision: number, session?: LayoutSession): SemanticLayout =>
  layoutSemanticDocument(part, revision, {
    measurer,
    ...(session ? { session } : {}),
  });

const shapeOf = (layout: SemanticLayout): string =>
  JSON.stringify(
    layout.pages.map((page) => ({
      index: page.index,
      box: page.box,
      fragments: page.fragments.map((fragment) => ({
        id: fragment.id,
        box: fragment.box,
        lines:
          fragment.kind === 'paragraph'
            ? fragment.lines.map((line) => ({ id: line.id, box: line.box, spans: line.spans }))
            : fragment.kind === 'table'
              ? fragment.rows
              : [],
      })),
    }))
  );

describe('multi-section incremental equals a clean pass', () => {
  test('an unchanged multi-section document re-lays out to the identical shape', () => {
    const session = createLayoutSession();
    const part = load(twoSectionDocument());
    const first = lay(part, 1, session);
    expect(first.pages.length).toBeGreaterThan(2);
    const second = lay(part, 2, session);
    expect(shapeOf(second)).toBe(shapeOf(first));
  });

  test('an edit in section 1 matches a full pass', () => {
    const session = createLayoutSession();
    lay(load(twoSectionDocument()), 1, session);
    const edited = load(twoSectionDocument((body) => body.replace('s1p3 ', 's1p3-rewritten ')));
    expect(shapeOf(lay(edited, 2, session))).toBe(shapeOf(lay(edited, 2)));
  });

  test('an edit in section 0 that changes its page count matches a full pass', () => {
    const session = createLayoutSession();
    lay(load(twoSectionDocument()), 1, session);
    const grown = load(
      twoSectionDocument((body) => body.replace('s0p2 ', `s0p2 ${'more words '.repeat(40)}`))
    );
    expect(shapeOf(lay(grown, 2, session))).toBe(shapeOf(lay(grown, 2)));
  });
});

describe('multi-section page identity and invalidation', () => {
  test('unchanged document places nothing and reuses every remapped page', () => {
    const session = createLayoutSession();
    const part = load(twoSectionDocument());
    const first = lay(part, 1, session);
    expect(session.stats.placed).toBe(session.stats.total);
    lay(part, 2, session);
    expect(session.stats.placed).toBe(0);
    expect(session.stats.reusedPages).toBe(first.pages.length);
  });

  test('edit in later section keeps earlier section page identity', () => {
    const session = createLayoutSession();
    const before = lay(load(twoSectionDocument()), 1, session);
    expect(before.pages.length).toBeGreaterThan(2);
    // Section 0 ends before s1 content; editing s1 must not rebuild section 0 sheets.
    const after = lay(
      load(twoSectionDocument((body) => body.replace('s1p10 ', 's1p10-changed '))),
      2,
      session
    );
    expect(after.pages[0]).toBe(before.pages[0]);
    // At least the first section-0 page keeps identity; later s0 pages too when page count holds.
    const s0PageCount = before.pages.findIndex((page, index) => {
      if (index === 0) return false;
      const text = page.fragments
        .flatMap((fragment) =>
          fragment.kind === 'paragraph'
            ? fragment.lines.flatMap((line) => line.spans.map((span) => span.text))
            : []
        )
        .join('');
      return text.includes('s1p');
    });
    expect(s0PageCount).toBeGreaterThan(0);
    for (let index = 0; index < s0PageCount; index += 1) {
      expect(after.pages[index]).toBe(before.pages[index]);
    }
    expect(session.stats.placed).toBeLessThan(session.stats.total);
    expect(session.stats.reusedPages).toBeGreaterThan(0);
  });

  test('an edit keeps the untouched pages of ITS OWN section by identity', () => {
    // The rebuilt section republishes every sheet it laid, including the ones its own
    // incremental pass carried over by reference — and the remap used to mint fresh box and
    // furniture wrappers on all of them. Paint skips a page only by record identity, so a
    // one-character edit repainted the whole section. The publish memo returns the previous
    // sheet when nothing about it changed; only the edited page may change identity.
    const session = createLayoutSession();
    const before = lay(load(twoSectionDocument()), 1, session);
    expect(before.pages.length).toBeGreaterThan(3);
    // Edit a paragraph that lays out on a LATER page of section 0, so earlier section-0
    // pages are provably untouched.
    const after = lay(
      load(twoSectionDocument((body) => body.replace('s0p10 ', 's0p10-changed '))),
      2,
      session
    );
    expect(after.pages.length).toBe(before.pages.length);
    const changed = after.pages
      .filter((page, index) => before.pages[index] !== page)
      .map((page) => page.index);
    // The page carrying the edit, and nothing else — not its section siblings.
    expect(changed.length).toBe(1);
    const changedText = after.pages[changed[0]!]!.fragments.flatMap((fragment) =>
      fragment.kind === 'paragraph'
        ? fragment.lines.flatMap((line) => line.spans.map((span) => span.text))
        : []
    ).join('');
    expect(changedText).toContain('s0p10-changed');
  });

  test('a line-count change before a next-page section keeps later-section pages', () => {
    const session = createLayoutSession();
    const before = lay(load(twoSectionDocument()), 1, session);
    const firstSectionOnePage = before.pages.findIndex((page) =>
      page.fragments.some(
        (fragment) =>
          fragment.kind === 'paragraph' &&
          fragment.lines.some((line) => line.spans.some((span) => span.text.includes('s1p')))
      )
    );
    expect(firstSectionOnePage).toBeGreaterThan(0);

    const edited = load(
      twoSectionDocument((body) =>
        body.replace(
          paragraph(`s0p1 ${'word '.repeat(8)}`),
          `<w:p><w:r><w:t>s0p1 ${'word '.repeat(8)}</w:t><w:br/></w:r></w:p>`
        )
      )
    );
    const after = lay(edited, 2, session);
    const cleanSession = createLayoutSession();
    const clean = lay(edited, 2, cleanSession);

    expect(shapeOf(after)).toBe(shapeOf(clean));
    expect(after.pages.length).toBe(before.pages.length);
    expect(session.multi?.sections.length).toBe(2);
    expect(session.multi?.sections[1]?.stats.placed).toBe(0);
    expect(session.multi?.sections[1]?.stats.reusedPages).toBeGreaterThan(0);
    expect(after.pages[firstSectionOnePage]).toBe(before.pages[firstSectionOnePage]);
    expect(session.multi?.sections[1]?.endLineCounter).toBe(
      cleanSession.multi?.sections[1]?.endLineCounter
    );
    expect(session.endLineCounter).toBe(cleanSession.endLineCounter);
    expect(session.stats.placed).toBeLessThan(session.stats.total);
  });

  test('earlier section repagination remaps later pages (new objects)', () => {
    const session = createLayoutSession();
    const before = lay(load(twoSectionDocument()), 1, session);
    const grownBody = (body: string) => body.replace('s0p1 ', `s0p1 ${'extra '.repeat(50)}`);
    const after = lay(load(twoSectionDocument(grownBody)), 2, session);
    expect(shapeOf(after)).toBe(shapeOf(lay(load(twoSectionDocument(grownBody)), 3)));
    // Page count moved: later sheets cannot keep prior identity even if their text is intact.
    expect(after.pages.length).not.toBe(before.pages.length);
    const lastBefore = before.pages[before.pages.length - 1]!;
    const lastAfter = after.pages[after.pages.length - 1]!;
    expect(lastAfter).not.toBe(lastBefore);
  });

  test('a continuous section is not re-appended to its host sheet on every pass', () => {
    // The host sheet is rebuilt each pass by concatenation. If the host section's span
    // recorded the MERGED page, its identity-reuse path would republish a sheet that
    // already carried this section, and the fragments would compound revision by
    // revision — a duplicated paragraph id breaks selection mapping, not just paint.
    const session = createLayoutSession();
    const shared = (type = '') =>
      `<w:pPr><w:sectPr>${type ? `<w:type w:val="${type}"/>` : ''}<w:pgSz w:w="6000" w:h="2400"/>` +
      '<w:pgMar w:top="200" w:right="200" w:bottom="200" w:left="200" w:header="100" ' +
      'w:footer="100"/></w:sectPr></w:pPr>';
    const document = (revision: number) =>
      load(
        paragraph('host one', shared()) +
          paragraph('host two') +
          paragraph(`continued ${'x'.repeat(revision)}`, shared('continuous'))
      );

    for (let revision = 1; revision <= 4; revision += 1) {
      const layout = lay(document(revision), revision, session);
      const ids = layout.pages.flatMap((page) => page.fragments.map((fragment) => fragment.id));
      expect(new Set(ids).size, `revision ${revision}: ${ids.join(',')}`).toBe(ids.length);
      // And the incremental result still matches a clean pass of the same document.
      expect(shapeOf(layout)).toBe(shapeOf(lay(document(revision), revision)));
    }
  });

  test('single -> multi -> single does not serve the multi-section layout', () => {
    // The single-section resume state (keys/context/checkpoints) describes ONE flow over
    // the whole body. A multi-section pass must clear it, or undoing the section break
    // recomputes the ORIGINAL single-section context, matches it, and the "nothing
    // changed" early exit republishes the sectioned pagination.
    const session = createLayoutSession();
    const plain = Array.from({ length: 8 }, (_, index) =>
      paragraph(`only ${index} ${'word '.repeat(6)}`)
    ).join('');
    const single = load(
      `${plain}<w:sectPr><w:pgSz w:w="6000" w:h="2400"/><w:pgMar w:top="200" w:right="200" ` +
        'w:bottom="200" w:left="200"/></w:sectPr>'
    );
    const before = lay(single, 1, session);

    // Split it: the first paragraph closes a section of its own.
    const split = Array.from({ length: 8 }, (_, index) =>
      paragraph(`only ${index} ${'word '.repeat(6)}`, index === 0 ? sectPr() : '')
    ).join('');
    lay(
      load(
        `${split}<w:sectPr><w:pgSz w:w="6000" w:h="2400"/><w:pgMar w:top="200" w:right="200" ` +
          'w:bottom="200" w:left="200"/></w:sectPr>'
      ),
      2,
      session
    );

    // Undo. The same session must not report the sectioned layout.
    const after = lay(single, 3, session);
    expect(shapeOf(after)).toBe(shapeOf(before));
    expect(shapeOf(after)).toBe(shapeOf(lay(single, 3)));
  });

  test('structure change (section count) resets child sessions without poisoning shape', () => {
    const session = createLayoutSession();
    lay(load(twoSectionDocument()), 1, session);
    // Collapse to a single section: multi state must clear on the single-section path.
    const single = Array.from({ length: 8 }, (_, index) =>
      paragraph(`only ${index} ${'word '.repeat(6)}`)
    ).join('');
    const part = load(
      `${single}<w:sectPr><w:pgSz w:w="6000" w:h="2400"/><w:pgMar w:top="200" w:right="200" w:bottom="200" w:left="200"/></w:sectPr>`
    );
    const incremental = lay(part, 2, session);
    expect(shapeOf(incremental)).toBe(shapeOf(lay(part, 2)));
    expect(session.multi).toBeNull();
  });
});

describe('page-break-before at a section start', () => {
  test('a next-page section does not add a second break', () => {
    const body =
      paragraph('Cover', sectPr()) + paragraph('Contents', '<w:pageBreakBefore/>') + sectPr();
    const session = createLayoutSession();
    const part = load(body);
    const first = lay(part, 1, session);
    expect(first.pages).toHaveLength(2);
    expect(first.pages.every((page) => page.fragments.length > 0)).toBe(true);
    expect(shapeOf(lay(part, 2, session))).toBe(shapeOf(first));
    const edited = load(body.replace('Cover', 'Edited cover'));
    expect(shapeOf(lay(edited, 3, session))).toBe(shapeOf(lay(edited, 3)));
  });

  test('a continued section still breaks away from existing host content', () => {
    const part = load(
      paragraph('Cover', sectPr()) +
        paragraph('Contents', '<w:pageBreakBefore/>') +
        sectPr('<w:type w:val="continuous"/>')
    );
    expect(lay(part, 1).pages).toHaveLength(2);
  });

  test('a page-break-before on the first document paragraph does not add a blank sheet', () => {
    expect(
      lay(load(paragraph('Contents', '<w:pageBreakBefore/>') + sectPr()), 1).pages
    ).toHaveLength(1);
  });
});
