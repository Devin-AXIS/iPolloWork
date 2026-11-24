// The paint fields a drawing record copies from its projection: the picture crop and
// transform, effects, hyperlink, vector shape, and the placeholder kind of a graphic that
// does not render.

import type { DrawingChartSummary } from '../store/package/chart-summary.ts';
import type { DrawingImageEffects } from '../store/package/drawing-image-effects.ts';
import type {
  DrawingProjection,
  DrawingTransform,
  SourceCrop,
  VectorShapeProjection,
} from '../store/package/drawing-projection.ts';
import type { PictureFrameEffects } from '../store/package/drawing-picture-frame.ts';
import { graphicKindOfUri } from '../store/package/drawing-graphic-kind.ts';

/**
 * How a drawing record holds the picture member of a shape group.
 *
 * @public
 */
export interface DrawingGroupPictureRecord {
  /**
   * Whether the group is the chosen branch of a run-level `mc:AlternateContent`.
   * Failed picture resources show one placeholder for the whole group.
   */
  readonly alternateContent: boolean;
}

/**
 * The kind of graphic a non-picture drawing holds: `chart` (a chart), `diagram` (SmartArt),
 * `textbox` (a DrawingML shape, with or without text), `group` (a shape group), `canvas` (a
 * drawing canvas), `shape` (a legacy VML drawing, such as WordArt), or `graphic` (any other
 * graphic). A picture, including an EMF, WMF or TIFF picture that does not convert, has none.
 *
 * @public
 */
export type DrawingPlaceholderKind =
  'chart' | 'diagram' | 'shape' | 'group' | 'textbox' | 'canvas' | 'graphic';

/** The kind named by an `unsupported-graphic` diagnostic; `legacy-vml` marks a VML drawing. */
function placeholderKindOfUri(uri: string): DrawingPlaceholderKind {
  if (uri === 'legacy-vml') return 'shape';
  // Every graphic kind except `picture` must also be a placeholder kind; the checker holds that.
  const kind = graphicKindOfUri(uri);
  return kind && kind !== 'picture' ? kind : 'graphic';
}

const EMPTY_TRANSFORM: DrawingTransform = Object.freeze({
  rotationDegrees: 0,
  flipHorizontal: false,
  flipVertical: false,
  offsetEmu: Object.freeze({ x: 0, y: 0 }),
  extentEmu: Object.freeze({ cx: 0, cy: 0 }),
});

const EMPTY_CROP: SourceCrop = Object.freeze({ left: 0, top: 0, right: 0, bottom: 0 });

export function drawingPaintFields(projection: DrawingProjection): {
  readonly hyperlinkHref: string | null;
  readonly effects: DrawingImageEffects;
  readonly crop: SourceCrop;
  readonly transform: DrawingTransform;
  readonly placeholderGraphicKind: DrawingPlaceholderKind | null;
  readonly vectorShape: VectorShapeProjection | null;
  readonly frameEffects?: PictureFrameEffects;
  readonly groupPicture?: DrawingGroupPictureRecord;
  readonly chart?: DrawingChartSummary;
} {
  const picture = projection.picture;
  let placeholderGraphicKind: DrawingPlaceholderKind | null = null;
  if (!picture) {
    for (const diagnostic of projection.diagnostics) {
      if (diagnostic.code !== 'unsupported-graphic') continue;
      const uri = diagnostic.detail ?? '';
      placeholderGraphicKind = placeholderKindOfUri(uri);
      break;
    }
    if (placeholderGraphicKind === null) placeholderGraphicKind = 'graphic';
  }
  return Object.freeze({
    hyperlinkHref: projection.hyperlinkHref,
    effects: projection.effects,
    crop: picture?.crop ?? projection.groupPicture?.crop ?? EMPTY_CROP,
    transform: picture?.transform ?? EMPTY_TRANSFORM,
    placeholderGraphicKind:
      picture || projection.legacyGraphic || projection.textArt ? null : placeholderGraphicKind,
    vectorShape: projection.vectorShape,
    ...(picture?.frameEffects ? { frameEffects: picture.frameEffects } : {}),
    ...(projection.groupPicture
      ? {
          groupPicture: Object.freeze({
            alternateContent: projection.groupPicture.alternateContent,
          }),
        }
      : {}),
    ...(projection.chartSummary ? { chart: projection.chartSummary } : {}),
  });
}
