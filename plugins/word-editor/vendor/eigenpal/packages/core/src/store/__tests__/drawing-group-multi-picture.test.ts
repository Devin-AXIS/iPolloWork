// A `wpg:wgp` group can hold several picture members beside its text box and vector
// members. The group picture read accepted one picture only, so a second picture left the
// whole group, its text box text included, projecting as nothing. These tests pin the
// projection of such groups: every picture in document order with its own frame and crop,
// the vector and text box members beside them, and negative child offsets.

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

/** Group child space: offset (100, -200), extent 3000 x 4000, drawn at 6000000 x 8000000 EMU. */
const SCALE = 2000;

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

/** A text box without fill or outline: it paints only its text. */
const TEXTBOX_MEMBER =
  '<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr>' +
  '<a:xfrm><a:off x="2100" y="-200"/><a:ext cx="1000" cy="4000"/></a:xfrm>' +
  '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln>' +
  '</wps:spPr><wps:txbx><w:txbxContent><w:p><w:r><w:t>Box</w:t></w:r></w:p>' +
  '</w:txbxContent></wps:txbx><wps:bodyPr><a:noAutofit/></wps:bodyPr></wps:wsp>';

const BAR_MEMBER =
  '<wps:wsp><wps:cNvPr id="3" name="Bar"/><wps:cNvSpPr/><wps:spPr>' +
  '<a:xfrm><a:off x="100" y="3000"/><a:ext cx="1000" cy="10"/></a:xfrm>' +
  '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
  '<a:solidFill><a:srgbClr val="000000"/></a:solidFill></wps:spPr><wps:bodyPr/></wps:wsp>';

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

function mcWrapped(drawing: string): string {
  return (
    `<mc:AlternateContent><mc:Choice Requires="wpg">${drawing}</mc:Choice>` +
    '<mc:Fallback><w:pict><v:group id="fallback"/></w:pict></mc:Fallback></mc:AlternateContent>'
  );
}

function projectionOf(run: string) {
  const projections = projectDrawingsInPart(parsePart(`<w:p><w:r>${run}</w:r></w:p>`));
  expect(projections).toHaveLength(1);
  return projections[0]!;
}

const CROP = '<a:srcRect t="19994" b="5"/>';

describe('a group with several picture members', () => {
  test('projects every picture in document order beside its text box and vector members', () => {
    const projection = projectionOf(
      groupDrawing(
        TEXTBOX_MEMBER +
          pictureMember('rIdA', 100, -100) +
          pictureMember('rIdB', 1200, 0, CROP) +
          BAR_MEMBER
      )
    );
    expect(projection.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      'unsupported-graphic'
    );
    // The negative child offset moves every member down by 200 child units.
    expect(projection.groupPicture).toMatchObject({
      embeddedRelationshipId: 'rIdA',
      crop: { left: 0, top: 0, right: 0, bottom: 0 },
      frameEmu: { x: 0, y: 100 * SCALE, cx: 1000 * SCALE, cy: 500 * SCALE },
      alternateContent: false,
    });
    expect(projection.groupPictureLayers).toHaveLength(1);
    expect(projection.groupPictureLayers![0]).toMatchObject({
      embeddedRelationshipId: 'rIdB',
      crop: { left: 0, top: 0.19994, right: 0, bottom: 0.00005 },
      frameEmu: { x: 1100 * SCALE, y: 200 * SCALE, cx: 1000 * SCALE, cy: 500 * SCALE },
    });
    // Neither picture is a vector member; the bar is.
    expect(projection.vectorShape?.components).toHaveLength(1);
    expect(projection.vectorShape?.components[0]!.subpathsEmu[0]![0]).toEqual({
      x: 0,
      y: 3200 * SCALE,
    });
    // The text box member keeps its text, in its own frame.
    expect(projection.groupTextboxes).toHaveLength(1);
    expect(projection.groupTextboxes![0]!.frameEmu).toEqual({
      x: 2000 * SCALE,
      y: 0,
      cx: 1000 * SCALE,
      cy: 4000 * SCALE,
    });
  });

  test('keeps three pictures in document order', () => {
    const projection = projectionOf(
      groupDrawing(
        pictureMember('rIdA', 100, -200) +
          pictureMember('rIdB', 1100, -200) +
          pictureMember('rIdC', 2100, -200)
      )
    );
    expect(projection.groupPicture?.embeddedRelationshipId).toBe('rIdA');
    expect(projection.groupPictureLayers?.map((picture) => picture.embeddedRelationshipId)).toEqual(
      ['rIdB', 'rIdC']
    );
    expect(projection.vectorShape).toBeNull();
  });

  test('marks every picture of an MC-wrapped group as alternate content', () => {
    const projection = projectionOf(
      mcWrapped(groupDrawing(pictureMember('rIdA', 100, -200) + pictureMember('rIdB', 1100, 0)))
    );
    expect(projection.groupPicture?.alternateContent).toBe(true);
    expect(projection.groupPictureLayers?.map((picture) => picture.alternateContent)).toEqual([
      true,
    ]);
  });

  test('a group with one picture has no picture layers', () => {
    const projection = projectionOf(groupDrawing(pictureMember('rIdA', 100, -200) + BAR_MEMBER));
    expect(projection.groupPicture?.embeddedRelationshipId).toBe('rIdA');
    expect(projection.groupPictureLayers).toBeUndefined();
  });

  test('a picture after a vector member leaves the group unpainted', () => {
    const projection = projectionOf(
      groupDrawing(pictureMember('rIdA', 100, -200) + BAR_MEMBER + pictureMember('rIdB', 1100, 0))
    );
    expect(projection.groupPicture).toBeNull();
    expect(projection.groupPictureLayers).toBeUndefined();
    expect(projection.vectorShape).toBeNull();
  });
});
