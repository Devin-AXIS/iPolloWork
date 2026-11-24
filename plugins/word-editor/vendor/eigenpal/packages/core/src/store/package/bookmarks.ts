// The bookmark index: every `w:bookmarkStart` name, and the paragraph position it marks.
//
// This is what an internal hyperlink's `w:anchor` resolves through. It is built from the
// TREE — paragraph node id plus UTF-16 offset — never from the DOM, because the paragraph a
// cross-document jump targets is normally on a virtualized page with no DOM at all. A
// bookmark index built by querying elements would resolve exactly the jumps that did not need
// it and fail every one that did.
//
// Names come out of the file, so the index is bounded: a document can declare as many
// bookmarks as it likes, and a lookup structure built from attacker input gets a cap like
// every other one.

import {
  isInlineRunContainer,
  MAX_INLINE_CONTAINER_DEPTH,
  WML_NAMESPACE_URI,
} from './ooxml-shared.ts';
import { contentControlContentOf, isContentControl } from './content-control-walk.ts';
import type { OoxmlNode, OoxmlParagraphNode, OoxmlPart } from './ooxml-tree.ts';
import { paragraphOffsetIndex } from '../store/tree-op-segments.ts';

/** Word's own limit is 40 characters; this is the fail-closed bound, not a fidelity claim. */
const MAX_BOOKMARK_NAME_LENGTH = 256;

/** Ceiling on indexed anchors. Beyond it the extra names simply do not resolve. */
const MAX_BOOKMARKS = 10_000;

/**
 * Word's own scratch bookmark, present in most documents and never a jump target: it marks
 * where the caret was when the file was last saved.
 */
const GO_BACK = '_GoBack';

/** One bookmark's name and the range its marker pair currently encloses. */
export interface BookmarkAnchor {
  readonly name: string;
  /** Canonical node id of the paragraph the marker sits in. */
  readonly paragraphId: string;
  /** UTF-16 offset within that paragraph, in `paragraphTextOf`'s vocabulary. */
  readonly offset: number;
}

/** Bookmarks by name. A name the document declares twice resolves to the first in order. */
export type BookmarkIndex = ReadonlyMap<string, BookmarkAnchor>;

function attributeValue(node: OoxmlNode, localName: string): string | undefined {
  if (node.kind === 'textValue') return undefined;
  for (const attribute of node.attributes) {
    if (attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === localName) {
      return attribute.value;
    }
  }
  return undefined;
}

/**
 * Build `name -> position` for every bookmark start in a part, in document order.
 *
 * FIRST IN DOCUMENT ORDER WINS on a duplicate name. Word treats a repeated bookmark name as
 * the same bookmark and jumps to the first, and the alternative — last-wins — makes a jump
 * target move when an edit far away happens to duplicate a name.
 *
 * The offset is measured the way the ops measure: text of the runs before the marker inside
 * its own paragraph, hyperlink runs included, so the position a jump places the caret at is a
 * position `setSelection` accepts.
 */
export function buildBookmarkIndex(part: OoxmlPart): BookmarkIndex {
  const index = new Map<string, BookmarkAnchor>();

  const scanParagraph = (paragraph: OoxmlParagraphNode): void => {
    // Paragraphs without bookmark starts need no retained offset index.
    let offsets: ReturnType<typeof paragraphOffsetIndex> | undefined;
    const walkInline = (child: OoxmlNode, depth: number): void => {
      if (depth >= MAX_INLINE_CONTAINER_DEPTH) return;
      if (child.kind === 'bookmarkStart') {
        const name = attributeValue(child, 'name');
        const span = (offsets ??= paragraphOffsetIndex(paragraph)).spanOf(child);
        if (
          span !== null &&
          name !== undefined &&
          name.length > 0 &&
          name.length <= MAX_BOOKMARK_NAME_LENGTH &&
          name !== GO_BACK &&
          !index.has(name) &&
          index.size < MAX_BOOKMARKS
        ) {
          index.set(name, { name, paragraphId: paragraph.id, offset: span.start });
        }
        return;
      }
      if (child.kind === 'run') return;
      // A link's markers sit at real positions inside it, so the walk descends rather than
      // charging the whole link's width before looking.
      if (isInlineRunContainer(child)) {
        for (const inner of child.children) walkInline(inner, depth + 1);
        return;
      }
      if (isContentControl(child)) {
        const content = contentControlContentOf(child);
        if (content) for (const inner of content) walkInline(inner, depth + 1);
      }
    };
    for (const child of paragraph.children) walkInline(child, 0);
  };

  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue' || index.size >= MAX_BOOKMARKS) return;
    if (node.kind === 'paragraph') {
      scanParagraph(node);
      return;
    }
    for (const child of node.children) walk(child);
  };
  walk(part.root);
  return index;
}
