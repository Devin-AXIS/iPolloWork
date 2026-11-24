// Paragraph border GROUPS across an incremental pass (ECMA-376 §17.3.1.24).
//
// Consecutive paragraphs with identical `w:pBdr` are ONE bordered block: the box opens above
// the first and closes below the last, and each interior boundary carries `w:between` or
// nothing at all. So a paragraph's bottom edge is decided by the paragraph AFTER it, and its
// top edge by the one before it. Neither bit lives in the block's own content key, so the incremental pass
// resumed past a paragraph that had just stopped being the last of its group and kept the
// closing rule — and the rule's `w:space` padding is real height, so the error compounded
// down the flow until whole page boundaries moved.
//
// Every test here is DIFFERENTIAL. The oracle is the same tree laid out cold, with no
// session; any disagreement IS the bug, whatever the numbers happen to be.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { createLayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import type { PageGeometry, SemanticLayout } from '../index.ts';

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
// 14pt lines in an 80pt content column: five bare lines to a page, fewer once rules and
// their `w:space` padding claim height. Small on purpose — a page boundary has to be
// reachable by a one-paragraph edit for the compounding to show.
const SMALL: PageGeometry = {
  width: 200,
  height: 100,
  margin: { top: 10, right: 10, bottom: 10, left: 10 },
};

/** One box rule, `w:sz` in eighths of a point. */
const rule = (side: string, color: string) =>
  `<w:${side} w:val="single" w:sz="8" w:space="4" w:color="${color}"/>`;

/**
 * A paragraph carrying a `w:pBdr` box with NO `w:between`.
 *
 * Word's own default when you box a selection: the group's interior boundaries draw nothing.
 * That makes the grouping question cost real HEIGHT — a member that gains a follower stops
 * spending its closing rule and the `w:space` padding under it — which is what lets a stale
 * verdict compound down the flow until a page boundary moves.
 */
const bordered = (text: string, { color = '000000', extra = '' } = {}) =>
  `<w:p><w:pPr><w:pBdr>` +
  rule('top', color) +
  rule('left', color) +
  rule('bottom', color) +
  rule('right', color) +
  `</w:pBdr>${extra}</w:pPr>` +
  `<w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;

/**
 * The same box with `w:between` authored at the SAME size and spacing as `w:bottom`.
 *
 * Grouping then changes only WHICH rule closes a member, never how much room it claims — the
 * height-neutral shape the convergence tail is asked about.
 */
const borderedBetween = (text: string, { color = '000000' } = {}) =>
  `<w:p><w:pPr><w:pBdr>` +
  rule('top', color) +
  rule('left', color) +
  rule('bottom', color) +
  rule('right', color) +
  rule('between', color) +
  `</w:pBdr></w:pPr>` +
  `<w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;

const plain = (text: string) =>
  `<w:p><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;

const TABLE =
  '<w:tbl><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>' +
  '<w:tr><w:tc>' +
  '<w:p><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>cell</w:t></w:r></w:p>' +
  '</w:tc></w:tr></w:tbl>';

const cold = (part: OoxmlPart): SemanticLayout =>
  layoutSemanticDocument(part, 1, { measurer, geometry: SMALL });

/**
 * Everything the border grouping decides, per fragment: where the box sits, how tall it is,
 * which rules it draws and on which sides, and whether it publishes a `bottomBorder`.
 */
const shapeOf = (layout: SemanticLayout): unknown =>
  layout.pages.map((page) => ({
    index: page.index,
    fragments: page.fragments.map((fragment) => ({
      id: fragment.id,
      box: fragment.box,
      ...(fragment.kind === 'paragraph'
        ? {
            sides: (fragment.borders ?? []).map((stroke) => `${stroke.side}@${stroke.box.y}`),
            bottomBorder: fragment.bottomBorder !== undefined,
          }
        : {}),
    })),
  }));

/**
 * Lay `before` out, then `after` over the same session, and compare against `after` cold.
 *
 * Both revisions go through one session and one cache, which is what a live editing session
 * does. The cold pass is the oracle.
 */
function differential(before: string, after: string): { warm: unknown; oracle: unknown } {
  const options = {
    measurer,
    geometry: SMALL,
    session: createLayoutSession(),
    cache: createParagraphLayoutCache(),
  };
  layoutSemanticDocument(load(before), 1, options);
  const warm = layoutSemanticDocument(load(after), 2, options);
  return { warm: shapeOf(warm), oracle: shapeOf(cold(load(after))) };
}

describe('a paragraph JOINING the group below it re-places the one above', () => {
  test('a new bordered paragraph appended to a pair', () => {
    // The paragraph that WAS last must give back its bottom rule and the padding under it.
    const { warm, oracle } = differential(
      bordered('one') + bordered('two'),
      bordered('one') + bordered('two') + bordered('three')
    );
    expect(warm).toEqual(oracle);
  });

  test('a plain paragraph that later takes the same borders joins the group', () => {
    const { warm, oracle } = differential(
      bordered('one') + bordered('two') + plain('three'),
      bordered('one') + bordered('two') + bordered('three')
    );
    expect(warm).toEqual(oracle);
  });

  test('the bottomBorder record follows the group, not the paragraph', () => {
    const options = {
      measurer,
      geometry: SMALL,
      session: createLayoutSession(),
      cache: createParagraphLayoutCache(),
    };
    layoutSemanticDocument(load(bordered('one') + bordered('two')), 1, options);
    const warm = layoutSemanticDocument(
      load(bordered('one') + bordered('two') + bordered('three')),
      2,
      options
    );
    const records = warm.pages
      .flatMap((page) => page.fragments)
      .filter((fragment) => fragment.kind === 'paragraph');
    // Only the LAST member of the group closes the box. A middle paragraph publishing a
    // `bottomBorder` draws the block's frame at an interior boundary.
    expect(records.map((fragment) => fragment.bottomBorder !== undefined)).toEqual([
      false,
      false,
      true,
    ]);
  });
});

describe('a paragraph LEAVING the group re-places the one above', () => {
  test('Increase Indent on the last member splits the group', () => {
    // `borderGroupKey` carries the box geometry, so an indent that moves the box makes the
    // paragraph a group of its own — and the one above it has to close.
    const { warm, oracle } = differential(
      bordered('one') + bordered('two') + bordered('three'),
      bordered('one') + bordered('two') + bordered('three', { extra: '<w:ind w:left="720"/>' })
    );
    expect(warm).toEqual(oracle);
  });

  test('a table inserted INTO the group closes the box above it', () => {
    // Into, not below. A table under the last member changes nothing — that member already
    // closed the box — so the only version of this that can catch a stale verdict is the one
    // where the table lands between two members and the first of them has to close.
    const { warm, oracle } = differential(
      bordered('one') + bordered('two') + bordered('three'),
      bordered('one') + bordered('two') + TABLE + bordered('three')
    );
    expect(warm).toEqual(oracle);
  });

  test('the last member losing its borders closes the one above it', () => {
    const { warm, oracle } = differential(
      bordered('one') + bordered('two') + bordered('three'),
      bordered('one') + bordered('two') + plain('three')
    );
    expect(warm).toEqual(oracle);
  });
});

describe('the compounded error moves page boundaries, not only box heights', () => {
  test('a group grown at its end paginates the way the same tree does cold', () => {
    const before = Array.from({ length: 5 }, (_, index) => bordered(`p${index}`)).join('');
    const after = before + bordered('p5');
    const { warm, oracle } = differential(before, after);
    expect(warm).toEqual(oracle);
  });

  test('the page COUNT agrees with the cold pass', () => {
    // The claim the whole fix rests on, and the exact shape that shows it. A member that
    // stops being last gives back its closing rule and the `w:space` padding under it; a
    // stale verdict keeps spending both, and four of them over-fill the page by enough to
    // spill a sheet that the same tree laid out cold does not need.
    const before = Array.from({ length: 4 }, (_, index) => bordered(`p${index}`)).join('');
    const after = before + bordered('p4');
    const options = {
      measurer,
      geometry: SMALL,
      session: createLayoutSession(),
      cache: createParagraphLayoutCache(),
    };
    layoutSemanticDocument(load(before), 1, options);
    const warm = layoutSemanticDocument(load(after), 2, options);
    expect(cold(load(after)).pages.length).toBe(1);
    expect(warm.pages.length).toBe(1);
  });
});

// The BACKWARD bit. Resume is a prefix cut, which makes a backward dependency safe: the
// earlier block moving re-places everything after it. The convergence tail is a SUFFIX cut,
// where backward is the exposed direction — so `above` is folded too.
//
// BOTH CASES BELOW HOLD WITHOUT THE FOLD, and that is recorded rather than hidden: the tail's
// guard compares fragment signatures, and `semantic-fragment-signature.ts` hashes every
// `w:pBdr` stroke, so a recoloured group moves the signature of the paragraph that changed.
// These are regression tests for the tail, not proofs of the fold — `borderGroupFlowKeys` in
// `pagination-keeps.test.ts` is what pins the `above` bit itself.
describe('a group change ABOVE a block', () => {
  test('a height-neutral recolour that merges two groups agrees with the cold pass', () => {
    // `borderedBetween` authors `w:between` at the same size and spacing as `w:bottom`, so
    // the paragraph that gains a follower closes at exactly the same height — nothing about
    // the flow moves. The paragraph BELOW still has to stop drawing its own top rule.
    const tail = plain('tail one') + plain('tail two') + plain('tail three');
    const before =
      plain('head') + borderedBetween('a', { color: 'FF0000' }) + borderedBetween('b') + tail;
    const after = plain('head') + borderedBetween('a') + borderedBetween('b') + tail;
    const { warm, oracle } = differential(before, after);
    expect(warm).toEqual(oracle);
  });

  test('the same recolour across a page boundary agrees with the cold pass', () => {
    // Three fillers put the recoloured paragraph last on page 1 and the one that reads it
    // first on page 2. The checkpoint at that block is still taken with the previous page's
    // fragments pending — `checkpointNow` runs BEFORE placement, and the flush happens while
    // placing the block after — so this does not reach an empty pending page. It stands as a
    // page-boundary regression case, not as a second mechanism.
    const fillers = Array.from({ length: 3 }, (_, index) => plain(`f${index}`)).join('');
    const tail = plain('tail one') + plain('tail two') + plain('tail three');
    const before =
      fillers + borderedBetween('a', { color: 'FF0000' }) + borderedBetween('b') + tail;
    const after = fillers + borderedBetween('a') + borderedBetween('b') + tail;
    const { warm, oracle } = differential(before, after);
    expect(warm).toEqual(oracle);
  });
});

describe('a document with no borders is not made to churn', () => {
  test('a no-change pass still returns the previous pages by identity', () => {
    const part = load(plain('one') + plain('two') + plain('three'));
    const options = {
      measurer,
      geometry: SMALL,
      session: createLayoutSession(),
      cache: createParagraphLayoutCache(),
    };
    const first = layoutSemanticDocument(part, 1, options);
    expect(layoutSemanticDocument(part, 2, options).pages).toBe(first.pages);
  });

  test('a no-change pass over a BORDERED document also returns pages by identity', () => {
    const part = load(bordered('one') + bordered('two') + bordered('three'));
    const options = {
      measurer,
      geometry: SMALL,
      session: createLayoutSession(),
      cache: createParagraphLayoutCache(),
    };
    const first = layoutSemanticDocument(part, 1, options);
    expect(layoutSemanticDocument(part, 2, options).pages).toBe(first.pages);
  });
});
