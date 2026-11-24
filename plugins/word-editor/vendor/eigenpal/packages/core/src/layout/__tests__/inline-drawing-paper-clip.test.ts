import { expect, test } from 'bun:test';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  WML_NAMESPACE_URI,
} from '../../store/package/ooxml-tree.ts';
import { indexInlineDrawingProjectionsInPart } from '../../store/package/drawing-projection.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf } from '../semantic-records.ts';
import { buildInlineDrawingRecord } from '../drawing-layout.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const DML = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const resource = Object.freeze({
  kind: 'ready' as const,
  partName: '/word/media/example.png',
  contentId: 'example',
  resourceKey: 'example',
  mime: 'image/png',
  pixelWidth: 1700,
  pixelHeight: 360,
  dpiX: 96,
  dpiY: 96,
});
function sample(
  width: number,
  left = 0,
  cell = false,
  height = 36,
  frame = '',
  rotation = 0,
  section = ''
) {
  const cx = width * 12700,
    cy = height * 12700;
  const paragraph = `<w:p><w:pPr>${frame}<w:ind w:left="${left * 20}"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="1" name="example"/><wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="example"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="example"/></pic:blipFill><pic:spPr><a:xfrm rot="${rotation * 60000}"><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  const contents = cell
    ? `<w:tbl><w:tblPr><w:tblW w:w="2000" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${paragraph}</w:tc></w:tr></w:tbl>`
    : paragraph;
  const xml = `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${DML}" xmlns:pic="${PIC}" xmlns:r="${REL}"><w:body>${contents}${section}</w:body></w:document>`;
  const parsed = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'application/xml' });
  if (!parsed.ok) throw Error(parsed.reason);
  const part = parsed.part,
    before = serializeOoxmlPart(part),
    projections = indexInlineDrawingProjectionsInPart(part);
  const layout = layoutSemanticDocument(part, 1, {
    measurer: createFixedMeasurer(6, 14),
    geometry: { width: 200, height: 300, margin: { top: 20, right: 20, bottom: 20, left: 20 } },
    inlineDrawingLayout: {
      ownerPartName: part.name,
      projectionForAtom: (id) => projections.get(id) ?? null,
      project: (node) => projections.get(node.id) ?? null,
      resourceOf: () => resource,
    },
  });
  const lines = linesOf(layout),
    line = lines.find((line) => line.drawings?.length)!;
  if (!line) throw Error('No inline drawing');
  const d = line.drawings![0]!;
  return {
    input: {
      drawingNodeId: d.drawingNodeId,
      ownerPartName: part.name,
      projection: projections.values().next().value!,
      resource,
    },
    width,
    left,
    cell,
    sourceUnchanged: serializeOoxmlPart(part) === before,
    sourceNodeId: d.drawingNodeId,
    start: d.start,
    x: d.x,
    y: d.y,
    authoredWidth: d.width,
    authoredHeight: d.height,
    advance: d.advanceEnd - d.advanceStart,
    paint: d.paintBounds,
    hit: d.hitBounds,
    geometry: d.geometry,
    resourceSame: d.resource === resource,
    pageCount: layout.pages.length,
    lineRange: line.range,
  };
}
test('inline pictures retain visible margin content and crop only at the physical paper edge', () => {
  const fits = sample(170),
    crosses = sample(200),
    leftMargin = sample(170, -10),
    cell = sample(170, 0, true);
  for (const row of [fits, crosses, leftMargin, cell]) {
    expect(row.sourceUnchanged).toBe(true);
    expect(row.resourceSame).toBe(true);
    expect(row.pageCount).toBe(1);
    expect(row.authoredHeight).toBe(36);
    expect(row.advance).toBe(row.authoredWidth);
    expect(row.paint).toEqual(row.hit);
  }
  expect(fits.authoredWidth).toBe(170);
  expect(fits.x).toBe(0);
  expect(fits.paint.width).toBe(170);
  expect(crosses.authoredWidth).toBe(200);
  expect(crosses.paint.width).toBe(180);
  expect(leftMargin.x).toBe(-10);
  expect(leftMargin.paint.width).toBe(170);
  expect(cell.authoredWidth).toBe(170);
  expect(cell.paint.width).toBeLessThanOrEqual(100);
  expect(cell.paint.width).toBeGreaterThan(0);
  // A negative indent past the paper edge crops at the edge, not at the text area.
  const pastPaper = sample(100, -40);
  expect(pastPaper.x).toBe(-40);
  expect(pastPaper.paint.x).toBe(-20);
  expect(pastPaper.paint.width).toBe(80);
  expect(pastPaper.paint).toEqual(pastPaper.hit);
});

test('body paper clipping preserves vertical limits and frame-local clipping', () => {
  const bottom = sample(36, 0, false, 270);
  const frame = sample(
    170,
    0,
    false,
    36,
    '<w:framePr w:x="0" w:y="0" w:w="2000" w:h="1000" w:hRule="exact"/>'
  );
  for (const row of [bottom, frame]) {
    expect(row.sourceUnchanged).toBe(true);
    expect(row.resourceSame).toBe(true);
    expect(row.advance).toBe(row.authoredWidth);
    expect(row.paint).toEqual(row.hit);
    expect(row.geometry.paintBounds).toEqual(row.paint);
    expect(row.geometry.hitBounds).toEqual(row.hit);
    expect(row.lineRange.end - row.lineRange.start).toBe(1);
  }
  expect(bottom.authoredHeight).toBe(270);
  expect(bottom.paint.y).toBe(0);
  expect(bottom.paint.height).toBe(260);
  const input = sample(170).input;
  const options = {
    input,
    paragraphId: 'top',
    start: 0,
    slotX: 0,
    y: -10,
    baseline: 0,
    contentLeft: 0,
    contentRight: 160,
    contentTop: 0,
    contentBottom: 260,
  };
  const topBefore = buildInlineDrawingRecord(options),
    top = buildInlineDrawingRecord({ ...options, deferHorizontalClip: true });
  expect(topBefore.paintBounds).toEqual({ x: 0, y: 0, width: 160, height: 26 });
  expect(top.paintBounds).toEqual({ x: 0, y: 0, width: 170, height: 26 });
  expect(top.geometry.paintBounds).toEqual(top.paintBounds);
  expect(top.hitBounds).toEqual(top.paintBounds);
  expect(frame.authoredWidth).toBe(170);
  expect(frame.paint.width).toBe(100);
});

test('a picture in an earlier column stops at the middle of the gap to the next column', () => {
  const columns = (cols: string) =>
    sample(170, 0, false, 36, '', 0, `<w:sectPr>${cols}</w:sectPr>`);
  // Equal columns of 70pt with a 20pt gap: the clip ends 10pt into the gap.
  const equal = columns('<w:cols w:num="2" w:space="400"/>');
  expect(equal.x).toBe(0);
  expect(equal.paint.x).toBe(0);
  expect(equal.paint.width).toBe(80);
  expect(equal.paint).toEqual(equal.hit);
  // Unequal columns of 30pt and 90pt with a 20pt gap.
  const unequal = columns(
    '<w:cols w:num="2" w:equalWidth="0"><w:col w:w="600" w:space="400"/><w:col w:w="1800"/></w:cols>'
  );
  expect(unequal.paint.width).toBe(40);
  expect(unequal.sourceUnchanged).toBe(true);
});
