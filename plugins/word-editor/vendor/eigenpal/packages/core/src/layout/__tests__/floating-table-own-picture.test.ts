// A floating table (`w:tblpPr`, ECMA-376 Part 1, 17.4.57) whose own cell holds a wrapping
// picture (`wp:anchor` with `wp:wrapSquare`, 20.4.2.3 and 20.4.2.17) still floats. The
// picture moves with the table, so the text after the table wraps beside it and does not
// move below it.

import { expect, test } from 'bun:test';
import { WML_NAMESPACE_URI } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { ParagraphFragmentRecord, TableFragmentRecord } from '../semantic-records.ts';
import { isOutOfFlowTableFragment } from '../table-float-position.ts';
import { layoutContext, load } from './anchored-drawing-test-fixtures.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const EMU = 12700;

const picture = (sizePt: number) =>
  '<w:r><w:drawing>' +
  '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0"' +
  ' allowOverlap="1" layoutInCell="1" relativeHeight="1">' +
  '<wp:simplePos x="0" y="0"/>' +
  '<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
  '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
  `<wp:extent cx="${sizePt * EMU}" cy="${sizePt * EMU}"/><wp:wrapSquare wrapText="bothSides"/>` +
  '<wp:docPr id="1" name="pic1"/>' +
  `<a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:nvPicPr>` +
  '<pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
  '<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
  `<pic:spPr><a:xfrm><a:ext cx="${sizePt * EMU}" cy="${sizePt * EMU}"/></a:xfrm>` +
  '<a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic>' +
  '</wp:anchor></w:drawing></w:r>';

const p = (text: string, content = '') =>
  `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr>${content}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

const cell = (content: string) =>
  `<w:tc><w:tcPr><w:tcW w:w="1600" w:type="dxa"/></w:tcPr>${content}</w:tc>`;

function document(withPicture: boolean): string {
  const table =
    '<w:tbl><w:tblPr><w:tblpPr w:vertAnchor="text" w:horzAnchor="page" w:tblpX="4000" w:tblpY="0"/>' +
    '<w:tblW w:w="3200" w:type="dxa"/><w:tblLayout w:type="fixed"/>' +
    '<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>' +
    '</w:tblPr><w:tblGrid><w:gridCol w:w="1600"/><w:gridCol w:w="1600"/></w:tblGrid>' +
    '<w:tr><w:trPr><w:trHeight w:val="1600"/></w:trPr>' +
    `${cell(p('Left'))}${cell(p('Right', withPicture ? picture(30) : ''))}</w:tr></w:tbl>`;
  return (
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body>` +
    `${p('Lead')}${table}${p('word '.repeat(40))}${p('Tail')}</w:body></w:document>`
  );
}

function render(withPicture: boolean) {
  const part = load(document(withPicture));
  return layoutSemanticDocument(part, 0, {
    measurer: createFixedMeasurer(6, 12),
    geometry: { width: 400, height: 400, margin: { top: 20, right: 20, bottom: 20, left: 20 } },
    inlineDrawingLayout: layoutContext(part),
  });
}

test('a floating table that holds a wrapping picture keeps the following text beside it', () => {
  for (const withPicture of [false, true]) {
    const layout = render(withPicture);
    const fragments = layout.pages[0]!.fragments;
    const table = fragments.find((f): f is TableFragmentRecord => f.kind === 'table')!;
    const anchor = fragments.filter(
      (f): f is ParagraphFragmentRecord => f.kind === 'paragraph'
    )[1]!;
    expect(isOutOfFlowTableFragment(table)).toBe(true);
    // The table floats at its anchor, and the anchor's lines run beside it, to its left.
    expect(Math.abs(anchor.lines[0]!.box.y - table.box.y)).toBeLessThan(0.1);
    const besideTable = anchor.lines.filter((line) => line.box.y < table.box.y + table.box.height);
    expect(besideTable.length).toBeGreaterThan(4);
    for (const line of besideTable)
      for (const span of line.spans)
        expect(span.box.x + span.box.width).toBeLessThanOrEqual(table.box.x);
  }
});
