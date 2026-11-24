// Two whole-story reads, extracted from `tree-session.ts` to keep it under its `max-lines` cap.
//
// Both walk a story tree and answer one question about all of it, and both are on the
// `snapshot()` path — which is why each carries its own note about what a naive version cost.

import { paragraphTextOf } from '@docx-editor.dev/core/store';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from '../store/package/ooxml-tree.ts';
import { keepsSubtreeMemo } from '../store/package/subtree-memo-policy.ts';
import { allParagraphs } from './tree-binding.ts';

/**
 * A story's text, every paragraph of it, joined by newlines and read from the CANONICAL TREE.
 *
 * Read through `paragraphTextOf` rather than the projection's `textContent`, because a tab and
 * a hard break are ATOM nodes in ProseMirror and contribute nothing to `textContent` — so the
 * text silently disagreed with the offsets the ops and the layout use. A caret at offset 12 and
 * a `bodyText().slice(12)` have to mean the same place.
 *
 * `allParagraphs`, not `bodyParagraphs`. The latter collects only DIRECT `w:p` children of
 * `w:body` because it exists to match the ProseMirror projection, so reading text through it
 * silently dropped every table cell and every paragraph inside a block content control — a
 * table-heavy document came back nearly empty. It also broke this read's own contract, which
 * says a caret at offset 12 and `bodyText().slice(12)` mean the same place: they cannot, once
 * a table precedes the caret.
 */
export function projectedText(part: OoxmlPart): string {
  return allParagraphs(part)
    .map((paragraph) => paragraphTextOf(part, paragraph.id) ?? '')
    .join('\n');
}

/** Depth bound for the anchor walk. Nesting is the cheapest unbounded axis in a hostile file. */
const MAX_ANCHOR_WALK_DEPTH = 64;

/**
 * Memoized per immutable node, because `snapshot()` reads `hasReviewContent` every tick:
 * without the memo a comment-less document paid a full-tree walk per keystroke, since the
 * answer only early-exits when an anchor IS found. An edit replaces only the nodes on its path,
 * so every untouched subtree answers from the cache. Only nodes `keepsSubtreeMemo` admits
 * get an entry: a node of leaves answers again from those leaves.
 */
const commentAnchorPresenceCache = new WeakMap<OoxmlElement, boolean>();

/**
 * Whether the story contains a comment anchor (`w:commentRangeStart` / `w:commentReference`),
 * from STORE vocabulary alone.
 *
 * Deliberately not `commentAnchorsOfStory`: that is review-model derivation and lives with the
 * review module. This answers presence only, for `hasReviewContent`, and must keep answering
 * with no module registered.
 */
export function storyCarriesCommentAnchor(node: OoxmlElement, depth = 0): boolean {
  if (depth > MAX_ANCHOR_WALK_DEPTH) return false;
  const cached = commentAnchorPresenceCache.get(node);
  if (cached !== undefined) return cached;
  let present = false;
  for (const child of node.children as readonly OoxmlNode[]) {
    if (child.kind === 'textValue') continue;
    if (
      child.kind === 'commentRangeStart' ||
      child.kind === 'commentReference' ||
      storyCarriesCommentAnchor(child, depth + 1)
    ) {
      present = true;
      break;
    }
  }
  if (keepsSubtreeMemo(node)) commentAnchorPresenceCache.set(node, present);
  return present;
}
