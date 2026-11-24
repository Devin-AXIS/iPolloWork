// A chart drawing in the tree: a `w:drawing` that holds a chart graphic (classic `c:chart` or
// chartex), alone or as the Choice of a run-level `mc:AlternateContent`.
//
// The rule is structural and never asks a renderer. Whether the page draws the chart, shows
// the picture saved in the wrapper's `mc:Fallback`, or shows a placeholder, the drawing is a
// chart, not a picture. Picture edits refuse on it in every state, because an edit of one
// branch alone would leave the other as it was, and a chart's own geometry lives in its chart
// part. A delete removes the whole chart: the wrapper with both branches, or the bare drawing.
// A bare chart drawing also takes the frame edits (`chartFrameEdit`): its size, position, wrap
// and alt text live in its own anchor, as a picture's do.

import {
  isMcAlternateContent,
  isMcChoice,
  isMcFallback,
} from '../package/drawing-projection-walk.ts';
import { choiceChartDrawing, holdsChartGraphic } from '../package/mc-fallback-projection.ts';
import { findNode, parentNodeOf } from '../package/ooxml-edit.ts';
import { WML_NAMESPACE_URI } from '../package/ooxml-shared.ts';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';

/** A chart in the tree: the node a delete removes, and the drawing that holds the chart. */
export interface ChartDrawingTarget {
  /** The `mc:AlternateContent` wrapper, or the bare chart `w:drawing`. */
  readonly removeNodeId: string;
  /** The chart's `w:drawing`, whose anchor carries the chart's locks. */
  readonly chartDrawing: OoxmlElement;
}

/** How far up from a fallback's nested content the wrapper is looked for. */
const MAX_FALLBACK_DEPTH = 4;

function isWmlDrawing(node: OoxmlNode): node is OoxmlElement {
  return (
    node.kind !== 'textValue' &&
    (node.kind === 'drawing' ||
      (node.namespaceUri === WML_NAMESPACE_URI && node.localName === 'drawing'))
  );
}

function wrapperTarget(wrapper: OoxmlNode | null): ChartDrawingTarget | null {
  if (!wrapper || wrapper.kind === 'textValue' || !isMcAlternateContent(wrapper)) return null;
  const chartDrawing = choiceChartDrawing(wrapper);
  return chartDrawing ? { removeNodeId: wrapper.id, chartDrawing } : null;
}

/**
 * The chart that `nodeId` names, or null when it names no chart.
 *
 * `nodeId` can be a run-level `mc:AlternateContent` whose Choice holds a chart, that chart
 * drawing, any content of the wrapper's `mc:Fallback` (a picture, shape or VML), or a bare
 * chart `w:drawing`.
 */
export function chartDrawingOf(part: OoxmlPart, nodeId: string): ChartDrawingTarget | null {
  const node = findNode(part, nodeId);
  if (!node || node.kind === 'textValue') return null;
  if (isMcAlternateContent(node)) return wrapperTarget(node);
  let current: OoxmlNode = node;
  for (let depth = 0; depth < MAX_FALLBACK_DEPTH; depth += 1) {
    const parent = parentNodeOf(part, current.id);
    if (!parent) break;
    if (isMcFallback(parent)) return wrapperTarget(parentNodeOf(part, parent.id));
    if (isMcChoice(parent)) {
      const target = wrapperTarget(parentNodeOf(part, parent.id));
      return target?.chartDrawing === current ? target : null;
    }
    current = parent;
  }
  if (isWmlDrawing(node) && holdsChartGraphic(node)) {
    return { removeNodeId: node.id, chartDrawing: node };
  }
  return null;
}

/** The edits that change only a chart's frame in the page, never its graphic. */
const CHART_FRAME_EDITS: ReadonlySet<string> = new Set([
  'resizeDrawing',
  'positionDrawing',
  'setDrawingWrap',
  'setDrawingMetadata',
]);

/**
 * Whether `operation` may change the frame of this chart: its size, position, wrap or alt text.
 * Only a bare chart drawing takes them. In an `mc:AlternateContent` wrapper the fallback
 * branch keeps its own frame, and an edit of one branch alone leaves the two out of step.
 */
export function chartFrameEdit(target: ChartDrawingTarget, operation: string): boolean {
  return target.removeNodeId === target.chartDrawing.id && CHART_FRAME_EDITS.has(operation);
}
