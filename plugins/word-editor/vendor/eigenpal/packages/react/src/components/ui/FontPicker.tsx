/**
 * Font Picker Component (Radix UI)
 *
 * A dropdown selector for choosing font families using Radix Select.
 */

import * as React from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from './Select';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../i18n';
import { getPrimaryFontFamily } from './fontPickerValue';

// ============================================================================
// TYPES
// ============================================================================

export type { FontOption } from '../../lib/fontOptions';
import type { FontOption } from '../../lib/fontOptions';

export interface FontPickerProps {
  value?: string;
  onChange?: (fontFamily: string) => void;
  fonts?: FontOption[];
  /**
   * Fonts the loaded document references that the browser can render. Shown in
   * a "Document fonts" group above the built-in list, deduped against `fonts`.
   */
  documentFonts?: readonly FontOption[];
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  width?: number | string;
  showPreview?: boolean;
}

// ============================================================================
// DEFAULT FONTS
// ============================================================================

const DEFAULT_FONTS: FontOption[] = [
  // Sans-serif
  { name: 'Arial', fontFamily: 'Arial, Helvetica, sans-serif', category: 'sans-serif' },
  { name: 'Calibri', fontFamily: '"Calibri", Arial, sans-serif', category: 'sans-serif' },
  { name: 'Helvetica', fontFamily: 'Helvetica, Arial, sans-serif', category: 'sans-serif' },
  { name: 'Verdana', fontFamily: 'Verdana, Geneva, sans-serif', category: 'sans-serif' },
  { name: 'Open Sans', fontFamily: '"Open Sans", sans-serif', category: 'sans-serif' },
  { name: 'Roboto', fontFamily: 'Roboto, sans-serif', category: 'sans-serif' },
  // Serif
  { name: 'Times New Roman', fontFamily: '"Times New Roman", Times, serif', category: 'serif' },
  { name: 'Georgia', fontFamily: 'Georgia, serif', category: 'serif' },
  { name: 'Cambria', fontFamily: 'Cambria, Georgia, serif', category: 'serif' },
  { name: 'Garamond', fontFamily: 'Garamond, serif', category: 'serif' },
  // Monospace
  { name: 'Courier New', fontFamily: '"Courier New", Courier, monospace', category: 'monospace' },
  { name: 'Consolas', fontFamily: 'Consolas, monospace', category: 'monospace' },
];

// ============================================================================
// COMPONENT
// ============================================================================

export function FontPicker({
  value,
  onChange,
  fonts = DEFAULT_FONTS,
  documentFonts,
  disabled = false,
  className,
  placeholder = 'Arial',
  width = 120,
  showPreview = true,
}: FontPickerProps) {
  const { t } = useTranslation();

  // Document fonts shown above the built-in list, minus any the built-in list
  // already covers (case-insensitive) so a font never appears twice.
  const docFonts = React.useMemo(() => {
    if (!documentFonts) return [];
    const taken = new Set(fonts.map((f) => f.name.toLowerCase()));
    return documentFonts.filter((f) => !taken.has(f.name.toLowerCase()));
  }, [documentFonts, fonts]);

  // Lookups (display + change) span both the document group and the main list.
  const lookupFonts = React.useMemo(() => [...docFonts, ...fonts], [docFonts, fonts]);

  // Find current font name for display
  const displayValue = React.useMemo(() => {
    if (!value) return placeholder;
    const font = lookupFonts.find(
      (f) =>
        f.fontFamily === value ||
        f.name.toLowerCase() === value.toLowerCase() ||
        getPrimaryFontFamily(f.fontFamily).toLowerCase() === value.toLowerCase()
    );
    return font?.name || value;
  }, [value, lookupFonts, placeholder]);

  const handleValueChange = React.useCallback(
    (newValue: string) => {
      const font = lookupFonts.find((f) => f.name === newValue);
      if (font) {
        onChange?.(getPrimaryFontFamily(font.fontFamily) || font.name);
      }
    },
    [onChange, lookupFonts]
  );

  // Group fonts by category
  const groupedFonts = React.useMemo(() => {
    const groups: Record<string, FontOption[]> = {
      'sans-serif': [],
      serif: [],
      monospace: [],
      other: [],
    };
    fonts.forEach((font) => {
      const category = font.category || 'other';
      groups[category].push(font);
    });
    return groups;
  }, [fonts]);

  return (
    <Select value={displayValue} onValueChange={handleValueChange} disabled={disabled}>
      <SelectTrigger
        className={cn('h-8 text-sm', className)}
        style={{ minWidth: typeof width === 'number' ? `${width}px` : width }}
        aria-label={t('font.selectAriaLabel')}
      >
        <SelectValue placeholder={placeholder}>{displayValue}</SelectValue>
      </SelectTrigger>
      <SelectContent className="max-h-[300px]">
        {docFonts.length > 0 && (
          <>
            <SelectGroup>
              <SelectLabel>{t('font.documentFonts')}</SelectLabel>
              {docFonts.map((font) => (
                <SelectItem
                  key={`doc-${font.name}`}
                  value={font.name}
                  style={showPreview ? { fontFamily: font.fontFamily } : undefined}
                >
                  {font.name}
                </SelectItem>
              ))}
            </SelectGroup>
            <SelectSeparator />
          </>
        )}
        {groupedFonts['sans-serif'].length > 0 && (
          <SelectGroup>
            <SelectLabel>{t('font.sansSerif')}</SelectLabel>
            {groupedFonts['sans-serif'].map((font) => (
              <SelectItem
                key={font.name}
                value={font.name}
                style={showPreview ? { fontFamily: font.fontFamily } : undefined}
              >
                {font.name}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
        {groupedFonts['serif'].length > 0 && (
          <>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>{t('font.serif')}</SelectLabel>
              {groupedFonts['serif'].map((font) => (
                <SelectItem
                  key={font.name}
                  value={font.name}
                  style={showPreview ? { fontFamily: font.fontFamily } : undefined}
                >
                  {font.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </>
        )}
        {groupedFonts['monospace'].length > 0 && (
          <>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>{t('font.monospace')}</SelectLabel>
              {groupedFonts['monospace'].map((font) => (
                <SelectItem
                  key={font.name}
                  value={font.name}
                  style={showPreview ? { fontFamily: font.fontFamily } : undefined}
                >
                  {font.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </>
        )}
        {groupedFonts['other'].length > 0 && (
          <>
            <SelectSeparator />
            <SelectGroup>
              {groupedFonts['other'].map((font) => (
                <SelectItem
                  key={font.name}
                  value={font.name}
                  style={showPreview ? { fontFamily: font.fontFamily } : undefined}
                >
                  {font.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </>
        )}
      </SelectContent>
    </Select>
  );
}
