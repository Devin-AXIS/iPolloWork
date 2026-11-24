// How typing and deleting treat the bookmarks around them.
//
// A bookmark's markers are zero-width, so an insertion exactly at a marker has to pick a side.
// The rule is that new text lands AFTER every bookmark marker at its offset:
//
//   - typed at a bookmark's start, the text joins the bookmark;
//   - typed at a bookmark's end, the text stays outside it;
//   - typed at a point bookmark, the text follows the point.
//
// The insertion path appends to the run before the offset, which puts the text in front of the
// markers. So the markers that sat at the offset are moved back to it afterwards.
//
// Pressing Enter at a marker keeps the marker in the first paragraph (`tree-op-split-markers.ts`).
//
// An untracked deletion removes the bookmarks it encloses:
//
//   - a range bookmark goes when the deletion covers its whole range, edges included;
//   - a point bookmark goes when it is strictly inside the deletion, and stays when the
//     deletion only touches it.
//
// A bookmark the deletion only partly covers keeps the text that is left. A tracked deletion
// removes nothing yet, so it keeps every bookmark. This op sees one paragraph: a deletion
// across paragraphs removes the bookmarks it encloses through the editor's range deletion
// (`enclosedBookmarkDeletions`), which plans `deleteBookmark` ops beside its text ops.

import { findNode, insertChildren, removeNode, type EditOptions } from '../package/ooxml-edit.ts';
import { WML_NAMESPACE_URI, type OoxmlNode, type OoxmlPart } from '../package/ooxml-tree.ts';
import { MAX_INLINE_CONTAINER_DEPTH } from '../package/ooxml-shared.ts';
import { markerSiteAt } from './tree-op-comments.ts';
import { paragraphOffsetIndex } from './tree-op-segments.ts';
import type { TreeDocOp, TreeOpResult } from './tree-op-types.ts';

interface ParagraphMarker {
  readonly node: OoxmlNode;
  readonly kind: 'bookmarkStart' | 'bookmarkEnd';
  readonly markerId: string | undefined;
  readonly offset: number;
}

/** Bookmark markers of one paragraph in document order, with their offsets. */
function paragraphMarkers(part: OoxmlPart, paragraphId: string): readonly ParagraphMarker[] {
  const paragraph = findNode(part, paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return [];
  const found: ParagraphMarker[] = [];
  let offsets: ReturnType<typeof paragraphOffsetIndex> | undefined;
  const walk = (node: OoxmlNode, depth: number): void => {
    if (node.kind === 'textValue' || depth > MAX_INLINE_CONTAINER_DEPTH) return;
    // A text box's paragraphs measure their own text.
    if (depth > 0 && node.kind === 'paragraph') return;
    if (node.kind === 'bookmarkStart' || node.kind === 'bookmarkEnd') {
      const span = (offsets ??= paragraphOffsetIndex(paragraph)).spanOf(node);
      if (!span) return;
      found.push({
        node,
        kind: node.kind,
        markerId: node.attributes.find(
          (attribute) =>
            attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === 'id'
        )?.value,
        offset: span.start,
      });
      return;
    }
    for (const child of node.children) walk(child, depth + 1);
  };
  walk(paragraph, 0);
  return found;
}

/** Whether the paragraph holds a bookmark marker at all: the cheap test every keystroke runs. */
function holdsBookmarkMarker(node: OoxmlNode, depth: number): boolean {
  if (node.kind === 'textValue' || depth > MAX_INLINE_CONTAINER_DEPTH) return false;
  if (node.kind === 'bookmarkStart' || node.kind === 'bookmarkEnd') return true;
  // Runs hold text, not range markup.
  if (node.kind === 'run') return false;
  return node.children.some((child) => holdsBookmarkMarker(child, depth + 1));
}

function touchesBookmarks(part: OoxmlPart, paragraphId: string): boolean {
  const paragraph = findNode(part, paragraphId);
  return !!paragraph && paragraph.kind === 'paragraph' && holdsBookmarkMarker(paragraph, 0);
}

/**
 * Move the markers that sat at `offset` (`atOffset`, read before the edit) back in front of
 * text inserted there.
 */
function keepMarkersBeforeInsertion(
  atOffset: readonly ParagraphMarker[],
  result: TreeOpResult,
  paragraphId: string,
  offset: number,
  options?: EditOptions
): TreeOpResult {
  if (!result.ok || atOffset.length === 0) return result;
  const nowAt = new Map(
    paragraphMarkers(result.part, paragraphId).map((marker) => [marker.node.id, marker.offset])
  );
  const moved = atOffset.filter((marker) => {
    const now = nowAt.get(marker.node.id);
    return now !== undefined && now !== offset;
  });
  if (moved.length === 0) return result;
  let part = result.part;
  for (const marker of moved) {
    const removed = removeNode(part, marker.node.id, options);
    if (!removed.ok) return result;
    part = removed.part;
  }
  const paragraph = findNode(part, paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return result;
  const site = markerSiteAt(part, paragraph, offset, options);
  if (!site.ok) return result;
  const nodes = moved.map((marker) => marker.node);
  const inserted = insertChildren(site.part, site.containerId, site.index, nodes, options);
  if (!inserted.ok) return result;
  return { ok: true, part: inserted.part, effect: result.effect };
}

/**
 * Remove the bookmarks an untracked deletion of `start`..`end` encloses, from the paragraph's
 * `markers` read before the edit.
 */
function dropEnclosedBookmarks(
  markers: readonly ParagraphMarker[],
  result: TreeOpResult,
  start: number,
  end: number,
  options?: EditOptions
): TreeOpResult {
  if (!result.ok || end <= start) return result;
  const starts = new Map<string, ParagraphMarker>();
  const doomed: string[] = [];
  for (const marker of markers) {
    if (marker.markerId === undefined) continue;
    if (marker.kind === 'bookmarkStart') {
      starts.set(marker.markerId, marker);
      continue;
    }
    const opened = starts.get(marker.markerId);
    if (!opened) continue;
    const point = opened.offset === marker.offset;
    const enclosed = point
      ? start < opened.offset && opened.offset < end
      : start <= opened.offset && marker.offset <= end;
    if (enclosed) doomed.push(opened.node.id, marker.node.id);
  }
  if (doomed.length === 0) return result;
  let part = result.part;
  for (const nodeId of doomed) {
    if (!findNode(part, nodeId)) continue;
    const removed = removeNode(part, nodeId, options);
    if (!removed.ok) return result;
    part = removed.part;
  }
  return { ok: true, part, effect: result.effect };
}

/**
 * Apply an op, then apply the bookmark rules for typing and deleting. The insert rule covers
 * text, tabs, breaks, pictures and pasted content; the delete rule covers an untracked
 * `deleteText`. Other ops, and paragraphs without bookmarks, pass through.
 */
export function withBookmarkEditRules(
  part: OoxmlPart,
  op: TreeDocOp,
  options: EditOptions | undefined,
  apply: () => TreeOpResult
): TreeOpResult {
  if (
    op.op === 'insertText' ||
    op.op === 'insertTab' ||
    op.op === 'insertHardBreak' ||
    op.op === 'insertPageBreak' ||
    op.op === 'insertDrawing' ||
    op.op === 'insertFragment'
  ) {
    if (!touchesBookmarks(part, op.paragraphId)) return apply();
    // Read BEFORE applying: the op moves the node index to its new tree, and a lookup in the
    // old one afterwards indexed the whole part again, on every keystroke.
    const atOffset = paragraphMarkers(part, op.paragraphId).filter(
      (marker) => marker.offset === op.offset
    );
    return keepMarkersBeforeInsertion(atOffset, apply(), op.paragraphId, op.offset, options);
  }
  if (op.op === 'deleteText' && !op.revision) {
    if (!touchesBookmarks(part, op.paragraphId)) return apply();
    const markers = paragraphMarkers(part, op.paragraphId);
    return dropEnclosedBookmarks(markers, apply(), op.start, op.end, options);
  }
  return apply();
}
