// VML text art (a text watermark, or WordArt on the line) laid out for paint.
//
// The text path stretches the string's glyph ink to fill the shape box inside the VML default
// text inset: 0.1in left and right, 0.05in top and bottom. A trimmed text path (`trim`) fills
// the whole box. Layout fits the outlines once, so
// the screen and every exporter paint the same ink. The box is the unrotated shape; paint
// turns it about its centre.
import { DEFAULT_RUN_STYLE, type ResolvedRunStyle } from './run-style.ts';
import { textArtOutline } from './text-art-outline.ts';
import type { LayoutBox, TextMeasurer, TextOutline } from './semantic-records.ts';
import type { LegacyTextArtProjection } from '../store/package/legacy-vml-text-art.ts';
import type { VectorShapeComponent } from '../store/package/drawing-shape-projection.ts';
import { drawingRenderers } from '../store/package/drawing-renderers.ts';
import type { TextArtOutline } from '../store/package/text-art-layout-hook.ts';
import type { TextboxOutlineProjection } from '../store/package/legacy-vml-textbox-geometry.ts';

/** Size the string is measured and, without outlines, drawn at; the fit scales it to the box. */
export const TEXT_ART_FONT_SIZE_PT = 100;
const INSET_X_PT = 7.2;
const INSET_Y_PT = 3.6;

/** `x' = scaleX * x + offsetX`, `y' = scaleY * y + offsetY`, from text space into the box. */
export interface TextArtFit {
  readonly scaleX: number;
  readonly scaleY: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export interface DrawingTextArtRecord {
  readonly text: string;
  readonly fontFamily: string;
  readonly bold: boolean;
  readonly italic: boolean;
  /** Size of the unfitted text that `fit` maps into the box. */
  readonly fontSizePt: number;
  /** `RRGGBB`, or null when the text is not filled. */
  readonly fillHex: string | null;
  readonly fillAlpha: number;
  /** `RRGGBB`, or null when the text is not outlined. */
  readonly strokeHex: string | null;
  readonly strokeAlpha: number;
  readonly strokeWidthPt: number;
  /** Clockwise rotation about the box centre. */
  readonly rotationDegrees: number;
  /**
   * The fitted glyph outlines in points from the box's top-left corner, as absolute M/L/Q/C/Z
   * path data. Null when the measurer knew only the ink box: paint then draws the text at
   * `fontSizePt` through `fit`.
   */
  readonly path: string | null;
  /** Null when the measurer could not bound the string's ink: nothing paints. */
  readonly fit: TextArtFit | null;
  /**
   * The geometry an installed text art layout drew, in EMU from the box's top-left corner,
   * unrotated. When present, paint draws these in place of `path`.
   */
  readonly components?: readonly VectorShapeComponent[];
  /** Box-local bounds of the components' ink in points, when it reaches past the box. */
  readonly inkBounds?: Readonly<{ left: number; top: number; right: number; bottom: number }>;
}

/** The style the text is measured in. */
export function textArtRunStyle(textArt: LegacyTextArtProjection): ResolvedRunStyle {
  return {
    ...DEFAULT_RUN_STYLE,
    fontFamily: textArt.fontFamily,
    bold: textArt.bold,
    italic: textArt.italic,
    fontSizePt: TEXT_ART_FONT_SIZE_PT,
  };
}

function fittedPath(path: string, fit: TextArtFit): string {
  let index = 0;
  return path.replace(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/giu, (value) => {
    const n = Number(value);
    const mapped = index++ % 2 === 0 ? fit.scaleX * n + fit.offsetX : fit.scaleY * n + fit.offsetY;
    const rounded = Math.round(mapped * 1000) / 1000;
    return String(Object.is(rounded, -0) ? 0 : rounded);
  });
}

/** Records by measurer, then projection, then box: a header watermark repeats on every page. */
const fitted = new WeakMap<
  object,
  WeakMap<LegacyTextArtProjection, Map<string, DrawingTextArtRecord>>
>();
const NO_MEASURER = {};
/** Box sizes kept per projection; a document resizes its watermark rarely. */
const MAX_BOXES = 8;

/**
 * Text art for a `width` by `height` box. When the measurer cannot bound the string's ink the
 * record has no fit and paints nothing: guessing glyph metrics would draw text the document does not.
 *
 * The same projection, box and measurer return the same record. A watermark sits in a header
 * that every page repeats, so shaping and fitting it once per page made layout of a long
 * document several times slower.
 */
export function layoutTextArt(
  textArt: LegacyTextArtProjection,
  width: number,
  height: number,
  measurer: TextMeasurer | undefined
): DrawingTextArtRecord {
  let byProjection = fitted.get(measurer ?? NO_MEASURER);
  if (!byProjection) fitted.set(measurer ?? NO_MEASURER, (byProjection = new WeakMap()));
  let byBox = byProjection.get(textArt);
  if (!byBox) byProjection.set(textArt, (byBox = new Map()));
  const key = `${width}x${height}`;
  const hit = byBox.get(key);
  if (hit) return hit;
  const record = fitTextArt(textArt, width, height, measurer);
  if (byBox.size >= MAX_BOXES) byBox.delete(byBox.keys().next().value!);
  byBox.set(key, record);
  return record;
}

/** The outline when its ink is a finite, non-empty box; null otherwise. */
function usableOutline(outline: TextOutline | undefined): TextOutline | null {
  const ink = outline?.ink;
  if (!outline || !ink) return null;
  if (![ink.left, ink.top, ink.right, ink.bottom].every(Number.isFinite)) return null;
  return ink.right > ink.left && ink.bottom > ink.top ? outline : null;
}

function fitTextArt(
  textArt: LegacyTextArtProjection,
  width: number,
  height: number,
  measurer: TextMeasurer | undefined
): DrawingTextArtRecord {
  const base = {
    text: textArt.text,
    fontFamily: textArt.fontFamily,
    bold: textArt.bold,
    italic: textArt.italic,
    fontSizePt: TEXT_ART_FONT_SIZE_PT,
    fillHex: textArt.fillHex,
    fillAlpha: textArt.fillAlpha,
    strokeHex: textArt.strokeHex,
    strokeAlpha: textArt.strokeAlpha,
    strokeWidthPt: textArt.strokeWidthPt,
    rotationDegrees: textArt.rotationDegrees,
  };
  const style = textArtRunStyle(textArt);
  const outlineOf = (runStyle: ResolvedRunStyle) =>
    width > 0 && height > 0
      ? usableOutline(measurer && textArtOutline(textArt.text, runStyle, measurer))
      : null;
  // A family no face resolves (a misspelled or garbled name) draws in the document's default
  // face, as a run of body text with that name does, rather than dropping the watermark.
  const own = outlineOf(style);
  const outline =
    own ?? (style.fontFamily === null ? null : outlineOf({ ...style, fontFamily: null }));
  const ink = outline?.ink;
  if (!outline || !ink) return Object.freeze({ ...base, path: null, fit: null });
  const laidOut = rendererLayout(textArt, width, height, measurer, own !== null);
  // A box too small for the inset keeps its whole area for the ink, and trimmed text fills it.
  const insetX = !textArt.trim && width > 4 * INSET_X_PT ? INSET_X_PT : 0;
  const insetY = !textArt.trim && height > 4 * INSET_Y_PT ? INSET_Y_PT : 0;
  const scaleX = (width - 2 * insetX) / (ink.right - ink.left);
  const scaleY = (height - 2 * insetY) / (ink.bottom - ink.top);
  const fit: TextArtFit = Object.freeze({
    scaleX,
    scaleY,
    offsetX: insetX - ink.left * scaleX,
    offsetY: insetY - ink.top * scaleY,
  });
  return Object.freeze({
    ...base,
    path: outline.path === null ? null : fittedPath(outline.path, fit),
    fit,
    ...(laidOut
      ? {
          components: laidOut.components,
          ...(laidOut.inkBounds ? { inkBounds: laidOut.inkBounds } : {}),
        }
      : {}),
  });
}

/**
 * The installed text art layout's geometry for text art that carries renderer data, or null
 * when none is installed, the projection carries none, or the layout declines it. `ownFace`
 * says whether the text art's own face had outlines; otherwise the default face stands in.
 */
function rendererLayout(
  textArt: LegacyTextArtProjection,
  width: number,
  height: number,
  measurer: TextMeasurer | undefined,
  ownFace: boolean
) {
  const layout = drawingRenderers().textArtLayout;
  if (textArt.renderData === undefined || !layout || !measurer?.textOutline) return null;
  const outline = (text: string, fontSizePt: number): TextArtOutline | null => {
    if (!(fontSizePt > 0 && fontSizePt <= 10_000) || text.length > 4096) return null;
    const style = { ...textArtRunStyle(textArt), fontSizePt };
    const found = usableOutline(
      textArtOutline(text, ownFace ? style : { ...style, fontFamily: null }, measurer)
    );
    return found && found.path !== null ? { path: found.path, ink: found.ink } : null;
  };
  const result = layout({ textArt, widthPt: width, heightPt: height, outline });
  return result && result.components.length ? result : null;
}

/**
 * Paint bounds that hold a text box shape: grown by the outer half of a centred outline, then
 * turned about the frame centre. `frame` is the extent the outline's shares and the turn use;
 * `bounds` is the paint box with its effect extents, which the result also holds. Without
 * `frame`, `bounds` is the frame.
 */
export function turnedTextboxBounds(
  bounds: LayoutBox,
  story:
    | {
        readonly chromeRotationDegrees?: number;
        readonly outline?: TextboxOutlineProjection;
        readonly strokeCentered?: true;
        readonly strokeHex: string | null;
        readonly strokeWidthPt: number;
        readonly shadow?: Readonly<{ dx: number; dy: number }>;
      }
    | null
    | undefined,
  frame: LayoutBox = bounds
): LayoutBox {
  if (!story) return bounds;
  // An outline polygon can leave its box, as a callout's tail does.
  let [left, top, right, bottom] = [0, 0, 1, 1];
  if (story.outline?.kind === 'polygon') {
    for (const subpath of story.outline.subpaths) {
      for (const point of subpath) {
        left = Math.min(left, point.x);
        top = Math.min(top, point.y);
        right = Math.max(right, point.x);
        bottom = Math.max(bottom, point.y);
      }
    }
  }
  const reach =
    story.strokeCentered && story.strokeHex !== null ? Math.max(0, story.strokeWidthPt) / 2 : 0;
  const grown =
    reach || left < 0 || top < 0 || right > 1 || bottom > 1
      ? Object.freeze({
          x: frame.x + left * frame.width - reach,
          y: frame.y + top * frame.height - reach,
          width: (right - left) * frame.width + 2 * reach,
          height: (bottom - top) * frame.height + 2 * reach,
        })
      : frame;
  // The shape turns about the frame's centre, which a tail moves off the grown box's centre.
  const degrees = story.chromeRotationDegrees;
  const shape = degrees ? boundsTurnedAbout(grown, degrees, frame) : grown;
  // The painted area holds the shape, and the effect extents' box around the frame when the
  // drawing has one.
  const sameBox =
    bounds.x === frame.x &&
    bounds.y === frame.y &&
    bounds.width === frame.width &&
    bounds.height === frame.height;
  const turned = shape === frame ? bounds : sameBox ? shape : unionOf(bounds, shape);
  // A shadow repeats the shape at a page offset; the painted area holds both.
  const shadow = story.shadow;
  if (!shadow || (shadow.dx === 0 && shadow.dy === 0)) return turned;
  const x = Math.min(turned.x, turned.x + shadow.dx),
    y = Math.min(turned.y, turned.y + shadow.dy);
  return Object.freeze({
    x,
    y,
    width: turned.width + Math.abs(shadow.dx),
    height: turned.height + Math.abs(shadow.dy),
  });
}

/**
 * The paint bounds of text art in `box`: grown to the ink that reaches past the box, then
 * turned about the box centre.
 */
export function textArtPaintBounds(box: LayoutBox, textArt: DrawingTextArtRecord): LayoutBox {
  const ink = textArt.inkBounds;
  if (!ink) return rotatedBounds(box, textArt.rotationDegrees);
  const left = Math.min(0, ink.left),
    top = Math.min(0, ink.top),
    right = Math.max(box.width, ink.right),
    bottom = Math.max(box.height, ink.bottom);
  if (![left, top, right, bottom].every(Number.isFinite)) return box;
  const radians = (textArt.rotationDegrees * Math.PI) / 180;
  const cos = Math.cos(radians),
    sin = Math.sin(radians);
  const cx = box.width / 2,
    cy = box.height / 2;
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of [
    [left, top],
    [right, top],
    [right, bottom],
    [left, bottom],
  ] as const) {
    const turnedX = cx + (x - cx) * cos - (y - cy) * sin,
      turnedY = cy + (x - cx) * sin + (y - cy) * cos;
    minX = Math.min(minX, turnedX);
    maxX = Math.max(maxX, turnedX);
    minY = Math.min(minY, turnedY);
    maxY = Math.max(maxY, turnedY);
  }
  return Object.freeze({
    x: box.x + minX,
    y: box.y + minY,
    width: maxX - minX,
    height: maxY - minY,
  });
}

/** The smallest box holding both boxes. */
function unionOf(a: LayoutBox, b: LayoutBox): LayoutBox {
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y);
  return Object.freeze({
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  });
}

/** The box holding `box` turned clockwise by `degrees` about the centre of `about`. */
function boundsTurnedAbout(box: LayoutBox, degrees: number, about: LayoutBox): LayoutBox {
  if (degrees % 360 === 0) return box;
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians),
    sin = Math.sin(radians);
  const cx = about.x + about.width / 2,
    cy = about.y + about.height / 2;
  let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of [
    [box.x, box.y],
    [box.x + box.width, box.y],
    [box.x, box.y + box.height],
    [box.x + box.width, box.y + box.height],
  ] as const) {
    const tx = cx + (x - cx) * cos - (y - cy) * sin;
    const ty = cy + (x - cx) * sin + (y - cy) * cos;
    left = Math.min(left, tx);
    top = Math.min(top, ty);
    right = Math.max(right, tx);
    bottom = Math.max(bottom, ty);
  }
  return Object.freeze({ x: left, y: top, width: right - left, height: bottom - top });
}

/** The box turned about its centre, as the axis-aligned box that holds it. */
export function rotatedBounds(box: LayoutBox, degrees: number): LayoutBox {
  if (degrees % 360 === 0) return box;
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians)),
    sin = Math.abs(Math.sin(radians));
  const width = box.width * cos + box.height * sin,
    height = box.width * sin + box.height * cos;
  return Object.freeze({
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
  });
}
