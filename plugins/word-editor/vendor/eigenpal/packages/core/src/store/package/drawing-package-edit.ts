// Pure package primitives for embedded drawing media (typed-drawings-and-images task 5).
//
// Adds binary media parts, owner-relative image relationships, package-wide wp:docPr/@id
// allocation, and orphan media cleanup. No store transaction wiring or drawing-tree insertion.

import {
  nextDenseDecimalId,
  nextStripedDecimalId,
  partNumberCandidates,
  resolveAllocationActor,
} from './actor-scoped-ids.ts';
import { resolveContentType } from './content-types.ts';
import { VML, vmlShapeNumber } from './legacy-vml-values.ts';
import { removeNode } from './ooxml-edit.ts';
import { normalizePartName, partNameKey, resolveInternalTarget } from './opc-names.ts';
import {
  sniffImageMime,
  validateRasterHeader,
  type ImageDecodePort,
  type SupportedImageMime,
} from './image-resources.ts';
import { canonicalMediaReferenceCount } from './canonical-media-references.ts';
import { resolveImageResourceLimits } from '../runtime/limits.ts';
import {
  readOoxmlPart,
  type OoxmlAttribute,
  type OoxmlNode,
  type OoxmlPart,
} from './ooxml-tree.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import {
  relsPartNameFor,
  withContentTypeOverride,
  withContentTypeOverrides,
  withRelationship,
  withRelationshipsPartFor,
} from './package-edit.ts';
import { IMAGE_RELATIONSHIP_TYPE } from './relationships.ts';
import { withoutContentTypeOverride } from './hf-lifecycle-shell.ts';
import { sha256FontBytes as sha256Bytes } from './sha256.ts';
import {
  isCanonicalPrimitiveCaptureActive,
  recordDeleteBinary,
  recordDeleteRelationship,
  recordPutBinary,
  recordPutContentTypeOverride,
  runWithoutJournalCapture,
} from './canonical-primitive-capture.ts';

const WP_NAMESPACE_URI = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
/** `wp:docPr/@id` is `xsd:unsignedInt`, so this is the highest id any minter may take. */
export const MAX_UNSIGNED_INT = 4_294_967_295;

const MIME_TO_CONTENT_TYPE: Readonly<Record<SupportedImageMime, string>> = Object.freeze({
  'image/png': 'image/png',
  'image/jpeg': 'image/jpeg',
  'image/gif': 'image/gif',
  'image/bmp': 'image/bmp',
  'image/webp': 'image/webp',
});

const MIME_TO_EXTENSION: Readonly<Record<SupportedImageMime, string>> = Object.freeze({
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/webp': 'webp',
});

const IMAGE_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/bmp',
  'image/x-ms-bmp',
  'image/x-bmp',
  'image/webp',
  'image/svg+xml',
  'image/tiff',
  'image/x-emf',
  'image/x-wmf',
]);

/** A freshly allocated drawing property id, or the reason one could not be minted. */
export type DrawingPropertyIdResult =
  | { readonly ok: true; readonly id: number }
  | { readonly ok: false; readonly reason: 'invalidArgs' };

function isDocPrNode(node: OoxmlNode): boolean {
  if (node.kind === 'textValue') return false;
  if (node.kind === 'drawingDocPr') return true;
  return node.localName === 'docPr' && node.namespaceUri === WP_NAMESPACE_URI;
}

function isUnqualifiedIdAttribute(attribute: OoxmlAttribute): boolean {
  return attribute.localName === 'id' && attribute.namespaceUri === '';
}

/** Only the unqualified `wp:docPr/@id` attribute participates in allocation. */
function docPrIdAttributeValue(node: OoxmlNode): string | undefined {
  if (node.kind === 'textValue' || !('attributes' in node)) return undefined;
  for (const attribute of node.attributes) {
    if (!isUnqualifiedIdAttribute(attribute)) continue;
    return attribute.value;
  }
  return undefined;
}

/** Parse xsd:unsignedInt for allocation scanning; null when not a valid 1..4294967295 value. */
function parseValidDocPrId(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  let lexical = raw.trim();
  if (lexical.length === 0) return null;
  if (lexical.startsWith('+')) lexical = lexical.slice(1);
  if (lexical.length === 0) return null;
  for (let index = 0; index < lexical.length; index += 1) {
    const code = lexical.charCodeAt(index);
    if (code < 0x30 || code > 0x39) return null;
  }
  let digits = lexical;
  while (digits.length > 1 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  if (digits.length > 10) return null;
  const value = Number(digits);
  if (!Number.isInteger(value) || value <= 0 || value > MAX_UNSIGNED_INT) return null;
  return value;
}

function walkNodes(node: OoxmlNode, visit: (node: OoxmlNode) => void): void {
  visit(node);
  if (node.kind === 'textValue') return;
  for (const child of node.children) walkNodes(child, visit);
}

/**
 * Every valid `wp:docPr/@id` the package holds, and the highest of them.
 *
 * Legacy VML shape numbers are marked used too, without raising `highest`. Shape automation
 * names a VML shape by that number, so a minted drawing id must not take it.
 *
 * `0` is seeded as used. It is a legal `xsd:unsignedInt` but names no drawing here —
 * {@link parseValidDocPrId} refuses it, so an id nothing can read back must never be minted.
 * The solo walk is `highest + 1` and cannot reach it; a striped residue of 0 would.
 *
 * Exported because the clipboard merge mints a RUN of these ids for one paste and needs the
 * same occupancy — reserved `0` included — that {@link allocateDrawingPropertyId} allocates
 * against for a single one.
 */
export function drawingPropertyIdOccupancy(pkg: OoxmlPackage): {
  readonly highest: number;
  readonly used: Set<string>;
} {
  let highest = 0;
  const used = new Set<string>(['0']);
  for (const part of pkg.parts.values()) {
    walkNodes(part.root, (node) => {
      if (node.kind !== 'textValue' && node.namespaceUri === VML) {
        const number = vmlShapeNumber(node);
        if (number !== null) used.add(String(number));
        return;
      }
      if (!isDocPrNode(node)) return;
      const parsed = parseValidDocPrId(docPrIdAttributeValue(node));
      if (parsed === null) return;
      used.add(String(parsed));
      if (parsed > highest) highest = parsed;
    });
  }
  return { highest, used };
}

/**
 * Mint a `wp:docPr` id unused anywhere in the package.
 *
 * Package-wide rather than per-part: Word treats these ids as document-global, and a collision
 * makes it renumber on open.
 *
 * Solo: `highest + 1`, the dense sequence Word writes. With a collaboration actor bound —
 * explicit argument, or the open store transaction — the id is the next unused value in that
 * actor's stripe. Two peers inserting a picture from one snapshot otherwise both mint `id="1"`,
 * and the merged document carries two drawings under one document-global id.
 */
export function allocateDrawingPropertyId(
  pkg: OoxmlPackage,
  actorId?: string
): DrawingPropertyIdResult {
  const { highest, used } = drawingPropertyIdOccupancy(pkg);
  const actor = resolveAllocationActor(actorId);
  let next: number;
  try {
    next = Number(
      actor
        ? nextStripedDecimalId(used, actor, MAX_UNSIGNED_INT)
        : nextDenseDecimalId(highest, undefined, MAX_UNSIGNED_INT)
    );
  } catch {
    return { ok: false, reason: 'invalidArgs' };
  }
  // Only VML shape numbers can sit above `highest`; the walk ends within `used.size` steps.
  while (!actor && used.has(String(next))) next += 1;
  if (next <= 0 || next > MAX_UNSIGNED_INT) {
    return { ok: false, reason: 'invalidArgs' };
  }
  return { ok: true, id: next };
}

function canonicalPartKey(partName: string): string | null {
  const normalized = normalizePartName(partName);
  return normalized.ok ? partNameKey(normalized.partName) : null;
}

function partPresent(pkg: OoxmlPackage, partName: string): boolean {
  const key = canonicalPartKey(partName);
  if (key === null) return false;
  for (const name of pkg.parts.keys()) {
    if (canonicalPartKey(name) === key) return true;
  }
  for (const name of pkg.partBytes.keys()) {
    if (canonicalPartKey(name) === key) return true;
  }
  return false;
}

function usesAbsolutePartNames(pkg: OoxmlPackage): boolean {
  for (const map of [pkg.partBytes, pkg.parts]) {
    for (const name of map.keys()) if (name.startsWith('/')) return true;
  }
  return false;
}

function storagePartName(canonical: string, pkg: OoxmlPackage): string {
  if (usesAbsolutePartNames(pkg)) return canonical;
  return canonical.startsWith('/') ? canonical.slice(1) : canonical;
}

function snapshotPartBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function storedPartBytes(pkg: OoxmlPackage, partName: string): Uint8Array | null {
  const key = canonicalPartKey(partName);
  if (key === null) return null;
  for (const [name, bytes] of pkg.partBytes) {
    if (canonicalPartKey(name) === key) return bytes;
  }
  return null;
}

/** Signature + header + dimension caps — the gate every media WRITE must pass. */
export function validateEmbeddedImageBytes(bytes: Uint8Array, mime: SupportedImageMime): boolean {
  const limits = resolveImageResourceLimits();
  if (bytes.length === 0 || bytes.length > limits.maxEncodedBytes) return false;
  if (sniffImageMime(bytes) !== mime) return false;
  const header = validateRasterHeader(bytes, mime);
  if (!header) return false;
  if (header.pixelWidth > limits.maxDimension || header.pixelHeight > limits.maxDimension) {
    return false;
  }
  if (header.pixelWidth > Number.MAX_SAFE_INTEGER / header.pixelHeight) return false;
  if (header.pixelWidth * header.pixelHeight > limits.maxPixels) return false;
  return true;
}

/** Bounded decode-port validation required before any package media write (task 12). */
export async function validateEmbeddedImageForCommit(
  decodePort: ImageDecodePort,
  bytes: Uint8Array,
  mime: SupportedImageMime,
  limits: ReturnType<typeof resolveImageResourceLimits> = resolveImageResourceLimits()
): Promise<Readonly<{ ok: true; bytes: Uint8Array } | { ok: false; reason: 'invalid-image' }>> {
  if (bytes.byteLength === 0 || bytes.byteLength > limits.maxEncodedBytes) {
    return { ok: false, reason: 'invalid-image' };
  }
  const snapshotted = snapshotPartBytes(bytes);
  if (!validateEmbeddedImageBytes(snapshotted, mime)) {
    return { ok: false, reason: 'invalid-image' };
  }
  const header = validateRasterHeader(snapshotted, mime);
  if (!header) return { ok: false, reason: 'invalid-image' };
  const decodeCopy = snapshotPartBytes(snapshotted);
  try {
    const decoded = await decodePort.decode(decodeCopy, mime, limits);
    if (
      decoded.pixelWidth !== header.pixelWidth ||
      decoded.pixelHeight !== header.pixelHeight ||
      decoded.pixelWidth <= 0 ||
      decoded.pixelHeight <= 0 ||
      decoded.pixelWidth > limits.maxDimension ||
      decoded.pixelHeight > limits.maxDimension ||
      decoded.pixelWidth * decoded.pixelHeight > limits.maxPixels
    ) {
      return { ok: false, reason: 'invalid-image' };
    }
  } catch {
    return { ok: false, reason: 'invalid-image' };
  }
  return { ok: true, bytes: snapshotted };
}

function allocateMediaPartName(pkg: OoxmlPackage, ext: string): string | null {
  for (const index of partNumberCandidates(Number.MAX_SAFE_INTEGER)) {
    const canonical = `/word/media/image${index}.${ext}`;
    if (!partPresent(pkg, canonical)) return storagePartName(canonical, pkg);
  }
  return null;
}

function relationshipTargetForMediaPart(partName: string): string | null {
  const normalized = normalizePartName(partName);
  if (!normalized.ok) return null;
  const canonical = normalized.partName;
  if (!canonical.startsWith('/word/media/')) return null;
  return canonical.slice('/word/'.length);
}

function drawingReferencesRelationship(
  pkg: OoxmlPackage,
  ownerPart: string,
  relationshipId: string
): boolean {
  const part = pkg.parts.get(ownerPart);
  if (!part) return true;
  const references = canonicalMediaReferenceCount(part.root, new Set([relationshipId]));
  return references.count > 0 || references.truncated;
}

function isPartReferencedByAnyInternalRelationship(pkg: OoxmlPackage, partName: string): boolean {
  const key = canonicalPartKey(partName);
  if (key === null) return false;
  for (const records of pkg.relationships.values()) {
    for (const record of records) {
      if (record.targetMode === 'External') continue;
      const resolved = resolveInternalTarget(record.ownerPart, record.rawTarget);
      if (resolved.ok && canonicalPartKey(resolved.partName) === key) return true;
    }
  }
  return false;
}

/** Authored media references include preserved VML and unselected compatibility branches. */
export function liveDrawingReferenceCount(pkg: OoxmlPackage, partName: string): number {
  const key = canonicalPartKey(partName);
  if (key === null) return 0;
  let count = 0;
  for (const [ownerPart, relationships] of pkg.relationships) {
    const ids = new Set<string>();
    for (const relationship of relationships) {
      if (relationship.targetMode === 'External' || relationship.type !== IMAGE_RELATIONSHIP_TYPE)
        continue;
      const resolved = resolveInternalTarget(ownerPart, relationship.rawTarget);
      if (resolved.ok && canonicalPartKey(resolved.partName) === key) {
        ids.add(relationship.id);
      }
    }
    if (ids.size === 0) continue;
    const part = pkg.parts.get(ownerPart);
    if (!part) return Math.max(1, count);
    const references = canonicalMediaReferenceCount(part.root, ids);
    count += references.count;
    // A bounded scan cannot prove a resource orphaned after truncation.
    if (references.truncated) return Math.max(1, count);
  }
  return count;
}

function isRemovableImageMediaPart(pkg: OoxmlPackage, partName: string): boolean {
  const normalized = normalizePartName(partName);
  if (!normalized.ok) return false;
  if (!normalized.partName.startsWith('/word/media/')) return false;
  const resolved = resolveContentType(pkg.contentTypes, normalized.partName);
  if (!resolved.ok) return false;
  return IMAGE_CONTENT_TYPES.has(resolved.contentType.toLowerCase());
}

/**
 * Store raw bytes for a part and declare its exact content type.
 *
 * Does not create a relationship; callers decide which owner points at the part.
 */
export function withBinaryPart(
  pkg: OoxmlPackage,
  partName: string,
  bytes: Uint8Array,
  contentType: string
): OoxmlPackage {
  const normalized = normalizePartName(partName);
  if (!normalized.ok) return pkg;
  const storedName = storagePartName(normalized.partName, pkg);
  const copied = snapshotPartBytes(bytes);
  const existingBytes = storedPartBytes(pkg, normalized.partName);
  if (existingBytes !== null && bytesEqual(existingBytes, copied)) {
    return withContentTypeOverride(pkg, normalized.partName, contentType, { forceOverride: true });
  }
  const next = runWithoutJournalCapture(() => {
    const partBytes = new Map(pkg.partBytes);
    partBytes.set(storedName, copied);
    const parts = new Map(pkg.parts);
    const storedKey = canonicalPartKey(storedName);
    for (const name of [...parts.keys()]) {
      if (storedKey !== null && canonicalPartKey(name) === storedKey) parts.delete(name);
    }
    return withContentTypeOverride(
      Object.freeze({ ...pkg, partBytes, parts }),
      normalized.partName,
      contentType,
      { forceOverride: true }
    );
  });
  if (isCanonicalPrimitiveCaptureActive()) {
    recordPutBinary({
      storageKey: storedName,
      digest: sha256Bytes(copied),
      size: copied.byteLength,
      mediaType: contentType,
    });
    // The override was written with capture off, beside the bytes. A peer builds its content
    // types from recorded overrides only, so without this record it held the bytes untyped.
    recordPutContentTypeOverride(normalized.partName, contentType);
  }
  return next;
}

/**
 * Add image bytes to the package: the media part, its content type, and the relationship.
 *
 * All three together — bytes with no relationship are unreachable, and a relationship with no
 * content-type record makes the package invalid.
 */
export function withEmbeddedImage(
  pkg: OoxmlPackage,
  ownerPartName: string,
  input: Readonly<{ bytes: Uint8Array; mime: SupportedImageMime }>
):
  | Readonly<{
      ok: true;
      pkg: OoxmlPackage;
      partName: string;
      relationshipId: string;
      docPrId: number;
    }>
  | Readonly<{ ok: false; reason: 'invalidArgs' | 'invalid-image' }> {
  const ownerNormalized = normalizePartName(ownerPartName);
  if (!ownerNormalized.ok) return { ok: false, reason: 'invalidArgs' };
  const owner = ownerNormalized.partName;
  if (!pkg.parts.has(owner)) return { ok: false, reason: 'invalidArgs' };
  if (!validateEmbeddedImageBytes(input.bytes, input.mime)) {
    return { ok: false, reason: 'invalid-image' };
  }

  const allocatedId = allocateDrawingPropertyId(pkg);
  if (!allocatedId.ok) return { ok: false, reason: 'invalidArgs' };

  const ext = MIME_TO_EXTENSION[input.mime];
  const mediaPartName = allocateMediaPartName(pkg, ext);
  if (mediaPartName === null) return { ok: false, reason: 'invalidArgs' };

  const contentType = MIME_TO_CONTENT_TYPE[input.mime];
  let next = withBinaryPart(pkg, mediaPartName, input.bytes, contentType);

  const target = relationshipTargetForMediaPart(mediaPartName);
  if (target === null) return { ok: false, reason: 'invalidArgs' };

  // MINT THE OWNER'S `.rels` PART FIRST. `withRelationship` fails closed when the owner has
  // none, and a header, a footer or a notes part that carries no relationship yet has no
  // `.rels` entry at all — the ordinary shape for a plain-text header, and near-universal for
  // a notes part. So Insert Picture was refused in every story but the body, which always has
  // one. The custom-XML lane already does this and the hyperlink lane authors its own; this
  // lane did neither.
  //
  // `withRelationshipsPartFor` still fails closed when the `.rels` exists only as bytes, so
  // the refusal below keeps its meaning for a package this cannot safely edit.
  const related = withRelationship(
    withRelationshipsPartFor(next, owner),
    owner,
    IMAGE_RELATIONSHIP_TYPE,
    target
  );
  if (!related.ok) return { ok: false, reason: 'invalidArgs' };
  next = related.pkg;

  return Object.freeze({
    ok: true,
    pkg: next,
    partName: mediaPartName,
    relationshipId: related.relationshipId,
    docPrId: allocatedId.id,
  });
}

/**
 * Store MANY binary parts and declare their content types in ONE package rebuild — the
 * batched twin of {@link withBinaryPart}. A per-part call copies the whole `partBytes` map
 * and re-serializes `[Content_Types].xml`, which is quadratic when a clipboard paste
 * installs thousands of distinct media parts; this copies and serializes once.
 */
export function withBinaryParts(
  pkg: OoxmlPackage,
  additions: ReadonlyArray<{
    readonly partName: string;
    readonly bytes: Uint8Array;
    readonly contentType: string;
  }>
): OoxmlPackage {
  if (additions.length === 0) return pkg;
  const capture = isCanonicalPrimitiveCaptureActive();
  const recorded: Array<{
    readonly storageKey: string;
    readonly digest: string;
    readonly size: number;
    readonly mediaType: string;
  }> = [];
  const overrides: Array<readonly [string, string]> = [];
  const withBytes = runWithoutJournalCapture(() => {
    const partBytes = new Map(pkg.partBytes);
    const parts = new Map(pkg.parts);
    const absoluteNames = usesAbsolutePartNames(pkg);
    const replacedKeys = new Set<string>();
    for (const addition of additions) {
      const normalized = normalizePartName(addition.partName);
      if (!normalized.ok) continue;
      const storedName = absoluteNames ? normalized.partName : normalized.partName.slice(1);
      const copied = snapshotPartBytes(addition.bytes);
      partBytes.set(storedName, copied);
      const storedKey = canonicalPartKey(storedName);
      if (storedKey !== null) replacedKeys.add(storedKey);
      overrides.push([normalized.partName, addition.contentType]);
      if (capture) {
        recorded.push({
          storageKey: storedName,
          digest: sha256Bytes(copied),
          size: copied.byteLength,
          mediaType: addition.contentType,
        });
      }
    }
    for (const name of parts.keys()) {
      const key = canonicalPartKey(name);
      if (key !== null && replacedKeys.has(key)) parts.delete(name);
    }
    return Object.freeze({ ...pkg, partBytes, parts });
  });
  const next = withContentTypeOverrides(withBytes, overrides);
  if (capture) {
    for (const descriptor of recorded) recordPutBinary(descriptor);
  }
  return next;
}

/** English typographic points → EMUs (914400 EMU per inch, 72 pt per inch). */
export const EMU_PER_POINT = 12_700;

export function pointsToEmu(points: number): number | null {
  if (!Number.isFinite(points) || points <= 0) return null;
  const emu = Math.round(points * EMU_PER_POINT);
  if (emu <= 0 || emu > ST_POSITIVE_COORDINATE_MAX) return null;
  return emu;
}

import { ST_POSITIVE_COORDINATE_MAX } from './ooxml-drawing-rules.ts';

const WML_NAMESPACE_URI = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const DRAWINGML_MAIN_NAMESPACE_URI = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC_NAMESPACE_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const RELATIONSHIPS_NAMESPACE_URI =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

export interface InlinePictureDrawingInput {
  readonly lockAspectRatio?: boolean;
  readonly docPrId: number;
  readonly relationshipId: string;
  readonly extentEmu: { readonly cx: number; readonly cy: number };
  readonly title?: string;
  readonly description?: string;
  readonly hyperlinkRelationshipId?: string;
}

function walkDrawingNode(node: OoxmlNode, visit: (node: OoxmlNode) => void): void {
  visit(node);
  if (node.kind === 'textValue') return;
  for (const child of node.children) walkDrawingNode(child, visit);
}

function firstDrawingNode(part: OoxmlPart): OoxmlNode | null {
  let found: OoxmlNode | null = null;
  walkDrawingNode(part.root, (node) => {
    if (found === null && node.kind === 'drawing') found = node;
  });
  return found;
}

/** Build a schema-valid inline picture `w:drawing` for {@link insertDrawing}. */
export function buildInlinePictureDrawing(input: InlinePictureDrawingInput): OoxmlNode {
  const cx = Math.round(input.extentEmu.cx);
  const cy = Math.round(input.extentEmu.cy);
  const docPrParts = [`id="${input.docPrId}"`, 'name=""'];
  if (input.title && input.title.length > 0) {
    docPrParts.push(`title="${escapeXmlAttribute(input.title)}"`);
  }
  if (input.description && input.description.length > 0) {
    docPrParts.push(`descr="${escapeXmlAttribute(input.description)}"`);
  }
  const hlinkChild = input.hyperlinkRelationshipId
    ? `<a:hlinkClick r:id="${escapeXmlAttribute(input.hyperlinkRelationshipId)}"/>`
    : '';
  const xml =
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP_NAMESPACE_URI}"` +
    ` xmlns:a="${DRAWINGML_MAIN_NAMESPACE_URI}" xmlns:pic="${PIC_NAMESPACE_URI}"` +
    ` xmlns:r="${RELATIONSHIPS_NAMESPACE_URI}">` +
    '<w:body><w:p><w:r><w:drawing>' +
    '<wp:inline distT="0" distB="0" distL="0" distR="0">' +
    `<wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:docPr ${docPrParts.join(' ')}>${hlinkChild}</wp:docPr>` +
    (input.lockAspectRatio
      ? '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>'
      : '<wp:cNvGraphicFramePr/>') +
    `<a:graphic><a:graphicData uri="${PIC_URI}">` +
    '<pic:pic>' +
    '<pic:nvPicPr><pic:cNvPr id="0" name="" descr=""/><pic:cNvPicPr/></pic:nvPicPr>' +
    `<pic:blipFill><a:blip r:embed="${escapeXmlAttribute(input.relationshipId)}"/>` +
    '<a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic>' +
    '</wp:inline></w:drawing></w:r></w:p></w:body></w:document>';
  const parsed = readOoxmlPart(xml, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!parsed.ok) throw new Error(`buildInlinePictureDrawing: ${parsed.reason}`);
  const drawing = firstDrawingNode(parsed.part);
  if (!drawing || drawing.kind !== 'drawing') {
    throw new Error('buildInlinePictureDrawing: missing drawing');
  }
  return drawing;
}

function escapeXmlAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

/** Remove an orphaned image media part after a package-wide internal relationship target check. */
export function withoutUnreferencedImagePart(pkg: OoxmlPackage, partName: string): OoxmlPackage {
  const normalized = normalizePartName(partName);
  if (!normalized.ok) return pkg;
  if (!isRemovableImageMediaPart(pkg, normalized.partName)) return pkg;
  if (liveDrawingReferenceCount(pkg, normalized.partName) > 0) return pkg;
  if (isPartReferencedByAnyInternalRelationship(pkg, normalized.partName)) return pkg;

  const storedName = storagePartName(normalized.partName, pkg);
  const next = runWithoutJournalCapture(() =>
    removeUnreferencedImagePart(pkg, normalized.partName, storedName)
  );
  if (next !== pkg) recordDeleteBinary(storedName);
  return next;
}

function removeUnreferencedImagePart(
  pkg: OoxmlPackage,
  partName: string,
  storedName: string
): OoxmlPackage {
  const partBytes = new Map(pkg.partBytes);
  const storedKey = canonicalPartKey(storedName);
  let removed = false;
  if (storedKey !== null) {
    for (const name of [...partBytes.keys()]) {
      if (canonicalPartKey(name) === storedKey) {
        partBytes.delete(name);
        removed = true;
      }
    }
  }
  if (!removed && !partPresent(pkg, partName)) return pkg;

  const parts = new Map(pkg.parts);
  if (storedKey !== null) {
    for (const name of [...parts.keys()]) {
      if (canonicalPartKey(name) === storedKey) parts.delete(name);
    }
  }

  const withoutBytes = Object.freeze({ ...pkg, partBytes, parts });
  return withoutContentTypeOverride(withoutBytes, partName) ?? withoutBytes;
}

function relsAttribute(node: OoxmlNode, localName: string): string | undefined {
  if (node.kind === 'textValue' || !('attributes' in node)) return undefined;
  return node.attributes.find(
    (attribute) => attribute.localName === localName && attribute.namespaceUri === ''
  )?.value;
}

/** Drop one internal relationship from an owner part and its `.rels` tree. */
export function removeOwnerRelationship(
  pkg: OoxmlPackage,
  ownerPart: string,
  relationshipId: string
): OoxmlPackage | null {
  const owned = pkg.relationships.get(ownerPart) ?? [];
  const record = owned.find((entry) => entry.id === relationshipId);
  if (!record) return pkg;
  const next = runWithoutJournalCapture(() =>
    dropOwnerRelationship(pkg, ownerPart, relationshipId)
  );
  if (next && next !== pkg) recordDeleteRelationship(ownerPart, relationshipId);
  return next;
}

function dropOwnerRelationship(
  pkg: OoxmlPackage,
  ownerPart: string,
  relationshipId: string
): OoxmlPackage | null {
  const owned = pkg.relationships.get(ownerPart) ?? [];
  const record = owned.find((entry) => entry.id === relationshipId);
  if (!record) return pkg;
  const nextOwned = owned.filter((entry) => entry.id !== relationshipId);
  const relationships = new Map([...pkg.relationships, [ownerPart, nextOwned]]);

  const relsName = relsPartNameFor(ownerPart);
  const relsPart = pkg.parts.get(relsName);
  if (!relsPart) {
    return Object.freeze({ ...pkg, relationships });
  }

  const node = relsPart.root.children.find(
    (child) =>
      child.kind !== 'textValue' &&
      child.localName === 'Relationship' &&
      relsAttribute(child, 'Id') === relationshipId
  );
  if (!node) {
    return Object.freeze({ ...pkg, relationships });
  }
  const removed = removeNode(relsPart, node.id);
  if (!removed.ok) return null;
  return Object.freeze({
    ...pkg,
    parts: new Map([...pkg.parts, [relsName, removed.part]]),
    relationships,
  });
}

/** Remove external image target metadata when nothing references the relationship id. */
export function removeExternalImageTargetIfUnused(
  pkg: OoxmlPackage,
  ownerPart: string,
  relationshipId: string
): OoxmlPackage {
  if (drawingReferencesRelationship(pkg, ownerPart, relationshipId)) return pkg;
  const externalTargets = pkg.externalTargets.filter(
    (entry) => !(entry.ownerPart === ownerPart && entry.id === relationshipId)
  );
  if (externalTargets.length === pkg.externalTargets.length) return pkg;
  return Object.freeze({ ...pkg, externalTargets: Object.freeze(externalTargets) });
}

/**
 * After a drawing resource swap or delete, drop orphaned media parts/relationships.
 * Uses {@link liveDrawingReferenceCount} for embedded parts and relationship scans for cleanup.
 */
export function cleanupOrphanImageMedia(
  pkg: OoxmlPackage,
  ownerPart: string,
  previousMediaPart: string | null,
  previousRelationshipId: string | null
): OoxmlPackage {
  let next = pkg;
  if (previousRelationshipId !== null) {
    if (!drawingReferencesRelationship(next, ownerPart, previousRelationshipId)) {
      const removed = removeOwnerRelationship(next, ownerPart, previousRelationshipId);
      if (removed !== null) next = removed;
    }
  }
  if (previousMediaPart !== null && liveDrawingReferenceCount(next, previousMediaPart) === 0) {
    next = withoutUnreferencedImagePart(next, previousMediaPart);
  }
  if (previousRelationshipId !== null) {
    next = removeExternalImageTargetIfUnused(next, ownerPart, previousRelationshipId);
  }
  return next;
}

export interface ExternalImageFetchPort {
  /** Atomically resolve, reject non-public addresses, and connect for one HTTPS hop. */
  requestPublicHttps(
    url: string,
    init: Readonly<{ redirect: 'manual'; signal: AbortSignal }>
  ): Promise<
    Readonly<{
      status: number;
      location: string | null;
      contentType: string | null;
      body: AsyncIterable<Uint8Array>;
      /** Must equal the requested absolute URL for this hop. */
      connectedUrl: string;
    }>
  >;
}

export type ExternalImageFetchRejection = 'fetch-refused' | 'invalid-image' | 'invalidArgs';

function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
  if (host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true;
  if (host.startsWith('ff')) return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true;
  }
  return false;
}

function validateExternalImageFetchUrl(
  raw: string
): Readonly<{ ok: true; href: string } | { ok: false; detail: string }> {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, detail: 'relative-url' };
  }
  if (parsed.protocol !== 'https:') return { ok: false, detail: 'https-only' };
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    return { ok: false, detail: 'embedded-credentials' };
  }
  if (isPrivateOrLocalHost(parsed.hostname)) return { ok: false, detail: 'private-network' };
  return { ok: true, href: parsed.href };
}

function resolveRedirectUrl(base: string, location: string): string | null {
  try {
    return new URL(location, base).href;
  } catch {
    return null;
  }
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function mimeFromContentTypeHeader(contentType: string | null): SupportedImageMime | 'unknown' {
  if (!contentType) return 'unknown';
  const base = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (base === 'image/png') return 'image/png';
  if (base === 'image/jpeg' || base === 'image/jpg') return 'image/jpeg';
  if (base === 'image/gif') return 'image/gif';
  return 'unknown';
}

/** Manual-hop external fetch with scheme validation, byte cap, and raster validation. */
export async function fetchExternalImageBytes(
  port: ExternalImageFetchPort,
  initialUrl: string,
  signal: AbortSignal,
  limits: ReturnType<typeof resolveImageResourceLimits> = resolveImageResourceLimits(),
  decodePort?: ImageDecodePort
): Promise<
  | { readonly ok: true; readonly bytes: Uint8Array; readonly mime: SupportedImageMime }
  | { readonly ok: false; readonly reason: ExternalImageFetchRejection; readonly detail?: string }
> {
  if (typeof port.requestPublicHttps !== 'function') {
    return { ok: false, reason: 'fetch-refused', detail: 'atomic-fetch-port-required' };
  }

  const allowed = validateExternalImageFetchUrl(initialUrl);
  if (!allowed.ok) {
    return { ok: false, reason: 'fetch-refused', detail: allowed.detail };
  }
  let url = allowed.href;
  let redirects = 0;

  while (true) {
    if (signal.aborted) return { ok: false, reason: 'fetch-refused', detail: 'aborted' };
    const hopAllowed = validateExternalImageFetchUrl(url);
    if (!hopAllowed.ok) {
      return { ok: false, reason: 'fetch-refused', detail: hopAllowed.detail };
    }
    url = hopAllowed.href;
    let response: Awaited<ReturnType<ExternalImageFetchPort['requestPublicHttps']>>;
    try {
      response = await port.requestPublicHttps(url, { redirect: 'manual', signal });
    } catch {
      return { ok: false, reason: 'fetch-refused', detail: 'network-error' };
    }

    if (response.connectedUrl !== url) {
      return { ok: false, reason: 'fetch-refused', detail: 'connected-url-mismatch' };
    }

    if (response.status >= 300 && response.status < 400 && response.location) {
      if (redirects >= limits.maxExternalRedirects) {
        return { ok: false, reason: 'fetch-refused', detail: 'redirect-limit' };
      }
      const resolved = resolveRedirectUrl(url, response.location);
      if (resolved === null) {
        return { ok: false, reason: 'fetch-refused', detail: 'bad-redirect' };
      }
      const nextAllowed = validateExternalImageFetchUrl(resolved);
      if (!nextAllowed.ok) {
        return { ok: false, reason: 'fetch-refused', detail: nextAllowed.detail };
      }
      url = nextAllowed.href;
      redirects += 1;
      continue;
    }

    if (response.status !== 200) {
      return { ok: false, reason: 'fetch-refused', detail: `status-${response.status}` };
    }

    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for await (const chunk of response.body) {
        if (signal.aborted) return { ok: false, reason: 'fetch-refused', detail: 'aborted' };
        total += chunk.length;
        if (total > limits.maxEncodedBytes) {
          return { ok: false, reason: 'invalid-image', detail: 'byte-limit' };
        }
        chunks.push(chunk);
      }
    } catch {
      return { ok: false, reason: 'fetch-refused', detail: 'network-error' };
    }

    const bytes = concatBytes(chunks);
    const sniffed = sniffImageMime(bytes);
    if (sniffed !== 'image/png' && sniffed !== 'image/jpeg' && sniffed !== 'image/gif') {
      return { ok: false, reason: 'invalid-image', detail: 'unsupported-format' };
    }
    const claimed = mimeFromContentTypeHeader(response.contentType);
    if (claimed !== 'unknown' && claimed !== sniffed) {
      return { ok: false, reason: 'invalid-image', detail: 'content-type-spoof' };
    }
    if (!validateEmbeddedImageBytes(bytes, sniffed)) {
      return { ok: false, reason: 'invalid-image', detail: 'invalid-bytes' };
    }
    if (decodePort) {
      const decoded = await validateEmbeddedImageForCommit(decodePort, bytes, sniffed, limits);
      if (!decoded.ok) {
        return { ok: false, reason: 'invalid-image', detail: 'invalid-bytes' };
      }
      return { ok: true, bytes: decoded.bytes, mime: sniffed };
    }
    return { ok: true, bytes: snapshotPartBytes(bytes), mime: sniffed };
  }
}
