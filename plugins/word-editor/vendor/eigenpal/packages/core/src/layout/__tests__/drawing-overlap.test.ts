import { describe, expect, test } from 'bun:test';
import { WML_NAMESPACE_URI } from '../../store/package/ooxml-tree.ts';
import { anchorPairInParagraph, layoutContext, load } from './anchored-drawing-test-fixtures.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { resolveOverlapDisplacement } from '../drawing-overlap.ts';

const measurer = createFixedMeasurer(6, 14);

/** The two pictures as laid out, in source order. */
function pair(options: Parameters<typeof anchorPairInParagraph>[0]) {
  const part = load(anchorPairInParagraph(options));
  const page = layoutSemanticDocument(part, 1, {
    measurer,
    inlineDrawingLayout: layoutContext(part),
  }).pages[0]!;
  const drawings = [...(page.anchoredDrawings ?? [])].sort(
    (left, right) => (left.sourceOrder ?? 0) - (right.sourceOrder ?? 0)
  );
  expect(drawings).toHaveLength(2);
  return { first: drawings[0]!, second: drawings[1]! };
}

const TEXT = 'word '.repeat(80);
const SIZE = { width: 158, height: 50, text: TEXT } as const;

// Word 16.113 moves a picture that may not overlap SIDEWAYS at its authored height: flush
// right of the picture it hits when that fits in the content box, else flush left. Only
// when neither side fits does it move down.
describe('allowOverlap="0" displacement', () => {
  test('moves the later picture flush right of the one it hits', () => {
    const { first, second } = pair({
      ...SIZE,
      allowOverlap: '0',
      first: { x: 22, y: 0 },
      second: { x: 94, y: 22 },
    });
    expect(second.x).toBeCloseTo(first.x + first.width, 3);
    expect(second.y).toBeCloseTo(first.y + 22, 3);
  });

  test('goes right even when the later picture was authored to the left', () => {
    const { first, second } = pair({
      ...SIZE,
      allowOverlap: '0',
      first: { x: 108, y: 0 },
      second: { x: 36, y: 22 },
    });
    expect(second.x).toBeCloseTo(first.x + first.width, 3);
  });

  test('goes left when the right side has no room', () => {
    const { first, second } = pair({
      ...SIZE,
      allowOverlap: '0',
      first: { x: 230, y: 0 },
      second: { x: 288, y: 22 },
    });
    expect(second.x).toBeCloseTo(first.x - second.width, 3);
    expect(second.y).toBeCloseTo(first.y + 22, 3);
  });

  test('moves down only when neither side fits', () => {
    const { first, second } = pair({
      width: 252,
      height: 50,
      text: TEXT,
      allowOverlap: '0',
      first: { x: 100, y: 0 },
      second: { x: 150, y: 22 },
    });
    expect(second.x).toBeCloseTo(first.x + 50, 3);
    expect(second.y).toBeGreaterThanOrEqual(first.y + first.height);
  });

  test('allowOverlap="1" leaves both where they were authored', () => {
    const { first, second } = pair({
      ...SIZE,
      allowOverlap: '1',
      first: { x: 22, y: 0 },
      second: { x: 94, y: 22 },
    });
    expect(second.x).toBeCloseTo(first.x + 72, 3);
  });

  test('a picture deferred to the next page carries its authored x, not the sideways move', () => {
    const { first, second } = pair({
      ...SIZE,
      allowOverlap: '1',
      first: { x: 22, y: 0 },
      second: { x: 94, y: 22 },
    });
    const later = Object.freeze({ ...second, allowOverlap: false });
    const resolved = resolveOverlapDisplacement([first, later], {
      contentHeight: later.y + later.height - 1,
      contentWidth: 468,
    });
    expect(resolved.deferred).toHaveLength(1);
    expect(resolved.deferred[0]!.x).toBeCloseTo(second.x, 3);
  });
});

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
/** A page-relative, top-and-bottom picture that may not overlap, sizes in EMU. */
function pagePicture(y: number, cx: number, cy: number): string {
  return (
    '<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" allowOverlap="0" layoutInCell="1" relativeHeight="1">' +
    '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
    `<wp:positionV relativeFrom="page"><wp:posOffset>${y}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:wrapTopAndBottom/><wp:docPr id="1" name="pic"/>` +
    `<a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>` +
    '<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    `<pic:spPr><a:xfrm><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic>` +
    '</wp:anchor></w:drawing></w:r>'
  );
}
function layoutBody(body: string) {
  const part = load(
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`
  );
  return layoutSemanticDocument(part, 1, { measurer, inlineDrawingLayout: layoutContext(part) });
}

describe('allowOverlap="0" without a collision', () => {
  test('a picture that hits nothing keeps its page when it reaches past the content bottom', () => {
    const { first } = pair({
      ...SIZE,
      allowOverlap: '1',
      first: { x: 22, y: 0 },
      second: { x: 300, y: 0 },
    });
    const alone = Object.freeze({ ...first, allowOverlap: false });
    const resolved = resolveOverlapDisplacement([alone], {
      contentHeight: alone.y + alone.height - 1,
      contentWidth: 468,
    });
    expect(resolved.deferred).toHaveLength(0);
    expect(resolved.drawings).toEqual([alone]);
  });

  test('a full-page picture alone in its section adds no blank pages', () => {
    // US Letter: 612 x 792 pt. The picture starts 1 EMU below the page top.
    const fullPage = pagePicture(1, 7772400, 10058400);
    const pages = layoutBody(
      '<w:p><w:r><w:t>lead</w:t></w:r></w:p><w:p><w:pPr><w:sectPr/></w:pPr></w:p>' +
        `<w:p>${fullPage}</w:p>`
    ).pages;
    expect(pages).toHaveLength(2);
    const drawing = pages[1]!.anchoredDrawings![0]!;
    // Content coordinates: the page top is 72 pt above the content box.
    expect([drawing.x, drawing.y, drawing.width, drawing.height]).toEqual([
      -72,
      expect.closeTo(-72, 3),
      612,
      792,
    ]);
    expect(drawing.layoutFallback).toBeUndefined();
  });

  test('a picture in the bottom margin stays on the page of its anchor', () => {
    // 36 pt high, from 756 pt down to the page bottom: below the content box, which ends at 720 pt.
    const pages = layoutBody(
      `<w:p><w:r><w:t>text</w:t></w:r>${pagePicture(9601200, 914400, 457200)}</w:p>`
    ).pages;
    expect(pages).toHaveLength(1);
    const drawing = pages[0]!.anchoredDrawings![0]!;
    expect(drawing.y).toBeCloseTo(756 - 72, 3);
    expect(drawing.layoutFallback).toBeUndefined();
  });
});
