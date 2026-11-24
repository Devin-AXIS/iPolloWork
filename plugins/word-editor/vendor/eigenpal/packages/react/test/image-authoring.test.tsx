import { createPortal } from 'react-dom';
import type { DocxEditorPopups } from '../src/editor/popup-config';
// Image authoring chrome — insert, wrap, alt text, properties, contextual toolbar group.

import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { useEffect } from 'react';
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import {
  IMAGE_WRAP_TARGETS,
  type DocxEditorInstance,
  type ImageWrapTarget,
} from '@docx-editor.dev/core/editor';
import type { ImageDecodePort } from '@docx-editor.dev/core/editor';
import { validateRasterHeader } from '@docx-editor.dev/core/editor';
import { resolveImageResourceLimits } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { DocxEditorToolbar } from '../src/editor/toolbar/index.ts';
import { useEditorValueCommand } from '../src/editor/useEditorValueCommand.ts';
import { normalizeImageBytes } from '../src/editor/images/normalizeImageFile.ts';
import { DocxEditorImagePropertiesDialog } from '../src/editor/images/ImageProperties.tsx';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const PIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (c) => c.charCodeAt(0)
);

function pngWithPhysicalSize(width: number, height: number, pixelsPerMeter: number): Uint8Array {
  const source = PNG_1X1.slice();
  const writeUint32 = (bytes: Uint8Array, offset: number, value: number): void => {
    bytes[offset] = (value >>> 24) & 0xff;
    bytes[offset + 1] = (value >>> 16) & 0xff;
    bytes[offset + 2] = (value >>> 8) & 0xff;
    bytes[offset + 3] = value & 0xff;
  };
  writeUint32(source, 16, width);
  writeUint32(source, 20, height);
  const phys = Uint8Array.from([
    0, 0, 0, 9, 0x70, 0x48, 0x59, 0x73, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0,
  ]);
  writeUint32(phys, 8, pixelsPerMeter);
  writeUint32(phys, 12, pixelsPerMeter);
  const out = new Uint8Array(source.length + phys.length);
  out.set(source.subarray(0, 33));
  out.set(phys, 33);
  out.set(source.subarray(33), 33 + phys.length);
  return out;
}

const JPEG_1X1 = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
  0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
  0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20,
  0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27,
  0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
  0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01,
  0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04,
  0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0xff, 0xc4, 0x00, 0xb5, 0x10, 0x00, 0x02, 0x01, 0x03,
  0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7d, 0x01, 0x02, 0x03, 0x00,
  0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32,
  0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72,
  0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35,
  0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55,
  0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75,
  0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94,
  0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2,
  0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9,
  0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6,
  0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa, 0xff, 0xda,
  0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0xfb, 0xd5, 0xdb, 0x20, 0xa8, 0xf1, 0x45, 0x14,
  0x01, 0xff, 0xd9,
]);

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

function inlinePictureDocument(wrapSquare?: string, behindDoc?: '0' | '1'): Uint8Array {
  const drawingInner =
    wrapSquare !== undefined
      ? `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="1" allowOverlap="0" behindDoc="${behindDoc ?? '0'}" locked="0" layoutInCell="1" relativeHeight="0">` +
        '<wp:simplePos x="0" y="0"/>' +
        '<wp:positionH relativeFrom="page"><wp:align>center</wp:align></wp:positionH>' +
        '<wp:positionV relativeFrom="line"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
        '<wp:extent cx="914400" cy="914400"/>' +
        wrapSquare +
        `<wp:docPr id="1" name="green" descr="Green square" title="Green title"/>` +
        '<wp:cNvGraphicFramePr/>' +
        `<a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC_URI}">` +
        `<pic:pic xmlns:pic="${PIC}"><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>` +
        `<pic:blipFill><a:blip r:embed="rIdImage"><a:stretch><a:fillRect/></a:stretch></a:blip></pic:blipFill>` +
        '<pic:spPr><a:xfrm rot="0"><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>' +
        '</pic:pic></a:graphicData></a:graphic></wp:anchor>'
      : `<wp:inline distT="0" distB="0" distL="0" distR="0">` +
        '<wp:extent cx="914400" cy="914400"/>' +
        `<wp:docPr id="1" name="green" descr="Green square" title="Green title"/>` +
        '<wp:cNvGraphicFramePr/>' +
        `<a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC_URI}">` +
        `<pic:pic xmlns:pic="${PIC}"><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>` +
        `<pic:blipFill><a:blip r:embed="rIdImage"><a:stretch><a:fillRect/></a:stretch></a:blip></pic:blipFill>` +
        '<pic:spPr><a:xfrm rot="0"><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>' +
        '</pic:pic></a:graphicData></a:graphic></wp:inline>';

  const body =
    `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    `<w:body><w:p><w:r><w:t>before</w:t></w:r><w:r><w:drawing>${drawingInner}</w:drawing></w:r><w:r><w:t>after</w:t></w:r></w:p></w:body></w:document>`;

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

async function settleDrawingResources(editor: DocxEditorInstance): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    editor.surface?.layout();
    const image = editor.snapshot().image;
    if (!image || image.resourceStatus !== 'pending') return;
  }
}

function selectInlineDrawing(editor: DocxEditorInstance, offset = 6): void {
  const paragraphId = editor.surface!.session.paragraphIds()[0]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset },
    head: { paragraphId, offset },
  });
}

const PLAIN_SOURCE = zipSync({
  '[Content_Types].xml': strToU8(
    `<Types xmlns="${CT}">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>'
  ),
  '_rels/.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>hello world</w:t></w:r></w:p></w:body></w:document>`
  ),
  'word/_rels/document.xml.rels': strToU8(`<Relationships xmlns="${REL}"></Relationships>`),
});

function placeTextCaret(editor: DocxEditorInstance, offset = 5): void {
  const paragraphId = editor.surface!.session.paragraphIds()[0]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset },
    head: { paragraphId, offset },
  });
}

async function waitForSurface(editor: () => DocxEditorInstance): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    await act(async () => {
      await Promise.resolve();
    });
    if (editor().surface) return;
  }
  throw new Error('editor surface did not attach');
}

function mount(
  ui: React.ReactNode,
  source: Uint8Array = PLAIN_SOURCE,
  popups?: DocxEditorPopups
): {
  view: ReturnType<typeof render>;
  editor: () => DocxEditorInstance;
  selectDrawing: () => Promise<void>;
  ready: () => Promise<void>;
} {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={source}
      popups={popups}
      imageDecodePort={createTestImageDecodePort()}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    >
      {ui}
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  const editor = () => instance!;
  return {
    view,
    editor,
    ready: async () => {
      await waitForSurface(editor);
    },
    selectDrawing: async () => {
      if (!instance?.surface) return;
      selectInlineDrawing(instance);
      await settleDrawingResources(instance);
      for (let attempt = 0; attempt < 20; attempt++) {
        if (instance.getSelectedImage()) return;
        await act(async () => {
          await Promise.resolve();
          instance.surface?.layout();
        });
      }
    },
  };
}

afterEach(() => cleanup);

describe('binds image value commands', () => {
  function WrapProbe({
    onReady,
  }: {
    onReady: (state: ReturnType<typeof useEditorValueCommand>) => void;
  }) {
    const state = useEditorValueCommand('image.wrap');
    useEffect(() => {
      onReady(state);
    }, [state, onReady]);
    return null;
  }

  test('exposes all nine wrap options with stable dispatch', async () => {
    const source = inlinePictureDocument(
      '<wp:wrapSquare wrapText="bothSides" distT="1" distB="2" distL="3" distR="4"/>'
    );
    let latest: ReturnType<typeof useEditorValueCommand> | null = null;
    const { editor, selectDrawing, ready } = mount(
      <WrapProbe
        onReady={(state) => {
          latest = state;
        }}
      />,
      inlinePictureDocument(
        '<wp:wrapSquare wrapText="bothSides" distT="1" distB="2" distL="3" distR="4"/>'
      )
    );
    await ready();
    await selectDrawing();
    expect(latest).not.toBeNull();
    expect(latest!.options).toEqual(IMAGE_WRAP_TARGETS);
    expect(latest!.value).toBe('square');
    expect(latest!.isEnabled).toBe(true);
    await act(async () => {
      latest!.execute('behind');
    });
    expect(editor().getSelectedImage()?.wrap).toBe('behind');
  });

  test('alt text value tracks description, not name', async () => {
    function AltProbe({ onReady }: { onReady: (value: string | null) => void }) {
      const { value } = useEditorValueCommand('image.altText');
      useEffect(() => {
        onReady(value);
      }, [value, onReady]);
      return null;
    }
    let description: string | null = null;
    const { ready, selectDrawing } = mount(
      <AltProbe
        onReady={(value) => {
          description = value;
        }}
      />,
      inlinePictureDocument(
        '<wp:wrapSquare wrapText="bothSides" distT="1" distB="2" distL="3" distR="4"/>'
      )
    );
    await ready();
    await selectDrawing();
    expect(description).toBe('Green square');
  });
});

describe('inserts validated image files', () => {
  test('PNG file input inserts through executeImageCommand', async () => {
    const alerts: string[] = [];
    const original = window.alert;
    window.alert = (message) => {
      alerts.push(String(message));
    };
    try {
      const { view, editor, ready } = mount(<DocxEditorToolbar />);
      await ready();
      placeTextCaret(editor());
      const beforeRevision = editor().surface!.session.packageRevision();
      const input = view.container.querySelector('.docx-image-insert__input') as HTMLInputElement;
      expect(input).not.toBeNull();
      const file = new File([PNG_1X1], 'pixel.png', { type: 'image/png' });
      await act(async () => {
        fireEvent.change(input, { target: { files: [file] } });
        await Promise.resolve();
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });
      expect(alerts).toEqual([]);
      expect(editor().surface!.session.packageRevision()).toBeGreaterThan(beforeRevision);
    } finally {
      window.alert = original;
    }
  });

  test('rejects spoofed extension with localized refusal', () => {
    const pngNamedTxt = normalizeImageBytes(PNG_1X1);
    expect(pngNamedTxt.ok).toBe(true);
    const svgBytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const refused = normalizeImageBytes(svgBytes);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.reasonKey).toBe('imageInsert.errors.unsupportedFormat');
    }
  });

  test('uses PNG physical resolution for the inserted size', () => {
    const normalized = normalizeImageBytes(pngWithPhysicalSize(144, 72, 5669));
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    expect(normalized.widthPoints).toBe(72);
    expect(normalized.heightPoints).toBe(36);
  });

  test('insert button preserves caret on mousedown', async () => {
    const { view, ready, selectDrawing } = mount(
      <DocxEditorToolbar />,
      inlinePictureDocument(
        '<wp:wrapSquare wrapText="bothSides" distT="1" distB="2" distL="3" distR="4"/>'
      )
    );
    await ready();
    await selectDrawing();
    const button = view.container.querySelector('[data-slot="image.insert"]') as HTMLButtonElement;
    expect(button).not.toBeNull();
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    button.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe('offers all nine Word wrap choices', () => {
  test('menu lists every target and dispatches one command', async () => {
    const cases: ReadonlyArray<{ wrap: string; expected: ImageWrapTarget }> = [
      {
        wrap: '<wp:wrapSquare wrapText="bothSides" distT="1" distB="2" distL="3" distR="4"/>',
        expected: 'square',
      },
      {
        wrap: '<wp:wrapSquare wrapText="left" distT="1" distB="2" distL="3" distR="4"/>',
        expected: 'squareLeft',
      },
      {
        wrap: '<wp:wrapSquare wrapText="right" distT="1" distB="2" distL="3" distR="4"/>',
        expected: 'squareRight',
      },
      {
        wrap: '<wp:wrapTight wrapText="bothSides" distT="1" distB="2" distL="3" distR="4"><wp:wrapPolygon edited="0"><wp:start x="0" y="0"/><wp:lineTo x="914400" y="0"/><wp:lineTo x="914400" y="914400"/><wp:lineTo x="0" y="914400"/><wp:lineTo x="0" y="0"/></wp:wrapPolygon></wp:wrapTight>',
        expected: 'tight',
      },
      {
        wrap: '<wp:wrapThrough wrapText="bothSides" distT="1" distB="2" distL="3" distR="4"><wp:wrapPolygon edited="0"><wp:start x="0" y="0"/><wp:lineTo x="914400" y="0"/><wp:lineTo x="914400" y="914400"/><wp:lineTo x="0" y="914400"/><wp:lineTo x="0" y="0"/></wp:wrapPolygon></wp:wrapThrough>',
        expected: 'through',
      },
      { wrap: '<wp:wrapTopAndBottom distT="1" distB="2"/>', expected: 'topAndBottom' },
      { wrap: '<wp:wrapNone distT="1" distB="2" distL="3" distR="4"/>', expected: 'inFront' },
    ];
    for (const { wrap, expected } of cases) {
      const { editor, ready, selectDrawing } = mount(
        <DocxEditorToolbar />,
        inlinePictureDocument(wrap)
      );
      await ready();
      await selectDrawing();
      expect(editor().getSelectedImage()?.wrap).toBe(expected);
    }
    const behind = mount(
      <DocxEditorToolbar />,
      inlinePictureDocument('<wp:wrapNone distT="1" distB="2" distL="3" distR="4"/>', '1')
    );
    await behind.ready();
    await behind.selectDrawing();
    expect(behind.editor().getSelectedImage()?.wrap).toBe('behind');
  });

  test('contextual image group appears when a drawing is selected', async () => {
    const { view, ready, selectDrawing } = mount(
      <DocxEditorToolbar />,
      inlinePictureDocument(
        '<wp:wrapSquare wrapText="bothSides" distT="1" distB="2" distL="3" distR="4"/>'
      )
    );
    await ready();
    await selectDrawing();
    expect(view.container.querySelector('[data-slot="image.wrap"]')).not.toBeNull();
    expect(view.container.querySelector('[data-slot="image.properties"]')).not.toBeNull();
    expect(view.container.querySelector('[data-slot="image.altText"]')).not.toBeNull();
  });
});

describe('edits image properties atomically', () => {
  test('apply writes one setImageProperties command', async () => {
    const { editor, ready, selectDrawing } = mount(
      null,
      inlinePictureDocument(
        '<wp:wrapSquare wrapText="bothSides" distT="1" distB="2" distL="3" distR="4"/>'
      )
    );
    await ready();
    await selectDrawing();
    const height = editor().getSelectedImage()!.heightEmu;
    const result = editor().exec({
      type: 'setImageProperties',
      widthEmu: 25400,
      heightEmu: height,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.changed).toBe(true);
    await selectDrawing();
    expect(editor().getSelectedImage()?.widthEmu).toBe(25400);
  });

  test('properties dialog apply closes after commit', async () => {
    let closed = false;
    const { view, ready, selectDrawing } = mount(
      <DocxEditorImagePropertiesDialog
        open
        onClose={() => {
          closed = true;
        }}
      />,
      inlinePictureDocument(
        '<wp:wrapSquare wrapText="bothSides" distT="1" distB="2" distL="3" distR="4"/>'
      )
    );
    await ready();
    await selectDrawing();
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(view.getByText('Apply'));
    });
    expect(closed).toBe(true);
  });

  test('the overlay carries the scope class when rendered outside the editor', async () => {
    // A host may render this public dialog from its own chrome. Its packaged rules are
    // anchored to `.docx-editor`, so the overlay has to carry that class itself or the
    // panel gets no styles at all.
    const { view, ready, selectDrawing } = mount(
      <DocxEditorImagePropertiesDialog open onClose={() => {}} />,
      inlinePictureDocument()
    );
    await ready();
    await selectDrawing();
    await act(async () => {
      await Promise.resolve();
    });
    const overlay = view.container.querySelector('.docx-dialog-overlay');
    if (!overlay) throw new Error(`no overlay; html: ${view.container.innerHTML.slice(0, 400)}`);
    expect(overlay.closest('.docx-editor')).not.toBeNull();
  });

  test('cancel makes no mutation', async () => {
    const { view, editor, ready, selectDrawing } = mount(
      <DocxEditorImagePropertiesDialog open onClose={() => {}} />,
      inlinePictureDocument(
        '<wp:wrapSquare wrapText="bothSides" distT="1" distB="2" distL="3" distR="4"/>'
      )
    );
    await ready();
    await selectDrawing();
    await act(async () => {
      await Promise.resolve();
    });
    const before = editor().getSelectedImage()?.widthEmu;
    expect(before).toBeDefined();
    const dialog = within(view.container).getByRole('dialog');
    await act(async () => {
      fireEvent.change(within(dialog).getByLabelText('Width:'), { target: { value: '3' } });
      fireEvent.click(within(dialog).getByText('Cancel'));
    });
    await selectDrawing();
    expect(editor().getSelectedImage()?.widthEmu).toBe(before);
  });
});

describe('edits floating image position in properties', () => {
  function anchoredSimplePosDocument(x: number, y: number): Uint8Array {
    const drawingInner =
      `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="1" allowOverlap="0" behindDoc="0" locked="0" layoutInCell="1" relativeHeight="0">` +
      `<wp:simplePos x="${x}" y="${y}"/>` +
      '<wp:positionH relativeFrom="page"><wp:align>center</wp:align></wp:positionH>' +
      '<wp:positionV relativeFrom="line"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
      '<wp:extent cx="914400" cy="914400"/>' +
      '<wp:wrapSquare wrapText="bothSides" distT="1" distB="2" distL="3" distR="4"/>' +
      '<wp:docPr id="1" name="green" descr="Green square" title="Green title"/>' +
      '<wp:cNvGraphicFramePr/>' +
      `<a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC_URI}">` +
      `<pic:pic xmlns:pic="${PIC}"><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="rIdImage"><a:stretch><a:fillRect/></a:stretch></a:blip></pic:blipFill>` +
      '<pic:spPr><a:xfrm rot="0"><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>' +
      '</pic:pic></a:graphicData></a:graphic></wp:anchor>';
    const body =
      `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
      `<w:body><w:p><w:r><w:t>before</w:t></w:r><w:r><w:drawing>${drawingInner}</w:drawing></w:r><w:r><w:t>after</w:t></w:r></w:p></w:body></w:document>`;
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

  test('position controls are unavailable for inline images', async () => {
    const { view, ready, selectDrawing } = mount(
      <DocxEditorImagePropertiesDialog open onClose={() => {}} />,
      inlinePictureDocument()
    );
    await ready();
    await selectDrawing();
    await act(async () => {
      await Promise.resolve();
    });
    const dialog = within(view.container).getByRole('dialog');
    expect(
      within(dialog).getByText('Position is available only for floating images.')
    ).toBeTruthy();
    expect(within(dialog).queryByLabelText('Horizontal offset')).toBeNull();
  });

  test('apply writes position with properties in one command', async () => {
    const { view, editor, ready, selectDrawing } = mount(
      <DocxEditorImagePropertiesDialog open onClose={() => {}} />,
      anchoredSimplePosDocument(120_000, -45_000)
    );
    await ready();
    await selectDrawing();
    await act(async () => {
      await Promise.resolve();
    });
    const img = editor().getSelectedImage();
    expect(img?.kind).toBe('anchored');
    expect(img?.canMove).toBe(true);
    expect(img?.position).toEqual({
      mode: 'simple',
      horizontalEmu: 120_000,
      verticalEmu: -45_000,
    });
    const dialog = within(view.container).getByRole('dialog');
    const beforeRevision = editor().surface!.session.packageRevision();
    await act(async () => {
      fireEvent.change(within(dialog).getByLabelText('Horizontal offset'), {
        target: { value: '12' },
      });
    });
    expect(within(dialog).getByLabelText('Horizontal offset')).toHaveProperty('value', '12');
    await act(async () => {
      fireEvent.click(within(dialog).getByText('Apply'));
    });
    expect(within(dialog).queryByText('These properties could not be applied.')).toBeNull();
    expect(editor().surface!.session.packageRevision()).toBe(beforeRevision + 1);
    await selectDrawing();
    expect(editor().getSelectedImage()?.position).toEqual({
      mode: 'simple',
      horizontalEmu: 152_400,
      verticalEmu: -45_000,
    });
  });

  test('invalid position blocks apply with localized error', async () => {
    const { view, editor, ready, selectDrawing } = mount(
      <DocxEditorImagePropertiesDialog open onClose={() => {}} />,
      anchoredSimplePosDocument(0, 0)
    );
    await ready();
    await selectDrawing();
    await act(async () => {
      await Promise.resolve();
    });
    const dialog = within(view.container).getByRole('dialog');
    const beforeRevision = editor().surface!.session.packageRevision();
    await act(async () => {
      fireEvent.change(within(dialog).getByLabelText('Horizontal offset'), {
        target: { value: '1.5.5' },
      });
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByText('Apply'));
    });
    expect(
      within(dialog).getByText('Enter valid horizontal and vertical position values.')
    ).toBeTruthy();
    expect(editor().surface!.session.packageRevision()).toBe(beforeRevision);
  });

  test('cancel makes no position mutation', async () => {
    const { view, editor, ready, selectDrawing } = mount(
      <DocxEditorImagePropertiesDialog open onClose={() => {}} />,
      anchoredSimplePosDocument(120_000, -45_000)
    );
    await ready();
    await selectDrawing();
    await act(async () => {
      await Promise.resolve();
    });
    const before = editor().getSelectedImage()?.position;
    const dialog = within(view.container).getByRole('dialog');
    await act(async () => {
      fireEvent.change(within(dialog).getByLabelText('Horizontal offset'), {
        target: { value: '20' },
      });
      fireEvent.click(within(dialog).getByText('Cancel'));
    });
    await selectDrawing();
    expect(editor().getSelectedImage()?.position).toEqual(before);
  });
});

describe('authors accessible image text', () => {
  test('alt text execute writes description only', async () => {
    function AltWriter() {
      const { execute, isEnabled } = useEditorValueCommand('image.altText');
      useEffect(() => {
        if (isEnabled) execute('Screen reader description');
      }, [execute, isEnabled]);
      return null;
    }
    const { editor, ready, selectDrawing } = mount(
      <AltWriter />,
      inlinePictureDocument(
        '<wp:wrapSquare wrapText="bothSides" distT="1" distB="2" distL="3" distR="4"/>'
      )
    );
    await ready();
    await selectDrawing();
    await act(async () => {
      await Promise.resolve();
    });
    expect(editor().getSelectedImage()?.description).toBe('Screen reader description');
    expect(editor().getSelectedImage()?.name).toBe('green');
  });
});

describe('renders semantic image resize handles', () => {
  function overlayHandles(container: HTMLElement): HTMLElement[] {
    return [...container.querySelectorAll<HTMLElement>('.docx-image-selection-overlay__handle')];
  }

  test('shows eight handles for a selected inline picture', async () => {
    const { view, ready, selectDrawing } = mount(null, inlinePictureDocument());
    await ready();
    await selectDrawing();
    await act(async () => {
      await Promise.resolve();
    });
    expect(overlayHandles(view.container)).toHaveLength(8);
    expect(
      view.container
        .querySelector('.docx-image-selection-overlay__frame')
        ?.classList.contains('docx-editor-one-surface__overlay-control')
    ).toBe(true);
  });

  test('shows no overlay for plain text selection', async () => {
    const { view, editor, ready } = mount(null, PLAIN_SOURCE);
    await ready();
    placeTextCaret(editor());
    await act(async () => {
      await Promise.resolve();
    });
    expect(view.container.querySelector('.docx-image-selection-overlay')).toBeNull();
  });

  test('does not steal focus when image context changes without an image pointer press', async () => {
    const { editor, ready, selectDrawing } = mount(null, inlinePictureDocument());
    await ready();
    const focusedBefore = document.activeElement?.tagName;
    await selectDrawing();

    expect(editor().surface).not.toBeNull();
    expect(document.activeElement?.tagName).toBe(focusedBefore);
  });
});

describe('previews pointer gestures and commits once', () => {
  test('inline resize commits one setImageProperties on pointerup', async () => {
    const { view, editor, ready, selectDrawing } = mount(null, inlinePictureDocument());
    await ready();
    await selectDrawing();
    await act(async () => {
      await Promise.resolve();
    });
    const exec = editor().exec.bind(editor());
    let execCount = 0;
    editor().exec = (command) => {
      execCount += 1;
      return exec(command);
    };
    const handle = view.container.querySelector<HTMLElement>(
      '.docx-image-selection-overlay__handle[aria-label="Resize bottom-right corner"]'
    );
    expect(handle).not.toBeNull();
    const beforeRevision = editor().surface!.session.packageRevision();
    // The drag binds its window listeners once, not once per pointer move.
    const addListener = window.addEventListener.bind(window);
    let moveBinds = 0;
    window.addEventListener = ((type: string, ...rest: [never, never?]) => {
      if (type === 'pointermove') moveBinds += 1;
      return addListener(type, ...rest);
    }) as typeof window.addEventListener;
    fireEvent.pointerDown(handle!, { clientX: 100, clientY: 100, pointerId: 1, button: 0 });
    for (const point of [120, 130, 140]) {
      fireEvent(
        window,
        new PointerEvent('pointermove', {
          clientX: point,
          clientY: point,
          bubbles: true,
          pointerId: 1,
        })
      );
    }
    window.addEventListener = addListener;
    expect(moveBinds).toBe(1);
    expect(editor().surface!.session.packageRevision()).toBe(beforeRevision);
    fireEvent(
      window,
      new PointerEvent('pointerup', { clientX: 140, clientY: 140, bubbles: true, pointerId: 1 })
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(execCount).toBe(1);
    expect(editor().surface!.session.packageRevision()).toBe(beforeRevision + 1);
  });

  test('pointerup recomputes commit from release coordinates without a final pointermove', async () => {
    const { view, editor, ready, selectDrawing } = mount(null, inlinePictureDocument());
    await ready();
    await selectDrawing();
    await act(async () => {
      await Promise.resolve();
    });
    const beforeWidth = editor().getSelectedImage()!.widthEmu;
    const exec = editor().exec.bind(editor());
    let committedWidth: number | undefined;
    editor().exec = (command) => {
      if (command.type === 'setImageProperties' && command.widthEmu !== undefined) {
        committedWidth = command.widthEmu;
      }
      return exec(command);
    };
    const handle = view.container.querySelector<HTMLElement>(
      '.docx-image-selection-overlay__handle[aria-label="Resize right edge"]'
    )!;
    fireEvent.pointerDown(handle, { clientX: 100, clientY: 100, pointerId: 3, button: 0 });
    fireEvent(
      window,
      new PointerEvent('pointermove', { clientX: 120, clientY: 100, bubbles: true, pointerId: 3 })
    );
    fireEvent(
      window,
      new PointerEvent('pointerup', { clientX: 160, clientY: 100, bubbles: true, pointerId: 3 })
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(committedWidth).toBeGreaterThan(beforeWidth);
    await selectDrawing();
    expect(editor().getSelectedImage()!.widthEmu).toBe(committedWidth);
    expect(editor().getSelectedImage()!.widthEmu).toBeGreaterThan(beforeWidth + 12_700 * 10);
  });

  test('pointercancel clears preview without mutation', async () => {
    const { view, editor, ready, selectDrawing } = mount(null, inlinePictureDocument());
    await ready();
    await selectDrawing();
    await act(async () => {
      await Promise.resolve();
    });
    const handle = view.container.querySelector<HTMLElement>(
      '.docx-image-selection-overlay__handle[aria-label="Resize right edge"]'
    )!;
    const beforeRevision = editor().surface!.session.packageRevision();
    fireEvent.pointerDown(handle, { clientX: 100, clientY: 100, pointerId: 2, button: 0 });
    fireEvent(window, new PointerEvent('pointercancel', { bubbles: true, pointerId: 2 }));
    expect(editor().surface!.session.packageRevision()).toBe(beforeRevision);
  });
});

describe('moves and resizes selected images by keyboard', () => {
  function overlayRoot(container: HTMLElement): HTMLElement {
    const root = container.querySelector<HTMLElement>('.docx-image-selection-overlay');
    if (!root) throw new Error('overlay missing');
    return root;
  }

  test('Delete removes the selected drawing', async () => {
    const { view, editor, ready, selectDrawing } = mount(null, inlinePictureDocument());
    await ready();
    await selectDrawing();
    await act(async () => {
      await Promise.resolve();
    });
    const beforeRevision = editor().surface!.session.packageRevision();
    fireEvent.keyDown(overlayRoot(view.container), { key: 'Delete' });
    await act(async () => {
      await Promise.resolve();
    });
    expect(editor().surface!.session.packageRevision()).toBeGreaterThan(beforeRevision);
  });

  test('Alt+Arrow resizes without moving inline selection', async () => {
    const { view, editor, ready, selectDrawing } = mount(null, inlinePictureDocument());
    await ready();
    await selectDrawing();
    await act(async () => {
      await Promise.resolve();
    });
    const beforeWidth = editor().getSelectedImage()!.widthEmu;
    fireEvent.keyDown(overlayRoot(view.container), {
      key: 'ArrowRight',
      altKey: true,
    });
    await act(async () => {
      await Promise.resolve();
    });
    await selectDrawing();
    expect(editor().getSelectedImage()!.widthEmu).toBeGreaterThan(beforeWidth);
  });

  test('does not intercept keys when overlay is unfocused and target is an input', async () => {
    const { view, editor, ready, selectDrawing } = mount(
      <input data-testid="probe" defaultValue="hello" />,
      inlinePictureDocument()
    );
    await ready();
    await selectDrawing();
    await act(async () => {
      await Promise.resolve();
    });
    const input = view.getByTestId('probe');
    input.focus();
    const beforeRevision = editor().surface!.session.packageRevision();
    fireEvent.keyDown(input, { key: 'Delete' });
    expect(editor().surface!.session.packageRevision()).toBe(beforeRevision);
  });
});

describe('task 16 fix round 1 — overlay coordinates and scroll port', () => {
  test('uses surface overlayCoordinates paint scale for handle placement', async () => {
    const { view, editor, ready, selectDrawing } = mount(null, inlinePictureDocument());
    await ready();
    await selectDrawing();
    await act(async () => {
      await Promise.resolve();
    });
    const coordinates = editor().surface!.overlayCoordinates();
    expect(coordinates.paintScale).toBeCloseTo(96 / 72, 8);
    const handle = view.container.querySelector<HTMLElement>(
      '.docx-image-selection-overlay__handle[aria-label="Resize bottom-right corner"]'
    );
    expect(handle).not.toBeNull();
    expect(handle!.style.left).toMatch(/px/);
  });
});

for (const disabled of [false, true]) {
  test(`image popup callbacks and false control automatic rendering (${disabled})`, async () => {
    const { view, ready, selectDrawing } = mount(<DocxEditorToolbar />, inlinePictureDocument(), {
      imageProperties: disabled
        ? false
        : (props) => (
            <button data-testid="custom-image-properties" onClick={props.onClose}>
              Close properties
            </button>
          ),
      imageAltText: disabled
        ? false
        : (props) => (
            <button data-testid="custom-image-alt" onClick={props.onClose}>
              Close alt
            </button>
          ),
    });
    await ready();
    await selectDrawing();
    await act(async () => {
      fireEvent.click(view.container.querySelector('[data-slot="image.properties"]')!);
    });
    expect(!!within(view.container).queryByTestId('custom-image-properties')).toBe(!disabled);
    if (!disabled)
      await act(async () => {
        fireEvent.click(within(view.container).getByTestId('custom-image-properties'));
      });
    await act(async () => {
      fireEvent.click(view.container.querySelector('[data-slot="image.altText"]')!);
    });
    expect(!!within(view.container).queryByTestId('custom-image-alt')).toBe(!disabled);
    if (!disabled) {
      await act(async () => {
        fireEvent.click(within(view.container).getByTestId('custom-image-alt'));
      });
      expect(within(view.container).queryByTestId('custom-image-alt')).toBeNull();
    }
    expect(within(view.container).queryByRole('dialog')).toBeNull();
  });
}

test('a portaled image alt-text popup keeps pointer input inside its owner', async () => {
  const { view, ready, selectDrawing } = mount(<DocxEditorToolbar />, inlinePictureDocument(), {
    imageAltText: (props) =>
      createPortal(
        <div id={props.id} data-testid="portaled-alt-text">
          <input
            aria-label="Custom alt text"
            value={props.value}
            onChange={(event) => props.onValueChange(event.target.value)}
          />
        </div>,
        document.body
      ),
  });
  await ready();
  await selectDrawing();
  await act(async () => {
    fireEvent.click(view.container.querySelector('[data-slot="image.altText"]')!);
  });
  const input = document.querySelector<HTMLInputElement>('[aria-label="Custom alt text"]')!;
  expect(input).not.toBeNull();
  await act(async () => {
    fireEvent.mouseDown(input);
    fireEvent.change(input, { target: { value: 'Draft in portal' } });
  });
  expect(document.querySelector('[data-testid="portaled-alt-text"]')).not.toBeNull();
  expect(input.value).toBe('Draft in portal');
  await act(async () => {
    fireEvent.mouseDown(document.body);
  });
  expect(document.querySelector('[data-testid="portaled-alt-text"]')).toBeNull();
});
