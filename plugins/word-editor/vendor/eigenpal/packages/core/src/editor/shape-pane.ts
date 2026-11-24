// The Format shape pane, headless: the text of each field, the check of what the user types, and
// the one command that each committed field or picked color sends (`setShapeFill` or
// `setShapeOutline`). The React and Vue panes render from these, so both check the same input
// with the same keys. The color grid is the shared picker's (`colorPickerGrid`). A theme pick sends
// a theme colour, which writes a theme reference; a standard colour or typed text sends
// `RRGGBB`. A colour is named as a theme colour only when its markup is a theme reference.
// DOM-free.

import type {
  ShapeFillState,
  ShapeFormatState,
  ShapeOutlineState,
  ShapeThemeColor,
} from '../store/package/shape-format.ts';
import { shapeColorHex } from '../store/package/shape-format.ts';
import type { ShapeOutlineDash } from '../store/store/tree-op-types.ts';
import { isShapeOutlineDash } from '../store/package/drawing-line-dash.ts';
import {
  colorPickHex,
  colorPickIsCurrent,
  colorPickLabel,
  colorPickOf,
  colorPickTheme,
  type ColorPick,
  type ColorPickerTranslate,
} from './color-picker.ts';
import type { SelectedShapeCommand } from './selected-shape.ts';

/** The outline widths the pane offers, in points. @public */
export const SHAPE_OUTLINE_WIDTHS: readonly number[] = [0.25, 0.5, 0.75, 1, 1.5, 2.25, 3, 4.5, 6];

/**
 * The outline dashes the pane offers, in list order: a plain line, the two dotted lines, and
 * the dashed ones. Every preset of `ShapeOutlineDash` is valid in a command. @public
 */
export const SHAPE_OUTLINE_DASHES: readonly ShapeOutlineDash[] = [
  'solid',
  'sysDot',
  'sysDash',
  'dash',
  'dashDot',
  'lgDash',
  'lgDashDot',
  'lgDashDotDot',
];

/** The i18n key of a dash's name, such as `shape.pane.dashes.sysDot` ("Round dot"). @public */
export const shapeDashLabelKey = (
  dash: ShapeOutlineDash | 'custom'
): `shape.pane.dashes.${ShapeOutlineDash | 'custom'}` => `shape.pane.dashes.${dash}`;

/** The widest outline the shape commands write, in points. */
const MAX_OUTLINE_PT = 1584;

/**
 * One change of the Format shape pane. `color` is a color grid pick (`accent1`,
 * `accent1:40`, `#4472C4`) or typed text: `#RRGGBB`, `RRGGBB`, or a CSS color name. `text` is
 * what the user typed in a number field. @public
 */
export type ShapePaneChange =
  | { readonly type: 'fillColor'; readonly color: string }
  | { readonly type: 'noFill' }
  | { readonly type: 'fillTransparency'; readonly text: string }
  | { readonly type: 'outlineColor'; readonly color: string }
  | { readonly type: 'noOutline' }
  | { readonly type: 'outlineWidth'; readonly text: string }
  | { readonly type: 'outlineDash'; readonly dash: ShapeOutlineDash };

/** The i18n key of why the pane refuses typed text. @public */
export type ShapePaneError =
  | 'shape.pane.errors.color'
  | 'shape.pane.errors.transparency'
  | 'shape.pane.errors.width'
  | 'shape.pane.errors.dash'
  | 'shape.pane.errors.noSolidFill';

/**
 * The command of a change, or the i18n key of why the typed text is refused. `command` is null
 * when the change asks for what the shape already shows, so nothing is sent. @public
 */
export type ShapePaneResult =
  | { readonly ok: true; readonly command: SelectedShapeCommand | null }
  | { readonly ok: false; readonly error: ShapePaneError };

const fail = (error: ShapePaneError): ShapePaneResult => ({ ok: false, error });

/** The number in a field: `,` reads as a decimal point and a trailing unit is dropped. */
function parseNumber(text: string, unit: RegExp): number | null {
  const t = text.trim().replace(unit, '').trim().replace(',', '.');
  if (t === '' || !/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(t)) return null;
  return Number(t);
}

/**
 * `RRGGBB` of a color grid pick or of typed color text, or null when it names no color.
 * `themeHexes` comes from `chartThemeHexes(editor.getDocumentThemeColors())`. @public
 */
export function shapePaneColorHex(color: string, themeHexes: readonly string[]): string | null {
  const text = color.trim();
  if (colorPickTheme(text)) return colorPickHex(text as ColorPick, themeHexes).slice(1);
  return shapeColorHex(text);
}

/** The theme colour of a grid pick (`accent1`, `accent1:40`), or null for any other text. */
const pickTheme = (color: string): ShapeThemeColor | null => colorPickTheme(color);

const sameTheme = (a: ShapeThemeColor | undefined, b: ShapeThemeColor | null): boolean =>
  (a ?? null) === b || (!!a && !!b && a.name === b.name && a.shift === b.shift);

/** Whether a picked colour is what the shape shows: the same theme colour, or the same `RRGGBB`. */
function sameColor(
  current: { readonly color: string | null; readonly theme?: ShapeThemeColor },
  color: string,
  theme: ShapeThemeColor | null
): boolean {
  if (theme || current.theme) return sameTheme(current.theme, theme);
  return current.color !== null && current.color.toUpperCase() === color.toUpperCase();
}

/**
 * The command of one pane change for a shape whose fill and outline are `format`, or why the
 * typed text is refused. A change to what the shape already shows gives a null command. @public
 */
export function shapePaneCommand(
  format: ShapeFormatState,
  change: ShapePaneChange,
  themeHexes: readonly string[]
): ShapePaneResult {
  switch (change.type) {
    case 'fillColor':
    case 'outlineColor': {
      const hex = shapePaneColorHex(change.color, themeHexes);
      if (!hex) return fail('shape.pane.errors.color');
      const theme = pickTheme(change.color);
      const color = theme ? { theme: theme.name, shift: theme.shift } : hex;
      if (change.type === 'fillColor')
        return {
          ok: true,
          command:
            format.fill.type === 'solid' && sameColor(format.fill, hex, theme)
              ? null
              : { type: 'setShapeFill', color },
        };
      return {
        ok: true,
        command:
          format.outline.visible === true && sameColor(format.outline, hex, theme)
            ? null
            : { type: 'setShapeOutline', visible: true, color },
      };
    }
    case 'noFill':
      return {
        ok: true,
        command: format.fill.type === 'none' ? null : { type: 'setShapeFill', visible: false },
      };
    case 'noOutline':
      return {
        ok: true,
        command:
          format.outline.visible === false ? null : { type: 'setShapeOutline', visible: false },
      };
    case 'fillTransparency': {
      if (format.fill.type !== 'solid') return fail('shape.pane.errors.noSolidFill');
      const percent = parseNumber(change.text, /%$/);
      if (percent === null || percent < 0 || percent > 100)
        return fail('shape.pane.errors.transparency');
      return {
        ok: true,
        command:
          Math.round(format.fill.transparency * 100) === percent
            ? null
            : { type: 'setShapeFill', transparency: percent / 100 },
      };
    }
    case 'outlineDash': {
      if (!isShapeOutlineDash(change.dash)) return fail('shape.pane.errors.dash');
      // A dash shows the outline, as a width does.
      return {
        ok: true,
        command:
          format.outline.visible === true && format.outline.dash === change.dash
            ? null
            : { type: 'setShapeOutline', visible: true, dash: change.dash },
      };
    }
    case 'outlineWidth': {
      const widthPt = parseNumber(change.text, /pt$/i);
      if (widthPt === null || widthPt < 0.25 || widthPt > MAX_OUTLINE_PT)
        return fail('shape.pane.errors.width');
      // A width shows the outline, as picking a weight for a shape with no line does.
      return {
        ok: true,
        command:
          format.outline.visible === true && format.outline.widthPt === widthPt
            ? null
            : { type: 'setShapeOutline', visible: true, widthPt },
      };
    }
  }
}

/** The i18n key that names a fill: `Gradient`, `No fill`, and so on. @public */
export function shapeFillLabelKey(
  fill: ShapeFillState
): `shape.pane.fillTypes.${ShapeFillState['type']}` {
  return `shape.pane.fillTypes.${fill.type}`;
}

/** Whether the pane can show a fill's color and transparency: a solid fill or no fill. @public */
export const shapeFillEditable = (fill: ShapeFillState): boolean =>
  fill.type === 'solid' || fill.type === 'none';

/** `#RRGGBB` as the hex field shows it, or empty for no color. @public */
export const shapeHexText = (color: string | null): string =>
  color && /^[0-9A-Fa-f]{6}$/.test(color) ? `#${color.toUpperCase()}` : '';

/** The transparency field's text: a whole percent, or empty when the fill is not solid. @public */
export const shapeTransparencyText = (fill: ShapeFillState): string =>
  fill.type === 'solid' ? String(Math.round(fill.transparency * 100)) : '';

/** The width field's text in points, or empty when the shapes of a group disagree. @public */
export const shapeWidthText = (widthPt: number | null): string =>
  widthPt === null ? '' : String(Math.round(widthPt * 100) / 100);

/**
 * Whether the grid swatch `swatchPick` is the shape's current pick `current` (from
 * `shapeFillPick` or `shapeOutlinePick`): the grid marks it as the current color. @public
 */
export const shapeSwatchCurrent = (swatchPick: ColorPick, current: ColorPick | null): boolean =>
  colorPickIsCurrent(swatchPick, current);

/**
 * The grid pick of a color: its theme pick (`accent1`, `accent1:40`) when `theme` says the
 * markup is a theme reference, else the standard color that paints `color` (`RRGGBB`), else
 * `#RRGGBB`. An `RRGGBB` that matches a theme color is not named as one. Null for no color.
 * @public
 */
export function shapeColorPick(
  color: string | null,
  _themeHexes: readonly string[],
  theme?: ShapeThemeColor
): ColorPick | null {
  return colorPickOf(color, theme);
}

/** The current grid pick of a fill, or null when it is not solid. @public */
export const shapeFillPick = (
  fill: ShapeFillState,
  themeHexes: readonly string[]
): ColorPick | null =>
  fill.type === 'solid' ? shapeColorPick(fill.color, themeHexes, fill.theme) : null;

/** The current grid pick of an outline, or null when it is hidden or mixed. @public */
export const shapeOutlinePick = (
  outline: ShapeOutlineState,
  themeHexes: readonly string[]
): ColorPick | null =>
  outline.visible ? shapeColorPick(outline.color, themeHexes, outline.theme) : null;

/** What the fill's color button says: a color name, No fill, Gradient, and so on. @public */
export function shapeFillSummary(
  fill: ShapeFillState,
  themeHexes: readonly string[],
  t: ColorPickerTranslate
): string {
  const pick = shapeFillPick(fill, themeHexes);
  return pick ? colorPickLabel(pick, t) : t(shapeFillLabelKey(fill));
}

/** What the outline's color button says: a color name, No line, or Mixed. @public */
export function shapeOutlineSummary(
  outline: ShapeOutlineState,
  themeHexes: readonly string[],
  t: ColorPickerTranslate
): string {
  if (outline.visible === false) return t('shape.pane.noOutline');
  const pick = shapeOutlinePick(outline, themeHexes);
  return pick ? colorPickLabel(pick, t) : t('shape.pane.fillTypes.mixed');
}

/** What the dash list shows: the dash's name, Custom, or empty when the shapes disagree. @public */
export const shapeDashValue = (outline: ShapeOutlineState): ShapeOutlineDash | 'custom' | '' =>
  outline.dash ?? '';
