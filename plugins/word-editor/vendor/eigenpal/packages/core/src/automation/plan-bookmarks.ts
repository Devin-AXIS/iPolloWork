// Planning the bookmark operations that name bookmarks rather than hold a handle to one:
// `Range.insertBookmark`, `Range.getBookmarks`, `Document.deleteBookmark`,
// `Document.getBookmarkRange` and `Bookmark.delete`.
//
// NAMES ARE CASE-INSENSITIVE AND DOCUMENT-WIDE. A lookup by name searches the main text first,
// then each section's headers and footers, then the notes, and the first bookmark that declares
// the name, in any case, answers. Adding a name that another story declares moves it: the write
// commits in the target story and removes the name from the other part in the same transaction.
// Deleting one in a story the batch does not write into is a package edit of that transaction
// too, so a batch can delete bookmarks anywhere and still edit one story.

import { bookmarkNameKey, bookmarkNameProblem } from '../store/package/bookmark-names.ts';
import type { OoxmlPackage } from '../store/package/ooxml-package.ts';
import {
  enclosedBookmarkDeletions,
  withoutBookmarkInPart,
  type BookmarkOpPosition,
} from '../store/store/tree-op-bookmarks.ts';
import type { TreeDocOp } from '../store/store/tree-ops.ts';
import type { AutomationHandleTable } from './handles.ts';
import { bookmarkIn, bookmarkReads, type AutomationBookmarkRead } from './links.ts';
import type { AutomationOperation } from './operations.ts';
import type { PlannedOperation } from './plan-types.ts';
import { TARGET_REMOVED } from './target-removed.ts';
import type { AutomationHandle, AutomationValue } from './protocol.ts';
import type { AutomationPackageReads, AutomationStoryReads } from './reads.ts';
import { resolveSpanRef, spanParagraphIds, spanValue, storyOfSpanRef } from './spans.ts';
import { BODY_STORY, HEADER_FOOTER_VARIANTS, storyKey, type AutomationStoryId } from './stories.ts';

type BookmarkOperation = Extract<
  AutomationOperation,
  {
    op:
      | 'getBookmarks'
      | 'getBookmarkName'
      | 'getBookmarkNames'
      | 'getBookmarkRangeByName'
      | 'insertBookmark'
      | 'deleteBookmark';
  }
>;

/** Whether an operation is one this planner owns. */
export function isBookmarkOperation(
  operation: AutomationOperation
): operation is BookmarkOperation {
  return (
    operation.op === 'getBookmarks' ||
    operation.op === 'getBookmarkName' ||
    operation.op === 'getBookmarkNames' ||
    operation.op === 'getBookmarkRangeByName' ||
    operation.op === 'insertBookmark' ||
    operation.op === 'deleteBookmark'
  );
}

const APPLIED: AutomationValue = Object.freeze({ kind: 'applied' as const });

const refuse = (
  code: 'unsupported-content' | 'invalid-handle' | 'unsupported-capability' | 'invalid-offset',
  message: string,
  detail?: string
): PlannedOperation => ({
  ok: false,
  error: detail === undefined ? { code, message } : { code, message, detail },
});

const query = (value: AutomationValue): PlannedOperation => ({ ok: true, kind: 'query', value });

/** Every story of the document, in lookup order: main text, headers and footers, notes. */
function storiesOf(reads: AutomationPackageReads): readonly AutomationStoryReads[] {
  const found: AutomationStoryReads[] = [];
  const seen = new Set<string>();
  const add = (id: AutomationStoryId) => {
    const story = reads.story(id);
    if (!story || seen.has(storyKey(id))) return;
    seen.add(storyKey(id));
    found.push(story);
  };
  add(BODY_STORY);
  reads.sections().forEach((_section, sectionIndex) => {
    for (const kind of ['header', 'footer'] as const) {
      for (const variant of HEADER_FOOTER_VARIANTS) {
        const declared = reads
          .furniture(sectionIndex)
          .some((entry) => entry.kind === kind && entry.variant === variant && entry.declared);
        if (declared) add({ kind, sectionIndex, variant });
      }
    }
  });
  for (const noteKind of ['footnote', 'endnote'] as const) {
    const ids = reads.noteIds(noteKind);
    if (ids.ok) for (const noteId of ids.ids) add({ kind: 'note', noteKind, noteId });
  }
  return found;
}

/** The first bookmark with this name, compared without case, and its story. */
function findByName(
  reads: AutomationPackageReads,
  name: string
): { readonly story: AutomationStoryReads; readonly bookmark: AutomationBookmarkRead } | null {
  const key = bookmarkNameKey(name);
  for (const story of storiesOf(reads)) {
    const bookmark = bookmarkReads(story, { includeHidden: true }).find(
      (entry) => bookmarkNameKey(entry.name) === key
    );
    if (bookmark) return { story, bookmark };
  }
  return null;
}

/** A point in story order, comparable as a tuple. */
type Point = readonly [index: number, offset: number];
const before = (a: Point, b: Point) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
const same = (a: Point, b: Point) => a[0] === b[0] && a[1] === b[1];
const atOrBefore = (a: Point, b: Point) => before(a, b) || same(a, b);

/**
 * Whether a bookmark belongs to a range's answer.
 *
 * A non-empty range holds a range bookmark when the two share text, and a point bookmark when
 * the point is inside the range or at its start. An empty range holds the bookmarks it sits in,
 * counting a bookmark's start but not its end, and a point bookmark at the same place. Adjacent
 * bookmarks touch the range at one end without sharing text.
 */
export function bookmarkInRange(
  range: { readonly start: Point; readonly end: Point },
  bookmark: { readonly start: Point; readonly end: Point },
  includeAdjacent: boolean
): boolean {
  const empty = same(range.start, range.end);
  const point = same(bookmark.start, bookmark.end);
  let overlaps: boolean;
  if (empty) {
    overlaps = point
      ? same(bookmark.start, range.start)
      : atOrBefore(bookmark.start, range.start) && before(range.start, bookmark.end);
  } else if (point) {
    overlaps = atOrBefore(range.start, bookmark.start) && before(bookmark.start, range.end);
  } else {
    overlaps = before(bookmark.start, range.end) && before(range.start, bookmark.end);
  }
  if (overlaps || !includeAdjacent) return overlaps;
  return same(bookmark.end, range.start) || same(bookmark.start, range.end);
}

/** The batch planner's hold on writes, as the bookmark planner needs it. */
export interface BookmarkWriteAdmission {
  /** Pin the batch's write story and claim the paragraphs, or say why not. */
  readonly admit: (
    story: AutomationStoryReads,
    paragraphIds: readonly string[]
  ) => PlannedOperation | null;
  /** The story the batch already writes into, or null. */
  readonly pinned: () => AutomationStoryId | null;
}

/** `admit` from the batch planner's own pin and claim. */
export function bookmarkWriteAdmission<Plan>(
  planFor: (story: AutomationStoryReads) => Plan,
  pinWrite: (plan: Plan) => PlannedOperation | null,
  claim: (plan: Plan, paragraphId: string) => PlannedOperation | null
): BookmarkWriteAdmission['admit'] {
  return (story, paragraphIds) => {
    const plan = planFor(story);
    return (
      pinWrite(plan) ??
      [...new Set(paragraphIds)].reduce<PlannedOperation | null>(
        (refusal, id) => refusal ?? claim(plan, id),
        null
      )
    );
  };
}

/** An untracked replacement takes the bookmarks its old text enclosed, as typing over it does. */
export function withEnclosedBookmarkDrops(
  planned: PlannedOperation,
  reads: AutomationStoryReads,
  range: { readonly start: BookmarkOpPosition; readonly end: BookmarkOpPosition },
  tracked: boolean
): PlannedOperation {
  if (tracked || !planned.ok || planned.kind !== 'command' || planned.relate) return planned;
  const drops = enclosedBookmarkDeletions(reads.part, range.start, range.end, reads.paragraphIds);
  return drops.length === 0 ? planned : { ...planned, ops: [...drops, ...planned.ops] };
}

/** The range a bookmark handle names, with its story, or why it names none. */
export function bookmarkHandleRange(
  handle: AutomationHandle,
  handles: AutomationHandleTable,
  reads: AutomationPackageReads
) {
  const target = handles.resolve(handle, 'bookmark');
  if (!target || target.kind !== 'bookmark')
    return refuse('invalid-handle', 'that handle does not name a bookmark', 'bookmark');
  const story = reads.story(target.story);
  if (!story) return refuse('invalid-handle', 'that story is not in this document');
  const bookmark = bookmarkIn(story, target.name);
  // Removed by an edit, a peer, or an undo: reading again finds a fresh handle.
  if (!bookmark)
    return refuse(
      'invalid-handle',
      'this document no longer declares that bookmark',
      TARGET_REMOVED
    );
  const point = (marker: { readonly paragraphId: string; readonly offset: number }) => ({
    story: story.story,
    paragraphId: marker.paragraphId,
    index: story.indexOf(marker.paragraphId),
    offset: marker.offset,
  });
  return { reads: story, range: { start: point(bookmark.start), end: point(bookmark.end) } };
}

/** Plan a bookmark operation. */
export function planBookmarks(
  operation: BookmarkOperation,
  handles: AutomationHandleTable,
  reads: AutomationPackageReads,
  { admit, pinned }: BookmarkWriteAdmission
): PlannedOperation {
  if (operation.op === 'getBookmarkName') {
    const target = handles.resolve(operation.bookmark, 'bookmark');
    if (!target || target.kind !== 'bookmark')
      return refuse('invalid-handle', 'that handle does not name a bookmark', 'bookmark');
    return query({ kind: 'text', text: target.name });
  }
  if (operation.op === 'getBookmarks') {
    const resolved = resolveSpanRef(operation.scope, handles, reads);
    if (!resolved.ok) return refuse(resolved.code, 'that span is not a place', resolved.detail);
    const story = storyOfSpanRef(operation.scope, handles, reads);
    if (!story.ok) return refuse(story.code, 'that span is not a place', story.detail);
    const scope = resolved.value;
    const covered = scope === null ? null : new Set(spanParagraphIds(scope, story.value));
    const overlapping = bookmarkReads(story.value).filter((bookmark) => {
      if (!covered || scope === null) return false;
      // Overlap, not containment: a range that starts inside a bookmark and ends past it has
      // that bookmark.
      if (!covered.has(bookmark.start.paragraphId) && !covered.has(bookmark.end.paragraphId))
        return false;
      const startsAfter =
        bookmark.start.paragraphId === scope.end.paragraphId &&
        bookmark.start.offset > scope.end.offset;
      const endsBefore =
        bookmark.end.paragraphId === scope.start.paragraphId &&
        bookmark.end.offset < scope.start.offset;
      return !startsAfter && !endsBefore;
    });
    return query({
      kind: 'handles',
      handles: overlapping.map((bookmark) => handles.bookmark(bookmark.name, story.value.story)),
    });
  }

  if (operation.op === 'getBookmarkNames') {
    const resolved = resolveSpanRef(operation.scope, handles, reads);
    if (!resolved.ok) return refuse(resolved.code, 'that range is not a place', resolved.detail);
    const story = storyOfSpanRef(operation.scope, handles, reads);
    if (!story.ok) return refuse(story.code, 'that range is not a place', story.detail);
    const span = resolved.value;
    if (!span) return query({ kind: 'texts', texts: [] });
    const at = (paragraphId: string, offset: number): Point => [
      story.value.indexOf(paragraphId),
      offset,
    ];
    const range = {
      start: at(span.start.paragraphId, span.start.offset),
      end: at(span.end.paragraphId, span.end.offset),
    };
    const names = bookmarkReads(story.value, { includeHidden: operation.includeHidden })
      .filter((bookmark) =>
        bookmarkInRange(
          range,
          {
            start: at(bookmark.start.paragraphId, bookmark.start.offset),
            end: at(bookmark.end.paragraphId, bookmark.end.offset),
          },
          operation.includeAdjacent
        )
      )
      .map((bookmark) => bookmark.name);
    return query({ kind: 'texts', texts: Object.freeze(names) });
  }

  if (operation.op === 'getBookmarkRangeByName') {
    if (!handles.resolve(operation.document, 'document'))
      return refuse('invalid-handle', 'that handle does not name a document', 'document');
    if (typeof operation.name !== 'string')
      return refuse('unsupported-content', 'a bookmark name is a string');
    const found = findByName(reads, operation.name);
    if (!found) return query({ kind: 'spans', spans: [] });
    const point = (marker: AutomationBookmarkRead['start']) => ({
      story: found.story.story,
      paragraphId: marker.paragraphId,
      index: found.story.indexOf(marker.paragraphId),
      offset: marker.offset,
    });
    return query({
      kind: 'spans',
      spans: [
        spanValue({ start: point(found.bookmark.start), end: point(found.bookmark.end) }, handles),
      ],
    });
  }

  if (operation.op === 'insertBookmark') {
    if (typeof operation.name !== 'string' || bookmarkNameProblem(operation.name) !== null)
      return refuse(
        'unsupported-content',
        'a bookmark name starts with a letter or an underscore, holds only letters, digits and underscores, and has at most 40 characters',
        'invalid-bookmark-name'
      );
    const resolved = resolveSpanRef(operation.span, handles, reads);
    if (!resolved.ok) return refuse(resolved.code, 'that range is not a place', resolved.detail);
    const story = storyOfSpanRef(operation.span, handles, reads);
    if (!story.ok) return refuse(story.code, 'that range is not a place', story.detail);
    const span = resolved.value;
    if (!span) return refuse('invalid-offset', 'this story holds no paragraph to bookmark');
    // One name, one bookmark: a name another part declares leaves that part in the same
    // transaction. Within one part the insert op moves it itself.
    const key = bookmarkNameKey(operation.name);
    const otherParts = new Set(
      storiesOf(reads)
        .filter(
          (candidate) =>
            candidate.part.name !== story.value.part.name &&
            bookmarkReads(candidate, { includeHidden: true }).some(
              (entry) => bookmarkNameKey(entry.name) === key
            )
        )
        .map((candidate) => candidate.part.name)
    );
    const refusal = admit(story.value, [span.start.paragraphId, span.end.paragraphId]);
    if (refusal) return refusal;
    const op: TreeDocOp = {
      op: 'insertBookmark',
      name: operation.name,
      start: { paragraphId: span.start.paragraphId, offset: span.start.offset },
      end: { paragraphId: span.end.paragraphId, offset: span.end.offset },
    };
    return {
      ok: true,
      kind: 'command',
      ops: [op],
      story: story.value.story,
      ...(otherParts.size > 0
        ? {
            packageEdits: [
              (pkg: OoxmlPackage) => {
                let next = pkg;
                for (const partName of otherParts)
                  next = withoutBookmarkInPart(next, partName, operation.name);
                return next;
              },
            ],
          }
        : {}),
      answer: () => APPLIED,
    };
  }

  // deleteBookmark
  const target = operation.target;
  let found: ReturnType<typeof findByName>;
  if ('bookmark' in target) {
    const resolved = handles.resolve(target.bookmark, 'bookmark');
    if (!resolved || resolved.kind !== 'bookmark')
      return refuse('invalid-handle', 'that handle does not name a bookmark', 'bookmark');
    const story = reads.story(resolved.story);
    const bookmark = story
      ? bookmarkReads(story, { includeHidden: true }).find((entry) => entry.name === resolved.name)
      : undefined;
    if (!story || !bookmark)
      return refuse(
        'invalid-handle',
        'this document no longer declares that bookmark',
        resolved.name
      );
    found = { story, bookmark };
  } else {
    if (!handles.resolve(target.document, 'document'))
      return refuse('invalid-handle', 'that handle does not name a document', 'document');
    if (typeof target.name !== 'string')
      return refuse('unsupported-content', 'a bookmark name is a string');
    found = findByName(reads, target.name);
  }
  // Deleting a name nothing declares is what the caller asked for already. Answered as a read,
  // so it pins no write story and never conflicts with the batch's writes elsewhere.
  if (!found) return query(APPLIED);
  // Outside the story the batch writes into, or before any write, the markers leave their part
  // as a package edit of the same transaction. It pins no story, so a delete can share a sync
  // with writes anywhere. Removing markers moves no text offset, so it claims no paragraph.
  const writing = pinned();
  if (writing === null || storyKey(writing) !== storyKey(found.story.story)) {
    const partName = found.story.part.name;
    const name = found.bookmark.name;
    return {
      ok: true,
      kind: 'command',
      ops: [],
      story: writing ?? found.story.story,
      packageEdits: [(pkg: OoxmlPackage) => withoutBookmarkInPart(pkg, partName, name)],
      answer: () => APPLIED,
    };
  }
  const refusal = admit(found.story, [
    found.bookmark.start.paragraphId,
    found.bookmark.end.paragraphId,
  ]);
  if (refusal) return refusal;
  return {
    ok: true,
    kind: 'command',
    ops: [{ op: 'deleteBookmark', name: found.bookmark.name }],
    story: found.story.story,
    answer: () => APPLIED,
  };
}
