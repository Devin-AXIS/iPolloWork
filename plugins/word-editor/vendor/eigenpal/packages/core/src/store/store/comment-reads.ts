// Comment anchors, comment bodies, and the sibling parts that hold thread state.
//
// An anchor is a RANGE over stable node identities plus UTF-16 offsets, in the same offset
// space layout and tree ops use. `w:commentRangeStart` / `w:commentRangeEnd` are empty elements
// that sit between runs, so they contribute no characters and mark a position rather than
// occupying one.
//
// ECMA-376 governs the anchor: `CT_Comment` (§17.13.4.2) carries `@w:id`, `@w:author`,
// `@w:initials` and `@w:date` and a body, and `CT_Markup`-derived range markers (§17.13.4.4,
// §17.13.4.3) place it. It defines NEITHER threading nor a resolved flag — a comment in Part 1
// is flat and open. Both live in namespaces outside Part 1, so this reader treats them as
// optional evidence rather than as structure the standard promises:
//
//   - `commentsExtended.xml`, `w15:commentEx` `@paraIdParent` / `@done`, keyed by `w14:paraId`.
//   - `@w16cid:parentId` on `w:comment`, naming the parent's `w:id` directly.
//
// A file using neither can still state a reply in Part 1 terms alone, by anchoring it over
// exactly the characters the parent covers — the ranges are the only part of a thread that
// survives a producer dropping the extension parts. Read all three, explicit before inferred;
// a comment whose text merely opens with "Reply:" is prose and is never treated as structure.
//
// IT LIVES IN THE STORE LANE, so every lane reads a reviewer's remarks through one derivation.
// The paginated surface, the review rail and the automation host all ask "what comments does
// this document hold", and the answer is a property of the canonical tree rather than of any one
// of their views — layout re-exports what is here rather than owning it. The bounded whole-part
// walk covers body, furniture, every normal note, separator and continuation-separator content,
// and nested textboxes without making any one layout story model the store's authority.

import { FieldResultsModeMemo } from '../package/field-result-mode.ts';
import type { OoxmlPackage } from '../package/ooxml-package.ts';
import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlParagraphNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { isInlineRunContainer, MAX_INLINE_CONTAINER_DEPTH } from '../package/ooxml-shared.ts';
import {
  chargePart,
  createCommentScanBudget,
  walkCharged,
} from '../package/comment-lifecycle-scan.ts';
import { paragraphOffsetIndex, transientParagraphOffsetIndex } from './tree-op-segments.ts';
import { contentControlContentOf, isContentControlNode } from './tree-op-nodes.ts';
import { createRecentRootCache } from './recent-root-cache.ts';
import { createSubtreeAggregateMemo, keepsSubtreeMemo } from '../package/subtree-memo-policy.ts';

/** The `w15` namespace: `commentsExtended.xml` — thread parent and resolved state. */
export const W15_NAMESPACE_URI = 'http://schemas.microsoft.com/office/word/2012/wordml';
/** The `w14` namespace, where `paraId` lives. */
const W14_NAMESPACE_URI = 'http://schemas.microsoft.com/office/word/2010/wordml';
/**
 * The `w16cid` namespace: `@parentId` on `w:comment`, a thread link by comment id.
 *
 * Outside ECMA-376 Part 1, like `w14` and `w15`. Carried in an `mc:Ignorable` namespace, which
 * is exactly the contract that lets this reader use it when present and ignore it when not.
 */
const W16CID_NAMESPACE_URI = 'http://schemas.microsoft.com/office/word/2016/wordml/cid';

/** A position in one story: a paragraph node id plus a UTF-16 offset inside it. */
export interface CommentPosition {
  readonly paragraphId: string;
  readonly offset: number;
}

/**
 * Where a comment is anchored, as a range.
 *
 * `orphaned` records that the file did not give this comment a usable range — a reference with
 * no range markers, or a start with no end. The comment is still listed, marked orphaned,
 * rather than dropped: a reviewer's remark disappearing silently is worse than one that says
 * it lost its text.
 */
export interface CommentAnchor {
  readonly commentId: string;
  /** Canonical name of the part the range lives in, so a header comment is attributable. */
  readonly partName: string;
  readonly start: CommentPosition;
  readonly end: CommentPosition;
  readonly orphaned: boolean;
}

/** One comment as authored in `word/comments.xml`. */
export interface CommentRecord {
  readonly id: string;
  readonly author: string;
  readonly initials?: string;
  readonly date?: string;
  /** Body paragraphs, as tree nodes, so the surface renders measured text rather than a string. */
  readonly blocks: readonly OoxmlElement[];
  /** `w14:paraId` of the last body paragraph — the key thread state is stored under. */
  readonly paraId?: string;
  /** `@w16cid:parentId` — the `w:id` of the comment this replies to, when the file names it. */
  readonly parentCommentId?: string;
}

/** Thread state for one comment, read from `commentsExtended.xml`. */
export interface CommentThreadState {
  /** `@w15:paraIdParent` — the comment this one replies to, absent for a top-level comment. */
  readonly parentParaId?: string;
  readonly done: boolean;
}

function attribute(
  node: OoxmlElement,
  namespaceUri: string,
  localName: string
): string | undefined {
  for (const entry of node.attributes) {
    if (entry.localName === localName && entry.namespaceUri === namespaceUri) return entry.value;
  }
  return undefined;
}

function wml(node: OoxmlElement, localName: string): string | undefined {
  return attribute(node, WML_NAMESPACE_URI, localName);
}

interface MarkerPoint {
  readonly commentId: string;
  readonly kind: 'start' | 'end';
  readonly offset: number;
}

/**
 * Comment range markers inside one paragraph, with the model offset each sits at.
 *
 * Offsets come from `paragraphOffsetIndex` — `segmentsOf`'s own walk — rather than from a
 * private character count. A marker occupies no characters, so it takes the offset of the
 * boundary it sits on, and that boundary is only right if everything before it measured what
 * the ops and the caret say it measures. The private count got two things wrong: it never
 * descended into `w:hyperlink`, so a comment after a link anchored short by the link's length
 * and markers written INSIDE one — which is what Word writes when you comment on link text —
 * yielded no anchor at all and reported the comment orphaned; and it gave a note reference or
 * an atomic field nothing where the model gives them one unit each.
 */
function markersInParagraphWithPolicy(
  paragraph: OoxmlParagraphNode,
  retainAcrossReads: boolean
): readonly MarkerPoint[] {
  // Paragraph-local by construction, like the offset index it reads — an unchanged
  // paragraph's markers sit at the offsets they sat at last time. Every full anchor pass
  // otherwise re-walked all paragraphs of the story, comments or none.
  const cached = retainAcrossReads ? markerPointsCache.get(paragraph) : undefined;
  if (cached) return cached;
  const points = computeMarkersInParagraph(paragraph, retainAcrossReads);
  if (retainAcrossReads) markerPointsCache.set(paragraph, points);
  return points;
}

/**
 * @internal The comment range markers inside one paragraph, with the offset each sits at; the
 * same reading a full anchor pass takes of that paragraph.
 */
export function commentMarkersOfParagraph(paragraph: OoxmlParagraphNode): readonly MarkerPoint[] {
  return markersInParagraphWithPolicy(paragraph, true);
}

/** Marker points per immutable paragraph node. */
const markerPointsCache = new FieldResultsModeMemo<OoxmlParagraphNode, readonly MarkerPoint[]>();

function computeMarkersInParagraph(
  paragraph: OoxmlParagraphNode,
  retainAcrossReads: boolean
): MarkerPoint[] {
  // Nearly every paragraph has no marker. Check the exact bounded containers the real walk
  // descends before building a full node-offset index, which is the expensive retained value.
  const hasMarker = (children: readonly OoxmlNode[], depth: number): boolean => {
    if (depth >= MAX_INLINE_CONTAINER_DEPTH) return false;
    for (const child of children) {
      if (child.kind === 'textValue') continue;
      if (child.kind === 'commentRangeStart' || child.kind === 'commentRangeEnd') return true;
      if (isInlineRunContainer(child) && hasMarker(child.children, depth + 1)) {
        return true;
      }
      if (!isContentControlNode(child)) continue;
      const content = contentControlContentOf(child);
      if (content && hasMarker(content.children, depth + 1)) return true;
    }
    return false;
  };
  if (!hasMarker(paragraph.children, 0)) return [];
  const offsets = retainAcrossReads
    ? paragraphOffsetIndex(paragraph)
    : transientParagraphOffsetIndex(paragraph);
  const points: MarkerPoint[] = [];
  const walk = (children: readonly OoxmlNode[], depth: number): void => {
    if (depth >= MAX_INLINE_CONTAINER_DEPTH) return;
    for (const child of children) {
      if (child.kind === 'textValue') continue;
      if (child.kind === 'commentRangeStart' || child.kind === 'commentRangeEnd') {
        const id = wml(child, 'id');
        const span = offsets.spanOf(child);
        // A marker the offset walk never reached — under a container it does not descend, or
        // past the nesting cap — has no position to report. It is left out, and the comment
        // is reported orphaned rather than anchored at a guessed offset.
        if (id !== undefined && span) {
          points.push({
            commentId: id,
            kind: child.kind === 'commentRangeStart' ? 'start' : 'end',
            offset: span.start,
          });
        }
        continue;
      }
      // A link is a run container like a revision wrapper, and either can hold the other.
      // Depth is bounded for the same reason the layout walk bounds it: nesting is the
      // cheapest unbounded axis in an attacker-controlled file.
      if (isInlineRunContainer(child)) {
        walk(child.children, depth + 1);
        continue;
      }
      if (!isContentControlNode(child)) continue;
      const content = contentControlContentOf(child);
      if (content) walk(content.children, depth + 1);
    }
  };
  walk(paragraph.children, 0);
  return points;
}

/**
 * Every comment anchor in one story, in document order.
 *
 * Overlapping and nested ranges are supported because each anchor is resolved independently —
 * Word produces both, and a model that assumed ranges nest cleanly would mis-anchor them.
 *
 * A start with no matching end anchors to the end of its own paragraph and is reported orphaned
 * rather than guessed at: extending it to the next end marker would attach a reviewer's remark
 * to text they never saw.
 */
export function commentAnchorsOfStory(part: OoxmlPart): CommentAnchor[] {
  return commentAnchorsOfStoryWithPolicy(part, true);
}

/** Export-only cold derivation that does not populate interactive comment memos. @internal */
export function commentAnchorsOfStoryTransient(part: OoxmlPart): CommentAnchor[] {
  return commentAnchorsOfStoryWithPolicy(part, false);
}

function commentAnchorsOfStoryWithPolicy(
  part: OoxmlPart,
  retainAcrossReads: boolean
): CommentAnchor[] {
  const open = new Map<string, CommentPosition>();
  const anchors: CommentAnchor[] = [];
  let lastPosition: CommentPosition | null = null;

  // Only a paragraph with markers can move `open`, `anchors` or `lastPosition`, so the
  // retained path walks just those; the transient export path keeps its memo-free walk.
  const paragraphs = retainAcrossReads ? markedParagraphsOfPart(part) : storyParagraphsOfPart(part);
  for (const paragraph of paragraphs) {
    for (const point of markersInParagraphWithPolicy(paragraph, retainAcrossReads)) {
      const position: CommentPosition = { paragraphId: paragraph.id, offset: point.offset };
      lastPosition = position;
      if (point.kind === 'start') {
        open.set(point.commentId, position);
        continue;
      }
      const start = open.get(point.commentId);
      if (start === undefined) {
        // An end with no start: the range is unusable, but the comment exists.
        anchors.push({
          commentId: point.commentId,
          partName: part.name,
          start: position,
          end: position,
          orphaned: true,
        });
        continue;
      }
      open.delete(point.commentId);
      anchors.push({
        commentId: point.commentId,
        partName: part.name,
        start,
        end: position,
        orphaned: false,
      });
    }
  }

  for (const [commentId, start] of open) {
    anchors.push({
      commentId,
      partName: part.name,
      start,
      end: lastPosition ?? start,
      orphaned: true,
    });
  }
  return anchors;
}

/**
 * Every authored paragraph in one story part, in reading order.
 *
 * A notes part also holds separator and continuation-separator stories. They are not editable
 * caret roots, but layout renders them and Word can retain comment markers inside them. Export
 * provenance therefore scans the whole supplied story part, including normal notes, separators,
 * table cells, content controls, and nested textbox stories.
 */
function storyParagraphsOfPart(part: OoxmlPart): readonly OoxmlParagraphNode[] {
  const found: OoxmlParagraphNode[] = [];
  const collect = (node: OoxmlNode, depth: number): void => {
    if (node.kind === 'textValue' || depth > MAX_STORY_WALK_DEPTH) return;
    if (node.kind === 'paragraph') found.push(node);
    // Comment ranges can live in a textbox story nested inside a host paragraph. Unlike the
    // editable root-story walk, anchor derivation must descend into that nested story while
    // retaining the host paragraph itself. Marker lookup remains paragraph-local, so the host
    // never consumes the nested paragraph's markers a second time.
    for (const child of node.children) collect(child, depth + 1);
  };
  collect(part.root, 0);
  return found;
}

const MAX_STORY_WALK_DEPTH = 64;
const NO_PARAGRAPHS: readonly OoxmlParagraphNode[] = Object.freeze([]);

/**
 * The root's answer, bounded to recent roots: the root and the story container are new on every
 * edit, and the undo history retains old roots by reference, so their answers are kept here
 * rather than per node.
 */
const markedParagraphsByRoot = createRecentRootCache<readonly OoxmlParagraphNode[]>(8);

function markedParagraphsOfPart(part: OoxmlPart): readonly OoxmlParagraphNode[] {
  const cached = markedParagraphsByRoot.get(part.root);
  if (cached) return cached;
  const paragraphs = markedParagraphsIn(part.root, 0, false);
  markedParagraphsByRoot.set(part.root, paragraphs);
  return paragraphs;
}

/**
 * The root and the body are replaced by every body edit, so they are not memoized per node; see
 * `markedParagraphsByRoot`. A header, footer or notes part keeps its blocks at depth 1, and
 * those are walked again each pass, which stays cheap: their own children answer from the memo.
 */
const MIN_MEMOIZED_DEPTH = 2;

/**
 * The paragraphs under `node` that carry comment markers, in the order
 * `storyParagraphsOfPart` visits them, memoized per immutable node.
 *
 * An edit replaces only the nodes on the path to what it changed, so the next anchor pass
 * re-walks that path and answers every untouched sibling from here — a keystroke no longer
 * visits every paragraph of the story. The depth the answer was computed at is part of the
 * key, because the walk's depth bound depends on where the node sits. Nothing inside a
 * paragraph is memoized: it is only walked when its paragraph is new, and an entry per run,
 * property and text element would cost more than the walk it saves.
 */
const markedParagraphsCache = createSubtreeAggregateMemo<{
  readonly depth: number;
  readonly paragraphs: readonly OoxmlParagraphNode[];
}>();
/** One shared entry per depth for the subtrees with no marked paragraph, which is most. */
const NO_MARKED_ENTRIES = Array.from({ length: MAX_STORY_WALK_DEPTH + 1 }, (_, depth) =>
  Object.freeze({ depth, paragraphs: NO_PARAGRAPHS })
);

function markedParagraphsIn(
  node: OoxmlNode,
  depth: number,
  insideParagraph: boolean
): readonly OoxmlParagraphNode[] {
  if (node.kind === 'textValue' || depth > MAX_STORY_WALK_DEPTH) return NO_PARAGRAPHS;
  // A node of leaves answers from its children again; an entry per one costs more.
  const memoize = !insideParagraph && depth >= MIN_MEMOIZED_DEPTH && keepsSubtreeMemo(node);
  const cached = memoize ? markedParagraphsCache.get(node) : undefined;
  if (cached && cached.depth === depth) return cached.paragraphs;
  let found: OoxmlParagraphNode[] | null = null;
  if (node.kind === 'paragraph' && markersInParagraphWithPolicy(node, true).length > 0) {
    found = [node];
  }
  for (const child of node.children) {
    const inner = markedParagraphsIn(
      child,
      depth + 1,
      insideParagraph || node.kind === 'paragraph'
    );
    if (inner.length === 0) continue;
    found ??= [];
    for (const paragraph of inner) found.push(paragraph);
  }
  const paragraphs = found ?? NO_PARAGRAPHS;
  if (memoize) {
    markedParagraphsCache.set(
      node,
      paragraphs === NO_PARAGRAPHS ? NO_MARKED_ENTRIES[depth]! : { depth, paragraphs },
      paragraphs.length
    );
  }
  return paragraphs;
}

/**
 * The comments in `word/comments.xml`, in authored order.
 *
 * Every value here comes from a file an attacker fully controls, so nothing is interpreted:
 * author, initials and date are carried verbatim for a surface that will set them as TEXT.
 */
export function commentsOfPart(part: OoxmlPart): CommentRecord[] {
  const comments: CommentRecord[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'comment') {
      const id = wml(node, 'id');
      if (id !== undefined) {
        const blocks: OoxmlElement[] = [];
        for (const child of node.children) {
          if (child.kind === 'paragraph' || child.kind === 'table') blocks.push(child);
        }
        const initials = wml(node, 'initials');
        const date = wml(node, 'date');
        let last: OoxmlElement | undefined;
        for (let index = blocks.length - 1; index >= 0; index -= 1) {
          if (blocks[index]?.kind !== 'paragraph') continue;
          last = blocks[index];
          break;
        }
        const paraId = last ? attribute(last, W14_NAMESPACE_URI, 'paraId') : undefined;
        // A comment naming ITSELF as parent is a file defect, not a cycle to propagate.
        const rawParent = attribute(node, W16CID_NAMESPACE_URI, 'parentId');
        const parentCommentId = rawParent === id ? undefined : rawParent;
        comments.push({
          id,
          author: wml(node, 'author') ?? '',
          ...(initials === undefined ? {} : { initials }),
          ...(date === undefined ? {} : { date }),
          blocks,
          ...(paraId === undefined ? {} : { paraId }),
          ...(parentCommentId === undefined ? {} : { parentCommentId }),
        });
      }
      return;
    }
    for (const child of node.children) visit(child);
  };
  visit(part.root);
  return comments;
}

/**
 * Thread state by `w14:paraId`, from `commentsExtended.xml`.
 *
 * The part being PRESENT is not evidence of threading. `issue-68-large-comments-suggestions.docx`
 * ships it with 212 entries carrying `@w15:done` and not one `@w15:paraIdParent`, so it records
 * resolved state for a flat list. Absent parent means top-level, and that is a fact about the
 * file rather than a default this code chose.
 */
export function threadStateOfPart(part: OoxmlPart): Map<string, CommentThreadState> {
  const states = new Map<string, CommentThreadState>();
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.namespaceUri === W15_NAMESPACE_URI && node.localName === 'commentEx') {
      const paraId = attribute(node, W15_NAMESPACE_URI, 'paraId');
      if (paraId !== undefined) {
        const parent = attribute(node, W15_NAMESPACE_URI, 'paraIdParent');
        const done = attribute(node, W15_NAMESPACE_URI, 'done');
        states.set(paraId.toUpperCase(), {
          ...(parent === undefined ? {} : { parentParaId: parent.toUpperCase() }),
          // `@w15:done` is `ST_OnOff`: absent reads as false, and only the true spellings
          // count. A file writing `done="0"` means unresolved, not resolved.
          done: done === '1' || done === 'true' || done === 'on',
        });
      }
      return;
    }
    for (const child of node.children) visit(child);
  };
  visit(part.root);
  return states;
}

/**
 * Whether the package holds any `w:comment` record — the cheap gate before a reap.
 *
 * Overflow cannot prove the package is comment-free, so it returns true and the reap still
 * runs rather than skipping cleanup.
 */
export function hasAnyComment(pkg: OoxmlPackage): boolean {
  const budget = createCommentScanBudget();
  for (const part of pkg.parts.values()) {
    if (!part.name.endsWith('.xml')) continue;
    if (!chargePart(budget)) return true;
    let found = false;
    const finished = walkCharged(part.root, budget, (node) => {
      if (node.kind !== 'comment') return false;
      found = true;
      return true;
    });
    if (found) return true;
    if (!finished) return true;
  }
  return false;
}
