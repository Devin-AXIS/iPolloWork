// The merged alignment control: ONE dropdown for the four alignment slots.
//
// The chrome spec renders alignment as a single button — the CURRENT alignment's
// icon plus a caret — opening a panel with the four options in a row. The four
// `alignment.*` slots and their commands are
// untouched: this part only merges their default RENDERING. Each option runs its
// slot's command through the shared can-before-exec gate (`useEditorCommand`), and
// the current alignment comes from the engine's own `isActive` answer — never a
// locally tracked guess.

import { useRef, useState } from 'react';
import { type ChromeSlotId } from '@docx-editor.dev/core/editor';
import { useEditorCommand, type EditorCommandState } from '../useEditorCommand';
import { useToolbarLabel } from './toolbar-context';
import { chromeControlForSlot, chromeIcon, guardToolbarMousedown } from './ToolbarButton';
import type { ToolbarSlotPartProps } from './parts';
import { useDropdownClose } from './useDropdownClose';

const ALIGNMENT_SLOTS = [
  'alignment.left',
  'alignment.center',
  'alignment.right',
  'alignment.justify',
] as const satisfies readonly ChromeSlotId[];

/** The merged part is keyed by its GROUP id — it stands in for all four slots. */
export interface ToolbarAlignmentComponent {
  (props: ToolbarSlotPartProps): ReturnType<typeof ToolbarAlignmentImpl>;
  readonly docxSlot: 'alignment';
}

function ToolbarAlignmentImpl({ className, hidden }: ToolbarSlotPartProps) {
  // Fixed-length hook calls: the slot list is a module constant, so order is stable.
  const left = useEditorCommand('alignment.left');
  const center = useEditorCommand('alignment.center');
  const right = useEditorCommand('alignment.right');
  const justify = useEditorCommand('alignment.justify');
  const label = useToolbarLabel();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useDropdownClose(open, setOpen, rootRef, hidden);

  if (hidden) return null;

  const states: readonly EditorCommandState[] = [left, center, right, justify];
  const options = ALIGNMENT_SLOTS.map((slot, index) => ({
    slot,
    control: chromeControlForSlot(slot),
    state: states[index]!,
  }));
  // The trigger shows the CURRENT alignment's icon (engine `isActive`), left default.
  const current = options.find((option) => option.state.isActive) ?? options[0]!;
  const enabled = options.some((option) => option.state.isEnabled);
  const currentText = label(current.control?.labelKey ?? current.slot);

  return (
    <div
      ref={rootRef}
      className={`docx-toolbar__alignment${className ? ` ${className}` : ''}`}
      data-slot="alignment"
    >
      <button
        type="button"
        className="docx-toolbar__button docx-toolbar__alignment-trigger"
        disabled={!enabled}
        {...(!enabled ? { 'data-disabled': '' } : {})}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={currentText}
        title={enabled ? currentText : (current.state.disabledReason ?? currentText)}
        onMouseDown={guardToolbarMousedown}
        onClick={() => setOpen((value) => !value)}
      >
        {chromeIcon(current.control?.paths)}
        <span className="docx-toolbar__picker-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        // The panel: the four options side by side, active one highlighted.
        <div className="docx-toolbar__menu docx-toolbar__alignment-popup">
          {options.map((option) => {
            const text = label(option.control?.labelKey ?? option.slot);
            return (
              <button
                key={option.slot}
                type="button"
                className="docx-toolbar__button docx-toolbar__alignment-option"
                data-slot={option.slot}
                disabled={!option.state.isEnabled}
                {...(option.state.isActive ? { 'data-active': '' } : {})}
                aria-pressed={option.state.isActive}
                aria-label={text}
                title={option.state.disabledReason ?? text}
                onMouseDown={guardToolbarMousedown}
                onClick={() => {
                  option.state.execute();
                  setOpen(false);
                }}
              >
                {chromeIcon(option.control?.paths)}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The alignment dropdown (`DocxEditorToolbar.Alignment`): the four wired
 * `alignment.*` commands behind one merged dropdown trigger. The individual
 * `AlignLeft` / `AlignCenter` / `AlignRight` / `AlignJustify` parts remain
 * available for hosts that want four separate buttons.
 *
 * @public
 */
export const ToolbarAlignment: ToolbarAlignmentComponent = Object.assign(ToolbarAlignmentImpl, {
  docxSlot: 'alignment' as const,
});
