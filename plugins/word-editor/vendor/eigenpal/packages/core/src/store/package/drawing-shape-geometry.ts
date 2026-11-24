// A shape's geometry in its own extent: the preset or custom definition from `spPr`, its
// adjust overrides, and the flip and turn `a:xfrm` applies around the shape centre.

import {
  customGeometryDefinition,
  evaluateGeometry,
  presetGeometryDefinition,
  type EvaluatedGeometry,
  type GeometryFill,
} from './drawing-geometry-engine.ts';
import { findDirectChild } from './drawing-shape-readers.ts';
import { isElement } from './drawing-projection-walk.ts';
import type { ShapeColor } from './drawing-shape-color.ts';
import { collapseSchemaWhitespace, schemaAttributeValue } from './ooxml-drawing-rules.ts';
import { DRAWINGML_MAIN_NAMESPACE_URI, type OoxmlElement } from './ooxml-tree.ts';

type Point = Readonly<{ x: number; y: number }>;

/** At most this many adjust overrides are read from one `a:avLst`. */
const MAX_ADJUST_OVERRIDES = 32;

/** `a:prstGeom/a:avLst` overrides: each `a:gd` must be a `val` formula. */
function adjustOverrides(prstGeom: OoxmlElement): ReadonlyMap<string, number> | null {
  const avLst = findDirectChild(prstGeom.children, {
    namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
    localName: 'avLst',
  });
  const overrides = new Map<string, number>();
  if (!avLst) return overrides;
  for (const gd of avLst.children) {
    if (!isElement(gd) || gd.namespaceUri !== DRAWINGML_MAIN_NAMESPACE_URI) continue;
    if (gd.localName !== 'gd') continue;
    if (overrides.size >= MAX_ADJUST_OVERRIDES) return null;
    const name = schemaAttributeValue(gd.attributes, 'name');
    const formula = collapseSchemaWhitespace(schemaAttributeValue(gd.attributes, 'fmla') ?? '');
    const match = /^val (-?\d{1,10})$/.exec(formula);
    if (!name || !/^[A-Za-z][A-Za-z0-9]{0,31}$/.test(name) || !match) return null;
    overrides.set(name, Number(match[1]));
  }
  return overrides;
}

/**
 * The evaluated geometry of a shape's `spPr` at `extent`, or null when it names no geometry,
 * an unknown preset, or a custom geometry past the engine's bounds.
 */
export function readShapeGeometry(
  spPr: OoxmlElement,
  extent: Readonly<{ cx: number; cy: number }>
): EvaluatedGeometry | null {
  const custGeom = findDirectChild(spPr.children, {
    namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
    localName: 'custGeom',
  });
  if (custGeom) {
    const definition = customGeometryDefinition(custGeom);
    return definition ? evaluateGeometry(definition, extent.cx, extent.cy) : null;
  }
  // A picture's `pic:spPr` holds a typed preset; a shape's holds a generic one.
  const prstGeom = findDirectChild(spPr.children, {
    typedKind: 'picturePresetGeometry',
    namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
    localName: 'prstGeom',
  });
  const preset = prstGeom ? schemaAttributeValue(prstGeom.attributes, 'prst') : undefined;
  if (!prstGeom || !preset) return null;
  const definition = presetGeometryDefinition(preset);
  const overrides = adjustOverrides(prstGeom);
  if (!definition || !overrides) return null;
  return evaluateGeometry(definition, extent.cx, extent.cy, overrides);
}

/** `a:xfrm/@rot` in clockwise degrees [0, 360), or null when schema-invalid. */
export function shapeRotationDegrees(xfrm: OoxmlElement | null): number | null {
  const raw = xfrm ? schemaAttributeValue(xfrm.attributes, 'rot') : undefined;
  if (raw === undefined) return 0;
  const collapsed = collapseSchemaWhitespace(raw);
  if (!/^[+-]?\d{1,10}$/.test(collapsed)) return null;
  const units = Number(collapsed);
  if (Math.abs(units) > 2_147_483_647) return null;
  const degrees = (((units / 60_000) % 360) + 360) % 360;
  return Number.isFinite(degrees) ? degrees : null;
}

/**
 * The map from shape space to its placed extent: mirror for `flipH`/`flipV`, then turn
 * clockwise about the shape centre. DrawingML flips before it rotates.
 */
export function shapePointTransform(
  extent: Readonly<{ cx: number; cy: number }>,
  flipH: boolean,
  flipV: boolean,
  rotationDegrees: number
): (point: Point) => { x: number; y: number } {
  const centerX = extent.cx / 2;
  const centerY = extent.cy / 2;
  const radians = (rotationDegrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const turned = rotationDegrees !== 0;
  return (point) => {
    const x = flipH ? extent.cx - point.x : point.x;
    const y = flipV ? extent.cy - point.y : point.y;
    if (!turned) return { x, y };
    const dx = x - centerX;
    const dy = y - centerY;
    return { x: centerX + dx * cos - dy * sin, y: centerY + dx * sin + dy * cos };
  };
}

/**
 * The fill a path paints with under its `fill` mode. Darkened and lightened faces of 3D-looking
 * presets (cube, can, bevel, folded corner) blend the shape fill toward black or white.
 */
export function pathFillColor(fill: ShapeColor | null, mode: GeometryFill): ShapeColor | null {
  if (fill === null || mode === 'none') return null;
  if (mode === 'norm') return fill;
  const toward = mode === 'lighten' || mode === 'lightenLess' ? 255 : 0;
  const amount = mode === 'darken' || mode === 'lighten' ? 0.4 : 0.2;
  const channels = [0, 2, 4].map((offset) => {
    const channel = Number.parseInt(fill.hex.slice(offset, offset + 2), 16);
    return Math.round(channel + (toward - channel) * amount)
      .toString(16)
      .padStart(2, '0');
  });
  return { hex: channels.join('').toUpperCase(), alpha: fill.alpha };
}
