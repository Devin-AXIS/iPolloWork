// Header/footer reference resolution over the canonical package (phase 2 of the
// legacy-lane retirement).
//
// Everything needed is already parsed: `pkg.parts` holds each header/footer part as a
// canonical tree and `pkg.relationships` holds every rels part with fail-closed internal
// target resolution. This module only CONNECTS them: each section's `w:sectPr`
// `w:headerReference`/`w:footerReference` children name relationship ids; each resolves
// through the main part's rels — filtered by the header/footer type URIs — to a part name.
//
// Inheritance (ECMA-376 §17.10.1): a section that omits a given header/footer variant
// inherits that variant from the previous section. The first section with no refs therefore
// has no furniture; a later section that declares its own refs uses those; a later section
// that declares nothing keeps the previous section's furniture.
//
// Fail-open per reference, exactly as Word behaves: a dangling r:id renders no header
// rather than refusing the document. Traversal safety was already enforced at load.

import type { OoxmlElement, OoxmlNode } from './ooxml-tree.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import type { OoxmlPart } from './ooxml-tree.ts';
import { walkStoryBlocks } from './content-control-walk.ts';
import { readOnOffChild } from './ooxml-shared.ts';
import { resolveRelationship, type RelationshipRecord } from './relationships.ts';
import { isSettingsElement, settingsOnOff } from './settings-onoff.ts';

const HEADER_REL_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header';
const FOOTER_REL_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer';
const SETTINGS_REL_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings';
const NO_RELATIONSHIPS: readonly RelationshipRecord[] = Object.freeze([]);
// Keep this equal to layout's MAX_DOCUMENT_SECTIONS without adding a store → layout edge.
const MAX_SECTION_PROPERTY_NODES = 4_096;

/** `w:headerReference w:type` vocabulary (ECMA-376 §17.10.5): default, first page, even pages. */
export type HeaderFooterVariant = 'default' | 'first' | 'even';

/** Header vs footer region kind for chrome and lifecycle ops. */
export type HeaderFooterKind = 'header' | 'footer';

/**
 * A section's resolved header and footer parts, by variant.
 *
 * The `even` variant is only honoured when `w:evenAndOddHeaders` is set in settings.xml —
 * without it Word ignores an authored even header, and so does this.
 */
export interface HeaderFooterParts {
  readonly headers: ReadonlyMap<HeaderFooterVariant, OoxmlPart>;
  readonly footers: ReadonlyMap<HeaderFooterVariant, OoxmlPart>;
  /** `w:evenAndOddHeaders` in settings.xml — without it the `even` variant is ignored. */
  readonly evenAndOddHeaders: boolean;
  /** Whether this section enables first-page header/footer furniture (`w:titlePg`). */
  readonly titlePage: boolean;
}

/**
 * One resolved furniture slot with enough metadata for "Same as previous" chrome.
 *
 * `inherited: true` means this section has no declared reference for the slot and the
 * part comes from a predecessor. The first section never reports inherited — omitting a
 * ref there is blank furniture, not inheritance from a later section.
 */
export interface HeaderFooterSlotMeta {
  readonly part: OoxmlPart;
  readonly partName: string;
  readonly rId: string;
  readonly inherited: boolean;
}

/** Per-section resolution including declared-vs-inherited metadata. */
export interface HeaderFooterSectionResolution {
  readonly headers: ReadonlyMap<HeaderFooterVariant, HeaderFooterSlotMeta>;
  readonly footers: ReadonlyMap<HeaderFooterVariant, HeaderFooterSlotMeta>;
  readonly evenAndOddHeaders: boolean;
  readonly titlePage: boolean;
}

/** Whether a section can paint one authored furniture variant. @internal */
export function headerFooterVariantCanPaint(
  section: { readonly evenAndOddHeaders: boolean; readonly titlePage: boolean },
  variant: HeaderFooterVariant
): boolean {
  if (variant === 'first') return section.titlePage;
  if (variant === 'even') return section.evenAndOddHeaders;
  return true;
}

const EMPTY: HeaderFooterParts = Object.freeze({
  headers: new Map(),
  footers: new Map(),
  evenAndOddHeaders: false,
  titlePage: false,
});

function elementChildren(node: OoxmlNode): readonly OoxmlNode[] {
  return node.kind === 'textValue' ? [] : node.children;
}

function attributeValue(node: OoxmlElement, localName: string): string | undefined {
  return node.attributes.find((attribute) => attribute.localName === localName)?.value;
}

function variantOf(raw: string | undefined): HeaderFooterVariant | null {
  return raw === 'default' || raw === 'first' || raw === 'even' ? raw : null;
}

function childNamed(node: OoxmlNode, localName: string): OoxmlElement | undefined {
  for (const child of elementChildren(node)) {
    if (child.kind !== 'textValue' && child.localName === localName) return child;
  }
  return undefined;
}

function findBody(root: OoxmlNode): OoxmlElement | undefined {
  if (root.kind === 'textValue') return undefined;
  if (root.kind === 'body' || root.localName === 'body') return root;
  for (const child of root.children) {
    const found = findBody(child);
    if (found) return found;
  }
  return undefined;
}

function paragraphSectPr(paragraph: OoxmlElement): OoxmlElement | undefined {
  const pPr =
    paragraph.children.find((child) => child.kind === 'paragraphProperties') ??
    childNamed(paragraph, 'pPr');
  if (!pPr || pPr.kind === 'textValue') return undefined;
  return childNamed(pPr, 'sectPr');
}

interface SectionPropertySubtreeSummary {
  readonly blockCount: number;
  readonly sectionProperties: readonly OoxmlElement[];
  readonly lastBlockEndsSection: boolean;
}

const sectionPropertySubtreeSummaries = new WeakMap<OoxmlNode, SectionPropertySubtreeSummary>();

/**
 * Section markers under one immutable direct body child.
 *
 * A text edit rebuilds one child and the body ancestry. Unchanged siblings keep these summaries,
 * so header/footer resolution does not flatten every table and content-control subtree again.
 */
function sectionPropertySummaryOf(node: OoxmlNode): SectionPropertySubtreeSummary {
  const cached = sectionPropertySubtreeSummaries.get(node);
  if (cached) return cached;
  let blockCount = 0;
  let lastBlockEndsSection = false;
  const sectionProperties: OoxmlElement[] = [];
  walkStoryBlocks([node], 0, (block) => {
    blockCount += 1;
    const sectPr = block.kind === 'paragraph' ? paragraphSectPr(block) : undefined;
    lastBlockEndsSection = sectPr !== undefined;
    if (sectPr && sectionProperties.length < MAX_SECTION_PROPERTY_NODES) {
      sectionProperties.push(sectPr);
    }
  });
  const result = Object.freeze({
    blockCount,
    sectionProperties: Object.freeze(sectionProperties),
    lastBlockEndsSection,
  });
  sectionPropertySubtreeSummaries.set(node, result);
  return result;
}

/**
 * `w:sectPr` nodes in section order, aligned with layout's `enumerateDocumentSections`.
 *
 * `null` means a section with no `w:sectPr` node (Word defaults, inherits HF from previous).
 * Paragraph-level breaks first; the final entry covers remaining blocks (body-level or null).
 */
export function collectSectionPropertyNodes(root: OoxmlNode): Array<OoxmlElement | null> {
  const body = findBody(root);
  if (!body) return [];
  const found: Array<OoxmlElement | null> = [];
  let blockCount = 0;
  let lastBlockEndsSection = false;
  for (const child of body.children) {
    const summary = sectionPropertySummaryOf(child);
    if (summary.blockCount === 0) continue;
    blockCount += summary.blockCount;
    for (const sectPr of summary.sectionProperties) {
      if (found.length >= MAX_SECTION_PROPERTY_NODES) return found;
      found.push(sectPr);
    }
    lastBlockEndsSection = summary.lastBlockEndsSection;
  }
  if (found.length >= MAX_SECTION_PROPERTY_NODES) return found;
  if (blockCount === 0 || !lastBlockEndsSection) {
    found.push(childNamed(body, 'sectPr') ?? null);
  } else {
    const bodySectPr = childNamed(body, 'sectPr');
    if (bodySectPr) found.push(bodySectPr);
  }
  return found;
}

interface DeclaredSlot {
  readonly part: OoxmlPart;
  readonly rId: string;
}

function referencesFromSectPr(
  sectPr: OoxmlElement,
  partForReference: (
    relId: string | undefined,
    typeUri: string
  ) => { part: OoxmlPart; rId: string } | undefined
): {
  headers: Map<HeaderFooterVariant, DeclaredSlot>;
  footers: Map<HeaderFooterVariant, DeclaredSlot>;
  titlePage: boolean;
} {
  const headers = new Map<HeaderFooterVariant, DeclaredSlot>();
  const footers = new Map<HeaderFooterVariant, DeclaredSlot>();
  for (const child of elementChildren(sectPr)) {
    if (child.kind === 'textValue') continue;
    const isHeader = child.localName === 'headerReference';
    const isFooter = child.localName === 'footerReference';
    if (!isHeader && !isFooter) continue;
    const variant = variantOf(attributeValue(child, 'type'));
    if (!variant) continue;
    const resolved = partForReference(
      attributeValue(child, 'id'),
      isHeader ? HEADER_REL_TYPE : FOOTER_REL_TYPE
    );
    if (!resolved) continue;
    const target = isHeader ? headers : footers;
    // Word honours the FIRST reference of a given type; a duplicate is ignored.
    if (!target.has(variant)) target.set(variant, resolved);
  }
  return {
    headers,
    footers,
    titlePage: readOnOffChild(sectPr, 'titlePg'),
  };
}

function inheritSlots(
  previous: ReadonlyMap<HeaderFooterVariant, HeaderFooterSlotMeta> | undefined,
  declared: ReadonlyMap<HeaderFooterVariant, DeclaredSlot>
): Map<HeaderFooterVariant, HeaderFooterSlotMeta> {
  const result = new Map<HeaderFooterVariant, HeaderFooterSlotMeta>();
  if (previous) {
    for (const [variant, slot] of previous) {
      // Inherited slots stay marked inherited — a later section that declares nothing
      // keeps the predecessor's furniture without claiming authorship.
      result.set(variant, { ...slot, inherited: true });
    }
  }
  for (const [variant, slot] of declared) {
    result.set(variant, {
      part: slot.part,
      partName: slot.part.name,
      rId: slot.rId,
      inherited: false,
    });
  }
  return result;
}

function partsFromSlots(
  slots: ReadonlyMap<HeaderFooterVariant, HeaderFooterSlotMeta>
): Map<HeaderFooterVariant, OoxmlPart> {
  const result = new Map<HeaderFooterVariant, OoxmlPart>();
  for (const [variant, slot] of slots) result.set(variant, slot.part);
  return result;
}

/** Convert resolved metadata without repeating section discovery and relationship resolution. */
export function headerFooterPartsFromResolution(
  resolution: readonly HeaderFooterSectionResolution[]
): readonly HeaderFooterParts[] {
  return resolution.map((section) => ({
    headers: partsFromSlots(section.headers),
    footers: partsFromSlots(section.footers),
    evenAndOddHeaders: section.evenAndOddHeaders,
    titlePage: section.titlePage,
  }));
}

interface HeaderFooterResolutionMemo {
  readonly sectionProperties: readonly (OoxmlElement | null)[];
  readonly evenAndOddHeaders: boolean;
  readonly slotParts: readonly OoxmlPart[];
  readonly resolution: readonly HeaderFooterSectionResolution[];
  readonly parts: readonly HeaderFooterParts[];
}

const headerFooterResolutionByRelationships = new WeakMap<object, HeaderFooterResolutionMemo>();

function sameSectionProperties(
  left: readonly (OoxmlElement | null)[],
  right: readonly (OoxmlElement | null)[]
): boolean {
  return (
    left.length === right.length &&
    left.every((sectionProperties, index) => sectionProperties === right[index])
  );
}

function slotPartsOf(resolution: readonly HeaderFooterSectionResolution[]): readonly OoxmlPart[] {
  const parts = new Set<OoxmlPart>();
  for (const section of resolution) {
    for (const slots of [section.headers, section.footers]) {
      for (const slot of slots.values()) parts.add(slot.part);
    }
  }
  return [...parts];
}

function resolveHeaderFooterBySection(pkg: OoxmlPackage): HeaderFooterResolutionMemo | null {
  const main = pkg.parts.get(pkg.mainDocumentPart);
  if (!main) return null;

  const packageRelationships = pkg.relationships.get(pkg.mainDocumentPart);
  const relationships = packageRelationships ?? NO_RELATIONSHIPS;
  const evenAndOddHeaders = readEvenAndOddHeaders(pkg, relationships);
  const sectionProperties = collectSectionPropertyNodes(main.root);
  const memoKey =
    packageRelationships ??
    sectionProperties.find((node): node is OoxmlElement => node !== null) ??
    NO_RELATIONSHIPS;
  const cached = headerFooterResolutionByRelationships.get(memoKey);
  if (
    cached &&
    cached.evenAndOddHeaders === evenAndOddHeaders &&
    sameSectionProperties(cached.sectionProperties, sectionProperties) &&
    cached.slotParts.every((part) => pkg.parts.get(part.name) === part)
  ) {
    return cached;
  }

  const partForReference = (
    relId: string | undefined,
    typeUri: string
  ): { part: OoxmlPart; rId: string } | undefined => {
    if (!relId) return undefined;
    const record = relationships.find((rel) => rel.id === relId && rel.type === typeUri);
    if (!record) return undefined;
    const resolved = resolveRelationship(record);
    if (resolved.mode !== 'Internal' || !resolved.target.ok) return undefined;
    const part = pkg.parts.get(resolved.target.partName);
    return part ? { part, rId: relId } : undefined;
  };

  const result: HeaderFooterSectionResolution[] = [];
  let previous: HeaderFooterSectionResolution | undefined;
  const nodes = sectionProperties.length > 0 ? sectionProperties : [null];
  for (const sectPr of nodes) {
    const declared = sectPr
      ? referencesFromSectPr(sectPr, partForReference)
      : { headers: new Map(), footers: new Map(), titlePage: false };
    const resolved: HeaderFooterSectionResolution = {
      headers: inheritSlots(previous?.headers, declared.headers),
      footers: inheritSlots(previous?.footers, declared.footers),
      evenAndOddHeaders,
      titlePage: declared.titlePage,
    };
    result.push(resolved);
    previous = resolved;
  }
  const resolution = Object.freeze(result);
  const memo = Object.freeze({
    sectionProperties,
    evenAndOddHeaders,
    slotParts: Object.freeze(slotPartsOf(resolution)),
    resolution,
    parts: Object.freeze(headerFooterPartsFromResolution(resolution)),
  });
  headerFooterResolutionByRelationships.set(memoKey, memo);
  return memo;
}

/**
 * Resolve header/footer parts for every section with declared-vs-inherited metadata.
 *
 * Index aligns with `enumerateDocumentSections` in the layout package. Existing merged
 * maps stay available via {@link resolveHeaderFooterPartsBySection}.
 */
export function resolveHeaderFooterResolutionBySection(
  pkg: OoxmlPackage
): readonly HeaderFooterSectionResolution[] {
  return resolveHeaderFooterBySection(pkg)?.resolution ?? [];
}

/**
 * Resolve header/footer parts for every section, applying OOXML inheritance.
 *
 * Index aligns with `enumerateDocumentSections` in the layout package.
 */
export function resolveHeaderFooterPartsBySection(pkg: OoxmlPackage): readonly HeaderFooterParts[] {
  return resolveHeaderFooterBySection(pkg)?.parts ?? [];
}

/**
 * Resolve the main-document header/footer references to their parts, gated by the
 * settings the section actually declares.
 *
 * Returns the FINAL section's effective parts (after inheritance). Multi-section hosts
 * should prefer `resolveHeaderFooterPartsBySection`.
 */
export function resolveHeaderFooterParts(pkg: OoxmlPackage): HeaderFooterParts {
  const bySection = resolveHeaderFooterPartsBySection(pkg);
  return bySection[bySection.length - 1] ?? EMPTY;
}

function readEvenAndOddHeaders(
  pkg: OoxmlPackage,
  mainRelationships: readonly RelationshipRecord[]
): boolean {
  const settingsRel = mainRelationships.find((rel) => rel.type === SETTINGS_REL_TYPE);
  if (!settingsRel) return false;
  const resolved = resolveRelationship(settingsRel);
  if (resolved.mode !== 'Internal' || !resolved.target.ok) return false;
  const settings = pkg.parts.get(resolved.target.partName);
  if (!settings || !isSettingsElement(settings.root)) return false;
  // ST_OnOff: `0`, `false` and `off` all turn it off, and it also adds blank parity sheets.
  return settingsOnOff(settings.root, 'evenAndOddHeaders');
}
