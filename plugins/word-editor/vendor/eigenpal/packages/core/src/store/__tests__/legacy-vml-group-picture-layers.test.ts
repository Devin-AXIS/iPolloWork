// A legacy group of shapes and one picture, with no member text, paints as vectors: members
// drawn before the picture lie under it and the rest over it. A `coordorigin` with one value
// has a y of 0.

import { expect, test } from 'bun:test';
import { indexInlineDrawingProjectionsInPart } from '../package/drawing-projection.ts';
import { readOoxmlPart } from '../package/ooxml-tree.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const V = 'urn:schemas-microsoft-com:vml';
const O = 'urn:schemas-microsoft-com:office:office';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const TEMPLATE =
  '<v:shapetype id="_x0000_t75" coordsize="21600,21600" o:spt="75" o:preferrelative="t" ' +
  'path="m@4@5l@4@11@9@11@9@5xe" filled="f" stroked="f"><v:stroke joinstyle="miter"/>' +
  '<v:formulas><v:f eqn="if lineDrawn pixelLineWidth 0"/><v:f eqn="sum @0 1 0"/>' +
  '<v:f eqn="sum 0 0 @1"/><v:f eqn="prod @2 1 2"/><v:f eqn="prod @3 21600 pixelWidth"/>' +
  '<v:f eqn="prod @3 21600 pixelHeight"/><v:f eqn="sum @0 0 1"/><v:f eqn="prod @6 1 2"/>' +
  '<v:f eqn="prod @7 21600 pixelWidth"/><v:f eqn="sum @8 21600 0"/>' +
  '<v:f eqn="prod @7 21600 pixelHeight"/><v:f eqn="sum @10 21600 0"/></v:formulas>' +
  '<v:path o:extrusionok="f" gradientshapeok="t" o:connecttype="rect"/>' +
  '<o:lock v:ext="edit" aspectratio="t"/></v:shapetype>';

const background =
  '<v:rect style="position:absolute;width:1000;height:600" fillcolor="#6f4997" stroked="f"/>';
const picture =
  '<v:shape type="#_x0000_t75" style="position:absolute;left:600;width:400;height:400">' +
  '<v:imagedata r:id="rId4" o:title=""/></v:shape>';
/** A filled triangle at the top left, away from the picture, with a one-value origin. */
const arc =
  '<v:shape style="position:absolute;left:10;width:200;height:100" coordorigin="10" ' +
  'coordsize="200,100" path="m10,l210,,10,100xe" fillcolor="#74519b" stroked="f"/>';

function project(members: string) {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:v="${V}" xmlns:o="${O}" xmlns:r="${R}"><w:body>` +
      '<w:p><w:r><w:pict><v:group style="position:absolute;margin-left:0;margin-top:0;' +
      'width:500pt;height:300pt;z-index:-1;mso-position-horizontal-relative:page;' +
      `mso-position-vertical-relative:page" coordsize="1000,600">${TEMPLATE}${members}` +
      '</v:group></w:pict></w:r></w:p></w:body></w:document>',
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  return [...indexInlineDrawingProjectionsInPart(parsed.part).values()][0] ?? null;
}

test('members before the picture paint under it, later ones over it', () => {
  const projected = project(background + picture + arc);
  expect(projected?.groupPicture?.embeddedRelationshipId).toBe('rId4');
  const components = projected?.vectorShape?.components ?? [];
  expect(components).toHaveLength(2);
  expect(components[0]!.belowPicture).toBe(true);
  expect(components[1]!.belowPicture).toBeUndefined();
});

test('a later member that covers the picture keeps the graphic preview', () => {
  const cover =
    '<v:rect style="position:absolute;left:650;top:50;width:100;height:100" ' +
    'fillcolor="#ff0000" stroked="f"/>';
  expect(project(background + picture + cover)?.groupPicture ?? null).toBeNull();
});
