/**
 * Shared icon-grid dropdown used by image toolbar controls.
 *
 * Renders a trigger button (icon + chevron) that opens a floating
 * row of icon buttons. Handles click-outside, Escape, focus-stealing
 * prevention, and optional active-state highlighting.
 */

import { useState, useCallback } from 'react';
import { MaterialSymbol } from './MaterialSymbol';
import { Button } from './Button';
import { Tooltip } from './Tooltip';
import { cn } from '../../lib/utils';
import { useFixedDropdown } from '../../hooks/useFixedDropdown';

const ICON_SIZE = 20;

export interface IconGridOption<T extends string = string> {
  value: T;
  label: string;
  iconName: string;
}

export interface IconGridDropdownProps<T extends string = string> {
  /** Options to display in the grid */
  options: IconGridOption<T>[];
  /** Currently active value (highlighted in the grid), or null */
  activeValue?: T | null;
  /** Icon shown on the trigger button */
  triggerIcon: string;
  /** Tooltip text when closed */
  tooltipContent: string;
  /** Fired when an option is clicked */
  onSelect: (value: T) => void;
  disabled?: boolean;
  /** aria-label for the trigger button */
  ariaLabel?: string;
  /** data-testid for the trigger button */
  testId?: string;
  /**
   * Render the dropdown as a vertical list of `[icon] [label]` rows instead of
   * a horizontal icon-only grid. Useful when label text is needed for clarity
   * (e.g. image wrap modes where the icons are visually similar).
   */
  showLabels?: boolean;
}

export function IconGridDropdown<T extends string = string>({
  options,
  activeValue,
  triggerIcon,
  tooltipContent,
  onSelect,
  disabled = false,
  ariaLabel,
  testId,
  showLabels = false,
}: IconGridDropdownProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const onClose = useCallback(() => setIsOpen(false), []);
  const { containerRef, dropdownRef, dropdownStyle, handleMouseDown } = useFixedDropdown({
    isOpen,
    onClose,
  });

  const handleOptionClick = useCallback(
    (value: T) => {
      if (!disabled) onSelect(value);
      setIsOpen(false);
    },
    [disabled, onSelect]
  );

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
      aria-label={ariaLabel ?? tooltipContent}
      aria-expanded={isOpen}
      aria-haspopup="true"
      data-testid={testId}
    >
      <MaterialSymbol name={triggerIcon} size={ICON_SIZE} />
      <MaterialSymbol name="arrow_drop_down" size={14} className="-ml-1" />
    </Button>
  );

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      {!isOpen ? <Tooltip content={tooltipContent}>{triggerButton}</Tooltip> : triggerButton}

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
              display: 'flex',
              flexDirection: showLabels ? 'column' : 'row',
              gap: showLabels ? 1 : 2,
              minWidth: showLabels ? 200 : undefined,
            }}
          >
            {options.map((option) => {
              const isActive = activeValue === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  title={option.label}
                  data-testid={testId ? `${testId}-${option.value}` : undefined}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    height: 32,
                    border: '1px solid transparent',
                    borderRadius: 4,
                    backgroundColor: isActive ? 'var(--doc-primary-light)' : 'transparent',
                    cursor: 'pointer',
                    color: isActive ? 'var(--doc-primary)' : 'var(--doc-text)',
                    // Per-mode geometry: label rows fill the menu width with the
                    // icon flush-left; icon-only stays a 32×32 square.
                    ...(showLabels
                      ? {
                          width: '100%',
                          gap: 10,
                          padding: '0 10px',
                          justifyContent: 'flex-start',
                          fontSize: 13,
                          textAlign: 'left' as const,
                        }
                      : { width: 32, justifyContent: 'center' }),
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
                  {showLabels && <span style={{ flex: 1 }}>{option.label}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
