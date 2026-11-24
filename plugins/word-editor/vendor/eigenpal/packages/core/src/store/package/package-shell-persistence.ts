// Session-persistent package shell resources across historical package snapshot installs.
//
// Numbering definitions and hyperlink relationships are minted outside tree history
// (`replacePackageShell`). Lifecycle undo/redo restores full package snapshots that may
// predate those writes. Replaying the snapshot alone would drop the shell resources while
// a later story redo restores `w:numId` / `r:id` references — dead ids.
//
// Furniture and notes lifecycle parts stay snapshot-owned: undo must remove them. Only
// hyperlinks recorded as shell-minted (via {@link rememberShellHyperlinks} on
// `replacePackageShell`) are re-applied onto snapshots — parked when the owner part is
// temporarily absent — so a later lifecycle+story redo cannot leave a dangling `r:id`.
// Lifecycle-cloned owned relationships (unlink) travel inside package history snapshots and
// must GC with the orphan part; merging every live external would incorrectly resurrect
// those clone `.rels`. {@link pruneUnreachableHyperlinkShell} drops parked shell entries
// once no live part and no package/story history can restore the owner. Only monotonic
// shell resources (numbering part + shell hyperlink externals) are re-applied, and only
// when their relationship ids do not collide with internals the snapshot already declares.

import { strFromU8, strToU8 } from 'fflate';
import { createNodeIdAllocator, insertChildren } from './ooxml-edit.ts';
import { readOoxmlPart, type OoxmlNode, type OoxmlPart } from './ooxml-tree.ts';
import { withPart, type OoxmlExternalTarget, type OoxmlPackage } from './ooxml-package.ts';
import { partNameKey } from './opc-names.ts';
import { escapeXmlChecked } from './sinks.ts';
import { HYPERLINK_RELATIONSHIP_TYPE } from './hyperlink.ts';
import type { RelationshipRecord } from './relationships.ts';
import { readXml, type XmlNode } from './xml-reader.ts';

const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const RELS_CONTENT_TYPE = 'application/vnd.openxmlformats-package.relationships+xml';
const CONTENT_TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const CONTENT_TYPES_PART = '/[Content_Types].xml';
const NUMBERING_PART = '/word/numbering.xml';
const NUMBERING_REL_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering';
const NUMBERING_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml';
const NUMBERING_OVERRIDE = `<Override PartName="${NUMBERING_PART}" ContentType="${NUMBERING_CONTENT_TYPE}"/>`;

/** Stable identity for a shell hyperlink row (owner + relationship id). */
export function hyperlinkShellKey(entry: Pick<OoxmlExternalTarget, 'ownerPart' | 'id'>): string {
  return `${entry.ownerPart}\u0000${entry.id}`;
}

/**
 * Fold newly minted hyperlink externals from a `replacePackageShell` write into the
 * session shell set. Pure. Entries already remembered stay; lifecycle-cloned owned rels
 * never pass through this path and therefore never park after GC.
 */
export function rememberShellHyperlinks(
  remembered: readonly OoxmlExternalTarget[],
  before: OoxmlPackage,
  after: OoxmlPackage
): readonly OoxmlExternalTarget[] {
  const beforeKeys = new Set(
    before.externalTargets
      .filter((entry) => entry.type === HYPERLINK_RELATIONSHIP_TYPE)
      .map(hyperlinkShellKey)
  );
  const minted = after.externalTargets.filter(
    (entry) =>
      entry.type === HYPERLINK_RELATIONSHIP_TYPE && !beforeKeys.has(hyperlinkShellKey(entry))
  );
  if (minted.length === 0) return remembered;
  const known = new Set(remembered.map(hyperlinkShellKey));
  const additions = minted.filter((entry) => !known.has(hyperlinkShellKey(entry)));
  if (additions.length === 0) return remembered;
  return Object.freeze([...remembered, ...additions]);
}

/**
 * Drop remembered shell hyperlinks whose owner is no longer live and not history-retained.
 * Main-document shell links are always kept (body never parks/evicts this way).
 */
export function retainShellHyperlinks(
  remembered: readonly OoxmlExternalTarget[],
  retainedOwnerParts: ReadonlySet<string>,
  mainDocumentPart: string
): readonly OoxmlExternalTarget[] {
  const next = remembered.filter(
    (entry) => entry.ownerPart === mainDocumentPart || retainedOwnerParts.has(entry.ownerPart)
  );
  return next.length === remembered.length ? remembered : Object.freeze(next);
}

/**
 * Re-apply session shell resources from `live` / `shellHyperlinks` onto a historical
 * `snapshot`.
 *
 * Hyperlink merge uses `shellHyperlinks` (minted via {@link rememberShellHyperlinks}), not
 * every live external — so lifecycle GC of cloned owned `.rels` is not undone by parking.
 *
 * Pure: neither package argument is mutated. Returns `snapshot` by identity when nothing to
 * merge.
 */
export function mergePersistentPackageShell(
  snapshot: OoxmlPackage,
  live: OoxmlPackage,
  shellHyperlinks: readonly OoxmlExternalTarget[] = [],
  restoreNumbering = false
): OoxmlPackage {
  if (snapshot === live) return snapshot;
  let next = mergeNumberingShell(snapshot, live, restoreNumbering);
  next = mergeHyperlinkShell(next, live, shellHyperlinks);
  return next;
}

/**
 * Drop parked scoped hyperlink shell resources whose owner part is no longer live and not
 * retained by package/story history. Main-document hyperlinks are never pruned here.
 *
 * Pure: returns `pkg` by identity when nothing to drop.
 */
export function pruneUnreachableHyperlinkShell(
  pkg: OoxmlPackage,
  retainedOwnerParts: ReadonlySet<string>
): OoxmlPackage {
  const dropOwners = new Set<string>();
  for (const entry of pkg.externalTargets) {
    if (entry.type !== HYPERLINK_RELATIONSHIP_TYPE) continue;
    if (entry.ownerPart === pkg.mainDocumentPart) continue;
    if (pkg.parts.has(entry.ownerPart)) continue;
    if (retainedOwnerParts.has(entry.ownerPart)) continue;
    dropOwners.add(entry.ownerPart);
  }
  // Orphan `.rels` left from a prior park with no remaining external index row.
  for (const name of pkg.parts.keys()) {
    const owner = ownerPartForRelsName(name);
    if (!owner || owner === pkg.mainDocumentPart) continue;
    if (pkg.parts.has(owner)) continue;
    if (retainedOwnerParts.has(owner)) continue;
    if (pkg.externalTargets.some((entry) => entry.ownerPart === owner)) continue;
    dropOwners.add(owner);
  }
  if (dropOwners.size === 0) return pkg;

  let next = pkg;
  for (const owner of dropOwners) {
    next = withoutOwnedHyperlinkShell(next, owner);
  }
  return next;
}

function mergeNumberingShell(
  snapshot: OoxmlPackage,
  live: OoxmlPackage,
  restoreNumbering: boolean
): OoxmlPackage {
  const liveNumbering = live.parts.get(NUMBERING_PART);
  if (!liveNumbering) return snapshot;

  // Explicit numbering edits are history-owned. Keep their snapshot definitions, while
  // retaining later shell allocations so unrelated paragraph references remain valid.
  const oldNumbering = snapshot.parts.get(NUMBERING_PART);
  const numbering =
    restoreNumbering && oldNumbering
      ? mergeMissingNumberingDefinitions(oldNumbering, liveNumbering)
      : liveNumbering;
  let next: OoxmlPackage = withPart(snapshot, numbering);

  const liveRel = (live.relationships.get(live.mainDocumentPart) ?? []).find(
    (record) => record.type === NUMBERING_REL_TYPE
  );
  const snapRels = next.relationships.get(next.mainDocumentPart) ?? [];
  if (liveRel && !snapRels.some((record) => record.type === NUMBERING_REL_TYPE)) {
    // Prefer live's id so freeRelationshipId high-water stays coherent; skip on collision.
    if (!snapRels.some((record) => record.id === liveRel.id)) {
      const related = withInternalRelationship(next, {
        ...liveRel,
        ownerPart: next.mainDocumentPart,
      });
      if (related) next = related;
    }
  }

  if (next.contentTypes.overrides.get(partNameKey(NUMBERING_PART)) !== NUMBERING_CONTENT_TYPE) {
    const declared = withNumberingContentTypeOverride(next);
    if (declared) next = declared;
  }

  return next;
}

function mergeMissingNumberingDefinitions(snapshot: OoxmlPart, live: OoxmlPart): OoxmlPart {
  const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const key = (node: OoxmlNode): string | null => {
    if (node.kind === 'textValue' || node.namespaceUri !== ns) return null;
    const attributeName =
      node.localName === 'abstractNum'
        ? 'abstractNumId'
        : node.localName === 'num'
          ? 'numId'
          : node.localName === 'numPicBullet'
            ? 'numPicBulletId'
            : null;
    if (!attributeName) return null;
    const id = node.attributes.find(
      (a) => a.namespaceUri === ns && a.localName === attributeName
    )?.value;
    return id === undefined ? null : `${node.localName}:${id}`;
  };
  const known = new Set(snapshot.root.children.map(key).filter(Boolean));
  const nextId = createNodeIdAllocator(snapshot);
  const order = ['numPicBullet', 'abstractNum', 'num', 'numIdMacAtCleanup'];
  let result = snapshot;
  for (const node of live.root.children) {
    const id = key(node);
    if (!id || known.has(id) || node.kind === 'textValue') continue;
    const rank = order.indexOf(node.localName);
    const at = result.root.children.findIndex(
      (n) => n.kind !== 'textValue' && n.namespaceUri === ns && order.indexOf(n.localName) > rank
    );
    const changed = insertChildren(
      result,
      result.root.id,
      at < 0 ? result.root.children.length : at,
      [withFreshIds(node, nextId)]
    );
    if (changed.ok) {
      result = changed.part;
      known.add(id);
    }
  }
  return result;
}

function mergeHyperlinkShell(
  snapshot: OoxmlPackage,
  live: OoxmlPackage,
  shellHyperlinks: readonly OoxmlExternalTarget[]
): OoxmlPackage {
  // Only shell-minted hyperlinks (replacePackageShell), for every owning part — not
  // lifecycle-cloned owned externals that history snapshots already carry for undo.
  const liveLinks = shellHyperlinks.filter((entry) => entry.type === HYPERLINK_RELATIONSHIP_TYPE);
  if (liveLinks.length === 0) return snapshot;

  let next = snapshot;

  for (const link of liveLinks) {
    const owner = remapOwnerPart(snapshot, live, link.ownerPart);
    if (!owner) continue;
    if (next.externalTargets.some((entry) => entry.ownerPart === owner && entry.id === link.id)) {
      continue;
    }
    // Snapshot lifecycle owns this id — do not collide. Leftover hyperlink persistence plus
    // max-based allocation normally prevent this; prefer coherent furniture over a forced merge.
    const snapInternals = new Set((next.relationships.get(owner) ?? []).map((record) => record.id));
    if (snapInternals.has(link.id)) continue;

    const merged = withExternalHyperlink(
      next,
      {
        ownerPart: owner,
        id: link.id,
        type: HYPERLINK_RELATIONSHIP_TYPE,
        rawTarget: link.rawTarget,
        sinkSafe: link.sinkSafe,
      },
      owner
    );
    if (!merged) continue;
    next = merged;
  }

  return next;
}

/**
 * Map a live owner part name onto the snapshot package (main-document name may differ).
 *
 * Scoped owners (header/footer/notes) are returned even when the snapshot temporarily
 * lacks the part — shell-minted hyperlink resources stay parked under the same owner name
 * until redo or {@link pruneUnreachableHyperlinkShell}.
 */
function remapOwnerPart(
  snapshot: OoxmlPackage,
  live: OoxmlPackage,
  liveOwner: string
): string | null {
  if (liveOwner === live.mainDocumentPart) return snapshot.mainDocumentPart;
  if (typeof liveOwner !== 'string' || liveOwner.length === 0) return null;
  return liveOwner;
}

function withInternalRelationship(
  pkg: OoxmlPackage,
  record: RelationshipRecord
): OoxmlPackage | null {
  const owner = pkg.mainDocumentPart;
  const relsName = relsPartNameFor(owner);
  const existing = pkg.parts.get(relsName);
  const authored = readOoxmlPart(
    `<Relationships xmlns="${REL}">` +
      `<Relationship Id="${escapeXmlChecked(record.id, 'relationship id')}"` +
      ` Type="${escapeXmlChecked(record.type, 'relationship type')}"` +
      ` Target="${escapeXmlChecked(record.rawTarget, 'relationship target')}"/>` +
      '</Relationships>',
    { name: relsName, contentType: RELS_CONTENT_TYPE }
  );
  if (!authored.ok) return null;

  const owned = pkg.relationships.get(owner) ?? [];
  if (owned.some((entry) => entry.id === record.id)) return null;
  const nextRecord: RelationshipRecord = {
    ...record,
    ownerPart: owner,
    order: owned.reduce((max, entry) => Math.max(max, entry.order), -1) + 1,
  };
  const relationships = new Map([...pkg.relationships, [owner, [...owned, nextRecord]]]);

  if (!existing) {
    return Object.freeze({
      ...pkg,
      parts: new Map([...pkg.parts, [relsName, authored.part]]),
      relationships,
    });
  }
  return appendRelsChild(pkg, existing, authored.part.root.children[0], relationships);
}

function withExternalHyperlink(
  pkg: OoxmlPackage,
  link: OoxmlExternalTarget,
  ownerPart: string = pkg.mainDocumentPart
): OoxmlPackage | null {
  const owner = ownerPart;
  if (typeof owner !== 'string' || owner.length === 0) return null;
  // Owner may be absent after lifecycle undo: park `.rels` + externalTargets under the
  // owner name so a later redo can resolve story `r:id`s. Do not invent the owner part.
  const relsName = relsPartNameFor(owner);
  const existing = pkg.parts.get(relsName);
  const authored = readOoxmlPart(
    `<Relationships xmlns="${REL}">` +
      `<Relationship Id="${escapeXmlChecked(link.id, 'relationship id')}"` +
      ` Type="${HYPERLINK_RELATIONSHIP_TYPE}"` +
      ` Target="${escapeXmlChecked(link.rawTarget, 'relationship target')}"` +
      ' TargetMode="External"/>' +
      '</Relationships>',
    { name: relsName, contentType: RELS_CONTENT_TYPE }
  );
  if (!authored.ok) return null;

  const externalTargets = [...pkg.externalTargets, link];

  if (!existing) {
    return Object.freeze({
      ...pkg,
      parts: new Map([...pkg.parts, [relsName, authored.part]]),
      externalTargets,
    });
  }
  const appended = appendRelsChild(
    pkg,
    existing,
    authored.part.root.children[0],
    pkg.relationships
  );
  if (!appended) return null;
  return Object.freeze({ ...appended, externalTargets });
}

function appendRelsChild(
  pkg: OoxmlPackage,
  existing: OoxmlPart,
  node: OoxmlNode | undefined,
  relationships: ReadonlyMap<string, readonly RelationshipRecord[]>
): OoxmlPackage | null {
  if (!node) return null;
  const nextId = createNodeIdAllocator(existing);
  const inserted = insertChildren(existing, existing.root.id, existing.root.children.length, [
    withFreshIds(node, nextId),
  ]);
  if (!inserted.ok) return null;
  return Object.freeze({
    ...pkg,
    parts: new Map([...pkg.parts, [existing.name, inserted.part]]),
    relationships,
  });
}

function withFreshIds(node: OoxmlNode, nextId: () => string): OoxmlNode {
  if (node.kind === 'textValue') return { ...node, id: nextId() } as OoxmlNode;
  return {
    ...node,
    id: nextId(),
    children: node.children.map((child) => withFreshIds(child, nextId)),
  } as OoxmlNode;
}

function relsPartNameFor(partName: string): string {
  const slash = partName.lastIndexOf('/');
  return `${partName.slice(0, slash)}/_rels/${partName.slice(slash + 1)}.rels`;
}

/** `/word/_rels/header1.xml.rels` → `/word/header1.xml`; non-rels names → null. */
function ownerPartForRelsName(partName: string): string | null {
  const match = /^(.*)\/_rels\/([^/]+)\.rels$/.exec(partName);
  if (!match) return null;
  const folder = match[1]!;
  const base = match[2]!;
  if (folder === '' || base === '') return null;
  return `${folder}/${base}`;
}

/** Drop hyperlink externals + `.rels` for one parked owner without touching other parts. */
function withoutOwnedHyperlinkShell(pkg: OoxmlPackage, ownerPart: string): OoxmlPackage {
  const relsName = relsPartNameFor(ownerPart);
  const parts = new Map(pkg.parts);
  parts.delete(relsName);
  const partBytes = new Map(pkg.partBytes);
  partBytes.delete(relsName);
  const relationships = new Map(pkg.relationships);
  relationships.delete(ownerPart);
  const externalTargets = Object.freeze(
    pkg.externalTargets.filter((entry) => entry.ownerPart !== ownerPart)
  );
  return Object.freeze({ ...pkg, parts, partBytes, relationships, externalTargets });
}

/**
 * Surgical numbering content-type override on snapshot bytes — never copy live CT wholesale,
 * or deleted furniture overrides would resurrect with the shell merge.
 */
function withNumberingContentTypeOverride(pkg: OoxmlPackage): OoxmlPackage | null {
  const declared = pkg.contentTypes.overrides.get(partNameKey(NUMBERING_PART));
  if (declared === NUMBERING_CONTENT_TYPE) return pkg;
  if (declared !== undefined) return null;

  const bytes = pkg.partBytes.get(CONTENT_TYPES_PART);
  if (!bytes) return null;
  const xml = strFromU8(bytes);
  const before = contentTypesShape(xml);
  if (!before) return null;

  const close = xml.lastIndexOf(`</${before.rootName}>`);
  if (close === -1) return null;
  const patched = xml.slice(0, close) + NUMBERING_OVERRIDE + xml.slice(close);

  const after = contentTypesShape(patched);
  if (!after || after.rootName !== before.rootName) return null;
  const expected = [
    ...before.children,
    childSignature('Override', {
      PartName: NUMBERING_PART,
      ContentType: NUMBERING_CONTENT_TYPE,
    }),
  ];
  if (after.children.length !== expected.length) return null;
  if (after.children.some((child, index) => child !== expected[index])) return null;

  return Object.freeze({
    ...pkg,
    partBytes: new Map([...pkg.partBytes, [CONTENT_TYPES_PART, strToU8(patched)]]),
    contentTypes: Object.freeze({
      defaults: pkg.contentTypes.defaults,
      overrides: new Map([
        ...pkg.contentTypes.overrides,
        [partNameKey(NUMBERING_PART), NUMBERING_CONTENT_TYPE],
      ]),
    }),
  });
}

interface ContentTypesShape {
  readonly rootName: string;
  readonly children: readonly string[];
}

function contentTypesShape(xml: string): ContentTypesShape | null {
  const parsed = readXml(xml);
  if (!parsed.ok) return null;
  const roots = parsed.nodes.filter(
    (node): node is Extract<XmlNode, { type: 'element' }> => node.type === 'element'
  );
  if (roots.length !== 1) return null;
  const root = roots[0]!;
  const colon = root.name.indexOf(':');
  const prefix = colon === -1 ? '' : root.name.slice(0, colon);
  if (root.name.slice(colon + 1) !== 'Types') return null;
  if (root.attributes[prefix ? `xmlns:${prefix}` : 'xmlns'] !== CONTENT_TYPES_NS) return null;
  const children: string[] = [];
  for (const child of root.children) {
    if (child.type !== 'element') continue;
    children.push(childSignature(child.name, child.attributes));
  }
  return { rootName: root.name, children };
}

function childSignature(name: string, attributes: Readonly<Record<string, string>>): string {
  const pairs = Object.entries(attributes)
    .map(([attribute, value]) => `${attribute}=${value}`)
    .sort();
  return [name, ...pairs].join('\u0001');
}
