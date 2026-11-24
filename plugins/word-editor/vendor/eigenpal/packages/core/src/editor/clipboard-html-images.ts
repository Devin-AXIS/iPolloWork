// Bounded `data:`-URI image projection for the external-HTML read lane — split from
// clipboard-html-read.ts at the max-lines cap. Never fetches: the base64 decode is
// size-capped BEFORE any allocation and the bytes are magic-byte sniffed.

import { sniffImageMime, validateRasterHeader } from '../store/package/image-resources.ts';
import { clipboardDecodeBase64 } from './clipboard-html-base64.ts';
import { imageDimensionPx, parseInlineStyle } from './clipboard-html-styles.ts';

const PIC_NS = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

const DATA_IMAGE_RE =
  /^data:image\/(?:png|jpeg|jpg|gif|bmp|webp|svg\+xml|tiff|tif|x-emf|emf|x-wmf|wmf);base64,([A-Za-z0-9+/=]+)$/i;

const IMAGE_EXTENSIONS: ReadonlyMap<string, string> = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpeg'],
  ['image/gif', 'gif'],
  ['image/bmp', 'bmp'],
  ['image/webp', 'webp'],
  ['image/svg+xml', 'svg'],
  ['image/tiff', 'tiff'],
  ['image/x-emf', 'emf'],
  ['image/x-wmf', 'wmf'],
]);

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** The projection state slice the image lane reads and advances. */
export interface HtmlImageProjectionState {
  readonly maxImageBytes: number;
  readonly wordHtml: boolean;
  imageCount: number;
  docPrId: number;
  readonly media: Map<string, Uint8Array>;
  readonly mediaExtensions: Map<string, string>;
  /** Media part per `src`, so a repeated image decodes and ships exactly once. */
  readonly mediaBySrc: Map<string, string>;
}

/** Project a `data:` image into a media part + rel + inline `w:drawing` run. */
export function projectHtmlImage(
  element: Element,
  runs: string[],
  p: HtmlImageProjectionState,
  allocateImageRel: (target: string) => string
): void {
  const src = element.getAttribute('src');
  if (src === null || src.length > p.maxImageBytes * 2) return;
  const match = DATA_IMAGE_RE.exec(src);
  if (!match) return; // External/blob/http sources drop with no fetch.
  // A repeated src reuses its media part: one decode, one part, one rel per use.
  const cachedPart = p.mediaBySrc.get(src);
  const cachedBytes = cachedPart === undefined ? undefined : p.media.get(cachedPart);
  const bytes = cachedBytes ?? clipboardDecodeBase64(match[1]!, p.maxImageBytes);
  if (bytes === null || bytes === undefined) return;
  const sniffed = sniffImageMime(bytes);
  const extension = IMAGE_EXTENSIONS.get(sniffed);
  if (extension === undefined) return;
  const header =
    sniffed === 'image/png' ||
    sniffed === 'image/jpeg' ||
    sniffed === 'image/gif' ||
    sniffed === 'image/bmp' ||
    sniffed === 'image/webp'
      ? validateRasterHeader(bytes, sniffed)
      : null;

  const style = parseInlineStyle(element);
  let widthPx = imageDimensionPx(element, style, 'width', p.wordHtml);
  let heightPx = imageDimensionPx(element, style, 'height', p.wordHtml);
  // A sniffed image whose header does not parse keeps its declared CSS extents,
  // completing a missing axis at the 3:2 fallback ratio.
  if (header !== null) {
    if (widthPx === null && heightPx === null) {
      widthPx = (header.pixelWidth * 96) / (header.dpiX ?? 96);
      heightPx = (header.pixelHeight * 96) / (header.dpiY ?? 96);
    } else if (widthPx !== null && heightPx === null) {
      heightPx = (widthPx * header.pixelHeight) / header.pixelWidth;
    } else if (widthPx === null && heightPx !== null) {
      widthPx = (heightPx * header.pixelWidth) / header.pixelHeight;
    }
  } else if (widthPx !== null && heightPx === null) {
    heightPx = (widthPx * 2) / 3;
  } else if (widthPx === null && heightPx !== null) {
    widthPx = (heightPx * 3) / 2;
  }
  // Unknown extent falls back to 300x200pt.
  const cx = widthPx === null ? 3_810_000 : clamp(Math.round(widthPx * 9525), 9525, 30_000_000);
  const cy = heightPx === null ? 2_540_000 : clamp(Math.round(heightPx * 9525), 9525, 30_000_000);

  let partName = cachedBytes === undefined ? undefined : cachedPart;
  if (partName === undefined) {
    p.imageCount += 1;
    partName = `word/media/image${p.imageCount}.${extension}`;
    p.media.set(partName, bytes);
    p.mediaBySrc.set(src, partName);
    if (!p.mediaExtensions.has(extension)) p.mediaExtensions.set(extension, sniffed);
  }
  const relId = allocateImageRel(partName.replace('word/', ''));
  p.docPrId += 1;
  runs.push(
    '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
      `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${p.docPrId}" name=""/>` +
      `<wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="${PIC_NS}"><pic:pic>` +
      '<pic:nvPicPr><pic:cNvPr id="0" name="" descr=""/><pic:cNvPicPr/></pic:nvPicPr>' +
      `<pic:blipFill><a:blip r:embed="${relId}"/>` +
      '<a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
      '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
  );
}
