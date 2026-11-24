// Property-container rewrites (tree-ops seam).
//
// `w:pPr` and `w:rPr` are the two containers an op rebuilds from a FLAT `OoxmlProperty[]`,
// and that projection cannot express everything they hold: children carry structure in
// their own children (`w:numPr`, `w:tabs`, `w:pBdr`), and both containers legitimately hold
// elements OUTSIDE the authorable D8 boundary — `w:rStyle`, `w:lang`, `w:sectPr`, the
// paragraph mark, a tracked-change record. This module owns the merge that keeps them:
// an op states the properties it names, and everything it cannot name survives untouched.

import { WML_NAMESPACE_URI, type OoxmlNode } from '../package/ooxml-tree.ts';
import {
  CT_PPR_SEQUENCE,
  CT_RPR_SEQUENCE,
  inSchemaOrder,
  rankOf,
} from '../package/ooxml-property-order.ts';
import {
  ACCEPTED_PARAGRAPH_PROPERTIES,
  ACCEPTED_RUN_PROPERTIES,
  ADDITIVE_RUN_PROPERTIES,
  type OoxmlProperty,
} from './tree-op-types.ts';

export { CT_PPR_SEQUENCE };

/** What one container's merge is allowed to author, and the order it must emit. */
export interface PropertyVocabulary {
  readonly authorable: ReadonlySet<string>;
  /** Names a write may add or replace, but keeps when the write leaves them out. */
  readonly additive?: ReadonlySet<string>;
  readonly sequence: readonly string[];
}

export const PARAGRAPH_VOCABULARY: PropertyVocabulary = {
  authorable: new Set(ACCEPTED_PARAGRAPH_PROPERTIES),
  sequence: CT_PPR_SEQUENCE,
};

export const RUN_VOCABULARY: PropertyVocabulary = {
  authorable: new Set(ACCEPTED_RUN_PROPERTIES),
  additive: new Set(ADDITIVE_RUN_PROPERTIES),
  sequence: CT_RPR_SEQUENCE,
};

/**
 * Build one property container child from a flat property, KEEPING the structure of the node
 * it replaces.
 *
 * `OoxmlProperty` is flat — a name and attributes — but several children carry their meaning
 * in CHILDREN: `w:numPr` holds `w:ilvl`/`w:numId`, `w:tabs` holds `w:tab`, `w:pBdr` holds its
 * edges. Rebuilding those from the flat projection alone emitted an empty element, so
 * centring a list paragraph silently deleted its numbering and the bullet vanished. When the
 * incoming property matches what is already there, the existing node is reused verbatim;
 * when its attributes changed, the children still come across.
 */
export function propertyElement(property: OoxmlProperty, id: string, prior?: OoxmlNode): OoxmlNode {
  const attributes = Object.entries(property.attributes ?? {}).map(([localName, value]) => ({
    kind: 'genericExtension' as const,
    namespaceUri: WML_NAMESPACE_URI,
    localName,
    prefix: 'w',
    value,
  }));
  const priorElement = prior && prior.kind !== 'textValue' ? prior : undefined;
  if (priorElement && sameAttributes(priorElement, attributes)) return prior!;
  return {
    id,
    kind: 'generic',
    namespaceUri: WML_NAMESPACE_URI,
    localName: property.localName,
    prefix: 'w',
    namespaceBindings: [],
    attributes,
    children: priorElement?.children ?? [],
  } as unknown as OoxmlNode;
}

function sameAttributes(
  node: Exclude<OoxmlNode, { kind: 'textValue' }>,
  attributes: readonly { readonly localName: string; readonly value: string }[]
): boolean {
  const existing = node.attributes ?? [];
  if (existing.length !== attributes.length) return false;
  for (const attribute of attributes) {
    const match = existing.find((entry) => entry.localName === attribute.localName);
    if (!match || match.value !== attribute.value) return false;
  }
  return true;
}

/**
 * The children a rewritten `w:pPr` / `w:rPr` gets: the op's properties, merged over what the
 * container already held.
 *
 * A property the op NAMES is rewritten (or dropped, when the op no longer names it) — that
 * is what the op is for. A child the op vocabulary cannot express is kept exactly as
 * authored, because an op that cannot say a thing cannot mean to delete it: `setRunProperties`
 * pressing Bold once erased the run's `w:rStyle` character style and its `w:lang`, and
 * `setParagraphProperties` centring a paragraph erased its `w:sectPr`, its paragraph mark and
 * its `w:pBdr`. New children land at their schema position, so an op naming its properties in
 * toolbar order still emits a `w:pPr` Word will open.
 */
export function mergedPropertyChildren(
  prior: readonly OoxmlNode[],
  properties: readonly OoxmlProperty[],
  vocabulary: PropertyVocabulary,
  nextId: () => string
): OoxmlNode[] {
  const wanted = new Map<string, OoxmlProperty[]>();
  for (const property of properties) {
    const bucket = wanted.get(property.localName);
    if (bucket) bucket.push(property);
    else wanted.set(property.localName, [property]);
  }

  // Authored children in authored order; repeats of one name pair up with the op's repeats
  // of that name, in order.
  const taken = new Map<string, number>();
  const children: OoxmlNode[] = [];
  for (const child of prior) {
    // A foreign extension that shares a local name (`e:b`) is not the property, so it
    // survives untouched rather than being rewritten or removed as one.
    if (
      child.kind === 'textValue' ||
      child.namespaceUri !== WML_NAMESPACE_URI ||
      !vocabulary.authorable.has(child.localName)
    ) {
      // An additive property the write names is replaced below; one it leaves out stays.
      if (
        child.kind !== 'textValue' &&
        child.namespaceUri === WML_NAMESPACE_URI &&
        vocabulary.additive?.has(child.localName) &&
        wanted.has(child.localName)
      ) {
        const index = taken.get(child.localName) ?? 0;
        taken.set(child.localName, index + 1);
        const property = wanted.get(child.localName)?.[index];
        if (property) children.push(propertyElement(property, nextId(), child));
        continue;
      }
      children.push(child);
      continue;
    }
    const index = taken.get(child.localName) ?? 0;
    taken.set(child.localName, index + 1);
    const property = wanted.get(child.localName)?.[index];
    if (property) children.push(propertyElement(property, nextId(), child));
  }

  for (const [localName, bucket] of wanted) {
    // Only the vocabulary is authorable. Validation refuses an op that names anything
    // else, so this is the second lock on the same door: a merge is the one place a name
    // becomes an ELEMENT, and it must not be reachable from a caller that forgot to
    // validate.
    if (!vocabulary.authorable.has(localName) && !vocabulary.additive?.has(localName)) continue;
    for (let index = taken.get(localName) ?? 0; index < bucket.length; index += 1) {
      const node = propertyElement(bucket[index]!, nextId());
      const rank = rankOf(vocabulary.sequence, node);
      const at = children.findIndex((child) => rankOf(vocabulary.sequence, child) > rank);
      if (at === -1) children.push(node);
      else children.splice(at, 0, node);
    }
  }
  return [...inSchemaOrder(children, vocabulary.sequence)];
}

/**
 * Where a new child belongs in an `xsd:sequence` container: BEFORE the first modelled
 * child that outranks it.
 *
 * `CT_PPrBase` is a strict sequence, so consumers refuse a file with an element in the
 * wrong slot even though every value in it is correct. Children the sequence
 * does not model (a `w14:` effect, an `mc:AlternateContent`) are skipped rather than
 * ranked — their position is not ours to decide, the same rule {@link inSchemaOrder} follows.
 */
export function schemaInsertIndex(
  children: readonly OoxmlNode[],
  sequence: readonly string[],
  localName: string
): number {
  const rank = sequence.indexOf(localName);
  if (rank < 0) return children.length;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (!child) continue;
    const childRank = rankOf(sequence, child);
    if (childRank < sequence.length && childRank > rank) return index;
  }
  return children.length;
}
