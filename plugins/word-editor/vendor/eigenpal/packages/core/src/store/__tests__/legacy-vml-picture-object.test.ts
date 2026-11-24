// A `w:pict` picture beside an `o:OLEObject` is the cached preview of an embedded object. It is
// a read-only drawing atom like a `w:object` preview. The object XML, its relationship and its
// binary part are carried unchanged and never resolved.

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createFixedMeasurer, layoutSemanticDocument } from '../../layout/semantic-layout.ts';
import { linesOf } from '../../layout/semantic-records.ts';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  indexInlineDrawingProjectionsInPart,
  projectDrawing,
  projectDrawingsInPackage,
  projectDrawingsInPart,
} from '../package/drawing-projection.ts';
import { liveDrawingReferenceCount } from '../package/image-resources.ts';
import { isLegacyVmlAtom } from '../package/legacy-vml-projection.ts';
import {
  readOoxmlPackage,
  writeOoxmlPackage,
  type OoxmlPackage,
} from '../package/ooxml-package.ts';
import {
  canonicalOoxmlFingerprint,
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { containsClipboardObject } from '../store/clipboard-object-policy.ts';
import { expectRefused } from './legacy-vml-refusal.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const V = 'urn:schemas-microsoft-com:vml';
const O = 'urn:schemas-microsoft-com:office:office';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const W10 = 'urn:schemas-microsoft-com:office:word';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const MAIN = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (c) => c.charCodeAt(0)
);
const OLE_BYTES = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 7, 7, 7, 7]);
const TEMPLATE =
  '<v:shapetype id="_x0000_t75" coordsize="21600,21600" o:spt="75" o:preferrelative="t" path="m@4@5l@4@11@9@11@9@5xe" filled="f" stroked="f"><v:stroke joinstyle="miter"/><v:formulas><v:f eqn="if lineDrawn pixelLineWidth 0"/><v:f eqn="sum @0 1 0"/><v:f eqn="sum 0 0 @1"/><v:f eqn="prod @2 1 2"/><v:f eqn="prod @3 21600 pixelWidth"/><v:f eqn="prod @3 21600 pixelHeight"/><v:f eqn="sum @0 0 1"/><v:f eqn="prod @6 1 2"/><v:f eqn="prod @7 21600 pixelWidth"/><v:f eqn="sum @8 21600 0"/><v:f eqn="prod @7 21600 pixelHeight"/><v:f eqn="sum @10 21600 0"/></v:formulas><v:path o:extrusionok="f" gradientshapeok="t" o:connecttype="rect"/><o:lock v:ext="edit" aspectratio="t"/></v:shapetype>';
const FLOATING =
  'position:absolute;margin-left:100pt;margin-top:-20pt;width:150pt;height:80pt;z-index:251658240';
const OLE =
  '<o:OLEObject Type="Embed" ProgID="Package" ShapeID="_x0000_s1026" DrawAspect="Content" ObjectID="_1" r:id="rOle"/>';

interface PictureOptions {
  readonly style?: string;
  readonly wrap?: string;
  readonly ole?: string;
  readonly shapeExtra?: string;
  readonly after?: string;
}

function picture(options: PictureOptions = {}): string {
  const wrap = options.wrap ?? '<w10:wrap type="topAndBottom"/>';
  return (
    `<w:pict>${TEMPLATE}` +
    `<v:shape id="_x0000_s1026" type="#_x0000_t75" style="${options.style ?? FLOATING}"${options.shapeExtra ?? ''}>` +
    `<v:imagedata r:id="rPreview" o:title=""/>${wrap}</v:shape>` +
    `${options.ole ?? OLE}${options.after ?? ''}</w:pict>`
  );
}

function documentXml(content: string): string {
  return `<w:document xmlns:w="${W}" xmlns:v="${V}" xmlns:o="${O}" xmlns:r="${R}" xmlns:w10="${W10}"><w:body><w:p><w:r>${content}</w:r></w:p><w:p><w:r><w:t>After</w:t></w:r></w:p></w:body></w:document>`;
}

function parse(content: string): OoxmlPart {
  const loaded = readOoxmlPart(documentXml(content), {
    name: '/word/document.xml',
    contentType: MAIN,
  });
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.part;
}

function packageOf(content: string): OoxmlPackage {
  const loaded = readOoxmlPackage(
    zipSync(
      {
        '[Content_Types].xml': strToU8(
          `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.oleObject"/><Override PartName="/word/document.xml" ContentType="${MAIN}"/></Types>`
        ),
        '_rels/.rels': strToU8(
          `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
        ),
        'word/document.xml': strToU8(documentXml(content)),
        'word/_rels/document.xml.rels': strToU8(
          `<Relationships xmlns="${REL}"><Relationship Id="rPreview" Type="${R}/image" Target="media/preview.png"/><Relationship Id="rOle" Type="${R}/oleObject" Target="embeddings/oleObject1.bin"/></Relationships>`
        ),
        'word/media/preview.png': PNG,
        'word/embeddings/oleObject1.bin': OLE_BYTES,
      },
      { level: 0 }
    )
  );
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.package;
}

function find(root: OoxmlNode, localName: string): OoxmlNode | undefined {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.kind === 'textValue') continue;
    if (node.namespaceUri === W && node.localName === localName) return node;
    for (const child of node.children) stack.push(child);
  }
  return undefined;
}

/** The top of each body line, laid out with the part's own drawing projections. */
function lineTops(part: OoxmlPart): number[] {
  const atoms = indexInlineDrawingProjectionsInPart(part);
  const layout = layoutSemanticDocument(part, 1, {
    measurer: createFixedMeasurer(6, 14),
    inlineDrawingLayout: {
      ownerPartName: part.name,
      projectionForAtom: (id) => atoms.get(id) ?? null,
      project: (node) =>
        atoms.get(node.id) ??
        projectDrawing(node, {
          ownerPartName: part.name,
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

describe('a picture with an embedded object beside it', () => {
  test('projects the picture as a read-only floating preview', () => {
    const part = parse(picture());
    const before = serializeOoxmlPart(part);
    const pict = find(part.root, 'pict')!;
    expect(isLegacyVmlAtom(pict)).toBe(true);
    const projections = projectDrawingsInPart(part);
    expect(projections).toHaveLength(1);
    const projection = projections[0]!;
    expect(projection).toMatchObject({
      drawingNodeId: pict.id,
      kind: 'anchored',
      wrap: 'topAndBottom',
      relationshipId: null,
      picture: null,
      groupPicture: null,
      extentEmu: { cx: 150 * 12700, cy: 80 * 12700 },
    });
    expect(projection.legacyGraphic!.fragments).toHaveLength(1);
    expect(projection.legacyGraphic!.fragments[0]).toMatchObject({ relationshipId: 'rPreview' });
    expect(projection.legacyGraphic!.soleImageRelationshipId).toBe('rPreview');
    expect(JSON.stringify(projection)).not.toContain('rOle');
    // A cropped preview stays a composite: the crop lives in the generated graphic.
    const cropped = projectDrawingsInPart(
      parse(picture().replace('o:title=""', 'o:title="" croptop="0.25"'))
    )[0]!;
    expect(cropped.legacyGraphic!.soleImageRelationshipId).toBeUndefined();
    // A sole preview picture keeps its colour adjustments, as a picture does.
    const adjusted = projectDrawingsInPart(
      parse(picture().replace('o:title=""', 'o:title="" gain="2147483647f" blacklevel="3932f"'))
    )[0]!;
    expect(adjusted.legacyGraphic!.soleImageRelationshipId).toBe('rPreview');
    // The largest gain is full contrast; the black level lifts by twice its fraction.
    expect(adjusted.effects.contrast).toBeCloseTo(100, 1);
    expect(adjusted.effects.brightness).toBeCloseTo(12, 1);
    expect(serializeOoxmlPart(part)).toBe(before);
  });

  test('reserves the same band as the picture alone', () => {
    const plain = lineTops(parse(picture({ ole: '' })));
    const object = lineTops(parse(picture()));
    expect(object).toEqual(plain);
    // The band ends at 60pt below the paragraph top: 80pt high, raised by 20pt.
    expect(object[0]).toBeGreaterThanOrEqual(60);
  });

  test('an inline preview stays inline', () => {
    const part = parse(picture({ style: 'width:150pt;height:80pt', wrap: '' }));
    expect(projectDrawingsInPart(part)[0]).toMatchObject({ kind: 'inline', wrap: 'inline' });
  });

  test('a saved source link keeps embedded pixels without becoming a resource target', () => {
    const xml = picture({ ole: '', style: 'width:150pt;height:80pt', wrap: '' }).replace(
      'r:id="rPreview"',
      'r:id="rPreview" r:href="rExternal"'
    );
    const part = parse(xml);
    const projection = projectDrawingsInPart(part)[0]!;
    expect(projection.picture).toMatchObject({
      embeddedRelationshipId: 'rPreview',
      linkedRelationshipId: null,
    });
    expect(projection.relationshipId).toBe('rPreview');
    expect(JSON.stringify(projection)).not.toContain('rExternal');
    expect(serializeOoxmlPart(part)).toContain('r:href="rExternal"');
    expectRefused(projectDrawingsInPart(parse(xml.replace('r:id="rPreview"', ''))));
  });

  test('never resolves the embedded part, and save keeps the object unchanged', () => {
    const pkg = packageOf(picture());
    expect(projectDrawingsInPackage(pkg)).toHaveLength(1);
    expect(liveDrawingReferenceCount(pkg, '/word/media/preview.png')).toBe(1);
    expect(liveDrawingReferenceCount(pkg, '/word/embeddings/oleObject1.bin')).toBe(0);
    const main = pkg.parts.get(pkg.mainDocumentPart)!;
    const saved = readOoxmlPackage(writeOoxmlPackage(pkg));
    if (!saved.ok) throw new Error(saved.reason);
    const reopened = saved.package.parts.get(saved.package.mainDocumentPart)!;
    expect(canonicalOoxmlFingerprint(reopened.root)).toBe(canonicalOoxmlFingerprint(main.root));
    expect(saved.package.partBytes.get('/word/embeddings/oleObject1.bin')).toEqual(OLE_BYTES);
  });

  test('cannot travel in a clipboard fragment', () => {
    expect(containsClipboardObject([parse(picture()).root])).toBe(true);
    expect(containsClipboardObject([parse(picture({ ole: '' })).root])).toBe(false);
  });

  test('keeps unsupported objects opaque', () => {
    const samples = [
      picture({ ole: OLE.replace(' ShapeID="_x0000_s1026"', '') }),
      picture({ ole: OLE.replace('_x0000_s1026', '_x0000_s9999') }),
      picture({ ole: OLE.replace('Type="Embed"', 'Type="Link"') }),
      picture({ ole: OLE.replace('DrawAspect="Content"', 'DrawAspect="Thumbnail"') }),
      picture({ ole: OLE.replace('r:id="rOle"', 'r:id="rPreview"') }),
      picture({ ole: OLE.replace('/>', ' UpdateMode="Always"/>') }),
      picture({ after: OLE }),
      picture({ after: '<v:rect style="width:10pt;height:10pt"/>' }),
      picture().replace('type="#_x0000_t75"', 'type="#_x0000_t202"'),
      picture({
        shapeExtra: ' o:borderleftcolor="black"',
        wrap: '<w10:borderleft type="single" width="8"/><w10:bordertop type="single" width="8"/><w10:borderright type="single" width="8"/><w10:borderbottom type="single" width="8"/>',
      }),
    ];
    for (const sample of samples) {
      const part = parse(sample);
      expect(isLegacyVmlAtom(find(part.root, 'pict')!)).toBe(false);
      expectRefused(projectDrawingsInPart(part));
    }
  });
});

test('a floating embedded object preview floats as its picture does', () => {
  const object =
    `<w:object w:dxaOrig="3000" w:dyaOrig="1600">${TEMPLATE}` +
    `<v:shape id="_x0000_s1026" type="#_x0000_t75" style="${FLOATING}" o:ole="">` +
    `<v:imagedata r:id="rPreview" o:title=""/><w10:wrap type="topAndBottom"/></v:shape>${OLE}</w:object>`;
  const part = parse(object);
  expect(projectDrawingsInPart(part)[0]).toMatchObject({
    drawingNodeId: find(part.root, 'object')!.id,
    kind: 'anchored',
    wrap: 'topAndBottom',
    picture: null,
  });
  expect(lineTops(part)).toEqual(lineTops(parse(picture())));
});
