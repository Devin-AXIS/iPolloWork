// Shared by both adapters: which toolbar CONTROLS give up their place to the "⋯" menu, and
// the framework-neutral rules for what a control is.
//
// A narrow bar collapses one control at a time, so it stays full:
//
// - The collapse ORDER picks the group: the first group in the order shrinks first.
// - Inside that group, controls leave from the END of the group, one per step, so what stays
//   is a prefix of the group and the bar keeps its reading order.
// - The next group starts to shrink only when the previous one is empty. At most one group
//   is partly in the bar.
// - A group that loses its last control also frees its separator slot, so no separator is
//   left standing next to nothing.
//
// The fit is arithmetic over measured widths, so it is a pure function and tests without a
// DOM.

import { TOOLBAR_OVERFLOW_HYSTERESIS } from './toolbar-fit.ts';

/**
 * Marks one control of a collapsible group in the bar; the value is the control id.
 *
 * @internal
 */
export const TOOLBAR_ITEM_ATTRIBUTE = 'data-toolbar-item';

/**
 * The control id of a group's host content (`Toolbar.Group` children), which collapses as one
 * control after the group's own slots. Printable, so it survives server rendering in a DOM
 * attribute, and never a slot or arrangement id.
 *
 * @internal
 */
export const TOOLBAR_HOST_ITEM = 'host-content';

/**
 * One collapsible group, as the item fit sees it.
 *
 * @internal
 */
export interface ToolbarFitGroup {
  /** The group id, as the collapse order names it. */
  readonly id: string;
  /** The group's control ids, in bar order. Controls leave from the end. */
  readonly items: readonly string[];
}

/**
 * Group id -> how many controls, counted from the END of the group, are in the "⋯" menu. A
 * group that is not in the map is complete in the bar. A count equal to the group's length
 * means the whole group is in the menu.
 *
 * @internal
 */
export type ToolbarItemOverflow = ReadonlyMap<string, number>;

/**
 * What {@link toolbarOverflowItems} measures against. Widths are layout px.
 *
 * @internal
 */
export interface ToolbarItemFitInput {
  /** Content width of the bar. `0` or less means "not measured yet". */
  readonly available: number;
  /** Collapsible groups, in bar order. */
  readonly groups: readonly ToolbarFitGroup[];
  /** Collapse order of group ids; groups missing from it never collapse. */
  readonly order: readonly string[];
  /** {@link toolbarItemKey} -> the control's measured width. A missing width counts as 0. */
  readonly itemWidths: ReadonlyMap<string, number>;
  /**
   * Group id -> what showing the group at all costs: its separator slot and its own padding.
   * A missing entry counts as 0.
   */
  readonly groupBases: ReadonlyMap<string, number>;
  /** The flex gap between two controls of one group, for groups without their own. */
  readonly gap: number;
  /** Group id -> that group's own flex gap, where it has one. */
  readonly groupGaps?: ReadonlyMap<string, number>;
  /** Width of everything that never collapses: pinned groups, appended children. */
  readonly fixed: number;
  /** Width the "⋯" trigger takes once it is shown. */
  readonly more: number;
  /** The previous answer, for the one-directional slack. */
  readonly previous?: ToolbarItemOverflow | undefined;
  /** Surplus a control needs before it comes back from the menu, in px. */
  readonly hysteresis?: number;
}

/** Nothing overflows. Shared so an unmeasured toolbar returns a stable identity. */
const NONE: ToolbarItemOverflow = new Map<string, number>();

/**
 * The key one control's width is stored under.
 *
 * @internal
 */
export function toolbarItemKey(groupId: string, itemId: string): string {
  return `${groupId}\u0000${itemId}`;
}

/**
 * A stable key for a list of groups, so a fresh list with the same content does not
 * re-measure.
 *
 * @internal
 */
export function toolbarGroupsKey(groups: readonly ToolbarFitGroup[]): string {
  return groups.map((group) => [group.id, ...group.items].join('\u0001')).join('\u0000');
}

/**
 * A group's collapsible controls, in bar order: its drawn slots, then its host content as one
 * control. Pass only the slots the bar draws; a slot removed with `hidden` takes no place.
 *
 * @internal
 */
export function toolbarGroupItems(slots: readonly string[], hasHostContent: boolean): string[] {
  return hasHostContent ? [...slots, TOOLBAR_HOST_ITEM] : [...slots];
}

/**
 * Whether a group's host panel content shows in the "⋯" panel: when its host content left the
 * bar, or, for a group whose panel content has no bar content, when any of its controls did.
 *
 * @internal
 */
export function toolbarHostPanelShown(hasHostContent: boolean, hidden: readonly string[]): boolean {
  return hasHostContent ? hidden.includes(TOOLBAR_HOST_ITEM) : hidden.length > 0;
}

/**
 * How many of a group's controls the bar shows under an answer.
 *
 * @internal
 */
export function toolbarShownCount(
  overflow: ToolbarItemOverflow,
  groupId: string,
  itemCount: number
): number {
  return Math.max(0, itemCount - (overflow.get(groupId) ?? 0));
}

function widthOf(input: ToolbarItemFitInput, groupId: string, itemId: string): number {
  return input.itemWidths.get(toolbarItemKey(groupId, itemId)) ?? 0;
}

/**
 * What a group costs with its first `shown` controls in the bar. A control with no width
 * (a part that draws nothing) is not a flex item, so it takes no gap either.
 */
function groupCost(input: ToolbarItemFitInput, group: ToolbarFitGroup, shown: number): number {
  if (shown <= 0) return 0;
  let content = 0;
  let drawn = 0;
  for (let index = 0; index < shown && index < group.items.length; index += 1) {
    const width = widthOf(input, group.id, group.items[index]!);
    if (!(width > 0)) continue;
    content += width;
    drawn += 1;
  }
  // A group whose controls measured nothing still costs its base, which then holds its whole
  // measured width: it leaves as a unit when its last control does.
  const gap = input.groupGaps?.get(group.id) ?? input.gap;
  return (input.groupBases.get(group.id) ?? 0) + content + Math.max(0, drawn - 1) * gap;
}

function fit(input: ToolbarItemFitInput, available: number): ToolbarItemOverflow {
  let total = input.fixed;
  for (const group of input.groups) total += groupCost(input, group, group.items.length);
  if (total <= available) return NONE;

  // The trigger costs width of its own once the bar is known not to fit.
  total += input.more;
  const byId = new Map(input.groups.map((group) => [group.id, group]));
  const hidden = new Map<string, number>();
  for (const id of input.order) {
    if (total <= available) break;
    const group = byId.get(id);
    if (!group || hidden.has(id)) continue;
    const count = group.items.length;
    for (let shown = count - 1; shown >= 0; shown -= 1) {
      const saved = groupCost(input, group, shown + 1) - groupCost(input, group, shown);
      // A control with no width frees nothing: it leaves only with an earlier one that does.
      if (saved <= 0) continue;
      total -= saved;
      hidden.set(id, count - shown);
      // What stays may draw nothing: then the group leaves whole, separator and base with it.
      if (shown > 0 && !drawsAny(input, group, shown)) {
        total -= groupCost(input, group, shown);
        hidden.set(id, count);
        break;
      }
      if (total <= available) break;
    }
  }
  return hidden;
}

/** Whether any of a group's first `shown` controls has a width. */
function drawsAny(input: ToolbarItemFitInput, group: ToolbarFitGroup, shown: number): boolean {
  for (let index = 0; index < shown && index < group.items.length; index += 1) {
    if (widthOf(input, group.id, group.items[index]!) > 0) return true;
  }
  return false;
}

/** What the bar costs under an answer. */
function costWith(input: ToolbarItemFitInput, overflow: ToolbarItemOverflow): number {
  let total = input.fixed;
  for (const group of input.groups) {
    total += groupCost(input, group, toolbarShownCount(overflow, group.id, group.items.length));
  }
  return overflow.size > 0 ? total + input.more : total;
}

function hiddenTotal(overflow: ToolbarItemOverflow): number {
  let total = 0;
  for (const count of overflow.values()) total += count;
  return total;
}

/**
 * True when two answers describe the same bar, so a re-render can be skipped.
 *
 * @internal
 */
export function sameItemOverflow(a: ToolbarItemOverflow, b: ToolbarItemOverflow): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [id, count] of a) if (b.get(id) !== count) return false;
  return true;
}

/**
 * The previous answer restricted to the bar as it is now, or null when the bar's controls
 * changed since (a contextual group came or went, a group gained or lost controls). The slack
 * keeps a bar from oscillating at one width; it must not keep controls hidden for room that a
 * group which has since left took.
 */
function stillValid(
  previous: ToolbarItemOverflow,
  groups: readonly ToolbarFitGroup[]
): ToolbarItemOverflow | null {
  const counts = new Map(groups.map((group) => [group.id, group.items.length]));
  for (const [id, hidden] of previous) {
    const count = counts.get(id);
    if (count === undefined || hidden > count) return null;
  }
  return previous;
}

/**
 * The controls that must leave the bar for the rest of it to fit in one row.
 *
 * An unmeasured bar (`available <= 0`, which is every server render and every jsdom test)
 * overflows nothing: the full toolbar is the honest answer when nothing is known about the
 * space.
 *
 * @internal
 */
export function toolbarOverflowItems(input: ToolbarItemFitInput): ToolbarItemOverflow {
  if (!(input.available > 0)) return NONE;
  const next = fit(input, input.available);
  const previous = input.previous ? stillValid(input.previous, input.groups) : null;
  // Growing the overflow is immediate; shrinking it has to clear the slack, or a control
  // whose width follows its own value oscillates across the threshold.
  if (!previous || previous.size === 0 || hiddenTotal(next) >= hiddenTotal(previous)) {
    return next;
  }
  const relaxed = fit(input, input.available - (input.hysteresis ?? TOOLBAR_OVERFLOW_HYSTERESIS));
  if (sameItemOverflow(relaxed, previous)) return previous;
  // The slack only ever holds controls back that were already in the menu. It never hides
  // more than the previous answer did, as long as that answer still fits.
  if (hiddenTotal(relaxed) > hiddenTotal(previous)) {
    return costWith(input, previous) <= input.available ? previous : next;
  }
  return relaxed;
}
