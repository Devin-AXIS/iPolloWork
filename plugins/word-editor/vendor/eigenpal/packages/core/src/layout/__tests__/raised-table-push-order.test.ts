// Before compatibility mode 15, a paragraph's last line clears a floating table band together
// with its space after (17.3.1.33); mode 15 tests the line alone.
//
// The text-anchored tables of one anchor are placed in source order, each from the flow as it
// stands then. A raised table (negative `w:tblpY`, 17.4.58) that leaves no passage moves the
// earlier lines it covers below it and keeps its own place. A later table of the same anchor is
// placed after that move: it opens below the moved lines and, when it is raised too, pushes
// them again from there.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { SemanticLayout } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p = (text = '', after = 0) =>
  `<w:p><w:pPr><w:spacing w:before="0" w:after="${after}" w:line="240" w:lineRule="exact"/></w:pPr>${
    text ? `<w:r><w:t>${text}</w:t></w:r>` : ''
  }</w:p>`;
/** A one-row table `label`, `height` twips tall (exact) and wider than the text column. */
const table = (label: string, height: number, tblpY?: number) =>
  '<w:tbl><w:tblPr>' +
  (tblpY === undefined
    ? ''
    : `<w:tblpPr w:leftFromText="180" w:rightFromText="180" w:vertAnchor="text" w:horzAnchor="margin" w:tblpY="${tblpY}"/>`) +
  '<w:tblW w:w="9400" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="9400"/></w:tblGrid>' +
  `<w:tr><w:trPr><w:trHeight w:val="${height}" w:hRule="exact"/></w:trPr><w:tc>${p(label)}</w:tc></w:tr>` +
  '</w:tbl>';
const lay = (body: string, compatibilityMode?: number): SemanticLayout => {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  return layoutSemanticDocument(read.part, 0, {
    measurer: createFixedMeasurer(6, 12),
    ...(compatibilityMode === undefined ? {} : { compatibilityMode }),
  });
};

/** The top of every table and text line on page one, keyed by its first text. */
function tops(layout: SemanticLayout): Record<string, number> {
  const result: Record<string, number> = {};
  for (const fragment of layout.pages[0]!.fragments) {
    if (fragment.kind === 'table') {
      const cell = fragment.rows[0]!.cells[0]!.blocks[0]!;
      if (cell.kind === 'paragraph')
        result[cell.lines[0]!.spans.map((span) => span.text).join('')] = Number(
          fragment.box.y.toFixed(1)
        );
    } else if (fragment.kind === 'paragraph') {
      for (const line of fragment.lines) {
        const text = line.spans.map((span) => span.text).join('');
        if (text) result[text] = Number(line.box.y.toFixed(1));
      }
    }
  }
  return result;
}

// ONE ends at 100pt. The empty paragraph after TWO (15pt below ONE) stands at 100-112pt, so the
// last paragraph starts at 112pt before anything moves. THREE rises 3pt above it, at 109pt,
// covers the empty paragraph, and moves it below THREE and then below TWO, to 215pt.
const opening = table('ONE', 2000) + table('TWO', 2000, 300) + p() + table('THREE', 2000, -60);

test('a later table of the anchor opens below the lines a raised table moved', () => {
  const placed = tops(lay(opening + table('FOUR', 1200, 0) + p('END')));
  expect(placed.THREE).toBeCloseTo(109, 0);
  expect(placed.TWO).toBeCloseTo(115, 0);
  // FOUR opens from the flow after the move: below the moved empty paragraph.
  expect(placed.FOUR).toBeCloseTo(227, 0);
  expect(placed.END).toBeCloseTo(287, 0);
});

test('a later raised table pushes the moved lines again and keeps its own place', () => {
  const placed = tops(lay(opening + table('FOUR', 1200, -400) + p('END')));
  expect(placed.THREE).toBeCloseTo(109, 0);
  // 20pt above where the flow stood after THREE's move; the empty paragraph moves below it.
  expect(placed.FOUR).toBeCloseTo(207, 0);
  expect(placed.END).toBeCloseTo(279, 0);
});

test('a later table raised by less than its gap to the moved lines still opens below them', () => {
  const placed = tops(lay(opening + table('FOUR', 1200, -2) + p('END')));
  expect(placed.THREE).toBeCloseTo(109, 0);
  expect(placed.FOUR).toBeCloseTo(227, 0);
});

test('a raised table opens below a line an earlier band moved and pushes it on', () => {
  // TWO now starts 5pt below ONE and covers the empty paragraph first: it moves below TWO, to
  // 205pt. THREE opens 3pt above the flow there, at 214pt, and moves it again; FOUR, 20pt above
  // the flow after that move, moves it once more.
  const lead = table('ONE', 2000) + table('TWO', 2000, 100) + p() + table('THREE', 2000, -60);
  const placed = tops(lay(lead + table('FOUR', 1200, -400) + p('END')));
  expect(placed.TWO).toBeCloseTo(105, 0);
  expect(placed.THREE).toBeCloseTo(214, 0);
  expect(placed.FOUR).toBeCloseTo(306, 0);
  expect(placed.END).toBeCloseTo(378, 0);
});

// MID stands at 12-24pt with 8pt after it. TWO, 15pt below the lead line, starts at 27pt: the
// line clears it and only the space after reaches into it.
const spaced = p('Lead') + table('TWO', 2000, 300) + p('MID', 160) + p('END');

test('before mode 15, a line whose space after reaches a floating table moves below it', () => {
  const legacy = tops(lay(spaced, 14));
  expect(legacy.TWO).toBeCloseTo(27, 0);
  expect(legacy.MID).toBeCloseTo(127, 0);
  const modern = tops(lay(spaced, 15));
  expect(modern.MID).toBeCloseTo(12, 0);
  expect(modern.END).toBeCloseTo(127, 0);
});

test('before mode 15, the space after an earlier line counts against a raised table', () => {
  // L1 at 0-12pt with 8pt after, L2 at 20-32pt; THREE rises 16pt above the last paragraph to
  // 16pt, below L1 and across its space after.
  const body = p('L1', 160) + p('L2') + table('THREE', 2000, -320) + p('END');
  expect(tops(lay(body, 14)).L1).toBeCloseTo(116, 0);
  expect(tops(lay(body, 15)).L1).toBeCloseTo(0, 0);
});
