/**
 * Offsets carried across changes to a paragraph's text, for the local caret and the carets
 * peers show.
 */
/**
 * An offset carried across one change to a paragraph's text.
 *
 * The local caret and the carets peers show both stay next to the same character this way,
 * whatever a peer typed or deleted around it, even when one remote update changed text on
 * both sides of the offset.
 *
 * @public
 */
export function mapOffsetAcrossText(offset: number, before: string, after: string): number {
  // Past the text this replica held: the peer is ahead of us (its presence arrived before its
  // document update), so there is nothing to map yet, only a position to hold.
  if (before === after || offset > before.length) return Math.min(offset, after.length);
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  if (offset <= prefix) return Math.min(offset, after.length);
  // Text inserted exactly at the offset goes after it, as it does when that insert is the
  // only change, so an offset at the start of the unchanged end is aligned, not shifted.
  if (offset > before.length - suffix) {
    return Math.min(after.length, offset + after.length - before.length);
  }
  // A peer that stays idle in a changed paragraph asks the same question on every remote
  // update, and many peers ask it of one text pair, so recent pairs keep their alignment
  // and their answers.
  const pair = alignmentOf(before, after, prefix, suffix);
  let mapped = pair.offsets.get(offset);
  if (mapped === undefined) {
    mapped =
      (pair.table ? alignedOffset(pair.table, offset, before, after, prefix) : null) ??
      contextOffset(offset, before, after, prefix, suffix) ??
      prefix;
    pair.offsets.set(offset, mapped);
  }
  return mapped;
}

interface AlignmentTable {
  readonly lengths: Uint32Array;
  readonly width: number;
  readonly columns: number;
}

interface Alignment {
  readonly before: string;
  readonly after: string;
  /** Null when the changed middle is too large to align. */
  readonly table: AlignmentTable | null;
  readonly offsets: Map<number, number>;
}

/** Text pairs whose alignment is kept, most recent last. */
const alignments: Alignment[] = [];
const MAX_KEPT_ALIGNMENTS = 16;

function alignmentOf(before: string, after: string, prefix: number, suffix: number): Alignment {
  const at = alignments.findIndex((pair) => pair.before === before && pair.after === after);
  if (at >= 0) {
    const [pair] = alignments.splice(at, 1);
    alignments.push(pair!);
    return pair!;
  }
  const pair = {
    before,
    after,
    table: alignTable(before, after, prefix, suffix),
    offsets: new Map(),
  };
  if (alignments.length >= MAX_KEPT_ALIGNMENTS) alignments.shift();
  alignments.push(pair);
  return pair;
}

/** Above this many character pairs the changed middle is treated as one change. */
const MAX_ALIGNED_CELLS = 1 << 18;

/**
 * The character alignment of two changed middles: the longest common subsequence of the
 * middles from each pair of positions on. Null when the middles are too large to align.
 */
function alignTable(
  before: string,
  after: string,
  prefix: number,
  suffix: number
): AlignmentTable | null {
  const rows = before.length - suffix - prefix;
  const columns = after.length - suffix - prefix;
  if (rows * columns > MAX_ALIGNED_CELLS) return null;
  const width = columns + 1;
  // lengths[i][j]: the longest common subsequence of the middles from i and j on.
  const lengths = new Uint32Array((rows + 1) * width);
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = columns - 1; j >= 0; j -= 1) {
      lengths[i * width + j] =
        before[prefix + i] === after[prefix + j]
          ? lengths[(i + 1) * width + j + 1]! + 1
          : Math.max(lengths[(i + 1) * width + j]!, lengths[i * width + j + 1]!);
    }
  }
  return { lengths, width, columns };
}

/**
 * An offset inside the changed middle, carried by a character alignment of the middles.
 *
 * Two edits in one paragraph, one before the offset and one after it, leave no shared prefix
 * or suffix that reaches the offset, and treating the whole middle as one change put the
 * caret at its start. Aligning the characters keeps it next to the same character.
 */
function alignedOffset(
  table: AlignmentTable,
  offset: number,
  before: string,
  after: string,
  prefix: number
): number {
  const { lengths, width, columns } = table;
  const target = offset - prefix;
  let i = 0;
  let j = 0;
  while (i < target) {
    if (j < columns && before[prefix + i] === after[prefix + j]) {
      i += 1;
      j += 1;
    } else if (j >= columns || lengths[(i + 1) * width + j]! >= lengths[i * width + j + 1]!) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return prefix + j;
}

/** Lengths of text beside an offset tried to find it in a changed middle too large to align. */
const CONTEXT_LENGTHS = [32, 16, 8, 4];

/**
 * An offset inside a changed middle too large to align, placed by the text right before it,
 * or else right after it, where that text occurs exactly once in the new middle. Null when no
 * such text does.
 */
function contextOffset(
  offset: number,
  before: string,
  after: string,
  prefix: number,
  suffix: number
): number | null {
  const middle = after.slice(prefix, after.length - suffix);
  const unique = (piece: string): number | null => {
    const at = middle.indexOf(piece);
    return at >= 0 && middle.indexOf(piece, at + 1) < 0 ? at : null;
  };
  for (const length of CONTEXT_LENGTHS) {
    const left = before.slice(Math.max(prefix, offset - length), offset);
    if (left.length === length) {
      const at = unique(left);
      if (at !== null) return prefix + at + left.length;
    }
    const right = before.slice(offset, Math.min(before.length - suffix, offset + length));
    if (right.length === length) {
      const at = unique(right);
      if (at !== null) return prefix + at;
    }
  }
  return null;
}
