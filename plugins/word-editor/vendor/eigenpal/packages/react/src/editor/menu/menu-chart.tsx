// The Insert > Chart row: a submenu of chart types when the engine can insert a chart, a plain
// disabled row with the engine's reason when it cannot. A pick inserts the chart, closes the
// menu bar, and asks the host to show the Chart pane without the focus.

import type { ReactElement } from 'react';
import {
  CHART_INSERT_CHOICES,
  chartTypeIconPaths,
  chartTypeLabelKey,
  type ChromeMenuItemEntry,
} from '@docx-editor.dev/core/editor';
import { useEditorValueCommand } from '../useEditorValueCommand';
import { chromeControlForSlot, chromeIcon } from '../toolbar/ToolbarButton';
import { useMenuContext, useMenuLabel } from './menu-context';
import { MenuItem, MenuRow, MenuSubmenu } from './parts';

/** The Insert > Chart row of the menu bar. */
export function MenuChartPicker({ entry }: { entry: ChromeMenuItemEntry }): ReactElement {
  const { execute, isEnabled } = useEditorValueCommand('insert.chart');
  const { setOpenMenu } = useMenuContext();
  const label = useMenuLabel();
  const control = chromeControlForSlot(entry.slot);
  if (!isEnabled)
    return (
      <MenuItem slotId={entry.slot} {...(entry.labelKey ? { labelKey: entry.labelKey } : {})} />
    );
  return (
    <MenuSubmenu
      labelKey={entry.labelKey ?? control?.labelKey ?? entry.slot}
      paths={control?.paths}
    >
      {CHART_INSERT_CHOICES.map((type) => (
        <MenuRow
          key={type}
          slot={entry.slot}
          data-value={type}
          icon={chromeIcon(chartTypeIconPaths(type))}
          onSelect={() => {
            execute(type);
            setOpenMenu(null);
          }}
        >
          {label(chartTypeLabelKey(type))}
        </MenuRow>
      ))}
    </MenuSubmenu>
  );
}
