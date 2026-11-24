// A footer line whose anchor stores tiny negative text distances as unsigned 32-bit values
// (4294967291 is -5 EMU) leaves the body text at full width.

import { expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  layoutHeaderFooterStory,
  layoutSemanticDocument,
  type PageFurniture,
  type SemanticLayout,
} from '../index.ts';
import { layoutContext, load as loadDrawingPart } from './anchored-drawing-test-fixtures.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const EMU_PER_PT = 12700;
const measurer = createFixedMeasurer(6, 14);
const FOOTER = '/word/footer1.xml';

/** A 360pt by 1pt tight-wrapped line at page x 72 and page y 700, inside the body band. */
function lineFooter(distT: string, distB: string): ReturnType<typeof layoutHeaderFooterStory> {
  const xml =
    `<w:ftr xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:wps="${WPS}"><w:p><w:r><w:drawing>` +
    `<wp:anchor distT="${distT}" distB="${distB}" distL="114300" distR="114300" simplePos="0" ` +
    'relativeHeight="1" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    `<wp:positionH relativeFrom="page"><wp:posOffset>${72 * EMU_PER_PT}</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="page"><wp:posOffset>${700 * EMU_PER_PT}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${360 * EMU_PER_PT}" cy="12700"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    '<wp:wrapTight wrapText="bothSides"><wp:wrapPolygon edited="0"><wp:start x="0" y="0"/>' +
    '<wp:lineTo x="0" y="21600"/><wp:lineTo x="21600" y="21600"/><wp:lineTo x="21600" y="0"/>' +
    '<wp:lineTo x="0" y="0"/></wp:wrapPolygon></wp:wrapTight><wp:docPr id="1" name="fixture"/>' +
    `<a:graphic><a:graphicData uri="${WPS}"><wps:wsp><wps:cNvCnPr/><wps:spPr>` +
    `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${360 * EMU_PER_PT}" cy="12700"/></a:xfrm>` +
    '<a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="12700"><a:solidFill>' +
    '<a:srgbClr val="000000"/></a:solidFill></a:ln></wps:spPr><wps:bodyPr/></wps:wsp>' +
    '</a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p></w:ftr>';
  const part = loadDrawingPart(xml, FOOTER);
  return layoutHeaderFooterStory(
    part,
    468,
    measurer,
    FOOTER,
    undefined,
    undefined,
    undefined,
    128,
    undefined,
    undefined,
    layoutContext(part, FOOTER),
    undefined,
    undefined,
    {
      pageNumber: 1,
      pageWidth: 612,
      pageHeight: 792,
      marginLeft: 72,
      marginRight: 72,
      marginTop: 72,
      marginBottom: 72,
    }
  );
}

function body(): OoxmlPart {
  const words = Array.from({ length: 12 }, (_unused, index) => `word${index}`).join(' ');
  const paragraphs = Array.from(
    { length: 60 },
    () => `<w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:t>${words}</w:t></w:r></w:p>`
  ).join('');
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${paragraphs}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>` +
      '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>' +
      '</w:sectPr></w:body></w:document>',
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function lay(footer?: ReturnType<typeof layoutHeaderFooterStory>): SemanticLayout {
  const furniture: PageFurniture = {
    titlePage: false,
    evenAndOddHeaders: false,
    headers: new Map(),
    footers: new Map(footer ? [['default', footer]] : []) as PageFurniture['footers'],
  };
  return layoutSemanticDocument(body(), 1, { measurer, sectionFurniture: [furniture] });
}

function bodyLines(layout: SemanticLayout): { x: number; y: number; width: number }[] {
  return layout.pages.flatMap((page) =>
    page.fragments.flatMap((fragment) =>
      fragment.kind === 'paragraph'
        ? fragment.lines.map((line) => ({
            x: Math.min(...line.spans.map((span) => span.box.x)),
            y: line.box.y,
            width: line.spans.reduce((sum, span) => sum + span.box.width, 0),
          }))
        : []
    )
  );
}

test('a footer line with unsigned-negative top and bottom distances keeps full-width body lines', () => {
  const footer = lineFooter('4294967291', '4294967291');
  const layout = lay(footer);
  expect(layout.pages[0]!.footer?.anchoredDrawings?.length).toBe(1);
  // The drawing still paints at its authored size; only its text distances read as zero.
  const drawing = layout.pages[0]!.footer!.anchoredDrawings![0]!;
  expect(drawing.wrap).toBe('tight');
  expect(drawing.width).toBeCloseTo(360, 3);
  expect(bodyLines(layout)).toEqual(bodyLines(lay(lineFooter('0', '0'))));
  // With no clearance, only the line rows the 1pt drawing crosses move; the rest stay full width.
  expect(bodyLines(layout).filter((line) => line.x !== 0).length).toBeLessThanOrEqual(1);
  expect(layout.pages).toHaveLength(lay().pages.length);
});

test('a positive footer line distance still pushes the body text aside', () => {
  const clear = bodyLines(lay(lineFooter('0', '0')));
  // 60pt above the line reaches body rows from content y 568 (page y 640) downward.
  const pushed = bodyLines(lay(lineFooter(String(60 * EMU_PER_PT), '0')));
  expect(pushed).not.toEqual(clear);
  const moved = pushed.filter((line) => line.x !== 0);
  expect(moved.length).toBeGreaterThan(1);
  for (const line of moved) expect(line.y + 14).toBeGreaterThan(568);
});
