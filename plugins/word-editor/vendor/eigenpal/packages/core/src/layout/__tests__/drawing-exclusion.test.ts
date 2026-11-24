// Task 9 — exclusion zones, paint order, overlap displacement (typed-drawings-and-images).

import { describe, expect, test } from 'bun:test';
import {
  WML_NAMESPACE_URI,
  readOoxmlPart,
  type OoxmlDrawingNode,
  type OoxmlPart,
} from '../../store/package/ooxml-tree.ts';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';
import type { ImageResourceState } from '../../store/package/image-resources.ts';
import {
  buildAnchoredDrawingRecord,
  emuToPoints,
  measureInlineDrawing,
  resolveAnchoredDrawingPosition,
  type DrawingAnchorFrameContext,
  type InlineDrawingLayoutInput,
} from '../drawing-layout.ts';
import {
  compareDrawingPaintOrder,
  exclusionLayoutToken,
  exclusionZoneFromAnchoredDrawing,
  mergeAvailableIntervalsAtY,
  paintLayerOf,
  remainingWidthAtX,
  sortDrawingsForPaint,
  wrapExclusionInputForProjection,
} from '../drawing-exclusion.ts';
import { resolveOverlapDisplacement } from '../drawing-overlap.ts';
import { availableTextIntervalsOnScanline } from '../drawing-wrap.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

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

function load(xml: string): OoxmlPart {
  const result = readOoxmlPart(xml, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function drawingOf(part: OoxmlPart): OoxmlDrawingNode {
  const stack = [part.root];
  while (stack.length > 0) {
    const node = stack.shift()!;
    if (node.kind === 'drawing') return node;
    for (const child of node.children) {
      if (child.kind !== 'textValue') stack.push(child);
    }
  }
  throw new Error('missing drawing');
}

function anchorXml(
  options: {
    readonly wrap?: string;
    readonly behindDoc?: string;
    readonly allowOverlap?: string;
    readonly relativeHeight?: string;
    readonly positionH?: string;
    readonly positionV?: string;
  } = {}
): string {
  const wrap =
    options.wrap ?? '<wp:wrapSquare wrapText="bothSides" distT="0" distB="0" distL="0" distR="0"/>';
  return (
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    '<w:body><w:p><w:r><w:t>x</w:t></w:r><w:r><w:drawing>' +
    `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="${options.behindDoc ?? '0'}" locked="0" allowOverlap="${options.allowOverlap ?? '1'}" layoutInCell="1" relativeHeight="${options.relativeHeight ?? '1'}">` +
    '<wp:simplePos x="0" y="0"/>' +
    (options.positionH ??
      '<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>') +
    (options.positionV ??
      '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>') +
    '<wp:extent cx="914400" cy="457200"/>' +
    wrap +
    '<wp:docPr id="1" name="a"/>' +
    `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>' +
    '</wp:anchor></w:drawing></w:r></w:p></w:body></w:document>'
  );
}

function frame(): DrawingAnchorFrameContext {
  return Object.freeze({
    pageNumber: 1,
    pageWidth: 612,
    pageHeight: 792,
    marginLeft: 72,
    marginRight: 72,
    marginBottom: 72,
    contentInsetTop: 72,
    contentInsetBottom: 72,
    contentWidth: 468,
    contentHeight: 648,
    contentBandHeight: 648,
    paragraphBox: Object.freeze({ x: 0, y: 10, width: 468, height: 14 }),
    anchorLineBox: Object.freeze({ x: 0, y: 10, width: 468, height: 14 }),
    anchorCharacterX: 6,
    columnBox: Object.freeze({ x: 0, y: 10, width: 468, height: 14 }),
    cellBox: null,
    layoutInCell: true,
    ownerPartName: '/word/document.xml',
    storyKind: 'body' as const,
  });
}

function anchoredRecord(part: OoxmlPart): ReturnType<typeof buildAnchoredDrawingRecord> {
  const projection = projectDrawing(drawingOf(part), {
    ownerPartName: '/word/document.xml',
    limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
  })!;
  const resolved = resolveAnchoredDrawingPosition(projection, frame());
  const input: InlineDrawingLayoutInput = Object.freeze({
    drawingNodeId: projection.drawingNodeId,
    ownerPartName: '/word/document.xml',
    projection,
    resource: READY,
  });
  return buildAnchoredDrawingRecord({
    input,
    anchorParagraphId: 'p1',
    start: 1,
    resolved,
    layoutInCell: projection.anchor?.layoutInCell ?? true,
  });
}

describe('wrapNone behind/inFront produce no exclusion', () => {
  test('behind wrapNone returns null exclusion zone', () => {
    const part = load(anchorXml({ wrap: '<wp:wrapNone/>', behindDoc: '1' }));
    const projection = projectDrawing(drawingOf(part), {
      ownerPartName: '/word/document.xml',
      limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    })!;
    const drawing = anchoredRecord(part);
    expect(
      wrapExclusionInputForProjection({
        projection,
        geometry: drawing.geometry,
        contentLeft: 0,
        contentRight: 468,
        anchorX: drawing.x,
        anchorY: drawing.y,
      })
    ).toBeNull();
    expect(
      exclusionZoneFromAnchoredDrawing({
        drawing,
        projection,
        sourceOrder: 0,
        contentLeft: 0,
        contentRight: 468,
      })
    ).toBeNull();
  });

  test('inFront wrapNone returns null exclusion zone', () => {
    const part = load(anchorXml({ wrap: '<wp:wrapNone/>', behindDoc: '0' }));
    const projection = projectDrawing(drawingOf(part), {
      ownerPartName: '/word/document.xml',
      limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    })!;
    const drawing = anchoredRecord(part);
    expect(
      exclusionZoneFromAnchoredDrawing({
        drawing,
        projection,
        sourceOrder: 0,
        contentLeft: 0,
        contentRight: 468,
      })
    ).toBeNull();
  });

  // `behindDoc` controls painting, while the wrap element controls text flow.
  test.each([
    ['square', '<wp:wrapSquare wrapText="bothSides" distT="0" distB="0" distL="0" distR="0"/>'],
    [
      'tight',
      '<wp:wrapTight wrapText="bothSides"><wp:wrapPolygon edited="0">' +
        '<wp:start x="0" y="0"/><wp:lineTo x="0" y="21600"/><wp:lineTo x="21600" y="21600"/>' +
        '<wp:lineTo x="21600" y="0"/><wp:lineTo x="0" y="0"/>' +
        '</wp:wrapPolygon></wp:wrapTight>',
    ],
  ] as const)('%s wrap still excludes when behindDoc is set', (_label, wrap) => {
    const part = load(anchorXml({ wrap, behindDoc: '1' }));
    const projection = projectDrawing(drawingOf(part), {
      ownerPartName: '/word/document.xml',
      limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    })!;
    const drawing = anchoredRecord(part);
    expect(drawing.behindDocument).toBe(true);
    const zone = exclusionZoneFromAnchoredDrawing({
      drawing,
      projection,
      sourceOrder: 0,
      contentLeft: 0,
      contentRight: 468,
    });
    expect(zone).not.toBeNull();
    expect(paintLayerOf(drawing)).toBe('behind');
  });
});

describe('square wrap feeds scanline intervals into line breaking', () => {
  test('bothSides leaves passages left and right of the drawing', () => {
    const part = load(anchorXml());
    const projection = projectDrawing(drawingOf(part), {
      ownerPartName: '/word/document.xml',
      limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    })!;
    const drawing = anchoredRecord(part);
    const zone = exclusionZoneFromAnchoredDrawing({
      drawing,
      projection,
      sourceOrder: 0,
      contentLeft: 0,
      contentRight: 468,
    })!;
    const y = drawing.y + drawing.height / 2;
    const merged = mergeAvailableIntervalsAtY(y, [zone], 0, 468);
    expect(merged.length).toBeGreaterThanOrEqual(1);
    expect(merged.some((interval) => interval.start >= drawing.x + drawing.width - 0.1)).toBe(true);
    expect(
      merged.every(
        (interval) =>
          interval.end <= drawing.x + 0.1 || interval.start >= drawing.x + drawing.width - 0.1
      )
    ).toBe(true);
  });

  test('squareLeft keeps only the left passage', () => {
    const part = load(
      anchorXml({
        wrap: '<wp:wrapSquare wrapText="left" distT="0" distB="0" distL="0" distR="0"/>',
      })
    );
    const projection = projectDrawing(drawingOf(part), {
      ownerPartName: '/word/document.xml',
      limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    })!;
    const drawing = anchoredRecord(part);
    const zone = exclusionZoneFromAnchoredDrawing({
      drawing,
      projection,
      sourceOrder: 0,
      contentLeft: 0,
      contentRight: 468,
    })!;
    const y = drawing.y + drawing.height / 2;
    const atY = availableTextIntervalsOnScanline(y, zone.input);
    expect(atY.every((interval) => interval.end <= drawing.x + 0.1)).toBe(true);
  });
});

describe('paint order and overlap displacement', () => {
  test('stable sort: layer, relativeHeight, source order, node id', () => {
    const partA = load(anchorXml({ relativeHeight: '2' }));
    const partB = load(anchorXml({ relativeHeight: '9', behindDoc: '1' }));
    const a = anchoredRecord(partA);
    const b = anchoredRecord(partB);
    expect(compareDrawingPaintOrder(b, a)).toBeLessThan(0);
    expect(paintLayerOf(b)).toBe('behind');
    expect(paintLayerOf(a)).toBe('inFront');
    const sorted = sortDrawingsForPaint([a, b]);
    expect(sorted[0]).toBe(b);
    expect(sorted[1]).toBe(a);
  });

  test('allowOverlap=false displaces the later drawing downward', () => {
    const part = load(anchorXml({ allowOverlap: '0' }));
    const first = anchoredRecord(part);
    const second = Object.freeze({
      ...anchoredRecord(part),
      drawingNodeId: 'second',
      y: first.y,
      paintBounds: Object.freeze({ ...first.paintBounds }),
      hitBounds: Object.freeze({ ...first.hitBounds }),
    });
    const resolved = resolveOverlapDisplacement([first, second], { contentHeight: 648 });
    expect(resolved.drawings).toHaveLength(2);
    expect(resolved.drawings[1]!.y).toBeGreaterThan(first.y);
  });
});

describe('exclusion cache token', () => {
  test('token changes when displaced y changes', () => {
    const part = load(anchorXml());
    const projection = projectDrawing(drawingOf(part), {
      ownerPartName: '/word/document.xml',
      limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    })!;
    const drawing = anchoredRecord(part);
    const zoneA = exclusionZoneFromAnchoredDrawing({
      drawing,
      projection,
      sourceOrder: 0,
      contentLeft: 0,
      contentRight: 468,
    })!;
    const zoneB = exclusionZoneFromAnchoredDrawing({
      drawing,
      projection,
      sourceOrder: 0,
      contentLeft: 0,
      contentRight: 468,
      yOverride: drawing.y + 20,
    })!;
    expect(exclusionLayoutToken([zoneA])).not.toBe(exclusionLayoutToken([zoneB]));
  });
});

describe('remaining width helper', () => {
  test('returns width to interval end from x', () => {
    expect(remainingWidthAtX(10, [{ start: 0, end: 100 }])).toBeCloseTo(90, 3);
    expect(remainingWidthAtX(150, [{ start: 0, end: 100 }])).toBe(0);
  });
});
