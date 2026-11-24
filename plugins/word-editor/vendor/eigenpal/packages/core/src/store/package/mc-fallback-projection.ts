// The `mc:Fallback` of a run-level `mc:AlternateContent` whose chosen branch cannot paint.
//
// The chosen branch can hold content outside the supported subset, such as a group nested
// inside a group. Its `mc:Fallback` often holds the same graphic as VML, which the engine can
// draw. That fallback then stands for the wrapper, with its own geometry. Without a fallback
// that paints, the caller keeps its earlier answer for the chosen branch.
//
// A chart (classic `c:chart` or chartex `cx:chart`) follows one rule: its chosen branch when
// that paints (a chart renderer is installed and supports the chart), otherwise its fallback
// when that paints (a DrawingML picture or drawable VML), otherwise its labelled `chart`
// placeholder. A skipped Choice can supply bounds for a placeholder when its fallback is
// empty. A hidden chart stays hidden whatever its fallback shows. A rendered fallback
// carries the chart's summary. The renderer
// registry is process-wide and read when the drawing is projected, so install renderers
// before opening a document. A Choice that the reader does not support (its `Requires` names
// an unknown namespace) is skipped for the fallback; a chart in it still gives its summary.
//
// One rule gives a chart its author text in every state: the chart drawing's own title and
// description, then the fallback's.

import { CHART_GRAPHIC_DATA_URI } from './chart-parts.ts';
import { readChartSummary } from './chart-summary.ts';
import { CHARTEX_GRAPHIC_DATA_URI } from './chartex-parts.ts';
import { readChartexSummary } from './chartex-summary.ts';
import type { DiagramPartResolver } from './diagram-parts.ts';
import { findGraphicData } from './drawing-group-frame.ts';
import type { DrawingProjection } from './drawing-projection.ts';
import {
  isElement,
  isMcChoice,
  isMcFallback,
  namespaceScopeForNode,
} from './drawing-projection-walk.ts';
import { projectLegacyVml } from './legacy-vml-projection.ts';
import { WML_NAMESPACE_URI, WP_NAMESPACE_URI } from './ooxml-shared.ts';
import type { OoxmlDrawingNode, OoxmlElement, OoxmlGenericElementNode } from './ooxml-tree.ts';

/**
 * The read-only projection of a VML `mc:Fallback` that paints, or null. A fallback text box
 * is left out: the wrapper's text box story is always read from its chosen branch.
 */
export function paintableMcFallback(
  wrapper: OoxmlGenericElementNode,
  ownerPartName: string
): DrawingProjection | null {
  for (const child of wrapper.children) {
    if (!isElement(child) || !isMcFallback(child)) continue;
    const content = child.children.find(isElement);
    const projection = content ? projectLegacyVml(content, ownerPartName) : null;
    if (!projection || projection.hidden || projection.textboxStory) return null;
    return projection.picture || projection.vectorShape || projection.legacyGraphic
      ? projection
      : null;
  }
  return null;
}

function isDrawingAnchor(node: OoxmlElement): boolean {
  return (
    node.kind === 'inlineDrawing' ||
    node.kind === 'anchoredDrawing' ||
    (node.namespaceUri === WP_NAMESPACE_URI &&
      (node.localName === 'inline' || node.localName === 'anchor'))
  );
}

/** The `wp:inline` or `wp:anchor` of a `w:drawing`, or null. */
function drawingAnchorOf(drawing: OoxmlElement): OoxmlElement | null {
  for (const child of drawing.children) {
    if (child.kind !== 'textValue' && isDrawingAnchor(child)) return child;
  }
  return null;
}

/** Whether a `w:drawing` holds a chart graphic, classic or chartex. */
export function holdsChartGraphic(drawing: OoxmlElement): boolean {
  const anchor = drawingAnchorOf(drawing);
  const data = anchor ? findGraphicData(anchor) : null;
  const uri = data?.attributes.find((attribute) => attribute.localName === 'uri')?.value;
  return uri === CHART_GRAPHIC_DATA_URI || uri === CHARTEX_GRAPHIC_DATA_URI;
}

function isWmlDrawing(node: OoxmlElement): boolean {
  return (
    node.kind === 'drawing' ||
    (node.namespaceUri === WML_NAMESPACE_URI && node.localName === 'drawing')
  );
}

/** The chart `w:drawing` in a Choice of `wrapper`, whether or not the Choice is supported. */
export function choiceChartDrawing(wrapper: OoxmlElement): OoxmlElement | null {
  for (const choice of wrapper.children) {
    if (!isElement(choice) || !isMcChoice(choice)) continue;
    for (const content of choice.children) {
      if (isElement(content) && isWmlDrawing(content) && holdsChartGraphic(content)) {
        return content;
      }
    }
  }
  return null;
}

/** A chart's author text: the chart drawing's own title and description, then the fallback's. */
export function chartAuthorText(
  chart: Pick<DrawingProjection, 'title' | 'description'>,
  fallback: Pick<DrawingProjection, 'title' | 'description'>
): { readonly title: string; readonly description: string } {
  return {
    title: chart.title || fallback.title,
    description: chart.description || fallback.description,
  };
}

/**
 * The labelled `chart` placeholder for a chart whose fallback does not paint. It keeps the
 * extent, the author text and the saved fallback picture (for an output that exports it).
 */
export function chartPlaceholderProjection(projection: DrawingProjection): DrawingProjection {
  return Object.freeze({
    ...projection,
    picture: null,
    vectorShape: null,
    groupPicture: null,
    groupPictureLayers: undefined,
    legacyGraphic: undefined,
    ...(projection.chartSummary
      ? { chartSummary: { ...projection.chartSummary, shownAs: 'placeholder' as const } }
      : {}),
    diagnostics: Object.freeze([
      ...projection.diagnostics,
      Object.freeze({
        code: 'unsupported-graphic' as const,
        nodeId: projection.drawingNodeId,
        detail: CHART_GRAPHIC_DATA_URI,
      }),
    ]),
  });
}

/**
 * The projection of a wrapper whose chosen branch is the Fallback because its Choice is not
 * supported, when that Choice holds a chart: the fallback with the chart's summary and author
 * text, or the chart placeholder when the fallback paints nothing. Null when `chosen` is not
 * a Fallback or no skipped Choice holds a chart.
 */
export function skippedChoiceChartProjection(
  wrapper: OoxmlGenericElementNode,
  chosen: OoxmlElement,
  projection: DrawingProjection,
  resolveDiagramParts: DiagramPartResolver | undefined,
  readAuthorText: (
    anchor: OoxmlElement
  ) => Pick<DrawingProjection, 'title' | 'description' | 'hidden'>
): DrawingProjection | null {
  const fallback = wrapper.children.find(
    (child): child is OoxmlElement => isElement(child) && isMcFallback(child)
  );
  if (!fallback || !fallback.children.some((child) => child === chosen)) return null;
  const chart = choiceChartDrawing(wrapper);
  const anchor = chart ? drawingAnchorOf(chart) : null;
  if (!anchor) return null;
  const summary =
    readChartexSummary(anchor, resolveDiagramParts?.chartex) ??
    readChartSummary(anchor, resolveDiagramParts?.chart);
  const text = readAuthorText(anchor);
  const paints = !!(projection.picture || projection.vectorShape || projection.groupPicture);
  const merged: DrawingProjection = Object.freeze({
    ...projection,
    ...chartAuthorText(text, projection),
    // A hidden chart stays hidden, whatever its fallback shows.
    hidden: projection.hidden || text.hidden,
    ...(summary ? { chartSummary: { ...summary, shownAs: 'fallback' as const } } : {}),
    ...(projection.picture ? { chartFallbackPicture: projection.picture } : {}),
  });
  return paints ? merged : chartPlaceholderProjection(merged);
}

/** Projects one fallback `w:drawing` in its namespace scope. */
export type McFallbackDrawingProjector = (
  drawing: OoxmlDrawingNode,
  namespaceScope: ReadonlyMap<string, string>
) => DrawingProjection | null;

/**
 * The fallback that stands for a chart whose chosen branch does not paint: a DrawingML
 * picture (or a shape or group the engine draws) in a fallback `w:drawing`, or drawable VML.
 * Null when the fallback paints nothing, so the chart keeps its placeholder.
 */
export function paintableMcChartFallback(
  wrapper: OoxmlGenericElementNode,
  namespaceScope: ReadonlyMap<string, string>,
  ownerPartName: string,
  project: McFallbackDrawingProjector
): DrawingProjection | null {
  for (const child of wrapper.children) {
    if (!isElement(child) || !isMcFallback(child)) continue;
    let content: OoxmlElement | null = null;
    for (const node of child.children) {
      if (node.kind !== 'textValue') {
        content = node;
        break;
      }
    }
    if (!content) return null;
    const isDrawing =
      content.kind === 'drawing' ||
      (content.namespaceUri === WML_NAMESPACE_URI && content.localName === 'drawing');
    if (!isDrawing) return paintableMcFallback(wrapper, ownerPartName);
    if (holdsChartGraphic(content)) return null;
    const scope = namespaceScopeForNode(namespaceScopeForNode(namespaceScope, child), content);
    const projection = project(content as unknown as OoxmlDrawingNode, scope);
    if (!projection || projection.hidden) return null;
    return projection.picture || projection.vectorShape || projection.groupPicture
      ? projection
      : null;
  }
  return null;
}
