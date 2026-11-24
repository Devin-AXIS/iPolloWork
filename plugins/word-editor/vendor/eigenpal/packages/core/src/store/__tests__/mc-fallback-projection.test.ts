// A run-level `mc:AlternateContent` whose chosen branch cannot paint shows its VML fallback
// when that paints, with the fallback's own geometry. Without one, the chosen branch keeps
// its hidden extent.

import { describe, expect, test } from 'bun:test';
import { createFixedMeasurer, layoutSemanticDocument } from '../../layout/semantic-layout.ts';
import { linesOf } from '../../layout/semantic-records.ts';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  indexInlineDrawingProjectionsInPart,
  projectDrawing,
  projectDrawingsInPart,
} from '../package/drawing-projection.ts';
import { readOoxmlPart, type OoxmlPart } from '../package/ooxml-tree.ts';

const NS = [
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
  'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"',
  'xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"',
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"',
  'xmlns:v="urn:schemas-microsoft-com:vml"',
  'xmlns:o="urn:schemas-microsoft-com:office:office"',
].join(' ');
const CX = 5652000;
const CY = 18415;
const frame = (cx: number, cy: number) =>
  `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/><a:chOff x="0" y="0"/><a:chExt cx="${cx}" cy="${cy}"/></a:xfrm>`;
const TEXTBOX =
  '<wps:wsp><wps:cNvPr id="3" name="T"/><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/>' +
  `<a:ext cx="${CX}" cy="${CY}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></wps:spPr>` +
  '<wps:txbx><w:txbxContent><w:p><w:r><w:t>t</w:t></w:r></w:p></w:txbxContent></wps:txbx>' +
  '<wps:bodyPr vert="vert270"/></wps:wsp>';
/** An inline group whose only member is a nested group of text boxes: outside the subset. */
const NESTED_GROUP =
  `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${CX}" cy="${CY}"/>` +
  '<wp:docPr id="1" name="G"/><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup">' +
  `<wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr>${frame(CX, CY)}</wpg:grpSpPr>` +
  `<wpg:grpSp><wpg:cNvGrpSpPr/><wpg:grpSpPr>${frame(CX, CY)}</wpg:grpSpPr>${TEXTBOX}</wpg:grpSp>` +
  '</wpg:wgp></a:graphicData></a:graphic></wp:inline></w:drawing>';
const CHART =
  `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${CX}" cy="1270000"/>` +
  '<wp:docPr id="2" name="C"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">' +
  '<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"/></a:graphicData></a:graphic>' +
  '</wp:inline></w:drawing>';
const VML_RECT =
  '<w:pict><v:rect style="width:100pt;height:4pt" fillcolor="black" stroked="f"/></w:pict>';
const TEMPLATE =
  '<v:shapetype id="_x0000_t75" coordsize="21600,21600" o:spt="75" o:preferrelative="t" path="m@4@5l@4@11@9@11@9@5xe" filled="f" stroked="f"><v:stroke joinstyle="miter"/><v:formulas><v:f eqn="if lineDrawn pixelLineWidth 0"/><v:f eqn="sum @0 1 0"/><v:f eqn="sum 0 0 @1"/><v:f eqn="prod @2 1 2"/><v:f eqn="prod @3 21600 pixelWidth"/><v:f eqn="prod @3 21600 pixelHeight"/><v:f eqn="sum @0 0 1"/><v:f eqn="prod @6 1 2"/><v:f eqn="prod @7 21600 pixelWidth"/><v:f eqn="sum @8 21600 0"/><v:f eqn="prod @7 21600 pixelHeight"/><v:f eqn="sum @10 21600 0"/></v:formulas><v:path o:extrusionok="f" gradientshapeok="t" o:connecttype="rect"/><o:lock v:ext="edit" aspectratio="t"/></v:shapetype>';
const VML_PICTURE =
  `<w:pict>${TEMPLATE}<v:shape id="p" type="#_x0000_t75" style="width:200pt;height:50pt">` +
  '<v:imagedata r:id="rChart" o:title=""/></v:shape></w:pict>';

const alternate = (choice: string, fallback: string) =>
  `<mc:AlternateContent><mc:Choice Requires="wpg">${choice}</mc:Choice>` +
  `<mc:Fallback>${fallback}</mc:Fallback></mc:AlternateContent>`;

/** One tight-spaced paragraph holding `run`, then a text paragraph. */
function part(run: string): OoxmlPart {
  const loaded = readOoxmlPart(
    `<w:document ${NS} mc:Ignorable=""><w:body>` +
      `<w:p><w:pPr><w:spacing w:line="28" w:lineRule="auto"/></w:pPr><w:r>${run}</w:r></w:p>` +
      '<w:p><w:r><w:t>After</w:t></w:r></w:p></w:body></w:document>',
    {
      name: '/word/document.xml',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    }
  );
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.part;
}

function lineTops(source: OoxmlPart): number[] {
  const atoms = indexInlineDrawingProjectionsInPart(source);
  const layout = layoutSemanticDocument(source, 1, {
    measurer: createFixedMeasurer(6, 14),
    inlineDrawingLayout: {
      ownerPartName: source.name,
      projectionForAtom: (id) => atoms.get(id) ?? null,
      project: (node) =>
        atoms.get(node.id) ??
        projectDrawing(node, {
          ownerPartName: source.name,
          limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
        }),
      resourceOf: () =>
        Object.freeze({
          kind: 'unrenderable',
          partName: null,
          mime: 'unknown',
          reason: 'unsupported-format',
        }) as never,
    },
  });
  return linesOf(layout).map((line) => line.box.y);
}

describe('an mc:AlternateContent whose chosen branch cannot paint', () => {
  test('shows a VML fallback that paints, at the fallback geometry', () => {
    const source = part(alternate(NESTED_GROUP, VML_RECT));
    const [projection] = [...indexInlineDrawingProjectionsInPart(source).values()];
    expect(projection).toMatchObject({
      kind: 'inline',
      extentEmu: { cx: 100 * 12700, cy: 4 * 12700 },
    });
    expect(projection!.vectorShape).toBeTruthy();
    expect(projection!.footprintOnly).toBeUndefined();
    expect(projectDrawingsInPart(source)).toHaveLength(1);
    // The line holds the fallback, never the chosen branch's extent.
    expect(lineTops(source)).toEqual(lineTops(part(VML_RECT)));
  });

  test('a chart shows its fallback picture', () => {
    const source = part(alternate(CHART, VML_PICTURE));
    const [projection] = [...indexInlineDrawingProjectionsInPart(source).values()];
    expect(projection).toMatchObject({
      kind: 'inline',
      relationshipId: 'rChart',
      extentEmu: { cx: 200 * 12700, cy: 50 * 12700 },
    });
  });

  test('a chosen branch without a drawing leaves its fallback inactive', () => {
    const source = part(alternate('<w:t>Chosen text</w:t>', VML_RECT));
    expect(indexInlineDrawingProjectionsInPart(source).size).toBe(0);
    expect(projectDrawingsInPart(source)).toHaveLength(0);
  });

  test('without a fallback that paints, keeps one visible placeholder at the chosen extent', () => {
    const unpaintable = '<w:pict><v:group style="width:10pt;height:10pt"/></w:pict>';
    const source = part(alternate(NESTED_GROUP, unpaintable));
    const [projection] = [...indexInlineDrawingProjectionsInPart(source).values()];
    expect(projection).toMatchObject({
      hidden: false,
      extentEmu: { cx: CX, cy: CY },
    });
    expect(projection!.footprintOnly).toBeUndefined();
    expect(projectDrawingsInPart(source)).toHaveLength(1);
  });
});
