// Where focus goes in a Compare documents dialog when its Compare button disables itself, and
// after a compare that leaves the dialog open. One rule for every adapter's dialog.

/**
 * The attribute that marks a Compare documents dialog's busy status: the step of a running
 * compare in words. {@link focusCompareDocumentsControl} focuses it while nothing else can
 * take focus.
 *
 * @public
 */
export const COMPARE_DOCUMENTS_PHASE_ATTRIBUTE = 'data-docx-compare-phase';

const enabled = (node: Element | null): node is HTMLElement =>
  node !== null && !(node as HTMLButtonElement).disabled && !node.closest('[hidden]');

/**
 * Move focus to the control that is useful at `moment` in a Compare documents dialog:
 *
 * - `busy`: a compare started and Compare is disabled. Cancel when it stays enabled (a
 *   background compare), else the busy status, else the dialog itself.
 * - `refused`: a compare was refused, or the file could not be read. The file input.
 * - `unchanged`: the documents have no differences. Compare, else the file input.
 *
 * The dialog's controls carry `data-docx-part` markers (`cancel`, `apply`) and the file
 * field `data-docx-field="revised"`. Focus never moves out of `dialog`.
 *
 * @public
 */
export function focusCompareDocumentsControl(
  dialog: HTMLElement | null | undefined,
  moment: 'busy' | 'refused' | 'unchanged'
): void {
  if (!dialog?.isConnected) return;
  const find = (selector: string) => dialog.querySelector(selector);
  const file = find('[data-docx-field="revised"] input, input[type="file"]');
  const candidates =
    moment === 'busy'
      ? [find('[data-docx-part="cancel"]'), find(`[${COMPARE_DOCUMENTS_PHASE_ATTRIBUTE}]`)]
      : moment === 'unchanged'
        ? [find('[data-docx-part="apply"]'), file]
        : [file, find('[data-docx-part="apply"]')];
  const target = candidates.find(enabled) ?? dialog;
  if (target === dialog && !dialog.hasAttribute('tabindex')) dialog.tabIndex = -1;
  target.focus({ preventScroll: true });
}
