// Pure package edits: add a part, add a relationship, add a content-type override.
//
// A part-level edit is not enough for anything that introduces a NEW part. A comment write
// creates `comments.xml`, points a relationship at it, and declares its content type; a
// package missing any one of those does not open. So these three belong together, behind one
// transaction, and each is pure in the same way the tree edits are: a new package, structurally
// shared with the old one, and the input untouched.
//
// `[Content_Types].xml` and the `.rels` parts are edited as TREES, never regenerated from the
// parsed index. The index case-folds part names and collapses duplicate defaults, so writing it
// back out would rewrite entries nobody touched. Editing the tree leaves every authored byte of
// every other entry exactly as it was.

import {
  buildContentTypeIndex,
  resolveContentType,
  type ContentTypeIndex,
} from './content-types.ts';
import { insertChildren, replaceChildren } from './ooxml-edit.ts';
import { normalizePartName, partNameKey, resolveInternalTarget } from './opc-names.ts';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlAttribute,
  type OoxmlElement,
  type OoxmlGenericElementNode,
  type OoxmlNode,
  type OoxmlPart,
} from './ooxml-tree.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import { withPart } from './ooxml-package.ts';
import type { RelationshipRecord } from './relationships.ts';
import {
  MAX_RELATIONSHIP_NUMBER,
  nextStripedDecimalId,
  relationshipIdFromNumber,
  relationshipNumberOf,
  resolveAllocationActor,
  stripedDecimalIdSequence,
} from './actor-scoped-ids.ts';
import {
  isCanonicalPrimitiveCaptureActive,
  recordDeleteContentTypeOverride,
  recordDeleteXmlPart,
  recordPutContentTypeOverride,
  recordPutRelationship,
  runWithoutJournalCapture,
} from './canonical-primitive-capture.ts';

/** The OPC content-types part, which every package has exactly one of. */
const CONTENT_TYPES_PART = '/[Content_Types].xml';
const CONTENT_TYPES_NAMESPACE = 'http://schemas.openxmlformats.org/package/2006/content-types';
const RELATIONSHIPS_NAMESPACE = 'http://schemas.openxmlformats.org/package/2006/relationships';
const RELATIONSHIPS_TYPE = 'application/vnd.openxmlformats-package.relationships+xml';

function contentTypesEntryOf(
  partBytes: ReadonlyMap<string, Uint8Array>
): { readonly storageKey: string; readonly bytes: Uint8Array } | null {
  for (const [name, bytes] of partBytes) {
    const normalized = normalizePartName(name);
    if (normalized.ok && partNameKey(normalized.partName) === partNameKey(CONTENT_TYPES_PART)) {
      return { storageKey: name, bytes };
    }
  }
  return null;
}

/** Locate `[Content_Types].xml` bytes regardless of zip key spelling. */
export function contentTypesPartBytes(
  pkg: OoxmlPackage
): { readonly storageKey: string; readonly bytes: Uint8Array } | null {
  return contentTypesEntryOf(pkg.partBytes);
}

/**
 * What a package-level invariant walk found wrong.
 *
 * Package invariants are cross-PART: a relationship pointing at a part that does not exist, or a
 * part no content-type record covers. Neither is visible from inside a single part's tree.
 */
export type PackageInvariantCode =
  | 'dangling-relationship'
  | 'missing-content-type'
  /** A part occupies a name OPC reserves for package infrastructure. */
  | 'reserved-part-name'
  /** Two parts whose names differ only by case, which OPC treats as one part. */
  | 'duplicate-part-name'
  /** A part name the OPC screens refuse; `writeZip` would throw on save. */
  | 'unsafe-part-name';

/** One package invariant violation, located by part name and relationship id. */
export interface PackageInvariantIssue {
  readonly code: PackageInvariantCode;
  /** The part the issue is about: the missing target, or the part with no type. */
  readonly partName: string;
  /** For a dangling relationship, the owner that points at nothing. */
  readonly ownerPart?: string;
}

/** Whether a package satisfies its cross-part invariants, listing every violation otherwise. */
export type PackageInvariantResult =
  { readonly ok: true } | { readonly ok: false; readonly issues: readonly PackageInvariantIssue[] };

/** Relationship records owned by one part, in authored order. */
export function relationshipsOf(
  pkg: OoxmlPackage,
  ownerPart: string
): readonly RelationshipRecord[] {
  return pkg.relationships.get(ownerPart) ?? [];
}

/** The content type that resolves for a part name, or null when nothing declares one. */
export function resolveContentTypeOf(pkg: OoxmlPackage, partName: string): string | null {
  const resolved = resolveContentType(pkg.contentTypes, partName);
  return resolved.ok ? resolved.contentType : null;
}

/** The `.rels` part that owns a part's relationships, by OPC convention. */
export function relsPartNameFor(partName: string): string {
  const slash = partName.lastIndexOf('/');
  const directory = partName.slice(0, slash);
  const file = partName.slice(slash + 1);
  return `${directory}/_rels/${file}.rels`;
}

function element(
  id: string,
  namespaceUri: string,
  localName: string,
  attributes: Readonly<Record<string, string>>,
  bindings: readonly { prefix: string; namespaceUri: string }[] = []
): OoxmlElement {
  return {
    id,
    kind: 'generic',
    namespaceUri,
    localName,
    namespaceBindings: bindings,
    attributes: Object.entries(attributes).map(([name, value]) => ({
      kind: 'genericExtension' as const,
      namespaceUri: '',
      localName: name,
      value,
    })),
    children: [],
  } as OoxmlElement;
}

/**
 * Part names no edit may ever create or replace.
 *
 * `[Content_Types].xml` and the `.rels` parts are package INFRASTRUCTURE, not content. They are
 * held as bytes and as trees respectively, and `writeOoxmlPackage` writes `parts` over
 * `partBytes` — so creating a "part" at one of those names replaces the real one on save. A
 * document that lost its content types still loads, resolves every part to no type, and opens
 * with zero trees: the user adds a comment, saves, reopens, and the document is empty with
 * nothing anywhere reporting an error.
 *
 * The names are attacker-reachable because a part name can come from a relationship target in
 * the file, and `resolveInternalTarget` will happily resolve `../[Content_Types].xml`.
 */
function isReservedForCreation(canonical: string): boolean {
  const key = partNameKey(canonical);
  return key === partNameKey(CONTENT_TYPES_PART) || /\/_rels\/[^/]*\.rels$/.test(key);
}

/**
 * The narrower check the COMMIT boundary applies.
 *
 * `.rels` parts are legitimately modelled as trees in `pkg.parts` — that is how a relationship
 * gets added at all — so flagging them here would reject every real package. Only
 * `[Content_Types].xml` must never appear as a tree: it is held as bytes, and a tree at that
 * name would be serialized over the real one on save.
 */
function isReservedAsTree(canonical: string): boolean {
  return partNameKey(canonical) === partNameKey(CONTENT_TYPES_PART);
}

/**
 * True when the package already holds a part OPC considers the same name.
 *
 * `partBytes` as well as `parts`: only parts whose content type resolves to something XML-ish
 * become trees, so a part declared `image/svg+xml` — or one with no declared type at all —
 * exists solely as bytes. Creating "a new part" over one of those destroys it on save, because
 * `writeOoxmlPackage` writes trees over bytes.
 */
function hasEquivalentPart(pkg: OoxmlPackage, canonical: string): boolean {
  const key = partNameKey(canonical);
  for (const name of pkg.parts.keys()) if (partNameKey(name) === key) return true;
  for (const name of pkg.partBytes.keys()) if (partNameKey(name) === key) return true;
  return false;
}

/**
 * A part name an edit is allowed to write, or null.
 *
 * Fail CLOSED where `normalizePartName` refuses: its `unsafe-key` screen exists to keep
 * `__proto__`-style segments out of the part map, and falling back to the raw name defeats it
 * — the name then survives into the package and `writeZip` throws on save, which strands the
 * session with unsaveable work.
 */
function writablePartName(canonical: string): string | null {
  const normalized = normalizePartName(canonical);
  if (!normalized.ok) return null;
  if (isReservedForCreation(normalized.partName)) return null;
  return normalized.partName;
}

/** A node id that cannot collide with a structural-path id in the target part. */
function mintedId(part: OoxmlPart, hint: string): string {
  return `${part.name}#minted-${hint}`;
}

function readUnqualifiedGenericAttribute(node: OoxmlNode, localName: string): string | undefined {
  if (node.kind === 'textValue') return undefined;
  return node.attributes.find(
    (attribute) => attribute.localName === localName && attribute.namespaceUri === ''
  )?.value;
}

function isContentTypeOverrideNode(node: OoxmlNode, canonical: string): boolean {
  if (node.kind !== 'generic') return false;
  if (node.namespaceUri !== CONTENT_TYPES_NAMESPACE || node.localName !== 'Override') return false;
  const partName = readUnqualifiedGenericAttribute(node, 'PartName');
  const contentType = readUnqualifiedGenericAttribute(node, 'ContentType');
  return (
    partName !== undefined &&
    contentType !== undefined &&
    partNameKey(partName) === partNameKey(canonical)
  );
}

function withGenericAttributeValue(
  node: OoxmlGenericElementNode,
  localName: string,
  value: string
): OoxmlGenericElementNode {
  return {
    ...node,
    attributes: node.attributes.map((attribute) =>
      attribute.localName === localName && attribute.namespaceUri === ''
        ? ({ ...attribute, value } satisfies OoxmlAttribute)
        : attribute
    ),
  };
}

function upsertContentTypeOverrideChildren(
  part: OoxmlPart,
  canonical: string,
  contentType: string
): { readonly part: OoxmlPart; readonly changed: boolean } {
  const root = part.root;
  if (root.kind !== 'generic') return { part, changed: false };

  let matched = false;
  let changed = false;
  const nextChildren: OoxmlNode[] = [];

  for (const child of root.children) {
    if (!isContentTypeOverrideNode(child, canonical)) {
      nextChildren.push(child);
      continue;
    }
    if (matched) {
      changed = true;
      continue;
    }
    matched = true;
    if (child.kind !== 'generic') continue;
    const existingType = readUnqualifiedGenericAttribute(child, 'ContentType');
    if (existingType === contentType) {
      nextChildren.push(child);
      continue;
    }
    changed = true;
    nextChildren.push(withGenericAttributeValue(child, 'ContentType', contentType));
  }

  if (!matched) {
    changed = true;
    nextChildren.push(
      element(mintedId(part, `override-${canonical}`), CONTENT_TYPES_NAMESPACE, 'Override', {
        PartName: canonical,
        ContentType: contentType,
      })
    );
  }

  if (!changed) return { part, changed: false };
  const replaced = runWithoutJournalCapture(() =>
    replaceChildren(part, root.id, nextChildren, { deferValidation: true })
  );
  if (!replaced.ok) return { part, changed: false };
  return { part: replaced.part, changed: true };
}

/**
 * Declare a content type for a part, by upserting an `<Override>` in the content-types tree.
 *
 * A no-op when the part already resolves to the same type, so repeating a write does not append
 * a duplicate entry. Resolving to a DIFFERENT type replaces the existing Override in place.
 * `forceOverride` writes an explicit Override even when a Default already matches.
 */
export function withContentTypeOverride(
  pkg: OoxmlPackage,
  partName: string,
  contentType: string,
  options?: { readonly forceOverride?: boolean }
): OoxmlPackage {
  const canonical = writablePartName(partName);
  if (canonical === null) return pkg;
  const overrideKey = partNameKey(canonical);
  if (!options?.forceOverride) {
    if (resolveContentTypeOf(pkg, canonical) === contentType) return pkg;
  } else if (pkg.contentTypes.overrides.get(overrideKey) === contentType) {
    const contentTypesEntry = contentTypesEntryOf(pkg.partBytes);
    if (contentTypesEntry !== null) {
      const parsed = readOoxmlPart(new TextDecoder().decode(contentTypesEntry.bytes), {
        name: CONTENT_TYPES_PART,
        contentType: 'application/xml',
      });
      if (parsed.ok) {
        const upserted = upsertContentTypeOverrideChildren(parsed.part, canonical, contentType);
        if (!upserted.changed) return pkg;
      }
    }
  }

  const contentTypesEntry = contentTypesEntryOf(pkg.partBytes);
  if (contentTypesEntry === null) return pkg;
  const parsed = readOoxmlPart(new TextDecoder().decode(contentTypesEntry.bytes), {
    name: CONTENT_TYPES_PART,
    contentType: 'application/xml',
  });
  if (!parsed.ok) return pkg;

  const upserted = upsertContentTypeOverrideChildren(parsed.part, canonical, contentType);
  if (!upserted.changed) return pkg;

  const overrides = new Map(pkg.contentTypes.overrides);
  overrides.set(overrideKey, contentType);
  const partBytes = new Map(pkg.partBytes);
  partBytes.set(
    contentTypesEntry.storageKey,
    new TextEncoder().encode(serializeOoxmlPart(upserted.part))
  );
  const next = Object.freeze({
    ...pkg,
    partBytes,
    contentTypes: { defaults: pkg.contentTypes.defaults, overrides } satisfies ContentTypeIndex,
  });
  recordPutContentTypeOverride(canonical, contentType);
  return next;
}

/**
 * Declare content types for MANY parts in one content-types tree edit — the batched twin
 * of {@link withContentTypeOverride}. A per-part call re-parses and re-serializes the whole
 * `[Content_Types].xml` each time, which is quadratic when a paste installs thousands of
 * media parts; this indexes, edits, and serializes the children once.
 */
export function withContentTypeOverrides(
  pkg: OoxmlPackage,
  entries: ReadonlyArray<readonly [partName: string, contentType: string]>
): OoxmlPackage {
  if (entries.length === 0) return pkg;
  const contentTypesEntry = contentTypesEntryOf(pkg.partBytes);
  if (contentTypesEntry === null) return pkg;
  const parsed = readOoxmlPart(new TextDecoder().decode(contentTypesEntry.bytes), {
    name: CONTENT_TYPES_PART,
    contentType: 'application/xml',
  });
  if (!parsed.ok) return pkg;

  const part = parsed.part;
  const root = part.root;
  if (root.kind !== 'generic') return pkg;
  const requests: Array<readonly [string, string, string]> = [];
  const wanted = new Set<string>();
  for (const [partName, contentType] of entries) {
    const canonical = writablePartName(partName);
    if (canonical === null) continue;
    const key = partNameKey(canonical);
    requests.push([canonical, key, contentType]);
    wanted.add(key);
  }
  if (requests.length === 0) return pkg;

  // Keep the first matching node in place. Remove only requested duplicates.
  const children: OoxmlNode[] = [];
  const positions = new Map<string, number>();
  const duplicates = new Set<string>();
  for (const child of root.children) {
    const name = readUnqualifiedGenericAttribute(child, 'PartName');
    const key = name === undefined ? undefined : partNameKey(name);
    if (
      name !== undefined &&
      key !== undefined &&
      wanted.has(key) &&
      isContentTypeOverrideNode(child, name)
    ) {
      if (positions.has(key)) {
        duplicates.add(key);
        continue;
      }
      positions.set(key, children.length);
    }
    children.push(child);
  }

  const overrides = new Map(pkg.contentTypes.overrides);
  const capture = isCanonicalPrimitiveCaptureActive();
  const recorded: Array<readonly [string, string]> = [];
  let changed = false;
  for (const [canonical, key, contentType] of requests) {
    const position = positions.get(key);
    if (position === undefined) {
      positions.set(key, children.length);
      children.push(
        element(mintedId(part, `override-${canonical}`), CONTENT_TYPES_NAMESPACE, 'Override', {
          PartName: canonical,
          ContentType: contentType,
        })
      );
    } else {
      const child = children[position] as OoxmlGenericElementNode;
      const removedDuplicates = duplicates.delete(key);
      if (readUnqualifiedGenericAttribute(child, 'ContentType') === contentType) {
        if (!removedDuplicates) continue;
      } else {
        children[position] = withGenericAttributeValue(child, 'ContentType', contentType);
      }
    }
    overrides.set(key, contentType);
    changed = true;
    if (capture) recorded.push([canonical, contentType]);
  }
  if (!changed) return pkg;

  const replaced = runWithoutJournalCapture(() =>
    replaceChildren(part, root.id, children, { deferValidation: true })
  );
  if (!replaced.ok) return pkg;
  const partBytes = new Map(pkg.partBytes);
  partBytes.set(
    contentTypesEntry.storageKey,
    new TextEncoder().encode(serializeOoxmlPart(replaced.part))
  );
  const next = Object.freeze({
    ...pkg,
    partBytes,
    contentTypes: { defaults: pkg.contentTypes.defaults, overrides } satisfies ContentTypeIndex,
  });
  if (capture) {
    for (const [partName, mediaType] of recorded) {
      recordPutContentTypeOverride(partName, mediaType);
    }
  }
  return next;
}

/**
 * Append MANY relationships to one owner part in a single `.rels` tree edit — the batched
 * twin of {@link withRelationship}. Returns the fresh ids in request order.
 */
export function withRelationships(
  pkg: OoxmlPackage,
  ownerPart: string,
  requests: ReadonlyArray<readonly [type: string, rawTarget: string]>
): { readonly pkg: OoxmlPackage; readonly ids: readonly string[]; readonly ok: boolean } {
  if (requests.length === 0) return { pkg, ids: [], ok: true };
  const relsName = relsPartNameFor(ownerPart);
  const relsPart = pkg.parts.get(relsName);
  if (!relsPart) return { pkg, ids: [], ok: false };

  const used = new Set(relationshipIdsForOwner(pkg, ownerPart));
  let next = 1;
  for (const id of used) {
    const match = /^rId(\d+)$/.exec(id);
    if (match) next = Math.max(next, Number(match[1]) + 1);
  }
  // With a collaborator bound, ids come from that actor's stripe, so two people adding
  // relationships to one part from one snapshot do not mint the same `rId`.
  const actor = resolveAllocationActor();
  const striped =
    actor === undefined
      ? null
      : stripedDecimalIdSequence(
          new Set(
            [...used].flatMap((id) => {
              const value = relationshipNumberOf(id);
              return value === null ? [] : [String(value)];
            })
          ),
          actor,
          MAX_RELATIONSHIP_NUMBER
        );
  const existing = relationshipsOf(pkg, ownerPart);
  const ids: string[] = [];
  const records: OoxmlNode[] = [];
  const added: RelationshipRecord[] = [];
  requests.forEach(([type, rawTarget], index) => {
    const stripedNumber = striped?.() ?? null;
    let id = stripedNumber !== null ? `rId${stripedNumber}` : `rId${next++}`;
    while (used.has(id)) id = `rId${next++}`;
    used.add(id);
    ids.push(id);
    records.push(
      element(mintedId(relsPart, `${id}-${index}`), RELATIONSHIPS_NAMESPACE, 'Relationship', {
        Id: id,
        Type: type,
        Target: rawTarget,
      })
    );
    added.push({
      ownerPart,
      id,
      type,
      rawTarget,
      targetMode: 'Internal',
      order: existing.length + index,
    });
  });

  const result = runWithoutJournalCapture(() => {
    const appended = insertChildren(
      relsPart,
      relsPart.root.id,
      relsPart.root.children.length,
      records,
      {
        deferValidation: true,
      }
    );
    if (!appended.ok) return { pkg, ids: [] as readonly string[], ok: false as const };
    const relationships = new Map(pkg.relationships);
    relationships.set(ownerPart, [...existing, ...added]);
    return {
      pkg: Object.freeze({ ...withPart(pkg, appended.part), relationships }),
      ids,
      ok: true as const,
    };
  });
  if (result.ok && result.pkg !== pkg && isCanonicalPrimitiveCaptureActive()) {
    for (const record of added) {
      recordPutRelationship(ownerPart, record);
    }
  }
  return result;
}

/** What {@link withoutPart} answers: `ok: false` leaves the package exactly as it was. */
export interface WithoutPartResult {
  readonly pkg: OoxmlPackage;
  readonly ok: boolean;
}

/**
 * Remove a part, its `.rels`, its content-type Override, and every relationship naming it.
 *
 * Deleting the tree alone is not deleting the part. The bytes it was loaded from would be
 * written back out, the Override would still name it in `[Content_Types].xml`, and the owner's
 * `.rels` would still point at it — so a caller stripping something out of a document for
 * export would leave three separate records saying it had been there.
 */
export function withoutPart(pkg: OoxmlPackage, partName: string): WithoutPartResult {
  const canonical = normalizePartName(partName);
  if (!canonical.ok) return { pkg, ok: false };
  const key = partNameKey(canonical.partName);
  const relsKey = partNameKey(relsPartNameFor(canonical.partName));

  // Every owner whose relationships name the part, and the ids to drop from each.
  const removedIds = new Map<string, Set<string>>();
  for (const [owner, records] of pkg.relationships) {
    const naming = records.filter((record) => {
      if (record.targetMode === 'External') return false;
      const resolved = resolveInternalTarget(owner, record.rawTarget);
      return resolved.ok && partNameKey(resolved.partName) === key;
    });
    if (naming.length > 0) removedIds.set(owner, new Set(naming.map((record) => record.id)));
  }

  // Refuse rather than half-remove. An owner whose `.rels` was never parsed into a tree —
  // a package omitting `Default Extension="rels"` still loads that way — has its records here
  // and its markup only in `partBytes`, which `writeOoxmlPackage` writes back out untouched.
  // Dropping the record alone leaves the saved file pointing at a part that is gone, and
  // `validatePackageInvariants` sees a clean model, so nothing anywhere reports it.
  for (const owner of removedIds.keys()) {
    if (!pkg.parts.has(relsPartNameFor(owner))) return { pkg, ok: false };
  }

  const result = runWithoutJournalCapture(() =>
    removePartFromPackage(pkg, canonical.partName, key, relsKey, removedIds)
  );
  if (result.ok && result.pkg !== pkg) recordDeleteXmlPart(canonical.partName);
  return result;
}

function removePartFromPackage(
  pkg: OoxmlPackage,
  partName: string,
  key: string,
  relsKey: string,
  removedIds: ReadonlyMap<string, ReadonlySet<string>>
): WithoutPartResult {
  const parts = new Map(pkg.parts);
  const partBytes = new Map(pkg.partBytes);
  for (const map of [parts, partBytes] as Map<string, unknown>[]) {
    for (const name of [...map.keys()]) {
      const named = partNameKey(name);
      if (named === key || named === relsKey) map.delete(name);
    }
  }

  const relationships = new Map(pkg.relationships);
  relationships.delete(partName);
  for (const [owner, ids] of removedIds) {
    const records = relationships.get(owner) ?? [];
    relationships.set(
      owner,
      records.filter((record) => !ids.has(record.id))
    );
    const ownerRels = parts.get(relsPartNameFor(owner));
    if (!ownerRels) continue;
    // Remove the matched elements BY ID rather than keeping an allowlist: a `<Relationship>`
    // the reader could not index — no `Id`, or one it dropped — is not ours to delete because
    // an unrelated part was removed.
    const children = ownerRels.root.children.filter((child) => {
      const id = relationshipIdAttribute(child);
      return id === undefined || !ids.has(id);
    });
    const rewritten = replaceChildren(ownerRels, ownerRels.root.id, children);
    // The tree is the file. If it cannot be rewritten, the whole removal is off.
    if (!rewritten.ok) return { pkg, ok: false };
    parts.set(rewritten.part.name, rewritten.part);
  }

  // External-target metadata is keyed by owner, so a removed part leaves records naming a part
  // that no longer exists, and callers branch on those.
  const externalTargets = pkg.externalTargets.filter(
    (target) => partNameKey(target.ownerPart) !== key
  );

  const next: OoxmlPackage = Object.freeze({
    ...pkg,
    parts,
    partBytes,
    relationships,
    externalTargets,
  });
  return { pkg: withoutContentTypeOverride(next, partName), ok: true };
}

/** Drop a part's Override, which otherwise names a part that is no longer in the package. */
function withoutContentTypeOverride(pkg: OoxmlPackage, partName: string): OoxmlPackage {
  const overrideKey = partNameKey(partName);
  if (!pkg.contentTypes.overrides.has(overrideKey)) return pkg;
  const entry = contentTypesEntryOf(pkg.partBytes);
  if (entry === null) return pkg;
  const parsed = readOoxmlPart(new TextDecoder().decode(entry.bytes), {
    name: CONTENT_TYPES_PART,
    contentType: 'application/xml',
  });
  if (!parsed.ok) return pkg;
  const children = parsed.part.root.children.filter((child) => {
    if (
      child.kind === 'textValue' ||
      child.namespaceUri !== CONTENT_TYPES_NAMESPACE ||
      child.localName !== 'Override'
    )
      return true;
    const named = child.attributes.find((a) => a.namespaceUri === '' && a.localName === 'PartName');
    return named === undefined || partNameKey(named.value) !== overrideKey;
  });
  if (children.length === parsed.part.root.children.length) return pkg;
  const rewritten = runWithoutJournalCapture(() =>
    replaceChildren(parsed.part, parsed.part.root.id, children)
  );
  if (!rewritten.ok) return pkg;

  const overrides = new Map(pkg.contentTypes.overrides);
  overrides.delete(overrideKey);
  const partBytes = new Map(pkg.partBytes);
  partBytes.set(entry.storageKey, new TextEncoder().encode(serializeOoxmlPart(rewritten.part)));
  const next = Object.freeze({
    ...pkg,
    partBytes,
    contentTypes: { defaults: pkg.contentTypes.defaults, overrides } satisfies ContentTypeIndex,
  });
  recordDeleteContentTypeOverride(partName);
  return next;
}

/**
 * Point a relationship from one part at another, minting an unused `rId`.
 *
 * Returns the id as well as the package: the story that references a new part has to write that
 * id into its own markup, and inventing it separately would risk the two disagreeing.
 */
function relationshipIdAttribute(node: OoxmlNode): string | undefined {
  if (node.kind === 'textValue' || !('attributes' in node)) return undefined;
  return node.attributes.find(
    (attribute) => attribute.localName === 'Id' && attribute.namespaceUri === ''
  )?.value;
}

/** Every `Id` on an owner's `.rels` tree, including external relationships. */
export function relationshipIdsForOwner(pkg: OoxmlPackage, ownerPart: string): ReadonlySet<string> {
  const used = new Set(relationshipsOf(pkg, ownerPart).map((record) => record.id));
  const relsPart = pkg.parts.get(relsPartNameFor(ownerPart));
  if (relsPart) {
    const walk = (node: OoxmlNode): void => {
      if (node.kind !== 'textValue' && node.localName === 'Relationship') {
        const id = relationshipIdAttribute(node);
        if (id !== undefined && id.length > 0) used.add(id);
      }
      if (node.kind === 'textValue') return;
      for (const child of node.children) walk(child);
    };
    walk(relsPart.root);
  }
  return used;
}

/** First unused `rIdN` on one owner part — collision-safe against internal and external ids. */
export function allocateOwnerRelationshipId(pkg: OoxmlPackage, ownerPart: string): string {
  const used = relationshipIdsForOwner(pkg, ownerPart);
  const actor = resolveAllocationActor();
  if (actor) {
    const numbers = new Set<string>();
    for (const id of used) {
      const value = relationshipNumberOf(id);
      if (value !== null) numbers.add(String(value));
    }
    return relationshipIdFromNumber(
      Number(nextStripedDecimalId(numbers, actor, MAX_RELATIONSHIP_NUMBER))
    );
  }
  let max = 0;
  for (const id of used) {
    const match = /^rId(\d+)$/.exec(id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  let next = max + 1;
  while (used.has(`rId${next}`)) next += 1;
  return `rId${next}`;
}

/**
 * Give a part an empty `.rels` of its own, so {@link withRelationship} has somewhere to write.
 *
 * A part created in this session has no relationships part, and neither primitive can produce
 * one: `withNewPart` refuses `.rels` names outright (they are not ordinary content), and
 * `withRelationship` refuses an owner that has none rather than guessing. That leaves a new
 * part unable to point at anything — which a custom XML store has to do, since its properties
 * are reachable only through its own relationship.
 *
 * Idempotent, and deliberately narrow: it mints the empty `<Relationships/>` tree and nothing
 * else. The content type comes from `Default Extension="rels"`, which every real package
 * declares. A package missing that default cannot be helped here — `withContentTypeOverride`
 * refuses `.rels` names for the same reason `withNewPart` does — so the part ships with no
 * resolvable type rather than with an override this pretends to add.
 */
export function withRelationshipsPartFor(pkg: OoxmlPackage, ownerPart: string): OoxmlPackage {
  const canonical = normalizePartName(ownerPart);
  if (!canonical.ok) return pkg;
  const relsName = relsPartNameFor(canonical.partName);
  if (pkg.parts.has(relsName)) return pkg;
  // Held as bytes rather than as a tree — a package whose `rels` content type does not resolve
  // still loads that way. Minting an empty tree here would be serialized OVER those bytes on
  // save, destroying relationships `pkg.relationships` still lists, so the model and the file
  // would disagree with nothing reporting it. Fail closed and let the caller refuse.
  for (const name of pkg.partBytes.keys()) {
    if (partNameKey(name) === partNameKey(relsName)) return pkg;
  }
  // Bind the namespace to the DEFAULT prefix, as every `.rels` Word writes does. Without the
  // binding the serializer has no prefix to reach for and invents one, so this part alone would
  // come out as `<ns1:Relationships xmlns:ns1="…">` while every sibling `.rels` in the same
  // package is `<Relationships xmlns="…">`. Equivalent to a namespace-aware reader, and a
  // gratuitous difference on the part type most likely to meet one that is not.
  const root = element(`${relsName}#root`, RELATIONSHIPS_NAMESPACE, 'Relationships', {}, [
    { prefix: '', namespaceUri: RELATIONSHIPS_NAMESPACE },
  ]);
  const part: OoxmlPart = { id: relsName, name: relsName, contentType: RELATIONSHIPS_TYPE, root };
  return withPart(pkg, part);
}

/** Add or replace one relationship on a part, returning a new package. */
export function withRelationship(
  pkg: OoxmlPackage,
  ownerPart: string,
  type: string,
  rawTarget: string
): { readonly pkg: OoxmlPackage; readonly relationshipId: string; readonly ok: boolean } {
  const existing = relationshipsOf(pkg, ownerPart);
  const relationshipId = allocateOwnerRelationshipId(pkg, ownerPart);

  const relsName = relsPartNameFor(ownerPart);
  const relsPart = pkg.parts.get(relsName);
  // A package whose `.rels` parts are not modelled as trees — one omitting the `rels` content
  // default, which still loads because relationships are read from the zip entries — cannot
  // gain a relationship here. Reporting it is the point: writing the comment body and the
  // story markers with nothing pointing at the part leaves a reference Word repairs away, and
  // a silent identity return is indistinguishable from "no work needed".
  if (!relsPart) return { pkg, relationshipId, ok: false };

  const result = runWithoutJournalCapture(() =>
    appendRelationship(pkg, ownerPart, type, rawTarget, existing, relationshipId, relsPart)
  );
  if (result.ok && result.pkg !== pkg) {
    const records = result.pkg.relationships.get(ownerPart) ?? [];
    const record = records.find((entry) => entry.id === result.relationshipId);
    if (record) recordPutRelationship(ownerPart, record);
  }
  return result;
}

function appendRelationship(
  pkg: OoxmlPackage,
  ownerPart: string,
  type: string,
  rawTarget: string,
  existing: readonly RelationshipRecord[],
  relationshipId: string,
  relsPart: OoxmlPart
): { readonly pkg: OoxmlPackage; readonly relationshipId: string; readonly ok: boolean } {
  const record = element(
    mintedId(relsPart, relationshipId),
    RELATIONSHIPS_NAMESPACE,
    'Relationship',
    { Id: relationshipId, Type: type, Target: rawTarget }
  );
  const appended = insertChildren(
    relsPart,
    relsPart.root.id,
    relsPart.root.children.length,
    [record],
    { deferValidation: true }
  );
  if (!appended.ok) return { pkg, relationshipId, ok: false };

  const relationships = new Map(pkg.relationships);
  relationships.set(ownerPart, [
    ...existing,
    {
      ownerPart,
      id: relationshipId,
      type,
      rawTarget,
      targetMode: 'Internal',
      order: existing.length,
    },
  ]);
  return {
    pkg: Object.freeze({ ...withPart(pkg, appended.part), relationships }),
    relationshipId,
    ok: true,
  };
}

/**
 * Add a part that does not exist yet, with the content-type override it needs to be openable.
 *
 * Deliberately does NOT create a relationship: a part is reachable because something points at
 * it, and which part points at it is the caller's decision. Creating one here would guess.
 */
export function withNewPart(
  pkg: OoxmlPackage,
  partName: string,
  root: OoxmlElement,
  contentType: string
): OoxmlPackage {
  const canonical = writablePartName(partName);
  // Refusing by returning the package unchanged keeps the primitive pure, and the caller sees
  // it as "nothing to do". The transaction that wanted the part then fails its own invariant
  // check rather than publishing a package with a story pointing at a part nobody created.
  if (canonical === null) return pkg;
  // OPC part names are case-insensitive, so a `Comments.xml` beside `comments.xml` is a
  // DUPLICATE, and `writeZip` refuses the whole package on save — after the transaction has
  // already committed, which strands the session.
  if (hasEquivalentPart(pkg, canonical)) return pkg;
  const part: OoxmlPart = { id: canonical, name: canonical, contentType, root };
  return withContentTypeOverride(withPart(pkg, part), canonical, contentType);
}

/** Resolve a relationship's target to a canonical part name, or null when it is not internal. */
function targetPartName(record: RelationshipRecord): string | null {
  if (record.targetMode === 'External') return null;
  const resolved = resolveInternalTarget(record.ownerPart, record.rawTarget);
  return resolved.ok ? resolved.partName : null;
}

/**
 * The two invariants a package must satisfy before it is published.
 *
 * Both describe the half-written state that splitting a multi-part write across transactions
 * produces, and both make a package Word refuses to open:
 *
 *  - a relationship pointing at a part nobody created;
 *  - a part with no content type, which is unopenable even though the XML is well formed.
 *
 * Checked at the commit boundary rather than inside each primitive, for the same reason part
 * validation moved there: a transaction is allowed to pass through an inconsistent intermediate
 * as long as nothing can observe it.
 */
export function validatePackageInvariants(pkg: OoxmlPackage): PackageInvariantResult {
  const issues: PackageInvariantIssue[] = [];

  for (const [ownerPart, records] of pkg.relationships) {
    for (const record of records) {
      const target = targetPartName(record);
      if (target === null) continue;
      if (pkg.parts.has(target) || pkg.partBytes.has(target)) continue;
      issues.push({ code: 'dangling-relationship', partName: target, ownerPart });
    }
  }

  const seen = new Map<string, string>();
  for (const name of pkg.parts.keys()) {
    if (resolveContentTypeOf(pkg, name) === null) {
      issues.push({ code: 'missing-content-type', partName: name });
    }
    // The same three screens `writablePartName` applies, re-run at the commit boundary. A
    // primitive can be bypassed; this is what nothing gets published without.
    if (isReservedAsTree(name)) issues.push({ code: 'reserved-part-name', partName: name });
    if (!normalizePartName(name).ok) issues.push({ code: 'unsafe-part-name', partName: name });
    const key = partNameKey(name);
    const previous = seen.get(key);
    if (previous !== undefined) {
      issues.push({ code: 'duplicate-part-name', partName: name, ownerPart: previous });
    } else {
      seen.set(key, name);
    }
  }

  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

/** Rebuild the content-type index from records, for callers that parsed their own. */
export { buildContentTypeIndex };

/** Nodes of a part, for callers that need to walk one without importing the tree module. */
export type PackageNode = OoxmlNode;
