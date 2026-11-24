/**
 * TableCellFillPicker - Wrapper around ColorPicker for table cell fill/shading.
 *
 * Translates ColorPicker's output to the TableAction format
 * expected by the toolbar's table action handler.
 */

import { useCallback } from 'react';
import type { ColorValue, Theme } from '@docx-editor.dev/core/contracts/editor';
import type { TableAction } from './TableToolbar';
import { ColorPicker } from './ColorPicker';
import { useTranslation } from '../../i18n';

export interface TableCellFillPickerProps {
  onAction: (action: TableAction) => void;
  disabled?: boolean;
  theme?: Theme | null;
  /** Current fill color (RGB hex without #) */
  value?: string;
}

export function TableCellFillPicker({
  onAction,
  disabled = false,
  theme,
  value,
}: TableCellFillPickerProps) {
  const { t } = useTranslation();
  const handleChange = useCallback(
    (color: ColorValue | string) => {
      // highlight mode emits hex strings or 'none'
      if (typeof color === 'string') {
        if (color === 'none') {
          onAction({ type: 'cellFillColor', color: null });
        } else {
          onAction({ type: 'cellFillColor', color: color.replace(/^#/, '') });
        }
      }
    },
    [onAction]
  );

  return (
    <div data-testid="toolbar-table-cell-fill" style={{ display: 'inline-block' }}>
      <ColorPicker
        mode="highlight"
        value={value}
        onChange={handleChange}
        theme={theme}
        disabled={disabled}
        title={t('table.cellFillColor')}
        icon="format_color_fill"
        autoLabel={t('colorPicker.noColor')}
      />
    </div>
  );
}

export default TableCellFillPicker;
