import type { OoxmlPackage } from '@docx-editor.dev/core/store';

/** Whether two maps hold the same keys with the very same values. */
function sameEntries<K, V>(a: ReadonlyMap<K, V>, b: ReadonlyMap<K, V>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [key, value] of a) if (b.get(key) !== value) return false;
  return true;
}

/**
 * Whether two packages share every byte, relationship and content type a drawing resource
 * reads. Compared entry by entry: a collaboration commit rebuilds these maps around the same
 * entries, and an identity check alone dropped every resolved picture on each commit.
 */
export function sameResourceSubstrate(a: OoxmlPackage, b: OoxmlPackage): boolean {
  return (
    sameEntries(a.partBytes, b.partBytes) &&
    sameEntries(a.relationships, b.relationships) &&
    (a.contentTypes === b.contentTypes ||
      (sameEntries(a.contentTypes.defaults, b.contentTypes.defaults) &&
        sameEntries(a.contentTypes.overrides, b.contentTypes.overrides)))
  );
}
