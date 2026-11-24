import type { PaginatedSurface } from './paginated-surface-contract.ts';

/**
 * Rescale a mounted surface in place, or report that this one cannot be.
 *
 * Reaches an internal member rather than widening the surface contract, so it has to answer
 * for a surface that does not carry one — a stub or a foreign implementation. `false`, not a
 * TypeError: the caller is a host asking for zoom, and "cannot" is an answer it can render.
 */
export function setPaginatedSurfaceScale(surface: PaginatedSurface, scale: number): boolean {
  const rescale = (surface as Partial<{ setScale(nextScale: number): boolean }>).setScale;
  if (typeof rescale !== 'function') return false;
  return rescale.call(surface, scale);
}
