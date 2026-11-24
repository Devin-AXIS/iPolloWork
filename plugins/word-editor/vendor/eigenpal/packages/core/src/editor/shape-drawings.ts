// Which selected drawings are DrawingML shapes, lines or groups: they paint their own geometry,
// with no picture to replace, crop or transform, and their size also lives in that geometry.

import type { EditorCommand, ExecResult } from '../contracts/editor.ts';
import type { AnchoredDrawingRecord, InlineDrawingRecord } from '../layout/drawing-layout.ts';
import { holdsDiagramGraphic } from '../store/package/diagram-frame.ts';
import type { DrawingProjection } from '../store/package/drawing-projection.ts';
import { findNode } from '../store/package/ooxml-edit.ts';
import type { OoxmlPart } from '../store/package/ooxml-tree.ts';
import { pointsToEmu } from './image-overlay-geometry.ts';
import { validateDrawingOp } from '../store/store/tree-op-drawings.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { partOfNodeId } from './surface-scope.ts';
import { selectedGroupMember } from './group-member-selection.ts';
import {
  readShapeFormat,
  narrowedTargets,
  shapeFormatTargets,
  type ShapeFormatState,
} from '../store/package/shape-format.ts';
import { createPackageShapeThemeResolvers } from '../store/package/theme-color-resolution.ts';

/**
 * Whether a laid-out drawing is a shape, line or group: not a picture, text box, chart or
 * diagram (a diagram paints from its saved drawing, as shapes).
 */
export function isShapeDrawing(
  surface: PaginatedSurface,
  record: InlineDrawingRecord | AnchoredDrawingRecord | null
): boolean {
  if (!record?.vectorShape || record.textboxStory || record.chart) return false;
  // A picture (its outline projects as a shape) and a legacy VML drawing name no graphic kind.
  if (record.placeholderGraphicKind === null || record.groupPicture) return false;
  if (record.resource.kind === 'ready' || record.placeholderGraphicKind === 'chart') return false;
  const part = partOfNodeId(surface.session, record.drawingNodeId) ?? surface.session.part();
  const node = findNode(part, record.drawingNodeId);
  return !node || node.kind === 'textValue' || !holdsDiagramGraphic(node);
}

/**
 * The refusal of a picture command on a selected text box or shape, or null. A shape's turn and
 * flips live in its own geometry and its VML fallback, as its size does, so it refuses a
 * transform as it refuses a resize. The reason names the command.
 */
export function shapePictureCommandRefusal(
  command: EditorCommand,
  surface: PaginatedSurface,
  record: InlineDrawingRecord | AnchoredDrawingRecord | null
): ExecResult | null {
  const hyperlink = command.type === 'setImageProperties' && command.hyperlink !== undefined;
  if (command.type !== 'replaceImage' && command.type !== 'transformImage' && !hyperlink) {
    return null;
  }
  const textbox = !!record && 'textboxStory' in record && !!record.textboxStory;
  if (!textbox && !isShapeDrawing(surface, record)) return null;
  const kind = textbox ? 'text boxes' : 'shapes';
  const what =
    command.type === 'transformImage'
      ? 'rotate and flip are'
      : command.type === 'replaceImage'
        ? 'replacing the picture is'
        : 'hyperlinks are';
  return { ok: false, code: 'unsupported', reason: `${what} not supported for ${kind}` };
}

/**
 * Whether the store takes a text wrap change for a text box, shape, line or group: a DrawingML
 * frame (`wp:anchor` or `wp:inline`) that no move lock holds. A legacy VML shape has no such frame.
 */
export function shapeFrameWraps(
  surface: PaginatedSurface,
  projection: DrawingProjection,
  chart: 'none' | 'frame' | 'locked'
): boolean {
  if (chart !== 'none' || projection.picture !== null) return false;
  const { drawingNodeId } = projection;
  const part = partOfNodeId(surface.session, drawingNodeId) ?? surface.session.part();
  // A part is immutable, so its answer holds until an edit makes a new part. The selected image
  // is read on every snapshot, and the check projects the drawing again.
  let answers = frameWrapAnswers.get(part);
  if (!answers) frameWrapAnswers.set(part, (answers = new Map()));
  let answer = answers.get(drawingNodeId);
  if (answer === undefined) {
    answer =
      validateDrawingOp(part, { op: 'setDrawingWrap', drawingNodeId, wrap: 'square' }) === null;
    answers.set(drawingNodeId, answer);
  }
  return answer;
}

const frameWrapAnswers = new WeakMap<OoxmlPart, Map<string, boolean>>();

/**
 * The painted height, in EMU, of a text box that fits its text ("Resize shape to fit text"), or
 * null for any other drawing. Its `wp:extent` height is not what the page shows, so the selected
 * image and a resize report and start from this height, and a resize that keeps it keeps the fit.
 */
export function fittedTextboxHeightEmu(
  record: InlineDrawingRecord | AnchoredDrawingRecord | null
): number | null {
  const height = record && 'textboxStory' in record ? record.textboxStory?.extentHeight : undefined;
  return height === undefined ? null : pointsToEmu(height);
}

/**
 * `textFit: 'release'` for a resize that changes the painted height of a text box that fits its
 * text, so the box keeps the new height; nothing for any other resize or drawing.
 */
export function textFitRelease(
  heightEmu: number | undefined,
  record: InlineDrawingRecord | AnchoredDrawingRecord | null
): { readonly textFit?: 'release' } {
  const fitted = fittedTextboxHeightEmu(record);
  return fitted !== null && heightEmu !== undefined && heightEmu !== fitted
    ? { textFit: 'release' }
    : {};
}

/**
 * Whether a drawing keeps its size in its own geometry too (`SHAPE_FRAME_EDITS`), so a resize
 * of its frame alone is refused. A legacy VML shape keeps its size in `style` alone.
 */
export function shapeKeepsGeometrySize(projection: DrawingProjection, chartless: boolean): boolean {
  const legacy = !!(projection.legacyGraphic || projection.textArt || projection.horizontalRule);
  return chartless && projection.picture === null && !projection.textboxStory && !legacy;
}

/**
 * The fill and outline of the shapes a selected drawing holds, resolved through the theme, or
 * null for a drawing with none to set: a picture, a chart, a diagram.
 */
export function selectedShapeFormat(
  surface: PaginatedSurface,
  drawingNodeId: string
): ShapeFormatState | null {
  const part = partOfNodeId(surface.session, drawingNodeId) ?? surface.session.part();
  const all = shapeFormatTargets(part, drawingNodeId);
  if (typeof all === 'string') return null;
  // A shape selected inside the group reads alone, as the commands then write it alone.
  const member = selectedGroupMember(surface, drawingNodeId);
  const targets = member ? (narrowedTargets(part, all, member) ?? all) : all;
  const theme = createPackageShapeThemeResolvers(surface.session.currentPackage());
  return Object.freeze(readShapeFormat(targets, theme));
}

/**
 * The frame of a turned shape or line: its unturned extent, in points, and its clockwise turn
 * in degrees. A selection overlay rings it turned about the centre of the box it covers.
 *
 * @public
 */
export interface OverlayFrameTurn {
  /** Clockwise turn in degrees, never 0. */
  readonly rotationDegrees: number;
  /** Unturned extent width, in points. */
  readonly width: number;
  /** Unturned extent height, in points. */
  readonly height: number;
}

/** The overlay turn fields of a laid-out drawing: `turn` for a turned shape, else nothing. */
export function overlayFrameTurnOf(record: InlineDrawingRecord | AnchoredDrawingRecord): {
  readonly turn?: OverlayFrameTurn;
} {
  const rotationDegrees = record.vectorShape?.rotationDegrees;
  if (!rotationDegrees) return {};
  const { width, height } = record.geometry.contentBounds;
  return { turn: Object.freeze({ rotationDegrees, width, height }) };
}
