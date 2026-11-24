import { containsClipboardObject } from './clipboard-object-policy.ts';
// Clipboard fragment merge: a read-back fragment package lands in a target package
// (rich-clipboard-fidelity tasks 2.2-2.4).
//
// Identifier discipline over trust: style ids reuse by definition fingerprint or import
// under fresh ids and derived unique names; numbering ids always remap; relationship ids
// are freshly allocated PER OWNER PART (rel-id namespaces are per part, and so are note
// ids — footnotes and endnotes each count from 1); media dedupes by content hash; every
// document-unique namespace the fragment carries (bookmarks, `wp:docPr`, SDT ids,
// revision ids) is freshened, in note bodies as well as blocks. The caller applies the
// returned package transform through `ctx.applyPackage` inside the same transaction as
// `insertFragment`, promoted to a package undo unit.

import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import type { OoxmlPackage } from '../package/ooxml-package.ts';
import { partNumberCandidates, resolveAllocationActor } from '../package/actor-scoped-ids.ts';
import { withPart } from '../package/ooxml-package.ts';
import {
  relationshipsOf,
  resolveContentTypeOf,
  withNewPart,
  withRelationship,
  withRelationships,
  withRelationshipsPartFor,
} from '../package/package-edit.ts';
import { withBinaryParts, validateEmbeddedImageBytes } from '../package/drawing-package-edit.ts';
import { standardImageType } from '../package/content-types.ts';
import { sniffImageMime, type SupportedImageMime } from '../package/image-resources.ts';
import { ensureHyperlinkRelationship } from '../package/hyperlink-part.ts';
import { ensureNotesPart } from '../package/note-lifecycle.ts';
import { resolveNotesPart } from '../package/note-references.ts';
import { resolveInternalTarget } from '../package/opc-names.ts';
import { readOoxmlPart } from '../package/ooxml-tree.ts';
import {
  carryIndexToRebuiltRoot,
  createNodeIdAllocator,
  insertChildren,
} from '../package/ooxml-edit.ts';
import { sha256FontBytes } from '../package/sha256.ts';
import { attributeValueOf, cloneWithNewIds } from './tree-op-nodes.ts';
import {
  isElementNode,
  isWml,
  materializeDefaults,
  styleSignature,
  stylesInfoOf,
  walkAll,
} from './clipboard-fragment-defaults.ts';
import { withRequiredNamespaceBindings } from './tree-op-fragment.ts';
import { sanitizeFragmentBlocks } from './clipboard-fragment-sanitize.ts';
import {
  carriesPastedRevisionId,
  freshUniqueId,
  freshUniqueName,
  rewriteIdentifiers,
  withRewrittenAttribute,
} from './clipboard-fragment-identifiers.ts';
import {
  canonicalNoteId,
  relationshipIdsIn,
  noteReferenceClosure,
  withoutDanglingNoteReferences,
} from './clipboard-fragment-closure.ts';
import { mintFragmentUniqueIds } from './clipboard-fragment-unique-ids.ts';
import { planNumberingImport } from './clipboard-fragment-numbering.ts';

const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const HYPERLINK_REL = `${R_NS}/hyperlink`;
const IMAGE_REL = `${R_NS}/image`;
const NUMBERING_REL = `${R_NS}/numbering`;
const STYLES_REL = `${R_NS}/styles`;
const NUMBERING_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml';
const STYLES_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml';

export type FragmentMergeRejection =
  'no-fragment-document' | 'no-target-part' | 'merge-refused' | 'unsupported-content';

export type FragmentMergeResult =
  | {
      readonly ok: true;
      readonly pkg: OoxmlPackage;
      /** The fragment blocks, rewritten to target identifiers, ready for `insertFragment`. */
      readonly blocks: readonly OoxmlNode[];
    }
  | { readonly ok: false; readonly reason: FragmentMergeRejection };

function relatedPart(
  pkg: OoxmlPackage,
  owner: string,
  relType: string,
  fallback: string
): OoxmlPart | null {
  for (const record of relationshipsOf(pkg, owner)) {
    if (record.type !== relType || record.targetMode === 'External') continue;
    const resolved = resolveInternalTarget(record.ownerPart, record.rawTarget);
    if (resolved.ok) {
      const part = pkg.parts.get(resolved.partName);
      if (part) return part;
    }
  }
  return pkg.parts.get(fallback) ?? null;
}

function maxNumericAttribute(
  root: OoxmlNode,
  match: (node: OoxmlNode) => string | undefined
): number {
  let max = 0;
  walkAll([root], (node) => {
    const value = match(node);
    if (value === undefined) return;
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > max) max = parsed;
  });
  return max;
}

function appendToPart(
  pkg: OoxmlPackage,
  part: OoxmlPart,
  nodes: readonly OoxmlNode[],
  index?: number
): OoxmlPackage | null {
  if (nodes.length === 0) return pkg;
  // Detached-clone shape, same as `applyInsertFragment`: the clones exist before the
  // insert below, so they mint in the `paste` family where no in-transaction `new` mint
  // can ever re-issue their ids.
  const nextId = createNodeIdAllocator(part, 'paste');
  const cloned = nodes.map((node) => cloneWithNewIds(node, nextId));
  const bound = withRequiredNamespaceBindings(part, cloned);
  const at = index ?? bound.root.children.length;
  const inserted = insertChildren(bound, bound.root.id, at, cloned, { deferValidation: true });
  if (!inserted.ok) return null;
  return withPart(pkg, inserted.part);
}

/**
 * Resolve references to relationships that could not merge: a drawing whose media rel was
 * dropped is removed; a `w:hyperlink` whose `r:id` was dropped (a refused `javascript:`
 * target, say) is UNWRAPPED to its runs, so the text survives without a dangling — or
 * worse, accidentally re-resolving — relationship id.
 */
function withoutDanglingDrawings(
  nodes: readonly OoxmlNode[],
  dropRelIds: ReadonlySet<string>
): OoxmlNode[] {
  if (dropRelIds.size === 0) return [...nodes];
  const rewrite = (node: OoxmlNode): OoxmlNode | OoxmlNode[] | null => {
    if (node.kind === 'textValue') return node;
    if (node.kind === 'drawing' || isWml(node, 'pict') || isWml(node, 'object')) {
      let dangling = false;
      walkAll([node], (inner) => {
        if (inner.kind === 'textValue') return;
        for (const attribute of inner.attributes) {
          if (attribute.namespaceUri === R_NS && dropRelIds.has(attribute.value)) dangling = true;
        }
      });
      return dangling ? null : node;
    }
    if (node.kind === 'hyperlink') {
      const relId = node.attributes.find((attribute) => attribute.namespaceUri === R_NS)?.value;
      if (relId !== undefined && dropRelIds.has(relId)) {
        // Unwrap: lift the link's (rewritten) children into the parent, drop the wrapper.
        return rewriteChildren(node.children);
      }
    }
    const children = rewriteChildren(node.children);
    return children.length === node.children.length &&
      children.every((child, index) => child === node.children[index])
      ? node
      : ({ ...node, children } as OoxmlNode);
  };
  function rewriteChildren(children: readonly OoxmlNode[]): OoxmlNode[] {
    const out: OoxmlNode[] = [];
    for (const child of children) {
      const kept = rewrite(child);
      if (kept === null) continue;
      if (Array.isArray(kept)) out.push(...kept);
      else out.push(kept);
    }
    return out;
  }
  return rewriteChildren(nodes);
}

const SUPPORTED_RASTER_MIMES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/bmp',
  'image/webp',
]);

/** Aliases OPC files legitimately declare for the same signature class. */
const DECLARED_MIME_ALIASES: Readonly<Record<string, string>> = {
  'image/jpg': 'image/jpeg',
  'image/x-ms-bmp': 'image/bmp',
  'image/x-bmp': 'image/bmp',
};

/**
 * The content type fragment media is admitted under, or null to drop it.
 *
 * Signature over claim: the sniffed mime must agree with the declared class, and a
 * supported raster must additionally pass the same header + dimension gate the
 * insert-image lane applies (`validateEmbeddedImageBytes`). Vector and preserved formats
 * (SVG, TIFF, EMF, WMF) travel signature-checked; the paint lane re-validates and renders
 * them inert.
 */
function admittedMediaMime(bytes: Uint8Array, declaredType: string): string | null {
  const sniffed = sniffImageMime(bytes);
  if (sniffed === 'unknown') return null;
  const declared = standardImageType(declaredType);
  const normalizedDeclared = Object.hasOwn(DECLARED_MIME_ALIASES, declared)
    ? DECLARED_MIME_ALIASES[declared]!
    : declared;
  if (normalizedDeclared !== sniffed) return null;
  if (SUPPORTED_RASTER_MIMES.has(sniffed)) {
    if (!validateEmbeddedImageBytes(bytes, sniffed as SupportedImageMime)) return null;
  }
  return sniffed;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Merge a fragment package's resources into `target` and rewrite the fragment blocks to
 * the target's identifiers. Pure: returns a new package; the caller commits it through
 * `ctx.applyPackage` beside the `insertFragment` op.
 */
export function mergeFragmentIntoPackage(
  target: OoxmlPackage,
  fragment: OoxmlPackage,
  ownerPartName: string
): FragmentMergeResult {
  for (const part of fragment.parts.values()) {
    if (containsClipboardObject([part.root])) return { ok: false, reason: 'unsupported-content' };
  }
  const fragmentDoc = fragment.parts.get(fragment.mainDocumentPart);
  if (!fragmentDoc) return { ok: false, reason: 'no-fragment-document' };
  if (!target.parts.has(ownerPartName)) return { ok: false, reason: 'no-target-part' };

  const fragmentBody =
    fragmentDoc.root.kind === 'document'
      ? fragmentDoc.root.children.find((child) => child.kind === 'body')
      : null;
  if (!fragmentBody || !isElementNode(fragmentBody)) {
    return { ok: false, reason: 'no-fragment-document' };
  }
  // Sanitize at the trust boundary: a crafted `data-docx-fragment` reaches here without
  // passing through the extractor, so sections, comments, external-content imports, and
  // dangerous field instructions (DDE/INCLUDE*) are neutralized regardless of who authored
  // the fragment. Idempotent on our own extractor-cleaned payloads.
  let blocks: OoxmlNode[] = sanitizeFragmentBlocks(
    fragmentBody.children.filter(
      (child) =>
        child.kind === 'paragraph' || child.kind === 'table' || child.kind === 'contentControl'
    )
  );
  if (blocks.length === 0) return { ok: false, reason: 'no-fragment-document' };

  let pkg = target;

  // ------------------------------------------------------------------
  // Numbering FIRST: always remap, dedupe by override-inclusive fingerprint. The style
  // pass below compares definitions AFTER applying this map, so a repeated paste of the
  // same payload recognizes its own earlier imports instead of minting `…Pasted` copies.
  // ------------------------------------------------------------------
  const numbering = planNumberingImport(
    relatedPart(fragment, fragment.mainDocumentPart, NUMBERING_REL, '/word/numbering.xml'),
    relatedPart(pkg, pkg.mainDocumentPart, NUMBERING_REL, '/word/numbering.xml')
  );
  if (!numbering) return { ok: false, reason: 'merge-refused' };
  const { numIdMap, numsToImport, abstractsToImport } = numbering;

  // ------------------------------------------------------------------
  // Styles: reuse by fingerprint, else import under fresh id + unique name.
  // ------------------------------------------------------------------
  const fragmentStyles = stylesInfoOf(
    relatedPart(fragment, fragment.mainDocumentPart, STYLES_REL, '/word/styles.xml')
  );
  let targetStylesPart = relatedPart(pkg, pkg.mainDocumentPart, STYLES_REL, '/word/styles.xml');
  let targetStyles = stylesInfoOf(targetStylesPart);

  const styleIdMap = new Map<string, string>();
  const stylesToImport: OoxmlElement[] = [];
  const takenIds = new Set(targetStyles.byId.keys());
  const takenNames = new Set(targetStyles.names);
  // Next unused suffix per base, so N colliding `Normal` styles rename in O(N) rather than
  // O(N^2): a fresh-id search that restarts from 2 each time is quadratic.
  const idSuffixes = new Map<string, number>();
  const nameSuffixes = new Map<string, number>();
  // Target style signatures computed LAZILY, only for an id the fragment actually reuses:
  // fingerprinting every target style up front is O(styles.xml) on a paste that collides
  // with none of them.
  const targetSignatures = new Map<string, string>();
  const targetSignatureOf = (id: string, style: OoxmlElement): string => {
    let signature = targetSignatures.get(id);
    if (signature === undefined) {
      signature = styleSignature(style);
      targetSignatures.set(id, signature);
    }
    return signature;
  };

  /**
   * An imported style must NEVER become the target's default: the cascade is last-wins
   * among `w:default` styles, so a pasted `Normal` carrying the flag would restyle every
   * unstyled paragraph in the HOST document.
   */
  const withoutDefaultFlag = (style: OoxmlElement): OoxmlElement =>
    ({
      ...style,
      attributes: style.attributes.filter(
        (attribute) =>
          !(attribute.localName === 'default' && attribute.namespaceUri === WML_NAMESPACE_URI)
      ),
    }) as OoxmlElement;

  for (const style of fragmentStyles.styles) {
    const id = attributeValueOf(style, 'styleId');
    if (!id) continue;
    const existing = targetStyles.byId.get(id);
    // Compare AFTER applying the maps built so far: the target's copy of a previously
    // imported style already carries rewritten numbering/style references.
    const comparable = styleSignature(
      rewriteIdentifiers(style, { styleIds: styleIdMap, numIds: numIdMap }) as OoxmlElement
    );
    if (existing && targetSignatureOf(id, existing) === comparable) {
      styleIdMap.set(id, id);
      continue;
    }
    if (!existing) {
      styleIdMap.set(id, id);
      takenIds.add(id);
      stylesToImport.push(withoutDefaultFlag(style));
      continue;
    }
    const fresh = freshUniqueId(`${id}Pasted`, takenIds, idSuffixes);
    takenIds.add(fresh);
    styleIdMap.set(id, fresh);
    stylesToImport.push(
      withoutDefaultFlag(withRewrittenAttribute(style, WML_NAMESPACE_URI, 'styleId', fresh))
    );
  }
  // Unique names for every imported style whose name collides with a different target style.
  const importedWithNames = stylesToImport.map((style) => {
    const nameNode = style.children.find((inner) => isWml(inner, 'name'));
    const name = nameNode ? attributeValueOf(nameNode, 'val') : undefined;
    if (!name || !takenNames.has(name)) {
      if (name) takenNames.add(name);
      return style;
    }
    const fresh = freshUniqueName(name, takenNames, nameSuffixes);
    takenNames.add(fresh);
    const children = style.children.map((inner) =>
      isWml(inner, 'name')
        ? withRewrittenAttribute(inner as OoxmlElement, WML_NAMESPACE_URI, 'val', fresh)
        : inner
    );
    return { ...style, children } as OoxmlElement;
  });

  // ------------------------------------------------------------------
  // Relationships and media — PER OWNER PART: `rId5` in `document.xml.rels` and `rId5`
  // in `footnotes.xml.rels` are different relationships, so each story rewrites through
  // its own map and its own drop set.
  // ------------------------------------------------------------------
  // Built LAZILY on the first admitted fragment image: a fragment with no media must not
  // pay for hashing every `/word/media/*` part in the target (linear in the target's image
  // bytes — expensive on an image-heavy host, useless when nothing dedupes against it).
  let targetMediaByHash: Map<string, string> | null = null;
  let nextMediaIndex = 1;
  const stripedMedia =
    resolveAllocationActor() === undefined ? null : partNumberCandidates(Number.MAX_SAFE_INTEGER);
  const mediaHashIndex = (): Map<string, string> => {
    if (targetMediaByHash) return targetMediaByHash;
    const index = new Map<string, string>();
    for (const [name, bytes] of pkg.partBytes) {
      const canonical = name.startsWith('/') ? name : `/${name}`;
      if (!canonical.startsWith('/word/media/')) continue;
      index.set(sha256FontBytes(bytes), canonical);
      const match = /\/image(\d+)\./.exec(canonical);
      if (match) nextMediaIndex = Math.max(nextMediaIndex, Number(match[1]) + 1);
    }
    targetMediaByHash = index;
    return index;
  };

  // Media part → the image relationship already pointing at it, per owner, so the
  // existing-rel check is a Map lookup rather than an O(rels) scan inside the media loop.
  const imageRelByMediaPart = new Map<string, Map<string, string>>();
  const imageRelIndexFor = (owner: string): Map<string, string> => {
    let index = imageRelByMediaPart.get(owner);
    if (!index) {
      index = new Map();
      for (const entry of relationshipsOf(pkg, owner)) {
        if (entry.targetMode === 'External' || entry.type !== IMAGE_REL) continue;
        const resolved = resolveInternalTarget(entry.ownerPart, entry.rawTarget);
        if (resolved.ok) index.set(resolved.partName, entry.id);
      }
      imageRelByMediaPart.set(owner, index);
    }
    return index;
  };

  /** A media extension constrained to a safe token, or a mime-derived fallback. */
  const safeMediaExtension = (partName: string, mime: string): string => {
    const dot = partName.lastIndexOf('.');
    const raw = dot === -1 ? '' : partName.slice(dot + 1);
    if (/^[A-Za-z0-9]{1,8}$/.test(raw)) return raw.toLowerCase();
    return mime === 'image/jpeg' ? 'jpeg' : mime === 'image/gif' ? 'gif' : 'png';
  };

  const mergeRels = (
    fragmentOwner: string,
    targetOwner: string,
    usedIds: ReadonlySet<string>
  ): { readonly relIdMap: Map<string, string>; readonly dropRelIds: Set<string> } => {
    const relIdMap = new Map<string, string>();
    const dropRelIds = new Set<string>();
    const relIndex = imageRelIndexFor(targetOwner);
    // Media writes are BATCHED and flushed once at the end of this call: a `withBinaryPart`
    // + `withRelationship` per image each copy the whole package, so a fragment with
    // thousands of distinct images was O(images^2). New media parts and new image
    // relationships accumulate here; each pending rel is keyed by its media part so many
    // records to the same new image share one relationship.
    const pendingBinary: Array<{ partName: string; bytes: Uint8Array; contentType: string }> = [];
    const pendingPartNames = new Set<string>();
    const pendingRelTargets: string[] = [];
    const pendingRelMediaParts: string[] = [];
    const pendingRelByMediaPart = new Map<string, number>();
    const recordPending: Array<{ recordId: string; index: number }> = [];
    const records = fragment.relationships.get(fragmentOwner) ?? [];
    for (const record of records) {
      if (!usedIds.has(record.id)) continue;
      if (record.targetMode === 'External') {
        if (record.type === HYPERLINK_REL) {
          const ensured = ensureHyperlinkRelationship(pkg, record.rawTarget, targetOwner);
          if (ensured) {
            pkg = ensured.pkg;
            relIdMap.set(record.id, ensured.relationshipId);
          } else {
            dropRelIds.add(record.id);
          }
        } else {
          dropRelIds.add(record.id);
        }
        continue;
      }
      const resolved = resolveInternalTarget(record.ownerPart, record.rawTarget);
      if (!resolved.ok) {
        dropRelIds.add(record.id);
        continue;
      }
      const bytes =
        fragment.partBytes.get(resolved.partName) ??
        fragment.partBytes.get(resolved.partName.replace(/^\//, ''));
      const declaredType = (resolveContentTypeOf(fragment, resolved.partName) ?? '').toLowerCase();
      if (!bytes || !declaredType.startsWith('image/')) {
        dropRelIds.add(record.id);
        continue;
      }
      // The declared content type is a CLAIM from the fragment's own attacker-controlled
      // [Content_Types].xml; the signature sniff is authoritative, same as the insert-image
      // lane. A mismatch, an unknown signature, or a raster that fails the header and
      // dimension caps drops the relationship (and with it the drawing) instead of copying
      // spoofed bytes into the target package under an image/* type.
      const mediaMime = admittedMediaMime(bytes, declaredType);
      if (mediaMime === null) {
        dropRelIds.add(record.id);
        continue;
      }
      const contentType = mediaMime;
      const hashIndex = mediaHashIndex();
      const hash = sha256FontBytes(bytes);
      let mediaPart = hashIndex.get(hash);
      if (!mediaPart) {
        const ext = safeMediaExtension(resolved.partName, contentType);
        const isPendingOrPresent = (candidate: string): boolean =>
          pkg.partBytes.has(candidate) ||
          pkg.partBytes.has(candidate.slice(1)) ||
          pkg.parts.has(candidate) ||
          pendingPartNames.has(candidate);
        let candidate: string;
        if (stripedMedia) {
          // A collaborator takes numbers from its own stripe, so two people pasting images
          // from one snapshot do not both name a part `image3`.
          do candidate = `/word/media/image${stripedMedia.next().value}.${ext}`;
          while (isPendingOrPresent(candidate));
        } else {
          candidate = `/word/media/image${nextMediaIndex}.${ext}`;
          while (isPendingOrPresent(candidate)) {
            nextMediaIndex += 1;
            candidate = `/word/media/image${nextMediaIndex}.${ext}`;
          }
          nextMediaIndex += 1;
        }
        mediaPart = candidate;
        pendingBinary.push({ partName: mediaPart, bytes, contentType });
        pendingPartNames.add(mediaPart);
        hashIndex.set(hash, mediaPart);
      }
      const relTarget = mediaPart.startsWith('/word/')
        ? mediaPart.slice('/word/'.length)
        : mediaPart;
      const existingRelId = relIndex.get(mediaPart);
      if (existingRelId !== undefined) {
        relIdMap.set(record.id, existingRelId);
        continue;
      }
      // Reserve one pending rel per NEW media part; many records to it share the rel.
      let pendingIndex = pendingRelByMediaPart.get(mediaPart);
      if (pendingIndex === undefined) {
        pendingIndex = pendingRelTargets.length;
        pendingRelByMediaPart.set(mediaPart, pendingIndex);
        pendingRelTargets.push(relTarget);
        pendingRelMediaParts.push(mediaPart);
      }
      recordPending.push({ recordId: record.id, index: pendingIndex });
    }

    // Flush: all media bytes + content types in one package edit, all relationships in one.
    if (pendingBinary.length > 0) pkg = withBinaryParts(pkg, pendingBinary);
    if (pendingRelTargets.length > 0) {
      const withRels = withRelationships(
        withRelationshipsPartFor(pkg, targetOwner),
        targetOwner,
        pendingRelTargets.map((target) => [IMAGE_REL, target] as const)
      );
      if (!withRels.ok) {
        for (const entry of recordPending) dropRelIds.add(entry.recordId);
      } else {
        pkg = withRels.pkg;
        withRels.ids.forEach((relId, index) => {
          relIndex.set(pendingRelMediaParts[index]!, relId);
        });
        for (const entry of recordPending) {
          relIdMap.set(entry.recordId, withRels.ids[entry.index]!);
        }
      }
    }
    return { relIdMap, dropRelIds };
  };

  const docRels = mergeRels(fragment.mainDocumentPart, ownerPartName, relationshipIdsIn(blocks));
  blocks = withoutDanglingDrawings(blocks, docRels.dropRelIds);

  // ------------------------------------------------------------------
  // Note bodies: collect and remap ids per KIND before any rewriting, so cross-references
  // between kinds resolve, then transplant below with full unique-id freshening.
  // ------------------------------------------------------------------
  const footnoteIdMap = new Map<string, string>();
  const endnoteIdMap = new Map<string, string>();
  interface NoteTransplant {
    readonly kind: 'footnote' | 'endnote';
    readonly fragmentPartName: string;
    bodies: OoxmlNode[];
  }
  const transplants: NoteTransplant[] = [];

  // Referenced note ids per kind: body blocks first, then the transitive closure
  // over the fragment's own note bodies — a shipped note's citations must
  // transplant too, or their ids would pass through the rewrite unmapped.
  // One id→element index per kind, so the closure stays linear in refs + notes.
  // A definition matches by SHAPE (w:footnote/w:endnote by name), not typed kind:
  // an out-of-allowlist `w:type` demotes the element to generic while its typed
  // reference stays, and missing it here would make the fail-closed scrub delete
  // the citation — a silent drop where main pasted the reference through.
  const isNoteShaped = (node: OoxmlNode, kind: 'footnote' | 'endnote'): node is OoxmlElement =>
    isElementNode(node) && node.namespaceUri === WML_NAMESPACE_URI && node.localName === kind;
  const noteIndexByKind: Partial<Record<'footnote' | 'endnote', Map<string, OoxmlNode>>> = {};
  const referencedByKind = noteReferenceClosure(blocks, (kind, id) => {
    let index = noteIndexByKind[kind];
    if (index === undefined) {
      index = new Map<string, OoxmlNode>();
      noteIndexByKind[kind] = index;
      const part = resolveNotesPart(fragment, kind);
      if (part && isElementNode(part.root)) {
        for (const child of part.root.children) {
          if (!isNoteShaped(child, kind)) continue;
          const noteId = attributeValueOf(child, 'id');
          // Canonical keys: a `w:id="07"` definition must satisfy a `w:id="7"`
          // reference (and vice versa), matching the HTML lane's numeric parse.
          if (noteId === undefined) continue;
          const key = canonicalNoteId(noteId);
          if (!index.has(key)) index.set(key, child);
        }
      }
    }
    return index.get(id) ?? null;
  });

  for (const noteKind of ['footnote', 'endnote'] as const) {
    const idMap = noteKind === 'footnote' ? footnoteIdMap : endnoteIdMap;
    const referenced = referencedByKind[noteKind];
    if (referenced.size === 0) continue;
    const fragmentNotes = resolveNotesPart(fragment, noteKind);
    if (!fragmentNotes || !isElementNode(fragmentNotes.root)) continue;

    const ensured = ensureNotesPart(pkg, noteKind);
    if (!ensured.ok || !ensured.package) return { ok: false, reason: 'merge-refused' };
    pkg = ensured.package;
    const targetNotes = resolveNotesPart(pkg, noteKind);
    if (!targetNotes) return { ok: false, reason: 'merge-refused' };

    let nextNoteId =
      maxNumericAttribute(targetNotes.root, (node) =>
        isNoteShaped(node, noteKind) ? attributeValueOf(node, 'id') : undefined
      ) + 1;

    const bodies: OoxmlNode[] = [];
    for (const child of fragmentNotes.root.children) {
      if (!isNoteShaped(child, noteKind)) continue;
      const id = attributeValueOf(child, 'id');
      const type = attributeValueOf(child, 'type');
      if (type === 'separator' || type === 'continuationSeparator') continue;
      if (id === undefined || !referenced.has(canonicalNoteId(id))) continue;
      // FIRST definition wins per canonical id, matching the closure's index: a
      // crafted '07'/'7' pair must not transplant two bodies with one id-map slot
      // (references would alias the second while the first orphans unseen).
      if (idMap.has(canonicalNoteId(id))) continue;
      const fresh = String(nextNoteId++);
      idMap.set(canonicalNoteId(id), fresh);
      bodies.push(withRewrittenAttribute(child, WML_NAMESPACE_URI, 'id', fresh));
    }
    if (bodies.length > 0) {
      // Note bodies are crafted-fragment content too: sanitize before transplant.
      transplants.push({
        kind: noteKind,
        fragmentPartName: fragmentNotes.name,
        bodies: sanitizeFragmentBlocks(bodies),
      });
    }
  }

  // ------------------------------------------------------------------
  // Unique-id namespaces — bookmarks, `wp:docPr`, SDT ids, revision ids — freshened over
  // the blocks AND the note bodies (the insert spec's "every namespace the fragment
  // carries"). One sequence per namespace keeps everything collision-free inside this paste;
  // `clipboard-fragment-unique-ids.ts` is what keeps it collision-free against a PEER's.
  // ------------------------------------------------------------------
  const ownerPart = pkg.parts.get(ownerPartName)!;
  const allTravelling: OoxmlNode[] = [...blocks, ...transplants.flatMap((entry) => entry.bodies)];

  // Collect the fragment-side id/name occurrences ONCE, so the target scans below run only
  // for namespaces the fragment actually carries — a plain paste pays for none of them.
  const fragmentBookmarkIds: string[] = [];
  const pastedBookmarkNames = new Set<string>();
  let fragmentHasRevision = false;
  let fragmentHasDocPr = false;
  const sdtIdMap = new Map<string, string>();
  walkAll(allTravelling, (node) => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'bookmarkStart' || node.kind === 'bookmarkEnd') {
      const id = attributeValueOf(node, 'id');
      if (id !== undefined) fragmentBookmarkIds.push(id);
      if (node.kind === 'bookmarkStart') {
        const name = attributeValueOf(node, 'name');
        if (name) pastedBookmarkNames.add(name);
      }
      return;
    }
    if (carriesPastedRevisionId(node)) {
      fragmentHasRevision = true;
      return;
    }
    if (node.kind === 'drawingDocPr') {
      fragmentHasDocPr = true;
      return;
    }
    if (node.kind === 'contentControlProperties') {
      for (const child of node.children) {
        if (!isWml(child, 'id')) continue;
        const value = attributeValueOf(child, 'val');
        if (value !== undefined && !sdtIdMap.has(value)) {
          let seed = 0;
          const basis = `${value}:${sdtIdMap.size}`;
          for (let index = 0; index < basis.length; index += 1) {
            seed = (seed * 31 + basis.charCodeAt(index)) >>> 0;
          }
          sdtIdMap.set(value, String(seed % 2147483647 || 1));
        }
      }
    }
  });

  // All three counters at once, striped per actor when a collaboration transaction bound one
  // and dense when none did. A refusal here is a namespace with no free id left; landing the
  // paste anyway would reuse an id the document already holds.
  const uniqueIds = mintFragmentUniqueIds({
    pkg,
    ownerPart,
    notesParts: transplants
      .map((transplant) => resolveNotesPart(pkg, transplant.kind))
      .filter((part): part is OoxmlPart => part !== null),
    travelling: allTravelling,
    fragmentBookmarkIds,
    hasRevision: fragmentHasRevision,
    hasDocPr: fragmentHasDocPr,
  });
  if (!uniqueIds) return { ok: false, reason: 'merge-refused' };
  const bookmarkIdMap = uniqueIds.bookmarkIds;
  const revisionIdMap = uniqueIds.revisionIds;
  const docPrIdMap = uniqueIds.docPrIds;

  // Pasted bookmark wins a name collision: the target's same-name markers go.
  if (pastedBookmarkNames.size > 0) {
    const collidingIds = new Set<string>();
    walkAll([ownerPart.root], (node) => {
      if (node.kind === 'textValue') return;
      if (node.kind === 'bookmarkStart') {
        const name = attributeValueOf(node, 'name');
        const id = attributeValueOf(node, 'id');
        if (name && id !== undefined && pastedBookmarkNames.has(name)) collidingIds.add(id);
      }
    });
    if (collidingIds.size > 0) {
      // One tree rebuild that drops every colliding marker, not a removeNode per marker
      // (each of which rebuilds the whole owner part — quadratic on a bookmark-heavy host).
      const dropCollidingMarkers = (node: OoxmlNode): OoxmlNode => {
        if (node.kind === 'textValue') return node;
        const children: OoxmlNode[] = [];
        let changed = false;
        for (const child of node.children) {
          if (
            (child.kind === 'bookmarkStart' || child.kind === 'bookmarkEnd') &&
            collidingIds.has(attributeValueOf(child, 'id') ?? '')
          ) {
            changed = true;
            continue;
          }
          const next = dropCollidingMarkers(child);
          if (next !== child) changed = true;
          children.push(next);
        }
        return changed ? ({ ...node, children } as OoxmlNode) : node;
      };
      const nextRoot = dropCollidingMarkers(ownerPart.root) as OoxmlElement;
      if (nextRoot !== ownerPart.root) {
        // A rebuilt root outside the op executors must carry its index — see the
        // invariant on `carryIndexToRebuiltRoot`.
        carryIndexToRebuiltRoot(ownerPart.root, nextRoot);
        pkg = withPart(pkg, { ...ownerPart, root: nextRoot });
      }
    }
  }

  // ------------------------------------------------------------------
  // Transplant note bodies: per-owner rels, full identifier rewrite, drop dangling
  // drawings, and the same default materialization the blocks get.
  // ------------------------------------------------------------------
  // Fail CLOSED on dangling note references (see clipboard-fragment-closure.ts).
  const scrubDanglingNoteRefs = (node: OoxmlNode): OoxmlNode =>
    withoutDanglingNoteReferences(node, footnoteIdMap, endnoteIdMap);

  for (const transplant of transplants) {
    transplant.bodies = transplant.bodies.map(scrubDanglingNoteRefs);
    const targetNotes = resolveNotesPart(pkg, transplant.kind);
    if (!targetNotes) return { ok: false, reason: 'merge-refused' };
    const noteRels = mergeRels(
      transplant.fragmentPartName,
      targetNotes.name,
      relationshipIdsIn(transplant.bodies)
    );
    let bodies = withoutDanglingDrawings(transplant.bodies, noteRels.dropRelIds);
    // Materialize before the rewrite — same original-id reason as the blocks below.
    bodies = [...materializeDefaults(bodies, fragmentStyles, targetStyles)];
    bodies = bodies.map((body) =>
      rewriteIdentifiers(body, {
        styleIds: styleIdMap,
        numIds: numIdMap,
        relIds: noteRels.relIdMap,
        footnoteIds: footnoteIdMap,
        endnoteIds: endnoteIdMap,
        bookmarkIds: bookmarkIdMap,
        sdtIds: sdtIdMap,
        revisionIds: revisionIdMap,
        docPrIds: docPrIdMap,
      })
    );
    const appendedPkg = appendToPart(pkg, pkg.parts.get(targetNotes.name)!, bodies);
    if (!appendedPkg) return { ok: false, reason: 'merge-refused' };
    pkg = appendedPkg;
  }

  // ------------------------------------------------------------------
  // Import styles and numbering into the target parts.
  // ------------------------------------------------------------------
  if (importedWithNames.length > 0) {
    const rewrittenImports = importedWithNames.map((style) =>
      rewriteIdentifiers(style, { styleIds: styleIdMap, numIds: numIdMap })
    );
    if (!targetStylesPart) {
      const authored = readOoxmlPart(`<w:styles xmlns:w="${WML_NAMESPACE_URI}"></w:styles>`, {
        name: '/word/styles.xml',
        contentType: STYLES_CT,
      });
      if (!authored.ok) return { ok: false, reason: 'merge-refused' };
      pkg = withNewPart(pkg, '/word/styles.xml', authored.part.root, STYLES_CT);
      const related = withRelationship(
        withRelationshipsPartFor(pkg, pkg.mainDocumentPart),
        pkg.mainDocumentPart,
        STYLES_REL,
        'styles.xml'
      );
      if (!related.ok) return { ok: false, reason: 'merge-refused' };
      pkg = related.pkg;
      targetStylesPart = pkg.parts.get('/word/styles.xml') ?? null;
    }
    if (!targetStylesPart) return { ok: false, reason: 'merge-refused' };
    const appended = appendToPart(pkg, pkg.parts.get(targetStylesPart.name)!, rewrittenImports);
    if (!appended) return { ok: false, reason: 'merge-refused' };
    pkg = appended;
    targetStyles = stylesInfoOf(pkg.parts.get(targetStylesPart.name) ?? null);
  }

  if (abstractsToImport.length > 0 || numsToImport.length > 0) {
    let numberingPart = relatedPart(
      pkg,
      pkg.mainDocumentPart,
      NUMBERING_REL,
      '/word/numbering.xml'
    );
    if (!numberingPart) {
      const authored = readOoxmlPart(`<w:numbering xmlns:w="${WML_NAMESPACE_URI}"></w:numbering>`, {
        name: '/word/numbering.xml',
        contentType: NUMBERING_CT,
      });
      if (!authored.ok) return { ok: false, reason: 'merge-refused' };
      pkg = withNewPart(pkg, '/word/numbering.xml', authored.part.root, NUMBERING_CT);
      const related = withRelationship(
        withRelationshipsPartFor(pkg, pkg.mainDocumentPart),
        pkg.mainDocumentPart,
        NUMBERING_REL,
        'numbering.xml'
      );
      if (!related.ok) return { ok: false, reason: 'merge-refused' };
      pkg = related.pkg;
      numberingPart = pkg.parts.get('/word/numbering.xml') ?? null;
    }
    if (!numberingPart) return { ok: false, reason: 'merge-refused' };
    // `w:abstractNum` elements precede every `w:num` per the schema.
    const current = pkg.parts.get(numberingPart.name)!;
    const firstNumIndex = current.root.children.findIndex((child) => isWml(child, 'num'));
    const abstractRewrites = abstractsToImport.map((node) =>
      rewriteIdentifiers(node, { styleIds: styleIdMap, numIds: numIdMap })
    );
    let appended = appendToPart(
      pkg,
      current,
      abstractRewrites,
      firstNumIndex === -1 ? undefined : firstNumIndex
    );
    if (!appended) return { ok: false, reason: 'merge-refused' };
    pkg = appended;
    appended = appendToPart(pkg, pkg.parts.get(numberingPart.name)!, numsToImport);
    if (!appended) return { ok: false, reason: 'merge-refused' };
    pkg = appended;
  }

  // ------------------------------------------------------------------
  // Rewrite the blocks and materialize defaults.
  // ------------------------------------------------------------------
  // Materialize BEFORE the identifier rewrite: `chainDefines` resolves style chains in
  // the FRAGMENT's styles part, which is keyed by original ids — a collision-remapped
  // `pStyle` would never resolve and the default value would stamp over the style's own.
  const materialized = [...materializeDefaults(blocks, fragmentStyles, targetStyles)].map(
    scrubDanglingNoteRefs
  );
  const rewritten = materialized.map((block) =>
    rewriteIdentifiers(block, {
      styleIds: styleIdMap,
      numIds: numIdMap,
      relIds: docRels.relIdMap,
      footnoteIds: footnoteIdMap,
      endnoteIds: endnoteIdMap,
      bookmarkIds: bookmarkIdMap,
      sdtIds: sdtIdMap,
      revisionIds: revisionIdMap,
      docPrIds: docPrIdMap,
    })
  );

  return { ok: true, pkg, blocks: rewritten };
}
