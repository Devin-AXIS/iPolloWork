// Where a stretch of text points, and what points at it.
//
// TWO KINDS OF TARGET, one string. A `w:hyperlink` either names a relationship — an address
// outside the document — or a `w:anchor`, a bookmark inside it. The protocol answers one string
// for both because that is what a target IS to a caller: `https://…` or `#name`. What it never
// answers is an authored string the engine would refuse to open. A file's own `javascript:` is
// preserved on save (round-tripping never rewrites a document) but it is reported as no target at
// all, and an AUTHORED one is refused before it reaches the package.
//
// A BOOKMARK IS A RANGE, and the file writes it as two markers that find each other by `@w:id`:
// `w:bookmarkStart` carries the name, `w:bookmarkEnd` closes it, and either may be missing or
// duplicated because a `.docx` is attacker-controlled. So the derivation pairs them, bounds itself,
// and answers only the ones that actually enclose something addressable. A start with no end has
// no range — reporting it as a zero-length one at its own position would invent a bookmark the
// document does not have.

import {
  hyperlinkAnchorOf,
  hyperlinkRelationshipIdOf,
  hyperlinkTargetOf,
  isHyperlinkNode,
} from '../store/package/hyperlink.ts';
import { relationshipTargetIn } from '../store/package/hyperlink-part.ts';
import type { OoxmlPackage } from '../store/package/ooxml-package.ts';
import { WML_NAMESPACE_URI } from '../store/package/ooxml-shared.ts';
import type { OoxmlNode } from '../store/package/ooxml-tree.ts';
import { paragraphOffsetIndex } from '../store/store/tree-op-segments.ts';
import type { AutomationStoryReads } from './reads.ts';

/**
 * Word's own limit is 40 characters. This is the fail-closed bound on a file-derived name, which
 * is a different question: a hostile document may declare a megabyte-long one.
 */
const MAX_BOOKMARK_NAME = 256;

/** Ceiling on how many bookmarks one story answers. Past it the extra names are not addressable. */
const MAX_BOOKMARKS = 10_000;

/** A position in one story: the paragraph a marker sits in and its UTF-16 offset. */
export interface AutomationMarkerPosition {
  readonly paragraphId: string;
  readonly offset: number;
}

/** One bookmark of a story: its name and the range its two markers enclose. */
export interface AutomationBookmarkRead {
  readonly name: string;
  readonly start: AutomationMarkerPosition;
  readonly end: AutomationMarkerPosition;
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

/**
 * `_GoBack` and friends: names Word writes for itself.
 *
 * Word's own bookmark collection hides them by default, and for good reason — `_GoBack` marks
 * where the caret was at the last save, so a caller iterating a document's bookmarks would be
 * handed one that moves every time the file is edited and means nothing about the content.
 */
function isHidden(name: string): boolean {
  return name.startsWith('_');
}

/**
 * Every bookmark of one story, in document order.
 *
 * FIRST NAME WINS on a duplicate, matching the jump index: Word treats a repeated name as the
 * same bookmark, and last-wins would move a target when an edit far away happened to repeat a
 * name.
 */
export function bookmarkReads(
  reads: AutomationStoryReads,
  options: { readonly includeHidden?: boolean } = {}
): readonly AutomationBookmarkRead[] {
  /** Open starts by `@w:id`, waiting for the end that closes them. */
  const open = new Map<string, { name: string; start: AutomationMarkerPosition }>();
  const found: AutomationBookmarkRead[] = [];
  const named = new Set<string>();

  for (const paragraphId of reads.paragraphIds) {
    const paragraph = reads.node(paragraphId);
    if (paragraph?.kind !== 'paragraph') continue;
    const offsets = paragraphOffsetIndex(paragraph);
    const walk = (node: OoxmlNode): void => {
      if (node.kind === 'textValue') return;
      if (node.kind === 'bookmarkStart') {
        if (found.length >= MAX_BOOKMARKS || open.size >= MAX_BOOKMARKS) return;
        const id = wmlAttribute(node, 'id');
        const name = wmlAttribute(node, 'name');
        if (id === undefined || name === undefined) return;
        if (name.length === 0 || name.length > MAX_BOOKMARK_NAME) return;
        if ((isHidden(name) && !options.includeHidden) || named.has(name) || open.has(id)) return;
        const at = offsets.spanOf(node)?.start ?? 0;
        open.set(id, { name, start: { paragraphId, offset: at } });
        return;
      }
      if (node.kind === 'bookmarkEnd') {
        const id = wmlAttribute(node, 'id');
        if (id === undefined) return;
        const started = open.get(id);
        if (!started) return;
        open.delete(id);
        named.add(started.name);
        const at = offsets.spanOf(node)?.start ?? 0;
        found.push(
          Object.freeze({
            name: started.name,
            start: started.start,
            end: { paragraphId, offset: at },
          })
        );
        return;
      }
      // Markers sit at real positions inside a link, so the walk descends rather than skipping
      // whatever wraps them.
      for (const child of node.children) walk(child);
    };
    for (const child of paragraph.children) walk(child);
  }
  return Object.freeze(found);
}

/** One story's bookmark by name, or null when nothing in it declares that name now. */
export function bookmarkIn(
  reads: AutomationStoryReads,
  name: string
): AutomationBookmarkRead | null {
  return bookmarkReads(reads).find((bookmark) => bookmark.name === name) ?? null;
}

/** A `w:hyperlink` in one story, with the range of the characters it wraps. */
export interface AutomationLinkRead {
  /** Canonical node id, which is what the retarget and unlink ops name. */
  readonly id: string;
  readonly paragraphId: string;
  readonly start: number;
  readonly end: number;
}

/** Every link in one paragraph, in document order. */
export function linksInParagraph(
  reads: AutomationStoryReads,
  paragraphId: string
): readonly AutomationLinkRead[] {
  const paragraph = reads.node(paragraphId);
  if (paragraph?.kind !== 'paragraph') return Object.freeze([]);
  const offsets = paragraphOffsetIndex(paragraph);
  const found: AutomationLinkRead[] = [];
  const walk = (node: OoxmlNode, depth: number): void => {
    if (node.kind === 'textValue' || depth > 32) return;
    if (isHyperlinkNode(node)) {
      const span = offsets.spanOf(node);
      if (span)
        found.push(Object.freeze({ id: node.id, paragraphId, start: span.start, end: span.end }));
      return;
    }
    for (const child of node.children) walk(child, depth + 1);
  };
  for (const child of paragraph.children) walk(child, 0);
  return Object.freeze(found);
}

/**
 * The SANITIZED target of one link: an absolute URL, `#anchor`, or null.
 *
 * Null covers every case a caller must not be handed a string for — a refused scheme, a
 * relationship the package does not declare, a target with no scheme at all — because the one
 * thing worse than answering nothing is answering something that looks openable and is not.
 */
export function linkTarget(pkg: OoxmlPackage, ownerPart: string, link: OoxmlNode): string | null {
  const resolved = hyperlinkTargetOf(link, (relationshipId) =>
    relationshipTargetIn(pkg, ownerPart, relationshipId)
  );
  if (resolved.kind === 'external') return resolved.href;
  if (resolved.kind === 'internal') {
    const anchor = hyperlinkAnchorOf(link);
    return anchor === undefined || anchor.length === 0 ? null : `#${anchor}`;
  }
  return null;
}

/** Whether a link names a relationship at all, for the retarget-versus-wrap decision. */
export function linkNamesRelationship(link: OoxmlNode): boolean {
  const id = hyperlinkRelationshipIdOf(link);
  return id !== undefined && id.length > 0;
}
