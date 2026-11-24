import type { ChromeMenuEntry, ChromeSlotId, ChromeMenu } from './chrome-controls.ts';

export function flattenChromeMenuSlots(menus: readonly ChromeMenu[]): readonly ChromeSlotId[] {
  const slots: ChromeSlotId[] = [];
  const walk = (entries: readonly ChromeMenuEntry[]): void => {
    for (const entry of entries) {
      if (entry.kind === 'item') slots.push(entry.slot);
      else if (entry.kind === 'submenu') walk(entry.items);
    }
  };
  for (const menu of menus) walk(menu.entries);
  return slots;
}
