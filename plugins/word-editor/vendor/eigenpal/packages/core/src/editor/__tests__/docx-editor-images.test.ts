import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import {
  IMAGE_WRAP_TARGETS,
  type ImageWrapTarget,
} from '../../store/package/drawing-projection.ts';
import {
  validateRasterHeader,
  type ImageDecodePort,
  type ImageResourceLookup,
} from '../../store/package/image-resources.ts';
import { resolveImageResourceLimits } from '../../store/runtime/limits.ts';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import type { OoxmlDrawingNode, OoxmlElement } from '../../store/package/ooxml-tree.ts';
import { createInlineDrawingLayoutBundle } from '../../layout/inline-drawing-source.ts';
import { findDrawingOverlayFrameInLayout } from '../../layout/semantic-hit-test.ts';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { PICTURE_SELECTED_INSERT_REASON } from '../docx-editor-images.ts';
import { selectedDrawingOverlayTargetOf } from '../drawing-overlay-target.ts';
import { toolbarCommandState } from '../toolbar-commands.ts';
import { stubReviewModule } from './review-test-module.ts';
import type { EditorDiagnostic } from '../../contracts/diagnostics.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const PIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
// A graphic the engine has no reader for. A chart selects as an object (chart-selection.test.ts).
const UNKNOWN_GRAPHIC_URI = 'urn:example:unknown-graphic';

const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (c) => c.charCodeAt(0)
);

function createTestImageDecodePort(): ImageDecodePort {
  return Object.freeze({
    async decode(bytes, mime, _limits) {
      const header = validateRasterHeader(bytes, mime);
      if (!header) throw new Error('invalid image');
      const limits = resolveImageResourceLimits();
      if (header.pixelWidth * header.pixelHeight > limits.maxPixels) {
        throw new Error('too large');
      }
      return Object.freeze({
        pixelWidth: header.pixelWidth,
        pixelHeight: header.pixelHeight,
        dpiX: 96,
        dpiY: 96,
      });
    },
  });
}

function inlinePictureDocument(
  options: {
    readonly embed?: string;
    readonly graphicDataUri?: string;
    readonly docPr?: string;
    readonly wrap?: 'inline' | 'anchor';
    readonly wrapSquare?: string;
    readonly behindDoc?: '0' | '1';
    /** Put the drawing in the FIRST run, so its anchor coincides with the mount-time caret. */
    readonly drawingFirst?: boolean;
    /** Paragraph properties for the paragraph that holds the drawing. */
    readonly pPr?: string;
    /** The inline drawing's `wp:cNvGraphicFramePr` element. */
    readonly graphicFramePr?: string;
    /** Paragraphs before the one that holds the drawing. */
    readonly before?: string;
  } = {}
): Uint8Array {
  const embed = options.embed ?? 'rIdImage';
  const graphicDataUri = options.graphicDataUri ?? PIC_URI;
  const docPr = options.docPr ?? 'id="1" name="green" descr="Green square" title="Green title"';
  const drawingInner =
    options.wrap === 'anchor'
      ? `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="1" allowOverlap="0" behindDoc="${options.behindDoc ?? '0'}" locked="0" layoutInCell="1" relativeHeight="0">` +
        '<wp:simplePos x="0" y="0"/>' +
        '<wp:positionH relativeFrom="page"><wp:align>center</wp:align></wp:positionH>' +
        '<wp:positionV relativeFrom="line"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
        '<wp:extent cx="914400" cy="914400"/>' +
        (options.wrapSquare ??
          '<wp:wrapSquare wrapText="bothSides" distT="1" distB="2" distL="3" distR="4"/>') +
        `<wp:docPr ${docPr}/>` +
        '<wp:cNvGraphicFramePr/>' +
        `<a:graphic xmlns:a="${A}"><a:graphicData uri="${graphicDataUri}">` +
        '<pic:pic xmlns:pic="' +
        PIC +
        '"><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
        `<pic:blipFill><a:blip r:embed="${embed}"><a:stretch><a:fillRect/></a:stretch></a:blip></pic:blipFill>` +
        '<pic:spPr><a:xfrm rot="0"><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>' +
        '</pic:pic></a:graphicData></a:graphic></wp:anchor>'
      : `<wp:inline distT="0" distB="0" distL="0" distR="0">` +
        '<wp:extent cx="914400" cy="914400"/>' +
        `<wp:docPr ${docPr}/>` +
        (options.graphicFramePr ?? '<wp:cNvGraphicFramePr/>') +
        `<a:graphic xmlns:a="${A}"><a:graphicData uri="${graphicDataUri}">` +
        '<pic:pic xmlns:pic="' +
        PIC +
        '"><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
        `<pic:blipFill><a:blip r:embed="${embed}"><a:stretch><a:fillRect/></a:stretch></a:blip></pic:blipFill>` +
        '<pic:spPr><a:xfrm rot="0"><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>' +
        '</pic:pic></a:graphicData></a:graphic></wp:inline>';

  const runs = options.drawingFirst
    ? `<w:r><w:drawing>${drawingInner}</w:drawing></w:r><w:r><w:t>after</w:t></w:r>`
    : `<w:r><w:t>before</w:t></w:r><w:r><w:drawing>${drawingInner}</w:drawing></w:r><w:r><w:t>after</w:t></w:r>`;
  const body =
    `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    `<w:body>${options.before ?? ''}<w:p>${options.pPr ?? ''}${runs}</w:p></w:body></w:document>`;

  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Default Extension="png" ContentType="image/png"/>' +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(body),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdImage" Type="${R}/image" Target="media/image1.png"/></Relationships>`
    ),
    'word/media/image1.png': PNG_1X1,
  });
}

/** A picture-less package around `body`, for the insert tests. No `w:sectPr`: Letter, 1in margins. */
function pictureLessDocument(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Default Extension="png" ContentType="image/png"/>' +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
    'word/_rels/document.xml.rels': strToU8(`<Relationships xmlns="${REL}"></Relationships>`),
  });
}

function mountEditor(bytes: Uint8Array): DocxEditorInstance {
  const container = document.createElement('div');
  const editor = createDocxEditor({
    container,
    document: bytes,
    imageDecodePort: createTestImageDecodePort(),
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

function drawingParagraphId(editor: DocxEditorInstance): string {
  const ids = editor.surface!.session.paragraphIds();
  return ids[0]!;
}

function selectInlineDrawing(editor: DocxEditorInstance, offset = 6): void {
  const paragraphId = drawingParagraphId(editor);
  editor.surface!.setSelection({
    anchor: { paragraphId, offset },
    head: { paragraphId, offset },
  });
}

async function settleDrawingResources(editor: DocxEditorInstance): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    editor.surface!.layout();
    const image = editor.snapshot().image;
    if (!image || image.resourceStatus !== 'pending') return;
  }
}

describe('docx-editor selected image context', () => {
  test('text-only package revisions preserve settled drawing resources', async () => {
    const loaded = readOoxmlPackage(inlinePictureDocument());
    if (!loaded.ok) throw new Error(loaded.reason);
    let pkg = loaded.package;
    let revision = 0;
    let resolves = 0;
    const resourceLookup: ImageResourceLookup = {
      async resolveEmbedded() {
        resolves += 1;
        return Object.freeze({ kind: 'missing' as const });
      },
      resolveLinked: () => Object.freeze({ kind: 'missing' as const }),
      async resolveForProjection() {
        resolves += 1;
        return Object.freeze({ kind: 'missing' as const });
      },
      liveReferenceCount: () => 0,
      dispose: () => {},
    };
    const session = {
      packageRevision: () => revision,
      currentPackage: () => pkg,
      part: () => pkg.parts.get(pkg.mainDocumentPart)!,
    };
    const bundle = createInlineDrawingLayoutBundle({
      session,
      decodePort: createTestImageDecodePort(),
      resourceLookup,
      onResourcesChanged: () => {},
    });
    const drawing = (() => {
      const stack: OoxmlElement[] = [session.part().root];
      while (stack.length > 0) {
        const node = stack.shift()!;
        if (node.kind === 'drawing') return node as OoxmlDrawingNode;
        for (const child of node.children) {
          if (child.kind !== 'textValue') stack.push(child);
        }
      }
      throw new Error('missing drawing');
    })();
    const firstProjection = bundle.bodyContext.project(drawing)!;
    expect(bundle.bodyContext.resourceOf(firstProjection).kind).toBe('pending');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(bundle.bodyContext.resourceOf(firstProjection).kind).toBe('missing');
    expect(resolves).toBe(1);

    pkg = Object.freeze({ ...pkg, parts: new Map(pkg.parts) });
    revision += 1;
    bundle.sync(session);

    const nextProjection = bundle.bodyContext.project(drawing)!;
    expect(bundle.bodyContext.resourceOf(nextProjection).kind).toBe('missing');
    expect(resolves).toBe(1);
  });

  test('text typed after an inline image reflows onto additional semantic lines', () => {
    const editor = mountEditor(inlinePictureDocument());
    const paragraphId = drawingParagraphId(editor);
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 12 },
      head: { paragraphId, offset: 12 },
    });

    editor.exec({ type: 'insertText', text: ' word'.repeat(200) });

    const fragment = editor
      .surface!.layout()
      .pages.flatMap((page) => page.fragments)
      .find((candidate) => candidate.kind === 'paragraph' && candidate.paragraphId === paragraphId);
    expect(fragment?.kind).toBe('paragraph');
    if (!fragment || fragment.kind !== 'paragraph') throw new Error('missing paragraph fragment');
    expect(fragment.lines.length).toBeGreaterThan(1);
  });

  test('derives selected image context for inline picture with stable references', async () => {
    const editor = mountEditor(inlinePictureDocument());
    selectInlineDrawing(editor);
    await settleDrawingResources(editor);
    const first = editor.snapshot();
    expect(first.image).not.toBeNull();
    expect(first.image!.wrap).toBe('inline');
    expect(first.image!.widthEmu).toBe(914_400);
    expect(first.image!.heightEmu).toBe(914_400);
    expect(first.image!.description).toBe('Green square');
    expect(first.image!.title).toBe('Green title');
    expect(first.image!.name).toBe('green');
    expect(first.image!.resourceStatus).toBe('ready');
    expect(first.image!.intrinsic).toEqual({
      pixelWidth: 1,
      pixelHeight: 1,
      dpiX: 96,
      dpiY: 96,
    });
    expect(editor.getSelectedImage()).toBe(first.image);
    const second = editor.snapshot();
    expect(second.image).toBe(first.image);
  });

  test('viewing mode takes the resize and move handles off the overlay target', async () => {
    // The overlay's capability flags came from the drawing's own OOXML locks alone, so a
    // reader in viewing got eight resize handles, a `move` cursor and a live drag preview —
    // then watched it snap back when the write was refused. The target itself stays: the
    // image is still selectable, copyable and describable in a document open for viewing.
    const editor = mountEditor(inlinePictureDocument());
    selectInlineDrawing(editor);
    await settleDrawingResources(editor);
    const editing = selectedDrawingOverlayTargetOf(editor.surface);
    expect(editing).not.toBeNull();
    expect(editing!.canResize).toBe(true);

    editor.exec({ type: 'setEditingMode', mode: 'viewing' });
    const viewing = selectedDrawingOverlayTargetOf(editor.surface);
    expect(viewing).not.toBeNull();
    expect(viewing!.canResize).toBe(false);
    expect(viewing!.canMove).toBe(false);

    // Suggesting refuses every image property edit too, so it gets no handles either.
    editor.exec({ type: 'setEditingMode', mode: 'suggesting' });
    expect(selectedDrawingOverlayTargetOf(editor.surface)!.canResize).toBe(false);

    editor.exec({ type: 'setEditingMode', mode: 'editing' });
    expect(selectedDrawingOverlayTargetOf(editor.surface)!.canResize).toBe(true);
  });

  test('derives null for text caret and range selection', () => {
    const editor = mountEditor(inlinePictureDocument());
    const paragraphId = drawingParagraphId(editor);
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 0 },
    });
    expect(editor.snapshot().image).toBeNull();
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 2 },
    });
    expect(editor.snapshot().image).toBeNull();
  });

  test('a freshly opened document never reports a selected drawing', async () => {
    // The mount-time caret sits at offset zero of the first paragraph — exactly where this
    // drawing anchors. Nothing selected the OBJECT, so nothing is selected: a document must
    // not open with an image ring and eight resize handles.
    const container = document.createElement('div');
    const editor = createDocxEditor({
      container,
      document: inlinePictureDocument({ wrap: 'anchor', drawingFirst: true }),
      imageDecodePort: createTestImageDecodePort(),
    });
    if (!editor.surface) throw new Error('surface failed to mount');
    expect(editor.surface.drawingSelectionIntent().kind).toBe('none');
    expect(editor.snapshot().image).toBeNull();
    expect(selectedDrawingOverlayTargetOf(editor.surface)).toBeNull();

    // A press on the PAGES (not the drawing) is a text caret: still no object selection.
    container.querySelector('.docx-pages')!.dispatchEvent(new Event('pointerdown'));
    expect(editor.surface.drawingSelectionIntent().kind).toBe('none');
    expect(selectedDrawingOverlayTargetOf(editor.surface)).toBeNull();

    // A press ON the painted drawing selects it, even at the very same caret offsets.
    const drawing = container.querySelector('[data-drawing-node-id]')!;
    drawing.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(editor.surface.drawingSelectionIntent().kind).toBe('pointer');
    await settleDrawingResources(editor);
    expect(selectedDrawingOverlayTargetOf(editor.surface)).not.toBeNull();
    expect(editor.snapshot().image).not.toBeNull();

    // Typing deselects the object — Word never rings an image from keystrokes.
    editor.exec({ type: 'insertText', text: 'x' });
    expect(editor.surface.drawingSelectionIntent().kind).toBe('none');
    expect(selectedDrawingOverlayTargetOf(editor.surface)).toBeNull();
  });

  test('an explicit selection write that moves the caret selects an adjacent drawing', () => {
    const editor = mountEditor(inlinePictureDocument({ wrap: 'anchor', drawingFirst: true }));
    expect(editor.surface!.drawingSelectionIntent().kind).toBe('none');
    // A same-position write stays inert — the font-load remount restores the saved caret
    // through this path during a plain open.
    const paragraphId = drawingParagraphId(editor);
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 0 },
    });
    expect(editor.surface!.drawingSelectionIntent().kind).toBe('none');
    selectInlineDrawing(editor, 1);
    expect(editor.surface!.drawingSelectionIntent().kind).toBe('programmatic');
    expect(selectedDrawingOverlayTargetOf(editor.surface)).not.toBeNull();
  });

  test('derives null for non-picture graphic', () => {
    const editor = mountEditor(inlinePictureDocument({ graphicDataUri: UNKNOWN_GRAPHIC_URI }));
    selectInlineDrawing(editor);
    expect(editor.snapshot().image).toBeNull();
  });

  test('reports anchored wrap behind and inFront distinctly', async () => {
    const behind = mountEditor(
      inlinePictureDocument({
        wrap: 'anchor',
        behindDoc: '1',
        wrapSquare: '<wp:wrapNone/>',
      })
    );
    selectInlineDrawing(behind);
    await settleDrawingResources(behind);
    expect(behind.snapshot().image?.wrap).toBe('behind');

    const front = mountEditor(
      inlinePictureDocument({
        wrap: 'anchor',
        behindDoc: '0',
        wrapSquare: '<wp:wrapNone/>',
      })
    );
    selectInlineDrawing(front);
    await settleDrawingResources(front);
    expect(front.snapshot().image?.wrap).toBe('inFront');
  });

  test('reports all nine wrap targets from anchored square sides', () => {
    const cases: ReadonlyArray<{
      readonly wrapSquare: string;
      readonly expected: ImageWrapTarget;
    }> = [
      { wrapSquare: '<wp:wrapSquare wrapText="bothSides"/>', expected: 'square' },
      { wrapSquare: '<wp:wrapSquare wrapText="left"/>', expected: 'squareLeft' },
      { wrapSquare: '<wp:wrapSquare wrapText="right"/>', expected: 'squareRight' },
      {
        wrapSquare:
          '<wp:wrapTight wrapText="bothSides"><wp:wrapPolygon edited="0"><wp:start x="0" y="0"/><wp:lineTo x="914400" y="0"/><wp:lineTo x="914400" y="914400"/><wp:lineTo x="0" y="914400"/><wp:lineTo x="0" y="0"/></wp:wrapPolygon></wp:wrapTight>',
        expected: 'tight',
      },
      {
        wrapSquare:
          '<wp:wrapThrough wrapText="bothSides"><wp:wrapPolygon edited="0"><wp:start x="0" y="0"/><wp:lineTo x="914400" y="0"/><wp:lineTo x="914400" y="914400"/><wp:lineTo x="0" y="914400"/><wp:lineTo x="0" y="0"/></wp:wrapPolygon></wp:wrapThrough>',
        expected: 'through',
      },
      { wrapSquare: '<wp:wrapTopAndBottom/>', expected: 'topAndBottom' },
    ];
    for (const { wrapSquare, expected } of cases) {
      const editor = mountEditor(inlinePictureDocument({ wrap: 'anchor', wrapSquare }));
      selectInlineDrawing(editor);
      expect(editor.snapshot().image?.wrap).toBe(expected);
    }
    expect(IMAGE_WRAP_TARGETS).toContain('behind');
    expect(IMAGE_WRAP_TARGETS).toContain('inFront');
  });

  test('unsupported picture reports resource status with null intrinsic', async () => {
    const bytes = inlinePictureDocument({ embed: 'rIdMissing' });
    const editor = mountEditor(bytes);
    selectInlineDrawing(editor);
    await settleDrawingResources(editor);
    const image = editor.snapshot().image;
    expect(image).not.toBeNull();
    expect(image!.resourceStatus).toBe('missing');
    expect(image!.intrinsic).toBeNull();
  });
});

describe('docx-editor image commands', () => {
  test('routes deleteImage through package transactions', () => {
    const editor = mountEditor(inlinePictureDocument());
    selectInlineDrawing(editor);
    const id = editor.snapshot().image!.id;
    const beforeRevision = editor.surface!.session.packageRevision();
    const result = editor.exec({ type: 'deleteImage' });
    expect(result).toEqual({ ok: true, changed: true });
    expect(editor.surface!.session.packageRevision()).toBeGreaterThan(beforeRevision);
    selectInlineDrawing(editor);
    expect(editor.snapshot().image).toBeNull();
    editor.exec({ type: 'undo' });
    selectInlineDrawing(editor);
    expect(editor.snapshot().image?.id).toBe(id);
  });

  test('resize publishes layout and overlay geometry synchronously', async () => {
    // The resize lane used to apply its ops without the commit tail, so layout reached the
    // screen through the scheduler's timer task — after a host's `change` handlers had read
    // geometry — and the selection overlay kept the drawing's old frame.
    const editor = mountEditor(inlinePictureDocument());
    selectInlineDrawing(editor);
    await settleDrawingResources(editor);
    const before = selectedDrawingOverlayTargetOf(editor.surface);
    expect(before).not.toBeNull();
    expect(before!.width).toBeCloseTo(72, 5);

    const result = editor.exec({
      type: 'setImageProperties',
      widthEmu: 457_200,
      heightEmu: 457_200,
    });
    expect(result).toEqual({ ok: true, changed: true });

    // No timer flush between the exec and these reads: the commit itself must publish.
    const frame = findDrawingOverlayFrameInLayout(editor.surface!.publishedLayout(), before!.id);
    expect(frame).not.toBeNull();
    expect(frame!.width).toBeCloseTo(36, 5);
    expect(frame!.height).toBeCloseTo(36, 5);

    const target = selectedDrawingOverlayTargetOf(editor.surface);
    expect(target).not.toBeNull();
    expect(target!.widthEmu).toBe(457_200);
    expect(target!.heightEmu).toBe(457_200);
    expect(target!.width).toBeCloseTo(36, 5);
    expect(target!.height).toBeCloseTo(36, 5);
  });

  test('refuses image commands without a selected picture', () => {
    const editor = mountEditor(inlinePictureDocument());
    const paragraphId = drawingParagraphId(editor);
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 0 },
    });
    const refused = editor.can({ type: 'deleteImage' });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toContain('no drawing');
  });

  test('refuses deleteImage in read-only viewing mode', () => {
    const container = document.createElement('div');
    const editor = createDocxEditor({
      container,
      document: inlinePictureDocument(),
      mode: 'view',
      imageDecodePort: createTestImageDecodePort(),
    });
    selectInlineDrawing(editor);
    const refused = editor.can({ type: 'deleteImage' });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe('locked');
  });

  test('routes insertImage through package transactions', async () => {
    const editor = mountEditor(pictureLessDocument('<w:p><w:r><w:t>hello</w:t></w:r></w:p>'));
    const paragraphId = drawingParagraphId(editor);
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 5 },
      head: { paragraphId, offset: 5 },
    });
    const beforeRevision = editor.surface!.session.packageRevision();
    const result = await editor.executeImageCommand({
      type: 'insertImage',
      data: PNG_1X1,
      mime: 'image/png',
      widthPoints: 72,
      heightPoints: 72,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.changed).toBe(true);
    expect(editor.surface!.session.packageRevision()).toBeGreaterThan(beforeRevision);
    await settleDrawingResources(editor);
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 5 },
      head: { paragraphId, offset: 5 },
    });
    await settleDrawingResources(editor);
    expect(editor.snapshot().image).not.toBeNull();
    expect(editor.snapshot().image!.resourceStatus).toBe('ready');
  });

  test('insertImage scales a too-wide extent down to the section content box', async () => {
    // Word's insert behavior: natural size when it fits, page scale when it does not.
    // 468pt content width: Letter minus 1in margins.
    const editor = mountEditor(pictureLessDocument('<w:p><w:r><w:t>hello</w:t></w:r></w:p>'));
    const paragraphId = drawingParagraphId(editor);
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 5 },
      head: { paragraphId, offset: 5 },
    });
    const result = await editor.executeImageCommand({
      type: 'insertImage',
      data: PNG_1X1,
      mime: 'image/png',
      widthPoints: 936,
      heightPoints: 468,
    });
    expect(result.ok).toBe(true);
    await settleDrawingResources(editor);
    // Offset 6 — the drawing's anchor + 1. The scaled drawing fills its own layout line, so
    // offset 5 resolves to the end of the text line and would miss it.
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 6 },
      head: { paragraphId, offset: 6 },
    });
    await settleDrawingResources(editor);
    const image = editor.snapshot().image;
    expect(image).not.toBeNull();
    // 936×468pt halves to fit the 468pt content width; aspect ratio is preserved.
    expect(image!.widthEmu).toBe(468 * 12_700);
    expect(image!.heightEmu).toBe(234 * 12_700);
  });

  test('insertImage in a narrow table cell fits the cell measure, not the page', async () => {
    // A 2000-twip (100pt) fixed cell. The caret line's box is the measure the paragraph was
    // broken against — cell margins included — so the fit lands well under the cell width
    // while the section box alone would have said 468pt.
    const editor = mountEditor(
      pictureLessDocument(
        '<w:tbl><w:tblPr><w:tblW w:w="2000" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>' +
          '<w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>' +
          '<w:tr><w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>' +
          '<w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
          '<w:p><w:r><w:t>after</w:t></w:r></w:p>'
      )
    );
    const cellParagraphId = editor.surface!.session.paragraphIds()[0]!;
    editor.surface!.setSelection({
      anchor: { paragraphId: cellParagraphId, offset: 4 },
      head: { paragraphId: cellParagraphId, offset: 4 },
    });
    const result = await editor.executeImageCommand({
      type: 'insertImage',
      data: PNG_1X1,
      mime: 'image/png',
      widthPoints: 936,
      heightPoints: 468,
    });
    expect(result.ok).toBe(true);
    await settleDrawingResources(editor);
    editor.surface!.setSelection({
      anchor: { paragraphId: cellParagraphId, offset: 5 },
      head: { paragraphId: cellParagraphId, offset: 5 },
    });
    await settleDrawingResources(editor);
    const image = editor.snapshot().image;
    expect(image).not.toBeNull();
    // At most the 100pt cell, far below the 468pt section box; 2:1 aspect preserved.
    expect(image!.widthEmu).toBeLessThanOrEqual(100 * 12_700);
    expect(image!.widthEmu).toBeGreaterThan(0);
    expect(image!.widthEmu).toBeCloseTo(image!.heightEmu * 2, -2);
  });

  test('refuses setImageWrapType with stale drawing id', () => {
    const editor = mountEditor(inlinePictureDocument());
    selectInlineDrawing(editor);
    const staleId = editor.snapshot().image!.id;
    editor.exec({ type: 'deleteImage' });
    const refused = editor.exec({
      type: 'setImageWrapType',
      target: 'square',
      drawingNodeId: staleId,
    } as never);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toContain('stale');
  });
});

describe('inserting a picture while one is selected', () => {
  for (const wrap of ['inline', 'anchor'] as const)
    test(`is refused with a reason, a public code, and a disabled toolbar button (${wrap})`, async () => {
      const events: EditorDiagnostic[] = [];
      const editor = createDocxEditor({
        container: document.createElement('div'),
        document: inlinePictureDocument({ wrap }),
        imageDecodePort: createTestImageDecodePort(),
        author: 'Reviewer',
        modules: [
          stubReviewModule(),
          { id: 'observer', onDiagnostic: (event) => events.push(event) },
        ],
      });
      try {
        expect(editor.exec({ type: 'setEditingMode', mode: 'suggesting' } as never).ok).toBe(true);
        selectInlineDrawing(editor);
        await settleDrawingResources(editor);
        expect(editor.snapshot().image).not.toBeNull();
        expect(toolbarCommandState(editor, 'image.insert')).toMatchObject({
          enabled: false,
          disabledReason: PICTURE_SELECTED_INSERT_REASON,
        });
        const result = await editor.executeImageCommand({
          type: 'insertImage',
          data: PNG_1X1,
          mime: 'image/png',
          widthPoints: 10,
          heightPoints: 10,
        });
        expect(result).toMatchObject({ ok: false, reason: PICTURE_SELECTED_INSERT_REASON });
        expect(events.filter((event) => event.kind === 'edit.rejected')).toEqual([
          expect.objectContaining({
            code: 'edit.picture-selected',
            origin: 'command',
            command: 'insertImage',
            tracked: true,
          }),
        ]);
      } finally {
        editor.destroy();
      }
    });
});

describe('changing the wrap of an inline picture', () => {
  const centered = () =>
    inlinePictureDocument({
      before: '<w:p><w:r><w:t>Heading</w:t></w:r></w:p>',
      pPr: '<w:pPr><w:spacing w:before="240"/><w:jc w:val="center"/></w:pPr>',
    });

  function selectDrawingIn(editor: DocxEditorInstance, paragraphIndex: number): void {
    const paragraphId = editor.surface!.session.paragraphIds()[paragraphIndex]!;
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 6 },
      head: { paragraphId, offset: 6 },
    });
  }

  test('the wrap control is enabled for an inline picture', async () => {
    const editor = mountEditor(centered());
    selectDrawingIn(editor, 1);
    await settleDrawingResources(editor);
    const image = editor.snapshot().image;
    expect(image?.kind).toBe('inline');
    expect(image?.canChangeWrap).toBe(true);
    expect(toolbarCommandState(editor, 'image.wrap').enabled).toBe(true);
    expect(editor.can({ type: 'setImageWrapType', target: 'square' })).toEqual({ ok: true });
  });

  for (const target of ['square', 'tight', 'topAndBottom', 'behind', 'inFront'] as const)
    test(`${target} floats the picture where it was and undo restores it`, async () => {
      const editor = mountEditor(centered());
      selectDrawingIn(editor, 1);
      await settleDrawingResources(editor);
      const before = selectedDrawingOverlayTargetOf(editor.surface)!;
      expect(before.kind).toBe('inline');
      // Centered on the line, below the first paragraph: not the default 0, 0 place.
      expect(before.x).toBeGreaterThan(100);
      expect(before.y).toBeGreaterThan(20);

      const result = editor.exec({ type: 'setImageWrapType', target });
      expect(result).toEqual({ ok: true, changed: true });
      const image = editor.snapshot().image!;
      expect(image.kind).toBe('anchored');
      expect(image.wrap).toBe(target);
      expect(image.position).toMatchObject({
        mode: 'frame',
        relativeToH: 'margin',
        relativeToV: 'paragraph',
      });
      const after = selectedDrawingOverlayTargetOf(editor.surface)!;
      expect(after.kind).toBe('anchored');
      expect(after.x).toBeCloseTo(before.x, 1);
      expect(after.y).toBeCloseTo(before.y, 1);

      editor.exec({ type: 'undo' });
      selectDrawingIn(editor, 1);
      expect(editor.snapshot().image?.kind).toBe('inline');
      expect(selectedDrawingOverlayTargetOf(editor.surface)!.x).toBeCloseTo(before.x, 1);
    });

  test('the properties dialog command floats the picture where it was', async () => {
    const editor = mountEditor(centered());
    selectDrawingIn(editor, 1);
    await settleDrawingResources(editor);
    const before = selectedDrawingOverlayTargetOf(editor.surface)!;
    const result = editor.exec({ type: 'setImageProperties', wrap: 'square', alt: 'Moved' });
    expect(result).toEqual({ ok: true, changed: true });
    const after = selectedDrawingOverlayTargetOf(editor.surface)!;
    expect(after.kind).toBe('anchored');
    expect(after.x).toBeCloseTo(before.x, 1);
    expect(after.y).toBeCloseTo(before.y, 1);
    expect(editor.snapshot().image?.description).toBe('Moved');
  });

  test('a floated picture returns inline, and floats again where it was', async () => {
    const editor = mountEditor(centered());
    selectDrawingIn(editor, 1);
    await settleDrawingResources(editor);
    const before = selectedDrawingOverlayTargetOf(editor.surface)!;
    expect(editor.exec({ type: 'setImageWrapType', target: 'square' }).ok).toBe(true);
    expect(editor.exec({ type: 'setImageWrapType', target: 'inline' }).ok).toBe(true);
    selectDrawingIn(editor, 1);
    expect(editor.snapshot().image?.kind).toBe('inline');
    expect(editor.exec({ type: 'setImageWrapType', target: 'tight' }).ok).toBe(true);
    const after = selectedDrawingOverlayTargetOf(editor.surface)!;
    expect(after.x).toBeCloseTo(before.x, 1);
    expect(after.y).toBeCloseTo(before.y, 1);
  });

  test('a move-locked inline picture still refuses a wrap change', async () => {
    const editor = mountEditor(
      inlinePictureDocument({
        graphicFramePr:
          '<wp:cNvGraphicFramePr><a:graphicFrameLocks noMove="1"/></wp:cNvGraphicFramePr>',
      })
    );
    selectInlineDrawing(editor);
    await settleDrawingResources(editor);
    const image = editor.snapshot().image!;
    expect(image.locks.move).toBe(true);
    expect(image.canChangeWrap).toBe(false);
    expect(editor.can({ type: 'setImageWrapType', target: 'square' }).ok).toBe(false);
  });
});
