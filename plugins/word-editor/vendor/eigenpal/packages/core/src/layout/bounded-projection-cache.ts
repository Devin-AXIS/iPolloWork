/** Keep interactive view combinations from growing an immutable-root cache without bound. */
const MAX_PROJECTIONS_PER_ROOT = 8;

export function cacheProjection<K, V>(cache: Map<K, V>, key: K, value: V): void {
  if (!cache.has(key) && cache.size >= MAX_PROJECTIONS_PER_ROOT) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, value);
}
