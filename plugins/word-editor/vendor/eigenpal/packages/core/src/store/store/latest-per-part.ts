// A small map from a part name to the value derived for it last, bounded.
//
// Part names come from the file, so a session that opens many documents, or one document
// with very many parts, must not grow the map without limit. Writing a key moves it to the
// back; past the limit the least recently written key goes. A dropped entry only costs one
// full derivation the next time that part is read.

/** Part names kept per map. A document with more stories re-derives the oldest ones. */
const LATEST_PER_PART_LIMIT = 256;

/** Records `value` as the latest for `key`, evicting the least recently written key. */
export function setLatestPerPart<V>(
  map: Map<string, V>,
  key: string,
  value: V,
  limit = LATEST_PER_PART_LIMIT
): void {
  map.delete(key);
  map.set(key, value);
  if (map.size <= limit) return;
  const oldest = map.keys().next();
  if (!oldest.done) map.delete(oldest.value);
}
