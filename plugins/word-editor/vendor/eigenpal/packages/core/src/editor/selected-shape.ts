// The selected shape for a host's own Format shape controls: what `useSelectedShape` returns in
// both adapters. The fill and outline come from `snapshot().image.shapeFormat`, and edits are the
// `setShapeFill` and `setShapeOutline` commands with the drawing id bound, so a custom pane
// speaks the same command language as the packaged one. Each section's enabled state is the
// engine's own `can` answer, so viewing, suggesting, protection, and locks all refuse here with
// the reason that `exec` would give. DOM-free.

import type { Editor, EditorCommand, ExecResult } from '../contracts/editor.ts';
import type { SelectedImageState } from '../contracts/editor-image-state.ts';
import type { ShapeFormatState } from '../store/package/shape-format.ts';
import { shapePaneCommand, type ShapePaneChange } from './shape-pane.ts';
import { chartThemeHexes } from './chart-pane.ts';

type ShapeFormatCommand = Extract<EditorCommand, { type: 'setShapeFill' | 'setShapeOutline' }>;

/**
 * A fill or outline edit as `editor.exec` takes it, without `drawingNodeId`: the hook binds the
 * shape it shows. For example `{ type: 'setShapeOutline', color: '1F3864', widthPt: 3 }`.
 * @public
 */
export type SelectedShapeCommand =
  | Omit<Extract<EditorCommand, { type: 'setShapeFill' }>, 'drawingNodeId'>
  | Omit<Extract<EditorCommand, { type: 'setShapeOutline' }>, 'drawingNodeId'>;

/** The selected shape, its fill and outline, and whether each can change. @public */
export interface SelectedShapeView {
  /** The drawing node id of the selected shape, text box, line, or group, or null. */
  readonly drawingNodeId: string | null;
  /**
   * The shape selected inside the group `drawingNodeId` by a second press, or null. The
   * format and the edits then apply to that shape alone.
   */
  readonly memberId: string | null;
  /** The fill and outline, or null when no shape with a fill or outline is selected. */
  readonly format: ShapeFormatState | null;
  /** Whether `setShapeFill` can run now. */
  readonly canEditFill: boolean;
  /** Whether `setShapeFill` can change the transparency now: a solid fill that keeps one. */
  readonly canEditTransparency: boolean;
  /** Whether `setShapeOutline` can run now. */
  readonly canEditOutline: boolean;
  /** Why the fill cannot change, for `localizeDisabledReason`, or null when it can. */
  readonly fillDisabledReason: string | null;
  /** Why the transparency cannot change, or null when it can. */
  readonly transparencyDisabledReason: string | null;
  /** Why the outline cannot change, or null when it can. */
  readonly outlineDisabledReason: string | null;
}

/** The reason of a refused selection: no drawing, or one with no fill or outline. */
export const SHAPE_NONE_REASON = 'this drawing has no fill or outline to set';
const NO_SOLID_FILL_REASON = 'the shape has no solid fill to change; set a color';
const MIXED_FILL_REASON =
  'the shapes in this group have different fills; pick a color to set them all';

const NO_SHAPE: SelectedShapeView = Object.freeze({
  drawingNodeId: null,
  memberId: null,
  format: null,
  canEditFill: false,
  canEditTransparency: false,
  canEditOutline: false,
  fillDisabledReason: SHAPE_NONE_REASON,
  transparencyDisabledReason: SHAPE_NONE_REASON,
  outlineDisabledReason: SHAPE_NONE_REASON,
});

/**
 * Whether two reads show the same thing: the same drawing and format, and the same
 * enabled states and reasons. An adapter reads the shape on every snapshot, because `can`
 * depends on more than the drawing (protection, locks, collaboration), and keeps the old value
 * when nothing a control shows has changed. @public
 */
export function sameSelectedShape(a: SelectedShapeView, b: SelectedShapeView): boolean {
  return (
    a.drawingNodeId === b.drawingNodeId &&
    a.memberId === b.memberId &&
    (a.format === b.format || JSON.stringify(a.format) === JSON.stringify(b.format)) &&
    a.canEditFill === b.canEditFill &&
    a.canEditTransparency === b.canEditTransparency &&
    a.canEditOutline === b.canEditOutline &&
    a.fillDisabledReason === b.fillDisabledReason &&
    a.transparencyDisabledReason === b.transparencyDisabledReason &&
    a.outlineDisabledReason === b.outlineDisabledReason
  );
}

/** Why `can` refuses `command`, or null when it admits it. */
function refusal(editor: Editor, command: ShapeFormatCommand): string | null {
  const answer = editor.can(command);
  return answer.ok ? null : answer.reason;
}

/**
 * Read `image`, the snapshot's selected drawing, for a host's Format shape controls. Call it
 * again when `image` changes: the snapshot gives a new object each time the drawing changes.
 * @public
 */
export function readSelectedShape(
  editor: Editor | null,
  image: SelectedImageState | null
): SelectedShapeView {
  const format = image?.shapeFormat ?? null;
  if (!editor || !image || !format) return NO_SHAPE;
  const drawingNodeId = image.id;
  // Probes that change nothing the user can see: each asks `can` for an edit of this section.
  const fillDisabledReason = refusal(editor, {
    type: 'setShapeFill',
    drawingNodeId,
    visible: false,
  });
  const outlineDisabledReason = refusal(editor, {
    type: 'setShapeOutline',
    drawingNodeId,
    visible: format.outline.visible ?? true,
  });
  const transparencyDisabledReason =
    fillDisabledReason ??
    (format.fill.type === 'solid'
      ? refusal(editor, {
          type: 'setShapeFill',
          drawingNodeId,
          // A nonzero value, so a shape that refuses any transparency says so here.
          transparency: format.fill.transparency || 0.5,
        })
      : format.fill.type === 'mixed'
        ? MIXED_FILL_REASON
        : NO_SOLID_FILL_REASON);
  return {
    drawingNodeId,
    memberId: image.memberId ?? null,
    format,
    canEditFill: fillDisabledReason === null,
    canEditTransparency: transparencyDisabledReason === null,
    canEditOutline: outlineDisabledReason === null,
    fillDisabledReason,
    transparencyDisabledReason,
    outlineDisabledReason,
  };
}

/**
 * Run a fill or outline edit on `image`, the shape a host's controls show, through
 * `editor.exec`. One undo step; a refusal names its reason, as `editor.exec` does. @public
 */
export function execSelectedShape(
  editor: Editor | null,
  image: SelectedImageState | null,
  command: SelectedShapeCommand
): ExecResult {
  if (!editor || !image?.shapeFormat)
    return { ok: false, code: 'notFound', reason: SHAPE_NONE_REASON };
  return editor.exec({ ...command, drawingNodeId: image.id } as ShapeFormatCommand);
}

/**
 * Apply one checked pane change to `image`, as the packaged pane does: a picked or typed color,
 * No fill, No line, a transparency, or an outline width. Text the pane cannot read refuses with
 * a translation key, such as `shape.pane.errors.width`. A theme color pick resolves through
 * the document's theme colors, or through `themeHexes` when given. @public
 */
export function editSelectedShape(
  editor: Editor | null,
  image: SelectedImageState | null,
  change: ShapePaneChange,
  themeHexes?: readonly string[]
): ExecResult {
  const format = image?.shapeFormat;
  if (!editor || !image || !format)
    return { ok: false, code: 'notFound', reason: SHAPE_NONE_REASON };
  const hexes = themeHexes ?? chartThemeHexes(editor.getDocumentThemeColors());
  const planned = shapePaneCommand(format, change, hexes);
  if (!planned.ok) return { ok: false, code: 'invalidArgs', reason: planned.error };
  // A change to what the shape already shows sends nothing and adds no undo step.
  if (!planned.command) return { ok: true, changed: false };
  return execSelectedShape(editor, image, planned.command);
}
