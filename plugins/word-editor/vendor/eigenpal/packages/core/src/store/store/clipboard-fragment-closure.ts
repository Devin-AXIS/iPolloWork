// Clipboard fragment dependency closure and part assembly (rich-clipboard-fidelity
// tasks 1.4-1.6): used styles/numbering, note bodies, theme literalization, and the
// synthetic parts a fragment package ships. Split from clipboard-fragment-extract.ts to
// hold the max-lines cap; the extractor entry point composes these.

import {
  WML_NAMESPACE_URI,
  type OoxmlAttribute,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import type { OoxmlPackage } from '../package/ooxml-package.ts';
import { relationshipsOf } from '../package/package-edit.ts';
import { resolveInternalTarget } from '../package/opc-names.ts';
import type { RelationshipRecord } from '../package/relationships.ts';
import { escapeXmlAttribute } from '../package/sinks.ts';
import { attributeValueOf } from './tree-op-nodes.ts';

export const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const RELS_XMLNS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const DRAWINGML_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';

export const DOCUMENT_CT =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
export const STYLES_CT =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml';
export const NUMBERING_CT =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml';
export const FOOTNOTES_CT =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml';
export const ENDNOTES_CT =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml';
export const RELS_CT = 'application/vnd.openxmlformats-package.relationships+xml';

export const STYLES_REL = `${R_NS}/styles`;
export const NUMBERING_REL = `${R_NS}/numbering`;
export const FOOTNOTES_REL = `${R_NS}/footnotes`;
export const ENDNOTES_REL = `${R_NS}/endnotes`;
export const OFFICE_DOCUMENT_REL = `${R_NS}/officeDocument`;
const THEME_REL = `${R_NS}/theme`;

function isElementNode(node: OoxmlNode): node is OoxmlElement {
  return node.kind !== 'textValue';
}

function withChildren(node: OoxmlElement, children: readonly OoxmlNode[]): OoxmlElement {
  return { ...node, children } as OoxmlElement;
}
// ---------------------------------------------------------------------------
// Dependency closure
// ---------------------------------------------------------------------------

export function walkNodes(node: OoxmlNode, visit: (node: OoxmlNode) => void): void {
  visit(node);
  if (node.kind === 'textValue') return;
  for (const child of node.children) walkNodes(child, visit);
}

const STYLE_REFERENCE_LOCAL_NAMES = new Set(['pStyle', 'rStyle', 'tblStyle']);

export function collectStyleIds(nodes: readonly OoxmlNode[], out: Set<string>): void {
  for (const node of nodes) {
    walkNodes(node, (current) => {
      if (current.kind === 'textValue') return;
      if (
        STYLE_REFERENCE_LOCAL_NAMES.has(current.localName) &&
        current.namespaceUri === WML_NAMESPACE_URI
      ) {
        const value = attributeValueOf(current, 'val');
        if (value) out.add(value);
      }
    });
  }
}

export function collectNumIds(nodes: readonly OoxmlNode[], out: Set<string>): void {
  for (const node of nodes) {
    walkNodes(node, (current) => {
      if (current.kind === 'textValue') return;
      if (current.localName === 'numId' && current.namespaceUri === WML_NAMESPACE_URI) {
        const value = attributeValueOf(current, 'val');
        if (value) out.add(value);
      }
    });
  }
}

/** Every `r:*` relationship id referenced anywhere under the nodes. */
export function relationshipIdsIn(nodes: readonly OoxmlNode[]): Set<string> {
  const ids = new Set<string>();
  collectRelationshipIds(nodes, ids);
  return ids;
}

export function collectRelationshipIds(nodes: readonly OoxmlNode[], out: Set<string>): void {
  for (const node of nodes) {
    walkNodes(node, (current) => {
      if (current.kind === 'textValue') return;
      for (const attribute of current.attributes) {
        if (attribute.namespaceUri === R_NS && attribute.value.length > 0) {
          out.add(attribute.value);
        }
      }
    });
  }
}

/** Canonical note-id key: numeric ids drop leading zeros — `w:id="07"` and
 *  `w:id="7"` are ONE note per ST_DecimalNumber's lexical space, and a raw-string
 *  compare would strand the reference while the HTML lane (which parses the
 *  number) keeps it. Non-numeric spellings compare verbatim. */
export function canonicalNoteId(raw: string): string {
  return /^\d+$/.test(raw) ? raw.replace(/^0+(?=\d)/, '') : raw;
}

export function collectNoteIds(
  nodes: readonly OoxmlNode[],
  localName: 'footnoteReference' | 'endnoteReference'
): Set<string> {
  const ids = new Set<string>();
  for (const node of nodes) {
    walkNodes(node, (current) => {
      if (current.kind === 'textValue') return;
      if (current.kind === 'noteReference' && current.localName === localName) {
        const id = attributeValueOf(current, 'id');
        if (id !== undefined) ids.add(canonicalNoteId(id));
      }
    });
  }
  return ids;
}

/**
 * Referenced note ids per kind, from `blocks` first, then closed TRANSITIVELY over
 * the note bodies `noteBodyOf` resolves: a shipped note's citations of other notes
 * must ship too, or their ids would pass through the id rewrite unmapped.
 * Bounded: each (kind, id) enqueues at most once.
 */
export function noteReferenceClosure(
  blocks: readonly OoxmlNode[],
  noteBodyOf: (kind: 'footnote' | 'endnote', id: string) => OoxmlNode | null
): Record<'footnote' | 'endnote', Set<string>> {
  const referenced = { footnote: new Set<string>(), endnote: new Set<string>() };
  const queue: Array<{ kind: 'footnote' | 'endnote'; id: string }> = [];
  const collect = (nodes: readonly OoxmlNode[]): void => {
    for (const node of nodes) {
      walkNodes(node, (current) => {
        if (current.kind !== 'noteReference') return;
        const kind = current.localName === 'footnoteReference' ? 'footnote' : 'endnote';
        const raw = attributeValueOf(current, 'id');
        if (raw === undefined) return;
        const id = canonicalNoteId(raw);
        if (referenced[kind].has(id)) return;
        referenced[kind].add(id);
        queue.push({ kind, id });
      });
    }
  };
  collect(blocks);
  while (queue.length > 0) {
    const current = queue.pop()!;
    const body = noteBodyOf(current.kind, current.id);
    if (body !== null) collect([body]);
  }
  return referenced;
}

/**
 * Fail CLOSED on dangling note references: an id with no mapping would pass through
 * the rewrite unmapped and alias the HOST's unrelated note. Stripping the reference
 * keeps the surrounding content and drops only the dead mark.
 */
export function withoutDanglingNoteReferences(
  node: OoxmlNode,
  footnoteIdMap: ReadonlyMap<string, string>,
  endnoteIdMap: ReadonlyMap<string, string>
): OoxmlNode {
  if (node.kind === 'textValue') return node;
  const children: OoxmlNode[] = [];
  let changed = false;
  for (const child of node.children) {
    // Match by NAME, not just typed kind: a demoted-to-generic w:footnoteReference
    // would bypass the id rewrite entirely, so only a TYPED reference with a mapped
    // id may stay — everything else in this shape is stripped.
    const isNoteReferenceShaped =
      child.kind !== 'textValue' &&
      child.namespaceUri === WML_NAMESPACE_URI &&
      (child.localName === 'footnoteReference' || child.localName === 'endnoteReference');
    if (isNoteReferenceShaped) {
      const map = child.localName === 'footnoteReference' ? footnoteIdMap : endnoteIdMap;
      const id = attributeValueOf(child, 'id');
      if (child.kind !== 'noteReference' || id === undefined || !map.has(canonicalNoteId(id))) {
        changed = true;
        continue;
      }
    }
    const next = withoutDanglingNoteReferences(child, footnoteIdMap, endnoteIdMap);
    if (next !== child) changed = true;
    children.push(next);
  }
  return changed ? ({ ...node, children } as OoxmlNode) : node;
}

export interface StylesIndex {
  readonly part: OoxmlPart | null;
  readonly byId: ReadonlyMap<string, OoxmlElement>;
  readonly defaults: readonly OoxmlElement[];
  readonly docDefaults: OoxmlElement | null;
}

function stylesPartOf(pkg: OoxmlPackage, documentPart: string): OoxmlPart | null {
  for (const record of relationshipsOf(pkg, documentPart)) {
    if (record.type !== STYLES_REL || record.targetMode === 'External') continue;
    const resolved = resolveInternalTarget(record.ownerPart, record.rawTarget);
    if (resolved.ok) return pkg.parts.get(resolved.partName) ?? null;
  }
  return pkg.parts.get('/word/styles.xml') ?? null;
}

function relatedPartOf(pkg: OoxmlPackage, owner: string, relType: string): OoxmlPart | null {
  for (const record of relationshipsOf(pkg, owner)) {
    if (record.type !== relType || record.targetMode === 'External') continue;
    const resolved = resolveInternalTarget(record.ownerPart, record.rawTarget);
    if (resolved.ok) return pkg.parts.get(resolved.partName) ?? null;
  }
  return null;
}

export function stylesIndexOf(pkg: OoxmlPackage, documentPart: string): StylesIndex {
  const part = stylesPartOf(pkg, documentPart);
  const byId = new Map<string, OoxmlElement>();
  const defaults: OoxmlElement[] = [];
  let docDefaults: OoxmlElement | null = null;
  if (part && isElementNode(part.root)) {
    for (const child of part.root.children) {
      if (!isElementNode(child)) continue;
      if (child.localName === 'docDefaults' && child.namespaceUri === WML_NAMESPACE_URI) {
        docDefaults = child;
        continue;
      }
      if (child.localName !== 'style' || child.namespaceUri !== WML_NAMESPACE_URI) continue;
      const id = attributeValueOf(child, 'styleId');
      if (id) byId.set(id, child);
      if (
        attributeValueOf(child, 'default') === '1' ||
        attributeValueOf(child, 'default') === 'true'
      ) {
        defaults.push(child);
      }
    }
  }
  return { part, byId, defaults, docDefaults };
}

const STYLE_CHAIN_LOCAL_NAMES = new Set(['basedOn', 'link', 'next']);

/** The used-style closure: referenced ids plus `basedOn`/`link`/`next` chains and defaults. */
export function styleClosure(index: StylesIndex, referenced: ReadonlySet<string>): OoxmlElement[] {
  const seen = new Set<string>();
  const queue = [...referenced];
  for (const style of index.defaults) {
    const id = attributeValueOf(style, 'styleId');
    if (id) queue.push(id);
  }
  const out: OoxmlElement[] = [];
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const style = index.byId.get(id);
    if (!style) continue;
    out.push(style);
    for (const child of style.children) {
      if (!isElementNode(child)) continue;
      if (
        STYLE_CHAIN_LOCAL_NAMES.has(child.localName) &&
        child.namespaceUri === WML_NAMESPACE_URI
      ) {
        const target = attributeValueOf(child, 'val');
        if (target) queue.push(target);
      }
    }
  }
  // Keep source order for a stable fingerprint.
  if (!index.part || !isElementNode(index.part.root)) return out;
  const order = new Map<OoxmlNode, number>();
  index.part.root.children.forEach((child, position) => order.set(child, position));
  return out.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
}

export interface NumberingClosure {
  readonly part: OoxmlPart | null;
  readonly nums: readonly OoxmlElement[];
  readonly abstracts: readonly OoxmlElement[];
}

export function numberingClosure(
  pkg: OoxmlPackage,
  documentPart: string,
  numIds: ReadonlySet<string>
): NumberingClosure {
  const part =
    relatedPartOf(pkg, documentPart, NUMBERING_REL) ?? pkg.parts.get('/word/numbering.xml') ?? null;
  if (!part || !isElementNode(part.root) || numIds.size === 0) {
    return { part, nums: [], abstracts: [] };
  }
  const nums: OoxmlElement[] = [];
  const abstractIds = new Set<string>();
  for (const child of part.root.children) {
    if (!isElementNode(child)) continue;
    if (child.localName !== 'num' || child.namespaceUri !== WML_NAMESPACE_URI) continue;
    const id = attributeValueOf(child, 'numId');
    if (!id || !numIds.has(id)) continue;
    nums.push(child);
    for (const inner of child.children) {
      if (isElementNode(inner) && inner.localName === 'abstractNumId') {
        const abstractId = attributeValueOf(inner, 'val');
        if (abstractId) abstractIds.add(abstractId);
      }
    }
  }
  const abstracts: OoxmlElement[] = [];
  for (const child of part.root.children) {
    if (!isElementNode(child)) continue;
    if (child.localName !== 'abstractNum' || child.namespaceUri !== WML_NAMESPACE_URI) continue;
    const id = attributeValueOf(child, 'abstractNumId');
    if (id && abstractIds.has(id)) abstracts.push(child);
  }
  return { part, nums, abstracts };
}

// ---------------------------------------------------------------------------
// Theme literalization (materialized defaults, design D3)
// ---------------------------------------------------------------------------

/** One theme font scheme slot: the latin, east-asian and complex-script faces. */
export interface ThemeFontSlot {
  readonly latin: string | null;
  readonly eastAsia: string | null;
  readonly cs: string | null;
}

export interface ThemeFonts {
  readonly major: ThemeFontSlot;
  readonly minor: ThemeFontSlot;
}

const EMPTY_SLOT: ThemeFontSlot = { latin: null, eastAsia: null, cs: null };

export function themeFontsOf(pkg: OoxmlPackage, documentPart: string): ThemeFonts {
  const theme = relatedPartOf(pkg, documentPart, THEME_REL);
  if (!theme) return { major: EMPTY_SLOT, minor: EMPTY_SLOT };
  const slots = { major: { ...EMPTY_SLOT }, minor: { ...EMPTY_SLOT } };
  walkNodes(theme.root, (node) => {
    if (node.kind === 'textValue') return;
    if (node.namespaceUri !== DRAWINGML_NS) return;
    if (node.localName !== 'majorFont' && node.localName !== 'minorFont') return;
    const slot = node.localName === 'majorFont' ? slots.major : slots.minor;
    for (const child of node.children) {
      if (!isElementNode(child)) continue;
      const typeface = attributeValueOf(child, 'typeface');
      if (!typeface) continue;
      if (child.localName === 'latin') slot.latin = typeface;
      else if (child.localName === 'ea') slot.eastAsia = typeface;
      else if (child.localName === 'cs') slot.cs = typeface;
    }
  });
  return { major: slots.major, minor: slots.minor };
}

/** The theme face an `rFonts` theme attribute resolves to — by SCRIPT, not always latin. */
function themeFaceFor(fonts: ThemeFonts, themeValue: string): string | null {
  const slot = themeValue.startsWith('major') ? fonts.major : fonts.minor;
  if (themeValue.endsWith('EastAsia')) return slot.eastAsia ?? slot.latin;
  if (themeValue.endsWith('Bidi')) return slot.cs ?? slot.latin;
  return slot.latin;
}

const THEME_FONT_ATTRIBUTES: ReadonlyArray<readonly [theme: string, literal: string]> = [
  ['asciiTheme', 'ascii'],
  ['hAnsiTheme', 'hAnsi'],
  ['eastAsiaTheme', 'eastAsia'],
  ['cstheme', 'cs'],
];

const THEME_COLOR_ATTRIBUTES = new Set([
  'themeColor',
  'themeTint',
  'themeShade',
  'themeFill',
  'themeFillTint',
  'themeFillShade',
]);

/**
 * Replace theme references with the values they resolve to in the SOURCE document, because
 * the fragment ships no theme and the target's theme must not restyle pasted content.
 * Theme colors keep the literal `w:val` Word caches beside them; the theme attrs drop.
 */
export function literalizeThemeReferences(node: OoxmlNode, fonts: ThemeFonts): OoxmlNode {
  if (node.kind === 'textValue') return node;
  let attributes: readonly OoxmlAttribute[] = node.attributes;
  if (node.localName === 'rFonts' && node.namespaceUri === WML_NAMESPACE_URI) {
    const next: OoxmlAttribute[] = [];
    const literalized = new Map<string, string>();
    for (const attribute of node.attributes) {
      const mapping = THEME_FONT_ATTRIBUTES.find(([theme]) => theme === attribute.localName);
      if (mapping && attribute.namespaceUri === WML_NAMESPACE_URI) {
        const face = themeFaceFor(fonts, attribute.value);
        if (face) literalized.set(mapping[1], face);
        continue;
      }
      next.push(attribute);
    }
    for (const [literal, face] of literalized) {
      if (next.some((attribute) => attribute.localName === literal)) continue;
      next.push({
        kind: 'genericExtension',
        namespaceUri: WML_NAMESPACE_URI,
        localName: literal,
        prefix: 'w',
        value: face,
      });
    }
    attributes = next;
  } else if (
    node.attributes.some(
      (attribute) =>
        THEME_COLOR_ATTRIBUTES.has(attribute.localName) &&
        attribute.namespaceUri === WML_NAMESPACE_URI &&
        node.attributes.some((other) => other.localName === 'val')
    )
  ) {
    attributes = node.attributes.filter(
      (attribute) =>
        !(
          THEME_COLOR_ATTRIBUTES.has(attribute.localName) &&
          attribute.namespaceUri === WML_NAMESPACE_URI
        )
    );
  }
  const children = node.children.map((child) => literalizeThemeReferences(child, fonts));
  const childrenChanged = children.some((child, index) => child !== node.children[index]);
  if (attributes === node.attributes && !childrenChanged) return node;
  return { ...node, attributes, children } as OoxmlNode;
}

// ---------------------------------------------------------------------------
// Part assembly
// ---------------------------------------------------------------------------

export function syntheticPart(name: string, contentType: string, root: OoxmlElement): OoxmlPart {
  return { id: name, name, contentType, root } as OoxmlPart;
}

export function documentRootFor(part: OoxmlPart, blocks: readonly OoxmlNode[]): OoxmlElement {
  if (part.root.kind === 'document') {
    const body = part.root.children.find((child) => child.kind === 'body');
    const bodyElement =
      body && isElementNode(body)
        ? withChildren(body, blocks)
        : ({
            id: 'fragment#body',
            kind: 'body',
            namespaceUri: WML_NAMESPACE_URI,
            localName: 'body',
            prefix: 'w',
            namespaceBindings: [],
            attributes: [],
            children: blocks,
          } as unknown as OoxmlElement);
    return withChildren(part.root, [bodyElement]);
  }
  // A non-document story (header, footer): wrap its blocks in a fresh document/body that
  // inherits the source root's namespace bindings so every prefix stays bound.
  const body = {
    id: 'fragment#body',
    kind: 'body',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'body',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children: blocks,
  } as unknown as OoxmlElement;
  return {
    id: 'fragment#document',
    kind: 'document',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'document',
    prefix: 'w',
    namespaceBindings: isElementNode(part.root) ? part.root.namespaceBindings : [],
    attributes: [],
    children: [body],
  } as unknown as OoxmlElement;
}

export function relationshipXml(records: readonly RelationshipRecord[]): string {
  const rows = records
    .map((record) => {
      const mode = record.targetMode === 'External' ? ' TargetMode="External"' : '';
      return (
        `<Relationship Id="${escapeXmlAttribute(record.id)}" ` +
        `Type="${escapeXmlAttribute(record.type)}" ` +
        `Target="${escapeXmlAttribute(record.rawTarget)}"${mode}/>`
      );
    })
    .join('');
  return `<Relationships xmlns="${RELS_XMLNS}">${rows}</Relationships>`;
}

export function freshRelationshipId(used: ReadonlySet<string>, hint: number): string {
  let index = hint;
  while (used.has(`rId${index}`)) index += 1;
  return `rId${index}`;
}

/** Media extension → content type, from the SOURCE package's resolution for that part. */
export function mediaExtensionOf(partName: string): string {
  const dot = partName.lastIndexOf('.');
  return dot === -1 ? '' : partName.slice(dot + 1).toLowerCase();
}
