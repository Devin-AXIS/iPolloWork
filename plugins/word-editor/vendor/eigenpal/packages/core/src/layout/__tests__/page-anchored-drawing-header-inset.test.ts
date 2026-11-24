// Furniture taller than its margin pushes the body content box in (Word's behaviour), and every
// body anchored drawing resolves in that box's coordinates. The anchor frame handed out the
// AUTHORED `w:pgMar` values instead of those insets, so a `relativeFrom="page"` anchor with a
// zero offset painted the whole header height below the sheet top (#274).
//
// The margin frames are the other half of the contract: `topMargin` and `bottomMargin` are
// page-setup landmarks, so neither may move when a header or a footer grows.

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
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { PageFurniture, PageGeometry, SemanticLayout } from '../semantic-records.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const OWNER = '/word/document.xml';
const measurer = createFixedMeasurer(6, 14);

/** 72pt tall, 144pt wide — the anchored picture every case below places. */
const IMAGE_HEIGHT = 72;
const IMAGE_EMU = { cx: 1828800, cy: 914400 };

/** A distance plus one furniture line already exceeds these 20pt margins. */
const GEOMETRY: PageGeometry = {
  width: 300,
  height: 400,
  margin: { top: 20, right: 20, bottom: 20, left: 20 },
  headerDistance: 10,
  footerDistance: 10,
};

/** Margins no furniture in this file can outgrow — the true no-op control. */
const ROOMY: PageGeometry = {
  ...GEOMETRY,
  margin: { top: 100, right: 20, bottom: 100, left: 20 },
};

const CONTENT_WIDTH = GEOMETRY.width - GEOMETRY.margin.left - GEOMETRY.margin.right;

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

interface Anchor {
  /** `wp:positionV/@relativeFrom`. */
  readonly frame: 'page' | 'topMargin' | 'bottomMargin' | 'margin';
  /** `wp:posOffset` in EMU; omitted when `align` is set. */
  readonly offsetEmu?: number;
  /** `wp:align`, which wins over an offset in ECMA-376 §20.4.2.10. */
  readonly align?: 'top' | 'bottom';
}

/** A page-relative background picture, behind the text, no wrap. */
function anchoredPicture(anchor: Anchor): string {
  const vertical =
    anchor.align !== undefined
      ? `<wp:align>${anchor.align}</wp:align>`
      : `<wp:posOffset>${anchor.offsetEmu ?? 0}</wp:posOffset>`;
  return (
    '<w:p><w:r><w:drawing>' +
    '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="1" locked="0"' +
    ' allowOverlap="1" layoutInCell="1" relativeHeight="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
    `<wp:positionV relativeFrom="${anchor.frame}">${vertical}</wp:positionV>` +
    `<wp:extent cx="${IMAGE_EMU.cx}" cy="${IMAGE_EMU.cy}"/>` +
    '<wp:wrapNone/>' +
    '<wp:docPr id="1" name="pic1"/>' +
    `<a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:nvPicPr>` +
    '<pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    `<pic:spPr><a:xfrm><a:ext cx="${IMAGE_EMU.cx}" cy="${IMAGE_EMU.cy}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"/></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>'
  );
}

function load(anchor: Anchor): OoxmlPart {
  const xml =
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" ` +
    `xmlns:pic="${PIC}" xmlns:r="${R}"><w:body>` +
    anchoredPicture(anchor) +
    '<w:p><w:r><w:t>body text</w:t></w:r></w:p>' +
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

function story(kind: 'header' | 'footer', lines: number) {
  const tag = kind === 'header' ? 'hdr' : 'ftr';
  const body = Array.from(
    { length: lines },
    (_, index) => `<w:p><w:r><w:t>${kind} line ${index}</w:t></w:r></w:p>`
  ).join('');
  const result = readOoxmlPart(`<w:${tag} xmlns:w="${WML_NAMESPACE_URI}">${body}</w:${tag}>`, {
    name: kind === 'header' ? '/word/header1.xml' : '/word/footer1.xml',
    contentType: 'application/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return layoutHeaderFooterStory(result.part, CONTENT_WIDTH, measurer, 'test');
}

/**
 * Two furniture lines beat the 20pt margins of {@link GEOMETRY} and nothing in {@link ROOMY}.
 * A line count instead of `true` asks for a taller band — 20 lines run past two fifths of the sheet.
 */
function furniture(opts: {
  readonly header?: boolean | number;
  readonly footer?: boolean | number;
}): PageFurniture {
  const lines = (value: boolean | number | undefined): number =>
    typeof value === 'number' ? value : 2;
  return {
    titlePage: false,
    evenAndOddHeaders: false,
    headers: opts.header ? new Map([['default', story('header', lines(opts.header))]]) : new Map(),
    footers: opts.footer ? new Map([['default', story('footer', lines(opts.footer))]]) : new Map(),
  };
}

function lay(
  anchor: Anchor,
  opts: { readonly furniture?: PageFurniture; readonly geometry?: PageGeometry } = {}
): SemanticLayout {
  const part = load(anchor);
  return layoutSemanticDocument(part, 1, {
    measurer,
    geometry: opts.geometry ?? GEOMETRY,
    inlineDrawingLayout: context(part),
    ...(opts.furniture ? { furniture: opts.furniture } : {}),
  });
}

const firstDrawing = (layout: SemanticLayout) => {
  const page = layout.pages[0]!;
  const drawing = page.anchoredDrawings?.[0];
  if (!drawing) throw new Error('expected one anchored drawing on the first page');
  return { page, drawing };
};

/**
 * Sheet-relative top of the drawing.
 *
 * Layout resolves anchors in page-CONTENT coordinates whose origin is the content box, so the
 * inset is what turns a frame position back into a position on the sheet. `semantic-paint`
 * performs the same conversion through `bodyAnchorOrigin`; the companion output-lane test
 * `output/__tests__/page-anchored-drawing-paint-inset.test.ts` pins that side.
 */
function sheetTop(layout: SemanticLayout): number {
  const { page, drawing } = firstDrawing(layout);
  return drawing.paintBounds.y + (page.contentBox.y - page.box.y);
}

function sheetLeft(layout: SemanticLayout): number {
  const { page, drawing } = firstDrawing(layout);
  return drawing.paintBounds.x + (page.contentBox.x - page.box.x);
}

const contentInset = (layout: SemanticLayout): number => {
  const page = layout.pages[0]!;
  return page.contentBox.y - page.box.y;
};

describe('the fixture reproduces the #274 condition', () => {
  test('a two-line header pushes the content box past the authored top margin', () => {
    expect(
      contentInset(lay({ frame: 'page' }, { furniture: furniture({ header: true }) }))
    ).toBeGreaterThan(GEOMETRY.margin.top);
  });

  test('roomy margins swallow the same header — the control is a real no-op', () => {
    const inset = contentInset(
      lay({ frame: 'page' }, { furniture: furniture({ header: true }), geometry: ROOMY })
    );
    expect(inset).toBeCloseTo(ROOMY.margin.top, 3);
  });
});

describe('a page-frame anchor stays on the sheet edge under any furniture', () => {
  test('a zero offset lands on the sheet top, not on the header height', () => {
    expect(
      sheetTop(lay({ frame: 'page' }, { furniture: furniture({ header: true }) }))
    ).toBeCloseTo(0, 3);
  });

  test('a nonzero offset lands at that offset from the sheet top', () => {
    // 914400 EMU = 72pt.
    const layout = lay(
      { frame: 'page', offsetEmu: 914400 },
      { furniture: furniture({ header: true }) }
    );
    expect(sheetTop(layout)).toBeCloseTo(72, 3);
  });

  test('a bottom-aligned anchor sits on the sheet bottom under a tall FOOTER', () => {
    const layout = lay(
      { frame: 'page', align: 'bottom' },
      { furniture: furniture({ footer: true }) }
    );
    expect(sheetTop(layout)).toBeCloseTo(GEOMETRY.height - IMAGE_HEIGHT, 3);
  });

  test('a bottom-aligned anchor sits on the sheet bottom with both bands tall', () => {
    const layout = lay(
      { frame: 'page', align: 'bottom' },
      { furniture: furniture({ header: true, footer: true }) }
    );
    expect(sheetTop(layout)).toBeCloseTo(GEOMETRY.height - IMAGE_HEIGHT, 3);
  });

  test('a header shorter than the top margin changes nothing', () => {
    const withHeader = lay(
      { frame: 'page' },
      { furniture: furniture({ header: true }), geometry: ROOMY }
    );
    const without = lay({ frame: 'page' }, { geometry: ROOMY });
    expect(sheetTop(withHeader)).toBeCloseTo(0, 3);
    expect(sheetTop(withHeader)).toBeCloseTo(sheetTop(without), 6);
  });

  test('the horizontal axis is unchanged — no furniture moves the left content edge', () => {
    expect(
      sheetLeft(lay({ frame: 'page' }, { furniture: furniture({ header: true }) }))
    ).toBeCloseTo(0, 3);
    expect(sheetLeft(lay({ frame: 'page' }))).toBeCloseTo(0, 3);
  });

  test('without furniture the anchor still lands on the sheet top', () => {
    expect(sheetTop(lay({ frame: 'page' }))).toBeCloseTo(0, 3);
    expect(sheetTop(lay({ frame: 'page', offsetEmu: 914400 }))).toBeCloseTo(72, 3);
  });
});

describe('the margin frames are page-setup landmarks, not furniture-relative', () => {
  test('topMargin is the sheet top whatever the header does', () => {
    expect(
      sheetTop(lay({ frame: 'topMargin' }, { furniture: furniture({ header: true }) }))
    ).toBeCloseTo(0, 3);
    expect(sheetTop(lay({ frame: 'topMargin' }))).toBeCloseTo(0, 3);
  });

  test('bottomMargin holds the authored margin line under a tall header', () => {
    const layout = lay({ frame: 'bottomMargin' }, { furniture: furniture({ header: true }) });
    expect(sheetTop(layout)).toBeCloseTo(GEOMETRY.height - GEOMETRY.margin.bottom, 3);
  });

  test('bottomMargin holds the authored margin line under a tall footer too', () => {
    const layout = lay({ frame: 'bottomMargin' }, { furniture: furniture({ footer: true }) });
    expect(sheetTop(layout)).toBeCloseTo(GEOMETRY.height - GEOMETRY.margin.bottom, 3);
  });

  test('bottomMargin is the same line with no furniture at all', () => {
    expect(sheetTop(lay({ frame: 'bottomMargin' }))).toBeCloseTo(
      GEOMETRY.height - GEOMETRY.margin.bottom,
      3
    );
  });

  test('bottomMargin holds with both bands tall', () => {
    const layout = lay(
      { frame: 'bottomMargin' },
      { furniture: furniture({ header: true, footer: true }) }
    );
    expect(sheetTop(layout)).toBeCloseTo(GEOMETRY.height - GEOMETRY.margin.bottom, 3);
  });

  // A header that pushes the body far down the sheet is the case most likely to rot: a
  // landmark that reads the inset must still land on the authored line there.
  test('the landmarks hold when a tall header pushes the inset past two fifths', () => {
    const tall = { furniture: furniture({ header: 20 }) };
    expect(contentInset(lay({ frame: 'page' }, tall))).toBeGreaterThan(GEOMETRY.height * 0.4);
    expect(sheetTop(lay({ frame: 'page' }, tall))).toBeCloseTo(0, 3);
    expect(sheetTop(lay({ frame: 'topMargin' }, tall))).toBeCloseTo(0, 3);
    expect(sheetTop(lay({ frame: 'bottomMargin' }, tall))).toBeCloseTo(
      GEOMETRY.height - GEOMETRY.margin.bottom,
      3
    );
  });

  // The inverse control. `margin` is the TEXT AREA, so it is the one vertical frame that must
  // move with the furniture — without it these tests only prove that nothing ever moves.
  test('the margin frame does follow the furniture, unlike the landmarks', () => {
    const withHeader = sheetTop(
      lay({ frame: 'margin' }, { furniture: furniture({ header: true }) })
    );
    const bare = sheetTop(lay({ frame: 'margin' }));
    expect(bare).toBeCloseTo(GEOMETRY.margin.top, 3);
    expect(withHeader).toBeGreaterThan(bare + 10);
    expect(withHeader).toBeCloseTo(
      contentInset(lay({ frame: 'margin' }, { furniture: furniture({ header: true }) })),
      3
    );
  });
});
