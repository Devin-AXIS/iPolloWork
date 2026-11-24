// The text art layout hook a capability package installs (`DrawingRenderers.textArtLayout`).
//
// The engine fits plain text art to its box itself. Text art whose projection carries
// `renderData` (a warp, a gradient, a shadow, an extrusion) can be laid out by an installed
// renderer instead: the engine hands it the box and a way to read glyph outlines, and paints
// the vector components it returns, in every output. The engine never reads `renderData`.
import type { VectorShapeComponent } from './drawing-shape-projection.ts';
import type { LegacyTextArtProjection } from './legacy-vml-text-art.ts';

/**
 * A string's glyph outlines in points, x right and y down from the pen origin on the
 * baseline. `path` holds only absolute `M`, `L`, `Q`, `C` and `Z` commands.
 *
 * @internal
 */
export interface TextArtOutline {
  readonly path: string;
  readonly ink: {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
  };
}

/**
 * What a text art layout reads.
 *
 * @internal
 */
export interface TextArtLayoutInput {
  readonly textArt: LegacyTextArtProjection;
  /** The unrotated shape box, in points. */
  readonly widthPt: number;
  readonly heightPt: number;
  /**
   * The outlines of `text` in the text art's face at `fontSizePt`, or null when the face has
   * no outlines for it. A face that does not resolve falls back to the document default.
   */
  readonly outline: (text: string, fontSizePt: number) => TextArtOutline | null;
}

/**
 * Text art as painted geometry.
 *
 * @internal
 */
export interface TextArtLayout {
  /**
   * Components in paint order, in EMU from the box's top-left corner, unrotated: paint turns
   * them about the box centre with the shape.
   */
  readonly components: readonly VectorShapeComponent[];
  /** Box-local bounds of all ink in points, when it reaches past the box. */
  readonly inkBounds?: Readonly<{ left: number; top: number; right: number; bottom: number }>;
}

/**
 * Lays out text art whose projection carries `renderData`, or returns null to leave it to the
 * engine's plain fit.
 *
 * @internal
 */
export type TextArtLayoutRenderer = (input: TextArtLayoutInput) => TextArtLayout | null;
