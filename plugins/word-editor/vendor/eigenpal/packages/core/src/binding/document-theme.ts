// Theme colour derivation: the document's `a:clrScheme`, projected for a colour picker.
//
// Reads the CANONICAL theme tree — never the DOM, never the layout. Word's picker shows
// ten theme columns (Background 1, Text 1, Background 2, Text 2, Accent 1-6); this module
// answers those ten base colours in that order. Tint/shade variants are presentation and
// belong to the chrome that draws the matrix.
//
// Every hex that leaves this module is validated here: scheme colours are authored file
// content, and downstream sinks (inline swatch backgrounds, `w:color` writes) must only
// receive values this module has already bounded.

import type { OoxmlElement } from '../store/package/ooxml-tree.ts';
import { collectThemeSchemeFaces } from '../store/package/theme-font-scheme.ts';
import { collectThemeColorScheme } from '../store/package/theme-color-resolution.ts';

/**
 * The scheme slots the picker shows, in Word's column order.
 *
 * Assumes the default `w:clrSchemeMapping` (bg1→lt1, t1→dk1, ...); a settings part
 * that remaps them is rare and a follow-up.
 */
const PICKER_SLOTS = [
  'lt1',
  'dk1',
  'lt2',
  'dk2',
  'accent1',
  'accent2',
  'accent3',
  'accent4',
  'accent5',
  'accent6',
] as const;

export type ThemeColorSlot = (typeof PICKER_SLOTS)[number];

/** One theme colour: the scheme slot and its resolved six-digit hex (no '#'). */
export interface DocumentThemeColorEntry {
  readonly slot: ThemeColorSlot;
  readonly hex: string;
}

export type { DocumentThemeFonts } from '../store/package/theme-font-scheme.ts';
import type { DocumentThemeFonts } from '../store/package/theme-font-scheme.ts';

/**
 * The theme part's `a:fontScheme` typefaces. Independent slots — a valid minor font
 * is answered even when the major is missing or invalid, unlike the colour scheme's
 * all-or-nothing rule, because each resolves a different `w:rFonts` attribute.
 */
export function collectDocumentThemeFonts(
  themeRoot: OoxmlElement | null,
  settingsRoot: OoxmlElement | null = null,
  fontTableRoot: OoxmlElement | null = null
): DocumentThemeFonts {
  return collectThemeSchemeFaces(themeRoot, settingsRoot, fontTableRoot);
}

/**
 * The ten picker colours of a theme part's `a:clrScheme`, or `[]` when the scheme is
 * absent or incomplete — all or nothing, so chrome can fall back to a default palette
 * rather than showing a matrix with holes.
 */
export function collectDocumentThemeColors(
  themeRoot: OoxmlElement | null
): readonly DocumentThemeColorEntry[] {
  const scheme = collectThemeColorScheme(themeRoot);
  const entries: DocumentThemeColorEntry[] = [];
  for (const slot of PICKER_SLOTS) {
    const hex = scheme.get(slot);
    if (!hex) return [];
    entries.push({ slot, hex });
  }
  return entries;
}
