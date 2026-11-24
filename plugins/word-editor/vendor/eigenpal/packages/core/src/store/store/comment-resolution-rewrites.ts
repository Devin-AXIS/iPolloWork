// One-rewrite helpers for comment-thread resolution.
//
// Missing `w14:paraId` stamps and `w15:commentEx` updates are planned by identity, then
// each affected part root is rewritten once. Per-member `replaceNode` is O(nodes × thread).

import { replaceChildren, replaceNode } from '../package/ooxml-edit.ts';
import { withPart, type OoxmlPackage } from '../package/ooxml-package.ts';
import { W14_NAMESPACE_URI } from '../package/ooxml-shared.ts';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { w14RootPrefix } from '../package/para-id.ts';

let extendedRootRewrites = 0;
let commentsRootRewrites = 0;

/** Test seam: commentsExtended root rewrites. Not barrel-exported. */
export function commentResolutionExtendedRootRewrites(): number {
  return extendedRootRewrites;
}

/** Test seam: comments-root rewrites. Not barrel-exported. */
export function commentResolutionCommentsRootRewrites(): number {
  return commentsRootRewrites;
}

function rewriteByIdentity(
  node: OoxmlNode,
  replacements: ReadonlyMap<string, OoxmlElement>
): OoxmlNode {
  if (node.kind === 'textValue') return node;
  const planned = replacements.get(node.id);
  if (planned !== undefined) return planned;
  let changed = false;
  const children: OoxmlNode[] = [];
  for (const child of node.children) {
    const next = rewriteByIdentity(child, replacements);
    if (next !== child) changed = true;
    children.push(next);
  }
  if (!changed) return node;
  return { ...node, children } as OoxmlElement;
}

function rewriteCommentsRoot(
  part: OoxmlPart,
  replacements: ReadonlyMap<string, OoxmlElement>,
  bindPrefix: string | null
): ReturnType<typeof replaceNode> {
  const rewritten = rewriteByIdentity(part.root, replacements);
  if (rewritten.kind === 'textValue') {
    return {
      ok: false,
      issues: [{ code: 'known-node-invariant', path: part.root.id, nodeId: part.root.id }],
    };
  }
  const root =
    bindPrefix === null
      ? rewritten
      : ({
          ...rewritten,
          namespaceBindings: [
            ...rewritten.namespaceBindings,
            { prefix: bindPrefix, namespaceUri: W14_NAMESPACE_URI },
          ],
        } as OoxmlElement);
  commentsRootRewrites += 1;
  return replaceNode(part, part.root.id, root, { deferValidation: true });
}

export function stampThreadParaIds(
  pkg: OoxmlPackage,
  members: readonly {
    readonly paraId: string;
    readonly stampParagraph: OoxmlElement | null;
    readonly commentsPartName: string;
  }[],
  stamp: (paragraph: OoxmlElement, paraId: string, prefix: string) => OoxmlElement
): OoxmlPackage | null {
  const byPart = new Map<string, Map<string, { paragraph: OoxmlElement; paraId: string }>>();
  for (const member of members) {
    if (member.stampParagraph === null) continue;
    let bucket = byPart.get(member.commentsPartName);
    if (!bucket) {
      bucket = new Map();
      byPart.set(member.commentsPartName, bucket);
    }
    bucket.set(member.stampParagraph.id, {
      paragraph: member.stampParagraph,
      paraId: member.paraId,
    });
  }
  let next = pkg;
  for (const [partName, stamps] of byPart) {
    const part = next.parts.get(partName);
    if (!part) return null;
    const existingPrefix = w14RootPrefix(part.root);
    const prefix = existingPrefix ?? 'w14';
    const replacements = new Map<string, OoxmlElement>();
    for (const entry of stamps.values()) {
      replacements.set(entry.paragraph.id, stamp(entry.paragraph, entry.paraId, prefix));
    }
    const written = rewriteCommentsRoot(
      part,
      replacements,
      existingPrefix === null ? prefix : null
    );
    if (!written.ok) return null;
    next = withPart(next, written.part);
  }
  return next;
}

export function rewriteExtendedRoot(
  part: OoxmlPart,
  replacements: ReadonlyMap<string, OoxmlElement>,
  additions: readonly OoxmlElement[]
): ReturnType<typeof replaceChildren> {
  const children = part.root.children.map((child) => {
    if (child.kind === 'textValue') return child;
    return replacements.get(child.id) ?? child;
  });
  extendedRootRewrites += 1;
  return replaceChildren(part, part.root.id, [...children, ...additions], {
    deferValidation: true,
  });
}
