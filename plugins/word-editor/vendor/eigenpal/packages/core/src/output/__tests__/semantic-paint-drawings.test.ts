// Drawing paint DOM contract (typed-drawings-and-images task 10).

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';
import type {
  ImageResourceState,
  ValidatedImageBytesHandle,
} from '../../store/package/image-resources.ts';
import { mockReadyImageResource } from '../../store/__tests__/drawing-ready-fixture.ts';
import {
  WML_NAMESPACE_URI,
  readOoxmlPart,
  type OoxmlDrawingNode,
  type OoxmlPart,
} from '../../store/package/ooxml-tree.ts';
import {
  buildInlineDrawingRecord,
  emuToPoints,
  type InlineDrawingRecord,
} from '../../layout/drawing-layout.ts';
import { computeDrawingGeometry } from '../../layout/drawing-geometry.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../../layout/semantic-layout.ts';
import { paintSemanticLayout } from '../semantic-paint.ts';
import {
  collectUsedDrawingElementKeys,
  collectUsedDrawingResourceKeys,
  DEFAULT_DRAWING_PAINT_STRINGS,
  detachDrawingUrlRegistry,
  drawingUrlRegistryFor,
  paintDrawingRecord,
  type PaintImageUrlPort,
} from '../semantic-paint-drawings.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const OWNER = '/word/document.xml';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const READY_PNG = mockReadyImageResource({
  bytes: PNG_BYTES,
  pixelWidth: 400,
  pixelHeight: 200,
});

function fakeUrlPort(): {
  readonly port: PaintImageUrlPort;
  readonly created: Map<string, string>;
  readonly revoked: string[];
} {
  const created = new Map<string, string>();
  const revoked: string[] = [];
  const port: PaintImageUrlPort = {
    create(handle, mime) {
      const url = `blob:fake/${mime}/${handle.resourceKey}`;
      created.set(handle.resourceKey, url);
      return url;
    },
    revoke(url) {
      revoked.push(url);
    },
  };
  return { port, created, revoked };
}

function inlinePictureXml(
  options: {
    readonly extent?: string;
    readonly descr?: string;
    readonly title?: string;
    readonly hidden?: boolean;
    readonly crop?: string;
    readonly rot?: string;
    readonly flipH?: boolean;
    readonly flipV?: boolean;
    readonly lum?: string;
    readonly grayscale?: boolean;
    readonly bilevel?: string;
    readonly preset?: string;
  } = {}
): string {
  const extent = options.extent ?? 'cx="914400" cy="457200"';
  const hidden = options.hidden ? ' hidden="1"' : '';
  const descr = options.descr !== undefined ? ` descr="${options.descr}"` : '';
  const title = options.title !== undefined ? ` title="${options.title}"` : '';
  const srcRect = options.crop ?? '';
  const rot = options.rot ? ` rot="${options.rot}"` : '';
  const flipH = options.flipH ? ' flipH="1"' : '';
  const flipV = options.flipV ? ' flipV="1"' : '';
  const lum = options.lum ?? '';
  const grayscale = options.grayscale ? '<a:grayscl/>' : '';
  const bilevel = options.bilevel === undefined ? '' : `<a:biLevel thresh="${options.bilevel}"/>`;
  const preset = options.preset ?? 'rect';
  return (
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    '<w:body><w:p><w:r><w:drawing>' +
    `<wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent ${extent}/>` +
    `<wp:docPr id="1" name="Picture 1"${descr}${title}${hidden}/>` +
    '<wp:cNvGraphicFramePr/>' +
    `<a:graphic><a:graphicData uri="${PIC_URI}">` +
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
    `<pic:blipFill><a:blip r:embed="rId14">${bilevel}${grayscale}${lum}</a:blip><a:srcRect ${srcRect}/>` +
    `<a:stretch/></pic:blipFill>` +
    `<pic:spPr><a:xfrm${rot}${flipH}${flipV}><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm>` +
    `<a:prstGeom prst="${preset}"><a:avLst/></a:prstGeom></pic:spPr>` +
    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>'
  );
}

function load(xml: string): OoxmlPart {
  const result = readOoxmlPart(xml, {
    name: OWNER,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function drawingOf(part: OoxmlPart): OoxmlDrawingNode {
  const stack: import('../../store/package/ooxml-tree.ts').OoxmlElement[] = [part.root];
  while (stack.length > 0) {
    const node = stack.shift()!;
    if (node.kind === 'drawing') return node;
    for (const child of node.children) {
      if (child.kind !== 'textValue') stack.push(child);
    }
  }
  throw new Error('missing drawing');
}

function readyRecordFromXml(
  xml: string,
  resource: ImageResourceState = READY_PNG
): InlineDrawingRecord {
  const part = load(xml);
  const projection = projectDrawing(drawingOf(part), {
    ownerPartName: OWNER,
    limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
  })!;
  const width = emuToPoints(projection.extentEmu.cx);
  const height = emuToPoints(projection.extentEmu.cy);
  return buildInlineDrawingRecord({
    input: {
      drawingNodeId: projection.drawingNodeId,
      ownerPartName: OWNER,
      projection,
      resource,
    },
    paragraphId: 'p1',
    start: 0,
    slotX: 0,
    y: 0,
    baseline: height,
    contentLeft: 0,
    contentRight: 600,
  });
}

function paintRecord(
  drawing: InlineDrawingRecord,
  port: PaintImageUrlPort | undefined
): HTMLElement {
  const { port: urlPort, created } = fakeUrlPort();
  const usePort = port ?? urlPort;
  const registry = {
    urlForReady: (
      handle: ValidatedImageBytesHandle,
      mime: 'image/png' | 'image/jpeg' | 'image/gif'
    ) => usePort.create(handle, mime),
    reconcile: () => {},
    revokeAll: () => {},
  };
  return paintDrawingRecord(
    document,
    drawing,
    {
      scale: 1,
      strings: DEFAULT_DRAWING_PAINT_STRINGS,
      ...(usePort ? { imageUrlPort: usePort } : {}),
    },
    registry,
    Object.freeze({ x: 0, y: 0, width: 600, height: 800 })
  )!;
}

describe('paints validated raster records', () => {
  test('ready PNG receives a host object URL and authored dimensions', () => {
    const { port, created } = fakeUrlPort();
    const drawing = readyRecordFromXml(inlinePictureXml());
    const element = paintRecord(drawing, port);
    expect(element.classList.contains('docx-drawing-ready')).toBe(true);
    const img = element.querySelector('img.docx-drawing-image') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toBe(created.get(READY_PNG.resourceKey));
    expect(element.style.width).toBe(`${drawing.paintBounds.width}px`);
    expect(element.style.height).toBe(`${drawing.paintBounds.height}px`);
  });

  test('reuses the same object URL for the same resource key', () => {
    const { port, created } = fakeUrlPort();
    const drawing = readyRecordFromXml(inlinePictureXml());
    const first = paintRecord(drawing, port);
    const second = paintRecord(drawing, port);
    const url = created.get(READY_PNG.resourceKey);
    expect(first.querySelector('img')!.getAttribute('src')).toBe(url);
    expect(second.querySelector('img')!.getAttribute('src')).toBe(url);
    expect(created.size).toBe(1);
  });

  test('applies rotation through outer clip and matrix on transform stage', () => {
    const drawing = readyRecordFromXml(
      inlinePictureXml({ rot: '5400000', flipH: true, flipV: true })
    );
    const element = paintRecord(drawing, fakeUrlPort().port);
    expect(element.style.clipPath).toMatch(/^polygon\(/);
    const frame = element.querySelector('.docx-drawing-image-frame') as HTMLElement;
    expect(frame.style.transform).toBe('');
    expect(frame.style.clipPath).toBe('');
    const stage = element.querySelector('.docx-drawing-transform-stage') as HTMLElement;
    expect(stage.style.transform).toMatch(/^matrix\(/);
    const img = element.querySelector('img') as HTMLImageElement;
    expect(img.style.transform).toBe('');
  });

  test('applies srcRect crop through image sizing', () => {
    const drawing = readyRecordFromXml(
      inlinePictureXml({ crop: 'l="25000" t="10000" r="25000" b="10000"' })
    );
    const element = paintRecord(drawing, fakeUrlPort().port);
    const img = element.querySelector('img') as HTMLImageElement;
    expect(img.style.width).toBe('200%');
    expect(img.style.height).toBe('125%');
    expect(img.style.left).toBe('-50%');
    expect(img.style.top).toBe('-12.5%');
    expect(img.style.position).toBe('absolute');
  });

  test('applies ellipse preset clip path on outer wrapper', () => {
    const drawing = readyRecordFromXml(inlinePictureXml({ preset: 'ellipse' }));
    const element = paintRecord(drawing, fakeUrlPort().port);
    expect(element.style.clipPath).toMatch(/^polygon\(/);
    const frame = element.querySelector('.docx-drawing-image-frame') as HTMLElement;
    expect(frame.style.clipPath).toBe('');
  });

  test('applies lum and grayscale as CSS filter', () => {
    const drawing = readyRecordFromXml(
      inlinePictureXml({
        lum: '<a:lum bright="-40000" contrast="-70000"/>',
        grayscale: true,
      })
    );
    const element = paintRecord(drawing, fakeUrlPort().port);
    const frame = element.querySelector('.docx-drawing-image-frame') as HTMLElement;
    expect(frame.style.filter).toBe('grayscale(1) contrast(0.625) brightness(0.48)');
  });

  test('washout lum keeps a white background white', () => {
    const drawing = readyRecordFromXml(
      inlinePictureXml({ lum: '<a:lum bright="70001" contrast="-70000"/>' })
    );
    const element = paintRecord(drawing, fakeUrlPort().port);
    const frame = element.querySelector('.docx-drawing-image-frame') as HTMLElement;
    // contrast() first keeps white inside [0, 1]; brightness() then lifts it back to 1.
    expect(frame.style.filter).toBe('contrast(0.157067) brightness(1.910013)');
  });

  test('uses descr for aria-label and never name', () => {
    const drawing = readyRecordFromXml(
      inlinePictureXml({ descr: 'Company logo', title: 'Logo title' })
    );
    const element = paintRecord(drawing, fakeUrlPort().port);
    expect(element.getAttribute('role')).toBe('img');
    expect(element.getAttribute('aria-label')).toBe('Company logo');
  });

  test('falls back to title when descr is absent', () => {
    const drawing = readyRecordFromXml(inlinePictureXml({ title: 'Banner title' }));
    const element = paintRecord(drawing, fakeUrlPort().port);
    expect(element.getAttribute('aria-label')).toBe('Banner title');
  });

  test('decorative drawing is aria-hidden', () => {
    const drawing = readyRecordFromXml(inlinePictureXml());
    const element = paintRecord(drawing, fakeUrlPort().port);
    expect(element.getAttribute('aria-hidden')).toBe('true');
  });

  test('hidden drawing paints nothing', () => {
    const drawing = readyRecordFromXml(inlinePictureXml({ hidden: true }));
    const element = paintDrawingRecord(
      document,
      drawing,
      { scale: 1, strings: DEFAULT_DRAWING_PAINT_STRINGS, imageUrlPort: fakeUrlPort().port },
      null
    );
    expect(element).toBeNull();
  });

  test('a reused ready element scrubs the revision marking once the decision resolves', () => {
    const { port } = fakeUrlPort();
    const registry = drawingUrlRegistryFor(document.createElement('div'), port);
    const untracked = readyRecordFromXml(inlinePictureXml());
    const tracked: InlineDrawingRecord = Object.freeze({
      ...untracked,
      revisions: Object.freeze([{ kind: 'delete' as const, id: '9', author: 'Bob', nodeId: 'n9' }]),
    });
    const ctx = {
      scale: 1,
      strings: DEFAULT_DRAWING_PAINT_STRINGS,
      imageUrlPort: port,
      paintInstance: 'p0',
    };
    const origin = Object.freeze({ x: 0, y: 0, width: 600, height: 800 });
    const first = paintDrawingRecord(document, tracked, ctx, registry, origin)!;
    expect(first.classList.contains('docx-drawing--revision-deletion')).toBe(true);
    expect(first.dataset.revisionKind).toBe('delete');
    // Same drawing, decision resolved: identical paint signature, so the registry hands the
    // SAME element back — the marking must be scrubbed, not left to a rebuild.
    const second = paintDrawingRecord(document, untracked, ctx, registry, origin)!;
    expect(second).toBe(first);
    expect(second.classList.contains('docx-drawing--revision')).toBe(false);
    expect(second.classList.contains('docx-drawing--revision-deletion')).toBe(false);
    expect(second.dataset.revisionKind).toBeUndefined();
    expect(second.dataset.revisionId).toBeUndefined();
    expect(second.dataset.reviewAuthor).toBeUndefined();
  });

  test('validates bilevel thresholds and paints a bounded alpha-preserving filter', () => {
    for (const value of ['0', '25000', '50000', '100000']) {
      const record = readyRecordFromXml(inlinePictureXml({ bilevel: value }));
      expect(record.effects.bilevel).toBe(Number(value) / 100_000);
      const painted = paintRecord(record, fakeUrlPort().port);
      expect(painted.querySelector('filter')?.getAttribute('color-interpolation-filters')).toBe(
        'sRGB'
      );
      expect(painted.querySelectorAll('feFuncA')).toHaveLength(0);
      expect(painted.querySelectorAll('feComponentTransfer')).toHaveLength(1);
      const table = painted
        .querySelector('feFuncR')!
        .getAttribute('tableValues')!
        .split(' ')
        .map(Number);
      expect(table).toHaveLength(256);
      expect(
        table.every((v, index) => v === (index / 255 >= Number(value) / 100_000 ? 1 : 0))
      ).toBe(true);
    }
    for (const value of ['', '-1', '100001', 'NaN', 'Infinity', '0.5', 'url(x)']) {
      const record = readyRecordFromXml(inlinePictureXml({ bilevel: value }));
      expect(record.effects.bilevel).toBeUndefined();
      expect(paintRecord(record, fakeUrlPort().port).querySelector('filter')).toBeNull();
    }
  });

  test('changing or removing bilevel invalidates a retained paint frame', () => {
    const { port } = fakeUrlPort();
    const registry = drawingUrlRegistryFor(document.createElement('div'), port);
    const ctx = { scale: 1, strings: DEFAULT_DRAWING_PAINT_STRINGS, imageUrlPort: port };
    const firstRecord = readyRecordFromXml(
      inlinePictureXml({
        bilevel: '50000',
        grayscale: true,
        lum: '<a:lum bright="-30000" contrast="66000"/>',
      })
    );
    const first = paintDrawingRecord(document, firstRecord, ctx, registry)!;
    const id = first.querySelector('filter')!.id;
    expect(paintDrawingRecord(document, firstRecord, ctx, registry)).toBe(first);
    expect(first.querySelector('filter')!.id).toBe(id);
    const second = paintDrawingRecord(
      document,
      readyRecordFromXml(inlinePictureXml({ bilevel: '75000' })),
      ctx,
      registry
    )!;
    expect(second).toBe(first);
    expect(second.querySelector('filter')!.id).not.toBe(id);
    expect(
      second
        .querySelector('feFuncR')!
        .getAttribute('tableValues')!
        .split(' ')
        .filter((v) => v === '1')
    ).toHaveLength(64);
    const third = paintDrawingRecord(
      document,
      readyRecordFromXml(inlinePictureXml()),
      ctx,
      registry
    )!;
    expect(third).toBe(first);
    expect(third.querySelector('filter')).toBeNull();
    expect(third.querySelector<HTMLElement>('.docx-drawing-image-frame')!.style.filter).toBe('');
    registry.revokeAll();
  });
});

describe('paints non-fetching refusal cards', () => {
  test('unsupported TIFF never calls the URL port or assigns src', () => {
    const { port, created } = fakeUrlPort();
    const projection = projectDrawing(drawingOf(load(inlinePictureXml())), {
      ownerPartName: OWNER,
      limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    })!;
    const drawing = buildInlineDrawingRecord({
      input: {
        drawingNodeId: projection.drawingNodeId,
        ownerPartName: OWNER,
        projection,
        resource: Object.freeze({
          kind: 'unrenderable',
          partName: '/word/media/x.tif',
          mime: 'image/tiff',
          reason: 'unsupported-format',
        }),
      },
      paragraphId: 'p1',
      start: 0,
      slotX: 0,
      y: 0,
      baseline: 50,
      contentLeft: 0,
      contentRight: 600,
    });
    const element = paintDrawingRecord(
      document,
      drawing,
      { scale: 1, strings: DEFAULT_DRAWING_PAINT_STRINGS, imageUrlPort: port },
      null
    )!;
    expect(element.classList.contains('docx-drawing-placeholder')).toBe(true);
    expect(element.querySelector('img')).toBeNull();
    expect(created.size).toBe(0);
    expect(element.textContent).toBe('Unsupported image format (TIFF)');
    expect(element.innerHTML).not.toContain('tif');
  });

  test('external relationship paints localized card without fetch', () => {
    const drawing = buildInlineDrawingRecord({
      input: {
        drawingNodeId: 'd-ext',
        ownerPartName: OWNER,
        projection: projectDrawing(drawingOf(load(inlinePictureXml())), {
          ownerPartName: OWNER,
          limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
        })!,
        resource: Object.freeze({
          kind: 'external',
          relationshipId: 'rId99',
          sinkSafe: true,
        }),
      },
      paragraphId: 'p1',
      start: 0,
      slotX: 0,
      y: 0,
      baseline: 50,
      contentLeft: 0,
      contentRight: 600,
    });
    const element = paintDrawingRecord(
      document,
      drawing,
      { scale: 1, strings: DEFAULT_DRAWING_PAINT_STRINGS },
      null
    )!;
    expect(element.textContent).toBe('External image not loaded');
    expect(element.querySelector('img')).toBeNull();
  });

  test('pending resource paints loading placeholder without URL port call', () => {
    const { port, created } = fakeUrlPort();
    const drawing = buildInlineDrawingRecord({
      input: {
        drawingNodeId: 'd-pending',
        ownerPartName: OWNER,
        projection: projectDrawing(drawingOf(load(inlinePictureXml())), {
          ownerPartName: OWNER,
          limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
        })!,
        resource: Object.freeze({ kind: 'pending', resourceKey: 'pending-key' }),
      },
      paragraphId: 'p1',
      start: 0,
      slotX: 0,
      y: 0,
      baseline: 50,
      contentLeft: 0,
      contentRight: 600,
    });
    paintDrawingRecord(
      document,
      drawing,
      { scale: 1, strings: DEFAULT_DRAWING_PAINT_STRINGS, imageUrlPort: port },
      null
    );
    expect(created.size).toBe(0);
  });

  test('non-picture graphic reserves extent with honest label', () => {
    const chartXml =
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:r="${R}">` +
      '<w:body><w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
      '<wp:extent cx="914400" cy="457200"/><wp:docPr id="2" name="Chart 1"/>' +
      '<wp:cNvGraphicFramePr/>' +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">' +
      '<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"/>' +
      '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>';
    const part = load(chartXml);
    const projection = projectDrawing(drawingOf(part), {
      ownerPartName: OWNER,
      limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    })!;
    const drawing = buildInlineDrawingRecord({
      input: {
        drawingNodeId: projection.drawingNodeId,
        ownerPartName: OWNER,
        projection,
        resource: Object.freeze({
          kind: 'unrenderable',
          partName: null,
          mime: 'unknown',
          reason: 'non-picture-graphic',
        }),
      },
      paragraphId: 'p1',
      start: 0,
      slotX: 0,
      y: 0,
      baseline: 50,
      contentLeft: 0,
      contentRight: 600,
    });
    const element = paintDrawingRecord(
      document,
      drawing,
      { scale: 1, strings: DEFAULT_DRAWING_PAINT_STRINGS },
      null
    )!;
    expect(element.style.width).toBe(`${drawing.paintBounds.width}px`);
    expect(element.textContent).toBe('Chart not shown');
  });

  test('placeholder labels name each kind through the translated catalog', async () => {
    const en = (await import('../../../../i18n/en.json')).default as {
      image: { placeholder: Record<string, string> };
    };
    const { drawingPaintStringsFromTranslate } = await import('../drawing-paint-strings.ts');
    const translated = drawingPaintStringsFromTranslate((key) => {
      const [, group, kind] = key.split('.');
      return group === 'placeholder' ? (en.image.placeholder[kind!] ?? key) : key;
    });
    const kinds = ['chart', 'diagram', 'shape', 'group', 'textbox', 'canvas', 'graphic'] as const;
    for (const kind of kinds) {
      expect(en.image.placeholder[kind]).toBeString();
      expect(translated.nonPictureGraphic(kind)).toBe(en.image.placeholder[kind]!);
      expect(DEFAULT_DRAWING_PAINT_STRINGS.nonPictureGraphic(kind)).toBe(
        en.image.placeholder[kind]!
      );
    }
    expect(translated.nonPictureGraphic('unknown')).toBe(en.image.placeholder.graphic!);
    expect(en.image.placeholder.chart).toBe('Chart not shown');
  });
});

describe('paintSemanticLayout drawing integration', () => {
  test('inline drawing appears in painted line when layout publishes it', () => {
    const part = load(inlinePictureXml());
    const layout = layoutSemanticDocument(part, 1, {
      measurer: createFixedMeasurer(6, 14),
      inlineDrawingLayout: {
        ownerPartName: OWNER,
        project: (node) =>
          projectDrawing(node, {
            ownerPartName: OWNER,
            limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
          }),
        resourceOf: () => READY_PNG,
      },
    });
    const { port } = fakeUrlPort();
    const container = document.createElement('div');
    paintSemanticLayout(container, layout, { scale: 1, imageUrlPort: port, ariaHidden: false });
    expect(
      container.querySelector('.docx-drawing-ready, .docx-drawing-placeholder')
    ).not.toBeNull();
  });

  test('reserves inline flow width between text before and after a drawing', () => {
    const xml = inlinePictureXml()
      .replace('<w:body><w:p>', '<w:body><w:p><w:r><w:t>A</w:t></w:r>')
      .replace('</w:p></w:body>', '<w:r><w:t>B</w:t></w:r></w:p></w:body>');
    const part = load(xml);
    const layout = layoutSemanticDocument(part, 1, {
      measurer: createFixedMeasurer(6, 14),
      inlineDrawingLayout: {
        ownerPartName: OWNER,
        project: (node) =>
          projectDrawing(node, {
            ownerPartName: OWNER,
            limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
          }),
        resourceOf: () => READY_PNG,
      },
    });
    const { port } = fakeUrlPort();
    const container = document.createElement('div');

    paintSemanticLayout(container, layout, { scale: 1, imageUrlPort: port, ariaHidden: false });

    const line = container.querySelector('.layout-line')!;
    const flow = [...line.children].filter(
      (element) =>
        element.classList.contains('layout-run-text') ||
        element.classList.contains('docx-inline-drawing-advance')
    );
    expect(flow.map((element) => element.className)).toEqual([
      'layout-run layout-run-text',
      'docx-inline-drawing-advance',
      'layout-run layout-run-text',
    ]);
    expect((flow[1] as HTMLElement).style.width).toBe(`${emuToPoints(914400)}px`);
    expect((flow[1] as HTMLElement).style.height).toBe(`${emuToPoints(457200)}px`);
    expect((line as HTMLElement).style.wordSpacing).toBe('');
  });

  test('a repaint reuses the same <img> element, so the decode survives a keystroke', () => {
    const part = load(inlinePictureXml());
    const layoutWith = (revision: number, resource: typeof READY_PNG | ImageResourceState) =>
      layoutSemanticDocument(part, revision, {
        measurer: createFixedMeasurer(6, 14),
        inlineDrawingLayout: {
          ownerPartName: OWNER,
          project: (node) =>
            projectDrawing(node, {
              ownerPartName: OWNER,
              limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
            }),
          resourceOf: () => resource,
        },
      });
    const layout = layoutWith(1, READY_PNG);
    const { port } = fakeUrlPort();
    const container = document.createElement('div');
    paintSemanticLayout(container, layout, { scale: 1, imageUrlPort: port, ariaHidden: false });
    const first = container.querySelector('img.docx-drawing-image');
    const firstReady = first?.closest('.docx-drawing-ready');
    const firstFrame = first?.closest('.docx-drawing-image-frame');
    expect(first).not.toBeNull();
    expect(firstReady).not.toBeNull();
    expect(firstFrame).not.toBeNull();
    const firstSrc = first!.getAttribute('src');
    paintSemanticLayout(container, layoutWith(2, READY_PNG), {
      scale: 1,
      imageUrlPort: port,
      ariaHidden: false,
    });
    const second = container.querySelector('img.docx-drawing-image');
    const secondReady = second?.closest('.docx-drawing-ready');
    expect(second).toBe(first as never);
    expect(secondReady).toBe(firstReady as never);
    expect(second?.closest('.docx-drawing-image-frame')).toBe(firstFrame as never);
    expect(second!.getAttribute('src')).toBe(firstSrc as never);
  });

  test('an unchanged repaint leaves the decoded image subtree untouched', () => {
    const part = load(inlinePictureXml());
    const layout = layoutSemanticDocument(part, 1, {
      measurer: createFixedMeasurer(6, 14),
      inlineDrawingLayout: {
        ownerPartName: OWNER,
        project: (node) =>
          projectDrawing(node, {
            ownerPartName: OWNER,
            limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
          }),
        resourceOf: () => READY_PNG,
      },
    });
    const { port } = fakeUrlPort();
    const container = document.createElement('div');
    paintSemanticLayout(container, layout, { scale: 1, imageUrlPort: port, ariaHidden: false });
    const firstFrame = container.querySelector('.docx-drawing-image-frame');
    expect(firstFrame).not.toBeNull();

    paintSemanticLayout(container, layout, { scale: 1, imageUrlPort: port, ariaHidden: false });

    expect(container.querySelector('.docx-drawing-image-frame')).toBe(firstFrame as never);
  });

  test('keeps the decoded image visible while a text revision revalidates its resource', () => {
    const part = load(inlinePictureXml());
    const layoutWith = (revision: number, resource: ImageResourceState) =>
      layoutSemanticDocument(part, revision, {
        measurer: createFixedMeasurer(6, 14),
        inlineDrawingLayout: {
          ownerPartName: OWNER,
          project: (node) =>
            projectDrawing(node, {
              ownerPartName: OWNER,
              limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
            }),
          resourceOf: () => resource,
        },
      });
    const ready = layoutWith(1, READY_PNG);
    const pending = layoutWith(
      2,
      Object.freeze({ kind: 'pending', resourceKey: 'revalidating-after-text-edit' })
    );
    const { port } = fakeUrlPort();
    const container = document.createElement('div');
    paintSemanticLayout(container, ready, { scale: 1, imageUrlPort: port, ariaHidden: false });
    const decoded = container.querySelector('img.docx-drawing-image');

    paintSemanticLayout(container, pending, { scale: 1, imageUrlPort: port, ariaHidden: false });

    expect(container.querySelector('img.docx-drawing-image')).toBe(decoded as never);
    expect(container.querySelector('.docx-drawing-placeholder')).toBeNull();
  });
});

describe('URL port lifecycle', () => {
  test('revokes URLs when resource keys drop out of layout', () => {
    const { port, revoked } = fakeUrlPort();
    const container = document.createElement('div');
    const drawing = readyRecordFromXml(inlinePictureXml());
    const geometry = computeDrawingGeometry({
      extentWidth: drawing.width,
      extentHeight: drawing.height,
      anchorX: 0,
      anchorY: 0,
      effectExtentEmu: { top: 0, right: 0, bottom: 0, left: 0 },
      crop: { left: 0, top: 0, right: 0, bottom: 0 },
      transform: drawing.transform,
      presetGeometry: 'rect',
    });
    void geometry;
    const layout = {
      revision: 1,
      pages: [
        Object.freeze({
          index: 0,
          box: Object.freeze({ x: 0, y: 0, width: 600, height: 800 }),
          contentBox: Object.freeze({ x: 0, y: 0, width: 600, height: 700 }),
          fragments: [
            Object.freeze({
              kind: 'paragraph' as const,
              paragraphId: 'p1',
              fragmentIndex: 0,
              props: [],
              box: Object.freeze({ x: 0, y: 0, width: 600, height: 100 }),
              lines: [
                Object.freeze({
                  id: 'l1',
                  box: Object.freeze({ x: 0, y: 0, width: 600, height: 50 }),
                  range: Object.freeze({ paragraphId: 'p1', start: 0, end: 1 }),
                  spans: [],
                  drawings: [drawing],
                }),
              ],
            }),
          ],
        }),
      ],
    };
    paintSemanticLayout(
      container,
      layout as import('@docx-editor.dev/core/layout').SemanticLayout,
      {
        scale: 1,
        imageUrlPort: port,
      }
    );
    expect(revoked.length).toBe(0);
    paintSemanticLayout(
      container,
      {
        revision: 2,
        pages: [{ ...layout.pages[0]!, fragments: [] }],
      } as import('@docx-editor.dev/core/layout').SemanticLayout,
      { scale: 1, imageUrlPort: port }
    );
    expect(revoked.length).toBe(1);
  });
});

describe('ready drawings with unavailable bytes', () => {
  test('paint a placeholder instead of throwing', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const port: PaintImageUrlPort = {
      create(handle) {
        throw new Error(
          `PaintImageUrlSource: validated bytes unavailable for ${handle.resourceKey}`
        );
      },
      revoke() {},
    };
    const registry = drawingUrlRegistryFor(host, port);
    const drawing = readyRecordFromXml(inlinePictureXml());
    let element: HTMLElement | null = null;
    expect(() => {
      element = paintDrawingRecord(
        document,
        drawing,
        { scale: 1, strings: DEFAULT_DRAWING_PAINT_STRINGS, imageUrlPort: port },
        registry
      );
    }).not.toThrow();
    expect(element?.classList.contains('docx-drawing-placeholder')).toBe(true);
    detachDrawingUrlRegistry(host);
    host.remove();
  });
});

describe('drawing membership belongs to the immutable layout', () => {
  function layoutWithResource(resource: ImageResourceState = READY_PNG) {
    return layoutSemanticDocument(load(inlinePictureXml()), 1, {
      measurer: createFixedMeasurer(6, 14),
      inlineDrawingLayout: {
        ownerPartName: OWNER,
        project: (node) =>
          projectDrawing(node, {
            ownerPartName: OWNER,
            limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
          }),
        resourceOf: () => resource,
      },
    });
  }

  test('both collectors share one page-list visit, then skip unchanged-layout aggregation', () => {
    const original = layoutWithResource();
    let pageListReads = 0;
    const layout = Object.freeze({
      revision: original.revision,
      get pages() {
        pageListReads++;
        return original.pages;
      },
    });
    const elements = collectUsedDrawingElementKeys(layout);
    const resources = collectUsedDrawingResourceKeys(layout);
    expect(elements.size).toBe(1);
    expect([...resources]).toEqual([READY_PNG.resourceKey]);
    expect(pageListReads).toBe(1);
    expect(collectUsedDrawingElementKeys(layout)).toBe(elements);
    expect(collectUsedDrawingResourceKeys(layout)).toBe(resources);
    expect(pageListReads).toBe(1);
  });

  test('reused drawings deduplicate resources but retain each page occurrence', () => {
    const original = layoutWithResource();
    const first = original.pages[0]!;
    const shifted = Object.freeze({ ...first, index: 7 });
    const layout = Object.freeze({ ...original, pages: Object.freeze([first, shifted]) });
    const originalElements = collectUsedDrawingElementKeys(original);
    expect([...collectUsedDrawingResourceKeys(layout)]).toEqual([READY_PNG.resourceKey]);
    expect([...collectUsedDrawingElementKeys(layout)]).toEqual([
      ...originalElements,
      ...[...originalElements].map((key) => key.replace(/^p0\|/, 'p7|')),
    ]);
    const removed = Object.freeze({ ...layout, pages: Object.freeze([shifted]) });
    expect([...collectUsedDrawingElementKeys(removed)]).toEqual(
      [...originalElements].map((key) => key.replace(/^p0\|/, 'p7|'))
    );
    expect(collectUsedDrawingElementKeys(original)).toBe(originalElements);
  });

  test('new layouts invalidate ready membership even at the same document revision', () => {
    const ready = layoutWithResource();
    const pending = layoutWithResource(Object.freeze({ kind: 'pending', resourceKey: 'pending' }));
    expect(ready.revision).toBe(pending.revision);
    expect([...collectUsedDrawingResourceKeys(ready)]).toEqual([READY_PNG.resourceKey]);
    expect(collectUsedDrawingResourceKeys(pending).size).toBe(0);
    expect(collectUsedDrawingElementKeys(pending).size).toBe(1);
    const replacement = layoutWithResource({ ...READY_PNG, resourceKey: 'replacement' });
    expect([...collectUsedDrawingResourceKeys(replacement)]).toEqual(['replacement']);
    expect([...collectUsedDrawingResourceKeys(ready)]).toEqual([READY_PNG.resourceKey]);
  });

  test('offscreen repaint releases resources and recreates them on return', () => {
    const layout = layoutWithResource();
    const { port, revoked } = fakeUrlPort();
    const container = document.createElement('div');
    const options = { scale: 1, imageUrlPort: port };
    paintSemanticLayout(container, layout, options);
    const image = container.querySelector('img');
    expect(image).not.toBeNull();
    const url = image!.getAttribute('src');
    paintSemanticLayout(container, layout, { ...options, materialize: new Set<number>() });
    expect(container.querySelector('img')).toBeNull();
    expect(revoked).toEqual([url!]);
    expect(image!.getAttribute('src')).toBeNull();
    paintSemanticLayout(container, layout, options);
    expect(container.querySelector('img')).not.toBe(image);
    expect(container.querySelector('img')!.getAttribute('src')).toBe(url);
    expect(revoked).toEqual([url!]);
    paintSemanticLayout(container, Object.freeze({ ...layout, pages: Object.freeze([]) }), options);
    expect(revoked).toEqual([url!, url!]);
    expect(image!.getAttribute('src')).toBeNull();
    paintSemanticLayout(container, layout, options);
    detachDrawingUrlRegistry(container);
    expect(revoked).toEqual([url!, url!, url!]);
  });
});

test('a rebuilt image removes its custom preview registration when previews are disabled', async () => {
  const { observeUnsupportedElements } = await import('../unsupported-elements.ts');
  const container = document.createElement('div');
  const { port } = fakeUrlPort();
  const registry = drawingUrlRegistryFor(container, port);
  // A duotone effect does not render, so the picture is partly supported and offered.
  const xml = inlinePictureXml({
    lum: '<a:duotone><a:prstClr val="black"/><a:srgbClr val="FFFFFF"/></a:duotone>',
  });
  const drawing = readyRecordFromXml(xml);
  const source = drawingOf(load(xml));
  const ctx = {
    scale: 1,
    strings: DEFAULT_DRAWING_PAINT_STRINGS,
    imageUrlPort: port,
    includePartial: true,
    unsupportedSource: () => source,
  };
  const first = paintDrawingRecord(document, drawing, ctx, registry)!;
  container.append(first);
  let hosts: readonly import('../unsupported-elements.ts').UnsupportedElementHost[] = [];
  const stop = observeUnsupportedElements(container, (next) => {
    hosts = next;
  });
  try {
    expect(hosts).toHaveLength(1);
    hosts[0]!.slot.append(document.createElement('img'));
    hosts[0]!.setCustomized(true);
    expect(first.getAttribute('aria-hidden')).toBeNull();
    const next = paintDrawingRecord(
      document,
      drawing,
      { ...ctx, scale: 2, includePartial: false },
      registry
    )!;
    expect(next).toBe(first);
    expect(next.hasAttribute('data-docx-unsupported')).toBe(false);
    expect(next.hasAttribute('data-docx-customized')).toBe(false);
    expect(next.getAttribute('aria-hidden')).toBe('true');
    expect(next.querySelector('img')).not.toBeNull();
  } finally {
    stop();
    detachDrawingUrlRegistry(container);
  }
});
