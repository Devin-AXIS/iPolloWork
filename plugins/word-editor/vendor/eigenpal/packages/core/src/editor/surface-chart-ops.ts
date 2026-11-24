// Chart commits for the paginated surface: insert a chart, and edit the chart part behind a
// chart drawing. Both go through the surface's commit path, as picture edits do, so layout
// and paint refresh at once and the collaboration actor mints the new ids.
//
// Viewing refuses both. Suggesting refuses both too: a chart part has no tracked form, so a
// proposal could not hold the edit, and tracking is never turned off to let one through.

import type { TreeApplyResult, TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import type { SemanticSelection } from '@docx-editor.dev/core/layout';
import type { StoryScope } from '@docx-editor.dev/core/store';
import type { OoxmlPackage } from '../store/package/ooxml-package.ts';
import type { ChartEdit, ChartTarget } from '../store/package/chart-edit/data.ts';
import type { ChartIntentResult, InsertChartInput } from '../store/store/tree-package-charts.ts';
import type { SurfaceEditingMode } from './paginated-surface-contract.ts';

/** The refusal of a chart edit while the document is open for viewing. */
export const CHART_VIEWING_REFUSAL = 'the document is open for viewing';
/** The refusal of a chart edit in suggesting mode. */
export const CHART_SUGGESTING_REFUSAL = 'chart changes are not supported in suggesting mode';

/** A surface chart insert; the actor is the surface's to supply. */
export type SurfaceInsertChartInput = Omit<InsertChartInput, 'actorId'>;

/** The chart operations of the paginated surface. */
export interface SurfaceChartOps {
  insertChart(input: SurfaceInsertChartInput): ChartIntentResult;
  editChart(
    drawingNodeId: string,
    edit: (pkg: OoxmlPackage, target: ChartTarget) => ChartEdit
  ): ChartIntentResult;
}

export function createChartOps(deps: {
  session: TreeDocxSessionView;
  commit: (
    run: () => TreeApplyResult | boolean,
    selectionAfter?: () => SemanticSelection | null
  ) => void;
  storyScope: () => StoryScope;
  outsidePromptAt?: (paragraphId: string, offset: number) => boolean;
  editingMode: () => SurfaceEditingMode;
  actorId: () => string | undefined;
}): SurfaceChartOps {
  const refusal = (): ChartIntentResult | null => {
    const mode = deps.editingMode();
    if (mode === 'view') return { ok: false, reason: 'invalidArgs', detail: CHART_VIEWING_REFUSAL };
    if (mode === 'suggest')
      return { ok: false, reason: 'invalidArgs', detail: CHART_SUGGESTING_REFUSAL };
    return null;
  };
  const run = (lane: () => ChartIntentResult): ChartIntentResult => {
    const refused = refusal();
    if (refused) return refused;
    let result: ChartIntentResult = { ok: false, reason: 'invalidArgs' };
    deps.commit(() => {
      result = lane();
      return {
        committed: result.ok,
        rejected: !result.ok,
        opCount: result.ok ? 1 : 0,
        ...(result.ok ? {} : { reason: result.detail ?? result.reason }),
      };
    });
    return result;
  };
  return {
    insertChart(input) {
      const actorId = deps.actorId();
      return run(() =>
        deps.session.charts().insert(deps.storyScope(), {
          ...input,
          ...(deps.outsidePromptAt?.(input.paragraphId, input.offset)
            ? { bias: 'left' as const }
            : {}),
          ...(actorId ? { actorId } : {}),
        })
      );
    },
    editChart(drawingNodeId, edit) {
      const actorId = deps.actorId();
      return run(() =>
        deps.session
          .charts()
          .edit(deps.storyScope(), drawingNodeId, edit, actorId ? { actorId } : undefined)
      );
    },
  };
}
