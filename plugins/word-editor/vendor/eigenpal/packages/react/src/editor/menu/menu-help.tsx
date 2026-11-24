// Help and its one packaged row, Report issue. Kept beside the other menu parts but in
// their own file, so the menu parts file stays under its line cap.

import { openReportIssue } from '../../lib/reportIssue';
import type { ChromeMenuId } from '@docx-editor.dev/core/editor';
import { useMenuContext, useMenuLabel } from './menu-context';
import { Menu, MenuRow, type MenuPartComponent, type MenuProps } from './parts';

/** Props for `DocxEditor.Menu.ReportIssue`. @public */
export interface MenuReportIssueProps {
  className?: string;
  /** Render nothing — inside the packaged Help menu this removes the row. */
  hidden?: boolean;
  /** Replaces the packaged handler. Falls back to the menu's `onReportIssue`, then to
   *  this project's own tracker. */
  onSelect?: () => void;
}

/**
 * Help › Report issue.
 *
 * A NAMED part rather than anonymous markup inside the Help menu, because it is the one
 * packaged row that reaches OUTSIDE the host's product: it opens this project's issue
 * tracker with the current page URL and user agent prefilled. A host embedding the editor
 * in its own app has every reason to point that somewhere else or drop it, and it should
 * not have to rebuild the menu to do either — `reportIssue={false}` removes it,
 * `onReportIssue` redirects it, and this part composes it back by name.
 *
 * @public
 */
function MenuReportIssueImpl({ className, hidden, onSelect }: MenuReportIssueProps) {
  const { setOpenMenu, onReportIssue, reportIssue } = useMenuContext();
  const label = useMenuLabel();
  if (hidden || reportIssue === false) return null;
  const run = onSelect ?? onReportIssue ?? openReportIssue;
  return (
    <MenuRow
      slot="help.reportIssue"
      onSelect={() => {
        run();
        setOpenMenu(null);
      }}
      {...(className ? { className } : {})}
    >
      {label('toolbar.reportIssue')}
    </MenuRow>
  );
}

/**
 * The report-issue row, with its row-identity marker.
 *
 * The key is NOT a `ChromeSlotId` — the row is React's, not the shared registry's — but the
 * merge only needs a stable string, and using one here is what lets a host write
 * `<Menu.ReportIssue hidden/>` and have it REPLACE the packaged row rather than render a
 * second, invisible one beside it.
 *
 * @public
 */
export const MenuReportIssue = Object.assign(MenuReportIssueImpl, {
  docxSlot: 'help.reportIssue',
});

/**
 * Help.
 *
 * The registry leaves this menu EMPTY on purpose — a product's documentation and support
 * channel are the host's, not the library's. The one row the library can honestly own is
 * a report for this project's own tracker, so the packaged Help menu supplies it here
 * rather than in the shared registry, where a Vue or vanilla host would inherit a link it
 * never asked for. Replace the whole menu by name to say something else.
 *
 * With no children and `reportIssue` unset the menu carries that one row; with
 * `reportIssue={false}` it carries nothing, and Help is dropped rather than left as a
 * trigger that opens an empty panel.
 */
function MenuHelpImpl({ children, ...rest }: Omit<MenuProps, 'id'>) {
  const { reportIssue } = useMenuContext();
  if (children === undefined && reportIssue === false) return null;
  // The packaged row is passed as a CHILD rather than as a fallback, so the ordinary merge
  // rules reach it: a host adds rows beside it, and `<Menu.ReportIssue hidden/>` removes
  // just that row without taking the menu with it.
  return (
    <Menu id="help" {...rest}>
      <MenuReportIssue />
      {children}
    </Menu>
  );
}

export const MenuHelp: MenuPartComponent = Object.assign(MenuHelpImpl, {
  docxMenu: 'help' as ChromeMenuId,
});
