// Vector drawing commands a metafile (EMF or WMF) replays into, in canvas pixels.
//
// These are paint data: an exporter draws them as it draws any other vector content. The
// replay that produces them is a capability package's metafile renderer
// (`drawing-renderers.ts`); without one, a metafile picture keeps its placeholder.

/** A 2D affine matrix `[a, b, c, d, e, f]`: x' = a·x + c·y + e, y' = b·x + d·y + f. @internal */
export type MetafileMatrix = readonly [number, number, number, number, number, number];

/** One path command in canvas pixels, y down. @internal */
export type MetafilePathCommand =
  | { readonly op: 'M' | 'L'; readonly x: number; readonly y: number }
  | {
      readonly op: 'C';
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly x: number;
      readonly y: number;
    }
  | { readonly op: 'Z' };

/** A solid paint: 0–255 channels and 0–1 alpha. @internal */
export interface MetafilePaint {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly alpha: number;
}

/** The face a text command names. @internal */
export interface MetafileFont {
  readonly family: string;
  readonly sizePx: number;
  readonly bold: boolean;
  readonly italic: boolean;
}

/** Raster content a metafile draws. @internal */
export type MetafileRaster =
  | {
      readonly kind: 'rgba';
      readonly width: number;
      readonly height: number;
      readonly data: Uint8Array;
    }
  | {
      readonly kind: 'encoded';
      readonly mime: 'image/png' | 'image/jpeg';
      readonly width: number;
      readonly height: number;
      readonly bytes: Uint8Array;
    };

/**
 * One recorded drawing command. Paths are in canvas pixels with the transform already
 * applied. `matrix` on an image maps its unit square (y down) into canvas pixels; on text and
 * a nested drawing it is the transform in force when it was drawn.
 * @internal
 */
export type MetafileCommand =
  | { readonly kind: 'save' }
  | { readonly kind: 'restore' }
  | {
      readonly kind: 'fill';
      readonly path: readonly MetafilePathCommand[];
      readonly evenOdd: boolean;
      readonly paint: MetafilePaint;
    }
  | {
      readonly kind: 'stroke';
      readonly path: readonly MetafilePathCommand[];
      readonly width: number;
      readonly dash: readonly number[];
      readonly paint: MetafilePaint;
    }
  | {
      readonly kind: 'clip';
      readonly path: readonly MetafilePathCommand[];
      readonly evenOdd: boolean;
    }
  | { readonly kind: 'image'; readonly raster: MetafileRaster; readonly matrix: MetafileMatrix }
  | {
      readonly kind: 'text';
      readonly text: string;
      readonly font: MetafileFont;
      readonly x: number;
      readonly y: number;
      readonly align: 'left' | 'center' | 'right';
      readonly baseline: 'alphabetic' | 'top' | 'bottom' | 'middle';
      readonly matrix: MetafileMatrix;
      readonly paint: MetafilePaint;
    }
  | {
      readonly kind: 'drawing';
      readonly drawing: MetafileDrawing;
      readonly matrix: MetafileMatrix;
    };

/** A replayed metafile: its canvas size in pixels and its commands in order. @internal */
export interface MetafileDrawing {
  readonly width: number;
  readonly height: number;
  readonly commands: readonly MetafileCommand[];
}

/** What a metafile renderer reads beside the bytes. @internal */
export interface MetafileRenderOptions {
  /** Advance width of `text` in `font`, in pixels at `font.sizePx`. */
  readonly textAdvance: (text: string, font: MetafileFont) => number;
}

/**
 * A replayed metafile. `complete` is false when a bound or a malformed record stopped recording
 * early, and `stop` then says which. @internal
 */
export interface MetafileReplay {
  readonly drawing: MetafileDrawing;
  readonly complete: boolean;
  /**
   * Why recording stopped early: a resource bound, or a record that does not fit. Absent when
   * the replay is complete; a renderer that does not tell the two apart also leaves it out.
   */
  readonly stop?: 'resource-bound' | 'malformed-record';
}
