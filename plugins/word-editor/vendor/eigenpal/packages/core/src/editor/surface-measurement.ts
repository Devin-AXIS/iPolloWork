import type { PaginatedSurface, PaginatedSurfaceOptions } from './paginated-surface.ts';
import { resolveDefaultSurfaceMeasurer, type CanvasMeasurerOptions } from '../layout/index.ts';
import { tryCreateBrowserCanvasContext } from './browser-canvas-context.ts';

/** The faces a surface's layout measures (`usedFontFacesOf`). */
export { createFontFaceUsage, registerUsedFontFaces, usedFontFacesOf } from './font-face-usage.ts';

type Measurement = Pick<
  PaginatedSurfaceOptions,
  'measurer' | 'producer' | 'fontAlias' | 'defaultFontFamily'
>;
const updates = new WeakMap<
  PaginatedSurface,
  (next: Measurement, restoreOnFailure: boolean) => void
>();

/** Internal seam: refresh geometry without replacing the editing session or its history. */
export function registerSurfaceMeasurement(
  surface: PaginatedSurface,
  read: () => Measurement,
  write: (next: Measurement) => void,
  refresh: () => void
): void {
  updates.set(surface, (next, restoreOnFailure) => {
    const previous = read();
    surface.flushPendingInput();
    try {
      write(next);
      refresh();
    } catch (error) {
      if (restoreOnFailure) {
        write(previous);
        refresh();
      }
      throw error;
    }
  });
}

export function updateSurfaceMeasurement(
  surface: PaginatedSurface,
  next: Measurement,
  restoreOnFailure = true
): void {
  const update = updates.get(surface);
  if (!update) throw new Error('Surface does not support measurement updates');
  update(next, restoreOnFailure);
}

/**
 * The measurer a surface uses when the host supplies none: the browser canvas of `container`'s
 * document, measuring with the faces that paint draws with (`fontAlias`). The editor creates the
 * canvas; layout only consumes the injected context.
 */
export function browserDefaultMeasurer(
  container: HTMLElement,
  scale: number,
  fontAlias: PaginatedSurfaceOptions['fontAlias'],
  serifHangulFace: CanvasMeasurerOptions['serifHangulFace']
) {
  return resolveDefaultSurfaceMeasurer(scale, {
    context: tryCreateBrowserCanvasContext(container.ownerDocument),
    ...(fontAlias ? { fontAlias } : {}),
    serifHangulFace,
  });
}
