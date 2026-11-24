import { useCallback } from 'react';
import type { ChromeSlotId } from '@docx-editor.dev/core/editor';
import { TableSizeGrid } from '../toolbar/TableSizeGrid';
import { useMenuContext, useMenuLabel } from './menu-context';

/** Props for `DocxEditor.Menu.TableGrid`. @public */
export interface MenuTableGridProps {
  /** The slot the picked size dispatches through. Defaults to `table.insert`. */
  slot?: ChromeSlotId;
  className?: string;
}

/**
 * The insert-table size picker: a 6×6 grid that highlights as the pointer sweeps it and
 * reads back the size underneath. A pick inserts the table and closes the menu bar.
 *
 * Rendered only when the engine will honour an insert (see `MenuTablePicker`). A panel
 * that opens onto a grid nothing can be picked from is worse than no panel: the row
 * cannot act, so it should not disclose — it should look disabled, like every other row
 * the engine refuses.
 *
 * @public
 */
export function MenuTableGrid({ slot = 'table.insert', className }: MenuTableGridProps) {
  const { setOpenMenu } = useMenuContext();
  const label = useMenuLabel();
  const close = useCallback(() => setOpenMenu(null), [setOpenMenu]);
  return (
    <TableSizeGrid
      slot={slot}
      label={label('toolbar.insertTable')}
      onInserted={close}
      className={className}
    />
  );
}
