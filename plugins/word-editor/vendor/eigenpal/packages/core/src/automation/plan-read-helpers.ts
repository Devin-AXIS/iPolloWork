import { readTextOf, searchableLineBreaks } from './line-break-text.ts';
import type { AutomationStoryReads } from './reads.ts';
import type { AutomationSectionRead } from './sections.ts';
import type { ResolvedRange } from './spans.ts';
import type { PlannedOperation } from './plan.ts';
import { refused as refuse } from './plan-results.ts';

/** Most delimiters one split accepts, and the longest each may be. Both are host input. */
const MAX_DELIMITERS = 16;
const MAX_DELIMITER_LENGTH = 64;

/** Why a split's delimiters are refused, or null when they are usable. */
export function delimiterRefusal(delimiters: readonly string[]): PlannedOperation | null {
  if (!Array.isArray(delimiters) || delimiters.length === 0)
    return refuse('unsupported-content', 'split needs at least one delimiter', 'delimiters');
  if (delimiters.length > MAX_DELIMITERS)
    return refuse('unsupported-content', 'too many delimiters', String(delimiters.length));
  for (const delimiter of delimiters) {
    if (typeof delimiter !== 'string' || delimiter.length === 0)
      return refuse('unsupported-content', 'a delimiter must be a non-empty string', 'delimiters');
    if (delimiter.length > MAX_DELIMITER_LENGTH)
      return refuse('unsupported-content', 'that delimiter is too long', 'delimiters');
  }
  return null;
}

/** A paragraph's text as a read reports it, and where any delimiter occurs in it. */
export function delimitedText(
  reads: AutomationStoryReads,
  paragraphId: string,
  delimiters: readonly string[]
): {
  readonly text: string;
  readonly occurrences: readonly { readonly start: number; readonly length: number }[];
} {
  const text = readTextOf(reads, paragraphId);
  return { text, occurrences: delimiterOccurrences(text, delimiters) };
}

const TRIMMABLE = /\s/;

/**
 * Every occurrence of any delimiter in `text`, non-overlapping, in order.
 *
 * `text` is read text, where a line break is `\v`; a delimiter that spells it `\n` finds it too.
 */
export function delimiterOccurrences(
  text: string,
  delimiters: readonly string[]
): readonly { readonly start: number; readonly length: number }[] {
  const found: { start: number; length: number }[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    let best: { start: number; length: number } | null = null;
    for (const given of delimiters) {
      const delimiter = searchableLineBreaks(given);
      const at = text.indexOf(delimiter, cursor);
      if (at < 0) continue;
      // Earliest wins; at the same position the LONGEST wins, so a two-character delimiter is
      // not shadowed by a one-character one that happens to be its prefix.
      if (!best || at < best.start || (at === best.start && delimiter.length > best.length))
        best = { start: at, length: delimiter.length };
    }
    if (!best) break;
    found.push(best);
    cursor = best.start + best.length;
  }
  return found;
}

/**
 * The paragraph `setSectionProperties` should resolve a section from.
 *
 * A section is ended by the paragraph whose mark carries its `w:sectPr`, so that paragraph names
 * it exactly. The FINAL section is the exception: no mark closes it — the body-level `w:sectPr`
 * governs whatever is left — so the story's last paragraph names it, provided that paragraph is
 * not itself a section mark. When it is, the trailing blocks are not paragraphs and there is
 * nothing to anchor to; the caller is told rather than having another section written.
 */
export function anchorForSection(
  body: AutomationStoryReads,
  sections: readonly AutomationSectionRead[],
  index: number
): string | null {
  const own = sections[index]?.markParagraphId ?? null;
  if (own !== null) return own;
  const ids = body.paragraphIds;
  const last = ids[ids.length - 1];
  if (last === undefined) return null;
  const marks = new Set(
    sections.map((section) => section.markParagraphId).filter((id): id is string => id !== null)
  );
  return marks.has(last) ? null : last;
}

/** Whether both ends of a range still name a paragraph and an offset inside it. */
export function placeable(range: ResolvedRange, reads: AutomationStoryReads): boolean {
  for (const point of [range.start, range.end]) {
    const text = reads.rawText(point.paragraphId);
    if (text === null || point.offset > text.length) return false;
  }
  return true;
}

/** `[start, end)` narrowed past leading and trailing whitespace. */
export function trimmed(text: string, start: number, end: number): readonly [number, number] {
  let from = start;
  let to = end;
  while (from < to && TRIMMABLE.test(text[from] as string)) from += 1;
  while (to > from && TRIMMABLE.test(text[to - 1] as string)) to -= 1;
  return [from, to];
}
