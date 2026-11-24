// A pass whose footnote reserves moved resumes from the last checkpoint those reserves left
// valid, and reuses the previous tail only where the reserves moved with it. Every resumed
// pass must equal a fresh pass over the same inputs.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlNode, type OoxmlPart } from '../../store/package/ooxml-tree.ts';
import { applyTreeOp } from '../../store/index.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
  type SemanticLayout,
} from '../index.ts';
import type { LayoutSession } from '../layout-session.ts';
import { takeMovedSeedReserves } from '../note-reserves.ts';
import { takeReadReserves, withReadReserves } from '../note-reserve-resume.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);
const sectPr =
  '<w:sectPr><w:pgSz w:w="4000" w:h="2400"/>' +
  '<w:pgMar w:top="200" w:right="200" w:bottom="200" w:left="200" w:header="100" w:footer="100"/>' +
  '</w:sectPr>';
const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
const sectionEnd = `<w:p><w:pPr>${sectPr}</w:pPr></w:p>`;

function partOf(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const filler = (count: number, tag: string) =>
  Array.from({ length: count }, (_, index) => paragraph(`${tag} ${index}`)).join('');

/** The page whose text holds `text` on one line. */
function pageWith(layout: SemanticLayout, text: string): number {
  return layout.pages.findIndex((page) =>
    page.fragments.some(
      (fragment) =>
        fragment.kind === 'paragraph' &&
        fragment.lines.some((line) => line.spans.map((span) => span.text).join('') === text)
    )
  );
}

/** Every fragment's paragraph, text, page and position. */
function signature(layout: SemanticLayout): string[] {
  return layout.pages.flatMap((page, pageIndex) =>
    page.fragments.map((fragment) =>
      fragment.kind === 'paragraph'
        ? `${pageIndex}|${fragment.paragraphId}|${fragment.lines
            .flatMap((line) => line.spans.map((span) => span.text))
            .join('')}|${fragment.box.y}|${fragment.lines.length}`
        : `${pageIndex}|table`
    )
  );
}

function lay(
  part: OoxmlPart,
  reserves: ReadonlyMap<number, number>,
  session?: LayoutSession,
  fromPreviousPass = false,
  followFlow = false
): SemanticLayout {
  return layoutSemanticDocument(part, 1, {
    measurer,
    producer: 'test',
    pageBottomReserves: reserves,
    ...(fromPreviousPass ? { pageBottomReservesFromPreviousPass: true } : {}),
    ...(followFlow ? { pageBottomReservesFollowFlow: true } : {}),
    ...(session ? { session } : {}),
  });
}

describe('a section pass whose reserves moved', () => {
  test('resumes before the first page whose reserve moved, and matches a fresh pass', () => {
    const part = partOf(filler(120, 'p') + sectPr);
    const session = createLayoutSession();
    const before = new Map([
      [3, 30],
      [8, 20],
    ]);
    lay(part, before, session);
    for (const moved of [
      new Map([...before, [10, 25]]),
      new Map([
        [3, 30],
        [8, 40],
      ]),
      new Map([[1, 15]]),
    ]) {
      const resumed = lay(part, moved, session);
      expect(signature(resumed)).toEqual(signature(lay(part, moved)));
      // Pages before the first moved reserve were not laid out again. A flow that comes back
      // into step after it reuses the previous tail too.
      const first = Math.min(
        ...[...moved.keys(), ...before.keys()].filter(
          (page) => moved.get(page) !== before.get(page)
        )
      );
      expect(session.stats.reusedPages).toBeGreaterThanOrEqual(first - 1);
      expect(session.stats.placed).toBeLessThan(session.stats.total);
      before.clear();
      for (const [page, height] of moved) before.set(page, height);
    }
  });

  test('a page break reuses the tail only where the reserves moved with it', () => {
    const plain = partOf(filler(40, 'a') + filler(80, 'b') + sectPr);
    const broken = partOf(filler(40, 'a') + pageBreak + filler(80, 'b') + sectPr);
    const reserves = new Map([
      [2, 20],
      [14, 30],
      [20, 10],
    ]);
    const fresh = lay(plain, reserves);
    const breakPage = pageWith(fresh, 'b 0');
    expect(breakPage).toBeGreaterThan(2);
    const shifted = new Map(
      [...reserves].map(([page, height]) => [page > breakPage ? page + 1 : page, height] as const)
    );
    for (const next of [shifted, reserves]) {
      const session = createLayoutSession();
      lay(plain, reserves, session);
      const resumed = lay(broken, next, session);
      expect(signature(resumed)).toEqual(signature(lay(broken, next)));
    }
  });

  test('a table edit in the same pass as a moved reserve still reflows the page', () => {
    const table = (text: string) =>
      '<w:tbl><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>' +
      `<w:tr><w:tc>${paragraph(text)}</w:tc></w:tr></w:tbl>`;
    const before = partOf(table('cell a') + filler(60, 'p') + sectPr);
    // An edit through the store, so every block but the table keeps its identity.
    const cellParagraph = (node: OoxmlNode): OoxmlNode | undefined =>
      node.kind === 'textValue'
        ? undefined
        : node.kind === 'paragraph'
          ? node
          : node.children.map(cellParagraph).find(Boolean);
    const edited = applyTreeOp(before, {
      op: 'insertText',
      paragraphId: cellParagraph(before.root)!.id,
      offset: 0,
      text: 'x',
    });
    if (!edited.ok) throw new Error(edited.reason);
    const after = edited.part;
    const session = createLayoutSession();
    lay(before, new Map(), session);
    const moved = new Map([[0, 40]]);
    const resumed = lay(after, moved, session);
    expect(signature(resumed)).toEqual(signature(lay(after, moved)));
  });
});

describe('a seeded notes pass over several sections', () => {
  test("moves each later section's seed with its first page", () => {
    const body = (extra: string) =>
      filler(15, 's0') +
      extra +
      filler(15, 's0 tail') +
      sectionEnd +
      filler(30, 's1') +
      sectionEnd +
      filler(30, 's2') +
      sectPr;
    const before = partOf(body(''));
    const after = partOf(body(pageBreak));
    const session = createLayoutSession();
    const first = lay(before, new Map(), session);
    const s1Start = pageWith(first, 's1 0');
    expect(s1Start).toBeGreaterThan(0);
    // Reserves on the second and third sections, at the pages of the previous pass.
    const seed = new Map([
      [s1Start + 1, 20],
      [first.pages.length - 2, 30],
    ]);
    lay(before, seed, session);
    takeMovedSeedReserves(session);

    const resumed = lay(after, seed, session, true);
    const moved = takeMovedSeedReserves(session);
    expect(moved).toBeDefined();
    const shift = resumed.pages.length - first.pages.length;
    expect(shift).toBe(1);
    expect([...moved!]).toEqual([...seed].map(([page, height]) => [page + shift, height]));
    expect(signature(resumed)).toEqual(signature(lay(after, moved!)));
  });
});

describe('a seeded notes pass whose tail moved by whole pages', () => {
  const before = partOf(filler(120, 'p') + sectPr);
  const seed = new Map([
    [4, 20],
    [9, 30],
  ]);
  /** `before` with one page's worth of lines added to its fourth paragraph, ids kept. */
  function grown(): OoxmlPart {
    const linesOf = (part: OoxmlPart) =>
      lay(part, new Map()).pages.map((page) =>
        page.fragments.reduce(
          (count, fragment) => count + (fragment.kind === 'paragraph' ? fragment.lines.length : 0),
          0
        )
      );
    const linesPerPage = linesOf(before)[1]!;
    const total = (part: OoxmlPart) => linesOf(part).reduce((sum, count) => sum + count, 0);
    const body = before.root.kind === 'textValue' ? undefined : before.root.children[0];
    const paragraph = body && body.kind !== 'textValue' ? body.children[3] : undefined;
    for (let words = 1; words < 200; words += 1) {
      const edited = applyTreeOp(before, {
        op: 'insertText',
        paragraphId: paragraph!.id,
        offset: 3,
        text: ' word'.repeat(words),
      });
      if (!edited.ok) throw new Error(edited.reason);
      if (total(edited.part) - total(before) === linesPerPage) return edited.part;
    }
    throw new Error('no edit adds one page of lines');
  }

  test('reuses the tail with the reserves it was laid out under, and reports them', () => {
    const after = grown();
    const session = createLayoutSession();
    const first = lay(before, seed, session);
    expect(takeReadReserves(session)).toBeUndefined();

    const resumed = lay(after, seed, session, true, true);
    const shift = takeReadReserves(session);
    expect(shift).toBeDefined();
    expect(resumed.pages.length).toBe(first.pages.length + 1);
    // The seed's note pages moved one page later with the tail that carries them.
    const used = withReadReserves(seed, shift!);
    expect([...used].sort((a, b) => a[0] - b[0])).toEqual([
      [5, 20],
      [10, 30],
    ]);
    expect(session.stats.reusedPages).toBeGreaterThan(0);
    // Exactly the layout of a fresh pass under the reserves it reported.
    expect(signature(resumed)).toEqual(signature(lay(after, used)));
  });

  test('without a seed the tail is laid out again under the reserves given', () => {
    const after = grown();
    const session = createLayoutSession();
    lay(before, seed, session);
    const resumed = lay(after, seed, session);
    expect(takeReadReserves(session)).toBeUndefined();
    expect(signature(resumed)).toEqual(signature(lay(after, seed)));
  });
});
