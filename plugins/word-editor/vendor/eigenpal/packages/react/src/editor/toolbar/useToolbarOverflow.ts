// The toolbar's own measurement: how wide each control is, and how much room the bar has.
//
// MEASURED, NOT BREAKPOINTED. A media query knows the window's width and nothing about the
// bar: the same 1200px window holds a different toolbar with a navigation pane open, at
// 150% zoom, in German, or with a host that appended two buttons of its own. The bar reads
// its own children instead, so all four cases land on the same rule.
//
// MEASUREMENT IS FREE HERE. Everything is read inside a ResizeObserver callback, which the
// browser delivers after layout has already been computed — so nothing in this file
// forces a reflow. The one exception is the mount pass, which reads once against the fully
// rendered bar to learn every control's width; that is also what makes a control that has
// been in the overflow menu since the first frame still have a known width to come back on.
//
// The reading (`readToolbarRow`) and the fit (`toolbarOverflowItems`) live in core, so the
// React and Vue bars collapse the same controls at the same widths.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  hostWindowOf,
  readToolbarRow,
  sameItemOverflow,
  TOOLBAR_OVERFLOW_HYSTERESIS,
  TOOLBAR_ITEM_ATTRIBUTE,
  toolbarGroupsKey,
  toolbarItemKey,
  toolbarOverflowItems,
  type ToolbarFitGroup,
  type ToolbarItemOverflow,
  type ToolbarRowMemory,
} from '@docx-editor.dev/core/editor';

/** Marks a collapsible group wrapper; the value is the group id. */
export const GROUP_ATTRIBUTE = 'data-toolbar-group';
/** Marks one control of a collapsible group; the value is the control id. */
export const ITEM_ATTRIBUTE = TOOLBAR_ITEM_ATTRIBUTE;
/** Marks anything that stays in the bar at every width (pinned groups, host children). */
export const FIXED_ATTRIBUTE = 'data-toolbar-fixed';
/** Marks the "⋯" trigger. */
export const MORE_ATTRIBUTE = 'data-toolbar-more';

/** Assumed trigger width before one has ever been rendered: the icon-button size. */
const ASSUMED_MORE_WIDTH = 34;

const NONE: ToolbarItemOverflow = new Map<string, number>();

export interface UseToolbarOverflowResult {
  /** Attach to the bar element. */
  readonly attach: (element: HTMLElement | null) => void;
  /** Group id -> how many controls, from the end of the group, render in the "⋯" menu. */
  readonly overflow: ToolbarItemOverflow;
}

/**
 * Measures the bar and answers which controls have to move into the overflow menu.
 *
 * `enabled` false is inert: no observer, no reads, and an empty answer, which renders the
 * complete bar exactly as it did before overflow existed.
 */
export function useToolbarOverflow(
  enabled: boolean,
  groups: readonly ToolbarFitGroup[],
  order: readonly string[]
): UseToolbarOverflowResult {
  const barRef = useRef<HTMLElement | null>(null);
  // Widths SURVIVE a control leaving the bar. See `ToolbarRowMemory`.
  const memory = useRef<ToolbarRowMemory>({
    itemWidths: new Map(),
    groupBases: new Map(),
    groupGaps: new Map(),
    more: ASSUMED_MORE_WIDTH,
  });
  const [overflow, setOverflow] = useState<ToolbarItemOverflow>(NONE);
  const overflowRef = useRef(overflow);
  overflowRef.current = overflow;

  // Latest inputs, read inside the measure callback without re-creating it (and with it the
  // observer) whenever a parent re-renders with a fresh array literal.
  const inputs = useRef({ groups, order });
  inputs.current = { groups, order };
  const groupsKey = toolbarGroupsKey(groups);
  // The controls the previous answer counted from. A count from the end names other controls
  // once a group gains or loses one, so the slack only applies to the same controls.
  const answeredKey = useRef(groupsKey);
  const orderKey = order.join('\u0000');

  const measure = useCallback(() => {
    const bar = barRef.current;
    if (!bar || !enabled) return;
    const reading = readToolbarRow(bar, memory.current, toolbarItemKey);
    // The arithmetic charges every group a few px of gap and separator it may not use, so on
    // a bar sized to its content it can call a bar that fits too narrow. Collapsing one
    // control then shrinks that bar and the next measurement collapses another, until every
    // control is in "⋯". So the first collapse waits for a control that really runs past the
    // bar's box. Without layout to read (null), the arithmetic decides alone.
    const fits = overflowRef.current.size === 0 && reading.overflowing === false;
    const key = toolbarGroupsKey(inputs.current.groups);
    const same = answeredKey.current === key;
    answeredKey.current = key;
    const next = fits
      ? NONE
      : toolbarOverflowItems({
          ...reading,
          groups: inputs.current.groups,
          order: inputs.current.order,
          itemWidths: memory.current.itemWidths,
          groupBases: memory.current.groupBases,
          groupGaps: memory.current.groupGaps,
          ...(same ? { previous: overflowRef.current } : {}),
          hysteresis: TOOLBAR_OVERFLOW_HYSTERESIS,
        });
    if (!sameItemOverflow(next, overflowRef.current)) {
      overflowRef.current = next;
      setOverflow(next);
    }
  }, [enabled]);

  const attach = useCallback((element: HTMLElement | null) => {
    barRef.current = element;
  }, []);

  // The mount pass, against the complete bar: the only forced read in the file, and the one
  // that gives every control a width before any of them can be hidden. In a layout effect so
  // the collapsed bar is what the browser paints — measuring after paint shows the user one
  // frame of the three-row toolbar this exists to remove.
  useLayoutEffect(() => {
    if (!enabled) {
      if (overflowRef.current.size > 0) {
        overflowRef.current = NONE;
        setOverflow(NONE);
      }
      return;
    }
    measure();
  }, [enabled, groupsKey, measure, orderKey]);

  // Width changes come from two directions and both are observed: the bar's own box (window
  // resize, a navigation pane opening) and each group's content (a longer font name, a
  // locale with longer labels, a host restyling a control).
  useEffect(() => {
    const bar = barRef.current;
    // The bar's own window: its frames keep running while a hidden opener's stop.
    const view = bar ? hostWindowOf(bar) : null;
    if (!enabled || !bar || !view || typeof view.ResizeObserver === 'undefined') return undefined;
    let frame = 0;
    const observer = new view.ResizeObserver(() => {
      // Coalesced: a window drag delivers a callback per frame per observed element, and
      // the answer only ever depends on the final geometry of the frame.
      if (frame !== 0) return;
      frame = view.requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    });
    observer.observe(bar);
    // The parent too: a bar as wide as its content does not resize when the room around
    // it grows, so only the parent reports the space a collapsed control can come back into.
    if (bar.parentElement) observer.observe(bar.parentElement);
    for (const element of bar.querySelectorAll<HTMLElement>(
      `[${GROUP_ATTRIBUTE}], [${FIXED_ATTRIBUTE}]`
    )) {
      observer.observe(element);
    }
    return () => {
      if (frame !== 0) view.cancelAnimationFrame(frame);
      observer.disconnect();
    };
    // Re-observes when the composition changes: a group that just came back into the bar is
    // a new element, and an unobserved one stops reporting the growth that would push it out
    // again. `overflow` in the deps is what makes that re-attachment happen.
  }, [enabled, groupsKey, measure, orderKey, overflow]);

  return { attach, overflow };
}

/**
 * The same measurement for a bar whose groups leave whole (the menu bar): each group is one
 * control, and the answer is the set of group ids in the "⋯" menu.
 */
export function useToolbarGroupOverflow(
  enabled: boolean,
  groups: readonly string[],
  order: readonly string[]
): {
  readonly attach: (element: HTMLElement | null) => void;
  readonly overflow: ReadonlySet<string>;
} {
  // A fresh list each render is fine: the measurement keys its inputs by value.
  const fitGroups = groups.map((id) => ({ id, items: [id] }));
  const { attach, overflow } = useToolbarOverflow(enabled, fitGroups, order);
  const ids = useMemo<ReadonlySet<string>>(() => new Set(overflow.keys()), [overflow]);
  return { attach, overflow: ids };
}
