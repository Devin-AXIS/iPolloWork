// Shared font-resolution policy for export measurement and laid-out text shaping.

import { FontResolutionError, fontRequestKey, type ResolvedFont } from '../layout/font-resource.ts';
import type { LayoutShapingOptions } from '../layout/shaped-measurer.ts';

/** Weight/style inputs shared by measurement and laid-out text shaping. @internal */
export interface ShapingFontStyle {
  readonly bold: boolean;
  readonly italic: boolean;
}

/** Per-substrate request-key cache for export shaping font resolution. @internal */
export type ShapingFontResolutionCache = Map<string, ResolvedFont | FontResolutionError>;

/** Create one empty shaping font cache. @internal */
export function createShapingFontResolutionCache(): ShapingFontResolutionCache {
  return new Map();
}

/**
 * Resolve one admitted face for export shaping with the shared default-family,
 * weight/style mapping, request-key cache, and swallowed failure policy.
 * @internal
 */
export function resolveShapingFontFace(
  shaping: LayoutShapingOptions,
  cache: ShapingFontResolutionCache,
  family: string,
  style: ShapingFontStyle
): ResolvedFont | null {
  if (family.trim().length === 0) return null;
  const request = {
    family,
    weight: style.bold ? 700 : 400,
    style: style.italic ? ('italic' as const) : ('normal' as const),
  };
  const key = fontRequestKey(request);
  let result = cache.get(key);
  if (!result) {
    try {
      result = shaping.fonts.resolve(request);
    } catch {
      return null;
    }
    cache.set(key, result);
  }
  return result instanceof FontResolutionError ? null : result;
}

/**
 * Resolve one admitted face from a run style, applying the substrate default family.
 * @internal
 */
export function resolveShapingFontFromStyle(
  shaping: LayoutShapingOptions,
  cache: ShapingFontResolutionCache,
  style: ShapingFontStyle & { readonly fontFamily: string | null }
): ResolvedFont | null {
  const family = style.fontFamily ?? shaping.defaultFont.family;
  return resolveShapingFontFace(shaping, cache, family, style);
}
