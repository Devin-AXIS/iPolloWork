import type { DrawingProjection } from './drawing-projection.ts';
import { isElement, isMcChoice } from './drawing-projection-walk.ts';
import { chartPlaceholderProjection, holdsChartGraphic } from './mc-fallback-projection.ts';
import {
  WML_NAMESPACE_URI,
  type OoxmlDrawingNode,
  type OoxmlGenericElementNode,
} from './ooxml-tree.ts';

/** Preserve only drawing geometry when no selected compatibility branch can provide it. */
export function unsupportedMcChoiceGeometry(
  wrapper: OoxmlGenericElementNode,
  maxBranches: number,
  project: (drawing: OoxmlDrawingNode) => DrawingProjection | null
): DrawingProjection | null {
  let visited = 0;
  for (const child of wrapper.children) {
    if (++visited > maxBranches) return null;
    if (!isElement(child) || !isMcChoice(child)) continue;
    const drawing = child.children.find(isElement);
    if (
      !drawing ||
      !isElement(drawing) ||
      drawing.namespaceUri !== WML_NAMESPACE_URI ||
      drawing.localName !== 'drawing'
    )
      continue;
    let projection = project(drawing as OoxmlDrawingNode);
    if (!projection || projection.hidden) continue;
    const chart = !!projection.chartSummary || holdsChartGraphic(drawing);
    if (chart) projection = chartPlaceholderProjection(projection);
    // An unselected branch must never supply paint content or an editable text-box story.
    return Object.freeze({
      ...projection,
      relationshipId: null,
      hyperlinkHref: null,
      picture: null,
      vectorShape: null,
      groupPicture: null,
      groupPictureLayers: undefined,
      textboxStory: null,
      groupTextboxes: undefined,
      legacyGraphic: undefined,
      textArt: undefined,
      horizontalRule: undefined,
      diagnostics: chart
        ? projection.diagnostics
        : Object.freeze([
            ...projection.diagnostics,
            Object.freeze({
              code: 'unsupported-graphic' as const,
              nodeId: drawing.id,
              detail: 'graphic',
            }),
          ]),
    });
  }
  return null;
}
