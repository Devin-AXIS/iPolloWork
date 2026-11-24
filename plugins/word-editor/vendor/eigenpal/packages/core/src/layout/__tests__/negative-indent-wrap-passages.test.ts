// A paragraph with a negative indent starts left of the column, or ends right of it, also when a
// wrapping picture elsewhere on the page makes the line break look for wrap passages.

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
import type { PageGeometry } from '../semantic-records.ts';

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

function load(indent: string, wrap: string): OoxmlPart {
  const xml =
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body>` +
    `<w:p>${picture(0, wrap)}<w:r><w:t>Top</w:t></w:r></w:p>` +
    '<w:p/><w:p/><w:p/><w:p/><w:p/><w:p/>' +
    `<w:p><w:pPr><w:ind ${indent}/></w:pPr><w:r><w:t>${'word '.repeat(40)}End</w:t></w:r></w:p>` +
    '</w:body></w:document>';
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

/** The left edge of the first word and the right edge of the widest line of the last paragraph. */
function edges(indent: string, wrap: string): [number, number] {
  const part = load(indent, wrap);
  const layout = layoutSemanticDocument(part, 1, {
    measurer,
    geometry: GEOMETRY,
    inlineDrawingLayout: context(part),
  });
  const paragraphs = layout.pages[0]!.fragments.filter((f) => f.kind === 'paragraph');
  const last = paragraphs.at(-1)!;
  if (last.kind !== 'paragraph') throw new Error('Missing paragraph');
  const left = last.lines[0]!.spans[0]!.box.x;
  const right = Math.max(
    ...last.lines.slice(0, -1).map((line) => {
      const span = line.spans.filter((s) => s.text.trim()).at(-1)!;
      return span.box.x + measurer.measure(span.text.trim(), span.style);
    })
  );
  return [left, right];
}

const SQUARE = '<wp:wrapSquare wrapText="bothSides"/>';
const NONE = '<wp:wrapNone/>';

describe('negative indents beside wrap passages', () => {
  test('a negative left indent starts left of the column with a wrapping picture on the page', () => {
    expect(edges('w:left="-90"', SQUARE)[0]).toBeCloseTo(-4.5, 3);
    expect(edges('w:left="-90"', SQUARE)[0]).toBeCloseTo(edges('w:left="-90"', NONE)[0], 3);
  });

  test('a negative right indent ends right of the column with a wrapping picture on the page', () => {
    const column = GEOMETRY.width - GEOMETRY.margin.left - GEOMETRY.margin.right;
    expect(edges('w:right="-600"', SQUARE)[1]).toBeGreaterThan(column);
    expect(edges('w:right="-600"', SQUARE)[1]).toBeCloseTo(edges('w:right="-600"', NONE)[1], 3);
  });
});
