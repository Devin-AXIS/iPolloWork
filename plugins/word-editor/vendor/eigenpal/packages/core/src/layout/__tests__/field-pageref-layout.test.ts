// PAGEREF fields through full layout: the page number of the bookmark target's page.
//
// The value is a property of pagination, so the paragraph walk paints the cached result (or
// the placeholder digit) and marks the span; `finalizePageFieldProjection` substitutes the
// number of the page hosting the target's first fragment. The document's own cache is the
// calibration oracle, exactly as it is for REF: a cache the computed number cannot reproduce
// keeps painting verbatim, and the verdict is sticky in the live direction only.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { createLayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { paragraphFragmentsOf, type PageGeometry, type SemanticLayout } from '../index.ts';
import { planRefFieldResultRefresh } from '../field-ref-refresh.ts';
import { pageRefCalibrationVerdict } from '../field-page-furniture.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);

// Content height 80pt at 14pt per fixed-measurer line: five lines per page.
const SMALL: PageGeometry = {
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

const filler = (count: number, prefix = 'filler') =>
  Array.from(
    { length: count },
    (_, i) => `<w:p><w:r><w:t xml:space="preserve">${prefix} ${i}</w:t></w:r></w:p>`
  ).join('');

const heading = (name: string, text: string) =>
  `<w:p><w:bookmarkStart w:id="1" w:name="${name}"/><w:r><w:t xml:space="preserve">${text}</w:t></w:r>` +
  `<w:bookmarkEnd w:id="1"/></w:p>`;

const pageRefField = (instr: string, cached = '') =>
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  `<w:r><w:instrText>${instr}</w:instrText></w:r>` +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  (cached ? `<w:r><w:t xml:space="preserve">${cached}</w:t></w:r>` : '') +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';

const pageRefParagraph = (instr: string, cached = '') =>
  `<w:p><w:r><w:t xml:space="preserve">page </w:t></w:r>${pageRefField(instr, cached)}</w:p>`;

const textsOf = (layout: SemanticLayout): string[] =>
  layout.pages.flatMap((page) =>
    paragraphFragmentsOf(page).map((fragment) =>
      fragment.lines
        .flatMap((line) => line.spans.map((span) => span.text))
        .join('')
        .trim()
    )
  );

function layoutOf(body: string): SemanticLayout {
  return layoutSemanticDocument(load(body), 1, { measurer, geometry: SMALL });
}

// Six 14pt lines fit the 80pt content box (a boundary line's trailing spacing may cross the
// bottom text margin). The PAGEREF paragraph opens the document; five filler lines fill
// page 1; the bookmarked heading opens page 2.
const TWO_PAGE_BODY = (cached = '', instr = ' PAGEREF target \\h ') =>
  pageRefParagraph(instr, cached) + filler(5) + heading('target', 'The heading');

describe('body PAGEREF fields compute the target page at finalize', () => {
  test('an empty cache paints the computed page number', () => {
    const layout = layoutOf(TWO_PAGE_BODY());
    expect(layout.pages).toHaveLength(2);
    expect(textsOf(layout)).toContain('page 2');
  });

  test('a cache the computed number reproduces goes live', () => {
    const layout = layoutOf(TWO_PAGE_BODY('2'));
    expect(textsOf(layout)).toContain('page 2');
  });

  test('a cache the computed number cannot reproduce paints verbatim', () => {
    const layout = layoutOf(TWO_PAGE_BODY('9'));
    expect(textsOf(layout)).toContain('page 9');
    expect(textsOf(layout).join('|')).not.toContain('page 2');
  });

  test('an unsupported switch keeps the cached result', () => {
    // `\p` (relative "above/below") is out of the grammar on purpose.
    const layout = layoutOf(TWO_PAGE_BODY('9', ' PAGEREF target \\p '));
    expect(textsOf(layout)).toContain('page 9');
  });

  test('a missing bookmark keeps the cached result', () => {
    const layout = layoutOf(TWO_PAGE_BODY('9', ' PAGEREF nowhere \\h '));
    expect(textsOf(layout)).toContain('page 9');
  });

  test('a simple PAGEREF resolves the same way', () => {
    const body =
      `<w:p><w:r><w:t xml:space="preserve">page </w:t></w:r><w:fldSimple w:instr=" PAGEREF target \\h "/></w:p>` +
      filler(5) +
      heading('target', 'The heading');
    const layout = layoutOf(body);
    expect(textsOf(layout)).toContain('page 2');
  });
});

/**
 * Replace the body's block list while keeping every surviving node BY IDENTITY — the shape a
 * `TreeDocumentStore` commit publishes (the same helper `field-ref-layout.test.ts` uses).
 */
function withBlocks(
  part: OoxmlPart,
  edit: (blocks: readonly OoxmlElement[]) => readonly OoxmlElement[]
): OoxmlPart {
  const body = part.root.children.find(
    (child): child is OoxmlElement => child.kind !== 'textValue' && child.localName === 'body'
  )!;
  const blocks = body.children.filter(
    (child): child is OoxmlElement => child.kind === 'paragraph' || child.kind === 'table'
  );
  const edited = edit(blocks);
  const nextChildren = [
    ...edited,
    ...body.children.filter(
      (child) =>
        child.kind === 'textValue' || (child.kind !== 'paragraph' && child.kind !== 'table')
    ),
  ];
  const nextBody = { ...body, children: nextChildren } as OoxmlElement;
  const nextRoot = {
    ...part.root,
    children: part.root.children.map((child) => (child === body ? nextBody : child)),
  } as OoxmlElement;
  return { ...part, root: nextRoot };
}

describe('a repagination repaints dependent PAGEREF fields in a warm session', () => {
  test('the target moving a page updates the painted number, live past its cache', () => {
    // The cache says 2 and the target IS on page 2, so the field calibrates live. The edit
    // pushes the heading to page 3 while the PAGEREF paragraph survives by identity — only
    // the finalize substitution can repaint it, and the sticky live verdict must hold even
    // though the computed value now diverges from the cache.
    const before = load(TWO_PAGE_BODY('2'));
    const options = {
      measurer,
      geometry: SMALL,
      session: createLayoutSession(),
      cache: createParagraphLayoutCache(),
    };
    const first = layoutSemanticDocument(before, 1, options);
    expect(textsOf(first)).toContain('page 2');

    const inserted = load(filler(6, 'insert'));
    const insertedBlocks = inserted.root.children
      .flatMap((child) => (child.kind === 'textValue' ? [] : child.children))
      .filter((child): child is OoxmlElement => child.kind === 'paragraph');
    const after = withBlocks(before, (blocks) => [
      blocks[0]!,
      ...insertedBlocks,
      ...blocks.slice(1),
    ]);
    const warm = layoutSemanticDocument(after, 2, options);
    expect(warm.pages).toHaveLength(3);
    expect(textsOf(warm)).toContain('page 3');
    expect(textsOf(warm).join('|')).not.toContain('page 2');
  });
});

describe('the calibration latch is provisional within a revision, sticky across them', () => {
  test('a same-revision re-finalize that moved the target revokes the latch', () => {
    // The body finalize matches the cache; the note pass then re-finalizes the SAME revision
    // with the target shifted by an inserted overflow sheet. The pass's last word is that the
    // cache is not reproduced, so the field must stay cached.
    const cell = {};
    expect(pageRefCalibrationVerdict(cell, '5', '5', 7)).toBe(true);
    expect(pageRefCalibrationVerdict(cell, '5', '6', 7)).toBe(false);
    expect(pageRefCalibrationVerdict(cell, '5', '6', 7)).toBe(false);
  });

  test('a later revision cannot revoke: an edit diverges the live value by design', () => {
    const cell = {};
    expect(pageRefCalibrationVerdict(cell, '5', '5', 7)).toBe(true);
    expect(pageRefCalibrationVerdict(cell, '5', '6', 8)).toBe(true);
    expect(pageRefCalibrationVerdict(cell, '5', '9', 9)).toBe(true);
  });

  test('an empty cache is always live and never revoked', () => {
    const cell = {};
    expect(pageRefCalibrationVerdict(cell, '', '5', 7)).toBe(true);
    expect(pageRefCalibrationVerdict(cell, '', '6', 7)).toBe(true);
  });

  test('a failed first compare re-checks and can go live on the post-note numbering', () => {
    const cell = {};
    expect(pageRefCalibrationVerdict(cell, '6', '5', 7)).toBe(false);
    expect(pageRefCalibrationVerdict(cell, '6', '6', 7)).toBe(true);
    expect(pageRefCalibrationVerdict(cell, '6', '9', 8)).toBe(true);
  });
});

describe('a bookmark edit re-resolves the target in a warm session', () => {
  test('removing the winning declaration moves the field to the next one', () => {
    // Two paragraphs declare the same name; first declaration wins, so the field paints the
    // page of the FIRST. Removing that paragraph re-resolves the name to the survivor on the
    // next page — while the field's own paragraph survives the edit by identity, so only the
    // target id folded into its ref token can invalidate its cached fragment.
    const before = load(
      pageRefParagraph(' PAGEREF target \\h ') +
        filler(5) +
        heading('target', 'First winner') +
        filler(6, 'gap') +
        `<w:p><w:bookmarkStart w:id="2" w:name="target"/><w:r><w:t>Second</w:t></w:r>` +
        `<w:bookmarkEnd w:id="2"/></w:p>`
    );
    const options = {
      measurer,
      geometry: SMALL,
      session: createLayoutSession(),
      cache: createParagraphLayoutCache(),
    };
    const first = layoutSemanticDocument(before, 1, options);
    expect(textsOf(first)).toContain('page 2');

    const after = withBlocks(before, (blocks) => blocks.filter((block) => block !== blocks[6]));
    const warm = layoutSemanticDocument(after, 2, options);
    const oracle = layoutSemanticDocument(after, 1, { measurer, geometry: SMALL });
    expect(textsOf(oracle)).toContain('page 3');
    expect(textsOf(warm)).toContain('page 3');
    expect(textsOf(warm).join('|')).not.toContain('page 2');
  });
});

describe('save-time PAGEREF result refresh', () => {
  test('a fresh result plans nothing; a moved target plans the painted value', () => {
    const part = load(TWO_PAGE_BODY('2'));
    // Paint first: the layout finalize is what latches the calibration (a save-time check
    // alone never latches — its NaN revision could not be revoked by the note pass).
    layoutSemanticDocument(part, 1, { measurer, geometry: SMALL });
    // Computed equals the cache: the field is live and nothing needs rewriting.
    expect(planRefFieldResultRefresh(part, { pageRefPageNumberOf: () => '2' })).toBeNull();
    // Same document object, so the sticky live verdict carries; the target now reports
    // page 3 and the plan rewrites the result to what the pages paint.
    const op = planRefFieldResultRefresh(part, { pageRefPageNumberOf: () => '3' });
    expect(op).not.toBeNull();
    expect(op!.updates).toHaveLength(1);
    expect(op!.updates[0]!.text).toBe('3');
  });

  test('a field that failed calibration keeps its cached result on save', () => {
    const part = load(TWO_PAGE_BODY('9'));
    expect(planRefFieldResultRefresh(part, { pageRefPageNumberOf: () => '2' })).toBeNull();
  });

  test('a plan without a page-number source keeps every PAGEREF result as loaded', () => {
    const part = load(TWO_PAGE_BODY('9'));
    expect(planRefFieldResultRefresh(part, {})).toBeNull();
  });
});
