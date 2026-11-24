// The chart lanes of the package store: insert a chart (`insertChart`), and edit the chart
// part behind a chart drawing (`setChartData`, `setChartType`, `setChartFormat`,
// `setChartColor`). Each is ONE package undo unit. An insert writes the chart part, its
// embedded workbook, both relationships, and the drawing; an edit writes the chart part and,
// for a data edit, the workbook. Layout keys chart drawings on the chart part's root, so an
// edit of the part alone lays the chart out again.

import type { StoryScope, TreePackageStore } from './tree-package-store.ts';
import {
  transactPackageImage,
  type ImageIntentResult,
  type ImageTransactOptions,
} from './tree-package-images.ts';
import { findNode } from '../package/ooxml-edit.ts';
import type { OoxmlPackage } from '../package/ooxml-package.ts';
import { allocateDrawingPropertyId } from '../package/drawing-package-edit.ts';
import { chartDrawingOf } from './tree-op-chart-drawing.ts';
import { chartTargetOf, type ChartEdit, type ChartTarget } from '../package/chart-edit/data.ts';
import {
  buildInlineChartDrawing,
  withChartSpace,
  withChartWorkbook,
  withNewChart,
} from '../package/chart-edit/package.ts';
import { duplicatedChartDrawing, withDuplicatedChart } from '../package/chart-edit/duplicate.ts';
import { ChartRefusal } from '../package/chart-edit/tree.ts';
import type { OoxmlDrawingNode, OoxmlElement } from '../package/ooxml-tree.ts';
import type { TreeDocOp } from './tree-op-types.ts';
import type { ChartType, NewChartData } from '../package/chart-edit/types.ts';
import { effectiveContentLockAt, isBoundAt } from './tree-op-nodes.ts';

/** Chart part writes must respect the control that owns their drawing. */
export function chartContentRefusal(
  pkg: OoxmlPackage,
  ownerPart: string,
  drawingNodeId: string
): 'locked' | 'bound' | null {
  const part = pkg.parts.get(ownerPart);
  if (!part) return null;
  if (effectiveContentLockAt(part, drawingNodeId).content) return 'locked';
  return isBoundAt(part, drawingNodeId) ? 'bound' : null;
}

/** The result of a chart lane: the store's result, or a chart refusal key. */
export type ChartIntentResult =
  ImageIntentResult | { readonly ok: false; readonly reason: 'chart'; readonly detail: string };

/** A chart insert at one place in a story. */
export interface InsertChartInput {
  /** Explicit left bias inserts before a leading prompt. */
  readonly bias?: 'left' | 'right';
  readonly paragraphId: string;
  readonly offset: number;
  readonly chartType: ChartType;
  readonly data?: NewChartData;
  readonly widthPoints: number;
  readonly heightPoints: number;
  /** The `wp:docPr` name, such as `Chart 1`. */
  readonly name: string;
  readonly expectedPackageRevision?: number;
  readonly actorId?: string;
}

const refused = (error: unknown): ChartIntentResult | null =>
  error instanceof ChartRefusal ? { ok: false, reason: 'chart', detail: error.reason } : null;

/** Insert a new chart with an embedded workbook, as one package undo unit. */
export function insertChart(
  store: TreePackageStore,
  scope: StoryScope,
  input: InsertChartInput
): ChartIntentResult {
  let refusal: ChartIntentResult | null = null;
  const options: ImageTransactOptions = {
    ...(input.expectedPackageRevision !== undefined
      ? { expectedPackageRevision: input.expectedPackageRevision }
      : {}),
    ...(input.actorId ? { actorId: input.actorId } : {}),
  };
  const outcome = transactPackageImage(
    store,
    scope,
    (ctx, owner) => {
      try {
        const added = withNewChart(
          store.currentPackage(),
          owner,
          input.chartType,
          input.data,
          input.actorId
        );
        const docPr = allocateDrawingPropertyId(added.pkg);
        if (!docPr.ok) return null;
        if (!ctx.applyPackage(() => added.pkg)) return null;
        const drawing = buildInlineChartDrawing({
          docPrId: docPr.id,
          relationshipId: added.relationshipId,
          name: input.name.replaceAll('{number}', String(docPr.id)),
          widthPoints: input.widthPoints,
          heightPoints: input.heightPoints,
        });
        if (
          !ctx.apply({
            op: 'insertDrawing',
            ...(input.bias ? { bias: input.bias } : {}),
            paragraphId: input.paragraphId,
            offset: input.offset,
            drawing,
          })
        )
          return null;
        return drawing.id;
      } catch (error) {
        refusal = refused(error);
        if (refusal) return null;
        throw error;
      }
    },
    options
  );
  return refusal ?? outcome;
}

/** The chart part behind the chart drawing `drawingNodeId` of a story, or null. */
export function chartTargetIn(
  pkg: OoxmlPackage,
  ownerPart: string,
  drawingNodeId: string
): ChartTarget | null {
  const part = pkg.parts.get(ownerPart);
  if (!part) return null;
  const chart = chartDrawingOf(part, drawingNodeId);
  const drawing = chart ? chart.chartDrawing : findNode(part, drawingNodeId);
  return drawing ? chartTargetOf(pkg, ownerPart, drawing) : null;
}

/** Edit the chart part behind a chart drawing, as one package undo unit. */
export function editChart(
  store: TreePackageStore,
  scope: StoryScope,
  drawingNodeId: string,
  edit: (pkg: OoxmlPackage, target: ChartTarget) => ChartEdit,
  options?: { readonly actorId?: string }
): ChartIntentResult {
  let refusal: ChartIntentResult | null = null;
  const outcome = transactPackageImage(
    store,
    scope,
    (ctx, owner) => {
      try {
        const pkg = store.currentPackage();
        const target = chartTargetIn(pkg, owner, drawingNodeId);
        if (!target) throw new ChartRefusal('chart.errors.noChart');
        const blocked = chartContentRefusal(pkg, owner, drawingNodeId);
        if (blocked) {
          refusal = { ok: false, reason: blocked };
          return null;
        }
        const change = edit(pkg, target);
        let next = withChartSpace(pkg, target.part, change.chartSpace);
        if (change.workbook)
          next = withChartWorkbook(next, change.workbook.part, change.workbook.bytes);
        if (!ctx.applyPackage(() => next)) return null;
        return drawingNodeId;
      } catch (error) {
        refusal = refused(error);
        if (refusal) return null;
        throw error;
      }
    },
    options?.actorId ? { actorId: options.actorId } : undefined
  );
  return refusal ?? outcome;
}

/** A chart copied out of a package: the package as it was, and the chart drawing in it. */
export interface ChartCopySource {
  readonly pkg: OoxmlPackage;
  /** The story part that holds the drawing. */
  readonly ownerPart: string;
  /** The chart's `w:drawing`, as the source package holds it. */
  readonly drawing: OoxmlElement;
}

/** A paste of a copied chart at one place in a story. */
export interface DuplicateChartInput {
  /** Explicit left bias inserts before a leading prompt. */
  readonly bias?: 'left' | 'right';
  readonly source: ChartCopySource;
  readonly paragraphId: string;
  readonly offset: number;
  /** Ops that run first in the same unit, such as the removal of the selected text. */
  readonly priorOps?: readonly TreeDocOp[];
  readonly expectedPackageRevision?: number;
  readonly actorId?: string;
}

/**
 * Insert a copy of a chart, with copies of its chart part and of each part the chart part
 * reaches, as one package undo unit. The source package may be this store's or another's.
 */
export function duplicateChart(
  store: TreePackageStore,
  scope: StoryScope,
  input: DuplicateChartInput
): ChartIntentResult {
  let refusal: ChartIntentResult | null = null;
  const options: ImageTransactOptions = {
    ...(input.expectedPackageRevision !== undefined
      ? { expectedPackageRevision: input.expectedPackageRevision }
      : {}),
    ...(input.actorId ? { actorId: input.actorId } : {}),
  };
  const outcome = transactPackageImage(
    store,
    scope,
    (ctx, owner) => {
      try {
        const { source } = input;
        const target = chartTargetOf(source.pkg, source.ownerPart, source.drawing);
        if (!target) throw new ChartRefusal('chart.errors.noChart');
        const added = withDuplicatedChart(
          store.currentPackage(),
          owner,
          source.pkg,
          target.part,
          input.actorId
        );
        const docPr = allocateDrawingPropertyId(added.pkg, input.actorId);
        if (!docPr.ok) return null;
        if (source.drawing.kind !== 'drawing') throw new ChartRefusal('chart.errors.noChart');
        const drawing = duplicatedChartDrawing(
          source.drawing as OoxmlDrawingNode,
          added.relationshipId,
          docPr.id
        );
        if (!ctx.applyPackage(() => added.pkg)) return null;
        // After the package write, which carries the story part as it stood before the unit.
        for (const op of input.priorOps ?? []) if (!ctx.apply(op)) return null;
        if (
          !ctx.apply({
            op: 'insertDrawing',
            ...(input.bias ? { bias: input.bias } : {}),
            paragraphId: input.paragraphId,
            offset: input.offset,
            drawing,
          })
        )
          return null;
        return drawing.id;
      } catch (error) {
        refusal = refused(error);
        if (refusal) return null;
        throw error;
      }
    },
    options
  );
  return refusal ?? outcome;
}

/** The chart lanes of one package store, as the editor session hands them on. */
export interface ChartLanes {
  insert(scope: StoryScope, input: InsertChartInput): ChartIntentResult;
  /** Insert a copy of a copied chart, as {@link duplicateChart} does. */
  duplicate(scope: StoryScope, input: DuplicateChartInput): ChartIntentResult;
  edit(
    scope: StoryScope,
    drawingNodeId: string,
    edit: (pkg: OoxmlPackage, target: ChartTarget) => ChartEdit,
    options?: { readonly actorId?: string }
  ): ChartIntentResult;
}

/** The chart lanes over `store`. */
export const chartLanesFor = (store: TreePackageStore): ChartLanes => ({
  insert: (scope, input) => insertChart(store, scope, input),
  duplicate: (scope, input) => duplicateChart(store, scope, input),
  edit: (scope, drawingNodeId, edit, options) =>
    editChart(store, scope, drawingNodeId, edit, options),
});
