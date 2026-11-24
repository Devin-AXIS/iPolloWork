// Resource keys and layout tokens for the picture a drawing projection shows.

import type { DrawingProjection } from '../store/package/drawing-projection.ts';
import type { ImageResourceState } from '../store/package/image-resources.ts';
import { framedTokenJoin } from './framed-token.ts';

export const FOOTPRINT_RESOURCE: ImageResourceState = Object.freeze({
  kind: 'unrenderable',
  partName: null,
  mime: 'unknown',
  reason: 'non-picture-graphic',
});

/** The state of a picture whose decode threw. */
export const DECODE_FAILED_RESOURCE: ImageResourceState = Object.freeze({
  kind: 'unrenderable',
  partName: null,
  mime: 'unknown',
  reason: 'decode-failed',
});

export function pendingResourceKey(projection: DrawingProjection): string {
  const picture = projection.picture ?? projection.groupPicture;
  if (picture?.embeddedRelationshipId) {
    return `embed:${projection.ownerPartName}:${picture.embeddedRelationshipId}`;
  }
  if (picture?.linkedRelationshipId) {
    return `link:${projection.ownerPartName}:${picture.linkedRelationshipId}`;
  }
  return `nonpicture:${projection.drawingNodeId}`;
}

// Length-framed where a field embeds file text (resource keys carry relationship ids and
// part names verbatim), so no crafted id can shift a field boundary.
export function drawingResourceLayoutToken(resource: ImageResourceState): string {
  switch (resource.kind) {
    case 'ready':
      return framedTokenJoin([
        'ready',
        resource.resourceKey,
        resource.contentId,
        `${resource.pixelWidth}x${resource.pixelHeight}`,
      ]);
    case 'pending':
      return framedTokenJoin(['pending', resource.resourceKey]);
    case 'external':
      return framedTokenJoin(['external', resource.relationshipId, resource.sinkSafe ? '1' : '0']);
    case 'missing':
      return 'missing';
    case 'unrenderable':
      return `unrenderable:${resource.reason}`;
    default:
      return (resource as ImageResourceState).kind;
  }
}
