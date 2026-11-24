// The level a paragraph takes when a list toggle joins it to the list above it.
//
// Reference renderings use two rules. A list whose levels link paragraph styles, such as a
// heading numbering, puts the paragraph on the level its first line reaches: one level per
// default tab stop, so with the default half inch a first line at 0.6 in joins at level 1
// and becomes a Heading 2. The level indents and the level of the item above do not count. A
// plain list puts the paragraph on the level of the item above, whatever its indent.

import type { ListMarkerRecord, ParagraphIndent } from '@docx-editor.dev/core/layout';

const MAX_LIST_LEVEL = 8;

/** What {@link joinedLevel} reads. */
export interface ListJoinReads {
  /** The paragraph style `numId` links at `level` through `w:pStyle`, or null. */
  listLevelStyleOf(numId: string, level: number): string | null;
  /** The paragraph's effective indent, in points, or null when it is not laid out. */
  indentOf(paragraphId: string): ParagraphIndent | null;
  /** `w:defaultTabStop` in points. */
  defaultTabStopPt(): number;
}

function linksStyles(reads: ListJoinReads, numId: string): boolean {
  for (let level = 0; level <= MAX_LIST_LEVEL; level += 1) {
    if (reads.listLevelStyleOf(numId, level) !== null) return true;
  }
  return false;
}

/** The level a paragraph that is no list item takes when it joins the list of `above`. */
export function joinedLevel(
  reads: ListJoinReads,
  paragraphId: string,
  above: ListMarkerRecord
): number {
  if (!linksStyles(reads, above.numId)) return above.level;
  const indent = reads.indentOf(paragraphId);
  // Whole twips, so a stop at 720 and a first line at 1440 divide exactly.
  const tab = Math.round(reads.defaultTabStopPt() * 20);
  if (!indent || !(tab > 0)) return 0;
  const firstLine = Math.round((indent.left + indent.firstLine - indent.hanging) * 20);
  if (!(firstLine > 0)) return 0;
  return Math.min(MAX_LIST_LEVEL, Math.floor(firstLine / tab));
}
