import { isLegacyPlaceholder } from '../../store/__tests__/legacy-vml-refusal.ts';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlPart,
  type OoxmlParagraphNode,
} from '../../store/package/ooxml-tree.ts';
import {
  createInlineDrawingLayoutBundle,
  drawingAtomIdentities,
} from '../inline-drawing-source.ts';
import {
  anchoredDrawingAtomsInParagraph,
  drawingModelOffsetsInParagraph,
  lineLayoutAtoms,
  type InlineDrawingLayoutContext,
} from '../drawing-layout.ts';
import { paragraphTextOf } from '../../store/store/tree-ops.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf } from '../semantic-records.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import {
  drawingRenderers,
  installDrawingRenderers,
} from '../../store/package/drawing-renderers.ts';
import { legacyTextArt } from '../../store/package/legacy-vml-text-art.ts';
import { MAX_INLINE_CONTAINER_DEPTH } from '../../store/package/ooxml-shared.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const V = 'urn:schemas-microsoft-com:vml';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const metadata = {
  name: '/word/document.xml',
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
};

// The fixture drawing is WordArt, which projects through an installed text art renderer; the
// engine's watermark reader stands in for it.
const installed = drawingRenderers().legacyTextArt;
beforeAll(() => installDrawingRenderers({ legacyTextArt }));
afterAll(() => installDrawingRenderers({ legacyTextArt: installed }));

function xml(text = 'Old', width = 120, floating = false): string {
  return `<w:document xmlns:w="${W}" xmlns:v="${V}"><w:body><w:p><w:r><w:t>A</w:t><w:pict><v:shape type="#_x0000_t136" style="width:${width}pt;height:30pt;${floating ? 'position:absolute;left:20pt;top:10pt;' : ''}" stroked="f"><v:textpath on="t" style="font-family:serif;font-size:24pt" string="${text}"/></v:shape></w:pict><w:t>Z</w:t></w:r></w:p></w:body></w:document>`;
}

function partOf(source: string): OoxmlPart {
  const loaded = readOoxmlPart(source, metadata);
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.part;
}

function paragraphOf(part: OoxmlPart): OoxmlParagraphNode {
  const body = part.root.children.find((n) => n.kind !== 'textValue' && n.localName === 'body');
  if (!body || body.kind === 'textValue') throw new Error('missing body');
  const paragraph = body.children.find((n) => n.kind === 'paragraph');
  if (!paragraph || paragraph.kind !== 'paragraph') throw new Error('missing paragraph');
  return paragraph;
}

/** The context with every picture a metafile preview the exporter draws itself. */
function withDrawablePreview(context: InlineDrawingLayoutContext): InlineDrawingLayoutContext {
  return {
    ...context,
    resourceOf: () => ({
      kind: 'unrenderable',
      partName: '/word/media/preview.wmf',
      mime: 'image/x-wmf',
      reason: 'unsupported-format',
    }),
  };
}

function setup(source = xml()) {
  const loaded = readOoxmlPackage(
    zipSync(
      {
        '[Content_Types].xml': strToU8(
          `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="${metadata.contentType}"/></Types>`
        ),
        '_rels/.rels': strToU8(
          `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
        ),
        'word/document.xml': strToU8(source),
      },
      { level: 0 }
    )
  );
  if (!loaded.ok) throw new Error(loaded.reason);
  let pkg = loaded.package;
  let revision = 0;
  const reader = {
    currentPackage: () => pkg,
    packageRevision: () => revision,
    part: () => pkg.parts.get(pkg.mainDocumentPart)!,
  };
  const bundle = createInlineDrawingLayoutBundle({
    session: reader,
    decodePort: {
      async decode() {
        throw new Error('WordArt has no raster media to decode');
      },
    },
    onResourcesChanged: () => {},
  });
  return {
    reader,
    bundle,
    setPart(part: OoxmlPart) {
      pkg = Object.freeze({ ...pkg, parts: new Map(pkg.parts).set(part.name, part) });
      revision++;
      bundle.sync(reader);
    },
    replace(source: string) {
      // Model-only change: preserve resource substrate identity, as a tree edit does.
      pkg = Object.freeze({
        ...pkg,
        parts: new Map(pkg.parts).set(pkg.mainDocumentPart, partOf(source)),
      });
      revision++;
      bundle.sync(reader);
    },
  };
}

test('lays out straight WordArt as one inline drawing between adjacent text offsets', () => {
  const { reader, bundle } = setup();
  try {
    expect(drawingAtomIdentities(reader.part())?.size).toBe(1);
    const result = layoutSemanticDocument(reader.part(), 1, {
      measurer: createFixedMeasurer(6, 14),
      inlineDrawingLayout: bundle.bodyContext,
    });
    const line = linesOf(result)[0]!;
    expect(lineLayoutAtoms(line).map((atom) => atom.kind)).toEqual([
      'text',
      'inlineDrawing',
      'text',
    ]);
    expect(line.drawings).toHaveLength(1);
    expect(line.drawings![0]).toMatchObject({ start: 1, width: 120, height: 30 });
    expect(line.range.end).toBe(3);
  } finally {
    bundle.dispose();
  }
});

test('discovers floating VML and reserves its model offset without an inline picture', () => {
  const { reader, bundle } = setup(xml('Floating', 120, true));
  try {
    const result = layoutSemanticDocument(reader.part(), 1, {
      measurer: createFixedMeasurer(6, 14),
      inlineDrawingLayout: bundle.bodyContext,
    });
    expect(result.pages[0]!.anchoredDrawings).toHaveLength(1);
    expect(result.pages[0]!.anchoredDrawings![0]).toMatchObject({ width: 120, height: 30 });
    expect(linesOf(result).flatMap((line) => line.drawings ?? [])).toHaveLength(0);
    expect(linesOf(result)[0]!.range.end).toBe(3);
  } finally {
    bundle.dispose();
  }
});

test('nested transparent wrappers preserve VML offsets after breaks and tabs', () => {
  for (const floating of [false, true]) {
    const source = xml('Wrapped', 120, floating)
      .replace('<w:p>', '<w:p><w:smartTag><w:customXml><w:dir w:val="ltr">')
      .replace('</w:p>', '</w:dir></w:customXml></w:smartTag></w:p>')
      .replace('<w:t>A</w:t>', '<w:t>A</w:t><w:br/><w:tab/><w:t>B</w:t>');
    const { reader, bundle } = setup(source);
    try {
      const paragraph = paragraphOf(reader.part());
      expect(paragraphTextOf(reader.part(), paragraph.id)).toBe('A\n\tB\uFFFCZ');
      expect([...drawingModelOffsetsInParagraph(paragraph).values()]).toEqual([4]);
      const result = layoutSemanticDocument(reader.part(), 1, {
        measurer: createFixedMeasurer(6, 14),
        inlineDrawingLayout: bundle.bodyContext,
      });
      const drawings = floating
        ? result.pages.flatMap((page) => page.anchoredDrawings ?? [])
        : linesOf(result).flatMap((line) => line.drawings ?? []);
      expect(drawings).toHaveLength(1);
      expect(drawings[0]).toMatchObject({ start: 4, width: 120, height: 30 });
      const trailing = linesOf(result)
        .flatMap((line) => line.spans)
        .find((span) => span.text === 'Z');
      expect(trailing?.range).toEqual({ paragraphId: paragraph.id, start: 5, end: 6 });
    } finally {
      bundle.dispose();
    }
  }
});

test('hidden VML anchors stay hidden inside transparent wrappers without losing offsets', () => {
  const source = xml('Hidden', 120, true)
    .replace('<w:r>', '<w:bdo w:val="ltr"><w:customXml><w:r><w:rPr><w:vanish/></w:rPr>')
    .replace('</w:r>', '</w:r></w:customXml></w:bdo><w:r><w:t>Tail</w:t></w:r>');
  const { reader, bundle } = setup(source);
  try {
    const paragraph = paragraphOf(reader.part());
    expect([...drawingModelOffsetsInParagraph(paragraph).values()]).toEqual([1]);
    expect(anchoredDrawingAtomsInParagraph(paragraph, bundle.bodyContext)).toHaveLength(0);
    const result = layoutSemanticDocument(reader.part(), 1, {
      measurer: createFixedMeasurer(6, 14),
      inlineDrawingLayout: bundle.bodyContext,
    });
    expect(result.pages.flatMap((page) => page.anchoredDrawings ?? [])).toHaveLength(0);
    const trailing = linesOf(result).flatMap((line) => line.spans);
    expect(trailing.map((span) => span.text).join('')).toBe('Tail');
    expect(trailing[0]?.range).toEqual({ paragraphId: paragraph.id, start: 3, end: 7 });
  } finally {
    bundle.dispose();
  }
});

test('VML anchor discovery and offsets honor the shared inline depth boundary', () => {
  for (const depth of [MAX_INLINE_CONTAINER_DEPTH - 1, MAX_INLINE_CONTAINER_DEPTH]) {
    const source = xml('Bounded', 120, true)
      .replace('<w:p>', `<w:p>${'<w:smartTag>'.repeat(depth)}`)
      .replace('</w:p>', `${'</w:smartTag>'.repeat(depth)}</w:p>`);
    const { reader, bundle } = setup(source);
    try {
      const paragraph = paragraphOf(reader.part());
      const admitted = depth < MAX_INLINE_CONTAINER_DEPTH;
      expect([...drawingModelOffsetsInParagraph(paragraph).values()]).toEqual(admitted ? [1] : []);
      expect(anchoredDrawingAtomsInParagraph(paragraph, bundle.bodyContext)).toHaveLength(
        admitted ? 1 : 0
      );
      const result = layoutSemanticDocument(reader.part(), 1, {
        measurer: createFixedMeasurer(6, 14),
        inlineDrawingLayout: bundle.bodyContext,
      });
      expect(result.pages.flatMap((page) => page.anchoredDrawings ?? [])).toHaveLength(
        admitted ? 1 : 0
      );
    } finally {
      bundle.dispose();
    }
  }
});

test('does not paint VML graphics in a hidden run', () => {
  for (const floating of [false, true]) {
    const { reader, bundle } = setup(
      xml('Hidden', 120, floating).replace('<w:r>', '<w:r><w:rPr><w:vanish/></w:rPr>')
    );
    try {
      const result = layoutSemanticDocument(reader.part(), 1, {
        measurer: createFixedMeasurer(6, 14),
        inlineDrawingLayout: bundle.bodyContext,
      });
      expect(linesOf(result).flatMap((line) => line.drawings ?? [])).toHaveLength(0);
      expect(result.pages.flatMap((page) => page.anchoredDrawings ?? [])).toHaveLength(0);
    } finally {
      bundle.dispose();
    }
  }
});

test('direct vanish suppresses VML anchors and preserves existing DrawingML behavior', () => {
  const wp = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
  const a = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const pic = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
  const modern = `<w:drawing xmlns:wp="${wp}" xmlns:a="${a}" xmlns:pic="${pic}" xmlns:r="${R}"><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="0" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>254000</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>127000</wp:posOffset></wp:positionV><wp:extent cx="1524000" cy="381000"/><wp:wrapSquare wrapText="bothSides"/><wp:docPr id="1" name="modern"/><a:graphic><a:graphicData uri="${pic}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="modern"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rPhoto"/></pic:blipFill><pic:spPr/></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing>`;
  const legacy = xml('Hidden', 120, true).match(/<w:pict>[\s\S]*?<\/w:pict>/)![0];
  for (const drawing of [legacy, modern]) {
    for (const [properties, hidden] of [
      ['<w:vanish/>', true],
      ['<w:vanish w:val="1"/>', true],
      ['<w:vanish w:val="0"/>', false],
      ['<w:vanish w:val="false"/>', false],
    ] as const) {
      const source = xml().replace(
        /<w:p>[\s\S]*?<\/w:p>/,
        `<w:p><w:r><w:t>A</w:t></w:r><w:r><w:rPr>${properties}</w:rPr>${drawing}</w:r><w:r><w:t>Z</w:t></w:r></w:p>`
      );
      const { reader, bundle } = setup(source);
      try {
        const before = serializeOoxmlPart(reader.part());
        const paragraph = paragraphOf(reader.part());
        expect(paragraphTextOf(reader.part(), paragraph.id)).toBe('A\uFFFCZ');
        expect([...drawingModelOffsetsInParagraph(paragraph).values()]).toEqual([1]);
        expect(anchoredDrawingAtomsInParagraph(paragraph, bundle.bodyContext)).toHaveLength(
          hidden && drawing === legacy ? 0 : 1
        );
        const result = layoutSemanticDocument(reader.part(), 1, {
          measurer: createFixedMeasurer(6, 14),
          inlineDrawingLayout: bundle.bodyContext,
        });
        expect(result.pages.flatMap((page) => page.anchoredDrawings ?? [])).toHaveLength(
          hidden && drawing === legacy ? 0 : 1
        );
        const trailing = linesOf(result)
          .flatMap((line) => line.spans)
          .find((span) => span.text === 'Z');
        expect(trailing?.range).toEqual({ paragraphId: paragraph.id, start: 2, end: 3 });
        expect(serializeOoxmlPart(reader.part())).toBe(before);
      } finally {
        bundle.dispose();
      }
    }
  }
});

test('model-only WordArt text and geometry edits invalidate the drawing cache and projection', () => {
  const { reader, bundle, replace } = setup();
  try {
    const token = () => bundle.drawingTokenForParagraph(paragraphOf(reader.part()), metadata.name);
    const projection = () => {
      const id = [...drawingAtomIdentities(reader.part())!.keys()][0]!;
      const value = bundle.bodyContext.projectionForAtom?.(id);
      if (!value) throw new Error('Expected drawing projection');
      return value;
    };
    // WordArt on the line projects its text for layout to fit, as floating WordArt does.
    expect(projection().textArt?.text).toBe('Old');
    const before = token();
    replace(xml('New'));
    expect(token()).not.toBe(before);
    expect(projection().textArt?.text).toBe('New');
    const afterText = token();
    replace(xml('New', 240));
    expect(token()).not.toBe(afterText);
    expect(projection().extentEmu.cx).toBe(240 * 12_700);
    const result = layoutSemanticDocument(reader.part(), 3, {
      measurer: createFixedMeasurer(6, 14),
      inlineDrawingLayout: bundle.bodyContext,
    });
    expect(linesOf(result)[0]!.drawings![0]!.width).toBe(240);
  } finally {
    bundle.dispose();
  }
});

test('an outlined VML picture reserves its picture size plus the outline on each side', () => {
  const O = 'urn:schemas-microsoft-com:office:office';
  const W10 = 'urn:schemas-microsoft-com:office:word';
  const shape = (sides: readonly string[]) =>
    `<w:document xmlns:w="${W}" xmlns:v="${V}" xmlns:o="${O}" xmlns:w10="${W10}" xmlns:r="${R}"><w:body><w:p><w:r><w:t>A</w:t><w:pict><v:shape type="#_x0000_t75" style="width:100pt;height:80pt"${sides.map((side) => ` o:border${side}color="black"`).join('')}><v:imagedata r:id="rPhoto" o:title=""/>${sides.map((side) => `<w10:border${side} type="single" width="8"/>`).join('')}</v:shape></w:pict><w:t>Z</w:t></w:r></w:p></w:body></w:document>`;
  const outlined = setup(shape(['top', 'left', 'bottom', 'right']));
  try {
    const result = layoutSemanticDocument(outlined.reader.part(), 1, {
      measurer: createFixedMeasurer(6, 14),
      inlineDrawingLayout: outlined.bundle.bodyContext,
    });
    const drawing = linesOf(result)[0]!.drawings![0]!;
    expect(drawing).toMatchObject({ start: 1, width: 102, height: 82 });
    expect(drawing.groupPicture).toBeDefined();
    expect(drawing.vectorShape?.components[0]?.strokeWidthEmu).toBe(12700);
  } finally {
    outlined.bundle.dispose();
  }
  // One side is not a supported outline: the drawing stays refused, not drawn without it. It
  // keeps its box on the line as a placeholder that paints nothing.
  const partial = setup(shape(['top']));
  try {
    const ids = [...(drawingAtomIdentities(partial.reader.part())?.keys() ?? [])];
    expect(ids).toHaveLength(1);
    expect(isLegacyPlaceholder(partial.bundle.bodyContext.projectionForAtom!(ids[0]!)!)).toBe(true);
  } finally {
    partial.bundle.dispose();
  }
});

test('an embedded object reserves its cached preview height, as the same w:pict does', () => {
  const O = 'urn:schemas-microsoft-com:office:office';
  const picture =
    '<v:shape id="_x0000_i1025" type="#_x0000_t75" style="width:100pt;height:28.5pt" o:ole=""><v:imagedata r:id="rPreview" o:title=""/></v:shape>';
  const ole = (type: string) =>
    `<o:OLEObject Type="${type}" ProgID="Package" ShapeID="_x0000_i1025" DrawAspect="Content" ObjectID="_1" r:id="rOle"/>`;
  const source = (wrapped: string) =>
    `<w:document xmlns:w="${W}" xmlns:v="${V}" xmlns:o="${O}" xmlns:r="${R}"><w:body><w:p><w:r><w:t>Before</w:t></w:r></w:p><w:p><w:r>${wrapped}</w:r></w:p><w:p><w:r><w:t>After</w:t></w:r></w:p></w:body></w:document>`;
  const lineTops = (wrapped: string) => {
    const { reader, bundle } = setup(source(wrapped));
    try {
      const result = layoutSemanticDocument(reader.part(), 1, {
        measurer: createFixedMeasurer(6, 14),
        inlineDrawingLayout: bundle.bodyContext,
      });
      const lines = linesOf(result);
      return {
        tops: lines.map((line) => line.box.y),
        drawings: lines.flatMap((line) => line.drawings ?? []),
      };
    } finally {
      bundle.dispose();
    }
  };
  const embedded = lineTops(
    `<w:object w:dxaOrig="2000" w:dyaOrig="570">${picture}${ole('Embed')}</w:object>`
  );
  const standalone = lineTops(`<w:pict>${picture.replace(' o:ole=""', '')}</w:pict>`);
  expect(embedded.drawings).toHaveLength(1);
  expect(embedded.drawings[0]).toMatchObject({ start: 0, width: 100, height: 28.5 });
  expect(embedded.tops).toEqual(standalone.tops);
  expect(embedded.tops[2]! - embedded.tops[1]!).toBeGreaterThanOrEqual(28.5);
  // A linked object stays opaque: its paragraph is one empty text line and paints nothing.
  const linked = lineTops(
    `<w:object w:dxaOrig="2000" w:dyaOrig="570">${picture}${ole('Link')}</w:object>`
  );
  expect(linked.drawings).toHaveLength(0);
  expect(linked.tops[2]! - linked.tops[1]!).toBe(linked.tops[1]! - linked.tops[0]!);
});

test('framed object previews keep atom offsets and draw out of the ordinary flow', async () => {
  const object =
    '<w:object><v:shape type="#_x0000_t75" style="width:52.5pt;height:56.25pt"><v:imagedata r:id="preview"/></v:shape></w:object>';
  const content = `<w:r><w:t>A</w:t>${object}<w:t>Z</w:t></w:r>`;
  const source = (framed: boolean) =>
    `<w:document xmlns:w="${W}" xmlns:v="${V}" xmlns:r="${R}"><w:body><w:p>${framed ? '<w:pPr><w:framePr w:vAnchor="text" w:y="-854"/></w:pPr>' : ''}${content}</w:p></w:body></w:document>`;
  const { reader, bundle, setPart } = setup(source(false));
  const { replaceNode, createNodeIdAllocator } = await import('../../store/package/ooxml-edit.ts');
  const { cloneWithNewIds } = await import('../../store/store/tree-op-nodes.ts');
  try {
    const paragraph = paragraphOf(reader.part());
    expect(paragraphTextOf(reader.part(), paragraph.id)).toBe('A\uFFFCZ');
    const atoms = drawingAtomIdentities(reader.part())!;
    const framedParagraph = paragraphOf(partOf(source(true)));
    const next = replaceNode(reader.part(), paragraph.id, {
      ...paragraph,
      children: [
        cloneWithNewIds(framedParagraph.children[0]!, createNodeIdAllocator(reader.part())),
        ...paragraph.children,
      ],
    } as OoxmlParagraphNode);
    if (!next.ok) throw new Error(JSON.stringify(next.issues));
    setPart(next.part);
    for (const [id, node] of atoms)
      expect(drawingAtomIdentities(reader.part())!.get(id)).toBe(node);
    const context = bundle.contextForPart(reader.part().name)!;
    const current = paragraphOf(reader.part());
    const layout = layoutSemanticDocument(reader.part(), 1, {
      measurer: createFixedMeasurer(6, 12),
      inlineDrawingLayout: withDrawablePreview(context),
    });
    expect(paragraphTextOf(reader.part(), current.id)).toBe('A\uFFFCZ');
    // The frame takes the paragraph out of the flow and draws the preview inside it.
    const fragment = layout.pages[0]!.fragments[0]!;
    expect(fragment.kind === 'paragraph' && fragment.positionedFrame).toBeTruthy();
    expect(linesOf(layout)[0]!.drawings).toHaveLength(1);
  } finally {
    bundle.dispose();
  }
});

test('inherited frame changes invalidate preview geometry without changing atom identity', () => {
  const source = `<w:document xmlns:w="${W}" xmlns:v="${V}" xmlns:r="${R}"><w:body><w:p><w:pPr><w:pStyle w:val="Child"/></w:pPr><w:r><w:t>A</w:t><w:object><v:shape type="#_x0000_t75" style="width:52.5pt;height:56.25pt"><v:imagedata r:id="preview"/></v:shape></w:object><w:t>Z</w:t></w:r></w:p></w:body></w:document>`;
  const { reader, bundle, setPart } = setup(source);
  const part = reader.part();
  const paragraph = paragraphOf(part);
  const atoms = drawingAtomIdentities(part)!;
  let styleCascade: ReturnType<typeof buildStyleCascadeTable> | undefined;
  const draw = () =>
    layoutSemanticDocument(reader.part(), 1, {
      measurer: createFixedMeasurer(6, 12),
      inlineDrawingLayout: withDrawablePreview(bundle.bodyContext),
      styleCascade,
    }).pages[0]!.fragments[0]!;
  const framed = () => {
    const fragment = draw();
    return fragment.kind === 'paragraph' && fragment.positionedFrame !== undefined;
  };
  try {
    expect(framed()).toBe(false);
    for (const frame of [true, false, true]) {
      const read = readOoxmlPart(
        `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="Child"><w:basedOn w:val="Base"/></w:style><w:style w:type="paragraph" w:styleId="Base"><w:pPr>${frame ? '<w:framePr w:y="-854" w:vAnchor="text"/>' : ''}</w:pPr></w:style></w:styles>`,
        {
          name: '/word/styles.xml',
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml',
        }
      );
      if (!read.ok) throw new Error(read.reason);
      setPart(read.part);
      styleCascade = buildStyleCascadeTable(read.part.root);
      expect(reader.part()).toBe(part);
      expect(drawingAtomIdentities(part)).toBe(atoms);
      expect(paragraphTextOf(part, paragraph.id)).toBe('A\uFFFCZ');
      expect(framed()).toBe(frame);
    }
  } finally {
    bundle.dispose();
  }
});
