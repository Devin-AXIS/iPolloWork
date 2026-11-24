// Image resolution for `w:numPicBullet` markers, on the ordinary embedded-image path.
//
// `w:numPicBullet` lives in `numbering.xml` and its `v:imagedata/@r:id` names a relationship
// of THAT part, so it resolves through the numbering part's own rels and not the story's.
// Everything else is the path an inline picture takes: `resolveEmbedded` refuses an external
// target without fetching it, refuses a target that escapes the package, sniffs the
// signature, validates the header, applies the decode caps, and only then mints a validated
// handle. Every refusal is a STATE, not a throw, so the marker falls back to the level's
// `w:lvlText` instead of failing the document.

import type { ImageResourceLookup, ImageResourceState } from '../store/package/image-resources.ts';
import type { OoxmlPackage } from '../store/package/ooxml-package.ts';
import type { ValidatedImageBytesHandle } from '../store/package/validated-image-bytes.ts';
import { resolveRelationship } from '../store/package/relationships.ts';

/** Relationship type of the numbering part, whose rels own every picture bullet image. */
const NUMBERING_RELATIONSHIP_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering';

/** Where Word writes the numbering part when the main document declares no relationship. */
const DEFAULT_NUMBERING_PART_NAME = '/word/numbering.xml';

/** Distinct picture-bullet relationship ids one resolver will ever send to the decode port. */
const MAX_PICTURE_BULLET_RESOURCES = 64;

/** One picture bullet's image, and the part whose relationships named it. */
export interface PictureBulletResource {
  readonly ownerPartName: string;
  readonly resource: ImageResourceState;
}

/** Bundle-owned picture-bullet image state: resolve, invalidate, and a cache epoch. */
export interface PictureBulletResourceResolver {
  /** Current state for one relationship id; schedules the decode on first ask. */
  readonly resolve: (relationshipId: string) => PictureBulletResource | null;
  /**
   * Monotonic counter, bumped whenever a bullet settles.
   *
   * Folded into the drawing cache tokens: the authored EXTENT decides the line height and is
   * known from the file, so a settle never re-breaks a line — but a fragment published while
   * the image was pending carries a pending resource, and only a changed key republishes it.
   */
  readonly epoch: () => number;
  /**
   * Bullets discovered but not yet settled.
   *
   * Headless export lays the document out and then WAITS for this to reach zero before it
   * publishes, exactly as it does for drawings. A resolver that did not report its in-flight
   * work let a converged layout publish a `pending` bullet, and every exporter then drew the
   * level's text for an image that was about to be ready.
   */
  readonly pendingCount: () => number;
  /** Drop every resolved bullet; the next ask re-resolves against the current package. */
  readonly reset: () => void;
}

export function createPictureBulletResourceResolver(options: {
  readonly currentPackage: () => OoxmlPackage;
  readonly lookup: () => ImageResourceLookup;
  readonly rememberReadyHandle: (handle: ValidatedImageBytesHandle) => void;
  readonly onResourcesChanged: () => void;
}): PictureBulletResourceResolver {
  let epoch = 0;
  let generation = 0;
  let ownerPartName: string | null | undefined;
  const states = new Map<string, ImageResourceState>();
  const inFlight = new Set<string>();

  const numberingPartName = (): string | null => {
    if (ownerPartName !== undefined) return ownerPartName;
    const pkg = options.currentPackage();
    let resolvedName: string | null = null;
    for (const record of pkg.relationships.get(pkg.mainDocumentPart) ?? []) {
      if (record.type !== NUMBERING_RELATIONSHIP_TYPE) continue;
      const resolved = resolveRelationship(record);
      // An External numbering relationship is not followed, exactly as an external image is
      // not: the `Internal` arm is the only one that can name a part.
      if (resolved.mode !== 'Internal' || !resolved.target.ok) break;
      if (pkg.parts.has(resolved.target.partName)) resolvedName = resolved.target.partName;
      break;
    }
    if (resolvedName === null && pkg.parts.has(DEFAULT_NUMBERING_PART_NAME)) {
      resolvedName = DEFAULT_NUMBERING_PART_NAME;
    }
    ownerPartName = resolvedName;
    return resolvedName;
  };

  const settle = (relationshipId: string, state: ImageResourceState): void => {
    states.set(relationshipId, state);
    if (state.kind === 'ready') options.rememberReadyHandle(state.validatedHandle);
    inFlight.delete(relationshipId);
    epoch += 1;
    options.onResourcesChanged();
  };

  const schedule = (owner: string, relationshipId: string): void => {
    if (inFlight.has(relationshipId)) return;
    inFlight.add(relationshipId);
    const startGeneration = generation;
    void options
      .lookup()
      .resolveEmbedded(owner, relationshipId)
      .then((state) => {
        if (startGeneration !== generation) return;
        settle(relationshipId, state);
      })
      .catch(() => {
        if (startGeneration !== generation) return;
        settle(
          relationshipId,
          Object.freeze({
            kind: 'unrenderable',
            partName: null,
            mime: 'unknown',
            reason: 'decode-failed',
          })
        );
      });
  };

  return Object.freeze({
    resolve(relationshipId: string): PictureBulletResource | null {
      const owner = numberingPartName();
      if (owner === null) return null;
      const cached = states.get(relationshipId);
      if (cached) return { ownerPartName: owner, resource: cached };
      // The projection caps how many bullets one part declares; this caps how many distinct
      // relationship ids can ever reach the decode port through this resolver.
      if (states.size >= MAX_PICTURE_BULLET_RESOURCES) return null;
      const pending = Object.freeze({
        kind: 'pending' as const,
        resourceKey: `picbullet:${owner}:${relationshipId}`,
      });
      states.set(relationshipId, pending);
      schedule(owner, relationshipId);
      return { ownerPartName: owner, resource: pending };
    },
    epoch: () => epoch,
    pendingCount: () => inFlight.size,
    reset(): void {
      generation += 1;
      // Only a layout that resolved a bullet read the epoch's resources. With none resolved,
      // a package change that resets the bundle, such as adding the first comment part, must
      // not change every paragraph's cache key.
      if (states.size > 0 || inFlight.size > 0) epoch += 1;
      ownerPartName = undefined;
      states.clear();
      inFlight.clear();
    },
  });
}
