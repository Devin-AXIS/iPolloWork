// Document watermarks: the VML text or picture shape a header carries behind the page.
//
// A watermark is not a drawing the author placed in one header: it belongs to every header a
// section shows (default, first page, even page), with the same shape in each.
// Reading picks the watermark the first section shows; writing removes every watermark shape
// from every header part and adds the new one to each header a section shows, creating the
// section's default header when it has none. The write is pure and all-or-nothing.
//
// Detection is conservative: only a shape whose id carries a watermark prefix counts.
// An ordinary VML shape in a header is never claimed or removed.
//
// Security: every value written into XML is validated or escaped; the shape markup is engine
// literals plus numbers, colours and an escaped string.
import { createNodeIdAllocator, insertChildren, removeNode } from './ooxml-edit.ts';
import { readOoxmlPart, type OoxmlElement, type OoxmlNode, type OoxmlPart } from './ooxml-tree.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import { withPart } from './ooxml-package.ts';
import { WML_NAMESPACE_URI } from './ooxml-shared.ts';
import { resolveRelationship } from './relationships.ts';
import type { HeaderFooterLifecycleResult } from './hf-lifecycle.ts';
import {
  headerFooterVariantCanPaint,
  resolveHeaderFooterResolutionBySection,
  type HeaderFooterVariant,
} from './hf-references.ts';
import {
  removeOwnerRelationship,
  withEmbeddedImage,
  withoutUnreferencedImagePart,
} from './drawing-package-edit.ts';
import type { SupportedImageMime } from './image-resources.ts';
import { legacyImageEffects } from './legacy-vml-image-effects.ts';
import { legacyTextArt, TEXT_WATERMARK_ID_PREFIX } from './legacy-vml-text-art.ts';
import {
  attribute as a,
  children,
  escapeXml,
  named,
  points,
  styleOf,
  VML,
} from './legacy-vml-values.ts';

const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const O_NS = 'urn:schemas-microsoft-com:office:office';
const W10_NS = 'urn:schemas-microsoft-com:office:word';
const TEXT_PREFIX = TEXT_WATERMARK_ID_PREFIX;
const PICTURE_PREFIX = 'WordPictureWatermark';
/** Cap on header parts a write visits; a document has a handful per section. */
const MAX_HEADER_PARTS = 512;
/** The watermark layer: behind the text, below other behind-text drawings. */
const Z_INDEX = -251657216;

/** A text watermark as the package stores it. */
export interface PackageTextWatermark {
  readonly kind: 'text';
  readonly text: string;
  readonly fontFamily: string;
  /** Null for Auto size, which fits the text to the shape box. */
  readonly fontSizePt: number | null;
  readonly bold: boolean;
  readonly italic: boolean;
  /** `RRGGBB`. */
  readonly colorHex: string;
  /** Fill opacity in [0, 1]; the dialog's Transparency is `1 - opacity`. */
  readonly opacity: number;
  readonly diagonal: boolean;
  readonly widthPt: number;
  readonly heightPt: number;
}

/** A picture watermark as the package stores it. */
export interface PackagePictureWatermark {
  readonly kind: 'picture';
  readonly washout: boolean;
  readonly widthPt: number;
  readonly heightPt: number;
}

export type PackageWatermark = PackageTextWatermark | PackagePictureWatermark;

/** One section's shape size, in points. */
export interface PackageWatermarkSize {
  readonly widthPt: number;
  readonly heightPt: number;
}

/**
 * A write may size the shape per section, indexed like the body's sections: a header part
 * takes the size of the first section that shows it, so a landscape section's watermark
 * fits its own text area. A missing or unusable entry falls back to `widthPt`/`heightPt`.
 */
interface PackageWatermarkSectionSizes {
  readonly sectionSizes?: readonly (PackageWatermarkSize | null)[];
}

/** A picture watermark write carries the image bytes. */
export type PackageWatermarkWrite =
  | (PackageTextWatermark & PackageWatermarkSectionSizes)
  | (PackagePictureWatermark &
      PackageWatermarkSectionSizes & {
        readonly image: { readonly bytes: Uint8Array; readonly mime: SupportedImageMime };
      });

/** The watermark read from a header, with where its picture lives. */
export type PackageWatermarkReading =
  | PackageTextWatermark
  | (PackagePictureWatermark & {
      readonly ownerPartName: string;
      readonly relationshipId: string;
      readonly mediaPartName: string | null;
    });

function elementChildren(node: OoxmlNode): readonly OoxmlElement[] {
  return node.kind === 'textValue'
    ? []
    : (node.children.filter((c) => c.kind !== 'textValue') as OoxmlElement[]);
}

function watermarkShape(node: OoxmlElement): OoxmlElement | null {
  if (node.namespaceUri !== VML || node.localName !== 'shape') return null;
  const id = a(node, 'id') ?? '';
  return id.startsWith(TEXT_PREFIX) || id.startsWith(PICTURE_PREFIX) ? node : null;
}

/** Every `w:r` in a header part that holds a watermark shape, with that shape. */
function watermarkRuns(part: OoxmlPart): Array<{ run: OoxmlElement; shape: OoxmlElement }> {
  const found: Array<{ run: OoxmlElement; shape: OoxmlElement }> = [];
  const stack: Array<{ node: OoxmlElement; run: OoxmlElement | null; depth: number }> = [
    { node: part.root, run: null, depth: 0 },
  ];
  let visited = 0;
  while (stack.length && visited++ < 200_000) {
    const { node, run, depth } = stack.pop()!;
    const owner = named(node, WML_NAMESPACE_URI, 'r') ? node : run;
    const shape = watermarkShape(node);
    if (shape && owner) {
      found.push({ run: owner, shape });
      continue;
    }
    if (depth > 64) continue;
    for (const child of elementChildren(node))
      stack.push({ node: child, run: owner, depth: depth + 1 });
  }
  return found;
}

function readShape(
  part: OoxmlPart,
  shape: OoxmlElement,
  pkg: OoxmlPackage
): PackageWatermarkReading | null {
  const style = styleOf(shape);
  const widthPt = points(style?.get('width')),
    heightPt = points(style?.get('height'));
  if (!(widthPt > 0) || !(heightPt > 0)) return null;
  if ((a(shape, 'id') ?? '').startsWith(TEXT_PREFIX)) {
    const art = legacyTextArt(shape);
    const path = children(shape).find((n) => named(n, VML, 'textpath'));
    if (!art || !path) return null;
    const size = points(styleOf(path)?.get('font-size'));
    return Object.freeze({
      kind: 'text',
      text: art.text,
      fontFamily: art.fontFamily,
      // Auto is stored as 1pt: the shape box, not the size, decides the drawn text.
      fontSizePt: size > 1 ? Math.round(size * 2) / 2 : null,
      bold: art.bold,
      italic: art.italic,
      colorHex: art.fillHex ?? 'C0C0C0',
      opacity: art.fillAlpha,
      diagonal: art.rotationDegrees !== 0,
      widthPt,
      heightPt,
    });
  }
  const image = children(shape).find((n) => named(n, VML, 'imagedata'));
  const relationshipId = image ? a(image, 'id', R_NS) : undefined;
  if (!image || !relationshipId) return null;
  const effects = legacyImageEffects(image);
  const record = (pkg.relationships.get(part.name) ?? []).find((r) => r.id === relationshipId);
  const resolved = record ? resolveRelationship(record) : null;
  return Object.freeze({
    kind: 'picture',
    washout: !!effects && effects.brightness > 0 && effects.contrast < 0,
    widthPt,
    heightPt,
    ownerPartName: part.name,
    relationshipId,
    mediaPartName:
      resolved && resolved.mode === 'Internal' && resolved.target.ok
        ? resolved.target.partName
        : null,
  });
}

/** Header parts in the order a reader meets them: first section first, default variant first. */
/** Every header part a section shows, once, with the first section that shows it. */
function shownHeaderSlots(pkg: OoxmlPackage): Array<{ part: OoxmlPart; sectionIndex: number }> {
  const slots: Array<{ part: OoxmlPart; sectionIndex: number }> = [];
  const seen = new Set<string>();
  resolveHeaderFooterResolutionBySection(pkg).forEach((section, sectionIndex) => {
    for (const variant of ['default', 'first', 'even'] as const) {
      if (!headerFooterVariantCanPaint(section, variant)) continue;
      const slot = section.headers.get(variant);
      if (!slot || seen.has(slot.partName)) continue;
      seen.add(slot.partName);
      const part = pkg.parts.get(slot.partName);
      if (part) slots.push({ part, sectionIndex });
    }
  });
  return slots;
}

function shownHeaderParts(pkg: OoxmlPackage): OoxmlPart[] {
  return shownHeaderSlots(pkg).map((slot) => slot.part);
}

const usableSide = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

/** The write sized for one section, or unchanged when it carries no size for it. */
function sizedForSection(
  watermark: PackageWatermarkWrite,
  sectionIndex: number
): PackageWatermarkWrite {
  const size = watermark.sectionSizes?.[sectionIndex];
  if (!size || !usableSide(size.widthPt) || !usableSide(size.heightPt)) return watermark;
  return { ...watermark, widthPt: size.widthPt, heightPt: size.heightPt };
}

/** The watermark the document shows, or null when no header carries one. */
export function readPackageWatermark(pkg: OoxmlPackage): PackageWatermarkReading | null {
  for (const part of shownHeaderParts(pkg)) {
    for (const { shape } of watermarkRuns(part)) {
      const reading = readShape(part, shape, pkg);
      if (reading) return reading;
    }
  }
  return null;
}

const T136 =
  '<v:shapetype id="_x0000_t136" coordsize="21600,21600" o:spt="136" adj="10800" path="m@7,l@8,m@5,21600l@6,21600e"><v:formulas><v:f eqn="sum #0 0 10800"/><v:f eqn="prod #0 2 1"/><v:f eqn="sum 21600 0 @1"/><v:f eqn="sum 0 0 @2"/><v:f eqn="sum 21600 0 @3"/><v:f eqn="if @0 @3 0"/><v:f eqn="if @0 21600 @1"/><v:f eqn="if @0 0 @2"/><v:f eqn="if @0 @4 21600"/><v:f eqn="mid @5 @6"/><v:f eqn="mid @8 @5"/><v:f eqn="mid @7 @8"/><v:f eqn="mid @6 @7"/><v:f eqn="sum @6 0 @5"/></v:formulas><v:path textpathok="t" o:connecttype="custom" o:connectlocs="@9,0;@10,10800;@11,21600;@12,10800" o:connectangles="270,180,90,0"/><v:textpath on="t" fitshape="t"/><v:handles><v:h position="#0,bottomRight" xrange="6629,14971"/></v:handles><o:lock v:ext="edit" text="t" shapetype="t"/></v:shapetype>';
const T75 =
  '<v:shapetype id="_x0000_t75" coordsize="21600,21600" o:spt="75" o:preferrelative="t" path="m@4@5l@4@11@9@11@9@5xe" filled="f" stroked="f"><v:stroke joinstyle="miter"/><v:formulas><v:f eqn="if lineDrawn pixelLineWidth 0"/><v:f eqn="sum @0 1 0"/><v:f eqn="sum 0 0 @1"/><v:f eqn="prod @2 1 2"/><v:f eqn="prod @3 21600 pixelWidth"/><v:f eqn="prod @3 21600 pixelHeight"/><v:f eqn="sum @0 0 1"/><v:f eqn="prod @6 1 2"/><v:f eqn="prod @7 21600 pixelWidth"/><v:f eqn="sum @8 21600 0"/><v:f eqn="prod @7 21600 pixelHeight"/><v:f eqn="sum @10 21600 0"/></v:formulas><v:path o:extrusionok="f" gradientshapeok="t" o:connecttype="rect"/><o:lock v:ext="edit" aspectratio="t"/></v:shapetype>';

const pt = (value: number) => `${Math.round(value * 100) / 100}pt`;

function placement(widthPt: number, heightPt: number, rotation: string): string {
  return (
    `position:absolute;margin-left:0;margin-top:0;width:${pt(widthPt)};height:${pt(heightPt)};` +
    `${rotation}z-index:${Z_INDEX};mso-position-horizontal:center;` +
    'mso-position-horizontal-relative:margin;mso-position-vertical:center;' +
    'mso-position-vertical-relative:margin'
  );
}

function runXml(
  watermark: PackageWatermark,
  ordinal: number,
  relationshipId: string | null
): string {
  const spid = `_x0000_s${2049 + ordinal}`;
  if (watermark.kind === 'text') {
    const textStyle =
      `font-family:&quot;${escapeXml(watermark.fontFamily)}&quot;;` +
      `font-size:${watermark.fontSizePt === null ? '1pt' : pt(watermark.fontSizePt)}` +
      (watermark.bold ? ';font-weight:bold' : '') +
      (watermark.italic ? ';font-style:italic' : '');
    const opacity = Math.round(watermark.opacity * 1000) / 1000;
    return (
      `<w:pict>${T136}<v:shape id="${TEXT_PREFIX}${ordinal + 1}" o:spid="${spid}" type="#_x0000_t136" ` +
      `style="${placement(watermark.widthPt, watermark.heightPt, watermark.diagonal ? 'rotation:315;' : '')}" ` +
      `o:allowincell="f" fillcolor="#${watermark.colorHex}" stroked="f">` +
      (opacity < 1 ? `<v:fill opacity="${opacity}"/>` : '') +
      `<v:textpath style="${textStyle}" string="${escapeXml(watermark.text)}"/>` +
      '<w10:wrap anchorx="margin" anchory="margin"/></v:shape></w:pict>'
    );
  }
  return (
    `<w:pict>${T75}<v:shape id="${PICTURE_PREFIX}${ordinal + 1}" o:spid="${spid}" type="#_x0000_t75" ` +
    `style="${placement(watermark.widthPt, watermark.heightPt, '')}" o:allowincell="f">` +
    `<v:imagedata r:id="${relationshipId}" o:title=""` +
    (watermark.washout ? ' gain="19661f" blacklevel="22938f"' : '') +
    '/><w10:wrap anchorx="margin" anchory="margin"/></v:shape></w:pict>'
  );
}

/** The watermark run, parsed from engine markup and given ids from `part`. */
function watermarkRun(
  part: OoxmlPart,
  watermark: PackageWatermark,
  ordinal: number,
  relationshipId: string | null,
  nextId: () => string
): OoxmlNode | null {
  const xml =
    `<w:r xmlns:w="${WML_NAMESPACE_URI}" xmlns:v="${VML}" xmlns:o="${O_NS}" xmlns:w10="${W10_NS}" xmlns:r="${R_NS}">` +
    `<w:rPr><w:noProof/></w:rPr>${runXml(watermark, ordinal, relationshipId)}</w:r>`;
  const read = readOoxmlPart(xml, { name: part.name, contentType: part.contentType });
  if (!read.ok) return null;
  const reassign = (node: OoxmlNode): OoxmlNode =>
    node.kind === 'textValue'
      ? { ...node, id: nextId() }
      : ({ ...node, id: nextId(), children: node.children.map(reassign) } as OoxmlNode);
  return reassign(read.part.root);
}

const fail = (detail: string): HeaderFooterLifecycleResult => ({
  ok: false,
  reason: 'tree-invariant',
  detail,
});

/** Adds an empty header part for one section variant; null when it cannot. */
export type CreateSectionHeader = (
  pkg: OoxmlPackage,
  sectionIndex: number,
  variant: HeaderFooterVariant
) => OoxmlPackage | null;

/** Create the default header (and first/even when shown) of a section that has none. */
function withShownHeaders(pkg: OoxmlPackage, create: CreateSectionHeader): OoxmlPackage | null {
  let next = pkg;
  const sections = resolveHeaderFooterResolutionBySection(next);
  for (let index = 0; index < sections.length; index += 1) {
    const section = resolveHeaderFooterResolutionBySection(next)[index];
    if (!section) return null;
    for (const variant of ['default', 'first', 'even'] as HeaderFooterVariant[]) {
      if (!headerFooterVariantCanPaint(section, variant) || section.headers.has(variant)) continue;
      const created = create(next, index, variant);
      if (!created) return null;
      next = created;
    }
  }
  return next;
}

/** Remove watermark shapes and picture relationships that no remaining node uses. */
function withoutWatermarks(pkg: OoxmlPackage, partName: string): OoxmlPackage | null {
  let next = pkg;
  const media: string[] = [];
  for (;;) {
    const part = next.parts.get(partName);
    if (!part) return null;
    const first = watermarkRuns(part)[0];
    if (!first) break;
    const reading = readShape(part, first.shape, next);
    // A run or pict can also hold text, fields, and unrelated pictures.
    // Remove only the identified shape; preserve its containers and siblings.
    const removed = removeNode(part, first.shape.id);
    if (!removed.ok) return null;
    next = withPart(next, removed.part);
    if (
      reading?.kind === 'picture' &&
      !referencesRelationship(removed.part, reading.relationshipId)
    ) {
      const dropped = removeOwnerRelationship(next, partName, reading.relationshipId);
      if (dropped === null) return null;
      next = dropped;
      if (reading.mediaPartName) media.push(reading.mediaPartName);
    }
  }
  for (const name of media) next = withoutUnreferencedImagePart(next, name);
  return next;
}

function referencesRelationship(part: OoxmlPart, relationshipId: string): boolean {
  const stack: OoxmlElement[] = [part.root];
  let visited = 0;
  while (stack.length && visited++ < 200_000) {
    const node = stack.pop()!;
    if (node.attributes.some((attr) => attr.namespaceUri === R_NS && attr.value === relationshipId))
      return true;
    stack.push(...elementChildren(node));
  }
  return false;
}

/** The header's first paragraph, which carries the watermark run at its start. */
function firstParagraph(part: OoxmlPart): OoxmlElement | null {
  return elementChildren(part.root).find((n) => named(n, WML_NAMESPACE_URI, 'p')) ?? null;
}

/**
 * Replace the document's watermark: null removes it. One package, one undo step.
 *
 * Every header part keeps its other content. A picture's bytes become one media part per
 * header relationship, through the same validated image gate every picture write passes.
 */
export function applyPackageWatermark(
  pkg: OoxmlPackage,
  watermark: PackageWatermarkWrite | null,
  createHeader: CreateSectionHeader
): HeaderFooterLifecycleResult {
  let next: OoxmlPackage | null = watermark ? withShownHeaders(pkg, createHeader) : pkg;
  if (!next) return fail('header-creation');
  const headerNames = new Set<string>();
  for (const section of resolveHeaderFooterResolutionBySection(next))
    for (const slot of section.headers.values()) headerNames.add(slot.partName);
  if (headerNames.size > MAX_HEADER_PARTS) return fail('header-count');
  for (const name of headerNames) {
    next = withoutWatermarks(next, name);
    if (!next) return fail('watermark-removal');
  }
  if (watermark) {
    let ordinal = 0;
    for (const { part, sectionIndex } of shownHeaderSlots(next)) {
      const sized = sizedForSection(watermark, sectionIndex);
      let relationshipId: string | null = null;
      if (watermark.kind === 'picture') {
        const embedded = withEmbeddedImage(next, part.name, watermark.image);
        if (!embedded.ok) return { ok: false, reason: 'invalidArgs', detail: embedded.reason };
        next = embedded.pkg;
        relationshipId = embedded.relationshipId;
      }
      const current: OoxmlPart | undefined = next.parts.get(part.name);
      if (!current) return fail('header-part');
      const nextId = createNodeIdAllocator(current);
      const run = watermarkRun(current, sized, ordinal++, relationshipId, nextId);
      if (!run) return fail('watermark-markup');
      const paragraph = firstParagraph(current);
      let edited;
      if (paragraph) {
        edited = insertChildren(current, paragraph.id, paragraphContentStart(paragraph), [run]);
      } else {
        const p = paragraphWith(current, run, nextId);
        if (!p) return fail('watermark-markup');
        edited = insertChildren(current, current.root.id, 0, [p]);
      }
      if (!edited.ok) return fail('watermark-insert');
      next = withPart(next, edited.part);
    }
  }
  return { ok: true, package: next, impact: 'global' };
}

/** After `w:pPr`, where run content starts. */
function paragraphContentStart(paragraph: OoxmlElement): number {
  const first = paragraph.children[0];
  return first && first.kind !== 'textValue' && named(first, WML_NAMESPACE_URI, 'pPr') ? 1 : 0;
}

function paragraphWith(part: OoxmlPart, run: OoxmlNode, nextId: () => string): OoxmlNode | null {
  const read = readOoxmlPart(`<w:p xmlns:w="${WML_NAMESPACE_URI}"/>`, {
    name: part.name,
    contentType: part.contentType,
  });
  if (!read.ok) return null;
  return { ...read.part.root, id: nextId(), children: [run] } as OoxmlNode;
}
