/**
 * TableMoreDropdown - Compact dropdown for less-used table actions
 *
 * Contains: delete row/column/table, vertical alignment, header row,
 * distribute columns, auto-fit, table alignment, cell margins,
 * text direction, no-wrap, row height, table properties.
 */

import { useState, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { Button } from './Button';
import { Tooltip } from './Tooltip';
import { MaterialSymbol } from './MaterialSymbol';
import { cn } from '../../lib/utils';
import type { TableAction } from './TableToolbar';
import { useFixedDropdown } from '../../hooks/useFixedDropdown';
import { useTranslation } from '../../i18n';

export interface TableMoreDropdownProps {
  onAction: (action: TableAction) => void;
  disabled?: boolean;
  tableContext?: {
    isInTable: boolean;
    rowCount?: number;
    columnCount?: number;
    canSplitCell?: boolean;
    hasMultiCellSelection?: boolean;
    table?: { attrs?: { justification?: string } };
  } | null;
}

const menuItemStyles: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '7px 14px',
  fontSize: 13,
  color: 'var(--doc-text)',
  cursor: 'pointer',
  border: 'none',
  backgroundColor: 'transparent',
  width: '100%',
  textAlign: 'left',
};

const separatorStyles: CSSProperties = {
  height: 1,
  backgroundColor: 'var(--doc-border)',
  margin: '4px 0',
};

const sectionLabelStyles: CSSProperties = {
  padding: '6px 14px 2px',
  fontSize: 11,
  color: 'var(--doc-text-muted)',
  fontWeight: 500,
};

export function TableMoreDropdown({
  onAction,
  disabled = false,
  tableContext,
}: TableMoreDropdownProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const close = useCallback(() => setIsOpen(false), []);
  const { containerRef, dropdownRef, dropdownStyle, handleMouseDown } = useFixedDropdown({
    isOpen,
    onClose: close,
    align: 'right',
  });
  const currentJustification =
    (tableContext?.table?.attrs?.justification as 'left' | 'center' | 'right' | null | undefined) ??
    'left';

  const handleAction = useCallback(
    (action: TableAction) => {
      onAction(action);
      setIsOpen(false);
    },
    [onAction]
  );

  const menuItem = (
    id: string,
    icon: string,
    label: string,
    action: TableAction,
    opts?: { danger?: boolean; itemDisabled?: boolean }
  ) => {
    const isItemDisabled = disabled || opts?.itemDisabled;
    return (
      <button
        key={id}
        type="button"
        role="menuitem"
        style={{
          ...menuItemStyles,
          backgroundColor:
            hoveredItem === id && !isItemDisabled ? 'var(--doc-bg-hover)' : 'transparent',
          color: isItemDisabled
            ? 'var(--doc-text-muted)'
            : opts?.danger
              ? 'var(--doc-error)'
              : 'var(--doc-text)',
          cursor: isItemDisabled ? 'not-allowed' : 'pointer',
        }}
        onClick={() => !isItemDisabled && handleAction(action)}
        onMouseEnter={() => setHoveredItem(id)}
        onMouseLeave={() => setHoveredItem(null)}
        disabled={isItemDisabled}
      >
        <MaterialSymbol
          name={icon}
          size={16}
          className={opts?.danger && !isItemDisabled ? 'text-destructive' : ''}
        />
        <span style={{ flex: 1 }}>{label}</span>
      </button>
    );
  };

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
      aria-label={t('table.moreOptions')}
      aria-expanded={isOpen}
      aria-haspopup="menu"
      data-testid="toolbar-table-more"
    >
      <MaterialSymbol name="more_vert" size={20} />
    </Button>
  );

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      {!isOpen ? <Tooltip content={t('table.moreOptions')}>{button}</Tooltip> : button}

      {isOpen && !disabled && (
        <div
          ref={dropdownRef}
          style={{
            ...dropdownStyle,
            backgroundColor: 'var(--doc-surface)',
            border: '1px solid var(--doc-border)',
            borderRadius: 8,
            boxShadow: '0 4px 16px var(--doc-shadow)',
            padding: '4px 0',
            minWidth: 200,
            maxHeight: '70vh',
            overflowY: 'auto',
          }}
          role="menu"
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* Insert actions */}
          {menuItem('addRowAbove', 'add', t('table.insertRowAbove'), 'addRowAbove')}
          {menuItem('addRowBelow', 'add', t('table.insertRowBelow'), 'addRowBelow')}
          {menuItem('addColumnLeft', 'add', t('table.insertColumnLeft'), 'addColumnLeft')}
          {menuItem('addColumnRight', 'add', t('table.insertColumnRight'), 'addColumnRight')}

          <div style={separatorStyles} role="separator" />

          {/* Merge/Split */}
          {menuItem('mergeCells', 'call_merge', t('table.mergeCells'), 'mergeCells', {
            itemDisabled: !tableContext?.hasMultiCellSelection,
          })}
          {menuItem('splitCell', 'call_split', t('table.splitCell'), 'splitCell', {
            itemDisabled: !tableContext?.canSplitCell,
          })}

          <div style={separatorStyles} role="separator" />

          {/* Select */}
          {menuItem('selectTable', 'select_all', t('table.selectTable'), 'selectTable')}

          <div style={separatorStyles} role="separator" />

          {/* Delete actions */}
          {menuItem('deleteRow', 'delete', t('table.deleteRow'), 'deleteRow', {
            danger: true,
            itemDisabled: (tableContext?.rowCount ?? 0) <= 1,
          })}
          {menuItem('deleteColumn', 'delete', t('table.deleteColumn'), 'deleteColumn', {
            danger: true,
            itemDisabled: (tableContext?.columnCount ?? 0) <= 1,
          })}
          {menuItem('deleteTable', 'delete', t('table.deleteTable'), 'deleteTable', {
            danger: true,
          })}

          <div style={separatorStyles} role="separator" />

          {/* Vertical alignment */}
          <div style={sectionLabelStyles}>{t('tableAdvanced.verticalAlignment')}</div>
          <div style={{ display: 'flex', gap: 4, padding: '4px 14px' }}>
            {(['top', 'center', 'bottom'] as const).map((align) => {
              const icons = {
                top: 'vertical_align_top',
                center: 'vertical_align_center',
                bottom: 'vertical_align_bottom',
              };
              const labelKeys = {
                top: 'tableAdvanced.top' as const,
                center: 'tableAdvanced.middle' as const,
                bottom: 'tableAdvanced.bottom' as const,
              };
              return (
                <button
                  key={align}
                  type="button"
                  title={t(labelKeys[align])}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 32,
                    height: 28,
                    border: '1px solid var(--doc-border)',
                    borderRadius: 4,
                    backgroundColor: 'transparent',
                    cursor: 'pointer',
                  }}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                      'var(--doc-bg-hover)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
                  }}
                  onClick={() => handleAction({ type: 'cellVerticalAlign', align })}
                >
                  <MaterialSymbol name={icons[align]} size={16} />
                </button>
              );
            })}
          </div>

          <div style={separatorStyles} role="separator" />

          {/* Table alignment */}
          <div style={sectionLabelStyles}>{t('tableAdvanced.tableAlignment')}</div>
          <div style={{ display: 'flex', gap: 4, padding: '4px 14px' }}>
            {(['left', 'center', 'right'] as const).map((align) => {
              const icons = {
                left: 'format_align_left',
                center: 'format_align_center',
                right: 'format_align_right',
              };
              const isActive = currentJustification === align;
              return (
                <button
                  key={align}
                  type="button"
                  title={t(
                    {
                      left: 'tableAdvanced.alignTableLeft' as const,
                      center: 'tableAdvanced.alignTableCenter' as const,
                      right: 'tableAdvanced.alignTableRight' as const,
                    }[align]
                  )}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 32,
                    height: 28,
                    border: '1px solid var(--doc-border)',
                    borderRadius: 4,
                    backgroundColor: isActive ? 'var(--doc-primary-light)' : 'transparent',
                    borderColor: isActive ? 'var(--doc-primary)' : 'var(--doc-border)',
                    color: isActive ? 'var(--doc-primary)' : 'var(--doc-text)',
                    cursor: 'pointer',
                  }}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() =>
                    handleAction({ type: 'tableProperties', props: { justification: align } })
                  }
                >
                  <MaterialSymbol name={icons[align]} size={16} />
                </button>
              );
            })}
          </div>

          <div style={separatorStyles} role="separator" />

          {/* Other options */}
          {menuItem('headerRow', 'table_rows', t('tableAdvanced.toggleHeaderRow'), {
            type: 'toggleHeaderRow',
          })}
          {menuItem('distribute', 'view_column', t('tableAdvanced.distributeColumns'), {
            type: 'distributeColumns',
          })}
          {menuItem('autoFit', 'fit_width', t('tableAdvanced.autoFit'), {
            type: 'autoFitContents',
          })}
          {menuItem('noWrap', 'wrap_text', t('tableAdvanced.toggleNoWrap'), {
            type: 'toggleNoWrap',
          })}

          <div style={separatorStyles} role="separator" />

          {menuItem('properties', 'settings', t('tableAdvanced.tableProperties'), {
            type: 'openTableProperties',
          })}
        </div>
      )}
    </div>
  );
}

export default TableMoreDropdown;
