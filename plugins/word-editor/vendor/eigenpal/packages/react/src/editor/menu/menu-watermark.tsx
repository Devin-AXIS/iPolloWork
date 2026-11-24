// Insert › Watermark. Kept in its own file, so the menu parts file stays under its line cap.

import { chromeProbeForSlot } from '@docx-editor.dev/core/editor';
import { useEditorCommand } from '../useEditorCommand';
import { chromeControlForSlot, chromeIcon } from '../toolbar/ToolbarButton';
import { useMenuContext, useMenuLabel } from './menu-context';
import { MenuRow, type MenuActionProps } from './parts';

/**
 * The Watermark dialog, from the Insert menu.
 *
 * Same shape as page setup: no fixed command to dispatch, so the row asks through the
 * slot's probe and is disabled with the engine's own words on a document it cannot rewrite.
 */
function MenuWatermarkImpl({ className, hidden }: MenuActionProps) {
  const { isEnabled: engineOk, disabledReason: engineReason } = useEditorCommand(
    chromeProbeForSlot('insert.watermark')!
  );
  const context = useMenuContext();
  const label = useMenuLabel();
  if (hidden) return null;
  const control = chromeControlForSlot('insert.watermark');
  const text = label(control?.labelKey ?? 'toolbar.watermark');
  const enabled = engineOk && !!context.onWatermarkDialog;
  return (
    <MenuRow
      slot="insert.watermark"
      icon={chromeIcon(control?.paths)}
      disabled={!enabled}
      {...(engineReason ? { title: engineReason } : {})}
      onSelect={() => {
        context.onWatermarkDialog?.();
        context.setOpenMenu(null);
      }}
      {...(className ? { className } : {})}
    >
      {text}
    </MenuRow>
  );
}

/** Insert › Watermark, so a host can hide it or place it elsewhere by name. @public */
export const MenuWatermark = Object.assign(MenuWatermarkImpl, {
  docxSlot: 'insert.watermark' as const,
});
