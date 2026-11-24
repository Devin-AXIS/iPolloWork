// Outline dash patterns (`a:prstDash`, `a:custDash`) as dash and gap lengths in multiples of
// the line width, the unit both painters scale by.

import { findDirectChild } from './drawing-shape-readers.ts';
import { isElement } from './drawing-projection-walk.ts';
import { schemaAttributeValue } from './ooxml-drawing-rules.ts';
import { DRAWINGML_MAIN_NAMESPACE_URI, type OoxmlElement } from './ooxml-tree.ts';
import type { ShapeOutlineDash } from '../store/tree-op-types.ts';

const A = DRAWINGML_MAIN_NAMESPACE_URI;
/** A custom dash list longer than this paints solid: it adds nothing visible. */
const MAX_CUSTOM_DASH_STOPS = 16;

/** ECMA-376 20.1.10.48 preset dashes: alternating dash and gap, in line widths. */
const PRESET_DASHES: ReadonlyMap<string, readonly number[] | null> = new Map([
  ['solid', null],
  ['dot', [1, 3]],
  ['dash', [4, 3]],
  ['lgDash', [8, 3]],
  ['dashDot', [4, 3, 1, 3]],
  ['lgDashDot', [8, 3, 1, 3]],
  ['lgDashDotDot', [8, 3, 1, 3, 1, 3]],
  ['sysDash', [3, 1]],
  ['sysDot', [1, 1]],
  ['sysDashDot', [3, 1, 1, 1]],
  ['sysDashDotDot', [3, 1, 1, 1, 1, 1]],
]);

/** The preset dashes a shape outline can take, in the order a dash list offers them. */
export const SHAPE_OUTLINE_DASH_PRESETS: readonly ShapeOutlineDash[] = [
  'solid',
  'sysDot',
  'sysDash',
  'dash',
  'dashDot',
  'lgDash',
  'lgDashDot',
  'lgDashDotDot',
  'sysDashDot',
  'sysDashDotDot',
  'dot',
];

/** Whether `value` names a preset dash. */
export function isShapeOutlineDash(value: unknown): value is ShapeOutlineDash {
  return typeof value === 'string' && PRESET_DASHES.has(value);
}

/**
 * The preset whose pattern is `pattern` (null is `solid`), or `custom` for any other pattern.
 * The legacy VML styles use the same patterns, so one lookup names both.
 */
export function dashPresetOf(
  pattern: readonly number[] | null | undefined
): ShapeOutlineDash | 'custom' {
  if (!pattern) return 'solid';
  for (const [name, preset] of PRESET_DASHES)
    if (preset && preset.length === pattern.length && preset.every((v, i) => v === pattern[i]))
      return name as ShapeOutlineDash;
  return 'custom';
}

function percent(element: OoxmlElement, name: string): number | null {
  const raw = schemaAttributeValue(element.attributes, name);
  if (raw === undefined) return null;
  if (/^\d{1,9}$/.test(raw)) return Number(raw) / 100_000;
  if (/^\d{1,7}(?:\.\d{1,3})?%$/.test(raw)) return Number(raw.slice(0, -1)) / 100;
  return null;
}

/**
 * The dash pattern a line names: an array of dash and gap lengths in line widths, `null` for
 * a solid line, or `undefined` when the line names none (so an inherited line decides).
 */
export function lineDash(
  line: OoxmlElement | null | undefined
): readonly number[] | null | undefined {
  if (!line) return undefined;
  const preset = findDirectChild(line.children, { namespaceUri: A, localName: 'prstDash' });
  if (preset) {
    const value = schemaAttributeValue(preset.attributes, 'val') ?? 'solid';
    return PRESET_DASHES.has(value) ? PRESET_DASHES.get(value)! : null;
  }
  const custom = findDirectChild(line.children, { namespaceUri: A, localName: 'custDash' });
  if (!custom) return undefined;
  const pattern: number[] = [];
  for (const stop of custom.children) {
    if (!isElement(stop) || stop.namespaceUri !== A || stop.localName !== 'ds') continue;
    if (pattern.length >= MAX_CUSTOM_DASH_STOPS * 2) return null;
    const dash = percent(stop, 'd');
    const gap = percent(stop, 'sp');
    if (dash === null || gap === null || dash > 1000 || gap > 1000) return null;
    pattern.push(dash, gap);
  }
  // An all-zero or empty pattern draws nothing visible as dashes; it paints solid.
  return pattern.some((value) => value > 0) && pattern.some((_, index) => index % 2 === 1)
    ? pattern
    : null;
}
