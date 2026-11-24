import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createInlineDrawingLayoutBundle } from '../inline-drawing-source.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const V = 'urn:schemas-microsoft-com:vml';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const metadata = {
  name: '/word/document.xml',
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
};

function xml(layers: readonly number[]): string {
  const shapes = layers.map(
    (z) =>
      `<w:r><w:pict><v:rect id="layer${z}" style="position:absolute;left:20pt;top:10pt;width:40pt;height:20pt;z-index:${z}" fillcolor="#112233" stroked="f"/></w:pict></w:r>`
  );
  return `<w:document xmlns:w="${W}" xmlns:v="${V}"><w:body><w:p>${shapes.join('')}<w:r><w:t>Text</w:t></w:r></w:p></w:body></w:document>`;
}

function setup(layers: readonly number[]) {
  const loaded = readOoxmlPackage(
    zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="${metadata.name}" ContentType="${metadata.contentType}"/></Types>`
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(xml(layers)),
    })
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
        throw new Error('Vector rectangles need no raster decode');
      },
    },
    onResourcesChanged: () => {},
  });
  return {
    bundle,
    token: () => bundle.cacheTokenForPart(metadata.name),
    layout() {
      const before = serializeOoxmlPart(reader.part());
      const result = layoutSemanticDocument(reader.part(), revision, {
        measurer: createFixedMeasurer(6, 14),
        inlineDrawingLayout: bundle.bodyContext,
      });
      expect(serializeOoxmlPart(reader.part())).toBe(before);
      return result.pages[0]!.anchoredDrawings!;
    },
    replace(next: readonly number[]) {
      const parsed = readOoxmlPart(xml(next), metadata);
      if (!parsed.ok) throw new Error(parsed.reason);
      // Preserve byte/relationship/content-type identities, as a model-only edit does.
      pkg = Object.freeze({
        ...pkg,
        parts: new Map(pkg.parts).set(pkg.mainDocumentPart, parsed.part),
      });
      revision++;
      bundle.sync(reader);
    },
  };
}

test('same-rank VML layer changes invalidate the cached projection in both directions', () => {
  for (const pair of [
    [-2147483648, 0],
    [-1, 2147483647],
  ]) {
    for (const [before, after] of [pair, [...pair].reverse()]) {
      const harness = setup([before!]);
      try {
        const initial = harness.layout()[0]!;
        const token = harness.token();
        expect(initial.behindDocument).toBe(before! < 0);
        harness.replace([after!]);
        expect(harness.token()).not.toBe(token);
        const updated = harness.layout()[0]!;
        expect(updated.relativeHeight).toBe(initial.relativeHeight);
        expect(updated.behindDocument).toBe(after! < 0);
      } finally {
        harness.bundle.dispose();
      }
    }
  }
});

test('VML layout paints negative layers first and retains ascending order within each layer', () => {
  const harness = setup([2147483647, -1, 0, -2147483648]);
  try {
    expect(
      harness.layout().map(({ behindDocument, relativeHeight }) => ({
        behindDocument,
        relativeHeight,
      }))
    ).toEqual([
      { behindDocument: true, relativeHeight: 0 },
      { behindDocument: true, relativeHeight: 2147483647 },
      { behindDocument: false, relativeHeight: 0 },
      { behindDocument: false, relativeHeight: 2147483647 },
    ]);
  } finally {
    harness.bundle.dispose();
  }
});
