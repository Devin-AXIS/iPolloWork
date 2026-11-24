// Rows that an edit shifted move again on the next edit.
//
// Typing in a narrow cell grows its row by a line every few keys, and every later row of the
// table moves down each time. Each pass must rebuild those rows from the previous layout, the
// rows that open a page included, or every key lays out the rest of the table afresh.

import { expect, test } from 'bun:test';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlElement,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import { createLayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { createFixedMeasurer } from '../semantic-layout.ts';
import { readTableStructure } from '../semantic-table.ts';
import { moveRowToTop, shiftedRowsTestRecorder } from '../table-row-geometry-reuse.ts';
import { placementFromPrevious, rememberRowPlacement } from '../table-row-placement-reuse.ts';
import { layoutRowFragment, type TableFlowDeps } from '../semantic-table-layout.ts';
import { bodyLineId } from '../body-line-id.ts';
import type { SemanticLayout, TableFragmentRecord } from '../semantic-records.ts';
import { lay, load, styleCascade } from './table-row-keep-fixtures.ts';

const measurer = createFixedMeasurer(6, 13.37);
const flowDeps = (): TableFlowDeps => ({
  measurer,
  styleCascade,
  producer: 'repeat-shift',
  nextLineId: bodyLineId,
  displayMode: 'all-markup',
  compatibilityMode: 15,
  cache: createParagraphLayoutCache(),
});
const p = (text: string) =>
  '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="274" w:lineRule="exact"/></w:pPr>' +
  `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const tc = (content: string) =>
  `<w:tc><w:tcPr><w:vAlign w:val="center"/></w:tcPr>${content}</w:tc>`;
const BORDERS =
  '<w:tblBorders>' +
  ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((edge) => `<w:${edge} w:val="single" w:sz="6"/>`)
    .join('') +
  '</w:tblBorders>';
const table = (rows: number) =>
  `<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/><w:tblLayout w:type="fixed"/>${BORDERS}` +
  `</w:tblPr><w:tblGrid>${'<w:gridCol w:w="2000"/>'.repeat(3)}</w:tblGrid>` +
  Array.from(
    { length: rows },
    (_, i) =>
      '<w:tr><w:trPr><w:trHeight w:val="300" w:hRule="atLeast"/></w:trPr>' +
      [0, 1, 2].map((c) => tc(p(`r${i}c${c}`))).join('') +
      '</w:tr>'
  ).join('') +
  '</w:tbl>';

const tableNode = (part: OoxmlPart): OoxmlElement =>
  part.root.children
    .find((node) => node.kind === 'body')!
    .children.find((node) => node.kind === 'table')! as OoxmlElement;
const reparsed = (part: OoxmlPart): OoxmlPart => {
  const result = readOoxmlPart(serializeOoxmlPart(part), {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw Error(result.reason);
  return result.part;
};
const pageOpeningRows = (layout: SemanticLayout) =>
  layout.pages.flatMap((page) =>
    page.fragments
      .filter((fragment): fragment is TableFragmentRecord => fragment.kind === 'table')
      .map((fragment) => fragment.rows[0]!.id)
  );

test('rows an edit shifted, page openers included, move again on the next edit', () => {
  let part = load(table(60));
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  lay(part, 15, { session, cache, measurer });
  const paragraphId = readTableStructure(tableNode(part), 310, 0, styleCascade)!.rows[3]!.cells[1]!
    .blocks[0]!.id;
  const grow = () => {
    const edit = applyTreeOp(part, {
      op: 'insertText',
      paragraphId,
      offset: 0,
      text: 'aaaa bbbb cccc dddd ',
    });
    if (!edit.ok) throw Error(edit.reason);
    part = edit.part;
  };
  for (let edit = 0; edit < 3; edit += 1) {
    grow();
    const recorder = shiftedRowsTestRecorder();
    const updated = lay(part, 15, { session, cache, measurer });
    recorder.dispose();
    expect(updated.pages).toEqual(lay(reparsed(part), 15, { measurer }).pages);
    expect(pageOpeningRows(updated).length).toBeGreaterThan(3);
    // Only a row that closed a page stays out: its final height carries the page's bottom
    // rule, which no probe gives. Every other shifted row moves.
    expect(recorder.moved).toBeGreaterThan(edit === 0 ? 30 : 5);
    if (edit > 0) expect(recorder.refused.record).toBeLessThan(pageOpeningRows(updated).length);
  }
});

test('a placement recorded by a pass that never published does not hide the published one', () => {
  const structure = readTableStructure(tableNode(load(table(1))), 310, 0, styleCascade)!;
  const row = structure.rows[0]!;
  const cols = structure.columnWidthsPt;
  const deps = flowDeps();
  // The published pass placed the row at 40; a later pass probed it at 55 and was superseded.
  const published = layoutRowFragment(row, cols, 0, 40, false, 0, deps);
  rememberRowPlacement(row, published, 40, deps);
  const superseded = moveRowToTop(row, published.record, cols, 0, 55, deps)!;
  rememberRowPlacement(row, { ...published, ...superseded, remainder: null }, 55, deps);
  // The next pass starts from the published row and moves it to 70.
  const moved = placementFromPrevious(row, published.record, cols, 0, 70, deps);
  expect(moved).not.toBeNull();
  expect(moved!.record).toEqual(layoutRowFragment(row, cols, 0, 70, false, 0, deps).record);
});
