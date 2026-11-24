// Browser image decode port for embedded drawing resources (typed-drawings-and-images task 6).
//
// Validates through the same decode contract as tests; layout never reads raw bytes directly.

import type {
  ImageDecodePort,
  MetafileImageMime,
  PreservedImageMime,
  SupportedImageMime,
} from '../store/package/image-resources.ts';
import type { ImageResourceLimits } from '../store/runtime/limits.ts';
import { drawingRenderers, metafileRasterOptions } from '../store/package/drawing-renderers.ts';
import { decodeTiffFrame } from '../store/package/tiff-frame.ts';

export { decodeTiffFrame, type DecodedTiffFrame } from '../store/package/tiff-frame.ts';

/**
 * Output bounds handed to every metafile rasterizer, well under every resource pixel cap. It
 * matches the 2048-pixel preview limit in `metafileRasterOptions` and the documentation.
 */
const MAX_METAFILE_RASTER_EDGE = 2048;

/** A converted raster, or null when the format was declined and the placeholder stands. */
type ConvertedRaster = Readonly<{ bytes: Uint8Array; mime: SupportedImageMime }> | null;

/**
 * Decode raster headers in the browser via `createImageBitmap`, or null when unavailable.
 * Also converts the formats an `<img>` cannot render — EMF/WMF metafiles through the
 * installed metafile renderer or `emf-converter`, TIFF through a lazily loaded TIFF decoder —
 * into PNG; the resource layer re-runs the converted bytes through the full raster
 * validation path before they can become a ready resource.
 */
export function tryCreateBrowserImageDecodePort(ownerDocument: Document): ImageDecodePort | null {
  if (typeof ownerDocument.defaultView?.createImageBitmap !== 'function') return null;
  const view = ownerDocument.defaultView!;
  return Object.freeze({
    async decode(bytes: Uint8Array, mime: SupportedImageMime, limits: ImageResourceLimits) {
      const blob = new Blob([new Uint8Array(bytes)], { type: mime });
      // `validateJpegHeader` reports the extent AFTER EXIF orientation; the bitmap must be
      // oriented the same way or the two disagree on portrait photos. An engine whose
      // `ImageOrientation` enum predates `from-image` rejects the dictionary with a
      // TypeError; retry without it to preserve the existing decode path. The resource
      // layer still rejects a bitmap whose dimensions disagree with the oriented header.
      let bitmap: ImageBitmap;
      try {
        bitmap = await view.createImageBitmap!(blob, { imageOrientation: 'from-image' });
      } catch (error) {
        if ((error as { name?: unknown } | null)?.name !== 'TypeError') throw error;
        bitmap = await view.createImageBitmap!(blob);
      }
      try {
        const pixelWidth = bitmap.width;
        const pixelHeight = bitmap.height;
        if (pixelWidth <= 0 || pixelHeight <= 0) {
          throw new Error('image dimensions invalid');
        }
        if (pixelWidth * pixelHeight > limits.maxPixels) {
          throw new Error('image dimensions exceed limits');
        }
        return Object.freeze({ pixelWidth, pixelHeight, dpiX: 96, dpiY: 96 });
      } finally {
        bitmap.close();
      }
    },
    convertPreserved(
      bytes: Uint8Array,
      mime: PreservedImageMime,
      limits: ImageResourceLimits
    ): Promise<ConvertedRaster> {
      return mime === 'image/tiff'
        ? convertBrowserTiff(ownerDocument, bytes, limits)
        : convertBrowserMetafile(bytes, mime, limits);
    },
  });
}

/**
 * EMF/WMF → PNG through the installed metafile renderer's rasterizer, or through the
 * `emf-converter` rasterizer when no renderer is installed (Canvas-based, lazily imported so
 * only documents that contain metafiles load it). Exported for direct unit coverage — the
 * port factory gates on `createImageBitmap`, which headless DOMs lack.
 */
export async function convertBrowserMetafile(
  bytes: Uint8Array,
  mime: MetafileImageMime,
  _limits: ImageResourceLimits
): Promise<Readonly<{ bytes: Uint8Array; mime: SupportedImageMime }> | null> {
  const rasterize = drawingRenderers().metafile?.rasterize;
  if (!rasterize) return convertPlainMetafile(bytes);
  const raster = await rasterize(bytes, mime, { maxEdge: MAX_METAFILE_RASTER_EDGE });
  return raster ? Object.freeze({ bytes: raster.bytes, mime: raster.mime }) : null;
}

async function convertPlainMetafile(
  bytes: Uint8Array
): Promise<Readonly<{ bytes: Uint8Array; mime: SupportedImageMime }> | null> {
  // Keep the full converter: its embedded image decoders preserve TIFF and CMYK JPEG content.
  const { convertMetafileToDataUrl } = await import('emf-converter');
  const copy = new Uint8Array(bytes);
  const buffer = copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength);
  const dataUrl = await convertMetafileToDataUrl(
    buffer,
    metafileRasterOptions(MAX_METAFILE_RASTER_EDGE)
  );
  const prefix = 'data:image/png;base64,';
  if (!dataUrl?.startsWith(prefix)) return null;
  const binary = atob(dataUrl.slice(prefix.length));
  const pngBytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    pngBytes[index] = binary.charCodeAt(index);
  }
  return Object.freeze({ bytes: pngBytes, mime: 'image/png' as const });
}

/**
 * TIFF → PNG. Exported for direct unit coverage — the port factory gates on
 * `createImageBitmap`, which headless DOMs lack.
 */
export async function convertBrowserTiff(
  ownerDocument: Document,
  bytes: Uint8Array,
  limits: ImageResourceLimits
): Promise<ConvertedRaster> {
  const frame = await decodeTiffFrame(bytes, limits);
  if (frame === null) return null;
  const png = await encodeRgbaAsPng(ownerDocument, frame.rgba, frame.pixelWidth, frame.pixelHeight);
  return png === null ? null : Object.freeze({ bytes: png, mime: 'image/png' as const });
}

/** RGBA → PNG bytes through a canvas, or null when this document cannot encode them. */
async function encodeRgbaAsPng(
  ownerDocument: Document,
  rgba: Uint8Array,
  pixelWidth: number,
  pixelHeight: number
): Promise<Uint8Array | null> {
  const canvas = ownerDocument.createElement('canvas');
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;
  // Browsers CLAMP an oversized canvas rather than refusing it, and the clamp is silent —
  // the surface just comes back smaller. Encoding into it would produce a valid PNG of the
  // wrong size, which then passes every downstream check and paints a cropped picture
  // stretched over the authored extent. Refusing keeps the labelled placeholder, which is
  // the honest answer.
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) return null;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const imageData = context.createImageData(pixelWidth, pixelHeight);
  imageData.data.set(rgba);
  context.putImageData(imageData, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((result) => resolve(result), 'image/png');
  });
  if (!blob) return null;
  return new Uint8Array(await blob.arrayBuffer());
}

/** Headless fallback: embedded images resolve to unrenderable, never ready. */
export function createHeadlessImageDecodePort(): ImageDecodePort {
  return Object.freeze({
    async decode() {
      throw new Error('Image decode unavailable in headless environment');
    },
  });
}
