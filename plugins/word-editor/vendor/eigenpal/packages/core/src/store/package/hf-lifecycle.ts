// Header/footer package lifecycle: create, delete, link, unlink, furniture options.
//
// These mutations touch the main document's `w:sectPr` references, the document rels
// part, `[Content_Types].xml` overrides, and optionally `settings.xml` — never a single
// story tree alone. Application is pure: given a package and an op, return a new package
// or a typed rejection, with no partial writes.
//
// Security posture matches `numbering-part.ts`: engine-authored XML is literals +
// validated integers only; content-types bytes are parse-and-prove patched; relationship
// targets are relative safe paths; maps are prototype-safe; scans are bounded.

import {
  carryIndexToRebuiltRoot,
  createNodeIdAllocator,
  insertChildren,
  replaceChildren,
} from './ooxml-edit.ts';
import { readOoxmlPart, type OoxmlElement, type OoxmlNode, type OoxmlPart } from './ooxml-tree.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import { withPart } from './ooxml-package.ts';
import { WML_NAMESPACE_URI } from './ooxml-shared.ts';
import { partNumberCandidates } from './actor-scoped-ids.ts';
import { withoutPart } from './package-edit.ts';
import {
  cloneOwnedRelationships,
  freeRelationshipId,
  withContentTypeOverride,
  withFreshIds,
  withStoryRelationship,
} from './hf-lifecycle-shell.ts';
import {
  collectSectionPropertyNodes,
  resolveHeaderFooterResolutionBySection,
  type HeaderFooterKind,
  type HeaderFooterVariant,
} from './hf-references.ts';
import { applyPackageWatermark, type PackageWatermarkWrite } from './watermark-package.ts';
import {
  applyDocumentProtection,
  sectionElement,
  settingsPartForWrite,
  wmlAttribute,
} from './settings-write.ts';

/** Lifecycle impact — furniture always reaches multiple pages; never narrower than flow-structural. */
export type HeaderFooterLifecycleImpact = 'flow-structural' | 'global';

const W = WML_NAMESPACE_URI;
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const HEADER_REL_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header';
const FOOTER_REL_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer';
const HEADER_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml';
const FOOTER_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml';

/** Cap on header/footer part numbers scanned when allocating a free name. */
const MAX_PART_NUMBER = 10_000;
/** Same margin bound as `setSectionProperties` write validation. */
const MAX_DISTANCE_TWIPS = 31_680;
/** Cap on section property nodes walked for reference counting. */
const MAX_SECTIONS = 4_096;

/**
 * A header/footer lifecycle mutation: create, remove, or relink a variant.
 *
 * Package-level, like note lifecycle: each touches the document, the header/footer part, the
 * relationships and `[Content_Types].xml` together.
 */
export type HeaderFooterLifecycleOp =
  | {
      readonly op: 'createHeaderFooter';
      readonly sectionIndex: number;
      readonly kind: HeaderFooterKind;
      readonly variant: HeaderFooterVariant;
      /** When true, also set section `w:titlePg` in the same package transaction. */
      readonly titlePage?: boolean;
      /** When true, also set document `w:evenAndOddHeaders` in the same package transaction. */
      readonly evenAndOddHeaders?: boolean;
    }
  | {
      readonly op: 'deleteHeaderFooter';
      readonly sectionIndex: number;
      readonly kind: HeaderFooterKind;
      readonly variant: HeaderFooterVariant;
    }
  | {
      readonly op: 'linkToPrevious';
      readonly sectionIndex: number;
      readonly kind: HeaderFooterKind;
      readonly variant: HeaderFooterVariant;
    }
  | {
      readonly op: 'unlinkFromPrevious';
      readonly sectionIndex: number;
      readonly kind: HeaderFooterKind;
      readonly variant: HeaderFooterVariant;
    }
  | {
      readonly op: 'setSectionFurnitureOptions';
      readonly sectionIndex?: number;
      readonly titlePage?: boolean;
      readonly evenAndOddHeaders?: boolean;
      readonly headerDistanceTwips?: number;
      readonly footerDistanceTwips?: number;
    }
  | {
      /**
       * A `settings.xml` write like `evenAndOddHeaders`, so it rides the same package-level
       * undo unit and the same routing rather than growing a second lifecycle lane.
       */
      readonly op: 'setDocumentProtection';
      readonly enforce: boolean;
    }
  | {
      /**
       * Replace the document watermark in every header a section shows; null removes it.
       * It may create a section's default header, so it rides this lane's package undo unit.
       */
      readonly op: 'setWatermark';
      readonly watermark: PackageWatermarkWrite | null;
    };

/** Why a header/footer lifecycle op was refused. */
export type HeaderFooterLifecycleRejection = 'invalidArgs' | 'tree-invariant';

/** A new package, or a typed rejection. Pure and all-or-nothing — no partial writes. */
export type HeaderFooterLifecycleResult =
  | {
      readonly ok: true;
      readonly package: OoxmlPackage;
      readonly impact: HeaderFooterLifecycleImpact;
      readonly createdRId?: string;
      readonly createdPartName?: string;
    }
  | {
      readonly ok: false;
      readonly reason: HeaderFooterLifecycleRejection;
      readonly detail?: string;
    };

const LIFECYCLE_OPS = new Set([
  'createHeaderFooter',
  'deleteHeaderFooter',
  'linkToPrevious',
  'unlinkFromPrevious',
  'setSectionFurnitureOptions',
  'setDocumentProtection',
  'setWatermark',
]);

/** Whether an op is a header/footer lifecycle op rather than a story-level one. */
export function isHeaderFooterLifecycleOp(op: {
  readonly op: string;
}): op is HeaderFooterLifecycleOp {
  return LIFECYCLE_OPS.has(op.op);
}

function fail(
  reason: HeaderFooterLifecycleRejection,
  detail?: string
): HeaderFooterLifecycleResult {
  return detail ? { ok: false, reason, detail } : { ok: false, reason };
}

function isVariant(value: unknown): value is HeaderFooterVariant {
  return value === 'default' || value === 'first' || value === 'even';
}

function isKind(value: unknown): value is HeaderFooterKind {
  return value === 'header' || value === 'footer';
}

function isNonNegInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function validateSlotOp(
  op: Extract<
    HeaderFooterLifecycleOp,
    | { op: 'createHeaderFooter' }
    | { op: 'deleteHeaderFooter' }
    | { op: 'linkToPrevious' }
    | { op: 'unlinkFromPrevious' }
  >
): HeaderFooterLifecycleResult | null {
  if (!isNonNegInt(op.sectionIndex) || op.sectionIndex >= MAX_SECTIONS) {
    return fail('invalidArgs', 'sectionIndex');
  }
  if (!isKind(op.kind)) return fail('invalidArgs', 'kind');
  if (!isVariant(op.variant)) return fail('invalidArgs', 'variant');
  return null;
}

/**
 * Apply one furniture lifecycle op atomically. Rejected ops leave the input package
 * untouched (pure function — callers discard the result).
 */
export function applyHeaderFooterLifecycleOp(
  pkg: OoxmlPackage,
  op: HeaderFooterLifecycleOp
): HeaderFooterLifecycleResult {
  if (!isHeaderFooterLifecycleOp(op)) return fail('invalidArgs', 'unknown-op');

  switch (op.op) {
    case 'createHeaderFooter':
      return applyCreate(pkg, op);
    case 'deleteHeaderFooter':
      return applyDelete(pkg, op);
    case 'linkToPrevious':
      return applyLink(pkg, op);
    case 'unlinkFromPrevious':
      return applyUnlink(pkg, op);
    case 'setSectionFurnitureOptions':
      return applyFurnitureOptions(pkg, op);
    case 'setDocumentProtection':
      return applyDocumentProtection(pkg, op);
    case 'setWatermark':
      return applyPackageWatermark(pkg, op.watermark, (next, sectionIndex, variant) => {
        const created = applyCreate(next, {
          op: 'createHeaderFooter',
          sectionIndex,
          kind: 'header',
          variant,
        });
        return created.ok ? created.package : null;
      });
  }
}

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

function applyCreate(
  pkg: OoxmlPackage,
  op: Extract<HeaderFooterLifecycleOp, { op: 'createHeaderFooter' }>
): HeaderFooterLifecycleResult {
  const shape = validateSlotOp(op);
  if (shape) return shape;

  const resolution = resolveHeaderFooterResolutionBySection(pkg);
  if (op.sectionIndex >= resolution.length) return fail('invalidArgs', 'sectionIndex');
  const section = resolution[op.sectionIndex]!;
  const slots = op.kind === 'header' ? section.headers : section.footers;
  if (slots.has(op.variant)) return fail('invalidArgs', 'slot-occupied');

  const allocated = allocateStoryPart(pkg, op.kind);
  if (!allocated) return fail('tree-invariant', 'part-allocation');

  const empty = emptyStoryPart(allocated.partName, allocated.contentType, op.kind);
  if (!empty) return fail('tree-invariant', 'empty-part');

  let next = withPart(pkg, empty);
  const related = withStoryRelationship(next, allocated.rId, allocated.relType, allocated.target);
  if (!related) return fail('tree-invariant', 'relationship');
  next = related;
  const typed = withContentTypeOverride(next, allocated.partName, allocated.contentType);
  if (!typed) return fail('tree-invariant', 'content-type');
  next = typed;

  const referenced = setSectionReference(next, op.sectionIndex, op.kind, op.variant, allocated.rId);
  if (!referenced) return fail('tree-invariant', 'sectPr-reference');
  next = referenced;

  // First/even creation may enable the matching document/section flag in the SAME
  // package transaction so one undo restores part + flag together.
  if (op.titlePage === true) {
    const titled = patchSectionFurniture(next, op.sectionIndex, { titlePage: true });
    if (!titled) return fail('tree-invariant', 'sectPr-options');
    next = titled;
  }
  if (op.evenAndOddHeaders === true) {
    const settings = setEvenAndOddHeaders(next, true);
    if (!settings) return fail('tree-invariant', 'settings');
    next = settings;
  }

  return {
    ok: true,
    package: next,
    impact: 'global',
    createdRId: allocated.rId,
    createdPartName: allocated.partName,
  };
}

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

function applyDelete(
  pkg: OoxmlPackage,
  op: Extract<HeaderFooterLifecycleOp, { op: 'deleteHeaderFooter' }>
): HeaderFooterLifecycleResult {
  const shape = validateSlotOp(op);
  if (shape) return shape;

  const resolution = resolveHeaderFooterResolutionBySection(pkg);
  if (op.sectionIndex >= resolution.length) return fail('invalidArgs', 'sectionIndex');
  const section = resolution[op.sectionIndex]!;
  const slots = op.kind === 'header' ? section.headers : section.footers;
  const slot = slots.get(op.variant);
  if (!slot || slot.inherited) return fail('invalidArgs', 'not-declared');

  const cleared = removeSectionReference(pkg, op.sectionIndex, op.kind, op.variant);
  if (!cleared) return fail('tree-invariant', 'sectPr-reference');

  const remaining = countReferences(cleared, slot.rId);
  if (remaining > 0) {
    return { ok: true, package: cleared, impact: 'global' };
  }
  const collected = garbageCollectStory(cleared, slot.rId, slot.partName);
  if (!collected) return fail('tree-invariant', 'gc');
  return { ok: true, package: collected, impact: 'global' };
}

// ---------------------------------------------------------------------------
// link (Same as previous ON)
// ---------------------------------------------------------------------------

function applyLink(
  pkg: OoxmlPackage,
  op: Extract<HeaderFooterLifecycleOp, { op: 'linkToPrevious' }>
): HeaderFooterLifecycleResult {
  const shape = validateSlotOp(op);
  if (shape) return shape;
  // First section has no predecessor — linking would invent inheritance from nowhere.
  if (op.sectionIndex === 0) return fail('invalidArgs', 'first-section');

  const resolution = resolveHeaderFooterResolutionBySection(pkg);
  if (op.sectionIndex >= resolution.length) return fail('invalidArgs', 'sectionIndex');
  const section = resolution[op.sectionIndex]!;
  const slots = op.kind === 'header' ? section.headers : section.footers;
  const slot = slots.get(op.variant);
  if (!slot || slot.inherited) return fail('invalidArgs', 'not-declared');

  const cleared = removeSectionReference(pkg, op.sectionIndex, op.kind, op.variant);
  if (!cleared) return fail('tree-invariant', 'sectPr-reference');

  const remaining = countReferences(cleared, slot.rId);
  if (remaining > 0) {
    return { ok: true, package: cleared, impact: 'global' };
  }
  const collected = garbageCollectStory(cleared, slot.rId, slot.partName);
  if (!collected) return fail('tree-invariant', 'gc');
  return { ok: true, package: collected, impact: 'global' };
}

// ---------------------------------------------------------------------------
// unlink (Same as previous OFF — clone)
// ---------------------------------------------------------------------------

function applyUnlink(
  pkg: OoxmlPackage,
  op: Extract<HeaderFooterLifecycleOp, { op: 'unlinkFromPrevious' }>
): HeaderFooterLifecycleResult {
  const shape = validateSlotOp(op);
  if (shape) return shape;

  const resolution = resolveHeaderFooterResolutionBySection(pkg);
  if (op.sectionIndex >= resolution.length) return fail('invalidArgs', 'sectionIndex');
  const section = resolution[op.sectionIndex]!;
  const slots = op.kind === 'header' ? section.headers : section.footers;
  const slot = slots.get(op.variant);
  if (!slot) return fail('invalidArgs', 'nothing-to-unlink');
  if (!slot.inherited) return fail('invalidArgs', 'already-declared');

  const source = pkg.parts.get(slot.partName);
  if (!source) return fail('tree-invariant', 'missing-source');

  const allocated = allocateStoryPart(pkg, op.kind);
  if (!allocated) return fail('tree-invariant', 'part-allocation');

  const cloned = cloneStoryPart(source, allocated.partName, allocated.contentType);
  if (!cloned) return fail('tree-invariant', 'clone');

  let next = withPart(pkg, cloned);
  // Clone the source part's owned relationships under the new owner so hyperlink /
  // image / embed rIds in the cloned story remain resolvable (same ids/targets/modes).
  const owned = cloneOwnedRelationships(next, slot.partName, allocated.partName);
  if (!owned) return fail('tree-invariant', 'owned-relationships');
  next = owned;
  const related = withStoryRelationship(next, allocated.rId, allocated.relType, allocated.target);
  if (!related) return fail('tree-invariant', 'relationship');
  next = related;
  const typed = withContentTypeOverride(next, allocated.partName, allocated.contentType);
  if (!typed) return fail('tree-invariant', 'content-type');
  next = typed;

  const referenced = setSectionReference(next, op.sectionIndex, op.kind, op.variant, allocated.rId);
  if (!referenced) return fail('tree-invariant', 'sectPr-reference');

  return {
    ok: true,
    package: referenced,
    impact: 'global',
    createdRId: allocated.rId,
    createdPartName: allocated.partName,
  };
}

// ---------------------------------------------------------------------------
// furniture options
// ---------------------------------------------------------------------------

function applyFurnitureOptions(
  pkg: OoxmlPackage,
  op: Extract<HeaderFooterLifecycleOp, { op: 'setSectionFurnitureOptions' }>
): HeaderFooterLifecycleResult {
  const touchesTitle = op.titlePage !== undefined;
  const touchesEven = op.evenAndOddHeaders !== undefined;
  const touchesHeaderDist = op.headerDistanceTwips !== undefined;
  const touchesFooterDist = op.footerDistanceTwips !== undefined;
  if (!touchesTitle && !touchesEven && !touchesHeaderDist && !touchesFooterDist) {
    return fail('invalidArgs', 'empty-options');
  }

  for (const value of [op.headerDistanceTwips, op.footerDistanceTwips]) {
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value < 0 || value > MAX_DISTANCE_TWIPS) {
      return fail('invalidArgs', 'distance');
    }
  }

  const needsSection = touchesTitle || touchesHeaderDist || touchesFooterDist;
  if (needsSection) {
    if (
      op.sectionIndex === undefined ||
      !isNonNegInt(op.sectionIndex) ||
      op.sectionIndex >= MAX_SECTIONS
    ) {
      return fail('invalidArgs', 'sectionIndex');
    }
  }

  let next = pkg;
  if (needsSection) {
    const patched = patchSectionFurniture(next, op.sectionIndex!, {
      titlePage: op.titlePage,
      headerDistanceTwips: op.headerDistanceTwips,
      footerDistanceTwips: op.footerDistanceTwips,
    });
    if (!patched) return fail('tree-invariant', 'sectPr-options');
    next = patched;
  }

  if (touchesEven) {
    const settings = setEvenAndOddHeaders(next, op.evenAndOddHeaders!);
    if (!settings) return fail('tree-invariant', 'settings');
    next = settings;
  }

  return { ok: true, package: next, impact: 'global' };
}

// ---------------------------------------------------------------------------
// Part allocation / empty / clone
// ---------------------------------------------------------------------------

interface AllocatedStory {
  readonly partName: string;
  readonly target: string;
  readonly rId: string;
  readonly relType: string;
  readonly contentType: string;
}

function allocateStoryPart(pkg: OoxmlPackage, kind: HeaderFooterKind): AllocatedStory | null {
  const prefix = kind === 'header' ? 'header' : 'footer';
  const contentType = kind === 'header' ? HEADER_CONTENT_TYPE : FOOTER_CONTENT_TYPE;
  const relType = kind === 'header' ? HEADER_REL_TYPE : FOOTER_REL_TYPE;
  let next = MAX_PART_NUMBER + 1;
  for (const candidate of partNumberCandidates(MAX_PART_NUMBER)) {
    const partName = `/word/${prefix}${candidate}.xml`;
    if (!pkg.parts.has(partName) && !pkg.partBytes.has(partName)) {
      next = candidate;
      break;
    }
  }
  if (next > MAX_PART_NUMBER) return null;
  const target = `${prefix}${next}.xml`;
  // Target is engine-authored digits only — never file-derived.
  if (!/^(header|footer)\d{1,5}\.xml$/.test(target)) return null;
  return {
    partName: `/word/${prefix}${next}.xml`,
    target,
    rId: freeRelationshipId(pkg),
    relType,
    contentType,
  };
}

function emptyStoryPart(
  partName: string,
  contentType: string,
  kind: HeaderFooterKind
): OoxmlPart | null {
  const root = kind === 'header' ? 'hdr' : 'ftr';
  // Engine literal: one empty paragraph. Creation is explicit — never auto-allocated on
  // double-click without a committed op.
  const xml =
    `<w:${root} xmlns:w="${W}" xmlns:r="${R_NS}">` +
    '<w:p><w:r><w:t></w:t></w:r></w:p>' +
    `</w:${root}>`;
  const read = readOoxmlPart(xml, { name: partName, contentType });
  return read.ok ? read.part : null;
}

function cloneStoryPart(
  source: OoxmlPart,
  partName: string,
  contentType: string
): OoxmlPart | null {
  let counter = 0;
  const nextId = (): string => {
    counter += 1;
    return `${partName}#clone:${counter}`;
  };
  const cloned = cloneNodeIds(source.root, nextId);
  if (cloned.kind === 'textValue') return null;
  const root = cloned as OoxmlElement;
  return Object.freeze({
    id: `part:${partName}`,
    name: partName,
    contentType,
    root,
  });
}

function cloneNodeIds(node: OoxmlNode, nextId: () => string): OoxmlNode {
  if (node.kind === 'textValue') return { ...node, id: nextId() };
  return {
    ...node,
    id: nextId(),
    children: node.children.map((child) => cloneNodeIds(child, nextId)),
  } as OoxmlNode;
}

// ---------------------------------------------------------------------------
// sectPr reference mutation
// ---------------------------------------------------------------------------

/**
 * The main part with `xmlns:r` guaranteed on its root, or null when the prefix is taken.
 *
 * A minted `w:headerReference` carries `r:id`, and a minimal document that never declared
 * the relationships namespace fails the invariant validator with `invalid-qname` — the
 * whole create refused over a missing binding. Same discipline as the `w14:paraId` root
 * binding: add it at the root, in the same mutation that needs it.
 */
function withRelationshipRootBinding(main: OoxmlPart): OoxmlPart | null {
  const bound = main.root.namespaceBindings.find((binding) => binding.prefix === 'r');
  if (bound) return bound.namespaceUri === R_NS ? main : null;
  const root = {
    ...main.root,
    namespaceBindings: Object.freeze([
      ...main.root.namespaceBindings,
      Object.freeze({ prefix: 'r', namespaceUri: R_NS }),
    ]),
  } as typeof main.root;
  // A rebuilt root outside the edit primitives carries its index — see the invariant on
  // `carryIndexToRebuiltRoot`.
  carryIndexToRebuiltRoot(main.root, root);
  return { ...main, root };
}

function setSectionReference(
  pkg: OoxmlPackage,
  sectionIndex: number,
  kind: HeaderFooterKind,
  variant: HeaderFooterVariant,
  rId: string
): OoxmlPackage | null {
  if (!/^rId\d{1,9}$/.test(rId)) return null;
  const located = pkg.parts.get(pkg.mainDocumentPart);
  if (!located) return null;
  const main = withRelationshipRootBinding(located);
  if (!main) return null;
  const sectPrNodes = collectSectionPropertyNodes(main.root);
  if (sectionIndex >= sectPrNodes.length) return null;

  const localName = kind === 'header' ? 'headerReference' : 'footerReference';
  const nextId = createNodeIdAllocator(main);
  const reference = authoredReference(localName, variant, rId, nextId);
  if (!reference) return null;

  const target = sectPrNodes[sectionIndex];
  let nextMain: OoxmlPart;
  if (target) {
    // Replace any existing declared ref of this variant, then insert at sequence head.
    const without = filterReferences(target, localName, variant);
    const children = [reference, ...without.children];
    const replaced = replaceChildren(main, target.id, children);
    if (!replaced.ok) return null;
    nextMain = replaced.part;
  } else {
    // Null entry is the implicit body-level section — mint sectPr as body's last child.
    const body = findBody(main.root);
    if (!body) return null;
    const sectPr = sectionElement(nextId(), 'sectPr', [], [reference]);
    const inserted = insertChildren(main, body.id, body.children.length, [sectPr]);
    if (!inserted.ok) return null;
    nextMain = inserted.part;
  }
  return withPart(pkg, nextMain);
}

function removeSectionReference(
  pkg: OoxmlPackage,
  sectionIndex: number,
  kind: HeaderFooterKind,
  variant: HeaderFooterVariant
): OoxmlPackage | null {
  const main = pkg.parts.get(pkg.mainDocumentPart);
  if (!main) return null;
  const sectPrNodes = collectSectionPropertyNodes(main.root);
  if (sectionIndex >= sectPrNodes.length) return null;
  const target = sectPrNodes[sectionIndex];
  if (!target) return failNull(); // cannot remove a declared ref from a missing sectPr

  const localName = kind === 'header' ? 'headerReference' : 'footerReference';
  const filtered = filterReferences(target, localName, variant);
  if (filtered.children.length === target.children.length) return null;
  const replaced = replaceChildren(main, target.id, filtered.children);
  if (!replaced.ok) return null;
  return withPart(pkg, replaced.part);
}

function failNull(): null {
  return null;
}

function filterReferences(
  sectPr: OoxmlElement,
  localName: string,
  variant: HeaderFooterVariant
): OoxmlElement {
  const children = sectPr.children.filter((child) => {
    if (child.kind === 'textValue') return true;
    if (child.localName !== localName) return true;
    return attributeOf(child, 'type') !== variant;
  });
  return { ...sectPr, children } as OoxmlElement;
}

function authoredReference(
  localName: string,
  variant: HeaderFooterVariant,
  rId: string,
  nextId: () => string
): OoxmlNode | null {
  // Parse-and-prove: engine literals only, then graft under fresh ids.
  const xml =
    `<w:sectPr xmlns:w="${W}" xmlns:r="${R_NS}">` +
    `<w:${localName} w:type="${variant}" r:id="${rId}"/>` +
    '</w:sectPr>';
  const read = readOoxmlPart(xml, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!read.ok) return null;
  const child = read.part.root.children[0];
  if (!child || child.kind === 'textValue' || child.localName !== localName) return null;
  if (attributeOf(child, 'type') !== variant || attributeOf(child, 'id') !== rId) return null;
  return withFreshIds(child, nextId);
}

function patchSectionFurniture(
  pkg: OoxmlPackage,
  sectionIndex: number,
  options: {
    readonly titlePage?: boolean;
    readonly headerDistanceTwips?: number;
    readonly footerDistanceTwips?: number;
  }
): OoxmlPackage | null {
  const main = pkg.parts.get(pkg.mainDocumentPart);
  if (!main) return null;
  const sectPrNodes = collectSectionPropertyNodes(main.root);
  if (sectionIndex >= sectPrNodes.length) return null;
  const nextId = createNodeIdAllocator(main);

  let target = sectPrNodes[sectionIndex];
  let working = main;
  if (!target) {
    const body = findBody(main.root);
    if (!body) return null;
    const minted = sectionElement(nextId(), 'sectPr', [], []);
    const inserted = insertChildren(main, body.id, body.children.length, [minted]);
    if (!inserted.ok) return null;
    working = inserted.part;
    const refreshed = collectSectionPropertyNodes(working.root);
    target = refreshed[sectionIndex] ?? null;
    if (!target) return null;
  }

  let children = [...target.children];
  if (options.titlePage !== undefined) {
    children = children.filter(
      (child) => child.kind === 'textValue' || child.localName !== 'titlePg'
    );
    if (options.titlePage) {
      const titlePg = sectionElement(nextId(), 'titlePg', [], []);
      children.splice(sectionInsertIndex(children, 'titlePg'), 0, titlePg);
    }
  }

  if (options.headerDistanceTwips !== undefined || options.footerDistanceTwips !== undefined) {
    const existing = children.find(
      (child): child is OoxmlElement => child.kind !== 'textValue' && child.localName === 'pgMar'
    );
    const attrs = new Map<string, string>();
    if (existing) {
      for (const attribute of existing.attributes) {
        attrs.set(attribute.localName, attribute.value);
      }
    }
    if (options.headerDistanceTwips !== undefined) {
      attrs.set('header', String(options.headerDistanceTwips));
    }
    if (options.footerDistanceTwips !== undefined) {
      attrs.set('footer', String(options.footerDistanceTwips));
    }
    // Ensure required margin attrs exist so a bare distance write is still valid pgMar.
    for (const name of ['top', 'right', 'bottom', 'left'] as const) {
      if (!attrs.has(name)) attrs.set(name, name === 'top' || name === 'bottom' ? '1440' : '1440');
    }
    const pgMar = sectionElement(
      existing?.id ?? nextId(),
      'pgMar',
      [...attrs.entries()].map(([localName, value]) => wmlAttribute(localName, value)),
      []
    );
    if (existing) {
      children = children.map((child) => (child.id === existing.id ? pgMar : child));
    } else {
      children.splice(sectionInsertIndex(children, 'pgMar'), 0, pgMar);
    }
  }

  const replaced = replaceChildren(working, target.id, children);
  if (!replaced.ok) return null;
  return withPart(pkg, replaced.part);
}

// ---------------------------------------------------------------------------
// settings.xml evenAndOddHeaders
// ---------------------------------------------------------------------------

function setEvenAndOddHeaders(pkg: OoxmlPackage, enabled: boolean): OoxmlPackage | null {
  const located = settingsPartForWrite(pkg);
  if (!located) return null;
  const { package: next, settings } = located;

  const nextId = createNodeIdAllocator(settings);
  let children = settings.root.children.filter(
    (child) => child.kind === 'textValue' || child.localName !== 'evenAndOddHeaders'
  );
  if (enabled) {
    const node = sectionElement(nextId(), 'evenAndOddHeaders', [], []);
    children = [...children, node];
  }
  const replaced = replaceChildren(settings, settings.root.id, children);
  if (!replaced.ok) return null;
  return withPart(next, replaced.part);
}

// ---------------------------------------------------------------------------
// GC
// ---------------------------------------------------------------------------

function countReferences(pkg: OoxmlPackage, rId: string): number {
  const main = pkg.parts.get(pkg.mainDocumentPart);
  if (!main) return 0;
  let count = 0;
  for (const sectPr of collectSectionPropertyNodes(main.root)) {
    if (!sectPr) continue;
    for (const child of sectPr.children) {
      if (child.kind === 'textValue') continue;
      if (child.localName !== 'headerReference' && child.localName !== 'footerReference') continue;
      if (attributeOf(child, 'id') === rId) count += 1;
    }
  }
  return count;
}

function garbageCollectStory(
  pkg: OoxmlPackage,
  rId: string,
  partName: string
): OoxmlPackage | null {
  // `withoutPart` finds every relationship whose target resolves to the part, across every
  // owner, so it covers this `rId` and any duplicate reference the old id-only removal left
  // behind. It is also the one deletion primitive the journal records, so a story removed
  // here replicates instead of surviving on the peer.
  void rId;
  const removed = withoutPart(pkg, partName);
  if (!removed.ok) return null;
  return removed.pkg;
}

// ---------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------

function attributeOf(node: OoxmlNode, localName: string): string | undefined {
  if (node.kind === 'textValue' || !('attributes' in node)) return undefined;
  return node.attributes.find((attribute) => attribute.localName === localName)?.value;
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

/**
 * `CT_SectPr` sequence from `pgSz` onward. Header/footer references precede this list and
 * insert at index 0 among non-reference siblings.
 */
const SECT_PR_SEQUENCE = [
  'pgSz',
  'pgMar',
  'paperSrc',
  'pgBorders',
  'lnNumType',
  'pgNumType',
  'cols',
  'formProt',
  'vAlign',
  'noEndnote',
  'titlePg',
  'textDirection',
  'bidi',
  'rtlGutter',
  'docGrid',
  'printerSettings',
  'sectPrChange',
] as const;

function sectionInsertIndex(children: readonly OoxmlNode[], localName: string): number {
  const rank = SECT_PR_SEQUENCE.indexOf(localName as (typeof SECT_PR_SEQUENCE)[number]);
  if (rank === -1) return children.length;
  const later = new Set(SECT_PR_SEQUENCE.slice(rank + 1));
  const before = children.findIndex(
    (child) =>
      child.kind !== 'textValue' &&
      'localName' in child &&
      later.has(child.localName as (typeof SECT_PR_SEQUENCE)[number])
  );
  return before === -1 ? children.length : before;
}
