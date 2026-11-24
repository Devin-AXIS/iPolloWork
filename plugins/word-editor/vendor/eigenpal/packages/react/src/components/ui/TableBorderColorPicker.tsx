/**
 * TableBorderColorPicker - Wrapper around ColorPicker for table border colors.
 *
 * Translates ColorPicker's ColorValue output to the TableAction format
 * expected by the toolbar's table action handler.
 */

import { useCallback } from 'react';
import type { ColorValue, Theme } from '@docx-editor.dev/core/contracts/editor';
import type { TableAction } from './TableToolbar';
import { ColorPicker } from './ColorPicker';
import { resolveColorToHex } from '../../lib/colorResolver';
import { useTranslation } from '../../i18n';

export interface TableBorderColorPickerProps {
  onAction: (action: TableAction) => void;
  disabled?: boolean;
  theme?: Theme | null;
  /** Current border color (RGB hex without #) */
  value?: string;
}

export function TableBorderColorPicker({
  onAction,
  disabled = false,
  theme,
  value,
}: TableBorderColorPickerProps) {
  const { t } = useTranslation();
  const handleChange = useCallback(
    (color: ColorValue | string) => {
      if (typeof color === 'string') {
        onAction({ type: 'borderColor', color: color.replace(/^#/, '') });
        return;
      }
      // `auto` means the default border color; hex/theme values resolve to
      // the concrete hex the action vocabulary carries.
      const hex = color.kind === 'auto' ? '000000' : resolveColorToHex(color, theme);
      if (hex) onAction({ type: 'borderColor', color: hex });
    },
    [onAction, theme]
  );

  return (
    <ColorPicker
      mode="border"
      value={value}
      onChange={handleChange}
      theme={theme}
      disabled={disabled}
      title={t('table.borderColor')}
    />
  );
}

export default TableBorderColorPicker;
