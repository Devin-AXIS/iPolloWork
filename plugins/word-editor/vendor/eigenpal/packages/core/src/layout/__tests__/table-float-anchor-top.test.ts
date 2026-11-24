// A table positioned against the text (ECMA-376 Part 1, 17.4.57, 17.4.66) stands in the flow
// where it is: its vertical offset counts from the top of its anchor paragraph's box, above that
// paragraph's space before (17.3.1.33) and top border. The space after the paragraph above stays
// whole instead of collapsing with the anchor's space before, contextual spacing (17.3.1.9)
// still joins the paragraphs around the table, and the anchor no longer opens the section, so
// at the top of a page it loses its space before. When the table covers its own anchor, the
// anchor keeps its space before below the table. Before mode 15, an anchor at the top of a page
// also keeps it when its own table only stands beside it, if that table covers the page top.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { SemanticLayout } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p = (text: string, ppr = '') =>
  `<w:p><w:pPr>${ppr}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const spacing = (before: number, after: number, extra = '') =>
  `<w:spacing w:before="${before}" w:after="${after}" w:line="240" w:lineRule="exact"/>${extra}`;
const plain = spacing(0, 0);
/** A one-row floating table `tblpY` twips below its anchor, 100pt tall. */
const float = (tblpY: number, width = 4000) =>
  '<w:tbl><w:tblPr><w:tblpPr w:leftFromText="180" w:rightFromText="180" w:vertAnchor="text" ' +
  `w:horzAnchor="margin" w:tblpY="${tblpY}"/><w:tblW w:w="${width}" w:type="dxa"/>` +
  `<w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="${width}"/></w:tblGrid>` +
  `<w:tr><w:trPr><w:trHeight w:val="2000" w:hRule="exact"/></w:trPr><w:tc>${p('TWO', plain)}</w:tc></w:tr></w:tbl>`;
const lay = (body: string, compatibilityMode = 15): SemanticLayout => {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  return layoutSemanticDocument(read.part, 0, {
    measurer: createFixedMeasurer(6, 12),
    compatibilityMode,
  });
};

/** The top of the table and of every text line on page one, by first text. */
function tops(layout: SemanticLayout): Record<string, number> {
  const result: Record<string, number> = {};
  for (const fragment of layout.pages[0]!.fragments) {
    if (fragment.kind === 'table') result.TWO = Number(fragment.box.y.toFixed(2));
    else if (fragment.kind === 'paragraph')
      for (const line of fragment.lines)
        result[line.spans.map((span) => span.text).join('')] = Number(line.box.y.toFixed(2));
  }
  return result;
}

// 600 twips less the one-twip storage bias of a numeric position.
const OFFSET = 29.95;

test('the offset counts from the anchor paragraph top, above its space before', () => {
  const placed = tops(
    lay(p('Lead', plain) + float(600) + p('MID', spacing(160, 0)) + p('END', plain))
  );
  expect(placed.MID).toBeCloseTo(20, 1);
  expect(placed.TWO).toBeCloseTo(12 + OFFSET, 1);
});

test('the offset counts from above the anchor paragraph top border', () => {
  const border = '<w:pBdr><w:top w:val="single" w:sz="8" w:space="6" w:color="000000"/></w:pBdr>';
  const placed = tops(
    lay(p('Lead', plain) + float(600) + p('MID', border + plain) + p('END', plain))
  );
  expect(placed.MID).toBeGreaterThan(12 + 6);
  expect(placed.TWO).toBeCloseTo(12 + OFFSET, 1);
});

test('the space after above the table stays whole beside the anchor space before', () => {
  const body = p('Lead', spacing(0, 80)) + float(600) + p('MID', spacing(160, 0)) + p('END', plain);
  const placed = tops(lay(body));
  expect(placed.MID).toBeCloseTo(12 + 4 + 8, 1);
  expect(placed.TWO).toBeCloseTo(16 + OFFSET, 1);
});

test('contextual spacing joins the paragraphs around the table', () => {
  const ctx = '<w:contextualSpacing/>';
  const body =
    p('Lead', spacing(0, 160, ctx)) + float(600) + p('MID', spacing(160, 0, ctx)) + p('END', plain);
  const placed = tops(lay(body));
  expect(placed.MID).toBeCloseTo(12, 1);
  expect(placed.TWO).toBeCloseTo(12 + OFFSET, 1);
});

test('an anchor after a table at the top of the first page loses its space before', () => {
  const placed = tops(lay(float(600) + p('MID', spacing(160, 0)) + p('END', plain)));
  expect(placed.MID).toBeCloseTo(0, 1);
  expect(placed.TWO).toBeCloseTo(OFFSET, 1);
});

test('an anchor its own table covers keeps its space before below the table', () => {
  // A table as wide as the column, 12pt below the lead line, covers the anchor line at 20pt.
  const body = p('Lead', plain) + float(240, 9400) + p('MID', spacing(160, 0)) + p('END', plain);
  const placed = tops(lay(body));
  expect(placed.TWO).toBeCloseTo(12 + 11.95, 1);
  expect(placed.MID).toBeCloseTo(12 + 11.95 + 100 + 8, 1);
});

test('an anchor its own table covers at the top of the first page keeps its space before', () => {
  // The table opens the page, so the anchor would lose its space before at the top. Its own
  // table covers the anchor line, so the line moves below the table and keeps that space.
  const placed = tops(lay(float(-200, 9400) + p('MID', spacing(160, 0)) + p('END', plain)));
  // Raised 10pt above the anchor top, less the one-twip storage bias.
  expect(placed.TWO).toBeCloseTo(-10.05, 1);
  expect(placed.MID).toBeCloseTo(-10.05 + 100 + 8, 1);
});

test('before mode 15, a table beside its anchor at the page top keeps the space before', () => {
  // A narrow table raised 10pt above the anchor covers the top of the text area.
  const body = float(-200) + p('MID', spacing(160, 0)) + p('END', plain);
  expect(tops(lay(body, 14)).MID).toBeCloseTo(8, 1);
  expect(tops(lay(body, 15)).MID).toBeCloseTo(0, 1);
});

test('before mode 15, a table below the page top does not keep the space before', () => {
  const placed = tops(lay(float(600) + p('MID', spacing(160, 0)) + p('END', plain), 14));
  expect(placed.MID).toBeCloseTo(0, 1);
  expect(placed.TWO).toBeCloseTo(OFFSET, 1);
});
