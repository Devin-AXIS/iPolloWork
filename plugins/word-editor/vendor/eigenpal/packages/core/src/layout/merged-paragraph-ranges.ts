// Giving a merged paragraph's content back its own identity.
//
// A resolved display mode lays a run of paragraphs out as one, because that is what the
// document becomes once its tracked decisions are taken. The layout is right and the identity
// is not: every span in that fragment names the paragraph the merge kept, at an offset in a
// paragraph that does not hold those characters. A resolved view is EDITABLE — the free engine
// renders `proposed` by default — so a click or a keystroke in the merged half would address a
// position the store does not have.
//
// This maps each published range back to the member that contributed it. The member boundaries
// are the members' own model lengths: `piecesOfParagraph` keeps its running offset aligned with
// `paragraphTextOf`, which is the same authority `paragraphOffsetIndex` answers from, so the
// k-th member starts at the sum of the lengths before it.

import { paragraphOffsetIndex } from '../store/store/tree-op-segments.ts';
import type { OoxmlParagraphNode } from '@docx-editor.dev/core/store';
import type { ParagraphMergeGroup } from './story-roots.ts';
import type { LineRecord, SourceRange, StyleSpanRecord } from './semantic-records.ts';
import { resolvedParagraphMarkChangeSites } from './revision-formatting-projection.ts';
import type {
  RevisionAttribution,
  RevisionAuthorFilter,
  RevisionDisplayMode,
} from './revision-projection.ts';

interface MergeMember {
  readonly paragraphId: string;
  /** Where this member's content starts in the merged paragraph's offsets. */
  readonly base: number;
  readonly length: number;
  /**
   * The mark decisions the view answered to fold this member into the next — the removed
   * break the merge exists for. Reported on the line that holds the join, for the Simple
   * Markup change bar; absent on the survivor, whose mark stays.
   */
  readonly markChangeSites?: readonly RevisionAttribution[];
}

export interface MergeBoundaries {
  readonly members: readonly MergeMember[];
  readonly total: number;
}

/** Member bases, in the merged paragraph's own offset space. */
export function mergeBoundariesOf(
  group: ParagraphMergeGroup,
  displayMode?: RevisionDisplayMode,
  authorFilter?: RevisionAuthorFilter
): MergeBoundaries {
  const members: MergeMember[] = [];
  let base = 0;
  const last = group.members.length - 1;
  group.members.forEach((member, index) => {
    const length = paragraphOffsetIndex(member as OoxmlParagraphNode).length;
    const markChangeSites =
      index < last && displayMode
        ? resolvedParagraphMarkChangeSites(member, displayMode, authorFilter)
        : [];
    members.push({
      paragraphId: member.id,
      base,
      length,
      ...(markChangeSites.length > 0 ? { markChangeSites } : {}),
    });
    base += length;
  });
  return { members, total: base };
}

/**
 * The member an offset belongs to.
 *
 * The LAST member whose content starts at or before the offset, which puts a position at a
 * member boundary — the caret between the two halves — at the start of the following member,
 * where an insertion belongs to the paragraph the reader is typing into. An empty member has
 * no offsets of its own, so it only wins a boundary offset that no later member claims.
 */
function memberAt(boundaries: MergeBoundaries, offset: number): MergeMember | undefined {
  let found: MergeMember | undefined;
  for (const member of boundaries.members) {
    if (member.base > offset) break;
    if (found === undefined || member.length > 0 || member.base > found.base) found = member;
  }
  return found ?? boundaries.members[boundaries.members.length - 1];
}

function remapRange(range: SourceRange, boundaries: MergeBoundaries): SourceRange {
  const member = memberAt(boundaries, range.start);
  if (!member) return range;
  const end = range.end - member.base;
  return {
    paragraphId: member.paragraphId,
    start: range.start - member.base,
    // A span is a piece of ONE run and two members contribute different runs, so a span cannot
    // cross a boundary. The clamp is what keeps a broken invariant from publishing an offset
    // past the end of a real paragraph, where an edit would be refused or land elsewhere.
    end: Math.min(end, member.length),
  };
}

function remapSpan(span: StyleSpanRecord, boundaries: MergeBoundaries): StyleSpanRecord {
  return { ...span, range: remapRange(span.range, boundaries) };
}

/**
 * Every range a merged fragment publishes, in the offsets of the paragraph that owns it.
 *
 * A line keeps ONE range, because that is the shape every consumer reads; it names the
 * paragraph of the line's first span. The join line therefore belongs to two paragraphs and
 * says so only through its spans, which is why the interaction index reads spans rather than
 * the line range when it maps a position.
 */
export function remapMergedLines(
  lines: readonly LineRecord[],
  boundaries: MergeBoundaries
): readonly LineRecord[] {
  // Each join lands on ONE line: the one whose merged-offset extent holds the member's end.
  // The end is EXCLUSIVE so a join at a line break is the next line's, not both — this runs
  // once per fragment, and a page break at the join would otherwise report it twice — except
  // at the very end of the merged paragraph (an empty survivor), where only the last line can.
  const joins = boundaries.members
    .filter((member) => member.markChangeSites !== undefined)
    .map((member) => ({ offset: member.base + member.length, sites: member.markChangeSites! }));
  return lines.map((line) => {
    const joinSites = joins
      .filter(
        (join) =>
          join.offset >= line.range.start &&
          (join.offset < line.range.end ||
            (join.offset === line.range.end && join.offset === boundaries.total))
      )
      .flatMap((join) => join.sites);
    const changeSites =
      joinSites.length > 0 ? [...(line.changeSites ?? []), ...joinSites] : line.changeSites;
    const spans = line.spans.map((span) => remapSpan(span, boundaries));
    const first = spans[0];
    // Remapped FIRST, because the line's own extent has to count them: an inline drawing is
    // an atom with an offset of its own, and a member that opens with a picture starts at the
    // picture, not at its first character.
    const remappedDrawings = line.drawings?.map((drawing) => {
      const member = memberAt(boundaries, drawing.start);
      return member
        ? { ...drawing, paragraphId: member.paragraphId, start: drawing.start - member.base }
        : drawing;
    });
    // The extent this line holds OF THE PARAGRAPH IT NAMES: from its first span to the last
    // span that still belongs to that paragraph. Reading the last span of the line instead
    // reported the other member's end, and reading the first span's end truncated the range
    // to one run whenever the member contributed several.
    const owned = first
      ? spans.filter((span) => span.range.paragraphId === first.range.paragraphId)
      : [];
    const ownedDrawings = first
      ? (remappedDrawings ?? []).filter(
          (drawing) => drawing.paragraphId === first.range.paragraphId
        )
      : [];
    const lineRange: SourceRange = first
      ? {
          paragraphId: first.range.paragraphId,
          start: Math.min(first.range.start, ...ownedDrawings.map((drawing) => drawing.start)),
          // An atom occupies ONE offset, so a trailing picture ends one past its own.
          end: Math.max(
            owned[owned.length - 1]!.range.end,
            ...ownedDrawings.map((drawing) => drawing.start + 1)
          ),
        }
      : remapRange(line.range, boundaries);
    const drawings = remappedDrawings;
    // A deleted range is a pair of offsets with no paragraph of its own, so on a join line it
    // can only be expressed in one paragraph's terms. Kept for the paragraph the line names and
    // dropped for the other — and in practice empty either way, because a mode that merges has
    // already resolved every deletion: `proposed` hides the text, `original` keeps it as live.
    const deletedRanges = line.deletedRanges
      ?.map((deleted) => ({ deleted, member: memberAt(boundaries, deleted.start) }))
      .filter(({ member }) => member?.paragraphId === lineRange.paragraphId)
      .map(({ deleted, member }) => ({
        start: deleted.start - (member?.base ?? 0),
        end: deleted.end - (member?.base ?? 0),
      }));
    return {
      ...line,
      range: lineRange,
      spans,
      ...(drawings ? { drawings } : {}),
      ...(deletedRanges ? { deletedRanges } : {}),
      ...(changeSites ? { changeSites } : {}),
    };
  });
}
