// Replay an EMF or WMF picture into vector drawing commands, for an exporter that draws the
// metafile itself rather than a raster of it.
//
// The replay is the installed metafile renderer's (`store/package/drawing-renderers.ts`).
// Without one, every metafile declines, and the exporter keeps its placeholder.

import { drawingRenderers } from '../store/package/drawing-renderers.ts';
import type { MetafileFont, MetafileReplay } from '../store/package/metafile-drawing.ts';

export type {
  MetafileCommand,
  MetafileDrawing,
  MetafileFont,
  MetafileMatrix,
  MetafilePaint,
  MetafilePathCommand,
  MetafileRaster,
  MetafileReplay,
} from '../store/package/metafile-drawing.ts';

/** Options for {@link replayMetafile}. @internal */
export interface MetafileReplayOptions {
  /** Advance width of `text` in `font`, in pixels at `font.sizePx`. */
  readonly measureText: (text: string, font: MetafileFont) => number;
}

/**
 * Replay an EMF or WMF picture into vector drawing commands in canvas pixels, through the
 * installed metafile renderer. Null when the bytes do not replay, or when no metafile renderer
 * is installed. Text keeps its face and position; the caller shapes and draws it.
 * @internal
 */
export function replayMetafile(
  bytes: Uint8Array,
  mime: 'image/x-emf' | 'image/x-wmf',
  options: MetafileReplayOptions
): Promise<MetafileReplay | null> {
  const renderer = drawingRenderers().metafile;
  return renderer
    ? renderer.replay(bytes, mime, { textAdvance: options.measureText })
    : Promise.resolve(null);
}
