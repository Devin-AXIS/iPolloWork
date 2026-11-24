// Which tracked-change sites of a part sit in a text box story.
//
// INTERNAL. A text box's `w:txbxContent` lives inside its owner's part, so a part-wide revision
// read or decision for the body, a header or a footer also reaches every text box it anchors.
// A text box is its own story, the way `Body.text` and `search` already treat it, so its changes
// are listed and decided through `Shape.body` and are left out of the owner's.
//
// Only a story `Shape.body` can reach is indexed: one the owner's shape listing answers, a
// DrawingML shape on the branch layout selects or a standalone legacy VML shape with a shape
// number. A DrawingML story's VML fallback copy is a shadow of that story, rewritten from it on
// export (`textbox-fallback-export.ts`), so the copy's sites map to the same story. A VML shape
// with no shape number, or a fallback branch that layout paints, is no reachable story, so its
// changes stay with the owner.

import { MC_NAMESPACE_URI, WML_NAMESPACE_URI } from '../store/package/ooxml-shared.ts';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from '../store/package/ooxml-tree.ts';
import { bodyStoryRoot, storyParagraphs } from '../store/package/story-blocks.ts';
import { shapesInParagraphs } from './shapes.ts';

/** Where the reachable text box stories of a part are. */
export interface TextboxSiteIndex {
  /** Node ids inside a story or its VML copy, each mapped to the story's root id. */
  readonly story: ReadonlyMap<string, string>;
  /** The node ids of that map that sit in a VML copy. */
  readonly copy: ReadonlySet<string>;
}

const MAX_DEPTH = 256;
const MAX_NODES = 1 << 22;
const cache = new WeakMap<OoxmlNode, TextboxSiteIndex>();
const EMPTY: TextboxSiteIndex = { story: new Map(), copy: new Set() };

function isTextboxContent(node: OoxmlNode): boolean {
  return (
    node.kind !== 'textValue' &&
    node.namespaceUri === WML_NAMESPACE_URI &&
    node.localName === 'txbxContent'
  );
}

/** The single `w:txbxContent` under an `mc:Fallback` branch, or null. */
function fallbackCopyOf(alternate: OoxmlElement): OoxmlElement | null {
  const fallback = alternate.children.find(
    (child) =>
      child.kind !== 'textValue' &&
      child.namespaceUri === MC_NAMESPACE_URI &&
      child.localName === 'Fallback'
  );
  if (!fallback || fallback.kind === 'textValue') return null;
  let found: OoxmlElement | null = null;
  const stack: { node: OoxmlNode; depth: number }[] = [{ node: fallback, depth: 0 }];
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    if (node.kind === 'textValue' || depth > MAX_DEPTH) continue;
    if (isTextboxContent(node)) {
      if (found) return null;
      found = node as OoxmlElement;
      continue;
    }
    for (const child of node.children) stack.push({ node: child, depth: depth + 1 });
  }
  return found;
}

/** Map every node of a subtree to `rootId`. False when the walk runs past its bounds. */
function indexSubtree(
  subtree: OoxmlNode,
  rootId: string,
  index: Map<string, string>,
  budget: { left: number },
  copy?: Set<string>
): boolean {
  const stack: { node: OoxmlNode; depth: number }[] = [{ node: subtree, depth: 0 }];
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    if (--budget.left < 0 || depth > MAX_DEPTH) return false;
    if (node.kind === 'textValue') continue;
    index.set(node.id, rootId);
    copy?.add(node.id);
    for (const child of node.children) stack.push({ node: child, depth: depth + 1 });
  }
  return true;
}

/**
 * Every node id inside a text box story `Shape.body` reaches, mapped to the story's root id.
 *
 * Built from the same shape listing `Shape.body` resolves through, so the two cannot disagree:
 * where that listing refuses (duplicate or missing shape ids, a scan past its bounds), no box is
 * reachable and the part has no index, so its revisions are read and decided part-wide.
 */
export function textboxSiteIndex(part: OoxmlPart): TextboxSiteIndex {
  const cached = cache.get(part.root);
  if (cached) return cached;
  const budget = { left: MAX_NODES };
  // The owner story's own paragraphs, by the walk its reads use: the body of the main part, or
  // the whole `w:hdr` / `w:ftr` of a header or footer part.
  const listing = shapesInParagraphs(part, storyParagraphs(bodyStoryRoot(part) ?? part.root));
  const index = new Map<string, string>();
  const copies = new Set<string>();
  let complete = listing.ok;
  for (const shape of listing.ok ? listing.shapes : []) {
    if (!complete) break;
    const root = shape.textboxRoot;
    if (!root) continue;
    complete = indexSubtree(root, root.id, index, budget);
    const copy = shape.alternate ? fallbackCopyOf(shape.alternate) : null;
    if (complete && copy) complete = indexSubtree(copy, root.id, index, budget, copies);
  }
  const answer = !complete || index.size === 0 ? EMPTY : { story: index, copy: copies };
  cache.set(part.root, answer);
  return answer;
}

/**
 * Whether a revision decision belongs to a story, by where its sites are.
 *
 * `textboxRootId` names the story's own `w:txbxContent`, or is null for the part's owning story.
 * A decision with no sites is answered by `fallback`, the story's range-based membership. A
 * decision only the VML copy still holds is in no story: export rewrites that copy.
 */
export function sitesInStory(
  index: TextboxSiteIndex,
  siteIds: readonly string[],
  textboxRootId: string | null,
  fallback: () => boolean
): boolean {
  if (siteIds.length === 0) return textboxRootId === null && fallback();
  if (textboxRootId === null) return siteIds.every((id) => !index.story.has(id)) && fallback();
  return (
    siteIds.every((id) => index.story.get(id) === textboxRootId) &&
    siteIds.some((id) => !index.copy.has(id))
  );
}
