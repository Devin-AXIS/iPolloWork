/**
 * Zoom Control Component
 *
 * A − / + stepper around a Radix Select: the buttons step through the zoom
 * levels and the middle % opens a dropdown for a direct pick. Matches the Vue
 * toolbar's zoom stepper and the font-size stepper.
 */

import * as React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './Select';
import { Button } from './Button';
import { MaterialSymbol } from './MaterialSymbol';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../i18n';

// ============================================================================
// TYPES
// ============================================================================

export interface ZoomLevel {
  value: number;
  label: string;
}

export interface ZoomControlProps {
  value?: number;
  onChange?: (zoom: number) => void;
  levels?: ZoomLevel[];
  disabled?: boolean;
  className?: string;
  compact?: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_ZOOM_LEVELS: ZoomLevel[] = [
  { value: 0.5, label: '50%' },
  { value: 0.75, label: '75%' },
  { value: 1.0, label: '100%' },
  { value: 1.25, label: '125%' },
  { value: 1.5, label: '150%' },
  { value: 2.0, label: '200%' },
];

// ============================================================================
// COMPONENT
// ============================================================================

export function ZoomControl({
  value = 1.0,
  onChange,
  levels = DEFAULT_ZOOM_LEVELS,
  disabled = false,
  className,
  compact = false,
}: ZoomControlProps) {
  const { t } = useTranslation();
  const displayLabel = React.useMemo(() => {
    const matchingLevel = levels.find((level) => Math.abs(level.value - value) < 0.001);
    if (matchingLevel) return matchingLevel.label;
    return `${Math.round(value * 100)}%`;
  }, [levels, value]);

  const handleValueChange = React.useCallback(
    (newValue: string) => {
      const zoom = parseFloat(newValue);
      if (!isNaN(zoom)) {
        onChange?.(zoom);
      }
    },
    [onChange]
  );

  // Stepper logic: − / + walk the sorted zoom levels (matches the Vue toolbar
  // and the font-size stepper). The middle % stays a dropdown for direct picks.
  const sorted = React.useMemo(() => [...levels].sort((a, b) => a.value - b.value), [levels]);
  const prevLevel = React.useMemo(
    () => [...sorted].reverse().find((l) => l.value < value - 0.001),
    [sorted, value]
  );
  const nextLevel = React.useMemo(
    () => sorted.find((l) => l.value > value + 0.001),
    [sorted, value]
  );
  const btnCls = compact ? 'h-7 w-7' : 'h-8 w-8';

  return (
    <div className="flex items-center">
      <Button
        variant="ghost"
        size="icon-sm"
        className={cn(
          btnCls,
          'text-muted-foreground hover:text-foreground hover:bg-muted/80 rounded-r-none',
          (disabled || !prevLevel) && 'opacity-30 cursor-not-allowed'
        )}
        onClick={() => prevLevel && onChange?.(prevLevel.value)}
        disabled={disabled || !prevLevel}
        aria-label={t('zoom.zoomOut')}
      >
        <MaterialSymbol name="remove" size={18} />
      </Button>
      <Select value={value.toString()} onValueChange={handleValueChange} disabled={disabled}>
        <SelectTrigger
          className={cn(
            compact ? 'h-7 min-w-[55px] text-xs' : 'h-8 min-w-[64px] text-sm',
            'rounded-none',
            className
          )}
          aria-label={t('zoom.ariaLabel', { label: displayLabel })}
        >
          <SelectValue placeholder="100%">{displayLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {levels.map((level) => (
            <SelectItem key={level.value} value={level.value.toString()}>
              {level.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant="ghost"
        size="icon-sm"
        className={cn(
          btnCls,
          'text-muted-foreground hover:text-foreground hover:bg-muted/80 rounded-l-none',
          (disabled || !nextLevel) && 'opacity-30 cursor-not-allowed'
        )}
        onClick={() => nextLevel && onChange?.(nextLevel.value)}
        disabled={disabled || !nextLevel}
        aria-label={t('zoom.zoomIn')}
      >
        <MaterialSymbol name="add" size={18} />
      </Button>
    </div>
  );
}

// Re-export types for compatibility
export type { ZoomControlProps as ZoomControlPropsType };
