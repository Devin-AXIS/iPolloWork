// Unsupported MC drawings retain their authored geometry and one visible placeholder.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart, WML_NAMESPACE_URI, type OoxmlPart } from '../index.ts';
import {
  drawingAccessibility,
  indexInlineDrawingProjectionsInPart,
  projectDrawingsInPart,
} from '../package/drawing-projection.ts';
import { wrapFootprintProjection } from '../package/drawing-wrap-footprint.ts';

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

const PICTURE_MEMBER =
  '<pic:pic><pic:nvPicPr><pic:cNvPr id="2" name="Picture"/><pic:cNvPicPr/></pic:nvPicPr>' +
  '<pic:blipFill><a:blip r:embed="rIdImg"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
  '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="762000" cy="762000"/></a:xfrm>' +
  '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>';

const TEXTBOX_MEMBER =
  '<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="889000" y="0"/>' +
  '<a:ext cx="2540000" cy="762000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
  '<a:effectLst><a:outerShdw dist="38100"/></a:effectLst></wps:spPr><wps:txbx><w:txbxContent><w:p><w:r><w:t>Label</w:t></w:r></w:p></w:txbxContent>' +
  '</wps:txbx><wps:bodyPr/></wps:wsp>';

interface AnchorOptions {
  readonly wrap?: string;
  readonly behindDoc?: '0' | '1';
  readonly docPr?: string;
  readonly cx?: number;
  readonly cy?: number;
  readonly members?: string;
}

/** A column/paragraph-anchored group at (0, 24pt), 300pt x 60pt, like a letterhead band. */
function groupAnchor(options: AnchorOptions = {}): string {
  const { cx = 3810000, cy = 762000 } = options;
  return (
    '<w:drawing><wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" ' +
    `relativeHeight="5" behindDoc="${options.behindDoc ?? '0'}" locked="0" layoutInCell="1" ` +
    'allowOverlap="1"><wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="paragraph"><wp:posOffset>304800</wp:posOffset></wp:positionV>' +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `${options.wrap ?? '<wp:wrapTopAndBottom/>'}` +
    `${options.docPr ?? '<wp:docPr id="1" name="Group 1"/>'}` +
    `<a:graphic><a:graphicData uri="${WPG}"><wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr>` +
    `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/>` +
    `<a:chOff x="0" y="0"/><a:chExt cx="${cx}" cy="${cy}"/></a:xfrm></wpg:grpSpPr>` +
    `${options.members ?? PICTURE_MEMBER + TEXTBOX_MEMBER}</wpg:wgp></a:graphicData></a:graphic>` +
    '</wp:anchor></w:drawing>'
  );
}

function mcWrapped(choice: string, requires = 'wpg', fallback = '<w:pict><v:group/></w:pict>') {
  return (
    `<mc:AlternateContent><mc:Choice Requires="${requires}">${choice}</mc:Choice>` +
    `<mc:Fallback>${fallback}</mc:Fallback></mc:AlternateContent>`
  );
}

function partWith(run: string): OoxmlPart {
  return parsePart(`<w:p><w:r>${run}</w:r><w:r><w:t>First line</w:t></w:r></w:p>`);
}

describe('the placeholder of an MC payload that cannot paint', () => {
  test('keeps the anchor geometry and unsupported drawing identity', () => {
    const part = partWith(mcWrapped(groupAnchor()));
    const index = indexInlineDrawingProjectionsInPart(part);
    expect(index.size).toBe(1);
    const [[atomId, footprint]] = [...index];
    // Keyed by the MC wrapper, the same atom every layout walk and model offset uses.
    const wrapper = part.root.children[0]!.children[0]!.children[0]!.children[0]!;
    expect(wrapper.localName).toBe('AlternateContent');
    expect(atomId).toBe(wrapper.id);
    expect(footprint!.footprintOnly).toBeUndefined();
    expect(footprint).toMatchObject({
      kind: 'anchored',
      wrap: 'topAndBottom',
      extentEmu: { cx: 3810000, cy: 762000 },
      picture: null,
      groupPicture: null,
      vectorShape: null,
      textboxStory: null,
      relationshipId: null,
      hyperlinkHref: null,
    });
    expect(footprint!.position?.vertical).toMatchObject({
      relativeFrom: 'paragraph',
      offsetEmu: 304800,
    });
    // Unsupported visible content stays available to every output.
    expect(drawingAccessibility(footprint!).hidden).toBe(false);
  });

  test('public projections list the unsupported drawing', () => {
    expect(projectDrawingsInPart(partWith(mcWrapped(groupAnchor())))).toHaveLength(1);
  });

  test('a group outside MC keeps its placeholder projection', () => {
    const [projection] = projectDrawingsInPart(partWith(groupAnchor()));
    expect(projection!.footprintOnly).toBeUndefined();
    expect(projection!.groupPicture).toBeNull();
    expect(drawingAccessibility(projection!).hidden).toBe(false);
  });

  const wraps: readonly (readonly [string, string, string | null])[] = [
    ['top and bottom', '<wp:wrapTopAndBottom/>', 'topAndBottom'],
    ['square', '<wp:wrapSquare wrapText="bothSides"/>', 'square'],
    ['square on the left', '<wp:wrapSquare wrapText="left"/>', 'squareLeft'],
    [
      'tight',
      '<wp:wrapTight wrapText="bothSides"><wp:wrapPolygon edited="0"><wp:start x="0" y="0"/>' +
        '<wp:lineTo x="21600" y="0"/><wp:lineTo x="21600" y="21600"/><wp:lineTo x="0" y="21600"/>' +
        '<wp:lineTo x="0" y="0"/></wp:wrapPolygon></wp:wrapTight>',
      'tight',
    ],
    ['none', '<wp:wrapNone/>', 'inFront'],
  ];
  for (const [name, wrap, expected] of wraps) {
    test(`wrap ${name} retains its projection`, () => {
      const index = indexInlineDrawingProjectionsInPart(partWith(mcWrapped(groupAnchor({ wrap }))));
      if (expected === null) {
        expect(index.size).toBe(0);
        return;
      }
      expect([...index.values()].map((projection) => projection.wrap)).toEqual([expected]);
    });
  }

  test('behind the text, placeholders retain the authored wrapping mode', () => {
    const behind = (wrap?: string) =>
      indexInlineDrawingProjectionsInPart(
        partWith(mcWrapped(groupAnchor({ behindDoc: '1', ...(wrap ? { wrap } : {}) })))
      );
    expect([...behind('<wp:wrapNone/>').values()].map((projection) => projection.wrap)).toEqual([
      'behind',
    ]);
    expect([...behind().values()].map((projection) => projection.wrap)).toEqual(['topAndBottom']);
  });

  test('a hidden anchor reserves nothing, and an inline payload keeps its extent', () => {
    const hidden = groupAnchor({ docPr: '<wp:docPr id="1" name="Group 1" hidden="1"/>' });
    expect(indexInlineDrawingProjectionsInPart(partWith(mcWrapped(hidden))).size).toBe(0);
    const inline = (docPr: string) =>
      '<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
      `<wp:extent cx="914400" cy="457200"/>${docPr}` +
      `<a:graphic><a:graphicData uri="${WPG}"><wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr/>` +
      `${PICTURE_MEMBER}${TEXTBOX_MEMBER}</wpg:wgp></a:graphicData></a:graphic></wp:inline></w:drawing>`;
    const part = partWith(mcWrapped(inline('<wp:docPr id="3" name="Group 3"/>')));
    const [footprint] = [...indexInlineDrawingProjectionsInPart(part).values()];
    expect(footprint).toMatchObject({
      kind: 'inline',
      wrap: 'inline',
      extentEmu: { cx: 914400, cy: 457200 },
      groupPicture: null,
      vectorShape: null,
      textboxStory: null,
    });
    expect(drawingAccessibility(footprint!).hidden).toBe(false);
    expect(projectDrawingsInPart(part)).toHaveLength(1);
    const hiddenInline = inline('<wp:docPr id="3" name="Group 3" hidden="1"/>');
    expect(indexInlineDrawingProjectionsInPart(partWith(mcWrapped(hiddenInline))).size).toBe(0);
  });

  test('keeps unsupported content without an unresolved hyperlink', () => {
    const linked = groupAnchor({
      docPr: '<wp:docPr id="1" name="Group 1"><a:hlinkClick r:id="rIdLink"/></wp:docPr>',
    });
    const part = partWith(mcWrapped(linked));
    const [footprint] = [...indexInlineDrawingProjectionsInPart(part).values()];
    expect(footprint!.footprintOnly).toBeUndefined();
    expect(footprint!.hyperlinkHref).toBeNull();
  });

  test('reads the selected MC branch only', () => {
    // The Choice needs a namespace the engine does not know, so the Fallback is the
    // selected branch. Its extent and wrap are the footprint, not the Choice's.
    const choice = groupAnchor({ cx: 6350000, cy: 2540000 });
    const fallback = groupAnchor({
      cx: 1270000,
      cy: 635000,
      wrap: '<wp:wrapSquare wrapText="bothSides"/>',
    });
    const part = parsePart(
      '<w:p xmlns:x="urn:example:unknown"><w:r>' + mcWrapped(choice, 'x', fallback) + '</w:r></w:p>'
    );
    const [footprint] = [...indexInlineDrawingProjectionsInPart(part).values()];
    expect(footprint!.extentEmu).toEqual({ cx: 1270000, cy: 635000 });
    expect(footprint!.wrap).toBe('square');
  });

  test('answers one object per projection', () => {
    const [projection] = projectDrawingsInPart(partWith(groupAnchor()));
    const footprint = wrapFootprintProjection(projection!);
    expect(footprint).not.toBeNull();
    expect(wrapFootprintProjection(projection!)).toBe(footprint);
    expect(Object.isFrozen(footprint)).toBe(true);
  });
});

test('an MC-wrapped anchor keeps its authored tight wrap polygon', () => {
  const wrap =
    '<wp:wrapTight wrapText="bothSides"><wp:wrapPolygon edited="0"><wp:start x="5000" y="500"/>' +
    '<wp:lineTo x="5000" y="21000"/><wp:lineTo x="17000" y="21000"/>' +
    '<wp:lineTo x="17000" y="500"/><wp:lineTo x="5000" y="500"/></wp:wrapPolygon></wp:wrapTight>';
  const [[, projection]] = [
    ...indexInlineDrawingProjectionsInPart(partWith(mcWrapped(groupAnchor({ wrap })))),
  ];
  expect(projection!.wrapGeometry?.element).toBe('tight');
  expect(projection!.wrapGeometry?.polygon).toEqual([
    { x: 5000, y: 500 },
    { x: 5000, y: 21000 },
    { x: 17000, y: 21000 },
    { x: 17000, y: 500 },
    { x: 5000, y: 500 },
  ]);
});

describe('MC drawing fallback selection', () => {
  const legacy = (shape: string) =>
    `<w:pict><v:shape id="Fallback" alt="Structure chart" style="width:120pt;height:60pt" ${shape}/></w:pict>`;

  test('an unsupported selected VML fallback retains one placeholder and its label', () => {
    const part = parsePart(
      '<w:p xmlns:x="urn:example:unknown"><w:r>' +
        mcWrapped(groupAnchor(), 'x', legacy('path="unsupported"')) +
        '</w:r></w:p>'
    );
    const before = serializeOoxmlPart(part);
    const projections = projectDrawingsInPart(part);
    expect(projections).toHaveLength(1);
    expect(projections[0]).toMatchObject({
      description: 'Structure chart',
      extentEmu: { cx: 1524000, cy: 762000 },
      picture: null,
      vectorShape: null,
      ownerPartName: '/word/document.xml',
    });
    expect(drawingAccessibility(projections[0]!).hidden).toBe(false);
    expect(indexInlineDrawingProjectionsInPart(part).size).toBe(1);
    expect(serializeOoxmlPart(part)).toBe(before);
    const reopened = readOoxmlPart(before, { name: part.name, contentType: part.contentType });
    if (!reopened.ok) throw new Error(reopened.reason);
    expect(projectDrawingsInPart(reopened.part)).toHaveLength(1);
  });

  test('a paintable VML fallback replaces an unsupported modern drawing', () => {
    const fallback =
      '<w:pict><v:rect id="Legacy" style="width:120pt;height:60pt" stroked="f" fillcolor="#123456"/></w:pict>';
    const [projection] = projectDrawingsInPart(partWith(mcWrapped(groupAnchor(), 'wpg', fallback)));
    expect(projection!.extentEmu).toEqual({ cx: 1524000, cy: 762000 });
    expect(projection!.vectorShape ?? projection!.legacyGraphic).toBeTruthy();
  });

  test('an unsized fallback uses only the modern drawing geometry', () => {
    const part = parsePart(
      '<w:p xmlns:x="urn:example:unknown"><w:r>' + mcWrapped(groupAnchor(), 'x') + '</w:r></w:p>'
    );
    const [projection] = projectDrawingsInPart(part);
    expect(projection).toMatchObject({
      extentEmu: { cx: 3810000, cy: 762000 },
      picture: null,
      vectorShape: null,
      groupPicture: null,
      textboxStory: null,
    });
    expect(drawingAccessibility(projection!).hidden).toBe(false);
    expect(indexInlineDrawingProjectionsInPart(part).size).toBe(1);
  });

  test('nonvisual selected content does not become a drawing placeholder', () => {
    const part = partWith(mcWrapped('<w:rPr><w:b/></w:rPr>'));
    expect(projectDrawingsInPart(part)).toHaveLength(0);
    expect(indexInlineDrawingProjectionsInPart(part).size).toBe(0);
  });
});
