// Toolbar parts for the `contentControl.*` chrome slots.
//
// Show-all and form-fill are surface toggles: enabled state comes from
// `useEditorCommand` / `toolbarCommandState`; pressed state and the click go through
// `useContentControl` so direct `setShowAll` / `setFormFill` and the toolbar stay aligned.
// They are shaped (not bare `ToolbarButton`) so `aria-pressed` reflects the mode —
// `ToolbarButton` only wires pressed-ness for marks and alignment.
//
// Inspector is adapter-shaped: `runToolbarCommand` only validates a control is at the
// caret; this part opens the shared inspector panel (same pattern as `text.link`).
//
// Remove is a live `ToolbarButton` — can-before-exec and the engine's reason are enough.

import type { ChromeSlotId } from '@docx-editor.dev/core/editor';
import { useEditorCommand } from '../useEditorCommand';
import { useContentControl, CONTENT_CONTROL_SLOTS } from '../useContentControl';
import { useToolbarLabel } from './toolbar-context';
import { Slot } from './Slot';
import { chromeControlForSlot, chromeIcon, guardToolbarMousedown } from './ToolbarButton';
import type { ToolbarPartComponent, ToolbarPartProps } from './parts';

function asSlot(id: string): ChromeSlotId {
  return id as ChromeSlotId;
}

function defineTogglePart(slotId: string, mode: 'showAll' | 'formFill'): ToolbarPartComponent {
  const slot = asSlot(slotId);
  const Part = ({ className, hidden, icon, asChild, children }: ToolbarPartProps) => {
    // Enabled state stays on the command table; pressed state comes from the shared hook so
    // `useContentControl().setShowAll` and the toolbar button cannot drift.
    const { isEnabled, disabledReason } = useEditorCommand(slot);
    const chrome = useContentControl();
    const pressed = mode === 'showAll' ? chrome.showAll : chrome.formFill;
    const label = useToolbarLabel();
    if (hidden) return null;
    const control = chromeControlForSlot(slot);
    const text = label(control?.labelKey ?? slotId);
    const shared = {
      type: 'button' as const,
      className: `docx-toolbar__button${className ? ` ${className}` : ''}`,
      'data-slot': slotId,
      disabled: !isEnabled,
      ...(!isEnabled ? { 'data-disabled': '' } : {}),
      ...(pressed ? { 'data-active': '' } : {}),
      'aria-pressed': pressed,
      'aria-label': text,
      title: disabledReason ?? text,
      onMouseDown: guardToolbarMousedown,
      onClick: () => {
        if (mode === 'showAll') chrome.toggleShowAll();
        else chrome.toggleFormFill();
      },
    };
    if (asChild) return <Slot {...shared}>{children}</Slot>;
    return <button {...shared}>{icon ?? children ?? chromeIcon(control?.paths)}</button>;
  };
  return Object.assign(Part, { docxSlot: slot });
}

function ToolbarContentControlInspectorImpl({
  className,
  hidden,
  icon,
  asChild,
  children,
}: ToolbarPartProps) {
  const slot = asSlot(CONTENT_CONTROL_SLOTS.inspector);
  const { isEnabled, disabledReason } = useEditorCommand(slot);
  const { inspectorOpen, openInspector } = useContentControl();
  const label = useToolbarLabel();
  if (hidden) return null;
  const registry = chromeControlForSlot(slot);
  const text = label(registry?.labelKey ?? 'contentControl.inspector');
  const shared = {
    type: 'button' as const,
    className: `docx-toolbar__button${className ? ` ${className}` : ''}`,
    'data-slot': CONTENT_CONTROL_SLOTS.inspector,
    disabled: !isEnabled,
    ...(!isEnabled ? { 'data-disabled': '' } : {}),
    ...(inspectorOpen ? { 'data-active': '' } : {}),
    'aria-pressed': inspectorOpen,
    'aria-label': text,
    title: disabledReason ?? text,
    onMouseDown: guardToolbarMousedown,
    onClick: () => openInspector(),
  };
  if (asChild) return <Slot {...shared}>{children}</Slot>;
  return <button {...shared}>{icon ?? children ?? chromeIcon(registry?.paths)}</button>;
}

function ToolbarContentControlRemoveImpl({
  className,
  hidden,
  icon,
  asChild,
  children,
}: ToolbarPartProps) {
  const { canRemove, removeDisabledReason, remove } = useContentControl();
  const label = useToolbarLabel();
  if (hidden) return null;
  const slot = asSlot(CONTENT_CONTROL_SLOTS.remove);
  const registry = chromeControlForSlot(slot);
  const text = label(registry?.labelKey ?? 'contentControl.remove');
  const shared = {
    type: 'button' as const,
    className: `docx-toolbar__button${className ? ` ${className}` : ''}`,
    'data-slot': CONTENT_CONTROL_SLOTS.remove,
    disabled: !canRemove,
    ...(!canRemove ? { 'data-disabled': '' } : {}),
    'aria-label': text,
    title: removeDisabledReason ?? text,
    onMouseDown: guardToolbarMousedown,
    onClick: () => {
      remove();
    },
  };
  if (asChild) return <Slot {...shared}>{children}</Slot>;
  return <button {...shared}>{icon ?? children ?? chromeIcon(registry?.paths)}</button>;
}

export const ToolbarContentControlShowAll = defineTogglePart(
  CONTENT_CONTROL_SLOTS.showAll,
  'showAll'
);
export const ToolbarContentControlFormFill = defineTogglePart(
  CONTENT_CONTROL_SLOTS.formFill,
  'formFill'
);
export const ToolbarContentControlRemove: ToolbarPartComponent = Object.assign(
  ToolbarContentControlRemoveImpl,
  { docxSlot: asSlot(CONTENT_CONTROL_SLOTS.remove) }
);
export const ToolbarContentControlInspector: ToolbarPartComponent = Object.assign(
  ToolbarContentControlInspectorImpl,
  { docxSlot: asSlot(CONTENT_CONTROL_SLOTS.inspector) }
);

export const CONTENT_CONTROL_SHAPED_PARTS: Partial<
  Record<
    ChromeSlotId,
    (props: { hidden?: boolean }) => ReturnType<typeof ToolbarContentControlInspectorImpl>
  >
> = {
  [asSlot(CONTENT_CONTROL_SLOTS.showAll)]: ToolbarContentControlShowAll,
  [asSlot(CONTENT_CONTROL_SLOTS.formFill)]: ToolbarContentControlFormFill,
  [asSlot(CONTENT_CONTROL_SLOTS.inspector)]: ToolbarContentControlInspector,
  [asSlot(CONTENT_CONTROL_SLOTS.remove)]: ToolbarContentControlRemove,
};
