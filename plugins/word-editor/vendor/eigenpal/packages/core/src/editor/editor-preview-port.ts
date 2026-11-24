// The automation port a preview fork writes through.
//
// The headless store port over the fork's scratch store, with every decision the planner or the
// commit asks of a port taken from the LIVE editor, so a batch means the same thing in the fork
// and when the commit replays it:
//
// - Suggesting mode. The live surface attributes an untracked document write to the editor's
//   author and lands a replacement after the struck words; the fork does the same with the same
//   pure functions, against its own tree. A runtime's own `TrackMineOnly` ops already carry
//   their revision and pass through unchanged, as they do in the live surface.
// - Collaboration. Writes run under the live session's actor, so a comment or revision id the
//   fork mints is the id the commit mints, and the planner hears the same `collaborative` flag.
// - Refusals. The live surface's mode rules (protection, a generated table of contents, viewing)
//   are asked of the live surface itself, the collaboration gate of the live session, and a
//   comment outside the body or a write without the review module refuses as it does live.
//   What the live editor would refuse never shows in a preview that could not commit.

import type { AutomationDocumentPort, AutomationStagedOps } from '../automation/document-port.ts';
import { packageStorePort } from '../automation/server-host.ts';
import { DEFAULT_REVISION_MARKUP } from '../contracts/revision-markup.ts';
import { layoutProjectionOf } from '../layout/revision-projection.ts';
import { runWithTransactionActor } from '../store/package/actor-scoped-ids.ts';
import { findNode } from '../store/package/ooxml-edit.ts';
import type { TreePackageStore } from '../store/store/tree-package-store.ts';
import type { TreeDocOp } from '../store/store/tree-ops.ts';
import type { PaginatedSurface, ScaleMutableSurface } from './paginated-surface-contract.ts';
import type { OoxmlParagraphNode } from '../store/package/ooxml-tree.ts';
import type { PaginatedSurfaceRuntimeOptions } from './surface-runtime-options.ts';
import {
  attributeTrackedOps,
  isTrackedEdit,
  trackedReplacementLanding,
} from './surface-tracked-ops.ts';
import { revisionDateNow } from '../automation/revision-date.ts';

const REVIEW_REQUIRED = 'review-module-required';
const UNSUPPORTED = 'preview-operation-unsupported';

/**
 * The fork's port. `display` is read per write, so a markup setting the reader changes while
 * the callback runs applies, as it would to the live editor.
 *
 * @internal
 */
export function previewForkPort(
  store: TreePackageStore,
  surface: PaginatedSurface,
  display: () => PaginatedSurfaceRuntimeOptions
): AutomationDocumentPort {
  const base = packageStorePort(store);
  const live = surface as ScaleMutableSurface;
  const collaboration = surface.collaborationSession();
  const actor = collaboration?.identity.actorId;
  const review = () => display().reviewModel !== undefined;
  /** The author suggesting mode attributes to, or undefined when writes land untracked. */
  const suggestingAuthor = (): string | undefined => {
    const writer = surface.author()?.trim();
    return surface.editingMode() === 'suggest' && writer ? writer : undefined;
  };
  const formattingTracked = (): boolean =>
    (display().revisionMarkup ?? DEFAULT_REVISION_MARKUP).trackFormatting &&
    !surface.session.trackingSettings().doNotTrackFormatting;
  const attributed = (ops: readonly TreeDocOp[]): readonly TreeDocOp[] => {
    const author = suggestingAuthor();
    if (author === undefined) return ops;
    return attributeTrackedOps(ops, { author, date: revisionDateNow() }, formattingTracked());
  };
  return {
    ...base,
    collaborative: () => !!collaboration,
    trackedRangeReplacement: () => !collaboration,
    suggesting: () => surface.editingMode() === 'suggest',
    revisionDisplayMode: () => layoutProjectionOf(surface.revisionDisplayMode()),
    replacementLanding(paragraphId, start, end) {
      const author = suggestingAuthor();
      if (author === undefined) return null;
      if (end <= start) return start;
      const paragraph = paragraphInFork(store, paragraphId);
      if (!paragraph) return start;
      return trackedReplacementLanding(paragraph, start, end, author, revisionDateNow());
    },
    apply(staged: AutomationStagedOps, scope, packageEdits = [], requiresReview = false) {
      // The live surface's order: its mode rules, the review module, then attribution and the
      // collaboration gate on the ops as they will be written.
      let refusal = live.automationWriteRefusal([], false);
      if (refusal !== null) return { ok: false, reason: refusal };
      if (requiresReview && !review()) return { ok: false, reason: REVIEW_REQUIRED };
      const result = runWithTransactionActor(actor, () =>
        base.apply(
          (relate) => {
            const ops = staged(relate);
            if (ops === null) return null;
            refusal = live.automationWriteRefusal(ops, packageEdits.length > 0);
            if (refusal !== null) return null;
            const written = attributed(ops);
            if (written.some(isTrackedEdit) && !review()) refusal = REVIEW_REQUIRED;
            else refusal = collaboration?.gateOperations(written, scope) ?? null;
            return refusal === null ? written : null;
          },
          scope,
          packageEdits
        )
      );
      return refusal !== null ? { ok: false, reason: refusal } : result;
    },
    applyCommentWrites(writes, scope) {
      const refusal = live.automationWriteRefusal([], false);
      if (refusal !== null) return { ok: false, reason: refusal };
      // The live editor's comment lane is the body's: a comment anywhere else refuses there.
      if (scope.kind !== 'body') return { ok: false, reason: 'unsupported-story' };
      if (!review()) return { ok: false, reason: REVIEW_REQUIRED };
      const gated = collaboration?.gateOperations([], scope);
      if (gated) return { ok: false, reason: gated };
      return runWithTransactionActor(actor, () => base.applyCommentWrites(writes, scope));
    },
    applyCustomNodeWrite: () => ({ ok: false, reason: UNSUPPORTED }),
    applyLifecycle: () => ({ ok: false, reason: UNSUPPORTED }),
  };
}

/** A paragraph of the fork by id, in the body first and then in any other story part. */
function paragraphInFork(store: TreePackageStore, paragraphId: string): OoxmlParagraphNode | null {
  const pkg = store.currentPackage();
  const main = pkg.parts.get(pkg.mainDocumentPart);
  const parts = main ? [main, ...pkg.parts.values()] : [...pkg.parts.values()];
  for (const part of parts) {
    if (!part.root) continue;
    const node = findNode(part, paragraphId);
    if (node?.kind === 'paragraph') return node;
  }
  return null;
}
