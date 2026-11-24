// Per-block memos for canonical serialization.
//
// Canonical trees are immutable, and an edit rebuilds only the nodes on the path to what it
// changed. A paragraph object that survives an edit therefore says exactly what it said
// before, so its serialized markup and its namespace summaries can be reused by identity.
// A save after a one-character edit then re-emits one block instead of the whole part.
//
// The memoized blocks are paragraphs and table rows. A row carries cell properties that
// would otherwise be walked on every save. A row's markup already contains its paragraphs,
// so the serializer does not memoize the markup of paragraphs inside a row: the row is the
// unit, and the document's text is held once.
//
// What a block serializes to also depends on its surroundings: the controlled prefixes
// chosen for the whole part, the namespace bindings in scope, and the inherited `xml:space`.
// Every memo stores the context it was computed in and is only reused in the same one, so a
// part whose prefix allocation moves re-serializes in full rather than reusing stale markup.
//
// The memos are weakly keyed. A block that leaves the document and every undo state takes
// its entries with it.

import type { OoxmlNode, OoxmlParagraphNode, OoxmlTableRowNode } from './ooxml-tree.ts';

/** A node whose output and namespace summaries are memoized. */
export type MemoizedBlock = OoxmlParagraphNode | OoxmlTableRowNode;

/** Whether `node` is a memoized block. */
export function isMemoizedBlock(node: OoxmlNode): node is MemoizedBlock {
  return node.kind === 'paragraph' || node.kind === 'tableRow';
}

const bindingKeys = new WeakMap<ReadonlyMap<string, string>, string>();

/**
 * A key that is equal for two binding maps with the same entries.
 *
 * The serializer builds a fresh map wherever an element declares namespaces, so two saves
 * hand the same block different map objects with the same content. Keying by content
 * keeps the memos valid across saves; memoizing the key per map keeps the cost to one sort
 * per map, and most blocks share their parent's map.
 */
export function bindingsKey(bindings: ReadonlyMap<string, string>): string {
  let key = bindingKeys.get(bindings);
  if (key === undefined) {
    key = [...bindings]
      .map(([prefix, uri]) => `${prefix}\u0001${uri}`)
      .sort()
      .join('\u0002');
    bindingKeys.set(bindings, key);
  }
  return key;
}

/** Namespaces and authored aliases a subtree uses. Context-free. */
export interface NamespaceSummary {
  readonly namespaceUris: readonly string[];
  readonly aliases: readonly (readonly [prefix: string, namespaceUri: string])[];
}

const namespaceSummaries = new WeakMap<MemoizedBlock, NamespaceSummary>();

export function memoizedNamespaceSummary(
  node: MemoizedBlock,
  compute: () => NamespaceSummary
): NamespaceSummary {
  let summary = namespaceSummaries.get(node);
  if (!summary) {
    summary = compute();
    namespaceSummaries.set(node, summary);
  }
  return summary;
}

interface ContextualEntry<T> {
  readonly context: string;
  readonly value: T;
}

/** Namespaces that need a non-empty prefix, per block and binding context. */
const nonEmptyPrefixUris = new WeakMap<MemoizedBlock, ContextualEntry<readonly string[]>>();

export function memoizedNonEmptyPrefixUris(
  node: MemoizedBlock,
  bindings: ReadonlyMap<string, string>,
  compute: () => readonly string[]
): readonly string[] {
  const context = bindingsKey(bindings);
  const entry = nonEmptyPrefixUris.get(node);
  if (entry && entry.context === context) return entry.value;
  const value = compute();
  nonEmptyPrefixUris.set(node, { context, value });
  return value;
}

/** Serialized markup as UTF-8, per block and serialization context. */
const serializedMarkup = new WeakMap<MemoizedBlock, ContextualEntry<Uint8Array>>();

/** The context a block serializes in. `prefixesKey` identifies the part's prefix map. */
export function serializationContext(
  prefixesKey: string,
  bindings: ReadonlyMap<string, string>,
  preserve: boolean
): string {
  return `${prefixesKey}\u0003${bindingsKey(bindings)}\u0003${preserve ? 1 : 0}`;
}

export function cachedMarkup(node: MemoizedBlock, context: string): Uint8Array | undefined {
  const entry = serializedMarkup.get(node);
  return entry && entry.context === context ? entry.value : undefined;
}

export function cacheMarkup(node: MemoizedBlock, context: string, markup: Uint8Array): void {
  serializedMarkup.set(node, { context, value: markup });
}
