// An empty paragraph beside a square float keeps its place while the float leaves a passage
// beside it. When the float covers the whole column, no passage holds even the paragraph
// mark, and the empty line moves below the float as a text line does.

import { describe, expect, test } from 'bun:test';
import { WML_NAMESPACE_URI } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { ParagraphFragmentRecord } from '../semantic-records.ts';
import { layoutContext, load } from './anchored-drawing-test-fixtures.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const EMU = 12700;

/** A square float `width` points wide at the column's left, 10pt below its paragraph's top. */
function float(width: number): string {
  return (
    '<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ' +
    'behindDoc="0" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="1">' +
    '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
    `<wp:positionV relativeFrom="paragraph"><wp:posOffset>${10 * EMU}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${width * EMU}" cy="${100 * EMU}"/><wp:wrapSquare wrapText="bothSides"/>` +
    `<wp:docPr id="1" name="pic"/><a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:nvPicPr>` +
    '<pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/>' +
    '<a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm>' +
    `<a:ext cx="${width * EMU}" cy="${100 * EMU}"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>` +
    '</pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>'
  );
}

/** Lines of the paragraphs after the anchor: two empty ones, then text. */
function after(width: number, empties = 2, paragraph = '<w:p/>'): ParagraphFragmentRecord[] {
  const empty = paragraph.repeat(empties);
  const part = load(
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
      `<w:body><w:p>${float(width)}<w:r><w:t>Anchor</w:t></w:r></w:p>${empty}` +
      '<w:p><w:r><w:t>Next</w:t></w:r></w:p></w:body></w:document>'
  );
  const layout = layoutSemanticDocument(part, 1, {
    measurer: createFixedMeasurer(6, 14),
    inlineDrawingLayout: layoutContext(part),
  });
  return (layout.pages[0]!.fragments as ParagraphFragmentRecord[]).filter(
    (fragment) => fragment.kind === 'paragraph'
  );
}

describe('an empty paragraph beside a square float', () => {
  test('moves below a float that covers the whole column', () => {
    const [, first, second, next] = after(468);
    // The float spans 10pt to 110pt below the anchor's top at 0.
    expect(first!.lines[0]!.box.y).toBeGreaterThanOrEqual(110 - 0.01);
    const pitch = first!.lines[0]!.box.height;
    expect(second!.lines[0]!.box.y).toBeCloseTo(first!.lines[0]!.box.y + pitch, 3);
    expect(next!.lines[0]!.box.y).toBeCloseTo(second!.lines[0]!.box.y + pitch, 3);
    // As far below the float as the text after it lands without the empty paragraphs.
    const [, direct] = after(468, 0);
    expect(first!.lines[0]!.box.y).toBeCloseTo(direct!.lines[0]!.box.y, 3);
  });

  test('keeps its space before below the float, once, as a text paragraph does', () => {
    const before = '<w:pPr><w:spacing w:before="240"/></w:pPr>';
    const [, empty] = after(468, 1, `<w:p>${before}</w:p>`);
    const [, text] = after(468, 1, `<w:p>${before}<w:r><w:t>Text</w:t></w:r></w:p>`);
    // A text paragraph sets the reference: below the float, with its space before once.
    expect(empty!.box.y).toBeCloseTo(text!.box.y, 3);
    expect(empty!.lines[0]!.box.y).toBeCloseTo(text!.lines[0]!.box.y, 3);
    const [, plain] = after(468, 1);
    expect(empty!.lines[0]!.box.y - plain!.lines[0]!.box.y).toBeCloseTo(12, 3);
  });

  test('contextual spacing drops the space before below the float too', () => {
    const before = '<w:pPr><w:contextualSpacing/><w:spacing w:before="240"/></w:pPr>';
    const [, empty] = after(468, 1, `<w:p>${before}</w:p>`);
    const [, text] = after(468, 1, `<w:p>${before}<w:r><w:t>Text</w:t></w:r></w:p>`);
    expect(empty!.lines[0]!.box.y).toBeCloseTo(text!.lines[0]!.box.y, 3);
  });

  test('the empty paragraphs a floating table anchors to keep their place', () => {
    const table =
      '<w:tbl><w:tblPr><w:tblpPr w:leftFromText="180" w:rightFromText="180" w:vertAnchor="text" ' +
      'w:horzAnchor="margin" w:tblpX="-90" w:tblpY="86"/>' +
      '<w:tblW w:w="9200" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="9200"/></w:tblGrid>' +
      '<w:tr><w:trPr><w:trHeight w:val="2000" w:hRule="exact"/></w:trPr><w:tc><w:tcPr>' +
      '<w:tcW w:w="9200" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
    const part = load(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}"><w:body><w:p><w:r><w:t>Lead</w:t></w:r></w:p>` +
        `${table}<w:p/><w:p/>` +
        '<w:p><w:r><w:t>Next</w:t></w:r></w:p></w:body></w:document>'
    );
    const layout = layoutSemanticDocument(part, 1, {
      measurer: createFixedMeasurer(6, 14),
    });
    const [lead, first, second] = (layout.pages[0]!.fragments as ParagraphFragmentRecord[]).filter(
      (fragment) => fragment.kind === 'paragraph'
    );
    expect(first!.box.y).toBeCloseTo(lead!.box.height, 3);
    expect(second!.box.y).toBeCloseTo(first!.box.y + first!.box.height, 3);
  });

  test('keeps its place beside a float that leaves a passage', () => {
    const [anchor, first, second] = after(200);
    const pitch = anchor!.lines[0]!.box.height;
    expect(first!.lines[0]!.box.y).toBeCloseTo(anchor!.lines[0]!.box.y + pitch, 3);
    expect(second!.lines[0]!.box.y).toBeCloseTo(first!.lines[0]!.box.y + pitch, 3);
  });
});
