// A text-anchored floating table (ECMA-376 Part 1, 17.4.57) keeps its `w:topFromText` distance
// (17.4.57) above it. When that band, or a negative `w:tblpY`, rises above the anchor paragraph,
// the earlier lines on the page that it crosses wrap beside the table. The table keeps the place
// its anchor had before those lines grew longer.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import type { PendingLine } from '../paragraph-flow.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
  type SemanticLayout,
} from '../semantic-layout.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p = (text: string) =>
  '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr>' +
  `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
/** `count` one-letter words: 39 fit a line of the 468 pt column, fewer beside the table. */
const words = (letter: string, count: number) => `${letter} `.repeat(count).trimEnd();
/** A 150 pt wide, 80 pt tall table at the left margin, 7.1 pt and 14.2 pt from the text. */
const table = (top: number, y = 1) =>
  '<w:tbl><w:tblPr><w:tblpPr w:leftFromText="142" w:rightFromText="284" ' +
  `w:topFromText="${top}" w:vertAnchor="text" w:horzAnchor="margin" w:tblpY="${y}"/>` +
  '<w:tblOverlap w:val="never"/><w:tblW w:w="3000" w:type="dxa"/><w:tblLayout w:type="fixed"/>' +
  '</w:tblPr><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:trPr>' +
  `<w:trHeight w:val="1600"/></w:trPr><w:tc>${p('ROW')}</w:tc></w:tr></w:tbl>`;
const options = { measurer: createFixedMeasurer(6, 12), compatibilityMode: 15 };

const part = (body: string) => {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  return read.part;
};

/** The table top, and each body line as `letter@x,y`, on page one. */
function placed(layout: SemanticLayout): { table: number; lines: string[] } {
  let table = Number.NaN;
  const lines: string[] = [];
  for (const fragment of layout.pages[0]!.fragments) {
    if (fragment.kind === 'table') table = Number(fragment.box.y.toFixed(2));
    else if (fragment.kind === 'paragraph')
      for (const line of fragment.lines)
        lines.push(
          `${line.spans[0]!.text[0]}@${Number(line.spans[0]!.box.x.toFixed(1))},${line.box.y}`
        );
  }
  return { table, lines };
}

/** Lines of `letter` from `top`, 12 pt apart, beside the table (x 164.2) or at the margin. */
const at = (letter: string, top: number, beside: readonly boolean[]) =>
  beside.map((wraps, index) => `${letter}@${wraps ? 164.2 : 0},${top + index * 12}`);

test('a top distance above the anchor wraps the earlier lines it crosses', () => {
  // The lead takes two full lines, so the anchor and the table start at 24 pt (the one-twip offset
  // is storage bias). The 28.35 pt band reaches both lines; beside the table the lead takes three,
  // and the anchor moves to 36 pt.
  const result = placed(
    layoutSemanticDocument(part(p(words('a', 70)) + table(567) + p(words('b', 20))), 0, options)
  );
  expect(result.table).toBe(24);
  expect(result.lines).toEqual([...at('a', 0, [true, true, true]), ...at('b', 36, [true])]);
});

test('an earlier line above the band keeps the full width', () => {
  // Three full lines put the anchor at 36 pt. The 14.2 pt band starts at 21.8 pt, below line one.
  const result = placed(
    layoutSemanticDocument(part(p(words('a', 110)) + table(284) + p(words('b', 20))), 0, options)
  );
  expect(result.table).toBe(36);
  expect(result.lines).toEqual([...at('a', 0, [false, true, true, true]), ...at('b', 48, [true])]);
});

test('a band that starts below the anchor top leaves the earlier lines alone', () => {
  const result = placed(
    layoutSemanticDocument(
      part(p(words('a', 70)) + table(567, 601) + p(words('b', 20))),
      0,
      options
    )
  );
  expect(result.table).toBe(54);
  // The anchor line still meets the band, which starts 1.65 pt below its top.
  expect(result.lines).toEqual([...at('a', 0, [false, false]), ...at('b', 24, [true])]);
});

test('a table raised by a negative offset wraps the earlier lines beside it too', () => {
  // Three full lines put the anchor at 36 pt and the table 30 pt above it. All three lead lines
  // meet the band, and beside it the lead takes four.
  const result = placed(
    layoutSemanticDocument(
      part(p(words('a', 110)) + table(0, -601) + p(words('b', 20))),
      0,
      options
    )
  );
  expect(result.table).toBe(5.9);
  expect(result.lines).toEqual([...at('a', 0, [true, true, true, true]), ...at('b', 48, [true])]);
});

test('a resumed layout places the table and the wrapped lines as a cold layout does', () => {
  const source = (lead: number) => part(p(words('a', lead)) + table(567) + p(words('b', 20)));
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache<readonly PendingLine[]>();
  for (const [revision, lead] of [70, 110, 70].entries()) {
    const warm = layoutSemanticDocument(source(lead), revision, { ...options, session, cache });
    expect(placed(warm)).toEqual(placed(layoutSemanticDocument(source(lead), revision, options)));
  }
});
