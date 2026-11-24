// A small, self-contained DOCX that holds one drawing and the parts it needs, so a rendering
// service can draw it without locating anything in the full document. Every value comes from
// an untrusted file: parts are copied only through validated internal relationships, external
// targets and executable or embedded-object parts are dropped, and every walk is capped.

import { resolveContentType } from './content-types.ts';
import { findNode, parentNodeOf } from './ooxml-edit.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import {
  controlledPrefixMap,
  rootSerializationScope,
  serializeNode,
  serializeOoxmlPart,
} from './ooxml-serialize.ts';
import type { MarkupChunk } from './ooxml-serialize.ts';
import {
  MC_NAMESPACE_URI,
  RELATIONSHIPS_NAMESPACE_URI,
  WP_NAMESPACE_URI as WP,
} from './ooxml-shared.ts';
import { DRAWINGML_MAIN_NAMESPACE_URI as A } from './ooxml-tree.ts';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from './ooxml-tree.ts';
import { resolveRelationship, type RelationshipRecord } from './relationships.ts';
import { escapeXml } from './sinks.ts';
import { writeZip } from './zip.ts';

/**
 * Where a drawing is. Pass an `inspectDrawingSupport` entry or an editor occurrence as is.
 *
 * @public
 */
export interface DrawingPreviewTarget {
  /** The part that holds the drawing, such as `/word/document.xml`. */
  readonly ownerPartName: string;
  /**
   * The drawing, its compatibility wrapper, or any node inside them, in the package you pass.
   * Every node of one drawing gives the same package.
   */
  readonly nodeId: string;
}

/** Caps for {@link createDrawingPreviewPackage}. @public */
export interface DrawingPreviewPackageLimits {
  /** Maximum number of copied parts. Defaults to 64. */
  readonly maxParts?: number;
  /** Maximum number of copied bytes. Defaults to 64 MiB. */
  readonly maxBytes?: number;
}

/**
 * A preview package, or why it could not be built.
 *
 * - `drawing-not-found`: the target is not a drawing in the package.
 * - `too-many-parts` or `too-large`: the drawing needs more than the limits allow.
 *
 * @public
 */
export type DrawingPreviewPackageResult =
  | {
      readonly ok: true;
      /**
       * DOCX bytes with one paragraph that holds the drawing. The same drawing and document
       * parts always give the same bytes, so a hash of them works as a cache key.
       */
      readonly docx: Uint8Array;
      /**
       * True when the page has the drawing's size, so the first page is the preview image.
       * False when the size is unknown, such as a legacy VML drawing without a width and height
       * in its style. Then the page has the document's page size and no margins, and the
       * drawing starts at its top left corner. With the occurrence's `element.bounds`, crop
       * from (0, 0) to `bounds.width * dpi / 72` by `bounds.height * dpi / 72` pixels;
       * `bounds.x` and `bounds.y` are page positions, not crop offsets. Send this flag and the
       * `bounds` size to your renderer with the bytes.
       * Without `bounds`, such as for a report entry, trim the white space instead.
       */
      readonly pageFitsDrawing: boolean;
      /** The package parts copied from the source document, for logging and caching. */
      readonly copiedParts: readonly string[];
    }
  | { readonly ok: false; readonly reason: 'drawing-not-found' | 'too-many-parts' | 'too-large' };

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const O = 'urn:schemas-microsoft-com:office:office';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const DOCUMENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const RELS_TYPE = 'application/vnd.openxmlformats-package.relationships+xml';
const DRAWING_WRAPPERS = new Set(['drawing', 'pict', 'object']);
// Parts that execute, embed whole files, or reach outside the document never travel.
const DROPPED_TYPES = new Set(
  [
    'oleObject',
    'package',
    'control',
    'vbaProject',
    'attachedTemplate',
    'externalLinkPath',
    'subDocument',
    'frame',
  ].map((type) => `${REL}/${type}`)
);
// Package-level parts a renderer reads for fonts, styles, and theme colors.
const CONTEXT_TYPES = ['styles', 'theme', 'settings', 'fontTable'].map((type) => `${REL}/${type}`);
const DIAGRAM_DATA = `${REL}/diagramData`;
const MAX_DEPTH = 4;
const PARAGRAPH_PROPERTIES =
  '<w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>' +
  '<w:ind w:left="0" w:right="0" w:firstLine="0"/><w:jc w:val="left"/></w:pPr>';
const MAX_NODES = 100_000;

/** Find the run-level element that holds the drawing, including its compatibility wrapper. */
function runLevelDrawing(part: OoxmlPart, nodeId: string): OoxmlElement | null {
  const node = findNode(part, nodeId);
  if (!node || node.kind === 'textValue') return null;
  let wrapper: OoxmlElement | null = null;
  let current: OoxmlElement | null = node;
  for (let steps = 0; current && steps < 64; steps++) {
    if (current.namespaceUri === W && DRAWING_WRAPPERS.has(current.localName)) wrapper = current;
    if (current.namespaceUri === MC_NAMESPACE_URI && current.localName === 'AlternateContent')
      wrapper = current;
    if (current.namespaceUri === W && (current.localName === 'r' || current.localName === 'p'))
      break;
    current = parentNodeOf(part, current.id);
  }
  return wrapper;
}

/** Relationship ids referenced from a subtree: `r:*` attributes and VML `o:relid`. */
function referencedIds(root: OoxmlElement, ids: Set<string>, attribute?: string): void {
  const stack: OoxmlElement[] = [root];
  let visited = 0;
  while (stack.length && ++visited <= MAX_NODES) {
    const node = stack.pop()!;
    for (const { namespaceUri, localName, value } of node.attributes) {
      if (attribute ? localName === attribute : namespaceUri === RELATIONSHIPS_NAMESPACE_URI)
        ids.add(value);
      else if (!attribute && namespaceUri === O && localName === 'relid') ids.add(value);
    }
    for (const child of node.children) if (child.kind !== 'textValue') stack.push(child);
  }
}

/** Serialize a subtree with its part's prefixes, so `mc:Choice Requires` still names them. */
function serializeElement(element: OoxmlElement, partRoot: OoxmlElement): string {
  const prefixes = controlledPrefixMap(partRoot);
  const { rootBindings, declarations } = rootSerializationScope(prefixes);
  const out: MarkupChunk[] = [];
  serializeNode(element, prefixes, rootBindings, false, declarations, out);
  const decoder = new TextDecoder();
  return out.map((chunk) => (typeof chunk === 'string' ? chunk : decoder.decode(chunk))).join('');
}

const INLINE_CHILDREN = new Set(['extent', 'effectExtent', 'docPr', 'cNvGraphicFramePr']);
const EMU_PER_TWIP = 635;
const VML = 'urn:schemas-microsoft-com:vml';

/**
 * A copy for serialization only that places floating drawings on the line, so the page can
 * fit the drawing exactly. The package itself is never changed.
 */
function inlineDrawingCopy(node: OoxmlElement, depth = 0, inWrapper = false): OoxmlElement {
  if (depth > 32 || (node.namespaceUri === W && node.localName === 'txbxContent')) return node;
  if (inWrapper && node.namespaceUri === VML) {
    const attributes = node.attributes.map((item) =>
      item.namespaceUri === '' && item.localName === 'style'
        ? { ...item, value: inlineVmlStyle(item.value) }
        : item
    );
    return { ...node, attributes } as OoxmlElement;
  }
  if (node.namespaceUri === WP && node.localName === 'anchor') {
    return {
      id: node.id,
      kind: 'generic',
      namespaceUri: WP,
      localName: 'inline',
      namespaceBindings: node.namespaceBindings,
      attributes: node.attributes.filter(
        (item) => item.namespaceUri === '' && /^dist[TBLR]$/.test(item.localName)
      ),
      children: (node.children as readonly OoxmlNode[]).filter(
        (child) =>
          child.kind !== 'textValue' &&
          ((child.namespaceUri === WP && INLINE_CHILDREN.has(child.localName)) ||
            (child.namespaceUri === A && child.localName === 'graphic'))
      ),
    };
  }
  let changed = false;
  const children = (node.children as readonly OoxmlNode[]).map((child) => {
    if (child.kind === 'textValue') return child;
    const wrapper =
      node.namespaceUri === W && (node.localName === 'pict' || node.localName === 'object');
    const copy = inlineDrawingCopy(child, depth + 1, wrapper);
    changed ||= copy !== child;
    return copy;
  });
  return changed ? ({ ...node, children } as OoxmlElement) : node;
}

// Style properties that float a legacy VML shape; without them it sits on the line.
const VML_FLOAT_PROPERTIES =
  /^(position|left|top|margin-(left|top|right|bottom)|z-index|mso-position-.*)$/;
const POINTS_PER_UNIT: Readonly<Record<string, number>> = {
  pt: 1,
  in: 72,
  cm: 72 / 2.54,
  mm: 72 / 25.4,
  pc: 12,
  px: 0.75,
  '': 0.75,
};

function inlineVmlStyle(style: string): string {
  return style
    .split(';')
    .filter((entry) => !VML_FLOAT_PROPERTIES.test(entry.split(':')[0]!.trim().toLowerCase()))
    .join(';');
}

/** A VML style length in twips, such as `width:100pt`, or null when it is not a length. */
function vmlLengthTwips(style: string, property: string): number | null {
  for (const entry of style.split(';')) {
    const [name, raw] = entry.split(':');
    if (name?.trim().toLowerCase() !== property || raw === undefined) continue;
    const match = /^\s*([0-9]+(?:\.[0-9]+)?)\s*(pt|in|cm|mm|pc|px|)\s*$/i.exec(raw);
    if (!match) return null;
    return Number(match[1]) * POINTS_PER_UNIT[match[2]!.toLowerCase()]! * 20;
  }
  return null;
}

/** The size of a legacy VML drawing from the style of its first shape, in twips. */
function vmlSizeTwips(drawing: OoxmlElement): { width: number; height: number } | null {
  const stack: { node: OoxmlElement; inWrapper: boolean }[] = [{ node: drawing, inWrapper: false }];
  let visited = 0;
  while (stack.length && ++visited <= MAX_NODES) {
    const { node, inWrapper } = stack.shift()!;
    // A shape type is a template without a size; the shape that uses it follows.
    if (inWrapper && node.namespaceUri === VML && node.localName !== 'shapetype') {
      const style = node.attributes.find(
        (item) => item.namespaceUri === '' && item.localName === 'style'
      )?.value;
      const width = style ? vmlLengthTwips(style, 'width') : null;
      const height = style ? vmlLengthTwips(style, 'height') : null;
      if (width !== null && height !== null && (width > 0 || height > 0)) {
        // A rotated shape needs the page of its rotated bounding box.
        const degrees = Number(/(?:^|;)\s*rotation\s*:\s*(-?[0-9.]+)/i.exec(style!)?.[1] ?? 0);
        const radians = ((Number.isFinite(degrees) ? degrees : 0) * Math.PI) / 180;
        const cos = Math.abs(Math.cos(radians));
        const sin = Math.abs(Math.sin(radians));
        const twips = (value: number) => Math.min(31_680, Math.max(1, Math.ceil(value)));
        return {
          width: twips(width * cos + height * sin),
          height: twips(width * sin + height * cos),
        };
      }
    }
    const wrapper =
      node.namespaceUri === W && (node.localName === 'pict' || node.localName === 'object');
    for (const child of node.children)
      if (child.kind !== 'textValue') stack.push({ node: child, inWrapper: wrapper });
  }
  return null;
}

/** The drawing's size with its effect extent, in twips, from its first `wp:extent`. */
function drawingSizeTwips(drawing: OoxmlElement): { width: number; height: number } | null {
  const stack: OoxmlElement[] = [drawing];
  let visited = 0;
  while (stack.length && ++visited <= MAX_NODES) {
    const node = stack.pop()!;
    if (node.namespaceUri === WP && (node.localName === 'anchor' || node.localName === 'inline')) {
      const emu = (name: string, attribute: string): number => {
        const child = (node.children as readonly OoxmlNode[]).find(
          (item) => item.kind !== 'textValue' && item.namespaceUri === WP && item.localName === name
        );
        const raw =
          child && child.kind !== 'textValue'
            ? child.attributes.find((item) => item.localName === attribute)?.value
            : undefined;
        const value = raw === undefined ? 0 : Number(raw);
        return Number.isFinite(value) ? value : 0;
      };
      const width = emu('extent', 'cx') + emu('effectExtent', 'l') + emu('effectExtent', 'r');
      const height = emu('extent', 'cy') + emu('effectExtent', 't') + emu('effectExtent', 'b');
      // A straight connector has no height or no width; the page still fits its other side.
      if (width <= 0 && height <= 0) return null;
      const twips = (value: number) =>
        Math.min(31_680, Math.max(1, Math.ceil(value / EMU_PER_TWIP)));
      return { width: twips(width), height: twips(height) };
    }
    for (const child of node.children) if (child.kind !== 'textValue') stack.push(child);
  }
  return null;
}

/** A page the size of the drawing, with no margins, so its first page is the preview. */
function fittedSection(size: { width: number; height: number }): string {
  // A little room below the line keeps the drawing on one page in every renderer.
  return (
    `<w:sectPr><w:pgSz w:w="${size.width}" w:h="${Math.min(31_680, size.height + 120)}"/>` +
    '<w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
  );
}

/** The last child element of `parent` with a WordprocessingML local name. */
function lastChild(parent: OoxmlElement | undefined, localName: string): OoxmlElement | undefined {
  let found: OoxmlElement | undefined;
  for (const child of (parent?.children ?? []) as readonly OoxmlNode[])
    if (child.kind !== 'textValue' && child.namespaceUri === W && child.localName === localName)
      found = child;
  return found;
}

/**
 * The document's last page size, as whole twips only, with no margins: a drawing of unknown
 * size starts at the top left corner, so a renderer can crop it to the drawing's box.
 */
function sectionProperties(pkg: OoxmlPackage): string {
  const body = lastChild(pkg.parts.get(pkg.mainDocumentPart)?.root, 'body');
  const sectPr = lastChild(body, 'sectPr');
  const read = (attribute: string, fallback: number): number => {
    const raw = lastChild(sectPr, 'pgSz')?.attributes.find(
      (item) => item.localName === attribute
    )?.value;
    const value = raw === undefined ? NaN : Number(raw);
    return Number.isInteger(value) && value > 0 && value <= 31_680 ? value : fallback;
  };
  return (
    `<w:sectPr><w:pgSz w:w="${read('w', 12_240)}" w:h="${read('h', 15_840)}"/>` +
    '<w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
  );
}

function relationshipsXml(
  records: readonly { id: string; type: string; target: string }[]
): string {
  const items = records
    .map(
      ({ id, type, target }) =>
        `<Relationship Id="${escapeXml(id)}" Type="${escapeXml(type)}" Target="${escapeXml(target)}"/>`
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG_REL}">${items}</Relationships>`;
}

/** A target relative to the main document's folder, which every copied part keeps its name in. */
function documentRelativeTarget(partName: string): string {
  return partName.startsWith('/word/') ? partName.slice('/word/'.length) : partName;
}

function relsPartName(partName: string): string {
  const slash = partName.lastIndexOf('/');
  return `${partName.slice(0, slash)}/_rels/${partName.slice(slash + 1)}.rels`;
}

/**
 * Build a small DOCX that holds one drawing for an external renderer.
 *
 * Contents: one paragraph with the drawing, plus the chart and diagram parts, images, styles,
 * theme, settings, and fonts it needs. Relationships to external targets, embedded objects,
 * macros, and templates are dropped, so the package never points outside itself.
 *
 * Page: the first page is the preview. It has the drawing's size, including its effect
 * extent, so it matches the occurrence's `bounds`, and it has no margins. A floating drawing
 * is placed on the line, and a legacy VML drawing takes its size from its style. When the
 * size is unknown, `pageFitsDrawing` is false; see that field for how to crop.
 *
 * Renderer: use one other than this library, whose own exporters show the same placeholder.
 * The bytes come from the document, so run the renderer in a sandbox without network access,
 * with time and memory limits.
 *
 * Pass the package that the target comes from: an `inspectDrawingSupport` entry with the
 * parsed package it inspected, or an editor occurrence with the editor's current package.
 *
 * @public
 */
export function createDrawingPreviewPackage(
  pkg: OoxmlPackage,
  target: DrawingPreviewTarget,
  limits: DrawingPreviewPackageLimits = {}
): DrawingPreviewPackageResult {
  const maxParts = limits.maxParts ?? 64;
  const maxBytes = limits.maxBytes ?? 64 * 1024 * 1024;
  const owner = pkg.parts.get(target.ownerPartName);
  const drawing = owner ? runLevelDrawing(owner, target.nodeId) : null;
  if (!owner || !drawing) return { ok: false, reason: 'drawing-not-found' };

  const entries = new Map<string, Uint8Array>();
  const contentTypes = new Map<string, string>();
  const copied: string[] = [];
  let bytes = 0;
  const encoder = new TextEncoder();
  let failure: 'too-many-parts' | 'too-large' | null = null;

  const internalTarget = (record: RelationshipRecord): string | null => {
    if (record.targetMode === 'External' || DROPPED_TYPES.has(record.type)) return null;
    const resolved = resolveRelationship(record);
    if (resolved.mode !== 'Internal' || !resolved.target.ok) return null;
    const name = resolved.target.partName;
    return pkg.parts.has(name) || pkg.partBytes.has(name) ? name : null;
  };
  const add = (name: string, data: Uint8Array, contentType: string | null): boolean => {
    if (entries.has(name)) return true;
    if (entries.size >= maxParts) failure = 'too-many-parts';
    else if (bytes + data.byteLength > maxBytes) failure = 'too-large';
    if (failure) return false;
    entries.set(name, data);
    bytes += data.byteLength;
    if (contentType) contentTypes.set(name, contentType);
    return true;
  };
  // Copy one part and, for XML parts, the internal parts it relates to.
  const copy = (name: string, depth: number): void => {
    if (failure || entries.has(name) || name === '/word/document.xml') return;
    const tree = pkg.parts.get(name);
    const data = tree ? encoder.encode(serializeOoxmlPart(tree)) : pkg.partBytes.get(name);
    if (!data) return;
    const type = resolveContentType(pkg.contentTypes, name);
    if (!add(name, data, type.ok ? type.contentType : null)) return;
    copied.push(name);
    if (!tree || depth >= MAX_DEPTH) return;
    const kept: { id: string; type: string; target: string }[] = [];
    for (const record of pkg.relationships.get(name) ?? []) {
      const next = internalTarget(record);
      if (!next) continue;
      kept.push({ id: record.id, type: record.type, target: record.rawTarget });
      copy(next, depth + 1);
    }
    if (kept.length) add(relsPartName(name), encoder.encode(relationshipsXml(kept)), RELS_TYPE);
  };

  // The relationships the drawing needs, resolved from its owner part.
  const ids = new Set<string>();
  referencedIds(drawing, ids);
  const ownerRecords = pkg.relationships.get(owner.name) ?? [];
  const documentRels: { id: string; type: string; target: string }[] = [];
  const keep = (record: RelationshipRecord): void => {
    const name = internalTarget(record);
    if (!name || documentRels.some((rel) => rel.id === record.id)) return;
    documentRels.push({ id: record.id, type: record.type, target: documentRelativeTarget(name) });
    copy(name, 1);
    // A diagram's drawing part hangs off the owner part, named from inside the data part.
    const data = pkg.parts.get(name);
    if (record.type === DIAGRAM_DATA && data) {
      const nested = new Set<string>();
      referencedIds(data.root, nested, 'relId');
      for (const other of ownerRecords) if (nested.has(other.id)) keep(other);
    }
  };
  for (const record of ownerRecords) if (ids.has(record.id)) keep(record);

  // Styles, theme, settings, and fonts from the main document, under fresh ids.
  let contextIndex = 0;
  for (const record of pkg.relationships.get(pkg.mainDocumentPart) ?? []) {
    if (!CONTEXT_TYPES.includes(record.type)) continue;
    const name = internalTarget(record);
    if (!name) continue;
    documentRels.push({
      id: `rIdPreviewContext${++contextIndex}`,
      type: record.type,
      target: documentRelativeTarget(name),
    });
    copy(name, 1);
  }
  if (failure) return { ok: false, reason: failure };

  const size = drawingSizeTwips(drawing) ?? vmlSizeTwips(drawing);
  const ignorable =
    'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" ' +
    'xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" ' +
    'xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" ' +
    `xmlns:mc="${MC_NAMESPACE_URI}" mc:Ignorable="w14 wp14 w15"`;
  const documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:document xmlns:w="${W}" ${ignorable}><w:body><w:p>${PARAGRAPH_PROPERTIES}` +
    `<w:r>${serializeElement(inlineDrawingCopy(drawing), owner.root)}</w:r></w:p>` +
    `${size ? fittedSection(size) : sectionProperties(pkg)}</w:body></w:document>`;
  if (
    !add('/word/document.xml', encoder.encode(documentXml), DOCUMENT_TYPE) ||
    !add('/word/_rels/document.xml.rels', encoder.encode(relationshipsXml(documentRels)), RELS_TYPE)
  )
    return { ok: false, reason: failure ?? 'too-large' };

  const rootRels = relationshipsXml([
    { id: 'rId1', type: `${REL}/officeDocument`, target: 'word/document.xml' },
  ]);
  const overrides = [...contentTypes]
    .map(
      ([name, type]) => `<Override PartName="${escapeXml(name)}" ContentType="${escapeXml(type)}"/>`
    )
    .join('');
  const types =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="${CT}">` +
    `<Default Extension="rels" ContentType="${RELS_TYPE}"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>${overrides}</Types>`;
  const zipEntries = new Map<string, Uint8Array>([
    ['/[Content_Types].xml', encoder.encode(types)],
    ['/_rels/.rels', encoder.encode(rootRels)],
  ]);
  for (const [name, data] of entries) zipEntries.set(name, data);
  return {
    ok: true,
    docx: writeZip(zipEntries),
    pageFitsDrawing: size !== null,
    copiedParts: Object.freeze(copied),
  };
}
