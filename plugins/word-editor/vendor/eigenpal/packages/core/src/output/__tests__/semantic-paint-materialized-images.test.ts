import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createFixedMeasurer, layoutSemanticDocument } from '../../layout/semantic-layout.ts';
import { mockReadyImageResource } from '../../store/__tests__/drawing-ready-fixture.ts';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';
import { readOoxmlPart, WML_NAMESPACE_URI } from '../../store/package/ooxml-tree.ts';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import {
  createOwnedImageResourceLookup,
  type ImageResourceState,
} from '../../store/package/image-resources.ts';
import { paintSemanticLayout } from '../semantic-paint.ts';
import {
  collectUsedDrawingElementKeys,
  detachDrawingUrlRegistry,
  drawingUrlRegistryFor,
  type PaintImageUrlPort,
} from '../semantic-paint-drawings.ts';

const OWNER = '/word/document.xml';
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (value) => value.charCodeAt(0)
);

function fixture(shared = false, firstResource?: ImageResourceState) {
  const paragraphs = [0, 1, 2]
    .map(
      (index) =>
        `<w:p>${index ? '<w:pPr><w:pageBreakBefore/></w:pPr>' : ''}<w:r><w:drawing>` +
        '<wp:inline><wp:extent cx="914400" cy="457200"/>' +
        `<wp:docPr id="${index + 1}" name="Picture ${index + 1}"/>` +
        '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
        '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
        `<pic:blipFill><a:blip r:embed="rId${index}"/><a:stretch/></pic:blipFill>` +
        '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm>' +
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
        '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>'
    )
    .join('');
  const xml =
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" ` +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<w:body>${paragraphs}</w:body></w:document>`;
  const parsed = readOoxmlPart(xml, {
    name: OWNER,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  const resources = [0, 1, 2].map((index) =>
    mockReadyImageResource({
      bytes: PNG,
      partName: `/word/media/image${shared ? 0 : index}.png`,
    })
  );
  if (firstResource) resources[0] = firstResource;
  const layout = layoutSemanticDocument(parsed.part, 1, {
    measurer: createFixedMeasurer(6, 14),
    inlineDrawingLayout: {
      ownerPartName: OWNER,
      project: (node) =>
        projectDrawing(node, {
          ownerPartName: OWNER,
          limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
        }),
      resourceOf: (projection) => resources[Number(projection.relationshipId!.slice(3))]!,
    },
  });
  expect(layout.pages).toHaveLength(3);
  const created: string[] = [];
  const revoked: string[] = [];
  const port: PaintImageUrlPort = {
    create() {
      const url = `blob:public-image/${created.length}`;
      created.push(url);
      return url;
    },
    revoke(url) {
      revoked.push(url);
    },
  };
  const host = document.createElement('div');
  const registry = drawingUrlRegistryFor(host, port);
  const paint = (...indices: number[]) =>
    paintSemanticLayout(host, layout, {
      scale: 1,
      imageUrlPort: port,
      materialize: new Set(indices),
    });
  const image = (index: number) =>
    host.querySelector<HTMLImageElement>(`[data-page-index="${index}"] img`);
  const key = (index: number) =>
    [...collectUsedDrawingElementKeys({ ...layout, pages: [layout.pages[index]!] })][0]!;
  return { host, registry, layout, resources, created, revoked, port, paint, image, key, xml };
}

function packageFor(xml: string) {
  const rels =
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    [0, 1, 2]
      .map(
        (index) =>
          `<Relationship Id="rId${index}" ` +
          'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" ' +
          `Target="media/image${index}.png"/>`
      )
      .join('') +
    '</Relationships>';
  const types =
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="png" ContentType="image/png"/>' +
    '<Override PartName="/word/document.xml" ' +
    'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '</Types>';
  const loaded = readOoxmlPackage(
    zipSync({
      '[Content_Types].xml': strToU8(types),
      '_rels/.rels': strToU8(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" ' +
          'Target="word/document.xml"/></Relationships>'
      ),
      'word/document.xml': strToU8(xml),
      'word/_rels/document.xml.rels': strToU8(rels),
      'word/media/image0.png': PNG,
      'word/media/image1.png': PNG,
      'word/media/image2.png': PNG,
    })
  );
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.package;
}

describe('materialized drawing resource lifecycle', () => {
  test('page zero is painted without retaining unvisited image elements', () => {
    const f = fixture();
    f.paint(0);
    expect(f.image(0)).not.toBeNull();
    expect(f.image(1)).toBeNull();
    expect(f.created).toHaveLength(1);
    expect(f.registry.imageForPending!(f.key(1))).toBeNull();
    detachDrawingUrlRegistry(f.host);
  });

  test('leaving a page clears its image source and revokes its last URL', () => {
    const f = fixture();
    f.paint(0);
    const image = f.image(0)!;
    const url = image.getAttribute('src');
    f.paint(1);
    expect(image.hasAttribute('src')).toBe(false);
    expect(f.registry.imageForPending!(f.key(0))).toBeNull();
    expect(f.revoked).toEqual([url]);
    expect(f.image(1)).not.toBeNull();
    detachDrawingUrlRegistry(f.host);
  });

  test('a picture that goes pending keeps its retained image and URL', () => {
    const f = fixture();
    f.paint(0);
    const image = f.image(0)!;
    const url = image.getAttribute('src');
    const revalidating = fixture(false, {
      kind: 'pending',
      resourceKey: `embed:${OWNER}:rId0`,
    });
    paintSemanticLayout(f.host, revalidating.layout, {
      scale: 1,
      imageUrlPort: f.port,
      materialize: new Set([0]),
    });
    expect(f.image(0)).toBe(image);
    expect(image.getAttribute('src')).toBe(url);
    expect(f.revoked).toEqual([]);
    // Ready again: the same URL, so the picture does not load a second time.
    f.paint(0);
    expect(f.image(0)!.getAttribute('src')).toBe(url);
    expect(f.created).toHaveLength(1);
    detachDrawingUrlRegistry(f.host);
    detachDrawingUrlRegistry(revalidating.host);
  });

  test('revisiting creates a new image and URL with unchanged geometry', () => {
    const f = fixture();
    f.paint(0);
    const first = f.image(0)!;
    const firstURL = first.getAttribute('src');
    const dimensions = [first.style.width, first.style.height];
    f.paint(2);
    f.paint(0);
    const revisited = f.image(0)!;
    expect(revisited).not.toBe(first);
    expect(revisited.getAttribute('src')).not.toBe(firstURL);
    expect([revisited.style.width, revisited.style.height]).toEqual(dimensions);
    expect(f.created).toHaveLength(3);
    detachDrawingUrlRegistry(f.host);
  });

  test('a shared image URL survives while another materialized page uses it', () => {
    const f = fixture(true);
    f.paint(0, 1);
    const url = f.image(0)!.getAttribute('src');
    f.paint(1);
    expect(f.registry.imageForPending!(f.key(0))).toBeNull();
    expect(f.image(1)!.getAttribute('src')).toBe(url);
    expect(f.created).toHaveLength(1);
    expect(f.revoked).toEqual([]);
    f.paint();
    expect(f.revoked).toEqual([url]);
    detachDrawingUrlRegistry(f.host);
  });

  test('materialized selection pins keep their image during viewport changes', () => {
    const f = fixture();
    f.paint(0, 1);
    const pinned = f.image(0)!;
    f.paint(0, 2);
    expect(f.image(0)).toBe(pinned);
    expect(pinned.hasAttribute('src')).toBe(true);
    expect(f.registry.imageForPending!(f.key(1))).toBeNull();
    f.paint(2);
    expect(pinned.hasAttribute('src')).toBe(false);
    detachDrawingUrlRegistry(f.host);
  });

  test('viewport changes do not mutate the source layout or ready resources', () => {
    const f = fixture();
    const before = JSON.stringify({ layout: f.layout, resources: f.resources });
    for (const index of [0, 1, 2, 1, 0]) f.paint(index);
    expect(JSON.stringify({ layout: f.layout, resources: f.resources })).toBe(before);
    expect(f.registry.imageForPending!(f.key(1))).toBeNull();
    expect(f.registry.imageForPending!(f.key(2))).toBeNull();
    detachDrawingUrlRegistry(f.host);
  });

  test('disposing one painter leaves another owner image and URL alive', () => {
    const first = fixture();
    const peer = fixture();
    first.paint(0);
    peer.paint(0);
    const peerImage = peer.image(0)!;
    detachDrawingUrlRegistry(first.host);
    expect(first.revoked).toHaveLength(1);
    expect(peer.revoked).toHaveLength(0);
    expect(peerImage.hasAttribute('src')).toBe(true);
    expect(peer.registry.imageForPending!(peer.key(0))).toBe(peerImage);
    detachDrawingUrlRegistry(peer.host);
    expect(peer.revoked).toHaveLength(1);
    expect(peerImage.hasAttribute('src')).toBe(false);
  });

  test('a late decode from a disposed owner cannot remove its replacement cache or image', async () => {
    const first = fixture();
    const pkg = packageFor(first.xml);
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const oldCache = createOwnedImageResourceLookup(pkg, {
      decodePort: {
        decode: async () => {
          await gate;
          return { pixelWidth: 1, pixelHeight: 1, dpiX: 96, dpiY: 96 };
        },
      },
    });
    const pending = oldCache.resolveEmbedded(OWNER, 'rId0');
    const outcome = pending.then(
      () => 'published',
      (error) => String(error)
    );
    first.paint(0);
    const departedImage = first.image(0)!;
    first.paint(1);
    expect(departedImage.hasAttribute('src')).toBe(false);
    oldCache.dispose();
    detachDrawingUrlRegistry(first.host);

    const replacement = createOwnedImageResourceLookup(pkg, {
      decodePort: { decode: async () => ({ pixelWidth: 1, pixelHeight: 1, dpiX: 96, dpiY: 96 }) },
    });
    const ready = await replacement.resolveEmbedded(OWNER, 'rId0');
    expect(ready.kind).toBe('ready');
    const peer = fixture(false, ready);
    peer.paint(0);
    const peerImage = peer.image(0)!;
    const url = peerImage.getAttribute('src');
    finish();
    expect(await outcome).toContain('stale');
    expect(await replacement.resolveEmbedded(OWNER, 'rId0')).toBe(ready);
    expect(peer.registry.imageForPending!(peer.key(0))).toBe(peerImage);
    expect(peerImage.getAttribute('src')).toBe(url);
    expect(peer.revoked).toEqual([]);
    replacement.dispose();
    detachDrawingUrlRegistry(peer.host);
    expect(peerImage.hasAttribute('src')).toBe(false);
  });
});
