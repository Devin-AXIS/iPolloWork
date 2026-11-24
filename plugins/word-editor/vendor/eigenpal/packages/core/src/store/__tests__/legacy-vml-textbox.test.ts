// Legacy VML text boxes (`v:textbox` → `w:txbxContent`) and the floating lines and rectangles
// around them project as drawing atoms that carry the text-box story.

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { projectDrawingsInPart, type DrawingProjection } from '../package/drawing-projection.ts';
import { readOoxmlPackage, writeOoxmlPackage } from '../package/ooxml-package.ts';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { textboxStoriesInPart } from '../package/textbox-stories.ts';
import { paragraphLength } from '../store/tree-op-segments.ts';
import { paragraphTextOf } from '../store/tree-ops.ts';
import { TreeDocumentStore } from '../store/tree-store.ts';
import { expectRefused } from './legacy-vml-refusal.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const V = 'urn:schemas-microsoft-com:vml';
const O = 'urn:schemas-microsoft-com:office:office';
const W10 = 'urn:schemas-microsoft-com:office:word';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const NS = `xmlns:w="${W}" xmlns:v="${V}" xmlns:o="${O}" xmlns:w10="${W10}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:wps="${WPS}" xmlns:mc="${MC}"`;
const EMU = 12_700;
const TEXTBOX_TEMPLATE =
  '<v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe">' +
  '<v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>';

const story = (text: string) =>
  `<w:txbxContent><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:txbxContent>`;

/** A floating rectangle text box, positioned against the page. */
function floatingBox(
  options: {
    text?: string;
    attributes?: string;
    style?: string;
    textbox?: string;
    children?: string;
  } = {}
): string {
  const style =
    options.style ??
    'position:absolute;left:0;text-align:left;margin-left:90pt;margin-top:120pt;width:144pt;height:36pt;' +
      'z-index:251659264;visibility:visible;mso-position-horizontal-relative:page;' +
      'mso-position-vertical-relative:page';
  return (
    `<w:pict><v:rect id="Box 1" o:spid="_x0000_s1026" style="${style}" ${options.attributes ?? 'fillcolor="#fc0"'}>` +
    `${options.children ?? ''}<v:textbox${options.textbox ?? ''}>${story(options.text ?? 'Inside')}</v:textbox>` +
    '</v:rect></w:pict>'
  );
}

/** A text box placed on the line, as a writer stores an inline shape. */
function inlineBox(text = 'Inline story'): string {
  return (
    `<w:pict>${TEXTBOX_TEMPLATE}<v:shape id="_x0000_s1027" type="#_x0000_t202" ` +
    'style="width:180pt;height:54pt;mso-left-percent:-10001;mso-top-percent:-10001;' +
    'mso-position-horizontal:absolute;mso-position-horizontal-relative:char;' +
    'mso-position-vertical:absolute;mso-position-vertical-relative:line;' +
    `mso-left-percent:-10001;mso-top-percent:-10001"><v:textbox>${story(text)}</v:textbox>` +
    '<w10:anchorlock/></v:shape></w:pict>'
  );
}

function parse(runContent: string): OoxmlPart {
  const xml = `<w:document ${NS}><w:body><w:p><w:r><w:t>A</w:t>${runContent}<w:t>Z</w:t></w:r></w:p></w:body></w:document>`;
  const loaded = readOoxmlPart(xml, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.part;
}

function only(part: OoxmlPart): DrawingProjection {
  const projections = projectDrawingsInPart(part);
  expect(projections).toHaveLength(1);
  return projections[0]!;
}

function textOf(node: OoxmlNode): string {
  return node.kind === 'textValue' ? node.value : node.children.map(textOf).join('');
}

function hostParagraph(part: OoxmlPart) {
  const body = part.root.children.find((n) => n.kind !== 'textValue' && n.localName === 'body');
  if (!body || body.kind === 'textValue') throw new Error('missing body');
  const paragraph = body.children.find((n) => n.kind === 'paragraph');
  if (!paragraph || paragraph.kind !== 'paragraph') throw new Error('missing paragraph');
  return paragraph;
}

describe('VML text box projection', () => {
  test('a floating rectangle carries its story, chrome, and page position', () => {
    const projection = only(parse(floatingBox()));
    expect(projection.kind).toBe('anchored');
    expect(projection.wrap).toBe('inFront');
    expect(projection.extentEmu).toEqual({ cx: 144 * EMU, cy: 36 * EMU });
    expect(projection.position?.horizontal).toEqual({
      relativeFrom: 'page',
      align: null,
      offsetEmu: 90 * EMU,
    });
    expect(projection.position?.vertical.offsetEmu).toBe(120 * EMU);
    expect(projection.legacyGraphic).toBeUndefined();
    const story = projection.textboxStory;
    expect(story).not.toBeNull();
    expect(story!.content.localName).toBe('txbxContent');
    // The default inner margins are 0.1 in left and right, 0.05 in top and bottom.
    expect(story!.insetsEmu).toEqual({ top: 45720, right: 91440, bottom: 45720, left: 91440 });
    expect(story!.fillHex).toBe('FFCC00');
    expect(story!.strokeHex).toBe('000000');
    expect(story!.strokeWidthEmu).toBe(0.75 * EMU);
    expect(story!.verticalAnchor).toBe('top');
  });

  test('inset, anchor, fit, and chrome overrides are read and bounded', () => {
    const projection = only(
      parse(
        floatingBox({
          attributes: 'filled="f" strokecolor="navy" strokeweight="2pt"',
          textbox: ' inset="0,1.44pt,,2mm" style="mso-fit-shape-to-text:t"',
          style:
            'position:absolute;margin-left:10pt;margin-top:10pt;width:100pt;height:50pt;z-index:-3;' +
            'v-text-anchor:middle',
        })
      )
    );
    const story = projection.textboxStory!;
    expect(story.insetsEmu).toEqual({
      top: Math.round(1.44 * EMU),
      right: 91440,
      bottom: Math.round((2 * 72 * EMU) / 25.4),
      left: 0,
    });
    expect(story.verticalAnchor).toBe('center');
    expect(story.autofit).toBe('shape');
    expect(story.fillHex).toBeNull();
    expect(story.strokeHex).toBe('000080');
    expect(story.strokeWidthEmu).toBe(2 * EMU);
    expect(projection.wrap).toBe('behind');
    expect(projection.anchor?.behindDocument).toBe(true);
  });

  test('a shape on the character and line positions lays out inline', () => {
    const part = parse(inlineBox());
    const projection = only(part);
    expect(projection.kind).toBe('inline');
    expect(projection.wrap).toBe('inline');
    expect(projection.position).toBeNull();
    expect(projection.extentEmu).toEqual({ cx: 180 * EMU, cy: 54 * EMU });
    expect(projection.textboxStory?.fillHex).toBe('FFFFFF');
    // The box is one model character of its host paragraph.
    expect(paragraphLength(hostParagraph(part))).toBe(3);
  });

  test('a rounded rectangle with text and aligned positions project', () => {
    const part = parse(
      '<w:pict><v:roundrect style="position:absolute;width:200pt;height:40pt;z-index:2;' +
        'mso-position-horizontal:center;mso-position-horizontal-relative:margin;' +
        'mso-position-vertical:bottom;mso-position-vertical-relative:page" arcsize="10923f" ' +
        'fillcolor="#a7bf38" strokecolor="#f2f2f2" strokeweight="3pt">' +
        '<v:shadow on="t" color="#4e6128" opacity=".5" offset="1pt"/>' +
        `<v:textbox>${story('Rounded')}</v:textbox><w10:wrap type="square" side="both"/></v:roundrect></w:pict>`
    );
    const projection = only(part);
    expect(projection.position?.horizontal).toEqual({
      relativeFrom: 'margin',
      align: 'center',
      offsetEmu: null,
    });
    expect(projection.position?.vertical).toEqual({
      relativeFrom: 'page',
      align: 'bottom',
      offsetEmu: null,
    });
    expect(projection.wrap).toBe('square');
    expect(projection.textboxStory?.fillHex).toBe('A7BF38');
    expect(projection.textboxStory?.strokeWidthEmu).toBe(3 * EMU);
  });

  test('search lists the story with its drawing atom and host paragraph', () => {
    const part = parse(floatingBox({ text: 'Findable' }));
    const stories = textboxStoriesInPart(part);
    expect(stories).toHaveLength(1);
    expect(stories[0]!.hostParagraphId).toBe(hostParagraph(part).id);
    expect(stories[0]!.root.localName).toBe('txbxContent');
    expect(stories[0]!.drawingNodeId).toBe(only(part).drawingNodeId);
  });

  test('a hidden shape offers no story to search', () => {
    const part = parse(
      floatingBox({
        style:
          'position:absolute;margin-left:0;margin-top:0;width:72pt;height:36pt;visibility:hidden',
      })
    );
    expect(only(part).hidden).toBe(true);
    expect(textboxStoriesInPart(part)).toEqual([]);
  });

  test('a large story does not count against the shape budget', () => {
    const paragraphs = Array.from(
      { length: 400 },
      (_, index) => `<w:p><w:r><w:t>Line ${index}</w:t></w:r></w:p>`
    ).join('');
    const part = parse(
      floatingBox().replace(story('Inside'), `<w:txbxContent>${paragraphs}</w:txbxContent>`)
    );
    expect(only(part).textboxStory).not.toBeNull();
  });
});

describe('drawings inside a VML text box story', () => {
  test('a nested modern drawing resolves under the namespaces the VML shape declares', () => {
    const nested =
      '<w:p><w:r><mc:AlternateContent><mc:Choice Requires="inner"><w:drawing><wp:inline>' +
      '<wp:extent cx="914400" cy="457200"/><wp:docPr id="5" name="Nested"/><a:graphic>' +
      '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr>' +
      '<pic:cNvPr id="5" name="Nested"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill>' +
      '<a:blip r:embed="rNested"/></pic:blipFill><pic:spPr/></pic:pic></a:graphicData></a:graphic>' +
      '</wp:inline></w:drawing></mc:Choice><mc:Fallback><w:t>fallback</w:t></mc:Fallback>' +
      '</mc:AlternateContent></w:r></w:p>';
    const part = parse(
      `<w:pict><v:rect xmlns:inner="${WPS}" style="position:absolute;width:200pt;height:100pt">` +
        `<v:textbox><w:txbxContent>${nested}</w:txbxContent></v:textbox></v:rect></w:pict>`
    );
    const projections = projectDrawingsInPart(part);
    expect(projections).toHaveLength(2);
    expect(projections[1]!.picture?.embeddedRelationshipId).toBe('rNested');
  });
});

describe('VML text box refusals', () => {
  const refused = (content: string) => expectRefused(projectDrawingsInPart(parse(content)));

  test('unknown children, an extrusion, and malformed insets refuse the shape', () => {
    refused(floatingBox({ children: '<o:extrusion v:ext="view" on="t"/>' }));
    refused(floatingBox({ children: '<v:imagedata r:id="rPhoto"/>' }));
    refused(floatingBox({ textbox: ' style="layout-flow:vertical-ideographic-alt"' }));
    refused(floatingBox({ textbox: ' inset="1e9pt,0,0,0"' }));
    refused(floatingBox({ textbox: ' inset="0,0,0,0,0"' }));
    refused(
      floatingBox().replace(
        `<v:textbox>${story('Inside')}</v:textbox>`,
        `<v:textbox>${story('One')}</v:textbox><v:textbox>${story('Two')}</v:textbox>`
      )
    );
    refused(
      floatingBox().replace('</w:txbxContent></v:textbox>', '</w:txbxContent><w:p/></v:textbox>')
    );
  });

  test('a text box on an open custom path is outside the subset', () => {
    refused(
      `<w:pict><v:shape style="position:absolute;width:72pt;height:72pt" path="m,l21600,21600e"><v:textbox>${story('X')}</v:textbox></v:shape></w:pict>`
    );
  });

  test('percentage positions stay refused', () => {
    refused(
      floatingBox({
        style: 'position:absolute;width:72pt;height:36pt;mso-left-percent:500',
      })
    );
  });

  test('a DrawingML choice wins over its VML fallback and paints once', () => {
    const choice =
      '<w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="1" ' +
      'behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/>' +
      '<wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
      '<wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
      '<wp:extent cx="1828800" cy="457200"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>' +
      '<wp:docPr id="1" name="Text Box 1"/><a:graphic><a:graphicData uri="' +
      WPS +
      '"><wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/>' +
      '<a:ext cx="1828800" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
      `</wps:spPr><wps:txbx>${story('Modern')}</wps:txbx><wps:bodyPr/></wps:wsp></a:graphicData>` +
      '</a:graphic></wp:anchor></w:drawing>';
    const part = parse(
      `<mc:AlternateContent><mc:Choice Requires="wps">${choice}</mc:Choice>` +
        `<mc:Fallback>${floatingBox({ text: 'Legacy' })}</mc:Fallback></mc:AlternateContent>`
    );
    const projection = only(part);
    expect(projection.legacyGraphic).toBeUndefined();
    expect(projection.docPrId).toBe(1);
    const stories = textboxStoriesInPart(part);
    expect(stories).toHaveLength(1);
    expect(textOf(stories[0]!.root)).toBe('Modern');
  });

  test('pictures keep their projection and word art needs its renderer', () => {
    const picture = only(
      parse(
        '<w:pict><v:shape style="width:72pt;height:36pt" type="#_x0000_t75"><v:imagedata r:id="rPhoto"/></v:shape></w:pict>'
      )
    );
    expect(picture.textboxStory).toBeNull();
    expect(picture.picture?.embeddedRelationshipId).toBe('rPhoto');
    // A floating text path outside a watermark needs the text art renderer; without it the
    // drawing is refused (the renderer's own tests cover its projection).
    const art = parse(
      '<w:pict><v:shape type="#_x0000_t136" style="position:absolute;width:300pt;height:60pt" ' +
        'fillcolor="silver" stroked="f"><v:textpath style="font-family:serif;font-size:1pt" ' +
        'string="Draft"/></v:shape></w:pict>'
    );
    expect(projectDrawingsInPart(art)).toEqual([]);
  });
});

describe('VML lines and rectangles', () => {
  test('a floating line spans its points and paints its arrowhead as a vector', () => {
    const projection = only(
      parse(
        '<w:pict><v:line style="position:absolute;left:0;text-align:left;z-index:5;visibility:visible" ' +
          'from="100pt,20pt" to="100pt,56pt"><v:stroke endarrow="block"/></v:line></w:pict>'
      )
    );
    expect(projection.kind).toBe('anchored');
    // A vertical line has no width, as a modern line can.
    expect(projection.extentEmu).toEqual({ cx: 0, cy: 36 * EMU });
    expect(projection.position?.horizontal.offsetEmu).toBe(100 * EMU);
    expect(projection.position?.vertical.offsetEmu).toBe(20 * EMU);
    expect(projection.legacyGraphic).toBeUndefined();
    const component = projection.vectorShape!.components[0]!;
    expect(component.subpathsEmu).toEqual([
      [
        { x: 0, y: 0 },
        { x: 0, y: 36 * EMU },
      ],
    ]);
    expect(component.subpathsClosed).toEqual([false]);
    expect(component.fillHex).toBeNull();
    expect(component.strokeHex).toBe('000000');
    expect(component.strokeWidthEmu).toBe(0.75 * EMU);
    // The block arrowhead at the end: three stroke widths long and wide.
    const length = 3 * 0.75 * EMU;
    expect(component.arrowheadsEmu).toEqual([
      [
        { x: 0, y: 36 * EMU },
        { x: length / 2, y: 36 * EMU - length },
        { x: -length / 2, y: 36 * EMU - length },
      ],
    ]);
  });

  test('a line drawn right to left keeps its direction and its open arrowhead', () => {
    const projection = only(
      parse(
        '<w:pict><v:line style="position:absolute;z-index:1" from="80pt,10pt" to="20pt,10pt" ' +
          'strokecolor="red" strokeweight="2pt"><v:stroke startarrow="open"/></v:line></w:pict>'
      )
    );
    expect(projection.position?.horizontal.offsetEmu).toBe(20 * EMU);
    const component = projection.vectorShape!.components[0]!;
    expect(component.subpathsEmu[0]).toEqual([
      { x: 60 * EMU, y: 0 },
      { x: 0, y: 0 },
    ]);
    expect(component.subpathsClosed).toEqual([false, false]);
    expect(component.subpathsEmu[1]![1]).toEqual({ x: 60 * EMU, y: 0 });
    expect(component.strokeHex).toBe('FF0000');
    expect(component.arrowheadsEmu).toBeUndefined();
  });

  test('a line without both points, or inline, stays refused', () => {
    for (const content of [
      '<w:pict><v:line style="position:absolute" from="0,0"/></w:pict>',
      '<w:pict><v:line style="width:10pt;height:10pt" from="0,0" to="10pt,10pt"/></w:pict>',
    ])
      expectRefused(projectDrawingsInPart(parse(content)));
  });

  test('a flip mirrors a line inside the box its points span', () => {
    const ends = (flip: string) =>
      only(
        parse(
          `<w:pict><v:line style="position:absolute;${flip}" from="0,0" to="100pt,50pt"/></w:pict>`
        )
      ).vectorShape!.components[0]!.subpathsEmu[0]!.map((p) => [p.x / 12_700, p.y / 12_700]);
    expect(ends('')).toEqual([
      [0, 0],
      [100, 50],
    ]);
    expect(ends('flip:x')).toEqual([
      [100, 0],
      [0, 50],
    ]);
    expect(ends('flip:y')).toEqual([
      [0, 50],
      [100, 0],
    ]);
  });

  test('a rectangle with short hex and named colors paints', () => {
    const projection = only(
      parse(
        '<w:pict><v:rect style="position:absolute;margin-left:0;margin-top:0;width:20pt;height:10pt;' +
          'text-align:center;mso-wrap-style:none;mso-width-relative:page;mso-height-relative:page" ' +
          'fillcolor="#339" strokecolor="yellow"/></w:pict>'
      )
    );
    // The outline's reach widens the drawing so the stroke stays inside its box.
    expect(projection.extentEmu).toEqual({ cx: 20.75 * EMU, cy: 10.75 * EMU });
    expect(projection.vectorShape?.extentEmu).toEqual({ cx: 20.75 * EMU, cy: 10.75 * EMU });
    expect(projection.position?.horizontal.offsetEmu).toBe(Math.round(-0.375 * EMU));
    expect(projection.vectorShape?.components[0]).toMatchObject({
      fillHex: '333399',
      strokeHex: 'FFFF00',
      strokeWidthEmu: 0.75 * EMU,
    });
    const xs = projection.vectorShape!.components[0]!.subpathsEmu.flat().map((p) => p.x);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([
      Math.round(0.375 * EMU),
      Math.round(20.375 * EMU),
    ]);
  });

  test('an arrow on a closed shape does not widen it', () => {
    const projection = only(
      parse(
        '<w:pict><v:oval style="position:absolute;margin-left:10pt;margin-top:10pt;width:40pt;height:20pt" ' +
          'strokeweight="2pt"><v:stroke endarrow="block"/></v:oval></w:pict>'
      )
    );
    expect(projection.extentEmu).toEqual({ cx: 42 * EMU, cy: 22 * EMU });
    expect(projection.position?.horizontal.offsetEmu).toBe(9 * EMU);
  });

  test('a plain rounded rectangle paints its corners', () => {
    const projection = only(
      parse(
        '<w:pict><v:roundrect style="width:40pt;height:20pt" arcsize="0.5" fillcolor="red"/></w:pict>'
      )
    );
    // The outline's reach widens the drawing so the stroke stays inside its box.
    expect(projection.extentEmu).toEqual({ cx: 40.75 * EMU, cy: 20.75 * EMU });
    const points = projection.vectorShape!.components[0]!.subpathsEmu.flat();
    // A 5pt corner radius: the top edge starts 5pt in from the left side.
    const top = points.filter((p) => Math.abs(p.y - 0.375 * EMU) <= 1).map((p) => p.x);
    expect(Math.abs(Math.min(...top) - 5.375 * EMU)).toBeLessThanOrEqual(1);
  });
});

describe('VML text box round trip', () => {
  test('save keeps the VML markup and its story unchanged', () => {
    const xml = `<w:document ${NS}><w:body><w:p><w:r>${floatingBox({ text: 'Keep me' })}</w:r></w:p><w:p><w:r>${inlineBox('Inline keep')}</w:r></w:p></w:body></w:document>`;
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(xml),
    });
    const loaded = readOoxmlPackage(bytes);
    if (!loaded.ok) throw new Error(loaded.reason);
    const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const before = serializeOoxmlPart(part);
    expect(projectDrawingsInPart(part)).toHaveLength(2);
    const reopened = readOoxmlPackage(writeOoxmlPackage(loaded.package));
    if (!reopened.ok) throw new Error(reopened.reason);
    const after = reopened.package.parts.get(reopened.package.mainDocumentPart)!;
    expect(serializeOoxmlPart(after)).toBe(before);
    expect(textboxStoriesInPart(after)).toHaveLength(2);
  });
});

describe('VML text box editing', () => {
  const styleOfShape = (part: OoxmlPart) =>
    serializeOoxmlPart(part).match(/<v:shape [^>]*style="([^"]*)"/)?.[1] ??
    serializeOoxmlPart(part).match(/<v:rect [^>]*style="([^"]*)"/)?.[1];

  test('story paragraphs take text edits, and the shape takes alt text but no link', () => {
    const store = new TreeDocumentStore(parse(floatingBox({ text: 'Inside' })));
    const [boxStory] = textboxStoriesInPart(store.part);
    const storyParagraph = boxStory!.root.children.find((node) => node.kind === 'paragraph')!;
    const typed = store.transact((tx) =>
      tx.apply({ op: 'insertText', paragraphId: storyParagraph.id, offset: 6, text: ' edited' })
    );
    expect(typed.ok).toBe(true);
    expect(paragraphTextOf(store.part, storyParagraph.id)).toBe('Inside edited');
    expect(serializeOoxmlPart(store.part)).toContain('<v:textbox><w:txbxContent>');
    const atom = boxStory!.drawingNodeId;
    const described = store.transact((tx) =>
      tx.apply({
        op: 'setDrawingMetadata',
        drawingNodeId: atom,
        title: 'T & "q"',
        description: 'd',
      })
    );
    expect(described.ok).toBe(true);
    expect(only(store.part)).toMatchObject({ title: 'T & "q"', description: 'd' });
    expect(serializeOoxmlPart(store.part)).toContain('title="T &amp; &quot;q&quot;"');
    const before = serializeOoxmlPart(store.part);
    const linked = store.transact((tx) =>
      tx.apply({
        op: 'setDrawingMetadata',
        drawingNodeId: atom,
        title: 't',
        description: 'd',
        hyperlink: 'https://example.com',
      })
    );
    expect(linked).toMatchObject({ ok: false, reason: 'packageTransactionRequired' });
    // An empty description removes the attribute instead of writing an empty one.
    expect(
      store.transact((tx) =>
        tx.apply({ op: 'setDrawingMetadata', drawingNodeId: atom, title: 't', description: '' })
      ).ok
    ).toBe(true);
    expect(serializeOoxmlPart(store.part)).not.toContain(' alt=');
    expect(before).toContain(' alt="d"');
  });

  test('a size below the written precision, and an offset without a mode, take the exact path', () => {
    const store = new TreeDocumentStore(parse(floatingBox({ text: 'Inside' })));
    const atom = textboxStoriesInPart(store.part)[0]!.drawingNodeId;
    const before = serializeOoxmlPart(store.part);
    expect(
      store.transact((tx) =>
        tx.apply({ op: 'resizeDrawing', drawingNodeId: atom, extentEmu: { cx: 60, cy: 12700 } })
      )
    ).toMatchObject({ ok: false, reason: 'invalid-drawing-value' });
    expect(serializeOoxmlPart(store.part)).toBe(before);
    expect(
      store.transact((tx) =>
        tx.apply({
          op: 'positionDrawing',
          drawingNodeId: atom,
          position: { horizontalEmu: 254000 } as never,
        })
      ).ok
    ).toBe(true);
    expect(only(store.part).position?.horizontal.offsetEmu).toBe(254000);
  });

  test('a zero percentage keeps a box resizable; a real one keeps its authored size', () => {
    const base =
      'position:absolute;margin-left:90pt;margin-top:0;width:144pt;height:36pt;z-index:1;';
    const zero = new TreeDocumentStore(
      parse(
        floatingBox({ text: 'Inside', style: base + 'mso-width-percent:0;mso-height-percent:0' })
      )
    );
    expect(only(zero.part).locks.resize).toBe(false);
    const real = new TreeDocumentStore(
      parse(
        floatingBox({
          text: 'Inside',
          style: base + 'mso-width-percent:400;mso-width-relative:margin',
        })
      )
    );
    expect(only(real.part).locks.resize).toBe(true);
  });

  test('a resize and a move rewrite only the geometry entries of the style', () => {
    const store = new TreeDocumentStore(parse(floatingBox({ text: 'Inside' })));
    const atom = textboxStoriesInPart(store.part)[0]!.drawingNodeId;
    expect(
      store.transact((tx) =>
        tx.apply({
          op: 'resizeDrawing',
          drawingNodeId: atom,
          extentEmu: { cx: 2540000, cy: 635000 },
        })
      ).ok
    ).toBe(true);
    expect(
      store.transact((tx) =>
        tx.apply({
          op: 'positionDrawing',
          drawingNodeId: atom,
          position: {
            mode: 'frame',
            horizontalEmu: 127000,
            verticalEmu: 1905000,
            relativeToV: 'margin',
          },
        })
      ).ok
    ).toBe(true);
    // `left:0` gives way to the written offset, which is the one the shape reads.
    expect(styleOfShape(store.part)).toBe(
      'position:absolute;text-align:left;margin-left:10pt;margin-top:150pt;width:200pt;height:50pt;' +
        'z-index:251659264;visibility:visible;mso-position-horizontal-relative:page;' +
        'mso-position-vertical-relative:margin'
    );
    const projection = only(store.part);
    expect(projection.extentEmu).toEqual({ cx: 2540000, cy: 635000 });
    expect(projection.position?.horizontal.offsetEmu).toBe(127000);
    expect(projection.position?.vertical).toMatchObject({
      relativeFrom: 'margin',
      offsetEmu: 1905000,
    });
  });

  test('a move replaces an aligned position with an offset', () => {
    const style =
      'position:absolute;margin-left:0;margin-top:0;width:144pt;height:36pt;z-index:1;' +
      'mso-position-horizontal:center;mso-position-horizontal-relative:page';
    const store = new TreeDocumentStore(parse(floatingBox({ text: 'Inside', style })));
    const atom = textboxStoriesInPart(store.part)[0]!.drawingNodeId;
    expect(only(store.part).position?.horizontal.align).toBe('center');
    const moved = store.transact((tx) =>
      tx.apply({
        op: 'positionDrawing',
        drawingNodeId: atom,
        position: { mode: 'frame', horizontalEmu: 254000 },
      })
    );
    expect(moved.ok).toBe(true);
    expect(only(store.part).position?.horizontal).toMatchObject({ align: null, offsetEmu: 254000 });
  });

  test('a delete removes the shape, and refusals leave the tree as it was', () => {
    for (const [style, op, reason] of [
      [
        undefined,
        { op: 'positionDrawing', position: { mode: 'simple', horizontalEmu: 0, verticalEmu: 0 } },
        'invalid-drawing-value',
      ],
      [
        undefined,
        { op: 'resizeDrawing', extentEmu: { cx: 0, cy: 12700 } },
        'invalid-drawing-value',
      ],
      [
        undefined,
        { op: 'positionDrawing', position: { mode: 'frame', relativeToH: 'insideMargin' } },
        'invalid-drawing-value',
      ],
      [
        'position:absolute;margin-left:90pt;margin-top:0;width:144pt;height:36pt;z-index:1;rotation:30',
        { op: 'resizeDrawing', extentEmu: { cx: 12700, cy: 12700 } },
        'drawing-locked',
      ],
      [
        'position:absolute;margin-left:90pt;margin-top:0;width:144pt;height:36pt;z-index:1;' +
          'mso-width-percent:500;mso-width-relative:page',
        { op: 'resizeDrawing', extentEmu: { cx: 12700, cy: 12700 } },
        'drawing-locked',
      ],
    ] as const) {
      const store = new TreeDocumentStore(
        parse(floatingBox({ text: 'Inside', ...(style ? { style } : {}) }))
      );
      const atom = textboxStoriesInPart(store.part)[0]!.drawingNodeId;
      const before = serializeOoxmlPart(store.part);
      const result = store.transact((tx) =>
        tx.apply({ ...op, drawingNodeId: atom } as Parameters<typeof tx.apply>[0])
      );
      expect(result).toMatchObject({ ok: false, reason });
      expect(serializeOoxmlPart(store.part)).toBe(before);
    }
    const inline = new TreeDocumentStore(parse(inlineBox()));
    const inlineAtom = textboxStoriesInPart(inline.part)[0]!.drawingNodeId;
    expect(
      inline.transact((tx) =>
        tx.apply({
          op: 'positionDrawing',
          drawingNodeId: inlineAtom,
          position: { mode: 'frame', horizontalEmu: 0 },
        })
      )
    ).toMatchObject({ ok: false, reason: 'drawing-locked' });
    expect(
      inline.transact((tx) =>
        tx.apply({
          op: 'resizeDrawing',
          drawingNodeId: inlineAtom,
          extentEmu: { cx: 1270000, cy: 635000 },
        })
      ).ok
    ).toBe(true);
    const store = new TreeDocumentStore(parse(floatingBox({ text: 'Inside' })));
    const atom = textboxStoriesInPart(store.part)[0]!.drawingNodeId;
    expect(store.transact((tx) => tx.apply({ op: 'deleteDrawing', drawingNodeId: atom })).ok).toBe(
      true
    );
    expect(serializeOoxmlPart(store.part)).not.toContain('v:textbox');
    expect(serializeOoxmlPart(store.part)).toContain('<w:t>A</w:t>');
  });
});
