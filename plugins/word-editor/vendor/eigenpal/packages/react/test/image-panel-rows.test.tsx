// Image parts in the toolbar's "⋯" panel are whole-row buttons that open their popups.
//
// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import type { DocxEditorInstance, ImageDecodePort } from '@docx-editor.dev/core/editor';
import { resolveImageResourceLimits, validateRasterHeader } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { DocxEditorToolbar } from '../src/editor/toolbar/index.ts';
import {
  ToolbarImageAltText,
  ToolbarImageInsert,
  ToolbarImageProperties,
  ToolbarImageWrap,
} from '../src/editor/images/index.ts';
import { ToolbarPlacementContext } from '../src/editor/toolbar/ToolbarGroup.tsx';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (c) => c.charCodeAt(0)
);

function inlinePictureDocument(): Uint8Array {
  const drawing =
    '<wp:inline distT="0" distB="0" distL="0" distR="0">' +
    '<wp:extent cx="914400" cy="914400"/>' +
    '<wp:docPr id="1" name="green" descr="Green square"/>' +
    '<wp:cNvGraphicFramePr/>' +
    `<a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC}">` +
    `<pic:pic xmlns:pic="${PIC}"><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>` +
    '<pic:blipFill><a:blip r:embed="rIdImage"><a:stretch><a:fillRect/></a:stretch></a:blip></pic:blipFill>' +
    '<pic:spPr><a:xfrm rot="0"><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic></wp:inline>';
  const body =
    `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    `<w:body><w:p><w:r><w:t>before</w:t></w:r><w:r><w:drawing>${drawing}</w:drawing></w:r><w:r><w:t>after</w:t></w:r></w:p></w:body></w:document>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Default Extension="png" ContentType="image/png"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
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

const decodePort: ImageDecodePort = {
  async decode(bytes, mime) {
    const header = validateRasterHeader(bytes, mime);
    if (!header) throw new Error('invalid image');
    if (header.pixelWidth * header.pixelHeight > resolveImageResourceLimits().maxPixels) {
      throw new Error('too large');
    }
    return Object.freeze({
      pixelWidth: header.pixelWidth,
      pixelHeight: header.pixelHeight,
      dpiX: 96,
      dpiY: 96,
    });
  },
};

function mount(ui: ReactNode): {
  view: ReturnType<typeof render>;
  ready: () => Promise<void>;
  selectDrawing: () => Promise<void>;
} {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={inlinePictureDocument()}
      imageDecodePort={decodePort}
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
  return {
    view,
    ready: async () => {
      for (let attempt = 0; attempt < 50 && !instance?.surface; attempt++) {
        await act(async () => {
          await Promise.resolve();
        });
      }
    },
    selectDrawing: async () => {
      const editor = instance!;
      const paragraphId = editor.surface!.session.paragraphIds()[0]!;
      editor.surface!.setSelection({
        anchor: { paragraphId, offset: 6 },
        head: { paragraphId, offset: 6 },
      });
      // Wait for the picture to decode and the selection to reach the toolbar.
      for (
        let attempt = 0;
        attempt < 50 &&
        (!editor.getSelectedImage() || editor.snapshot().image?.resourceStatus === 'pending');
        attempt++
      ) {
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
          editor.surface?.layout();
        });
      }
    },
  };
}

const RealResizeObserver = global.ResizeObserver;

afterEach(() => {
  cleanup();
  global.ResizeObserver = RealResizeObserver;
});

describe('image parts as "⋯" panel rows', () => {
  test('each part is a full-width labelled row, and a click opens its popup', async () => {
    const { view, ready, selectDrawing } = mount(
      <ToolbarPlacementContext.Provider value="panel">
        <ToolbarImageInsert />
        <ToolbarImageProperties />
        <ToolbarImageWrap />
        <ToolbarImageAltText />
      </ToolbarPlacementContext.Provider>
    );
    await ready();
    await selectDrawing();
    const row = (slot: string) =>
      view.container.querySelector<HTMLButtonElement>(`button[data-slot="${slot}"]`)!;

    for (const slot of ['image.insert', 'image.properties', 'image.wrap', 'image.altText']) {
      const button = row(slot);
      expect(button).not.toBeNull();
      // The whole row is the button, labelled like the panel's command rows.
      expect(button.classList.contains('docx-toolbar__more-command')).toBe(true);
      expect(button.classList.contains('docx-toolbar__button')).toBe(false);
      const label = button.querySelector('.docx-toolbar__more-command-label')?.textContent;
      expect(label).toBeTruthy();
    }
    // Inserting is not offered while an image is selected; the other three are.
    expect(row('image.insert').disabled).toBe(true);

    await act(async () => {
      row('image.wrap').click();
    });
    expect(view.container.querySelector('[role="menu"]')).not.toBeNull();
    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    });

    await act(async () => {
      row('image.altText').click();
    });
    expect(row('image.altText').getAttribute('aria-expanded')).toBe('true');

    const dialogs = () => document.querySelectorAll('[role="dialog"]').length;
    const before = dialogs();
    await act(async () => {
      row('image.properties').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(dialogs()).toBeGreaterThan(before);
  });

  test('in the bar, the same parts stay icon buttons', async () => {
    const { view, ready, selectDrawing } = mount(
      <>
        <ToolbarImageWrap />
        <ToolbarImageAltText />
      </>
    );
    await ready();
    await selectDrawing();
    for (const slot of ['image.wrap', 'image.altText']) {
      const button = view.container.querySelector(`button[data-slot="${slot}"]`)!;
      expect(button.classList.contains('docx-toolbar__button')).toBe(true);
      expect(button.querySelector('.docx-toolbar__more-command-label')).toBeNull();
    }
  });
});

test('a selected image collapsed into More shows clickable rows', async () => {
  // A minimal measurement mock: every group is wider than the bar, so all collapse into More.
  const observers: Array<() => void> = [];
  const RealResizeObserver = global.ResizeObserver;
  global.ResizeObserver = class {
    constructor(callback: ResizeObserverCallback) {
      observers.push(() => callback([], this as unknown as ResizeObserver));
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  try {
    const { view, ready, selectDrawing } = mount(
      <DocxEditorToolbar t={(key) => (key === 'formattingBar.more' ? 'More' : key)} />
    );
    await ready();
    await selectDrawing();
    // Other test files can leave mounts in the body, so query inside this mount only.
    const scope = within(view.container);
    const toolbar = scope.getByTestId('docx-toolbar');
    Object.defineProperty(toolbar, 'clientWidth', { configurable: true, get: () => 200 });
    for (const node of toolbar.querySelectorAll('[data-toolbar-group], [data-toolbar-fixed]')) {
      Object.defineProperty(node, 'offsetWidth', { configurable: true, get: () => 150 });
    }
    await act(async () => {
      for (const flush of observers) flush();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    await act(async () => {
      (scope.getByLabelText('More') as HTMLButtonElement).click();
    });
    const panel = scope.getByTestId('toolbar-overflow-panel');
    for (const slot of ['image.properties', 'image.wrap', 'image.altText']) {
      const button = panel.querySelector<HTMLButtonElement>(`button[data-slot="${slot}"]`);
      expect(button).not.toBeNull();
      expect(button!.disabled).toBe(false);
      expect(button!.classList.contains('docx-toolbar__more-command')).toBe(true);
      // Not a plain-text label beside a small icon button.
      expect(button!.closest('.docx-toolbar__more-control')).toBeNull();
    }
    await act(async () => {
      panel.querySelector<HTMLButtonElement>('button[data-slot="image.wrap"]')!.click();
    });
    expect(panel.querySelector('[role="menu"]')).not.toBeNull();
    // Opening the wrap menu keeps More open, so the choice can be made.
    expect(scope.queryByTestId('toolbar-overflow-panel')).not.toBeNull();
  } finally {
    global.ResizeObserver = RealResizeObserver;
  }
});
