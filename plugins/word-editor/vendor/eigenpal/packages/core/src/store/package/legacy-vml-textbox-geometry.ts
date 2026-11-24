// The shape around a legacy VML text box: the area its text lays out in and the outline that
// paints around it.
//
// A rectangle keeps the whole box. A round rectangle and an oval move the text inside their
// curves. A preset template names its text area with `textboxrect` formulas over the shape's
// adjust values. The text box template (`o:spt="202"`) always uses the whole box: a text area
// written on it, or on a shape that uses it, does not move the text.
//
// A text area written on the shape itself (`v:path/@textboxrect`) follows measured rules: a
// round rectangle and a shape on a rectangle template ignore it, and so does a rectangle with
// its own coordinate size when the area covers it. A rectangle or an oval without a coordinate
// size paints its outline and hides its text. Other combinations are outside this subset.
//
// An untyped shape with no path has no geometry to draw: it paints nothing, its text included,
// whether or not it writes a text area.

import type { OoxmlElement } from './ooxml-tree.ts';
import {
  attribute as a,
  children,
  named,
  numeric,
  OFFICE,
  pair,
  VML,
  vmlFraction,
} from './legacy-vml-values.ts';
import {
  isFullRectangle,
  vmlCoordinate,
  vmlFormulaValues,
  vmlOperands,
  vmlPolygonPath,
  type VmlPolygon,
} from './legacy-vml-formulas.ts';

const EMU_PER_POINT = 12_700;
/** The share of each side an ellipse's inscribed rectangle leaves free: (1 - √½) / 2. */
const ELLIPSE_TEXT_INSET = (1 - Math.SQRT1_2) / 2;
/** `v:roundrect/@arcsize` default: a fifth of the shorter side. */
const DEFAULT_ARC_SIZE = 0.2;
const MAX_TEMPLATE_CHILDREN = 16;

/**
 * Outline geometry of a text box shape. A polygon's points are shares of the box, from 0 at
 * its top-left to 1 at its far side, so the outline stretches with a box that fits its text.
 */
export type TextboxOutlineProjection =
  | { readonly kind: 'ellipse' }
  /** The corner radius is `arc` times the box's shorter side. */
  | { readonly kind: 'roundRect'; readonly arc: number }
  | {
      readonly kind: 'polygon';
      readonly subpaths: readonly (readonly { readonly x: number; readonly y: number }[])[];
    };

/** The shape geometry of a legacy text box. */
export interface LegacyTextboxGeometry {
  /** Space between the shape box and its text area, in EMU, before the `v:textbox` insets. */
  readonly textAreaEmu: Readonly<{ top: number; right: number; bottom: number; left: number }>;
  /** Null for a rectangle, which paints as a plain box. */
  readonly outline: TextboxOutlineProjection | null;
  /** The shape paints and its text does not. */
  readonly textHidden?: true;
  /** Nothing paints: an untyped shape with no path has no geometry to draw. */
  readonly invisible?: true;
  /** How the text area follows the box size, for a box that fits its text. */
  readonly textAreaRule?: TextboxTextAreaRule;
}

/**
 * The text area of a box of any size: shares of its width and height (an oval, a preset), or
 * the inscribed square of a round rectangle's corner arc on every side.
 */
export type TextboxTextAreaRule =
  | {
      readonly kind: 'share';
      readonly top: number;
      readonly right: number;
      readonly bottom: number;
      readonly left: number;
    }
  | { readonly kind: 'arc'; readonly arc: number };

/** The text area `rule` gives a `width`×`height` box, in points. */
export function textAreaOf(
  rule: TextboxTextAreaRule,
  width: number,
  height: number
): { top: number; right: number; bottom: number; left: number } {
  if (rule.kind === 'arc') {
    const inset = rule.arc * Math.min(width, height) * (1 - Math.SQRT1_2);
    return { top: inset, right: inset, bottom: inset, left: inset };
  }
  return {
    top: rule.top * height,
    right: rule.right * width,
    bottom: rule.bottom * height,
    left: rule.left * width,
  };
}

const RECTANGLE: LegacyTextboxGeometry = Object.freeze({
  textAreaEmu: Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 }),
  outline: null,
});

const edges = (left: number, top: number, right: number, bottom: number) =>
  Object.freeze({
    top: Math.round(top * EMU_PER_POINT),
    right: Math.round(right * EMU_PER_POINT),
    bottom: Math.round(bottom * EMU_PER_POINT),
    left: Math.round(left * EMU_PER_POINT),
  });

/** The `textboxrect` of a shape's own `v:path` children, or undefined when none sets one. */
function ownTextboxRect(root: OoxmlElement): string | undefined {
  for (const child of children(root))
    if (named(child, VML, 'path') && a(child, 'textboxrect') !== undefined)
      return a(child, 'textboxrect');
  return undefined;
}

/** A `textboxrect` that is the first rectangle and covers the whole coordinate space. */
function coversSpace(rect: string, width: number, height: number): boolean {
  const values = vmlOperands(rect.split(';')[0] ?? '').map((v) => vmlCoordinate(v, []));
  return values.length === 4 && values.join(',') === `0,0,${width},${height}`;
}

/** `v:roundrect/@arcsize`: a fraction, or 16.16 fixed point with an `f` suffix. */
function arcSize(raw: string | undefined): number {
  const parsed = raw?.trim() ? vmlFraction(raw) : DEFAULT_ARC_SIZE;
  return parsed !== undefined && Number.isFinite(parsed) ? Math.min(0.5, Math.max(0, parsed)) : NaN;
}

/** Adjust values: the template's, with each slot the shape writes replacing it. */
function adjustValues(template: OoxmlElement, root: OoxmlElement): number[] | null {
  const base = (a(template, 'adj') ?? '').split(',');
  const own = (a(root, 'adj') ?? '').split(',');
  const count = Math.max(base.length, own.length);
  if (count > 16) return null;
  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    const raw = (own[i] ?? '').trim() || (base[i] ?? '').trim() || '0';
    const value = numeric(raw);
    if (!Number.isFinite(value)) return null;
    values.push(value);
  }
  return values;
}

function polygonOutline(
  polygons: readonly VmlPolygon[],
  size: readonly [number, number],
  flipX: boolean,
  flipY: boolean
): TextboxOutlineProjection | null {
  // A text box shape encloses its text; an open path is outside this subset.
  if (!polygons.every((polygon) => polygon.closed)) return null;
  const share = (value: number) => Math.round(value * 1e6) / 1e6;
  const subpaths = polygons.map((polygon) =>
    Object.freeze(
      polygon.points.map((p) => {
        const x = p.x / size[0],
          y = p.y / size[1];
        return Object.freeze({ x: share(flipX ? 1 - x : x), y: share(flipY ? 1 - y : y) });
      })
    )
  );
  // A point outside the box, or no number at all, is outside this subset.
  const inBox = (value: number) => Number.isFinite(value) && value >= -1 && value <= 2;
  if (!subpaths.every((points) => points.every((p) => inBox(p.x) && inBox(p.y)))) return null;
  return Object.freeze({
    kind: 'polygon' as const,
    subpaths: Object.freeze(subpaths),
  });
}

/** The `v:shapetype` in `host` that `root` names with its `type`, if the host holds it. */
export function legacyTemplateOf(host: OoxmlElement, root: OoxmlElement): OoxmlElement | undefined {
  const type = a(root, 'type');
  const id = type?.startsWith('#') ? type.slice(1) : undefined;
  return id
    ? children(host).find((child) => named(child, VML, 'shapetype') && a(child, 'id') === id)
    : undefined;
}

/** A template's children are geometry metadata; anything else is outside this subset. */
function templateChildrenOk(template: OoxmlElement): boolean {
  const list = children(template);
  if (list.length > MAX_TEMPLATE_CHILDREN) return false;
  return list.every(
    (child) =>
      (child.namespaceUri === VML &&
        ['stroke', 'path', 'formulas', 'handles', 'fill'].includes(child.localName)) ||
      named(child, OFFICE, 'lock')
  );
}

/**
 * The geometry of a text box shape `root` inside the `w:pict` `host`, whose box is
 * `width`×`height` points. Null when the shape names geometry this subset cannot trace.
 */
export function legacyTextboxGeometry(
  host: OoxmlElement,
  root: OoxmlElement,
  width: number,
  height: number,
  flip: { readonly x: boolean; readonly y: boolean }
): LegacyTextboxGeometry | null {
  const ownRect = ownTextboxRect(root);
  const coordsize = a(root, 'coordsize');
  const ownSize = pair(coordsize ?? '21600,21600');
  if (!ownSize || ownSize.some((n) => n <= 0)) return null;
  const ownRectCovers = ownRect === undefined || coversSpace(ownRect, ownSize[0], ownSize[1]);
  const plainHost =
    root.localName === 'rect' ||
    root.localName === 'oval' ||
    (root.localName === 'shape' && a(root, 'type') === undefined && a(root, 'path') === undefined);
  if (ownRect !== undefined && plainHost && coordsize !== undefined && !ownRectCovers) return null;
  if (ownRect !== undefined && root.localName !== 'rect' && plainHost && coordsize !== undefined)
    return null;
  const hide = <T extends LegacyTextboxGeometry>(geometry: T): LegacyTextboxGeometry =>
    ownRect !== undefined && plainHost && coordsize === undefined
      ? Object.freeze({ ...geometry, textHidden: true as const })
      : geometry;
  if (root.localName === 'rect') return hide(RECTANGLE);
  if (root.localName === 'roundrect') {
    const arc = arcSize(a(root, 'arcsize'));
    if (!Number.isFinite(arc)) return null;
    const rule = Object.freeze({ kind: 'arc' as const, arc });
    const area = textAreaOf(rule, width, height);
    return Object.freeze({
      textAreaEmu: edges(area.left, area.top, area.right, area.bottom),
      textAreaRule: rule,
      outline: arc > 0 ? Object.freeze({ kind: 'roundRect' as const, arc }) : null,
    });
  }
  if (root.localName === 'oval') {
    const x = width * ELLIPSE_TEXT_INSET,
      y = height * ELLIPSE_TEXT_INSET;
    return hide(
      Object.freeze({
        textAreaEmu: edges(x, y, x, y),
        outline: Object.freeze({ kind: 'ellipse' as const }),
        textAreaRule: Object.freeze({
          kind: 'share' as const,
          top: ELLIPSE_TEXT_INSET,
          right: ELLIPSE_TEXT_INSET,
          bottom: ELLIPSE_TEXT_INSET,
          left: ELLIPSE_TEXT_INSET,
        }),
      })
    );
  }
  if (root.localName !== 'shape') return null;

  const ownPath = a(root, 'path');
  const type = a(root, 'type');
  if (ownPath !== undefined) {
    // A shape that draws its own path keeps the whole box for its text.
    if (!ownRectCovers || a(root, 'coordorigin')) return null;
    const polygons = vmlPolygonPath(ownPath, []);
    if (!polygons || !polygons.length) return null;
    if (isFullRectangle(polygons, ownSize[0], ownSize[1])) return RECTANGLE;
    const outline = polygonOutline(polygons, ownSize, flip.x, flip.y);
    return outline ? Object.freeze({ textAreaEmu: RECTANGLE.textAreaEmu, outline }) : null;
  }
  const template = legacyTemplateOf(host, root);
  if (!template) {
    // An untyped shape is a rectangle. The rectangle and text box templates may be defined
    // once, earlier in the story; a shape on either ignores a text area of its own.
    if (type === undefined)
      return Object.freeze({ ...RECTANGLE, textHidden: true, invisible: true });
    return type === '#_x0000_t202' || type === '#_x0000_t1' ? RECTANGLE : null;
  }
  if (!templateChildrenOk(template)) return null;
  const textboxTemplate = a(template, 'spt', OFFICE) === '202';
  const size = pair(a(root, 'coordsize') ?? a(template, 'coordsize') ?? '21600,21600');
  if (!size || size.some((n) => n <= 0) || a(template, 'coordorigin') || a(root, 'coordorigin'))
    return null;
  const adjust = adjustValues(template, root);
  if (!adjust) return null;
  const formulasNode = children(template).find((child) => named(child, VML, 'formulas'));
  const eqns = formulasNode
    ? children(formulasNode)
        .filter((f) => named(f, VML, 'f'))
        .map((f) => a(f, 'eqn') ?? '')
    : [];
  const formulas = vmlFormulaValues(eqns, { width: size[0], height: size[1], adjust });
  if (!formulas) return null;
  const polygons = vmlPolygonPath(a(template, 'path') ?? '', formulas);
  if (!polygons || !polygons.length) return null;
  const rectangle = isFullRectangle(polygons, size[0], size[1]);
  // A preset ignoring a text area of its own is unmeasured; a rectangle template ignores it.
  if (!textboxTemplate && !rectangle && !ownRectCovers) return null;
  const outline = rectangle ? null : polygonOutline(polygons, size, flip.x, flip.y);
  if (!rectangle && !outline) return null;

  const templatePath = children(template).find((child) => named(child, VML, 'path'));
  const rect = textboxTemplate
    ? undefined
    : templatePath
      ? a(templatePath, 'textboxrect')
      : undefined;
  if (rect === undefined) return Object.freeze({ textAreaEmu: RECTANGLE.textAreaEmu, outline });
  const values = vmlOperands(rect.split(';')[0] ?? '').map((v) => vmlCoordinate(v, formulas));
  if (values.length !== 4 || !values.every(Number.isFinite)) return null;
  let [l, t, r, b] = values as [number, number, number, number];
  if (flip.x) [l, r] = [size[0] - r, size[0] - l];
  if (flip.y) [t, b] = [size[1] - b, size[1] - t];
  if (!(l >= 0 && t >= 0 && r <= size[0] && b <= size[1] && l < r && t < b)) return null;
  return Object.freeze({
    textAreaEmu: edges(
      (l / size[0]) * width,
      (t / size[1]) * height,
      ((size[0] - r) / size[0]) * width,
      ((size[1] - b) / size[1]) * height
    ),
    outline,
    textAreaRule: Object.freeze({
      kind: 'share' as const,
      top: t / size[1],
      right: (size[0] - r) / size[0],
      bottom: (size[1] - b) / size[1],
      left: l / size[0],
    }),
  });
}
