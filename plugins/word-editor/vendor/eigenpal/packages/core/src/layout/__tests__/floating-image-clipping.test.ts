import { expect, test } from 'bun:test';
import { readOoxmlPart, WML_NAMESPACE_URI } from '../../store/package/ooxml-tree.ts';
import { indexInlineDrawingProjectionsInPart } from '../../store/package/drawing-projection.ts';
import { pageClipRegion } from '../drawing-layout.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function inCell(wrap: string, behind = false, layoutInCell = true) {
  const xml = `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body>
    <w:tbl><w:tblPr><w:tblW w:w="2000" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>
    <w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr><w:p><w:r><w:drawing>
    <wp:anchor simplePos="0" behindDoc="${behind ? 1 : 0}" layoutInCell="${layoutInCell ? 1 : 0}" allowOverlap="1" locked="0" relativeHeight="1">
      <wp:simplePos x="0" y="0"/>
      <wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>
      <wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>
      <wp:extent cx="2540000" cy="1143000"/>${wrap}<wp:docPr id="1" name="photo"/>
      <a:graphic><a:graphicData uri="${PIC}"><pic:pic>
      <pic:nvPicPr><pic:cNvPr id="1" name="photo"/><pic:cNvPicPr/></pic:nvPicPr>
      <pic:blipFill><a:blip r:embed="photo"/></pic:blipFill><pic:spPr/>
      </pic:pic></a:graphicData></a:graphic>
    </wp:anchor></w:drawing></w:r></w:p></w:tc></w:tr></w:tbl><w:p/>
    <w:sectPr><w:cols w:num="2" w:space="720"/></w:sectPr></w:body></w:document>`;
  const loaded = readOoxmlPart(xml, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!loaded.ok) throw new Error(loaded.reason);
  const projections = indexInlineDrawingProjectionsInPart(loaded.part);
  const result = layoutSemanticDocument(loaded.part, 1, {
    measurer: createFixedMeasurer(6, 14),
    inlineDrawingLayout: {
      ownerPartName: loaded.part.name,
      projectionForAtom: (id) => projections.get(id) ?? null,
      project: (node) => projections.get(node.id) ?? null,
      resourceOf: () => ({ kind: 'missing', relationshipId: 'photo' }),
    },
  });
  const drawing = result.pages.flatMap((page) => page.anchoredDrawings ?? [])[0];
  expect(drawing).toBeDefined();
  return drawing!;
}

for (const behind of [false, true]) {
  test(`wrapNone ${behind ? 'behind' : 'in front of'} text is not cropped to its short anchor cell`, () => {
    const drawing = inCell('<wp:wrapNone/>', behind);
    expect(drawing.layoutInCell).toBe(true);
    expect(drawing.width).toBe(200);
    expect(drawing.height).toBe(90);
    expect(drawing.paintBounds.width).toBeCloseTo(200, 4);
    expect(drawing.paintBounds.height).toBeCloseTo(90, 4);
  });
}

test('square wrapping retains cell clipping', () => {
  const drawing = inCell('<wp:wrapSquare wrapText="bothSides"/>');
  expect(drawing.paintBounds.width).toBeGreaterThan(0);
  expect(drawing.paintBounds.width).toBeLessThan(drawing.width);
});

test('layoutInCell=false still permits overflow', () => {
  const drawing = inCell('<wp:wrapSquare wrapText="bothSides"/>', false, false);
  expect(drawing.layoutInCell).toBe(false);
  expect(drawing.paintBounds.width).toBeCloseTo(drawing.width, 4);
});

test('physical page height outlives a short continuous-section band', () => {
  const frame = {
    pageWidth: 600,
    pageHeight: 900,
    marginLeft: 40,
    contentInsetTop: 50,
    contentInsetBottom: 60,
    contentBandHeight: 420,
  };
  expect(pageClipRegion(frame)).toEqual({ x: -40, y: -50, width: 600, height: 900 });
  // Callers with no physical height keep the existing full-band fallback.
  for (const pageHeight of [undefined, NaN, 0, -1]) {
    expect(pageClipRegion({ ...frame, pageHeight }).height).toBe(530);
  }
});
