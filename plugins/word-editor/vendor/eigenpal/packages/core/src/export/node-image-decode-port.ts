// DOM-free image metadata decoding for server layout.

import {
  validateRasterHeader,
  type ImageDecodePort,
  type PreservedImageMime,
  type SupportedImageMime,
} from '../store/package/image-resources.ts';
import type { ImageResourceLimits } from '../store/runtime/limits.ts';
import { decodeTiffFrame } from '../store/package/tiff-frame.ts';
import { encodeRgbaPng } from './raster-png.ts';

/** TIFF to PNG without a DOM. Metafiles decline here: the exporter draws them itself. */
async function convertTiff(
  bytes: Uint8Array,
  mime: PreservedImageMime,
  limits: ImageResourceLimits
): Promise<Readonly<{ bytes: Uint8Array; mime: SupportedImageMime }> | null> {
  if (mime !== 'image/tiff') return null;
  const frame = await decodeTiffFrame(bytes, limits);
  if (!frame) return null;
  const png = encodeRgbaPng(frame.rgba, frame.pixelWidth, frame.pixelHeight);
  return Object.freeze({ bytes: png, mime: 'image/png' as const });
}

/** Optional caller conversion for preserved formats such as EMF/WMF/TIFF. @public */
export type PreservedImageConverter = (
  bytes: Uint8Array,
  mime: PreservedImageMime,
  limits: ImageResourceLimits,
  /** Aborted when the owning export session is disposed. */
  signal?: AbortSignal
) => Promise<Readonly<{ bytes: Uint8Array; mime: SupportedImageMime }> | null>;

/**
 * Decode raster dimensions from validated headers, with no native image dependency or DOM.
 * SVG sizing is handled by the resource registry. TIFF converts to PNG unless the caller
 * supplies `convertPreserved`, which then handles every preserved format.
 * @public
 */
export function createNodeImageDecodePort(
  options: {
    readonly convertPreserved?: PreservedImageConverter;
  } = {}
): ImageDecodePort {
  return Object.freeze({
    async decode(bytes: Uint8Array, mime: SupportedImageMime, limits: ImageResourceLimits) {
      const header = validateRasterHeader(bytes, mime);
      if (!header) throw new Error(`Unsupported or malformed ${mime} image`);
      if (
        header.pixelWidth > limits.maxDimension ||
        header.pixelHeight > limits.maxDimension ||
        header.pixelWidth > limits.maxPixels / header.pixelHeight
      ) {
        throw new Error('Image dimensions exceed resource limits');
      }
      return Object.freeze({
        pixelWidth: header.pixelWidth,
        pixelHeight: header.pixelHeight,
        dpiX: header.dpiX ?? 96,
        dpiY: header.dpiY ?? 96,
      });
    },
    convertPreserved: options.convertPreserved ?? convertTiff,
  });
}
