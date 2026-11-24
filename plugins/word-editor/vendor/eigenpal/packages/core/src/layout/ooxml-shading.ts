// Shared OOXML shading fill resolution (paragraph, run, table cell).
//
// `w:shd/@w:fill` and `@w:color` are attacker-controlled. Only a strict 6-hex RRGGBB leaves this
// boundary; theme fills, CSS/URL payloads, and other values are rejected. A pattern mixes its
// colour into its fill and paints as one solid colour. Measurement never reads shading —
// resolve and paint only.
//
// Paragraph shading geometry is the line/content band only: Word does not extend `w:pPr/w:shd`
// into before/after spacing or bottom-border extent. Layout publishes that box; paint must not
// invent it from the fragment outer box.

import { WML_NAMESPACE_URI, type OoxmlElement } from '@docx-editor.dev/core/store';
import type { OoxmlProperty } from '../store/store/tree-op-types.ts';
import type { LayoutBox } from './semantic-records.ts';

const STRICT_HEX = /^[0-9A-Fa-f]{6}$/;

/**
 * Strict hex fill: exactly six hex digits. Rejects `auto`, `nil`, and any non-hex payload
 * (CSS functions, URLs, short hex, theme tokens).
 */
export function resolveStrictHexFill(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === 'auto' || raw === 'nil') return undefined;
  if (!STRICT_HEX.test(raw)) return undefined;
  return raw.toUpperCase();
}

/** How much of a hatch pattern its colour covers, in ten-thousandths, from reference renderings. */
// A Map, so a file-supplied `val` such as `constructor` never reads an Object prototype key.
const HATCH_COVERAGE: ReadonlyMap<string, number> = new Map([
  ['horzStripe', 5000],
  ['vertStripe', 5000],
  ['diagStripe', 5000],
  ['reverseDiagStripe', 5000],
  ['horzCross', 5000],
  ['diagCross', 7500],
  ['thinHorzStripe', 2500],
  ['thinVertStripe', 2500],
  ['thinDiagStripe', 2500],
  ['thinReverseDiagStripe', 2500],
  ['thinHorzCross', 4375],
  ['thinDiagCross', 4375],
]);

/** `pct12`, `pct37`, `pct62` and `pct87` are the eighths: 12.5, 37.5, 62.5 and 87.5 percent. */
const PERCENT_PATTERN =
  /^pct(5|10|12|15|20|25|30|35|37|40|45|50|55|60|62|65|70|75|80|85|87|90|95)$/;

/** The share of a `w:shd` pattern its colour covers, in ten-thousandths, or null for `clear`. */
function patternCoverage(val: string | undefined): number | null {
  if (val === 'solid') return 10000;
  const percent = val === undefined ? null : PERCENT_PATTERN.exec(val);
  if (percent) {
    const value = Number(percent[1]);
    return value % 25 === 12 ? value * 100 + 50 : value * 100;
  }
  return (val !== undefined && HATCH_COVERAGE.get(val)) || null;
}

/** One channel of `color` over `fill` at `coverage`, half a step rounding away from the fill. */
function mixChannel(fill: number, color: number, coverage: number): number {
  const scaled = (color - fill) * coverage;
  return fill + Math.sign(scaled) * Math.floor((Math.abs(scaled) + 5000) / 10000);
}

function mixHex(fill: string, color: string, coverage: number): string {
  let out = '';
  for (let at = 0; at < 6; at += 2) {
    const mixed = mixChannel(
      Number.parseInt(fill.slice(at, at + 2), 16),
      Number.parseInt(color.slice(at, at + 2), 16),
      coverage
    );
    out += mixed.toString(16).padStart(2, '0');
  }
  return out.toUpperCase();
}

/**
 * Resolve a `w:shd` attribute bag to a validated RRGGBB fill, or undefined.
 *
 * `w:themeFill` is a REFERENCE, and Word always writes the value it resolved to alongside
 * it: `<w:shd w:val="clear" w:fill="D9E2F3" w:themeFill="accent1" w:themeFillTint="33"/>`.
 * Reading `w:fill` in that case is not inventing a colour from the theme — it is reading
 * the colour the producer computed. Dropping the fill because a theme reference sat next
 * to it left every accent-shaded cell and paragraph unpainted.
 *
 * `val="nil"` clears shading, and `clear` paints the fill alone. Any other pattern mixes
 * `w:color` into `w:fill` by the share it covers: `pct50` is half of each, `solid` is the colour
 * alone. Each channel rounds half a step away from the fill, as reference renderings do. Under
 * a pattern an `auto` colour is black and an `auto` or absent fill is white. A hatch (stripes
 * and crosses) paints as one colour of the same average, where the reference draws its lines.
 */
export function resolveOoxmlShadingFill(
  attributes: Readonly<Record<string, string>> | undefined
): string | undefined {
  if (!attributes) return undefined;
  if (attributes.val === 'nil') return undefined;
  const coverage = patternCoverage(attributes.val);
  const fill = resolveStrictHexFill(attributes.fill);
  if (coverage === null) return fill;
  // A theme colour with no resolved hex `w:color` beside it is not guessed: the fill stands alone.
  if (
    attributes.themeColor !== undefined &&
    (attributes.color === undefined || attributes.color === 'auto')
  )
    return fill;
  const color =
    attributes.color === undefined || attributes.color === 'auto'
      ? '000000'
      : resolveStrictHexFill(attributes.color);
  // A colour that is neither `auto` nor hex cannot be mixed: the fill stands alone.
  if (color === undefined) return fill;
  return mixHex(fill ?? 'FFFFFF', color, coverage);
}

function shadingAttributes(shd: OoxmlElement): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const attribute of shd.attributes) {
    if (attribute.namespaceUri === WML_NAMESPACE_URI)
      attributes[attribute.localName] = attribute.value;
  }
  return attributes;
}

/** Read `w:shd` from a typed/generic element (table `tcPr`, nested `pPr`, …). */
export function shadingFillFromElement(shd: OoxmlElement | null | undefined): string | undefined {
  if (!shd || shd.localName !== 'shd') return undefined;
  return resolveOoxmlShadingFill(shadingAttributes(shd));
}

/**
 * What one layer's `w:shd` states: its fill, `null` when it states shading that paints no
 * colour (an `auto` fill under `clear`), or undefined when it states none (absent or `nil`).
 * A stated `null` hides the layers below it; undefined leaves them showing.
 */
export function statedShadingFill(shd: OoxmlElement | null | undefined): string | null | undefined {
  if (!shd || shd.localName !== 'shd') return undefined;
  const attributes = shadingAttributes(shd);
  if (attributes.val === 'nil') return undefined;
  return resolveOoxmlShadingFill(attributes) ?? null;
}

/**
 * Resolve paragraph shading from cascaded flat `w:pPr` properties.
 *
 * Later `w:shd` entries win (defaults → style → direct), matching spacing/border cascade.
 */
export function paragraphShading(props: readonly OoxmlProperty[]): string | undefined {
  let fill: string | undefined;
  for (const property of props) {
    if (property.localName !== 'shd') continue;
    fill = resolveOoxmlShadingFill(property.attributes);
  }
  return fill;
}

/**
 * Page-content box for paragraph shading: union of this fragment's line boxes.
 *
 * Excludes collapsed before/after spacing and bottom-border extent so the painted band
 * matches Word's content-area fill (character shading height on a single line).
 */
export function paragraphShadingBox(
  lines: readonly { readonly box: LayoutBox }[],
  x: number,
  width: number
): LayoutBox | undefined {
  if (lines.length === 0) return undefined;
  const top = lines[0]!.box.y;
  const last = lines[lines.length - 1]!.box;
  return {
    x,
    y: top,
    width,
    height: Math.max(last.y + last.height - top, 0),
  };
}

/**
 * The colour of automatic text on a `background` fill: white on a dark fill, null for the
 * default black. A fill is dark when its luma (0.299 R + 0.587 G + 0.114 B, out of 255) is
 * under 59.5: grey `3B3B3B` takes white text and `3C3C3C` black, as measured.
 *
 * @internal
 */
export function automaticTextColor(background: string | null | undefined): 'FFFFFF' | null {
  if (!background || !/^[0-9A-Fa-f]{6}$/.test(background)) return null;
  const channel = (at: number) => parseInt(background.slice(at, at + 2), 16);
  const luma = 0.299 * channel(0) + 0.587 * channel(2) + 0.114 * channel(4);
  return luma < 59.5 ? 'FFFFFF' : null;
}
