// A paragraph's border box opens where its first line starts (ECMA-376 §17.3.1.24).
//
// In anonymous probes, `w:ind w:left="1701" w:hanging="1701"` draws its box from the margin,
// where the first line starts, not from 1701 twips. Paragraphs with identical `w:pBdr` form
// one bordered group when their BOX edges agree, whatever their `w:left` says: a flush
// paragraph groups with a hanging one whose first line starts at the margin, and two
// paragraphs with equal `w:left` but first lines that start apart stay separate boxes. In a
// right-to-left paragraph the first line starts on the right, so the box reaches past the
// right edge instead. A first-line indent moves the line inward and leaves the box alone.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type {
  ParagraphBorderSide,
  ParagraphFragmentRecord,
  SemanticLayout,
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
const lay = (body: string): SemanticLayout => layoutSemanticDocument(load(body), 1, { measurer });

const BOX =
  '<w:pBdr>' +
  '<w:top w:val="single" w:sz="8" w:space="1" w:color="C00000"/>' +
  '<w:left w:val="single" w:sz="8" w:space="4" w:color="C00000"/>' +
  '<w:bottom w:val="single" w:sz="8" w:space="4" w:color="C00000"/>' +
  '<w:right w:val="single" w:sz="8" w:space="4" w:color="C00000"/>' +
  '</w:pBdr>';

/** A boxed one-word paragraph with optional extra `w:pPr` content (indent, `w:bidi`). */
const boxed = (text: string, extra = '') =>
  `<w:p><w:pPr>${BOX}${extra}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;

const FLUSH = '';
const HANGING = '<w:ind w:left="1701" w:hanging="1701"/>';
const INDENTED = '<w:ind w:left="1701"/>';
const FIRST_LINE = '<w:ind w:firstLine="850"/>';
const RTL = '<w:bidi/>';
// In a right-to-left paragraph `w:left` is the leading (right) indent and `w:right` the
// trailing (left) one.
const RTL_HANGING_PAST_EDGE = '<w:bidi/><w:ind w:right="1701" w:hanging="1701"/>';
const RTL_TRAILING = '<w:bidi/><w:ind w:right="1701"/>';
const RTL_HANGING_AT_EDGE = '<w:bidi/><w:ind w:left="1701" w:hanging="1701"/>';

/** Bordered body paragraph fragments, in reading order. */
function bodyParagraphs(layout: SemanticLayout): ParagraphFragmentRecord[] {
  return layout.pages.flatMap((page) =>
    page.fragments.filter(
      (fragment): fragment is ParagraphFragmentRecord =>
        fragment.kind === 'paragraph' && (fragment.borders ?? []).length > 0
    )
  );
}

function cellParagraphs(layout: SemanticLayout): ParagraphFragmentRecord[] {
  const found: ParagraphFragmentRecord[] = [];
  for (const page of layout.pages) {
    for (const fragment of page.fragments) {
      if (fragment.kind !== 'table') continue;
      for (const row of fragment.rows) {
        for (const cell of row.cells) {
          for (const block of cell.blocks) if (block.kind === 'paragraph') found.push(block);
        }
      }
    }
  }
  return found;
}

function stroke(fragment: ParagraphFragmentRecord, side: ParagraphBorderSide) {
  const found = (fragment.borders ?? []).find((entry) => entry.side === side);
  if (!found) throw new Error(`no ${side} stroke on ${fragment.id}`);
  return found;
}

/** How many top and bottom rules a run of fragments draws: one each for one group. */
function rules(fragments: readonly ParagraphFragmentRecord[]) {
  const all = fragments.flatMap((fragment) => fragment.borders ?? []);
  return {
    top: all.filter((entry) => entry.side === 'top').length,
    bottom: all.filter((entry) => entry.side === 'bottom').length,
  };
}

describe('the box opens at the first-line start', () => {
  test('a hanging paragraph whose first line starts at the margin boxes from the margin', () => {
    const [flush, hanging] = bodyParagraphs(
      lay(boxed('a', FLUSH) + '<w:p/>' + boxed('b', HANGING))
    );
    expect(stroke(hanging!, 'left').box.x).toBe(stroke(flush!, 'left').box.x);
    expect(stroke(hanging!, 'top').box.x).toBe(stroke(flush!, 'top').box.x);
    expect(stroke(hanging!, 'top').box.width).toBe(stroke(flush!, 'top').box.width);
  });

  test('an indented paragraph without a hanging indent keeps its box at the indent', () => {
    const [flush, indented] = bodyParagraphs(
      lay(boxed('a', FLUSH) + '<w:p/>' + boxed('b', INDENTED))
    );
    expect(stroke(indented!, 'left').box.x - stroke(flush!, 'left').box.x).toBeCloseTo(85.05, 5);
  });

  test('a first-line indent leaves the box at the paragraph indent', () => {
    const [flush, firstLine] = bodyParagraphs(
      lay(boxed('a', FLUSH) + '<w:p/>' + boxed('b', FIRST_LINE))
    );
    expect(stroke(firstLine!, 'left').box.x).toBe(stroke(flush!, 'left').box.x);
  });

  test('a right-to-left hanging paragraph reaches past its right edge', () => {
    const [plain, hanging] = bodyParagraphs(
      lay(boxed('a', RTL) + '<w:p/>' + boxed('b', RTL_HANGING_PAST_EDGE))
    );
    expect(stroke(hanging!, 'right').box.x - stroke(plain!, 'right').box.x).toBeCloseTo(85.05, 5);
    expect(stroke(hanging!, 'left').box.x - stroke(plain!, 'left').box.x).toBeCloseTo(85.05, 5);
  });
});

describe('paragraphs group by their box edges', () => {
  test('flush and hanging paragraphs with the same box edge draw one box', () => {
    const fragments = bodyParagraphs(
      lay(boxed('a', FLUSH) + boxed('b', HANGING) + boxed('c', FLUSH))
    );
    expect(rules(fragments)).toEqual({ top: 1, bottom: 1 });
    // No border padding between the members: each line follows the previous one directly.
    expect(fragments[1]!.lines[0]!.box.y).toBe(
      fragments[0]!.lines[0]!.box.y + fragments[0]!.lines[0]!.box.height
    );
  });

  test('a first-line indent groups with a flush paragraph', () => {
    expect(rules(bodyParagraphs(lay(boxed('a', FLUSH) + boxed('b', FIRST_LINE))))).toEqual({
      top: 1,
      bottom: 1,
    });
  });

  test('equal left indents with first lines that start apart are two boxes', () => {
    expect(rules(bodyParagraphs(lay(boxed('a', INDENTED) + boxed('b', HANGING))))).toEqual({
      top: 2,
      bottom: 2,
    });
  });

  test('right-to-left paragraphs group by the box edge on their leading side', () => {
    expect(rules(bodyParagraphs(lay(boxed('a', RTL) + boxed('b', RTL_HANGING_AT_EDGE))))).toEqual({
      top: 1,
      bottom: 1,
    });
    expect(
      rules(bodyParagraphs(lay(boxed('a', RTL_HANGING_PAST_EDGE) + boxed('b', RTL_TRAILING))))
    ).toEqual({ top: 2, bottom: 2 });
  });

  test('a table cell follows the same box edge and grouping', () => {
    const cell = (content: string) => `<w:tbl><w:tr><w:tc>${content}</w:tc></w:tr></w:tbl>`;
    const [flush, hanging] = cellParagraphs(lay(cell(boxed('a', FLUSH) + boxed('b', HANGING))));
    expect(rules([flush!, hanging!])).toEqual({ top: 1, bottom: 1 });
    expect(stroke(hanging!, 'left').box.x).toBe(stroke(flush!, 'left').box.x);
    const [indented, other] = cellParagraphs(lay(cell(boxed('a', INDENTED) + boxed('b', HANGING))));
    expect(rules([indented!, other!])).toEqual({ top: 2, bottom: 2 });
  });
});
