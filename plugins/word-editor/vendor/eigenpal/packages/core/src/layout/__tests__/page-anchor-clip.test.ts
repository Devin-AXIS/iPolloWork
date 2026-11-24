import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  WML_NAMESPACE_URI,
  type OoxmlPart,
} from '../../store/package/ooxml-tree.ts';
import {
  indexInlineDrawingProjectionsInPart,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { emuToPoints, pageClipRegion, type InlineDrawingLayoutContext } from '../drawing-layout.ts';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const OWNER = '/word/document.xml';
function load(xml: string): OoxmlPart {
  const result = readOoxmlPart(xml, { name: OWNER, contentType: 'application/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}
function layoutContext(part: OoxmlPart): InlineDrawingLayoutContext {
  const projections = indexInlineDrawingProjectionsInPart(part);
  return {
    ownerPartName: OWNER,
    projectionForAtom: (id) => projections.get(id) ?? null,
    project: (node) => projections.get(node.id) ?? projectDrawing(node, { ownerPartName: OWNER }),
    resourceOf: () => null,
  };
}
function lay(part: OoxmlPart, inlineDrawingLayout: InlineDrawingLayoutContext) {
  return layoutSemanticDocument(part, 1, {
    measurer: createFixedMeasurer(6, 14),
    inlineDrawingLayout,
  });
}
describe('page clip for page-relative anchors', () => {
  const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
  const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
  const WPS_URI = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';

  test('pageClipRegion uses pageWidth, not the active column contentWidth', () => {
    const clip = pageClipRegion({
      pageWidth: 595.5,
      marginLeft: 49,
      marginBottom: 14,
      contentInsetTop: 61,
      contentInsetBottom: 14,
      contentHeight: 767,
      contentBandHeight: 767,
    });
    expect(clip).toEqual({
      x: -49,
      y: -61,
      width: 595.5,
      height: 842,
    });
  });

  test('multi-column page-relative behindDoc vector shape keeps non-zero paint bounds', () => {
    // Repro: a multi-column section feeds column width into frame contentWidth. Page clip used
    // to be contentWidth+margins, so a page-relative black box past the first column painted
    // as 0×0 (Graphic 17–20). Raster inFront boxes on a later single-column page still worked.
    const shapeDrawing =
      '<w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ' +
      'relativeHeight="1" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1">' +
      '<wp:simplePos x="0" y="0"/>' +
      '<wp:positionH relativeFrom="page"><wp:posOffset>2383154</wp:posOffset></wp:positionH>' +
      '<wp:positionV relativeFrom="paragraph"><wp:posOffset>148238</wp:posOffset></wp:positionV>' +
      '<wp:extent cx="1016635" cy="207645"/><wp:effectExtent l="0" t="0" r="0" b="0"/>' +
      '<wp:wrapTopAndBottom/><wp:docPr id="17" name="Graphic 17"/>' +
      `<a:graphic><a:graphicData uri="${WPS_URI}">` +
      '<wps:wsp><wps:cNvSpPr/><wps:spPr>' +
      '<a:xfrm><a:off x="0" y="0"/><a:ext cx="1016635" cy="207645"/></a:xfrm>' +
      '<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="l" t="t" r="r" b="b"/>' +
      '<a:pathLst><a:path w="1016635" h="207645">' +
      '<a:moveTo><a:pt x="1016177" y="0"/></a:moveTo>' +
      '<a:lnTo><a:pt x="0" y="0"/></a:lnTo>' +
      '<a:lnTo><a:pt x="0" y="207391"/></a:lnTo>' +
      '<a:lnTo><a:pt x="1016177" y="207391"/></a:lnTo>' +
      '<a:close/></a:path></a:pathLst></a:custGeom>' +
      '<a:solidFill><a:srgbClr val="000000"/></a:solidFill>' +
      '</wps:spPr><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing>';
    const xml =
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" ` +
      `xmlns:wps="${WPS}" xmlns:mc="${MC}"><w:body>` +
      `<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps">${shapeDrawing}</mc:Choice>` +
      '<mc:Fallback><w:pict/></mc:Fallback></mc:AlternateContent></w:r>' +
      '<w:r><w:t>col</w:t></w:r></w:p>' +
      '<w:sectPr>' +
      '<w:pgSz w:w="11906" w:h="16838"/>' +
      '<w:pgMar w:top="1220" w:right="0" w:bottom="280" w:left="980"/>' +
      '<w:cols w:num="3" w:space="720"/>' +
      '</w:sectPr></w:body></w:document>';
    const part = load(xml);
    const layout = lay(part, layoutContext(part));
    const drawing = layout.pages[0]!.anchoredDrawings?.[0];
    expect(drawing).toBeDefined();
    expect(drawing!.behindDocument).toBe(true);
    expect(drawing!.wrap).toBe('topAndBottom');
    expect(drawing!.vectorShape).not.toBeNull();
    expect(drawing!.paintBounds.width).toBeGreaterThan(1);
    expect(drawing!.paintBounds.height).toBeGreaterThan(1);
    expect(drawing!.x).toBeGreaterThan(120);
  });

  test('Selection Notice form bar: page posOffset maps to content x = pagePt − marginLeft', () => {
    // shapes-and-page-breaks Selection Notice item 3 (Graphic 14): page-H bar whose RIGHT
    // edge meets the tab at 6896 twips. VML fallback margin-left:338.5pt; section left=980.
    const posOffsetEmu = 4298950;
    const extentCx = 702945;
    const extentCy = 9525;
    const shapeDrawing =
      '<w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ' +
      'relativeHeight="1" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1">' +
      '<wp:simplePos x="0" y="0"/>' +
      `<wp:positionH relativeFrom="page"><wp:posOffset>${posOffsetEmu}</wp:posOffset></wp:positionH>` +
      '<wp:positionV relativeFrom="paragraph"><wp:posOffset>208632</wp:posOffset></wp:positionV>' +
      `<wp:extent cx="${extentCx}" cy="${extentCy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
      '<wp:wrapNone/><wp:docPr id="14" name="Graphic 14"/>' +
      `<a:graphic><a:graphicData uri="${WPS_URI}">` +
      '<wps:wsp><wps:cNvSpPr/><wps:spPr>' +
      `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${extentCx}" cy="${extentCy}"/></a:xfrm>` +
      '<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="l" t="t" r="r" b="b"/>' +
      `<a:pathLst><a:path w="${extentCx}" h="${extentCy}">` +
      `<a:moveTo><a:pt x="${extentCx - 382}" y="0"/></a:moveTo>` +
      '<a:lnTo><a:pt x="0" y="0"/></a:lnTo>' +
      `<a:lnTo><a:pt x="0" y="${extentCy - 508}"/></a:lnTo>` +
      `<a:lnTo><a:pt x="${extentCx - 382}" y="${extentCy - 508}"/></a:lnTo>` +
      '<a:close/></a:path></a:pathLst></a:custGeom>' +
      '<a:solidFill><a:srgbClr val="000000"/></a:solidFill>' +
      '</wps:spPr><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing>';
    const xml =
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" ` +
      `xmlns:wps="${WPS}" xmlns:mc="${MC}"><w:body>` +
      '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="6896"/></w:tabs></w:pPr>' +
      `<w:r><mc:AlternateContent><mc:Choice Requires="wps">${shapeDrawing}</mc:Choice>` +
      '<mc:Fallback><w:pict/></mc:Fallback></mc:AlternateContent></w:r>' +
      '<w:r><w:t>divided into [</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>] Loans</w:t></w:r></w:p>' +
      '<w:sectPr>' +
      '<w:pgSz w:w="11910" w:h="16840"/>' +
      '<w:pgMar w:top="980" w:right="0" w:bottom="1120" w:left="980"/>' +
      '</w:sectPr></w:body></w:document>';
    const part = load(xml);
    const layout = lay(part, layoutContext(part));
    const page = layout.pages[0]!;
    const drawing = page.anchoredDrawings?.[0];
    expect(drawing).toBeDefined();
    const marginLeft = page.contentBox.x;
    const pageXPt = emuToPoints(posOffsetEmu);
    const widthPt = emuToPoints(extentCx);
    expect(marginLeft).toBe(49);
    expect(drawing!.horizontalFrame).toBe('page');
    expect(drawing!.horizontalFrameOrigin).toBe(-marginLeft);
    expect(drawing!.x).toBeCloseTo(pageXPt - marginLeft, 5);
    expect(drawing!.width).toBeCloseTo(widthPt, 5);
    // Right edge of the bar meets the authored tab stop (6896 twips ≈ 344.8pt).
    expect(drawing!.x + drawing!.width).toBeCloseTo(6896 / 20, 0);
    // Paint origin on the page element is −margin; CSS left must equal page posOffset.
    expect(drawing!.x - drawing!.horizontalFrameOrigin).toBeCloseTo(pageXPt, 5);
  });
});
