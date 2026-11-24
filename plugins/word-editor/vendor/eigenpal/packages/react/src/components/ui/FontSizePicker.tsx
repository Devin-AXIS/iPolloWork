/**
 * Font Size Picker Component (Google Docs Style)
 *
 * A font size control with minus/plus buttons and editable input.
 * Features:
 * - Minus button to decrease font size
 * - Plus button to increase font size
 * - Editable input for custom sizes
 * - Click input to show dropdown with preset sizes
 */

import * as React from 'react';
import { useState, useCallback, useRef } from 'react';
import { Button } from './Button';
import { MaterialSymbol } from './MaterialSymbol';
import { cn } from '../../lib/utils';
import { useFixedDropdown } from '../../hooks/useFixedDropdown';
import { useTranslation } from '../../i18n';
import { hostWindowOf } from '@docx-editor.dev/core/editor';

// ============================================================================
// TYPES
// ============================================================================

export interface FontSizePickerProps {
  value?: number;
  onChange?: (size: number) => void;
  sizes?: number[];
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  width?: number | string;
  minSize?: number;
  maxSize?: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_SIZES: number[] = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];
const DEFAULT_MIN_SIZE = 1;
const DEFAULT_MAX_SIZE = 400;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

// Re-export the adapter's half-point conversions so the React FontSizePicker
// keeps its existing import surface.
export { halfPointsToPoints, pointsToHalfPoints } from '../../lib/units';

/**
 * Find the next size in the preset list (going up)
 */
function getNextSize(currentSize: number, sizes: number[], maxSize: number): number {
  for (const size of sizes) {
    if (size > currentSize) {
      return size;
    }
  }
  // If current size is beyond preset list, increment by 1
  return Math.min(currentSize + 1, maxSize);
}

/**
 * Find the previous size in the preset list (going down)
 */
function getPrevSize(currentSize: number, sizes: number[], minSize: number): number {
  for (let i = sizes.length - 1; i >= 0; i--) {
    if (sizes[i] < currentSize) {
      return sizes[i];
    }
  }
  // If current size is below preset list, decrement by 1
  return Math.max(currentSize - 1, minSize);
}

// ============================================================================
// COMPONENT
// ============================================================================

export function FontSizePicker({
  value,
  onChange,
  sizes = DEFAULT_SIZES,
  disabled = false,
  className,
  placeholder = '11',
  minSize = DEFAULT_MIN_SIZE,
  maxSize = DEFAULT_MAX_SIZE,
}: FontSizePickerProps) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const onCloseDropdown = useCallback(() => {
    setIsDropdownOpen(false);
    setIsEditing(false);
  }, []);
  const {
    containerRef,
    dropdownRef,
    dropdownStyle: fixedDropdownStyle,
  } = useFixedDropdown({
    isOpen: isDropdownOpen,
    onClose: onCloseDropdown,
  });

  const currentValue = value ?? (parseInt(placeholder, 10) || 11);
  const displayValue = value !== undefined ? value.toString() : placeholder;

  // Handle decrease font size
  const handleDecrease = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (disabled) return;
      const newSize = getPrevSize(currentValue, sizes, minSize);
      onChange?.(newSize);
    },
    [currentValue, sizes, minSize, disabled, onChange]
  );

  // Handle increase font size
  const handleIncrease = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (disabled) return;
      const newSize = getNextSize(currentValue, sizes, maxSize);
      onChange?.(newSize);
    },
    [currentValue, sizes, maxSize, disabled, onChange]
  );

  // Handle input click - start editing
  const handleInputClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (disabled) return;
      setIsEditing(true);
      setInputValue(displayValue);
      setIsDropdownOpen(true);
      // Focus input after state update
      hostWindowOf(inputRef.current).requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    },
    [disabled, displayValue]
  );

  // Handle input change
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  }, []);

  // Handle input blur - commit change
  const handleInputBlur = useCallback(() => {
    setIsEditing(false);
    const size = parseFloat(inputValue);
    if (!isNaN(size) && size >= minSize && size <= maxSize) {
      // Round to nearest 0.5 to match Word's font size granularity
      const rounded = Math.round(size * 2) / 2;
      onChange?.(rounded);
    }
  }, [inputValue, minSize, maxSize, onChange]);

  // Handle input keydown
  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleInputBlur();
        setIsDropdownOpen(false);
      } else if (e.key === 'Escape') {
        setIsEditing(false);
        setIsDropdownOpen(false);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const newSize = getNextSize(currentValue, sizes, maxSize);
        setInputValue(newSize.toString());
        onChange?.(newSize);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const newSize = getPrevSize(currentValue, sizes, minSize);
        setInputValue(newSize.toString());
        onChange?.(newSize);
      }
    },
    [handleInputBlur, currentValue, sizes, maxSize, minSize, onChange]
  );

  // Handle dropdown item click
  const handleSizeSelect = useCallback(
    (size: number) => {
      onChange?.(size);
      setIsDropdownOpen(false);
      setIsEditing(false);
    },
    [onChange]
  );

  // Prevent mousedown from stealing focus
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Allow input to receive focus
    if ((e.target as HTMLElement).tagName !== 'INPUT') {
      e.preventDefault();
    }
  }, []);

  return (
    <div
      ref={containerRef}
      className={cn('flex items-center', className)}
      onMouseDown={handleMouseDown}
    >
      {/* Decrease button */}
      <Button
        variant="ghost"
        size="icon-sm"
        className={cn(
          'h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-muted/80 rounded-r-none',
          disabled && 'opacity-30 cursor-not-allowed'
        )}
        onMouseDown={handleDecrease}
        disabled={disabled || currentValue <= minSize}
        aria-label={t('fontSize.decrease')}
        data-testid="font-size-decrease"
      >
        <MaterialSymbol name="remove" size={18} />
      </Button>

      {/* Font size input/display */}
      <div className="relative">
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            onBlur={handleInputBlur}
            onKeyDown={handleInputKeyDown}
            className={cn(
              'h-7 w-10 text-center text-sm border border-input bg-doc-bg-input text-doc-text',
              'focus:outline-none focus:ring-1 focus:ring-ring',
              'rounded-none'
            )}
            aria-label={t('fontSize.label')}
            data-testid="font-size-input"
          />
        ) : (
          <button
            type="button"
            onClick={handleInputClick}
            className={cn(
              'h-7 w-10 text-center text-sm border border-border bg-doc-bg-input text-doc-text',
              'hover:border-input hover:bg-doc-bg-hover',
              'focus:outline-none focus:ring-1 focus:ring-ring',
              'rounded-none',
              disabled && 'opacity-50 cursor-not-allowed'
            )}
            disabled={disabled}
            aria-label={t('fontSize.label')}
            aria-haspopup="listbox"
            aria-expanded={isDropdownOpen}
            data-testid="font-size-display"
          >
            {displayValue}
          </button>
        )}
      </div>

      {/* Dropdown */}
      {isDropdownOpen && (
        <div
          ref={dropdownRef}
          style={{
            ...fixedDropdownStyle,
            backgroundColor: 'var(--doc-surface)',
            border: '1px solid var(--doc-border)',
            borderRadius: 6,
            boxShadow: '0 4px 12px var(--doc-shadow)',
            maxHeight: 240,
            overflowY: 'auto',
            minWidth: 60,
          }}
          role="listbox"
          aria-label={t('fontSize.listLabel')}
        >
          {sizes.map((size) => (
            <button
              key={size}
              type="button"
              onClick={() => handleSizeSelect(size)}
              className={cn(
                'w-full px-3 py-1.5 text-sm text-left',
                'hover:bg-muted',
                size === currentValue && 'bg-muted font-medium'
              )}
              role="option"
              aria-selected={size === currentValue}
            >
              {size}
            </button>
          ))}
        </div>
      )}

      {/* Increase button */}
      <Button
        variant="ghost"
        size="icon-sm"
        className={cn(
          'h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-muted/80 rounded-l-none',
          disabled && 'opacity-30 cursor-not-allowed'
        )}
        onMouseDown={handleIncrease}
        disabled={disabled || currentValue >= maxSize}
        aria-label={t('fontSize.increase')}
        data-testid="font-size-increase"
      >
        <MaterialSymbol name="add" size={18} />
      </Button>
    </div>
  );
}
