// Host-neutral inline picture authoring. Media and drawing nodes commit in one transaction.
import { PackageEditRefusal } from '../store/store/package-edit-refusal.ts';
import { findNode } from '../store/package/ooxml-edit.ts';
import type { OoxmlPackage } from '../store/package/ooxml-package.ts';
import type { OoxmlDrawingNode, OoxmlPart } from '../store/package/ooxml-tree.ts';
import { isValidXmlText } from '../store/package/sinks.ts';
import {
  buildInlinePictureDrawing,
  withEmbeddedImage,
  pointsToEmu,
  EMU_PER_POINT,
} from '../store/package/drawing-package-edit.ts';
import {
  projectDrawingsInPart,
  type DrawingProjection,
} from '../store/package/drawing-projection.ts';
import { sniffImageMime, validateRasterHeader } from '../store/package/image-resources.ts';
import { segmentsOf } from '../store/store/tree-op-segments.ts';
import type { TreeDocOp } from '../store/store/tree-ops.ts';
import type { AutomationPackageEdit } from './document-port.ts';

export interface AutomationInlinePictureRead {
  readonly width: number;
  readonly height: number;
  readonly lockAspectRatio: boolean;
  readonly altTextDescription: string;
}
export interface AutomationInlinePictureWrite {
  readonly width?: number;
  readonly height?: number;
  readonly lockAspectRatio?: boolean;
  readonly altTextDescription?: string;
}
type Result<T> = ({ readonly ok: true } & T) | { readonly ok: false; readonly detail: string };
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/** Decode bounded, canonical RFC 4648 base64 without a DOM or Node dependency. */
export function decodeBase64(value: string, maxBytes = MAX_IMAGE_BYTES): Uint8Array | null {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > Math.ceil(maxBytes / 3) * 4 ||
    value.length % 4 !== 0
  )
    return null;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const bytes = new Uint8Array((value.length / 4) * 3 - padding);
  let cursor = 0;
  for (let index = 0; index < value.length; index += 4) {
    const final = index + 4 === value.length;
    const count = final ? 4 - padding : 4;
    const digits = [0, 0, 0, 0];
    for (let j = 0; j < count; j++) {
      const digit = alphabet.indexOf(value[index + j]!);
      if (digit < 0) return null;
      digits[j] = digit;
    }
    if (
      final &&
      ((padding === 2 && (digits[1]! & 15) !== 0) || (padding === 1 && (digits[2]! & 3) !== 0))
    )
      return null;
    const word = (digits[0]! << 18) | (digits[1]! << 12) | (digits[2]! << 6) | digits[3]!;
    if (cursor < bytes.length) bytes[cursor++] = word >>> 16;
    if (cursor < bytes.length) bytes[cursor++] = word >>> 8;
    if (cursor < bytes.length) bytes[cursor++] = word;
  }
  return bytes;
}

export function insertPicturePlan(
  pkg: OoxmlPackage,
  partName: string,
  paragraphId: string,
  offset: number,
  base64: string
): Result<{
  readonly ops: readonly TreeDocOp[];
  readonly packageEdits: readonly AutomationPackageEdit[];
  readonly docPrId: number;
}> {
  const bytes = decodeBase64(base64);
  if (!bytes) return { ok: false, detail: 'picture: invalid or oversized base64 (20 MiB maximum)' };
  const mime = sniffImageMime(bytes);
  if (mime !== 'image/png' && mime !== 'image/jpeg')
    return { ok: false, detail: 'picture: only PNG and JPEG are supported' };
  if (!hasCompleteRasterContainer(bytes, mime))
    return { ok: false, detail: 'picture: truncated raster container' };
  const header = validateRasterHeader(bytes, mime);
  if (!header || header.pixelWidth * header.pixelHeight > 40_000_000)
    return { ok: false, detail: 'picture: invalid or oversized raster dimensions' };
  const width = (header.pixelWidth * 72) / (header.dpiX ?? 96);
  const height = (header.pixelHeight * 72) / (header.dpiY ?? 96);
  const cx = pointsToEmu(width);
  const cy = pointsToEmu(height);
  if (cx === null || cy === null)
    return { ok: false, detail: 'picture: invalid physical dimensions' };
  const embedded = withEmbeddedImage(pkg, partName, { bytes, mime });
  if (!embedded.ok) return { ok: false, detail: `picture: ${embedded.reason}` };
  const drawing = buildInlinePictureDrawing({
    docPrId: embedded.docPrId,
    lockAspectRatio: true,
    relationshipId: embedded.relationshipId,
    extentEmu: { cx, cy },
  }) as OoxmlDrawingNode;
  return {
    ok: true,
    docPrId: embedded.docPrId,
    ops: [{ op: 'insertDrawing', paragraphId, offset, drawing }],
    packageEdits: [
      (current) => {
        // Embedded again, not reused from the plan: returning the planning result dropped the
        // media part from collaborative replication (document-picture-automation.test.ts).
        const applied = withEmbeddedImage(current, partName, { bytes, mime });
        // Never point a preplanned drawing at a different allocation. Plan and commit see the same
        // package and the same collaboration actor, so a mismatch is an engine defect.
        if (
          !applied.ok ||
          applied.relationshipId !== embedded.relationshipId ||
          applied.docPrId !== embedded.docPrId ||
          applied.partName !== embedded.partName
        )
          throw new PackageEditRefusal('picture allocation changed during the batch');
        return applied.pkg;
      },
    ],
  };
}

export function pictureProjection(
  part: OoxmlPart,
  drawingNodeId: string
): DrawingProjection | null {
  return (
    projectDrawingsInPart(part).find(
      (p) => p.drawingNodeId === drawingNodeId && p.kind === 'inline' && p.picture !== null
    ) ?? null
  );
}
export function pictureRead(picture: DrawingProjection): AutomationInlinePictureRead {
  return {
    width: picture.extentEmu.cx / EMU_PER_POINT,
    height: picture.extentEmu.cy / EMU_PER_POINT,
    lockAspectRatio: picture.locks.changeAspect,
    altTextDescription: picture.description,
  };
}
export function pictureIdsInSpans(
  part: OoxmlPart,
  spans: readonly { paragraphId: string; start: number; end: number }[]
): readonly string[] {
  const supported = new Set(
    projectDrawingsInPart(part)
      .filter((p) => p.kind === 'inline' && p.picture !== null)
      .map((p) => p.drawingNodeId)
  );
  const ids: string[] = [];
  for (const span of spans) {
    const paragraph = findNode(part, span.paragraphId);
    if (!paragraph || paragraph.kind !== 'paragraph') continue;
    for (const segment of segmentsOf(paragraph)) {
      if (segment.start >= span.start && segment.end <= span.end && supported.has(segment.node.id))
        ids.push(segment.node.id);
    }
  }
  return ids;
}
export function pictureWriteOps(
  picture: DrawingProjection,
  request: AutomationInlinePictureWrite
): Result<{ readonly ops: readonly TreeDocOp[] }> {
  const ops: TreeDocOp[] = [];
  const drawingNodeId = picture.drawingNodeId;
  if (request.lockAspectRatio !== undefined && typeof request.lockAspectRatio !== 'boolean')
    return { ok: false, detail: 'lockAspectRatio: not a boolean' };
  const locked = request.lockAspectRatio ?? picture.locks.changeAspect;
  // Unlock first, then resize, then re-lock. Other authored drawing locks remain intact.
  if (request.lockAspectRatio === false)
    ops.push({ op: 'setDrawingLocks', drawingNodeId, locks: { changeAspect: false } });
  if (request.width !== undefined || request.height !== undefined) {
    let width = request.width ?? picture.extentEmu.cx / EMU_PER_POINT;
    let height = request.height ?? picture.extentEmu.cy / EMU_PER_POINT;
    if (locked) {
      const ratio = picture.extentEmu.cx / picture.extentEmu.cy;
      if (
        request.width !== undefined &&
        request.height !== undefined &&
        Math.abs(width / height - ratio) > 1e-6
      )
        return {
          ok: false,
          detail: 'picture: width and height disagree with the locked aspect ratio',
        };
      if (request.width !== undefined && request.height === undefined) height = width / ratio;
      if (request.height !== undefined && request.width === undefined) width = height * ratio;
    }
    const cx = pointsToEmu(width);
    const cy = pointsToEmu(height);
    if (cx === null || cy === null)
      return { ok: false, detail: 'picture: dimensions must be finite positive points' };
    ops.push({ op: 'resizeDrawing', drawingNodeId, extentEmu: { cx, cy } });
  }
  if (request.lockAspectRatio === true)
    ops.push({ op: 'setDrawingLocks', drawingNodeId, locks: { changeAspect: true } });
  if (request.altTextDescription !== undefined) {
    if (
      typeof request.altTextDescription !== 'string' ||
      request.altTextDescription.length > 32767 ||
      !isValidXmlText(request.altTextDescription)
    )
      return { ok: false, detail: 'altTextDescription: invalid XML text or length' };
    ops.push({
      op: 'setDrawingMetadata',
      drawingNodeId,
      title: picture.title,
      description: request.altTextDescription,
    });
  }
  return ops.length ? { ok: true, ops } : { ok: false, detail: 'picture: no properties requested' };
}

// This lane validates bounded container structure. It does not invoke a browser image decoder.
function hasCompleteRasterContainer(bytes: Uint8Array, mime: 'image/png' | 'image/jpeg'): boolean {
  if (mime === 'image/jpeg')
    return (
      bytes.length >= 4 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9
    );
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let imageData = false;
  while (offset + 12 <= bytes.length) {
    const size = view.getUint32(offset);
    if (size > bytes.length - offset - 12) return false;
    const type = String.fromCharCode(
      bytes[offset + 4]!,
      bytes[offset + 5]!,
      bytes[offset + 6]!,
      bytes[offset + 7]!
    );
    if (type === 'IDAT' && size > 0) imageData = true;
    offset += size + 12;
    if (type === 'IEND') return imageData && size === 0 && offset === bytes.length;
  }
  return false;
}
