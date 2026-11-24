import { fitInsertExtent } from './image-insert-extent.ts';
import { pointTargetRefusal } from './editor-point-target.ts';
import { SUGGESTING_IMAGE_REPLACE_REASON } from './opening-editing-mode.ts';
import {
  hasBorderPayload,
  positionCommandHasFields,
  propertiesCommandHasFields,
} from './image-command-fields.ts';
import { drawingAtomProjection } from '../store/package/drawing-atom-projection.ts';
import { commandProtectionRefusal } from './command-protection.ts';
import * as member from './group-member-selection.ts';
import { inlineToFloatingPosition } from './inline-wrap-placement.ts';
import { reanchorMovedDrawing } from './drawing-reanchor.ts';
import { preserveWrapExtentOps, type WrapExtentOverrides } from './image-wrap-extent.ts';
import { reportCommandResult } from './command-reporting.ts';
import {
  chartDrawingRefusal,
  drawingGate,
  intrinsicOf,
  type ChartGate,
} from './image-state-rules.ts';
import {
  isShapeDrawing,
  overlayFrameTurnOf,
  shapePictureCommandRefusal,
  selectedShapeFormat,
  fittedTextboxHeightEmu,
  textFitRelease,
  shapeFrameWraps,
  shapeKeepsGeometrySize,
  type OverlayFrameTurn,
} from './shape-drawings.ts';
export { imageContextEqual } from './image-state-rules.ts';
// Selected-image derivation and image command dispatch for `createDocxEditor` (task 13).
//
// Reads derive from layout records plus canonical projection; writes route through the
// surface guarded mutation path — never raw session bypass.

import type {
  CanResult,
  EditorCommand,
  ExecResult,
  ImageContext,
  SelectedImageState,
} from '../contracts/editor.ts';
import { lineAtPosition } from '../layout/index.ts';
import { lineAtIndexedPosition, paragraphLinesFor } from '../layout/paragraph-lines.ts';
import type { AnchoredDrawingRecord, InlineDrawingRecord } from '../layout/drawing-layout.ts';
import { findDrawingOverlayFrameInLayout } from '../layout/semantic-hit-test.ts';
import { editedTextboxOverlayFrame, textboxTextEditable } from './textbox-overlay-frame.ts';
import { partOfNodeId } from './surface-scope.ts';
import { findNode } from '../store/package/ooxml-edit.ts';
import type {
  DrawingPositionInput,
  DrawingTransform,
} from '../store/package/drawing-projection.ts';
import {
  createDrawingRelationshipResolver,
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  DEFAULT_SUPPORTED_MC_REQUIRES,
  projectDrawing,
  type DrawingLocks,
  type DrawingProjection,
  type ImageWrapTarget,
} from '../store/package/drawing-projection.ts';
import {
  cropPercentFromSourceCrop,
  cropPermilleFromCropPercent,
  validateImageCropPercent,
} from '../store/package/image-crop-units.ts';
import { sanitizeHref } from '../store/package/sinks.ts';
import type { SupportedImageMime } from '../store/package/image-resources.ts';
import {
  validateDrawingPositionInput,
  validateSetImagePositionCommand,
  propertiesCommandHasPositionFields,
  positionInputFromPropertiesCommand,
} from '../store/package/drawing-position-input.ts';
import type { DrawingTreeDocOp } from '../store/store/tree-op-types.ts';
import type { DocxEditorInstance } from './docx-editor-types.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';

export type { ImageContext, SelectedImageState };

type SelectedDrawingRecord = InlineDrawingRecord | AnchoredDrawingRecord;

export {
  computeMovedImagePosition,
  computeResizedImageExtentEmu,
  emuToOverlayPoints,
  EMU_PER_POINT,
  pointsToEmu,
  type ImageResizeHandle,
} from './image-overlay-geometry.ts';
import { pointsToEmu, type ImageResizeHandle } from './image-overlay-geometry.ts';

const IMAGE_ASYNC_COMMAND_TYPES = new Set(['insertImage', 'replaceImage']);
const IMAGE_COMMAND_TYPES = new Set([
  'insertImage',
  'replaceImage',
  'deleteImage',
  'setImageWrapType',
  'transformImage',
  'setImagePosition',
  'setImageProperties',
]);

export type ImageMutationPreconditions = Readonly<{
  mountGeneration: number;
  packageRevision: number;
  drawingNodeId: string | null;
  selectionParagraphId: string;
  selectionOffset: number;
}>;

/**
 * Whether a record answers to this caret, and to the drawing the caller named.
 *
 * One paragraph can anchor several drawings, and they occupy ADJACENT offsets, so the offset
 * alone is ambiguous: the second box's anchor offset is also the first box's `start + 1`.
 * A named drawing therefore decides the tie, or the scan returns whichever came first and the
 * caller can never address the rest.
 */
function drawingAnswersTo(
  drawing: Pick<InlineDrawingRecord, 'drawingNodeId' | 'start' | 'accessibility'>,
  offset: number,
  wanted: string | null
): boolean {
  // A hidden record (an MC wrap footprint) holds layout space only; nothing can select it.
  if (drawing.accessibility.hidden) return false;
  if (wanted !== null && drawing.drawingNodeId !== wanted) return false;
  return drawing.start === offset || drawing.start + 1 === offset;
}

function inlineDrawingAtOffset(
  line: ReturnType<typeof lineAtPosition>,
  paragraphId: string,
  offset: number,
  wanted: string | null
): InlineDrawingRecord | null {
  if (!line) return null;
  for (const drawing of line.drawings ?? []) {
    // The PARAGRAPH as well as the offset. A resolved display mode draws two paragraphs on
    // the join line and both count from zero, so an offset alone selected the other half's
    // image — and every later command addressed that one.
    if (drawing.paragraphId !== paragraphId) continue;
    if (drawingAnswersTo(drawing, offset, wanted)) return drawing;
  }
  return null;
}

/**
 * The named inline drawing when it starts the next line. A drawing that does not fit after the
 * text wraps, and its anchor offset is also the end of the line before it, which the offset
 * lookup finds first.
 */
function namedDrawingOnOtherLine(
  surface: PaginatedSurface,
  paragraphId: string,
  offset: number,
  wanted: string | null
): InlineDrawingRecord | null {
  if (!wanted) return null;
  for (const placed of paragraphLinesFor(surface.layout(), paragraphId)) {
    const found = inlineDrawingAtOffset(placed.line, paragraphId, offset, wanted);
    if (found) return found;
  }
  return null;
}

function anchoredDrawingAtSelection(
  surface: PaginatedSurface,
  paragraphId: string,
  offset: number,
  wanted: string | null
): AnchoredDrawingRecord | null {
  const layout = surface.layout();
  for (const page of layout.pages) {
    for (const drawing of page.anchoredDrawings ?? []) {
      if (drawing.anchorParagraphId !== paragraphId) continue;
      if (drawingAnswersTo(drawing, offset, wanted)) return drawing;
    }
    for (const story of [page.header, page.footer]) {
      if (!story) continue;
      for (const drawing of story.anchoredDrawings ?? []) {
        if (drawing.anchorParagraphId !== paragraphId) continue;
        if (drawingAnswersTo(drawing, offset, wanted)) return drawing;
      }
    }
  }
  return null;
}

export function resolveSelectedDrawingRecord(
  surface: PaginatedSurface | null
): SelectedDrawingRecord | null {
  if (!surface) return null;
  // Word's rule: a caret at a drawing's anchor offset is a TEXT caret unless something
  // selected the object — a pointer press on the painted drawing, or an explicit host
  // selection write. The mount-time caret routinely coincides with a drawing anchored at
  // offset zero, and typing lands the caret at anchor+1; neither means "selected".
  const intent = surface.drawingSelectionIntent();
  if (intent.kind === 'none') return null;
  const { anchor, head } = surface.state().selection;
  if (anchor.paragraphId !== head.paragraphId || anchor.offset !== head.offset) return null;
  const line = lineAtIndexedPosition(surface.layout(), anchor.paragraphId, anchor.offset);
  // A press names its drawing, so a stale press can never claim a DIFFERENT drawing the caret
  // later visits (a find jump that lands at another anchor), and a paragraph anchoring several
  // drawings resolves to the named one rather than to the first.
  const wanted = intent.kind === 'pointer' ? intent.drawingNodeId : null;
  return (
    inlineDrawingAtOffset(line, anchor.paragraphId, anchor.offset, wanted) ??
    namedDrawingOnOtherLine(surface, anchor.paragraphId, anchor.offset, wanted) ??
    anchoredDrawingAtSelection(surface, anchor.paragraphId, anchor.offset, wanted)
  );
}

function projectDrawingForRecord(
  surface: PaginatedSurface,
  record: SelectedDrawingRecord
): DrawingProjection | null {
  const scope = surface.storyScope();
  const part = surface.session.partFor(scope) ?? surface.session.part();
  const drawing = findNode(part, record.drawingNodeId);
  const pkg = surface.session.currentPackage();
  if (!drawing) return null;
  if (drawing.kind !== 'drawing') return drawingAtomProjection(part, record.drawingNodeId, pkg);
  return projectDrawing(drawing as import('../store/package/ooxml-tree.ts').OoxmlDrawingNode, {
    ownerPartName: record.ownerPartName,
    supportedMcRequires: DEFAULT_SUPPORTED_MC_REQUIRES,
    limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    resolveRelationship: createDrawingRelationshipResolver(pkg, record.ownerPartName),
  });
}

function positionInputOf(projection: DrawingProjection): DrawingPositionInput | null {
  if (projection.kind !== 'anchored' || !projection.position) return null;
  const pos = projection.position;
  if (projection.anchor?.simplePos) {
    return Object.freeze({
      mode: 'simple' as const,
      horizontalEmu: pos.simplePosition.xEmu,
      verticalEmu: pos.simplePosition.yEmu,
    });
  }
  return Object.freeze({
    mode: 'frame' as const,
    ...(pos.horizontal.offsetEmu !== null ? { horizontalEmu: pos.horizontal.offsetEmu } : {}),
    ...(pos.vertical.offsetEmu !== null ? { verticalEmu: pos.vertical.offsetEmu } : {}),
    relativeToH: pos.horizontal.relativeFrom,
    relativeToV: pos.vertical.relativeFrom,
  });
}

function capabilityFlags(
  projection: DrawingProjection,
  chart: ChartGate,
  gateLocks: DrawingLocks,
  shapeWraps = false
): Pick<SelectedImageState, 'canResize' | 'canMove' | 'canChangeWrap' | 'canCrop'> {
  const locks = chart === 'locked' ? { resize: true, move: true, changeAspect: true } : gateLocks;
  // An inline text box flows with its line: it resizes in place but is never dragged.
  const fixed = projection.kind === 'inline' && projection.textboxStory !== null;
  const shape = shapeKeepsGeometrySize(projection, chart === 'none');
  return Object.freeze({
    canResize: !shape && !locks.resize && !projection.hidden,
    canMove: !fixed && !locks.move && !projection.hidden,
    canChangeWrap:
      (chart === 'frame' || (chart === 'none' && (projection.picture !== null || shapeWraps))) &&
      !locks.move &&
      !projection.hidden,
    canCrop:
      chart === 'none' &&
      projection.picture !== null &&
      !locks.resize &&
      !locks.changeAspect &&
      !projection.hidden,
  });
}

function wrapOf(record: SelectedDrawingRecord): ImageWrapTarget {
  if (record.kind === 'inlineDrawing') return 'inline';
  return record.wrap;
}

/**
 * Image commands reach pictures, text boxes, shapes, lines and groups (`vectorShape`), charts
 * (drawn, by their fallback, or as a placeholder) and diagrams (`chart` is not `none`); the
 * overlay offers handles on the same gate. A chart or a diagram selects as an object.
 */
const imageCommandsReach = (record: SelectedDrawingRecord, chart: ChartGate): boolean =>
  record.placeholderGraphicKind === null ||
  !!record.textboxStory ||
  !!record.vectorShape ||
  record.placeholderGraphicKind === 'chart' ||
  !!record.chart ||
  chart !== 'none';

/**
 * The selected image and what may be done to it, or null when nothing image-like is selected.
 *
 * Unsupported placeholders, hidden drawings, and select-locked drawings cannot be selected.
 */
export function selectedImageStateOf(surface: PaginatedSurface | null): SelectedImageState | null {
  const record = resolveSelectedDrawingRecord(surface);
  if (!record) return null;
  const projection = surface ? projectDrawingForRecord(surface, record) : null;
  if (!projection) return null;
  const { chart, locks } = drawingGate(surface!, record.drawingNodeId, projection);
  if (!imageCommandsReach(record, chart)) return null;
  if (projection.hidden || locks.select) return null;
  const transform = record.transform;
  return Object.freeze({
    id: record.drawingNodeId,
    kind: projection.kind,
    widthEmu: projection.extentEmu.cx,
    heightEmu: fittedTextboxHeightEmu(record) ?? projection.extentEmu.cy,
    crop: cropPercentFromSourceCrop(record.crop),
    rotationDegrees: transform.rotationDegrees || (record.vectorShape?.rotationDegrees ?? 0),
    wrap: wrapOf(record),
    position: positionInputOf(projection),
    name: projection.name,
    title: projection.title,
    description: projection.description,
    hyperlink: projection.hyperlinkHref,
    locks,
    hidden: projection.hidden,
    resourceStatus: record.resource.kind,
    intrinsic: intrinsicOf(record),
    ...capabilityFlags(projection, chart, locks, shapeFrameWraps(surface!, projection, chart)),
    ...member.memberImageFields(surface!, record.drawingNodeId),
    shapeFormat: chart === 'none' ? selectedShapeFormat(surface!, record.drawingNodeId) : null,
  });
}

function requestedDrawingId(command: EditorCommand): string | undefined {
  if (
    'drawingNodeId' in command &&
    typeof (command as { drawingNodeId?: unknown }).drawingNodeId === 'string'
  ) {
    return (command as { drawingNodeId: string }).drawingNodeId;
  }
  return undefined;
}

function expectedPackageRevisionOf(command: EditorCommand): number | undefined {
  if (
    'expectedPackageRevision' in command &&
    typeof (command as { expectedPackageRevision?: unknown }).expectedPackageRevision === 'number'
  ) {
    return (command as { expectedPackageRevision: number }).expectedPackageRevision;
  }
  return undefined;
}

export function imageCommandHasIdentityFields(command: EditorCommand): boolean {
  return (
    requestedDrawingId(command) !== undefined ||
    expectedPackageRevisionOf(command) !== undefined ||
    (command.type === 'setImageProperties' && command.selectionParagraphId !== undefined)
  );
}

export function verifyImageCommandIdentity(
  editor: Pick<DocxEditorInstance, 'surface' | 'mountGeneration'>,
  command: EditorCommand,
  pre: ImageMutationPreconditions
): ExecResult | null {
  const surface = editor.surface;
  if (!surface) return { ok: false, code: 'notFound', reason: 'no document is loaded' };
  const expectedRevision = expectedPackageRevisionOf(command);
  if (expectedRevision !== undefined && surface.session.packageRevision() !== expectedRevision) {
    return { ok: false, code: 'notFound', reason: 'stale package revision' };
  }
  const requested = requestedDrawingId(command);
  const selected = selectedImageStateOf(surface);
  if (requested !== undefined && (!selected || selected.id !== requested)) {
    return { ok: false, code: 'notFound', reason: 'stale drawing selection' };
  }
  if (
    command.type === 'setImageProperties' &&
    command.selectionParagraphId !== undefined &&
    command.selectionOffset !== undefined
  ) {
    const { anchor, head } = surface.state().selection;
    if (
      anchor.paragraphId !== command.selectionParagraphId ||
      anchor.offset !== command.selectionOffset ||
      head.paragraphId !== command.selectionParagraphId ||
      head.offset !== command.selectionOffset
    ) {
      return { ok: false, code: 'notFound', reason: 'stale drawing selection' };
    }
  }
  return isStaleImageMutation(editor, pre, {
    requireDrawing: requested !== undefined || pre.drawingNodeId !== null,
    drawingNodeId: requested ?? pre.drawingNodeId ?? undefined,
  });
}

function selectedOrRequestedId(
  surface: PaginatedSurface,
  command: EditorCommand
): { readonly id: string } | ExecResult {
  const selected = selectedImageStateOf(surface);
  const requested = requestedDrawingId(command);
  if (requested) {
    if (!selected || selected.id !== requested) {
      return { ok: false, code: 'notFound', reason: 'stale drawing selection' };
    }
    return { id: requested };
  }
  if (!selected) {
    return { ok: false, code: 'notFound', reason: 'no drawing is selected' };
  }
  return { id: selected.id };
}

function drawingOpsResult(
  result: ReturnType<PaginatedSurface['applyDrawingOps']>
): ExecResult | null {
  if (result.rejected) {
    const reason =
      result.reason === 'drawing-locked'
        ? 'the drawing is locked'
        : result.reason === 'unknown-drawing'
          ? 'stale drawing selection'
          : typeof result.reason === 'string'
            ? result.reason
            : 'the image change was refused';
    return { ok: false, code: 'invalidArgs', reason };
  }
  return null;
}

/** Keeps an inline picture where it is when a wrap change makes it float. */
function keepPlaceWhenFloated(
  surface: PaginatedSurface,
  drawingNodeId: string,
  wrap: ImageWrapTarget
): DrawingTreeDocOp[] {
  if (wrap === 'inline') return [];
  const position = inlineToFloatingPosition(surface.layout(), drawingNodeId);
  return position ? [{ op: 'positionDrawing', drawingNodeId, position }] : [];
}

function preserveWrapExtent(
  surface: PaginatedSurface,
  wrap: ImageWrapTarget,
  ops: DrawingTreeDocOp[],
  overrides?: WrapExtentOverrides
): void {
  const record = resolveSelectedDrawingRecord(surface);
  const projection = record && projectDrawingForRecord(surface, record);
  if (!projection) return;
  preserveWrapExtentOps(projection, wrap, ops, overrides, record!.drawingNodeId);
}

function applyDrawingOps(
  surface: PaginatedSurface,
  ops: readonly DrawingTreeDocOp[]
): ExecResult | null {
  return drawingOpsResult(surface.applyDrawingOps(ops));
}

function naturalExtentEmu(
  image: SelectedImageState
): { readonly cx: number; readonly cy: number } | null {
  if (!image.intrinsic) return null;
  const cx = Math.round((image.intrinsic.pixelWidth * 914_400) / image.intrinsic.dpiX);
  const cy = Math.round((image.intrinsic.pixelHeight * 914_400) / image.intrinsic.dpiY);
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || cx <= 0 || cy <= 0) return null;
  return { cx, cy };
}

function positionInputFromCommand(
  command: Extract<EditorCommand, { type: 'setImagePosition' }>,
  selected: SelectedImageState | null
): DrawingPositionInput {
  if (selected?.position?.mode === 'simple') {
    return Object.freeze({
      mode: 'simple' as const,
      ...(command.horizontalEmu !== undefined ? { horizontalEmu: command.horizontalEmu } : {}),
      ...(command.verticalEmu !== undefined ? { verticalEmu: command.verticalEmu } : {}),
    });
  }
  return Object.freeze({
    mode: 'frame' as const,
    ...(command.horizontalEmu !== undefined ? { horizontalEmu: command.horizontalEmu } : {}),
    ...(command.verticalEmu !== undefined ? { verticalEmu: command.verticalEmu } : {}),
    ...(command.relativeToH !== undefined
      ? { relativeToH: command.relativeToH as DrawingPositionInput['relativeToH'] }
      : {}),
    ...(command.relativeToV !== undefined
      ? { relativeToV: command.relativeToV as DrawingPositionInput['relativeToV'] }
      : {}),
  });
}

export function isImageCommand(command: EditorCommand): boolean {
  return IMAGE_COMMAND_TYPES.has(command.type);
}

export function isAsyncImageCommand(
  command: EditorCommand
): command is Extract<EditorCommand, { type: 'insertImage' | 'replaceImage' }> {
  return IMAGE_ASYNC_COMMAND_TYPES.has(command.type);
}

export function asyncImageCommandRefusal(
  command: Extract<EditorCommand, { type: 'insertImage' | 'replaceImage' }>
): ExecResult {
  return {
    ok: false,
    code: 'unsupported',
    reason: `${command.type} is asynchronous; use executeImageCommand`,
  };
}

function asyncImageExecutionGate(
  surface: PaginatedSurface | null,
  commandType: 'insertImage' | 'replaceImage'
): ExecResult | null {
  if (!surface) return { ok: false, code: 'notFound', reason: 'no document is loaded' };
  const mode = surface.editingMode();
  if (mode === 'view') {
    return { ok: false, code: 'locked', reason: 'the document is open for viewing' };
  }
  // Suggesting inserts a picture as a TRACKED insertion (the surface lane wraps it in
  // `w:ins`); replacing one still refuses — swapping bytes inside an existing drawing has
  // no tracked-change representation.
  if (mode === 'suggest' && commandType === 'replaceImage') {
    return {
      ok: false,
      code: 'invalidArgs',
      reason: SUGGESTING_IMAGE_REPLACE_REASON,
    };
  }
  return null;
}

/**
 * Snapshot the state an image mutation was planned against: mount generation, package revision,
 * and the selection anchor.
 *
 * Taken at the START of a drag so the commit can be checked against it with
 * {@link isStaleImageInteractionCommit}. A pointer gesture spans many frames, and a document that
 * moved underneath it must not have the gesture's final coordinates applied to it.
 */
export function captureImageMutationPreconditions(
  editor: Pick<DocxEditorInstance, 'surface' | 'mountGeneration'>
): ImageMutationPreconditions | null {
  const surface = editor.surface;
  if (!surface) return null;
  const { anchor } = surface.state().selection;
  const selected = selectedImageStateOf(surface);
  return Object.freeze({
    mountGeneration: editor.mountGeneration,
    packageRevision: surface.session.packageRevision(),
    drawingNodeId: selected?.id ?? null,
    selectionParagraphId: anchor.paragraphId,
    selectionOffset: anchor.offset,
  });
}

function isStaleImageMutation(
  editor: Pick<DocxEditorInstance, 'surface' | 'mountGeneration'>,
  pre: ImageMutationPreconditions,
  options?: { readonly requireDrawing?: boolean; readonly drawingNodeId?: string }
): ExecResult | null {
  const surface = editor.surface;
  if (!surface) return { ok: false, code: 'notFound', reason: 'no document is loaded' };
  if (editor.mountGeneration !== pre.mountGeneration) {
    return { ok: false, code: 'notFound', reason: 'the editor is no longer attached' };
  }
  const { anchor, head } = surface.state().selection;
  if (anchor.paragraphId !== pre.selectionParagraphId || anchor.offset !== pre.selectionOffset) {
    return { ok: false, code: 'notFound', reason: 'stale drawing selection' };
  }
  if (anchor.paragraphId !== head.paragraphId || anchor.offset !== head.offset) {
    return { ok: false, code: 'notFound', reason: 'stale drawing selection' };
  }
  if (options?.requireDrawing) {
    const selected = selectedImageStateOf(surface);
    const expectedId = options.drawingNodeId ?? pre.drawingNodeId;
    if (!selected || !expectedId || selected.id !== expectedId) {
      return { ok: false, code: 'notFound', reason: 'stale drawing selection' };
    }
  }
  return null;
}

/**
 * Inserting a picture while one is selected has no place to land: the selection sits on the
 * picture, and the store refuses an insert there. Refused up front, so the toolbar can say why.
 */
export const PICTURE_SELECTED_INSERT_REASON =
  'a picture is selected; place the caret in text to insert a picture';

export function gateImageCommand(
  command: EditorCommand,
  surface: PaginatedSurface | null
): ExecResult | null {
  if (!isImageCommand(command)) return null;
  if (!surface) {
    return { ok: false, code: 'notFound', reason: 'no document is loaded' };
  }
  const protectedWrite =
    commandProtectionRefusal(command, surface) ?? member.groupMemberRefusal(command, surface);
  if (protectedWrite) return protectedWrite;
  if (command.type === 'insertImage') {
    if (command.at) {
      const stale = pointTargetRefusal(surface, command.at);
      if (stale) return stale;
    }
    if (!command.at && resolveSelectedDrawingRecord(surface)) {
      return { ok: false, code: 'invalidArgs', reason: PICTURE_SELECTED_INSERT_REASON };
    }
    if (!(command.data instanceof Uint8Array) || command.data.byteLength === 0) {
      return { ok: false, code: 'invalidArgs', reason: 'insertImage requires image bytes' };
    }
    if (!Number.isFinite(command.widthPoints) || !Number.isFinite(command.heightPoints)) {
      return { ok: false, code: 'invalidArgs', reason: 'insertImage requires finite dimensions' };
    }
    if (command.widthPoints <= 0 || command.heightPoints <= 0) {
      return { ok: false, code: 'invalidArgs', reason: 'insertImage dimensions must be positive' };
    }
    return null;
  }
  const shapeRefusal = shapePictureCommandRefusal(
    command,
    surface,
    resolveSelectedDrawingRecord(surface)
  );
  if (shapeRefusal) return shapeRefusal;
  if (command.type === 'replaceImage') {
    if (!(command.data instanceof Uint8Array) || command.data.byteLength === 0) {
      return { ok: false, code: 'invalidArgs', reason: 'replaceImage requires image bytes' };
    }
    const resolved = selectedOrRequestedId(surface, command);
    if ('ok' in resolved) return resolved;
    return chartDrawingRefusal(surface, command, resolved.id);
  }
  const resolved = selectedOrRequestedId(surface, command);
  if ('ok' in resolved) return resolved;
  const chartRefusal = chartDrawingRefusal(surface, command, resolved.id);
  if (chartRefusal) return chartRefusal;
  const image = selectedImageStateOf(surface);
  if (!image) {
    return { ok: false, code: 'notFound', reason: 'no drawing is selected' };
  }
  const wrapTarget =
    command.type === 'setImageWrapType'
      ? command.target
      : command.type === 'setImageProperties'
        ? command.wrap
        : undefined;
  if (wrapTarget !== undefined && image.locks.resize) {
    const resizing: DrawingTreeDocOp[] = [];
    preserveWrapExtent(surface, wrapTarget, resizing);
    if (resizing.length) return { ok: false, code: 'locked', reason: 'the drawing size is locked' };
  }
  // Suggesting proposes a deletion and applies property edits (size, position, wrap, crop,
  // alt text) directly: OOXML records no tracked form for a drawing's properties, so they
  // are never proposals. Replacing the picture is refused by `asyncImageExecutionGate`.
  switch (command.type) {
    case 'deleteImage':
      if (image.locks.select) {
        return { ok: false, code: 'locked', reason: 'the drawing cannot be selected' };
      }
      return null;
    case 'setImageWrapType': {
      if (!image.canChangeWrap) {
        return { ok: false, code: 'locked', reason: 'wrap cannot be changed on this drawing' };
      }
      return null;
    }
    case 'transformImage':
      if (image.locks.changeAspect || image.locks.resize) {
        return { ok: false, code: 'locked', reason: 'the drawing is locked' };
      }
      return null;
    case 'setImagePosition':
      if (!image.canMove || image.kind !== 'anchored') {
        return { ok: false, code: 'locked', reason: 'position cannot be changed on this drawing' };
      }
      if (!positionCommandHasFields(command)) {
        return {
          ok: false,
          code: 'invalidArgs',
          reason: 'setImagePosition requires at least one field',
        };
      }
      const positionMode = image.position?.mode ?? 'frame';
      if (!validateSetImagePositionCommand(command, positionMode)) {
        return {
          ok: false,
          code: 'invalidArgs',
          reason: 'setImagePosition carries invalid position values',
        };
      }
      if (!validateDrawingPositionInput(positionInputFromCommand(command, image))) {
        return {
          ok: false,
          code: 'invalidArgs',
          reason: 'setImagePosition carries invalid position values',
        };
      }
      return null;
    case 'setImageProperties': {
      if (hasBorderPayload(command)) {
        return {
          ok: false,
          code: 'unsupported',
          reason: 'image border properties are not supported yet',
        };
      }
      if (!propertiesCommandHasFields(command)) {
        return {
          ok: false,
          code: 'invalidArgs',
          reason: 'setImageProperties requires at least one field',
        };
      }
      if (command.resetToNaturalSize && !image.intrinsic) {
        return {
          ok: false,
          code: 'invalidArgs',
          reason: 'natural size is unavailable for this image',
        };
      }
      if (
        command.widthEmu !== undefined &&
        (!Number.isFinite(command.widthEmu) || command.widthEmu <= 0)
      ) {
        return {
          ok: false,
          code: 'invalidArgs',
          reason: 'widthEmu must be a positive finite number',
        };
      }
      if (
        command.heightEmu !== undefined &&
        (!Number.isFinite(command.heightEmu) || command.heightEmu <= 0)
      ) {
        return {
          ok: false,
          code: 'invalidArgs',
          reason: 'heightEmu must be a positive finite number',
        };
      }
      if (command.widthEmu !== undefined && !image.canResize) {
        return { ok: false, code: 'locked', reason: 'the drawing is locked' };
      }
      if (command.heightEmu !== undefined && !image.canResize) {
        return { ok: false, code: 'locked', reason: 'the drawing is locked' };
      }
      if (command.crop !== undefined && !validateImageCropPercent(command.crop)) {
        return { ok: false, code: 'invalidArgs', reason: 'crop values are out of range' };
      }
      if (command.crop !== undefined && !image.canCrop) {
        return { ok: false, code: 'locked', reason: 'crop cannot be changed on this drawing' };
      }
      if (command.hyperlink !== undefined && command.hyperlink !== null) {
        const href = sanitizeHref(command.hyperlink);
        if (!href.ok) {
          return { ok: false, code: 'invalidArgs', reason: 'unsafe hyperlink URL' };
        }
      }
      if (command.wrap !== undefined && !image.canChangeWrap) {
        return { ok: false, code: 'locked', reason: 'wrap cannot be changed on this drawing' };
      }
      if (propertiesCommandHasPositionFields(command)) {
        if (!image.canMove || image.kind !== 'anchored') {
          return {
            ok: false,
            code: 'locked',
            reason: 'position cannot be changed on this drawing',
          };
        }
        const positionMode = image.position?.mode ?? 'frame';
        if (!validateSetImagePositionCommand(command, positionMode)) {
          return {
            ok: false,
            code: 'invalidArgs',
            reason: 'setImageProperties carries invalid position values',
          };
        }
        if (!validateDrawingPositionInput(positionInputFromPropertiesCommand(command, image))) {
          return {
            ok: false,
            code: 'invalidArgs',
            reason: 'setImageProperties carries invalid position values',
          };
        }
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * Whether an insert or replace would be accepted — the `can` half of the can-before-exec pair.
 *
 * Refuses in suggesting mode, since an image property edit has no tracked-change representation.
 */
export function canExecuteImageCommand(
  command: Extract<EditorCommand, { type: 'insertImage' | 'replaceImage' }>,
  surface: PaginatedSurface | null
): CanResult {
  const modeGate = asyncImageExecutionGate(surface, command.type);
  if (modeGate) return modeGate;
  const gate = gateImageCommand(command, surface);
  if (gate) return gate;
  return { ok: true };
}

export function canAsyncImageCommand(
  command: Extract<EditorCommand, { type: 'insertImage' | 'replaceImage' }>,
  surface: PaginatedSurface | null
): CanResult {
  const gate = gateImageCommand(command, surface);
  if (gate) return gate;
  return asyncImageCommandRefusal(command);
}

export function execImageCommand(
  surface: PaginatedSurface,
  command: EditorCommand,
  editor?: Pick<DocxEditorInstance, 'surface' | 'mountGeneration'>
): ExecResult | null {
  if (isAsyncImageCommand(command)) {
    return asyncImageCommandRefusal(command);
  }
  const pre =
    editor && imageCommandHasIdentityFields(command)
      ? captureImageMutationPreconditions(editor)
      : null;
  if (pre && editor) {
    const identity = verifyImageCommandIdentity(editor, command, pre);
    if (identity) return identity;
  }
  switch (command.type) {
    case 'deleteImage': {
      const resolved = selectedOrRequestedId(surface, command);
      if ('ok' in resolved) return resolved;
      const result = surface.deleteImage(resolved.id);
      if (!result.ok) {
        return {
          ok: false,
          code: 'invalidArgs',
          reason: result.detail ?? result.reason ?? 'deleteImage was refused',
        };
      }
      return null;
    }
    case 'setImageWrapType': {
      const resolved = selectedOrRequestedId(surface, command);
      if ('ok' in resolved) return resolved;
      const ops: DrawingTreeDocOp[] = [];
      preserveWrapExtent(surface, command.target, ops);
      return applyDrawingOps(surface, [
        ...ops,
        { op: 'setDrawingWrap', drawingNodeId: resolved.id, wrap: command.target },
        ...keepPlaceWhenFloated(surface, resolved.id, command.target),
      ]);
    }
    case 'transformImage': {
      const resolved = selectedOrRequestedId(surface, command);
      if ('ok' in resolved) return resolved;
      return applyDrawingOps(surface, [
        { op: 'transformDrawing', drawingNodeId: resolved.id, action: command.action },
      ]);
    }
    case 'setImagePosition': {
      const resolved = selectedOrRequestedId(surface, command);
      if ('ok' in resolved) return resolved;
      const selected = selectedImageStateOf(surface);
      const position = positionInputFromCommand(command, selected);
      if (reanchorMovedDrawing(surface, resolved.id, position)) return null;
      return applyDrawingOps(surface, [
        { op: 'positionDrawing', drawingNodeId: resolved.id, position },
      ]);
    }
    case 'setImageProperties': {
      const resolved = selectedOrRequestedId(surface, command);
      if ('ok' in resolved) return resolved;
      const image = selectedImageStateOf(surface);
      if (!image) return { ok: false, code: 'notFound', reason: 'no drawing is selected' };
      const ops: DrawingTreeDocOp[] = [];
      if (command.resetToNaturalSize) {
        const natural = naturalExtentEmu(image);
        if (!natural) {
          return {
            ok: false,
            code: 'invalidArgs',
            reason: 'natural size is unavailable for this image',
          };
        }
        ops.push({ op: 'resizeDrawing', drawingNodeId: resolved.id, extentEmu: natural });
      } else if (command.widthEmu !== undefined || command.heightEmu !== undefined) {
        ops.push({
          op: 'resizeDrawing',
          drawingNodeId: resolved.id,
          extentEmu: {
            cx: command.widthEmu ?? image.widthEmu,
            cy: command.heightEmu ?? image.heightEmu,
          },
          ...textFitRelease(command.heightEmu, resolveSelectedDrawingRecord(surface)),
        });
      }
      if (command.crop !== undefined) {
        ops.push({
          op: 'cropDrawing',
          drawingNodeId: resolved.id,
          crop: cropPermilleFromCropPercent(command.crop),
        });
      }
      const title = command.title ?? command.alt;
      const description = command.description ?? command.alt;
      if (title !== undefined || description !== undefined) {
        ops.push({
          op: 'setDrawingMetadata',
          drawingNodeId: resolved.id,
          title: title ?? image.title,
          description: description ?? image.description,
        });
      }
      if (command.wrap !== undefined) {
        preserveWrapExtent(surface, command.wrap, ops, command);
        ops.push({ op: 'setDrawingWrap', drawingNodeId: resolved.id, wrap: command.wrap });
        ops.push(...keepPlaceWhenFloated(surface, resolved.id, command.wrap));
      }
      if (propertiesCommandHasPositionFields(command)) {
        const position = positionInputFromPropertiesCommand(command, image);
        ops.push({ op: 'positionDrawing', drawingNodeId: resolved.id, position });
      }
      if (command.hyperlink !== undefined) {
        const result = surface.applyImageProperties({
          drawingNodeId: resolved.id,
          ops,
          hyperlink: command.hyperlink,
        });
        if (!result.ok) {
          return {
            ok: false,
            code: 'invalidArgs',
            reason: result.detail ?? result.reason ?? 'setImageProperties was refused',
          };
        }
        return null;
      }
      if (ops.length === 0) {
        return {
          ok: false,
          code: 'invalidArgs',
          reason: 'setImageProperties requires at least one field',
        };
      }
      return applyDrawingOps(surface, ops);
    }
    default:
      return null;
  }
}

/**
 * Run an insert or replace, re-checking the same gates {@link canExecuteImageCommand} applies.
 *
 * Async because image bytes must be decoded to derive their natural extent before the drawing can
 * be projected — the one editor command that cannot complete synchronously. It runs outside
 * `exec`, so it reports a refusal to the editor's diagnostics itself.
 */
export async function executeImageCommand(
  editor: DocxEditorInstance,
  command: Extract<EditorCommand, { type: 'insertImage' | 'replaceImage' }>
): Promise<ExecResult> {
  const result = await runImageCommand(editor, command);
  reportCommandResult(editor, command, result);
  return result;
}

async function runImageCommand(
  editor: DocxEditorInstance,
  command: Extract<EditorCommand, { type: 'insertImage' | 'replaceImage' }>
): Promise<ExecResult> {
  const surface = editor.surface;
  if (!surface) return { ok: false, code: 'notFound', reason: 'no document is loaded' };
  const modeGate = asyncImageExecutionGate(surface, command.type);
  if (modeGate) return modeGate;
  const gate = gateImageCommand(command, surface);
  if (gate) return gate;
  const pre = captureImageMutationPreconditions(editor);
  if (!pre) return { ok: false, code: 'notFound', reason: 'no document is loaded' };
  if (command.type === 'insertImage') {
    const anchor = command.at ?? surface.state().selection.anchor;
    const current = () =>
      command.at
        ? editor.surface === surface &&
          editor.mountGeneration === pre.mountGeneration &&
          pointTargetRefusal(surface, command.at) === null
        : isStaleImageMutation(editor, pre) === null;
    const expectedRevision = command.expectedPackageRevision ?? pre.packageRevision;
    if (
      command.expectedPackageRevision !== undefined &&
      surface.session.packageRevision() !== command.expectedPackageRevision
    ) {
      return { ok: false, code: 'notFound', reason: 'stale package revision' };
    }
    const fitted = fitInsertExtent(
      surface,
      anchor.paragraphId,
      anchor.offset,
      command.widthPoints,
      command.heightPoints
    );
    const result = await surface.insertImage({
      paragraphId: anchor.paragraphId,
      offset: anchor.offset,
      bytes: command.data,
      mime: command.mime,
      widthPoints: fitted.widthPoints,
      heightPoints: fitted.heightPoints,
      expectedPackageRevision: expectedRevision,
      commitGuard: current,
      ...(command.title !== undefined ? { title: command.title } : {}),
      ...(command.description !== undefined ? { description: command.description } : {}),
      ...(command.hyperlink !== undefined ? { hyperlink: command.hyperlink } : {}),
    });
    const stale = command.at
      ? editor.surface !== surface || editor.mountGeneration !== pre.mountGeneration
        ? {
            ok: false as const,
            code: 'notFound' as const,
            reason: 'the drop target is no longer attached',
          }
        : null
      : isStaleImageMutation(editor, pre);
    if (stale) return stale;
    if (!result.ok && command.at) {
      const targetRefusal = pointTargetRefusal(surface, command.at);
      if (targetRefusal) return targetRefusal;
    }
    if (!result.ok) {
      return {
        ok: false,
        code: 'invalidArgs',
        reason:
          result.detail === 'stale-package-epoch'
            ? 'stale package revision'
            : (result.detail ?? result.reason ?? 'insertImage was refused'),
      };
    }
    return { ok: true, changed: result.change !== null };
  }
  const resolved = selectedOrRequestedId(surface, command);
  if ('ok' in resolved) return resolved;
  const expectedRevision = command.expectedPackageRevision ?? pre.packageRevision;
  if (
    command.expectedPackageRevision !== undefined &&
    surface.session.packageRevision() !== command.expectedPackageRevision
  ) {
    return { ok: false, code: 'notFound', reason: 'stale package revision' };
  }
  const mime = (command.mime ?? 'image/png') as SupportedImageMime;
  const result = await surface.replaceImage(resolved.id, command.data, mime, {
    expectedPackageRevision: expectedRevision,
    commitGuard: () =>
      isStaleImageMutation(editor, pre, {
        requireDrawing: true,
        drawingNodeId: resolved.id,
      }) === null,
  });
  const stale = isStaleImageMutation(editor, pre, {
    requireDrawing: true,
    drawingNodeId: resolved.id,
  });
  if (stale) return stale;
  if (!result.ok) {
    return {
      ok: false,
      code: 'invalidArgs',
      reason:
        result.detail === 'stale-package-epoch'
          ? 'stale package revision'
          : (result.detail ?? result.reason ?? 'replaceImage was refused'),
    };
  }
  return { ok: true, changed: result.change !== null };
}

/** How far one arrow-key press nudges a selected image, in points. */
export const IMAGE_OVERLAY_NUDGE_PT = 1;

/** How far Shift+arrow nudges a selected image, in points. */
export const IMAGE_OVERLAY_NUDGE_SHIFT_PT = 10;

/**
 * One in-flight image drag: where it started, and everything needed to decide at commit time
 * whether the document still describes what the gesture was planned against.
 *
 * Both revisions are captured because they move independently — layout can re-flow without the
 * package changing, and vice versa.
 */
export interface ImageInteractionSession {
  readonly drawingNodeId: string;
  readonly startBounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly startWidthEmu: number;
  readonly startHeightEmu: number;
  readonly startPosition: DrawingPositionInput | null;
  readonly anchorFrameOrigin: { readonly x: number; readonly y: number } | null;
  readonly transform: DrawingTransform;
  readonly mode: 'move' | 'resize';
  readonly handle: ImageResizeHandle | null;
  readonly preconditions: ImageMutationPreconditions;
  readonly layoutRevision: number;
  readonly packageRevision: number;
  readonly kind: 'inline' | 'anchored';
}

/**
 * How an image drag scrolls the page when it reaches the viewport edge.
 *
 * Returns the delta ACTUALLY applied rather than the one requested, because a drag at the end of
 * the document cannot scroll further and the overlay must not move the image by a distance the
 * page did not travel.
 */
export interface ImageOverlayScrollPort {
  /** Scroll by a preview delta and return the actual applied document-space delta in points. */
  scrollBy(deltaY: number): number;
}

/**
 * The painted geometry of the selected drawing, plus what the overlay is allowed to do to it.
 *
 * Carries BOTH the painted rect (points, for hit-testing and handle placement) and the stored
 * extent (EMU, for writing back), so the overlay never has to convert between the two spaces to
 * decide what it is looking at.
 */
export interface SelectedDrawingOverlayTarget {
  /** Keep the text area available for pointer editing through the frame. */
  readonly textbox?: boolean;
  /** A shape, line or group: its frame is labelled as a shape, not as an image. */
  readonly shape?: boolean;
  /**
   * False for a text box whose text takes no caret: rotated or vertical text, or a story
   * holding a table. Absent for a drawing that is not a text box.
   */
  readonly textEditable?: boolean;
  readonly id: string;
  readonly pageIndex: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly kind: 'inline' | 'anchored';
  readonly widthEmu: number;
  readonly heightEmu: number;
  readonly position: DrawingPositionInput | null;
  readonly anchorFrameOrigin: { readonly x: number; readonly y: number } | null;
  readonly transform: DrawingTransform;
  /** A turned shape's frame, which `overlayFrameCssBox` rings turned; absent when upright. */
  readonly turn?: OverlayFrameTurn;
  readonly canResize: boolean;
  readonly canMove: boolean;
  /** Hard lock from `noChangeAspect` — never overridden by Shift. */
  readonly aspectLocked: boolean;
}

function overlayCapabilityFlags(
  record: SelectedDrawingRecord,
  projection: DrawingProjection | null,
  chart: ChartGate,
  locks: DrawingLocks
): Pick<SelectedDrawingOverlayTarget, 'canResize' | 'canMove' | 'aspectLocked'> {
  if (!projection || projection.hidden || !imageCommandsReach(record, chart)) {
    return Object.freeze({ canResize: false, canMove: false, aspectLocked: true });
  }
  const caps = capabilityFlags(projection, chart, locks);
  return Object.freeze({
    canResize: caps.canResize,
    canMove: caps.canMove,
    aspectLocked: chart === 'locked' || projection.locks.changeAspect,
  });
}

/**
 * The painted geometry of the selected drawing, built anew on each call. Read it through
 * `selectedDrawingOverlayTargetOf`, which keeps the previous object when nothing changed.
 *
 * Stricter than {@link selectedImageStateOf}: it also requires a COLLAPSED selection, because a
 * range that merely contains a drawing is a text selection, and drawing handles over it would
 * claim an object the user did not single out.
 */
export function freshSelectedDrawingOverlayTarget(
  surface: PaginatedSurface | null
): SelectedDrawingOverlayTarget | null {
  if (!surface) return null;
  const scope = surface.activeScope();
  const { anchor, head } = surface.state().selection;
  if (
    scope.kind !== 'frame' &&
    (anchor.paragraphId !== head.paragraphId || anchor.offset !== head.offset)
  )
    return null;
  // Outside a text box, no drawing is selected unless something selected one, and that answer
  // needs no layout. The overlay asks after every keystroke, so asking `layout()` first landed
  // the pass that typing defers, once per key.
  const selected = scope.kind === 'frame' ? null : resolveSelectedDrawingRecord(surface);
  if (scope.kind !== 'frame' && !selected) return null;
  // `layout()`, not only `publishedLayout()`: the caller is about to act on this geometry —
  // place handles, stamp a drag session — so a pass still parked on the scheduler's timer must
  // land first. Nothing pending makes this a plain read.
  const layout = surface.layout();
  const page = surface.currentPage('caret') - 1;
  const edited = scope.kind === 'frame' ? editedTextboxOverlayFrame(layout, scope, page) : null;
  const record = scope.kind === 'frame' ? edited?.record : selected;
  if (!record) return null;
  if (record.accessibility.hidden) return null;
  // The page the caret is on: an open header's drawing repeats on every page it heads.
  const frame = edited ?? findDrawingOverlayFrameInLayout(layout, record.drawingNodeId, page);
  if (!frame) return null;
  const projection = projectDrawingForRecord(surface, record);
  const gate = projection ? drawingGate(surface, record.drawingNodeId, projection) : null;
  // A text box being edited keeps its frame even when its shape cannot be selected, moved or
  // resized, as a legacy shape cannot: the frame shows which box the caret is in.
  const shapeSelectable = gate !== null && !gate.locks.select;
  if (!shapeSelectable && scope.kind !== 'frame') return null;
  const caps = shapeSelectable
    ? overlayCapabilityFlags(record, projection, gate.chart, gate.locks)
    : { canResize: false, canMove: false, aspectLocked: true };
  // The MODE, on top of the drawing's own OOXML locks. Without it a viewing-mode reader got
  // eight resize handles, a `move` cursor and a live drag preview that auto-scrolled the
  // document — then snapped back when the write was refused. The selection ring stays: the
  // image is still selectable, copyable and describable in a document open for viewing.
  const writable = surface.editingMode() !== 'view' && surface.session.editable;
  const gated = writable ? caps : { ...caps, canResize: false, canMove: false };
  // The frame origins are in the record's own coordinates, which for a header or footer
  // drawing on a story-relative axis are the story's. The overlay frame is in page-content
  // coordinates, so the origin moves by the same shift: none for a body or page-relative axis.
  const anchorFrameOrigin =
    record.kind === 'anchoredDrawing'
      ? Object.freeze({
          x: record.horizontalFrameOrigin + frame.x - record.paintBounds.x,
          y: record.verticalFrameOrigin + frame.y - record.paintBounds.y,
        })
      : null;
  return Object.freeze({
    id: record.drawingNodeId,
    textbox: 'textboxStory' in record && !!record.textboxStory,
    shape: isShapeDrawing(surface, record),
    ...textboxTextEditable(
      record,
      partOfNodeId(surface.session, record.drawingNodeId) ?? surface.session.part()
    ),
    pageIndex: frame.pageIndex,
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height,
    kind: record.kind === 'inlineDrawing' ? 'inline' : 'anchored',
    widthEmu: projection?.extentEmu.cx ?? pointsToEmu(frame.width),
    heightEmu:
      fittedTextboxHeightEmu(record) ?? projection?.extentEmu.cy ?? pointsToEmu(frame.height),
    position: projection ? positionInputOf(projection) : null,
    anchorFrameOrigin,
    transform: record.transform,
    ...overlayFrameTurnOf(record),
    ...member.memberOverlayFields(surface, record.drawingNodeId, frame, gated),
  });
}

/**
 * Whether a drag's commit should be refused because the document moved under it — the refusal to
 * return, or null when the commit is still valid.
 *
 * Checks the mount generation and both revisions captured by
 * {@link captureImageMutationPreconditions}. A gesture spans many frames, so this is the one
 * place that decides its coordinates still describe the document they were measured against.
 */
export function isStaleImageInteractionCommit(
  editor: Pick<DocxEditorInstance, 'surface' | 'mountGeneration'>,
  session: ImageInteractionSession
): ExecResult | null {
  const surface = editor.surface;
  if (!surface) return { ok: false, code: 'notFound', reason: 'no document is loaded' };
  if (surface.publishedLayout().revision !== session.layoutRevision) {
    return { ok: false, code: 'notFound', reason: 'stale layout revision' };
  }
  if (surface.session.packageRevision() !== session.packageRevision) {
    return { ok: false, code: 'notFound', reason: 'stale package revision' };
  }
  return isStaleImageMutation(editor, session.preconditions, {
    requireDrawing: true,
    drawingNodeId: session.drawingNodeId,
  });
}
