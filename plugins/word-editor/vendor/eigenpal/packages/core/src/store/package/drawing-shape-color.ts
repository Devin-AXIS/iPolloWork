// DrawingML colour and fill reads for shapes: `a:srgbClr`/`a:schemeClr` with their transforms,
// resolved at the store trust boundary into validated 6-digit sRGB hex and an alpha.

import { presetColorHex } from './drawing-preset-colors.ts';
import { findDirectChild } from './drawing-shape-readers.ts';
import { isElement } from './drawing-projection-walk.ts';
import { schemaAttributeValue } from './ooxml-drawing-rules.ts';
import { DRAWINGML_MAIN_NAMESPACE_URI, type OoxmlElement, type OoxmlNode } from './ooxml-tree.ts';

/** @internal */
export type ShapeSchemeColorResolver = (scheme: string) => string | null;

const SHAPE_HEX_RE = /^[0-9A-Fa-f]{6}$/;

/** A resolved shape colour. @public */
export interface ShapeColor {
  /** Validated six-character sRGB hex, without `#`. */
  readonly hex: string;
  /** Opacity, 0..1. */
  readonly alpha: number;
}

/**
 * sRGB components, 0..1. They stay unrounded through the whole transform chain, and
 * `channelsHex` rounds them to bytes once, at the end.
 */
type Rgb = [number, number, number];

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function hexChannels(hex: string): Rgb {
  return [
    Number.parseInt(hex.slice(0, 2), 16) / 255,
    Number.parseInt(hex.slice(2, 4), 16) / 255,
    Number.parseInt(hex.slice(4, 6), 16) / 255,
  ];
}

function channelsHex(channels: Rgb): string {
  return channels
    .map((channel) =>
      Math.round(clampUnit(channel) * 255)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')
    .toUpperCase();
}

/**
 * The sRGB transfer curve (IEC 61966-2-1), between a stored sRGB component and linear light.
 *
 * `a:tint`, `a:shade`, `a:inv`, and the `a:red`/`a:green`/`a:blue` family work in linear
 * light, through this curve, and the result rounds to a byte once, at the end of the chain.
 * Rendered reference output gives these values, which fix the curve and the rounding:
 *
 * - `a:shade val="50000"` on `ED7D31` is `AE5A21`, on `4F81BD` is `385D8A`, on `4472C4` is
 *   `2F528F`, and on `5B9BD5` is `41719C`. A 2.3 power curve that truncates to a byte gives
 *   `AF5C24`, `3A5F8B`, `325491`, and `43729D`.
 * - ECMA-376 Part 1, 20.1.2.3.31 gives a worked `a:shade` example: `00FF00` at `50%` is
 *   `00BC00`. This curve with one rounding gives `00BC00`. A blend on the stored component
 *   gives `008000`.
 *
 * `a:lumMod`, `a:lumOff`, and the other HSL transforms do not use this curve. They work in
 * HSL over the stored sRGB components.
 */
function linearFromSrgb(component: number): number {
  const value = clampUnit(component);
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function srgbFromLinear(linear: number): number {
  const value = clampUnit(linear);
  return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
}

function rgbToHsl([red, green, blue]: Rgb): Rgb {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness];
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  const hue =
    max === red
      ? (green - blue) / delta + (green < blue ? 6 : 0)
      : max === green
        ? (blue - red) / delta + 2
        : (red - green) / delta + 4;
  return [hue / 6, saturation, lightness];
}

function hslToRgb([hue, saturation, lightness]: Rgb): Rgb {
  if (saturation === 0) return [lightness, lightness, lightness];
  const q =
    lightness < 0.5
      ? lightness * (1 + saturation)
      : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  const channel = (offset: number): number => {
    let value = hue + offset;
    if (value < 0) value += 1;
    if (value > 1) value -= 1;
    if (value < 1 / 6) return p + (q - p) * 6 * value;
    if (value < 1 / 2) return q;
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
    return p;
  };
  return [channel(1 / 3), channel(0), channel(-1 / 3)];
}

/**
 * `val` on `a:tint`, `a:shade`, and `a:alpha` (`ST_PositiveFixedPercentage`), as a 0..1
 * ratio, or null to refuse the colour.
 *
 * The type has two spellings, and both appear in files:
 *
 * - The integer in 1000ths of a percent (`50000`). This is an `xsd:int`, so a leading `+`
 *   and leading zeros are legal (`+50000`, `050000`).
 * - The percentage literal (`50%`, `12.5%`), whose pattern is ECMA-376 Part 1, 22.9.2.10.
 *   The spec's own worked examples use it.
 *
 * The Strict schema (Part 1) admits only the percentage literal. In the Transitional schema
 * (Part 4), `a:ST_PositiveFixedPercentage` is a union of the integer and the
 * `s:ST_PositiveFixedPercentage` percentage pattern, so a Transitional file can use either.
 *
 * Both regexes are anchored, bounded and have no nested quantifier, so a hostile `val`
 * cannot make either backtrack. Anything else (a minus sign, an exponent, whitespace,
 * more than 100000) refuses, and the caller fails the whole colour closed rather than guessing.
 *
 * The percentage pattern is wider than its value space: 22.9.2.10 admits `100.99%`, which
 * is 1.0099 as a ratio. The explicit ceiling keeps the result in 0..1 and refuses the
 * overshoot, as the integer branch refuses `100001`.
 */
function transformRatio(value: string | undefined): number | null {
  if (value === undefined) return null;
  if (/^\+?\d{1,10}$/.test(value)) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 100_000 ? parsed / 100_000 : null;
  }
  if (/^(?:100|\d{1,2})(?:\.\d{1,2})?%$/.test(value)) {
    const percent = Number(value.slice(0, -1));
    return percent >= 0 && percent <= 100 ? percent / 100 : null;
  }
  return null;
}

/** `xsd:int` bounds. A value outside them is not an `xsd:int`, so it refuses the colour. */
const XSD_INT_MAX = 2_147_483_647;
const XSD_INT_MIN = -2_147_483_648;

/** 60000ths of a degree in one turn. */
const ANGLE_TURN = 21_600_000;

/**
 * The schema type of a signed transform value (ECMA-376 Part 1, 20.1.10 and 22.9.2):
 *
 * - `percentage`: `ST_Percentage`, any `xsd:int` in 1000ths of a percent, or the
 *   percentage literal `-?[0-9]+(\.[0-9]+)?%`.
 * - `positivePercentage`: `ST_PositivePercentage`, the same with no negative value.
 * - `fixedPercentage`: `ST_FixedPercentage`, the same from -100% to 100%.
 * - `angle`: `ST_Angle`, an `xsd:int` in 60000ths of a degree. It has no percentage literal.
 */
type SignedValueKind = 'percentage' | 'positivePercentage' | 'fixedPercentage' | 'angle';

/**
 * A signed transform `val` as its raw integer (1000ths of a percent, or 60000ths of a
 * degree), or null to refuse the colour. The percentage literal (`-12.5%`) converts to the
 * same 1000ths-of-a-percent integer. A leading `+` is legal only on the integer, because the
 * percentage pattern has no `+`.
 *
 * Both regexes are anchored, bounded and have no nested quantifier, so a hostile `val`
 * cannot make either backtrack. A value outside its type's range refuses; inside it, the
 * caller clamps the result, so a large value cannot push a component out of 0..1.
 */
function signedTransformValue(value: string | undefined, kind: SignedValueKind): number | null {
  if (value === undefined) return null;
  let parsed: number;
  if (/^[+-]?\d{1,10}$/.test(value)) {
    parsed = Number(value);
    if (parsed > XSD_INT_MAX || parsed < XSD_INT_MIN) return null;
  } else if (kind !== 'angle' && /^-?\d{1,7}(?:\.\d{1,10})?%$/.test(value)) {
    parsed = Math.round(Number(value.slice(0, -1)) * 1000);
  } else return null;
  if (kind === 'positivePercentage' && parsed < 0) return null;
  if (kind === 'fixedPercentage' && Math.abs(parsed) > 100_000) return null;
  return parsed;
}

/**
 * An `ST_PositiveFixedAngle` (`a:hue`, `a:hslClr/@hue`) as a fraction of a turn, or null to
 * refuse the colour. The type is an `xsd:int` in 60000ths of a degree, 0 up to but not
 * including 21600000.
 */
function positiveFixedAngleTurn(value: string | undefined): number | null {
  const parsed = signedTransformValue(value, 'angle');
  return parsed !== null && parsed >= 0 && parsed < ANGLE_TURN ? parsed / ANGLE_TURN : null;
}

/** A colour with no theme lookup: `a:sysClr` keeps its last colour, or its system default. */
const SYSTEM_COLOR_DEFAULTS: ReadonlyMap<string, string> = new Map([
  ['windowText', '000000'],
  ['window', 'FFFFFF'],
  ['btnText', '000000'],
  ['btnFace', 'F0F0F0'],
  ['highlight', '0078D7'],
  ['highlightText', 'FFFFFF'],
  ['grayText', '6D6D6D'],
]);

/** A base colour before its transforms: sRGB components and alpha, or null to refuse. */
interface BaseColor {
  readonly channels: Rgb | null;
  readonly alpha: number;
}

function hexBase(hex: string | null | undefined): BaseColor {
  return { channels: hex && SHAPE_HEX_RE.test(hex) ? hexChannels(hex) : null, alpha: 1 };
}

function baseColor(
  color: OoxmlElement,
  resolveSchemeColor: ShapeSchemeColorResolver | undefined,
  placeholder: ShapeColor | undefined
): BaseColor {
  const token = schemaAttributeValue(color.attributes, 'val');
  switch (color.localName) {
    case 'srgbClr':
      return hexBase(token);
    case 'schemeClr':
      if (token === 'phClr' && placeholder) {
        return { channels: hexBase(placeholder.hex).channels, alpha: placeholder.alpha };
      }
      return hexBase(token !== undefined ? resolveSchemeColor?.(token) : null);
    case 'sysClr': {
      const last = schemaAttributeValue(color.attributes, 'lastClr');
      if (last !== undefined && SHAPE_HEX_RE.test(last)) return hexBase(last);
      return hexBase(token !== undefined ? SYSTEM_COLOR_DEFAULTS.get(token) : null);
    }
    case 'prstClr':
      return hexBase(presetColorHex(token));
    case 'scrgbClr': {
      // ECMA-376 Part 1, 20.1.2.3.30: linear components, through the sRGB transfer curve.
      const channels: number[] = [];
      for (const name of ['r', 'g', 'b']) {
        const percent = signedTransformValue(
          schemaAttributeValue(color.attributes, name),
          'percentage'
        );
        if (percent === null) return { channels: null, alpha: 1 };
        channels.push(srgbFromLinear(percent / 100_000));
      }
      return { channels: channels as Rgb, alpha: 1 };
    }
    case 'hslClr': {
      // ECMA-376 Part 1, 20.1.2.3.13: `hue` is an `ST_PositiveFixedAngle`, `sat` and `lum`
      // are `ST_Percentage` values, clamped to 0..1.
      const hue = positiveFixedAngleTurn(schemaAttributeValue(color.attributes, 'hue'));
      const sat = signedTransformValue(schemaAttributeValue(color.attributes, 'sat'), 'percentage');
      const lum = signedTransformValue(schemaAttributeValue(color.attributes, 'lum'), 'percentage');
      if (hue === null || sat === null || lum === null) return { channels: null, alpha: 1 };
      return {
        channels: hslToRgb([hue, clampUnit(sat / 100_000), clampUnit(lum / 100_000)]),
        alpha: 1,
      };
    }
    default:
      return { channels: null, alpha: 1 };
  }
}

const BASE_COLOR_NAMES = new Set([
  'srgbClr',
  'schemeClr',
  'sysClr',
  'scrgbClr',
  'prstClr',
  'hslClr',
]);

/**
 * The transforms that carry a signed `val` (ECMA-376 Part 1, 20.1.2.3). `space` says what
 * they change: an HSL component over the stored sRGB components, a linear-light component,
 * or alpha. `index` is the component (hue, saturation, luminance; or red, green, blue).
 * `set` replaces the component, `mod` scales it, and `off` adds to it. `kind` is the schema
 * type of `val`.
 *
 * A modulation may exceed 100%, as theme and diagram colours write it
 * (`lumMod val="102000"`).
 */
const SIGNED_TRANSFORMS: ReadonlyMap<
  string,
  {
    readonly space: 'hsl' | 'linear' | 'alpha';
    readonly index: 0 | 1 | 2;
    readonly mode: 'set' | 'mod' | 'off';
    readonly kind: SignedValueKind;
  }
> = new Map([
  ['hueOff', { space: 'hsl', index: 0, mode: 'off', kind: 'angle' }],
  ['hueMod', { space: 'hsl', index: 0, mode: 'mod', kind: 'positivePercentage' }],
  ['sat', { space: 'hsl', index: 1, mode: 'set', kind: 'percentage' }],
  ['satOff', { space: 'hsl', index: 1, mode: 'off', kind: 'percentage' }],
  ['satMod', { space: 'hsl', index: 1, mode: 'mod', kind: 'percentage' }],
  ['lum', { space: 'hsl', index: 2, mode: 'set', kind: 'percentage' }],
  ['lumMod', { space: 'hsl', index: 2, mode: 'mod', kind: 'percentage' }],
  ['lumOff', { space: 'hsl', index: 2, mode: 'off', kind: 'percentage' }],
  ['red', { space: 'linear', index: 0, mode: 'set', kind: 'percentage' }],
  ['redMod', { space: 'linear', index: 0, mode: 'mod', kind: 'percentage' }],
  ['redOff', { space: 'linear', index: 0, mode: 'off', kind: 'percentage' }],
  ['green', { space: 'linear', index: 1, mode: 'set', kind: 'percentage' }],
  ['greenMod', { space: 'linear', index: 1, mode: 'mod', kind: 'percentage' }],
  ['greenOff', { space: 'linear', index: 1, mode: 'off', kind: 'percentage' }],
  ['blue', { space: 'linear', index: 2, mode: 'set', kind: 'percentage' }],
  ['blueMod', { space: 'linear', index: 2, mode: 'mod', kind: 'percentage' }],
  ['blueOff', { space: 'linear', index: 2, mode: 'off', kind: 'percentage' }],
  ['alphaOff', { space: 'alpha', index: 0, mode: 'off', kind: 'fixedPercentage' }],
  ['alphaMod', { space: 'alpha', index: 0, mode: 'mod', kind: 'positivePercentage' }],
]);

function applyMode(mode: 'set' | 'mod' | 'off', current: number, value: number): number {
  return mode === 'set' ? value : mode === 'mod' ? current * value : current + value;
}

function mapLinear(channels: Rgb, transform: (linear: number) => number): Rgb {
  return channels.map((channel) => srgbFromLinear(transform(linearFromSrgb(channel)))) as Rgb;
}

/**
 * The transforms that carry no `val`, or null when `name` is not one of them.
 *
 * - `a:comp` (20.1.2.3.7) turns the hue by 180 degrees, in HSL.
 * - `a:inv` (20.1.2.3.17) inverts each linear-light component: `4472C4` gives `F8EBB3`.
 *   The inverse on the stored components, `BB8D3B`, does not match the measured value.
 * - `a:gray` (20.1.2.3.9) weights the stored sRGB components by the Rec. 709 primaries
 *   (0.2126, 0.7152, 0.0722): `ED7D31` gives `8F8F8F`. Rec. 601 weights give `969696`, and
 *   Rec. 709 weights on linear components give `9C9C9C`.
 * - `a:gamma` (20.1.2.3.8) and `a:invGamma` (20.1.2.3.18) apply the sRGB transfer curve and
 *   its inverse to each component, as the spec text describes them. No measured value
 *   confirms these two.
 */
function applyUnvaluedTransform(name: string, channels: Rgb): Rgb | null {
  switch (name) {
    case 'comp': {
      const hsl = rgbToHsl(channels);
      hsl[0] = (hsl[0] + 0.5) % 1;
      return hslToRgb(hsl);
    }
    case 'inv':
      return mapLinear(channels, (linear) => 1 - linear);
    case 'gray': {
      const [red, green, blue] = channels;
      const luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      return [luma, luma, luma];
    }
    case 'gamma':
      return channels.map(srgbFromLinear) as Rgb;
    case 'invGamma':
      return channels.map(linearFromSrgb) as Rgb;
    default:
      return null;
  }
}

/**
 * Resolve one DrawingML colour element and its transforms (ECMA-376 Part 1, 20.1.2.3).
 * The transforms apply in document order, each to the result of the one before it. A
 * malformed or out-of-range `val`, or an unknown transform, refuses the whole colour.
 *
 * @internal
 */
export function resolveColorNode(
  color: OoxmlNode,
  resolveSchemeColor?: ShapeSchemeColorResolver,
  placeholder?: ShapeColor
): ShapeColor | null {
  if (
    !isElement(color) ||
    !('namespaceUri' in color) ||
    color.namespaceUri !== DRAWINGML_MAIN_NAMESPACE_URI ||
    !BASE_COLOR_NAMES.has(color.localName)
  ) {
    return null;
  }
  const base = baseColor(color, resolveSchemeColor, placeholder);
  if (!base.channels) return null;
  let channels = base.channels;
  let alpha = base.alpha;
  for (const child of color.children) {
    if (!isElement(child) || child.namespaceUri !== DRAWINGML_MAIN_NAMESPACE_URI) continue;
    const name = child.localName;
    const val = schemaAttributeValue(child.attributes, 'val');
    const signed = SIGNED_TRANSFORMS.get(name);
    if (signed) {
      const raw = signedTransformValue(val, signed.kind);
      if (raw === null) return null;
      // An identity transform leaves the colour exactly as it is: no colour-space round trip.
      if (signed.mode === 'off' ? raw === 0 : signed.mode === 'mod' && raw === 100_000) continue;
      // Hue offsets are 60000ths of a degree; every other value is 1000ths of a percent.
      const value = signed.kind === 'angle' ? raw / ANGLE_TURN : raw / 100_000;
      if (signed.space === 'alpha') {
        alpha = clampUnit(applyMode(signed.mode, alpha, value));
      } else if (signed.space === 'linear') {
        const linear = channels.map(linearFromSrgb) as Rgb;
        linear[signed.index] = clampUnit(applyMode(signed.mode, linear[signed.index], value));
        channels = linear.map(srgbFromLinear) as Rgb;
      } else {
        const hsl = rgbToHsl(channels);
        const next = applyMode(signed.mode, hsl[signed.index], value);
        // Hue wraps around the turn; saturation and luminance clamp.
        hsl[signed.index] = signed.index === 0 ? ((next % 1) + 1) % 1 : clampUnit(next);
        channels = hslToRgb(hsl);
      }
      continue;
    }
    if (name === 'hue') {
      // 20.1.2.3.14: an absolute hue, as an `ST_PositiveFixedAngle`.
      const turn = positiveFixedAngleTurn(val);
      if (turn === null) return null;
      const hsl = rgbToHsl(channels);
      hsl[0] = turn;
      channels = hslToRgb(hsl);
      continue;
    }
    if (name === 'alpha' || name === 'tint' || name === 'shade') {
      const ratio = transformRatio(val);
      if (ratio === null) return null;
      if (name === 'alpha') alpha = ratio;
      // 20.1.2.3.34: `val` is the fraction of the INPUT colour, the rest white.
      else if (name === 'tint')
        channels = mapLinear(channels, (linear) => 1 - (1 - linear) * ratio);
      // 20.1.2.3.31: `val` is the fraction of the input colour, the rest black.
      else channels = mapLinear(channels, (linear) => linear * ratio);
      continue;
    }
    const unvalued = applyUnvaluedTransform(name, channels);
    if (!unvalued) return null;
    channels = unvalued;
  }
  return { hex: channelsHex(channels), alpha };
}

/** Resolve and transform one DrawingML solid fill at the store trust boundary. */
export function readSolidFill(
  parent: OoxmlElement,
  resolveSchemeColor?: ShapeSchemeColorResolver,
  placeholder?: ShapeColor
): ShapeColor | null {
  const solidFill = findDirectChild(parent.children, {
    namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
    localName: 'solidFill',
  });
  if (!solidFill) return null;
  const color = solidFill.children.find(isElement);
  return color ? resolveColorNode(color, resolveSchemeColor, placeholder) : null;
}

const FILL_ELEMENT_NAMES = new Set([
  'noFill',
  'solidFill',
  'gradFill',
  'blipFill',
  'pattFill',
  'grpFill',
]);

/** @internal */
export function directFill(
  parent: OoxmlElement,
  resolveSchemeColor?: ShapeSchemeColorResolver,
  placeholder?: ShapeColor
): { readonly present: boolean; readonly color: ShapeColor | null } {
  const authored = parent.children.find(
    (child) =>
      isElement(child) &&
      child.namespaceUri === DRAWINGML_MAIN_NAMESPACE_URI &&
      FILL_ELEMENT_NAMES.has(child.localName)
  );
  if (!authored || !isElement(authored)) return { present: false, color: null };
  return {
    present: true,
    color:
      authored.localName === 'solidFill'
        ? readSolidFill(parent, resolveSchemeColor, placeholder)
        : null,
  };
}
