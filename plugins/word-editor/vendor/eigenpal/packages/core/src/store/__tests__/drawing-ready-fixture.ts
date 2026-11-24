import { sha256FontBytes } from '../../layout/font-resource.ts';
import type { ImageResourceState, SupportedImageMime } from '../package/image-resources.ts';
import { registerValidatedImageBytes } from '../package/validated-image-bytes.ts';

/** Test helper — ready {@link ImageResourceState} with a validated opaque byte handle. */
export function mockReadyImageResource(options: {
  readonly bytes: Uint8Array;
  readonly ownerPartName?: string;
  readonly partName?: string;
  readonly mime?: SupportedImageMime;
  readonly pixelWidth?: number;
  readonly pixelHeight?: number;
}): ImageResourceState {
  const ownerPartName = options.ownerPartName ?? '/word/document.xml';
  const partName = options.partName ?? '/word/media/image1.png';
  const contentId = sha256FontBytes(options.bytes);
  const resourceKey = `${ownerPartName}\0${partName}\0${contentId}`;
  return Object.freeze({
    kind: 'ready',
    partName,
    contentId,
    resourceKey,
    validatedHandle: registerValidatedImageBytes(resourceKey, contentId, options.bytes),
    mime: options.mime ?? 'image/png',
    pixelWidth: options.pixelWidth ?? 1,
    pixelHeight: options.pixelHeight ?? 1,
    dpiX: 96,
    dpiY: 96,
  });
}
