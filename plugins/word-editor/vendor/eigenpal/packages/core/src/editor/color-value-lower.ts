// Lower public `ColorValue` to store `TreeDocColorValue` for table property ops.
//
// Shared by table command planning and adapter chrome — tint/shade semantics follow
// reference/quick-ref/themes-colors.md:110-133 (OOXML byte-quantized modifiers).

import type { ColorValue } from '@docx-editor.dev/core/contracts/editor';
import type { DocumentThemeColorEntry } from '../binding/document-theme.ts';
import type { TreeDocColorValue } from '../store/store/tree-op-types.ts';

const STRICT_HEX = /^[0-9A-Fa-f]{6}$/;

const THEME_SLOT_ALIASES: Readonly<Record<string, string>> = {
  dk1: 'dk1',
  lt1: 'lt1',
  dk2: 'dk2',
  lt2: 'lt2',
  accent1: 'accent1',
  accent2: 'accent2',
  accent3: 'accent3',
  accent4: 'accent4',
  accent5: 'accent5',
  accent6: 'accent6',
  hlink: 'hlink',
  folhlink: 'folHlink',
  dark1: 'dk1',
  light1: 'lt1',
  dark2: 'dk2',
  light2: 'lt2',
  hyperlink: 'hlink',
  followedhyperlink: 'folHlink',
  background1: 'lt1',
  text1: 'dk1',
  background2: 'lt2',
  text2: 'dk2',
  tx1: 'dk1',
  tx2: 'dk2',
  bg1: 'lt1',
  bg2: 'lt2',
};

const DEFAULT_THEME: Readonly<Record<string, string>> = {
  dk1: '000000',
  lt1: 'FFFFFF',
  dk2: '44546A',
  lt2: 'E7E6E6',
  accent1: '4472C4',
  accent2: 'ED7D31',
  accent3: 'A5A5A5',
  accent4: 'FFC000',
  accent5: '5B9BD5',
  accent6: '70AD47',
  hlink: '0563C1',
  folHlink: '954F72',
};

/** Clamp and validate an OOXML theme modifier fraction (0, 1]. */
export function validateThemeModifier(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1;
}

export function clampThemeModifier(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace(/^#/, '').padStart(6, '0').slice(0, 6);
  return {
    r: parseInt(normalized.slice(0, 2), 16) || 0,
    g: parseInt(normalized.slice(2, 4), 16) || 0,
    b: parseInt(normalized.slice(4, 6), 16) || 0,
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0');
  return `${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

/** Blend toward white. `keep` is the fraction of the base colour retained (OOXML themeTint byte). */
export function applyThemeTint(hex: string, keep: number): string {
  if (keep >= 1) return hex.toUpperCase();
  if (keep <= 0) return 'FFFFFF';
  const tintByte = Math.max(0, Math.min(255, Math.round((1 - clampThemeModifier(keep)) * 255)));
  const t = tintByte / 255;
  const rgb = hexToRgb(hex);
  return rgbToHex(t * 255 + (1 - t) * rgb.r, t * 255 + (1 - t) * rgb.g, t * 255 + (1 - t) * rgb.b);
}

/** Blend toward black. `keep` is the fraction of the base colour retained (OOXML themeShade byte). */
export function applyThemeShade(hex: string, keep: number): string {
  if (keep >= 1) return hex.toUpperCase();
  if (keep <= 0) return '000000';
  const shadeByte = Math.max(0, Math.min(255, Math.round(clampThemeModifier(keep) * 255)));
  const s = shadeByte / 255;
  const rgb = hexToRgb(hex);
  return rgbToHex(s * rgb.r, s * rgb.g, s * rgb.b);
}

function normalizeThemeSlot(slot: string): string | null {
  const key = THEME_SLOT_ALIASES[slot] ?? THEME_SLOT_ALIASES[slot.toLowerCase()];
  return key ?? null;
}

function resolveThemeBaseHex(
  slot: string,
  themeColors: readonly DocumentThemeColorEntry[]
): string | null {
  const key = normalizeThemeSlot(slot);
  if (!key) return null;
  const fromDoc = themeColors.find((entry) => entry.slot === key)?.hex;
  if (fromDoc && STRICT_HEX.test(fromDoc)) return fromDoc.toUpperCase();
  const fallback = DEFAULT_THEME[key];
  return fallback && STRICT_HEX.test(fallback) ? fallback.toUpperCase() : null;
}

/** Resolve a theme colour to literal hex. When both tint and shade are present, ECMA-376
 *  §17.3.2.6 / §17.3.4 / §17.3.5 require tint precedence — shade is ignored for paint. */
export function resolveThemeColorHex(
  color: Extract<ColorValue, { kind: 'theme' }>,
  themeColors: readonly DocumentThemeColorEntry[]
): { ok: true; hex: string } | { ok: false; reason: string } {
  const base = resolveThemeBaseHex(color.slot, themeColors);
  if (!base) {
    return { ok: false, reason: 'the theme colour could not be resolved for this document' };
  }
  if (color.tint !== undefined && !validateThemeModifier(color.tint)) {
    return { ok: false, reason: 'theme tint is out of range' };
  }
  if (color.shade !== undefined && !validateThemeModifier(color.shade)) {
    return { ok: false, reason: 'theme shade is out of range' };
  }
  let hex = base;
  if (color.tint !== undefined) {
    hex = applyThemeTint(hex, clampThemeModifier(color.tint));
  } else if (color.shade !== undefined) {
    hex = applyThemeShade(hex, clampThemeModifier(color.shade));
  }
  return { ok: true, hex };
}

export type ColorLowerRefusal = { readonly ok: false; readonly reason: string };

/**
 * A public colour lowered for a border or fill op, or the reason it could not be.
 *
 * Refusals happen because paint needs a literal: a theme colour the document's theme does not
 * define has no hex to draw, and inventing one would show a border in a colour the file never
 * named.
 */
export type ColorLowerResult =
  { readonly ok: true; readonly color: TreeDocColorValue } | ColorLowerRefusal;

/** Border/fill auto resolves to Word's automatic text colour for paint; XML keeps `auto`. */
const AUTO_BORDER_RENDER_HEX = '000000';

/**
 * Lower a public colour for table border ops. Theme colours require a resolved literal for
 * paint; `auto` preserves OOXML automatic semantics with a black render fallback.
 */
export function lowerColorValueForBorder(
  color: ColorValue,
  themeColors: readonly DocumentThemeColorEntry[]
): ColorLowerResult {
  if (color.kind === 'hex') {
    const value = color.value.toUpperCase();
    return STRICT_HEX.test(value)
      ? { ok: true, color: { kind: 'hex', value } }
      : { ok: false, reason: 'border colour requires a six-digit hex value' };
  }
  if (color.kind === 'auto') {
    return { ok: true, color: { kind: 'auto', resolvedHex: AUTO_BORDER_RENDER_HEX } };
  }
  const resolved = resolveThemeColorHex(color, themeColors);
  if (!resolved.ok) return resolved;
  const slot = normalizeThemeSlot(color.slot) ?? color.slot;
  return {
    ok: true,
    color: {
      kind: 'theme',
      slot,
      resolvedHex: resolved.hex,
      ...(color.tint !== undefined ? { tint: color.tint } : {}),
      ...(color.shade !== undefined ? { shade: color.shade } : {}),
    },
  };
}

/**
 * Lower a public colour for cell fill. `auto` refuses because the cascade literal
 * cannot be named honestly at commit time.
 */
export function lowerColorValueForFill(
  color: ColorValue,
  themeColors: readonly DocumentThemeColorEntry[]
): ColorLowerResult {
  if (color.kind === 'auto') {
    return { ok: false, reason: 'automatic fill cannot be written without a resolved colour' };
  }
  if (color.kind === 'hex') {
    const value = color.value.toUpperCase();
    return STRICT_HEX.test(value)
      ? { ok: true, color: { kind: 'hex', value } }
      : { ok: false, reason: 'fill colour requires a six-digit hex value' };
  }
  const resolved = resolveThemeColorHex(color, themeColors);
  if (!resolved.ok) return resolved;
  const slot = normalizeThemeSlot(color.slot) ?? color.slot;
  return {
    ok: true,
    color: {
      kind: 'theme',
      slot,
      resolvedHex: resolved.hex,
      ...(color.tint !== undefined ? { tint: color.tint } : {}),
      ...(color.shade !== undefined ? { shade: color.shade } : {}),
    },
  };
}

/** Resolve any public colour to a CSS `#RRGGBB` string for chrome display. */
export function resolveColorValueToCss(
  color: ColorValue | undefined | null,
  themeColors: readonly DocumentThemeColorEntry[],
  defaultHex = '000000'
): string {
  if (!color || color.kind === 'auto') return `#${defaultHex}`;
  if (color.kind === 'hex') {
    const value = color.value.replace(/^#/, '').toUpperCase();
    return STRICT_HEX.test(value) ? `#${value}` : `#${defaultHex}`;
  }
  const resolved = resolveThemeColorHex(color, themeColors);
  return `#${resolved.ok ? resolved.hex : defaultHex}`;
}
