import type {
  DrawingProjection,
  projectDrawing,
  projectRunLevelMcDrawing,
} from './drawing-projection.ts';
import { projectLegacyVml } from './legacy-vml-projection.ts';
import { isElement } from './drawing-projection-walk.ts';
import {
  WML_NAMESPACE_URI,
  type OoxmlDrawingNode,
  type OoxmlElement,
  type OoxmlGenericElementNode,
  type OoxmlNode,
} from './ooxml-tree.ts';
import { hostsTextboxStory } from './group-textbox-projection.ts';
import { withAlternateContentGroupPictures } from './drawing-group-picture.ts';
import {
  chartAuthorText,
  holdsChartGraphic,
  paintableMcChartFallback,
  paintableMcFallback,
  skippedChoiceChartProjection,
} from './mc-fallback-projection.ts';
import { unsupportedMcChoiceGeometry } from './mc-unsupported-projection.ts';

/** Resolve compatibility drawing content without changing either source branch. */
export function projectMcDrawingContent(
  wrapper: OoxmlGenericElementNode,
  context: Parameters<typeof projectRunLevelMcDrawing>[1],
  drawing: OoxmlDrawingNode | null,
  select: () => { readonly branch: OoxmlNode | null; readonly refused: boolean },
  project: typeof projectDrawing,
  readAuthorText: (
    anchor: OoxmlElement
  ) => Pick<DrawingProjection, 'title' | 'description' | 'hidden'>
): DrawingProjection | null {
  const fallbackOf = () =>
    paintableMcChartFallback(
      wrapper,
      context.namespaceScope,
      context.ownerPartName,
      (fallback, namespaceScope) => project(fallback, { ...context, namespaceScope })
    );
  if (drawing === null) {
    const selected = select();
    const legacy = selected.branch
      ? projectLegacyVml(selected.branch, context.ownerPartName)
      : null;
    if (legacy && selected.branch && isElement(selected.branch)) {
      const skipped = skippedChoiceChartProjection(
        wrapper,
        selected.branch,
        legacy,
        context.resolveDiagramParts,
        readAuthorText
      );
      return skipped ?? (legacy.hidden ? null : legacy);
    }
    if (selected.refused) return null;
    if (
      selected.branch &&
      (!isElement(selected.branch) ||
        selected.branch.namespaceUri !== WML_NAMESPACE_URI ||
        !['pict', 'object'].includes(selected.branch.localName))
    )
      return null;
    return unsupportedMcChoiceGeometry(
      wrapper,
      context.limits.maxCompatibilityBranches,
      (drawing) => project(drawing, context)
    );
  }
  const projection = project(drawing, {
    ...context,
    namespaceScope: context.namespaceScope,
  });
  if (!projection) return paintableMcFallback(wrapper, context.ownerPartName);
  // A chart in a skipped Choice still names the chart its fallback stands for.
  const skipped = skippedChoiceChartProjection(
    wrapper,
    drawing,
    projection,
    context.resolveDiagramParts,
    readAuthorText
  );
  if (skipped) return skipped;
  if (projection.hidden) {
    return projection.chartSummary || holdsChartGraphic(drawing) ? projection : null;
  }
  // Prefer a paintable fallback when the selected modern drawing cannot paint.
  // Otherwise retain its geometry and diagnostic for the unsupported-content API.
  if (
    projection.picture === null &&
    projection.vectorShape === null &&
    projection.groupPicture === null &&
    !hostsTextboxStory(projection)
  ) {
    if (projection.chartSummary || holdsChartGraphic(drawing)) {
      // A hidden chart stays hidden, whatever its fallback shows.
      const chartFallback = projection.hidden ? null : fallbackOf();
      if (chartFallback) {
        return Object.freeze({
          ...chartFallback,
          ...chartAuthorText(projection, chartFallback),
          ...(projection.chartSummary
            ? { chartSummary: { ...projection.chartSummary, shownAs: 'fallback' as const } }
            : {}),
          ...(chartFallback.picture ? { chartFallbackPicture: chartFallback.picture } : {}),
        });
      }
      return withAlternateContentGroupPictures(projection);
    }
    const fallback = paintableMcFallback(wrapper, context.ownerPartName);
    if (fallback) return fallback;
    return projection;
  }
  // A drawn chart keeps the picture saved in its fallback, for an output that exports it,
  // and takes its author text by the same rule as a chart shown by its fallback.
  if (projection.chartSummary && !projection.hidden) {
    const fallback = fallbackOf();
    if (fallback?.picture) {
      return Object.freeze({
        ...projection,
        ...chartAuthorText(projection, fallback),
        chartFallbackPicture: fallback.picture,
      });
    }
  }
  // Preserve compatibility provenance for group-picture resource handling.
  return withAlternateContentGroupPictures(projection);
}
