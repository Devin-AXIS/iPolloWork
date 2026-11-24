// The PAINTED half of #274. Layout resolves a body anchored drawing in page-content
// coordinates and paint converts it back to the sheet through `bodyAnchorOrigin`. The layout
// test pins the first half; only this one fails when the second half drifts, and the bug the
// issue reports is a painted `style.top`.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  indexInlineDrawingProjectionsInPart,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';
import { mockReadyImageResource } from '../../store/__tests__/drawing-ready-fixture.ts';
import {
  WML_NAMESPACE_URI,
  readOoxmlPart,
  type OoxmlPart,
} from '../../store/package/ooxml-tree.ts';
import { layoutHeaderFooterStory } from '../../layout/hf-layout.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../../layout/semantic-layout.ts';
import type { PageFurniture, PageGeometry, SemanticLayout } from '../../layout/semantic-records.ts';
import { paintSemanticLayout } from '../semantic-paint.ts';
import type { PaintImageUrlPort } from '../semantic-paint-drawings.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const OWNER = '/word/document.xml';
const measurer = createFixedMeasurer(6, 14);

const GEOMETRY: PageGeometry = {
  width: 300,
  height: 400,
  margin: { top: 20, right: 20, bottom: 20, left: 20 },
  headerDistance: 10,
  footerDistance: 10,
};

const READY_PNG = mockReadyImageResource({
  bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
  pixelWidth: 400,
  pixelHeight: 200,
});

const urlPort: PaintImageUrlPort = {
  create: (handle, mime) => `blob:fake/${mime}/${handle.resourceKey}`,
  revoke: () => {},
};

function documentXml(offsetEmu: number): string {
  return (
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" ` +
    `xmlns:pic="${PIC}" xmlns:r="${R}"><w:body>` +
    '<w:p><w:r><w:drawing>' +
    '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="1" locked="0"' +
    ' allowOverlap="1" layoutInCell="1" relativeHeight="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
    `<wp:positionV relativeFrom="page"><wp:posOffset>${offsetEmu}</wp:posOffset></wp:positionV>` +
    '<wp:extent cx="1828800" cy="914400"/>' +
    '<wp:wrapNone/>' +
    '<wp:docPr id="1" name="pic1"/>' +
    `<a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:nvPicPr>` +
    '<pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:ext cx="1828800" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>' +
    '<w:p><w:r><w:t>body text</w:t></w:r></w:p>' +
    '</w:body></w:document>'
  );
}

function load(xml: string, name: string): OoxmlPart {
  const result = readOoxmlPart(xml, { name, contentType: 'application/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

/** A two-line header: taller than the 20pt top margin once the header distance is added. */
function tallHeader(): PageFurniture {
  const part = load(
    `<w:hdr xmlns:w="${WML_NAMESPACE_URI}">` +
      '<w:p><w:r><w:t>letterhead</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>second line</w:t></w:r></w:p></w:hdr>',
    '/word/header1.xml'
  );
  return {
    titlePage: false,
    evenAndOddHeaders: false,
    headers: new Map([['default', layoutHeaderFooterStory(part, 260, measurer, 'test')]]),
    footers: new Map(),
  };
}

function lay(offsetEmu: number, furniture?: PageFurniture): SemanticLayout {
  const part = load(documentXml(offsetEmu), OWNER);
  const projections = indexInlineDrawingProjectionsInPart(part);
  return layoutSemanticDocument(part, 1, {
    measurer,
    geometry: GEOMETRY,
    inlineDrawingLayout: {
      ownerPartName: OWNER,
      projectionForAtom: (atomId) => projections.get(atomId) ?? null,
      project: (node) =>
        projections.get(node.id) ??
        projectDrawing(node, { ownerPartName: OWNER, limits: DEFAULT_DRAWING_PROJECTION_LIMITS }),
      resourceOf: () => READY_PNG,
    },
    ...(furniture ? { furniture } : {}),
  });
}

/** `style.top` of the painted drawing, which its layer makes page-relative. */
function paintedTop(layout: SemanticLayout): number {
  const container = document.createElement('div');
  paintSemanticLayout(container, layout, { scale: 1, imageUrlPort: urlPort, ariaHidden: false });
  const drawing = container.querySelector<HTMLElement>('.docx-drawing-layer-behind > *');
  if (!drawing) throw new Error('expected a behind-text anchored drawing on the painted page');
  return parseFloat(drawing.style.top);
}

describe('a page-anchored body drawing paints on the sheet edge', () => {
  test('a zero offset paints at the page top under a tall header', () => {
    expect(paintedTop(lay(0, tallHeader()))).toBeCloseTo(0, 3);
  });

  test('a 72pt offset paints 72pt down under a tall header', () => {
    expect(paintedTop(lay(914400, tallHeader()))).toBeCloseTo(72, 3);
  });

  test('the header does not move it — the painted top matches the header-free page', () => {
    expect(paintedTop(lay(0, tallHeader()))).toBeCloseTo(paintedTop(lay(0)), 6);
  });
});
