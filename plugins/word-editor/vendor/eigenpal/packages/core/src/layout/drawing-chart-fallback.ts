// The picture saved in a chart's `mc:Fallback`, as a resource on the chart's drawing record.
//
// A chart record shows one state: the drawn chart, its fallback, or a placeholder. An output
// that cannot use a drawn chart (Markdown) exports the saved picture instead, so the record
// carries that picture's resource. It resolves through the same resource path and cache as
// the record's own picture, keyed by its relationship, so a record that shows the fallback
// resolves it once.
//
// Only a record that shows the fallback (or the placeholder that replaces a fallback that
// failed) reads the picture while laying out. A drawn chart never decodes its fallback, waits
// for it, or lays out again when it settles: its record holds a `pending` state that an
// exporter resolves through its session when it needs the picture.
//
// Whether a fallback picture loads is known only when its resource settles. A fallback whose
// picture is missing, linked, external, or cannot be decoded shows the chart placeholder
// instead, with the fallback's extent (`chartRecordProjection`).

import type { DrawingProjection } from '../store/package/drawing-projection.ts';
import type { ImageResourceState } from '../store/package/image-resources.ts';
import { chartPlaceholderProjection } from '../store/package/mc-fallback-projection.ts';
import { DECODE_FAILED_RESOURCE, pendingResourceKey } from './drawing-resource-keys.ts';

/** The projection that resolves a chart's fallback picture, or null without one. */
export function fallbackPictureProjection(projection: DrawingProjection): DrawingProjection | null {
  const picture = projection.chartFallbackPicture;
  if (!picture) return null;
  return {
    ...projection,
    picture,
    vectorShape: null,
    groupPicture: null,
    groupPictureLayers: undefined,
    legacyGraphic: undefined,
    footprintOnly: undefined,
  };
}

/** Whether the projection shows a chart's saved fallback picture. */
function showsChartFallbackPicture(projection: DrawingProjection): boolean {
  const { picture, chartFallbackPicture: saved } = projection;
  return (
    !!picture &&
    !!saved &&
    picture.embeddedRelationshipId === saved.embeddedRelationshipId &&
    picture.linkedRelationshipId === saved.linkedRelationshipId
  );
}

/** Whether a settled resource cannot paint: missing, linked or external, or refused. */
function resourceFailed(resource: ImageResourceState | undefined): boolean {
  return !!resource && resource.kind !== 'ready' && resource.kind !== 'pending';
}

/**
 * The projection a record lays out for a chart: a chart shown by its fallback picture whose
 * resource failed becomes the labelled chart placeholder. `settled` answers the picture's
 * resource without starting a decode (undefined while it was never asked for).
 */
export function chartRecordProjection(
  projection: DrawingProjection,
  settled: (projection: DrawingProjection) => ImageResourceState | undefined
): DrawingProjection {
  if (!showsChartFallbackPicture(projection)) return projection;
  return resourceFailed(settled(projection)) ? chartPlaceholderProjection(projection) : projection;
}

/**
 * Whether the projection is the chart placeholder that replaced a fallback picture that
 * failed. Its resource is known at once: a placeholder decodes nothing.
 */
export function replacesFailedChartFallback(projection: DrawingProjection): boolean {
  return (
    !!projection.chartFallbackPicture &&
    projection.picture === null &&
    projection.vectorShape === null &&
    projection.chartSummary?.shownAs !== 'chart'
  );
}

/**
 * The resource of a chart's fallback picture; undefined for a drawing without one. A drawn
 * chart answers a `pending` state that starts no decode.
 */
export function chartFallbackResource(
  projection: DrawingProjection,
  resourceOf: (projection: DrawingProjection) => ImageResourceState
): ImageResourceState | undefined {
  const fallback = fallbackPictureProjection(projection);
  if (!fallback) return undefined;
  if (projection.chartSummary?.shownAs === 'chart') {
    return Object.freeze({ kind: 'pending', resourceKey: pendingResourceKey(fallback) });
  }
  return resourceOf(fallback);
}

/**
 * The settled resource of a drawn chart's fallback picture, resolved on request: a decode
 * already in flight is awaited, a settled one is reused, and otherwise the picture resolves
 * once and is stored. Undefined without a fallback picture, or when the owner is disposed.
 */
export async function resolveChartFallbackResource(deps: {
  readonly projection: DrawingProjection | undefined;
  readonly cached: (key: string) => ImageResourceState | undefined;
  readonly settlement: (key: string) => Promise<void> | undefined;
  readonly resolve: (projection: DrawingProjection) => Promise<ImageResourceState>;
  readonly live: () => boolean;
  readonly store: (key: string, state: ImageResourceState) => void;
}): Promise<ImageResourceState | undefined> {
  const fallback = deps.projection ? fallbackPictureProjection(deps.projection) : null;
  if (!fallback || !deps.live()) return undefined;
  const key = pendingResourceKey(fallback);
  if (deps.cached(key)?.kind === 'pending') await deps.settlement(key);
  const known = deps.cached(key);
  if (known && known.kind !== 'pending') return known;
  const state = await deps.resolve(fallback).catch(() => DECODE_FAILED_RESOURCE);
  if (!deps.live()) return undefined;
  const raced = deps.cached(key);
  if (raced && raced.kind !== 'pending') return raced;
  deps.store(key, state);
  return state;
}

/** The `chartFallbackResource` field of a drawing record; empty for a drawing without one. */
export function chartFallbackFields(resource: ImageResourceState | undefined): {
  readonly chartFallbackResource?: ImageResourceState;
} {
  return resource ? { chartFallbackResource: resource } : {};
}
