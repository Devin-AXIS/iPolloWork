// Drawing renderers that a capability package installs: a chart reader, the SmartArt layout
// engine for a diagram saved without its drawing part, shape effects beyond the outer shadow,
// VML text art outside a watermark, and the EMF/WMF metafile replay and rasterizer.
//
// The engine reads a saved SmartArt drawing, shapes, groups, canvases and pictures on its own.
// A chart, or a diagram it would have to lay out, keeps its labelled placeholder until a
// renderer for it is installed; a chart in `mc:AlternateContent` shows its fallback picture
// instead when that paints. A shape paints without the effects no renderer projects, a
// text path outside a watermark keeps the placeholder of a refused legacy drawing, and a
// metafile picture keeps the placeholder of an image format the engine cannot decode.
//
// The boundary is the projection: the engine paints whatever a projection carries, and a
// renderer decides whether the projection carries it. Installation is process-wide, because
// drawing projections are shared by every editor and export that reads the same parsed
// package; install renderers before any document opens. Looking up a renderer is one property
// read, so documents without these drawings pay nothing for the hooks.

import type { ChartPartResolver } from './chart-parts.ts';
import type { ChartexPartResolver } from './chartex-parts.ts';
import type {
  ShapeSchemeColorResolver,
  VectorShapeProjection,
} from './drawing-shape-projection.ts';
import type { GroupTextboxProjection } from './group-textbox-projection.ts';
import type { OoxmlElement } from './ooxml-tree.ts';
import type { ShapeEffectList } from './drawing-shape-effects.ts';
import type { PictureFrameEffects } from './drawing-picture-frame.ts';
import type { VectorShapeComponent } from './drawing-shape-projection.ts';
import type { LegacyTextArtProjection } from './legacy-vml-text-art.ts';
import type { TextArtLayoutRenderer } from './text-art-layout-hook.ts';
import type { MetafileImageMime } from './image-resources.ts';
import type { MetafileRenderOptions, MetafileReplay } from './metafile-drawing.ts';

/**
 * What a shape effects renderer reads for one shape: its properties, the effect list the
 * engine resolved for the outer shadow, and the components the engine painted.
 *
 * @internal
 */
export interface ShapeEffectsInput {
  /** The shape (`wps:wsp`) or picture (`pic:pic`) element. */
  readonly shape: OoxmlElement;
  /** Its shape properties (`wps:spPr` or `pic:spPr`). */
  readonly spPr: OoxmlElement;
  /** Its own effect list or the theme one it references; null when it has neither. */
  readonly effectList: ShapeEffectList | null;
  readonly resolveSchemeColor?: ShapeSchemeColorResolver;
}

/**
 * What a picture effects renderer returns: effects that change how the picture paints, and
 * components that paint under it.
 *
 * @internal
 */
export interface PictureEffectsProjection {
  readonly effects?: PictureFrameEffects;
  /** Painted first, under the picture's shadow, fill and image. */
  readonly underComponents?: readonly VectorShapeComponent[];
}

/**
 * Shape and picture effects beyond the outer shadow: glow, inner shadow, reflection, soft
 * edge, and the rim of a dark-edged bevel.
 *
 * @internal
 */
export interface DrawingEffectsRenderer {
  /**
   * The components of a shape with its effects added, in paint order. Return `components`
   * itself when the shape has no effect the renderer paints.
   */
  readonly shape: (
    input: ShapeEffectsInput & {
      readonly components: readonly VectorShapeComponent[];
      readonly extent: Readonly<{ cx: number; cy: number }>;
    }
  ) => readonly VectorShapeComponent[];
  /**
   * The effects of a picture. `outlineEmu` holds the closed outlines of the picture's frame in
   * its extent, or null when the frame paints nothing (a turned picture, or one past the point
   * budget). Null when the picture has no effect the renderer paints.
   */
  readonly picture: (
    input: ShapeEffectsInput & {
      readonly outlineEmu: readonly (readonly Readonly<{ x: number; y: number }>[])[] | null;
    }
  ) => PictureEffectsProjection | null;
}

/** The long edge, in pixels, a metafile raster scales up toward to stay sharp on the page. */
const METAFILE_SHARP_EDGE = 2048;
/** The largest resolution multiplier the metafile rasterizer accepts. */
const METAFILE_MAX_SCALE = 4;

/**
 * Rasterizer options for a metafile raster no larger than `maxEdge` pixels on a side. A
 * metafile's own size is its recording device's pixels, often far smaller than the picture
 * shows on the page, so it renders at up to 4x toward a 2048-pixel long edge. The converter
 * lowers the render scale itself to fit the bounds, so no separate size read is needed.
 *
 * @internal
 */
export function metafileRasterOptions(
  maxEdge: number
): Readonly<{ dpiScale: number; maxWidth: number; maxHeight: number }> {
  const edge = Math.max(1, Math.min(METAFILE_SHARP_EDGE, Math.floor(maxEdge)));
  return { dpiScale: METAFILE_MAX_SCALE, maxWidth: edge, maxHeight: edge };
}

/** A metafile raster for the editor: PNG bytes the image pipeline validates again. @internal */
export interface MetafileRasterImage {
  readonly bytes: Uint8Array;
  readonly mime: 'image/png';
}

/**
 * EMF and WMF pictures: a vector replay for exporters, and a raster for the browser editor.
 * Both run on attacker-controlled bytes and must bound their own work.
 *
 * @internal
 */
export interface MetafileRenderer {
  /** Vector drawing commands in canvas pixels, or null when the bytes do not replay. */
  readonly replay: (
    bytes: Uint8Array,
    mime: MetafileImageMime,
    options: MetafileRenderOptions
  ) => Promise<MetafileReplay | null>;
  /**
   * A PNG of the metafile no larger than `maxEdge` pixels on a side, drawn in the current
   * browser, or null when it does not draw.
   */
  readonly rasterize?: (
    bytes: Uint8Array,
    mime: MetafileImageMime,
    options: Readonly<{ maxEdge: number }>
  ) => Promise<MetafileRasterImage | null>;
}

/**
 * What a drawing renderer paints: vector components over the drawing extent, and read-only
 * stories for its text.
 *
 * @internal
 */
export interface DrawingGraphicProjection {
  readonly vectorShape: VectorShapeProjection | null;
  readonly groupTextboxes: readonly GroupTextboxProjection[] | null;
}

/**
 * What a chart renderer reads beside the drawing.
 *
 * @internal
 */
export interface ChartRenderContext {
  readonly resolveChartPart?: ChartPartResolver;
  /** The chartex part behind a `cx:chart` element (waterfall, funnel, histogram, ...). */
  readonly resolveChartexPart?: ChartexPartResolver;
  readonly resolveSchemeColor?: ShapeSchemeColorResolver;
}

/**
 * The parts a SmartArt layout engine lays a diagram out from.
 *
 * @internal
 */
export interface DiagramLayoutParts {
  readonly dataModel: OoxmlElement;
  readonly layoutDef: OoxmlElement;
  readonly styleDef: OoxmlElement | null;
  readonly colorsDef: OoxmlElement | null;
}

/**
 * What a SmartArt layout engine reads beside the diagram parts.
 *
 * @internal
 */
export interface DiagramLayoutOptions {
  /** The theme's minor (body) Latin font, which diagram text uses by default. */
  readonly fontFamily?: string;
  readonly resolveSchemeColor?: ShapeSchemeColorResolver;
}

/**
 * What a text art renderer reads beside the shape.
 *
 * @internal
 */
export interface LegacyTextArtContext {
  /**
   * The `v:shapetype` the shape names with its `type`, when the same drawing holds it. A
   * renderer that reads its geometry accepts it; the engine refuses any other custom template.
   */
  readonly template?: OoxmlElement;
}

/**
 * Renderers a capability package installs.
 *
 * @internal
 */
export interface DrawingRenderers {
  /**
   * The shapes and labels of a chart drawing, classic (`c:chart`) or chartex (`cx:chart`), or
   * null when the drawing is not a chart or the chart is outside what the renderer paints.
   */
  readonly chart?: (
    anchor: OoxmlElement,
    extent: Readonly<{ cx: number; cy: number }>,
    context: ChartRenderContext
  ) => DrawingGraphicProjection | null;
  /**
   * The drawing part (`dsp:drawing`) Office would save for a diagram at this extent, or null
   * when its layout is outside what the engine places.
   */
  readonly diagramLayout?: (
    parts: DiagramLayoutParts,
    extent: Readonly<{ cx: number; cy: number }>,
    options: DiagramLayoutOptions
  ) => OoxmlElement | null;
  /** Glow, inner shadow, reflection, soft edge and bevel rim. The outer shadow is the engine's. */
  readonly effects?: DrawingEffectsRenderer;
  /**
   * The text art of a VML text path (`v:shape` of a text path type, `#_x0000_t136` to
   * `#_x0000_t175`) outside a watermark, or null when the shape is outside what the renderer
   * projects. A watermark's text art is the engine's.
   */
  readonly legacyTextArt?: (
    shape: OoxmlElement,
    context?: LegacyTextArtContext
  ) => LegacyTextArtProjection | null;
  /**
   * The painted geometry of text art whose projection carries `renderData`: glyph outlines
   * warped to the text path, with fills, outlines, shadows and extrusion. Without it, or
   * when it returns null, the engine fits the plain text to the box.
   */
  readonly textArtLayout?: TextArtLayoutRenderer;
  /** EMF and WMF pictures. */
  readonly metafile?: MetafileRenderer;
}

let installed: DrawingRenderers = Object.freeze({});
/** The renderers as their package passed them, so installing the same ones again is silent. */
const passed = new WeakSet<object>();
let consulted = false;
let warnedLate = false;

/**
 * Install drawing renderers for every editor and export in this process. A later install
 * replaces the renderers it names and keeps the others. Install before any document opens:
 * a drawing already read keeps what it read.
 *
 * @internal
 */
export function installDrawingRenderers(renderers: DrawingRenderers): void {
  const added = Object.values(renderers).filter(
    (renderer): renderer is object => typeof renderer === 'object' || typeof renderer === 'function'
  );
  const fresh = added.filter((renderer) => !passed.has(renderer));
  for (const renderer of fresh) passed.add(renderer);
  if (fresh.length > 0 && consulted && !warnedLate) {
    warnedLate = true;
    console.warn(
      '[docx-editor] Drawing renderers were installed after a document opened. Drawings read ' +
        'before the install keep their placeholders. Install them before the first document opens.'
    );
  }
  installed = Object.freeze({ ...installed, ...guardedRenderers(renderers) });
}

/** `render`, returning `fallback` instead of throwing, so one bad drawing keeps its placeholder. */
function guard<A extends unknown[], R, F>(
  render: (...args: A) => R,
  fallback: (args: A) => F
): (...args: A) => R | F {
  return (...args) => {
    try {
      return Reflect.apply(render, undefined, args);
    } catch {
      return fallback(args);
    }
  };
}

/** `render`, resolving `null` instead of rejecting. */
function guardAsync<A extends unknown[], R>(
  render: (...args: A) => Promise<R | null>
): (...args: A) => Promise<R | null> {
  return (...args) => {
    try {
      return Reflect.apply(render, undefined, args).catch(() => null);
    } catch {
      return Promise.resolve(null);
    }
  };
}

function guardedRenderers(renderers: DrawingRenderers): DrawingRenderers {
  const { chart, diagramLayout, effects, legacyTextArt, textArtLayout, metafile } = renderers;
  const none = () => null;
  // Spread first, so a renderer named with `undefined` clears the installed one.
  return {
    ...renderers,
    ...(chart ? { chart: guard(chart, none) } : {}),
    ...(diagramLayout ? { diagramLayout: guard(diagramLayout, none) } : {}),
    ...(effects
      ? {
          effects: Object.freeze({
            // A shape whose effects fail paints without them.
            shape: guard(effects.shape, ([input]) => input.components),
            picture: guard(effects.picture, none),
          }),
        }
      : {}),
    ...(legacyTextArt ? { legacyTextArt: guard(legacyTextArt, none) } : {}),
    ...(textArtLayout ? { textArtLayout: guard(textArtLayout, none) } : {}),
    ...(metafile
      ? {
          metafile: Object.freeze({
            replay: guardAsync(metafile.replay),
            ...(metafile.rasterize ? { rasterize: guardAsync(metafile.rasterize) } : {}),
          }),
        }
      : {}),
  };
}

/** The installed renderers. */
export function drawingRenderers(): DrawingRenderers {
  consulted = true;
  return installed;
}
