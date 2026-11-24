// The dash pattern and shadow of a legacy VML text box shape.
//
// Dash lengths are multiples of the outline width. The named styles follow the measured
// patterns, and a custom pattern of one dash and one gap is used as written; other custom
// patterns paint solid. A shadow is the shape painted again under itself in one colour,
// offset on the page; it paints only when switched on. A plain shadow copies the outline, and
// the text of an unfilled shape; an obscured one is the solid silhouette, seen only outside the
// shape. Every value is bounded here.

import type { OoxmlElement } from './ooxml-tree.ts';
import { attribute as a, color, numeric, off, points, vmlFraction } from './legacy-vml-values.ts';

const EMU_PER_POINT = 12_700;
const MAX_SHADOW_OFFSET_POINTS = 1000;

// A Map, so a file-supplied style name never reaches an inherited object property.
const DASH_STYLES: ReadonlyMap<string, readonly number[]> = new Map([
  ['shortdash', [3, 1]],
  ['shortdot', [1, 1]],
  ['shortdashdot', [3, 1, 1, 1]],
  ['shortdashdotdot', [3, 1, 1, 1, 1, 1]],
  ['dot', [1, 3]],
  ['dash', [4, 3]],
  ['longdash', [8, 3]],
  ['dashdot', [4, 3, 1, 3]],
  ['longdashdot', [8, 3, 1, 3]],
  ['longdashdotdot', [8, 3, 1, 3, 1, 3]],
]);

/** The dash pattern of `v:stroke/@dashstyle`, in outline widths; undefined for solid. */
export function legacyDashPattern(stroke: OoxmlElement | undefined): readonly number[] | undefined {
  const raw = stroke ? a(stroke, 'dashstyle')?.trim().toLowerCase() : undefined;
  if (!raw || raw === 'solid') return undefined;
  const named = DASH_STYLES.get(raw);
  if (named) return Object.freeze([...named]);
  const custom = raw.split(/\s+/).map(numeric);
  if (custom.length === 2 && custom.every((value) => value > 0 && value <= 100))
    return Object.freeze(custom);
  return undefined;
}

/** `v:stroke/@endcap`: how dashes end. Undefined for the flat default. */
export function legacyStrokeCap(stroke: OoxmlElement | undefined): 'round' | 'square' | undefined {
  const raw = stroke ? a(stroke, 'endcap')?.trim().toLowerCase() : undefined;
  return raw === 'round' ? 'round' : raw === 'square' ? 'square' : undefined;
}

/** A text box shadow: colour, opacity and page offset. */
export interface LegacyTextboxShadow {
  readonly hex: string;
  readonly alpha: number;
  readonly offsetXEmu: number;
  readonly offsetYEmu: number;
  /** The shadow is the solid silhouette, seen only outside the shape. */
  readonly obscured: boolean;
}

/** An opacity in [0, 1]: a fraction, or 16.16 fixed point with an `f` suffix. */
function opacity(raw: string | undefined): number {
  const parsed = raw?.trim() ? vmlFraction(raw) : 1;
  return parsed !== undefined && Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : NaN;
}

/**
 * The shadow `v:shadow` paints, or undefined when it paints none. A perspective, emboss or
 * other shaped shadow is outside this subset and paints none.
 */
export function legacyTextboxShadow(
  shadow: OoxmlElement | undefined
): LegacyTextboxShadow | undefined {
  if (!shadow) return undefined;
  const on = a(shadow, 'on');
  if (on === undefined || off(on)) return undefined;
  const type = a(shadow, 'type')?.trim().toLowerCase();
  if (type && type !== 'single' && type !== 'double') return undefined;
  if (a(shadow, 'matrix')) return undefined;
  const hex = color(a(shadow, 'color'), '#808080');
  const alpha = opacity(a(shadow, 'opacity'));
  const parts = (a(shadow, 'offset') ?? '2pt,2pt').split(',');
  if (!hex || !Number.isFinite(alpha) || parts.length > 2) return undefined;
  const dx = parts[0]?.trim() ? points(parts[0].trim()) : 2;
  const dy = parts[1]?.trim() ? points(parts[1].trim()) : 2;
  if (![dx, dy].every((v) => Number.isFinite(v) && Math.abs(v) <= MAX_SHADOW_OFFSET_POINTS))
    return undefined;
  return Object.freeze({
    hex: hex.slice(1).toUpperCase(),
    alpha,
    offsetXEmu: Math.round(dx * EMU_PER_POINT),
    offsetYEmu: Math.round(dy * EMU_PER_POINT),
    obscured: a(shadow, 'obscured') !== undefined && !off(a(shadow, 'obscured')),
  });
}
