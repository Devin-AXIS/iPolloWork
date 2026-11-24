// Independent ECMA WordprocessingML theme tint/shade expectations.
//
// Paint formulas — reference/quick-ref/themes-colors.md:110-133:
//   tint:  final = (tintByte/255)*white + (1 - tintByte/255)*theme   (per channel, rounded)
//   shade: final = (shadeByte/255)*theme                               (per channel, rounded)
//
// When both modifiers are authored, ECMA-376 §17.3.2.6 states themeShade is ignored if
// themeTint is supplied (same rule in §17.3.4 borders and §17.3.5 shading).
// CT_Color permits both attributes (reference/ecma-376/part1/schemas/wml.xsd:152-157).
// This file does NOT import production tint/shade helpers.

import { describe, expect, test } from 'bun:test';
import { lowerColorValueForBorder, resolveThemeColorHex } from '../color-value-lower.ts';

function parseHex(hex: string): { readonly r: number; readonly g: number; readonly b: number } {
  const normalized = hex.replace(/^#/, '').padStart(6, '0').slice(0, 6);
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
}

function channelRound(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function toHex(r: number, g: number, b: number): string {
  const byte = (n: number) => channelRound(n).toString(16).toUpperCase().padStart(2, '0');
  return `${byte(r)}${byte(g)}${byte(b)}`;
}

/** ECMA tint with theme-retained fraction f ∈ (0,1]: tintByte = round((1-f)*255). */
function ecmaTintHex(baseHex: string, themeRetained: number): string {
  const tintByte = channelRound((1 - themeRetained) * 255);
  const t = tintByte / 255;
  const base = parseHex(baseHex);
  // final = t*white + (1-t)*theme per themes-colors.md:126
  return toHex(t * 255 + (1 - t) * base.r, t * 255 + (1 - t) * base.g, t * 255 + (1 - t) * base.b);
}

/** ECMA shade with theme-retained fraction f ∈ (0,1]: shadeByte = round(f*255). */
function ecmaShadeHex(baseHex: string, themeRetained: number): string {
  const shadeByte = channelRound(themeRetained * 255);
  const s = shadeByte / 255;
  const base = parseHex(baseHex);
  // final = s*theme per themes-colors.md:132
  return toHex(s * base.r, s * base.g, s * base.b);
}

const OFFICE_ACCENT1 = '4472C4';
const CUSTOM_ACCENT2 = 'ED7D31';

describe('ECMA theme tint/shade (independent reference)', () => {
  test('tint 50% on Office accent1 — hand check R=162 G=185 B=226', () => {
    // accent1 rgb(68,114,196); tintByte=128; R=128+127/255*68≈162 (0xA2), etc.
    expect(ecmaTintHex(OFFICE_ACCENT1, 0.5)).toBe('A2B9E2');
    const resolved = resolveThemeColorHex({ kind: 'theme', slot: 'accent1', tint: 0.5 }, [
      { slot: 'accent1', hex: OFFICE_ACCENT1 },
    ]);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.hex).toBe('A2B9E2');
  });

  test('shade 50% on Office accent1 — hand check R=34 G=57 B=98', () => {
    expect(ecmaShadeHex(OFFICE_ACCENT1, 0.5)).toBe('223962');
    const resolved = resolveThemeColorHex({ kind: 'theme', slot: 'accent1', shade: 0.5 }, [
      { slot: 'accent1', hex: OFFICE_ACCENT1 },
    ]);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.hex).toBe('223962');
  });

  test('custom document theme accent2 tint 25% retained', () => {
    const expected = ecmaTintHex(CUSTOM_ACCENT2, 0.25);
    const resolved = resolveThemeColorHex({ kind: 'theme', slot: 'accent2', tint: 0.25 }, [
      { slot: 'accent2', hex: CUSTOM_ACCENT2 },
    ]);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.hex).toBe(expected);
  });

  test('tint boundary: full theme retained leaves base unchanged', () => {
    expect(ecmaTintHex(OFFICE_ACCENT1, 1)).toBe('4472C4');
    const resolved = resolveThemeColorHex({ kind: 'theme', slot: 'accent1', tint: 1 }, [
      { slot: 'accent1', hex: OFFICE_ACCENT1 },
    ]);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.hex).toBe('4472C4');
  });

  test('shade boundary 0 is out of range', () => {
    const resolved = resolveThemeColorHex({ kind: 'theme', slot: 'accent1', shade: 0 }, [
      { slot: 'accent1', hex: OFFICE_ACCENT1 },
    ]);
    expect(resolved.ok).toBe(false);
  });

  test('both tint and shade resolve with tint precedence — shade ignored for paint', () => {
    // tint 80% retained on accent2; shade 50% would yield a darker colour if applied.
    const tintOnly = ecmaTintHex(CUSTOM_ACCENT2, 0.8);
    const shadeOnly = ecmaShadeHex(CUSTOM_ACCENT2, 0.5);
    expect(tintOnly).not.toBe(shadeOnly);
    const color = { kind: 'theme' as const, slot: 'accent2', tint: 0.8, shade: 0.5 };
    const resolved = resolveThemeColorHex(color, [{ slot: 'accent2', hex: CUSTOM_ACCENT2 }]);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.hex).toBe(tintOnly);
    expect(resolved.hex).not.toBe(shadeOnly);
    const lowered = lowerColorValueForBorder(color, [{ slot: 'accent2', hex: CUSTOM_ACCENT2 }]);
    expect(lowered.ok).toBe(true);
    if (!lowered.ok) return;
    expect(lowered.color.kind).toBe('theme');
    if (lowered.color.kind !== 'theme') return;
    expect(lowered.color.tint).toBe(0.8);
    expect(lowered.color.shade).toBe(0.5);
    expect(lowered.color.resolvedHex).toBe(tintOnly);
  });
});
