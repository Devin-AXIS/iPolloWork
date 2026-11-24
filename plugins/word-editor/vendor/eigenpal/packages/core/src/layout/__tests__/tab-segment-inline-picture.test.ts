// A centered or right tab aligns the whole segment after it, inline pictures included.

import { expect, test } from 'bun:test';
import { readOoxmlPart, WML_NAMESPACE_URI } from '../../store/package/ooxml-tree.ts';
import { indexInlineDrawingProjectionsInPart } from '../../store/package/drawing-projection.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf } from '../semantic-records.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const DML = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS = `xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${DML}" xmlns:pic="${PIC}" xmlns:r="${REL}"`;
const resource = Object.freeze({
  kind: 'ready' as const,
  partName: '/word/media/example.png',
  contentId: 'example',
  resourceKey: 'example',
  mime: 'image/png',
  pixelWidth: 800,
  pixelHeight: 100,
  dpiX: 96,
  dpiY: 96,
});

/** An inline picture 60pt wide and 20pt tall. */
const picture =
  '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
  `<wp:extent cx="${60 * 12700}" cy="${20 * 12700}"/><wp:docPr id="1" name="p"/><wp:cNvGraphicFramePr/>` +
  `<a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="p"/>` +
  '<pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="example"/></pic:blipFill><pic:spPr>' +
  `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${60 * 12700}" cy="${20 * 12700}"/></a:xfrm>` +
  '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData>' +
  '</a:graphic></wp:inline></w:drawing></w:r>';

/** Where the text after the tab starts, and its own width. */
function textBox(alignment: 'center' | 'right'): { x: number; width: number } {
  const body =
    `<w:p><w:pPr><w:tabs><w:tab w:val="${alignment}" w:pos="4000"/></w:tabs></w:pPr>` +
    `<w:r><w:tab/><w:t>AB</w:t></w:r>${picture}</w:p>`;
  const parsed = readOoxmlPart(`<w:document ${NS}><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!parsed.ok) throw Error(parsed.reason);
  const projections = indexInlineDrawingProjectionsInPart(parsed.part);
  const layout = layoutSemanticDocument(parsed.part, 1, {
    measurer: createFixedMeasurer(6, 14),
    geometry: { width: 400, height: 400, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
    inlineDrawingLayout: {
      ownerPartName: parsed.part.name,
      projectionForAtom: (id) => projections.get(id) ?? null,
      project: (node) => projections.get(node.id) ?? null,
      resourceOf: () => resource,
    },
  });
  return linesOf(layout)[0]!.spans.find((span) => span.text === 'AB')!.box;
}

test('the segment after a centered or right tab includes its inline picture', () => {
  // The segment is the text and the 60pt picture, aligned on the stop at 200pt.
  const center = textBox('center');
  expect(center.x).toBeCloseTo(200 - (center.width + 60) / 2, 5);
  const right = textBox('right');
  expect(right.x).toBeCloseTo(200 - (right.width + 60), 5);
});
