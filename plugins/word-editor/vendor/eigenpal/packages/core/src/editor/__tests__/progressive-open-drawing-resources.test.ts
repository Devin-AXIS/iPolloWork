// A picture that finishes decoding while a large document opens in slices waits for the end of
// the opening: the slices still to come lay out with it, and the opening's final layout shows
// it. Laying the document out again at the settle finished the paused slice and relaid the
// whole prefix in one task, for every picture that settled during the opening.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { forEachSemanticDrawing } from '../../layout/index.ts';
import type { SemanticLayout } from '../../layout/semantic-records.ts';
import type { ImageDecodePort } from '../../store/package/image-resources.ts';
import { validateRasterHeader } from '../../store/package/image-resources.ts';
import { mountPaginatedSurface } from '../paginated-surface.ts';
import { continueProgressiveOpen, progressiveOpenPending } from '../surface-progressive-open.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (c) => c.charCodeAt(0)
);

/** A picture in the first paragraph, then far more paragraphs than the first slice holds. */
function docx(): Uint8Array {
  const picture =
    '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
    '<wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="Picture 1"/>' +
    `<a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/>` +
    '<pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImage"/>' +
    '<a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm>' +
    '<a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic>' +
    '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  const paragraphs = [`<w:p><w:r><w:t>Before</w:t></w:r>${picture}</w:p>`];
  for (let index = 0; index < 600; index += 1) {
    paragraphs.push(`<w:p><w:r><w:t>Body paragraph ${index} with some text.</w:t></w:r></w:p>`);
  }
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Default Extension="png" ContentType="image/png"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdImage" Type="${R}/image" Target="media/image1.png"/></Relationships>`
    ),
    'word/media/image1.png': PNG_1X1,
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
        `<w:body>${paragraphs.join('')}<w:sectPr/></w:body></w:document>`
    ),
  });
}

/** A decode port whose decodes settle only when the test says so. */
function heldDecodePort(): { port: ImageDecodePort; calls: () => number; release: () => void } {
  const waiting: (() => void)[] = [];
  let calls = 0;
  const port = Object.freeze({
    decode(bytes: Uint8Array, mime: string) {
      calls += 1;
      const header = validateRasterHeader(bytes, mime as never);
      return new Promise((resolve, reject) => {
        waiting.push(() =>
          header
            ? resolve({
                pixelWidth: header.pixelWidth,
                pixelHeight: header.pixelHeight,
                dpiX: 96,
                dpiY: 96,
              })
            : reject(new Error('invalid image'))
        );
      });
    },
  }) as unknown as ImageDecodePort;
  return { port, calls: () => calls, release: () => waiting.splice(0).forEach((go) => go()) };
}

function pictureStates(layout: SemanticLayout): string[] {
  const states: string[] = [];
  forEachSemanticDrawing(layout, ({ drawing }) => states.push(drawing.resource.kind));
  return states;
}

const tick = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

test('a picture that settles during a sliced open waits for the opening to end', async () => {
  const decode = heldDecodePort();
  const container = document.createElement('div');
  document.body.append(container);
  const mounted = mountPaginatedSurface(container, docx(), {
    progressiveOpen: true,
    imageDecodePort: decode.port,
  } as Parameters<typeof mountPaginatedSurface>[2]);
  if (!mounted.ok) throw new Error(mounted.reason);
  const surface = mounted.surface;
  try {
    expect(progressiveOpenPending(surface)).toBe(true);
    expect(decode.calls()).toBeGreaterThan(0);
    expect(pictureStates(surface.layout())).toEqual(['pending']);
    // A composition holds the slices, so only the settle could lay the document out here.
    const pages = container.querySelector('.docx-pages')!;
    pages.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    const before = surface.layout();
    decode.release();
    for (let index = 0; index < 10; index += 1) await tick();
    expect(surface.layout()).toBe(before);
    expect(progressiveOpenPending(surface)).toBe(true);
    pages.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }));
    while (!continueProgressiveOpen(surface, 0)) {
      // The opening goes on once the composition ends.
    }
    // The opening's final layout shows the settled picture.
    expect(pictureStates(surface.layout())).toEqual(['ready']);
  } finally {
    surface.destroy();
    container.remove();
  }
}, 60_000);
