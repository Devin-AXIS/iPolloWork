// A legacy VML group of shapes, connectors and text boxes paints as vector members with
// member stories, the way a drawing canvas paints.

import { describe, expect, test } from 'bun:test';
import { projectDrawingsInPart, type DrawingProjection } from '../package/drawing-projection.ts';
import { readOoxmlPart } from '../package/ooxml-tree.ts';
import { expectRefused } from './legacy-vml-refusal.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const V = 'urn:schemas-microsoft-com:vml';
const O = 'urn:schemas-microsoft-com:office:office';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const EMU = 12_700;

const PICTURE_TEMPLATE =
  '<v:shapetype id="_x0000_t75" coordsize="21600,21600" filled="f" stroked="f" o:spt="75" o:preferrelative="t" path="m@4@5l@4@11@9@11@9@5xe"><v:stroke joinstyle="miter"/><v:formulas><v:f eqn="if lineDrawn pixelLineWidth 0"/><v:f eqn="sum @0 1 0"/><v:f eqn="sum 0 0 @1"/><v:f eqn="prod @2 1 2"/><v:f eqn="prod @3 21600 pixelWidth"/><v:f eqn="prod @3 21600 pixelHeight"/><v:f eqn="sum @0 0 1"/><v:f eqn="prod @6 1 2"/><v:f eqn="prod @7 21600 pixelWidth"/><v:f eqn="sum @8 21600 0"/><v:f eqn="prod @7 21600 pixelHeight"/><v:f eqn="sum @10 21600 0"/></v:formulas><v:path gradientshapeok="t" o:connecttype="rect" o:extrusionok="f"/><o:lock v:ext="edit" aspectratio="t"/></v:shapetype>';
// The connector template as some writers save it, with an editing lock.
const LINE_TEMPLATE =
  '<v:shapetype id="_x0000_t32" coordsize="21600,21600" o:oned="t" filled="f" o:spt="32" path="m,l21600,21600e"><v:path fillok="f" arrowok="t" o:connecttype="none"/><o:lock v:ext="edit" shapetype="t"/></v:shapetype>';

function box(id: string, left: number, text: string): string {
  return `<v:roundrect id="${id}" style="width:5040;height:16200;left:${left};position:absolute;top:2700;v-text-anchor:middle" fillcolor="#dce6f2" stroked="t" strokecolor="#1f3864" strokeweight="1pt" arcsize="10923f"><v:textbox><w:txbxContent><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:txbxContent></v:textbox></v:roundrect>`;
}

function arrow(left: number): string {
  return `<v:shape style="width:3240;height:0;left:${left};position:absolute;top:10800" fillcolor="this" stroked="t" strokecolor="#1f3864" strokeweight="1.5pt" type="#_x0000_t32"><v:stroke endarrow="block"/></v:shape>`;
}

function canvasGroup(members: string): string {
  return `<w:pict><v:group id="canvas" style="width:432pt;height:72pt;mso-wrap-distance-left:0;mso-wrap-distance-right:0" coordsize="21600,21600" coordorigin="0,0" editas="canvas">${PICTURE_TEMPLATE}<v:shape style="width:21600;height:21600;position:absolute" type="#_x0000_t75"><v:fill o:detectmouseclick="t"/></v:shape>${members}</v:group></w:pict>`;
}

function project(content: string): DrawingProjection[] {
  const xml = `<w:document xmlns:w="${W}" xmlns:v="${V}" xmlns:o="${O}" xmlns:r="${R}"><w:body><w:p><w:r>${content}</w:r></w:p></w:body></w:document>`;
  const loaded = readOoxmlPart(xml, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!loaded.ok) throw new Error(loaded.reason);
  return projectDrawingsInPart(loaded.part);
}

describe('legacy VML groups as vector members', () => {
  test('a canvas group paints its shapes, connectors and text', () => {
    const [projection] = project(
      canvasGroup(`${box('a', 0, 'Start')}${LINE_TEMPLATE}${arrow(5040)}${box('b', 8280, 'End')}`)
    );
    expect(projection).toBeDefined();
    expect(projection!.legacyGraphic).toBeUndefined();
    const shape = projection!.vectorShape!;
    expect(shape.extentEmu).toEqual({ cx: 432 * EMU, cy: 72 * EMU });
    // The empty background frame paints nothing; two boxes and one connector remain.
    expect(shape.components).toHaveLength(3);
    expect(shape.components[0]).toMatchObject({ fillHex: 'DCE6F2', strokeHex: '1F3864' });
    const connector = shape.components[1]!;
    expect(connector).toMatchObject({ fillHex: null, strokeHex: '1F3864' });
    expect(connector.arrowheadsEmu).toHaveLength(1);
    // 5040 of 21600 across 432pt is 100.8pt; the connector runs to 8280 (165.6pt).
    const xs = connector.subpathsEmu[0]!.map((point) => point.x / EMU);
    expect(xs[0]).toBeCloseTo(100.8, 3);
    expect(xs[1]).toBeCloseTo(165.6, 3);
    const texts = projection!.groupTextboxes!;
    expect(texts.map((member) => member.frameEmu.x / EMU)).toEqual([0, 165.6]);
    expect(texts[0]!.story).toMatchObject({
      verticalAnchor: 'center',
      fillHex: null,
      strokeHex: null,
    });
    expect(texts[0]!.frameEmu.cy / EMU).toBeCloseTo(54, 3);
  });

  test('a group with text refuses when a member is outside the subset', () => {
    const picture = '<v:shape style="width:100;height:100" type="#_x0000_t75" filled="t"/>';
    expectRefused(project(canvasGroup(`${box('a', 0, 'Start')}${picture}`)));
  });

  test('a group of shapes without text keeps painting as vectors', () => {
    const [projection] = project(
      canvasGroup('<v:oval style="width:5000;height:5000;position:absolute" fillcolor="red"/>')
    );
    expect(projection!.vectorShape!.components).toHaveLength(1);
    expect(projection!.groupTextboxes).toBeUndefined();
  });
});

test('a line member spans its points in the group space', () => {
  const [projection] = project(
    '<w:pict><v:group style="width:200pt;height:100pt" coordsize="2000,1000">' +
      '<v:line style="position:absolute" from="0,500" to="2000,500" strokecolor="red"/>' +
      '</v:group></w:pict>'
  );
  const line = projection!.vectorShape!.components[0]!.subpathsEmu[0]!;
  expect(line.map((point) => [point.x / EMU, point.y / EMU])).toEqual([
    [0, 50],
    [200, 50],
  ]);
});

test('a shape drawn by its own straight path paints as a line in the group', () => {
  const [projection] = project(
    '<w:pict><v:group style="position:absolute;width:488.45pt;height:.1pt" coordorigin="955,285" coordsize="9769,2">' +
      '<v:shape style="position:absolute;left:955;top:285;width:9769;height:2" coordorigin="955,285" coordsize="9769,0" path="m955,285r9769,e" filled="f" strokeweight="1pt"><v:path arrowok="t"/></v:shape>' +
      '</v:group></w:pict>'
  );
  const component = projection!.vectorShape!.components[0]!;
  expect(component.subpathsEmu[0]!.map((point) => [point.x / EMU, point.y / EMU])).toEqual([
    [0, 0],
    [488.45, 0],
  ]);
  expect(component.fillHex).toBeNull();
});

test('a flipped line member mirrors inside its box, and an edit flag is ignored', () => {
  const [projection] = project(
    '<w:pict><v:group style="position:absolute;width:100pt;height:50pt" coordsize="100,50">' +
      '<v:line style="position:absolute;flip:y;mso-wrap-edited:f" from="0,0" to="100,50"/>' +
      '</v:group></w:pict>'
  );
  const line = projection!.vectorShape!.components[0]!.subpathsEmu[0]!;
  expect(line.map((point) => [point.x / EMU, point.y / EMU])).toEqual([
    [0, 50],
    [100, 0],
  ]);
});

test('a member text wrap style is ignored; a member placement key still refuses', () => {
  const group = (style: string) =>
    '<w:pict><v:group style="position:absolute;width:100pt;height:50pt" coordsize="100,50">' +
    `<v:line style="position:absolute;visibility:visible;${style}" from="0,0" to="0,50"/>` +
    '</v:group></w:pict>';
  const [kept] = project(group('mso-wrap-style:square'));
  expect(kept!.vectorShape!.components).toHaveLength(1);
  const [refused] = project(group('mso-position-horizontal:center'));
  expect(refused?.vectorShape ?? null).toBeNull();
});

test('beside member text, one picture member paints as the group picture', () => {
  const picture = (id: string, left: number) =>
    `<v:shape style="position:absolute;left:${left};top:0;width:500;height:500" type="#_x0000_t75" stroked="false"><v:imagedata r:id="${id}" o:title=""/></v:shape>`;
  const group = (members: string) =>
    `<w:pict><v:group style="position:absolute;margin-left:36pt;margin-top:52pt;width:200pt;height:50pt" coordsize="2000,500">${members}</v:group></w:pict>`;
  const line =
    '<v:line style="position:absolute" from="0,450" to="2000,450" strokeweight=".5pt"/>' +
    '<v:shape style="position:absolute;left:1500;top:200;width:500;height:100" type="#_x0000_t202" filled="false" stroked="false"><v:textbox inset="0,0,0,0"><w:txbxContent><w:p><w:r><w:t>Date</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape>';
  const [projection] = project(group(line + picture('rId7', 500)));
  expect(projection!.groupTextboxes).toHaveLength(1);
  expect(projection!.groupPicture).toMatchObject({
    embeddedRelationshipId: 'rId7',
    frameEmu: { x: 50 * EMU, y: 0, cx: 50 * EMU, cy: 50 * EMU },
  });
  expectRefused(project(group(line + picture('rId7', 0) + picture('rId8', 1000))));
});

describe('floating straight connectors', () => {
  const connector = (style: string, children = '') =>
    `<w:pict>${LINE_TEMPLATE}<v:shape type="#_x0000_t32" style="position:absolute;margin-left:126.75pt;margin-top:14.5pt;${style};z-index:251658240" o:connectortype="straight">${children}</v:shape></w:pict>`;

  test('a connector with no path of its own draws its template line', () => {
    const [projection] = project(connector('width:197.25pt;height:0'));
    expect(projection!.kind).toBe('anchored');
    const line = projection!.vectorShape!.components[0]!.subpathsEmu[0]!;
    expect(line.map((point) => [point.x / EMU, point.y / EMU])).toEqual([
      [0, 0],
      [197.25, 0],
    ]);
  });

  test('a flip turns the connector, so its arrowhead moves to the other end', () => {
    const [projection] = project(
      connector('width:100pt;height:0;flip:x', '<v:stroke endarrow="block"/>')
    );
    const component = projection!.vectorShape!.components[0]!;
    expect(component.subpathsEmu[0]!.map((point) => point.x / EMU)).toEqual([100, 0]);
    expect(component.arrowheadsEmu![0]![0]!.x).toBe(0);
  });

  test('a diagonal connector is a vector line from corner to corner', () => {
    const [projection] = project(connector('width:2.5pt;height:295.3pt'));
    const line = projection!.vectorShape!.components[0]!.subpathsEmu[0]!;
    expect(line.map((point) => [point.x / EMU, point.y / EMU])).toEqual([
      [0, 0],
      [2.5, 295.3],
    ]);
    expect(projection!.legacyGraphic).toBeUndefined();
  });

  test('a packed copy of the drawing spends none of the input budget', () => {
    const packed = connector('width:100pt;height:0').replace(
      'o:connectortype="straight"',
      `o:connectortype="straight" o:gfxdata="${'A'.repeat(20_000)}"`
    );
    expect(project(packed)[0]!.vectorShape).not.toBeNull();
  });

  test('a dashed or double outline paints as its dashes or two bands', () => {
    const [dashed] = project(connector('width:100pt;height:0', '<v:stroke dashstyle="1 1"/>'));
    expect(dashed!.vectorShape!.components[0]!.strokeDash).toEqual([1, 1]);
    const [double] = project(connector('width:100pt;height:0', '<v:stroke linestyle="thinThin"/>'));
    expect(double!.vectorShape!.components.length).toBeGreaterThan(1);
    // A style outside the known set refuses the shape rather than paint it solid.
    expect(project(connector('width:100pt;height:0', '<v:stroke dashstyle="1 2 3"/>'))).toEqual([]);
  });
});
