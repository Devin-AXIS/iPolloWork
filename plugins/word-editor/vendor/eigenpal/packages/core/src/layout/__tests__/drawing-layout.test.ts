// Inline drawing layout, hit testing, and caret offsets (typed-drawings-and-images task 6).

import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  WML_NAMESPACE_URI,
  type OoxmlDrawingNode,
  type OoxmlPart,
} from '../../store/package/ooxml-tree.ts';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  indexInlineDrawingProjectionsInPart,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';
import type { ImageResourceState } from '../../store/package/image-resources.ts';
import {
  emuToPoints,
  lineLayoutAtoms,
  measureInlineDrawing,
  resolveAnchoredDrawingPosition,
  shiftAnchoredDrawingRecords,
  type InlineDrawingLayoutContext,
} from '../drawing-layout.ts';
import { hitTestPage } from '../semantic-hit-test.ts';
import { caretAt, moveCaret } from '../semantic-interaction.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';
import { linesOf, paragraphFragmentsOf, type PageGeometry } from '../semantic-records.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

const measurer = createFixedMeasurer(6, 14);
const OWNER = '/word/document.xml';

const READY_RESOURCE: ImageResourceState = Object.freeze({
  kind: 'ready',
  partName: '/word/media/image1.png',
  contentId: 'image1',
  resourceKey: 'k1',
  mime: 'image/png',
  pixelWidth: 4000,
  pixelHeight: 2000,
  dpiX: 96,
  dpiY: 96,
});

function inlinePictureXml(
  options: {
    readonly extent?: string;
    readonly inlineAttrs?: string;
    readonly before?: string;
    readonly after?: string;
    readonly hidden?: boolean;
  } = {}
): string {
  const extent = options.extent ?? 'cx="914400" cy="457200"';
  const inlineAttrs = options.inlineAttrs ?? 'distT="0" distB="0" distL="0" distR="0"';
  const hiddenAttr = options.hidden ? ' hidden="1"' : '';
  const docPr = `id="1" name="pic" descr="alt"${hiddenAttr}`;
  const before = options.before ?? '';
  const after = options.after ?? '';
  return (
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    '<w:body><w:p>' +
    before +
    '<w:r><w:drawing>' +
    `<wp:inline ${inlineAttrs}>` +
    `<wp:extent ${extent}/>` +
    `<wp:docPr ${docPr}/>` +
    '<wp:cNvGraphicFramePr/>' +
    `<a:graphic><a:graphicData uri="${PIC_URI}">` +
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rId14"/></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>' +
    '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>' +
    after +
    '</w:p></w:body></w:document>'
  );
}

function load(bodyOrDoc: string, owner: string = OWNER): OoxmlPart {
  const xml = bodyOrDoc.startsWith('<w:document')
    ? bodyOrDoc
    : `<w:document xmlns:w="${WML_NAMESPACE_URI}"><w:body>${bodyOrDoc}</w:body></w:document>`;
  const result = readOoxmlPart(xml, {
    name: owner,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function drawingOf(part: OoxmlPart): OoxmlDrawingNode {
  const stack: import('../../store/package/ooxml-tree.ts').OoxmlElement[] = [part.root];
  while (stack.length > 0) {
    const node = stack.shift()!;
    if (node.kind === 'drawing') return node;
    for (const child of node.children) {
      if (child.kind !== 'textValue') stack.push(child);
    }
  }
  throw new Error('missing drawing');
}

function layoutContext(
  part: OoxmlPart,
  resource: ImageResourceState = READY_RESOURCE,
  owner: string = OWNER
): InlineDrawingLayoutContext {
  const atomProjections = indexInlineDrawingProjectionsInPart(part);
  return {
    ownerPartName: owner,
    projectionForAtom: (atomId) => atomProjections.get(atomId) ?? null,
    project: (node) =>
      atomProjections.get(node.id) ??
      projectDrawing(node, { ownerPartName: owner, limits: DEFAULT_DRAWING_PROJECTION_LIMITS }),
    resourceOf: () => resource,
  };
}

function lay(part: OoxmlPart, drawingLayout?: InlineDrawingLayoutContext, geometry?: PageGeometry) {
  return layoutSemanticDocument(part, 1, {
    measurer,
    ...(geometry ? { geometry } : {}),
    ...(drawingLayout ? { inlineDrawingLayout: drawingLayout } : {}),
  });
}

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;

describe('measureInlineDrawing', () => {
  test('converts wp:extent EMUs to points without using pixel dimensions', () => {
    const part = load(inlinePictureXml());
    const projection = projectDrawing(drawingOf(part), {
      ownerPartName: OWNER,
      limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    })!;
    const measure = measureInlineDrawing(projection);
    expect(measure.width).toBe(emuToPoints(914400));
    expect(measure.height).toBe(emuToPoints(457200));
    expect(measure.width).not.toBe(READY_RESOURCE.pixelWidth);
  });

  test('effect extents still reserve space when inline wrap distances are ignored', () => {
    const xml = inlinePictureXml({
      inlineAttrs: 'distT="914400" distB="914400" distL="914400" distR="914400"',
    }).replace('<wp:docPr', '<wp:effectExtent l="12700" r="25400" t="38100" b="50800"/><wp:docPr');
    const part = load(xml);
    const projection = projectDrawing(drawingOf(part), {
      ownerPartName: OWNER,
      limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    })!;
    const measure = measureInlineDrawing(projection);
    expect(measure.totalWidth).toBe(75);
    expect(measure.lineContribution).toBe(43);
    expect([measure.effectL, measure.effectR, measure.effectT, measure.effectB]).toEqual([
      1, 2, 3, 4,
    ]);
  });
});

describe('lays out inline drawings', () => {
  test('text-image-text on one line with one UTF-16 unit for the drawing', () => {
    const part = load(
      inlinePictureXml({
        before: run('A'),
        after: run('B'),
        inlineAttrs: 'distT="0" distB="0" distL="0" distR="0"',
      })
    );
    const layout = lay(part, layoutContext(part));
    const [line] = linesOf(layout);
    expect(lineLayoutAtoms(line!).map((atom) => atom.kind)).toEqual([
      'text',
      'inlineDrawing',
      'text',
    ]);
    expect(lineLayoutAtoms(line!)[1]).toMatchObject({
      start: 1,
      width: emuToPoints(914400),
      height: emuToPoints(457200),
    });
    expect(line!.range.end).toBe(3);
    expect(line!.drawings).toHaveLength(1);
    expect(line!.drawings![0]!.start).toBe(1);
  });

  test('inline wrap distances remain in the projection without changing layout', () => {
    const part = load(
      inlinePictureXml({
        before: run('A'),
        after: run('B'),
        inlineAttrs: 'distT="38100" distB="50800" distL="12700" distR="25400"',
      })
    );
    const projection = projectDrawing(drawingOf(part), {
      ownerPartName: OWNER,
      limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    })!;
    expect(projection.inlineDistancesEmu).toEqual({
      top: 38100,
      bottom: 50800,
      left: 12700,
      right: 25400,
    });
    const measure = measureInlineDrawing(projection);
    expect([measure.distL, measure.distR, measure.distT, measure.distB]).toEqual([0, 0, 0, 0]);
    const layout = lay(part, layoutContext(part));
    const [line] = linesOf(layout);
    const textWidth = line!.spans[0]!.box.width;
    expect(line!.drawings![0]!.x).toBeCloseTo(textWidth + measure.distL, 5);
    const used = line!.drawings![0]!.x + measure.width + measure.distR;
    expect(used).toBeCloseTo(textWidth + measure.totalWidth, 5);
    const zeroPart = load(inlinePictureXml({ before: run('A'), after: run('B') }));
    const [zeroLine] = linesOf(lay(zeroPart, layoutContext(zeroPart)));
    expect(line!.box).toEqual(zeroLine!.box);
    expect(line!.baseline).toBe(zeroLine!.baseline);
    expect(line!.spans.map((span) => span.box)).toEqual(zeroLine!.spans.map((span) => span.box));
    expect(line!.drawings![0]!.x).toBe(zeroLine!.drawings![0]!.x);
    expect(line!.drawings![0]!.y).toBe(zeroLine!.drawings![0]!.y);
  });

  test('wraps an image wider than the remaining line to the next line', () => {
    const part = load(
      inlinePictureXml({
        before: run('W'.repeat(30)),
        inlineAttrs: 'distT="0" distB="0" distL="0" distR="0"',
      })
    );
    const layout = lay(part, layoutContext(part), {
      width: 120,
      height: 800,
      margin: { top: 10, right: 10, bottom: 10, left: 10 },
    });
    const fragment = paragraphFragmentsOf(layout.pages[0]!)[0]!;
    expect(fragment.lines.length).toBeGreaterThan(1);
    expect(fragment.lines.some((line) => line.drawings?.length === 1)).toBe(true);
  });

  test('wraps text typed after an inline image within the content width', () => {
    const part = load(
      inlinePictureXml({
        before: run('A'),
        after: run(' one two three four five six seven eight nine ten'),
        inlineAttrs: 'distT="0" distB="0" distL="0" distR="0"',
      })
    );
    const layout = lay(part, layoutContext(part), {
      width: 120,
      height: 800,
      margin: { top: 10, right: 10, bottom: 10, left: 10 },
    });
    const fragment = paragraphFragmentsOf(layout.pages[0]!)[0]!;

    expect(fragment.lines.length).toBeGreaterThan(1);
    expect(fragment.lines.every((line) => line.box.width <= 100)).toBe(true);
  });

  test('grows line height when the image is taller than text', () => {
    const part = load(inlinePictureXml({ extent: 'cx="152400" cy="914400"' }));
    const layout = lay(part, layoutContext(part));
    const [line] = linesOf(layout);
    expect(line!.box.height).toBeGreaterThan(14);
    expect(line!.drawings![0]!.height).toBe(emuToPoints(914400));
  });

  test('lays out an image-only paragraph on one line', () => {
    const part = load(inlinePictureXml());
    const layout = lay(part, layoutContext(part));
    const [line] = linesOf(layout);
    expect(line!.spans).toEqual([]);
    expect(line!.drawings).toHaveLength(1);
    expect(line!.range).toEqual({ paragraphId: expect.any(String), start: 0, end: 1 });
  });

  test('preserves authored extent when wider than the content box and clips paint bounds', () => {
    const part = load(inlinePictureXml({ extent: 'cx="3657600" cy="457200"' }));
    const layout = lay(part, layoutContext(part), {
      width: 120,
      height: 800,
      margin: { top: 10, right: 10, bottom: 10, left: 10 },
    });
    const [line] = linesOf(layout);
    const drawing = line!.drawings![0]!;
    expect(drawing.width).toBe(emuToPoints(3657600));
    expect(drawing.paintBounds.width).toBeLessThan(drawing.width);
    expect(drawing.paintBounds.width).toBeGreaterThan(0);
  });

  test('uses intrinsic pixels only for resource metadata, never layout extent', () => {
    const part = load(inlinePictureXml({ extent: 'cx="914400" cy="457200"' }));
    const resource: ImageResourceState = Object.freeze({
      ...READY_RESOURCE,
      pixelWidth: 9999,
      pixelHeight: 8888,
    });
    const layout = lay(part, layoutContext(part, resource));
    const drawing = linesOf(layout)[0]!.drawings![0]!;
    expect(drawing.width).toBe(emuToPoints(914400));
    expect(drawing.resource).toEqual(resource);
  });

  test('page-bottom split keeps the drawing on one fragment line', () => {
    const tallBefore = run('L'.repeat(80));
    const part = load(
      inlinePictureXml({
        before: tallBefore,
        extent: 'cx="914400" cy="685800"',
      })
    );
    const SMALL: PageGeometry = {
      width: 120,
      height: 80,
      margin: { top: 10, right: 10, bottom: 10, left: 10 },
    };
    const layout = lay(part, layoutContext(part), SMALL);
    const allLines = layout.pages.flatMap((page) =>
      paragraphFragmentsOf(page).flatMap((fragment) => fragment.lines)
    );
    const drawingLines = allLines.filter((line) => (line.drawings?.length ?? 0) > 0);
    expect(drawingLines.length).toBe(1);
    expect(layout.pages.length).toBeGreaterThan(1);
  });

  test('header/footer inline image placement uses the same inline records', () => {
    const headerXml =
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
      '<w:body><w:p>' +
      run('H') +
      '<w:r><w:drawing>' +
      '<wp:inline distT="0" distB="0" distL="0" distR="0">' +
      '<wp:extent cx="914400" cy="457200"/>' +
      '<wp:docPr id="2" name="hf"/>' +
      '<wp:cNvGraphicFramePr/>' +
      `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>` +
      '<pic:blipFill><a:blip r:embed="rId14"/></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>' +
      '</wp:inline></w:drawing></w:r></w:p></w:body></w:document>';
    const headerPart = load(headerXml);
    const headerLayout = layoutSemanticDocument(headerPart, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(headerPart, READY_RESOURCE, '/word/header1.xml'),
    });
    const [line] = linesOf(headerLayout);
    expect(line!.drawings).toHaveLength(1);
    expect(line!.drawings![0]!.ownerPartName).toBe('/word/header1.xml');
  });
});

describe('hit tests inline drawings', () => {
  function layoutWithImage() {
    const part = load(
      inlinePictureXml({
        before: run('A'),
        after: run('B'),
        inlineAttrs: 'distT="0" distB="0" distL="0" distR="0"',
      })
    );
    return lay(part, layoutContext(part));
  }

  test('clicking inside text after a drawing stays inside that text', () => {
    const part = load(
      inlinePictureXml({
        before: run('red '),
        after: run('blue'),
        inlineAttrs: 'distT="0" distB="0" distL="0" distR="0"',
      })
    );
    const layout = lay(part, layoutContext(part));
    const line = linesOf(layout)[0]!;
    const blue = line.spans.find((span) => span.text === 'blue')!;

    const hit = hitTestPage(layout, 0, {
      x: blue.box.x + blue.box.width / 2,
      y: line.box.y + line.box.height / 2,
    })!;

    expect(hit.position.offset).toBeGreaterThan(blue.range.start);
    expect(hit.position.offset).toBeLessThan(blue.range.end);
    expect(hit.drawing).toBeNull();
  });

  test('clicking inside text between two drawings stays inside that text', () => {
    const drawingOnly = inlinePictureXml();
    const drawingRun = drawingOnly.slice(
      drawingOnly.indexOf('<w:r><w:drawing>'),
      drawingOnly.indexOf('</w:p>')
    );
    const part = load(
      inlinePictureXml({
        before: run('Inline: ') + drawingRun + run('red '),
        after: run('blue'),
        inlineAttrs: 'distT="0" distB="0" distL="0" distR="0"',
      })
    );
    const layout = lay(part, layoutContext(part));
    const line = linesOf(layout)[0]!;
    const red = line.spans.find((span) => span.text === 'red ')!;

    const hit = hitTestPage(layout, 0, {
      x: red.box.x + 6,
      y: line.box.y + line.box.height / 2,
    })!;

    expect(hit.position.offset).toBe(red.range.start + 1);
    expect(hit.drawing).toBeNull();
  });

  test('inside the drawing maps to the atomic model offset', () => {
    const layout = layoutWithImage();
    const line = linesOf(layout)[0]!;
    const drawing = line.drawings![0]!;
    const hit = hitTestPage(layout, 0, {
      x: drawing.hitBounds.x + drawing.hitBounds.width / 2,
      y: line.box.y + drawing.y + drawing.height / 2,
    })!;
    expect(hit.position.offset).toBe(1);
    expect(hit.onGlyphs).toBe(true);
  });

  test('edge before the drawing prefers offset before the atom', () => {
    const layout = layoutWithImage();
    const line = linesOf(layout)[0]!;
    const drawing = line.drawings![0]!;
    const hit = hitTestPage(layout, 0, {
      x: drawing.hitBounds.x - 1,
      y: line.box.y + line.baseline,
    })!;
    expect(hit.position.offset).toBe(1);
  });

  test('edge after the drawing prefers offset after the atom', () => {
    const layout = layoutWithImage();
    const line = linesOf(layout)[0]!;
    const drawing = line.drawings![0]!;
    const hit = hitTestPage(layout, 0, {
      x: drawing.hitBounds.x + drawing.hitBounds.width + 1,
      y: line.box.y + line.baseline,
    })!;
    expect(hit.position.offset).toBe(2);
  });

  test('outside vertically still resolves to the line', () => {
    const layout = layoutWithImage();
    const line = linesOf(layout)[0]!;
    const drawing = line.drawings![0]!;
    const hit = hitTestPage(layout, 0, {
      x: drawing.hitBounds.x + 2,
      y: line.box.y - 5,
    })!;
    expect(hit.position.paragraphId).toBe(line.range.paragraphId);
  });

  test('caret affinity steps over the drawing as one unit', () => {
    const layout = layoutWithImage();
    const line = linesOf(layout)[0]!;
    const forward = moveCaret(layout, { paragraphId: line.range.paragraphId, offset: 0 }, 'right');
    expect(forward?.position.offset).toBe(1);
    const over = moveCaret(layout, forward!.position, 'right');
    expect(over?.position.offset).toBe(2);
    const back = moveCaret(layout, over!.position, 'left');
    expect(back?.position.offset).toBe(1);
  });

  test('hidden drawing produces no visible or hittable record while projection stays available', () => {
    const part = load(inlinePictureXml({ hidden: true, before: run('X') }));
    const projection = projectDrawing(drawingOf(part), {
      ownerPartName: OWNER,
      limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    })!;
    expect(projection.hidden).toBe(true);
    const layout = lay(part, layoutContext(part));
    const [line] = linesOf(layout);
    expect(line!.drawings ?? []).toEqual([]);
    expect(line!.range.end).toBe(2);
    const hit = hitTestPage(layout, 0, { x: line!.box.x + 10, y: line!.box.y + 5 })!;
    expect(hit.position.offset).toBeLessThanOrEqual(2);
  });
});

describe('caretAt on inline drawings', () => {
  test('returns geometry at the drawing edge for the atomic offset', () => {
    const part = load(inlinePictureXml({ before: run('A'), after: run('B') }));
    const layout = lay(part, layoutContext(part));
    const line = linesOf(layout)[0]!;
    const caret = caretAt(layout, { paragraphId: line.range.paragraphId, offset: 1 });
    expect(caret).not.toBeNull();
    expect(caret!.x).toBeCloseTo(line.drawings![0]!.x, 1);
  });
});

const ANCHOR_EXTENT = 'cx="914400" cy="457200"';

function anchoredPictureXml(
  options: {
    readonly positionH?: string;
    readonly positionV?: string;
    readonly anchorAttrs?: string;
    readonly simplePos?: string;
    readonly before?: string;
  } = {}
): string {
  const anchorAttrs =
    options.anchorAttrs ??
    'distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="952500"';
  const positionH =
    options.positionH ??
    '<wp:positionH relativeFrom="margin"><wp:align>right</wp:align></wp:positionH>';
  const positionV =
    options.positionV ??
    '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>';
  const simplePos = options.simplePos ?? '<wp:simplePos x="0" y="0"/>';
  const before = options.before ?? '';
  return (
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    '<w:body><w:p>' +
    before +
    '<w:r><w:drawing>' +
    `<wp:anchor ${anchorAttrs}>` +
    simplePos +
    positionH +
    positionV +
    `<wp:extent ${ANCHOR_EXTENT}/>` +
    '<wp:wrapSquare wrapText="bothSides"/>' +
    '<wp:docPr id="3" name="float"/>' +
    '<wp:cNvGraphicFramePr/>' +
    `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>` +
    '<pic:blipFill><a:blip r:embed="rId14"/></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>' +
    '</wp:anchor></w:drawing></w:r></w:p></w:body></w:document>'
  );
}

function anchorFrameContext(
  overrides: Partial<import('../drawing-layout.ts').DrawingAnchorFrameContext> = {}
) {
  const contentWidth = 468;
  return Object.freeze({
    pageNumber: 1,
    pageWidth: 612,
    pageHeight: 792,
    marginLeft: 72,
    marginRight: 72,
    marginBottom: 72,
    contentInsetTop: 72,
    contentInsetBottom: 72,
    contentWidth,
    contentHeight: 648,
    contentBandHeight: 648,
    paragraphBox: Object.freeze({ x: 0, y: 40, width: contentWidth, height: 20 }),
    anchorLineBox: Object.freeze({ x: 0, y: 40, width: contentWidth, height: 14 }),
    anchorCharacterX: 6,
    columnBox: Object.freeze({ x: 0, y: 40, width: contentWidth, height: 20 }),
    cellBox: null,
    layoutInCell: true,
    ownerPartName: OWNER,
    storyKind: 'body' as const,
    ...overrides,
  });
}

describe('resolves anchored position frames', () => {
  test('cell column and margin alignment use text padding while page keeps the physical cell', () => {
    const cellBox = { x: 100, y: 40, width: 200, height: 100 };
    const cellContentBox = { ...cellBox, x: 112, width: 170 };
    for (const [frame, right, outside] of [
      ['column', 282, 468],
      ['margin', 282, 468],
      ['page', 300, 540],
    ] as const) {
      const projection = projectDrawing(
        drawingOf(
          load(
            anchoredPictureXml({
              positionH: `<wp:positionH relativeFrom="${frame}"><wp:align>right</wp:align></wp:positionH>`,
            })
          )
        ),
        { ownerPartName: OWNER, limits: DEFAULT_DRAWING_PROJECTION_LIMITS }
      )!;
      expect(
        resolveAnchoredDrawingPosition(projection, anchorFrameContext({ cellBox, cellContentBox }))
          .x + 72
      ).toBeCloseTo(right, 5);
      expect(
        resolveAnchoredDrawingPosition(
          projection,
          anchorFrameContext({ cellBox, cellContentBox, layoutInCell: false })
        ).x + 72
      ).toBeCloseTo(outside, 5);
    }
  });
  test('margin right align places the right edge at the content edge', () => {
    const part = load(anchoredPictureXml());
    const projection = projectDrawing(drawingOf(part), {
      ownerPartName: OWNER,
      limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    })!;
    const resolved = resolveAnchoredDrawingPosition(projection, anchorFrameContext());
    const width = emuToPoints(914400);
    expect(resolved.horizontalFrame).toBe('margin');
    expect(resolved.x + width).toBeCloseTo(468, 3);
  });

  test('paragraph vertical offset zero aligns the top to the paragraph top', () => {
    const part = load(anchoredPictureXml());
    const projection = projectDrawing(drawingOf(part), {
      ownerPartName: OWNER,
      limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    })!;
    const ctx = anchorFrameContext();
    const resolved = resolveAnchoredDrawingPosition(projection, ctx);
    expect(resolved.verticalFrame).toBe('paragraph');
    expect(resolved.y).toBeCloseTo(ctx.paragraphBox.y, 3);
  });

  test('simplePos is authoritative over positionH and positionV', () => {
    const part = load(
      anchoredPictureXml({
        anchorAttrs:
          'distT="0" distB="0" distL="0" distR="0" simplePos="1" behindDoc="0" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="1"',
        simplePos: '<wp:simplePos x="127000" y="254000"/>',
        positionH: '<wp:positionH relativeFrom="margin"><wp:align>right</wp:align></wp:positionH>',
        positionV: '<wp:positionV relativeFrom="page"><wp:align>bottom</wp:align></wp:positionV>',
      })
    );
    const projection = projectDrawing(drawingOf(part), {
      ownerPartName: OWNER,
      limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    })!;
    const resolved = resolveAnchoredDrawingPosition(projection, anchorFrameContext());
    expect(resolved.x).toBeCloseTo(emuToPoints(127000) - 72, 3);
    expect(resolved.y).toBeCloseTo(emuToPoints(254000) - 72, 3);
  });

  // The frame origin is the CONTENT BOX, so a simplePos measured from the sheet corner has to
  // give back the inset — not the authored margin, which a tall header parts company with
  // (#274). 72 above is the case where the two coincide; this is the case where they do not.
  test('simplePos subtracts the content inset, not the authored margin', () => {
    const part = load(
      anchoredPictureXml({
        anchorAttrs:
          'distT="0" distB="0" distL="0" distR="0" simplePos="1" behindDoc="0" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="1"',
        simplePos: '<wp:simplePos x="127000" y="254000"/>',
        positionH: '<wp:positionH relativeFrom="margin"><wp:align>right</wp:align></wp:positionH>',
        positionV: '<wp:positionV relativeFrom="page"><wp:align>bottom</wp:align></wp:positionV>',
      })
    );
    const projection = projectDrawing(drawingOf(part), {
      ownerPartName: OWNER,
      limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    })!;
    const resolved = resolveAnchoredDrawingPosition(
      projection,
      anchorFrameContext({ contentInsetTop: 130, contentBandHeight: 590 })
    );
    expect(resolved.y).toBeCloseTo(emuToPoints(254000) - 130, 3);
  });

  // `contentHeight` is the FLOW height, which a note reserve shrinks below the content band.
  // The two are equal on an ordinary page, so only a hand-built frame can tell which one an
  // inside/outside align reads.
  test('outside vertical align spans the content band, not the note-shrunk flow height', () => {
    const part = load(
      anchoredPictureXml({
        positionV: '<wp:positionV relativeFrom="page"><wp:align>outside</wp:align></wp:positionV>',
      })
    );
    const projection = projectDrawing(drawingOf(part), {
      ownerPartName: OWNER,
      limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    })!;
    const resolved = resolveAnchoredDrawingPosition(
      projection,
      // Odd page: `outside` puts the object bottom on the band bottom.
      anchorFrameContext({ contentHeight: 400, contentBandHeight: 648 })
    );
    expect(resolved.y).toBeCloseTo(648 - emuToPoints(457200), 3);
  });

  test.each([
    ['page', 'left', null, -72],
    ['page', 'center', null, 612 / 2 - 72 - emuToPoints(914400) / 2],
    ['column', 'left', null, 0],
    ['character', 'left', null, 6],
    ['leftMargin', 'left', null, -72],
    ['rightMargin', 'right', null, 612 - 72 - emuToPoints(914400)],
    ['insideMargin', 'left', null, 0],
    ['outsideMargin', 'right', null, 612 - 72 - emuToPoints(914400)],
  ] as const)('horizontal %s align %s', (frame, align, offsetEmu, expectedX) => {
    const part = load(
      anchoredPictureXml({
        positionH: `<wp:positionH relativeFrom="${frame}"><wp:align>${align}</wp:align></wp:positionH>`,
      })
    );
    const projection = projectDrawing(drawingOf(part), {
      ownerPartName: OWNER,
      limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    })!;
    const resolved = resolveAnchoredDrawingPosition(
      projection,
      anchorFrameContext({ pageNumber: 1 })
    );
    expect(resolved.horizontalFrame).toBe(frame);
    expect(resolved.x).toBeCloseTo(expectedX, 2);
  });

  test('inside/outside margins swap on even pages', () => {
    const odd = load(
      anchoredPictureXml({
        positionH:
          '<wp:positionH relativeFrom="insideMargin"><wp:align>left</wp:align></wp:positionH>',
      })
    );
    const even = load(
      anchoredPictureXml({
        positionH:
          '<wp:positionH relativeFrom="outsideMargin"><wp:align>left</wp:align></wp:positionH>',
      })
    );
    const oddProjection = projectDrawing(drawingOf(odd), {
      ownerPartName: OWNER,
      limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    })!;
    const evenProjection = projectDrawing(drawingOf(even), {
      ownerPartName: OWNER,
      limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    })!;
    const oddResolved = resolveAnchoredDrawingPosition(
      oddProjection,
      anchorFrameContext({ pageNumber: 1 })
    );
    const evenResolved = resolveAnchoredDrawingPosition(
      evenProjection,
      anchorFrameContext({ pageNumber: 2 })
    );
    expect(oddResolved.x).toBeCloseTo(0, 2);
    expect(evenResolved.x).toBeCloseTo(-72, 2);
  });

  test('negative posOffset moves before the frame origin', () => {
    const part = load(
      anchoredPictureXml({
        positionH:
          '<wp:positionH relativeFrom="margin"><wp:posOffset>-12700</wp:posOffset></wp:positionH>',
      })
    );
    const projection = projectDrawing(drawingOf(part), {
      ownerPartName: OWNER,
      limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    })!;
    expect(projection.position!.horizontal.offsetEmu).toBe(-12700);
    const resolved = resolveAnchoredDrawingPosition(projection, anchorFrameContext());
    expect(resolved.x).toBeCloseTo(-1, 3);
  });

  test('invalid frame uses page-content fallback with a reason', () => {
    const part = load(anchoredPictureXml());
    const projection = projectDrawing(drawingOf(part), {
      ownerPartName: OWNER,
      limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    })!;
    const broken = Object.freeze({
      ...projection,
      position: Object.freeze({
        ...projection.position!,
        horizontal: Object.freeze({
          ...projection.position!.horizontal,
          relativeFrom: 'not-a-frame' as 'page',
        }),
      }),
    });
    const resolved = resolveAnchoredDrawingPosition(broken, anchorFrameContext());
    expect(resolved).toMatchObject({ x: 0, y: 0, layoutFallback: 'unresolvable-frame' });
  });
});

describe('places anchors in story and cell context', () => {
  test('cell column offsets retain padding after row finalization and cached layout', () => {
    for (const align of ['top', 'center']) {
      const source = anchoredPictureXml({
        positionH:
          '<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>',
        before: '<w:pPr><w:ind w:left="120"/></w:pPr>',
      })
        .replace(
          '<w:body>',
          '<w:body><w:tbl><w:tblPr><w:tblLayout w:type="fixed"/><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:left w:w="240" w:type="dxa"/><w:right w:w="360" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val="3000" w:hRule="atLeast"/></w:trPr><w:tc><w:tcPr><w:vAlign w:val="' +
            align +
            '"/></w:tcPr>'
        )
        .replace('</w:body>', '</w:tc></w:tr></w:tbl></w:body>');
      const part = load(source);
      // Mode 15 keeps the table at the text column, so the column starts after the 12pt
      // padding. Without a declared mode, the fixed table with a stated indent aligns that
      // content edge with the text column instead (`fixedTableContentEdgeOrigin`).
      for (const [compatibilityMode, x] of [
        [15, 12],
        [undefined, 0],
      ] as const) {
        const options = { measurer, inlineDrawingLayout: layoutContext(part), compatibilityMode };
        const session = createLayoutSession();
        const cold = layoutSemanticDocument(part, 1, options);
        for (const revision of [1, 2]) {
          const layout = layoutSemanticDocument(part, revision, { ...options, session });
          expect(layout.pages).toEqual(cold.pages);
          expect(layout.pages[0]!.anchoredDrawings![0]!.x).toBeCloseTo(x, 5);
        }
      }
    }
  });
  test('a legacy fixed table without a style or indent starts its outer edge at the column', () => {
    const source = anchoredPictureXml({
      positionH:
        '<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>',
    })
      .replace(
        '<w:body>',
        '<w:body><w:tbl><w:tblPr><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="240" w:type="dxa"/><w:right w:w="360" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc>'
      )
      .replace('</w:body>', '</w:tc></w:tr></w:tbl></w:body>');
    const part = load(source);
    // With neither a table style nor a stated indent, the table sits as if indented by its
    // leading cell margin, so the cell column starts one 12pt margin inside the text column.
    for (const compatibilityMode of [undefined, 11, 14, 15]) {
      const layout = layoutSemanticDocument(part, 1, {
        measurer,
        inlineDrawingLayout: layoutContext(part),
        compatibilityMode,
      });
      expect(layout.pages[0]!.anchoredDrawings![0]!.x).toBeCloseTo(12, 5);
    }
  });
  test('body anchor publishes on the page with owner part context', () => {
    const part = load(anchoredPictureXml({ before: run('A') }));
    const layout = lay(part, layoutContext(part));
    const anchors = layout.pages[0]!.anchoredDrawings ?? [];
    expect(anchors).toHaveLength(1);
    expect(anchors[0]!.kind).toBe('anchoredDrawing');
    expect(anchors[0]!.ownerPartName).toBe(OWNER);
    expect(anchors[0]!.anchorParagraphId).toBeTruthy();
  });

  test('header anchor resolves with header owner part, not the main document', () => {
    const headerDoc = anchoredPictureXml({
      positionH: '<wp:positionH relativeFrom="page"><wp:align>center</wp:align></wp:positionH>',
    });
    const part = load(headerDoc, '/word/header1.xml');
    const headerLayout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part, READY_RESOURCE, '/word/header1.xml'),
    });
    const anchors = headerLayout.pages[0]!.anchoredDrawings ?? [];
    expect(anchors[0]!.ownerPartName).toBe('/word/header1.xml');
    expect(anchors[0]!.ownerPartName).not.toBe(OWNER);
  });

  test('layoutInCell=true clamps paint bounds to the cell box', () => {
    const drawingXml =
      '<w:r><w:drawing>' +
      '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="1">' +
      '<wp:simplePos x="0" y="0"/>' +
      '<wp:positionH relativeFrom="margin"><wp:align>right</wp:align></wp:positionH>' +
      '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
      `<wp:extent cx="3657600" cy="457200"/>` +
      '<wp:wrapSquare wrapText="bothSides"/>' +
      '<wp:docPr id="3" name="float"/>' +
      '<wp:cNvGraphicFramePr/>' +
      `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>` +
      '<pic:blipFill><a:blip r:embed="rId14"/></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>' +
      '</wp:anchor></w:drawing></w:r>';
    const doc =
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
      '<w:body><w:tbl><w:tr><w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr><w:p>' +
      drawingXml +
      '</w:p></w:tc></w:tr></w:tbl></w:body></w:document>';
    const part = load(doc);
    const layout = lay(part, layoutContext(part), {
      width: 612,
      height: 792,
      margin: { top: 72, right: 72, bottom: 72, left: 72 },
    });
    const drawing = layout.pages[0]!.anchoredDrawings![0]!;
    expect(drawing.layoutInCell).toBe(true);
    expect(drawing.paintBounds.width).toBeLessThan(drawing.width);
    expect(drawing.paintBounds.width).toBeGreaterThan(0);
  });

  test('layoutInCell=false may extend outside the cell box', () => {
    const drawingXml =
      '<w:r><w:drawing>' +
      '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" allowOverlap="1" layoutInCell="0" relativeHeight="1">' +
      '<wp:simplePos x="0" y="0"/>' +
      '<wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
      '<wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
      `<wp:extent ${ANCHOR_EXTENT}/>` +
      '<wp:wrapSquare wrapText="bothSides"/>' +
      '<wp:docPr id="3" name="float"/>' +
      '<wp:cNvGraphicFramePr/>' +
      `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>` +
      '<pic:blipFill><a:blip r:embed="rId14"/></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>' +
      '</wp:anchor></w:drawing></w:r>';
    const doc =
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
      '<w:body><w:tbl><w:tr><w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr><w:p>' +
      drawingXml +
      '</w:p></w:tc></w:tr></w:tbl></w:body></w:document>';
    const part = load(doc);
    const layout = lay(part, layoutContext(part));
    const drawing = layout.pages[0]!.anchoredDrawings![0]!;
    expect(drawing.layoutInCell).toBe(false);
    expect(drawing.x).toBeCloseTo(-72, 2);
    const shifted = [drawing];
    shiftAnchoredDrawingRecords(shifted, drawing.anchorParagraphId, 100);
    expect(shifted[0]!.y).toBe(drawing.y);
  });
});

describe('drawing record geometry', () => {
  test('inline records publish normalized geometry without resizing authored extent', () => {
    const part = load(inlinePictureXml());
    const layout = lay(part, layoutContext(part));
    const line = linesOf(layout)[0]!;
    const drawing = line.drawings![0]!;
    expect(drawing.width).toBe(emuToPoints(914400));
    expect(drawing.geometry.contentBounds.width).toBe(drawing.width);
    expect(drawing.geometry.contentBounds.height).toBe(drawing.height);
    expect(drawing.geometry.effectInsets.top).toBeGreaterThanOrEqual(0);
    expect(drawing.geometry.imageTransformCorners).toEqual(drawing.geometry.transformedCorners);
  });

  test('anchored records use wrap-element distances in geometry effect expansion', () => {
    const doc =
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
      '<w:body><w:p><w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1" relativeHeight="1">' +
      '<wp:simplePos x="0" y="0"/>' +
      '<wp:positionH relativeFrom="page"><wp:align>left</wp:align></wp:positionH>' +
      '<wp:positionV relativeFrom="paragraph"><wp:align>top</wp:align></wp:positionV>' +
      '<wp:extent cx="914400" cy="457200"/>' +
      '<wp:effectExtent l="12700" t="12700" r="12700" b="12700"/>' +
      '<wp:wrapSquare wrapText="bothSides" distT="25400" distB="25400" distL="38100" distR="38100"/>' +
      '<wp:docPr id="1" name="pic"/>' +
      '<wp:cNvGraphicFramePr/>' +
      `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic>` +
      '<pic:blipFill><a:blip r:embed="rId14"/></pic:blipFill>' +
      '<pic:spPr><a:xfrm rot="5400000"><a:ext cx="914400" cy="457200"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>' +
      '</pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p></w:body></w:document>';
    const part = load(doc);
    const layout = lay(part, layoutContext(part));
    const drawing = layout.pages[0]!.anchoredDrawings![0]!;
    expect(drawing.geometry.contentBounds.width).toBe(emuToPoints(914400));
    expect(drawing.geometry.effectInsets.left).toBeCloseTo(1, 3);
    expect(drawing.geometry.transformedCorners.length).toBe(4);
  });
});
