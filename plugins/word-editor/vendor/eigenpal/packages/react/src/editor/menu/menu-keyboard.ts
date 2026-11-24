// Keyboard navigation for the menu bar, as DOM helpers rather than an item registry.
//
// The bar declares `menubar`/`menu`/`menuitem`, and those roles are a PROMISE: a screen
// reader switches to focus mode on them and hands arrow keys to the widget. Declaring the
// role without implementing the keys is worse than plain buttons — browse mode, which
// would at least have let the user read the items, is suppressed, and nothing answers the
// arrows. So the keys are implemented here and the roles are earned.
//
// Items are FOUND IN THE DOM rather than registered, because the panels are built from
// registry data, host overrides, and arbitrary children in any mix — a registry would have
// to be threaded through every one of those and would go stale the moment a host composed
// something the parts do not know about. Querying is one selector and cannot drift from
// what is actually rendered.
//
// Disabled rows are NOT skipped. They carry `aria-disabled` (not the native attribute)
// precisely so they stay focusable, so the engine's reason is reachable by the users who
// cannot hover to read a tooltip.

/** Every menu row inside one panel, in visual order, excluding nested panels' rows. */
const ITEM_SELECTOR = '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]';

/**
 * The rows a panel owns.
 *
 * `closest` re-anchors each candidate to its nearest panel: a submenu's rows live inside
 * the parent panel's subtree, and stepping into them from the parent's own arrow keys
 * would walk the user into a list they did not open.
 */
export function panelItems(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>(ITEM_SELECTOR)].filter(
    (item) => item.closest('[role="menu"]') === panel
  );
}

/** The triggers of a menu bar, in bar order. */
export function barTriggers(bar: HTMLElement): HTMLElement[] {
  return [...bar.querySelectorAll<HTMLElement>('.docx-menubar__trigger')];
}

/**
 * Move focus within a list by a step, wrapping at both ends.
 *
 * Wrapping is the menu pattern's behaviour and it is what makes a short list usable: from
 * the last row, Down reaches the first in one key rather than none.
 */
export function focusBy(
  items: readonly HTMLElement[],
  from: Element | null,
  step: number
): boolean {
  if (items.length === 0) return false;
  const index = from ? items.indexOf(from as HTMLElement) : -1;
  const next =
    index === -1 ? (step > 0 ? 0 : items.length - 1) : (index + step + items.length) % items.length;
  items[next]?.focus();
  return true;
}

/** Focus the first or last row of a list. */
export function focusEdge(items: readonly HTMLElement[], edge: 'first' | 'last'): boolean {
  const target = edge === 'first' ? items[0] : items[items.length - 1];
  if (!target) return false;
  target.focus();
  return true;
}

/** Give the export dialog a stable menu trigger to restore focus to. */
export function restoreExportFocus(root: HTMLElement | null): void {
  const focused = root?.ownerDocument.activeElement;
  const menu = focused && root?.contains(focused) ? focused.closest('[data-menu]') : null;
  const trigger =
    menu?.querySelector<HTMLElement>(':scope > [role="menuitem"]') ??
    root?.querySelector<HTMLElement>('.docx-menubar__trigger[aria-expanded="true"]');
  trigger?.focus({ preventScroll: true });
}

/**
 * Whether a shortcut target is this editor's pages in ANOTHER window than the bar.
 *
 * A host can keep the menu bar in its main window and render the pages in a pop-out window.
 * Keys typed there never reach the bar's own subtree, so the bar's scope test alone would leave
 * Cmd+S and Cmd+P to the browser. `editorElement` is THIS editor's mount element
 * (`editorHostElement(editor)`): a target inside it belongs to this editor, and only to it,
 * even when several editors share the pop-out.
 */
export function isPoppedOutEditorTarget(
  target: Node,
  barDocument: Document,
  editorElement: Element | null
): boolean {
  if (!editorElement || editorElement.ownerDocument === barDocument) return false;
  return editorElement.contains(target);
}
