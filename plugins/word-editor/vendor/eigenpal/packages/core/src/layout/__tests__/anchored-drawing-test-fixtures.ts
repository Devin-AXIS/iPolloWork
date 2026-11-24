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
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const OWNER = '/word/document.xml';
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

export function load(xml: string, owner = OWNER): OoxmlPart {
  const result = readOoxmlPart(xml, {
    name: owner,
    contentType: owner.includes('header')
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

export function layoutContext(part: OoxmlPart, owner = OWNER): InlineDrawingLayoutContext {
  const atomProjections = indexInlineDrawingProjectionsInPart(part);
  return {
    ownerPartName: owner,
    projectionForAtom: (atomId) => atomProjections.get(atomId) ?? null,
    project: (node) =>
      atomProjections.get(node.id) ??
      projectDrawing(node, { ownerPartName: owner, limits: DEFAULT_DRAWING_PROJECTION_LIMITS }),
    resourceOf: () => READY,
  };
}

export function squareAnchorAtLeft(options: {
  readonly text: string;
  readonly behindDoc?: string;
}): string {
  const words = options.text;
  return (
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    '<w:body>' +
    '<w:p><w:r><w:drawing>' +
    `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="${options.behindDoc ?? '0'}" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="1">` +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="1828800" cy="914400"/>' +
    '<wp:wrapSquare wrapText="bothSides" distT="0" distB="0" distL="0" distR="0"/>' +
    '<wp:docPr id="1" name="pic"/>' +
    `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    '<pic:spPr><a:xfrm><a:ext cx="1828800" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic>' +
    '</wp:anchor></w:drawing></w:r>' +
    `<w:r><w:t>${words}</w:t></w:r></w:p>` +
    '</w:body></w:document>'
  );
}

/** Two square-wrapped pictures in one paragraph, positions and size in points. */
export function anchorPairInParagraph(options: {
  readonly first: { readonly x: number; readonly y: number };
  readonly second: { readonly x: number; readonly y: number };
  readonly width: number;
  readonly height: number;
  readonly allowOverlap: '0' | '1';
  readonly text: string;
}): string {
  const emu = (pt: number) => Math.round(pt * 12_700);
  const anchor = (id: number, at: { readonly x: number; readonly y: number }) =>
    '<w:r><w:drawing>' +
    `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" allowOverlap="${options.allowOverlap}" layoutInCell="1" relativeHeight="${id}">` +
    '<wp:simplePos x="0" y="0"/>' +
    `<wp:positionH relativeFrom="column"><wp:posOffset>${emu(at.x)}</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="paragraph"><wp:posOffset>${emu(at.y)}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${emu(options.width)}" cy="${emu(options.height)}"/>` +
    '<wp:wrapSquare wrapText="bothSides" distT="0" distB="0" distL="0" distR="0"/>' +
    `<wp:docPr id="${id}" name="pic${id}"/>` +
    `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:ext cx="${emu(options.width)}" cy="${emu(options.height)}"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic>` +
    '</wp:anchor></w:drawing></w:r>';
  return (
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    '<w:body><w:p>' +
    anchor(1, options.first) +
    anchor(2, options.second) +
    `<w:r><w:t>${options.text}</w:t></w:r></w:p>` +
    '</w:body></w:document>'
  );
}

/**
 * The same square anchor, inside a one-cell table, with `w:layoutInCell` under the caller's
 * control. `"0"` positions the object against the page rather than the cell, so it is not part
 * of that cell's flow.
 */
export function squareAnchorInCell(options: {
  readonly text: string;
  readonly layoutInCell: '0' | '1';
  /** `w:tblInd` in twips, which moves the cell (and an in-cell anchor) off the margin. */
  readonly tableIndent?: number;
  /** A tall row with `w:vAlign="center"`, which moves the cell's content after it flows. */
  readonly centred?: boolean;
  readonly horizontalFrame?: 'column' | 'character';
  readonly verticalFrame?: 'paragraph' | 'line' | 'margin';
  readonly wrap?: 'square' | 'topAndBottom';
}): string {
  const indent =
    options.tableIndent === undefined
      ? ''
      : `<w:tblInd w:w="${options.tableIndent}" w:type="dxa"/>`;
  return (
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    '<w:body><w:tbl>' +
    `<w:tblPr><w:tblW w:w="8800" w:type="dxa"/>${indent}<w:tblLayout w:type="fixed"/></w:tblPr>` +
    '<w:tblGrid><w:gridCol w:w="8800"/></w:tblGrid>' +
    (options.centred ? '<w:tr><w:trPr><w:trHeight w:val="6000"/></w:trPr>' : '<w:tr>') +
    '<w:tc><w:tcPr><w:tcW w:w="8800" w:type="dxa"/>' +
    (options.centred ? '<w:vAlign w:val="center"/>' : '') +
    '</w:tcPr>' +
    '<w:p><w:r><w:drawing>' +
    '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0"' +
    ` allowOverlap="1" layoutInCell="${options.layoutInCell}" relativeHeight="1">` +
    '<wp:simplePos x="0" y="0"/>' +
    `<wp:positionH relativeFrom="${options.horizontalFrame ?? 'column'}"><wp:posOffset>0</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="${options.verticalFrame ?? 'paragraph'}"><wp:posOffset>0</wp:posOffset></wp:positionV>` +
    '<wp:extent cx="1828800" cy="914400"/>' +
    (options.wrap === 'topAndBottom'
      ? '<wp:wrapTopAndBottom distT="0" distB="0"/>'
      : '<wp:wrapSquare wrapText="bothSides" distT="0" distB="0" distL="0" distR="0"/>') +
    '<wp:docPr id="1" name="pic"/>' +
    `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    '<pic:spPr><a:xfrm><a:ext cx="1828800" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic>' +
    '</wp:anchor></w:drawing></w:r>' +
    `<w:r><w:t>${options.text}</w:t></w:r></w:p>` +
    '</w:tc></w:tr></w:tbl></w:body></w:document>'
  );
}
