// An embedded OLE object (`w:object`) renders only its cached VML preview picture. The preview
// is a read-only drawing atom; the object XML, its relationship and its binary part are
// carried unchanged and are never resolved for rendering.

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { pictureIdsInSpans } from '../../automation/pictures.ts';
import {
  projectDrawingsInPackage,
  projectDrawingsInPart,
  type DrawingProjection,
} from '../package/drawing-projection.ts';
import { createImageResourceCache, liveDrawingReferenceCount } from '../package/image-resources.ts';
import { isLegacyVmlAtom } from '../package/legacy-vml-projection.ts';
import {
  readOoxmlPackage,
  withPart,
  writeOoxmlPackage,
  type OoxmlPackage,
} from '../package/ooxml-package.ts';
import {
  canonicalOoxmlFingerprint,
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlNode,
  type OoxmlPart,
  type OoxmlParagraphNode,
} from '../package/ooxml-tree.ts';
import { extractFragmentPackage } from '../store/clipboard-fragment-extract.ts';
import { paragraphLength, segmentsOf } from '../store/tree-op-segments.ts';
import { paragraphTextOf } from '../store/tree-ops.ts';
import { TreePackageStore } from '../store/tree-package-store.ts';
import { TreeDocumentStore } from '../store/tree-store.ts';
import { expectRefused } from './legacy-vml-refusal.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const V = 'urn:schemas-microsoft-com:vml';
const O = 'urn:schemas-microsoft-com:office:office';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
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
const WMF = new Uint8Array([0xd7, 0xcd, 0xc6, 0x9a, ...new Array(40).fill(0)]);
const OLE_BYTES = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 7, 7, 7, 7]);
const TEMPLATE =
  '<v:shapetype id="_x0000_t75" coordsize="21600,21600" o:spt="75" o:preferrelative="t" path="m@4@5l@4@11@9@11@9@5xe" filled="f" stroked="f"><v:stroke joinstyle="miter"/><v:formulas><v:f eqn="if lineDrawn pixelLineWidth 0"/><v:f eqn="sum @0 1 0"/><v:f eqn="sum 0 0 @1"/><v:f eqn="prod @2 1 2"/><v:f eqn="prod @3 21600 pixelWidth"/><v:f eqn="prod @3 21600 pixelHeight"/><v:f eqn="sum @0 0 1"/><v:f eqn="prod @6 1 2"/><v:f eqn="prod @7 21600 pixelWidth"/><v:f eqn="sum @8 21600 0"/><v:f eqn="prod @7 21600 pixelHeight"/><v:f eqn="sum @10 21600 0"/></v:formulas><v:path o:extrusionok="f" gradientshapeok="t" o:connecttype="rect"/><o:lock v:ext="edit" aspectratio="t"/></v:shapetype>';

interface ObjectOptions {
  readonly template?: boolean;
  readonly style?: string;
  readonly shapeExtra?: string;
  readonly shapeChildren?: string;
  readonly ole?: string | null;
  readonly objectAttributes?: string;
  readonly after?: string;
}

function embeddedObject(options: ObjectOptions = {}): string {
  const ole =
    options.ole === undefined
      ? '<o:OLEObject Type="Embed" ProgID="Package" ShapeID="_x0000_i1025" DrawAspect="Content" ObjectID="_1000000001" r:id="rOle"/>'
      : (options.ole ?? '');
  return (
    `<w:object w:dxaOrig="2000" w:dyaOrig="570"${options.objectAttributes ?? ''}>` +
    (options.template === false ? '' : TEMPLATE) +
    `<v:shape id="_x0000_i1025" type="#_x0000_t75" style="${options.style ?? 'width:100pt;height:28.5pt'}" o:ole="" fillcolor="window"${options.shapeExtra ?? ''}>` +
    `<v:imagedata r:id="rPreview" o:title=""/>${options.shapeChildren ?? ''}</v:shape>` +
    ole +
    (options.after ?? '') +
    '</w:object>'
  );
}

function documentXml(content: string): string {
  return `<w:document xmlns:w="${W}" xmlns:v="${V}" xmlns:o="${O}" xmlns:r="${R}" xmlns:w14="${W14}" xmlns:w10="${W10}"><w:body><w:p><w:r><w:t>A</w:t>${content}<w:t>Z</w:t></w:r></w:p></w:body></w:document>`;
}

function parse(content: string): OoxmlPart {
  const loaded = readOoxmlPart(documentXml(content), {
    name: '/word/document.xml',
    contentType: MAIN,
  });
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.part;
}

function packageOf(content: string, preview: 'png' | 'wmf' = 'png'): OoxmlPackage {
  const loaded = readOoxmlPackage(
    zipSync(
      {
        '[Content_Types].xml': strToU8(
          `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="wmf" ContentType="image/x-wmf"/><Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.oleObject"/><Override PartName="/word/document.xml" ContentType="${MAIN}"/></Types>`
        ),
        '_rels/.rels': strToU8(
          `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
        ),
        'word/document.xml': strToU8(documentXml(content)),
        'word/_rels/document.xml.rels': strToU8(
          `<Relationships xmlns="${REL}"><Relationship Id="rPreview" Type="${R}/image" Target="media/preview.${preview}"/><Relationship Id="rOle" Type="${R}/oleObject" Target="embeddings/oleObject1.bin"/></Relationships>`
        ),
        [`word/media/preview.${preview}`]: preview === 'png' ? PNG : WMF,
        'word/embeddings/oleObject1.bin': OLE_BYTES,
      },
      { level: 0 }
    )
  );
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.package;
}

function firstParagraph(part: OoxmlPart): OoxmlParagraphNode {
  const body = part.root.children.find((n) => n.kind !== 'textValue' && n.localName === 'body');
  if (!body || body.kind === 'textValue') throw new Error('missing body');
  const paragraph = body.children.find((n) => n.kind === 'paragraph');
  if (!paragraph || paragraph.kind !== 'paragraph') throw new Error('missing paragraph');
  return paragraph;
}

function objectIn(root: OoxmlNode): OoxmlNode | undefined {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.kind === 'textValue') continue;
    if (node.namespaceUri === W && node.localName === 'object') return node;
    for (const child of node.children) stack.push(child);
  }
  return undefined;
}

function onlyProjection(part: OoxmlPart): DrawingProjection {
  const projections = projectDrawingsInPart(part);
  expect(projections).toHaveLength(1);
  return projections[0]!;
}

describe('embedded object cached previews', () => {
  test('project the preview picture as one inline read-only atom', () => {
    for (const options of [
      {},
      { template: false },
      { ole: null },
      { objectAttributes: ' w14:anchorId="1A2B3C4D"' },
      { ole: '<o:OLEObject Type="Embed" ProgID="Package" DrawAspect="Icon" r:id="rOle"/>' },
      {
        ole: '<o:OLEObject Type="Embed" ProgID="Package" ShapeID="_x0000_i1025" DrawAspect="Content" ObjectID="_1" r:id="rOle"><o:FieldCodes>\\s</o:FieldCodes></o:OLEObject>',
      },
    ] satisfies ObjectOptions[]) {
      const part = parse(embeddedObject(options));
      const before = serializeOoxmlPart(part);
      const object = objectIn(part.root)!;
      expect(isLegacyVmlAtom(object)).toBe(true);
      const projection = onlyProjection(part);
      expect(projection).toMatchObject({
        drawingNodeId: object.id,
        kind: 'inline',
        wrap: 'inline',
        relationshipId: null,
        picture: null,
        groupPicture: null,
        vectorShape: null,
        extentEmu: { cx: 100 * 12700, cy: 28.5 * 12700 },
        locks: { select: true, move: true, resize: true, changeAspect: true },
      });
      // Only the preview relationship reaches the render slot. The embedded object's
      // relationship is not part of the projection.
      const fragments = projection.legacyGraphic!.fragments;
      expect(fragments).toHaveLength(1);
      expect(fragments[0]).toMatchObject({ relationshipId: 'rPreview' });
      expect(JSON.stringify(projection)).not.toContain('rOle');
      // One model unit between the two characters.
      const paragraph = firstParagraph(part);
      expect(paragraphLength(paragraph)).toBe(3);
      expect(segmentsOf(paragraph).find((s) => s.node.id === object.id)).toMatchObject({
        start: 1,
        end: 2,
      });
      expect(serializeOoxmlPart(part)).toBe(before);
    }
  });

  test('keep unsupported objects unpainted: opaque, or a placeholder that keeps the box', () => {
    const samples = [
      embeddedObject({
        ole: '<o:OLEObject Type="Link" ProgID="Package" ShapeID="_x0000_i1025" r:id="rOle"/>',
      }),
      embeddedObject({ ole: '<o:OLEObject Type="Embed" DrawAspect="Thumbnail" r:id="rOle"/>' }),
      embeddedObject({ ole: '<o:OLEObject Type="Embed" ShapeID="_x0000_i9999" r:id="rOle"/>' }),
      // The preview slot must never point at the embedded object's own relationship.
      embeddedObject({ ole: '<o:OLEObject Type="Embed" r:id="rPreview"/>' }),
      embeddedObject({ ole: '<o:OLEObject Type="Embed" UpdateMode="Always" r:id="rOle"/>' }),
      embeddedObject({
        ole: '<o:OLEObject Type="Embed" r:id="rOle"><o:FieldCodes><o:x/></o:FieldCodes></o:OLEObject>',
      }),
      embeddedObject({
        ole: `<o:OLEObject Type="Embed" r:id="rOle"><o:FieldCodes>${'x'.repeat(1025)}</o:FieldCodes></o:OLEObject>`,
      }),
      embeddedObject({
        after: '<w:control r:id="rOle" w:name="Control1" w:shapeid="_x0000_i1025"/>',
      }),
      embeddedObject({ after: '<o:OLEObject Type="Embed" r:id="rOle"/>' }),
      embeddedObject({
        after: '<v:shape id="second" type="#_x0000_t75" style="width:1pt;height:1pt"/>',
      }),
      embeddedObject({ after: 'loose text' }),
      embeddedObject({ objectAttributes: ' w:unknown="1"' }),
      embeddedObject({ objectAttributes: ' r:id="rOle"' }),
      embeddedObject().replace('w:dxaOrig="2000"', 'w:dxaOrig="-1"'),
      embeddedObject({ style: 'width:100pt;height:28.5pt;rotation:90' }),
      embeddedObject({
        shapeExtra: ' o:borderleftcolor="black"',
        shapeChildren:
          '<w10:borderleft type="single" width="8"/><w10:bordertop type="single" width="8"/><w10:borderright type="single" width="8"/><w10:borderbottom type="single" width="8"/>',
      }),
      embeddedObject({ shapeChildren: '<v:textbox/>' }),
      embeddedObject().replace('<v:imagedata r:id="rPreview" o:title=""/>', ''),
      embeddedObject().replace('r:id="rPreview"', 'o:href="https://example.invalid/preview.png"'),
      embeddedObject({ template: false }).replace('type="#_x0000_t75"', 'type="#_x0000_t202"'),
      embeddedObject().replace('o:spt="75"', 'o:spt="76"'),
      embeddedObject().replace('<v:shape ', '<v:rect ').replace('</v:shape>', '</v:rect>'),
    ];
    for (const sample of samples) {
      const part = parse(sample);
      const before = serializeOoxmlPart(part);
      // An object whose preview cannot paint keeps its box as a placeholder atom on the line;
      // an object without a readable preview stays opaque. Neither paints.
      const atom = isLegacyVmlAtom(objectIn(part.root)!);
      expectRefused(projectDrawingsInPart(part));
      expect(paragraphLength(firstParagraph(part))).toBe(atom ? 3 : 2);
      expect(serializeOoxmlPart(part)).toBe(before);
    }
  });

  test('show an ActiveX control by its preview picture and never read the control', () => {
    const control = '<w:control r:id="rOle" w:name="CheckBox1" w:shapeid="_x0000_i1025"/>';
    const part = parse(embeddedObject({ ole: control }));
    const [projection] = projectDrawingsInPart(part);
    expect(projection?.legacyGraphic?.soleImageRelationshipId).toBe('rPreview');
    // A control that names another shape keeps the object opaque.
    const other = parse(embeddedObject({ ole: control.replace('_x0000_i1025', '_x0000_i9') }));
    expect(isLegacyVmlAtom(objectIn(other.root)!)).toBe(false);
  });

  test('resolve only the preview image and report a metafile preview as unrenderable', async () => {
    for (const format of ['png', 'wmf'] as const) {
      const pkg = packageOf(embeddedObject(), format);
      const decoded: string[] = [];
      const lookup = createImageResourceCache(pkg, {
        decodePort: {
          async decode(_bytes, mime) {
            decoded.push(mime);
            return { pixelWidth: 1, pixelHeight: 1, dpiX: 96, dpiY: 96 };
          },
        },
      });
      try {
        const projection = projectDrawingsInPackage(pkg)[0]!;
        const state = await lookup.resolveForProjection(projection);
        if (format === 'png') {
          // The preview is one uncropped picture, so it resolves to that picture itself.
          expect(state).toMatchObject({ kind: 'ready', mime: 'image/png' });
          expect(decoded).toEqual(['image/png']);
        } else {
          // No metafile converter: an honest unsupported-format state, never a fake picture.
          expect(state).toMatchObject({
            kind: 'unrenderable',
            mime: 'image/x-wmf',
            reason: 'unsupported-format',
          });
          expect(decoded).toEqual([]);
        }
        expect(liveDrawingReferenceCount(pkg, `/word/media/preview.${format}`)).toBe(1);
        expect(liveDrawingReferenceCount(pkg, '/word/embeddings/oleObject1.bin')).toBe(0);
      } finally {
        lookup.dispose();
      }
    }
  });

  test('is not an editable picture and refuses picture operations', () => {
    const pkg = packageOf(embeddedObject());
    const store = new TreeDocumentStore(pkg.parts.get(pkg.mainDocumentPart)!);
    const paragraph = firstParagraph(store.part);
    const objectId = objectIn(paragraph)!.id;
    expect(
      pictureIdsInSpans(store.part, [{ paragraphId: paragraph.id, start: 0, end: 3 }])
    ).toEqual([]);
    for (const op of [
      { op: 'resizeDrawing', drawingNodeId: objectId, extentEmu: { cx: 12700, cy: 12700 } },
      { op: 'setDrawingMetadata', drawingNodeId: objectId, title: 't', description: 'd' },
      { op: 'replaceDrawingResource', drawingNodeId: objectId, relationshipId: 'rPreview' },
      { op: 'deleteDrawing', drawingNodeId: objectId },
    ] as const) {
      const before = serializeOoxmlPart(store.part);
      const result = store.transact((tx) => tx.apply(op));
      expect(result).toMatchObject({ ok: false, reason: 'not-a-drawing' });
      expect(serializeOoxmlPart(store.part)).toBe(before);
    }
  });

  test('text edits keep the object, and deleting its unit keeps the embedded part on save', () => {
    const pkg = packageOf(embeddedObject());
    const store = new TreeDocumentStore(pkg.parts.get(pkg.mainDocumentPart)!);
    const paragraphId = firstParagraph(store.part).id;
    const object = canonicalOoxmlFingerprint(objectIn(store.part.root)!);
    const typed = store.transact((tx) =>
      tx.apply({ op: 'insertText', paragraphId, offset: 2, text: 'b' })
    );
    expect(typed.ok).toBe(true);
    expect(paragraphTextOf(store.part, paragraphId)).toBe('A￼bZ');
    const kept = readOoxmlPackage(writeOoxmlPackage(withPart(pkg, store.part)));
    if (!kept.ok) throw new Error(kept.reason);
    expect(
      canonicalOoxmlFingerprint(
        objectIn(kept.package.parts.get(kept.package.mainDocumentPart)!.root)!
      )
    ).toBe(object);

    const deleted = store.transact((tx) =>
      tx.apply({ op: 'deleteText', paragraphId, start: 1, end: 2 })
    );
    expect(deleted.ok).toBe(true);
    expect(objectIn(store.part.root)).toBeUndefined();
    expect(paragraphTextOf(store.part, paragraphId)).toBe('AbZ');
    const saved = readOoxmlPackage(writeOoxmlPackage(withPart(pkg, store.part)));
    if (!saved.ok) throw new Error(saved.reason);
    // Removing the object from the text does not discard package parts.
    expect(saved.package.partBytes.get('/word/embeddings/oleObject1.bin')).toEqual(OLE_BYTES);
    expect(saved.package.partBytes.get('/word/media/preview.png')).toEqual(PNG);

    expect(store.undo()).not.toBeNull();
    expect(canonicalOoxmlFingerprint(objectIn(store.part.root)!)).toBe(object);
  });

  test('copy and paste refuse embedded objects without changing either package', () => {
    // The embedded part is not media, so it cannot travel with a fragment. The preview alone
    // is not the object: the whole w:object degrades away and the text survives.
    const bytes = writeOoxmlPackage(packageOf(embeddedObject()));
    const source = readOoxmlPackage(bytes);
    if (!source.ok) throw new Error(source.reason);
    const main = source.package.parts.get(source.package.mainDocumentPart)!;
    const paragraph = firstParagraph(main);
    const extracted = extractFragmentPackage(source.package, {
      partName: main.name,
      paragraphIds: [paragraph.id],
      startOffset: 0,
      endOffset: paragraphLength(paragraph),
      coveredParagraphIds: [paragraph.id],
      fullyCoveredBlockIds: [],
      lastMarkCovered: true,
    });
    expect(extracted).toEqual({ ok: false, reason: 'unsupported-content' });

    const target = readOoxmlPackage(
      zipSync({
        '[Content_Types].xml': strToU8(
          `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="${MAIN}"/></Types>`
        ),
        '_rels/.rels': strToU8(
          `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
        ),
        'word/document.xml': strToU8(
          `<w:document xmlns:w="${W}"><w:body><w:p/></w:body></w:document>`
        ),
      })
    );
    if (!target.ok) throw new Error(target.reason);
    const store = new TreePackageStore(
      target.package,
      target.package.parts.get(target.package.mainDocumentPart)!
    );
    const pasted = store.applyFragmentPaste(
      { kind: 'body' },
      {
        paragraphId: firstParagraph(store.currentPackage().parts.get('/word/document.xml')!).id,
        offset: 0,
        fragmentBytes: bytes,
        lastMarkCovered: true,
      }
    );
    expect(pasted.ok).toBe(false);
    if (!pasted.ok) expect(pasted.detail).toContain('unsupported-content');
    const after = store.currentPackage();
    const pastedXml = serializeOoxmlPart(after.parts.get(after.mainDocumentPart)!);
    expect(pastedXml).not.toContain('<w:t>A</w:t>');
    expect(pastedXml).not.toContain('w:object');
    expect(pastedXml).not.toContain('rOle');
    expect([...after.partBytes.keys()].some((name) => name.includes('/embeddings/'))).toBe(false);
  });
});

test('object-only and mixed cuts refuse before writing or deleting the source', async () => {
  const { buildCopyFlavours } = await import('../../editor/clipboard-copy-payload.ts');
  const { createClipboardHandlers } = await import('../../editor/surface-input.ts');
  for (const [startOffset, endOffset] of [
    [1, 2],
    [0, 3],
  ]) {
    const pkg = packageOf(embeddedObject());
    const part = pkg.parts.get(pkg.mainDocumentPart)!;
    const paragraph = firstParagraph(part);
    const before = canonicalOoxmlFingerprint(part.root);
    const flavours = buildCopyFlavours({
      text: 'A\uFFFCZ',
      cellRectangle: false,
      pkg,
      coverage: {
        partName: part.name,
        paragraphIds: [paragraph.id],
        startOffset: startOffset!,
        endOffset: endOffset!,
        coveredParagraphIds: [paragraph.id],
        fullyCoveredBlockIds: [],
        lastMarkCovered: false,
      },
    });
    expect(flavours.reason).toBe('unsupported-content');
    let prevented = false;
    const handlers = createClipboardHandlers({
      copyFlavours: () => flavours,
      editingMode: () => 'edit',
      activeScope: () => ({ kind: 'body' }),
      deleteSelection: () => {
        throw new Error('must not delete');
      },
    } as unknown as import('../../editor/paginated-surface-contract.ts').PaginatedSurface);
    handlers.onCut({
      clipboardData: {
        setData: () => {
          throw new Error('must not write');
        },
      },
      preventDefault: () => {
        prevented = true;
      },
    } as unknown as ClipboardEvent);
    expect(prevented).toBe(true);
    expect(canonicalOoxmlFingerprint(part.root)).toBe(before);
  }
});

test('object templates reject over-budget children before signature traversal', async () => {
  const { embeddedObjectPreview } = await import('../package/legacy-vml-object.ts');
  const object = objectIn(
    parse(embeddedObject()).root
  )! as import('../package/ooxml-tree.ts').OoxmlElement;
  const template = object.children.find(
    (node) => node.kind !== 'textValue' && node.localName === 'shapetype'
  )!;
  const unvisited = new Proxy(
    {},
    {
      get() {
        throw new Error('signature traversed rejected template');
      },
    }
  );
  const oversized = {
    ...template,
    children: Array(513).fill(unvisited),
  } as import('../package/ooxml-tree.ts').OoxmlElement;
  expect(
    embeddedObjectPreview({
      ...object,
      children: object.children.map((node) => (node === template ? oversized : node)),
    })
  ).toBeNull();
});

test('a same-document object move refuses and rolls back its preceding deletion', () => {
  const pkg = packageOf(embeddedObject());
  const part = pkg.parts.get(pkg.mainDocumentPart)!;
  const store = new TreePackageStore(pkg, part);
  const before = serializeOoxmlPart(store.currentPackage().parts.get(part.name)!);
  const paragraph = firstParagraph(part);
  const result = store.applyFragmentPaste(
    { kind: 'body' },
    {
      paragraphId: paragraph.id,
      offset: 0,
      fragmentBytes: writeOoxmlPackage(pkg),
      lastMarkCovered: false,
      priorOps: [{ op: 'deleteText', paragraphId: paragraph.id, start: 1, end: 2 }],
    }
  );
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.detail).toBe('fragment-merge:unsupported-content');
  expect(serializeOoxmlPart(store.currentPackage().parts.get(part.name)!)).toBe(before);
});

test('object templates reject oversized attributes before normalizing their strings', async () => {
  const { embeddedObjectPreview } = await import('../package/legacy-vml-object.ts');
  const object = objectIn(
    parse(embeddedObject()).root
  )! as import('../package/ooxml-tree.ts').OoxmlElement;
  const template = object.children.find(
    (node) => node.kind !== 'textValue' && node.localName === 'shapetype'
  )! as import('../package/ooxml-tree.ts').OoxmlElement;
  // A string stand-in exposes whether signature normalization runs after the size refusal.
  const value = {
    length: 8193,
    trim() {
      throw new Error('normalized an oversized attribute');
    },
  } as unknown as string;
  const oversized = {
    ...template,
    attributes: [
      ...template.attributes,
      { kind: 'genericExtension' as const, namespaceUri: '', localName: 'extra', value },
    ],
  };
  expect(
    embeddedObjectPreview({
      ...object,
      children: object.children.map((node) => (node === template ? oversized : node)),
    })
  ).toBeNull();
});

test('a closed rich-paste lane refuses object fragments without a plain fallback', async () => {
  const { routePaste } = await import('../../editor/clipboard-paste-router.ts');
  const { wrapInteropHtml } = await import('../../editor/clipboard-fragment-codec.ts');
  const html = wrapInteropHtml('<p>AZ</p>', {
    bytes: writeOoxmlPackage(packageOf(embeddedObject())),
    lastMarkCovered: true,
  });
  expect(
    routePaste(
      {
        richLaneOpen: false,
        pasteFragment: () => {
          throw new Error('rich lane is closed');
        },
        insertPlainText: () => {
          throw new Error('must not degrade');
        },
      },
      { html, text: 'AZ', forcePlain: false }
    )
  ).toBe('unsupported-content');
});
