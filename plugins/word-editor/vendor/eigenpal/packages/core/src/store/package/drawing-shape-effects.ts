// The effect list a shape paints with, and the outer shadow (`a:outerShdw`) in it.
//
// Effects come from the shape's own `a:effectLst`, which replaces the theme effects, or from
// the theme effect style its `effectRef` names. The engine paints the outer shadow. Other
// effects (glow, inner shadow, reflection, soft edge, a dark-edged bevel) paint only through
// the effects renderer a capability package installs (`drawing-renderers.ts`).

import { themeEffectStyle } from './drawing-group-theme-effects.ts';
import { findDirectChild } from './drawing-shape-readers.ts';
import { isElement } from './drawing-projection-walk.ts';
import {
  resolveColorNode,
  type ShapeColor,
  type ShapeSchemeColorResolver,
} from './drawing-shape-color.ts';
import type { ShapeStyleMatrixResolver } from './drawing-shape-projection.ts';
import { collapseSchemaWhitespace, schemaAttributeValue } from './ooxml-drawing-rules.ts';
import { DRAWINGML_MAIN_NAMESPACE_URI, type OoxmlElement } from './ooxml-tree.ts';

const A = DRAWINGML_MAIN_NAMESPACE_URI;
/** Larger shadow distances and blurs are clamped: they would only add empty paint area. */
const MAX_SHADOW_EMU = 1_270_000;

/** An outer shadow: the shape's silhouette, offset, blurred and filled in one colour. */
export interface ShapeShadow {
  /** Offset of the silhouette, in the component's point space. */
  readonly dxEmu: number;
  /** Vertical offset of the silhouette, in the same units. */
  readonly dyEmu: number;
  /** Blur radius in the same units; 0 is a crisp silhouette. */
  readonly blurEmu: number;
  /** Validated six-character sRGB hex, without `#`. */
  readonly hex: string;
  /** Opacity, 0..1. */
  readonly alpha: number;
}

function nonNegative(element: OoxmlElement, name: string): number {
  const raw = schemaAttributeValue(element.attributes, name);
  if (raw === undefined) return 0;
  const collapsed = collapseSchemaWhitespace(raw);
  if (!/^\d{1,10}$/.test(collapsed)) return 0;
  return Math.min(MAX_SHADOW_EMU, Number(collapsed));
}

/** How a shape is flipped and turned, for shadows that turn with it. */
export interface ShapeTurn {
  readonly flipH: boolean;
  readonly flipV: boolean;
  readonly rotationDegrees: number;
}

function shadowOf(
  effectLst: OoxmlElement,
  resolveSchemeColor: ShapeSchemeColorResolver | undefined,
  placeholder: ShapeColor | undefined,
  turn: ShapeTurn | undefined
): ShapeShadow | null {
  const outer = findDirectChild(effectLst.children, { namespaceUri: A, localName: 'outerShdw' });
  if (!outer) return null;
  let colorNode: OoxmlElement | null = null;
  for (const node of outer.children) {
    if (isElement(node)) {
      colorNode = node;
      break;
    }
  }
  // An outer shadow with no colour is black at full strength (ECMA-376 20.1.8.49).
  const color = colorNode
    ? resolveColorNode(colorNode, resolveSchemeColor, placeholder)
    : { hex: '000000', alpha: 1 };
  if (!color || color.alpha <= 0) return null;
  const distance = nonNegative(outer, 'dist');
  const rawDirection = collapseSchemaWhitespace(
    schemaAttributeValue(outer.attributes, 'dir') ?? '0'
  );
  const direction = /^\d{1,9}$/.test(rawDirection) ? Number(rawDirection) / 60_000 : 0;
  const radians = (direction * Math.PI) / 180;
  let dx = distance * Math.cos(radians);
  let dy = distance * Math.sin(radians);
  // A shadow turns and flips with its shape unless `rotWithShape` is off (it defaults on).
  const rotWithShape = schemaAttributeValue(outer.attributes, 'rotWithShape');
  if (turn && rotWithShape !== '0' && rotWithShape !== 'false') {
    if (turn.flipH) dx = -dx;
    if (turn.flipV) dy = -dy;
    const angle = (turn.rotationDegrees * Math.PI) / 180;
    [dx, dy] = [
      dx * Math.cos(angle) - dy * Math.sin(angle),
      dx * Math.sin(angle) + dy * Math.cos(angle),
    ];
  }
  return {
    dxEmu: dx,
    dyEmu: dy,
    blurEmu: nonNegative(outer, 'blurRad'),
    hex: color.hex,
    alpha: color.alpha,
  };
}

/**
 * The effect list a shape paints with, and the colour `phClr` stands for in it.
 *
 * @internal
 */
export interface ShapeEffectList {
  /** The shape's own `a:effectLst`, or the one in the theme effect style it references. */
  readonly effectLst: OoxmlElement;
  /** True when `effectLst` comes from the theme through the shape's `effectRef`. */
  readonly fromTheme: boolean;
  /** The colour of the `effectRef`, which `phClr` in a theme effect list stands for. */
  readonly placeholder?: ShapeColor;
}

/**
 * The effect list a shape paints with: its own `a:effectLst`, or the theme effect style its
 * `effectRef` names, with that reference's colour as the placeholder colour. Null when it has
 * none.
 */
export function shapeEffectList(
  shape: OoxmlElement,
  spPr: OoxmlElement,
  resolveSchemeColor?: ShapeSchemeColorResolver,
  resolveStyleMatrixReference?: ShapeStyleMatrixResolver
): ShapeEffectList | null {
  const direct = findDirectChild(spPr.children, { namespaceUri: A, localName: 'effectLst' });
  if (direct) return { effectLst: direct, fromTheme: false };
  const style = findDirectChild(shape.children, {
    namespaceUri: shape.namespaceUri,
    localName: 'style',
  });
  const reference = style
    ? findDirectChild(style.children, { namespaceUri: A, localName: 'effectRef' })
    : null;
  if (!reference) return null;
  const raw = collapseSchemaWhitespace(schemaAttributeValue(reference.attributes, 'idx') ?? '');
  if (!/^\d{1,4}$/.test(raw) || Number(raw) === 0) return null;
  const effectStyle = themeEffectStyle(resolveStyleMatrixReference, Number(raw));
  const effectLst = effectStyle
    ? findDirectChild(effectStyle.children, { namespaceUri: A, localName: 'effectLst' })
    : null;
  if (!effectLst) return null;
  let placeholderNode: OoxmlElement | null = null;
  for (const node of reference.children) {
    if (isElement(node)) {
      placeholderNode = node;
      break;
    }
  }
  const placeholder = placeholderNode
    ? (resolveColorNode(placeholderNode, resolveSchemeColor) ?? undefined)
    : undefined;
  return { effectLst, fromTheme: true, ...(placeholder ? { placeholder } : {}) };
}

/** The outer shadow in a shape's effect list, or null when it has none the painters can draw. */
export function readShapeShadow(
  list: ShapeEffectList | null,
  resolveSchemeColor?: ShapeSchemeColorResolver,
  turn?: ShapeTurn
): ShapeShadow | null {
  return list ? shadowOf(list.effectLst, resolveSchemeColor, list.placeholder, turn) : null;
}

/**
 * A mirror image below a picture that fades out downward (`a:reflection`), as the effects
 * renderer projects it for paint.
 *
 * @public
 */
export interface ShapeReflection {
  /** Opacity where the mirror image meets the shape. */
  readonly startAlpha: number;
  /** Opacity at `endPosition`; below it the mirror image is clear. */
  readonly endAlpha: number;
  /** Where the fade ends, as a share of the shape's height. */
  readonly endPosition: number;
  /** Gap between the shape and its mirror image. */
  readonly distanceEmu: number;
  /** Blur radius of the mirror image. */
  readonly blurEmu: number;
}
