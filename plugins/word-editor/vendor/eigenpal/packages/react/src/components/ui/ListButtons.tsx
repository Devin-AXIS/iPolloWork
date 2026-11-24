import type { ReactNode } from 'react';
/**
 * List Buttons Component
 *
 * A component for list formatting controls in the DOCX editor:
 * - Bullet list button
 * - Numbered list button
 * - Toggles list on/off for selection
 * - Indent/outdent for list levels
 */

import React, { useState, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { MaterialSymbol } from './MaterialSymbol';
import { useTranslation } from '../../i18n';

// ============================================================================
// TYPES
// ============================================================================

// List-state types live in the shared lib; re-exported here for backwards compat.
export type { ListType, ListState } from '../../lib/listState';
import type { ListState } from '../../lib/listState';

/**
 * Props for the ListButtons component
 */
export interface ListButtonsProps {
  /** Current list state of the selection */
  listState?: ListState;
  /** Callback when bullet list is toggled */
  onBulletList?: () => void;
  /** Callback when numbered list is toggled */
  onNumberedList?: () => void;
  /** Callback to increase list indent */
  onIndent?: () => void;
  /** Callback to decrease list indent */
  onOutdent?: () => void;
  /** Whether the buttons are disabled */
  disabled?: boolean;
  /** Additional CSS class name */
  className?: string;
  /** Additional inline styles */
  style?: CSSProperties;
  /** Show indent/outdent buttons */
  showIndentButtons?: boolean;
  /** Compact mode (smaller buttons) */
  compact?: boolean;
  /** Whether the current paragraph has left indentation (for enabling outdent) */
  hasIndent?: boolean;
}

/**
 * Props for individual list button
 */
export interface ListButtonProps {
  /** Whether the button is active/selected */
  active?: boolean;
  /** Whether the button is disabled */
  disabled?: boolean;
  /** Button title/tooltip */
  title?: string;
  /** Click handler */
  onClick?: () => void;
  /** Button content */
  children: ReactNode;
  /** Additional CSS class name */
  className?: string;
  /** Additional inline styles */
  style?: CSSProperties;
}

// ============================================================================
// STYLES
// ============================================================================

const CONTAINER_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
};

const BUTTON_GROUP_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
};

const BUTTON_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '32px',
  height: '32px',
  padding: '4px',
  border: 'none',
  borderRadius: '4px',
  backgroundColor: 'transparent',
  cursor: 'pointer',
  transition: 'background-color 0.1s',
  color: 'var(--doc-text-muted)',
};

const BUTTON_HOVER_STYLE: CSSProperties = {
  ...BUTTON_STYLE,
  backgroundColor: 'var(--doc-bg-hover)',
};

const BUTTON_ACTIVE_STYLE: CSSProperties = {
  ...BUTTON_STYLE,
  backgroundColor: 'var(--doc-primary-light)',
  color: 'var(--doc-primary)',
};

const BUTTON_DISABLED_STYLE: CSSProperties = {
  ...BUTTON_STYLE,
  cursor: 'default',
  opacity: 0.38,
};

const COMPACT_BUTTON_STYLE: CSSProperties = {
  width: '28px',
  height: '28px',
  padding: '2px',
};

const SEPARATOR_STYLE: CSSProperties = {
  width: '1px',
  height: '20px',
  backgroundColor: 'var(--doc-border)',
  margin: '0 6px',
};

// ============================================================================
// ICON SIZE CONSTANT
// ============================================================================

const ICON_SIZE = 20;

// ============================================================================
// LIST BUTTON COMPONENT
// ============================================================================

/**
 * Individual list button
 */
export function ListButton({
  active = false,
  disabled = false,
  title,
  onClick,
  children,
  className,
  style,
}: ListButtonProps) {
  const [isHovered, setIsHovered] = useState(false);

  const buttonStyle: CSSProperties = {
    ...(disabled
      ? BUTTON_DISABLED_STYLE
      : active
        ? BUTTON_ACTIVE_STYLE
        : isHovered
          ? BUTTON_HOVER_STYLE
          : BUTTON_STYLE),
    ...style,
  };

  // Prevent mousedown from stealing focus/selection from the editor
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
  };

  return (
    <button
      type="button"
      className={`docx-list-button ${active ? 'docx-list-button-active' : ''} ${
        disabled ? 'docx-list-button-disabled' : ''
      } ${className || ''}`}
      style={buttonStyle}
      onMouseDown={handleMouseDown}
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      // Native disabled buttons suppress mousedown, defeating the focus-preserving
      // handler above and dropping the editor caret. Preserve disabled semantics
      // with ARIA while keeping pointer cancellation observable.
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : undefined}
      title={title}
      aria-label={title}
      aria-pressed={active}
      role="button"
    >
      {children}
    </button>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

/**
 * List buttons component for bullet/numbered list controls
 */
export function ListButtons({
  listState,
  onBulletList,
  onNumberedList,
  onIndent,
  onOutdent,
  disabled = false,
  className,
  style,
  showIndentButtons = true,
  compact = false,
  hasIndent = false,
}: ListButtonsProps) {
  const { t } = useTranslation();
  /**
   * Get button style with compact option
   */
  const getButtonStyle = useCallback(
    (): CSSProperties => (compact ? { ...COMPACT_BUTTON_STYLE } : {}),
    [compact]
  );

  const isBulletList = listState?.type === 'bullet';
  const isNumberedList = listState?.type === 'numbered';
  const isInList = listState?.isInList || isBulletList || isNumberedList;
  // Can outdent if: in a list with level > 0, OR has paragraph indentation
  const canOutdent = (isInList && (listState?.level ?? 0) > 0) || hasIndent;

  return (
    <div
      className={`docx-list-buttons ${className || ''}`}
      style={{ ...CONTAINER_STYLE, ...style }}
      role="group"
      aria-label={t('lists.ariaLabel')}
    >
      {/* List type buttons */}
      <div style={BUTTON_GROUP_STYLE} role="group" aria-label={t('lists.typeAriaLabel')}>
        <ListButton
          active={isBulletList}
          disabled={disabled}
          title={t('lists.bulletList')}
          onClick={onBulletList}
          style={getButtonStyle()}
        >
          <MaterialSymbol name="format_list_bulleted" size={ICON_SIZE} />
        </ListButton>

        <ListButton
          active={isNumberedList}
          disabled={disabled}
          title={t('lists.numberedList')}
          onClick={onNumberedList}
          style={getButtonStyle()}
        >
          <MaterialSymbol name="format_list_numbered" size={ICON_SIZE} />
        </ListButton>
      </div>

      {/* Indent/Outdent buttons */}
      {showIndentButtons && (
        <>
          <div style={SEPARATOR_STYLE} role="separator" />
          <div style={BUTTON_GROUP_STYLE} role="group" aria-label={t('lists.indentationAriaLabel')}>
            <ListButton
              active={false}
              disabled={disabled || !canOutdent}
              title={t('lists.decreaseIndent')}
              onClick={onOutdent}
              style={getButtonStyle()}
            >
              <MaterialSymbol name="format_indent_decrease" size={ICON_SIZE} />
            </ListButton>

            <ListButton
              active={false}
              disabled={disabled}
              title={t('lists.increaseIndent')}
              onClick={onIndent}
              style={getButtonStyle()}
            >
              <MaterialSymbol name="format_indent_increase" size={ICON_SIZE} />
            </ListButton>
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

// Pure list-state helpers live in the shared lib; re-exported here so the
// existing import surface keeps working.
export {
  createDefaultListState,
  createBulletListState,
  createNumberedListState,
  isBulletListState,
  isNumberedListState,
  isAnyListState,
  getNextIndentLevel,
  getPreviousIndentLevel,
  toggleListType,
} from '../../lib/listState';

/**
 * Get CSS for list indent
 */
export function getListIndentCss(level: number): CSSProperties {
  const baseIndent = 36; // ~0.5 inch per level
  return {
    marginLeft: `${baseIndent * (level + 1)}px`,
    textIndent: `-${baseIndent * 0.5}px`,
  };
}

/**
 * Get default bullet character for a level
 */
export function getDefaultBulletForLevel(level: number): string {
  const bullets = ['•', '○', '▪', '•', '○', '▪', '•', '○', '▪'];
  return bullets[level % bullets.length];
}

/**
 * The number formats the default list presets cycle through (OOXML
 * `w:numFmt` values). Presentation-only vocabulary for this control.
 */
export type ListNumberFormat = 'decimal' | 'lowerLetter' | 'lowerRoman';

/**
 * Get default number format for a level
 */
export function getDefaultNumberFormatForLevel(level: number): ListNumberFormat {
  const formats: ListNumberFormat[] = [
    'decimal',
    'lowerLetter',
    'lowerRoman',
    'decimal',
    'lowerLetter',
    'lowerRoman',
    'decimal',
    'lowerLetter',
    'lowerRoman',
  ];
  return formats[level % formats.length];
}

/**
 * Handle keyboard shortcut for list operations
 * Returns the action to perform, or undefined if no match
 */
export function handleListShortcut(
  event: KeyboardEvent | React.KeyboardEvent
): 'bullet' | 'numbered' | 'indent' | 'outdent' | undefined {
  // Tab for indent, Shift+Tab for outdent
  if (event.key === 'Tab') {
    if (event.shiftKey) {
      return 'outdent';
    }
    return 'indent';
  }

  // Check for Ctrl/Cmd shortcuts (not commonly used for lists, but some editors support them)
  if (event.ctrlKey || event.metaKey) {
    if (event.shiftKey && event.key.toLowerCase() === 'l') {
      return 'bullet';
    }
    // Note: Ctrl+Shift+L is often bullet in Word-like editors
  }

  return undefined;
}

// ============================================================================
// EXPORTS
// ============================================================================

export default ListButtons;
