// The frame of a DrawingML diagram (`dgm:` graphic data): find a bare diagram drawing, and
// rescale its saved drawing part (`dsp:drawing`) when the frame changes size.
//
// Other DOCX applications lay a diagram out again from its data model for `wp:extent` and
// rewrite the saved drawing with absolute positions for the new frame, leaving
// `dsp:grpSpPr` empty. The saved drawing serves applications that read it instead, and this
// engine paints from it, so a resize keeps it in step: every shape and text rectangle scales
// on each axis, and font sizes follow the smaller axis, rounded to whole points. Line widths,
// insets, and geometry adjustments keep their values.

import {
  DIAGRAM_DRAWING_NAMESPACE_URI,
  DIAGRAM_GRAPHIC_DATA_URI,
  DIAGRAM_NAMESPACE_URI,
  createDiagramPartResolver,
} from './diagram-parts.ts';
import { findGraphicData } from './drawing-group-frame.ts';
import { findDirectChild } from './drawing-shape-readers.ts';
import { replaceNode } from './ooxml-edit.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import { withPart } from './ooxml-package.ts';
import {
  DRAWINGML_MAIN_NAMESPACE_URI,
  WML_NAMESPACE_URI,
  WP_NAMESPACE_URI,
} from './ooxml-shared.ts';
import type { OoxmlAttribute, OoxmlElement, OoxmlNode } from './ooxml-tree.ts';

const A = DRAWINGML_MAIN_NAMESPACE_URI;
const DSP = DIAGRAM_DRAWING_NAMESPACE_URI;
/** Font sizes in hundredths of a point: 1 pt to 4000 pt, the `ST_TextFontSize` range. */
const MIN_FONT_SIZE = 100;
const MAX_FONT_SIZE = 400_000;
/** Text run properties whose `sz` sets a font size. */
const RUN_PROPERTIES = new Set(['rPr', 'defRPr', 'endParaRPr']);
/** The `ST_Coordinate` bound: a scaled position or size past it is not valid DrawingML. */
const MAX_COORDINATE = 27_273_042_316_900;

/** The `wp:inline` or `wp:anchor` of a `w:drawing`, or null. */
function anchorOf(drawing: OoxmlElement): OoxmlElement | null {
  for (const child of drawing.children) {
    if (child.kind === 'textValue') continue;
    if (child.kind === 'inlineDrawing' || child.kind === 'anchoredDrawing') return child;
    if (
      child.namespaceUri === WP_NAMESPACE_URI &&
      (child.localName === 'inline' || child.localName === 'anchor')
    )
      return child;
  }
  return null;
}

/** The `dgm:relIds` of a drawing that holds a diagram, or null for any other drawing. */
function diagramRelIds(drawing: OoxmlElement): OoxmlElement | null {
  const isDrawing =
    drawing.kind === 'drawing' ||
    (drawing.namespaceUri === WML_NAMESPACE_URI && drawing.localName === 'drawing');
  if (!isDrawing) return null;
  const anchor = anchorOf(drawing);
  const data = anchor ? findGraphicData(anchor) : null;
  if (!data) return null;
  const uri = data.attributes.find((attribute) => attribute.localName === 'uri')?.value;
  if (uri !== DIAGRAM_GRAPHIC_DATA_URI) return null;
  return findDirectChild(data.children, {
    namespaceUri: DIAGRAM_NAMESPACE_URI,
    localName: 'relIds',
  });
}

/** The `graphicData/@uri` of a shape and of a group of shapes. */
const SHAPE_GRAPHIC_DATA_URIS: ReadonlySet<string> = new Set([
  'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
  'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup',
]);

/**
 * Whether `drawing` is a `w:drawing` that holds a shape, a line or a group of shapes, whether
 * or not its geometry projects: such a frame moves and deletes as a whole.
 */
export function holdsShapeGraphic(drawing: OoxmlElement): boolean {
  const anchor = anchorOf(drawing);
  const data = anchor ? findGraphicData(anchor) : null;
  const uri = data?.attributes.find((attribute) => attribute.localName === 'uri')?.value;
  return uri !== undefined && SHAPE_GRAPHIC_DATA_URIS.has(uri);
}

/** Whether `drawing` is a `w:drawing` that holds a DrawingML diagram. */
export function holdsDiagramGraphic(drawing: OoxmlElement): boolean {
  return diagramRelIds(drawing) !== null;
}

/** The saved drawing part behind a diagram drawing of `ownerPart`, or null when it has none. */
export function diagramDrawingPartName(
  pkg: OoxmlPackage,
  ownerPart: string,
  drawing: OoxmlElement
): string | null {
  const relIds = diagramRelIds(drawing);
  if (!relIds) return null;
  return createDiagramPartResolver(pkg, ownerPart)(relIds)?.drawingPartName ?? null;
}

/** The attributes with each named coordinate scaled, or null when one leaves `ST_Coordinate`. */
function scaledAttributes(
  attributes: readonly OoxmlAttribute[],
  scales: Readonly<Record<string, number>>
): readonly OoxmlAttribute[] | null {
  let changed = false;
  let outOfRange = false;
  const next = attributes.map((attribute) => {
    if (attribute.kind !== 'genericExtension' || attribute.namespaceUri !== '') return attribute;
    const scale = scales[attribute.localName];
    if (scale === undefined || !/^-?\d{1,15}$/.test(attribute.value)) return attribute;
    const scaled = Math.round(Number(attribute.value) * scale);
    if (!Number.isSafeInteger(scaled) || Math.abs(scaled) > MAX_COORDINATE) outOfRange = true;
    const value = String(scaled);
    if (outOfRange || value === attribute.value) return attribute;
    changed = true;
    return { ...attribute, value };
  });
  if (outOfRange) return null;
  return changed ? next : attributes;
}

function scaledFontSize(attributes: readonly OoxmlAttribute[], scale: number) {
  let changed = false;
  const next = attributes.map((attribute) => {
    if (attribute.kind !== 'genericExtension' || attribute.namespaceUri !== '') return attribute;
    if (attribute.localName !== 'sz') return attribute;
    if (!/^\d{1,6}$/.test(attribute.value)) return attribute;
    const points = Math.round((Number(attribute.value) * scale) / 100) * 100;
    const value = String(Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, points)));
    if (value === attribute.value) return attribute;
    changed = true;
    return { ...attribute, value };
  });
  return changed ? next : attributes;
}

/**
 * `drawing` (a `dsp:drawing` root) laid out for a frame `sx` times as wide and `sy` times as
 * tall, or null when a scaled position or size would leave the `ST_Coordinate` range. Node ids
 * stay, so the write is one edit of the part.
 */
export function scaleDiagramDrawing(
  drawing: OoxmlElement,
  sx: number,
  sy: number
): OoxmlElement | null {
  if (sx === 1 && sy === 1) return drawing;
  if (!(Number.isFinite(sx) && Number.isFinite(sy) && sx > 0 && sy > 0)) return null;
  const text = Math.min(sx, sy);
  const position = { x: sx, y: sy };
  const size = { cx: sx, cy: sy };
  let outOfRange = false;
  const walk = (node: OoxmlNode, inTransform: boolean): OoxmlNode => {
    if (node.kind === 'textValue' || outOfRange) return node;
    let attributes: readonly OoxmlAttribute[] | null = node.attributes;
    if (inTransform && node.namespaceUri === A) {
      if (node.localName === 'off' || node.localName === 'chOff')
        attributes = scaledAttributes(attributes, position);
      else if (node.localName === 'ext' || node.localName === 'chExt')
        attributes = scaledAttributes(attributes, size);
    } else if (node.namespaceUri === A && RUN_PROPERTIES.has(node.localName)) {
      attributes = scaledFontSize(attributes, text);
    }
    if (!attributes) {
      outOfRange = true;
      return node;
    }
    const transform =
      (node.namespaceUri === A && node.localName === 'xfrm') ||
      (node.namespaceUri === DSP && node.localName === 'txXfrm');
    const children = node.children.map((child) => walk(child, transform));
    const same =
      attributes === node.attributes && children.every((kid, i) => kid === node.children[i]);
    return same ? node : ({ ...node, attributes, children } as OoxmlElement);
  };
  const scaled = walk(drawing, false) as OoxmlElement;
  return outOfRange ? null : scaled;
}

const DRAWING_PART_USES = new WeakMap<OoxmlPackage, ReadonlyMap<string, number>>();

/**
 * How many diagram drawings resolve to each saved drawing part. One walk of the story parts
 * per package: the package is immutable, so the counts stay valid for it.
 */
function drawingPartUses(pkg: OoxmlPackage): ReadonlyMap<string, number> {
  const cached = DRAWING_PART_USES.get(pkg);
  if (cached) return cached;
  const uses = new Map<string, number>();
  for (const [partName, part] of pkg.parts) {
    if (part.root.namespaceUri !== WML_NAMESPACE_URI) continue;
    const resolve = createDiagramPartResolver(pkg, partName);
    const walk = (node: OoxmlNode): void => {
      if (node.kind === 'textValue') return;
      const relIds = diagramRelIds(node);
      if (relIds) {
        const name = resolve(relIds)?.drawingPartName;
        if (name) uses.set(name, (uses.get(name) ?? 0) + 1);
        return;
      }
      for (const child of node.children) walk(child);
    };
    walk(part.root);
  }
  DRAWING_PART_USES.set(pkg, uses);
  return uses;
}

/** Whether another diagram shares the saved drawing part of this diagram drawing. */
export function diagramDrawingPartShared(
  pkg: OoxmlPackage,
  ownerPart: string,
  drawing: OoxmlElement
): boolean {
  const name = diagramDrawingPartName(pkg, ownerPart, drawing);
  return name !== null && (drawingPartUses(pkg).get(name) ?? 0) > 1;
}

/**
 * The package with the saved drawing of a diagram rescaled from frame `from` to frame `to`.
 * Unchanged when the diagram has no saved drawing part, or a size is not positive. Null, a
 * refusal, when another diagram shares the saved drawing part, which the rescale would
 * distort, or when a scaled value would leave the `ST_Coordinate` range.
 */
export function withRescaledDiagramDrawing(
  pkg: OoxmlPackage,
  ownerPart: string,
  drawing: OoxmlElement,
  from: Readonly<{ cx: number; cy: number }>,
  to: Readonly<{ cx: number; cy: number }>
): OoxmlPackage | null {
  if (!(from.cx > 0 && from.cy > 0 && to.cx > 0 && to.cy > 0)) return pkg;
  if (from.cx === to.cx && from.cy === to.cy) return pkg;
  const name = diagramDrawingPartName(pkg, ownerPart, drawing);
  const part = name ? pkg.parts.get(name) : undefined;
  if (!part || !name) return pkg;
  if ((drawingPartUses(pkg).get(name) ?? 0) > 1) return null;
  const root = scaleDiagramDrawing(part.root, to.cx / from.cx, to.cy / from.cy);
  if (!root) return null;
  if (root === part.root) return pkg;
  const replaced = replaceNode(part, part.root.id, root);
  return replaced.ok ? withPart(pkg, replaced.part) : null;
}
