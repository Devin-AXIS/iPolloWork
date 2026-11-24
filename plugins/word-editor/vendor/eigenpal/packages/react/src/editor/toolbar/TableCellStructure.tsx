// Merge Cells and Split Cells in the contextual table chrome.
//
// Merge is an ordinary slot button: its command needs no arguments. Split needs counts, so
// its button opens the Split cells dialog; its enabled state is the slot's probe, which asks
// the engine whether the cell at the selection splits at all.

import { useEditorCommand } from '../useEditorCommand';
import { useDialogHost } from '../dialog-host';
import { useToolbarLabel } from './toolbar-context';
import {
  ToolbarButton,
  chromeControlForSlot,
  chromeIcon,
  guardToolbarMousedown,
} from './ToolbarButton';
import type { ToolbarPartComponent, ToolbarPartProps } from './parts';

/** Merge the selected cells. @public */
export const ToolbarTableMergeCells: ToolbarPartComponent = Object.assign(
  (props: ToolbarPartProps) => <ToolbarButton slotId="table.mergeCells" {...props} />,
  { docxSlot: 'table.mergeCells' as const }
);

function SplitCellButton({ icon, className, children, hidden }: ToolbarPartProps) {
  const { isEnabled, disabledReason } = useEditorCommand('table.splitCell');
  const dialogs = useDialogHost();
  const label = useToolbarLabel();
  // Without a dialog host there is nothing to open, and an enabled button would do nothing.
  if (hidden || !dialogs) return null;
  const text = label(chromeControlForSlot('table.splitCell')?.labelKey ?? 'table.splitCell');
  return (
    <button
      type="button"
      data-slot="table.splitCell"
      className={`docx-toolbar__button${className ? ` ${className}` : ''}`}
      disabled={!isEnabled}
      {...(!isEnabled ? { 'data-disabled': '' } : {})}
      aria-label={text}
      aria-haspopup="dialog"
      title={disabledReason ?? text}
      onMouseDown={guardToolbarMousedown}
      onClick={(event) => dialogs.open('splitCell', event.currentTarget)}
    >
      {icon ?? children ?? chromeIcon(chromeControlForSlot('table.splitCell')?.paths)}
    </button>
  );
}

/** Open the Split cells dialog for the cell at the selection. @public */
export const ToolbarTableSplitCell: ToolbarPartComponent = Object.assign(SplitCellButton, {
  docxSlot: 'table.splitCell' as const,
});
