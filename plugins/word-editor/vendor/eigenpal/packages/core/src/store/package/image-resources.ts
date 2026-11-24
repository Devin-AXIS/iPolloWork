// Embedded image resource validation and cache (typed-drawings-and-images task 4).
//
// Content type is a claim; signature sniffing, structural header validation, and
// the decode port are authoritative. Validated bytes never enter public state.

import { sha256FontBytes } from './sha256.ts';
import { createLegacyGraphicResolver } from './legacy-vml-resources.ts';
import {
  createValidatedImageBytesRegistry,
  type ValidatedImageBytesHandle,
} from './validated-image-bytes.ts';
import { resolveContentType } from './content-types.ts';
import {
  IMAGE_RELATIONSHIP_TYPE,
  resolveImageRelationship,
  type ImageRelationshipResolution,
} from './relationships.ts';
import type { DrawingProjection } from './drawing-projection.ts';
import { countDrawingImageReferences } from './image-reference-count.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import { readPngPhysicalDensity } from './png-physical-density.ts';
import { validateJpegHeader as readJpegHeader } from './jpeg-header.ts';
import {
  IMAGE_RESOURCE_HARD_CEILINGS,
  resolveImageResourceLimits,
  type ImageResourceLimits,
} from '../runtime/limits.ts';
import { createHostAbortController } from '../runtime/host-abort-controller.ts';

/**
 * Raster media the decode port measures and any authoring path may write.
 *
 * BMP and WebP are here for the same reason the other three are: an `<img>` decodes them
 * natively, so they need a signature and a structural header and nothing else. BMP is what
 * older documents carry; WebP is what current Word writes.
 */
export type SupportedImageMime =
  'image/png' | 'image/jpeg' | 'image/gif' | 'image/bmp' | 'image/webp';
/**
 * Vector media painted straight from validated bytes. An `<img>` renders SVG in the
 * browser's secure static mode — no script, no external subresource loads — so there is
 * no decode step and no raster buffer sized by a file-supplied number.
 */
export type VectorImageMime = 'image/svg+xml';
/** Every mime the painter can hand to an `<img>`. */
export type RenderableImageMime = SupportedImageMime | VectorImageMime;
/**
 * Media kept in the package byte-for-byte that the painter cannot hand to an `<img>`.
 * A decode port may rasterize it; without one it paints as a labelled placeholder.
 */
export type PreservedImageMime = 'image/tiff' | 'image/x-emf' | 'image/x-wmf';
/** @internal */
export type MetafileImageMime = 'image/x-emf' | 'image/x-wmf';

export type { ImageResourceLimits };

export type {
  ValidatedImageBytesHandle,
  ValidatedImageBytesRegistry,
} from './validated-image-bytes.ts';

/**
 * What is known about one embedded image: validated, refused, or still decoding.
 *
 * Content type is a CLAIM. Signature sniffing, structural header validation and the decode port
 * are authoritative, and bytes that fail them never enter public state.
 */
export type ImageResourceState =
  | {
      readonly kind: 'ready';
      readonly partName: string;
      readonly contentId: string;
      readonly resourceKey: string;
      readonly validatedHandle: ValidatedImageBytesHandle;
      readonly mime: RenderableImageMime;
      readonly pixelWidth: number;
      readonly pixelHeight: number;
      readonly dpiX: number;
      readonly dpiY: number;
    }
  | {
      readonly kind: 'unrenderable';
      readonly partName: string | null;
      readonly mime: RenderableImageMime | PreservedImageMime | 'unknown';
      readonly reason:
        | 'unsupported-format'
        | 'non-picture-graphic'
        | 'signature-mismatch'
        | 'decode-failed'
        | 'resource-limit';
    }
  | {
      readonly kind: 'external';
      readonly relationshipId: string;
      readonly sinkSafe: boolean;
    }
  | { readonly kind: 'missing'; readonly relationshipId: string }
  | { readonly kind: 'pending'; readonly resourceKey: string };

/**
 * The injected image decoder.
 *
 * A port rather than a direct `Image`/`createImageBitmap` call, so a worker or server runtime
 * supplies its own and the engine never reaches for a browser global.
 */
export interface ImageDecodePort {
  decode(
    bytes: Uint8Array,
    mime: SupportedImageMime,
    limits: ImageResourceLimits,
    /** Aborted when the owning lookup/session is disposed. */
    signal?: AbortSignal
  ): Promise<Readonly<{ pixelWidth: number; pixelHeight: number; dpiX: number; dpiY: number }>>;
  /**
   * Optional conversion of media an `<img>` cannot render (EMF/WMF metafiles, TIFF) into a
   * renderable raster. The returned bytes are untrusted and re-enter the full raster
   * validation path (sniff, header, pixel caps, decode) before they can become a ready
   * resource. A null return declines the format and keeps the labelled placeholder; so does
   * a throw, as `decode-failed`.
   */
  convertPreserved?(
    bytes: Uint8Array,
    mime: PreservedImageMime,
    limits: ImageResourceLimits,
    /** Aborted when the owning lookup/session is disposed. */
    signal?: AbortSignal
  ): Promise<Readonly<{ bytes: Uint8Array; mime: SupportedImageMime }> | null>;
}

/** Resolves a relationship id to a validated image resource, or reports why it could not. */
export interface ImageResourceLookup {
  readonly resolveEmbedded: (
    ownerPartName: string,
    relationshipId: string
  ) => Promise<ImageResourceState>;
  readonly resolveLinked: (ownerPartName: string, relationshipId: string) => ImageResourceState;
  readonly resolveForProjection: (projection: DrawingProjection) => Promise<ImageResourceState>;
  readonly liveReferenceCount: (partName: string) => number;
  readonly dispose: () => void;
}

const PNG_SIGNATURE = Object.freeze([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DEFAULT_DPI = 96;
/** Maximum prefix inspected for SVG root detection (exported for bounded-scan tests). */
export const MAX_SVG_SNIFF_BYTES = 512;
/** Maximum prefix inspected for the SVG root element's sizing attributes. */
export const MAX_SVG_ROOT_SCAN_BYTES = 8192;
/** CSS default size of a replaced element with no intrinsic dimensions. */
const DEFAULT_SVG_INTRINSIC_WIDTH = 300;
const DEFAULT_SVG_INTRINSIC_HEIGHT = 150;

// A Map, not an object literal: the key is a `[Content_Types].xml` value the sender controls,
// and this is the upstream of the `mime` that reaches paint's format label.
//
// No exploit reaches it today, and the reason is worth recording so nobody relaxes the wrong
// guard later: `readContentTypes` refuses anything that is not `type/subtype`
// (`MIME_ESSENCE_RE` in content-types.ts) and fails the whole package with
// `bad-content-types`, and no member of `Object.prototype` contains a slash. The Map removes
// the hazard at the source instead of depending on that coincidence holding.
const CONTENT_TYPE_TO_MIME: ReadonlyMap<string, RenderableImageMime | PreservedImageMime> = new Map(
  [
    ['image/png', 'image/png'],
    ['image/jpeg', 'image/jpeg'],
    ['image/jpg', 'image/jpeg'],
    ['image/gif', 'image/gif'],
    // `image/bmp` is the registered type; Word and older producers also write these two.
    ['image/bmp', 'image/bmp'],
    ['image/x-ms-bmp', 'image/bmp'],
    ['image/x-bmp', 'image/bmp'],
    ['image/webp', 'image/webp'],
    ['image/svg+xml', 'image/svg+xml'],
    ['image/tiff', 'image/tiff'],
    ['image/x-emf', 'image/x-emf'],
    ['image/x-wmf', 'image/x-wmf'],
  ]
);

/** A raster header that passed structural validation: its real MIME type and pixel extent. */
export interface ValidatedRasterHeader {
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  /** Horizontal physical density when bounded header metadata supplies it. */
  readonly dpiX?: number;
  /** Vertical physical density when bounded header metadata supplies it. */
  readonly dpiY?: number;
}

function bytesStartWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false;
  for (let index = 0; index < prefix.length; index += 1) {
    if (bytes[index] !== prefix[index]) return false;
  }
  return true;
}

function isWhitespaceByte(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

/** Bounded scan for an `<svg` document root (optional `<?xml` prolog only). */
export function hasBoundedSvgRoot(bytes: Uint8Array): boolean {
  const prefix = bytes.subarray(0, Math.min(bytes.length, MAX_SVG_SNIFF_BYTES));
  let index = 0;
  while (index < prefix.length && isWhitespaceByte(prefix[index]!)) index += 1;
  if (index + 5 < prefix.length && prefix[index] === 0x3c && prefix[index + 1] === 0x3f) {
    let close = -1;
    for (let scan = index + 2; scan + 1 < prefix.length; scan += 1) {
      if (prefix[scan] === 0x3f && prefix[scan + 1] === 0x3e) {
        close = scan;
        break;
      }
    }
    if (close === -1) return false;
    index = close + 2;
    while (index < prefix.length && isWhitespaceByte(prefix[index]!)) index += 1;
  }
  return (
    index + 4 <= prefix.length &&
    prefix[index] === 0x3c &&
    prefix[index + 1] === 0x73 &&
    prefix[index + 2] === 0x76 &&
    prefix[index + 3] === 0x67 &&
    (index + 4 === prefix.length ||
      prefix[index + 4] === 0x20 ||
      prefix[index + 4] === 0x09 ||
      prefix[index + 4] === 0x0a ||
      prefix[index + 4] === 0x0d ||
      prefix[index + 4] === 0x3e)
  );
}

function isRasterSupportedMime(mime: string): mime is SupportedImageMime {
  return (
    mime === 'image/png' ||
    mime === 'image/jpeg' ||
    mime === 'image/gif' ||
    mime === 'image/bmp' ||
    mime === 'image/webp'
  );
}

function isPreservedMime(mime: string): mime is PreservedImageMime {
  return mime === 'image/tiff' || mime === 'image/x-emf' || mime === 'image/x-wmf';
}

/** Signature sniffing — authoritative over declared content type. */
export function sniffImageMime(
  bytes: Uint8Array
): RenderableImageMime | PreservedImageMime | 'unknown' {
  if (bytesStartWith(bytes, PNG_SIGNATURE)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  // `BM` — the only file type BITMAPFILEHEADER declares. The DIB header behind it is what
  // `validateBmpHeader` reads; two bytes alone are a weak signature, which is exactly why
  // nothing downstream trusts the sniff on its own.
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp';
  // RIFF container with a `WEBP` form type: `RIFF....WEBP`.
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return 'image/gif';
  }
  if (hasBoundedSvgRoot(bytes)) return 'image/svg+xml';
  if (bytes.length >= 4) {
    if (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) {
      return 'image/tiff';
    }
    if (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a) {
      return 'image/tiff';
    }
  }
  if (
    bytes.length >= 44 &&
    bytes[0] === 0x01 &&
    bytes[1] === 0x00 &&
    bytes[2] === 0x00 &&
    bytes[3] === 0x00
  ) {
    return 'image/x-emf';
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0xd7 &&
    bytes[1] === 0xcd &&
    bytes[2] === 0xc6 &&
    bytes[3] === 0x9a
  ) {
    return 'image/x-wmf';
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x01 &&
    bytes[1] === 0x00 &&
    bytes[2] === 0x09 &&
    bytes[3] === 0x00
  ) {
    return 'image/x-wmf';
  }
  return 'unknown';
}

function isValidPngColorTypeAndBitDepth(colorType: number, bitDepth: number): boolean {
  switch (colorType) {
    case 0:
      return (
        bitDepth === 1 || bitDepth === 2 || bitDepth === 4 || bitDepth === 8 || bitDepth === 16
      );
    case 2:
      return bitDepth === 8 || bitDepth === 16;
    case 3:
      return bitDepth === 1 || bitDepth === 2 || bitDepth === 4 || bitDepth === 8;
    case 4:
      return bitDepth === 8 || bitDepth === 16;
    case 6:
      return bitDepth === 8 || bitDepth === 16;
    default:
      return false;
  }
}

/** Structural PNG IHDR validation before decode. */
export function validatePngHeader(bytes: Uint8Array): ValidatedRasterHeader | null {
  if (!bytesStartWith(bytes, PNG_SIGNATURE)) return null;
  if (bytes.length < 33) return null;
  const chunkLength =
    ((bytes[8]! << 24) >>> 0) | (bytes[9]! << 16) | (bytes[10]! << 8) | bytes[11]!;
  if (chunkLength !== 13) return null;
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) {
    return null;
  }
  const pixelWidth =
    ((bytes[16]! << 24) >>> 0) | (bytes[17]! << 16) | (bytes[18]! << 8) | bytes[19]!;
  const pixelHeight =
    ((bytes[20]! << 24) >>> 0) | (bytes[21]! << 16) | (bytes[22]! << 8) | bytes[23]!;
  if (pixelWidth === 0 || pixelHeight === 0) return null;
  const bitDepth = bytes[24]!;
  const colorType = bytes[25]!;
  const compression = bytes[26]!;
  const filter = bytes[27]!;
  const interlace = bytes[28]!;
  if (!isValidPngColorTypeAndBitDepth(colorType, bitDepth)) return null;
  if (compression !== 0 || filter !== 0) return null;
  if (interlace !== 0 && interlace !== 1) return null;
  const density = readPngPhysicalDensity(bytes);
  return density ? { pixelWidth, pixelHeight, ...density } : { pixelWidth, pixelHeight };
}

/** Structural GIF logical screen descriptor validation before decode. */
export function validateGifHeader(bytes: Uint8Array): ValidatedRasterHeader | null {
  if (bytes.length < 10) return null;
  if (
    bytes[0] !== 0x47 ||
    bytes[1] !== 0x49 ||
    bytes[2] !== 0x46 ||
    bytes[3] !== 0x38 ||
    (bytes[4] !== 0x37 && bytes[4] !== 0x39) ||
    bytes[5] !== 0x61
  ) {
    return null;
  }
  const pixelWidth = bytes[6]! | (bytes[7]! << 8);
  const pixelHeight = bytes[8]! | (bytes[9]! << 8);
  if (pixelWidth === 0 || pixelHeight === 0) return null;
  return { pixelWidth, pixelHeight };
}

/** Bounded JPEG marker scan through the first supported SOF marker. */
export function validateJpegHeader(bytes: Uint8Array): ValidatedRasterHeader | null {
  return readJpegHeader(bytes);
}

/** `BITMAPCOREHEADER` is 12 bytes and 16-bit; every later DIB header is 40 or more and 32-bit. */
const BMP_CORE_HEADER_SIZE = 12;
const BMP_INFO_HEADER_SIZE = 40;
/** Bit depths BITMAPINFOHEADER defines. Anything else is not a bitmap this file claims to be. */
const BMP_BIT_COUNTS: ReadonlySet<number> = new Set([0, 1, 4, 8, 16, 24, 32]);

/**
 * Structural BMP validation: file header, DIB header size, and the extent it declares.
 *
 * Height is SIGNED — a negative one is a top-down bitmap, which is ordinary and must not be
 * read as a malformed file or as a huge unsigned number.
 */
export function validateBmpHeader(bytes: Uint8Array): ValidatedRasterHeader | null {
  if (bytes.length < 26) return null;
  if (bytes[0] !== 0x42 || bytes[1] !== 0x4d) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dibSize = view.getUint32(14, true);
  if (dibSize === BMP_CORE_HEADER_SIZE) {
    const pixelWidth = view.getUint16(18, true);
    const pixelHeight = view.getUint16(20, true);
    if (pixelWidth === 0 || pixelHeight === 0) return null;
    return { pixelWidth, pixelHeight };
  }
  // 40 (INFO), 52/56 (V2/V3), 108 (V4), 124 (V5) all share the first 16 bytes.
  if (dibSize < BMP_INFO_HEADER_SIZE || dibSize > 1024) return null;
  if (bytes.length < 14 + BMP_INFO_HEADER_SIZE) return null;
  const pixelWidth = view.getInt32(18, true);
  const signedHeight = view.getInt32(22, true);
  const pixelHeight = Math.abs(signedHeight);
  if (pixelWidth <= 0 || pixelHeight === 0) return null;
  if (view.getUint16(26, true) !== 1) return null; // planes: always 1
  if (!BMP_BIT_COUNTS.has(view.getUint16(28, true))) return null;
  return { pixelWidth, pixelHeight };
}

/**
 * Structural WebP validation across the three body chunks: `VP8 ` lossy, `VP8L` lossless,
 * and `VP8X` extended (animated or with alpha/ICC, where the canvas size is authoritative).
 *
 * Each stores its extent differently and none of them stores it in the RIFF header, so all
 * three are read rather than assuming the common case.
 */
export function validateWebpHeader(bytes: Uint8Array): ValidatedRasterHeader | null {
  if (bytes.length < 30) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunk = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
  if (chunk === 'VP8 ') {
    // Key-frame start code, then 14-bit width and height.
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    const pixelWidth = view.getUint16(26, true) & 0x3fff;
    const pixelHeight = view.getUint16(28, true) & 0x3fff;
    if (pixelWidth === 0 || pixelHeight === 0) return null;
    return { pixelWidth, pixelHeight };
  }
  if (chunk === 'VP8L') {
    if (bytes[20] !== 0x2f) return null; // lossless signature byte
    const packed = view.getUint32(21, true);
    const pixelWidth = (packed & 0x3fff) + 1;
    const pixelHeight = ((packed >>> 14) & 0x3fff) + 1;
    return { pixelWidth, pixelHeight };
  }
  if (chunk === 'VP8X') {
    // Canvas extent as two 24-bit little-endian "minus one" values.
    const pixelWidth = (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16)) + 1;
    const pixelHeight = (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16)) + 1;
    return { pixelWidth, pixelHeight };
  }
  return null;
}

/** IFD0 entry ceiling. Real files carry a few dozen; the count is a file-supplied number. */
const MAX_TIFF_IFD_ENTRIES = 4096;
const TIFF_TAG_IMAGE_WIDTH = 256;
const TIFF_TAG_IMAGE_LENGTH = 257;
const TIFF_FIELD_TYPE_SHORT = 3;
const TIFF_FIELD_TYPE_LONG = 4;

/**
 * Structural TIFF validation: byte order, magic, and the extent tags of the first IFD.
 *
 * Read before any converter runs, so the pixel caps are applied to the declared extent
 * rather than to whatever a third-party decoder allocated on the way to reporting it.
 * Only the first image is inspected — Word paints page one of a multi-page TIFF.
 * BigTIFF (magic 43) has a different directory layout and is refused here.
 */
export function validateTiffHeader(bytes: Uint8Array): ValidatedRasterHeader | null {
  if (bytes.length < 8) return null;
  let littleEndian: boolean;
  if (bytes[0] === 0x49 && bytes[1] === 0x49) littleEndian = true;
  else if (bytes[0] === 0x4d && bytes[1] === 0x4d) littleEndian = false;
  else return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(2, littleEndian) !== 42) return null;
  const directoryOffset = view.getUint32(4, littleEndian);
  if (directoryOffset < 8 || directoryOffset + 2 > bytes.length) return null;
  const entryCount = view.getUint16(directoryOffset, littleEndian);
  if (entryCount === 0 || entryCount > MAX_TIFF_IFD_ENTRIES) return null;
  if (directoryOffset + 2 + entryCount * 12 > bytes.length) return null;

  let pixelWidth = 0;
  let pixelHeight = 0;
  for (let index = 0; index < entryCount; index += 1) {
    const entry = directoryOffset + 2 + index * 12;
    const tag = view.getUint16(entry, littleEndian);
    if (tag !== TIFF_TAG_IMAGE_WIDTH && tag !== TIFF_TAG_IMAGE_LENGTH) continue;
    // Both extents are single-valued and fit inline; anything else is malformed.
    if (view.getUint32(entry + 4, littleEndian) !== 1) return null;
    const fieldType = view.getUint16(entry + 2, littleEndian);
    let value: number;
    if (fieldType === TIFF_FIELD_TYPE_SHORT) value = view.getUint16(entry + 8, littleEndian);
    else if (fieldType === TIFF_FIELD_TYPE_LONG) value = view.getUint32(entry + 8, littleEndian);
    else return null;
    if (tag === TIFF_TAG_IMAGE_WIDTH) pixelWidth = value;
    else pixelHeight = value;
  }
  if (pixelWidth <= 0 || pixelHeight <= 0) return null;
  return { pixelWidth, pixelHeight };
}

/**
 * CSS absolute length units, in CSS pixels. Percentages are not intrinsic and are refused.
 *
 * A Map, not an object literal. Unlike the content-type lookup above, this key IS reachable
 * from file content — it is the unit suffix of an embedded SVG's root `width`/`height`, so
 * `width="1constructor"` indexed the literal to `Object` and sailed past the
 * `scale === undefined` guard.
 *
 * No input changes its answer either way, and that is worth stating rather than implying a
 * fix that is not one: every member of `Object.prototype` is a function or an object, so
 * `number * scale` is always `NaN` and the finiteness check below already returns null. The
 * Map removes a read that only luck made safe, so a later edit to that check cannot turn it
 * into a live defect.
 */
const CSS_ABSOLUTE_UNIT_PX: ReadonlyMap<string, number> = new Map([
  ['', 1],
  ['px', 1],
  ['pt', 96 / 72],
  ['pc', 16],
  ['in', 96],
  ['cm', 96 / 2.54],
  ['mm', 96 / 25.4],
  ['q', 96 / 101.6],
]);

/** A CSS absolute length in px, or null for a percentage, a bad unit, or a non-number. */
function parseCssAbsoluteLength(raw: string): number | null {
  const value = raw.trim();
  if (value === '') return null;
  const number = Number.parseFloat(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  let index = 0;
  // parseFloat consumed a leading numeric run; step past exactly that run to find the unit.
  if (value[index] === '+' || value[index] === '-') index += 1;
  while (index < value.length && value[index]! >= '0' && value[index]! <= '9') index += 1;
  if (value[index] === '.') {
    index += 1;
    while (index < value.length && value[index]! >= '0' && value[index]! <= '9') index += 1;
  }
  if (value[index] === 'e' || value[index] === 'E') {
    let scan = index + 1;
    if (value[scan] === '+' || value[scan] === '-') scan += 1;
    let digits = 0;
    while (scan < value.length && value[scan]! >= '0' && value[scan]! <= '9') {
      scan += 1;
      digits += 1;
    }
    if (digits > 0) index = scan;
  }
  const scale = CSS_ABSOLUTE_UNIT_PX.get(value.slice(index).trim().toLowerCase());
  if (scale === undefined) return null;
  const px = number * scale;
  return Number.isFinite(px) && px > 0 ? px : null;
}

/** `viewBox` width/height, or null when the list is not four finite numbers with positive extent. */
function parseSvgViewBox(raw: string): Readonly<{ width: number; height: number }> | null {
  const parts: number[] = [];
  let token = '';
  for (const char of `${raw} `) {
    if (char === ' ' || char === ',' || char === '\t' || char === '\n' || char === '\r') {
      if (token !== '') {
        parts.push(Number.parseFloat(token));
        token = '';
        if (parts.length > 4) return null;
      }
      continue;
    }
    token += char;
    if (token.length > 64) return null;
  }
  if (parts.length !== 4 || !parts.every((part) => Number.isFinite(part))) return null;
  const [, , width, height] = parts as [number, number, number, number];
  return width > 0 && height > 0 ? Object.freeze({ width, height }) : null;
}

/**
 * Sizing attributes off the root `<svg>` element, read by a bounded character scan rather
 * than a full XML parse — the bytes are attacker-controlled and only three attributes matter.
 */
function readSvgRootSizingAttributes(
  bytes: Uint8Array
): Readonly<{ width: string; height: string; viewBox: string }> | null {
  const prefix = bytes.subarray(0, Math.min(bytes.length, MAX_SVG_ROOT_SCAN_BYTES));
  const text = new TextDecoder('utf-8', { fatal: false }).decode(prefix);
  const rootStart = text.indexOf('<svg');
  if (rootStart === -1) return null;
  let index = rootStart + 4;
  const attributes: Record<string, string> = { width: '', height: '', viewBox: '' };
  while (index < text.length) {
    const char = text[index]!;
    if (char === '>' || char === '/') break;
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      index += 1;
      continue;
    }
    let name = '';
    while (index < text.length && !' \t\n\r=>/'.includes(text[index]!)) {
      name += text[index]!;
      index += 1;
    }
    while (index < text.length && ' \t\n\r'.includes(text[index]!)) index += 1;
    if (text[index] !== '=') continue;
    index += 1;
    while (index < text.length && ' \t\n\r'.includes(text[index]!)) index += 1;
    const quote = text[index];
    let value = '';
    if (quote === '"' || quote === "'") {
      index += 1;
      while (index < text.length && text[index] !== quote) {
        value += text[index]!;
        index += 1;
      }
      // An unterminated quote means the root element ran past the scan window.
      if (index >= text.length) return null;
      index += 1;
    } else {
      while (index < text.length && !' \t\n\r>/'.includes(text[index]!)) {
        value += text[index]!;
        index += 1;
      }
    }
    if (name in attributes) attributes[name] = value;
  }
  // Running out of text before the root tag closed means the scan window was too small.
  if (index >= text.length) return null;
  return Object.freeze(attributes as { width: string; height: string; viewBox: string });
}

/**
 * Intrinsic size of an SVG, resolved the way a browser sizes one: absolute `width`/`height`
 * first, then `viewBox` for the missing axis or ratio, then the CSS 300x150 default.
 *
 * This is metadata for insert and reset-to-natural-size only. Layout uses the authored
 * `wp:extent` and the browser rasterizes into that box, so nothing here sizes an allocation
 * and an out-of-range value is clamped rather than refused.
 */
export function resolveSvgIntrinsicSize(
  bytes: Uint8Array,
  limits: ImageResourceLimits
): ValidatedRasterHeader | null {
  const attributes = readSvgRootSizingAttributes(bytes);
  if (attributes === null) return null;
  const width = parseCssAbsoluteLength(attributes.width);
  const height = parseCssAbsoluteLength(attributes.height);
  const viewBox = parseSvgViewBox(attributes.viewBox);

  let pixelWidth: number;
  let pixelHeight: number;
  if (width !== null && height !== null) {
    pixelWidth = width;
    pixelHeight = height;
  } else if (viewBox !== null) {
    const ratio = viewBox.width / viewBox.height;
    if (width !== null) {
      pixelWidth = width;
      pixelHeight = width / ratio;
    } else if (height !== null) {
      pixelWidth = height * ratio;
      pixelHeight = height;
    } else {
      pixelWidth = viewBox.width;
      pixelHeight = viewBox.height;
    }
  } else {
    pixelWidth = width ?? DEFAULT_SVG_INTRINSIC_WIDTH;
    pixelHeight = height ?? DEFAULT_SVG_INTRINSIC_HEIGHT;
  }

  const clamp = (value: number): number =>
    Math.min(Math.max(Math.round(value), 1), limits.maxDimension);
  return { pixelWidth: clamp(pixelWidth), pixelHeight: clamp(pixelHeight) };
}

/**
 * Validate a raster image's header structurally and report its real MIME type and extent.
 *
 * Content type is a CLAIM; this is what makes it a fact. A file declaring `image/png` over JPEG
 * bytes is caught here rather than at decode.
 */
export function validateRasterHeader(
  bytes: Uint8Array,
  mime: SupportedImageMime
): ValidatedRasterHeader | null {
  switch (mime) {
    case 'image/png':
      return validatePngHeader(bytes);
    case 'image/gif':
      return validateGifHeader(bytes);
    case 'image/jpeg':
      return validateJpegHeader(bytes);
    case 'image/bmp':
      return validateBmpHeader(bytes);
    case 'image/webp':
      return validateWebpHeader(bytes);
    default:
      return null;
  }
}

function claimedMimeForPart(
  pkg: OoxmlPackage,
  partName: string
): RenderableImageMime | PreservedImageMime | 'unknown' {
  const resolved = resolveContentType(pkg.contentTypes, partName);
  if (!resolved.ok) return 'unknown';
  return CONTENT_TYPE_TO_MIME.get(resolved.contentType.toLowerCase()) ?? 'unknown';
}

function snapshotBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

function contentIdOf(bytes: Uint8Array): string {
  return sha256FontBytes(bytes);
}

function resourceKeyOf(ownerPartName: string, partName: string, contentId: string): string {
  return `${ownerPartName}\0${partName}\0${contentId}`;
}

function freezeState(state: ImageResourceState): ImageResourceState {
  return Object.freeze(state) as ImageResourceState;
}

function unrenderable(
  partName: string | null,
  mime: RenderableImageMime | PreservedImageMime | 'unknown',
  reason: Extract<ImageResourceState, { kind: 'unrenderable' }>['reason']
): ImageResourceState {
  return freezeState({ kind: 'unrenderable', partName, mime, reason });
}

function checkedPixelCount(
  width: number,
  height: number,
  limits: ImageResourceLimits
): number | null {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  if (width > limits.maxDimension || height > limits.maxDimension) return null;
  if (width > Number.MAX_SAFE_INTEGER / height) return null;
  const pixels = width * height;
  if (pixels > limits.maxPixels) return null;
  return pixels;
}

function checkedDecodedRgbaBytes(pixelCount: number, limits: ImageResourceLimits): boolean {
  if (pixelCount > Number.MAX_SAFE_INTEGER / 4) return false;
  return pixelCount * 4 <= limits.maxDecodedBytes;
}

function imageMimeClass(
  mime: RenderableImageMime | PreservedImageMime
): 'raster' | 'vector' | 'preserved' {
  if (isRasterSupportedMime(mime)) return 'raster';
  if (isPreservedMime(mime)) return 'preserved';
  return 'vector';
}

function mimeClassesMismatch(
  claimed: RenderableImageMime | PreservedImageMime | 'unknown',
  sniffed: RenderableImageMime | PreservedImageMime | 'unknown'
): boolean {
  if (claimed === 'unknown' || sniffed === 'unknown') return false;
  // Class changes can select a different processing path.
  if (imageMimeClass(claimed) !== imageMimeClass(sniffed)) return true;
  // Raster signatures control validation, decoding, and the published MIME type.
  if (imageMimeClass(sniffed) === 'raster') return false;
  // A metafile part named for the other metafile format (an EMF saved as `.wmf`) draws by
  // its own bytes: the signature picks the converter.
  const metafile = (mime: string) => mime === 'image/x-emf' || mime === 'image/x-wmf';
  if (metafile(claimed) && metafile(sniffed)) return false;
  return claimed !== sniffed;
}

function relationshipFingerprint(
  ownerPartName: string,
  relationshipId: string,
  resolved: ImageRelationshipResolution
): string {
  if (resolved.mode === 'internal') {
    return `${ownerPartName}\0${relationshipId}\0internal\0${resolved.partName}\0${resolved.raw}`;
  }
  if (resolved.mode === 'external') {
    return `${ownerPartName}\0${relationshipId}\0external\0${resolved.raw}\0${resolved.sinkSafe ? '1' : '0'}`;
  }
  return `${ownerPartName}\0${relationshipId}\0missing`;
}

function resolveEmbeddedPartName(
  pkg: OoxmlPackage,
  ownerPartName: string,
  relationshipId: string
): ImageRelationshipResolution {
  return resolveImageRelationship(
    pkg.relationships.get(ownerPartName) ?? [],
    ownerPartName,
    relationshipId
  );
}

interface CachedLookupEntry {
  readonly relationshipFingerprint: string;
  readonly contentId: string;
  readonly state: ImageResourceState;
}

/** Package-wide live drawing references to a media part name. */
export function liveDrawingReferenceCount(pkg: OoxmlPackage, partName: string): number {
  return countDrawingImageReferences(pkg, partName);
}

/** How the image cache decodes, and what it will spend doing so. */
export interface CreateImageResourceCacheOptions {
  readonly limits?: Partial<ImageResourceLimits>;
  readonly decodePort: ImageDecodePort;
}

interface ImageResourceRegistrySlot {
  readonly lookup: ImageResourceLookup;
}

const IMAGE_LIMIT_IDENTITY_KEYS = Object.keys(
  IMAGE_RESOURCE_HARD_CEILINGS
) as (keyof ImageResourceLimits)[];

function limitsIdentityKey(limits: ImageResourceLimits): string {
  return IMAGE_LIMIT_IDENTITY_KEYS.map((key) => `${key}=${limits[key]}`).join('\0');
}

/** pkg → decodePort → normalized limits → lookup (no strong pkg retention beyond WeakMap keys). */
const imageResourceRegistry = new WeakMap<
  OoxmlPackage,
  WeakMap<ImageDecodePort, Map<string, ImageResourceRegistrySlot>>
>();

function registrySlotFor(
  pkg: OoxmlPackage,
  decodePort: ImageDecodePort,
  limits: ImageResourceLimits
): ImageResourceRegistrySlot {
  let byDecodePort = imageResourceRegistry.get(pkg);
  if (!byDecodePort) {
    byDecodePort = new WeakMap();
    imageResourceRegistry.set(pkg, byDecodePort);
  }
  let byLimits = byDecodePort.get(decodePort);
  if (!byLimits) {
    byLimits = new Map();
    byDecodePort.set(decodePort, byLimits);
  }
  const limitsKey = limitsIdentityKey(limits);
  const existing = byLimits.get(limitsKey);
  if (existing) return existing;

  const lookup = createImageResourceCacheInternal(pkg, decodePort, limits);
  const slot = { lookup };
  byLimits.set(limitsKey, slot);
  return slot;
}

function unregisterLookupIfCurrent(
  pkg: OoxmlPackage,
  decodePort: ImageDecodePort,
  limits: ImageResourceLimits,
  lookup: ImageResourceLookup
): void {
  const byDecodePort = imageResourceRegistry.get(pkg);
  if (!byDecodePort) return;
  const byLimits = byDecodePort.get(decodePort);
  if (!byLimits) return;
  const limitsKey = limitsIdentityKey(limits);
  const slot = byLimits.get(limitsKey);
  if (!slot || slot.lookup !== lookup) return;
  byLimits.delete(limitsKey);
  if (byLimits.size === 0) {
    byDecodePort.delete(decodePort);
  }
}

/**
 * Derived cache for one immutable package snapshot. Registry identity is
 * `(package snapshot, decodePort object, normalized limits)` — the first caller
 * never imposes its decoder or limits on later callers with different options.
 */
export function imageResourceLookupFor(
  pkg: OoxmlPackage,
  options: CreateImageResourceCacheOptions
): ImageResourceLookup {
  const limits = resolveImageResourceLimits(options.limits);
  return registrySlotFor(pkg, options.decodePort, limits).lookup;
}

/**
 * Build an independently disposable lookup for a single layout owner.
 *
 * Unlike {@link imageResourceLookupFor}, this does not participate in the package registry:
 * layout bundles have independent lifetimes, so disposing one must never invalidate another
 * bundle that happens to use the same package snapshot and decoder.
 * @internal
 */
export function createOwnedImageResourceLookup(
  pkg: OoxmlPackage,
  options: CreateImageResourceCacheOptions
): ImageResourceLookup {
  return createImageResourceCacheInternal(
    pkg,
    options.decodePort,
    resolveImageResourceLimits(options.limits)
  );
}

/** @deprecated Prefer {@link imageResourceLookupFor} — registry binds cache to package identity. */
/** Build the per-document image cache. Validated bytes only; refusals are remembered too. */
export function createImageResourceCache(
  initialPkg: OoxmlPackage,
  options: CreateImageResourceCacheOptions
): ImageResourceLookup {
  return imageResourceLookupFor(initialPkg, options);
}

function createImageResourceCacheInternal(
  initialPkg: OoxmlPackage,
  decodePort: ImageDecodePort,
  limits: ImageResourceLimits
): ImageResourceLookup {
  const pkg = initialPkg;
  let generation = 0;
  let disposed = false;
  const lifetimeAbort = createHostAbortController();
  const validatedBytesRegistry = createValidatedImageBytesRegistry();
  const byRelationship = new Map<string, CachedLookupEntry>();
  const inFlightByContent = new Map<string, Promise<ImageResourceState>>();

  const ensureActive = (): void => {
    if (disposed) throw new Error('ImageResourceLookup disposed');
  };

  const lookupKey = (ownerPartName: string, relationshipId: string): string =>
    `${ownerPartName}\0${relationshipId}`;

  const contentFlightKey = (ownerPartName: string, partName: string, contentId: string): string =>
    `${ownerPartName}\0${partName}\0${contentId}`;

  const invalidateAll = (): void => {
    generation += 1;
    byRelationship.clear();
    inFlightByContent.clear();
  };

  const currentRelationshipEntry = (
    ownerPartName: string,
    relationshipId: string
  ): CachedLookupEntry | null => {
    const resolved = resolveEmbeddedPartName(pkg, ownerPartName, relationshipId);
    const fingerprint = relationshipFingerprint(ownerPartName, relationshipId, resolved);
    const cached = byRelationship.get(lookupKey(ownerPartName, relationshipId));
    if (!cached || cached.relationshipFingerprint !== fingerprint) return null;
    if (resolved.mode === 'internal') {
      const live = pkg.partBytes.get(resolved.partName);
      if (!live) return null;
      if (contentIdOf(live) !== cached.contentId) return null;
    }
    return cached;
  };

  const validateAndDecodeEmbedded = async (
    ownerPartName: string,
    resolvedPartName: string,
    snapshotted: Uint8Array,
    startGeneration: number
  ): Promise<ImageResourceState> => {
    if (startGeneration !== generation || disposed) {
      throw new Error('ImageResourceLookup stale');
    }

    if (snapshotted.length > limits.maxEncodedBytes) {
      return unrenderable(
        resolvedPartName,
        claimedMimeForPart(pkg, resolvedPartName),
        'resource-limit'
      );
    }

    const sniffed = sniffImageMime(snapshotted);
    const claimed = claimedMimeForPart(pkg, resolvedPartName);

    if (claimed !== 'unknown' && sniffed !== 'unknown' && mimeClassesMismatch(claimed, sniffed)) {
      return unrenderable(resolvedPartName, sniffed, 'signature-mismatch');
    }

    if (claimed !== 'unknown' && sniffed === 'unknown') {
      return unrenderable(resolvedPartName, claimed, 'signature-mismatch');
    }

    if (sniffed === 'unknown') {
      return unrenderable(resolvedPartName, 'unknown', 'unsupported-format');
    }

    if (isPreservedMime(sniffed)) {
      const preservedMime = sniffed;
      const convert = decodePort.convertPreserved?.bind(decodePort);
      if (!convert) {
        return unrenderable(resolvedPartName, preservedMime, 'unsupported-format');
      }
      if (preservedMime === 'image/tiff') {
        // TIFF declares its extent up front, so the caps apply before the converter
        // allocates a raster from it. Metafiles carry no comparable pre-decode extent
        // and are bounded by the output size the converter is asked for instead.
        const tiffHeader = validateTiffHeader(snapshotted);
        if (tiffHeader === null) {
          return unrenderable(resolvedPartName, preservedMime, 'unsupported-format');
        }
        const tiffPixels = checkedPixelCount(tiffHeader.pixelWidth, tiffHeader.pixelHeight, limits);
        if (tiffPixels === null || !checkedDecodedRgbaBytes(tiffPixels, limits)) {
          return unrenderable(resolvedPartName, preservedMime, 'resource-limit');
        }
      }
      const contentId = contentIdOf(snapshotted);
      const flightKey = contentFlightKey(ownerPartName, resolvedPartName, contentId);
      const existingFlight = inFlightByContent.get(flightKey);
      if (existingFlight) return existingFlight;
      const convertCopy = snapshotBytes(snapshotted);
      const flight = new Promise<ImageResourceState>((resolve, reject) => {
        void (async () => {
          try {
            let converted: Readonly<{ bytes: Uint8Array; mime: SupportedImageMime }> | null;
            try {
              converted = await convert(convertCopy, preservedMime, limits, lifetimeAbort.signal);
            } catch {
              resolve(unrenderable(resolvedPartName, preservedMime, 'decode-failed'));
              return;
            }
            if (startGeneration !== generation || disposed) {
              reject(new Error('ImageResourceLookup stale'));
              return;
            }
            // A null return is the converter declining the format — the ordinary
            // labelled placeholder, not a decode failure.
            if (converted === null) {
              resolve(unrenderable(resolvedPartName, preservedMime, 'unsupported-format'));
              return;
            }
            // The converter runs on attacker-controlled bytes; its OUTPUT is untrusted
            // too. Converted rasters take the same validation the source raster path
            // applies: size cap, signature sniff, header structure, pixel caps, decode.
            if (converted.bytes.length > limits.maxEncodedBytes) {
              resolve(unrenderable(resolvedPartName, preservedMime, 'resource-limit'));
              return;
            }
            const convertedSniffed = sniffImageMime(converted.bytes);
            if (convertedSniffed !== converted.mime || !isRasterSupportedMime(convertedSniffed)) {
              resolve(unrenderable(resolvedPartName, preservedMime, 'decode-failed'));
              return;
            }
            const convertedHeader = validateRasterHeader(converted.bytes, convertedSniffed);
            if (convertedHeader === null) {
              resolve(unrenderable(resolvedPartName, preservedMime, 'decode-failed'));
              return;
            }
            const pixelCount = checkedPixelCount(
              convertedHeader.pixelWidth,
              convertedHeader.pixelHeight,
              limits
            );
            if (pixelCount === null || !checkedDecodedRgbaBytes(pixelCount, limits)) {
              resolve(unrenderable(resolvedPartName, preservedMime, 'resource-limit'));
              return;
            }
            let decoded: Readonly<{ pixelWidth: number; pixelHeight: number }>;
            try {
              decoded = await decodePort.decode(
                snapshotBytes(converted.bytes),
                convertedSniffed,
                limits,
                lifetimeAbort.signal
              );
            } catch {
              resolve(unrenderable(resolvedPartName, preservedMime, 'decode-failed'));
              return;
            }
            if (startGeneration !== generation || disposed) {
              reject(new Error('ImageResourceLookup stale'));
              return;
            }
            if (
              decoded.pixelWidth !== convertedHeader.pixelWidth ||
              decoded.pixelHeight !== convertedHeader.pixelHeight
            ) {
              resolve(unrenderable(resolvedPartName, preservedMime, 'decode-failed'));
              return;
            }
            const resourceKey = resourceKeyOf(ownerPartName, resolvedPartName, contentId);
            const validatedHandle = validatedBytesRegistry.acquire(
              resourceKey,
              contentId,
              snapshotBytes(converted.bytes)
            );
            validatedBytesRegistry.retain(validatedHandle);
            resolve(
              freezeState({
                kind: 'ready',
                partName: resolvedPartName,
                contentId,
                resourceKey,
                validatedHandle,
                mime: convertedSniffed,
                pixelWidth: convertedHeader.pixelWidth,
                pixelHeight: convertedHeader.pixelHeight,
                dpiX: convertedHeader.dpiX ?? DEFAULT_DPI,
                dpiY: convertedHeader.dpiY ?? DEFAULT_DPI,
              })
            );
          } catch (error) {
            reject(error);
          } finally {
            if (startGeneration === generation) {
              inFlightByContent.delete(flightKey);
            }
          }
        })();
      });
      inFlightByContent.set(flightKey, flight);
      return flight;
    }

    if (sniffed === 'image/svg+xml') {
      // Vector media needs no decode: the painter hands these bytes to an `<img>`, where
      // the browser renders SVG in secure static mode — scripts inert, external
      // subresources never fetched — and rasterizes into the authored `wp:extent` box.
      // There is no decode port round trip and no buffer sized by a file-supplied number.
      const intrinsic = resolveSvgIntrinsicSize(snapshotted, limits);
      if (intrinsic === null) {
        return unrenderable(resolvedPartName, sniffed, 'decode-failed');
      }
      const svgContentId = contentIdOf(snapshotted);
      const svgResourceKey = resourceKeyOf(ownerPartName, resolvedPartName, svgContentId);
      const svgHandle = validatedBytesRegistry.acquire(
        svgResourceKey,
        svgContentId,
        snapshotBytes(snapshotted)
      );
      validatedBytesRegistry.retain(svgHandle);
      return freezeState({
        kind: 'ready',
        partName: resolvedPartName,
        contentId: svgContentId,
        resourceKey: svgResourceKey,
        validatedHandle: svgHandle,
        mime: sniffed,
        pixelWidth: intrinsic.pixelWidth,
        pixelHeight: intrinsic.pixelHeight,
        dpiX: DEFAULT_DPI,
        dpiY: DEFAULT_DPI,
      });
    }

    const header = validateRasterHeader(snapshotted, sniffed);
    if (header === null) {
      return unrenderable(resolvedPartName, sniffed, 'unsupported-format');
    }

    const headerPixels = checkedPixelCount(header.pixelWidth, header.pixelHeight, limits);
    if (headerPixels === null || !checkedDecodedRgbaBytes(headerPixels, limits)) {
      return unrenderable(resolvedPartName, sniffed, 'resource-limit');
    }

    const contentId = contentIdOf(snapshotted);
    const flightKey = contentFlightKey(ownerPartName, resolvedPartName, contentId);
    const existingFlight = inFlightByContent.get(flightKey);
    if (existingFlight) return existingFlight;

    const decodeCopy = snapshotBytes(snapshotted);
    const flight = new Promise<ImageResourceState>((resolve, reject) => {
      void (async () => {
        try {
          let decoded: Readonly<{
            pixelWidth: number;
            pixelHeight: number;
            dpiX: number;
            dpiY: number;
          }>;
          try {
            decoded = await decodePort.decode(decodeCopy, sniffed, limits, lifetimeAbort.signal);
          } catch {
            resolve(unrenderable(resolvedPartName, sniffed, 'decode-failed'));
            return;
          }

          if (startGeneration !== generation || disposed) {
            reject(new Error('ImageResourceLookup stale'));
            return;
          }

          if (
            decoded.pixelWidth !== header.pixelWidth ||
            decoded.pixelHeight !== header.pixelHeight
          ) {
            resolve(unrenderable(resolvedPartName, sniffed, 'decode-failed'));
            return;
          }

          const pixelCount = checkedPixelCount(decoded.pixelWidth, decoded.pixelHeight, limits);
          if (pixelCount === null || !checkedDecodedRgbaBytes(pixelCount, limits)) {
            resolve(unrenderable(resolvedPartName, sniffed, 'resource-limit'));
            return;
          }

          const decodedDpiX =
            Number.isFinite(decoded.dpiX) && decoded.dpiX > 0 ? decoded.dpiX : DEFAULT_DPI;
          const decodedDpiY =
            Number.isFinite(decoded.dpiY) && decoded.dpiY > 0 ? decoded.dpiY : DEFAULT_DPI;
          const dpiX = header.dpiX ?? decodedDpiX;
          const dpiY = header.dpiY ?? decodedDpiY;

          const resourceKey = resourceKeyOf(ownerPartName, resolvedPartName, contentId);
          const validatedHandle = validatedBytesRegistry.acquire(
            resourceKey,
            contentId,
            decodeCopy
          );
          validatedBytesRegistry.retain(validatedHandle);
          resolve(
            freezeState({
              kind: 'ready',
              partName: resolvedPartName,
              contentId,
              resourceKey,
              validatedHandle,
              mime: sniffed,
              pixelWidth: decoded.pixelWidth,
              pixelHeight: decoded.pixelHeight,
              dpiX,
              dpiY,
            })
          );
        } catch (error) {
          reject(error);
        } finally {
          if (startGeneration === generation) {
            inFlightByContent.delete(flightKey);
          }
        }
      })();
    });
    inFlightByContent.set(flightKey, flight);
    return flight;
  };

  const storeRelationshipResult = (
    ownerPartName: string,
    relationshipId: string,
    resolved: ImageRelationshipResolution,
    state: ImageResourceState,
    contentId = ''
  ): ImageResourceState => {
    byRelationship.set(lookupKey(ownerPartName, relationshipId), {
      relationshipFingerprint: relationshipFingerprint(ownerPartName, relationshipId, resolved),
      contentId,
      state,
    });
    return state;
  };

  const resolveEmbedded = async (
    ownerPartName: string,
    relationshipId: string
  ): Promise<ImageResourceState> => {
    ensureActive();
    const resolved = resolveEmbeddedPartName(pkg, ownerPartName, relationshipId);
    const cached = currentRelationshipEntry(ownerPartName, relationshipId);
    if (cached) return cached.state;

    if (resolved.mode === 'external') {
      return storeRelationshipResult(
        ownerPartName,
        relationshipId,
        resolved,
        freezeState({
          kind: 'external',
          relationshipId,
          sinkSafe: resolved.sinkSafe,
        })
      );
    }
    if (resolved.mode === 'missing') {
      return storeRelationshipResult(
        ownerPartName,
        relationshipId,
        resolved,
        freezeState({ kind: 'missing', relationshipId })
      );
    }

    const liveBytes = pkg.partBytes.get(resolved.partName);
    if (!liveBytes) {
      return storeRelationshipResult(
        ownerPartName,
        relationshipId,
        resolved,
        freezeState({ kind: 'missing', relationshipId })
      );
    }

    const snapshotted = snapshotBytes(liveBytes);
    const startGeneration = generation;
    const state = await validateAndDecodeEmbedded(
      ownerPartName,
      resolved.partName,
      snapshotted,
      startGeneration
    );
    if (startGeneration !== generation || disposed) {
      throw new Error('ImageResourceLookup stale');
    }
    const contentId =
      state.kind === 'ready' || (state.kind === 'unrenderable' && state.partName)
        ? contentIdOf(snapshotted)
        : '';
    return storeRelationshipResult(ownerPartName, relationshipId, resolved, state, contentId);
  };

  const resolveLinked = (ownerPartName: string, relationshipId: string): ImageResourceState => {
    ensureActive();
    const resolved = resolveEmbeddedPartName(pkg, ownerPartName, relationshipId);
    const cached = currentRelationshipEntry(ownerPartName, relationshipId);
    if (cached) return cached.state;

    if (resolved.mode === 'external') {
      return storeRelationshipResult(
        ownerPartName,
        relationshipId,
        resolved,
        freezeState({
          kind: 'external',
          relationshipId,
          sinkSafe: resolved.sinkSafe,
        })
      );
    }
    if (resolved.mode === 'internal') {
      return storeRelationshipResult(
        ownerPartName,
        relationshipId,
        resolved,
        unrenderable(
          resolved.partName,
          claimedMimeForPart(pkg, resolved.partName),
          'unsupported-format'
        )
      );
    }
    return storeRelationshipResult(
      ownerPartName,
      relationshipId,
      resolved,
      freezeState({ kind: 'missing', relationshipId })
    );
  };

  const resolveLegacyGraphic = createLegacyGraphicResolver({
    resolveEmbedded,
    registry: validatedBytesRegistry,
    limits,
    ensureActive,
  });

  const resolveForProjection = async (
    projection: DrawingProjection
  ): Promise<ImageResourceState> => {
    ensureActive();
    if (projection.legacyGraphic) return resolveLegacyGraphic(projection);
    const picture = projection.picture ?? projection.groupPicture;
    if (!picture) {
      return unrenderable(null, 'unknown', 'non-picture-graphic');
    }
    // An embedded copy is the picture shown; a link beside it only names the source.
    const embedded = picture.embeddedRelationshipId;
    if (embedded) return resolveEmbedded(projection.ownerPartName, embedded);
    const linked = picture.linkedRelationshipId;
    if (linked) return resolveLinked(projection.ownerPartName, linked);
    return unrenderable(null, 'unknown', 'unsupported-format');
  };

  const lookup = Object.freeze({
    resolveEmbedded,
    resolveLinked,
    resolveForProjection,
    liveReferenceCount: (partName: string) => liveDrawingReferenceCount(pkg, partName),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      lifetimeAbort.abort();
      invalidateAll();
      validatedBytesRegistry.dispose();
      unregisterLookupIfCurrent(pkg, decodePort, limits, lookup);
    },
  });
  return lookup;
}

export { IMAGE_RELATIONSHIP_TYPE };
