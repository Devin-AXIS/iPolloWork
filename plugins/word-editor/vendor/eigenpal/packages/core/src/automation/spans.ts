import { scopedStoryReads } from './reads.ts';
import { findNode } from '../store/package/ooxml-edit.ts';
// Turning the protocol's positions into positions in a document.
//
// INTERNAL. A caller says "the paragraph behind this handle, sixteen UTF-16 units in", or "the
// end of this body". Both have to become a canonical node id and a model offset before any read
// or op can use them, and both can be WRONG in ways that must be named rather than guessed at:
// a handle for a paragraph that has since been deleted, an offset past the end of a paragraph,
// a span whose start comes after its end.
//
// Resolution is against a SNAPSHOT, so a resolved position is only meaningful together with the
// package it was resolved against. That is deliberate: it is what makes "this handle is stale"
// a detectable condition instead of a silent misplacement.

import type { AutomationHandleTable } from './handles.ts';
import type { AutomationEndpoint, AutomationHandle, AutomationSpan } from './protocol.ts';
import type {
  AutomationParagraphRef,
  AutomationPoint,
  AutomationSpanRef,
  AutomationTextProjection,
} from './operations.ts';
import type { AutomationPackageReads, AutomationStoryReads } from './reads.ts';
import { storyKey, type AutomationStoryId } from './stories.ts';

/**
 * A position in a document: which story, a canonical paragraph id in it, its position in that
 * story's reading order, and a model offset.
 *
 * The STORY travels with the position, so a resolved point says which part its offsets are
 * measured in. Without it a range resolved from a header handle and a range resolved from the body
 * are the same shape, and a planner has nothing to stop it writing one where the other belongs.
 */
export interface ResolvedPoint {
  readonly story: AutomationStoryId;
  readonly paragraphId: string;
  readonly index: number;
  readonly offset: number;
}

export interface ResolvedRange {
  readonly start: ResolvedPoint;
  readonly end: ResolvedPoint;
}

/** A stretch of a document. `null` where a span covers a story that holds no paragraph. */
export type ResolvedSpan = ResolvedRange | null;

export type ResolutionCode = 'invalid-handle' | 'invalid-offset';

export type Resolution<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: ResolutionCode; readonly detail: string };

function fail<T>(code: ResolutionCode, detail: string): Resolution<T> {
  return { ok: false, code, detail };
}

function ok<T>(value: T): Resolution<T> {
  return { ok: true, value };
}

/**
 * The story reads a handle addresses, or a refusal.
 *
 * One place answers "which story is this handle in", so a stale handle and a handle naming a story
 * the document no longer has are both `invalid-handle` rather than a silent fall back to the body.
 */
export function storyOfHandle(
  handle: AutomationHandle,
  kind: 'body' | 'paragraph',
  handles: AutomationHandleTable,
  reads: AutomationPackageReads
): Resolution<AutomationStoryReads> {
  const resolved = handles.resolve(handle, kind);
  if (!resolved || (resolved.kind !== 'body' && resolved.kind !== 'paragraph'))
    return fail('invalid-handle', `not-a-${kind}-handle`);
  const story = reads.story(resolved.story);
  if (!story) return fail('invalid-handle', `no-such-story:${storyKey(resolved.story)}`);
  if (resolved.kind === 'body' && resolved.rootNodeId) {
    const root = findNode(story.part, resolved.rootNodeId);
    if (!root || root.kind !== 'tableCell') return fail('invalid-handle', 'cell-not-in-story');
    return ok(scopedStoryReads(story, root));
  }
  return ok(story);
}

/** A paragraph handle, checked against the story it claims to be in. */
export function resolveParagraphHandle(
  handle: AutomationHandle,
  handles: AutomationHandleTable,
  reads: AutomationPackageReads
): Resolution<ResolvedPoint> {
  const resolved = handles.resolve(handle, 'paragraph');
  if (!resolved || resolved.kind !== 'paragraph')
    return fail('invalid-handle', 'not-a-paragraph-handle');
  const story = reads.story(resolved.story);
  if (!story) return fail('invalid-handle', `no-such-story:${storyKey(resolved.story)}`);
  const index = story.indexOf(resolved.paragraphId);
  // A handle whose paragraph left the story is STALE, not merely unknown: the deletion that
  // removed it is exactly why the caller must be told rather than silently retargeted.
  if (index < 0) return fail('invalid-handle', 'paragraph-not-in-body');
  return ok({ story: resolved.story, paragraphId: resolved.paragraphId, index, offset: 0 });
}

/** An explicit `{ paragraph, offset }` endpoint. */
export function resolveEndpoint(
  endpoint: AutomationEndpoint,
  handles: AutomationHandleTable,
  reads: AutomationPackageReads
): Resolution<ResolvedPoint> {
  const paragraph = resolveParagraphHandle(endpoint.paragraph, handles, reads);
  if (!paragraph.ok) return paragraph;
  const story = reads.story(paragraph.value.story);
  const length = (story?.rawText(paragraph.value.paragraphId) ?? '').length;
  const { offset } = endpoint;
  if (!Number.isInteger(offset) || offset < 0 || offset > length)
    return fail('invalid-offset', `offset ${String(offset)} outside 0..${String(length)}`);
  return ok({ ...paragraph.value, offset });
}

/** A point: an endpoint, or one edge of a paragraph or a story. */
export function resolvePoint(
  point: AutomationPoint,
  handles: AutomationHandleTable,
  reads: AutomationPackageReads
): Resolution<ResolvedPoint> {
  if ('paragraph' in point) {
    if (!('at' in point)) return resolveEndpoint(point, handles, reads);
    const paragraph = resolveParagraphHandle(point.paragraph, handles, reads);
    if (!paragraph.ok) return paragraph;
    if (point.at === 'start') return paragraph;
    const story = reads.story(paragraph.value.story);
    const length = (story?.rawText(paragraph.value.paragraphId) ?? '').length;
    return ok({ ...paragraph.value, offset: length });
  }
  const story = storyOfHandle(point.body, 'body', handles, reads);
  if (!story.ok) return story;
  const ids = story.value.paragraphIds;
  if (ids.length === 0) return fail('invalid-offset', 'empty-story');
  if (point.at === 'start')
    return ok({
      story: story.value.story,
      paragraphId: ids[0] as string,
      index: story.value.indexOf(ids[0]!),
      offset: 0,
    });
  const index = ids.length - 1;
  const paragraphId = ids[index] as string;
  return ok({
    story: story.value.story,
    paragraphId,
    index: story.value.indexOf(paragraphId),
    offset: (story.value.rawText(paragraphId) ?? '').length,
  });
}

/** Whether `a` is at or before `b`. */
function ordered(a: ResolvedPoint, b: ResolvedPoint): boolean {
  return a.index < b.index || (a.index === b.index && a.offset <= b.offset);
}

/** The whole of a story, or null when it holds no paragraph. */
function wholeStory(reads: AutomationStoryReads): ResolvedSpan {
  const ids = reads.paragraphIds;
  if (ids.length === 0) return null;
  const lastIndex = ids.length - 1;
  const lastId = ids[lastIndex] as string;
  return {
    start: {
      story: reads.story,
      paragraphId: ids[0] as string,
      index: reads.indexOf(ids[0]!),
      offset: 0,
    },
    end: {
      story: reads.story,
      paragraphId: lastId,
      index: reads.indexOf(lastId),
      offset: (reads.rawText(lastId) ?? '').length,
    },
  };
}

/** A span: two points, a whole paragraph, or a whole story. */
export function resolveSpanRef(
  span: AutomationSpanRef,
  handles: AutomationHandleTable,
  reads: AutomationPackageReads
): Resolution<ResolvedSpan> {
  if ('body' in span) {
    const story = storyOfHandle(span.body, 'body', handles, reads);
    if (!story.ok) return story;
    return ok(wholeStory(story.value));
  }
  if ('paragraph' in span) {
    const paragraph = resolveParagraphHandle(span.paragraph, handles, reads);
    if (!paragraph.ok) return paragraph;
    const story = reads.story(paragraph.value.story);
    const length = (story?.rawText(paragraph.value.paragraphId) ?? '').length;
    return ok({ start: paragraph.value, end: { ...paragraph.value, offset: length } });
  }
  const start = resolvePoint(span.start, handles, reads);
  if (!start.ok) return start;
  const end = resolvePoint(span.end, handles, reads);
  if (!end.ok) return end;
  // ONE STORY PER SPAN. Two ends in two stories describe no stretch of any document: their
  // offsets are measured in different parts, and the paragraphs between them do not exist.
  if (storyKey(start.value.story) !== storyKey(end.value.story))
    return fail('invalid-handle', 'span-crosses-stories');
  if (!ordered(start.value, end.value)) return fail('invalid-offset', 'span-start-after-end');
  return ok({ start: start.value, end: end.value });
}

/**
 * Which story a span ref addresses, whether or not that story holds a paragraph.
 *
 * A span over an EMPTY story resolves to `null` — there is no paragraph to name — and a reader
 * asking that story for its formatting still deserves an answer rather than a refusal. The story
 * identity comes from the ref itself, which is the one part of the request that survives the
 * story being empty.
 */
export function storyOfSpanRef(
  span: AutomationSpanRef,
  handles: AutomationHandleTable,
  reads: AutomationPackageReads
): Resolution<AutomationStoryReads> {
  if ('body' in span) return storyOfHandle(span.body, 'body', handles, reads);
  if ('paragraph' in span) return storyOfHandle(span.paragraph, 'paragraph', handles, reads);
  const start = span.start;
  return 'paragraph' in start
    ? storyOfHandle(start.paragraph, 'paragraph', handles, reads)
    : storyOfHandle(start.body, 'body', handles, reads);
}

/** A paragraph reference: a handle, or one end of a story. */
export function resolveParagraphRef(
  ref: AutomationParagraphRef,
  handles: AutomationHandleTable,
  reads: AutomationPackageReads
): Resolution<ResolvedPoint> {
  if ('paragraph' in ref) return resolveParagraphHandle(ref.paragraph, handles, reads);
  const story = storyOfHandle(ref.body, 'body', handles, reads);
  if (!story.ok) return story;
  const ids = story.value.paragraphIds;
  if (ids.length === 0) return fail('invalid-offset', 'empty-story');
  const index = ref.at === 'first' ? 0 : ids.length - 1;
  return ok({
    story: story.value.story,
    paragraphId: ids[index] as string,
    index,
    offset: 0,
  });
}

/** The canonical ids a span covers, in reading order. */
export function spanParagraphIds(
  span: ResolvedSpan,
  reads: AutomationStoryReads
): readonly string[] {
  if (!span) return [];
  const ids = reads.paragraphIds;
  // Resolved positions use whole-story indexes. A cell-scoped read exposes only
  // its own paragraphs, so those positions need indexes within this array.
  const start =
    ids[span.start.index] === span.start.paragraphId
      ? span.start.index
      : ids.indexOf(span.start.paragraphId);
  const end =
    ids[span.end.index] === span.end.paragraphId
      ? span.end.index
      : ids.indexOf(span.end.paragraphId);
  return start < 0 || end < start ? [] : ids.slice(start, end + 1);
}

/** One paragraph's share of a span: the offsets inside it the span actually reaches. */
export interface SpanOffsets {
  readonly paragraphId: string;
  readonly start: number;
  readonly end: number;
  /** Whether the span reaches from the paragraph's first offset to its last. */
  readonly whole: boolean;
}

/**
 * A span broken into one entry per paragraph it covers, clipped at its own two ends.
 *
 * The vocabulary every per-character operation needs: formatting, link wrapping and bookmark
 * containment all ask "which characters of which paragraph", and each computing the clipping
 * itself is how two of them end up disagreeing at a paragraph boundary.
 */
export function spanOffsets(
  span: ResolvedSpan,
  reads: AutomationStoryReads
): readonly SpanOffsets[] {
  if (!span) return [];
  const ids = spanParagraphIds(span, reads);
  const last = ids.length - 1;
  return ids.map((paragraphId, position) => {
    const length = (reads.rawText(paragraphId) ?? '').length;
    const start = position === 0 ? span.start.offset : 0;
    const end = position === last ? span.end.offset : length;
    return { paragraphId, start, end, whole: start === 0 && end === length };
  });
}

/**
 * The text a span covers, with a paragraph mark at every paragraph boundary it crosses.
 *
 * This is display text. Field atoms can expand beyond their model length. Paragraph marks still
 * preserve visible story boundaries, but callers must use raw reads for model offset math.
 */
export function spanText(
  span: ResolvedSpan,
  reads: AutomationStoryReads,
  paragraphMark: string,
  projection: AutomationTextProjection = 'allMarkup'
): string {
  if (!span) return '';
  const ids = spanParagraphIds(span, reads);
  if (ids.length === 1) {
    return (
      reads
        .projectedText(span.start.paragraphId, projection)
        ?.sliceRaw(span.start.offset, span.end.offset) ?? ''
    );
  }
  return ids
    .map((id, position) => {
      const projected = reads.projectedText(id, projection);
      if (!projected) return '';
      const rawLength = (reads.rawText(id) ?? '').length;
      if (position === 0) return projected.sliceRaw(span.start.offset, rawLength);
      if (position === ids.length - 1) return projected.sliceRaw(0, span.end.offset);
      return projected.text;
    })
    .join(paragraphMark);
}

/** A resolved range in protocol vocabulary, with handles minted for its endpoints. */
export function spanValue(range: ResolvedRange, handles: AutomationHandleTable): AutomationSpan {
  return {
    start: {
      paragraph: handles.paragraph(range.start.paragraphId, range.start.story),
      offset: range.start.offset,
    },
    end: {
      paragraph: handles.paragraph(range.end.paragraphId, range.end.story),
      offset: range.end.offset,
    },
  };
}
