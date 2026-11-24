// The menu bar's "⋯" overflow, as one menu sees it.
//
// A menu that does not fit renders as a submenu row of the "⋯" menu instead of in the bar,
// and the "⋯" menu itself is an icon-only trigger. This reads the shared overflow answer
// for one menu id, so the `Menu` part renders from one plain value.

import { MENU_OVERFLOW_ID, type MenuOverflowValue } from './menu-context';
import { GROUP_ATTRIBUTE, MORE_ATTRIBUTE } from '../toolbar/useToolbarOverflow';

/** Where one menu renders, and the measurement attributes its bar root carries. */
export interface MenuOverflowPlacement {
  /** Render nothing: the menu is in the bar while this is the "⋯" panel, or the reverse. */
  readonly skip: boolean;
  /** Render as a submenu row of the "⋯" panel. */
  readonly asSubmenu: boolean;
  /** This menu is the "⋯" trigger: icon only, named on the element. */
  readonly iconOnly: boolean;
  /** Attributes for the menu's root in the bar. */
  readonly rootAttributes: Record<string, string>;
  /** True when this trigger holds the menu bar's tab stop. */
  readonly tabStop: boolean;
}

export function menuOverflowPlacement(
  state: MenuOverflowValue,
  id: string,
  activeMenu: string | null
): MenuOverflowPlacement {
  const collapsed = state.overflow.has(id);
  const iconOnly = id === MENU_OVERFLOW_ID;
  return {
    skip: state.inMore ? !collapsed : collapsed,
    asSubmenu: state.inMore && collapsed,
    iconOnly,
    rootAttributes: {
      ...(state.measuring && !iconOnly ? { [GROUP_ATTRIBUTE]: id } : {}),
      ...(iconOnly ? { [MORE_ATTRIBUTE]: '' } : {}),
    },
    // When the active menu moved into "⋯", the "⋯" trigger holds the stop instead.
    tabStop:
      activeMenu === id || (iconOnly && activeMenu !== null && state.overflow.has(activeMenu)),
  };
}
