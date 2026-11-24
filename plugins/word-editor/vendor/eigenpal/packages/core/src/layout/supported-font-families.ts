// Catalog metadata is not font data: it never contributes to face/byte budgets.
const MAX_SUPPORTED_FAMILIES = 2048;
const FONT_NAME = /^[\p{L}\p{N}\p{M} \-.+_,;]{1,64}$/u;

export function supportedFontFamilies(lists: readonly unknown[]): readonly string[] {
  const names = new Map<string, string>();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const family of list.slice(0, MAX_SUPPORTED_FAMILIES)) {
      if (typeof family !== 'string' || !FONT_NAME.test(family)) continue;
      const key = family.toLowerCase();
      if (!names.has(key)) names.set(key, family);
      if (names.size === MAX_SUPPORTED_FAMILIES) break;
    }
    if (names.size === MAX_SUPPORTED_FAMILIES) break;
  }
  return Object.freeze([...names.values()]);
}
