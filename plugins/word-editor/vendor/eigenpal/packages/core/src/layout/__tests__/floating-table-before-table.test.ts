import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { isOutOfFlowTableFragment } from '../table-float-position.ts';
import type { TableFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p = (text: string, height = 20) =>
  `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="${height * 20}" w:lineRule="exact"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const table = (rows: number, position = '') =>
  `<w:tbl><w:tblPr>${position}<w:tblLayout w:type="fixed"/><w:tblW w:type="dxa" w:w="4000"/><w:tblCellMar><w:top w:type="dxa" w:w="0"/><w:bottom w:type="dxa" w:w="0"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>${Array.from(
    { length: rows },
    (_, index) =>
      `<w:tr><w:trPr><w:trHeight w:val="800" w:hRule="exact"/></w:trPr><w:tc>${p(`Row ${index}`)}</w:tc></w:tr>`
  ).join('')}</w:tbl>`;

function layout(body: string) {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  return layoutSemanticDocument(read.part, 0, {
    measurer: createFixedMeasurer(6, 12),
    geometry: { width: 200, height: 400, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
  });
}

test('a text-positioned floating table before an in-flow table sits at that table and pushes it below', () => {
  const float = '<w:tblpPr w:vertAnchor="text" w:horzAnchor="margin" w:tblpY="-40"/>';
  const result = layout(p('Lead') + table(2, float) + table(1) + p('After'));
  expect(result.pages).toHaveLength(1);
  const tables = result.pages[0]!.fragments.filter(
    (fragment): fragment is TableFragmentRecord => fragment.kind === 'table'
  );
  const floating = tables.find(isOutOfFlowTableFragment)!;
  const inFlow = tables.find((fragment) => !isOutOfFlowTableFragment(fragment))!;
  // The float takes the in-flow table's place, raised by its offset, on the same page.
  expect(floating.box.y).toBeCloseTo(18, 0);
  // The in-flow table cannot sit beside a full-width float, so it starts below it.
  expect(inFlow.box.y).toBeCloseTo(floating.box.y + floating.box.height, 6);
  const after = result.pages[0]!.fragments.at(-1)!;
  expect(after.box.y).toBeCloseTo(inFlow.box.y + inFlow.box.height, 6);
});

test('a page-positioned float before an in-flow table still clears the earlier lines on its page', () => {
  const float = '<w:tblpPr w:vertAnchor="page" w:horzAnchor="margin" w:tblpY="400"/>';
  const result = layout(p('Lead') + p('Second') + table(2, float) + table(1) + p('After'));
  const page = result.pages[0]!.fragments;
  const floating = page.find(
    (fragment): fragment is TableFragmentRecord =>
      fragment.kind === 'table' && isOutOfFlowTableFragment(fragment)
  )!;
  const bottom = floating.box.y + floating.box.height;
  // The float covers 20..100: the second line and the in-flow table both start below it.
  expect(page[1]!.box.y).toBeGreaterThanOrEqual(bottom - 0.001);
  const inFlow = page.find(
    (fragment): fragment is TableFragmentRecord =>
      fragment.kind === 'table' && !isOutOfFlowTableFragment(fragment)
  )!;
  expect(inFlow.box.y).toBeGreaterThanOrEqual(bottom - 0.001);
});

test('an earlier in-flow table moves below a page-positioned float that spans the column', () => {
  const float = '<w:tblpPr w:vertAnchor="page" w:horzAnchor="margin" w:tblpY="200"/>';
  // The float's band (10..90) crosses the lead line and the top of the table after it.
  const result = layout(p('Lead') + table(1) + table(2, float) + p('After'));
  const tables = result.pages[0]!.fragments.filter(
    (fragment): fragment is TableFragmentRecord => fragment.kind === 'table'
  );
  const floating = tables.find(isOutOfFlowTableFragment)!;
  const inFlow = tables.find((fragment) => !isOutOfFlowTableFragment(fragment))!;
  expect(floating.box.y).toBeCloseTo(10, 0);
  expect(inFlow.box.y).toBeGreaterThanOrEqual(floating.box.y + floating.box.height - 0.001);
  // A text-positioned float after the table leaves the earlier table in place.
  const textFloat = '<w:tblpPr w:vertAnchor="text" w:horzAnchor="margin" w:tblpY="200"/>';
  const flowing = layout(p('Lead') + table(1) + table(2, textFloat) + p('After'));
  const first = flowing.pages[0]!.fragments.find(
    (fragment): fragment is TableFragmentRecord =>
      fragment.kind === 'table' && !isOutOfFlowTableFragment(fragment)
  )!;
  expect(first.box.y).toBe(20);
});
