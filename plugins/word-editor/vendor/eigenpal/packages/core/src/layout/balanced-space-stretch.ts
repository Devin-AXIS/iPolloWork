// Justified and distributed lines with spaces at the balanced width
// (`balanced-space-widths.ts`). Every space of such a line takes one common width, and a
// balanced space never goes below its balanced width: the narrower spaces take the slack
// first, and once every space is as wide as the widest, they all stretch together.
import { isBalancedSpace, mayHoldBalancedSpaces } from './balanced-space-widths.ts';
import { automaticTextSpacingBefore } from './cjk-automatic-spacing.ts';
import { insideFitTextGroup } from './fit-text-groups.ts';
import { measureDisplayText } from './run-style.ts';
import { styleForFontSlot } from './script-itemization.ts';
import type { StyleSpanRecord, TextMeasurer } from './semantic-records.ts';
import { withoutTrailingSpaces, withoutTrailingZeroWidthSpaces } from './trailing-spaces.ts';

/** Text whose characters a justified line also spreads: ideographs and kana, not Hangul. */
const SPREAD_TEXT = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;

interface Slot {
  readonly index: number;
  readonly spaces: number;
  /** One space's advance. */
  readonly width: number;
}

function trailingSpaces(text: string): number {
  const visible = withoutTrailingZeroWidthSpaces(text);
  let count = 0;
  while (count < visible.length && visible[visible.length - 1 - count] === ' ') count += 1;
  return count;
}

/**
 * Stretch `spans[0, slotEnd)` by `slack` over its spaces, as above. Null when the line holds no
 * balanced space, or when something else on it takes slack too (ideograph and kana gaps,
 * automatic gaps between scripts, tabs, reserved float positions): the caller's own rules
 * then apply. `distributed` lines keep the spaces before their first character.
 */
export function stretchBalancedSpaces(
  spans: readonly StyleSpanRecord[],
  measurer: TextMeasurer,
  slack: number,
  slotEnd: number,
  distributed: boolean
): readonly StyleSpanRecord[] | null {
  if (slack <= 0 || !mayHoldBalancedSpaces() || !spans.some(isBalancedSpace)) return null;
  for (const span of spans)
    if (
      span.text.includes('\t') ||
      (span.wrapAdvanceBefore ?? 0) > 0 ||
      automaticTextSpacingBefore(span) > 0 ||
      SPREAD_TEXT.test(span.text)
    )
      return null;
  let slotStart = 1;
  if (distributed)
    while (slotStart < slotEnd && withoutTrailingSpaces(spans[slotStart - 1]!.text) === '')
      slotStart += 1;
  const slots: Slot[] = [];
  for (let index = slotStart; index < slotEnd; index += 1) {
    const before = spans[index - 1]!;
    if (insideFitTextGroup(before, spans[index]!)) continue;
    const spaces = trailingSpaces(before.text);
    if (spaces === 0) continue;
    const width = isBalancedSpace(before)
      ? before.box.width / spaces
      : measureDisplayText(' ', styleForFontSlot(before.style, before.fontSlot), measurer);
    slots.push({ index, spaces, width });
  }
  if (!slots.some((slot) => isBalancedSpace(spans[slot.index - 1]!))) return null;
  const level = fillLevel(slots, slack);
  const gaps = new Map(
    slots.map((slot) => [slot.index, slot.spaces * Math.max(0, level - slot.width)])
  );
  let shift = 0;
  return spans.map((span, index) => {
    shift += gaps.get(index) ?? 0;
    return shift === 0 ? span : { ...span, box: { ...span.box, x: span.box.x + shift } };
  });
}

/**
 * How much the lending spaces of a line widen, as a ratio of their advance, when the line
 * takes `slack` the balanced way. Each slot is a run of `spaces` spaces of one `width`;
 * `lends` marks the spaces that are not at the balanced width. Undefined without such spaces.
 */
export function balancedStretchRatio(
  slots: readonly (Omit<Slot, 'index'> & { readonly lends: boolean })[],
  slack: number
): number | undefined {
  let natural = 0;
  for (const slot of slots) if (slot.lends) natural += slot.spaces * slot.width;
  if (natural <= 0) return undefined;
  const level = fillLevel(slots, Math.max(0, slack));
  let added = 0;
  for (const slot of slots) if (slot.lends) added += slot.spaces * Math.max(0, level - slot.width);
  return 1 + added / natural;
}

/** The common space width that takes exactly `slack`, the narrowest spaces first. */
function fillLevel(slots: readonly Omit<Slot, 'index'>[], slack: number): number {
  const widths = [...new Set(slots.map((slot) => slot.width))].sort((a, b) => a - b);
  let count = 0;
  let level = widths[0]!;
  let left = slack;
  for (let step = 0; step < widths.length; step += 1) {
    const width = widths[step]!;
    count += slots.filter((slot) => slot.width === width).reduce((n, slot) => n + slot.spaces, 0);
    const next = widths[step + 1];
    const room = next === undefined ? Infinity : (next - width) * count;
    if (left <= room) return width + left / count;
    left -= room;
    level = next!;
  }
  return level;
}
