// Node-level helpers for rebuilding a part after a tracked-change decision.

import { parentNodeOf } from '../package/ooxml-edit.ts';
import { declaredLockOf } from './tree-op-nodes.ts';
import { coalesced, isRunProperties } from './tree-op-tracked.ts';
import { equivalentNodes } from './ooxml-node-equality.ts';
import { sameRevision } from './same-revision.ts';
import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';

export type Resolution = 'unwrap' | 'remove' | 'restore';

/** Where the content of the last decided wrapper starts and ends in the rebuilt child list. */
export interface DecidedSpan {
  readonly wrapper: OoxmlElement;
  readonly from: number;
  readonly to: number;
}

/**
 * Push the content one decision keeps from `wrapper`, with adjacent same-format text runs
 * joined, and return where it starts.
 *
 * Shared text can hold one change as several runs, or several adjacent wrappers, split where
 * another edit once fell, while a peer holds the same change as one run. Inside the change the
 * split means nothing. Once the decision makes the content ordinary text, the split would show
 * and differ between peers, so every peer joins the runs the same way. `before` is the span of
 * the wrapper just before this one, if it was decided too: the same change joins across it.
 */
export function pushDecidedContent(
  out: OoxmlNode[],
  wrapper: OoxmlElement,
  kept: readonly OoxmlNode[],
  before: DecidedSpan | null,
  mint: () => string
): DecidedSpan {
  const continues =
    before !== null &&
    before.to === out.length &&
    before.wrapper.kind === wrapper.kind &&
    sameRevision(before.wrapper, wrapper);
  const from = continues ? before.from : out.length;
  // Same-format runs join in one pass: each is collected once, and the joined run is built once
  // per group, so a change of many tab or break runs stays linear.
  let group: JoinGroup | null = null;
  const flush = () => {
    if (group) out.push(joinedGroup(mint, group));
    group = null;
  };
  const add = (node: OoxmlNode) => {
    const parts = joinableParts(node);
    if (group && parts && equivalentNodes(group.properties, parts.properties)) {
      for (const child of parts.content) group.content.push(child);
      group.count++;
      return;
    }
    flush();
    if (parts)
      group = { first: node, properties: parts.properties, content: [...parts.content], count: 1 };
    else out.push(node);
  };
  const previous = out.length > from ? out.pop() : undefined;
  if (previous !== undefined) add(previous);
  for (const node of kept) add(node);
  flush();
  return { wrapper, from, to: out.length };
}

/** Run content a join may concatenate: characters, tabs and breaks, never atoms or fields. */
const JOINABLE_CONTENT = new Set(['text', 'deletedText', 'tab', 'hardBreak']);

interface JoinGroup {
  readonly first: OoxmlNode;
  readonly properties: readonly OoxmlNode[];
  readonly content: OoxmlNode[];
  count: number;
}

/** A run's properties and content when it may join a neighbour: it holds only joinable content. */
function joinableParts(node: OoxmlNode): { properties: OoxmlNode[]; content: OoxmlNode[] } | null {
  if (node.kind !== 'run') return null;
  const content = node.children.filter((child) => !isRunProperties(child));
  if (content.length === 0 || !content.every((child) => JOINABLE_CONTENT.has(child.kind)))
    return null;
  return { properties: node.children.filter(isRunProperties), content };
}

/** One run for a group of adjacent runs of the same format; a lone run stays as it is. */
function joinedGroup(mint: () => string, group: JoinGroup): OoxmlNode {
  if (group.count === 1) return group.first;
  const children: OoxmlNode[] = [...group.properties];
  for (const child of coalesced(mint, group.content)) children.push(child);
  return { ...group.first, children } as OoxmlNode;
}

/**
 * The controls a removal must keep: a control locked against removal (`sdtLocked`,
 * `sdtContentLocked`) stays, emptied, where the removed content held it. The decision then
 * restores its placeholder.
 */
export function lockedControlShells(node: OoxmlNode): OoxmlNode[] {
  if (node.kind === 'textValue') return [];
  if (node.kind === 'contentControl' && declaredLockOf(node).wrapper)
    return [
      {
        ...node,
        children: node.children.map((child) =>
          child.kind === 'contentControlContent' ? { ...child, children: [] } : child
        ),
      } as OoxmlNode,
    ];
  return node.children.flatMap(lockedControlShells);
}

/** How one wrapper resolves, given the action. */
export function resolutionOf(node: OoxmlElement, action: 'accept' | 'reject'): Resolution {
  switch (node.kind) {
    case 'revisionInsert':
    case 'revisionMoveTo':
      // Accepting keeps the content and drops the wrapper; rejecting takes both.
      return action === 'accept' ? 'unwrap' : 'remove';
    case 'revisionDelete':
    case 'revisionMoveFrom':
      // Accepting removes the content; rejecting restores it, which also turns `w:delText`
      // back into `w:t`.
      return action === 'accept' ? 'remove' : 'restore';
    default:
      return 'remove';
  }
}

function textElementFrom(node: OoxmlElement): OoxmlElement {
  return { ...node, kind: 'text', localName: 't' } as OoxmlElement;
}

/**
 * Undo the deleted forms of run content when a deletion is rejected.
 *
 * `w:delText` is the deleted form of `w:t`, and `w:delInstrText` is the deleted form of
 * `w:instrText` (`EG_RunInnerContent`, §17.3.3.7 / §17.16.23). BOTH have to be inverted.
 * Restoring the text but leaving the instruction in its deleted form outside any `w:del` means
 * Word stops reading it as an instruction: the field's code is silently lost and the field
 * never updates again.
 */
export function withDeletedTextRestored(node: OoxmlNode): OoxmlNode {
  if (node.kind === 'textValue') return node;
  const children = node.children.map(withDeletedTextRestored);
  const rebuilt = children.some((child, index) => child !== node.children[index])
    ? ({ ...node, children } as OoxmlElement)
    : node;
  if (rebuilt.kind === 'deletedText') return textElementFrom(rebuilt);
  // `w:delInstrText` has no typed kind — it is layout-inert either way — so it is matched by
  // name and renamed in place.
  if (
    rebuilt.kind === 'generic' &&
    rebuilt.namespaceUri === WML_NAMESPACE_URI &&
    rebuilt.localName === 'delInstrText'
  ) {
    return { ...rebuilt, localName: 'instrText' } as OoxmlElement;
  }
  return rebuilt;
}

/**
 * Every node on the path from the part root to one of `targets`, the targets included.
 *
 * A rebuild descends only into these. Every other subtree holds nothing the decision changes,
 * so it is kept as it is, and the rebuild costs the paths it changes instead of the part.
 */
export function rebuildReach(part: OoxmlPart, targets: Iterable<string>): Set<string> {
  const reach = new Set<string>();
  for (const target of targets) {
    let id: string | undefined = target;
    while (id !== undefined && !reach.has(id)) {
      reach.add(id);
      id = parentNodeOf(part, id)?.id;
    }
  }
  return reach;
}
