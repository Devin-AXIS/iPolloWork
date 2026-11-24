// Note story splitting: cut a laid note at a line boundary so its head fits a page's
// remaining note room and its tail carries to the next page. Pure fragment surgery —
// pagination policy (when to split at all) stays in note-pagination.ts.

import { fragmentFlowBottom, shiftFragments } from './note-fragment-geometry.ts';
import { adjustedBreakIndex, paragraphKeeps } from './pagination-keeps.ts';
import { MAX_NOTE_FRAGMENTS, type NoteStoryLayout } from './note-layout.ts';
import type { BlockFragmentRecord, ParagraphFragmentRecord } from './semantic-records.ts';

/** The one fallback splitting itself can raise; the pagination reason union includes it. */
type NoteSplitFallbackReason = 'note-line-exceeds-page';

/** Where a note split records its fallback: structurally any list whose element type includes it. */
export interface NoteSplitReasons {
  push(reason: NoteSplitFallbackReason): unknown;
}

/**
 * Split one paragraph fragment at a line boundary so the head fits under `availableBottom`
 * (story-relative). Empty head means no line fits — caller must defer the fragment.
 *
 * `w:widowControl` (§17.3.1.44) governs a note paragraph exactly as it governs a body one:
 * never one line alone on either side of the break. A three-line endnote with room for two
 * therefore moves whole, which is what the reference does: a corpus document once kept two of
 * its lines and stranded the third, and the reference opens the area on the next page instead.
 *
 * `canRetreat` is the fail-open switch. Retreating is only safe when the next page offers
 * more room than this one; when the note already has the full column, a paragraph that
 * cannot satisfy the rule there could never satisfy it anywhere, so the near miss prints.
 */
function splitParagraphFragmentByBottom(
  fragment: ParagraphFragmentRecord,
  availableBottom: number,
  canRetreat: boolean
): {
  readonly head: ParagraphFragmentRecord | null;
  readonly tail: ParagraphFragmentRecord | null;
} {
  if (fragment.lines.length === 0) {
    return fragment.box.y + fragment.box.height <= availableBottom + 0.001
      ? { head: fragment, tail: null }
      : { head: null, tail: fragment };
  }

  let cut = 0;
  for (; cut < fragment.lines.length; cut += 1) {
    const line = fragment.lines[cut]!;
    if (line.box.y + line.box.height > availableBottom + 0.001) break;
  }
  if (cut >= fragment.lines.length) return { head: fragment, tail: null };
  if (canRetreat)
    cut = adjustedBreakIndex(cut, 0, fragment.lines.length, paragraphKeeps(fragment.props), false);
  if (cut === 0) return { head: null, tail: fragment };

  const headLines = fragment.lines.slice(0, cut);
  const tailLines = fragment.lines.slice(cut);
  const headLast = headLines[headLines.length - 1]!;
  const headTop = fragment.box.y;
  const headBottom = headLast.box.y + headLast.box.height;
  const headBorders = fragment.borders?.filter((stroke) => stroke.side !== 'bottom');

  const head: ParagraphFragmentRecord = {
    ...fragment,
    range: {
      paragraphId: fragment.paragraphId,
      start: headLines[0]!.range.start,
      end: headLast.range.end,
    },
    spacing: { before: fragment.spacing.before, after: 0 },
    lines: headLines,
    box: { ...fragment.box, height: Math.max(0, headBottom - headTop) },
    ...(headBorders && headBorders.length > 0 ? { borders: headBorders } : { borders: undefined }),
    bottomBorder: undefined,
    ...(fragment.shadingBox
      ? {
          shadingBox: {
            ...fragment.shadingBox,
            height: Math.max(0, headBottom - fragment.shadingBox.y),
          },
        }
      : {}),
  };

  // Keep the tail in the original story coordinate space; {@link splitNoteFragments} rebases
  // the whole raw tail with one shift so sibling blocks stay contiguous.
  const tailLast = tailLines[tailLines.length - 1]!;
  const tailTop = tailLines[0]!.box.y;
  const tailBottom = tailLast.box.y + tailLast.box.height;
  const tailBorders = fragment.borders?.filter((stroke) => stroke.side !== 'top');
  const tail: ParagraphFragmentRecord = {
    ...fragment,
    id: `${fragment.paragraphId}#f${fragment.fragmentIndex + 1}`,
    fragmentIndex: fragment.fragmentIndex + 1,
    range: {
      paragraphId: fragment.paragraphId,
      start: tailLines[0]!.range.start,
      end: tailLines[tailLines.length - 1]!.range.end,
    },
    spacing: { before: 0, after: fragment.spacing.after },
    lines: tailLines,
    box: {
      x: fragment.box.x,
      y: tailTop,
      width: fragment.box.width,
      height: Math.max(0, tailBottom - tailTop),
    },
    marker: undefined,
    ...(tailBorders && tailBorders.length > 0 ? { borders: tailBorders } : { borders: undefined }),
    ...(fragment.bottomBorder ? { bottomBorder: fragment.bottomBorder } : {}),
    ...(fragment.shadingBox
      ? {
          shadingBox: {
            x: fragment.shadingBox.x,
            y: tailTop,
            width: fragment.shadingBox.width,
            height: Math.max(0, tailBottom - tailTop),
          },
        }
      : {}),
  };
  return { head, tail };
}

/**
 * Split a note story so the head fits in `availableHeight` (story-relative).
 *
 * Allows an empty head (entire story moves to the next page) instead of accepting a first
 * fragment taller than the remaining room. Paragraph fragments split at line boundaries;
 * a single line that exceeds a full content column records {@link NoteSplitFallbackReason}
 * and is not placed with overflowing geometry.
 */
export function splitNoteFragments(
  laid: NoteStoryLayout,
  availableHeight: number,
  options?: {
    readonly fullContentHeight?: number;
    readonly reasons?: NoteSplitReasons;
  }
): {
  readonly head: readonly BlockFragmentRecord[];
  readonly headHeight: number;
  readonly tail: readonly BlockFragmentRecord[];
  readonly tailHeight: number;
} {
  if (laid.flowHeight <= availableHeight + 0.001) {
    return {
      head: laid.fragments,
      headHeight: laid.flowHeight,
      tail: [],
      tailHeight: 0,
    };
  }
  if (availableHeight <= 0.001) {
    return {
      head: [],
      headHeight: 0,
      tail: laid.fragments,
      tailHeight: laid.flowHeight,
    };
  }

  const head: BlockFragmentRecord[] = [];
  let headHeight = 0;
  let cut = 0;
  let partialTail: BlockFragmentRecord | null = null;

  for (let i = 0; i < laid.fragments.length && i < MAX_NOTE_FRAGMENTS; i += 1) {
    const fragment = laid.fragments[i]!;
    const next = fragment.box.y + fragment.box.height;
    if (next <= availableHeight + 0.001) {
      head.push(fragment);
      headHeight = next;
      cut = i + 1;
      continue;
    }

    if (fragment.kind === 'paragraph') {
      const split = splitParagraphFragmentByBottom(
        fragment,
        availableHeight,
        (options?.fullContentHeight ?? availableHeight) > availableHeight + 0.001
      );
      if (split.head) {
        head.push(split.head);
        headHeight = split.head.box.y + split.head.box.height;
        partialTail = split.tail;
        cut = i + 1;
      } else {
        // No line fits in the remaining room — leave head as-is (possibly empty) and
        // defer this fragment. When the room is a full content column and one line still
        // does not fit, record a named fallback rather than overflowing geometry.
        const fullH = options?.fullContentHeight ?? availableHeight;
        const firstLine = fragment.lines[0];
        const lineH = firstLine?.box.height ?? fragment.box.height;
        if (head.length === 0 && availableHeight >= fullH - 0.001 && lineH > fullH + 0.001) {
          options?.reasons?.push('note-line-exceeds-page');
          // Skip the unsplittable fragment; continue attempting later siblings on a fresh
          // carry rather than clipping it into the column.
          cut = i + 1;
          partialTail = null;
          const rest = laid.fragments.slice(cut);
          const dy = rest[0]?.box.y ?? 0;
          return {
            head: [],
            headHeight: 0,
            tail: shiftFragments(rest, -dy),
            tailHeight: Math.max(0, laid.flowHeight - dy),
          };
        }
        cut = i;
        partialTail = null;
      }
      break;
    }

    // Tables / non-paragraph: never accept an overflowing first fragment.
    cut = i;
    break;
  }

  const rawTail = [...(partialTail ? [partialTail] : []), ...laid.fragments.slice(cut)];
  if (rawTail.length === 0) {
    return { head, headHeight, tail: [], tailHeight: 0 };
  }
  const dy = rawTail[0]?.box.y ?? 0;
  const tail = shiftFragments(rawTail, -dy);
  const tailHeight = fragmentFlowBottom(tail);
  return { head, headHeight, tail, tailHeight };
}
