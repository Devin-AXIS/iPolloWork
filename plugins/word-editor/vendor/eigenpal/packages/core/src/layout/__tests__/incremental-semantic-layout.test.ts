// Resuming placement and reconverging with the previous layout (tasks 9.3, 9.6).
//
// Every test here is differential: an incremental pass must produce EXACTLY what a clean
// pass produces. An incremental engine that is merely fast is a liability — it shows
// geometry for a document that no longer exists, and it looks right until someone types.
//
// Work is asserted with structural counters (paragraphs placed, pages reused), never with
// wall-clock timings, which measure the machine rather than the algorithm.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  createLayoutSession,
  createParagraphLayoutCache,
  layoutSemanticDocument,
  type LayoutSession,
  type PageGeometry,
  type SemanticLayout,
} from '../index.ts';
import { fragmentSignature, sameFragments } from '../semantic-fragment-signature.ts';
import type {
  BlockFragmentRecord,
  LineRecord,
  ParagraphFragmentRecord,
} from '../semantic-records.ts';

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
const GEOMETRY: PageGeometry = {
  width: 300,
  height: 120,
  margin: { top: 10, right: 10, bottom: 10, left: 10 },
};

const paragraph = (text: string, pPr = '') =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;

/** Long enough to span several pages, so a mid-document edit has a real tail to reuse. */
const DOCUMENT = Array.from({ length: 24 }, (_, index) =>
  paragraph(`paragraph ${index} ${'word '.repeat(6)}`)
).join('');

const lay = (part: OoxmlPart, revision: number, session?: LayoutSession): SemanticLayout =>
  layoutSemanticDocument(part, revision, {
    measurer,
    geometry: GEOMETRY,
    ...(session ? { session } : {}),
  });

/** Records only, so two layouts compare without their revision stamps getting in the way. */
const shapeOf = (layout: SemanticLayout): string =>
  JSON.stringify(
    layout.pages.map((page) => ({
      index: page.index,
      box: page.box,
      fragments: page.fragments.map((fragment) => ({
        id: fragment.id,
        box: fragment.box,
        lines: fragment.lines.map((line) => ({ id: line.id, box: line.box, spans: line.spans })),
      })),
    }))
  );

describe('an incremental pass equals a clean one (tasks 9.3, 9.6)', () => {
  test('an unchanged document re-lays out to the identical shape', () => {
    const session = createLayoutSession();
    const part = load(DOCUMENT);
    const first = lay(part, 1, session);
    const second = lay(part, 2, session);
    expect(shapeOf(second)).toBe(shapeOf(first));
  });

  test('an edit in the MIDDLE gives the same shape as a full pass', () => {
    const session = createLayoutSession();
    lay(load(DOCUMENT), 1, session);
    const edited = load(DOCUMENT.replace('paragraph 12 ', 'paragraph twelve, rewritten '));
    expect(shapeOf(lay(edited, 2, session))).toBe(shapeOf(lay(edited, 2)));
  });

  test('an edit that changes the PAGE COUNT still matches a full pass', () => {
    // The case a naive suffix reuse gets wrong: everything below shifts by a page, so the
    // tail cannot be reused however unchanged its content is.
    const session = createLayoutSession();
    lay(load(DOCUMENT), 1, session);
    const grown = load(DOCUMENT.replace('paragraph 3 ', `paragraph 3 ${'more words '.repeat(40)}`));
    expect(shapeOf(lay(grown, 2, session))).toBe(shapeOf(lay(grown, 2)));
  });

  test('inserting a paragraph matches a full pass', () => {
    const session = createLayoutSession();
    lay(load(DOCUMENT), 1, session);
    const inserted = load(
      DOCUMENT.replace(
        paragraph('paragraph 5 word word word word word word '),
        paragraph('paragraph 5 word word word word word word ') + paragraph('inserted')
      )
    );
    expect(shapeOf(lay(inserted, 2, session))).toBe(shapeOf(lay(inserted, 2)));
  });

  test('deleting the first paragraph matches a full pass', () => {
    const session = createLayoutSession();
    lay(load(DOCUMENT), 1, session);
    const shortened = load(
      DOCUMENT.replace(paragraph('paragraph 0 word word word word word word '), '')
    );
    expect(shapeOf(lay(shortened, 2, session))).toBe(shapeOf(lay(shortened, 2)));
  });

  test('a geometry change is a full pass, not a resume from a stale flow', () => {
    const session = createLayoutSession();
    const part = load(DOCUMENT);
    lay(part, 1, session);
    const narrow: PageGeometry = { ...GEOMETRY, width: 200 };
    const incremental = layoutSemanticDocument(part, 2, {
      measurer,
      geometry: narrow,
      session,
    });
    const clean = layoutSemanticDocument(part, 2, { measurer, geometry: narrow });
    expect(shapeOf(incremental)).toBe(shapeOf(clean));
    expect(session.stats.placed).toBe(session.stats.total);
  });
});

describe('work is bounded, measured structurally (tasks 9.3, 9.6)', () => {
  test('an unchanged document places NOTHING and reuses every page', () => {
    const session = createLayoutSession();
    const part = load(DOCUMENT);
    const first = lay(part, 1, session);
    expect(session.stats.placed).toBe(session.stats.total);
    lay(part, 2, session);
    expect(session.stats.placed).toBe(0);
    expect(session.stats.reusedPages).toBe(first.pages.length);
  });

  test('an edit near the END places only the tail, not the document', () => {
    const session = createLayoutSession();
    lay(load(DOCUMENT), 1, session);
    const total = session.stats.total;
    lay(load(DOCUMENT.replace('paragraph 22 ', 'paragraph twenty-two ')), 2, session);
    expect(session.stats.placed).toBeLessThan(total);
    expect(session.stats.placed).toBeLessThanOrEqual(2);
  });

  test('an edit near the START reuses the tail once the flow reconverges', () => {
    // A short edit that does not move anything: the paragraphs below keep their positions,
    // so the flow returns to exactly where it was and the rest is carried over.
    const session = createLayoutSession();
    const first = lay(load(DOCUMENT), 1, session);
    lay(load(DOCUMENT.replace('paragraph 1 ', 'paragraph A ')), 2, session);
    expect(session.stats.placed).toBeLessThan(session.stats.total);
    expect(session.stats.reusedPages).toBeGreaterThan(0);
    expect(session.stats.reusedPages).toBeLessThanOrEqual(first.pages.length);
  });

  test('a line-count change reconverges after an explicit page break', () => {
    const pageBreak = `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
    const withReset = DOCUMENT.replace(
      paragraph('paragraph 8 word word word word word word '),
      paragraph('paragraph 8 word word word word word word ') + pageBreak
    );
    const session = createLayoutSession();
    lay(load(withReset), 1, session);

    const edited = load(
      withReset.replace(
        paragraph('paragraph 1 word word word word word word '),
        `<w:p><w:r><w:t>paragraph 1 word word word word word word </w:t><w:br/></w:r></w:p>`
      )
    );
    const incremental = lay(edited, 2, session);

    expect(shapeOf(incremental)).toBe(shapeOf(lay(edited, 2)));
    expect(session.stats.placed).toBeLessThan(session.stats.total);
    expect(session.stats.reusedPages).toBeGreaterThan(0);
  });

  test('unchanged pages keep their IDENTITY, so a consumer can skip repainting them', () => {
    const session = createLayoutSession();
    const before = lay(load(DOCUMENT), 1, session);
    const after = lay(load(DOCUMENT.replace('paragraph 20 ', 'paragraph twenty ')), 2, session);
    // Not merely equal — the same objects.
    expect(after.pages[0]).toBe(before.pages[0]);
    expect(after.pages[1]).toBe(before.pages[1]);
  });

  test('a changed page is a NEW object, so identity cannot mean "unchanged" falsely', () => {
    const session = createLayoutSession();
    const before = lay(load(DOCUMENT), 1, session);
    const after = lay(load(DOCUMENT.replace('paragraph 0 ', 'paragraph zero ')), 2, session);
    expect(after.pages[0]).not.toBe(before.pages[0]);
  });
});

describe('the cache and the session compose (tasks 9.2, 9.3)', () => {
  test('a resumed pass does not evict the prefix it skipped', () => {
    // The prefix is never visited, so a cache pruned by "what this pass touched" would
    // throw it away and make the next full pass measure the whole document again.
    const session = createLayoutSession();
    const cache = createParagraphLayoutCache<never>();
    const options = { measurer, geometry: GEOMETRY, cache: cache as never, session };
    layoutSemanticDocument(load(DOCUMENT), 1, options);
    const size = cache.stats.size;
    const edited = load(DOCUMENT.replace('paragraph 22 ', 'paragraph X '));
    layoutSemanticDocument(edited, 2, options);
    // The edited paragraph mints one new key; nothing already cached may be evicted.
    expect(cache.stats.size).toBeGreaterThanOrEqual(size);
    // The proof: a clean full pass over the edited document misses only the entries the
    // edit could have invalidated, never the untouched prefix.
    const missesBefore = cache.stats.misses;
    layoutSemanticDocument(edited, 3, { measurer, geometry: GEOMETRY, cache: cache as never });
    expect(cache.stats.misses - missesBefore).toBeLessThanOrEqual(1);
  });

  test('together they still produce exactly what a clean pass produces', () => {
    const session = createLayoutSession();
    const cache = createParagraphLayoutCache<never>();
    layoutSemanticDocument(load(DOCUMENT), 1, {
      measurer,
      geometry: GEOMETRY,
      cache: cache as never,
      session,
    });
    const edited = load(DOCUMENT.replace('paragraph 9 ', 'paragraph nine, longer than before '));
    const incremental = layoutSemanticDocument(edited, 2, {
      measurer,
      geometry: GEOMETRY,
      cache: cache as never,
      session,
    });
    expect(shapeOf(incremental)).toBe(shapeOf(lay(edited, 2)));
  });

  test('table geometry fields participate in fragment signature equality', () => {
    const session = createLayoutSession();
    const tableDoc = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>` +
        `<w:tr><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`
    );
    const first = layoutSemanticDocument(tableDoc, 1, { measurer, geometry: GEOMETRY, session });
    const second = layoutSemanticDocument(tableDoc, 2, { measurer, geometry: GEOMETRY, session });
    const tableA = first.pages[0]!.fragments.find((fragment) => fragment.kind === 'table');
    const tableB = second.pages[0]!.fragments.find((fragment) => fragment.kind === 'table');
    expect(tableA?.kind).toBe('table');
    expect(tableB?.kind).toBe('table');
    if (tableA?.kind === 'table' && tableB?.kind === 'table') {
      expect(tableB.nestingDepth).toBe(tableA.nestingDepth);
      expect(tableB.columnEdges).toEqual(tableA.columnEdges);
      expect(tableB.rows[0]!.rowIndex).toBe(tableA.rows[0]!.rowIndex);
    }
  });

  test('changing nestingDepth columnEdges or rowIndex changes fragmentSignature', () => {
    const session = createLayoutSession();
    const tableDoc = load(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>` +
        `<w:tr><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`
    );
    const layout = layoutSemanticDocument(tableDoc, 1, { measurer, geometry: GEOMETRY, session });
    const base = layout.pages[0]!.fragments.find((fragment) => fragment.kind === 'table');
    expect(base?.kind).toBe('table');
    if (base?.kind !== 'table') return;

    const deeper = { ...base, nestingDepth: base.nestingDepth + 1 };
    expect(fragmentSignature(deeper)).not.toBe(fragmentSignature(base));

    const newEdges = [...base.columnEdges];
    newEdges[newEdges.length - 1] = (newEdges.at(-1) ?? 0) + 1;
    const retuned = { ...base, columnEdges: newEdges };
    expect(fragmentSignature(retuned)).not.toBe(fragmentSignature(base));

    const reindexed = {
      ...base,
      rows: base.rows.map((row, index) => ({ ...row, rowIndex: index + 1 })),
    };
    expect(fragmentSignature(reindexed)).not.toBe(fragmentSignature(base));

    const same = { ...base, rows: [...base.rows] };
    expect(fragmentSignature(same)).toBe(fragmentSignature(base));
  });

  test('an inline drawing resource transition changes the open-page fragment signature', () => {
    const base = lay(load(paragraph('open page')), 1).pages[0]!.fragments[0]!;
    expect(base.kind).toBe('paragraph');
    if (base.kind !== 'paragraph') return;

    const withResource = (resource: object): BlockFragmentRecord =>
      ({
        ...base,
        lines: base.lines.map((line, index) =>
          index === 0
            ? {
                ...line,
                drawings: [
                  {
                    kind: 'inlineDrawing',
                    drawingNodeId: 'drawing-1',
                    resource,
                  },
                ],
              }
            : line
        ),
      }) as BlockFragmentRecord;

    const pending = withResource({ kind: 'pending', resourceKey: 'drawing-1' });
    const samePending = withResource({ kind: 'pending', resourceKey: 'drawing-1' });
    const ready = withResource({
      kind: 'ready',
      resourceKey: 'drawing-1-ready',
      contentId: 'content-1',
    });

    expect(sameFragments([pending], [samePending])).toBe(true);
    expect(sameFragments([pending], [ready])).toBe(false);
  });
});

// Convergence restores the previous pass's open page verbatim, so a published field the
// signature does not carry comes back at its pre-edit value. Each case below is a state
// transition that moves ONE field and no geometry, which is exactly what makes it invisible
// to a hand-written field list.
describe('every published field of a fragment participates in its signature', () => {
  const openPageFragment = (): ParagraphFragmentRecord => {
    const fragment = lay(load(paragraph('open page')), 1).pages[0]!.fragments[0]!;
    if (fragment.kind !== 'paragraph') throw new Error('expected a paragraph fragment');
    return fragment;
  };

  const withFirstLine = (
    fragment: ParagraphFragmentRecord,
    patch: Partial<LineRecord>
  ): ParagraphFragmentRecord => ({
    ...fragment,
    lines: fragment.lines.map((line, index) => (index === 0 ? { ...line, ...patch } : line)),
  });

  // `lines.drawings` belongs to this set too; the pending → ready transition has its own
  // test above, which arrived with the document that reproduced it.
  const TRANSITIONS: readonly [
    string,
    (base: ParagraphFragmentRecord) => ParagraphFragmentRecord,
  ][] = [
    [
      'accepting the tracked revision on the paragraph mark',
      (base) => ({
        ...base,
        markRevisions: [{ kind: 'insert', id: '7', author: 'A', nodeId: 'revision-7' }],
      }),
    ],
    [
      'a line-spacing rule moving the space above the glyph band',
      (base) => withFirstLine(base, { leading: base.lines[0]!.leading + 1 }),
    ],
    [
      'a line-spacing rule moving the space below the glyph band',
      (base) => withFirstLine(base, { trailingSpacing: (base.lines[0]!.trailingSpacing ?? 0) + 1 }),
    ],
    [
      'a deletion the caret must step over appearing on the line',
      (base) =>
        withFirstLine(base, {
          deletedRanges: [{ start: 0, end: 1 }],
        }),
    ],
    [
      'the model range a line covers moving under equal geometry',
      (base) =>
        withFirstLine(base, {
          range: { ...base.lines[0]!.range, end: base.lines[0]!.range.end + 1 },
        }),
    ],
  ];

  for (const [name, vary] of TRANSITIONS) {
    test(`${name} changes the signature`, () => {
      const base = openPageFragment();
      const moved = vary(base);
      expect(fragmentSignature(moved)).not.toBe(fragmentSignature(base));
      expect(sameFragments([base], [moved])).toBe(false);
    });
  }

  test('a rebuilt fragment with no change keeps its signature', () => {
    const base = openPageFragment();
    const rebuilt: ParagraphFragmentRecord = {
      ...base,
      lines: base.lines.map((line) => ({ ...line })),
    };
    expect(fragmentSignature(rebuilt)).toBe(fragmentSignature(base));
    expect(sameFragments([base], [rebuilt])).toBe(true);
  });
});

// The review decisions that reach layout as a paragraph-MARK edit. Each rewrites
// `w:pPr/w:rPr/w:ins|w:del` and moves nothing else a page publishes: the pilcrow keeps its
// place, the text keeps its metrics, and `props` still reads the one `rPr` it read before.
// So the fragment signature was the only thing standing between the decision and a page that
// kept drawing the old attribution.
describe('a tracked paragraph mark reaches the incremental layout', () => {
  const TARGET = paragraph('paragraph 12 word word word word word word ');
  const marked = (rPr: string) =>
    paragraph('paragraph 12 word word word word word word ', `<w:rPr>${rPr}</w:rPr>`);

  /** Every published field of every page, so a stale one anywhere fails the comparison. */
  const publishedShapeOf = (layout: SemanticLayout): string => JSON.stringify(layout.pages);

  // `CT_ParaRPr` is a SEQUENCE with `EG_ParaRPrTrackChanges` (`ins? del? moveFrom? moveTo?`)
  // ahead of `EG_RPrBase`, which is why the mark's revision precedes its `w:b` here and in
  // `CT_RPR_SEQUENCE` (store/store/tree-op-properties.ts). A fixture in the other order is a
  // document Word calls damaged, and this reader would accept it and hide that.
  const DECISIONS: readonly [string, string, string][] = [
    [
      'accepting an insertion whose mark keeps its other run properties',
      '<w:ins w:id="7" w:author="A"/><w:b/>',
      '<w:b/>',
    ],
    ['rejecting a deletion the mark carried', '<w:del w:id="7" w:author="A"/><w:b/>', '<w:b/>'],
    // The pair `EG_ParaRPrTrackChanges` allows and this engine's own writer emits: B proposes
    // removing a mark A proposed adding. Both decisions have to reach the page.
    [
      'a second author proposing the removal of an inserted mark',
      '<w:ins w:id="7" w:author="A"/>',
      '<w:ins w:id="7" w:author="A"/><w:del w:id="8" w:author="B"/>',
    ],
    // Word does not rewrite an author while editing, but two of its own operations produce
    // exactly this: the Document Inspector under `w:removePersonalInformation`, which
    // rewrites every `w:author` and leaves `w:id` alone, and Compare or Combine Documents.
    [
      'the mark changing hands to another author',
      '<w:ins w:id="7" w:author="A"/>',
      '<w:ins w:id="7" w:author="B"/>',
    ],
  ];

  for (const [name, before, after] of DECISIONS) {
    test(`${name} matches a full pass`, () => {
      const session = createLayoutSession();
      lay(load(DOCUMENT.replace(TARGET, marked(before))), 1, session);
      const decided = load(DOCUMENT.replace(TARGET, marked(after)));
      expect(publishedShapeOf(lay(decided, 2, session))).toBe(publishedShapeOf(lay(decided, 2)));
    });
  }
});
