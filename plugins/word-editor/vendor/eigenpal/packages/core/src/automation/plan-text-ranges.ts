// Planning the range reads an agent uses to address and re-read words: `Range.getTextRanges`,
// `Paragraph.getTextRanges`, `Range.expandTo`, and `getReviewedText` on a range or a paragraph.
//
// TOKENS COME FROM THE MODEL TEXT THE VIEW SHOWS. A field, an equation, a picture, and a note
// reference each occupy one model offset, so a token can never end inside one: an atom counts as
// an ordinary non-spacing character and stays in the token it touches. A tab is a spacing
// character, so `trimSpacing` removes it from the edges of a token, but it ends a token only when
// the caller lists it as an ending mark. An inline content control's boundaries occupy no offset,
// so its text joins the tokens around it. A paragraph end always ends a token, and no token holds
// a paragraph mark.
//
// THE VIEW DECIDES WHAT A TOKEN IS. Text the view hides (a pending insertion in the `original`
// view, a floating drawing in any view) holds no ending mark, and a token's span starts at its
// first shown character and ends after its last one, so an edit through it never reaches hidden
// text at its edges. Hidden text strictly between two shown characters of one token stays inside
// the span: an edit through that token also edits the hidden text, which the documentation
// states.
//
// REVIEWED TEXT IS A READ ONLY. `current` drops pending deletions and the paragraph marks they
// delete, `original` drops pending insertions and inserted marks, as if every revision were
// accepted or rejected. Neither changes the document.

import { paragraphMarkRevisionOf } from '../store/store/tree-op-tracked-marks.ts';
import type { AutomationHandleTable } from './handles.ts';
import type { AutomationOperation, AutomationTextProjection } from './operations.ts';
import type { PlannedOperation } from './plan-types.ts';
import type { AutomationErrorCode, AutomationSpan } from './protocol.ts';
import { PARAGRAPH_MARK, type AutomationPackageReads, type AutomationStoryReads } from './reads.ts';
import {
  resolveSpanRef,
  spanParagraphIds,
  spanValue,
  storyOfSpanRef,
  type ResolvedPoint,
  type ResolvedRange,
} from './spans.ts';
import { storyKey } from './stories.ts';
import { projectReviewedParagraphText } from './text-projection.ts';
import { planParagraphText } from './plan-paragraph-text.ts';

type TextRangeOperation = Extract<
  AutomationOperation,
  {
    op:
      | 'getTextRanges'
      | 'getParagraphTextIfPresent'
      | 'getParagraphTextSpan'
      | 'expandSpan'
      | 'getReviewedText';
  }
>;

/** Most ending marks one `getTextRanges` call may name. */
export const MAX_TEXT_RANGE_MARKS = 32;
/** Longest ending mark, in UTF-16 code units. */
export const MAX_TEXT_RANGE_MARK_LENGTH = 32;

/** Characters `trimSpacing` removes from a token's edges: space, tab, and column break. */
const SPACING = new Set([' ', '\t', '\u000e']);

function refuse(code: AutomationErrorCode, message: string, detail?: string): PlannedOperation {
  return {
    ok: false,
    error: detail === undefined ? { code, message } : { code, message, detail },
  };
}

/** Plan one text-range read against the batch snapshot. */
export function planTextRanges(
  operation: TextRangeOperation,
  handles: AutomationHandleTable,
  reads: AutomationPackageReads
): PlannedOperation {
  if (operation.op === 'expandSpan') return planExpand(operation, handles, reads);
  if (operation.op === 'getParagraphTextIfPresent' || operation.op === 'getParagraphTextSpan')
    return planParagraphText(operation, handles, reads);
  const ref = operation.op === 'getTextRanges' ? operation.scope : operation.span;
  const resolved = resolveSpanRef(ref, handles, reads);
  if (!resolved.ok) return refuse(resolved.code, 'that span is not a place', resolved.detail);
  const story = storyOfSpanRef(ref, handles, reads);
  if (!story.ok) return refuse(story.code, 'that span is not a place', story.detail);
  if (operation.op === 'getReviewedText') {
    if (operation.version !== 'original' && operation.version !== 'current')
      return refuse('unsupported-content', 'unknown change tracking version', 'version');
    return {
      ok: true,
      kind: 'query',
      value: { kind: 'text', text: reviewedText(resolved.value, story.value, operation.version) },
    };
  }
  const marks = validMarks(operation.endingMarks);
  if (!marks) return refuse('unsupported-content', 'ending marks are not usable', 'endingMarks');
  const projection = operation.projection ?? 'allMarkup';
  if (projection !== 'allMarkup' && projection !== 'original' && projection !== 'model')
    return refuse('unsupported-content', 'unknown text projection', 'projection');
  return {
    ok: true,
    kind: 'query',
    value: {
      kind: 'spans',
      spans: textRangeSpans(
        resolved.value,
        story.value,
        handles,
        marks,
        operation.trimSpacing === true,
        projection
      ),
    },
  };
}

/** Marks longest first, so a longer mark wins over a shorter one it starts with. */
function validMarks(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_TEXT_RANGE_MARKS)
    return null;
  const marks: string[] = [];
  for (const mark of value as unknown[]) {
    if (
      typeof mark !== 'string' ||
      mark.length === 0 ||
      mark.length > MAX_TEXT_RANGE_MARK_LENGTH ||
      hasUnpairedSurrogate(mark)
    )
      return null;
    marks.push(mark);
  }
  return marks.sort((left, right) => right.length - left.length);
}

/**
 * Whether a string holds a surrogate half without its partner. A mark like that would match half
 * of a character and cut it in two.
 */
export function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

/**
 * One paragraph's token boundaries between `from` and `to`, in model offsets.
 *
 * `shown(offset)` says whether the view shows the model character at `offset`. A hidden character
 * is never part of a mark, and no token starts or ends on one.
 */
export function textRangeBoundaries(
  text: string,
  from: number,
  to: number,
  marks: readonly string[],
  trimSpacing: boolean,
  shown: (offset: number) => boolean = () => true
): readonly (readonly [number, number])[] {
  const found: (readonly [number, number])[] = [];
  const trimmed = (offset: number): boolean =>
    !shown(offset) || (trimSpacing && SPACING.has(text[offset]!));
  const push = (start: number, end: number): void => {
    let first = start;
    let last = end;
    while (first < last && trimmed(first)) first += 1;
    while (last > first && trimmed(last - 1)) last -= 1;
    if (first < last) found.push([first, last]);
  };
  const allShown = (start: number, length: number): boolean => {
    for (let offset = start; offset < start + length; offset += 1) if (!shown(offset)) return false;
    return true;
  };
  let start = from;
  let at = from;
  while (at < to) {
    const mark = marks.find(
      (candidate) =>
        at + candidate.length <= to &&
        text.startsWith(candidate, at) &&
        allShown(at, candidate.length)
    );
    if (mark) {
      at += mark.length;
      push(start, at);
      start = at;
      continue;
    }
    // Step over a surrogate pair whole, so no boundary lands between its halves.
    const code = text.charCodeAt(at);
    const pair = code >= 0xd800 && code <= 0xdbff && at + 1 < to;
    at += pair ? 2 : 1;
  }
  if (start < to) push(start, to);
  return found;
}

function textRangeSpans(
  span: ResolvedRange | null,
  story: AutomationStoryReads,
  handles: AutomationHandleTable,
  marks: readonly string[],
  trimSpacing: boolean,
  projection: AutomationTextProjection
): readonly AutomationSpan[] {
  if (!span) return [];
  const ids = spanParagraphIds(span, story);
  const last = ids.length - 1;
  const spans: AutomationSpan[] = [];
  for (const [position, paragraphId] of ids.entries()) {
    const model = story.projectedText(paragraphId, 'model');
    const shown = story.projectedText(paragraphId, projection);
    if (!model || !shown) continue;
    const from = position === 0 ? span.start.offset : 0;
    const to = position === last ? span.end.offset : model.text.length;
    const paragraph = handles.paragraph(paragraphId, story.story);
    // A model character is shown when the view gives it at least one character of its own.
    const projected = shown.projectedOffsets(from, to);
    const isShown = (offset: number): boolean =>
      projected[offset + 1 - from]! > projected[offset - from]!;
    for (const [start, end] of textRangeBoundaries(
      model.text,
      from,
      to,
      marks,
      trimSpacing,
      isShown
    )) {
      spans.push({ start: { paragraph, offset: start }, end: { paragraph, offset: end } });
    }
  }
  return spans;
}

/** A span's text as if every pending revision were accepted or rejected. */
function reviewedText(
  span: ResolvedRange | null,
  story: AutomationStoryReads,
  version: 'original' | 'current'
): string {
  if (!span) return '';
  const ids = spanParagraphIds(span, story);
  const last = ids.length - 1;
  let text = '';
  for (const [position, paragraphId] of ids.entries()) {
    const node = story.node(paragraphId);
    const raw = story.rawText(paragraphId);
    if (!node || node.kind !== 'paragraph' || raw === null) continue;
    const projected = projectReviewedParagraphText(node, raw, version);
    const from = position === 0 ? span.start.offset : 0;
    const to = position === last ? span.end.offset : raw.length;
    text += projected.sliceRaw(from, to);
    if (position === last) break;
    // The mark between this paragraph and the next: a pending deletion of it joins the two once
    // accepted, and a pending insertion of it was never there originally.
    const markHidden = paragraphMarkRevisionOf(node, version === 'current' ? 'del' : 'ins');
    if (!markHidden) text += PARAGRAPH_MARK;
  }
  return text;
}

/** A position's place in its whole story's reading order. */
function orderOf(point: ResolvedPoint, reads: AutomationPackageReads): number {
  return reads.story(point.story)?.indexOf(point.paragraphId) ?? point.index;
}

function before(a: ResolvedPoint, b: ResolvedPoint, reads: AutomationPackageReads): boolean {
  const left = orderOf(a, reads);
  const right = orderOf(b, reads);
  return left < right || (left === right && a.offset < b.offset);
}

/** The smallest span that covers both spans. Both must be in one story. */
function planExpand(
  operation: Extract<AutomationOperation, { op: 'expandSpan' }>,
  handles: AutomationHandleTable,
  reads: AutomationPackageReads
): PlannedOperation {
  const self = resolveSpanRef(operation.span, handles, reads);
  if (!self.ok) return refuse(self.code, 'that span is not a place', self.detail);
  const other = resolveSpanRef(operation.to, handles, reads);
  if (!other.ok) return refuse(other.code, 'that span is not a place', other.detail);
  if (!self.value || !other.value) return refuse('invalid-offset', 'empty story');
  if (storyKey(self.value.start.story) !== storyKey(other.value.start.story))
    return refuse(
      'unsupported-content',
      'the ranges are in different stories',
      'span-crosses-stories'
    );
  const start = before(other.value.start, self.value.start, reads)
    ? other.value.start
    : self.value.start;
  const end = before(self.value.end, other.value.end, reads) ? other.value.end : self.value.end;
  return {
    ok: true,
    kind: 'query',
    value: { kind: 'span', span: spanValue({ start, end }, handles) },
  };
}
