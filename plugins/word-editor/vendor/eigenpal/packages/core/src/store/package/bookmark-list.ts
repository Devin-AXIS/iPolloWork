// Every bookmark of one part, with both ends, in document order.
//
// `bookmarks.ts` answers "where does this name jump to", which needs only the start. Listing,
// painting and editing bookmarks need the whole range: the start AND the end marker, paired by
// `@w:id`, hidden names included, and the order the starts appear in.
//
// Markers are not always inside a paragraph. `EG_RangeMarkupElements` also sits between
// block-level siblings, so a bookmark can open before a table and close after it. A start
// between blocks resolves to the beginning of the next paragraph, and an end between blocks to
// the end of the previous one, which are the text positions those markers bound.
//
// Every value here comes from the file, so the walk is bounded: a start without an end is not a
// bookmark and is not listed, a repeated name keeps its first occurrence, and the list stops at
// a fixed count.

import { MAX_INLINE_CONTAINER_DEPTH, WML_NAMESPACE_URI } from './ooxml-shared.ts';
import type { OoxmlNode, OoxmlParagraphNode, OoxmlPart } from './ooxml-tree.ts';
import { paragraphOffsetIndex } from '../store/tree-op-segments.ts';
import { bookmarkNameKey, isHiddenBookmarkName } from './bookmark-names.ts';

/** File names longer than this are not listed. Bounds a hostile name, not an authored one. */
const MAX_LISTED_NAME_LENGTH = 256;

/** Ceiling on listed bookmarks per part. */
export const MAX_LISTED_BOOKMARKS = 10_000;

/** Deepest block nesting the walk follows (tables in tables, controls in cells). */
const MAX_BLOCK_DEPTH = 64;

/** A text position: a paragraph's node id and a UTF-16 offset in its text. */
export interface BookmarkPosition {
  readonly paragraphId: string;
  readonly offset: number;
}

/** One bookmark, both ends resolved. */
export interface BookmarkRecord {
  /** The name as the document writes it. */
  readonly name: string;
  /** Names starting with an underscore are hidden. */
  readonly hidden: boolean;
  /** The marker pair's `@w:id`. */
  readonly markerId: string;
  readonly start: BookmarkPosition;
  readonly end: BookmarkPosition;
  /** Node ids of the two markers. */
  readonly startNodeId: string;
  readonly endNodeId: string;
  /**
   * How many marker pairs in the part carry this name, compared without case: 1, or more
   * where concurrent edits left copies. The record is the first; the rest are not listed.
   */
  readonly copies: number;
}

function wmlAttribute(node: OoxmlNode, localName: string): string | undefined {
  if (node.kind === 'textValue') return undefined;
  for (const attribute of node.attributes) {
    if (attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === localName) {
      return attribute.value;
    }
  }
  return undefined;
}

interface OpenStart {
  readonly name: string;
  readonly nodeId: string;
  readonly start: BookmarkPosition | null;
}

/**
 * List the bookmarks of a part in the document order of their starts.
 *
 * @internal Includes each duplicate pair so range edits address only the enclosed markers.
 */
export function listBookmarkPairs(part: OoxmlPart): readonly BookmarkRecord[] {
  const open = new Map<string, OpenStart>();
  /** Starts between blocks, waiting for the paragraph that follows them. */
  const pendingStarts: string[] = [];
  const closed: {
    readonly order: number;
    readonly key: string;
    readonly record: Omit<BookmarkRecord, 'copies'>;
  }[] = [];
  const copies = new Map<string, number>();
  const startOrder = new Map<string, number>();
  let order = 0;
  let previous: BookmarkPosition | null = null;

  const openStart = (node: OoxmlNode, at: BookmarkPosition | null): void => {
    if (open.size >= MAX_LISTED_BOOKMARKS || closed.length >= MAX_LISTED_BOOKMARKS) return;
    const id = wmlAttribute(node, 'id');
    const name = wmlAttribute(node, 'name');
    if (id === undefined || name === undefined) return;
    if (name.length === 0 || name.length > MAX_LISTED_NAME_LENGTH) return;
    if (open.has(id)) return;
    open.set(id, { name, nodeId: node.id, start: at });
    startOrder.set(id, order++);
    if (at === null) pendingStarts.push(id);
  };

  const closeEnd = (node: OoxmlNode, at: BookmarkPosition | null): void => {
    const id = wmlAttribute(node, 'id');
    if (id === undefined) return;
    const started = open.get(id);
    if (!started) return;
    open.delete(id);
    const start = started.start ?? at;
    const end = at ?? started.start;
    if (!start || !end) return;
    const key = bookmarkNameKey(started.name);
    copies.set(key, (copies.get(key) ?? 0) + 1);
    closed.push({
      order: startOrder.get(id) ?? 0,
      key,
      record: {
        name: started.name,
        hidden: isHiddenBookmarkName(started.name),
        markerId: id,
        start,
        end,
        startNodeId: started.nodeId,
        endNodeId: node.id,
      },
    });
  };

  const resolvePending = (at: BookmarkPosition): void => {
    for (const id of pendingStarts.splice(0)) {
      const started = open.get(id);
      if (started && started.start === null) open.set(id, { ...started, start: at });
    }
  };

  const visitParagraph = (paragraph: OoxmlParagraphNode): void => {
    resolvePending({ paragraphId: paragraph.id, offset: 0 });
    let offsets: ReturnType<typeof paragraphOffsetIndex> | undefined;
    const positionOf = (marker: OoxmlNode): BookmarkPosition => ({
      paragraphId: paragraph.id,
      offset: (offsets ??= paragraphOffsetIndex(paragraph)).spanOf(marker)?.start ?? 0,
    });
    const walk = (node: OoxmlNode, depth: number): void => {
      if (node.kind === 'textValue' || depth > MAX_INLINE_CONTAINER_DEPTH) return;
      if (node.kind === 'bookmarkStart') return openStart(node, positionOf(node));
      if (node.kind === 'bookmarkEnd') return closeEnd(node, positionOf(node));
      // A text box's paragraphs are paragraphs of their own, with their own offsets.
      if (node.kind === 'paragraph') return visitParagraph(node);
      for (const child of node.children) walk(child, depth + 1);
    };
    for (const child of paragraph.children) walk(child, 0);
    previous = {
      paragraphId: paragraph.id,
      offset: (offsets ??= paragraphOffsetIndex(paragraph)).length,
    };
  };

  const visitBlock = (node: OoxmlNode, depth: number): void => {
    if (node.kind === 'textValue' || depth > MAX_BLOCK_DEPTH) return;
    if (node.kind === 'paragraph') return visitParagraph(node);
    if (node.kind === 'bookmarkStart') return openStart(node, null);
    if (node.kind === 'bookmarkEnd') return closeEnd(node, previous);
    for (const child of node.children) visitBlock(child, depth + 1);
  };

  visitBlock(part.root, 0);
  // Starts that no paragraph followed close against the last paragraph in the part.
  if (previous) resolvePending(previous);
  closed.sort((a, b) => a.order - b.order);
  return Object.freeze(
    closed.map((entry) => Object.freeze({ ...entry.record, copies: copies.get(entry.key) ?? 1 }))
  );
}

/** List each name once, using its first marker pair in document order. @public */
export function listBookmarks(part: OoxmlPart): readonly BookmarkRecord[] {
  const seen = new Set<string>();
  return Object.freeze(
    listBookmarkPairs(part).filter((record) => {
      const key = bookmarkNameKey(record.name);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
  );
}
