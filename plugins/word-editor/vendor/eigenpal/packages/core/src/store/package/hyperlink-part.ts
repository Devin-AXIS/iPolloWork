// Minting the relationship an external hyperlink needs.
//
// An external link's target does not live in `document.xml` — the paragraph holds only an
// `r:id`, and the URL sits in `/word/_rels/document.xml.rels`. So inserting a link is TWO
// writes in different places, and only one of them is a tree op. This module owns the other,
// on the same lane as `ensureListDefinition`: the package changes outside `store.transact`,
// and the tree op that names the id is what the undo stack records.
//
// A LEFTOVER RELATIONSHIP IS HARMLESS; A MISSING ONE IS NOT. Undoing an insert removes the
// `w:hyperlink` but leaves its relationship declared, and an unreferenced hyperlink
// relationship is something Word writes freely and ignores on load. Removing it eagerly would
// instead break every redo, and break any other link that had been given the same reused id.
//
// The URL here is HOST-supplied (a popover input), not file-derived, but it reaches XML all
// the same, so it is validated and escaped rather than interpolated on trust.

import { createNodeIdAllocator, insertChildren, removeNode } from './ooxml-edit.ts';
import { readOoxmlPart } from './ooxml-tree.ts';
import type { OoxmlNode } from './ooxml-tree.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import { escapeXmlChecked, isValidXmlText, sanitizeHref } from './sinks.ts';
import { validateExternalTarget } from './opc-names.ts';
import {
  HYPERLINK_RELATIONSHIP_TYPE,
  hyperlinkRelationshipIdOf,
  isHyperlinkNode,
} from './hyperlink.ts';
import { DRAWINGML_MAIN_NAMESPACE_URI, RELATIONSHIPS_NAMESPACE_URI } from './ooxml-tree.ts';
import { freePackageRelationshipId } from './actor-scoped-ids.ts';
import { withRelationshipsPartFor } from './package-edit.ts';
import { recordPutRelationship, runWithoutJournalCapture } from './canonical-primitive-capture.ts';

const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const RELS_CONTENT_TYPE = 'application/vnd.openxmlformats-package.relationships+xml';

/**
 * Longest target accepted into a relationship.
 *
 * A `.docx` is a zip an attacker controls and so is a paste into a URL field; nothing
 * downstream benefits from an unbounded one, and every consumer of the rels part pays for it.
 */
const MAX_TARGET_LENGTH = 2048;

/** The package with a hyperlink relationship guaranteed present, and that relationship's id. */
export interface EnsuredHyperlinkRelationship {
  readonly pkg: OoxmlPackage;
  readonly relationshipId: string;
}

/**
 * The target this engine would write for `url`, or null when it would write none.
 *
 * The VALIDATION half of {@link ensureHyperlinkRelationship}, exported so a caller that must decide
 * "would this be authored?" before it is allowed to change the package can ask without changing it.
 * A relationship outlives a refusal — it lives beside the trees, outside the undo stack — so a
 * caller planning a batch that may yet be refused has to ask this and mint later.
 *
 * Same rules, one implementation: `sanitizeHref`'s allowlist, a bound on the length, XML-writable
 * text, and the absolute-URI gate the READ side applies. There is no legitimate reason for this
 * engine to author a scheme it would refuse to open.
 */
export function authorableHyperlinkTarget(url: string): string | null {
  if (typeof url !== 'string' || url.length === 0 || url.length > MAX_TARGET_LENGTH) return null;
  if (!isValidXmlText(url)) return null;
  const projection = sanitizeHref(url);
  if (!projection.ok || projection.href.length === 0) return null;
  return validateExternalTarget(projection.href).ok ? projection.href : null;
}

/** `/word/document.xml` -> `/word/_rels/document.xml.rels`. */
function relsPartNameFor(partName: string): string {
  const slash = partName.lastIndexOf('/');
  return `${partName.slice(0, slash)}/_rels/${partName.slice(slash + 1)}.rels`;
}

/** An `rIdN` no owner in the package already uses. */
function freeRelationshipId(pkg: OoxmlPackage): string {
  // External targets live OUTSIDE `relationships` (that map holds the internal ones), so an
  // id already spent on a hyperlink would be handed out a second time without this — two
  // links pointing at one URL, and editing either would silently move the other.
  return freePackageRelationshipId(pkg);
}

/** Re-key a grafted subtree so it cannot collide with the part it is joining. */
function withFreshIds(node: OoxmlNode, nextId: () => string): OoxmlNode {
  if (node.kind === 'textValue') return { ...node, id: nextId() } as OoxmlNode;
  return {
    ...node,
    id: nextId(),
    children: node.children.map((child) => withFreshIds(child, nextId)),
  } as OoxmlNode;
}

/**
 * The external hyperlink relationship for `url` on `ownerPart` (default: main document),
 * reusing an existing one with the same target, or `null` when the URL is not something to
 * write.
 *
 * REUSE IS BY EXACT TARGET, matching Word: linking twice to the same address produces one
 * relationship. It is safe because a hyperlink relationship carries nothing but its target —
 * two links sharing one are indistinguishable from two links with identical targets, and
 * retargeting one always mints rather than rewriting (see the edit op).
 *
 * Ownership follows the story that holds the `w:hyperlink`: a header/footer or notes part
 * mints into that part's `.rels`, never into `document.xml.rels`. Passing an owner the
 * package does not declare fails closed (`null`) so a scoped insert cannot leave a stray
 * body relationship behind.
 *
 * The URL is refused unless `sanitizeHref` admits it. Storing a `javascript:` target that a
 * FILE authored is required — round-tripping never rewrites a document — but AUTHORING one
 * here is not: there is no legitimate reason for this engine to write a scheme it would then
 * refuse to open, and writing it would hand the next reader a live target this reader made.
 */
export function ensureHyperlinkRelationship(
  pkg: OoxmlPackage,
  url: string,
  ownerPart: string = pkg.mainDocumentPart
): EnsuredHyperlinkRelationship | null {
  // The same gate the READ side applies, applied on the way in: an authored external relationship
  // must be an absolute URI. Writing `/admin/delete-account` as `TargetMode="External"` is not a
  // shape Word produces, and it would hand the next reader a target that resolves against whatever
  // origin opens the file.
  const target = authorableHyperlinkTarget(url);
  if (target === null) return null;

  const owner = ownerPart;
  if (typeof owner !== 'string' || owner.length === 0) return null;
  // Refuse unknown owners rather than inventing a rels part that points at nothing in the
  // package — a scoped insert that cannot name its story must fail atomically.
  if (owner !== pkg.mainDocumentPart && !pkg.parts.has(owner)) return null;
  const reusable = pkg.externalTargets.find(
    (entry) =>
      entry.ownerPart === owner &&
      entry.type === HYPERLINK_RELATIONSHIP_TYPE &&
      entry.rawTarget === target
  );
  if (reusable) return { pkg, relationshipId: reusable.id };

  const relsName = relsPartNameFor(owner);
  const prepared = withRelationshipsPartFor(pkg, owner);
  const existing = prepared.parts.get(relsName);
  if (!existing) return null;
  const id = freeRelationshipId(prepared);
  const order =
    [...prepared.relationships.values()]
      .flat()
      .reduce((max, entry) => Math.max(max, entry.order), -1) + 1;
  const authored = readOoxmlPart(
    `<Relationships xmlns="${REL}">` +
      `<Relationship Id="${escapeXmlChecked(id, 'relationship id')}"` +
      ` Type="${HYPERLINK_RELATIONSHIP_TYPE}"` +
      ` Target="${escapeXmlChecked(target, 'relationship target')}"` +
      ' TargetMode="External"/>' +
      '</Relationships>',
    { name: relsName, contentType: RELS_CONTENT_TYPE }
  );
  if (!authored.ok) return null;

  // The external record is what `hyperlinkTargetOf` resolves against, so it is added in the
  // same breath as the tree node. Writing only the tree left the resolver blind to a link
  // this session had just created: it painted inert until the document was saved and
  // reopened.
  const externalTargets = [
    ...prepared.externalTargets,
    {
      ownerPart: owner,
      id,
      type: HYPERLINK_RELATIONSHIP_TYPE,
      rawTarget: target,
      sinkSafe: true,
    },
  ];
  const node = authored.part.root.children[0];
  if (!node) return null;
  const inserted = runWithoutJournalCapture(() =>
    insertChildren(existing, existing.root.id, existing.root.children.length, [
      withFreshIds(node, createNodeIdAllocator(existing)),
    ])
  );
  if (!inserted.ok) return null;
  const owned = prepared.relationships.get(owner) ?? [];
  const record = {
    ownerPart: owner,
    id,
    type: HYPERLINK_RELATIONSHIP_TYPE,
    rawTarget: target,
    targetMode: 'External' as const,
    order,
  };
  recordPutRelationship(owner, record);
  return {
    pkg: Object.freeze({
      ...prepared,
      parts: new Map([...prepared.parts, [relsName, inserted.part]]),
      externalTargets,
      relationships: new Map([...prepared.relationships, [owner, [...owned, record]]]),
    }),
    relationshipId: id,
  };
}

/**
 * What a part's relationships answer for one `r:id`, over both maps.
 *
 * `relationships` holds the internal records and `externalTargets` the external ones, so a
 * resolver reading only the first sees every hyperlink as dangling.
 */
export function relationshipTargetIn(
  pkg: OoxmlPackage,
  ownerPart: string,
  relationshipId: string
): {
  readonly target: string;
  readonly external: boolean;
  readonly sinkSafe?: boolean;
} | null {
  for (const external of pkg.externalTargets) {
    if (external.ownerPart === ownerPart && external.id === relationshipId) {
      // `sinkSafe` travels WITH the target. The package computed it at load
      // (`validateExternalTarget`: absolute URI, safe scheme) and it answers the question
      // `sanitizeHref` structurally cannot — whether a target with no scheme at all is
      // safe to follow. Dropping it here is what let `Target="/admin/delete-account"`
      // reach a live `href` resolving against the host application's origin.
      return { target: external.rawTarget, external: true, sinkSafe: external.sinkSafe };
    }
  }
  const internal = (pkg.relationships.get(ownerPart) ?? []).find(
    (record) => record.id === relationshipId
  );
  if (internal) return { target: internal.rawTarget, external: false };
  return null;
}

/** Unused ids are never reclaimed, so an unreferenced relationship keeps its slot. */
export const HYPERLINK_RELATIONSHIP_MAX_TARGET_LENGTH = MAX_TARGET_LENGTH;

function relsRelationshipId(node: OoxmlNode): string | undefined {
  if (node.kind === 'textValue' || !('attributes' in node)) return undefined;
  return node.attributes.find(
    (attribute) => attribute.localName === 'Id' && attribute.namespaceUri === ''
  )?.value;
}

function drawingHlinkClickRelationshipId(node: OoxmlNode): string | undefined {
  if (node.kind === 'textValue' || !('attributes' in node)) return undefined;
  if (node.kind !== 'generic') return undefined;
  if (node.namespaceUri !== DRAWINGML_MAIN_NAMESPACE_URI || node.localName !== 'hlinkClick') {
    return undefined;
  }
  for (const attribute of node.attributes) {
    if (attribute.localName !== 'id') continue;
    if (attribute.namespaceUri !== RELATIONSHIPS_NAMESPACE_URI) continue;
    return attribute.value;
  }
  return undefined;
}

function walkPartNodes(node: OoxmlNode, visit: (node: OoxmlNode) => void): void {
  visit(node);
  if (node.kind === 'textValue') return;
  for (const child of node.children) walkPartNodes(child, visit);
}

/**
 * Whether any canonical reference in `ownerPart` still names this external hyperlink `r:id`.
 *
 * Counts typed `w:hyperlink/@r:id` and direct `wp:docPr/a:hlinkClick/@r:id` only — the same
 * vocabulary projection reads. Scoped to one owner part so duplicate ids across header/body
 * parts stay independent.
 */
export function ownerPartReferencesHyperlinkRelationshipId(
  pkg: OoxmlPackage,
  ownerPart: string,
  relationshipId: string
): boolean {
  const part = pkg.parts.get(ownerPart);
  if (!part) return false;
  let referenced = false;
  walkPartNodes(part.root, (node) => {
    if (referenced) return;
    if (isHyperlinkNode(node)) {
      if (hyperlinkRelationshipIdOf(node) === relationshipId) referenced = true;
      return;
    }
    if (drawingHlinkClickRelationshipId(node) === relationshipId) referenced = true;
  });
  return referenced;
}

/** Drop one owner-scoped external hyperlink relationship from `.rels` and `externalTargets`. */
export function removeExternalHyperlinkRelationship(
  pkg: OoxmlPackage,
  ownerPart: string,
  relationshipId: string
): OoxmlPackage | null {
  const external = pkg.externalTargets.find(
    (entry) =>
      entry.ownerPart === ownerPart &&
      entry.id === relationshipId &&
      entry.type === HYPERLINK_RELATIONSHIP_TYPE
  );
  if (!external) return pkg;

  const relsName = relsPartNameFor(ownerPart);
  const relsPart = pkg.parts.get(relsName);
  let parts = pkg.parts;
  if (relsPart) {
    const node = relsPart.root.children.find(
      (child) =>
        child.kind !== 'textValue' &&
        child.localName === 'Relationship' &&
        relsRelationshipId(child) === relationshipId
    );
    if (node) {
      const removed = removeNode(relsPart, node.id);
      if (!removed.ok) return null;
      parts = new Map([...pkg.parts, [relsName, removed.part]]);
    }
  }

  const externalTargets = Object.freeze(
    pkg.externalTargets.filter(
      (entry) => !(entry.ownerPart === ownerPart && entry.id === relationshipId)
    )
  );
  return Object.freeze({ ...pkg, parts, externalTargets });
}

/**
 * After a drawing `a:hlinkClick` update or removal, drop the prior owner rel when nothing
 * in that part still references it. Shared rels and an unchanged same-target rel are kept.
 */
export function cleanupOrphanDrawingHyperlinkRelationship(
  pkg: OoxmlPackage,
  ownerPart: string,
  previousRelationshipId: string | null
): OoxmlPackage | null {
  if (previousRelationshipId === null) return pkg;
  if (ownerPartReferencesHyperlinkRelationshipId(pkg, ownerPart, previousRelationshipId)) {
    return pkg;
  }
  return removeExternalHyperlinkRelationship(pkg, ownerPart, previousRelationshipId);
}
