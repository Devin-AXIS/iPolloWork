// Shared by both adapters: the toolbar's collapse POLICY, so React and Vue cannot drift on
// what collapses first.
//
// THE BAR IS ONE ROW. Wrapping to a second and third row was the old answer, and on a
// laptop beside an open navigation pane it ate a third of the window before a single line
// of the document was visible. So the row measures itself and moves controls into an
// overflow menu instead. The fit itself, one control at a time, is `toolbar-item-fit.ts`.
//
// TWO RULES DECIDE WHAT GOES:
//
// - GROUP BY GROUP. The fit empties one group, from its end, before it touches the next,
//   and a group that empties takes its separator with it, so no separator stands between
//   nothing and something.
// - A DECLARED ORDER, not "whatever is last". Registry order is bar order, and its tail is
//   the review controls: the comments toggle and the editing-mode pill, which stay at every
//   width. The order below is the collapse policy of THIS arrangement, which is the same
//   layer that merges the four alignment slots into one dropdown; the registry stays free
//   of layout policy.

/**
 * Collapse order: the first id here is the first group to leave the bar.
 *
 * Zoom goes first (a document you cannot format is worse than one you cannot scale), then
 * the small standalone groups, then the paragraph controls, then text formatting and history, and the selected
 * shape's or chart's controls last. A group the registry has but this list does not is collapsed before all of these,
 * in reverse bar order — a host-added group has no declared standing, and the alternative
 * is a new group that silently never collapses.
 *
 * @internal
 */
export const TOOLBAR_COLLAPSE_ORDER: readonly string[] = [
  'zoom',
  'script',
  'format',
  'list',
  'alignment',
  'styles',
  'font',
  'text',
  'history',
  // The selected object's own controls leave last, and lead the overflow menu when they do.
  'shape',
  'chart',
];

/**
 * Groups that lead the overflow menu when they collapse: the controls of the selected object,
 * which a host most often reaches for while the object is selected.
 *
 * @internal
 */
export const TOOLBAR_OVERFLOW_LEADING_GROUPS: ReadonlySet<string> = new Set(['shape', 'chart']);

/**
 * `sections` with the {@link TOOLBAR_OVERFLOW_LEADING_GROUPS} first, each side in its own order.
 *
 * @internal
 */
export function orderToolbarOverflowSections<T extends { readonly id: string }>(
  sections: readonly T[]
): T[] {
  const leading = sections.filter((section) => TOOLBAR_OVERFLOW_LEADING_GROUPS.has(section.id));
  return [
    ...leading,
    ...sections.filter((section) => !TOOLBAR_OVERFLOW_LEADING_GROUPS.has(section.id)),
  ];
}

/**
 * Groups that never move into the overflow menu.
 *
 * `review` holds the comments toggle and the editing-mode pill. The comments rail is
 * reached through that toggle and nothing else, and a narrow window is exactly where a
 * reader needs it, so burying it one menu deep is the wrong trade.
 *
 * @internal
 */
export const TOOLBAR_PINNED_GROUPS: ReadonlySet<string> = new Set(['review']);

/**
 * Px of surplus, beyond what a control costs (its width and gap, plus its group's separator
 * slot when it is the group's first control back, less the "⋯" trigger when it is the last
 * hidden one), the bar must have before that control comes back OUT of the overflow menu.
 *
 * Without it a value control that widens with its own value (font family going from
 * "Arial" to "Times New Roman") pushes itself out, which frees the width that pulled it
 * back in, forever. One-directional slack breaks the loop.
 *
 * @internal
 */
export const TOOLBAR_OVERFLOW_HYSTERESIS = 24;

/**
 * The priority of a declared group: its place in {@link TOOLBAR_COLLAPSE_ORDER}, in steps of
 * 10, so zoom is 10 and history is 90. A host group with a `priority` sorts among these, and
 * a LOWER number leaves the bar first. The steps leave room between two built-in groups.
 *
 * @internal
 */
export function toolbarGroupPriority(
  id: string,
  order: readonly string[] = TOOLBAR_COLLAPSE_ORDER
): number | undefined {
  const index = order.indexOf(id);
  return index === -1 ? undefined : (index + 1) * 10;
}

/**
 * The collapse order actually used: the declared one, with undeclared groups first.
 *
 * `priorities` gives a group an explicit place among the declared ones (see
 * {@link toolbarGroupPriority}), and overrides a declared group's own priority. Groups with
 * neither collapse first, in reverse bar order. Two groups with the same priority collapse
 * in reverse bar order too: the one further along the bar leaves first.
 *
 * @internal
 */
export function collapseOrder(
  groups: readonly string[],
  order: readonly string[] = TOOLBAR_COLLAPSE_ORDER,
  priorities?: ReadonlyMap<string, number>
): readonly string[] {
  const ranked: { id: string; priority: number; position: number }[] = [];
  const undeclared: string[] = [];
  groups.forEach((id, position) => {
    const priority = priorities?.get(id) ?? toolbarGroupPriority(id, order);
    if (priority === undefined || Number.isNaN(priority)) undeclared.push(id);
    else ranked.push({ id, priority, position });
  });
  ranked.sort((a, b) => a.priority - b.priority || b.position - a.position);
  return [...undeclared.reverse(), ...ranked.map((entry) => entry.id)];
}

/**
 * One host group's placement request.
 *
 * @internal
 */
export interface ToolbarHostGroupPlacement {
  readonly id: string;
  /** The group this one follows. Absent, or unknown, places it after every group. */
  readonly after?: string | undefined;
}

/**
 * Bar order with the host's groups placed.
 *
 * A host group without `after` follows every built-in group, in order of appearance. A group
 * with `after` follows the group it names, after any host groups already placed there, so
 * several groups anchored to one place keep their order of appearance. An anchor may be
 * another host group. An anchor that never resolves (an unknown id, or a cycle) places the
 * group at the end.
 *
 * @internal
 */
export function arrangeToolbarGroups(
  builtIn: readonly string[],
  hosts: readonly ToolbarHostGroupPlacement[]
): readonly string[] {
  const result = [...builtIn];
  // The last id placed after each anchor, so a second group anchored there follows the first.
  const tail = new Map<string, string>();
  let pending = hosts.filter((host) => !builtIn.includes(host.id));
  while (pending.length > 0) {
    const deferred: ToolbarHostGroupPlacement[] = [];
    for (const host of pending) {
      const anchor = host.after;
      if (anchor === undefined || anchor === host.id) {
        result.push(host.id);
        continue;
      }
      if (!result.includes(anchor)) {
        deferred.push(host);
        continue;
      }
      const after = tail.get(anchor) ?? anchor;
      result.splice(result.indexOf(after) + 1, 0, host.id);
      tail.set(anchor, host.id);
    }
    if (deferred.length === pending.length) {
      // Nothing resolved in this pass: the rest name groups that do not exist.
      result.push(...deferred.map((host) => host.id));
      break;
    }
    pending = deferred;
  }
  return result;
}

/**
 * The margin the "⋯" panel keeps from each viewport edge, in px.
 *
 * @internal
 */
export const TOOLBAR_PANEL_EDGE_MARGIN = 8;

/**
 * Where the "⋯" panel opens, in viewport px.
 *
 * @internal
 */
export interface ToolbarPanelPlacement {
  /** The panel's left edge. */
  readonly left: number;
  /** The widest the panel may be: the viewport less both margins. */
  readonly maxWidth: number;
  /** Which trigger edge the panel lines up with, or `clamped` when neither fits. */
  readonly anchor: 'start' | 'end' | 'clamped';
}

/**
 * Keep the "⋯" panel inside the viewport.
 *
 * The panel lines up with the trigger's end edge first, which suits a trigger at the end of
 * the bar. When that runs past the left edge (a centered or narrow bar), it lines up with
 * the trigger's start edge instead. When neither fits, it is clamped to the margins.
 *
 * @internal
 */
export function toolbarPanelPlacement(input: {
  readonly triggerLeft: number;
  readonly triggerRight: number;
  readonly panelWidth: number;
  readonly viewportWidth: number;
  readonly margin?: number;
}): ToolbarPanelPlacement {
  const margin = input.margin ?? TOOLBAR_PANEL_EDGE_MARGIN;
  const maxWidth = Math.max(0, input.viewportWidth - margin * 2);
  const width = Math.min(input.panelWidth, maxWidth);
  const min = margin;
  const max = input.viewportWidth - margin - width;
  const end = input.triggerRight - width;
  if (end >= min && end <= max) return { left: end, maxWidth, anchor: 'end' };
  const start = input.triggerLeft;
  if (start >= min && start <= max) return { left: start, maxWidth, anchor: 'start' };
  return { left: Math.max(min, Math.min(end, max)), maxWidth, anchor: 'clamped' };
}

/**
 * The left edge, in viewport px, of a popup that opens under a bar control.
 *
 * The popup lines up with the control's start edge, and moves left or right only as far as
 * it must to keep {@link TOOLBAR_PANEL_EDGE_MARGIN} from each viewport edge. A popup wider
 * than the viewport keeps its left margin.
 *
 * @internal
 */
export function toolbarPopupLeft(input: {
  readonly anchorLeft: number;
  readonly popupWidth: number;
  readonly viewportWidth: number;
  readonly margin?: number;
}): number {
  const margin = input.margin ?? TOOLBAR_PANEL_EDGE_MARGIN;
  const max = input.viewportWidth - margin - input.popupWidth;
  return Math.max(margin, Math.min(input.anchorLeft, max));
}
