// Shared OOXML name machinery.
//
// This module owns the namespace constants, QName resolution/canonicalization and the
// known-kind shape rules that the ooxml-tree read path, the canonical serializer
// (ooxml-serialize) and the invariant validator (ooxml-validate) all consume. It lives
// apart from all three so none of them has to import another for a constant — the type
// imports below are erased, so the module graph stays acyclic at runtime.

import { isXmlNCName } from './qname.ts';
import {
  validContentControlCheckboxChildren,
  validContentControlChildren,
  validContentControlContentChildren,
  validContentControlDateChildren,
  validContentControlDropDownOrComboChildren,
  validContentControlEndPropertiesChildren,
  validContentControlPropertiesChildren,
  validEmptySdtPayload,
} from './ooxml-sdt.ts';
import { isDrawingKnownKind, validDrawingKnownKind } from './ooxml-drawing-rules.ts';
import type { OoxmlAttribute, OoxmlElement, OoxmlNode, OoxmlReadRejection } from './ooxml-tree.ts';

export { knownKindAllowsWmlVal } from './ooxml-sdt.ts';

// No `as const` on the three below: a `const` bound to a string literal is already
// literal-typed, and `typeof WML_NAMESPACE_URI` / `typeof XML_NAMESPACE_URI` are read by
// the typed attribute kinds in `ooxml-tree.ts`. API Extractor 7.x crashes ("Unable to
// follow symbol for 'const'", rushstack#4754) whenever a public type reaches an
// `as const` variable declaration, and any public type that reaches `OoxmlElement` drags
// these attribute kinds along with it. Same reason `CHROME_GROUPS` in
// `editor/chrome-controls.ts` avoids the derived-from-`as const` form.
/** The WordprocessingML main namespace — the `w:` prefix in every `word/document.xml`. */
export const WML_NAMESPACE_URI = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
/** The reserved `xml:` namespace, which carries `xml:space`. */
export const XML_NAMESPACE_URI = 'http://www.w3.org/XML/1998/namespace';
/** The reserved `xmlns:` namespace that namespace declarations themselves live in. */
export const XMLNS_NAMESPACE_URI = 'http://www.w3.org/2000/xmlns/';
export const MC_NAMESPACE_URI = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
export const XSI_NAMESPACE_URI = 'http://www.w3.org/2001/XMLSchema-instance';
/** The `w14` wordml-2010 extension namespace — `w14:paraId`/`w14:textId` live here. */
export const W14_NAMESPACE_URI = 'http://schemas.microsoft.com/office/word/2010/wordml';
/** @internal */
export const DRAWINGML_MAIN_NAMESPACE_URI = 'http://schemas.openxmlformats.org/drawingml/2006/main';
export const WP_NAMESPACE_URI =
  'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
export const PIC_NAMESPACE_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
export const RELATIONSHIPS_NAMESPACE_URI =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
/** `a:graphicData/@uri` for a DrawingML picture payload. */
export const PIC_GRAPHIC_DATA_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
export const MC_QNAME_LIST_ATTRIBUTES = new Set([
  'ProcessContent',
  'PreserveElements',
  'PreserveAttributes',
]);

export type KnownKind = Exclude<OoxmlElement['kind'], 'generic'>;

export class TreeReadError extends Error {
  constructor(readonly reason: OoxmlReadRejection) {
    super(reason);
  }
}

export interface ExpandedName {
  readonly prefix?: string;
  readonly localName: string;
}

export function splitQName(name: string): ExpandedName {
  const colon = name.indexOf(':');
  if (colon < 0) {
    if (!isXmlNCName(name)) throw new TreeReadError('invalid-name');
    return { localName: name };
  }
  if (name.indexOf(':', colon + 1) >= 0) throw new TreeReadError('invalid-name');
  const prefix = name.slice(0, colon);
  const localName = name.slice(colon + 1);
  if (!isXmlNCName(prefix) || !isXmlNCName(localName)) throw new TreeReadError('invalid-name');
  return { prefix, localName };
}

/**
 * {@link splitQName} for names that repeat across a part. A long document repeats a few
 * hundred element and attribute names millions of times, and each one was validated again.
 * Bounded, so a part of unique names cannot grow it without limit. Results are frozen and
 * shared; a failing name still throws every time, because it is never stored.
 */
const qNames = new Map<string, ExpandedName>();
const MAX_SHARED_QNAMES = 4096;

export function splitQNameShared(authoredName: string): ExpandedName {
  let name = qNames.get(authoredName);
  if (name) return name;
  name = Object.freeze(splitQName(authoredName));
  if (qNames.size < MAX_SHARED_QNAMES) qNames.set(authoredName, name);
  return name;
}

/** Attribute lists shorter than this find duplicates by a scan instead of a set. */
const SCANNED_ATTRIBUTES = 8;

/**
 * Throw when `attributes` already holds the expanded name. Most lists are short, and a scan
 * beats a set and a key string per element. A long list (file input is untrusted) switches to
 * a set kept in `state`, so the whole check stays linear.
 */
export function rejectDuplicateAttribute(
  attributes: readonly { readonly namespaceUri: string; readonly localName: string }[],
  namespaceUri: string,
  localName: string,
  state: { seen: Set<string> | undefined }
): void {
  if (attributes.length < SCANNED_ATTRIBUTES) {
    for (const earlier of attributes) {
      if (earlier.localName === localName && earlier.namespaceUri === namespaceUri)
        throw new TreeReadError('duplicate-expanded-attribute');
    }
    return;
  }
  if (!state.seen) {
    state.seen = new Set();
    for (const earlier of attributes)
      state.seen.add(expandedKey(earlier.namespaceUri, earlier.localName));
  }
  const key = expandedKey(namespaceUri, localName);
  if (state.seen.has(key)) throw new TreeReadError('duplicate-expanded-attribute');
  state.seen.add(key);
}

export function expandedKey(namespaceUri: string, localName: string): string {
  return `${namespaceUri}\u0000${localName}`;
}

export function resolvedQNameToken(
  token: string,
  bindings: ReadonlyMap<string, string>
): readonly [string, string] {
  const name = splitQName(token);
  const namespaceUri =
    name.prefix === undefined ? (bindings.get('') ?? '') : bindings.get(name.prefix);
  if (namespaceUri === undefined) throw new TreeReadError('undeclared-prefix');
  return [namespaceUri, name.localName];
}

export function resolvedPrefixNamespaceSet(
  value: string,
  bindings: ReadonlyMap<string, string>
): readonly string[] {
  const namespaceUris = value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((prefix) => {
      if (!isXmlNCName(prefix)) throw new TreeReadError('invalid-name');
      const namespaceUri = bindings.get(prefix);
      if (namespaceUri === undefined) throw new TreeReadError('undeclared-prefix');
      return namespaceUri;
    });
  return [...new Set(namespaceUris)].sort();
}

export function canonicalQNameAttributeValue(
  attribute: OoxmlAttribute,
  bindings: ReadonlyMap<string, string>,
  ownerNamespaceUri: string,
  ownerLocalName: string
): string {
  if (
    (attribute.namespaceUri === MC_NAMESPACE_URI &&
      (attribute.localName === 'Ignorable' || attribute.localName === 'MustUnderstand')) ||
    (ownerNamespaceUri === MC_NAMESPACE_URI &&
      ownerLocalName === 'Choice' &&
      attribute.namespaceUri === '' &&
      attribute.localName === 'Requires')
  ) {
    return resolvedPrefixNamespaceSet(attribute.value, bindings).join(' ');
  }
  if (
    attribute.namespaceUri === MC_NAMESPACE_URI &&
    MC_QNAME_LIST_ATTRIBUTES.has(attribute.localName)
  ) {
    return attribute.value
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((token) => JSON.stringify(resolvedQNameToken(token, bindings)))
      .sort()
      .join(' ');
  }
  if (attribute.namespaceUri === XSI_NAMESPACE_URI && attribute.localName === 'type') {
    return JSON.stringify(resolvedQNameToken(attribute.value.trim(), bindings));
  }
  return attribute.value;
}

export function validateQNameAttributeValues(
  attributes: readonly OoxmlAttribute[],
  bindings: ReadonlyMap<string, string>,
  ownerNamespaceUri: string,
  ownerLocalName: string
): void {
  for (const attribute of attributes)
    canonicalQNameAttributeValue(attribute, bindings, ownerNamespaceUri, ownerLocalName);
}

/**
 * The `w:pPr` children that legally FOLLOW `w:rPr`.
 *
 * `CT_PPr` (ECMA-376 17.3.1.26) is `CT_PPrBase`, then `w:rPr`, then `w:sectPr`, then
 * `w:pPrChange` — so the paragraph-mark properties are NOT last. Requiring them to be
 * demoted the `w:pPr` of every section-ending paragraph, and of every paragraph carrying a
 * tracked property change, to a generic node: the tree still round-tripped it, but nothing
 * downstream could read the paragraph's style, alignment, indent or numbering out of it,
 * and writing a paragraph mark onto a section-ending paragraph produced a document that
 * reopened demoted.
 */
const PPR_ELEMENTS_AFTER_RPR = new Set(['sectPr', 'pPrChange']);

/** The four content-position revision wrappers, which nest and carry runs. */
export function isContentRevisionKind(
  kind: OoxmlNode['kind']
): kind is 'revisionInsert' | 'revisionDelete' | 'revisionMoveFrom' | 'revisionMoveTo' {
  return (
    kind === 'revisionInsert' ||
    kind === 'revisionDelete' ||
    kind === 'revisionMoveFrom' ||
    kind === 'revisionMoveTo'
  );
}

/** Total transparent-container depth available to every paragraph-inline walk. */
export const MAX_INLINE_CONTAINER_DEPTH = 32;

/** Depth inherited by a node's children in the shared paragraph-inline address space. */
export function nextInlineContainerDepth(node: OoxmlNode, depth: number): number {
  const contentControl =
    node.kind === 'contentControl' ||
    (node.kind === 'generic' &&
      node.namespaceUri === WML_NAMESPACE_URI &&
      node.localName === 'sdt');
  return isInlineRunContainer(node) || contentControl ? depth + 1 : depth;
}

/** Whether a run/block-polymorphic wrapper contains block-level content. */
function hasBlockContent(node: OoxmlElement, depth = 0): boolean {
  // Exhaustion hides deeper content; it is not evidence of block-level children.
  if (depth >= MAX_INLINE_CONTAINER_DEPTH) return false;
  for (const child of node.children) {
    if (child.kind === 'textValue') continue;
    if (
      child.kind === 'paragraph' ||
      child.kind === 'table' ||
      child.kind === 'tableRow' ||
      child.kind === 'tableCell'
    ) {
      return true;
    }
    const nestedContainer =
      child.kind === 'contentControl' ||
      child.kind === 'contentControlContent' ||
      (child.kind === 'generic' &&
        child.namespaceUri === WML_NAMESPACE_URI &&
        child.localName === 'customXml');
    if (nestedContainer && hasBlockContent(child, depth + 1)) return true;
  }
  return false;
}

/** A paragraph-level wrapper whose descendants contribute ordinary run content. */
export function isInlineRunContainer(node: OoxmlNode): node is Extract<
  OoxmlElement,
  {
    readonly kind:
      | 'generic'
      | 'hyperlink'
      | 'revisionInsert'
      | 'revisionDelete'
      | 'revisionMoveFrom'
      | 'revisionMoveTo';
  }
> {
  if (node.kind === 'textValue') return false;
  if (node.kind === 'hyperlink' || isContentRevisionKind(node.kind)) return true;
  if (node.kind !== 'generic' || node.namespaceUri !== WML_NAMESPACE_URI) return false;
  if (node.localName === 'customXml') return !hasBlockContent(node);
  return node.localName === 'smartTag' || node.localName === 'dir' || node.localName === 'bdo';
}

/** Move-range and comment-range boundary markers, which are empty and sit between runs. */
export function isRangeMarkerKind(
  kind: OoxmlNode['kind']
): kind is
  | 'moveFromRangeStart'
  | 'moveFromRangeEnd'
  | 'moveToRangeStart'
  | 'moveToRangeEnd'
  | 'commentRangeStart'
  | 'commentRangeEnd' {
  return (
    kind === 'moveFromRangeStart' ||
    kind === 'moveFromRangeEnd' ||
    kind === 'moveToRangeStart' ||
    kind === 'moveToRangeEnd' ||
    kind === 'commentRangeStart' ||
    kind === 'commentRangeEnd'
  );
}

/**
 * Content that is PRESERVED rather than structural, and may therefore sit anywhere a
 * `generic` child may sit.
 *
 * Bookmark markers are the reason this exists. Word writes them between block-level
 * siblings as freely as it writes them between runs — around a table, around a row, at the
 * top of the body — so once they carry a typed kind, every container that previously
 * accepted them only as `generic` would stop recognising its own children and DEMOTE. A
 * demoted `w:body` is not a cosmetic loss: nothing downstream finds a paragraph in it, so a
 * document with one stray bookmark would open blank. Admitting them wherever `generic` is
 * admitted keeps typing them additive.
 *
 * The move-range and comment-range markers are the same class and join for the same reason:
 * `EG_RangeMarkupElements` sits in `EG_PContent` and between block-level siblings alike, so a
 * comment anchored across a table boundary would otherwise demote the container holding it.
 */
function isPreservedChild(child: OoxmlNode): boolean {
  return (
    child.kind === 'generic' ||
    child.kind === 'bookmarkStart' ||
    child.kind === 'bookmarkEnd' ||
    child.kind === 'hyperlink' ||
    isRangeMarkerKind(child.kind) ||
    // Block/inline/row/cell `w:sdt` appears wherever `EG_*Content` admits it — same additive
    // typing rationale as bookmarks. Demoting a parent body/cell because a control typed
    // would blank the story.
    child.kind === 'contentControl'
  );
}

export function validKnownKind(kind: KnownKind, children: readonly OoxmlNode[]): boolean {
  if (isDrawingKnownKind(kind)) return validDrawingKnownKind(kind, children);
  switch (kind) {
    case 'document':
      return (
        children.every((child) => child.kind === 'body' || isPreservedChild(child)) &&
        children.filter((child) => child.kind === 'body').length === 1
      );
    case 'body':
      return children.every(
        (child) => child.kind === 'paragraph' || child.kind === 'table' || isPreservedChild(child)
      );
    case 'paragraph': {
      const properties = children.findIndex((child) => child.kind === 'paragraphProperties');
      return (
        children.every(
          (child) =>
            child.kind === 'paragraphProperties' ||
            child.kind === 'run' ||
            isContentRevisionKind(child.kind) ||
            child.kind === 'fldSimple' ||
            isPreservedChild(child)
        ) &&
        (properties < 0 || properties === 0) &&
        children.filter((child) => child.kind === 'paragraphProperties').length <= 1
      );
    }
    /**
     * A hyperlink holds runs and range markers. Anything else it wraps — a drawing, a
     * complex field, a nested content control — stays generic AT ITS POSITION rather than
     * demoting the link, so the runs beside it still paint and the link identity survives.
     *
     * `isPreservedChild` admits `hyperlink`, so a link nested in a link stays TYPED. That is
     * not an accident of sharing the helper: `CT_Hyperlink`'s content model is `EG_PContent`
     * (ECMA-376 §17.16.22), which lists `w:hyperlink` among its members, so nesting is
     * schema-legal and a reader that demoted it would stop the inner link's runs painting.
     */
    case 'hyperlink':
      // `EG_PContent` includes the revision wrappers, and a tracked edit inside a link is
      // ordinary, so a `w:ins` here must not demote the link.
      return children.every(
        (child) =>
          child.kind === 'run' ||
          child.kind === 'drawing' ||
          // `w:fldSimple` is an `EG_PContent` member too, and a linked heading followed by its
          // page number is exactly how a table of contents entry is written. Omitting it
          // demoted the LINK, and layout drops a generic paragraph child whole — so the entry's
          // words and its number both disappeared, not just the field.
          child.kind === 'fldSimple' ||
          isContentRevisionKind(child.kind) ||
          isPreservedChild(child)
      );
    case 'bookmarkStart':
    case 'bookmarkEnd':
      return children.length === 0;
    case 'run': {
      const properties = children.findIndex((child) => child.kind === 'runProperties');
      return (
        children.every(
          (child) =>
            child.kind === 'runProperties' ||
            child.kind === 'text' ||
            child.kind === 'deletedText' ||
            child.kind === 'tab' ||
            child.kind === 'hardBreak' ||
            child.kind === 'bookmarkStart' ||
            child.kind === 'bookmarkEnd' ||
            child.kind === 'commentReference' ||
            child.kind === 'fldChar' ||
            child.kind === 'instrText' ||
            child.kind === 'noteReference' ||
            child.kind === 'noteRef' ||
            child.kind === 'separator' ||
            child.kind === 'continuationSeparator' ||
            child.kind === 'drawing' ||
            child.kind === 'generic'
        ) &&
        (properties < 0 || properties === 0) &&
        children.filter((child) => child.kind === 'runProperties').length <= 1
      );
    }
    // Revision wrappers carry run-level content and may nest — an insertion inside a
    // deletion is ordinary in a two-round review. Deliberately permissive, like the table
    // arms: demotion to generic is the safe fallback and generic round-trips losslessly.
    case 'revisionInsert':
    case 'revisionDelete':
    case 'revisionMoveFrom':
    case 'revisionMoveTo':
      return children.every(
        (child) =>
          child.kind === 'run' ||
          child.kind === 'drawing' ||
          // Admitted DELIBERATELY WIDER than the schema: `CT_RunTrackChange` takes
          // `EG_ContentRunContent`, which does not list `w:fldSimple` (that is `EG_PContent`).
          // Word writes the shape anyway for an inserted cross-reference, and refusing it
          // demoted the WRAPPER rather than the field — the revision stopped being a revision,
          // so the insertion left the page and the review surface together. Demotion is the
          // safe fallback only where the thing demoted is the odd one out; here it is not.
          child.kind === 'fldSimple' ||
          isContentRevisionKind(child.kind) ||
          isPreservedChild(child)
      );
    // Range markers and the comment reference are empty elements. Any child means this is
    // not the element the schema describes, so it demotes rather than being trusted.
    case 'moveFromRangeStart':
    case 'moveFromRangeEnd':
    case 'moveToRangeStart':
    case 'moveToRangeEnd':
    case 'commentRangeStart':
    case 'commentRangeEnd':
    case 'commentReference':
      return children.length === 0;
    case 'comments':
      return children.every((child) => child.kind === 'comment' || isPreservedChild(child));
    case 'comment':
      return children.every(
        (child) => child.kind === 'paragraph' || child.kind === 'table' || isPreservedChild(child)
      );
    case 'runProperties':
      return children.every((child) => child.kind === 'generic');
    case 'paragraphProperties': {
      const runProperties = children.findIndex((child) => child.kind === 'runProperties');
      return (
        children.every((child) => child.kind === 'runProperties' || child.kind === 'generic') &&
        children.filter((child) => child.kind === 'runProperties').length <= 1 &&
        (runProperties < 0 ||
          children
            .slice(runProperties + 1)
            .every(
              (child) =>
                child.kind === 'generic' &&
                child.namespaceUri === WML_NAMESPACE_URI &&
                PPR_ELEMENTS_AFTER_RPR.has(child.localName)
            ))
      );
    }
    case 'text':
    case 'deletedText':
      return children.every((child) => child.kind === 'textValue');
    case 'tab':
    case 'hardBreak':
      return children.length === 0;
    case 'fldChar':
      // `w:ffData` and any other payload stay generic — never typed as executable.
      return children.every((child) => child.kind === 'generic');
    case 'instrText':
      return children.every((child) => child.kind === 'textValue');
    /**
     * `CT_SimpleField`'s content model is `EG_PContent` (§17.16.19), exactly like a
     * hyperlink's — so a revision wrapper inside one is schema-legal and must not demote it.
     *
     * It is also the ONLY way to strike a simple field: `CT_RunTrackChange` takes
     * `EG_ContentRunContent`, which has no `w:fldSimple` in it, so the deletion cannot go
     * around the field and has to go inside it. Word writes that shape, and refusing it here
     * demoted every such field to `generic` on READ as well — losing its addressing.
     */
    case 'fldSimple':
      return children.every(
        (child) =>
          child.kind === 'run' || isContentRevisionKind(child.kind) || isPreservedChild(child)
      );
    case 'footnotes':
    case 'endnotes':
      return children.every((child) => child.kind === 'note' || child.kind === 'generic');
    case 'note':
      // The same block content model as `body`, through the same predicate. Spelling it out
      // separately drifted: the list admitted only `generic` where the body admits every
      // preserved child, so a bookmark, a hyperlink, a range marker or a content control
      // inside a `w:footnote` demoted the NOTE. A demoted note is not a note — it vanishes
      // from `notesOf`, its paragraphs leave `paragraphIdsIn`, and `enterNote` refuses, so a
      // footnote holding an ordinary content control could not be read or edited at all.
      return children.every(
        (child) => child.kind === 'paragraph' || child.kind === 'table' || isPreservedChild(child)
      );
    case 'noteReference':
    case 'noteRef':
    case 'separator':
    case 'continuationSeparator':
      return children.length === 0;
    // Table arms are deliberately permissive (no ordering constraints): demotion to
    // generic on any violation is the safe fallback, and generic round-trips losslessly.
    case 'table':
      return (
        children.every(
          (child) =>
            child.kind === 'tableRow' ||
            child.kind === 'tableProperties' ||
            child.kind === 'tableGrid' ||
            isPreservedChild(child)
        ) &&
        children.filter((child) => child.kind === 'tableProperties').length <= 1 &&
        children.filter((child) => child.kind === 'tableGrid').length <= 1
      );
    case 'tableRow':
      return children.every((child) => child.kind === 'tableCell' || isPreservedChild(child));
    case 'tableCell':
      return children.every(
        (child) => child.kind === 'paragraph' || child.kind === 'table' || isPreservedChild(child)
      );
    case 'tableGrid':
    case 'tableProperties':
      return children.every((child) => child.kind === 'generic');
    case 'contentControl':
      return validContentControlChildren(children);
    case 'contentControlProperties':
      return validContentControlPropertiesChildren(children);
    case 'contentControlEndProperties':
      return validContentControlEndPropertiesChildren(children);
    case 'contentControlContent':
      return validContentControlContentChildren(children);
    case 'contentControlDropDownList':
    case 'contentControlComboBox':
      return validContentControlDropDownOrComboChildren(children);
    case 'contentControlDate':
      return validContentControlDateChildren(children);
    case 'contentControlCheckbox':
      return validContentControlCheckboxChildren(children);
    case 'contentControlListItem':
    case 'contentControlDateFormat':
    case 'contentControlLid':
    case 'contentControlStoreMappedDataAs':
    case 'contentControlCalendar':
    case 'contentControlText':
    case 'contentControlDataBinding':
    case 'contentControlChecked':
    case 'contentControlCheckedState':
    case 'contentControlUncheckedState':
      return validEmptySdtPayload(children);
    default:
      return false;
  }
}

/** XML 1.0 whitespace — the set Word uses for `w:t` boundary semantics. */
export function isXmlWhitespaceChar(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\r' || char === '\n';
}

/** True when a `w:t` text value must carry `xml:space="preserve"` on save. */
export function wmlTextNeedsXmlSpacePreserve(text: string): boolean {
  // Without it, a reader drops boundary white space and shows a tab as a space.
  return (
    text.length > 0 &&
    (isXmlWhitespaceChar(text[0]!) ||
      isXmlWhitespaceChar(text[text.length - 1]!) ||
      text.includes('\t'))
  );
}

/** Text content of a typed `w:t` element, or empty when absent or malformed. */
export function wmlTextValueOf(node: OoxmlElement): string {
  const child = node.children.find((candidate) => candidate.kind === 'textValue');
  return child?.kind === 'textValue' ? child.value : '';
}

/**
 * Canonical `w:t` attributes for normalized serialization and fingerprinting.
 * Injects `xml:space="preserve"` when boundary whitespace requires it; drops a
 * redundant or stale `xml:space` when the text no longer needs it. Other authored
 * attributes (including generic extensions) are preserved verbatim.
 */
export function normalizedWmlTextAttributes(
  attributes: readonly OoxmlAttribute[],
  text: string
): readonly OoxmlAttribute[] {
  const withoutSpace = attributes.filter(
    (attribute) =>
      !(attribute.namespaceUri === XML_NAMESPACE_URI && attribute.localName === 'space')
  );
  if (!wmlTextNeedsXmlSpacePreserve(text)) return withoutSpace;
  return [
    ...withoutSpace,
    {
      kind: 'xmlSpace',
      namespaceUri: XML_NAMESPACE_URI,
      localName: 'space',
      prefix: 'xml',
      value: 'preserve',
    },
  ];
}

function ooxmlChildNamed(
  node: OoxmlNode,
  localName: string,
  namespaceUri: string = WML_NAMESPACE_URI
): OoxmlElement | undefined {
  if (node.kind === 'textValue') return undefined;
  for (const child of node.children) {
    if (
      child.kind !== 'textValue' &&
      child.localName === localName &&
      child.namespaceUri === namespaceUri
    ) {
      return child;
    }
  }
  return undefined;
}

function ooxmlAttributeValue(
  node: OoxmlElement,
  localName: string,
  namespaceUri: string = WML_NAMESPACE_URI
): string | undefined {
  return node.attributes.find(
    (attribute) => attribute.localName === localName && attribute.namespaceUri === namespaceUri
  )?.value;
}

/**
 * OOXML on/off toggle: on only when a same-namespace child is present and its `w:val`
 * (same namespace as the child) does not explicitly disable. Foreign-namespace siblings
 * with the same local name cannot turn the flag on.
 */
export function readOnOffChild(
  parent: OoxmlNode,
  localName: string,
  namespaceUri: string = WML_NAMESPACE_URI
): boolean {
  const child = ooxmlChildNamed(parent, localName, namespaceUri);
  if (!child) return false;
  const value = ooxmlAttributeValue(child, 'val', namespaceUri);
  return value === undefined || !(value === '0' || value === 'false' || value === 'off');
}
