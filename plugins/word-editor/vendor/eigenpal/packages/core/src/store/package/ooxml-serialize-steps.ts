// Canonical serialization in steps, so a long part can be written without one long task.
//
// The serializer itself is a recursive, synchronous walk. Instead of making it resumable,
// this fills its per-block memos one paragraph or table row at a time, yielding between them,
// and then runs the ordinary serializer, which finds every block already done. The output is
// the output of `serializeOoxmlPart` by construction, because that is what produces it. It
// comes out as UTF-8, assembled from the blocks' cached bytes a slice at a time.

import { isMemoizedBlock, type MemoizedBlock } from './ooxml-serialize-cache.ts';
import {
  collectNamespacesAndAliases,
  collectNonEmptyPrefixUris,
} from './ooxml-serialize-namespaces.ts';
import {
  DEFAULT_FINGERPRINT_BINDINGS,
  controlledPrefixMap,
  extendedBindings,
  inheritedPreserveOf,
  normalizedFingerprintAttributes,
  rootSerializationScope,
  serializeNode,
  serializeOoxmlPartChunks,
  type ControlledPrefixes,
  type MarkupChunk,
} from './ooxml-serialize.ts';
import type { OoxmlNode, OoxmlPart } from './ooxml-tree.ts';

type BlockVisitor = (
  block: MemoizedBlock,
  bindings: ReadonlyMap<string, string>,
  preserve: boolean
) => void;

/**
 * Visit the outermost memoized blocks under `node` (paragraphs and table rows) with the
 * bindings and `xml:space` state the serializer gives them, yielding after each one.
 *
 * Bindings are compared by content, so a map built here matches the one the serializer builds
 * for the same block. A block's own descendants are not visited: serializing it covers them.
 */
function* visitBlocks(
  node: OoxmlNode,
  bindings: ReadonlyMap<string, string>,
  preserve: boolean,
  visit: BlockVisitor
): Generator<void, void> {
  if (node.kind === 'textValue') return;
  if (isMemoizedBlock(node)) {
    visit(node, bindings, preserve);
    yield;
    return;
  }
  const childBindings = extendedBindings(bindings, node);
  const childPreserve = inheritedPreserveOf(normalizedFingerprintAttributes(node), preserve);
  for (const child of node.children) yield* visitBlocks(child, childBindings, childPreserve, visit);
}

/**
 * {@link serializeOoxmlPart} as UTF-8, yielding between paragraphs and table rows. A caller
 * that stops between yields gives the page a turn while a long part serializes; the result is
 * the same either way.
 *
 * A block serialized by an earlier save in the same context costs a lookup, so after an edit
 * only the blocks it rebuilt do real work.
 *
 * @internal
 */
export function* serializeOoxmlPartSteps(part: OoxmlPart): Generator<void, Uint8Array> {
  // Pass 1: the namespace summaries the prefix map is built from. The non-empty-prefix walk
  // starts from the same two reserved bindings `controlledPrefixMap` starts from.
  const namespaceUris = new Set<string>();
  const aliasUris = new Map<string, Set<string>>();
  const nonEmpty = new Set<string>();
  yield* visitBlocks(part.root, DEFAULT_FINGERPRINT_BINDINGS, false, (block, bindings) => {
    collectNamespacesAndAliases(block, namespaceUris, aliasUris);
    collectNonEmptyPrefixUris(block, bindings, nonEmpty);
  });

  // Pass 2: each block's markup, in the scope the root element gives its children.
  const prefixes: ControlledPrefixes = controlledPrefixMap(part.root);
  yield;
  const { rootBindings } = rootSerializationScope(prefixes);
  const scratch: MarkupChunk[] = [];
  yield* visitBlocks(part.root, rootBindings, false, (block, bindings, preserve) => {
    serializeNode(block, prefixes, bindings, preserve, '', scratch);
    scratch.length = 0;
  });
  const chunks = serializeOoxmlPartChunks(part);
  yield;
  return yield* concatenateSteps(chunks);
}

/** Bytes copied between yields while the part is assembled. */
const ASSEMBLY_SLICE_BYTES = 4 * 1024 * 1024;

function* concatenateSteps(chunks: readonly MarkupChunk[]): Generator<void, Uint8Array> {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  let length = 0;
  let text: string[] = [];
  const flushText = () => {
    if (text.length === 0) return;
    const bytes = encoder.encode(text.join(''));
    parts.push(bytes);
    length += bytes.length;
    text = [];
  };
  for (const chunk of chunks) {
    if (typeof chunk === 'string') {
      text.push(chunk);
      continue;
    }
    flushText();
    parts.push(chunk);
    length += chunk.length;
  }
  flushText();
  const out = new Uint8Array(length);
  let at = 0;
  let sinceYield = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
    sinceYield += part.length;
    if (sinceYield >= ASSEMBLY_SLICE_BYTES) {
      sinceYield = 0;
      yield;
    }
  }
  return out;
}
