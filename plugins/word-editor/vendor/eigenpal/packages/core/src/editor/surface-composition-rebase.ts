// A composition's edit, carried onto a paragraph that changed while it was being composed.
//
// Once the input method has written, the painted DOM is its own until `compositionend`, so
// the surface holds its repaint for that long (see `render` in paginated-surface.ts). The
// MODEL does not wait: a collaborator's edit arriving mid-composition is applied at once. At
// `compositionend` the page therefore shows the paragraph as it was when the hold began,
// plus what the input method wrote, while the model holds that older text plus the
// collaborator's edit. Diffing the two would read the collaborator's edit as the user's, and
// undo it.
//
// So the readback is taken against the text the page shows (`base`), and the one edit that
// yields is moved onto the model's current text. Offsets move the way a remote caret's do
// (`mapOffsetAcrossText`), so the composed text stays where the reader's caret is. A
// deletion the composition made (a candidate replacing a selection) never deletes what a
// collaborator wrote, which the user did not see.

import { mapOffsetAcrossText } from '../collaboration/offset-mapping.ts';

/** One replace, in the offsets of the text it applies to. */
export interface TextEdit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** The differing middle of two strings: `before.slice(start, end)` became `text`. */
function differingMiddle(before: string, after: string): TextEdit {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) {
    start += 1;
  }
  let suffix = 0;
  while (
    suffix < before.length - start &&
    suffix < after.length - start &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return { start, end: before.length - suffix, text: after.slice(start, after.length - suffix) };
}

/**
 * What the input method did to `base`.
 *
 * A composition at a collapsed caret inserts there, which a plain diff cannot always tell:
 * `에` composed before `에서` diffs as an insert after it. When the caret's reading gives the
 * same text, it is the one taken, so the edit keeps its place relative to the remote text.
 */
export function composedEdit(base: string, painted: string, caret: number | null): TextEdit {
  const grown = painted.length - base.length;
  if (
    caret !== null &&
    grown > 0 &&
    caret <= base.length &&
    painted.startsWith(base.slice(0, caret)) &&
    painted.endsWith(base.slice(caret))
  ) {
    return { start: caret, end: caret, text: painted.slice(caret, caret + grown) };
  }
  return differingMiddle(base, painted);
}

/** Where an offset into `base` is in `current`, by the rule a remote caret moves by. */
export function rebaseOffset(base: string, current: string, offset: number): number {
  return mapOffsetAcrossText(offset, base, current);
}

/**
 * The text a paragraph should hold: `current` with the input method's edit applied.
 *
 * `base` is the text the page showed under the composition, `painted` what it shows at the
 * end, and `caret` the collapsed caret offset it began at, or null for a range.
 */
export function rebaseComposedText(
  base: string,
  painted: string,
  current: string,
  caret: number | null
): string {
  if (current === base) return painted;
  if (painted === base) return current;
  const edit = composedEdit(base, painted, caret);
  const start = rebaseOffset(base, current, edit.start);
  if (edit.end === edit.start) return current.slice(0, start) + edit.text + current.slice(start);
  // Each replaced character is deleted where it is now, if it is still there unchanged.
  // Whatever else lies in the range is a collaborator's, which the user never saw.
  const deleted = new Set<number>();
  for (let index = edit.start; index < edit.end; index += 1) {
    const at = rebaseOffset(base, current, index);
    if (rebaseOffset(base, current, index + 1) === at + 1 && current[at] === base[index]) {
      deleted.add(at);
    }
  }
  let kept = '';
  for (let index = start; index < current.length; index += 1) {
    if (!deleted.has(index)) kept += current[index];
  }
  return current.slice(0, start) + edit.text + kept;
}
