// An in-flow table that would cross a floating table (`w:tblpPr`, ECMA-376 Part 1, 17.4.57)
// moves into the passage beside it when the passage holds the table's width. Inside the
// passage the table keeps its `w:jc` alignment (17.4.28), as in a narrower column. A table
// wider than the passage starts below the float. This holds whether the float anchors at an
// empty paragraph before the table or at the table itself, and the text after the table wraps
// beside the float. The page is 200 pt wide without margins; the float is 100 pt wide.
import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { isOutOfFlowTableFragment } from '../table-float-position.ts';
import type { ParagraphFragmentRecord, TableFragmentRecord } from '../semantic-records.ts';
import { layoutContext } from './anchored-drawing-test-fixtures.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p = (text = '') =>
  '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr>' +
  (text ? `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>` : '') +
  '</w:p>';
const float =
  '<w:tbl><w:tblPr><w:tblpPr w:vertAnchor="text" w:horzAnchor="margin" w:tblpY="1"/>' +
  '<w:tblLayout w:type="fixed"/><w:tblW w:type="dxa" w:w="2000"/></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val="1600" ' +
  `w:hRule="exact"/></w:trPr><w:tc>${p('Float')}</w:tc></w:tr></w:tbl>`;
const inline = (width: number, jc: string) =>
  `<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/><w:tblW w:type="dxa" w:w="${width * 20}"/>` +
  `<w:jc w:val="${jc}"/><w:tblCellMar><w:left w:type="dxa" w:w="0"/><w:right w:type="dxa" w:w="0"/>` +
  `</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="${width * 20}"/></w:tblGrid>` +
  `<w:tr><w:tc>${p('In')}</w:tc></w:tr></w:tbl>`;

function render(body: string) {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  const fragments = layoutSemanticDocument(read.part, 0, {
    measurer: createFixedMeasurer(6, 12),
    geometry: { width: 200, height: 300, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
    compatibilityMode: 15,
    inlineDrawingLayout: layoutContext(read.part),
  }).pages[0]!.fragments;
  const tables = fragments.filter((f): f is TableFragmentRecord => f.kind === 'table');
  return {
    floating: tables.find(isOutOfFlowTableFragment)!,
    inFlow: tables.find((table) => !isOutOfFlowTableFragment(table))!,
    last: fragments.at(-1) as ParagraphFragmentRecord,
  };
}

for (const anchoredAtTable of [false, true]) {
  const label = anchoredAtTable ? 'the float anchors at the table' : 'an empty paragraph anchors';
  const body = (table: string) =>
    p('Lead') + float + (anchoredAtTable ? '' : p()) + table + p('After word word word');

  test(`a table that fits the passage stands beside the float (${label})`, () => {
    for (const [jc, x] of [
      ['center', 125],
      ['left', 100],
      ['right', 150],
    ] as const) {
      const { floating, inFlow, last } = render(body(inline(50, jc)));
      expect(floating.box.y).toBeCloseTo(12, 1);
      expect(inFlow.box.x).toBeCloseTo(x, 6);
      expect(inFlow.box.y).toBe(anchoredAtTable ? 12 : 24);
      // The text after the table wraps beside the float.
      expect(last.lines[0]!.box.y).toBe(inFlow.box.y + inFlow.box.height);
      expect(last.lines[0]!.spans[0]!.box.x).toBeGreaterThanOrEqual(100);
    }
  });

  test(`a table wider than the passage starts below the float (${label})`, () => {
    const { floating, inFlow } = render(body(inline(120, 'center')));
    expect(inFlow.box.y).toBeCloseTo(floating.box.y + floating.box.height, 6);
    expect(inFlow.box.x).toBeCloseTo(40, 6);
  });
}
