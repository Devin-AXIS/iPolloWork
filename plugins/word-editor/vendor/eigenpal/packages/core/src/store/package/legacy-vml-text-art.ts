// A floating VML text path (`#_x0000_t136`, plain text WordArt): the shape every text
// watermark is written as. Unlike the preview subset in `legacy-vml-shapes.ts`, this projects
// the text itself, so layout can fit real glyph outlines into the box and every output paints
// the same ink. The canonical XML is never rewritten here.
//
// The engine projects the text art of a watermark itself, because a watermark is a page
// feature with its own dialog and API. Text art in any other drawing projects only through an
// installed text art renderer (`drawing-renderers.ts`); without one it stays refused.
import type { DrawingRenderers } from './drawing-renderers.ts';
import type { OoxmlElement } from './ooxml-tree.ts';
import {
  attribute as a,
  children,
  color,
  named,
  numeric,
  off,
  OFFICE,
  points,
  styleOf,
  VML,
  WORD_VML,
  legacyRotationDegrees,
} from './legacy-vml-values.ts';

/** The `id` prefix of a text watermark shape; only such a shape is a watermark. */
export const TEXT_WATERMARK_ID_PREFIX = 'PowerPlusWaterMarkObject';

/**
 * Plain text fitted to a floating shape box, painted with one fill and an optional outline.
 *
 * @internal
 */
export interface LegacyTextArtProjection {
  readonly text: string;
  readonly fontFamily: string;
  readonly bold: boolean;
  readonly italic: boolean;
  /** `RRGGBB`, or null when the shape is not filled. */
  readonly fillHex: string | null;
  readonly fillAlpha: number;
  /** `RRGGBB`, or null when the shape is not stroked. */
  readonly strokeHex: string | null;
  readonly strokeAlpha: number;
  readonly strokeWidthPt: number;
  /** Clockwise rotation about the box centre, in [0, 360). */
  readonly rotationDegrees: number;
  /** `trim`: the ink fills the whole box, with no text inset. */
  readonly trim?: true;
  /**
   * Data an installed text art layout (`DrawingRenderers.textArtLayout`) reads: plain JSON
   * values, so equal projections stay equal. The engine never reads it.
   */
  readonly renderData?: unknown;
}

/** The longest text this subset fits; a watermark is a short phrase. */
export const MAX_TEXT_ART_LENGTH = 256;

const TEXTPATH_STYLES = new Set([
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'v-text-align',
  'v-rotate-letters',
  'v-same-letter-heights',
  'v-text-kern',
]);

/** VML opacity: a fraction, a `f` fixed-point fraction, or a percentage. NaN when malformed. */
function opacity(raw: string | undefined): number {
  if (raw === undefined) return 1;
  const value = raw.trim();
  if (/^\d{1,6}f$/.test(value)) return Number(value.slice(0, -1)) / 65536;
  if (/^\d{1,3}(\.\d{1,6})?%$/.test(value)) return Number(value.slice(0, -1)) / 100;
  return numeric(value);
}

/** A CSS-style font family with its quotes removed; null when it cannot name a face. */
function family(raw: string | undefined): string | null {
  const value = (raw ?? '')
    .trim()
    .replace(/^(["'])(.*)\1$/, '$2')
    .trim();
  if (!value || value.length > 64 || /["';{}<>\\]/.test(value)) return null;
  return value;
}

/** The face a `v:textpath` names, for font provisioning; null when it names none. */
export function textPathFontFamily(path: OoxmlElement): string | null {
  if (path.namespaceUri !== VML || path.localName !== 'textpath') return null;
  return family(styleOf(path)?.get('font-family'));
}

const unit = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1;
const hex = (value: string) => value.slice(1).toUpperCase();

/**
 * The text art of a `#_x0000_t136` shape, or null outside the bounded subset.
 *
 * Accepts the markup a text watermark is written with: one `v:textpath` with `fitshape`, a
 * fill colour with an optional `v:fill` opacity, an optional plain outline, and a shadow that
 * is switched off. Custom paths, adjustment handles, gradients, shown shadows and multi-line
 * text stay outside the subset, and the caller keeps refusing them.
 *
 * @public
 */
export function legacyTextArt(node: OoxmlElement): LegacyTextArtProjection | null {
  if (node.namespaceUri !== VML || node.localName !== 'shape') return null;
  if (a(node, 'type') !== '#_x0000_t136' || a(node, 'path')) return null;
  if (a(node, 'adj') !== undefined && a(node, 'adj') !== '10800') return null;
  const list = children(node);
  const allowed = list.every(
    (n) =>
      (n.namespaceUri === VML && ['textpath', 'fill', 'stroke', 'path'].includes(n.localName)) ||
      // A shadow is off unless it says `on`; a switched-off one paints nothing.
      (named(n, VML, 'shadow') && (a(n, 'on') === undefined || off(a(n, 'on')))) ||
      named(n, OFFICE, 'lock') ||
      named(n, WORD_VML, 'wrap') ||
      (named(n, WORD_VML, 'anchorlock') && n.attributes.length === 0)
  );
  if (!allowed || list.some((n) => children(n).length)) return null;
  const once = (name: string) => list.filter((n) => named(n, VML, name));
  const [paths, fills, strokes, shapePaths] = [
    once('textpath'),
    once('fill'),
    once('stroke'),
    once('path'),
  ];
  if (paths.length !== 1 || fills.length > 1 || strokes.length > 1 || shapePaths.length > 1)
    return null;
  if (shapePaths[0] && shapePaths[0].attributes.some((attr) => attr.localName !== 'textpathok'))
    return null;
  const path = paths[0]!;
  if (
    path.attributes.some(
      (attr) =>
        attr.namespaceUri ||
        !['on', 'fitshape', 'fitpath', 'string', 'style', 'trim', 'xscale'].includes(attr.localName)
    ) ||
    off(a(path, 'on')) ||
    off(a(path, 'fitshape')) ||
    (a(path, 'xscale') !== undefined && !off(a(path, 'xscale')))
  )
    return null;
  const text = a(path, 'string') ?? '';
  if (!text.trim() || text.length > MAX_TEXT_ART_LENGTH || /[\r\n\v\f\u2028\u2029]/.test(text))
    return null;
  const style = styleOf(path);
  if (!style) return null;
  for (const [key, value] of style) {
    if (!TEXTPATH_STYLES.has(key)) return null;
    if (key === 'v-text-align' && value !== 'center') return null;
    // Kerning only tightens letter pairs; the fit to the box still holds.
    if (key.startsWith('v-') && !['v-text-align', 'v-text-kern'].includes(key) && !off(value))
      return null;
  }
  const face = family(style.get('font-family'));
  const size = style.has('font-size') ? points(style.get('font-size')) : 36;
  const weight = style.get('font-weight') ?? 'normal';
  const slant = style.get('font-style') ?? 'normal';
  if (
    !face ||
    !(size > 0 && size <= 1000) ||
    !['normal', 'bold', '400', '700'].includes(weight) ||
    !['normal', 'italic'].includes(slant)
  )
    return null;

  const fillNode = fills[0];
  if (
    fillNode?.attributes.some(
      (attr) =>
        attr.namespaceUri ||
        !['on', 'color', 'opacity', 'type', 'focussize'].includes(attr.localName) ||
        (attr.localName === 'type' && attr.value !== 'solid')
    )
  )
    return null;
  const filled = !(off(a(node, 'filled')) || (fillNode && off(a(fillNode, 'on'))));
  const fill = filled
    ? color((fillNode && a(fillNode, 'color')) ?? a(node, 'fillcolor'), '#ffffff')
    : null;
  const fillAlpha = opacity(fillNode && a(fillNode, 'opacity'));
  if ((filled && !fill) || !unit(fillAlpha)) return null;

  const strokeNode = strokes[0];
  if (
    strokeNode?.attributes.some(
      (attr) =>
        attr.namespaceUri ||
        !['on', 'color', 'weight', 'opacity', 'joinstyle'].includes(attr.localName)
    )
  )
    return null;
  // VML strokes a shape unless told otherwise, black at three quarters of a point.
  const stroked = !(off(a(node, 'stroked')) || (strokeNode && off(a(strokeNode, 'on'))));
  const stroke = stroked
    ? color((strokeNode && a(strokeNode, 'color')) ?? a(node, 'strokecolor'), '#000000')
    : null;
  const strokeWidth = points(
    (strokeNode && a(strokeNode, 'weight')) ?? a(node, 'strokeweight') ?? '0.75pt'
  );
  const strokeAlpha = opacity(strokeNode && a(strokeNode, 'opacity'));
  if (stroked && (!stroke || !(strokeWidth > 0 && strokeWidth <= 100) || !unit(strokeAlpha)))
    return null;

  const rotation = legacyRotationDegrees(styleOf(node)?.get('rotation'));
  if (!Number.isFinite(rotation)) return null;
  return Object.freeze({
    text,
    fontFamily: face,
    bold: weight === 'bold' || weight === '700',
    italic: slant === 'italic',
    fillHex: fill ? hex(fill) : null,
    fillAlpha: filled ? fillAlpha : 1,
    strokeHex: stroke ? hex(stroke) : null,
    strokeAlpha: stroked ? strokeAlpha : 1,
    strokeWidthPt: stroked ? strokeWidth : 0,
    rotationDegrees: rotation,
    ...(a(path, 'trim') !== undefined && !off(a(path, 'trim')) ? { trim: true as const } : {}),
  });
}

/**
 * The text art a drawing paints: the engine's for a text watermark, the installed text art
 * renderer's for any other text path, and null without one.
 */
export function drawingTextArt(
  node: OoxmlElement,
  renderer: DrawingRenderers['legacyTextArt'],
  template?: OoxmlElement
): LegacyTextArtProjection | null {
  if ((a(node, 'id') ?? '').startsWith(TEXT_WATERMARK_ID_PREFIX)) return legacyTextArt(node);
  return renderer ? renderer(node, template ? { template } : {}) : null;
}

/** The text path shape types: plain text (`136`) through the can shapes (`175`). */
const TEXT_PATH_TYPE = /^#_x0000_t(\d{3})$/;

/** Whether `type` names one of the text path shape types. */
export function isTextPathType(type: string | undefined): boolean {
  const match = TEXT_PATH_TYPE.exec(type ?? '');
  const spt = match ? Number(match[1]) : NaN;
  return spt >= 136 && spt <= 175;
}

/** A text path outside a watermark, which only an installed text art renderer projects. */
export function isUnrenderedTextArt(node: OoxmlElement): boolean {
  return (
    node.namespaceUri === VML &&
    node.localName === 'shape' &&
    isTextPathType(a(node, 'type')) &&
    !(a(node, 'id') ?? '').startsWith(TEXT_WATERMARK_ID_PREFIX)
  );
}
