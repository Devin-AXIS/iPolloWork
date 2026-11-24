// Spaces that open a line with balanced single-byte and double-byte widths
// (`w:balanceSingleByteDoubleByteWidth`) take half an em each. In a proportional face that is
// wider than the space itself, so such a line has no room to borrow from its spaces or to hang
// a final mark: its next word wraps. A face whose space is wider than half an em, such as
// Courier New, gains room instead, and keeps the usual rules.
import { isBalancedSpace, unwidenedStyle } from './balanced-space-widths.ts';
import { measureDisplayText } from './run-style.ts';
import { styleForFontSlot } from './script-itemization.ts';
import type { StyleSpanRecord, TextMeasurer } from './semantic-records.ts';

/** Whether the line opens with spaces that balanced widths make wider than their face's space. */
export function opensWithWidenedSpaces(
  spans: readonly StyleSpanRecord[],
  measurer: TextMeasurer
): boolean {
  const first = spans[0];
  if (!first?.text.startsWith(' ')) return false;
  // A space already at the balanced width carries the difference as character spacing.
  if (isBalancedSpace(first))
    return first.style.characterSpacingPt > unwidenedStyle(first.style).characterSpacingPt;
  const style = styleForFontSlot(first.style, first.fontSlot);
  return measureDisplayText(' ', style, measurer) < style.fontSizePt / 2 - 1e-6;
}
