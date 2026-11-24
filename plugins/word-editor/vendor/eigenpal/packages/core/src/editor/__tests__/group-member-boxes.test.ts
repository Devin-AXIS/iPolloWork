// A member's box in its group is the box the member paints in before it turns. A member turned
// nearer a quarter turn takes the other axis's scale, so its box matches its paint in a group
// that scales its axes unevenly.

import { expect, test } from 'bun:test';
import { readOoxmlPart, WML_NAMESPACE_URI } from '../../store/index.ts';
import { projectDrawingsInPart } from '../../store/package/drawing-projection.ts';
import { groupMemberBoxes } from '../group-member-selection.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const WPG = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';
const EMU = 12_700;

function member(x: number, rot: number): string {
  return (
    `<wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm${rot ? ` rot="${rot * 60_000}"` : ''}>` +
    `<a:off x="${x * EMU}" y="0"/><a:ext cx="${72 * EMU}" cy="${144 * EMU}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
    '<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></wps:spPr><wps:bodyPr/></wps:wsp>'
  );
}

/** A 144 x 72pt group in 144 x 144pt child units: an upright member and a turned one. */
function boxes(rot: number) {
  const xml =
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" ` +
    `xmlns:wps="${WPS}" xmlns:wpg="${WPG}"><w:body><w:p><w:r><w:drawing>` +
    '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="1" ' +
    'behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="page"><wp:posOffset>914400</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="page"><wp:posOffset>914400</wp:posOffset></wp:positionV>' +
    `<wp:extent cx="${144 * EMU}" cy="${72 * EMU}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    '<wp:wrapNone/><wp:docPr id="1" name="Group 1"/>' +
    `<a:graphic><a:graphicData uri="${WPG}"><wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr><a:xfrm>` +
    `<a:off x="0" y="0"/><a:ext cx="${144 * EMU}" cy="${72 * EMU}"/><a:chOff x="0" y="0"/>` +
    `<a:chExt cx="${144 * EMU}" cy="${144 * EMU}"/></a:xfrm></wpg:grpSpPr>` +
    `${member(0, 0)}${member(72, rot)}</wpg:wgp></a:graphicData></a:graphic></wp:anchor>` +
    '</w:drawing></w:r></w:p></w:body></w:document>';
  const parsed = readOoxmlPart(xml, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  const [projection] = projectDrawingsInPart(parsed.part);
  return groupMemberBoxes(parsed.part, projection!.drawingNodeId)!.map((box) => [
    box.x,
    box.y,
    box.width,
    box.height,
  ]);
}

test('a member box follows the member placement in an unevenly scaled group', () => {
  // Upright: the child box in shares of the child extent.
  expect(boxes(0)).toEqual([
    [0, 0, 0.5, 1],
    [0.5, 0, 0.5, 1],
  ]);
  // Turned 90 degrees: a 36 x 144pt box about the centre (108, 36)pt of the 144 x 72pt group.
  expect(boxes(90)[1]).toEqual([0.625, -0.5, 0.25, 2]);
  // Turned 30 degrees: each axis keeps its own scale, so the box is the child box.
  expect(boxes(30)[1]).toEqual([0.5, 0, 0.5, 1]);
});
