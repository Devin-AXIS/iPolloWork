// Decode ports, drawing fixture snippets and record walks shared by the image-resource
// suites (header/footer, footnote/endnote and text-box stories).
//
// Image resources resolve ASYNCHRONOUSLY: the first pass publishes `pending`, the decode
// settles, and a later pass must pick the ready record up. Suites that assert on that
// window need the SAME gate-and-release port and the same settle cadence, or a fix to one
// copy leaves the other silently asserting post-decode — a test that passes with the
// invalidation deleted. Nothing here touches the DOM at module scope.

import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { validateRasterHeader, type ImageDecodePort } from '../../store/package/image-resources.ts';
import { resolveImageResourceLimits } from '../../store/runtime/limits.ts';
import type { BlockFragmentRecord } from '../../layout/semantic-records.ts';

export const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
export const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
export const OD_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
export const IMG_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const WP_NS = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC_NS = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const WPS_NS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';

/** Root-element namespace declarations covering every snippet below. */
export const DRAWING_NS =
  `xmlns:w="${W_NS}" xmlns:wp="${WP_NS}" xmlns:a="${A_NS}" ` +
  `xmlns:pic="${PIC_NS}" xmlns:r="${R_NS}" xmlns:wps="${WPS_NS}"`;

export const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (c) => c.charCodeAt(0)
);

/** A `pic:pic` graphic referencing the part's `rIdImg` image relationship. */
export function picture(id: number): string {
  return (
    `<a:graphic><a:graphicData uri="${PIC_NS}"><pic:pic>` +
    `<pic:nvPicPr><pic:cNvPr id="${id}" name="pic"/><pic:cNvPicPr/></pic:nvPicPr>` +
    '<pic:blipFill><a:blip r:embed="rIdImg"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:ext cx="457200" cy="457200"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic>'
  );
}

export function inlinePicture(id: number): string {
  return (
    '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
    `<wp:extent cx="457200" cy="457200"/><wp:docPr id="${id}" name="pic"/>` +
    `${picture(id)}</wp:inline></w:drawing></w:r>`
  );
}

/** An anchored `wps:txbx` text box with the given extent height and story content. */
function anchoredTextbox(cyEmu: number, storyContent: string): string {
  return (
    '<w:r><w:drawing>' +
    '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" ' +
    'layoutInCell="1" allowOverlap="1" relativeHeight="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
    `<wp:extent cx="2743200" cy="${cyEmu}"/><wp:wrapNone/><wp:docPr id="10" name="box"/>` +
    `<a:graphic><a:graphicData uri="${WPS_NS}">` +
    '<wps:wsp><wps:cNvSpPr txBox="1"/>' +
    `<wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2743200" cy="${cyEmu}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"/></wps:spPr>' +
    `<wps:txbx><w:txbxContent>${storyContent}</w:txbxContent></wps:txbx>` +
    '<wps:bodyPr/></wps:wsp>' +
    '</a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>'
  );
}

/** An anchored text box whose story holds one inline picture. */
export function textboxWithPicture(): string {
  return anchoredTextbox(
    1828800,
    `<w:p><w:r><w:t>in the box</w:t></w:r>${inlinePicture(11)}</w:p>`
  );
}

/**
 * An anchored text box too short for its story, whose picture the height clip drops.
 *
 * The extent height (91440 EMU = 7.2pt) equals the default vertical insets, so the content
 * height is zero and `layoutTextboxStory` drops every fragment — the picture flows, its
 * decode is scheduled, but no laid-out record carries it (`textbox-height-clip`).
 */
export function textboxWithClippedPicture(): string {
  return anchoredTextbox(
    91440,
    `<w:p><w:r><w:t>in the box</w:t></w:r></w:p><w:p>${inlinePicture(11)}</w:p>`
  );
}

export function decodeBytes(
  bytes: Uint8Array,
  mime: string
): { pixelWidth: number; pixelHeight: number } {
  const header = validateRasterHeader(bytes, mime);
  if (!header) throw new Error('invalid raster');
  const limits = resolveImageResourceLimits();
  if (header.pixelWidth * header.pixelHeight > limits.maxPixels) throw new Error('too large');
  return header;
}

/** Validates the real bytes, like the browser port does, but without a browser. */
export function decodePort(): ImageDecodePort {
  return Object.freeze({
    async decode(bytes, mime) {
      return Object.freeze({ ...decodeBytes(bytes, mime), dpiX: 96, dpiY: 96 });
    },
  });
}

/**
 * A decode port that does not settle until told to.
 *
 * The invalidation half of a resource fix is only observable if a layout is READ while the
 * picture is still pending. A port that resolves on its own microtask makes every assertion
 * a post-decode one, and a test written that way passes with the invalidation removed
 * entirely.
 */
export function deferredDecodePort(): { port: ImageDecodePort; release: () => void } {
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    port: Object.freeze({
      async decode(bytes, mime) {
        await gate;
        return Object.freeze({ ...decodeBytes(bytes, mime), dpiX: 96, dpiY: 96 });
      },
    }),
    release: () => release(),
  };
}

/** Resource resolution and the relayout it triggers are both asynchronous. */
export async function settle(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) await new Promise((resolve) => setTimeout(resolve, 5));
}

/** Resource kinds of the line drawings in a block list, table interiors included. */
export function blockDrawingKinds(blocks: readonly BlockFragmentRecord[]): string[] {
  const kinds: string[] = [];
  const visit = (block: BlockFragmentRecord): void => {
    if (block.kind === 'table') {
      for (const row of block.rows) {
        for (const cell of row.cells) for (const inner of cell.blocks) visit(inner);
      }
      return;
    }
    for (const line of block.lines) {
      for (const drawing of line.drawings ?? []) kinds.push(drawing.resource.kind);
    }
  };
  for (const block of blocks) visit(block);
  return kinds;
}

export async function mountWithImages(
  bytes: Uint8Array,
  port: ImageDecodePort = decodePort()
): Promise<{ surface: PaginatedSurface; container: HTMLElement }> {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, bytes, {
    scale: 1,
    imageDecodePort: port,
  });
  if (!opened.ok) throw new Error(opened.reason);
  await settle();
  return { surface: opened.surface, container };
}
