import { afterAll, expect, mock, test } from 'bun:test';
import * as ownership from '../table-border-ownership.ts';

// The pass-wide border ownership budget is far larger than any fixture. Shrink it for this
// file only, so a three-page table spends it on its second page. Later files get the default.
let limit: number | undefined;
// Captured before mocking: the namespace binding is live and would point at the wrapper.
const createBudget = ownership.createTableBorderOwnershipBudget;
const original = { ...ownership };
mock.module('../table-border-ownership.ts', () => ({
  ...original,
  createTableBorderOwnershipBudget: (cap?: number) =>
    limit === undefined ? createBudget(cap) : { intervalsRemaining: limit },
}));
afterAll(() => {
  limit = undefined;
});

const { applyTreeOp } = await import('../../store/store/tree-ops.ts');
const { readOoxmlPart, serializeOoxmlPart } = await import('@docx-editor.dev/core/store');
const { createLayoutSession } = await import('../layout-session.ts');
const { createParagraphLayoutCache } = await import('../layout-cache.ts');
const { readTableStructure } = await import('../semantic-table.ts');
const { updateTableText } = await import('../table-text-update.ts');
const { finalizedWithHeadroom } = await import('../table-budget-proof.ts');
const { lay, load, measurer, styleCascade } = await import('./table-row-keep-fixtures.ts');
import type { OoxmlElement, OoxmlPart } from '@docx-editor.dev/core/store';
import type { SemanticLayout, TableFragmentRecord } from '../semantic-records.ts';

const p = (text: string) =>
  '<w:p><w:pPr><w:widowControl w:val="0"/>' +
  '<w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="exact"/></w:pPr>' +
  `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
// A cell's own thick top and left rules win interior conflicts only when the resolver can
// find the neighbor that owns them, which is what the ownership budget pays for.
const thick =
  '<w:tcBorders><w:top w:val="single" w:sz="24"/><w:left w:val="single" w:sz="24"/></w:tcBorders>';
const row = (i: number) =>
  `<w:tr>${[0, 1, 2].map((c) => `<w:tc><w:tcPr>${thick}</w:tcPr>${p(i === 0 && c === 1 ? 'the widest cell text' : `r${i}c${c}`)}</w:tc>`).join('')}</w:tr>`;
const borders =
  '<w:tblBorders>' +
  ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((edge) => `<w:${edge} w:val="single" w:sz="4"/>`)
    .join('') +
  '</w:tblBorders>';
const autofit = (rows: number) =>
  `<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/>${borders}</w:tblPr>` +
  `<w:tblGrid>${'<w:gridCol w:w="2000"/>'.repeat(3)}</w:tblGrid>` +
  `${Array.from({ length: rows }, (_, i) => row(i)).join('')}</w:tbl>`;
const deps = {
  measurer,
  styleCascade,
  producer: 'test',
  nextLineId: () => '',
  displayMode: 'all-markup' as const,
  compatibilityMode: 15,
};
const tableNode = (part: OoxmlPart): OoxmlElement =>
  part.root.children
    .find((node) => node.kind === 'body')!
    .children.find((node) => node.kind === 'table')! as OoxmlElement;
const tables = (layout: SemanticLayout): TableFragmentRecord[] =>
  layout.pages
    .flatMap((page) => page.fragments)
    .filter((fragment): fragment is TableFragmentRecord => fragment.kind === 'table');
const reparsed = (part: OoxmlPart): OoxmlPart => {
  const result = readOoxmlPart(serializeOoxmlPart(part), {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw Error(result.reason);
  return result.part;
};
const insert = (part: OoxmlPart, row: number, text: string): OoxmlPart => {
  const id = readTableStructure(tableNode(part), 310, 0, styleCascade)!.rows[row]!.cells[1]!
    .blocks[0]!.id;
  const edit = applyTreeOp(part, { op: 'insertText', paragraphId: id, offset: 0, text });
  if (!edit.ok) throw Error(edit.reason);
  return edit.part;
};

test('a spent ownership budget changes borders, and only the fragments before it carry proof', () => {
  const part = load(autofit(30));
  limit = undefined;
  const unlimited = lay(part);
  limit = 40;
  const limited = lay(part);
  expect(tables(limited).length).toBeGreaterThan(2);
  // The same rows finalized after the budget ran out lose border ownership.
  expect(tables(limited)[0]).toEqual(tables(unlimited)[0]!);
  expect(tables(limited).slice(1)).not.toEqual(tables(unlimited).slice(1));
  expect(tables(limited).map(finalizedWithHeadroom)).toEqual(
    tables(limited).map((_, index) => index === 0)
  );
  expect(tables(unlimited).every(finalizedWithHeadroom)).toBe(true);
  limit = undefined;
});

test('width and text fast paths refuse fragments finalized after the budget ran out', () => {
  limit = 40;
  const part = load(autofit(30));
  const before = lay(part);
  const last = 29;
  // Width change: the whole table re-finalizes, so one cut fragment refuses it.
  const wider = insert(part, last, 'an even wider cell text ');
  expect(tables(lay(wider))[0]!.columnEdges).not.toEqual(tables(before)[0]!.columnEdges);
  expect(updateTableText(tableNode(part), tableNode(wider), before.pages, 310, deps)).toBeNull();
  // Same widths, row on a cut page: refused. Row on the proven first page: accepted.
  const late = insert(part, last, 'x');
  const early = insert(part, 1, 'x');
  expect(tables(lay(late))[0]!.columnEdges).toEqual(tables(before)[0]!.columnEdges);
  expect(updateTableText(tableNode(part), tableNode(late), before.pages, 310, deps)).toBeNull();
  const accepted = updateTableText(tableNode(part), tableNode(early), before.pages, 310, deps);
  expect(accepted).not.toBeNull();
  expect(accepted!.pages).toEqual(lay(early).pages);
  // The retained session falls back to the full layout and still equals a cold one.
  for (const next of [wider, late, early]) {
    const session = createLayoutSession();
    const cache = createParagraphLayoutCache();
    lay(part, 15, { session, cache });
    expect(lay(next, 15, { session, cache }).pages).toEqual(lay(reparsed(next)).pages);
  }
  limit = undefined;
});
