// Word's paragraph pagination controls: `w:widowControl`, `w:keepNext`, `w:keepLines`
// (ECMA-376 §17.3.1.44, §17.3.1.15, §17.3.1.16).
//
// Every assertion here is about the DISTRIBUTION OF LINES ACROSS A PAGE BOUNDARY, not about a
// property having been read: the whole point of these three is where the cut lands.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { createLayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import {
  adjustedBreakIndex,
  borderGroupFlowKeys,
  composeFlowKeys,
  contextualSpacingFlowKeys,
  keepNextFlowKeys,
  listMarkerFlowKeys,
  tocFieldFlowKeys,
  paragraphKeeps,
  DEFAULT_PARAGRAPH_KEEPS,
  type FlowKeyFoldInputs,
} from '../pagination-keeps.ts';
import type { PageGeometry, PageRecord } from '../semantic-records.ts';
import { paragraphIndent } from '../paragraph-flow.ts';
import { paragraphTabStops } from '../paragraph-tabs.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

// 14pt lines in an 80pt content column: exactly five lines fit on a page.
const measurer = createFixedMeasurer(6, 14);
const SMALL: PageGeometry = {
  width: 200,
  height: 100,
  margin: { top: 10, right: 10, bottom: 10, left: 10 },
};

const lay = (body: string) => layoutSemanticDocument(load(body), 1, { measurer, geometry: SMALL });

// The 6pt/14pt measurer base describes an 11pt run, so every fixture authors `w:sz="22"`.
// Leaning on the terminal fallback instead would measure at 10pt (see `DEFAULT_RUN_STYLE`)
// and scale every line box by 10/11, which is a font-size question, not a pagination one.

/** One line of text, so filler paragraphs are countable. */
const one = (text: string, pPr = '') =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;

/** `count` lines in ONE paragraph, via hard breaks — deterministic, no wrap arithmetic. */
const multi = (count: number, pPr = '') => {
  const runs = Array.from({ length: count }, (_, index) => `<w:t>l${index}</w:t>`).join('<w:br/>');
  return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r><w:rPr><w:sz w:val="22"/></w:rPr>${runs}</w:r></w:p>`;
};

const fillers = (count: number) =>
  Array.from({ length: count }, (_, index) => one(`f${index}`)).join('');

/** Lines on each page, in order — the shape every pagination rule here is about. */
const linesPerPage = (pages: readonly PageRecord[]): number[] =>
  pages.map((page) =>
    page.fragments.reduce((sum, f) => sum + (f.kind === 'paragraph' ? f.lines.length : 0), 0)
  );

const WIDOW_OFF = '<w:widowControl w:val="0"/>';

describe('w:widowControl (§17.3.1.44) — on unless a document turns it off', () => {
  test('an absent property means ON, so it applies to documents that never mention it', () => {
    expect(paragraphKeeps([])).toEqual(DEFAULT_PARAGRAPH_KEEPS);
    expect(paragraphKeeps([]).widowControl).toBe(true);
  });

  test('an explicit w:val="0" turns it off, and a later bare element turns it back on', () => {
    expect(paragraphKeeps([{ localName: 'widowControl', attributes: { val: '0' } }])).toMatchObject(
      {
        widowControl: false,
      }
    );
    // Cascade order is docDefaults → style → direct, so the LAST statement wins.
    expect(
      paragraphKeeps([
        { localName: 'widowControl', attributes: { val: 'false' } },
        { localName: 'widowControl' },
      ]).widowControl
    ).toBe(true);
  });

  test('an orphan is prevented: a lone FIRST line at the page bottom pulls the paragraph over', () => {
    // Four fillers leave room for exactly one more line. Without the rule the two-line
    // paragraph splits 1/1; Word moves both lines instead.
    const layout = lay(fillers(4) + multi(2));
    expect(linesPerPage(layout.pages)).toEqual([4, 2]);
    // And it is ONE fragment, not two — the paragraph was moved, not cut.
    const moved = layout.pages[1]!.fragments.filter((f) => f.kind === 'paragraph');
    expect(moved).toHaveLength(1);
  });

  test('turning it off restores the naive split, proving the rule is what moved the line', () => {
    expect(linesPerPage(lay(fillers(4) + multi(2, WIDOW_OFF)).pages)).toEqual([5, 1]);
  });

  test('a widow is prevented: a lone LAST line at the page top drags a second over with it', () => {
    // Two fillers plus a four-line paragraph would break 3/1. Word breaks 2/2.
    expect(linesPerPage(lay(fillers(2) + multi(4)).pages)).toEqual([4, 2]);
    expect(linesPerPage(lay(fillers(2) + multi(4, WIDOW_OFF)).pages)).toEqual([5, 1]);
  });

  test('a three-line paragraph with room for two moves whole: fixing the widow makes an orphan', () => {
    expect(linesPerPage(lay(fillers(3) + multi(3)).pages)).toEqual([3, 3]);
    expect(linesPerPage(lay(fillers(3) + multi(3, WIDOW_OFF)).pages)).toEqual([5, 1]);
  });

  test('a single-line paragraph is never moved — there is no line to strand', () => {
    expect(linesPerPage(lay(fillers(4) + one('tail')).pages)).toEqual([5]);
  });

  test('a paragraph taller than a page still fragments rather than looping', () => {
    // Nothing can satisfy the rule here, so it fails open and the content is placed.
    const layout = lay(multi(12));
    expect(linesPerPage(layout.pages).reduce((a, b) => a + b, 0)).toBe(12);
    expect(layout.pages.length).toBeGreaterThan(1);
  });
});

describe('w:keepLines (§17.3.1.16) — every line of one paragraph on one page', () => {
  test('a paragraph that would split moves whole, past what widow control alone would do', () => {
    // One filler leaves room for four of the five lines. Widow control alone breaks 3/2;
    // keepLines moves all five.
    expect(linesPerPage(lay(one('f0') + multi(5)).pages)).toEqual([4, 2]);
    expect(linesPerPage(lay(one('f0') + multi(5, '<w:keepLines/>')).pages)).toEqual([1, 5]);
  });

  test('w:val="0" is an explicit off, so the paragraph splits again', () => {
    expect(
      linesPerPage(lay(one('f0') + multi(5, '<w:keepLines w:val="0"/>' + WIDOW_OFF)).pages)
    ).toEqual([5, 1]);
  });

  test('a paragraph taller than a page fails open and fragments — Word gives up, it does not hang', () => {
    const layout = lay(multi(12, '<w:keepLines/>'));
    expect(linesPerPage(layout.pages).reduce((a, b) => a + b, 0)).toBe(12);
    expect(layout.pages.length).toBeGreaterThan(1);
  });
});

describe('w:keepNext (§17.3.1.15) — stay on the page the next paragraph starts on', () => {
  test('a heading at the foot of a page moves down to meet its body text', () => {
    const body = fillers(4) + one('heading', '<w:keepNext/>') + one('body');
    expect(linesPerPage(lay(body).pages)).toEqual([4, 2]);
    // Without the property the heading is stranded as the last line of page one.
    expect(linesPerPage(lay(fillers(4) + one('heading') + one('body')).pages)).toEqual([5, 1]);
  });

  test('a heading follows a three-line successor that widow control moves whole', () => {
    const body = fillers(2) + one('heading', '<w:keepNext/>') + multi(3);
    expect(linesPerPage(lay(body).pages)).toEqual([2, 4]);
  });

  test('a heading follows a successor whose keepLines requires the whole paragraph', () => {
    const body = fillers(1) + one('heading', '<w:keepNext/>') + multi(4, '<w:keepLines/>');
    expect(linesPerPage(lay(body).pages)).toEqual([1, 5]);
  });

  test('a keepLines group fits after natural page movement suppresses heading space before', () => {
    const body =
      fillers(2) +
      one('heading', '<w:keepNext/><w:spacing w:before="300"/>') +
      multi(4, '<w:keepLines/>');
    expect(linesPerPage(lay(body).pages)).toEqual([2, 5]);
  });

  test('a short widow-controlled successor fits after heading space before is suppressed', () => {
    const body = fillers(2) + multi(2, '<w:keepNext/><w:spacing w:before="300"/>') + multi(3);
    expect(linesPerPage(lay(body).pages)).toEqual([2, 5]);
  });

  test('contextual heading space before does not make a kept group too large', () => {
    const body =
      fillers(2) +
      one('heading', '<w:keepNext/><w:contextualSpacing/><w:spacing w:before="800"/>') +
      multi(4, '<w:keepLines/>');
    expect(linesPerPage(lay(body).pages)).toEqual([2, 5]);
  });

  test('a group that fits beside its heading does not move for suppressed contextual spacing', () => {
    const body =
      fillers(1) +
      one('heading', '<w:keepNext/><w:contextualSpacing/><w:spacing w:before="300"/>') +
      multi(3, '<w:keepLines/>');
    expect(linesPerPage(lay(body).pages)).toEqual([5]);
  });

  test('current-page fit still includes unsuppressed heading space before', () => {
    const body =
      fillers(1) +
      one('heading', '<w:keepNext/><w:spacing w:before="300"/>') +
      multi(3, '<w:keepLines/>');
    expect(linesPerPage(lay(body).pages)).toEqual([1, 4]);
  });

  test('a section-leading group keeps its authored space before', () => {
    const body =
      one('heading', '<w:keepNext/><w:spacing w:before="300"/>') + multi(4, '<w:keepLines/>');
    const pages = lay(body).pages;
    expect(linesPerPage(pages)).toEqual([1, 4]);
    const heading = pages[0]!.fragments[0]!;
    expect(heading.kind === 'paragraph' && heading.spacing.before).toBe(15);
  });

  test('a four-line successor can still split with two lines beside its heading', () => {
    const body = fillers(2) + one('heading', '<w:keepNext/>') + multi(4);
    expect(linesPerPage(lay(body).pages)).toEqual([5, 2]);
  });

  test('turning off widow control permits a three-line successor to split', () => {
    const body = fillers(2) + one('heading', '<w:keepNext/>') + multi(3, WIDOW_OFF);
    expect(linesPerPage(lay(body).pages)).toEqual([5, 1]);
  });

  for (const kind of ['page', 'column']) {
    test(`a ${kind} break ends the successor prefix priced for widow control`, () => {
      const successor = multi(3).replace('<w:br/>', `<w:br w:type="${kind}"/>`);
      expect(
        linesPerPage(lay(fillers(2) + one('heading', '<w:keepNext/>') + successor).pages)
      ).toEqual([4, 2]);
    });

    test(`widow pricing permits a two-line prefix before a later ${kind} break`, () => {
      const successor = multi(4).replace(
        '<w:t>l2</w:t><w:br/>',
        `<w:t>l2</w:t><w:br w:type="${kind}"/>`
      );
      expect(
        linesPerPage(lay(fillers(2) + one('heading', '<w:keepNext/>') + successor).pages)
      ).toEqual([5, 1, 1]);
    });

    test(`keepLines does not price successor lines after a ${kind} break`, () => {
      const successor = multi(3, '<w:keepLines/>').replace(
        '<w:t>l1</w:t><w:br/>',
        `<w:t>l1</w:t><w:br w:type="${kind}"/>`
      );
      expect(
        linesPerPage(lay(fillers(2) + one('heading', '<w:keepNext/>') + successor).pages)
      ).toEqual([5, 1]);
    });

    test(`an internal ${kind} break stops lookahead into later keep-chain members`, () => {
      const successor = multi(3, '<w:keepNext/>').replace('<w:br/>', `<w:br w:type="${kind}"/>`);
      const body = fillers(2) + one('heading', '<w:keepNext/>') + successor + multi(3);
      expect(linesPerPage(lay(body).pages)).toEqual([4, 5]);
    });
  }

  test('a later column break keeps the heading in the first column when two successor lines fit', () => {
    const successor = multi(4).replace(
      '<w:t>l2</w:t><w:br/>',
      '<w:t>l2</w:t><w:br w:type="column"/>'
    );
    const body = fillers(2) + one('heading', '<w:keepNext/>') + successor;
    const pages = lay(body + '<w:sectPr><w:cols w:num="2" w:space="400"/></w:sectPr>').pages;
    expect(linesPerPage(pages)).toEqual([6, 1]);
    const heading = pages[0]!.fragments.find(
      (fragment) => fragment.kind === 'paragraph' && fragment.paragraphId.endsWith('.2')
    );
    expect(heading?.box.x).toBe(0);
  });

  test('a successor page break before ends the keep group', () => {
    const body = fillers(2) + one('heading', '<w:keepNext/>') + multi(3, '<w:pageBreakBefore/>');
    expect(linesPerPage(lay(body).pages)).toEqual([3, 3]);
  });

  test('keepLines on a successor with page break before adds no extra heading page', () => {
    const body =
      fillers(1) + one('heading', '<w:keepNext/>') + multi(4, '<w:pageBreakBefore/><w:keepLines/>');
    expect(linesPerPage(lay(body).pages)).toEqual([2, 4]);
  });

  test('a successor page break before discards trailing paragraph spacing from the group', () => {
    const body =
      fillers(2) +
      one('heading', '<w:keepNext/><w:spacing w:after="800"/>') +
      multi(3, '<w:pageBreakBefore/>');
    expect(linesPerPage(lay(body).pages)).toEqual([3, 3]);
  });

  test('a page break before an internal chain member ends the preceding group', () => {
    const body =
      fillers(2) +
      one('h1', '<w:keepNext/>') +
      one('h2', '<w:pageBreakBefore/><w:keepNext/>') +
      multi(3);
    expect(linesPerPage(lay(body).pages)).toEqual([3, 4]);
  });

  // The empty mark never opens a sheet, so nothing keeps with it: the heading stays with the
  // fillers, the mark rides below them, and the next section opens the next sheet.
  test('a keepNext paragraph before an empty section mark is priced alone', () => {
    const section =
      '<w:sectPr><w:pgSz w:w="4000" w:h="2000"/><w:pgMar w:top="200" w:right="200" w:bottom="200" w:left="200"/></w:sectPr>';
    const mark =
      '<w:p><w:pPr><w:pageBreakBefore/><w:rPr><w:sz w:val="22"/></w:rPr>' +
      section +
      '</w:pPr></w:p>';
    const body = fillers(4) + one('heading', '<w:keepNext/>') + mark + one('next') + section;
    expect(linesPerPage(lay(body).pages)).toEqual([6, 1]);
  });

  test('a chain of keepNext paragraphs moves together, not one at a time', () => {
    const body = fillers(4) + one('h1', '<w:keepNext/>') + one('h2', '<w:keepNext/>') + one('body');
    expect(linesPerPage(lay(body).pages)).toEqual([4, 3]);
  });

  test('a chain that cannot fit a page of its own is abandoned, and everything is still placed', () => {
    // The kept-with paragraph is twelve lines that may not split: no page can hold the group.
    const body =
      fillers(4) +
      one('h1', '<w:keepNext/>') +
      multi(12, '<w:keepNext/><w:keepLines/>') +
      one('end');
    const layout = lay(body);
    expect(linesPerPage(layout.pages)[0]).toBe(5);
    expect(linesPerPage(layout.pages).reduce((a, b) => a + b, 0)).toBe(4 + 1 + 12 + 1);
  });

  test('the last paragraph of a story keeps with nothing, so it is not moved', () => {
    expect(linesPerPage(lay(fillers(4) + one('tail', '<w:keepNext/>')).pages)).toEqual([5]);
  });

  test('a keepNext paragraph followed by a table moves with the table opening', () => {
    // The table's first row has no room beside the heading, so both start the next page.
    const table = `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
    const layout = lay(fillers(4) + one('heading', '<w:keepNext/>') + table);
    expect(linesPerPage(layout.pages)[0]).toBe(4);
  });
});

describe('the keeps are style-inheritable, not direct-only', () => {
  test('cascaded properties are what the rule reads, so a style can carry the keep', () => {
    // `paragraphKeeps` is fed the CASCADED bag, so a style contributing `w:keepNext` reaches
    // the rule exactly as a direct `w:pPr` child would.
    expect(paragraphKeeps([{ localName: 'keepNext' }, { localName: 'keepLines' }])).toEqual({
      keepNext: true,
      keepLines: true,
      widowControl: true,
    });
  });
});

describe('the break-retreat rule in isolation', () => {
  const keeps = (over: Partial<typeof DEFAULT_PARAGRAPH_KEEPS>) => ({
    ...DEFAULT_PARAGRAPH_KEEPS,
    ...over,
  });

  test('a break with two lines each side is already legal and does not move', () => {
    expect(adjustedBreakIndex(2, 0, 4, keeps({}), false)).toBe(2);
  });

  test('a break leaving one line behind retreats to move the paragraph whole', () => {
    expect(adjustedBreakIndex(1, 0, 3, keeps({}), false)).toBe(0);
  });

  test('a break stranding the last line retreats by one', () => {
    expect(adjustedBreakIndex(3, 0, 4, keeps({}), false)).toBe(2);
  });

  test('keepLines retreats to the start of what the page holds', () => {
    expect(adjustedBreakIndex(4, 0, 5, keeps({ keepLines: true }), false)).toBe(0);
  });

  test('no retreat is offered when it could not progress — the paragraph already owns the page', () => {
    // Two lines with room for one: retreating moves both onto an identical empty page.
    expect(adjustedBreakIndex(1, 0, 2, keeps({}), true)).toBe(1);
    expect(adjustedBreakIndex(1, 0, 2, keeps({ keepLines: true }), true)).toBe(1);
  });

  test('keepLines on a page the paragraph owns still yields to widow control', () => {
    // Five lines, four fit, nothing can hold all five: keepLines gives up, but pulling the
    // cut back one line still stops the fifth opening the next page alone.
    expect(adjustedBreakIndex(4, 0, 5, keeps({ keepLines: true }), true)).toBe(3);
  });

  test('widow control off leaves the natural break alone', () => {
    expect(adjustedBreakIndex(3, 0, 4, keeps({ widowControl: false }), false)).toBe(3);
  });
});

describe('incremental layout still reuses pages by identity (task 9.4)', () => {
  const session = () => createLayoutSession();

  test('a no-change pass over a document with keeps returns the SAME page objects', () => {
    const part = load(fillers(4) + one('heading', '<w:keepNext/>') + multi(3));
    const options = {
      measurer,
      geometry: SMALL,
      session: session(),
      cache: createParagraphLayoutCache(),
    };
    const first = layoutSemanticDocument(part, 1, options);
    const second = layoutSemanticDocument(part, 2, options);
    expect(second.pages).toBe(first.pages);
    for (const [index, page] of second.pages.entries()) expect(page).toBe(first.pages[index]!);
  });

  test('editing a successor between three and four lines repositions its heading', () => {
    const part = (lines: number) =>
      load(fillers(2) + one('heading', '<w:keepNext/>') + multi(lines));
    const options = {
      measurer,
      geometry: SMALL,
      session: session(),
      cache: createParagraphLayoutCache(),
    };
    for (const [revision, lines] of [3, 4, 3].entries()) {
      const document = part(lines);
      const retained = layoutSemanticDocument(document, revision + 1, options);
      const fresh = layoutSemanticDocument(document, revision + 1, { measurer, geometry: SMALL });
      expect(linesPerPage(retained.pages)).toEqual(lines === 3 ? [2, 4] : [5, 2]);
      expect(retained.pages).toEqual(fresh.pages);
    }
  });

  test('editing the block a keepNext paragraph is kept WITH re-decides the keep', () => {
    // The heading fits beside a one-line body, so nothing moves. Grow the body past what the
    // page can hold beside the heading and the pair must move together — which only happens
    // if the heading's flow key saw the body change.
    const before = load(fillers(3) + one('heading', '<w:keepNext/>') + one('body'));
    const after = load(fillers(3) + one('heading', '<w:keepNext/>') + multi(3));
    const options = {
      measurer,
      geometry: SMALL,
      session: session(),
      cache: createParagraphLayoutCache(),
    };
    expect(linesPerPage(layoutSemanticDocument(before, 1, options).pages)).toEqual([5]);
    const grown = layoutSemanticDocument(after, 2, options);
    expect(linesPerPage(grown.pages)).toEqual([3, 4]);
    // Same answer as a cold pass with no session at all.
    expect(
      linesPerPage(layoutSemanticDocument(after, 1, { measurer, geometry: SMALL }).pages)
    ).toEqual(linesPerPage(grown.pages));
  });

  test('an incremental pass produces the same line ids a cold pass does', () => {
    // The retreat hands line ids back before re-placing, so an un-placed line keeps its id.
    const part = load(fillers(2) + multi(4) + one('tail'));
    const options = {
      measurer,
      geometry: SMALL,
      session: session(),
      cache: createParagraphLayoutCache(),
    };
    layoutSemanticDocument(load(fillers(2) + multi(4)), 1, options);
    const warm = layoutSemanticDocument(part, 2, options);
    const cold = layoutSemanticDocument(part, 1, { measurer, geometry: SMALL });
    const ids = (pages: readonly PageRecord[]) =>
      pages.flatMap((page) =>
        page.fragments.flatMap((f) => (f.kind === 'paragraph' ? f.lines.map((l) => l.id) : []))
      );
    expect(ids(warm.pages)).toEqual(ids(cold.pages));
  });
});

describe('w:ind digit cap (C3) — a hostile indent cannot reach paint geometry', () => {
  test('a 1000-digit w:left is dropped rather than becoming Infinity', () => {
    const huge = '9'.repeat(1000);
    const indent = paragraphIndent([{ localName: 'ind', attributes: { left: huge } }]);
    expect(indent.left).toBe(0);
    expect(Number.isFinite(indent.left)).toBe(true);
  });

  test('an over-long but finite value is dropped, matching the sibling readers', () => {
    // Ten digits: `Number` handles it, but every other reader in layout caps at nine.
    expect(paragraphIndent([{ localName: 'ind', attributes: { left: '1234567890' } }]).left).toBe(
      0
    );
  });

  test('an in-range value still clamps rather than running away', () => {
    // 999_999_999 twips is nine digits and passes the pattern; the clamp holds it at 22".
    const indent = paragraphIndent([{ localName: 'ind', attributes: { left: '999999999' } }]);
    expect(indent.left).toBe(31_680 / 20);
  });

  test('negative indents survive, clamped symmetrically', () => {
    expect(paragraphIndent([{ localName: 'ind', attributes: { left: '-720' } }]).left).toBe(-36);
    expect(
      paragraphIndent([{ localName: 'ind', attributes: { right: '-99999999999' } }]).right
    ).toBe(0);
  });

  test('ordinary indents are untouched', () => {
    const indent = paragraphIndent([
      { localName: 'ind', attributes: { left: '720', right: '360' } },
    ]);
    expect(indent).toEqual({ left: 36, right: 18 });
  });
});

describe('ISO 29500 Strict tab alignments (B12)', () => {
  const tabs = (xml: string) => {
    const part = load(`<w:p><w:pPr><w:tabs>${xml}</w:tabs></w:pPr></w:p>`);
    // document → body → p → pPr
    return paragraphTabStops(part.root.children[0]!.children[0]!.children[0]!);
  };

  test('w:val="end" is a RIGHT stop, not a dropped one', () => {
    // A Strict-saved table of contents writes `end`; dropping it sent every page number to a
    // default-interval left tab.
    const resolved = tabs('<w:tab w:val="end" w:pos="3600" w:leader="dot"/>');
    expect(resolved.stops).toHaveLength(1);
    expect(resolved.stops[0]).toMatchObject({ positionPt: 180, alignment: 'right', leader: 'dot' });
  });

  test('w:val="start" is a LEFT stop', () => {
    expect(tabs('<w:tab w:val="start" w:pos="1440"/>').stops[0]).toMatchObject({
      positionPt: 72,
      alignment: 'left',
    });
  });

  test('the transitional spellings are unchanged', () => {
    const resolved = tabs(
      '<w:tab w:val="left" w:pos="720"/><w:tab w:val="center" w:pos="1440"/>' +
        '<w:tab w:val="right" w:pos="2160"/><w:tab w:val="decimal" w:pos="2880"/>'
    );
    expect(resolved.stops.map((stop) => stop.alignment)).toEqual([
      'left',
      'center',
      'right',
      'decimal',
    ]);
  });

  test('a genuinely unknown alignment is still ignored', () => {
    expect(tabs('<w:tab w:val="sideways" w:pos="720"/>').stops).toHaveLength(0);
    // `bar` and `num` are not stops.
    expect(tabs('<w:tab w:val="bar" w:pos="720"/>').stops).toHaveLength(0);
  });
});

// `w:contextualSpacing` (§17.3.1.9) is a CROSS-BLOCK property: it drops a paragraph's space
// on the side where the neighbour is a paragraph of the same style, so a block's height is a
// function of two blocks it does not contain. Incremental resume compares flow keys and
// re-places from the first that moved, which makes the fold the whole mechanism — a verdict
// that changes without moving a key is a paragraph that keeps its old spacing until the
// document is reopened.
//
// These pin the fold's boundary answers, and the correspondence between `styleAt` here and
// `sameStyleAs` in `semantic-layout.ts`. Everything else about the property rests on it.
describe('contextualSpacingFlowKeys — the cross-block fold', () => {
  const KEYS = ['a', 'b', 'c'];
  const all = () => true;

  test('nothing contextual returns the SAME array, not a copy', () => {
    // Identity is the contract: the prepass memo and the unchanged-document exit both lean
    // on flow keys not churning when no block reads across a boundary.
    expect(
      contextualSpacingFlowKeys(
        KEYS,
        () => false,
        () => 'Tight'
      )
    ).toBe(KEYS);
  });

  test('a run of one style records which SIDES match', () => {
    const flow = contextualSpacingFlowKeys(KEYS, all, () => 'Tight');
    // First has no block before it, last has none after it; the middle matches on both.
    expect(flow).toEqual(['a~cs~01', 'b~cs~11', 'c~cs~10']);
  });

  test('a neighbour of a DIFFERENT style does not match', () => {
    const styles = ['Tight', 'Other', 'Tight'];
    const flow = contextualSpacingFlowKeys(KEYS, all, (index) => styles[index]!);
    expect(flow).toEqual(['a~cs~00', 'b~cs~00', 'c~cs~00']);
  });

  test('a null style is never a match on either side, and takes no token', () => {
    // `styleAt` answers null for a table, and for a paragraph with no resolved style. That
    // mirrors `sameStyleAs`, whose `styleId !== null` guard makes both sides false.
    const styles: (string | null)[] = ['Tight', null, 'Tight'];
    const flow = contextualSpacingFlowKeys(KEYS, all, (index) => styles[index]!);
    expect(flow).toEqual(['a~cs~00', 'b', 'c~cs~00']);
  });

  test('only the contextual blocks are keyed', () => {
    const flow = contextualSpacingFlowKeys(
      KEYS,
      (index) => index === 1,
      () => 'Tight'
    );
    expect(flow).toEqual(['a', 'b~cs~11', 'c']);
  });

  test('the verdict MOVES when a same-style neighbour arrives — the bug this exists for', () => {
    const before = contextualSpacingFlowKeys(['a', 'b'], all, () => 'Tight');
    const after = contextualSpacingFlowKeys(['a', 'b', 'c'], all, () => 'Tight');
    // `b` was last and carried its space-after; now a same-style block follows it.
    expect(before[1]).toBe('b~cs~10');
    expect(after[1]).toBe('b~cs~11');
    expect(after[1]).not.toBe(before[1]);
  });
});

describe('borderGroupFlowKeys — the border-group fold', () => {
  const KEYS = ['a', 'b', 'c'];

  test('no borders anywhere returns the SAME array, not a copy', () => {
    expect(borderGroupFlowKeys(KEYS, () => '')).toBe(KEYS);
  });

  test('a run of one border group records which SIDES continue', () => {
    const flow = borderGroupFlowKeys(KEYS, () => 'box');
    // The first has nothing above it, the last nothing below; the middle continues both ways.
    expect(flow).toEqual(['a~bg~01', 'b~bg~11', 'c~bg~10']);
  });

  test('a DIFFERENT group on either side does not continue', () => {
    const groups = ['box', 'other', 'box'];
    const flow = borderGroupFlowKeys(KEYS, (index) => groups[index]!);
    expect(flow).toEqual(['a~bg~00', 'b~bg~00', 'c~bg~00']);
  });

  test('a block with no borders takes no token and breaks the group', () => {
    // `''` is a table, or a paragraph with no `w:pBdr` at all. Two of them are not a group
    // with each other, which is what keeps an ordinary document out of the fold entirely.
    const groups = ['box', '', 'box'];
    const flow = borderGroupFlowKeys(KEYS, (index) => groups[index]!);
    expect(flow).toEqual(['a~bg~00', 'b', 'c~bg~00']);
  });

  test('the verdict MOVES when a member arrives below — the bug this exists for', () => {
    const before = borderGroupFlowKeys(['a', 'b'], () => 'box');
    const after = borderGroupFlowKeys(['a', 'b', 'c'], () => 'box');
    // `b` closed the box; now a third member does, and `b` has to draw `between` instead.
    expect(before[1]).toBe('b~bg~10');
    expect(after[1]).toBe('b~bg~11');
  });

  test('the verdict MOVES when the member ABOVE joins the group', () => {
    // The backward bit. Resume never needs it — the block above moving re-places everything
    // after — but the convergence tail is a suffix cut, where backward is the exposed side.
    const apart = borderGroupFlowKeys(KEYS, (index) => (index === 0 ? 'other' : 'box'));
    const together = borderGroupFlowKeys(KEYS, () => 'box');
    expect(apart[1]).toBe('b~bg~01');
    expect(together[1]).toBe('b~bg~11');
  });

  test('an indent that moves the box splits the group', () => {
    // `borderGroupKey` carries the box geometry as well as the rules, so Increase Indent on
    // one member is a different key and the paragraph above it has to close.
    const groups = ['box@0,468', 'box@0,468', 'box@36,468'];
    const flow = borderGroupFlowKeys(KEYS, (index) => groups[index]!);
    expect(flow).toEqual(['a~bg~01', 'b~bg~10', 'c~bg~00']);
  });
});

describe('tocFieldFlowKeys — the TOC field fold', () => {
  const KEYS = ['begin', 'result', 'end'];

  test('a document with no TOC returns the SAME array, not a copy', () => {
    expect(tocFieldFlowKeys(KEYS, () => '')).toBe(KEYS);
  });

  test('only the blocks a TOC touches are keyed', () => {
    const verdicts = ['100', '', '100'];
    expect(tocFieldFlowKeys(KEYS, (index) => verdicts[index]!)).toEqual([
      'begin~toc~100',
      'result',
      'end~toc~100',
    ]);
  });

  test('the begin paragraph re-places when the TOC empties under it', () => {
    // Chrome-only while the results carry text; chrome plus placeholder once they do not.
    // The begin paragraph itself does not change one byte between the two.
    const filled = tocFieldFlowKeys(KEYS, (index) => (index === 0 ? '100' : ''));
    const emptied = tocFieldFlowKeys(KEYS, (index) => (index === 0 ? '110' : ''));
    expect(filled[0]).toBe('begin~toc~100');
    expect(emptied[0]).toBe('begin~toc~110');
  });
});

// `keepNextFlowKeys` splices a neighbour's WHOLE key in, so it has to fold last or a chain
// head carries its members' pre-fold keys.
describe('keepNextFlowKeys folds over the other folds', () => {
  test('a chain head carries the successor key INCLUDING its contextual verdict', () => {
    const folded = contextualSpacingFlowKeys(
      ['h', 'p'],
      (index) => index === 1,
      () => 'Tight'
    );
    const flow = keepNextFlowKeys(folded, (index) => index === 0);
    // The head splices in the AUGMENTED successor key, so a verdict flip under it moves
    // the head's own key too. Folded the other way round the head would carry a bare `p`.
    expect(flow[0]).toBe('h~kn~7:p~cs~10.');
  });

  test('a chain head carries the successor key INCLUDING its border-group verdict', () => {
    const folded = borderGroupFlowKeys(['h', 'p'], () => 'box');
    const flow = keepNextFlowKeys(folded, (index) => index === 0);
    // The head carries its OWN group verdict too, then the successor's whole folded key.
    expect(flow[0]).toBe('h~bg~01~kn~7:p~bg~10.');
  });

  test('a chain head carries the successor key INCLUDING its TOC verdict', () => {
    const folded = tocFieldFlowKeys(['h', 'p'], (index) => (index === 1 ? '110' : ''));
    const flow = keepNextFlowKeys(folded, (index) => index === 0);
    expect(flow[0]).toBe('h~kn~9:p~toc~110.');
  });
});

describe('composeFlowKeys — the one composition, and its load-bearing order', () => {
  const none: FlowKeyFoldInputs = {
    contextualSpacingAt: () => false,
    styleIdAt: () => null,
    borderGroupKeyAt: () => '',
    tocVerdicts: [],
    markerTextAt: () => undefined,
    keepsNextAt: () => false,
  };

  test('nothing folding returns the SAME array, not a copy', () => {
    // Identity is the contract: the prepass memo and the unchanged-document exit both
    // lean on flow keys not churning when no block reads across a boundary.
    const keys = ['a', 'b', 'c'];
    expect(composeFlowKeys(keys, none)).toBe(keys);
  });

  test('a terminal table group folds before keep-next and changes all member keys', () => {
    const keys = ['lead', 'table', 'anchor'];
    const fold = (token: string) =>
      composeFlowKeys(keys, {
        ...none,
        terminalTableGroup: { start: 1, anchorIndex: 2, token },
        keepsNextAt: (index) => index === 0,
      });
    const before = fold('empty');
    const after = fold('bookmarked');
    expect(before[0]).toBe(`lead~kn~${before[1]!.length}:${before[1]}`);
    for (let index = 0; index < keys.length; index++) expect(after[index]).not.toBe(before[index]);
  });

  test('a keep-next chain head carries its successor POST-fold — every other fold first', () => {
    // Block 0 keeps with block 1; block 1 carries a marker, a contextual verdict and a
    // border-group verdict. The head must splice block 1's FINISHED key: run keepNext
    // before any other fold and the head carries 'b' bare — a head that never re-places
    // when a member's marker, contextual or border verdict moves.
    const composed = composeFlowKeys(['a', 'b'], {
      contextualSpacingAt: (index) => index === 1,
      styleIdAt: () => 'Tight',
      borderGroupKeyAt: (index) => (index === 1 ? 'box' : ''),
      tocVerdicts: ['', '110'],
      markerTextAt: (index) => (index === 1 ? 'M1' : undefined),
      keepsNextAt: (index) => index === 0,
    });
    const successor = composed[1]!;
    expect(successor).toContain('~cs~');
    expect(successor).toContain('~bg~');
    expect(successor).toContain('~toc~110');
    expect(successor).toContain('~mk~M1');
    // The whole finished successor key, spliced verbatim — the order test proper. The
    // trailing `.` records that the successor is the story's last block.
    expect(composed[0]).toBe(`a~kn~${successor.length}:${successor}.`);
  });

  test('the composition equals the folds applied by hand with keepNext LAST', () => {
    const keys = ['a', 'b', 'c'];
    const markerAt = (index: number) => (index === 2 ? 'M2' : undefined);
    const keepsAt = (index: number) => index === 1;
    const byHand = keepNextFlowKeys(listMarkerFlowKeys(keys, markerAt), keepsAt);
    const composed = composeFlowKeys(keys, {
      ...none,
      markerTextAt: markerAt,
      keepsNextAt: keepsAt,
    });
    expect(composed).toEqual(byHand);
  });
});

test('keep-next keys carry the next ordinary chain through positioned frames', () => {
  const fold = (tail: string) =>
    keepNextFlowKeys(
      ['heading', 'positioned', 'anchor', tail],
      (index) => index === 0 || index === 2,
      (index) => index === 1
    );
  const before = fold('short');
  expect(before[0]).toBe('heading~kn~-6:anchor5:short.');
  expect(before[1]).toBe('positioned');
  expect(fold('long')[0]).not.toBe(before[0]);
});
