// `insertFragment` — the clipboard fragment's atomic landing (rich-clipboard-fidelity 2.1).
//
// The op carries BLOCKS ONLY, staying JSON-safe like every TreeDocOp; the resource merge
// travels through the package-edit path in the same transaction (clipboard-fragment-merge).
// Word's paragraph-mark rule at the seam: a merged edge paragraph takes the properties of
// the mark that ENDS it — the fragment's first-paragraph mark on the leading merge, the
// host's original mark on the trailing merge. A single-paragraph fragment whose source
// mark was not covered splices inline and leaves host properties untouched.

import type {
  OoxmlElement,
  OoxmlNode,
  OoxmlParagraphNode,
  OoxmlPart,
} from '../package/ooxml-tree.ts';
import {
  carryIndexToRebuiltRoot,
  createNodeIdAllocator,
  findNode,
  insertChildren,
  replaceChildren,
  type EditOptions,
} from '../package/ooxml-edit.ts';
import { usedParaIds, w14PrefixInScopeAt, withFreshParaIds } from '../package/para-id.ts';
import { actorScopedSeed } from '../package/actor-scoped-ids.ts';
import {
  cloneWithNewIds,
  paragraphPropertiesNodeOf,
  parentOf,
  TEXT_DEPS,
} from './tree-op-nodes.ts';
import {
  indivisibleAt,
  isParagraph,
  paragraphLength,
  splitsSurrogate,
} from './tree-op-segments.ts';
import { rejectContentEdit } from './tree-op-validate-controls.ts';
import { applyTreeOp } from './tree-op-apply.ts';
import { equationsOfAtom, isOmmlDisplay } from '../package/omml-display.ts';
import type { TreeDocOp, TreeOpEffect, TreeOpRejection, TreeOpResult } from './tree-op-types.ts';
import { recordSetNamespaceBinding } from '../package/canonical-primitive-capture.ts';

export type InsertFragmentOp = Extract<TreeDocOp, { readonly op: 'insertFragment' }>;

/** Fragment budgets: a hostile payload cannot force unbounded tree work. */
export const MAX_FRAGMENT_INSERT_BLOCKS = 50_000;
export const MAX_FRAGMENT_DEPTH = 64;
export const MAX_FRAGMENT_NODES = 500_000;

const INSERTABLE_BLOCK_KINDS = new Set(['paragraph', 'table', 'contentControl']);

function fragmentShape(
  node: OoxmlNode,
  depth: number,
  budget: { nodes: number }
): TreeOpRejection | null {
  if (depth > MAX_FRAGMENT_DEPTH) return 'fragment-too-deep';
  budget.nodes += 1;
  if (budget.nodes > MAX_FRAGMENT_NODES) return 'fragment-resource-budget';
  if (node.kind === 'textValue') {
    return typeof node.value === 'string' ? null : 'fragment-invalid-block';
  }
  if (typeof node.localName !== 'string' || typeof node.namespaceUri !== 'string') {
    return 'fragment-invalid-block';
  }
  if (!Array.isArray(node.children) || !Array.isArray(node.attributes)) {
    return 'fragment-invalid-block';
  }
  for (const child of node.children) {
    const refused = fragmentShape(child, depth + 1, budget);
    if (refused) return refused;
  }
  return null;
}

export function validateInsertFragment(
  part: OoxmlPart,
  op: InsertFragmentOp
): TreeOpRejection | null {
  const paragraph = findNode(part, op.paragraphId);
  if (!paragraph) return 'unknown-paragraph';
  if (!isParagraph(paragraph)) return 'not-a-paragraph';
  if (!Number.isInteger(op.offset) || op.offset < 0 || op.offset > paragraphLength(paragraph)) {
    return 'offset-out-of-range';
  }
  if (splitsSurrogate(paragraph, op.offset)) return 'splits-surrogate-pair';
  if (indivisibleAt(paragraph, op.offset)) return 'indivisible-content';
  if (!Array.isArray(op.blocks) || op.blocks.length === 0) return 'fragment-invalid-block';
  if (op.blocks.length > MAX_FRAGMENT_INSERT_BLOCKS) return 'fragment-resource-budget';
  const budget = { nodes: 0 };
  for (const block of op.blocks) {
    if (block.kind === 'textValue' || !INSERTABLE_BLOCK_KINDS.has(block.kind)) {
      return 'fragment-invalid-block';
    }
    const refused = fragmentShape(block, 1, budget);
    if (refused) return refused;
  }
  return rejectContentEdit(part, paragraph as OoxmlParagraphNode, op.offset, op.offset);
}

/**
 * Prefix bindings the incoming nodes need that the part root does not declare.
 *
 * Fragment content legitimately uses prefixes the TARGET root never bound (`wp:`, `a:`,
 * `pic:`, `w14:` — the source bound them on ITS root, which does not travel). The commit
 * validator requires every prefix bound in scope, so the missing ones are added to the
 * root; a prefix already bound to a DIFFERENT uri stays untouched and the incoming nodes
 * keep working through their own local bindings when they carry any.
 */
export function withRequiredNamespaceBindings(
  part: OoxmlPart,
  nodes: readonly OoxmlNode[]
): OoxmlPart {
  const rootBindings = new Map(
    part.root.namespaceBindings.map((binding) => [binding.prefix, binding.namespaceUri])
  );
  const additions = new Map<string, string>();
  const visit = (node: OoxmlNode, scope: ReadonlyMap<string, string>): void => {
    if (node.kind === 'textValue') return;
    let local = scope;
    if (node.namespaceBindings.length > 0) {
      const merged = new Map(scope);
      for (const binding of node.namespaceBindings) {
        merged.set(binding.prefix, binding.namespaceUri);
      }
      local = merged;
    }
    const need = (prefix: string | undefined, namespaceUri: string): void => {
      if (prefix === undefined || prefix.length === 0 || namespaceUri.length === 0) return;
      // `xml` and `xmlns` are bound by the XML spec itself, never by a declaration.
      // Treating `xml` as unbound declared it redundantly and rebuilt the root for
      // virtually every paste — `xml:space="preserve"` is in every real document copy.
      if (prefix === 'xml' || prefix === 'xmlns') return;
      if (local.get(prefix) === namespaceUri) return;
      if (rootBindings.get(prefix) === namespaceUri) return;
      if (rootBindings.has(prefix) || additions.has(prefix)) {
        if (additions.get(prefix) === namespaceUri) return;
        // Bound to something else: leave it; the serializer resolves through local bindings.
        if (rootBindings.get(prefix) !== undefined && rootBindings.get(prefix) !== namespaceUri) {
          return;
        }
        return;
      }
      additions.set(prefix, namespaceUri);
    };
    need(node.prefix, node.namespaceUri);
    for (const attribute of node.attributes) {
      need(attribute.prefix, attribute.namespaceUri);
    }
    for (const child of node.children) visit(child, local);
  };
  for (const node of nodes) visit(node, rootBindings);
  if (additions.size === 0) return part;
  const root = {
    ...part.root,
    namespaceBindings: [
      ...part.root.namespaceBindings,
      ...[...additions].map(([prefix, namespaceUri]) => ({ prefix, namespaceUri })),
    ],
  } as typeof part.root;
  // Same id, same children — only the bindings changed. Carry the index like every op
  // executor does, or the rebuilt root re-walks the whole part on its next lookup and
  // restarts the mint frontier underneath ids already handed out.
  carryIndexToRebuiltRoot(part.root, root);
  for (const [prefix, namespaceUri] of additions) {
    recordSetNamespaceBinding(part.root.id, prefix, namespaceUri);
  }
  return Object.freeze({ ...part, root }) as OoxmlPart;
}

/** Keep local bindings when a paste removes the node's original parent. */
function withParentBindings(node: OoxmlNode, parent: OoxmlElement): OoxmlNode {
  if (node.kind === 'textValue' || parent.namespaceBindings.length === 0) return node;
  const ownPrefixes = new Set(node.namespaceBindings.map((binding) => binding.prefix));
  const inherited = parent.namespaceBindings.filter((binding) => !ownPrefixes.has(binding.prefix));
  if (inherited.length === 0) return node;
  return { ...node, namespaceBindings: [...inherited, ...node.namespaceBindings] };
}

function inlineChildrenOf(paragraph: OoxmlElement): readonly OoxmlNode[] {
  const pPr = paragraphPropertiesNodeOf(paragraph);
  return paragraph.children
    .filter((child) => child !== pPr)
    .map((child) => withParentBindings(child, paragraph));
}

/**
 * A display equation (`m:oMathPara`) is a paragraph of its own. Merged beside existing
 * text, it becomes its inline equations, the same as Word pastes a display into a line.
 */
function besideText(
  pasted: readonly OoxmlNode[],
  neighbour: readonly OoxmlNode[]
): readonly OoxmlNode[] {
  const hasContent = (nodes: readonly OoxmlNode[]): boolean =>
    paragraphLength({ children: nodes } as unknown as OoxmlParagraphNode) > 0;
  if (!pasted.some(isOmmlDisplay) || !hasContent(neighbour)) return pasted;
  return pasted.flatMap((node): OoxmlNode[] =>
    isOmmlDisplay(node)
      ? equationsOfAtom(node).map((equation) => withParentBindings(equation, node))
      : [node]
  );
}

function rebuiltParagraph(
  pPr: OoxmlElement | undefined,
  inline: readonly OoxmlNode[]
): readonly OoxmlNode[] {
  return pPr ? [pPr, ...inline] : inline;
}

/** The length of one paragraph in `part`, or null when the id names no paragraph. */
function paragraphLengthIn(part: OoxmlPart, paragraphId: string): number | null {
  const node = findNode(part, paragraphId);
  return node && node.kind === 'paragraph' ? paragraphLength(node as OoxmlParagraphNode) : null;
}

/**
 * The end of the pasted content, where Word leaves the caret: in the paragraph that now holds
 * the host's trailing text, just before that text. The trailing text keeps its length through
 * the landing, so the end is that paragraph's length minus it. Null when it cannot be measured:
 * the end is only a caret hint, so the content still lands.
 */
function pasteEnd(
  part: OoxmlPart,
  paragraphId: string,
  trailing: number | null
): { readonly paragraphId: string; readonly offset: number } | null {
  const length = paragraphLengthIn(part, paragraphId);
  if (length === null || trailing === null || length < trailing) return null;
  return { paragraphId, offset: length - trailing };
}

export function applyInsertFragment(
  hostPart: OoxmlPart,
  op: InsertFragmentOp,
  options?: EditOptions
): TreeOpResult {
  const host = findNode(hostPart, op.paragraphId);
  if (!host || host.kind !== 'paragraph') return { ok: false, reason: 'unknown-paragraph' };

  // Clone every block with fresh node ids and fresh paragraph identities: the fragment's
  // ids belong to another document, and a second paste of the same payload must not
  // collide with the first.
  //
  // The clones stay DETACHED until the split/merge sequence below lands them, so their ids
  // are invisible to every later allocator's in-tree check — the frontier alone kept them
  // apart, and losing it (an orphaned index after a root rebuild) re-issued a clone's id to
  // the split's tail and refused the whole paste as duplicate ids. A dedicated family makes
  // the disjointness structural instead of frontier-dependent; in-tree occupancy (a prior
  // paste) is still skipped by the allocator's index check.
  const nextId = createNodeIdAllocator(hostPart, 'paste');
  const paraIds = new Set(usedParaIds(hostPart.root as OoxmlElement));
  const counter = { value: 0 };
  // The clones land beside the host paragraph (or inside it), so its scope decides the prefix.
  const hostPrefix = w14PrefixInScopeAt(hostPart, host);
  const blocks = op.blocks.map((block, index) =>
    withFreshParaIds(
      cloneWithNewIds(block, nextId),
      paraIds,
      actorScopedSeed(`${op.paragraphId}:${op.offset}:${index}`),
      counter,
      hostPrefix
    )
  );

  // Prefixes the fragment uses must be bound at the target root before commit validation.
  const part = withRequiredNamespaceBindings(hostPart, blocks);

  const first = blocks[0]!;
  const last = blocks[blocks.length - 1]!;
  const inlineOnly =
    blocks.length === 1 && first.kind === 'paragraph' && op.lastMarkCovered !== true;

  if (inlineOnly) {
    // Pure inline splice: split, append the fragment's inline content to the head, join.
    // Reusing split+join keeps every offset/atom/wrapper rule identical to typing lanes.
    const split = applyTreeOp(
      part,
      { op: 'splitParagraph', paragraphId: host.id, offset: op.offset },
      options
    );
    if (!split.ok) return split;
    const tailId = split.effect.split?.tail;
    if (!tailId) return { ok: false, reason: 'tree-invariant' };
    const head = findNode(split.part, host.id);
    if (!head || head.kind !== 'paragraph') return { ok: false, reason: 'tree-invariant' };
    const hostTrailing = paragraphLengthIn(split.part, tailId);
    const appended = replaceChildren(
      split.part,
      head.id,
      [
        ...head.children,
        ...besideText(inlineChildrenOf(first as OoxmlElement), inlineChildrenOf(host)),
      ],
      { ...options, deferValidation: true }
    );
    if (!appended.ok) return { ok: false, reason: 'tree-invariant' };
    const joined = applyTreeOp(
      appended.part,
      { op: 'joinParagraphs', firstId: head.id, secondId: tailId },
      options
    );
    if (!joined.ok) return joined;
    // Unmeasurable (a broken invariant), the caret stays where the paste started.
    const caret = pasteEnd(joined.part, host.id, hostTrailing) ?? {
      paragraphId: host.id,
      offset: op.offset,
    };
    const effect: TreeOpEffect = {
      dirty: [host.id],
      created: [],
      deleted: [],
      caret,
      dependencyKeys: TEXT_DEPS,
      impact: 'flow-structural',
    };
    return { ok: true, part: joined.part, effect };
  }

  // Structural landing: split the host, merge paragraph edges, insert the rest between.
  const split = applyTreeOp(
    part,
    { op: 'splitParagraph', paragraphId: host.id, offset: op.offset },
    options
  );
  if (!split.ok) return split;
  const tailId = split.effect.split?.tail;
  if (!tailId) return { ok: false, reason: 'tree-invariant' };
  let current = split.part;
  const hostTrailing = paragraphLengthIn(current, tailId);

  const middle: OoxmlNode[] = [...blocks];
  const created: string[] = [tailId];

  // Leading merge: the merged paragraph ends at the fragment's first mark, so it takes the
  // fragment's paragraph properties and keeps the host's leading text.
  if (first.kind === 'paragraph') {
    middle.shift();
    const head = findNode(current, host.id);
    if (!head || head.kind !== 'paragraph') return { ok: false, reason: 'tree-invariant' };
    const sourcePPr = paragraphPropertiesNodeOf(first as OoxmlElement);
    const fragmentPPr = sourcePPr
      ? (withParentBindings(sourcePPr, first as OoxmlElement) as OoxmlElement)
      : undefined;
    const headInline = inlineChildrenOf(head);
    const replaced = replaceChildren(
      current,
      head.id,
      rebuiltParagraph(fragmentPPr, [
        ...headInline,
        ...besideText(inlineChildrenOf(first as OoxmlElement), headInline),
      ]),
      { ...options, deferValidation: true }
    );
    if (!replaced.ok) return { ok: false, reason: 'tree-invariant' };
    current = replaced.part;
  }

  // Trailing merge: the merged paragraph ends at the HOST's original mark (now on the
  // tail), so the host properties stay and the fragment's last inline content leads it.
  if (
    middle.length > 0 &&
    last.kind === 'paragraph' &&
    middle[middle.length - 1] === last &&
    op.lastMarkCovered !== true
  ) {
    middle.pop();
    const tail = findNode(current, tailId);
    if (!tail || tail.kind !== 'paragraph') return { ok: false, reason: 'tree-invariant' };
    const tailPPr = paragraphPropertiesNodeOf(tail);
    const tailInline = inlineChildrenOf(tail);
    const replaced = replaceChildren(
      current,
      tail.id,
      rebuiltParagraph(tailPPr, [
        ...besideText(inlineChildrenOf(last as OoxmlElement), tailInline),
        ...tailInline,
      ]),
      { ...options, deferValidation: true }
    );
    if (!replaced.ok) return { ok: false, reason: 'tree-invariant' };
    current = replaced.part;
  }

  if (middle.length > 0) {
    const parent = parentOf(current, tailId);
    if (!parent) return { ok: false, reason: 'tree-invariant' };
    const tailIndex = parent.children.findIndex((child) => child.id === tailId);
    if (tailIndex === -1) return { ok: false, reason: 'tree-invariant' };
    const inserted = insertChildren(current, parent.id, tailIndex, middle, {
      ...options,
      deferValidation: true,
    });
    if (!inserted.ok) return { ok: false, reason: 'tree-invariant' };
    current = inserted.part;
    for (const block of middle) created.push(block.id);
  }

  // Unmeasurable, the caret goes to the start of the tail: the end when the last block was
  // not merged into it.
  const caret = pasteEnd(current, tailId, hostTrailing) ?? { paragraphId: tailId, offset: 0 };
  const effect: TreeOpEffect = {
    dirty: [host.id, tailId],
    created,
    deleted: [],
    caret,
    dependencyKeys: TEXT_DEPS,
    impact: 'flow-structural',
  };
  return { ok: true, part: current, effect };
}
