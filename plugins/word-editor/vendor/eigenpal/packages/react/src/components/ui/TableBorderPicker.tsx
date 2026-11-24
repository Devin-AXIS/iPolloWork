/**
 * TableBorderPicker - Google Docs-style border preset popover
 *
 * Shows a grid of border preset buttons: All, Outside, Inside,
 * Top, Bottom, Left, Right, and Clear.
 */

import { useState, useCallback } from 'react';
import { Button } from './Button';
import { Tooltip } from './Tooltip';
import { MaterialSymbol } from './MaterialSymbol';
import { cn } from '../../lib/utils';
import type { TableAction } from './TableToolbar';
import { useFixedDropdown } from '../../hooks/useFixedDropdown';
import { useTranslation } from '../../i18n';
import type { TranslationKey } from '../../i18n';

export interface TableBorderPickerProps {
  onAction: (action: TableAction) => void;
  disabled?: boolean;
}

const BORDER_PRESETS: { action: TableAction; icon: string; labelKey: TranslationKey }[] = [
  { action: 'borderAll', icon: 'border_all', labelKey: 'table.borders.all' },
  { action: 'borderOutside', icon: 'border_outer', labelKey: 'table.borders.outside' },
  { action: 'borderInside', icon: 'border_inner', labelKey: 'table.borders.inside' },
  { action: 'borderTop', icon: 'border_top', labelKey: 'table.borders.top' },
  { action: 'borderBottom', icon: 'border_bottom', labelKey: 'table.borders.bottom' },
  { action: 'borderLeft', icon: 'border_left', labelKey: 'table.borders.left' },
  { action: 'borderRight', icon: 'border_right', labelKey: 'table.borders.right' },
  { action: 'borderNone', icon: 'border_clear', labelKey: 'table.borders.none' },
];

export function TableBorderPicker({ onAction, disabled = false }: TableBorderPickerProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const close = useCallback(() => setIsOpen(false), []);
  const { containerRef, dropdownRef, dropdownStyle, handleMouseDown } = useFixedDropdown({
    isOpen,
    onClose: close,
  });

  const handlePreset = useCallback(
    (action: TableAction) => {
      onAction(action);
      setIsOpen(false);
    },
    [onAction]
  );

  const button = (
    <Button
      variant="ghost"
      size="icon-sm"
      className={cn(
        'text-muted-foreground hover:text-foreground hover:bg-muted/80',
        isOpen && 'bg-muted',
        disabled && 'opacity-30 cursor-not-allowed'
      )}
      onMouseDown={handleMouseDown}
      onClick={() => !disabled && setIsOpen((prev) => !prev)}
      disabled={disabled}
      aria-label={t('table.borders.styleAriaLabel')}
      aria-expanded={isOpen}
      aria-haspopup="true"
      data-testid="toolbar-table-borders"
    >
      <MaterialSymbol name="border_all" size={20} />
      <MaterialSymbol name="arrow_drop_down" size={14} className="-ml-1" />
    </Button>
  );

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      {!isOpen ? <Tooltip content={t('table.borders.tooltip')}>{button}</Tooltip> : button}

      {isOpen && !disabled && (
        <div
          ref={dropdownRef}
          style={{
            ...dropdownStyle,
            backgroundColor: 'var(--doc-surface)',
            border: '1px solid var(--doc-border)',
            borderRadius: 8,
            boxShadow: '0 4px 16px var(--doc-shadow)',
            padding: 6,
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 2,
            }}
          >
            {BORDER_PRESETS.map(({ action, icon, labelKey }) => (
              <button
                key={typeof action === 'string' ? action : action.type}
                type="button"
                title={t(labelKey)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 32,
                  height: 32,
                  border: '1px solid transparent',
                  borderRadius: 4,
                  backgroundColor: 'transparent',
                  cursor: 'pointer',
                  color: 'var(--doc-text)',
                }}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                    'var(--doc-bg-hover)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
                }}
                onClick={() => handlePreset(action)}
              >
                <MaterialSymbol name={icon} size={18} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default TableBorderPicker;
