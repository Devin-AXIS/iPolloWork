// Move, resize, describe and delete a legacy VML text box.
//
// A VML shape keeps its geometry in its `style` attribute: `width` and `height` for the extent,
// `margin-left` and `margin-top` for the offset from the frames that
// `mso-position-horizontal-relative` and `mso-position-vertical-relative` name. A resize or a
// move rewrites exactly those entries in points, alt text rewrites the shape's `title` and
// `alt` attributes, and every other entry, attribute and child stays as it was. Only the text
// box shapes the projection reads as movable take these ops; any other legacy drawing keeps
// refusing them, and an edit whose result the projection would not read back is refused.

import { findNode, removeNode, replaceNode, type EditOptions } from '../package/ooxml-edit.ts';
import { isLegacyVmlAtom, projectLegacyVml } from '../package/legacy-vml-projection.ts';
import { attribute, children, named, VML } from '../package/legacy-vml-values.ts';
import type { DrawingProjection } from '../package/drawing-projection.ts';
import { validateDrawingPositionInput } from '../package/drawing-position-input.ts';
import {
  WML_NAMESPACE_URI,
  type OoxmlAttribute,
  type OoxmlElement,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { fromEdit } from './tree-op-nodes.ts';
import { drawingEffect, isValidXmlMetadata } from './tree-op-drawing-kinds.ts';
import type { DrawingTreeDocOp, TreeOpRejection, TreeOpResult } from './tree-op-types.ts';

/** The drawing ops a legacy VML text box takes. */
export type LegacyVmlDrawingOp = Extract<
  DrawingTreeDocOp,
  { readonly op: 'resizeDrawing' | 'positionDrawing' | 'deleteDrawing' | 'setDrawingMetadata' }
>;

/** The VML value of each reference frame a moved legacy shape can keep. */
const HORIZONTAL_FRAMES: Readonly<Record<string, string>> = {
  column: 'text',
  character: 'char',
  page: 'page',
  margin: 'margin',
  leftMargin: 'left-margin-area',
  rightMargin: 'right-margin-area',
};
const VERTICAL_FRAMES: Readonly<Record<string, string>> = {
  paragraph: 'text',
  line: 'line',
  page: 'page',
  margin: 'margin',
  topMargin: 'top-margin-area',
  bottomMargin: 'bottom-margin-area',
};

const SHAPES = new Set(['shape', 'rect', 'roundrect', 'oval']);
/** The largest extent and offset the projection reads, 10 000 pt and 100 000 pt. */
const MAX_EXTENT_EMU = 10_000 * 12700;
const MAX_OFFSET_EMU = 100_000 * 12700;
/** The smallest extent written: a hundredth of a point, the precision `style` is written in. */
const MIN_EXTENT_EMU = 127;

interface LegacyTextbox {
  readonly pict: OoxmlElement;
  readonly shape: OoxmlElement;
  readonly projection: DrawingProjection;
}

/** The legacy text box `drawingNodeId` names, or null when it names anything else. */
function legacyTextbox(part: OoxmlPart, drawingNodeId: string): LegacyTextbox | null {
  const pict = findNode(part, drawingNodeId);
  if (!pict || pict.kind === 'textValue' || !named(pict, WML_NAMESPACE_URI, 'pict')) return null;
  if (!isLegacyVmlAtom(pict)) return null;
  const projection = projectLegacyVml(pict, part.name);
  if (!projection?.textboxStory) return null;
  const shapes = children(pict).filter((child) => !named(child, VML, 'shapetype'));
  const shape = shapes.length === 1 ? shapes[0]! : null;
  if (!shape || shape.namespaceUri !== VML || !SHAPES.has(shape.localName)) return null;
  return { pict, shape, projection };
}

/**
 * `op` when it targets a legacy VML drawing, which takes this module's path whatever the
 * outcome; null for every other op.
 */
export function legacyVmlDrawingOp(
  part: OoxmlPart,
  op: DrawingTreeDocOp
): LegacyVmlDrawingOp | null {
  if (
    op.op !== 'resizeDrawing' &&
    op.op !== 'positionDrawing' &&
    op.op !== 'deleteDrawing' &&
    op.op !== 'setDrawingMetadata'
  )
    return null;
  const node = findNode(part, op.drawingNodeId);
  return node && node.kind !== 'textValue' && named(node, WML_NAMESPACE_URI, 'pict') ? op : null;
}

/** Why the op's values are out of bounds, before the target is looked at. */
function valueRejection(op: LegacyVmlDrawingOp): TreeOpRejection | null {
  switch (op.op) {
    case 'deleteDrawing':
      return op.revision ? 'trackedDrawingDeletionUnsupported' : null;
    case 'resizeDrawing':
      // The bounds the projection reads back, at the precision `style` is written in.
      return [op.extentEmu.cx, op.extentEmu.cy].every(
        (emu) => Number.isFinite(emu) && emu >= MIN_EXTENT_EMU && emu <= MAX_EXTENT_EMU
      )
        ? null
        : 'invalid-drawing-value';
    case 'positionDrawing':
      return validateDrawingPositionInput(op.position) &&
        (op.position.mode ?? 'frame') === 'frame' &&
        [op.position.horizontalEmu, op.position.verticalEmu].every(
          (emu) => emu === undefined || Math.abs(emu) <= MAX_OFFSET_EMU
        ) &&
        (op.position.relativeToH === undefined || op.position.relativeToH in HORIZONTAL_FRAMES) &&
        (op.position.relativeToV === undefined || op.position.relativeToV in VERTICAL_FRAMES)
        ? null
        : 'invalid-drawing-value';
    case 'setDrawingMetadata':
      if (!isValidXmlMetadata(op.title) || !isValidXmlMetadata(op.description))
        return 'invalid-drawing-value';
      // A legacy shape has no link of its own to keep or add.
      return op.hyperlink !== undefined && op.hyperlink !== null
        ? 'packageTransactionRequired'
        : null;
  }
}

/** Why a legacy op is refused, or null when it applies exactly. */
export function legacyVmlGeometryRejection(
  part: OoxmlPart,
  op: LegacyVmlDrawingOp
): TreeOpRejection | null {
  const value = valueRejection(op);
  if (value) return value;
  const target = legacyTextbox(part, op.drawingNodeId);
  // Every other legacy drawing is read-only.
  if (!target) return 'drawing-locked';
  const { locks, kind } = target.projection;
  if (op.op === 'deleteDrawing') return locks.select ? 'drawing-locked' : null;
  if (op.op === 'setDrawingMetadata') return null;
  if (op.op === 'resizeDrawing') return locks.resize ? 'drawing-locked' : null;
  if (locks.move) return 'drawing-locked';
  return kind === 'anchored' ? null : 'invalid-drawing-value';
}

/** Points written for EMU, to the hundredth. */
const pointsOf = (emu: number): string => `${Math.round((emu / 12700) * 100) / 100}pt`;

/** `style` with `set` entries written in place (or appended) and `drop` entries removed. */
function restyled(
  style: string,
  set: ReadonlyMap<string, string>,
  drop: ReadonlySet<string>
): string {
  const written = new Set<string>();
  const entries: string[] = [];
  for (const entry of style.split(';')) {
    const colon = entry.indexOf(':');
    if (colon < 1) continue;
    const key = entry.slice(0, colon).trim().toLowerCase();
    if (drop.has(key)) continue;
    const value = set.get(key);
    entries.push(value === undefined ? entry.trim() : `${key}:${value}`);
    if (value !== undefined) written.add(key);
  }
  for (const [key, value] of set) if (!written.has(key)) entries.push(`${key}:${value}`);
  return entries.join(';');
}

/** `attributes` with the unqualified `values` written, an empty value removing its attribute. */
function withAttributes(
  attributes: readonly OoxmlAttribute[],
  values: ReadonlyMap<string, string>
): OoxmlAttribute[] {
  const plain = (a: OoxmlAttribute) => !a.namespaceUri && values.has(a.localName);
  const kept = attributes.filter((a) => !plain(a) || values.get(a.localName) !== '');
  // Only unqualified attributes are rewritten, and those are the generic kind.
  const next = kept.map((a): OoxmlAttribute =>
    plain(a) ? ({ ...a, value: values.get(a.localName)! } as OoxmlAttribute) : a
  );
  for (const [localName, value] of values) {
    if (value === '' || next.some((a) => !a.namespaceUri && a.localName === localName)) continue;
    next.push({ kind: 'genericExtension', namespaceUri: '', localName, value });
  }
  return next;
}

/** The shape attributes `op` writes. */
function shapeAttributes(shape: OoxmlElement, op: LegacyVmlDrawingOp): OoxmlAttribute[] {
  if (op.op === 'setDrawingMetadata')
    return withAttributes(
      shape.attributes,
      new Map([
        ['title', op.title],
        ['alt', op.description],
      ])
    );
  const set = new Map<string, string>();
  const drop = new Set<string>();
  if (op.op === 'resizeDrawing') {
    set.set('width', pointsOf(op.extentEmu.cx));
    set.set('height', pointsOf(op.extentEmu.cy));
  } else if (op.op === 'positionDrawing') {
    const { horizontalEmu, verticalEmu, relativeToH, relativeToV } = op.position;
    // An offset replaces an alignment, as a modern drawing's `wp:posOffset` replaces `wp:align`.
    if (horizontalEmu !== undefined) {
      set.set('margin-left', pointsOf(horizontalEmu));
      drop.add('mso-position-horizontal').add('left');
    }
    if (verticalEmu !== undefined) {
      set.set('margin-top', pointsOf(verticalEmu));
      drop.add('mso-position-vertical').add('top');
    }
    if (relativeToH !== undefined)
      set.set('mso-position-horizontal-relative', HORIZONTAL_FRAMES[relativeToH]!);
    if (relativeToV !== undefined)
      set.set('mso-position-vertical-relative', VERTICAL_FRAMES[relativeToV]!);
  }
  // A shape the projection reads has a `style`: its extent comes from it.
  return withAttributes(
    shape.attributes,
    new Map([['style', restyled(attribute(shape, 'style')!, set, drop)]])
  );
}

/** Apply a legacy op that {@link legacyVmlGeometryRejection} accepted. */
export function applyLegacyVmlGeometryOp(
  part: OoxmlPart,
  op: LegacyVmlDrawingOp,
  options?: EditOptions
): TreeOpResult {
  const rejection = legacyVmlGeometryRejection(part, op);
  if (rejection) return { ok: false, reason: rejection };
  const { pict, shape } = legacyTextbox(part, op.drawingNodeId)!;
  if (op.op === 'deleteDrawing') {
    const effect = drawingEffect(part, pict.id, op);
    return fromEdit(removeNode(part, pict.id, options), { ...effect, deleted: [pict.id] });
  }
  const updatedShape = { ...shape, attributes: shapeAttributes(shape, op) } as OoxmlElement;
  const updatedPict = {
    ...pict,
    children: pict.children.map((child) => (child.id === shape.id ? updatedShape : child)),
  } as OoxmlElement;
  // Refuse rather than write a shape the projection would no longer read: it would vanish.
  if (!projectLegacyVml(updatedPict, part.name)?.textboxStory)
    return { ok: false, reason: 'invalid-drawing-value' };
  return fromEdit(
    replaceNode(part, pict.id, updatedPict, options),
    drawingEffect(part, pict.id, op)
  );
}
