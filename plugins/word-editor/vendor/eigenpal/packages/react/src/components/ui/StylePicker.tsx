/**
 * Style Picker Component (Radix UI)
 *
 * A dropdown selector for applying named paragraph styles using Radix Select.
 * Shows each style with its visual appearance (font size, bold, color).
 */

import * as React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger } from './Select';
import { cn } from '../../lib/utils';
import type { Theme } from '@docx-editor.dev/core/contracts/editor';
import type { DocumentStyleSummary } from '../../lib/stylePreview';
import {
  builtInParagraphStyleLabel,
  getStylePreviewProps,
  resolveParagraphStyleOptions,
} from '../../lib/stylePreview';
import { useTranslation } from '../../i18n';
import type { TranslationKey } from '../../i18n';

// ============================================================================
// TYPES
// ============================================================================

export interface StyleOption {
  styleId: string;
  name: string;
  nameKey?: TranslationKey;
  /** Style type as the engine reports it (`paragraph`, `character`, …). */
  type: string;
  isDefault?: boolean;
  qFormat?: boolean;
  priority?: number;
  /** Font size in half-points for visual preview */
  fontSize?: number;
  /** Bold styling */
  bold?: boolean;
  /** Italic styling */
  italic?: boolean;
  /** Text color (RGB hex) */
  color?: string;
}

export interface StylePickerProps {
  value?: string;
  onChange?: (styleId: string) => void;
  /** The engine's document-style summaries (`Editor.getDocumentStyles()`). */
  styles?: readonly DocumentStyleSummary[];
  theme?: Theme | null;
  disabled?: boolean;
  className?: string;
  width?: number | string;
}

// ============================================================================
// DEFAULT STYLES (matching Google Docs order and appearance)
// ============================================================================

const DEFAULT_STYLES: StyleOption[] = [
  {
    styleId: 'Normal',
    name: 'Normal text',
    nameKey: 'styles.normalText',
    type: 'paragraph',
    isDefault: true,
    priority: 0,
    qFormat: true,
    fontSize: 22, // 11pt
  },
  {
    styleId: 'Title',
    name: 'Title',
    nameKey: 'styles.title',
    type: 'paragraph',
    priority: 1,
    qFormat: true,
    fontSize: 52, // 26pt
    bold: true,
  },
  {
    styleId: 'Subtitle',
    name: 'Subtitle',
    nameKey: 'styles.subtitle',
    type: 'paragraph',
    priority: 2,
    qFormat: true,
    fontSize: 30, // 15pt
    color: '666666', // Gray
  },
  {
    styleId: 'Heading1',
    name: 'Heading 1',
    nameKey: 'styles.heading1',
    type: 'paragraph',
    priority: 3,
    qFormat: true,
    fontSize: 40, // 20pt
    bold: true,
  },
  {
    styleId: 'Heading2',
    name: 'Heading 2',
    nameKey: 'styles.heading2',
    type: 'paragraph',
    priority: 4,
    qFormat: true,
    fontSize: 32, // 16pt
    bold: true,
  },
  {
    styleId: 'Heading3',
    name: 'Heading 3',
    nameKey: 'styles.heading3',
    type: 'paragraph',
    priority: 5,
    qFormat: true,
    fontSize: 28, // 14pt
    bold: true,
  },
];

// ============================================================================
// COMPONENT
// ============================================================================

export function StylePicker({
  value,
  onChange,
  styles,
  disabled = false,
  className,
  width = 120,
}: StylePickerProps) {
  const { t } = useTranslation();
  // Convert document styles to options. Filter/sort + preview CSS come from the
  // shared core helper (resolveParagraphStyleOptions / getStylePreviewProps) so
  // React and Vue stay in lockstep; only the i18n nameKey lookup is React-side.
  const styleOptions: StyleOption[] = React.useMemo(() => {
    const resolved = resolveParagraphStyleOptions(styles);
    if (resolved.length === 0) return DEFAULT_STYLES;
    return resolved.map((o) => {
      // Built-in styles match by name, because a style id can be localized. This picker
      // keeps its own "Normal text" label for the default style.
      const builtIn = builtInParagraphStyleLabel(o.name);
      if (!builtIn) return { ...o, type: 'paragraph' };
      const name =
        builtIn.key === 'styles.normal' ? t('styles.normalText') : t(builtIn.key, builtIn.vars);
      return { ...o, type: 'paragraph', name };
    });
  }, [styles, t]);

  const handleValueChange = React.useCallback(
    (newValue: string) => {
      onChange?.(newValue);
    },
    [onChange]
  );

  const getStyleName = (style: StyleOption) => (style.nameKey ? t(style.nameKey) : style.name);

  const currentValue = value || 'Normal';
  const currentStyle = styleOptions.find((s) => s.styleId === currentValue);
  const displayName = currentStyle ? getStyleName(currentStyle) : currentValue;

  return (
    <Select value={currentValue} onValueChange={handleValueChange} disabled={disabled}>
      <SelectTrigger
        className={cn('h-8 text-sm', className)}
        style={{ width: typeof width === 'number' ? `${width}px` : width }}
        aria-label={t('styles.selectAriaLabel')}
      >
        <span className="truncate">{displayName}</span>
      </SelectTrigger>
      <SelectContent className="min-w-[260px] max-h-[400px]">
        {styleOptions.map((style) => (
          <SelectItem key={style.styleId} value={style.styleId} className="py-2.5 px-3">
            <span style={getStylePreviewProps(style)}>{getStyleName(style)}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
