// A wrapping picture laid out in a table cell and positioned from its paragraph stays inside
// its cell. A negative offset stops at the cell top, and the row grows until it holds the whole
// picture, so the next row starts below it. A picture that does not wrap keeps its offset and
// the row keeps its text height.

import { describe, expect, test } from 'bun:test';
import {
  WML_NAMESPACE_URI,
  readOoxmlPart,
  type OoxmlPart,
} from '../../store/package/ooxml-tree.ts';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  indexInlineDrawingProjectionsInPart,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';
import type { ImageResourceState } from '../../store/package/image-resources.ts';
import type { InlineDrawingLayoutContext } from '../drawing-layout.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { anchoredDrawingsOf, type PageGeometry, type SemanticLayout } from '../semantic-records.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const OWNER = '/word/document.xml';
const measurer = createFixedMeasurer(6, 14);
const GEOMETRY: PageGeometry = {
  width: 400,
  height: 400,
  margin: { top: 40, right: 20, bottom: 20, left: 20 },
};
const READY: ImageResourceState = Object.freeze({
  kind: 'ready',
  partName: '/word/media/image1.png',
  contentId: 'image1',
  resourceKey: 'k1',
  mime: 'image/png',
  pixelWidth: 100,
  pixelHeight: 100,
  dpiX: 96,
  dpiY: 96,
});
const EMU = 12700;
const HEIGHT_PT = 60;

function picture(offsetPt: number, wrap: string): string {
  return (
    '<w:r><w:drawing>' +
    '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0"' +
    ' allowOverlap="1" layoutInCell="1" relativeHeight="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
    `<wp:positionV relativeFrom="paragraph"><wp:posOffset>${offsetPt * EMU}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${100 * EMU}" cy="${HEIGHT_PT * EMU}"/>${wrap}` +
    '<wp:docPr id="1" name="pic1"/>' +
    `<a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:nvPicPr>` +
    '<pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    `<pic:spPr><a:xfrm><a:ext cx="${100 * EMU}" cy="${HEIGHT_PT * EMU}"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>` +
    '</pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>'
  );
}

const cell = (content: string): string =>
  `<w:tc><w:tcPr><w:tcW w:w="6000" w:type="dxa"/></w:tcPr>${content}</w:tc>`;

function load(offsetPt: number, wrap: string): OoxmlPart {
  const xml =
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body>` +
    '<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="6000"/></w:tblGrid>' +
    `<w:tr>${cell(`<w:p>${picture(offsetPt, wrap)}</w:p>`)}</w:tr>` +
    `<w:tr>${cell('<w:p><w:r><w:t>Next</w:t></w:r></w:p>')}</w:tr>` +
    '</w:tbl><w:p/></w:body></w:document>';
  const result = readOoxmlPart(xml, {
    name: OWNER,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function context(part: OoxmlPart): InlineDrawingLayoutContext {
  const projections = indexInlineDrawingProjectionsInPart(part);
  return {
    ownerPartName: OWNER,
    projectionForAtom: (atomId) => projections.get(atomId) ?? null,
    project: (node) =>
      projections.get(node.id) ??
      projectDrawing(node, { ownerPartName: OWNER, limits: DEFAULT_DRAWING_PROJECTION_LIMITS }),
    resourceOf: () => READY,
  };
}

function lay(offsetPt: number, wrap: string): SemanticLayout {
  const part = load(offsetPt, wrap);
  return layoutSemanticDocument(part, 1, {
    measurer,
    geometry: GEOMETRY,
    inlineDrawingLayout: context(part),
  });
}

/** The picture's top, and the tops of the two rows, on the first page. */
function geometry(layout: SemanticLayout) {
  const page = layout.pages[0]!;
  const table = page.fragments.find((fragment) => fragment.kind === 'table') as unknown as {
    rows: { box: { y: number; height: number } }[];
  };
  const drawing = anchoredDrawingsOf(page)[0];
  return {
    pictureTop: drawing?.hitBounds.y,
    rowTops: table.rows.map((row) => row.box.y),
    rowHeights: table.rows.map((row) => row.box.height),
  };
}

const SQUARE = '<wp:wrapSquare wrapText="bothSides"/>';
const NONE = '<wp:wrapNone/>';

describe('a wrapping picture in a table cell', () => {
  test('a negative offset stops at the cell top and the row holds the picture', () => {
    const placed = geometry(lay(-30, SQUARE));
    expect(placed.pictureTop).toBeGreaterThanOrEqual(placed.rowTops[0]!);
    expect(placed.rowHeights[0]).toBeGreaterThanOrEqual(HEIGHT_PT);
    expect(placed.rowTops[1]).toBeGreaterThanOrEqual(placed.pictureTop! + HEIGHT_PT - 0.001);
  });

  test('a positive offset grows the row by the offset too', () => {
    const lower = geometry(lay(10, SQUARE));
    const clamped = geometry(lay(-30, SQUARE));
    expect(lower.rowTops[1]! - clamped.rowTops[1]!).toBeCloseTo(10, 3);
  });

  test('a picture that does not wrap keeps its offset and its row height', () => {
    const placed = geometry(lay(-30, NONE));
    expect(placed.pictureTop).toBeLessThan(placed.rowTops[0]!);
    expect(placed.rowHeights[0]).toBeLessThan(HEIGHT_PT);
  });
});
