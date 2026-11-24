// The customXml DATA PART: a package-level XML store a document carries alongside its body,
// and the only place a payload too large for `w:tag` can live and still survive Word.
//
// WHY THIS SHAPE
//
// A run-level SDT anchors a host's node in the body, but `w:tag` caps at 64 characters, so
// anything larger needs somewhere else to sit. OOXML's answer is a custom XML data part:
// `/customXml/itemN.xml` holding the payload, `/customXml/itemPropsN.xml` giving it a
// `ds:itemID` GUID, and a `customXml` relationship from the story that owns it. An SDT binds
// to a node inside it through `w:dataBinding` (`@w:storeItemID` = that GUID, `@w:xpath` =
// the node), which is the one link Word itself maintains.
//
// The inline `w:customXml` ELEMENT is a different thing and is not what this writes: Word for
// the web refuses a document containing one outright. The data PART is what survives.
//
// The evidence is two fixtures. `sdt-custom-tag-word-roundtrip.docx` is Word's own output for
// a document carrying a store: parts, relationships and payload all came back intact, so Word
// emits and accepts this wiring. It carries no binding.
//
// `sdt-custom-node-databinding-word-roundtrip.docx` is what Word returned for a document that
// DOES carry one, and it settles the rest:
//
//   - `w:dataBinding` survives, with its `prefixMappings`, `storeItemID` and `xpath` intact;
//   - the payload in the store survives unchanged;
//   - `ds:itemID` still matches `w:storeItemID`;
//   - the child order below is right — Word refuses a document whose `sdtPr` children are out
//     of sequence, so a file that comes back at all had them in order;
//   - a bound control with no type child is READ-ONLY in Word. The text is painted from the
//     xpath and a user cannot type into it, which is why the store is the source of truth and
//     the two can never drift. Making one editable in Word means adding `<w:text/>` to turn
//     Word's binding two-way, which is an opt-in, not the default.
//
// One normalization to expect: Word drops `xml:space="preserve"` from the bound run when the
// text has no leading or trailing space, so a label that needs it must re-assert it.
//
// SECURITY: everything read back out of one of these parts came from a file the sender
// controls. This module writes and locates parts; it does not interpret payloads, and a caller
// that renders one owes it the same sanitizing every other file-derived value gets.

import type { OoxmlPackage } from './ooxml-package.ts';
import {
  relationshipsOf,
  relsPartNameFor,
  resolveContentTypeOf,
  withNewPart,
  withRelationship,
  withRelationshipsPartFor,
  withContentTypeOverride,
  withoutPart,
  type WithoutPartResult,
} from './package-edit.ts';
import { partNameKey, resolveInternalTarget } from './opc-names.ts';
import { isValidNCName } from './qname.ts';
import { readOoxmlPart, type OoxmlElement } from './ooxml-tree.ts';
import { fnv1a32 } from './para-id.ts';

/** Relationship from the story to one data part. */
export const CUSTOM_XML_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml';
/** Relationship from a data part to the properties that carry its `ds:itemID`. */
export const CUSTOM_XML_PROPS_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps';
/** `itemPropsN.xml` needs an Override; `itemN.xml` rides the package's `xml` default. */
export const CUSTOM_XML_PROPS_TYPE =
  'application/vnd.openxmlformats-officedocument.customXmlProperties+xml';
/** The datastore namespace `ds:datastoreItem` lives in. */
export const DATASTORE_NAMESPACE_URI =
  'http://schemas.openxmlformats.org/officeDocument/2006/customXml';

/** A data part located in a package: where it lives, and the GUID an SDT binds to. */
export interface CustomXmlDataPart {
  /** Canonical part name, e.g. `/customXml/item1.xml`. */
  readonly partName: string;
  /** Part name of its properties, e.g. `/customXml/itemProps1.xml`. */
  readonly propsPartName: string;
  /** `ds:itemID`, braced and upper-case, as `w:storeItemID` must spell it. */
  readonly itemId: string;
  /** Namespace URI of the payload root, which is what identifies one store among several. */
  readonly namespaceUri: string;
}

/**
 * A `ds:itemID` derived from the seed rather than drawn at random.
 *
 * Exported so a caller that authors a store OUTSIDE a package — a template engine splicing
 * markup it will assemble into a `.docx` later — mints the id the same way this does, rather
 * than inventing a second GUID shape Word has to be tolerant of.
 *
 * The store is a pure function of what it is asked to write: the same document written twice
 * has to produce the same bytes, or a save/reopen/save round trip stops being a fixed point
 * and every digest taken over saved bytes moves. A GUID's job here is uniqueness within one
 * package, not unguessability, so four FNV-1a passes over a salted seed carry it.
 */
export function datastoreItemIdFor(seed: string): string {
  const block = (salt: string): string =>
    fnv1a32(`${salt} ${seed}`).toString(16).padStart(8, '0').toUpperCase();
  const a = block('a');
  const b = block('b');
  const c = block('c');
  const d = block('d');
  // 8-4-4-4-12, the shape Word writes and expects to read back.
  return `{${a}-${b.slice(0, 4)}-${b.slice(4)}-${c.slice(0, 4)}-${c.slice(4)}${d}}`;
}

/**
 * Something stable that differs between documents, folded into every item id.
 *
 * Without it the id is a function of the namespace alone, so every document this library
 * writes carries the SAME GUID — and Word's data store dedupes on it. Paste a bound control
 * from one of our documents into another and Word declines to import the incoming store,
 * silently binding the pasted control to the host document's payload instead. Nothing repairs
 * that: Word preserves the GUID it is given rather than reissuing one.
 *
 * The bytes as loaded, over the parts that distinguish one document from another. Read once,
 * at mint time; afterwards the id is read back out of the store rather than recomputed, so
 * later edits cannot move it.
 *
 * The main part alone is not enough, and that gap is why this reads more than one: two
 * documents made from one corporate template have byte-identical body content the moment they
 * are opened, so a seed of body bytes alone hands them the same GUID — and Word's data store
 * dedupes on it, so a bound control pasted from one into the other binds to the wrong payload.
 * `core.xml` carries the revision and the modified time, `settings.xml` the editing-session
 * rsids: two documents that have been edited at all differ in those long before they differ
 * in anything else.
 *
 * Two byte-identical packages still seed identically. That is the correct answer — they are
 * the same document, and their stores hold the same payload.
 */
const IDENTITY_PARTS = ['/docProps/core.xml', '/word/settings.xml'];

function documentIdentityOf(pkg: OoxmlPackage): string {
  // FNV-1a over the bytes themselves: `fnv1a32` takes a string, and decoding a megabyte of
  // XML to hash it would cost more than the hash.
  let hash = 0x811c9dc5;
  let length = 0;
  for (const name of [pkg.mainDocumentPart, ...IDENTITY_PARTS]) {
    const bytes = pkg.partBytes.get(name);
    if (!bytes) continue;
    length += bytes.length;
    for (const byte of bytes) {
      hash ^= byte;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return `${pkg.mainDocumentPart}#${String(length)}#${hash.toString(16)}`;
}

/** `<dir>/_rels/<file>.rels` — never a payload store, whatever points at it. */
const RELS_PART = /\/_rels\/[^/]*\.rels$/i;

/** A relationship target for `to`, written relative to `from`'s own directory. */
export function relativeTarget(from: string, to: string): string {
  const fromParts = from.split('/').slice(1, -1);
  const toParts = to.split('/').slice(1);
  let shared = 0;
  while (
    shared < fromParts.length &&
    shared < toParts.length - 1 &&
    fromParts[shared] === toParts[shared]
  ) {
    shared += 1;
  }
  const up = '../'.repeat(fromParts.length - shared);
  return `${up}${toParts.slice(shared).join('/')}`;
}

function itemNames(index: number): { readonly item: string; readonly props: string } {
  return {
    item: `/customXml/item${String(index)}.xml`,
    props: `/customXml/itemProps${String(index)}.xml`,
  };
}

function parsePart(name: string, xml: string): OoxmlElement | null {
  const parsed = readOoxmlPart(xml, { name, contentType: 'application/xml' });
  return parsed.ok ? parsed.part.root : null;
}

function itemIdOf(pkg: OoxmlPackage, propsPartName: string): string | null {
  const part = pkg.parts.get(propsPartName);
  if (!part) return null;
  const id = part.root.attributes.find(
    (a) => a.localName === 'itemID' && a.namespaceUri === DATASTORE_NAMESPACE_URI
  );
  return id && id.value.length > 0 ? id.value : null;
}

/**
 * The data parts a story relates to, in relationship order.
 *
 * Reads the relationships rather than scanning `/customXml/` by name: a part nothing relates
 * to is not part of the document, and a package from a hostile sender can hold as many
 * plausibly-named files as it likes.
 */
export function customXmlDataParts(pkg: OoxmlPackage, storyPartName: string): CustomXmlDataPart[] {
  const found: CustomXmlDataPart[] = [];
  for (const rel of relationshipsOf(pkg, storyPartName)) {
    if (rel.type !== CUSTOM_XML_REL) continue;
    // An External target is a URL. Resolving one as a part name would either miss or, for a
    // relative-looking one, name a part the document does not actually carry.
    if (rel.targetMode === 'External') continue;
    const resolved = resolveInternalTarget(storyPartName, rel.rawTarget);
    if (!resolved.ok) continue;
    const part = pkg.parts.get(resolved.partName);
    if (!part) continue;
    // A relationship of the right type is the sender's claim, not proof. Without the checks
    // below, any XML part in the package can be presented as a store — including
    // `/word/_rels/document.xml.rels`, which a caller would then write payload nodes into,
    // producing a relationships part with foreign children that Word repairs away.
    if (RELS_PART.test(resolved.partName)) continue;
    const props = relationshipsOf(pkg, resolved.partName).find(
      (r) => r.type === CUSTOM_XML_PROPS_REL && r.targetMode !== 'External'
    );
    if (!props) continue;
    const resolvedProps = resolveInternalTarget(resolved.partName, props.rawTarget);
    if (!resolvedProps.ok) continue;
    // The properties must actually BE properties. A planted rels part otherwise lets a sender
    // choose which `ds:itemID` we hand back, and so which store Word binds the control to.
    if (resolveContentTypeOf(pkg, resolvedProps.partName) !== CUSTOM_XML_PROPS_TYPE) continue;
    const itemId = itemIdOf(pkg, resolvedProps.partName);
    if (itemId === null) continue;
    found.push({
      partName: resolved.partName,
      propsPartName: resolvedProps.partName,
      itemId,
      namespaceUri: part.root.namespaceUri,
    });
  }
  return found;
}

/** The data part carrying this namespace, or null when the document has none yet. */
export function findCustomXmlDataPart(
  pkg: OoxmlPackage,
  storyPartName: string,
  namespaceUri: string
): CustomXmlDataPart | null {
  return (
    customXmlDataParts(pkg, storyPartName).find((p) => p.namespaceUri === namespaceUri) ?? null
  );
}

/** What {@link withCustomXmlDataPart} answers. */
export interface CustomXmlDataPartResult {
  readonly pkg: OoxmlPackage;
  /** Null when the part could not be authored; the package then comes back unchanged. */
  readonly part: CustomXmlDataPart | null;
}

/**
 * Ensure the document carries a data part for this namespace, creating it and everything it
 * needs — properties, both relationships, the properties content type — when it does not.
 *
 * Idempotent: a package that already has one for the namespace comes back untouched, so a
 * second node added to the same store does not author a second store.
 *
 * @param storyPartName - Whose relationships the store hangs off. Word enumerates its data
 * store from the MAIN DOCUMENT part, so a store authored off a header or footer is one Word
 * never sees.
 */
export function withCustomXmlDataPart(
  pkg: OoxmlPackage,
  storyPartName: string,
  namespaceUri: string,
  rootLocalName: string
): CustomXmlDataPartResult {
  const existing = findCustomXmlDataPart(pkg, storyPartName, namespaceUri);
  if (existing) {
    // THE ROOT NAME HAS TO MATCH TOO. A store is located by namespace, but a binding's xpath
    // names the ROOT — so reusing a store whose root is called something else authors
    // `/ns0:asked/ns0:node[…]` into a part whose root is `<got>`, and Word resolves that to
    // nothing and paints an empty control. Two ways in: a caller passing a second root name for
    // one namespace, and a file that planted a store under a namespace this host claims.
    const root = pkg.parts.get(existing.partName)?.root;
    if (root && root.localName !== rootLocalName) return { pkg, part: null };
    return { pkg, part: existing };
  }

  // An element name is not an attribute value: escaping cannot rescue a bad one, because the
  // injection lands in NAME position where `evil xmlns:q="urn:q" q:attr="1"` is markup and not
  // text. Only an NCName may be templated in.
  if (!isValidNCName(rootLocalName)) return { pkg, part: null };

  // First free index, so a document that already carries Word's own stores (the Cover Page
  // Properties one is in most templates) gains a sibling rather than overwriting one.
  //
  // Case-folded, over `partBytes` as well as `parts`, and counting the item's own `.rels`:
  //  - OPC treats `/customXml/Item1.xml` as the same part as `item1.xml`, and `withNewPart`
  //    refuses the duplicate, which would strand this on index 1 forever;
  //  - a part whose content type does not resolve never becomes a tree, so a scan of `parts`
  //    alone authors over bytes it cannot see and drops that payload on save;
  //  - a package holding `/customXml/_rels/item1.xml.rels` but no `item1.xml` is not broken,
  //    it is a trap: authoring there adopts every relationship already sitting in it, including
  //    a `customXmlProps` naming someone else's properties — which decides the `ds:itemID` a
  //    binding quotes — and any `External` target, which then ships inside a part we own.
  const taken = new Set<string>();
  for (const name of pkg.parts.keys()) taken.add(partNameKey(name));
  for (const name of pkg.partBytes.keys()) taken.add(partNameKey(name));
  const free = (candidate: number): boolean => {
    const { item, props } = itemNames(candidate);
    return (
      !taken.has(partNameKey(item)) &&
      !taken.has(partNameKey(props)) &&
      !taken.has(partNameKey(relsPartNameFor(item)))
    );
  };
  let index = 1;
  while (!free(index)) index += 1;
  const names = itemNames(index);
  // Derivation is public and the package is the sender's, so a store precomputed with our own
  // id is cheap to plant: two stores, one `ds:itemID`, and Word binds to whichever it prefers.
  // Re-salt until the id is one the package does not already carry.
  const used = existingItemIds(pkg);
  const seed = `${documentIdentityOf(pkg)} ${storyPartName} ${namespaceUri} ${names.item}`;
  let itemId = datastoreItemIdFor(seed);
  for (let salt = 1; used.has(itemId.toUpperCase()) && salt < 64; salt += 1) {
    itemId = datastoreItemIdFor(`${seed} ${String(salt)}`);
  }
  if (used.has(itemId.toUpperCase())) return { pkg, part: null };

  const namespaceAttr = attributeValue(namespaceUri);
  const itemIdAttr = attributeValue(itemId);
  if (namespaceAttr === null || itemIdAttr === null) return { pkg, part: null };

  const itemRoot = parsePart(names.item, `<${rootLocalName} xmlns="${namespaceAttr}"/>`);
  const propsRoot = parsePart(
    names.props,
    `<ds:datastoreItem ds:itemID="${itemIdAttr}" xmlns:ds="${DATASTORE_NAMESPACE_URI}">` +
      `<ds:schemaRefs><ds:schemaRef ds:uri="${namespaceAttr}"/></ds:schemaRefs>` +
      `</ds:datastoreItem>`
  );
  if (!itemRoot || !propsRoot) return { pkg, part: null };

  let next = withNewPart(pkg, names.item, itemRoot, 'application/xml');
  next = withNewPart(next, names.props, propsRoot, CUSTOM_XML_PROPS_TYPE);
  if (!next.parts.has(names.item) || !next.parts.has(names.props)) return { pkg, part: null };
  next = withContentTypeOverride(next, names.props, CUSTOM_XML_PROPS_TYPE);

  // Relative TO THE STORY. `../customXml/…` is only right when the story sits exactly one
  // directory deep, and the main document part comes from the root `.rels`, which the file
  // chooses — a root-level `/document.xml` made that target escape the package, so the store
  // never read back, idempotency was lost, and every call authored another one.
  // The STORY's `.rels` too, not just the item's. A document that has never needed a
  // relationship carries no `.rels` for its main part — a bare two-part package is legal and
  // Word opens one — and `withRelationship` refuses rather than inventing the part, so without
  // this the first store a document ever gets is refused with `store-not-authored`.
  const stored = withRelationship(
    withRelationshipsPartFor(next, storyPartName),
    storyPartName,
    CUSTOM_XML_REL,
    relativeTarget(storyPartName, names.item)
  );
  if (!stored.ok) return { pkg, part: null };
  // The item part is new, so it has no `.rels` of its own to write into yet.
  const propsRelated = withRelationship(
    withRelationshipsPartFor(stored.pkg, names.item),
    names.item,
    CUSTOM_XML_PROPS_REL,
    `itemProps${String(index)}.xml`
  );
  if (!propsRelated.ok) return { pkg, part: null };

  // Read it back before claiming it. Everything above can succeed while the result is not
  // something `findCustomXmlDataPart` will ever locate again, and a store that cannot be found
  // is a store the next call authors a duplicate of.
  const readBack = findCustomXmlDataPart(propsRelated.pkg, storyPartName, namespaceUri);
  if (!readBack || readBack.partName !== names.item) return { pkg, part: null };

  return {
    pkg: propsRelated.pkg,
    part: { partName: names.item, propsPartName: names.props, itemId, namespaceUri },
  };
}

/**
 * An attribute value, or null when the input cannot be one.
 *
 * REFUSING rather than stripping. The earlier version dropped the characters XML cannot
 * represent, which silently changed the value — and a store is located by comparing the
 * namespace it was asked for against the one parsed back, so a namespace holding a control
 * character was written stripped, never matched on read, and authored ANOTHER store pair on
 * every single call until the document blew past the reader's part cap.
 */
function attributeValue(value: string): string | null {
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(value)) return null;
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Every `ds:itemID` the package already carries, however the store got there. */
function existingItemIds(pkg: OoxmlPackage): Set<string> {
  const found = new Set<string>();
  for (const part of pkg.parts.values()) {
    if (part.root.localName !== 'datastoreItem') continue;
    if (part.root.namespaceUri !== DATASTORE_NAMESPACE_URI) continue;
    const id = part.root.attributes.find(
      (a) => a.localName === 'itemID' && a.namespaceUri === DATASTORE_NAMESPACE_URI
    );
    if (id) found.add(id.value.toUpperCase());
  }
  return found;
}

/**
 * Remove a store from a document: both parts, both relationships, the Override.
 *
 * PACKAGE ONLY. It does not touch the body, so a `w:sdt` bound to the store keeps its
 * `w:dataBinding`, its `w:storeItemID` and its `w:tag`, and Word then opens a control bound to
 * a store that is not there. Stripping those is the export path's job and is not built; this
 * is the half that removes the payload, which is the half a caller can rely on.
 *
 * `ok: false` means nothing was removed and the package is unchanged — most often because an
 * owner's `.rels` was never parsed into a tree, which {@link withoutPart} refuses to work
 * around. A caller exporting a document has to treat that as a failure to export rather than
 * as a document with nothing to strip, or it ships the payload it meant to remove.
 */
export function withoutCustomXmlDataPart(
  pkg: OoxmlPackage,
  storyPartName: string,
  namespaceUri: string
): WithoutPartResult {
  let next = pkg;
  // Every store for the namespace, not the first: a document can carry two, and "the export
  // leaves no record of it" is false if one survives.
  for (const store of customXmlDataParts(pkg, storyPartName)) {
    if (store.namespaceUri !== namespaceUri) continue;
    const item = withoutPart(next, store.partName);
    if (!item.ok) return { pkg, ok: false };
    const props = withoutPart(item.pkg, store.propsPartName);
    if (!props.ok) return { pkg, ok: false };
    next = props.pkg;
  }
  // Nothing to remove is a success: the document already carries no such store.
  return { pkg: next, ok: true };
}
