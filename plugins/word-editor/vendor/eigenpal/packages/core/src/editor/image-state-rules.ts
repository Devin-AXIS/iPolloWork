// Selected-image rules shared by the image commands and the snapshot: value equality of the
// selected image, and the refusal for a chart.
//
// A chart is no picture, whether the page draws it, shows the fallback saved beside it in
// `mc:AlternateContent`, or shows a placeholder. A bare chart drawing takes the frame edits:
// size, position, wrap and alt text. Cropping, replacing, turning or bordering it as a
// picture refuse, and a wrapped chart refuses every edit but delete, which would change one
// branch alone. Delete removes the whole chart (`store/store/tree-op-chart-drawing.ts`).
// A DrawingML diagram takes the same frame edits as a bare chart, and a resize also rescales
// its saved drawing part (`store/store/tree-package-diagram-frame.ts`).

import type { EditorCommand, ExecResult, SelectedImageState } from '../contracts/editor.ts';
import type { DrawingLocks, DrawingProjection } from '../store/package/drawing-projection.ts';
import { chartDrawingOf, chartFrameEdit } from '../store/store/tree-op-chart-drawing.ts';
import { chartDrawingLocks } from '../store/store/tree-op-drawings.ts';
import { diagramDrawingOf } from '../store/store/tree-op-diagram-drawing.ts';
import { diagramDrawingPartShared } from '../store/package/diagram-frame.ts';
import type { InlineDrawingRecord } from '../layout/drawing-layout.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { partOfNodeId } from './surface-scope.ts';

/**
 * The engine's reason for a refused picture command on a chart. Adapters translate it through
 * `DISABLED_REASON_KEYS` in `@docx-editor.dev/i18n`, so the two sentences must stay the same.
 */
export const CHART_DRAWING_REASON =
  'this drawing is a chart; only delete applies, and it removes the whole chart';

/**
 * The engine's reason for a picture-only command on a chart that takes frame edits. Adapters
 * translate it through `DISABLED_REASON_KEYS` in `@docx-editor.dev/i18n`.
 */
export const CHART_FRAME_REASON =
  'this drawing is a chart; only its size, position, wrap and alt text change';

/**
 * The engine's reason for a picture-only command on a DrawingML diagram. Adapters translate it
 * through `DISABLED_REASON_KEYS` in `@docx-editor.dev/i18n`.
 */
export const DIAGRAM_FRAME_REASON =
  'this drawing is a diagram; only its size, position, wrap and alt text change';

/** Whether `drawingNodeId` names a chart: drawn, shown by its saved fallback, or a placeholder. */
export function isChartDrawing(surface: PaginatedSurface, drawingNodeId: string): boolean {
  // A pure read: `partOfNodeId`, never `partFor`, which would retain a story store.
  const part = partOfNodeId(surface.session, drawingNodeId) ?? surface.session.part();
  return chartDrawingOf(part, drawingNodeId) !== null;
}

/**
 * Whether `drawingNodeId` names a chart, and the locks that gate it. A chart's locks come
 * from its chart drawing in every state, as the store reads them for its delete, so `can()`
 * answers what the command does; any other drawing reads its own.
 */
export function drawingGate(
  surface: PaginatedSurface,
  drawingNodeId: string,
  projection: DrawingProjection
): { readonly chart: ChartGate; readonly locks: DrawingLocks } {
  const part = partOfNodeId(surface.session, drawingNodeId) ?? surface.session.part();
  const diagram = diagramDrawingOf(part, drawingNodeId);
  if (diagram) {
    // A saved drawing that another diagram shares cannot rescale, so the frame cannot resize.
    const pkg = surface.session.currentPackage();
    const shared = diagramDrawingPartShared(pkg, part.name, diagram);
    return {
      chart: 'frame',
      locks: shared ? { ...projection.locks, resize: true } : projection.locks,
    };
  }
  const target = chartDrawingOf(part, drawingNodeId);
  if (!target) return { chart: 'none', locks: projection.locks };
  return {
    chart: chartFrameEdit(target, 'resizeDrawing') ? 'frame' : 'locked',
    locks: chartDrawingLocks(target.chartDrawing) ?? projection.locks,
  };
}

/**
 * What a drawing is to the image commands: no chart, a chart or diagram that takes frame
 * edits, or a chart that takes only delete.
 */
export type ChartGate = 'none' | 'frame' | 'locked';

/** Whether `command` changes more than a chart's frame: size, position, wrap and alt text. */
function changesChartGraphic(command: EditorCommand): boolean {
  if (command.type === 'replaceImage' || command.type === 'transformImage') return true;
  if (command.type !== 'setImageProperties') return false;
  return (
    command.crop !== undefined ||
    command.resetToNaturalSize === true ||
    command.borderWidthEmu !== undefined ||
    command.borderColor !== undefined
  );
}

/**
 * The refusal of an image command on a chart, or null. A wrapped chart refuses all but
 * delete; a bare one refuses only what changes more than its frame.
 */
export function chartDrawingRefusal(
  surface: PaginatedSurface,
  command: EditorCommand,
  drawingNodeId: string
): ExecResult | null {
  if (command.type === 'deleteImage') return null;
  const part = partOfNodeId(surface.session, drawingNodeId) ?? surface.session.part();
  if (diagramDrawingOf(part, drawingNodeId)) {
    if (!changesChartGraphic(command)) return null;
    return { ok: false, code: 'unsupported', reason: DIAGRAM_FRAME_REASON };
  }
  const target = chartDrawingOf(part, drawingNodeId);
  if (!target) return null;
  if (!chartFrameEdit(target, 'resizeDrawing'))
    return { ok: false, code: 'unsupported', reason: CHART_DRAWING_REASON };
  if (!changesChartGraphic(command)) return null;
  return { ok: false, code: 'unsupported', reason: CHART_FRAME_REASON };
}

export function imageContextEqual(
  a: SelectedImageState | null,
  b: SelectedImageState | null
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.id === b.id &&
    a.kind === b.kind &&
    a.widthEmu === b.widthEmu &&
    a.heightEmu === b.heightEmu &&
    a.crop.left === b.crop.left &&
    a.crop.top === b.crop.top &&
    a.crop.right === b.crop.right &&
    a.crop.bottom === b.crop.bottom &&
    a.rotationDegrees === b.rotationDegrees &&
    a.wrap === b.wrap &&
    a.name === b.name &&
    a.title === b.title &&
    a.description === b.description &&
    a.hyperlink === b.hyperlink &&
    a.hidden === b.hidden &&
    a.resourceStatus === b.resourceStatus &&
    a.canResize === b.canResize &&
    a.canMove === b.canMove &&
    a.canChangeWrap === b.canChangeWrap &&
    a.canCrop === b.canCrop &&
    a.locks.select === b.locks.select &&
    a.locks.move === b.locks.move &&
    a.locks.resize === b.locks.resize &&
    a.locks.changeAspect === b.locks.changeAspect &&
    (a.position?.mode ?? 'frame') === (b.position?.mode ?? 'frame') &&
    (a.position?.horizontalEmu ?? null) === (b.position?.horizontalEmu ?? null) &&
    (a.position?.verticalEmu ?? null) === (b.position?.verticalEmu ?? null) &&
    (a.position?.relativeToH ?? null) === (b.position?.relativeToH ?? null) &&
    (a.position?.relativeToV ?? null) === (b.position?.relativeToV ?? null) &&
    (a.intrinsic?.pixelWidth ?? null) === (b.intrinsic?.pixelWidth ?? null) &&
    (a.intrinsic?.pixelHeight ?? null) === (b.intrinsic?.pixelHeight ?? null) &&
    (a.intrinsic?.dpiX ?? null) === (b.intrinsic?.dpiX ?? null) &&
    (a.intrinsic?.dpiY ?? null) === (b.intrinsic?.dpiY ?? null) &&
    a.memberId === b.memberId &&
    shapeFormatEqual(a.shapeFormat, b.shapeFormat)
  );
}

function shapeFormatEqual(
  a: SelectedImageState['shapeFormat'],
  b: SelectedImageState['shapeFormat']
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.fill.type === b.fill.type &&
    a.fill.color === b.fill.color &&
    a.fill.transparency === b.fill.transparency &&
    a.outline.visible === b.outline.visible &&
    a.outline.color === b.outline.color &&
    a.outline.widthPt === b.outline.widthPt &&
    a.outline.dash === b.outline.dash &&
    themeEqual(a.fill.theme, b.fill.theme) &&
    themeEqual(a.outline.theme, b.outline.theme)
  );
}

type ThemeColor = NonNullable<SelectedImageState['shapeFormat']>['fill']['theme'];

/** Whether two theme colours agree; a theme reference and an RGB of the same colour differ. */
const themeEqual = (a: ThemeColor, b: ThemeColor): boolean =>
  a === b || (!!a && !!b && a.name === b.name && a.shift === b.shift);

/** The pixel size and resolution of a picture that has loaded, or null. */
export function intrinsicOf(record: {
  readonly resource: InlineDrawingRecord['resource'];
}): SelectedImageState['intrinsic'] {
  const resource = record.resource;
  if (resource.kind !== 'ready') return null;
  return Object.freeze({
    pixelWidth: resource.pixelWidth,
    pixelHeight: resource.pixelHeight,
    dpiX: resource.dpiX,
    dpiY: resource.dpiY,
  });
}
