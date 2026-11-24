// Development warnings for toolbar compositions that cannot do what they say.
//
// A misplaced part still renders, because breaking the host's page is worse than a
// misplaced control. But it must not fail silently: each case below names the part, the
// value, and what the toolbar did instead. Each message prints once, and never in a
// production build.

import { isDevelopment } from '../../lib/is-development';

const printed = new Set<string>();

/** Print `message` once per page, in development builds only. */
export function toolbarDevWarning(message: string): void {
  if (!isDevelopment() || printed.has(message)) return;
  printed.add(message);
  console.warn(`[docx-editor] ${message}`);
}

/** A `Toolbar.Group` names an `after` anchor that is not a group of this toolbar. */
export function warnUnknownGroupAnchor(id: string, after: string, known: readonly string[]): void {
  toolbarDevWarning(
    `Toolbar.Group "${id}" has after="${after}", but no group has that id. ` +
      `The group is placed after every other group. Known ids: ${known.join(', ')}.`
  );
}

/** A `Toolbar.Group` with a built-in id sets a prop that only a host group uses. */
export function warnBuiltInGroupSetting(id: string, setting: string): void {
  toolbarDevWarning(
    `Toolbar.Group "${id}" is a built-in group, so its ${setting} is ignored. ` +
      `A built-in group keeps its own label and place in the bar.`
  );
}

/** A `Toolbar.Group` uses an id the toolbar keeps for its own contextual group. */
export function warnReservedGroupId(id: string): void {
  toolbarDevWarning(
    `Toolbar.Group "${id}" uses the id of the contextual table group, so it is ignored. ` +
      `Give the group another id.`
  );
}

/** A slot override names a slot the preset arrangement does not draw. */
export function warnSlotOutsideArrangement(slot: string, known: boolean): void {
  toolbarDevWarning(
    known
      ? `Toolbar slot "${slot}" is not part of the preset arrangement, so its content is ` +
          `appended after the groups. Put it in a Toolbar.Group to give it a place.`
      : `"${slot}" is not a toolbar slot id. Its content is appended after the groups. ` +
          `Use a ChromeSlotId such as "text.bold".`
  );
}
