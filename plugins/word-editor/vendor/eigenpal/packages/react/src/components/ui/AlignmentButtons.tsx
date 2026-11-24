import type { ReactNode } from 'react';
/**
 * Alignment Dropdown Component (Google Docs style)
 *
 * A single dropdown button for paragraph alignment controls:
 * - Shows current alignment icon + chevron
 * - Opens a floating panel with Left, Center, Right, Justify options
 * - Active option is highlighted
 */

import React, { useState, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { MaterialSymbol } from './MaterialSymbol';
import { Button } from './Button';
import { Tooltip } from './Tooltip';
import { cn } from '../../lib/utils';
import { useFixedDropdown } from '../../hooks/useFixedDropdown';
import { useTranslation } from '../../i18n';
import type { TranslationKey } from '../../i18n';

// ============================================================================
// TYPES
// ============================================================================

/**
 * The paragraph alignments this control understands, in OOXML `w:jc`
 * vocabulary (`both` is Word's justify; `distribute` renders as justify).
 * Presentation-only: the dropdown emits the first four.
 */
export type ParagraphAlignment = 'left' | 'center' | 'right' | 'both' | 'distribute';

/**
 * Alignment option for the buttons
 */
export interface AlignmentOption {
  /** Alignment value */
  value: ParagraphAlignment;
  /** Display label */
  label: string;
  /** Icon to display */
  icon: ReactNode;
  /** Material symbol icon name */
  iconName: string;
  /** Keyboard shortcut hint */
  shortcut?: string;
  /** Translation key for label */
  labelKey: TranslationKey;
  /** Translation key for shortcut */
  shortcutKey?: TranslationKey;
}

/**
 * Props for the AlignmentButtons component
 */
export interface AlignmentButtonsProps {
  /** Current alignment value */
  value?: ParagraphAlignment;
  /** Callback when alignment is changed */
  onChange?: (alignment: ParagraphAlignment) => void;
  /** Whether the buttons are disabled */
  disabled?: boolean;
  /** Additional CSS class name */
  className?: string;
  /** Additional inline styles */
  style?: CSSProperties;
  /** Show labels next to icons */
  showLabels?: boolean;
  /** Compact mode (smaller buttons) */
  compact?: boolean;
}

/**
 * Props for individual alignment button
 */
export interface AlignmentButtonProps {
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
// ICON SIZE CONSTANT
// ============================================================================

const ICON_SIZE = 20;

// ============================================================================
// ALIGNMENT OPTIONS
// ============================================================================

const ALIGNMENT_OPTIONS: AlignmentOption[] = [
  {
    value: 'left',
    label: 'Align Left',
    labelKey: 'alignment.alignLeft',
    shortcutKey: 'alignment.alignLeftShortcut',
    icon: <MaterialSymbol name="format_align_left" size={ICON_SIZE} />,
    iconName: 'format_align_left',
    shortcut: 'Ctrl+L',
  },
  {
    value: 'center',
    label: 'Center',
    labelKey: 'alignment.center',
    shortcutKey: 'alignment.centerShortcut',
    icon: <MaterialSymbol name="format_align_center" size={ICON_SIZE} />,
    iconName: 'format_align_center',
    shortcut: 'Ctrl+E',
  },
  {
    value: 'right',
    label: 'Align Right',
    labelKey: 'alignment.alignRight',
    shortcutKey: 'alignment.alignRightShortcut',
    icon: <MaterialSymbol name="format_align_right" size={ICON_SIZE} />,
    iconName: 'format_align_right',
    shortcut: 'Ctrl+R',
  },
  {
    value: 'both',
    label: 'Justify',
    labelKey: 'alignment.justify',
    shortcutKey: 'alignment.justifyShortcut',
    icon: <MaterialSymbol name="format_align_justify" size={ICON_SIZE} />,
    iconName: 'format_align_justify',
    shortcut: 'Ctrl+J',
  },
];

// ============================================================================
// MAIN COMPONENT
// ============================================================================

/**
 * Alignment dropdown component — single button with popover panel
 */
export function AlignmentButtons({
  value = 'left',
  onChange,
  disabled = false,
}: AlignmentButtonsProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const onClose = useCallback(() => setIsOpen(false), []);
  const { containerRef, dropdownRef, dropdownStyle, handleMouseDown } = useFixedDropdown({
    isOpen,
    onClose,
  });

  const handleOptionClick = useCallback(
    (alignment: ParagraphAlignment) => {
      if (!disabled) {
        onChange?.(alignment);
      }
      setIsOpen(false);
    },
    [disabled, onChange]
  );

  // Find the current alignment option for the trigger icon
  const currentOption =
    ALIGNMENT_OPTIONS.find((opt) => opt.value === value) || ALIGNMENT_OPTIONS[0];

  const currentLabel = t(currentOption.labelKey);
  const currentShortcut = currentOption.shortcutKey ? t(currentOption.shortcutKey) : undefined;
  const ariaText = `${currentLabel}${currentShortcut ? ` (${currentShortcut})` : ''}`;

  const triggerButton = (
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
      aria-label={ariaText}
      aria-expanded={isOpen}
      aria-haspopup="true"
      data-testid="toolbar-alignment"
    >
      <MaterialSymbol name={currentOption.iconName} size={ICON_SIZE} />
      <MaterialSymbol name="arrow_drop_down" size={14} className="-ml-1" />
    </Button>
  );

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      {!isOpen ? <Tooltip content={ariaText}>{triggerButton}</Tooltip> : triggerButton}

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
          <div style={{ display: 'flex', gap: 2 }}>
            {ALIGNMENT_OPTIONS.map((option) => {
              const isActive = value === option.value;
              const optLabel = t(option.labelKey);
              const optShortcut = option.shortcutKey ? t(option.shortcutKey) : undefined;
              return (
                <button
                  key={option.value}
                  type="button"
                  title={`${optLabel}${optShortcut ? ` (${optShortcut})` : ''}`}
                  data-testid={`alignment-${option.value}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 32,
                    height: 32,
                    border: '1px solid transparent',
                    borderRadius: 4,
                    backgroundColor: isActive ? 'var(--doc-primary-light)' : 'transparent',
                    cursor: 'pointer',
                    color: isActive ? 'var(--doc-primary)' : 'var(--doc-text)',
                  }}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                        'var(--doc-bg-hover)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor = isActive
                      ? 'var(--doc-primary-light)'
                      : 'transparent';
                  }}
                  onClick={() => handleOptionClick(option.value)}
                >
                  <MaterialSymbol name={option.iconName} size={18} />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get default alignment options
 */
export function getAlignmentOptions(): AlignmentOption[] {
  return [...ALIGNMENT_OPTIONS];
}

/**
 * Check if an alignment value is valid
 */
export function isValidAlignment(value: string): value is ParagraphAlignment {
  return ['left', 'center', 'right', 'both', 'distribute'].includes(value);
}

/**
 * Get alignment label from value
 */
export function getAlignmentLabel(value: ParagraphAlignment): string {
  const option = ALIGNMENT_OPTIONS.find((opt) => opt.value === value);
  return option?.label || 'Left';
}

/**
 * Get alignment icon from value
 */
export function getAlignmentIcon(value: ParagraphAlignment): ReactNode {
  const option = ALIGNMENT_OPTIONS.find((opt) => opt.value === value);
  return option?.icon || <MaterialSymbol name="format_align_left" size={ICON_SIZE} />;
}

/**
 * Get alignment shortcut from value
 */
export function getAlignmentShortcut(value: ParagraphAlignment): string | undefined {
  const option = ALIGNMENT_OPTIONS.find((opt) => opt.value === value);
  return option?.shortcut;
}

/**
 * Get CSS text-align value from OOXML alignment
 */
export function alignmentToCss(alignment: ParagraphAlignment): string {
  switch (alignment) {
    case 'left':
      return 'left';
    case 'center':
      return 'center';
    case 'right':
      return 'right';
    case 'both':
    case 'distribute':
      return 'justify';
    default:
      return 'left';
  }
}

/**
 * Get OOXML alignment value from CSS text-align
 */
export function cssToAlignment(textAlign: string): ParagraphAlignment {
  switch (textAlign) {
    case 'left':
    case 'start':
      return 'left';
    case 'center':
      return 'center';
    case 'right':
    case 'end':
      return 'right';
    case 'justify':
      return 'both';
    default:
      return 'left';
  }
}

/**
 * Cycle to next alignment (left -> center -> right -> justify -> left)
 */
export function cycleAlignment(current: ParagraphAlignment): ParagraphAlignment {
  const order: ParagraphAlignment[] = ['left', 'center', 'right', 'both'];
  const currentIndex = order.indexOf(current);
  const nextIndex = (currentIndex + 1) % order.length;
  return order[nextIndex];
}

/**
 * Handle keyboard shortcut for alignment
 * Returns the alignment if matched, undefined otherwise
 */
export function handleAlignmentShortcut(
  event: KeyboardEvent | React.KeyboardEvent
): ParagraphAlignment | undefined {
  if (!event.ctrlKey && !event.metaKey) {
    return undefined;
  }

  const key = event.key.toLowerCase();

  switch (key) {
    case 'l':
      return 'left';
    case 'e':
      return 'center';
    case 'r':
      return 'right';
    case 'j':
      return 'both';
    default:
      return undefined;
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default AlignmentButtons;
