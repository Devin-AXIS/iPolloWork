// What one run-level drawing atom contributes to the piece walk.
//
// A `w:drawing` (or an MC wrapper carrying one) occupies one UTF-16 model unit whatever it
// paints. This decides, purely, what the walk pushes for it and whether its unit joins the
// deleted ranges; the walk owns the offset advance and the push itself.

import type { OoxmlNode } from '../store/package/ooxml-tree.ts';
import { isLegacyVmlAtom } from '../store/package/legacy-vml-projection.ts';
import { isRunLevelMcAlternateContent } from '../store/package/drawing-projection.ts';
import type { InlineDrawingLayoutContext, InlineDrawingLayoutInput } from './drawing-layout.ts';
import { groupPictureLayerResources } from './drawing-group-picture-layers.ts';
import { chartFallbackResource } from './drawing-chart-fallback.ts';
import {
  revisionsAreDeletion,
  revisionsVisible,
  type RevisionAttribution,
  type RevisionAuthorFilter,
  type RevisionDisplayMode,
} from './revision-projection.ts';

export interface RunDrawingAtomPlan {
  /** The unit joins the deleted ranges (an INLINE drawing under a tracked deletion). */
  readonly recordDeleted: boolean;
  /** Push a projected `'￼'` piece for the unit; false leaves the offset reserved only. */
  readonly emit: boolean;
  /** Piece extras: the inline drawing payload, or the anchored change-bar marker. */
  readonly extras?:
    { readonly inlineDrawing: InlineDrawingLayoutInput } | { readonly anchoredAtom: true };
}

/** True for the two run children this plan covers. */
export function isRunDrawingAtom(node: OoxmlNode): boolean {
  return node.kind === 'drawing' || isRunLevelMcAlternateContent(node) || isLegacyVmlAtom(node);
}

export function runDrawingAtomPlan(options: {
  readonly node: OoxmlNode;
  readonly layout: InlineDrawingLayoutContext;
  /** The owning run resolved to `w:vanish`. */
  readonly hiddenRun: boolean;
  readonly revisions: readonly RevisionAttribution[];
  readonly displayMode: RevisionDisplayMode;
  readonly authorFilter?: RevisionAuthorFilter;
}): RunDrawingAtomPlan {
  const { node, layout, revisions, displayMode } = options;
  // Only the projection lookup differs between the two atom kinds: an MC wrapper has no
  // direct `project` fallback.
  const projection =
    layout.projectionForAtom?.(node.id) ?? (node.kind === 'drawing' ? layout.project(node) : null);
  if (!projection || projection.kind !== 'inline') {
    // The marker only for a drawing that will actually PUBLISH: hidden anchors and failed
    // projections paint nothing, so they must cue no change bar either.
    const anchored =
      projection?.kind === 'anchored' && !projection.hidden && !projection.footprintOnly;
    return anchored
      ? { recordDeleted: false, emit: true, extras: { anchoredAtom: true } }
      : { recordDeleted: false, emit: true };
  }
  // A tracked-deleted picture stays LAID OUT in `all-markup`, exactly as deleted text does —
  // the reader is looking at a pending removal, and dropping it showed the proposed result
  // under a mode that promises the markup (#479). Its model range is still recorded as
  // deleted in every mode, because the offset exists in every mode.
  const recordDeleted = revisionsAreDeletion(revisions);
  const suppressed =
    options.hiddenRun || !revisionsVisible(revisions, displayMode, options.authorFilter);
  if (projection.hidden || suppressed) {
    // A hidden drawing keeps a bare placeholder so surrounding offsets stay aligned; a
    // mode- or vanish-suppressed one emits nothing at all.
    return projection.hidden ? { recordDeleted, emit: true } : { recordDeleted, emit: false };
  }
  return {
    recordDeleted,
    emit: true,
    extras: {
      inlineDrawing: Object.freeze({
        drawingNodeId: node.id,
        ownerPartName: layout.ownerPartName,
        projection,
        resource: layout.resourceOf(projection),
        groupPictureLayerResources: groupPictureLayerResources(projection, layout.resourceOf),
        chartFallbackResource: chartFallbackResource(projection, layout.resourceOf),
      }),
    },
  };
}
