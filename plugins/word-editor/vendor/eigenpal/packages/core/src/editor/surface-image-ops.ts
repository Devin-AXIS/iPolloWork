// Guarded image mutation commits for the paginated surface (task 13 fix round 1).
//
// Routes drawing tree ops and package image intents through the same applyOps / commit path
// as keystrokes — viewing refusal, suggesting attribution, and layout/paint refresh.

import type { TreeApplyResult, TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import type { SemanticSelection } from '@docx-editor.dev/core/layout';
import type { StoryScope } from '@docx-editor.dev/core/store';
import type { ImageDecodePort, SupportedImageMime } from '../store/package/image-resources.ts';
import type {
  InsertImageInput,
  ApplyImagePropertiesInput,
  ImageIntentResult,
} from '../store/store/tree-package-images.ts';
import type { DrawingTreeDocOp } from '../store/store/tree-op-types.ts';
import type { SurfaceEditingMode } from './paginated-surface-contract.ts';
import { resizesDiagram } from '../store/store/tree-package-diagram-frame.ts';
import { partOfNodeId } from './surface-scope.ts';

/**
 * What a host may set on a surface image insert.
 *
 * The decode port and the collaboration actor are the SURFACE's to supply. An actor a host
 * could pass would be a second identity for the same mint, which is the thing actor-scoped
 * allocation exists to prevent.
 */
export type SurfaceInsertImageInput = Omit<InsertImageInput, 'decodePort' | 'actorId'>;

const VIEWING_REFUSAL = 'the document is open for viewing';
const SUGGESTING_IMAGE_REFUSAL = 'image changes are not supported in suggesting mode';
const TRACKED_AUTHOR_REFUSAL = 'tracked changes need a non-empty author';

export function createImageOps(deps: {
  session: TreeDocxSessionView;
  applyOps: (
    ops: readonly DrawingTreeDocOp[],
    before?: { paragraphId: string; start: number; end: number } | null,
    after?: { paragraphId: string; start: number; end: number } | null
  ) => TreeApplyResult;
  commit: (
    run: () => TreeApplyResult | boolean,
    selectionAfter?: () => SemanticSelection | null
  ) => void;
  storyScope: () => StoryScope;
  outsidePromptAt?: (paragraphId: string, offset: number) => boolean;
  selectionMark: () => { paragraphId: string; start: number; end: number } | null;
  editingMode: () => SurfaceEditingMode;
  author: () => string | undefined;
  trackedDate: () => string;
  decodePort: () => ImageDecodePort;
  /**
   * The collaboration actor, or undefined when none is attached.
   *
   * Handed DOWN as a value rather than bound around the call: both image entries await a
   * decode before they mint, and `runWithTransactionActor` is ambient and synchronous, so a
   * wrap here would be unbound by the time `wp:docPr/@id` is taken.
   */
  actorId: () => string | undefined;
}): {
  applyDrawingOps: (ops: readonly DrawingTreeDocOp[]) => TreeApplyResult;
  applyImageProperties: (input: ApplyImagePropertiesInput) => ImageIntentResult;
  deleteImage: (drawingNodeId: string) => ImageIntentResult;
  insertImage: (input: SurfaceInsertImageInput) => Promise<ImageIntentResult>;
  replaceImage: (
    drawingNodeId: string,
    bytes: Uint8Array,
    mime: SupportedImageMime,
    options: {
      readonly expectedPackageRevision: number;
      readonly commitGuard?: () => boolean;
    }
  ) => Promise<ImageIntentResult>;
} {
  function refuseViewing(): TreeApplyResult {
    return {
      committed: false,
      rejected: true,
      opCount: 0,
      reason: VIEWING_REFUSAL,
    };
  }

  return {
    applyDrawingOps(ops) {
      if (deps.editingMode() === 'view') return refuseViewing();
      // Suggesting applies drawing geometry (size, position, wrap, crop, alt text) directly:
      // OOXML has no tracked form for a drawing's properties, so they are never proposals.
      const mark = deps.selectionMark();
      // Through `commit`, not `applyOps` alone: the commit tail is what publishes layout and
      // paint synchronously. Applied bare, the resize reached the screen through the
      // scheduler's timer task — after the host's `change` handlers had already read the
      // superseded geometry — so the selection overlay kept the drawing's old frame.
      let result: TreeApplyResult = { committed: false, rejected: true, opCount: 0 };
      // A diagram resize also rescales the diagram's saved drawing part, in the same unit.
      const first = ops.find((op) => 'drawingNodeId' in op);
      const part =
        first && 'drawingNodeId' in first
          ? (partOfNodeId(deps.session, first.drawingNodeId) ?? deps.session.part())
          : null;
      if (part && resizesDiagram(part, ops)) {
        deps.commit(() => {
          const outcome = deps.session.applyDrawingFrameOps(deps.storyScope(), ops);
          result = {
            committed: outcome.ok,
            rejected: !outcome.ok,
            opCount: outcome.ok ? ops.length : 0,
            ...(outcome.ok ? {} : { reason: outcome.detail ?? outcome.reason }),
          };
          return result;
        });
        return result;
      }
      deps.commit(() => {
        result = deps.applyOps(ops, mark, mark);
        return result;
      });
      return result;
    },

    applyImageProperties(input) {
      if (deps.editingMode() === 'view') {
        return { ok: false, reason: 'invalidArgs', detail: VIEWING_REFUSAL };
      }
      // Direct in suggesting too, for the same reason as `applyDrawingOps`.
      let result: ImageIntentResult = { ok: false, reason: 'invalidArgs' };
      deps.commit(() => {
        result = deps.session.applyImageProperties(deps.storyScope(), input);
        return {
          committed: result.ok,
          rejected: !result.ok,
          opCount: result.ok ? 1 : 0,
          ...(result.ok ? {} : { reason: result.detail ?? result.reason }),
        };
      });
      return result;
    },

    deleteImage(drawingNodeId) {
      if (deps.editingMode() === 'view') {
        return { ok: false, reason: 'invalidArgs', detail: VIEWING_REFUSAL };
      }
      // Suggesting PROPOSES the deletion instead of performing it: the drawing's model unit
      // goes into a `w:del` through the same tracked lane a struck word takes, so the page
      // keeps the picture (dimmed, outlined, change-barred) and the review queue offers one
      // Accept. Deleting it outright here would be a silent untracked edit in a mode whose
      // whole promise is that nothing changes without a reviewable proposal.
      const tracked = deps.editingMode() === 'suggest';
      const author = deps.author();
      if (tracked && (author === undefined || author === '')) {
        return { ok: false, reason: 'invalidArgs', detail: TRACKED_AUTHOR_REFUSAL };
      }
      let result: ImageIntentResult = { ok: false, reason: 'invalidArgs' };
      deps.commit(() => {
        result = tracked
          ? deps.session.deleteImageTracked(deps.storyScope(), drawingNodeId, {
              author: author!,
              date: deps.trackedDate(),
            })
          : deps.session.deleteImage(deps.storyScope(), drawingNodeId);
        return {
          committed: result.ok,
          rejected: !result.ok,
          opCount: result.ok ? 1 : 0,
          ...(result.ok ? {} : { reason: result.detail ?? result.reason }),
        };
      });
      return result;
    },

    insertImage(input) {
      if (deps.editingMode() === 'view') {
        return Promise.resolve({ ok: false, reason: 'invalidArgs', detail: VIEWING_REFUSAL });
      }
      // Suggesting PROPOSES the picture: the inserted run goes into a `w:ins`, so the page
      // paints it with the insertion cues and the review queue offers one Accept.
      const tracked = deps.editingMode() === 'suggest';
      const author = deps.author();
      if (tracked && (author === undefined || author === '')) {
        return Promise.resolve({
          ok: false,
          reason: 'invalidArgs',
          detail: TRACKED_AUTHOR_REFUSAL,
        });
      }
      const actorId = deps.actorId();
      return deps.session.insertImage(deps.storyScope(), {
        ...input,
        ...(deps.outsidePromptAt?.(input.paragraphId, input.offset)
          ? { bias: 'left' as const }
          : {}),
        decodePort: deps.decodePort(),
        ...(tracked ? { revision: { author: author!, date: deps.trackedDate() } } : {}),
        ...(actorId ? { actorId } : {}),
      });
    },

    replaceImage(drawingNodeId, bytes, mime, options) {
      if (deps.editingMode() === 'view') {
        return Promise.resolve({ ok: false, reason: 'invalidArgs', detail: VIEWING_REFUSAL });
      }
      if (deps.editingMode() === 'suggest') {
        return Promise.resolve({
          ok: false,
          reason: 'invalidArgs',
          detail: SUGGESTING_IMAGE_REFUSAL,
        });
      }
      const actorId = deps.actorId();
      return deps.session.replaceImage(
        deps.storyScope(),
        drawingNodeId,
        bytes,
        mime,
        deps.decodePort(),
        {
          ...options,
          commitGuard: () => deps.editingMode() === 'edit' && options.commitGuard?.() !== false,
          ...(actorId ? { actorId } : {}),
        }
      );
    },
  };
}
