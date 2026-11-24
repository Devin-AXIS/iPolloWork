import type { SourceCrop } from './drawing-projection.ts';
import { RELATIONSHIPS_NAMESPACE_URI, type OoxmlElement } from './ooxml-tree.ts';
import { legacyChromaKeyFilter } from './legacy-vml-chromakey.ts';
import { LEGACY_IMAGE_EFFECT_ATTRIBUTES, legacyImageEffects } from './legacy-vml-image-effects.ts';
import type { VectorShapeComponent, VectorShapeProjection } from './drawing-shape-projection.ts';
import { compoundBands, type LineCompound } from './drawing-line-compound.ts';
import { legacyDashPattern } from './legacy-vml-textbox-stroke.ts';
import { freezeVectorShapeComponent } from './drawing-vector-freeze.ts';
import { evaluateGeometry, presetGeometryDefinition } from './drawing-geometry-engine.ts';
import {
  attribute as a,
  children,
  color,
  escapeXml as esc,
  named,
  numeric,
  off,
  OFFICE,
  pair,
  points,
  styleOf,
  VML,
  WORD_VML,
  coordOrigin,
} from './legacy-vml-values.ts';

/** Only generated, escaped SVG and relationship slots; never authored markup. */
export type LegacyGraphicFragment =
  | string
  | Readonly<{ relationshipId: string; before: string; after: string; nativeCrop?: SourceCrop }>;
export interface LegacyGraphicProjection {
  readonly width: number;
  readonly height: number;
  readonly fragments: readonly LegacyGraphicFragment[];
  /**
   * The relationship of the one uncropped picture that fills the whole graphic, when that is
   * all it paints. The graphic then resolves to that picture, which every output can paint.
   */
  readonly soleImageRelationshipId?: string;
}
export interface LegacyBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** VML `v:stroke/@linestyle` as a compound outline. */
const LINE_STYLES: ReadonlyMap<string, LineCompound> = new Map([
  ['single', 'sng'],
  ['thinthin', 'dbl'],
  ['thinthick', 'thinThick'],
  ['thickthin', 'thickThin'],
  ['thickbetweenthin', 'tri'],
]);

export interface LegacyInk {
  readonly fill: string;
  readonly stroke: string;
  readonly weight: number;
  readonly strokeNode?: OoxmlElement;
  /** Dash and gap lengths in outline widths; absent for solid. */
  readonly dash?: readonly number[];
  readonly compound: LineCompound;
}

/** The fill and outline of a legacy shape, or null outside the subset. */
export function legacyInk(node: OoxmlElement, line = false): LegacyInk | null {
  return paint(node, line);
}

function paint(node: OoxmlElement, line = false): LegacyInk | null {
  const list = children(node);
  if (['fill', 'stroke', 'path'].some((name) => list.filter((n) => named(n, VML, name)).length > 1))
    return null;
  // A frame picture fill draws as a picture over the shape; it adds no paint fill of its own.
  const picture = !line && !!framePictureFill(node, list);
  const fillNode = picture ? undefined : list.find((n) => named(n, VML, 'fill'));
  const strokeNode = list.find((n) => named(n, VML, 'stroke'));
  if (
    fillNode &&
    fillNode.attributes.some(
      (attr) =>
        attr.namespaceUri ||
        // A solid fill is the default; other fill types paint gradients or pictures.
        (attr.localName === 'type'
          ? attr.value !== 'solid'
          : !['on', 'color', 'focussize'].includes(attr.localName))
    )
  )
    return null;
  if (
    strokeNode &&
    strokeNode.attributes.some(
      (attr) =>
        ![
          'on',
          'color',
          'weight',
          'joinstyle',
          'endarrow',
          'startarrow',
          'endarrowwidth',
          'endarrowlength',
          'startarrowwidth',
          'startarrowlength',
          'dashstyle',
          'linestyle',
        ].includes(attr.localName) || attr.namespaceUri
    )
  )
    return null;
  // A line has no inside, so its fill is never read; a writer may spell it `this`.
  const fill =
    picture || line || off(a(node, 'filled')) || (fillNode && off(a(fillNode, 'on')))
      ? 'none'
      : color(
          fillNode ? (a(fillNode, 'color') ?? a(node, 'fillcolor')) : a(node, 'fillcolor'),
          '#ffffff'
        );
  const stroke =
    off(a(node, 'stroked')) || (strokeNode && off(a(strokeNode, 'on')))
      ? 'none'
      : color(
          strokeNode ? (a(strokeNode, 'color') ?? a(node, 'strokecolor')) : a(node, 'strokecolor'),
          '#000000'
        );
  const weight = points(
    (strokeNode ? a(strokeNode, 'weight') : undefined) ?? a(node, 'strokeweight') ?? '0.75pt'
  );
  // A dash or line style outside the known set refuses the shape rather than paint it solid.
  const dashStyle = strokeNode ? a(strokeNode, 'dashstyle')?.trim().toLowerCase() : undefined;
  const dash = legacyDashPattern(strokeNode);
  if (dashStyle && dashStyle !== 'solid' && !dash) return null;
  const compound = LINE_STYLES.get(
    (strokeNode ? a(strokeNode, 'linestyle') : undefined)?.trim().toLowerCase() ?? 'single'
  );
  if (!compound) return null;
  return fill && stroke && Number.isFinite(weight) && weight >= 0 && weight <= 100
    ? { fill, stroke, weight, strokeNode, ...(dash ? { dash } : {}), compound }
    : null;
}

/** The SVG dash attribute of `ink`, empty for a solid outline. */
function dashArray(ink: LegacyInk): string {
  return ink.dash ? ` stroke-dasharray="${ink.dash.map((d) => d * ink.weight).join(' ')}"` : '';
}

/** A vector shape's components with the ink's dash, split into its compound bands. */
export function inkComponents(
  component: VectorShapeComponent,
  ink: LegacyInk
): readonly VectorShapeComponent[] {
  const dashed = ink.dash ? { ...component, strokeDash: ink.dash } : component;
  return ink.compound === 'sng' ? [dashed] : compoundBands(dashed, ink.compound);
}

function wordArt(node: OoxmlElement, box: LegacyBox): string | null {
  if (a(node, 'type') !== '#_x0000_t136') return null;
  if (a(node, 'path') || (a(node, 'adj') && a(node, 'adj') !== '10800')) return null;
  const textNodes = children(node).filter((n) => named(n, VML, 'textpath'));
  if (textNodes.length !== 1) return null;
  const path = textNodes[0]!,
    style = styleOf(path),
    ink = paint(node);
  const text = a(path, 'string');
  if (
    !style ||
    !ink ||
    !text?.trim() ||
    text.length > 1024 ||
    /[\r\n]/.test(text) ||
    ['on', 'fitshape', 'fitpath'].some((key) => off(a(path, key)))
  )
    return null;
  for (const [key, value] of style) {
    if (
      ![
        'font-family',
        'font-size',
        'font-weight',
        'font-style',
        'v-text-align',
        'v-rotate-letters',
        'v-same-letter-heights',
      ].includes(key)
    )
      return null;
    if (key.startsWith('v-') && (key === 'v-text-align' ? value !== 'center' : !off(value)))
      return null;
  }
  const size = points(style.get('font-size')),
    face = style.get('font-family') ?? 'serif';
  const weight = style.get('font-weight') ?? 'normal',
    italic = style.get('font-style') ?? 'normal';
  if (
    !(size > 0 && size <= 400) ||
    face.length > 100 ||
    !['normal', 'bold', '400', '700'].includes(weight) ||
    !['normal', 'italic'].includes(italic)
  )
    return null;
  const span = Array.from(text).length * 1000;
  return `<svg x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" viewBox="0 -880 ${span} 1000" preserveAspectRatio="none"><text x="0" y="0" font-family="${esc(face)}" font-size="1000" font-weight="${weight}" font-style="${italic}" textLength="${span}" lengthAdjust="spacingAndGlyphs" fill="${ink.fill}" stroke="${ink.stroke}" stroke-width="${(ink.weight / size) * 1000}" stroke-linejoin="round">${esc(text)}</text></svg>`;
}

/** Arrowhead width and length, in stroke widths. */
const ARROW_WIDTHS: ReadonlyMap<string, number> = new Map([
  ['narrow', 2],
  ['medium', 3],
  ['wide', 5],
]);
const ARROW_LENGTHS: ReadonlyMap<string, number> = new Map([
  ['short', 2],
  ['medium', 3],
  ['long', 5],
]);

function arrow(
  pointsList: readonly [number, number][],
  start: boolean,
  stroke: OoxmlElement | undefined,
  color: string,
  weight: number
): string | null {
  const prefix = start ? 'startarrow' : 'endarrow';
  const type = stroke ? (a(stroke, prefix) ?? 'none') : 'none';
  if (type === 'none' || color === 'none') return '';
  if (!['block', 'classic', 'open'].includes(type)) return null;
  const w = ARROW_WIDTHS.get(a(stroke!, prefix + 'width') ?? 'medium');
  const h = ARROW_LENGTHS.get(a(stroke!, prefix + 'length') ?? 'medium');
  if (!w || !h) return null;
  if (weight === 0) return '';
  const tip = pointsList[start ? 0 : pointsList.length - 1]!;
  const previous = pointsList[start ? 1 : pointsList.length - 2]!;
  const dx = previous[0] - tip[0],
    dy = previous[1] - tip[1],
    distance = Math.hypot(dx, dy);
  if (!distance) return '';
  const ux = dx / distance,
    uy = dy / distance,
    len = h * weight,
    half = (w * weight) / 2;
  const left = [tip[0] + ux * len - uy * half, tip[1] + uy * len + ux * half];
  const right = [tip[0] + ux * len + uy * half, tip[1] + uy * len - ux * half];
  const d = `M${left.join(',')} L${tip.join(',')} L${right.join(',')}`;
  const notch =
    type === 'classic' ? ` L${tip[0] + ux * len * 0.75},${tip[1] + uy * len * 0.75}` : '';
  return `<path d="${d}${notch}${type === 'open' ? '' : ' Z'}" fill="${type === 'open' ? 'none' : color}" stroke="${color}" stroke-width="${weight}" stroke-linejoin="round"/>`;
}

function pathPoints(
  node: OoxmlElement,
  box: LegacyBox,
  ends?: LegacyLineEnds
): [number, number][] | null {
  const style = styleOf(node)!;
  if (ends) {
    // Explicit ends already carry the direction, with the line's flip applied.
    return ends.map(([x, y]) => [box.x + x, box.y + y]);
  }
  let coords: [number, number][];
  const authored = a(node, 'path');
  // An omitted operand is 0: `m,l1811,e` moves to 0,0 and draws to 1811,0.
  const source = authored?.replace(
    /([a-z])([^a-z]*)/gi,
    (_, command: string, operands: string) =>
      command +
      (operands.includes(',')
        ? operands
            .split(',')
            .map((operand) => operand.trim() || '0')
            .join(',')
        : operands)
  );
  if (source) {
    // One move followed by explicit line segments. Curves, formulas, relative
    // commands and multiple subpaths remain opaque rather than an incomplete chart.
    const tokens = source.match(/[mlxez]|-?(?:\d+(?:\.\d*)?|\.\d+)/gi) ?? [];
    if (
      tokens.join('').toLowerCase() !== source.replace(/[,\s]/g, '').toLowerCase() ||
      tokens.length > 256 ||
      tokens[0]?.toLowerCase() !== 'm'
    )
      return null;
    coords = [];
    let i = 1;
    while (i < tokens.length) {
      const command = tokens[i]!.toLowerCase();
      if (command === 'l') {
        i++;
        continue;
      }
      if (command === 'e') {
        if (i !== tokens.length - 1) return null;
        break;
      }
      const x = numeric(tokens[i]),
        y = numeric(tokens[i + 1]);
      if (![x, y].every(Number.isFinite)) return null;
      coords.push([x, y]);
      i += 2;
    }
    const size = pair(a(node, 'coordsize') ?? '21600,21600'),
      origin = coordOrigin(a(node, 'coordorigin') ?? '0,0');
    if (!size || !origin || size.some((v) => v < 0) || coords.length < 2) return null;
    // A zero coordinate extent is a flat axis: every point on it must sit at the origin.
    const scale = (value: number, axis: 0 | 1, extent: number) =>
      size[axis] > 0
        ? ((value - origin[axis]) * extent) / size[axis]
        : value === origin[axis]
          ? 0
          : NaN;
    coords = coords.map(([x, y]) => [scale(x, 0, box.width), scale(y, 1, box.height)]);
    if (coords.some((point) => !point.every(Number.isFinite))) return null;
  } else {
    if (a(node, 'from') || a(node, 'to')) return null;
    coords = [
      [0, 0],
      [box.width, box.height],
    ];
  }
  const flip = style.get('flip')?.split(/\s+/) ?? [];
  if (flip.some((v) => v !== 'x' && v !== 'y')) return null;
  return coords.map(([x, y]) => [
    box.x + (flip.includes('x') ? box.width - x : x),
    box.y + (flip.includes('y') ? box.height - y : y),
  ]);
}

/** A line's `from` and `to` points in points, relative to its box. */
export type LegacyLineEnds = readonly [readonly [number, number], readonly [number, number]];

/**
 * How far a line's ink reaches past its ends, in points: half the stroke, or the arrowhead
 * allowance when an end has one. A `closed` shape reaches half its stroke. Null when the paint
 * is outside the subset.
 */
export function legacyLineReach(node: OoxmlElement, closed = false): number | null {
  const ink = paint(node, !closed);
  if (!ink) return null;
  if (ink.stroke === 'none') return 0;
  // A closed shape draws no arrowheads.
  if (closed) return ink.weight / 2;
  const arrows =
    ink.strokeNode &&
    ['startarrow', 'endarrow'].some((key) => (a(ink.strokeNode!, key) ?? 'none') !== 'none');
  return arrows ? ink.weight * 6 : ink.weight / 2;
}

const EMU_PER_POINT = 12_700;
type Point = Readonly<{ x: number; y: number }>;

/** The filled or open arrowhead of a line end, in EMU, as `arrow` draws it. */
function arrowEmu(
  tip: Point,
  previous: Point,
  stroke: OoxmlElement,
  prefix: 'startarrow' | 'endarrow',
  weight: number
): { filled?: Point[]; open?: Point[] } | null {
  const type = a(stroke, prefix) ?? 'none';
  if (type === 'none') return {};
  const w = ARROW_WIDTHS.get(a(stroke, prefix + 'width') ?? 'medium');
  const h = ARROW_LENGTHS.get(a(stroke, prefix + 'length') ?? 'medium');
  if (!['block', 'classic', 'open'].includes(type) || !w || !h) return null;
  const dx = previous.x - tip.x,
    dy = previous.y - tip.y,
    distance = Math.hypot(dx, dy);
  if (!distance || weight === 0) return {};
  const ux = dx / distance,
    uy = dy / distance,
    len = h * weight,
    half = (w * weight) / 2;
  const left = { x: tip.x + ux * len - uy * half, y: tip.y + uy * len + ux * half };
  const right = { x: tip.x + ux * len + uy * half, y: tip.y + uy * len - ux * half };
  if (type === 'open') return { open: [left, tip, right] };
  if (type === 'block') return { filled: [tip, left, right] };
  return {
    filled: [tip, left, { x: tip.x + ux * len * 0.75, y: tip.y + uy * len * 0.75 }, right],
  };
}

/**
 * A `v:line` between `ends` as a vector shape in its own `width` by `height` points box. The
 * caller has validated the line with {@link legacyShapeFragment}. A vector shape paints in
 * every output, and its outline reaches past the box as a modern line's does. Null when the
 * paint is outside the subset.
 */
export function legacyLineShape(
  node: OoxmlElement,
  width: number,
  height: number,
  ends: LegacyLineEnds
): VectorShapeProjection | null {
  const ink = paint(node, true);
  if (!ink) return null;
  const emu = ([x, y]: readonly [number, number]): Point =>
    Object.freeze({ x: Math.round(x * EMU_PER_POINT), y: Math.round(y * EMU_PER_POINT) });
  const stroked = ink.stroke !== 'none' && ink.weight > 0;
  const strokeHex = stroked ? ink.stroke.slice(1).toUpperCase() : null;
  const weight = stroked ? ink.weight : 0;
  const subpaths: Point[][] = [];
  const closed: boolean[] = [];
  const arrowheads: Point[][] = [];
  const from = emu(ends[0]),
    to = emu(ends[1]);
  subpaths.push([from, to]);
  closed.push(false);
  if (stroked && ink.strokeNode) {
    const weightEmu = weight * EMU_PER_POINT;
    for (const [tip, previous, prefix] of [
      [from, to, 'startarrow'],
      [to, from, 'endarrow'],
    ] as const) {
      const head = arrowEmu(tip, previous, ink.strokeNode, prefix, weightEmu);
      if (!head) return null;
      if (head.filled) arrowheads.push(head.filled);
      if (head.open) {
        subpaths.push(head.open);
        closed.push(false);
      }
    }
  }
  const component = freezeVectorShapeComponent({
    subpathsEmu: subpaths,
    subpathsClosed: closed,
    ...(arrowheads.length ? { arrowheadsEmu: arrowheads } : {}),
    fillHex: null,
    fillAlpha: 1,
    strokeHex,
    strokeAlpha: 1,
    strokeWidthEmu: Math.round(weight * EMU_PER_POINT),
  });
  return Object.freeze({
    extentEmu: Object.freeze({
      cx: Math.round(width * EMU_PER_POINT),
      cy: Math.round(height * EMU_PER_POINT),
    }),
    subpathsEmu: component.subpathsEmu,
    fillHex: null,
    fillAlpha: 1,
    strokeHex,
    strokeAlpha: 1,
    strokeWidthEmu: component.strokeWidthEmu,
    components: Object.freeze(inkComponents(component, ink)),
  });
}

/**
 * A `v:rect`, `v:roundrect` or `v:oval` with a plain fill and outline, as a vector shape over
 * the graphic's `outer` box with the shape at `box`. It paints the same pixels as its graphic
 * preview, in every output. Null for any other shape.
 */
export function legacyBoxShape(
  node: OoxmlElement,
  box: LegacyBox,
  outer: LegacyBox
): VectorShapeProjection | null {
  // The text box template is a plain rectangle.
  const kind = a(node, 'type') === '#_x0000_t202' ? 'rect' : node.localName;
  const preset = ({ rect: 'rect', roundrect: 'roundRect', oval: 'ellipse' } as const)[
    kind as 'rect' | 'roundrect' | 'oval'
  ];
  const ink = preset ? paint(node) : null;
  if (!preset || !ink) return null;
  const radius = preset === 'roundRect' ? cornerRadius(node, box) : 0;
  const definition = presetGeometryDefinition(preset);
  if (radius === null || !definition) return null;
  const shortSide = Math.min(box.width, box.height);
  const adjust = new Map([['adj', shortSide > 0 ? Math.round((radius / shortSide) * 100_000) : 0]]);
  const geometry = evaluateGeometry(
    definition,
    box.width * EMU_PER_POINT,
    box.height * EMU_PER_POINT,
    adjust
  );
  const outline = geometry?.paths[0];
  if (!outline) return null;
  const dx = box.x * EMU_PER_POINT,
    dy = box.y * EMU_PER_POINT;
  const stroked = ink.stroke !== 'none' && ink.weight > 0;
  const fillHex = ink.fill === 'none' ? null : ink.fill.slice(1).toUpperCase();
  const strokeHex = stroked ? ink.stroke.slice(1).toUpperCase() : null;
  const component = freezeVectorShapeComponent({
    subpathsEmu: outline.subpaths.map((subpath) =>
      subpath.points.map((point) => ({ x: Math.round(point.x + dx), y: Math.round(point.y + dy) }))
    ),
    subpathsClosed: outline.subpaths.map((subpath) => subpath.closed),
    fillHex,
    fillAlpha: 1,
    strokeHex,
    strokeAlpha: 1,
    strokeWidthEmu: stroked ? Math.round(ink.weight * EMU_PER_POINT) : 0,
  });
  return Object.freeze({
    extentEmu: Object.freeze({
      cx: Math.round(outer.width * EMU_PER_POINT),
      cy: Math.round(outer.height * EMU_PER_POINT),
    }),
    subpathsEmu: component.subpathsEmu,
    fillHex,
    fillAlpha: 1,
    strokeHex,
    strokeAlpha: 1,
    strokeWidthEmu: component.strokeWidthEmu,
    components: Object.freeze(inkComponents(component, ink)),
  });
}

/** The corner radius of a `v:roundrect`: `arcsize` of half the shorter side (default 0.2). */
function cornerRadius(node: OoxmlElement, box: LegacyBox): number | null {
  const raw = (a(node, 'arcsize') ?? '0.2').trim();
  const fraction = raw.endsWith('f') ? numeric(raw.slice(0, -1)) / 65536 : numeric(raw);
  if (!Number.isFinite(fraction) || fraction < 0) return null;
  return (Math.min(fraction, 1) * Math.min(box.width, box.height)) / 2;
}

/** A picture outline: one solid line of `weight` points in `color` (`#rrggbb`) on all sides. */
export interface LegacyPictureBorder {
  readonly weight: number;
  readonly color: string;
}

const isBorderSide = (n: OoxmlElement) =>
  n.namespaceUri === WORD_VML &&
  ['bordertop', 'borderleft', 'borderbottom', 'borderright'].includes(n.localName);

/**
 * The `w10:border*` outline of a picture shape. Undefined when the shape has no border side.
 * Null unless all four sides are present once, as one `single` line of the same width (in
 * eighths of a point) and the same `o:border*color`; the caller refuses the picture then.
 */
export function legacyPictureBorder(node: OoxmlElement): LegacyPictureBorder | null | undefined {
  const sides = children(node).filter(
    (n) => n.namespaceUri === WORD_VML && n.localName.startsWith('border')
  );
  if (!sides.length) return undefined;
  if (sides.length !== 4 || !sides.every(isBorderSide)) return null;
  let border: LegacyPictureBorder | undefined;
  for (const side of sides) {
    const name = side.localName;
    const width = a(side, 'width') ?? '';
    const ink = color(a(node, `${name}color`, OFFICE), '');
    if (
      sides.filter((n) => n.localName === name).length !== 1 ||
      children(side).length ||
      side.attributes.some(
        (attr) => attr.namespaceUri || !['type', 'width'].includes(attr.localName)
      ) ||
      a(side, 'type') !== 'single' ||
      !/^\d{1,2}$/.test(width) ||
      !ink
    )
      return null;
    const eighths = Number(width);
    if (eighths < 1 || eighths > 96) return null;
    if (border && (border.weight !== eighths / 8 || border.color !== ink)) return null;
    border = { weight: eighths / 8, color: ink };
  }
  return border ? Object.freeze(border) : null;
}

/**
 * `bordered`: the caller validated the shape's `w10:border*` sides and draws the outline.
 * `ends`: a line's `from` and `to` points relative to `box`, in place of its diagonal.
 */
export function legacyShapeFragment(
  node: OoxmlElement,
  box: LegacyBox,
  canvas: LegacyBox = box,
  bordered = false,
  ends?: LegacyLineEnds
): LegacyGraphicFragment | null {
  // A point exactly on the edge stays inside despite floating-point error in the sums.
  const tolerance = 1e-9;
  const inside = (x: number, y: number, padding = 0) =>
    x - padding >= canvas.x - tolerance &&
    y - padding >= canvas.y - tolerance &&
    x + padding <= canvas.x + canvas.width + tolerance &&
    y + padding <= canvas.y + canvas.height + tolerance;
  if (!inside(box.x, box.y) || !inside(box.x + box.width, box.y + box.height)) return null;
  const list = children(node);
  if (
    list.some(
      (n) =>
        !(
          n.namespaceUri === VML &&
          ['imagedata', 'textpath', 'fill', 'stroke', 'path'].includes(n.localName)
        ) &&
        !named(n, OFFICE, 'lock') &&
        // A signature line's signing details are metadata; the picture is what shows.
        !(named(n, OFFICE, 'signatureline') && children(n).length === 0) &&
        !named(n, WORD_VML, 'wrap') &&
        !(named(n, WORD_VML, 'anchorlock') && n.attributes.length === 0) &&
        !(bordered && isBorderSide(n))
    )
  )
    return null;
  if (list.some((n) => children(n).length)) return null;
  const data = list.filter((n) => named(n, VML, 'imagedata'));
  if (data.length > 1) return null;
  const type = a(node, 'type');
  if (type === '#_x0000_t136') {
    if (
      data.some((n) => n.attributes.some((attr) => attr.localName !== 'title' || attr.value !== ''))
    )
      return null;
    return wordArt(node, box);
  }
  if (list.some((n) => named(n, VML, 'textpath'))) return null;
  if (data.length) {
    if (type && type !== '#_x0000_t75') return null;
    // Do not silently drop picture outlines or custom geometry/fills.
    if (
      a(node, 'path') ||
      (a(node, 'stroked') && !off(a(node, 'stroked'))) ||
      list.some((n) => {
        if (named(n, VML, 'path')) return n.attributes.length !== 0;
        if (named(n, VML, 'fill')) {
          return (
            !off(a(n, 'on') ?? a(node, 'filled')) ||
            n.attributes.some(
              (attr) =>
                attr.namespaceUri ||
                !['on', 'focussize'].includes(attr.localName) ||
                (attr.localName === 'focussize' && attr.value !== '0,0')
            )
          );
        }
        if (named(n, VML, 'stroke')) {
          return (
            !off(a(n, 'on') ?? a(node, 'stroked')) ||
            n.attributes.some((attr) => attr.namespaceUri || attr.localName !== 'on')
          );
        }
        return false;
      })
    )
      return null;
    const image = data[0]!,
      id = a(image, 'id', RELATIONSHIPS_NAMESPACE_URI);
    if (
      !id ||
      image.attributes.some(
        (attr) =>
          !(
            // The embedded id supplies the pixels. A saved source link stays inert.
            (attr.namespaceUri === RELATIONSHIPS_NAMESPACE_URI &&
              (attr.localName === 'id' || attr.localName === 'href')) ||
            (attr.localName === 'title' && attr.namespaceUri === OFFICE) ||
            (!attr.namespaceUri &&
              (['cropleft', 'croptop', 'cropright', 'cropbottom', 'chromakey'].includes(
                attr.localName
              ) ||
                LEGACY_IMAGE_EFFECT_ATTRIBUTES.has(attr.localName)))
          )
      ) ||
      legacyImageEffects(image) === null
    )
      return null;
    const key = a(image, 'chromakey');
    const keyColor = key === undefined ? undefined : color(key, '');
    if (keyColor === null) return null;
    const filter = keyColor ? legacyChromaKeyFilter(keyColor) : undefined;
    const crop = ['cropleft', 'croptop', 'cropright', 'cropbottom'].map((key) => {
      const raw = a(image, key) ?? '0';
      return raw.endsWith('f') ? numeric(raw.slice(0, -1)) / 65536 : numeric(raw);
    });
    const [left, top, right, bottom] = crop as [number, number, number, number];
    if (
      crop.some((v) => !Number.isFinite(v) || v < 0 || v >= 1) ||
      left + right >= 1 ||
      top + bottom >= 1
    )
      return null;
    const width = box.width / (1 - left - right),
      height = box.height / (1 - top - bottom);
    if (![width, height].every((value) => Number.isFinite(value) && value <= 100_000)) return null;
    return Object.freeze({
      relationshipId: id,
      ...(!filter ? { nativeCrop: Object.freeze({ left, top, right, bottom }) } : {}),
      before: `<svg x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" viewBox="0 0 ${box.width} ${box.height}" overflow="hidden">${filter?.definition ?? ''}<image x="${-left * width}" y="${-top * height}" width="${width}" height="${height}" preserveAspectRatio="none"${filter ? ` filter="url(#${filter.id})"` : ''} href="`,
      after: '"/></svg>',
    });
  }
  const framed = framePictureFill(node, list);
  if (framed !== undefined) {
    if (!framed) return null;
    return Object.freeze({
      relationshipId: framed,
      nativeCrop: Object.freeze({ left: 0, top: 0, right: 0, bottom: 0 }),
      before: `<svg x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" viewBox="0 0 ${box.width} ${box.height}" overflow="hidden"><image x="0" y="0" width="${box.width}" height="${box.height}" preserveAspectRatio="none" href="`,
      after: '"/></svg>',
    });
  }
  const ink = paint(node);
  if (!ink) return null;
  // The preview draws one outline; only a line painted as a vector shape draws bands.
  if (ink.compound !== 'sng' && !ends) return null;
  const padding = ink.stroke === 'none' ? 0 : ink.weight / 2;
  if (
    ['rect', 'roundrect', 'oval'].includes(node.localName) &&
    (!inside(box.x, box.y, padding) || !inside(box.x + box.width, box.y + box.height, padding))
  )
    return null;
  if (node.localName === 'rect')
    return `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" fill="${ink.fill}" stroke="${ink.stroke}" stroke-width="${ink.weight}"${dashArray(ink)}/>`;
  if (node.localName === 'roundrect') {
    const radius = cornerRadius(node, box);
    if (radius === null) return null;
    return `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="${radius}" ry="${radius}" fill="${ink.fill}" stroke="${ink.stroke}" stroke-width="${ink.weight}"${dashArray(ink)}/>`;
  }
  if (node.localName === 'oval')
    return `<ellipse cx="${box.x + box.width / 2}" cy="${box.y + box.height / 2}" rx="${box.width / 2}" ry="${box.height / 2}" fill="${ink.fill}" stroke="${ink.stroke}" stroke-width="${ink.weight}"${dashArray(ink)}/>`;
  if (node.localName !== 'line' && type !== '#_x0000_t32' && !a(node, 'path')) return null;
  const path = pathPoints(node, box, ends);
  if (!path || path.some((p) => p.some((v) => !Number.isFinite(v) || Math.abs(v) > 1_000_000)))
    return null;
  if (a(node, 'connectortype', OFFICE) && a(node, 'connectortype', OFFICE) !== 'straight')
    return null;
  if (path.some(([x, y]) => !inside(x, y, padding))) return null;
  if (ink.strokeNode && ink.stroke !== 'none') {
    for (const [key, index] of [
      ['startarrow', 0],
      ['endarrow', path.length - 1],
    ] as const) {
      if (
        a(ink.strokeNode, key) &&
        a(ink.strokeNode, key) !== 'none' &&
        !inside(path[index]![0], path[index]![1], ink.weight * 6)
      )
        return null;
    }
  }
  const start = arrow(path, true, ink.strokeNode, ink.stroke, ink.weight),
    end = arrow(path, false, ink.strokeNode, ink.stroke, ink.weight);
  if (start === null || end === null) return null;
  return `<polyline points="${path.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${ink.stroke}" stroke-width="${ink.weight}"${dashArray(ink)}/>${start}${end}`;
}

/**
 * A rectangle without an outline whose fill is one picture stretched to the shape
 * (`v:fill type="frame"`), which draws exactly like that picture: its relationship id.
 * `recolor` leaves the picture's own colours. Undefined when the shape has no such fill;
 * null when it has one outside this subset.
 */
function framePictureFill(
  node: OoxmlElement,
  list: readonly OoxmlElement[]
): string | null | undefined {
  const fill = list.find((n) => named(n, VML, 'fill'));
  if (!fill || a(fill, 'type') !== 'frame') return undefined;
  const id = a(fill, 'id', RELATIONSHIPS_NAMESPACE_URI);
  if (
    node.localName !== 'rect' ||
    !id ||
    !off(a(node, 'stroked')) ||
    off(a(fill, 'on') ?? a(node, 'filled')) ||
    list.some((n) => n !== fill) ||
    fill.attributes.some(
      (attr) =>
        !(
          (attr.namespaceUri === RELATIONSHIPS_NAMESPACE_URI && attr.localName === 'id') ||
          (attr.namespaceUri === OFFICE && attr.localName === 'title') ||
          (!attr.namespaceUri && ['type', 'on', 'recolor', 'rotate'].includes(attr.localName))
        )
    )
  )
    return null;
  return id;
}
