// Branded length units: twips and points, and the ONE conversion pair between them.
//
// The engine's rule is "points everywhere; twips convert at property-read boundaries", but a
// rule over raw `number`s is convention only — nothing stops a twips value from reaching an
// arithmetic expression that assumes points. The brands make the unit part of the type, so a
// declared `Twips` parameter refuses a raw or points-valued number at compile time.
//
// This lives in the store lane deliberately: it is the one lane every consumer of the
// conversion may import (`layout`, `automation` and `editor` all reach `store` in the lane
// DAG; none of them may reach `contracts`). See
// `packages/core/src/__tests__/core-lane-graph.ts`.

declare const TWIPS: unique symbol;
declare const POINTS: unique symbol;

/**
 * A length in twentieths of a point — OOXML's `ST_TwipsMeasure` / `ST_SignedTwipsMeasure`.
 *
 * The brand is intersection-typed onto `number`, so a `Twips` value still decays to `number`
 * wherever arithmetic consumes it; only the reverse direction — passing a raw number where
 * `Twips` is declared — is refused.
 *
 * @public
 */
export type Twips = number & { readonly [TWIPS]: true };

/**
 * A length in typographic points, the unit layout and paint compute in.
 *
 * @public
 */
export type Points = number & { readonly [POINTS]: true };

/**
 * Twentieths of a point per point.
 *
 * @public
 */
export const TWIPS_PER_POINT = 20;

/**
 * Assert that a number is a twips measurement.
 *
 * A compile-time cast, not a validator: bounds, integrality and finiteness stay at the parse
 * boundary that produced the number, exactly where they are enforced today. The cast is the
 * caller's claim about the UNIT, nothing more.
 *
 * @public
 */
export const twips = (value: number): Twips => value as Twips;

/**
 * Assert that a number is a points measurement. A compile-time cast; see {@link twips}.
 *
 * @public
 */
export const points = (value: number): Points => value as Points;

/**
 * The one twips-to-points conversion. Exact division; twips are the finer unit.
 *
 * @public
 */
export const twipsToPoints = (value: Twips): Points => (value / TWIPS_PER_POINT) as Points;

/**
 * The one points-to-twips conversion.
 *
 * Rounds to the nearest twip: every OOXML twips measurement is integral, and emitting a
 * fractional twip would write a value no consumer of the file can represent.
 *
 * @public
 */
export const pointsToTwips = (value: Points): Twips => Math.round(value * TWIPS_PER_POINT) as Twips;

// `ST_TwipsMeasure` / `ST_SignedTwipsMeasure` lexical forms. Every quantifier is bounded, so a
// hostile attribute value cannot make either pattern backtrack.
const PLAIN_TWIPS = /^([+-]?)(\d{0,9})(?:\.(\d{0,32}))?$/;
const UNIVERSAL_TWIPS = /^[+-]?(\d{0,9})(?:\.(\d{0,32}))?(mm|cm|in|pt|pc|pi)$/;

/** Twips per unit as an exact fraction, so `1.27cm` reads as 720 rather than 719. */
const UNIVERSAL_TWIPS_PER_UNIT: Readonly<Record<string, readonly [bigint, bigint]>> = {
  in: [1440n, 1n],
  pt: [20n, 1n],
  pc: [240n, 1n],
  pi: [240n, 1n],
  cm: [72_000n, 127n],
  mm: [7_200n, 127n],
};

/**
 * Read a twips attribute (`ST_TwipsMeasure`, `ST_SignedTwipsMeasure`, or a `dxa` table width)
 * as a whole, signed number of twips, or `null` when the value is not a measurement.
 *
 * The schema allows an integer or a universal measure, but files also carry decimal twips
 * (`4743.74`, `708.0`, `707.9999999999998`). The accepted forms read as follows:
 *
 * - A decimal truncates toward zero: `1443.74` is 1443 and `-720.6` is -720. A leading `+`,
 *   leading zeros, a bare fraction (`.5`) and a trailing point (`1440.`) are accepted.
 * - A universal measure (`mm`, `cm`, `in`, `pt`, `pc`, `pi`) converts exactly and then
 *   truncates: `1.27cm` is 720 and `0.333in` is 479. Its sign is ignored, so `-0.5in` is 720.
 * - Whitespace, exponents, hexadecimal, uppercase units, and an integer part longer than nine
 *   digits are not measurements.
 *
 * The result is NOT bounded. Callers apply their own sign rule and range clamp, because each
 * attribute has a different valid range and a different fallback.
 *
 * @internal
 */
export function readTwipsMeasure(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const plain = PLAIN_TWIPS.exec(raw);
  if (plain) {
    const [, sign, whole = '', fraction = ''] = plain;
    if (whole === '' && fraction === '') return null;
    const magnitude = whole === '' ? 0 : Number(whole);
    return sign === '-' && magnitude !== 0 ? -magnitude : magnitude;
  }
  const universal = UNIVERSAL_TWIPS.exec(raw);
  if (!universal) return null;
  const [, whole = '', fraction = '', unit = ''] = universal;
  const ratio = UNIVERSAL_TWIPS_PER_UNIT[unit];
  if ((whole === '' && fraction === '') || ratio === undefined) return null;
  const [numerator, denominator] = ratio;
  const mantissa = BigInt(`${whole}${fraction}`);
  // BigInt division truncates toward zero, which is the rounding a decimal value gets too.
  return Number((mantissa * numerator) / (denominator * 10n ** BigInt(fraction.length)));
}
