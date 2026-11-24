/**
 * Line Spacing Picker Component (Radix UI)
 *
 * A dropdown selector for choosing line spacing values using Radix Select.
 * Styled like Google Docs with options: Single, 1.15, 1.5, Double
 */

import * as React from 'react';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
} from './Select';
import { cn } from '../../lib/utils';
import { IconLineSpacing } from './Icons';
import { useTranslation } from '../../i18n';
import type { TranslationKey } from '../../i18n';

// ============================================================================
// TYPES
// ============================================================================

export interface LineSpacingOption {
  label: string;
  labelKey?: TranslationKey;
  value: number;
  twipsValue: number;
}

export interface LineSpacingPickerProps {
  value?: number;
  onChange?: (twipsValue: number) => void;
  options?: LineSpacingOption[];
  disabled?: boolean;
  className?: string;
  width?: number | string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Standard line spacing options (Google Docs style)
 * OOXML uses twips for line spacing when lineRule="auto"
 * 240 twips = 1.0 line spacing (single)
 */
const DEFAULT_OPTIONS: LineSpacingOption[] = [
  { label: 'Single', labelKey: 'lineSpacing.single', value: 1.0, twipsValue: 240 },
  { label: '1.15', value: 1.15, twipsValue: 276 },
  { label: '1.5', value: 1.5, twipsValue: 360 },
  { label: 'Double', labelKey: 'lineSpacing.double', value: 2.0, twipsValue: 480 },
];

// ============================================================================
// COMPONENT
// ============================================================================

export function LineSpacingPicker({
  value,
  onChange,
  options = DEFAULT_OPTIONS,
  disabled = false,
  className,
}: LineSpacingPickerProps) {
  const { t } = useTranslation();
  // Find current option by twips value
  const currentOption = React.useMemo(() => {
    if (value === undefined) return options[0]; // Default to Single
    return options.find((opt) => opt.twipsValue === value) || options[0];
  }, [value, options]);

  const handleValueChange = React.useCallback(
    (newValue: string) => {
      const twips = parseInt(newValue, 10);
      if (!isNaN(twips)) {
        onChange?.(twips);
      }
    },
    [onChange]
  );

  const getOptionLabel = (option: LineSpacingOption) =>
    option.labelKey ? t(option.labelKey) : option.label;

  return (
    <Select
      value={currentOption.twipsValue.toString()}
      onValueChange={handleValueChange}
      disabled={disabled}
    >
      <SelectTrigger
        className={cn('h-8 text-sm gap-0.5 px-2', className)}
        style={{ width: 'auto' }}
        aria-label={t('lineSpacing.label')}
        title={t('lineSpacing.lineSpacingTitle', { label: getOptionLabel(currentOption) })}
      >
        <IconLineSpacing className="h-5 w-5 shrink-0" />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.twipsValue} value={option.twipsValue.toString()}>
            {getOptionLabel(option)}
          </SelectItem>
        ))}
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>{t('lineSpacing.blockSpacingRules')}</SelectLabel>
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

export function getDefaultLineSpacingOptions(): LineSpacingOption[] {
  return [...DEFAULT_OPTIONS];
}

export function lineSpacingMultiplierToTwips(multiplier: number): number {
  return Math.round(multiplier * 240);
}

export function twipsToLineSpacingMultiplier(twips: number): number {
  return twips / 240;
}

export function getLineSpacingLabel(twips: number): string {
  const option = DEFAULT_OPTIONS.find((opt) => opt.twipsValue === twips);
  if (option) return option.label;
  const multiplier = twipsToLineSpacingMultiplier(twips);
  return multiplier.toFixed(2).replace(/\.?0+$/, '');
}

export function isStandardLineSpacing(twips: number): boolean {
  return DEFAULT_OPTIONS.some((opt) => opt.twipsValue === twips);
}

export function nearestStandardLineSpacing(twips: number): LineSpacingOption {
  let nearest = DEFAULT_OPTIONS[0];
  let minDiff = Math.abs(twips - nearest.twipsValue);

  for (const option of DEFAULT_OPTIONS) {
    const diff = Math.abs(twips - option.twipsValue);
    if (diff < minDiff) {
      minDiff = diff;
      nearest = option;
    }
  }

  return nearest;
}

export function createLineSpacingOption(multiplier: number): LineSpacingOption {
  const twipsValue = lineSpacingMultiplierToTwips(multiplier);
  const label = multiplier.toFixed(2).replace(/\.?0+$/, '');
  return { label, value: multiplier, twipsValue };
}

export default LineSpacingPicker;
