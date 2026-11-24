// The public decoder must reach both React hosts and keep its owner lifetime.
import './dom-setup.ts';
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditor } from '../src/components/DocxEditor.tsx';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { validateRasterHeader, type ImageDecodePort } from '@docx-editor.dev/core/editor';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (c) => c.charCodeAt(0)
);
const SOURCE = zipSync({
  '[Content_Types].xml': strToU8(
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  ),
  '_rels/.rels': strToU8(
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="office" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
  ),
  'word/_rels/document.xml.rels': strToU8(
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="picture" Type="${R}/image" Target="media/pixel.png"/></Relationships>`
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body><w:p><w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="pixel"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="pixel"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="picture"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>`
  ),
  'word/media/pixel.png': PNG,
});

function observedPort(hold = false) {
  const calls: { signal: AbortSignal | undefined; mime: string }[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const port: ImageDecodePort = Object.freeze({
    async decode(bytes, mime, _limits, signal) {
      const header = validateRasterHeader(bytes, mime);
      if (!header) throw new Error('Invalid synthetic PNG');
      calls.push({ signal, mime });
      if (hold) await gate;
      return Object.freeze({ ...header, dpiX: 96, dpiY: 96 });
    },
  });
  return { port, calls, release };
}

afterEach(cleanup);
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));
function tree(host: 'root' | 'sugar', port: ImageDecodePort, onReady: (editor: unknown) => void) {
  return host === 'sugar' ? (
    <DocxEditor document={SOURCE} imageDecodePort={port} onReady={onReady} />
  ) : (
    <DocxEditorRoot document={SOURCE} imageDecodePort={port} onReady={onReady}>
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
}
describe('imageDecodePort prop', () => {
  for (const host of ['root', 'sugar'] as const) {
    test(`${host} decodes the source image and preserves it on save`, async () => {
      const observed = observedPort(),
        ready: DocxEditorInstance[] = [];
      const onReady = (editor: unknown) => ready.push(editor as DocxEditorInstance);
      let mounted!: ReturnType<typeof render>;
      await act(async () => {
        mounted = render(tree(host, observed.port, onReady));
      });
      await act(settle);
      expect(observed.calls.length).toBeGreaterThan(0);
      expect(observed.calls.every((call) => call.mime === 'image/png')).toBe(true);
      expect(ready).toHaveLength(1);
      const saved = await ready[0]!.save();
      expect(unzipSync(new Uint8Array(saved))['word/media/pixel.png']).toEqual(PNG);
      const replacement = observedPort();
      await act(async () => {
        mounted.rerender(tree(host, replacement.port, onReady));
      });
      await act(settle);
      expect(ready).toHaveLength(2);
      expect(replacement.calls.length).toBeGreaterThan(0);
    });
    test(`${host} aborts pending decode when unmounted`, async () => {
      const observed = observedPort(true);
      let mounted!: ReturnType<typeof render>;
      await act(async () => {
        mounted = render(tree(host, observed.port, () => {}));
      });
      await act(settle);
      expect(observed.calls.length).toBeGreaterThan(0);
      expect(observed.calls[0]!.signal?.aborted).toBe(false);
      await act(async () => {
        mounted.unmount();
        observed.release();
      });
      expect(observed.calls[0]!.signal?.aborted).toBe(true);
    });
  }
});
