import { useState, useCallback, useMemo, useEffect } from 'react';
import type { CSSProperties } from 'react';
import type { ColorValue, Theme, ThemeColorScheme } from '@docx-editor.dev/core/contracts/editor';
import {
  generateThemeTintShadeMatrix,
  resolveColor,
  resolveColorToHex,
  resolveHighlightColor,
} from '../../lib/colorResolver';
import type { ThemeMatrixCell } from '../../lib/colorResolver';
import { useFixedDropdown } from '../../hooks/useFixedDropdown';
import { MaterialSymbol } from './MaterialSymbol';
import { useTranslation } from '../../i18n';
import type { TranslationKey } from '../../i18n';

// ============================================================================
// TYPES
// ============================================================================

export type ColorPickerMode = 'text' | 'highlight' | 'border';

export interface ColorPickerProps {
  mode: ColorPickerMode;
  value?: ColorValue | string;
  onChange?: (color: ColorValue | string) => void;
  theme?: Theme | null;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  title?: string;
  /** Override the default icon for the mode */
  icon?: string;
  /** Override the auto/no-color button label */
  autoLabel?: string;
  /**
   * Word-style split button. When true (default), renders two halves:
   *  - left (apply): re-applies the last picked color directly
   *  - right (arrow): opens the color picker
   * When false, the legacy single button is rendered (one click toggles dropdown).
   */
  splitButton?: boolean;
  /**
   * Initial "last picked" color used by the apply half before the user picks
   * anything. Defaults: text → red, highlight → yellow, border → black.
   */
  defaultColor?: ColorValue | string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const STANDARD_COLORS: Array<{ name: string; nameKey: TranslationKey; hex: string }> = [
  { name: 'Dark Red', nameKey: 'colorPicker.colors.darkRed', hex: 'C00000' },
  { name: 'Red', nameKey: 'colorPicker.colors.red', hex: 'FF0000' },
  { name: 'Orange', nameKey: 'colorPicker.colors.orange', hex: 'FFC000' },
  { name: 'Yellow', nameKey: 'colorPicker.colors.yellow', hex: 'FFFF00' },
  { name: 'Light Green', nameKey: 'colorPicker.colors.lightGreen', hex: '92D050' },
  { name: 'Green', nameKey: 'colorPicker.colors.green', hex: '00B050' },
  { name: 'Light Blue', nameKey: 'colorPicker.colors.lightBlue', hex: '00B0F0' },
  { name: 'Blue', nameKey: 'colorPicker.colors.blue', hex: '0070C0' },
  { name: 'Dark Blue', nameKey: 'colorPicker.colors.darkBlue', hex: '002060' },
  { name: 'Purple', nameKey: 'colorPicker.colors.purple', hex: '7030A0' },
];

const CELL_SIZE = 18;
const GAP = 2;

// ============================================================================
// STYLES
// ============================================================================

const S_CONTAINER: CSSProperties = {
  position: 'relative',
  display: 'inline-block',
};

const S_BUTTON: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '40px',
  height: '32px',
  padding: '2px 6px',
  border: 'none',
  borderRadius: '4px',
  backgroundColor: 'transparent',
  cursor: 'pointer',
  transition: 'background-color 0.1s',
  color: 'var(--doc-text-muted)',
};

const S_DROPDOWN: CSSProperties = {
  padding: '10px',
  backgroundColor: 'var(--doc-surface)',
  border: '1px solid var(--doc-border-dark)',
  borderRadius: '6px',
  boxShadow: '0 4px 16px var(--doc-shadow)',
  width: 'auto',
};

const S_SECTION_LABEL: CSSProperties = {
  fontSize: '11px',
  color: 'var(--doc-text-muted)',
  marginBottom: '4px',
  fontWeight: 500,
};

const S_DIVIDER: CSSProperties = {
  height: '1px',
  backgroundColor: 'var(--doc-border)',
  margin: '8px 0',
};

const S_GRID: CSSProperties = {
  display: 'grid',
  gap: `${GAP}px`,
};

const S_CELL: CSSProperties = {
  width: `${CELL_SIZE}px`,
  height: `${CELL_SIZE}px`,
  border: '1px solid var(--doc-border-input)',
  borderRadius: '2px',
  cursor: 'pointer',
  padding: 0,
  transition: 'transform 0.1s, border-color 0.1s',
};

const S_CELL_HOVER: CSSProperties = {
  ...S_CELL,
  transform: 'scale(1.15)',
  borderColor: 'var(--doc-text)',
  zIndex: 1,
};

const S_CELL_SELECTED: CSSProperties = {
  ...S_CELL,
  borderWidth: '2px',
  borderColor: 'var(--doc-primary)',
  boxShadow: '0 0 0 1px var(--doc-primary)',
};

const S_AUTO_BUTTON: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  width: '100%',
  padding: '5px 8px',
  border: '1px solid var(--doc-border-dark)',
  borderRadius: '4px',
  backgroundColor: 'var(--doc-surface)',
  cursor: 'pointer',
  fontSize: '12px',
  color: 'var(--doc-text)',
};

const S_CUSTOM_ROW: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
};

const S_HEX_INPUT: CSSProperties = {
  width: '70px',
  height: '24px',
  padding: '2px 6px',
  border: '1px solid var(--doc-border-input)',
  borderRadius: '3px',
  fontSize: '12px',
};

const S_APPLY_BTN: CSSProperties = {
  height: '24px',
  padding: '0 10px',
  border: '1px solid var(--doc-border-input)',
  borderRadius: '3px',
  backgroundColor: 'var(--doc-bg-subtle)',
  fontSize: '12px',
  cursor: 'pointer',
};

const S_COLOR_BAR: CSSProperties = {
  width: '16px',
  height: '4px',
  borderRadius: '1px',
  marginTop: '-2px',
};

// ── Split-button styles ─────────────────────────────────────────────────────
// Two distinct buttons sitting side by side, like in MS Word. Each half has
// full rounded corners and its own hover state; a 2px gap between them sells
// the "two separate buttons" affordance without a visible divider line.
const S_SPLIT_GROUP: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'stretch',
  height: '32px',
  gap: '2px',
};

const S_SPLIT_APPLY_BTN: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 0,
  width: '28px',
  padding: '2px 4px',
  border: 'none',
  borderRadius: '4px',
  backgroundColor: 'transparent',
  cursor: 'pointer',
  transition: 'background-color 0.1s',
  color: 'var(--doc-text-muted)',
};

const S_SPLIT_ARROW_BTN: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '18px',
  padding: 0,
  border: 'none',
  borderRadius: '4px',
  backgroundColor: 'transparent',
  cursor: 'pointer',
  transition: 'background-color 0.1s',
  color: 'var(--doc-text-muted)',
};

// ============================================================================
// HELPERS
// ============================================================================

function resolveCurrentColor(
  value: ColorValue | string | undefined,
  mode: ColorPickerMode,
  theme: Theme | null | undefined
): string {
  if (!value) {
    return mode === 'text' || mode === 'border' ? '#000000' : 'transparent';
  }
  if (typeof value === 'string') {
    if (mode === 'highlight') {
      // Try OOXML named color first, then treat as hex
      const resolved = resolveHighlightColor(value);
      if (resolved) return resolved;
      if (value === 'none') return 'transparent';
      return value.startsWith('#') ? value : `#${value}`;
    }
    return value.startsWith('#') ? value : `#${value}`;
  }
  return resolveColor(value, theme);
}

/** Returns true if the hex color (e.g. "#F8FAFC") is very light and needs a border to be visible. */
function isLightColor(hex: string): boolean {
  const h = hex.replace(/^#/, '');
  if (h.length !== 6) return false;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  // Perceived luminance — threshold at ~90% white
  return (r * 299 + g * 587 + b * 114) / 1000 > 230;
}

function isSelectedCell(
  value: ColorValue | string | undefined,
  cellHex: string,
  theme: Theme | null | undefined
): boolean {
  if (!value) return false;
  const resolved =
    typeof value === 'string'
      ? value.replace(/^#/, '').toUpperCase()
      : resolveColorToHex(value, theme);
  return resolved === cellHex.toUpperCase();
}

// ============================================================================
// SUBCOMPONENTS
// ============================================================================

function ThemeColorMatrix({
  matrix,
  selectedColor,
  theme,
  onSelect,
}: {
  matrix: ThemeMatrixCell[][];
  selectedColor?: ColorValue | string;
  theme?: Theme | null;
  onSelect: (cell: ThemeMatrixCell) => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <div style={{ ...S_GRID, gridTemplateColumns: `repeat(10, ${CELL_SIZE}px)` }}>
      {matrix.flatMap((row, ri) =>
        row.map((cell, ci) => {
          const key = `${ri}-${ci}`;
          const isHov = hovered === key;
          const isSel = isSelectedCell(selectedColor, cell.hex, theme);
          return (
            <button
              key={key}
              type="button"
              style={{
                ...(isSel ? S_CELL_SELECTED : isHov ? S_CELL_HOVER : S_CELL),
                backgroundColor: `#${cell.hex}`,
              }}
              title={cell.label}
              aria-label={cell.label}
              aria-selected={isSel}
              onClick={() => onSelect(cell)}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setHovered(key)}
              onMouseLeave={() => setHovered(null)}
            />
          );
        })
      )}
    </div>
  );
}

function StandardColorRow({
  selectedColor,
  theme,
  onSelect,
}: {
  selectedColor?: ColorValue | string;
  theme?: Theme | null;
  onSelect: (hex: string) => void;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const { t } = useTranslation();

  return (
    <div style={{ ...S_GRID, gridTemplateColumns: `repeat(10, ${CELL_SIZE}px)` }}>
      {STANDARD_COLORS.map((c, i) => {
        const isHov = hovered === i;
        const isSel = isSelectedCell(selectedColor, c.hex, theme);
        const displayName = t(c.nameKey);
        return (
          <button
            key={c.hex}
            type="button"
            style={{
              ...(isSel ? S_CELL_SELECTED : isHov ? S_CELL_HOVER : S_CELL),
              backgroundColor: `#${c.hex}`,
            }}
            title={displayName}
            aria-label={displayName}
            aria-selected={isSel}
            onClick={() => onSelect(c.hex)}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          />
        );
      })}
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function ColorPicker({
  mode,
  value,
  onChange,
  theme,
  disabled = false,
  className,
  style,
  title,
  icon: iconOverride,
  autoLabel,
  splitButton = true,
  defaultColor,
}: ColorPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [applyHovered, setApplyHovered] = useState(false);
  const [arrowHovered, setArrowHovered] = useState(false);
  const [customHex, setCustomHex] = useState('');
  // Word-style: a sensible default until the user picks something — red for
  // font color, yellow for highlight, black for border. The swatch still
  // mirrors the selection's actual color when one is set; this is just the
  // fallback for uncolored selections.
  const [pickedColor, setPickedColor] = useState<ColorValue | string>(
    () =>
      defaultColor ??
      (mode === 'highlight'
        ? 'FFFF00'
        : mode === 'border'
          ? { kind: 'hex', value: '000000' }
          : { kind: 'hex', value: 'FF0000' })
  );
  const { t } = useTranslation();

  // Sync custom hex input with the current value
  useEffect(() => {
    const hex = resolveCurrentColor(value, mode, theme).replace(/^#/, '');
    if (/^[0-9A-Fa-f]{6}$/.test(hex)) {
      setCustomHex(hex.toUpperCase());
    }
  }, [value, mode, theme]);

  const onClose = useCallback(() => setIsOpen(false), []);
  const { containerRef, dropdownRef, dropdownStyle } = useFixedDropdown({
    isOpen,
    onClose,
  });

  const colorScheme: ThemeColorScheme | null = theme?.colorScheme ?? null;
  const matrix = useMemo(() => generateThemeTintShadeMatrix(colorScheme), [colorScheme]);

  const resolvedColor = useMemo(
    () => resolveCurrentColor(value, mode, theme),
    [value, mode, theme]
  );

  // The swatch shows the last picked color (or the mode default if nothing
  // has been picked yet). It does NOT follow the cursor / selection — Word's
  // behavior is: pick once, the swatch stays put while you move around and
  // click apply on multiple selections. The dropdown's "selected cell"
  // indicator separately reflects the selection's actual color (driven by
  // `value`), so the user can still see what's currently applied.
  const swatchColor = useMemo(
    () => resolveCurrentColor(pickedColor, mode, theme),
    [pickedColor, mode, theme]
  );

  const toggleDropdown = useCallback(() => {
    if (!disabled) setIsOpen((prev) => !prev);
  }, [disabled]);

  // --- Handlers ---

  const handleThemeCellSelect = useCallback(
    (cell: ThemeMatrixCell) => {
      let picked: ColorValue | string;
      if (mode === 'highlight') {
        picked = cell.hex;
      } else {
        picked = {
          kind: 'theme',
          slot: cell.themeSlot,
          ...(cell.tint !== undefined ? { tint: cell.tint } : {}),
          ...(cell.shade !== undefined ? { shade: cell.shade } : {}),
        };
      }
      setPickedColor(picked);
      onChange?.(picked);
      setIsOpen(false);
    },
    [mode, onChange]
  );

  const handleStandardColorSelect = useCallback(
    (hex: string) => {
      const picked: ColorValue | string = mode === 'highlight' ? hex : { kind: 'hex', value: hex };
      setPickedColor(picked);
      onChange?.(picked);
      setIsOpen(false);
    },
    [mode, onChange]
  );

  // Auto / "no color" intentionally does NOT update pickedColor — clearing
  // a color isn't a "color choice" the apply button should remember.
  const handleAutomatic = useCallback(() => {
    if (mode === 'highlight') {
      onChange?.('none');
    } else {
      onChange?.({ kind: 'auto' });
    }
    setIsOpen(false);
  }, [mode, onChange]);

  const handleCustomApply = useCallback(() => {
    const hex = customHex.replace(/^#/, '').toUpperCase();
    if (/^[0-9A-F]{6}$/i.test(hex)) {
      const picked: ColorValue | string = mode === 'highlight' ? hex : { kind: 'hex', value: hex };
      setPickedColor(picked);
      onChange?.(picked);
      setIsOpen(false);
      setCustomHex('');
    }
  }, [mode, customHex, onChange]);

  // Click on the "apply" half — apply the last picked color (or seeded default).
  const handleApplyLastColor = useCallback(() => {
    if (disabled) return;
    onChange?.(pickedColor);
  }, [disabled, pickedColor, onChange]);

  // --- Button style ---
  const buttonStyle: CSSProperties = {
    ...S_BUTTON,
    ...(disabled
      ? { cursor: 'default', opacity: 0.38 }
      : isOpen
        ? { backgroundColor: 'var(--doc-primary-light)', color: 'var(--doc-primary)' }
        : isHovered
          ? { backgroundColor: 'var(--doc-bg-hover)' }
          : {}),
  };

  const defaultTitle =
    mode === 'text'
      ? t('formattingBar.fontColor')
      : mode === 'highlight'
        ? t('formattingBar.highlightColor')
        : t('table.borderColor');

  const iconName =
    iconOverride ??
    (mode === 'text'
      ? 'format_color_text'
      : mode === 'highlight'
        ? 'ink_highlighter'
        : 'border_color');

  return (
    <div
      ref={containerRef}
      className={`docx-color-picker ${className || ''}`}
      style={{ ...S_CONTAINER, ...style }}
    >
      {splitButton ? (
        <div
          className="docx-color-picker-split"
          style={{
            ...S_SPLIT_GROUP,
            ...(disabled ? { opacity: 0.38, cursor: 'default' } : null),
          }}
        >
          <button
            type="button"
            className="docx-color-picker-apply"
            style={{
              ...S_SPLIT_APPLY_BTN,
              ...(disabled
                ? { cursor: 'default' }
                : applyHovered
                  ? { backgroundColor: 'var(--doc-bg-hover)' }
                  : null),
            }}
            onClick={handleApplyLastColor}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setApplyHovered(true)}
            onMouseLeave={() => setApplyHovered(false)}
            disabled={disabled}
            title={title || defaultTitle}
            aria-label={title || defaultTitle}
          >
            <MaterialSymbol name={iconName} size={18} />
            <div
              style={{
                ...S_COLOR_BAR,
                backgroundColor: swatchColor === 'transparent' ? '#fff' : swatchColor,
                outline:
                  swatchColor === 'transparent' || isLightColor(swatchColor)
                    ? '1px solid #bbb'
                    : 'none',
              }}
            />
          </button>
          <button
            type="button"
            className="docx-color-picker-arrow"
            style={{
              ...S_SPLIT_ARROW_BTN,
              ...(disabled
                ? { cursor: 'default' }
                : isOpen
                  ? {
                      backgroundColor: 'var(--doc-primary-light)',
                      color: 'var(--doc-primary)',
                    }
                  : arrowHovered
                    ? { backgroundColor: 'var(--doc-bg-hover)' }
                    : null),
            }}
            onClick={toggleDropdown}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setArrowHovered(true)}
            onMouseLeave={() => setArrowHovered(false)}
            disabled={disabled}
            title={title || defaultTitle}
            aria-label={title || defaultTitle}
            aria-haspopup="true"
            aria-expanded={isOpen}
          >
            <MaterialSymbol name="arrow_drop_down" size={18} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="docx-color-picker-button"
          style={buttonStyle}
          onClick={toggleDropdown}
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          disabled={disabled}
          title={title || defaultTitle}
          aria-label={title || defaultTitle}
          aria-haspopup="true"
          aria-expanded={isOpen}
        >
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
            <MaterialSymbol name={iconName} size={18} />
            <div
              style={{
                ...S_COLOR_BAR,
                backgroundColor: resolvedColor === 'transparent' ? '#fff' : resolvedColor,
                outline:
                  resolvedColor === 'transparent' || isLightColor(resolvedColor)
                    ? '1px solid #bbb'
                    : 'none',
              }}
            />
          </div>
          <MaterialSymbol name="arrow_drop_down" size={14} />
        </button>
      )}

      {isOpen && (
        <div
          ref={dropdownRef}
          className="docx-color-picker-dropdown"
          style={{ ...dropdownStyle, ...S_DROPDOWN }}
          role="dialog"
          aria-label={`${defaultTitle} picker`}
          onMouseDown={(e) => {
            // Allow input elements to receive focus, prevent focus steal for everything else
            if ((e.target as HTMLElement).tagName !== 'INPUT') {
              e.preventDefault();
            }
          }}
        >
          {/* All modes share the same layout */}
          <>
            <button
              type="button"
              style={S_AUTO_BUTTON}
              onClick={handleAutomatic}
              onMouseDown={(e) => e.preventDefault()}
            >
              {mode === 'highlight' ? (
                <span
                  style={{
                    display: 'inline-block',
                    width: '16px',
                    height: '16px',
                    border: '1px solid #ccc',
                    borderRadius: '2px',
                    position: 'relative',
                    backgroundColor: '#fff',
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      top: '50%',
                      left: '-1px',
                      right: '-1px',
                      height: '2px',
                      backgroundColor: '#ff0000',
                      transform: 'rotate(-45deg)',
                    }}
                  />
                </span>
              ) : (
                <span
                  style={{
                    display: 'inline-block',
                    width: '16px',
                    height: '16px',
                    backgroundColor: '#000',
                    borderRadius: '2px',
                  }}
                />
              )}
              {autoLabel ??
                (mode === 'highlight' ? t('colorPicker.noColor') : t('colorPicker.automatic'))}
            </button>
            <div style={S_DIVIDER} />
            <div style={S_SECTION_LABEL}>{t('colorPicker.themeColors')}</div>
            <ThemeColorMatrix
              matrix={matrix}
              selectedColor={value}
              theme={theme}
              onSelect={handleThemeCellSelect}
            />
            <div style={S_DIVIDER} />
            <div style={S_SECTION_LABEL}>{t('colorPicker.standardColors')}</div>
            <StandardColorRow
              selectedColor={value}
              theme={theme}
              onSelect={handleStandardColorSelect}
            />
            <div style={S_DIVIDER} />
            <div style={S_SECTION_LABEL}>{t('colorPicker.customColor')}</div>
            <div style={S_CUSTOM_ROW}>
              <span style={{ fontSize: '12px', color: 'var(--doc-text-muted)' }}>#</span>
              <input
                type="text"
                style={S_HEX_INPUT}
                value={customHex}
                onChange={(e) =>
                  setCustomHex(e.target.value.replace(/[^0-9A-Fa-f]/g, '').slice(0, 6))
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCustomApply();
                }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                }}
                placeholder="FF0000"
                maxLength={6}
                aria-label="Custom hex color"
              />
              <button
                type="button"
                style={{
                  ...S_APPLY_BTN,
                  opacity: /^[0-9A-Fa-f]{6}$/.test(customHex) ? 1 : 0.4,
                  cursor: /^[0-9A-Fa-f]{6}$/.test(customHex) ? 'pointer' : 'default',
                }}
                onClick={handleCustomApply}
                onMouseDown={(e) => e.preventDefault()}
                disabled={!/^[0-9A-Fa-f]{6}$/.test(customHex)}
              >
                {t('common.apply')}
              </button>
            </div>
          </>
        </div>
      )}
    </div>
  );
}

export default ColorPicker;
