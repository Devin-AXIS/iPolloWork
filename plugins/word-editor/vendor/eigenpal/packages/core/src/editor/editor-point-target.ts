import { partOfNodeId } from './surface-scope.ts';
import type { EditorPointPosition } from '../contracts/editor-drop.ts';
import type { Editor, ExecResult } from '../contracts/editor.ts';
import type { SemanticPosition } from '../layout/semantic-interaction.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';

interface PointIdentity {
  readonly surface: PaginatedSurface;
  readonly revision: number;
  readonly scope: string;
  readonly mode: string;
  readonly mount: number;
}

const mounts = new WeakMap<PaginatedSurface, number>();

/** Mounted geometry cannot remain an asynchronous target after a move or detach. */
export function invalidatePointTargets(surface: PaginatedSurface): void {
  mounts.set(surface, (mounts.get(surface) ?? 0) + 1);
}

const identities = new WeakMap<EditorPointPosition, PointIdentity>();

/** Geometry and selection helpers for the mounted browser host. */
export function createEditorPointMembers(
  readSurface: () => PaginatedSurface | null,
  mounted: () => boolean
): Pick<Editor, 'relayout' | 'positionAtPoint' | 'retainSelection' | 'releaseSelection'> {
  return {
    relayout(options) {
      // Reading layout flushes pending commits and publishes through the surface scheduler.
      void options?.sync;
      readSurface()?.layout();
    },
    positionAtPoint(x, y) {
      const surface = readSurface();
      if (!mounted() || !surface) return null;
      const point = surface.pointAt(x, y);
      return point ? capturePointPosition(surface, point.hit.position) : null;
    },
    retainSelection: () => (mounted() ? (readSurface()?.retainSelection() ?? null) : null),
    releaseSelection: (pin) => readSurface()?.releaseSelection(pin),
  };
}

/** Capture the source identity before a host reads a dropped file asynchronously. */
export function capturePointPosition(
  surface: PaginatedSurface,
  position: SemanticPosition
): EditorPointPosition {
  const target = Object.freeze({
    part: (partOfNodeId(surface.session, position.paragraphId) ?? surface.session.part()).name,
    paragraphId: position.paragraphId,
    offset: position.offset,
  });
  identities.set(target, {
    surface,
    revision: surface.session.packageRevision(),
    scope: JSON.stringify(surface.activeScope()),
    mode: surface.editingMode(),
    mount: mounts.get(surface) ?? 0,
  });
  return target;
}

/** The captured target remains valid only in its original document revision and story. */
export function pointTargetRefusal(
  surface: PaginatedSurface,
  position: EditorPointPosition
): Exclude<ExecResult, { ok: true }> | null {
  const identity = identities.get(position);
  if (
    !identity ||
    identity.surface !== surface ||
    identity.mount !== (mounts.get(surface) ?? 0) ||
    identity.revision !== surface.session.packageRevision()
  ) {
    return {
      ok: false,
      code: 'notFound',
      reason: 'the drop target is stale; drop the image again',
    };
  }
  if (
    identity.scope !== JSON.stringify(surface.activeScope()) ||
    identity.mode !== surface.editingMode()
  ) {
    return { ok: false, code: 'notFound', reason: 'the drop target story is no longer active' };
  }
  return null;
}
