// Floating VML text art (a text watermark) and VML picture colour adjustments.
//
// The markup below is the shape a desktop word processor writes for a diagonal, half
// transparent text watermark and for a washed-out picture watermark.

import { describe, expect, test } from 'bun:test';
import { projectDrawingsInPart, type DrawingProjection } from '../package/drawing-projection.ts';
import { readOoxmlPart, type OoxmlPart } from '../package/ooxml-tree.ts';
import { legacyRotationDegrees } from '../package/legacy-vml-values.ts';

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" ' +
  'xmlns:w10="urn:schemas-microsoft-com:office:word" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

const TEMPLATE =
  '<v:shapetype id="_x0000_t136" coordsize="21600,21600" o:spt="136" adj="10800" path="m@7,l@8,m@5,21600l@6,21600e"><v:formulas><v:f eqn="sum #0 0 10800"/><v:f eqn="prod #0 2 1"/><v:f eqn="sum 21600 0 @1"/><v:f eqn="sum 0 0 @2"/><v:f eqn="sum 21600 0 @3"/><v:f eqn="if @0 @3 0"/><v:f eqn="if @0 21600 @1"/><v:f eqn="if @0 0 @2"/><v:f eqn="if @0 @4 21600"/><v:f eqn="mid @5 @6"/><v:f eqn="mid @8 @5"/><v:f eqn="mid @7 @8"/><v:f eqn="mid @6 @7"/><v:f eqn="sum @6 0 @5"/></v:formulas><v:path textpathok="t" o:connecttype="custom" o:connectlocs="@9,0;@10,10800;@11,21600;@12,10800" o:connectangles="270,180,90,0"/><v:textpath on="t" fitshape="t"/><v:handles><v:h position="#0,bottomRight" xrange="6629,14971"/></v:handles><o:lock v:ext="edit" text="t" shapetype="t"/></v:shapetype>';

const STYLE =
  'position:absolute;margin-left:0;margin-top:0;width:412.4pt;height:247.45pt;rotation:315;' +
  'z-index:-251657216;mso-position-horizontal:center;mso-position-horizontal-relative:margin;' +
  'mso-position-vertical:center;mso-position-vertical-relative:margin';

function header(run: string): OoxmlPart {
  const loaded = readOoxmlPart(`<w:hdr ${NS}><w:p><w:r>${run}</w:r></w:p></w:hdr>`, {
    name: '/word/header1.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml',
  });
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.part;
}

function watermark(
  options: { style?: string; attributes?: string; children?: string; path?: string } = {}
): string {
  return (
    `<w:pict>${TEMPLATE}<v:shape id="PowerPlusWaterMarkObject1" o:spid="_x0000_s1025" type="#_x0000_t136" ` +
    `style="${options.style ?? STYLE}" o:allowincell="f" ${options.attributes ?? 'fillcolor="silver" stroked="f"'}>` +
    `${options.children ?? '<v:fill opacity=".5"/>'}` +
    `${options.path ?? '<v:textpath style="font-family:&quot;Calibri&quot;;font-size:1pt" string="DRAFT"/>'}` +
    '<w10:wrap anchorx="margin" anchory="margin"/></v:shape></w:pict>'
  );
}

const projected = (run: string): DrawingProjection[] => projectDrawingsInPart(header(run));

describe('VML text art', () => {
  test('a rotated, translucent text watermark projects its text behind the page', () => {
    const [art] = projected(watermark());
    expect(art?.textArt).toEqual({
      text: 'DRAFT',
      fontFamily: 'Calibri',
      bold: false,
      italic: false,
      fillHex: 'C0C0C0',
      fillAlpha: 0.5,
      strokeHex: null,
      strokeAlpha: 1,
      strokeWidthPt: 0,
      rotationDegrees: 315,
    });
    expect(art?.legacyGraphic).toBeUndefined();
    expect(art?.wrap).toBe('behind');
    expect(art?.position?.horizontal).toMatchObject({ relativeFrom: 'margin', align: 'center' });
    expect(art?.position?.vertical).toMatchObject({ relativeFrom: 'margin', align: 'center' });
    expect(art?.extentEmu).toEqual({
      cx: Math.round(412.4 * 12700),
      cy: Math.round(247.45 * 12700),
    });
  });

  test('bold, italic, an outline and a percentage opacity are read', () => {
    const [art] = projected(
      watermark({
        attributes: 'fillcolor="#1F4E79" strokecolor="red" strokeweight="1pt"',
        children: '<v:fill opacity="25%"/>',
        path: '<v:textpath style="font-family:Arial;font-size:72pt;font-weight:bold;font-style:italic" string="Copy"/>',
      })
    );
    expect(art?.textArt).toMatchObject({
      text: 'Copy',
      fontFamily: 'Arial',
      bold: true,
      italic: true,
      fillHex: '1F4E79',
      fillAlpha: 0.25,
      strokeHex: 'FF0000',
      strokeWidthPt: 1,
    });
  });

  test('markup outside the subset is refused rather than approximated', () => {
    const refused = [
      watermark({ children: '<v:fill type="gradient" color2="red"/>' }),
      watermark({ children: '<v:shadow on="t"/>' }),
      watermark({
        path: '<v:textpath style="font-family:Calibri;v-rotate-letters:t" string="X"/>',
      }),
      watermark({ path: '<v:textpath style="font-family:Calibri" string="two&#10;lines"/>' }),
      watermark({ path: '<v:textpath style="font-family:Calibri" string="   "/>' }),
      watermark({ children: '<v:fill opacity="2"/>' }),
      watermark({ style: STYLE.replace('rotation:315', 'rotation:x') }),
    ];
    for (const run of refused) expect(projected(run)).toEqual([]);
  });

  test('without a text art renderer, WordArt outside a watermark is refused', () => {
    const shape = (style: string) =>
      `<w:pict>${TEMPLATE}<v:shape id="title" type="#_x0000_t136" style="${style}" ` +
      'fillcolor="black"><v:textpath style="font-family:Cambria;font-size:24pt" ' +
      'string="Title"/></v:shape></w:pict>';
    // On the line it keeps the placeholder of a refused legacy drawing, which paints nothing.
    const [inline] = projected(shape('width:238.8pt;height:27.6pt'));
    expect(inline?.kind).toBe('inline');
    expect(inline?.textArt).toBeUndefined();
    expect(inline?.legacyGraphic).toBeUndefined();
    // Floating, it takes the refusal path of any drawing outside the subset.
    expect(projected(shape('position:absolute;width:238.8pt;height:27.6pt'))).toEqual([]);
  });

  test('rotation stays outside the subset for every other shape', () => {
    const rect =
      '<w:pict><v:rect style="position:absolute;width:72pt;height:36pt;rotation:30" fillcolor="red"/></w:pict>';
    expect(projected(rect)).toEqual([]);
  });

  test('rotation spellings normalise to clockwise degrees', () => {
    expect(legacyRotationDegrees('315')).toBe(315);
    expect(legacyRotationDegrees('-45')).toBe(315);
    expect(legacyRotationDegrees(`${90 * 65536}fd`)).toBe(90);
    expect(legacyRotationDegrees('nope')).toBeNaN();
  });
});

describe('VML picture colour adjustments', () => {
  const picture = (attributes: string) =>
    '<w:pict><v:shape id="WordPictureWatermark1" type="#_x0000_t75" ' +
    `style="${STYLE.replace('rotation:315;', '')}" o:allowincell="f">` +
    `<v:imagedata r:id="rId1" o:title="" ${attributes}/>` +
    '<w10:wrap anchorx="margin" anchory="margin"/></v:shape></w:pict>';

  test('washout gain and black level become picture brightness and contrast', () => {
    const [image] = projected(picture('gain="19661f" blacklevel="22938f"'));
    expect(image?.picture?.embeddedRelationshipId).toBe('rId1');
    expect(image?.effects.brightness).toBeCloseTo(70, 1);
    expect(image?.effects.contrast).toBeCloseTo(-70, 1);
    expect(image?.wrap).toBe('behind');
  });

  test('grayscale and black-and-white flags carry over', () => {
    const [image] = projected(picture('grayscale="t" bilevel="t"'));
    expect(image?.effects).toMatchObject({ grayscale: true, bilevel: 0.5 });
  });

  test('an unreadable adjustment refuses the picture', () => {
    expect(projected(picture('gain="lots"'))).toEqual([]);
    expect(projected(picture('blacklevel="3"'))).toEqual([]);
  });
});
