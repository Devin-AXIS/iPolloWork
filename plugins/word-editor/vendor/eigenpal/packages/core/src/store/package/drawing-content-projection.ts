// What a drawing paints besides a plain picture: a picture frame, a group picture, vector shapes,
// a text box story, the text of group members, a SmartArt diagram, a chart from its chart part,
// or a drawing canvas.

import { readChartSummary, type DrawingChartSummary } from './chart-summary.ts';
import { readChartexSummary } from './chartex-summary.ts';
import type { DiagramPartResolver } from './diagram-parts.ts';
import { projectDiagram } from './diagram-projection.ts';
import { projectCanvas } from './drawing-canvas-projection.ts';
import { drawingRenderers } from './drawing-renderers.ts';
import {
  groupVectorMembersAreBounded,
  readGroupPicture,
  type GroupPictureProjection,
} from './drawing-group-picture.ts';
import {
  projectTextboxStory,
  projectVectorShape,
  type ShapeSchemeColorResolver,
  type ShapeStyleMatrixResolver,
  type TextboxStoryProjection,
  type VectorShapeProjection,
} from './drawing-shape-projection.ts';
import { groupTextboxesField, type GroupTextboxProjection } from './group-textbox-projection.ts';
import { projectPictureFrame, type PictureFrameEffects } from './drawing-picture-frame.ts';
import { projectTextboxChrome } from './drawing-textbox-chrome.ts';
import { readShapePictureFill } from './drawing-shape-picture-fill.ts';
import type { OoxmlElement } from './ooxml-tree.ts';

export interface DrawingContentContext {
  readonly resolveSchemeColor?: ShapeSchemeColorResolver;
  readonly resolveStyleMatrixReference?: ShapeStyleMatrixResolver;
  readonly resolveDiagramParts?: DiagramPartResolver;
}

export interface DrawingContentProjection {
  readonly groupPicture: GroupPictureProjection | null;
  /** The group's other picture members, above `groupPicture` in paint order. */
  readonly groupPictureLayers?: readonly GroupPictureProjection[];
  readonly vectorShape: VectorShapeProjection | null;
  readonly textboxStory: TextboxStoryProjection | null;
  readonly groupTextboxes?: readonly GroupTextboxProjection[];
  /** Something paints, so an "unsupported graphic" diagnostic no longer applies. */
  readonly paints: boolean;
  /** The title and plot types of a chart, whether it paints or not. */
  readonly chartSummary?: DrawingChartSummary;
  /** A picture's clip ring in the unit square of its extent; see `projectPictureFrame`. */
  readonly pictureClipUnit?: readonly Readonly<{ x: number; y: number }>[];
  /** A picture's reflection and soft edges; see `projectPictureFrame`. */
  readonly pictureEffects?: PictureFrameEffects;
}

const NOTHING: DrawingContentProjection = Object.freeze({
  groupPicture: null,
  vectorShape: null,
  textboxStory: null,
  paints: false,
});

/**
 * The painted content of a drawing: for a picture, the frame its `pic:spPr` draws around it;
 * otherwise the group picture, shapes, story, diagram, or canvas it holds.
 */
export function projectDrawingContent(
  anchor: OoxmlElement,
  extent: Readonly<{ cx: number; cy: number }>,
  compatibilityMode: boolean,
  picture: OoxmlElement | null,
  ctx: DrawingContentContext
): DrawingContentProjection {
  if (picture) {
    const frame = projectPictureFrame(picture, extent, ctx);
    return {
      ...NOTHING,
      vectorShape: frame.vectorShape,
      ...(frame.clipUnit ? { pictureClipUnit: frame.clipUnit } : {}),
      ...(frame.effects ? { pictureEffects: frame.effects } : {}),
    };
  }
  // A shape filled with a picture paints that picture as a group picture over its extent.
  const pictureFill = readShapePictureFill(anchor, extent);
  if (pictureFill) {
    return {
      groupPicture: pictureFill,
      vectorShape: projectVectorShape(
        anchor,
        extent,
        compatibilityMode,
        ctx.resolveSchemeColor,
        ctx.resolveStyleMatrixReference
      ),
      textboxStory: null,
      paints: true,
    };
  }
  const groupRead = readGroupPicture(
    anchor,
    extent,
    ctx.resolveStyleMatrixReference,
    ctx.resolveSchemeColor
  );
  const vectorMembers = projectVectorShape(
    anchor,
    extent,
    compatibilityMode,
    ctx.resolveSchemeColor,
    ctx.resolveStyleMatrixReference,
    groupRead ? new Set(groupRead.pictures.map((picture) => picture.memberNodeId)) : undefined
  );
  // A group paints whole or not at all: the picture needs every other member to paint too,
  // inside the same bounds as the picture frame.
  const groupAdmitted =
    groupRead !== null &&
    (vectorMembers
      ? groupVectorMembersAreBounded(vectorMembers, extent)
      : !groupRead.hasOtherMembers);
  const groupPicture = groupAdmitted ? groupRead.picture : null;
  const groupPictureLayers = groupAdmitted ? groupRead.pictures.slice(1) : [];
  const vectorShape = groupRead && !groupAdmitted ? null : vectorMembers;
  let chartSummary: DrawingChartSummary | null = null;
  if (!groupPicture && !vectorShape) {
    // Every chart carries its summary, whether it renders, shows a fallback, or a placeholder.
    chartSummary =
      readChartexSummary(anchor, ctx.resolveDiagramParts?.chartex) ??
      readChartSummary(anchor, ctx.resolveDiagramParts?.chart);
    // A chart paints through an installed renderer; without one it keeps its placeholder.
    const diagram =
      projectDiagram(anchor, extent, ctx) ??
      drawingRenderers().chart?.(anchor, extent, {
        resolveChartPart: ctx.resolveDiagramParts?.chart,
        resolveChartexPart: ctx.resolveDiagramParts?.chartex,
        resolveSchemeColor: ctx.resolveSchemeColor,
      }) ??
      projectCanvas(anchor, extent, ctx);
    if (diagram) {
      return {
        groupPicture: null,
        vectorShape: diagram.vectorShape,
        textboxStory: null,
        ...(diagram.groupTextboxes ? { groupTextboxes: diagram.groupTextboxes } : {}),
        paints: true,
        ...(chartSummary ? { chartSummary: { ...chartSummary, shownAs: 'chart' as const } } : {}),
      };
    }
  }
  const textboxStory = projectTextboxStory(
    anchor,
    extent,
    ctx.resolveSchemeColor,
    ctx.resolveStyleMatrixReference
  );
  // A box whose shape needs more than one solid colour paints that shape as vector components.
  const chrome =
    textboxStory && !vectorShape
      ? projectTextboxChrome(
          anchor,
          extent,
          ctx.resolveSchemeColor,
          ctx.resolveStyleMatrixReference
        )
      : null;
  return {
    groupPicture,
    ...(groupPictureLayers.length > 0
      ? { groupPictureLayers: Object.freeze(groupPictureLayers) }
      : {}),
    vectorShape: vectorShape ?? chrome,
    textboxStory: chrome && textboxStory ? { ...textboxStory, chromeByVector: true } : textboxStory,
    ...groupTextboxesField(anchor, extent, { picture: null, groupPicture, vectorShape }, ctx),
    paints: groupPicture !== null || vectorShape !== null,
    ...(chartSummary ? { chartSummary } : {}),
  };
}

/** The picture with what its frame gives it: a clip ring for its geometry, and its effects. */
export function withPictureClip<P extends object>(
  picture: P | null,
  content: DrawingContentProjection
):
  | (P & {
      readonly clipUnit?: readonly Readonly<{ x: number; y: number }>[];
      readonly frameEffects?: PictureFrameEffects;
    })
  | null {
  if (!picture || (!content.pictureClipUnit && !content.pictureEffects)) return picture;
  return {
    ...picture,
    ...(content.pictureClipUnit ? { clipUnit: content.pictureClipUnit } : {}),
    ...(content.pictureEffects ? { frameEffects: content.pictureEffects } : {}),
  };
}
