// Identifier rewriting and unique-name allocation for the clipboard fragment merge
// (split from clipboard-fragment-merge.ts to hold the max-lines cap).
//
// `rewriteIdentifiers` is the one place a fragment subtree is retargeted to the host's id
// namespaces - style ids, numbering ids, per-kind note ids, per-owner relationship ids,
// bookmark/SDT/revision/`docPr` ids - keyed by node kind and (for `w:id`) parent so an
// unrelated `w:id` is never touched.

import {
  WML_NAMESPACE_URI,
  type OoxmlAttribute,
  type OoxmlElement,
  type OoxmlNode,
} from '../package/ooxml-tree.ts';
import { attributeValueOf } from './tree-op-nodes.ts';
import { carriesRevisionId } from './tree-op-revision-ids.ts';
import { isWml } from './clipboard-fragment-defaults.ts';
import { canonicalNoteId } from './clipboard-fragment-closure.ts';

const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

export function withRewrittenAttribute(
  node: OoxmlElement,
  namespaceUri: string,
  localName: string,
  value: string
): OoxmlElement {
  return {
    ...node,
    attributes: node.attributes.map((attribute) =>
      attribute.localName === localName && attribute.namespaceUri === namespaceUri
        ? ({ ...attribute, value } as OoxmlAttribute)
        : attribute
    ),
  } as OoxmlElement;
}

// `styleLink`/`numStyleLink` included: numbering definitions reference numbering STYLES,
// and an import under a fresh style id must rewrite those references too.
const STYLE_REF_NAMES = new Set([
  'pStyle',
  'rStyle',
  'tblStyle',
  'basedOn',
  'link',
  'next',
  'styleLink',
  'numStyleLink',
]);

/**
 * Whether a pasted node brings a revision `@w:id` that has to be re-minted.
 *
 * BY LOCAL NAME, through the store's own predicate. The four content wrappers are the only
 * ones with a typed kind, so a kind test missed `w:rPrChange`, `w:cellIns` and the rest — and
 * a pasted format record kept the id of the one it was copied from, which made one review card
 * cover the original text and the copy at once.
 */
export const carriesPastedRevisionId = carriesRevisionId;

export interface RewriteMaps {
  readonly styleIds?: ReadonlyMap<string, string>;
  readonly numIds?: ReadonlyMap<string, string>;
  readonly relIds?: ReadonlyMap<string, string>;
  readonly footnoteIds?: ReadonlyMap<string, string>;
  readonly endnoteIds?: ReadonlyMap<string, string>;
  readonly bookmarkIds?: ReadonlyMap<string, string>;
  readonly sdtIds?: ReadonlyMap<string, string>;
  readonly revisionIds?: ReadonlyMap<string, string>;
  readonly docPrIds?: ReadonlyMap<string, string>;
}

const EMPTY_MAP: ReadonlyMap<string, string> = new Map();

export function rewriteIdentifiers(node: OoxmlNode, maps: RewriteMaps): OoxmlNode {
  const styleIds = maps.styleIds ?? EMPTY_MAP;
  const numIds = maps.numIds ?? EMPTY_MAP;
  const relIds = maps.relIds ?? EMPTY_MAP;
  const footnoteIds = maps.footnoteIds ?? EMPTY_MAP;
  const endnoteIds = maps.endnoteIds ?? EMPTY_MAP;
  const bookmarkIds = maps.bookmarkIds ?? EMPTY_MAP;
  const sdtIds = maps.sdtIds ?? EMPTY_MAP;
  const revisionIds = maps.revisionIds ?? EMPTY_MAP;
  const docPrIds = maps.docPrIds ?? EMPTY_MAP;

  const walk = (current: OoxmlNode, parentLocal: string): OoxmlNode => {
    if (current.kind === 'textValue') return current;
    let next: OoxmlElement = current;

    if (current.namespaceUri === WML_NAMESPACE_URI && STYLE_REF_NAMES.has(current.localName)) {
      const value = attributeValueOf(current, 'val');
      const mapped = value !== undefined ? styleIds.get(value) : undefined;
      if (mapped !== undefined)
        next = withRewrittenAttribute(next, WML_NAMESPACE_URI, 'val', mapped);
    }
    if (isWml(current, 'numId')) {
      const value = attributeValueOf(current, 'val');
      const mapped = value !== undefined ? numIds.get(value) : undefined;
      if (mapped !== undefined)
        next = withRewrittenAttribute(next, WML_NAMESPACE_URI, 'val', mapped);
    }
    if (current.kind === 'noteReference') {
      // Footnote and endnote ids are SEPARATE namespaces; each reference kind resolves
      // through its own map, never a shared one. The map keys are canonical
      // (leading zeros dropped), so every id spelling of one note resolves alike.
      const kindMap = current.localName === 'footnoteReference' ? footnoteIds : endnoteIds;
      const value = attributeValueOf(current, 'id');
      const mapped = value !== undefined ? kindMap.get(canonicalNoteId(value)) : undefined;
      if (mapped !== undefined)
        next = withRewrittenAttribute(next, WML_NAMESPACE_URI, 'id', mapped);
    }
    if (current.kind === 'bookmarkStart' || current.kind === 'bookmarkEnd') {
      const value = attributeValueOf(current, 'id');
      const mapped = value !== undefined ? bookmarkIds.get(value) : undefined;
      if (mapped !== undefined)
        next = withRewrittenAttribute(next, WML_NAMESPACE_URI, 'id', mapped);
    }
    // `w:id` rewrites ONLY under `w:sdtPr` — an unrelated `w:id` element elsewhere with a
    // colliding value must stay untouched.
    if (isWml(current, 'id') && parentLocal === 'sdtPr') {
      const value = attributeValueOf(current, 'val');
      const mapped = value !== undefined ? sdtIds.get(value) : undefined;
      if (mapped !== undefined)
        next = withRewrittenAttribute(next, WML_NAMESPACE_URI, 'val', mapped);
    }
    if (carriesPastedRevisionId(current)) {
      const value = attributeValueOf(current, 'id');
      const mapped = value !== undefined ? revisionIds.get(value) : undefined;
      if (mapped !== undefined)
        next = withRewrittenAttribute(next, WML_NAMESPACE_URI, 'id', mapped);
    }
    if (current.kind === 'drawingDocPr') {
      const value = current.attributes.find(
        (attribute) => attribute.localName === 'id' && attribute.namespaceUri === ''
      )?.value;
      const mapped = value !== undefined ? docPrIds.get(value) : undefined;
      if (mapped !== undefined) next = withRewrittenAttribute(next, '', 'id', mapped);
    }
    // Relationship references (r:id, r:embed, r:link).
    for (const attribute of next.attributes) {
      if (attribute.namespaceUri !== R_NS) continue;
      const mapped = relIds.get(attribute.value);
      if (mapped !== undefined && mapped !== attribute.value) {
        next = withRewrittenAttribute(next, R_NS, attribute.localName, mapped);
      }
    }

    const parentForChildren = current.localName;
    const children = next.children.map((child) => walk(child, parentForChildren));
    const changed =
      next !== current || children.some((child, index) => child !== next.children[index]);
    return changed ? ({ ...next, children } as OoxmlNode) : current;
  };
  return walk(node, '');
}

/**
 * A `${base}Pasted`, `${base}Pasted2`, … id unused in `taken`, resolved in O(1) via a
 * per-base next-suffix map so many collisions on one base stay linear overall.
 */
export function freshUniqueId(
  base: string,
  taken: ReadonlySet<string>,
  suffixes: Map<string, number>
): string {
  let candidate = base;
  let suffix = suffixes.get(base) ?? 2;
  while (taken.has(candidate)) {
    candidate = `${base}${suffix}`;
    suffix += 1;
  }
  suffixes.set(base, suffix);
  return candidate;
}

/** The `w:name` twin of {@link freshUniqueId}: `Name (pasted)`, `Name (pasted 2)`, …. */
export function freshUniqueName(
  base: string,
  taken: ReadonlySet<string>,
  suffixes: Map<string, number>
): string {
  let candidate = `${base} (pasted)`;
  let suffix = suffixes.get(base) ?? 2;
  while (taken.has(candidate)) {
    candidate = `${base} (pasted ${suffix})`;
    suffix += 1;
  }
  suffixes.set(base, suffix);
  return candidate;
}

/** Numeric max over an attribute across a part, for fresh-id allocation. */
