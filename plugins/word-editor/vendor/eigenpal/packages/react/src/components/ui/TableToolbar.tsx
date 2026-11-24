import type { DocxEditorChildren } from '../../docx-editor-children';
import type { ReactNode } from 'react';
/**
 * TableToolbar Component
 *
 * Provides controls for editing tables:
 * - Add row above/below
 * - Add column left/right
 * - Delete row/column
 * - Merge cells
 * - Split cell
 *
 * Shows when cursor is in a table.
 */

import React from 'react';
import type { CSSProperties } from 'react';
import { MaterialSymbol } from './MaterialSymbol';
import { useTranslation } from '../../i18n';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Table editing action types
 */
export type TableAction =
  | 'addRowAbove'
  | 'addRowBelow'
  | 'addColumnLeft'
  | 'addColumnRight'
  | 'deleteRow'
  | 'deleteColumn'
  | 'mergeCells'
  | 'splitCell'
  | 'deleteTable'
  | 'selectTable'
  | 'selectRow'
  | 'selectColumn'
  | 'borderAll'
  | 'borderOutside'
  | 'borderInside'
  | 'borderNone'
  | 'borderTop'
  | 'borderBottom'
  | 'borderLeft'
  | 'borderRight'
  | { type: 'cellFillColor'; color: string | null }
  | { type: 'borderColor'; color: string }
  | { type: 'borderWidth'; size: number }
  | {
      type: 'cellBorder';
      side: 'top' | 'bottom' | 'left' | 'right' | 'all';
      style: string;
      size: number;
      color: string;
    }
  | { type: 'cellVerticalAlign'; align: 'top' | 'center' | 'bottom' }
  | {
      type: 'cellMargins';
      margins: { top?: number; bottom?: number; left?: number; right?: number };
    }
  | { type: 'cellTextDirection'; direction: string | null }
  | { type: 'toggleNoWrap' }
  | { type: 'rowHeight'; height: number | null; rule?: 'auto' | 'atLeast' | 'exact' }
  | { type: 'toggleHeaderRow' }
  | { type: 'distributeColumns' }
  | { type: 'autoFitContents' }
  | {
      type: 'tableProperties';
      props: {
        width?: number | null;
        widthType?: string | null;
        justification?: 'left' | 'center' | 'right' | null;
      };
    }
  | { type: 'openTableProperties' }
  | { type: 'applyTableStyle'; styleId: string };

/**
 * Border style preset
 */
export type BorderPreset =
  'all' | 'outside' | 'inside' | 'none' | 'top' | 'bottom' | 'left' | 'right';

/**
 * Selection within a table
 */
export interface TableSelection {
  /** Index of the table in the document */
  tableIndex: number;
  /** Row index (0-indexed) */
  rowIndex: number;
  /** Column index (0-indexed) */
  columnIndex: number;
  /** Selected cell range for multi-cell selection */
  selectedCells?: {
    startRow: number;
    startCol: number;
    endRow: number;
    endCol: number;
  };
}

/**
 * Context for table operations. Derivable from the engine's selected-table
 * summary (`Editor.getSelectedTable()`); structure edits themselves go through
 * `Editor.exec` table commands, so no table content model appears here.
 */
export interface TableContext {
  /** Current selection within the table */
  selection: TableSelection;
  /** Whether multiple cells are selected (for merge) */
  hasMultiCellSelection: boolean;
  /** Whether current cell can be split */
  canSplitCell: boolean;
  /** Total number of rows */
  rowCount: number;
  /** Total number of columns */
  columnCount: number;
}

/**
 * Props for TableToolbar component
 */
export interface TableToolbarProps {
  /** Current table context (null if cursor not in table) */
  context: TableContext | null;
  /** Callback when a table action is triggered */
  onAction?: (action: TableAction, context: TableContext) => void;
  /** Whether the toolbar is disabled */
  disabled?: boolean;
  /** Additional CSS class name */
  className?: string;
  /** Additional inline styles */
  style?: CSSProperties;
  /** Show labels next to icons */
  showLabels?: boolean;
  /** Compact mode */
  compact?: boolean;
  /** Position of the toolbar */
  position?: 'top' | 'floating';
  /** Custom render for additional buttons */
  children?: DocxEditorChildren;
}

/**
 * Props for individual table toolbar button
 */
export interface TableToolbarButtonProps {
  /** Action to trigger */
  action: TableAction;
  /** Button label */
  label: string;
  /** Button icon */
  icon: ReactNode;
  /** Button is disabled */
  disabled?: boolean;
  /** Click handler */
  onClick?: () => void;
  /** Show label */
  showLabel?: boolean;
  /** Compact mode */
  compact?: boolean;
  /** Keyboard shortcut hint */
  shortcut?: string;
}

// ============================================================================
// ICONS - Using Material Symbols
// ============================================================================

const ICON_SIZE = 16;

export function AddRowAboveIcon(): React.ReactElement {
  return <MaterialSymbol name="table_rows" size={ICON_SIZE} style={{ transform: 'scaleY(-1)' }} />;
}

export function AddRowBelowIcon(): React.ReactElement {
  return <MaterialSymbol name="table_rows" size={ICON_SIZE} />;
}

export function AddColumnLeftIcon(): React.ReactElement {
  return <MaterialSymbol name="view_column" size={ICON_SIZE} style={{ transform: 'scaleX(-1)' }} />;
}

export function AddColumnRightIcon(): React.ReactElement {
  return <MaterialSymbol name="view_column" size={ICON_SIZE} />;
}

export function DeleteRowIcon(): React.ReactElement {
  return <MaterialSymbol name="delete_sweep" size={ICON_SIZE} />;
}

export function DeleteColumnIcon(): React.ReactElement {
  return (
    <MaterialSymbol name="delete_sweep" size={ICON_SIZE} style={{ transform: 'rotate(90deg)' }} />
  );
}

export function MergeCellsIcon(): React.ReactElement {
  return <MaterialSymbol name="call_merge" size={ICON_SIZE} />;
}

export function SplitCellIcon(): React.ReactElement {
  return <MaterialSymbol name="call_split" size={ICON_SIZE} />;
}

export function DeleteTableIcon(): React.ReactElement {
  return <MaterialSymbol name="delete" size={ICON_SIZE} className="text-destructive" />;
}

export function SelectTableIcon(): React.ReactElement {
  return <MaterialSymbol name="select_all" size={ICON_SIZE} />;
}

// ============================================================================
// STYLES
// ============================================================================

const TOOLBAR_STYLES: Record<string, CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '4px 8px',
    backgroundColor: 'var(--doc-bg-subtle)',
    borderRadius: '4px',
    border: '1px solid var(--doc-border)',
    fontSize: '12px',
  },
  containerCompact: {
    padding: '2px 4px',
    gap: '2px',
  },
  containerFloating: {
    position: 'absolute',
    zIndex: 1000,
    boxShadow: '0 2px 8px var(--doc-shadow)',
  },
  group: {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
  },
  separator: {
    width: '1px',
    height: '20px',
    backgroundColor: 'var(--doc-border-dark)',
    margin: '0 4px',
  },
  button: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '4px',
    padding: '4px 8px',
    border: 'none',
    borderRadius: '3px',
    backgroundColor: 'transparent',
    color: 'var(--doc-text)',
    cursor: 'pointer',
    fontSize: '12px',
    lineHeight: '1',
    transition: 'background-color 0.15s, color 0.15s',
  },
  buttonCompact: {
    padding: '3px 5px',
  },
  buttonHover: {
    backgroundColor: 'var(--doc-border)',
  },
  buttonDisabled: {
    color: 'var(--doc-text-subtle)',
    cursor: 'not-allowed',
  },
  buttonDelete: {
    color: 'var(--doc-error)',
  },
  label: {
    fontSize: '11px',
    fontWeight: 500,
    color: 'var(--doc-text-muted)',
    marginRight: '8px',
    whiteSpace: 'nowrap',
  },
  hidden: {
    display: 'none',
  },
};

// ============================================================================
// COMPONENTS
// ============================================================================

/**
 * Individual toolbar button
 */
export function TableToolbarButton({
  action,
  label,
  icon,
  disabled = false,
  onClick,
  showLabel = false,
  compact = false,
  shortcut,
}: TableToolbarButtonProps): React.ReactElement {
  const [isHovered, setIsHovered] = React.useState(false);

  const isDeleteAction = typeof action === 'string' && action.startsWith('delete');

  const buttonStyle: CSSProperties = {
    ...TOOLBAR_STYLES.button,
    ...(compact ? TOOLBAR_STYLES.buttonCompact : {}),
    ...(isHovered && !disabled ? TOOLBAR_STYLES.buttonHover : {}),
    ...(disabled ? TOOLBAR_STYLES.buttonDisabled : {}),
    ...(isDeleteAction && !disabled ? TOOLBAR_STYLES.buttonDelete : {}),
  };

  const title = shortcut ? `${label} (${shortcut})` : label;

  return (
    <button
      type="button"
      className={`docx-table-toolbar-button docx-table-toolbar-${typeof action === 'string' ? action : action.type}`}
      style={buttonStyle}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      title={title}
      aria-label={label}
    >
      {icon}
      {showLabel && <span>{label}</span>}
    </button>
  );
}

/**
 * Button group with separator
 */
function ToolbarGroup({
  children,
  showSeparator = true,
}: {
  children: ReactNode;
  showSeparator?: boolean;
}): React.ReactElement {
  return (
    <>
      <div style={TOOLBAR_STYLES.group}>{children}</div>
      {showSeparator && <div style={TOOLBAR_STYLES.separator} />}
    </>
  );
}

/**
 * TableToolbar - Shows table manipulation controls when cursor is in a table
 */
export function TableToolbar({
  context,
  onAction,
  disabled = false,
  className,
  style,
  showLabels = false,
  compact = false,
  position = 'top',
  children,
}: TableToolbarProps): React.ReactElement | null {
  const { t } = useTranslation();

  // Don't render if not in a table
  if (!context) {
    return null;
  }

  const handleAction = (action: TableAction) => {
    if (!disabled && onAction && context) {
      onAction(action, context);
    }
  };

  // Check if actions are available
  const canDeleteRow = context.rowCount > 1;
  const canDeleteColumn = context.columnCount > 1;
  const canMerge = context.hasMultiCellSelection;
  const canSplit = context.canSplitCell;

  const containerStyle: CSSProperties = {
    ...TOOLBAR_STYLES.container,
    ...(compact ? TOOLBAR_STYLES.containerCompact : {}),
    ...(position === 'floating' ? TOOLBAR_STYLES.containerFloating : {}),
    ...style,
  };

  const classNames = ['docx-table-toolbar'];
  if (className) {
    classNames.push(className);
  }
  if (compact) {
    classNames.push('docx-table-toolbar-compact');
  }
  if (position === 'floating') {
    classNames.push('docx-table-toolbar-floating');
  }

  return (
    <div
      className={classNames.join(' ')}
      style={containerStyle}
      role="toolbar"
      aria-label={t('table.editingTools')}
    >
      <span style={TOOLBAR_STYLES.label}>{t('table.label')}</span>

      {/* Row operations */}
      <ToolbarGroup>
        <TableToolbarButton
          action="addRowAbove"
          label={t('table.insertRowAbove')}
          icon={<AddRowAboveIcon />}
          disabled={disabled}
          onClick={() => handleAction('addRowAbove')}
          showLabel={showLabels}
          compact={compact}
        />
        <TableToolbarButton
          action="addRowBelow"
          label={t('table.insertRowBelow')}
          icon={<AddRowBelowIcon />}
          disabled={disabled}
          onClick={() => handleAction('addRowBelow')}
          showLabel={showLabels}
          compact={compact}
        />
        <TableToolbarButton
          action="deleteRow"
          label={t('table.deleteRow')}
          icon={<DeleteRowIcon />}
          disabled={disabled || !canDeleteRow}
          onClick={() => handleAction('deleteRow')}
          showLabel={showLabels}
          compact={compact}
        />
      </ToolbarGroup>

      {/* Column operations */}
      <ToolbarGroup>
        <TableToolbarButton
          action="addColumnLeft"
          label={t('table.insertColumnLeft')}
          icon={<AddColumnLeftIcon />}
          disabled={disabled}
          onClick={() => handleAction('addColumnLeft')}
          showLabel={showLabels}
          compact={compact}
        />
        <TableToolbarButton
          action="addColumnRight"
          label={t('table.insertColumnRight')}
          icon={<AddColumnRightIcon />}
          disabled={disabled}
          onClick={() => handleAction('addColumnRight')}
          showLabel={showLabels}
          compact={compact}
        />
        <TableToolbarButton
          action="deleteColumn"
          label={t('table.deleteColumn')}
          icon={<DeleteColumnIcon />}
          disabled={disabled || !canDeleteColumn}
          onClick={() => handleAction('deleteColumn')}
          showLabel={showLabels}
          compact={compact}
        />
      </ToolbarGroup>

      {/* Merge/Split operations */}
      <ToolbarGroup showSeparator={false}>
        <TableToolbarButton
          action="mergeCells"
          label={t('table.mergeCells')}
          icon={<MergeCellsIcon />}
          disabled={disabled || !canMerge}
          onClick={() => handleAction('mergeCells')}
          showLabel={showLabels}
          compact={compact}
        />
        <TableToolbarButton
          action="splitCell"
          label={t('table.splitCell')}
          icon={<SplitCellIcon />}
          disabled={disabled || !canSplit}
          onClick={() => handleAction('splitCell')}
          showLabel={showLabels}
          compact={compact}
        />
        <TableToolbarButton
          action="selectTable"
          label={t('table.selectTable')}
          icon={<SelectTableIcon />}
          disabled={disabled}
          onClick={() => handleAction('selectTable')}
          showLabel={showLabels}
          compact={compact}
        />
        <TableToolbarButton
          action="deleteTable"
          label={t('table.deleteTable')}
          icon={<DeleteTableIcon />}
          disabled={disabled}
          onClick={() => handleAction('deleteTable')}
          showLabel={showLabels}
          compact={compact}
        />
      </ToolbarGroup>

      {/* Custom content */}
      {children}
    </div>
  );
}

// ============================================================================
// TABLE SELECTION HELPERS (re-exported from TableToolbar/operations.ts)
// ============================================================================

export {
  isMultiCellSelection,
  getSelectionBounds,
  isCellInSelection,
  getActionLabel,
  isDeleteAction,
  handleTableShortcut,
} from './TableToolbar/operations';

export default TableToolbar;
