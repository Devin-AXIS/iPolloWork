// The surface half of the chart clipboard (`chart-clipboard.ts`): the copy of the one selected
// chart, and the paste of a copied chart at the selection as ONE commit. A paste replaces a
// range selection in the same undo unit, then selects the new chart.
//
// The paste follows the chart insert's rules: viewing refuses it, and so does suggesting,
// because a chart part has no tracked form. A token that is not the latest copy refuses too,
// rather than pasting the chart's name as text.

import type { TreeApplyResult } from '@docx-editor.dev/core/binding';
import type { TreeDocOp } from '@docx-editor.dev/core/store';
import {
  CHART_CLIPBOARD_STALE_REASON,
  chartClipboardFlavours,
  chartClipboardToken,
  chartCopyFor,
  chartCopySourceOf,
} from './chart-clipboard.ts';
import { CHART_SUGGESTING_REFUSAL, CHART_VIEWING_REFUSAL } from './surface-chart-ops.ts';
import type { CopyFlavours } from './clipboard-copy-payload.ts';
import { collapsedAt, type RangeDeletionPlan } from './surface-selection-ops.ts';
import type { SurfaceClipboardDeps } from './surface-clipboard-ops.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';

const refusal = (reason: string): TreeApplyResult =>
  ({ committed: false, rejected: true, opCount: 0, reason }) as TreeApplyResult;

/** The flavours of the one selected chart, or null when the selection is not one chart. */
export function chartCopyFlavours(deps: SurfaceClipboardDeps): CopyFlavours | null {
  if (deps.cellSelection()) return null;
  const { from, to } = deps.orderedRange();
  if (from.paragraphId !== to.paragraphId || from.offset !== to.offset) return null;
  const drawing = deps.selectedDrawing?.();
  if (!drawing) return null;
  const source = chartCopySourceOf(
    deps.session.currentPackage(),
    drawing.ownerPartName,
    drawing.drawingNodeId
  );
  if (!source) return null;
  return { ...chartClipboardFlavours(source), chartDrawingNodeId: drawing.drawingNodeId };
}

/**
 * Paste the copied chart that `html` names: true when it landed, false when it was refused,
 * and null when `html` names no copied chart, so the ordinary paste lanes run.
 */
export function pasteCopiedChart(deps: SurfaceClipboardDeps, html: string | null): boolean | null {
  const token = chartClipboardToken(html);
  if (token === null) return null;
  if (deps.richPasteAllowed?.() === false) return null;
  const source = chartCopyFor(token);
  const mode = deps.editingMode();
  const refused = !source
    ? CHART_CLIPBOARD_STALE_REASON
    : mode === 'view'
      ? CHART_VIEWING_REFUSAL
      : mode === 'suggest'
        ? CHART_SUGGESTING_REFUSAL
        : null;
  if (refused || !source) {
    deps.commit(() => refusal(refused ?? CHART_CLIPBOARD_STALE_REASON));
    return false;
  }
  deps.flushPendingInputAndLayout();
  const plan: RangeDeletionPlan & { readonly outsidePromptId?: string } =
    deps.typingSelectionPlan?.() ?? deps.deleteSelectionPlan();
  const target = plan.replaceAt ?? plan.collapseTo;
  const scope = deps.storyScope();
  let drawingNodeId: string | null = null;
  deps.commit(
    () => {
      const gate = deps.collaborationGate(plan.ops as unknown as TreeDocOp[], scope);
      if (gate) return refusal(gate);
      const actorId = deps.actorId();
      const result = deps.session.charts().duplicate(scope, {
        source,
        paragraphId: target.paragraphId,
        offset: target.offset,
        priorOps: plan.ops as unknown as TreeDocOp[],
        ...(plan.outsidePromptId ? { bias: 'left' as const } : {}),
        ...(actorId ? { actorId } : {}),
      });
      if (result.ok) drawingNodeId = result.drawingNodeId ?? null;
      return {
        committed: result.ok,
        rejected: !result.ok,
        opCount: result.ok ? 1 : 0,
        ...(result.ok ? {} : { reason: result.detail ?? result.reason }),
      } as unknown as TreeApplyResult;
    },
    () => collapsedAt(target)
  );
  if (drawingNodeId === null) return false;
  deps.selectPastedDrawing?.(drawingNodeId, target.paragraphId);
  return true;
}

/** Select a pasted drawing and bring the whole of it into view, as a chart insert does. */
export function selectPastedDrawing(
  surface: PaginatedSurface,
  drawingNodeId: string,
  paragraphId: string
): void {
  if (surface.selectDrawing(drawingNodeId, paragraphId))
    surface.revealPosition(surface.state().selection.head, { block: 'nearest' });
}
