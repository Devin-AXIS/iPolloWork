// Anchored `wp:wrapNone` drawings, end to end through page layout.
//
// What is unique here is the second test: a paragraph-relative `wp:posOffset` past the
// content band resolves unclamped. Clamping it in `resolveAnchoredDrawingPosition` fails
// both tests below; among the siblings it fails only page- and margin-frame cases and one
// fixture oracle, none of which name the paragraph frame.
//
// The first test is a characterization test, and it is deliberately not the only cover for
// its claim. Sibling tests already hold the parts:
//   - `drawing-exclusion.test.ts` pins `inFront` + `wrapNone` to a null exclusion zone, at
//     the unit boundary rather than through layout.
//   - `drawing-exclusion-layout.test.ts` and the header/textbox anchor tests catch an
//     anchored atom that leaks an inline payload into flow height.
// It stays because neither sibling reads the two together on one paginated document: that
// the anchor adds no height AND moves no text, with a `wrapSquare` twin of the same bytes
// proving the text would have moved.
//
// Both shapes sit inside the content box, so a wrap exclusion would bite if the engine
// produced one. The tall shape locks a negative offset and an extent taller than the page.
//
// Scope note: this file locks anchor behavior only. Blank pages in real documents come
// from cumulative block over-height, tracked as issue #507.

import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  indexInlineDrawingProjectionsInPart,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';
import type { ImageResourceState } from '../../store/package/image-resources.ts';
import {
  readOoxmlPart,
  WML_NAMESPACE_URI,
  type OoxmlPart,
} from '../../store/package/ooxml-tree.ts';
import { emuToPoints, type AnchoredDrawingRecord } from '../drawing-layout.ts';
import type { InlineDrawingLayoutContext } from '../drawing-layout.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { paragraphFragmentsOf, type LayoutBox, type PageRecord } from '../semantic-records.ts';

const OWNER = '/word/document.xml';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';

/** `w:pgMar/@left` of the default US-Letter geometry, in EMU — puts the shape at content x 0. */
const CONTENT_LEFT_EMU = 914_400;
/** Small square shape, 43.2pt on a side. */
const SQUARE_EXTENT_EMU = 548_640;
/** 18pt below the paragraph top, so the shape band starts inside the anchor paragraph. */
const SQUARE_OFFSET_EMU = 228_600;
/** Taller than the 792pt page, so the record must be clipped rather than dropped. */
const TALL_WIDTH_EMU = 219_456;
const TALL_HEIGHT_EMU = 10_186_416;
/** Negative paragraph-relative offset — the bar starts above its own anchor paragraph. */
const TALL_OFFSET_EMU = -563_880;
/** Larger than the whole 648pt content band. */
const PAGE_SIZED_OFFSET_EMU = 8_394_065;

const WRAP_NONE = '<wp:wrapNone/>';
const WRAP_SQUARE = '<wp:wrapSquare wrapText="bothSides"/>';

const MISSING_RESOURCE: ImageResourceState = Object.freeze({
  kind: 'missing',
  partName: null,
  reason: 'no-resource',
});

function load(xml: string): OoxmlPart {
  const result = readOoxmlPart(xml, {
    name: OWNER,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function drawingContext(part: OoxmlPart): InlineDrawingLayoutContext {
  const projections = indexInlineDrawingProjectionsInPart(part);
  return {
    ownerPartName: OWNER,
    projectionForAtom: (atomId) => projections.get(atomId) ?? null,
    project: (node) =>
      projections.get(node.id) ??
      projectDrawing(node, {
        ownerPartName: OWNER,
        limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
      }),
    resourceOf: () => MISSING_RESOURCE,
  };
}

function shapeDrawing(options: {
  readonly id: number;
  readonly widthEmu: number;
  readonly heightEmu: number;
  readonly verticalOffsetEmu: number;
  readonly wrap: string;
}): string {
  const cx = options.widthEmu;
  const cy = options.heightEmu;
  return (
    '<w:drawing><wp:anchor distT="0" distB="0" distL="114300" distR="114300" ' +
    'simplePos="0" relativeHeight="1" behindDoc="0" locked="1" layoutInCell="1" allowOverlap="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="page">' +
    `<wp:posOffset>${CONTENT_LEFT_EMU}</wp:posOffset></wp:positionH>` +
    '<wp:positionV relativeFrom="paragraph">' +
    `<wp:posOffset>${options.verticalOffsetEmu}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${cx}" cy="${cy}"/>${options.wrap}` +
    `<wp:docPr id="${options.id}" name="shape ${options.id}"/>` +
    `<a:graphic><a:graphicData uri="${WPS}"><wps:wsp><wps:cNvSpPr/><wps:spPr>` +
    `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
    '<a:solidFill><a:srgbClr val="4472C4"/></a:solidFill>' +
    '</wps:spPr><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing>'
  );
}

/** The two anchors one section paragraph carries: a small square and a page-tall bar. */
function anchorPair(wrap: string, squareOffsetEmu = SQUARE_OFFSET_EMU): string {
  return (
    shapeDrawing({
      id: 1,
      widthEmu: SQUARE_EXTENT_EMU,
      heightEmu: SQUARE_EXTENT_EMU,
      verticalOffsetEmu: squareOffsetEmu,
      wrap,
    }) +
    shapeDrawing({
      id: 3,
      widthEmu: TALL_WIDTH_EMU,
      heightEmu: TALL_HEIGHT_EMU,
      verticalOffsetEmu: TALL_OFFSET_EMU,
      wrap,
    })
  );
}

/** 60 four-letter words — four full lines at 6pt per character in a 468pt column. */
const ANCHOR_TEXT = 'word '.repeat(60).trim();

function documentXml(drawings: string, anchorText: string | null = ANCHOR_TEXT): string {
  return (
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" ` +
    `xmlns:wps="${WPS}"><w:body>` +
    '<w:p><w:r><w:t>lead</w:t></w:r></w:p>' +
    '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' +
    `<w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r>${drawings}</w:r>` +
    (anchorText === null ? '</w:p>' : `<w:r><w:t>${anchorText}</w:t></w:r></w:p>`) +
    '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>' +
    '<w:tr><w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>' +
    '<w:p><w:r><w:t>table</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
    '</w:body></w:document>'
  );
}

function layoutOf(drawings: string, anchorText: string | null = ANCHOR_TEXT) {
  const part = load(documentXml(drawings, anchorText));
  return layoutSemanticDocument(part, 1, {
    measurer: createFixedMeasurer(6, 14),
    inlineDrawingLayout: drawingContext(part),
  });
}

/** Round to 3 decimals so exact expectations survive float noise. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function roundBox(box: LayoutBox): LayoutBox {
  return { x: round(box.x), y: round(box.y), width: round(box.width), height: round(box.height) };
}

function anchoredOf(page: PageRecord): readonly AnchoredDrawingRecord[] {
  return page.anchoredDrawings ?? [];
}

function anchorParagraphOf(page: PageRecord, paragraphId: string) {
  const found = paragraphFragmentsOf(page).find((fragment) => fragment.paragraphId === paragraphId);
  if (!found) throw new Error(`missing paragraph fragment ${paragraphId}`);
  return found;
}

/** Left edge of the first painted span on each line — where a wrap hole shows up. */
function spanStartsOf(page: PageRecord, paragraphId: string): readonly number[] {
  return anchorParagraphOf(page, paragraphId).lines.map((line) =>
    round(line.spans[0]?.box.x ?? -1)
  );
}

function lineTopsOf(page: PageRecord, paragraphId: string): readonly number[] {
  return anchorParagraphOf(page, paragraphId).lines.map((line) => round(line.box.y));
}

/**
 * A page counts as blank when it holds no table and no text span of any width. Page 1 of
 * this fixture holds the table, so this only discriminates on page 0 — which is the page
 * the lead paragraph exists to keep non-blank.
 */
function pageHasVisibleContent(page: PageRecord): boolean {
  if (page.fragments.some((fragment) => fragment.kind === 'table')) return true;
  return paragraphFragmentsOf(page).some((fragment) =>
    fragment.lines.some((line) => line.spans.some((span) => span.box.width > 0))
  );
}

/**
 * Third block of the body. Naming it rather than reading it back off a record keeps the
 * shape-free layout and the two anchored layouts on the same paragraph.
 */
const ANCHOR_PARAGRAPH_ID = '/word/document.xml#0.0.2';

describe('anchored wrapNone flow', () => {
  test('a drawing-only anchor paragraph stays with the following table', () => {
    const drawing = shapeDrawing({
      id: 1,
      widthEmu: SQUARE_EXTENT_EMU,
      heightEmu: SQUARE_EXTENT_EMU,
      verticalOffsetEmu: PAGE_SIZED_OFFSET_EMU,
      wrap: WRAP_NONE,
    });
    const wrapNone = layoutOf(drawing, null);
    const noDrawing = layoutOf('', null);

    expect(wrapNone.pages).toHaveLength(2);
    expect(noDrawing.pages).toHaveLength(2);
    expect(wrapNone.pages.every(pageHasVisibleContent)).toBe(true);

    const page = wrapNone.pages[1]!;
    const bare = noDrawing.pages[1]!;
    expect(anchoredOf(page)).toHaveLength(1);
    expect(round(anchoredOf(page)[0]!.y)).toBe(660.95);

    // The anchor has only its paragraph mark's normal line height. Its 660.95pt offset
    // and 43.2pt extent do not advance the table or create an intervening blank page.
    expect(round(anchorParagraphOf(page, ANCHOR_PARAGRAPH_ID).box.height)).toBe(12.727);
    expect(roundBox(anchorParagraphOf(page, ANCHOR_PARAGRAPH_ID).box)).toEqual(
      roundBox(anchorParagraphOf(bare, ANCHOR_PARAGRAPH_ID).box)
    );
    expect(page.fragments.find((fragment) => fragment.kind === 'table')?.box).toEqual(
      bare.fragments.find((fragment) => fragment.kind === 'table')?.box
    );
  });

  test('wrapNone anchors inside the content box carve no hole and add no flow height', () => {
    const wrapNone = layoutOf(anchorPair(WRAP_NONE));
    const wrapSquare = layoutOf(anchorPair(WRAP_SQUARE));
    const noDrawing = layoutOf('');

    expect(wrapNone.pages).toHaveLength(2);
    expect(noDrawing.pages).toHaveLength(2);
    expect(wrapNone.pages.every(pageHasVisibleContent)).toBe(true);

    const page = wrapNone.pages[1]!;
    const [square, tall] = anchoredOf(page);
    expect(square?.anchorParagraphId).toBe(ANCHOR_PARAGRAPH_ID);
    expect(tall?.anchorParagraphId).toBe(ANCHOR_PARAGRAPH_ID);

    // Both anchors resolve out of flow, at the left edge of the content box.
    expect(square!.wrap).toBe('inFront');
    expect(tall!.wrap).toBe('inFront');
    expect(round(square!.x)).toBe(0);
    expect(round(square!.y)).toBe(emuToPoints(SQUARE_OFFSET_EMU));
    expect(roundBox(square!.paintBounds)).toEqual({ x: 0, y: 18, width: 43.2, height: 43.2 });

    // The tall bar starts above its own paragraph and outgrows the page, so it clips.
    expect(round(tall!.y)).toBe(-44.4);
    expect(round(tall!.width)).toBe(17.28);
    expect(round(tall!.height)).toBe(802.08);
    expect(roundBox(tall!.paintBounds)).toEqual({
      x: 0,
      y: -44.4,
      width: 17.28,
      height: 764.4,
    });

    // No flow height and no wrap hole: the anchor paragraph matches the shape-free document.
    const bare = noDrawing.pages[1]!;
    expect(round(anchorParagraphOf(page, ANCHOR_PARAGRAPH_ID).box.height)).toBe(50.909);
    expect(roundBox(anchorParagraphOf(page, ANCHOR_PARAGRAPH_ID).box)).toEqual(
      roundBox(anchorParagraphOf(bare, ANCHOR_PARAGRAPH_ID).box)
    );
    expect(lineTopsOf(page, ANCHOR_PARAGRAPH_ID)).toEqual([0, 12.727, 25.455, 38.182]);
    expect(spanStartsOf(page, ANCHOR_PARAGRAPH_ID)).toEqual([0, 0, 0, 0]);
    expect(page.fragments.some((fragment) => fragment.kind === 'table')).toBe(true);

    // The same bytes with `wrapSquare` instead of `wrapNone` push the text right. Without
    // this the assertions above would hold for a wrapping anchor just as well.
    expect(wrapSquare.pages).toHaveLength(2);
    const squarePage = wrapSquare.pages[1]!;
    expect(anchoredOf(squarePage)[0]?.wrap).toBe('square');
    // Each anchor authors a 114300 EMU (9pt) right-side text distance.
    // The second line (12.727–25.455pt) crosses the square starting at 18pt.
    expect(spanStartsOf(squarePage, ANCHOR_PARAGRAPH_ID)).toEqual([26.28, 52.2, 52.2, 52.2]);
  });

  test('a page-sized paragraph-relative offset resolves unclamped and adds no page', () => {
    const layout = layoutOf(anchorPair(WRAP_NONE, PAGE_SIZED_OFFSET_EMU));

    expect(layout.pages).toHaveLength(2);
    const page = layout.pages[1]!;
    const square = anchoredOf(page)[0]!;

    // 660.95pt is past the 648pt content band; the engine keeps it rather than clamping.
    expect(round(square.y)).toBe(660.95);
    expect(roundBox(square.paintBounds)).toEqual({
      x: 0,
      y: 660.95,
      width: 43.2,
      height: 43.2,
    });

    expect(round(anchorParagraphOf(page, ANCHOR_PARAGRAPH_ID).box.height)).toBe(50.909);
    expect(spanStartsOf(page, ANCHOR_PARAGRAPH_ID)).toEqual([0, 0, 0, 0]);
  });
});
