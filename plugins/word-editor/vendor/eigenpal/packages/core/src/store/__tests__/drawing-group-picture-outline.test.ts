// A picture member of a `wpg:wgp` group can carry a visible outline (`a:ln` with a solid
// fill). The group used to refuse such a member, so the whole group projected as nothing. Now
// the group picture paints the raster and the outline strokes above it as a vector member.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, WML_NAMESPACE_URI, type OoxmlPart } from '../index.ts';
import { projectDrawingsInPart } from '../package/drawing-projection.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const WPG = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const V = 'urn:schemas-microsoft-com:vml';

function parsePart(body: string): OoxmlPart {
  const xml =
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" ` +
    `xmlns:pic="${PIC}" xmlns:r="${R}" xmlns:wps="${WPS}" xmlns:wpg="${WPG}" ` +
    `xmlns:mc="${MC}" xmlns:v="${V}"><w:body>${body}</w:body></w:document>`;
  const parsed = readOoxmlPart(xml, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}

function pictureMember(id: string, x: number, y: number, srcRect = ''): string {
  return (
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="2" name="Picture"/><pic:cNvPicPr/></pic:nvPicPr>' +
    `<pic:blipFill><a:blip r:embed="${id}"/>${srcRect}<a:stretch/></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="1000" cy="500"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></pic:spPr></pic:pic>'
  );
}

function groupDrawing(members: string): string {
  return (
    '<w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ' +
    'relativeHeight="10" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="page"><wp:posOffset>360000</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="page"><wp:posOffset>180000</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="6000000" cy="8000000"/><wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    '<wp:wrapNone/><wp:docPr id="1" name="Group 1"/>' +
    `<a:graphic><a:graphicData uri="${WPG}"><wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr>` +
    '<a:xfrm><a:off x="0" y="0"/><a:ext cx="6000000" cy="8000000"/>' +
    '<a:chOff x="100" y="-200"/><a:chExt cx="3000" cy="4000"/></a:xfrm></wpg:grpSpPr>' +
    `${members}</wpg:wgp></a:graphicData></a:graphic></wp:anchor></w:drawing>`
  );
}

function outlinedPicture(id: string, x: number, y: number, line: string): string {
  return pictureMember(id, x, y).replace('<a:noFill/></pic:spPr>', `${line}</pic:spPr>`);
}

/** The same group at scale 1: child space equal to the drawn extent, so widths stay as authored. */
function unscaledGroup(members: string): string {
  return groupDrawing(members)
    .replace('<wp:extent cx="6000000" cy="8000000"/>', '<wp:extent cx="3000" cy="4000"/>')
    .replace('<a:ext cx="6000000" cy="8000000"/>', '<a:ext cx="3000" cy="4000"/>');
}

const SOLID_LINE = '<a:ln w="20"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:ln>';

describe('group picture members with outlines', () => {
  test('two outlined pictures project both rasters and a stroke for each frame', () => {
    const part = parsePart(
      `<w:p><w:r>${unscaledGroup(
        outlinedPicture('rId1', 100, -200, SOLID_LINE) +
          outlinedPicture('rId2', 1100, 300, SOLID_LINE)
      )}</w:r></w:p>`
    );
    const [projection] = projectDrawingsInPart(part);
    expect(projection?.groupPicture).not.toBeNull();
    expect(projection?.groupPictureLayers?.length).toBe(1);
    const strokes = projection?.vectorShape?.components ?? [];
    expect(strokes.length).toBe(2);
    for (const stroke of strokes) {
      expect(stroke.strokeHex).toBe('FF0000');
      expect(stroke.fillHex).toBeNull();
    }
  });

  test('an outline with a gradient keeps the group refused', () => {
    const gradient =
      '<a:ln w="12700"><a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs>' +
      '</a:gsLst></a:gradFill></a:ln>';
    const part = parsePart(
      `<w:p><w:r>${unscaledGroup(
        outlinedPicture('rId1', 100, -200, gradient) +
          outlinedPicture('rId2', 1100, 300, SOLID_LINE)
      )}</w:r></w:p>`
    );
    const [projection] = projectDrawingsInPart(part);
    expect(projection?.groupPicture ?? null).toBeNull();
  });
});
