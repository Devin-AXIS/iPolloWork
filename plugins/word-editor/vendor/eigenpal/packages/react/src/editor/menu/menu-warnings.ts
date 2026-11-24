// Development warnings for menu and context-menu compositions whose overrides do nothing
// or use a deprecated prop. Each message prints once, and never in a production build.

import { isDevelopment } from '../../lib/is-development';

const printed = new Set<string>();

/** Print `message` once per page, in development builds only. */
export function menuDevWarning(message: string): void {
  if (!isDevelopment() || printed.has(message)) return;
  printed.add(message);
  console.warn(`[docx-editor] ${message}`);
}

/** A menu row named by the deprecated `slot` prop instead of `slotId`. */
export function warnDeprecatedSlotProp(slot: string): void {
  menuDevWarning(
    `Menu.Item and ContextMenu.Slot take the slot id as slotId. slot="${slot}" still works ` +
      `in this release; write slotId="${slot}".`
  );
}

/** A `hidden` override whose id matches no packaged row, so it removes nothing. */
export function warnUnmatchedHiddenRow(id: string): void {
  menuDevWarning(
    `A hidden context-menu override names "${id}", but no packaged row has that id, so ` +
      `nothing is removed.`
  );
}

/** A packaged row inside `ContextMenu.Start`, which renders it a second time above its default. */
export function warnPackagedRowInStart(id: string): void {
  menuDevWarning(
    `ContextMenu.Start holds the packaged row "${id}", which also renders in its default ` +
      `place, so it shows twice. Start is for the host's own rows.`
  );
}

/** A `ContextMenu.Start` the menu could not hoist, such as one a host component returned. */
export function warnStartNotDirectChild(): void {
  menuDevWarning(
    `A ContextMenu.Start is not a direct child of ContextMenu, so it renders after the ` +
      `default rows. Put your component inside Start instead of returning Start from it.`
  );
}

/** A `Menu.Item` or `ContextMenu.Slot` with neither `slotId` nor `slot`, so it renders nothing. */
export function warnMissingSlotId(): void {
  menuDevWarning('A Menu.Item or ContextMenu.Slot has no slotId, so it renders nothing.');
}

/** A `Menu.Submenu` with neither `label` nor `labelKey`. */
export function warnMissingSubmenuLabel(): void {
  menuDevWarning('A Menu.Submenu has neither label nor labelKey, so its row has no name.');
}

/** A `Toolbar.Button` named by the deprecated `slot` prop instead of `slotId`. */
export function warnDeprecatedButtonSlot(slot: string): void {
  menuDevWarning(
    `Toolbar.Button takes the slot id as slotId. slot="${slot}" still works in this ` +
      `release; write slotId="${slot}".`
  );
}

/** A `Toolbar.Button` with neither `slotId` nor `slot`, so it renders nothing. */
export function warnMissingButtonSlot(): void {
  menuDevWarning('A Toolbar.Button has no slotId, so it renders nothing.');
}
