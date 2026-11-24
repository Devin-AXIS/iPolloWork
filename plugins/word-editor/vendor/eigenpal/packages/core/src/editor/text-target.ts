// The target `selectMatch` and `replaceMatch` take: a `findMatches` result, or a range a host
// computed itself, such as a proofing result from a server.
//
// Both commands address text by paragraph id and offsets, which name a position in ONE
// revision. A peer's edit or the reader's own typing can move the text away from those
// offsets, and replacing whatever now sits there destroys text nobody chose to replace. So a
// target that says which text it expects is checked against the paragraph first, and a
// mismatch is refused with nothing changed.
//
// The story comes from the paragraph, not from the caller. A computed range rarely knows
// which header relationship or note holds its paragraph, and a `scope` that names a different
// story than the paragraph's is a caller error, not a reason to edit somewhere else.

import type { ExecResult, TextMatch, ViewScope } from '../contracts/editor.ts';
import type { HighlightRange } from '../contracts/editor-highlights.ts';
import { rangeHoldsText } from '../binding/document-search.ts';
import { findNode } from '../store/package/ooxml-edit.ts';
import type { OoxmlParagraphNode, OoxmlPart } from '../store/package/ooxml-tree.ts';
import { resolveNotesPart } from '../store/package/note-references.ts';
import { isParagraph } from '../store/store/tree-op-segments.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { rangeOverlapsRemovedText } from './removed-text-spans.ts';
import { textboxScopeOfParagraph } from './review-story-entry.ts';
import { noteScopeIdInLayout, partOfNodeId } from './surface-scope.ts';

/** What `selectMatch` and `replaceMatch` accept. */
export type TextTarget = TextMatch | HighlightRange;

type Refusal = Exclude<ExecResult, { ok: true }>;

/** The refusal reason when the text at a target's offsets is not the text it expects. */
export const TEXT_TARGET_CHANGED = 'the text at the match changed; find it again';

/** The text a target expects at its offsets: `expectedText`, else a match's `text`. */
export function expectedTextOfTarget(target: TextTarget): string | undefined {
  const declared = (target as Partial<HighlightRange>).expectedText;
  if (typeof declared === 'string') return declared;
  const text = (target as Partial<TextMatch>).text;
  return typeof text === 'string' ? text : undefined;
}

/** The checks that need no document. A host calls from JavaScript, so nothing is assumed. */
export function textTargetArgumentRefusal(target: TextTarget | undefined): string | null {
  if (
    typeof target?.blockId !== 'string' ||
    target.blockId.length === 0 ||
    !Number.isInteger(target.start) ||
    target.start < 0 ||
    !Number.isInteger(target.length) ||
    target.length < 0
  ) {
    return 'match must carry a blockId and offsets';
  }
  const record = target as { readonly expectedText?: unknown; readonly text?: unknown };
  if (record.expectedText !== undefined && typeof record.expectedText !== 'string') {
    return 'match expectedText must be a string';
  }
  if (record.text !== undefined && typeof record.text !== 'string') {
    return 'match text must be a string';
  }
  return null;
}

/** The paragraph a target names, with the part that holds it. */
interface TargetParagraph {
  readonly part: OoxmlPart;
  readonly paragraph: OoxmlParagraphNode;
}

function paragraphOfTarget(surface: PaginatedSurface, blockId: string): TargetParagraph | null {
  const part = partOfNodeId(surface.session, blockId);
  const node = part ? findNode(part, blockId) : null;
  return part && isParagraph(node) ? { part, paragraph: node } : null;
}

const OVERLAPS_REMOVED: Refusal = Object.freeze({
  ok: false as const,
  code: 'unsupported' as const,
  reason: 'the match overlaps deleted text; accept or reject that change first',
});

/**
 * Refused when the target shares a character with a pending tracked deletion or moved-away
 * text. Replacing it again would stack a second proposal on a removed word, and editing mode
 * would turn the pending deletion into plain text.
 */
export function removedTextRefusal(surface: PaginatedSurface, target: TextTarget): Refusal | null {
  const found = paragraphOfTarget(surface, target.blockId);
  if (!found) return null;
  const end = target.start + target.length;
  return rangeOverlapsRemovedText(found.paragraph, target.start, end) ? OVERLAPS_REMOVED : null;
}

const NOT_IN_DOCUMENT: Refusal = Object.freeze({
  ok: false as const,
  code: 'notFound' as const,
  reason: 'the match paragraph is not in the document; find it again',
});

/** Whether a match that covers only part of a field result is accepted or refused. */
export type PartialFieldMatch = 'accept' | 'refuse';

const INSIDE_FIELD: Refusal = Object.freeze({
  ok: false as const,
  code: 'unsupported' as const,
  reason: 'the match is inside a field result; replace the whole field or edit the field',
});

/**
 * Refused when the target expects text its offsets no longer hold. A declared `expectedText`
 * must equal the range's text. A match's `text` may be part of a field result, verified as the
 * same occurrence through its context; `partial` decides whether such a match is accepted.
 */
function textRefusal(
  target: TextTarget,
  found: TargetParagraph,
  partial: PartialFieldMatch
): Refusal | null {
  const declared = (target as Partial<HighlightRange>).expectedText;
  const match = target as Partial<TextMatch>;
  const expected = expectedTextOfTarget(target);
  if (expected === undefined) return null;
  const context =
    typeof declared === 'string'
      ? undefined
      : { before: match.contextBefore, after: match.contextAfter };
  const end = target.start + target.length;
  const held = rangeHoldsText(found.paragraph, target.start, end, expected, context);
  if (held === 'equal') return null;
  if (held === 'partial') return partial === 'accept' ? null : INSIDE_FIELD;
  return { ok: false, code: 'notFound', reason: TEXT_TARGET_CHANGED };
}

/** The relationship ids whose header or footer is `partName`, in section order. */
function headerFooterRIdsOf(surface: PaginatedSurface, partName: string): string[] {
  const rIds: string[] = [];
  for (const section of surface.session.headerFooterResolutionBySection()) {
    for (const slots of [section.headers, section.footers]) {
      for (const slot of slots.values()) {
        if (slot.partName === partName && !rIds.includes(slot.rId)) rIds.push(slot.rId);
      }
    }
  }
  return rIds;
}

/**
 * The story that holds `found`, as a view scope. A header part can serve more than one
 * relationship: the one `preferred` names wins, then the open one, then the first section's.
 */
function storyOfParagraph(
  surface: PaginatedSurface,
  blockId: string,
  found: TargetParagraph,
  preferred: ViewScope | undefined
): ViewScope | Refusal {
  const session = surface.session;
  const { part } = found;
  const frame = textboxScopeOfParagraph(part, blockId);
  if (part.name === session.part().name) return frame ?? { kind: 'body' };
  const rIds = headerFooterRIdsOf(surface, part.name);
  if (rIds.length > 0) {
    const active = surface.activeScope();
    const rId =
      preferred?.kind === 'headerFooter' && rIds.includes(preferred.rId)
        ? preferred.rId
        : active.kind === 'headerFooter' && rIds.includes(active.rId)
          ? active.rId
          : rIds[0]!;
    const owner = { kind: 'headerFooter' as const, rId };
    return frame ? { ...frame, owner } : owner;
  }
  for (const noteKind of ['footnote', 'endnote'] as const) {
    if (resolveNotesPart(session.currentPackage(), noteKind)?.name !== part.name) continue;
    if (frame) {
      return { ok: false, code: 'unsupported', reason: 'a text box in a note cannot be opened' };
    }
    const id = noteScopeIdInLayout(surface.layout(), blockId);
    return id === null
      ? { ok: false, code: 'unsupported', reason: 'the note that holds the match is not laid out' }
      : { kind: 'note', id };
  }
  return {
    ok: false,
    code: 'unsupported',
    reason: 'the story that holds the match cannot be opened',
  };
}

function isRefusal(value: ViewScope | Refusal): value is Refusal {
  return 'ok' in value;
}

/** Whether a caller's `scope` names the story the paragraph is in. */
function scopeAgrees(declared: ViewScope, story: ViewScope): boolean {
  if (declared.kind === 'body') return story.kind === 'body';
  if (declared.kind === 'headerFooter')
    return story.kind === 'headerFooter' && story.rId === declared.rId;
  if (declared.kind === 'note') return story.kind === 'note' && story.id === declared.id;
  return false;
}

/** A resolved target: the story to address, or why it cannot be addressed. */
export type ResolvedTextTarget = { readonly ok: true; readonly scope: ViewScope } | Refusal;

/**
 * Resolve a target to the story that holds it and check its expected text. Reads only.
 *
 * A frame `scope` is the caller's address of a text box drawing and is returned as given: a
 * text box can be found and still have no paragraph this lookup reaches, and the drawing
 * selection decides that. Its text is checked when its paragraph resolves.
 */
export function resolveTextTarget(
  surface: PaginatedSurface,
  target: TextTarget,
  partial: PartialFieldMatch
): ResolvedTextTarget {
  const declared = target.scope;
  const found = paragraphOfTarget(surface, target.blockId);
  if (declared?.kind === 'frame') {
    const changed = found ? textRefusal(target, found, partial) : null;
    return changed ?? { ok: true, scope: declared };
  }
  if (
    declared !== undefined &&
    declared.kind !== 'body' &&
    declared.kind !== 'headerFooter' &&
    declared.kind !== 'note'
  ) {
    return {
      ok: false,
      code: 'invalidArgs',
      reason: 'the match scope does not hold the paragraph; omit scope or name its story',
    };
  }
  if (!found) return NOT_IN_DOCUMENT;
  const story = storyOfParagraph(surface, target.blockId, found, declared);
  if (isRefusal(story)) return story;
  if (declared && !scopeAgrees(declared, story)) {
    return {
      ok: false,
      code: 'invalidArgs',
      reason: 'the match scope names a different story than the one that holds its paragraph',
    };
  }
  return textRefusal(target, found, partial) ?? { ok: true, scope: story };
}

/** Whether `scope` is the story the reader is in. */
export function isActiveStory(surface: PaginatedSurface, scope: ViewScope): boolean {
  const active = surface.activeScope();
  if (scope.kind === 'body') return active.kind === 'body';
  if (scope.kind === 'headerFooter')
    return active.kind === 'headerFooter' && active.rId === scope.rId;
  if (scope.kind === 'note') return active.kind === 'note' && active.id === scope.id;
  return active.kind === 'frame' && active.id === scope.id;
}
