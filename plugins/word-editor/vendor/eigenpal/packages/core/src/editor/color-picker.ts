// The colour picker, headless: the grid of theme colours with their tints and shades, the
// standard colours, the name and the paint of each pick, and the keyboard model of an opened
// grid. Every colour control uses it: shape fill and outline, chart colours, and table borders
// and shading. React and Vue render `ColorPicker` compounds from these, so both adapters show
// the same grid, name each swatch the same way, and move the focus with the same keys.
//
// A pick is a string: `auto` (the automatic colour), a theme colour (`accent1`), a theme tint
// or shade (`accent1:40` is Lighter 40%, `accent1:-25` is Darker 25%), or `#RRGGBB`. A target
// that keeps theme references (a shape, a chart) writes the theme pick as a reference, so it
// follows a later theme change; a target that keeps only `RRGGBB` (a table border) writes the
// paint from `colorPickHex`. DOM-free, except the focus helpers, which take the grid element.

import type { ShapeThemeColorName } from '../store/store/tree-op-types.ts';
import { hostWindowOf } from './host-realm.ts';

/** A theme colour slot of a picker: the same ten slots a shape or chart colour can name. @public */
export type ColorPickerThemeSlot = ShapeThemeColorName;

/**
 * A colour picker value: `auto`, a theme colour, a theme tint or shade (`accent1:40`,
 * `accent1:-25`), or `#RRGGBB`. @public
 */
export type ColorPick =
  'auto' | ColorPickerThemeSlot | `${ColorPickerThemeSlot}:${number}` | `#${string}`;

/** A translator, as the adapters pass theirs to the colour helpers. @public */
export type ColorPickerTranslate = (
  key: string,
  params?: Record<string, string | number>
) => string;

/** The theme colours of the grid, in the order of its first row. @public */
export const COLOR_PICKER_THEME_SLOTS: readonly ColorPickerThemeSlot[] = [
  'bg1',
  'tx1',
  'bg2',
  'tx2',
  'accent1',
  'accent2',
  'accent3',
  'accent4',
  'accent5',
  'accent6',
];

/** The i18n key of each theme colour's name. */
const THEME_NAME_KEYS: Readonly<Record<ColorPickerThemeSlot, string>> = {
  bg1: 'colorPicker.theme.background1',
  tx1: 'colorPicker.theme.text1',
  bg2: 'colorPicker.theme.background2',
  tx2: 'colorPicker.theme.text2',
  accent1: 'colorPicker.theme.accent1',
  accent2: 'colorPicker.theme.accent2',
  accent3: 'colorPicker.theme.accent3',
  accent4: 'colorPicker.theme.accent4',
  accent5: 'colorPicker.theme.accent5',
  accent6: 'colorPicker.theme.accent6',
};

/** The standard colours of the grid, with the i18n key of each name. @public */
export const COLOR_PICKER_STANDARD_COLORS: readonly {
  readonly hex: string;
  readonly nameKey: string;
}[] = [
  { hex: '#C00000', nameKey: 'colorPicker.colors.darkRed' },
  { hex: '#FF0000', nameKey: 'colorPicker.colors.red' },
  { hex: '#FFC000', nameKey: 'colorPicker.colors.orange' },
  { hex: '#FFFF00', nameKey: 'colorPicker.colors.yellow' },
  { hex: '#92D050', nameKey: 'colorPicker.colors.lightGreen' },
  { hex: '#00B050', nameKey: 'colorPicker.colors.green' },
  { hex: '#00B0F0', nameKey: 'colorPicker.colors.lightBlue' },
  { hex: '#0070C0', nameKey: 'colorPicker.colors.blue' },
  { hex: '#002060', nameKey: 'colorPicker.colors.darkBlue' },
  { hex: '#7030A0', nameKey: 'colorPicker.colors.purple' },
];

/** Six hex digits, the only colour text that reaches a swatch style. */
const HEX6 = /^[0-9A-F]{6}$/;

/** The default theme colours, for a document with no theme, in slot order. */
const DEFAULT_THEME_HEXES: readonly string[] = [
  'FFFFFF',
  '000000',
  'E7E6E6',
  '44546A',
  '4472C4',
  'ED7D31',
  'A5A5A5',
  'FFC000',
  '5B9BD5',
  '70AD47',
];

/**
 * The theme colours of a document, `RRGGBB` in `COLOR_PICKER_THEME_SLOTS` order, from
 * `editor.getDocumentThemeColors()`; the default theme when the document has none. @public
 */
export function documentThemeHexes(
  entries: readonly { readonly hex: string }[] | undefined
): readonly string[] {
  const hexes = (entries ?? []).map((entry) => entry.hex.replace(/^#/, '').toUpperCase());
  return hexes.length === DEFAULT_THEME_HEXES.length && hexes.every((hex) => HEX6.test(hex))
    ? hexes
    : DEFAULT_THEME_HEXES;
}

/** The theme slot and shift of a theme pick (`accent1:40`), or null for any other pick. @public */
export function colorPickTheme(
  pick: string
): { readonly name: ColorPickerThemeSlot; readonly shift: number } | null {
  const match = /^([a-z0-9]+)(?::(-?\d+))?$/.exec(pick.trim());
  const name = match?.[1] as ColorPickerThemeSlot | undefined;
  if (!match || !name || !COLOR_PICKER_THEME_SLOTS.includes(name)) return null;
  const shift = match[2] === undefined ? 0 : Number(match[2]);
  return shift >= -100 && shift <= 100 ? { name, shift } : null;
}

/**
 * The name of a pick: Automatic, a theme colour with its tint or shade, a standard colour by
 * name ("Purple"), or the hex code of any other colour. @public
 */
export function colorPickLabel(pick: ColorPick, t: ColorPickerTranslate): string {
  if (pick === 'auto') return t('colorPicker.automatic');
  if (pick.startsWith('#')) {
    const standard = COLOR_PICKER_STANDARD_COLORS.find((c) => c.hex === pick.toUpperCase());
    return standard ? t(standard.nameKey) : pick.toUpperCase();
  }
  const [theme, shift] = pick.split(':') as [ColorPickerThemeSlot, string?];
  const name = t(THEME_NAME_KEYS[theme]);
  const n = Number(shift ?? 0);
  if (n > 0) return t('colorPicker.lighterPercent', { color: name, percent: n });
  if (n < 0) return t('colorPicker.darkerPercent', { color: name, percent: -n });
  return name;
}

/**
 * `RRGGBB` of `hex` with the luminance transform that a theme reference writes: `lumMod` of
 * `100 - |shift|` percent, and `lumOff` of `shift` percent for a tint (ECMA-376 Part 1,
 * 20.1.2.3.20 and 20.1.2.3.21), on the HSL lightness.
 */
function shifted(hex: string, shift: number): string {
  const [r, g, b] = [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  const lum = Math.max(0, Math.min(1, l * (1 - Math.abs(shift) / 100) + Math.max(0, shift) / 100));
  const c = (1 - Math.abs(2 * lum - 1)) * s;
  const x = c * (1 - Math.abs(((((h % 6) + 6) % 6) % 2) - 1));
  const m = lum - c / 2;
  const sector = Math.floor(((h % 6) + 6) % 6);
  const rgb = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][sector]!;
  return rgb
    .map((v) =>
      Math.max(0, Math.min(255, Math.round((v + m) * 255)))
        .toString(16)
        .padStart(2, '0')
    )
    .join('')
    .toUpperCase();
}

/**
 * The `#RRGGBB` that a pick paints, from the document's theme colours (`documentThemeHexes`).
 * `auto` paints `automaticHex`, or black without one. @public
 */
export function colorPickHex(
  pick: ColorPick,
  themeHexes: readonly string[],
  automaticHex?: string
): string {
  if (pick === 'auto') {
    const hex = automaticHex?.replace(/^#/, '').toUpperCase();
    return hex && HEX6.test(hex) ? `#${hex}` : '#000000';
  }
  if (pick.startsWith('#')) {
    const hex = pick.slice(1).toUpperCase();
    return HEX6.test(hex) ? `#${hex}` : '#000000';
  }
  const [theme, shift] = pick.split(':') as [ColorPickerThemeSlot, string?];
  const base = themeHexes[COLOR_PICKER_THEME_SLOTS.indexOf(theme)] ?? '000000';
  const n = Math.max(-100, Math.min(100, Number(shift ?? 0)));
  return `#${shifted(base, Number.isFinite(n) ? n : 0)}`;
}

/** The tint and shade steps under one theme colour, by the colour's lightness. */
function steps(hex: string): readonly number[] {
  const channels = [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16));
  const lightness = (Math.max(...channels) + Math.min(...channels)) / 2 / 255;
  if (lightness === 1) return [-5, -15, -25, -35, -50];
  if (lightness === 0) return [50, 35, 25, 15, 5];
  if (lightness >= 0.8) return [-10, -25, -50, -75, -90];
  return [80, 60, 40, -25, -50];
}

/** One swatch of the colour grid. @public */
export interface ColorSwatch {
  readonly pick: ColorPick;
  /** The colour the swatch paints, `#RRGGBB`. */
  readonly hex: string;
}

/** The colour grid: theme rows (one column per theme colour) and the standard row. @public */
export interface ColorPickerGrid {
  /** The theme colours, then five rows of their tints and shades. */
  readonly theme: readonly (readonly ColorSwatch[])[];
  readonly standard: readonly ColorSwatch[];
}

/**
 * The colour grid: one row of theme colours, five rows of their tints and shades (one column per
 * theme colour), and the row of standard colours. @public
 */
export function colorPickerGrid(themeHexes: readonly string[]): ColorPickerGrid {
  const base = COLOR_PICKER_THEME_SLOTS.map((slot) => ({
    pick: slot as ColorPick,
    hex: colorPickHex(slot, themeHexes),
  }));
  const ladders = COLOR_PICKER_THEME_SLOTS.map((_, i) => steps(themeHexes[i] ?? '000000'));
  const variants = [0, 1, 2, 3, 4].map((row) =>
    COLOR_PICKER_THEME_SLOTS.map((slot, column) => {
      const pick = `${slot}:${ladders[column]![row]!}` as ColorPick;
      return { pick, hex: colorPickHex(pick, themeHexes) };
    })
  );
  const standard = COLOR_PICKER_STANDARD_COLORS.map((c) => ({
    pick: c.hex as ColorPick,
    hex: c.hex,
  }));
  return { theme: [base, ...variants], standard };
}

/**
 * The grid pick of a colour: the theme pick when `theme` names one, else the standard colour
 * that paints `hex`, else `#RRGGBB`. Null for no colour. @public
 */
export function colorPickOf(
  hex: string | null | undefined,
  theme?: { readonly name: ColorPickerThemeSlot; readonly shift?: number } | null
): ColorPick | null {
  if (theme) return theme.shift ? `${theme.name}:${theme.shift}` : theme.name;
  const value = hex?.replace(/^#/, '').toUpperCase();
  if (!value || !HEX6.test(value)) return null;
  const found = COLOR_PICKER_STANDARD_COLORS.find((swatch) => swatch.hex === `#${value}`);
  return (found?.hex as ColorPick | undefined) ?? `#${value}`;
}

/** Whether the swatch `swatch` is the current pick `current`, ignoring case. @public */
export const colorPickIsCurrent = (swatch: ColorPick, current: ColorPick | null): boolean =>
  current !== null && swatch.toUpperCase() === current.toUpperCase();

/**
 * The pick of typed hex text (`#RRGGBB`, `RRGGBB`, or three digits), or null when it names
 * no colour. @public
 */
export function colorPickFromHexText(text: string): ColorPick | null {
  let hex = text.trim().replace(/^#/, '').toUpperCase();
  if (/^[0-9A-F]{3}$/.test(hex)) hex = [...hex].map((c) => c + c).join('');
  return HEX6.test(hex) ? `#${hex}` : null;
}

// --- The keyboard model of an opened grid ----------------------------------------------------

/** The columns of every swatch row of the grid. */
const SWATCH_COLUMNS = 10;

/** A grid swatch: the attribute the adapters' `ColorPicker.Swatch` sets, or the older class. */
const SWATCH_SELECTOR = '[data-color-swatch], .docx-chart-pane__swatch';
/** The button above the swatches: No colour, Automatic, or the older chart class. */
const NONE_SELECTOR = '[data-color-none], .docx-chart-pane__grid-auto';

const swatchesOf = (grid: HTMLElement): HTMLElement[] => [
  ...grid.querySelectorAll<HTMLElement>(SWATCH_SELECTOR),
];

/** Keep one swatch in the Tab order, so Tab leaves the grid in one step. */
function rovingSwatch(grid: HTMLElement, active: HTMLElement | null): void {
  for (const swatch of swatchesOf(grid)) swatch.tabIndex = swatch === active ? 0 : -1;
}

/**
 * Keep an opened popover grid inside the window. The grid opens under the trigger, aligned to
 * its end edge; when that edge leaves no room (a trigger near the start of a host toolbar), the
 * grid takes `data-align="start"` and aligns to the start edge instead. @public
 */
export function alignColorPickerPopover(grid: HTMLElement | null): void {
  if (!grid) return;
  grid.removeAttribute('data-align');
  const rect = grid.getBoundingClientRect();
  const width = hostWindowOf(grid).innerWidth;
  if (rect.left < 0 || (width > 0 && rect.right > width)) grid.setAttribute('data-align', 'start');
}

/**
 * Focus the current swatch of an opened grid (`aria-pressed="true"`), else its first button,
 * and scroll the whole grid into view. A popover grid first moves inside the window
 * (`alignColorPickerPopover`). @public
 */
export function focusColorSwatch(grid: HTMLElement | null): void {
  if (!grid) return;
  alignColorPickerPopover(grid);
  const current =
    grid.querySelector<HTMLElement>('[aria-pressed="true"]') ??
    grid.querySelector<HTMLElement>('button');
  if (current?.matches(SWATCH_SELECTOR)) rovingSwatch(grid, current);
  else rovingSwatch(grid, swatchesOf(grid)[0] ?? null);
  current?.focus({ preventScroll: true });
  grid.scrollIntoView?.({ block: 'nearest' });
}

/**
 * Move the focus in an opened grid for an arrow key, Home, or End. The swatches are rows of ten;
 * Up from the first row goes to the No colour (or Automatic) button. Returns whether the key
 * moved the focus, so the caller can prevent the default action. @public
 */
export function moveColorSwatchFocus(grid: HTMLElement | null, key: string): boolean {
  if (!grid) return false;
  const swatches = swatchesOf(grid);
  const none = grid.querySelector<HTMLElement>(NONE_SELECTOR);
  const active = grid.ownerDocument.activeElement;
  const at = swatches.findIndex((swatch) => swatch === active);
  const rtl = grid.ownerDocument.defaultView?.getComputedStyle(grid).direction === 'rtl';
  const step = { ArrowLeft: rtl ? 1 : -1, ArrowRight: rtl ? -1 : 1 }[key];
  let next: HTMLElement | null | undefined;
  if (at < 0) {
    if (active !== none || (key !== 'ArrowDown' && key !== 'Home')) return false;
    next = swatches[0];
  } else if (step !== undefined) next = swatches[at + step];
  else if (key === 'ArrowDown') next = swatches[at + SWATCH_COLUMNS];
  else if (key === 'ArrowUp') next = at < SWATCH_COLUMNS ? none : swatches[at - SWATCH_COLUMNS];
  else if (key === 'Home') next = swatches[0];
  else if (key === 'End') next = swatches[swatches.length - 1];
  else return false;
  if (!next) return true;
  if (next !== none) rovingSwatch(grid, next);
  next.focus({ preventScroll: true });
  return true;
}
