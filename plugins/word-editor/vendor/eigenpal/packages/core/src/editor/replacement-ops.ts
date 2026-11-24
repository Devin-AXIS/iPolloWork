// The text ops that replace one paragraph range with new text, shared by every replacing
// command: `replaceMatch`, `replaceAllMatches`, and `replaceAcceptedText`.
//
// Deleting first and then inserting at the range start put the new text wherever an insert at
// that boundary goes, which is the run BEFORE the range, or the run after a hyperlink when
// the range ended one. A fix of the last word in a link moved its letters out of the link. So
// an untracked replacement inserts first, at the range start with a right bias, which joins
// the run of the first replaced character, and then deletes the old text after it. A tracked
// replacement keeps the strike and inserts where the struck text ends, as typing does.

import type { TreeDocOp } from '@docx-editor.dev/core/store';

/**
 * Ops that replace `[start, end)` of a paragraph with `text`. `landing` is where a tracked
 * replacement inserts, or null when the edit is not tracked.
 */
export function replacementOps(
  paragraphId: string,
  start: number,
  end: number,
  text: string,
  landing: number | null
): TreeDocOp[] {
  if (end <= start) {
    return text.length > 0
      ? [{ op: 'insertText', paragraphId, offset: landing ?? start, text }]
      : [];
  }
  if (text.length === 0) return [{ op: 'deleteText', paragraphId, start, end }];
  if (landing !== null) {
    return [
      { op: 'deleteText', paragraphId, start, end },
      { op: 'insertText', paragraphId, offset: landing, text },
    ];
  }
  return [
    { op: 'insertText', paragraphId, offset: start, text, bias: 'right' },
    {
      op: 'deleteText',
      paragraphId,
      start: start + text.length,
      end: end + text.length,
    },
  ];
}
