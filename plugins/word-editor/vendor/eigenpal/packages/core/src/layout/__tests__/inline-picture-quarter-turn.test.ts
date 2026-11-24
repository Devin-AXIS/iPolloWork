import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/index.ts';
import { indexInlineDrawingProjectionsInPart } from '../../store/package/drawing-projection.ts';
import { measureInlineDrawing } from '../drawing-layout.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';
import { caretAt } from '../semantic-interaction.ts';

function source(degrees: number) {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:r><w:t>A</w:t></w:r><w:r><w:drawing><wp:inline><wp:extent cx="381000" cy="1143000"/><wp:effectExtent l="12700" t="25400" r="38100" b="50800"/><wp:docPr id="1" name="Picture"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="Picture"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:srcRect l="10000"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm rot="${degrees * 60000}"><a:ext cx="381000" cy="1143000"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r><w:r><w:t>B</w:t></w:r></w:p><w:p><w:r><w:t>Tail</w:t></w:r></w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!parsed.ok) throw Error(parsed.reason);
  const projections = indexInlineDrawingProjectionsInPart(parsed.part);
  const projection = [...projections.values()][0]!;
  return {
    part: parsed.part,
    projection,
    drawingLayout: {
      ownerPartName: parsed.part.name,
      project: () => projection,
      projectionForAtom: (id: string) => projections.get(id) ?? null,
      resourceOf: () => ({
        kind: 'ready' as const,
        partName: '/word/media/image.png',
        contentId: 'image',
        resourceKey: 'image',
        mime: 'image/png',
        pixelWidth: 3,
        pixelHeight: 9,
        dpiX: 96,
        dpiY: 96,
      }),
    },
  };
}

for (const degrees of [90, 270, -90, 450])
  test(`inline ${degrees}-degree picture reserves its rotated dimensions`, () => {
    const { part, projection, drawingLayout } = source(degrees);
    const saved = serializeOoxmlPart(part),
      measured = measureInlineDrawing(projection);
    expect(measured.width).toBe(90);
    expect(measured.height).toBe(30);
    expect(measured.totalWidth).toBe(94);
    expect(measured.lineContribution).toBe(36);
    const options = {
      measurer: createFixedMeasurer(5, 12),
      inlineDrawingLayout: drawingLayout,
      geometry: { width: 200, height: 100, margin: { left: 0, right: 0, top: 0, bottom: 0 } },
    };
    const session = createLayoutSession();
    const layout = layoutSemanticDocument(part, 0, { ...options, session });
    expect(layout.pages).toHaveLength(1);
    const paragraph = layout.pages[0]!.fragments[0]!;
    if (paragraph.kind !== 'paragraph') throw Error('paragraph');
    const drawing = paragraph.lines[0]!.drawings![0]!;
    expect(drawing.width).toBe(90);
    expect(drawing.height).toBe(30);
    expect(drawing.geometry.contentBounds.width).toBe(90);
    expect(drawing.geometry.contentBounds.height).toBe(30);
    expect(
      caretAt(layout, { paragraphId: paragraph.paragraphId, offset: 2 })!.x -
        caretAt(layout, { paragraphId: paragraph.paragraphId, offset: 1 })!.x
    ).toBeCloseTo(94, 6);
    expect(layoutSemanticDocument(part, 0, { ...options, session }).pages).toEqual(layout.pages);
    expect(serializeOoxmlPart(part)).toBe(saved);
  });

for (const degrees of [0, 45, 180, 360])
  test(`other rotation ${degrees} retains authored layout extents`, () => {
    const { projection } = source(degrees);
    const measured = measureInlineDrawing(projection);
    expect(measured.width).toBe(30);
    expect(measured.height).toBe(90);
  });
test('anchored quarter-turn pictures retain their declared anchor extent', () => {
  const { projection } = source(90);
  const measured = measureInlineDrawing({ ...projection, kind: 'anchored' });
  expect(measured.width).toBe(30);
  expect(measured.height).toBe(90);
});
