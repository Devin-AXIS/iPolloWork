import { layoutProjectionOf } from '../layout/revision-projection.ts';
import { caretAt } from '@docx-editor.dev/core/layout';
import {
  paginationSnapshotOf,
  paginationContextFor,
  type AutomationPaginationSnapshot,
} from '../automation/pagination.ts';
import { documentReads } from '../automation/reads.ts';
import { completeProgressiveOpen } from './surface-progressive-open.ts';
// Automation over an editor that is already open.
//
// This is an ADAPTER, not a second host: it builds the neutral lane's port over the live
// session and hands it to the same composition factory the headless host uses. Every
// operation, every validation and every read is the neutral lane's, so a document operation
// cannot mean one thing here and another on a server.
//
// Three things it deliberately does not do:
//
// - It owns no document. Authority is the session's canonical package, reached per call, and
//   never the painted DOM. Writes go through `applyTreeOps`, which is one
//   `TreePackageStore.transact` — the same path a keystroke takes — so the surface repaints
//   from the commit like any other, and undo sees one unit per batch.
// - It does not widen the adapter contract. It takes the core editor instance a host already
//   has; the seven-member React/Vue `DocxEditorRef` is untouched.
// - It does not own the editor's lifetime. `dispose()` releases this host's subscription and
//   nothing else: the editor it borrowed keeps working.
//
// Detach and destroy are ordinary states here rather than errors. A detached editor has no
// session, so operations answer `document-unavailable` — the host may well answer again after
// the next `attach`.

import type { AutomationCapabilities, AutomationHost } from '../automation/index.ts';
import { DEFAULT_FORMATTING_DISPLAY_MODE } from '../store/store/formattable-runs.ts';
import type {
  AutomationCommentWrite,
  AutomationCommentWriteResult,
  AutomationDocumentPort,
  AutomationPortApplyResult,
  AutomationStagedOps,
} from '../automation/document-port.ts';
import type { ReviewWriteIntent } from './paginated-surface-contract.ts';
import { automationParagraphNodeId, createAutomationHost } from '../automation/host.ts';
import type { HighlightRange } from '../contracts/editor-highlights.ts';
import { replaceDocumentError } from '../automation/plan-replace-document.ts';
import { runAsAutomation } from './editor-diagnostics.ts';
import { publicRefusal } from './diagnostic-codes.ts';
import type { OoxmlPackage } from '../store/package/ooxml-package.ts';
import type { TreeDocOp } from '../store/store/tree-ops.ts';
import type { StoryScope } from '../store/store/tree-package-store.ts';
import type { TreeDocxSessionView } from '../binding/tree-session.ts';
import type { DocxEditorInstance } from './docx-editor-types.ts';
import type {
  AutomationBatchRequest,
  AutomationBatchResponse,
  AutomationSpan,
} from '../automation/index.ts';
import type { HistoryGroup } from '../contracts/editor.ts';
import {
  editorAutomationFrames,
  editorOwnsOpenHistoryGroup,
} from './editor-history-group-registry.ts';
import type { AutomationHistoryFrames } from './editor-history-groups.ts';
import { editorCompareEngine } from './editor-compare-engine-registry.ts';
import { editorPreviewActive, PREVIEW_WRITE_REFUSAL } from './editor-preview.ts';

/**
 * One automation run inside a history group: every batch it executes is a frame of the
 * group, and the run settles once into one outcome on the handle.
 *
 * @internal
 */
export interface HistoryGroupRun {
  /** Execute one batch; `null`, executing nothing, once the group is no longer open. */
  execute(request: AutomationBatchRequest): AutomationBatchResponse | null;
  /** Settle the run's outcome on the handle. Safe to call more than once. */
  finish(): void;
}

/**
 * An automation host over a live editor.
 *
 * @public
 */
export interface BrowserAutomationHost extends AutomationHost {
  /**
   * Begin one run inside `group`, or `null` when `group` is not an open handle from this
   * editor. Used by the browser runtime's `run({ historyToken }, callback)`.
   *
   * @internal
   */
  beginHistoryGroupRun(group: HistoryGroup): HistoryGroupRun | null;
  /**
   * The editor highlight range for a span this host answered, or `null` when the span is empty,
   * crosses a paragraph boundary, or names a paragraph this host did not mint. The browser
   * runtime paints proofing annotations through it.
   *
   * @internal
   */
  highlightRangeOf(span: AutomationSpan): HighlightRange | null;
}

/**
 * What a browser host can do.
 *
 * `selection`, `scrolling` and `layout` are true because a mounted editor genuinely has a
 * caret, a scroll container and paginated layout — a consumer may branch on them. The
 * DOCUMENT operations behave identically to the headless host regardless; the extra
 * capabilities widen what may be asked later, never what an existing operation means.
 */
export const BROWSER_AUTOMATION_CAPABILITIES: AutomationCapabilities = Object.freeze({
  document: true,
  save: true,
  events: true,
  selection: true,
  scrolling: true,
  layout: true,
});

/**
 * Which review write a comment batch amounts to, decided BEFORE the commit.
 *
 * The callback below branches on the batch, so the gate cannot read the kind off it. `undefined`
 * for a batch this lane refuses anyway (empty, or mixed kinds) — a caller that cannot be named is
 * one a replica must not admit, and the branch inside reports the specific reason.
 */
function automationCommentIntent(
  writes: readonly AutomationCommentWrite[]
): ReviewWriteIntent | undefined {
  if (writes.length === 0) return undefined;
  if (writes.every((write) => write.kind === 'delete')) return 'comment-delete';
  if (writes.every((write) => write.kind === 'edit')) return 'comment-edit';
  if (writes.length !== 1) return undefined;
  const write = writes[0]!;
  if (write.kind === 'resolve') return 'comment-resolve';
  if (write.kind === 'create') return 'comment-add';
  if (write.kind === 'reply') return 'comment-reply';
  return undefined;
}

/**
 * An automation host over a live editor.
 *
 * The editor keeps its own lifetime: `dispose()` on the returned host releases the change
 * subscription this adapter took and leaves the editor mounted and editable.
 *
 * `save()` validates pending form input. Invalid values and saves during an active edit
 * return `transaction-refused`. For autosaving from change callbacks, use the asynchronous
 * `editor.save()`, which waits for the active edit to finish.
 */
export function createBrowserAutomationHost(editor: DocxEditorInstance): BrowserAutomationHost {
  // The history frames of the batch in flight, while `executeInHistoryGroup` runs one.
  let bound: AutomationHistoryFrames | undefined;
  const host = createAutomationHost({
    port: sessionPort(editor, () => bound),
    capabilities: BROWSER_AUTOMATION_CAPABILITIES,
  });
  let disposed = false;
  const execute = (request: AutomationBatchRequest): AutomationBatchResponse => {
    // COALESCED TYPING FIRST, ONCE, at the batch's own entry.
    //
    // A keystroke still in the buffer lands as its own transaction the moment anything asks
    // the surface for state, so a batch that read a revision or a package ahead of it
    // planned against a document it no longer writes to — and `expectedRevision` waved
    // through exactly the move it exists to catch. Settling HERE rather than inside those
    // reads keeps the commit off the change-notification path: `revision()` is called from
    // the host's own `on('change')` subscriber, and flushing there would commit typing from
    // inside a render.
    // Nothing to settle for a batch that will be refused anyway: a disposed host must not
    // commit the editor's buffered keystrokes on its way to saying it is disposed.
    if (!disposed) editor.surface?.flushPendingInput();
    // Typing flushed above is the user's; refusals inside the batch are the batch's.
    return runAsAutomation(editor, () => host.execute(request));
  };
  return {
    ...host,
    save: () => {
      try {
        return host.save();
      } catch (error) {
        return {
          ok: false,
          error: {
            code: 'transaction-refused',
            message: error instanceof Error ? error.message : 'Cannot save the document.',
          },
        };
      }
    },
    dispose: () => {
      disposed = true;
      host.dispose();
    },
    execute,
    highlightRangeOf: (span) => {
      const blockId = automationParagraphNodeId(host, span.start.paragraph);
      if (blockId === null || automationParagraphNodeId(host, span.end.paragraph) !== blockId)
        return null;
      const length = span.end.offset - span.start.offset;
      return length > 0 ? { blockId, start: span.start.offset, length } : null;
    },
    beginHistoryGroupRun: (group) => {
      const frames = disposed ? null : editorAutomationFrames(editor, group);
      if (frames === null) return null;
      let finished = false;
      return {
        execute: (request) => {
          if (finished || disposed || !editorOwnsOpenHistoryGroup(editor, group)) return null;
          const outer = bound;
          bound = frames;
          try {
            return execute(request);
          } finally {
            bound = outer;
          }
        },
        finish: () => {
          if (finished) return;
          finished = true;
          frames.finish();
        },
      };
    },
  };
}

function sessionPort(
  editor: DocxEditorInstance,
  bound: () => AutomationHistoryFrames | undefined
): AutomationDocumentPort {
  /**
   * Run one surface commit as a frame of the bound history group, if any. Bound per commit,
   * because the surface's first commit takes the group: a batch that applies ops and then
   * writes a comment makes two commits, and both belong to the group.
   */
  const grouped = <T>(surface: object, commit: () => T): T => {
    const frames = bound();
    return frames === undefined ? commit() : frames.bind(surface, commit);
  };
  /**
   * Revision, made monotonic across remounts.
   *
   * A remount is a fresh session whose own revision restarts at zero (documented: the undo
   * stack and caret do not survive re-attach). Reporting that raw would let an
   * `expectedRevision` captured before a detach be satisfied by coincidence afterwards, on a
   * document that had been saved and reopened in between. So a session change carries the
   * previous count forward. An editor that never remounts reports the session's own revision
   * unchanged, which is what keeps this comparable with a headless host.
   */
  let base = 0;
  let seen = 0;
  let session: TreeDocxSessionView | null = null;
  let started = false;
  let released = false;

  const sync = (): TreeDocxSessionView | null => {
    // Released: report nothing and, crucially, move nothing. A disposed host that kept
    // re-adopting the editor's session would keep advancing the revision it no longer reads.
    if (released) return null;
    const live = editor.surface?.session ?? null;
    if (live !== session) {
      if (started) base += seen + 1;
      started = true;
      session = live;
      seen = 0;
    }
    if (live) seen = live.packageRevision();
    return live;
  };

  let fieldPagination: AutomationPaginationSnapshot | undefined;
  let fieldPaginationPackage: OoxmlPackage | null = null;
  return {
    localChangeTracking: true,
    suggesting: () => editor.surface?.editingMode() === 'suggest',
    async prepare(request) {
      if (!request.operations.some((operation) => operation.op === 'updateFieldResult')) return;
      fieldPagination = undefined;
      fieldPaginationPackage = null;
      const surface = editor.surface;
      if (!surface) return;
      // Page fields read the whole pagination, which a large open may still be laying out.
      completeProgressiveOpen(surface);
      const layout = surface.layout();
      fieldPagination = paginationSnapshotOf(layout);
      fieldPaginationPackage = sync()?.currentPackage() ?? null;
    },
    fieldPageContext(story, paragraphId, fieldNodeId) {
      const current = sync()?.currentPackage() ?? null;
      if (!current || current !== fieldPaginationPackage) return null;
      const reads = documentReads(current).story(story);
      return reads
        ? paginationContextFor(fieldPagination, reads.part, paragraphId, fieldNodeId)
        : null;
    },
    revision() {
      sync();
      return base + seen;
    },
    currentPackage: (): OoxmlPackage | null => sync()?.currentPackage() ?? null,
    // THE READER'S VIEW, so the object model's formatting reaches the runs the toolbar does.
    // Per call rather than captured: the editor remounts, and a detached editor has no
    // surface to ask — the lane then falls back to the resolved result, which is what a
    // caller with no view means.
    revisionDisplayMode: () =>
      editor.surface
        ? layoutProjectionOf(editor.surface.revisionDisplayMode())
        : DEFAULT_FORMATTING_DISPLAY_MODE,
    collaborative: () => !!editor.surface?.collaborationSession(),
    ...compareEnginePort(editor),
    setupOutsideUndo: () => true,
    allocationActor: () => editor.surface?.collaborationSession()?.identity.actorId,
    trackedRangeReplacement: () => !editor.surface?.collaborationSession(),
    replacementLanding: (paragraphId, start, end) =>
      editor.surface?.replacementLanding(paragraphId, start, end) ?? null,
    apply(
      staged: AutomationStagedOps,
      scope: StoryScope,
      packageEdits = [],
      requiresReview = false
    ): AutomationPortApplyResult {
      sync();
      // A preview over the editor refuses every write until it is committed or discarded.
      if (editorPreviewActive(editor)) return { ok: false, reason: PREVIEW_WRITE_REFUSAL };
      const surface = editor.surface;
      if (!surface) return { ok: false, reason: 'no-document' };
      // THROUGH THE SURFACE, NOT THE SESSION. `applyAutomationOps` is one gated transaction:
      // viewing refuses, suggesting proposes and attributes, the story the batch named is
      // addressed explicitly, and the pages repaint from the commit. Reaching
      // `session.applyTreeOps` from here — the
      // first version of this adapter — wrote into a document open for viewing and turned a
      // proposal into a permanent edit. A refusal anywhere leaves the session, its history and
      // the painted pages untouched, which is what makes the batch atomic.
      //
      // The ops are STAGED, so the relationship an external hyperlink needs is minted inside that
      // gate — see `applyAutomationOps`. Minting it out here would put a target in the `.rels` of a
      // document the very next line refuses to write to.
      const result = grouped(surface, () =>
        surface.applyAutomationOps(staged, scope, packageEdits, requiresReview)
      );
      if (result.rejected) return { ok: false, reason: publicRefusal(result.reason) };
      return { ok: true, changed: result.committed };
    },
    applyLifecycle(op: TreeDocOp): AutomationPortApplyResult {
      sync();
      if (editorPreviewActive(editor)) return { ok: false, reason: PREVIEW_WRITE_REFUSAL };
      const surface = editor.surface;
      if (!surface) return { ok: false, reason: 'no-document' };
      // THE SAME SURFACE PATH. `applyTreeOps` routes a solitary lifecycle op to the package
      // store's own transaction, so this goes through the mode gates and the repaint like every
      // other write rather than reaching around them.
      const result = grouped(surface, () => surface.applyAutomationOps(() => [op]));
      if (result.rejected) return { ok: false, reason: publicRefusal(result.reason) };
      return { ok: true, changed: result.committed };
    },
    applyCommentWrites(writes, scope): AutomationCommentWriteResult {
      const surface = editor.surface;
      const session = sync();
      if (!surface || !session) return { ok: false, reason: 'no-document' };
      if (editorPreviewActive(editor)) return { ok: false, reason: PREVIEW_WRITE_REFUSAL };
      if (writes.length === 0) return { ok: true, changed: false };
      // THE BODY'S COMMENTS, for as long as the session's comment lane is the body store's: the
      // scope is carried so this refuses a story it cannot write rather than silently commenting
      // on the wrong one.
      if (scope.kind !== 'body') return { ok: false, reason: 'unsupported-story' };
      const review = editor.can({ type: 'toggleReviewPane' });
      // A sentence the editor refused in (a refresh, viewing) becomes its public code.
      if (!review.ok)
        return { ok: false, reason: publicRefusal(review.reason ?? 'review-module-required') };
      // Judged before the surface gates, so a mixed batch is named as one on every host.
      if (
        writes.length !== 1 &&
        !writes.every((write) => write.kind === 'delete') &&
        !writes.every((write) => write.kind === 'edit')
      )
        return { ok: false, reason: 'mixed-comment-writes' };
      let outcome: AutomationCommentWriteResult | null = null;
      // `commitReviewOps` is the gate a comment goes through in the editor: viewing refuses, and
      // the pages and the rail repaint from the commit. Reaching past it would let a script
      // comment on a document open for reading.
      const refused = grouped(surface, () =>
        surface.commitReviewOps((historyToken) => {
          if (writes.every((write) => write.kind === 'delete')) {
            const deletion = writes.find((write) => write.kind === 'delete');
            const done = session.deleteComments(
              writes.map((write) => {
                if (write.kind !== 'delete') throw new Error('unreachable mixed comment write');
                return {
                  commentId: write.commentId,
                  ...(write.parentCommentId === undefined
                    ? {}
                    : { parentCommentId: write.parentCommentId }),
                };
              }),
              scope,
              deletion?.kind === 'delete' ? deletion.noteId : undefined,
              { historyToken }
            );
            outcome = done ? { ok: true, changed: true } : { ok: false, reason: 'unknown-comment' };
            return { committed: done };
          }
          if (writes.every((write) => write.kind === 'edit')) {
            const before = session.packageRevision();
            const done = session.setCommentTexts(
              writes.map((write) => ({ commentId: write.commentId, text: write.text })),
              { historyToken }
            );
            const changed = done && session.packageRevision() !== before;
            outcome = done
              ? { ok: true, changed }
              : { ok: false, reason: 'unsupported-comment-body' };
            return { committed: changed };
          }
          if (writes.length !== 1) {
            outcome = { ok: false, reason: 'mixed-comment-writes' };
            return { committed: false };
          }
          const write = writes[0]!;
          if (write.kind === 'resolve') {
            const done = session.setCommentResolved(write.commentId, write.resolved, {
              historyToken,
            });
            outcome = done ? { ok: true, changed: true } : { ok: false, reason: 'unknown-comment' };
            return { committed: done };
          }
          if (write.kind !== 'create' && write.kind !== 'reply') {
            outcome = { ok: false, reason: 'unsupported-comment-write' };
            return { committed: false };
          }
          const created = session.replyToComment(
            write.kind === 'reply' ? write.parentCommentId : null,
            write.anchor,
            write.text,
            write.author,
            write.date,
            undefined,
            undefined,
            { historyToken }
          );
          outcome =
            created === null
              ? { ok: false, reason: 'refused' }
              : { ok: true, changed: true, commentId: created };
          return { committed: created !== null };
        }, automationCommentIntent(writes))
      );
      // Null only when a gate or the refresh guard stopped the write before `run`.
      return outcome ?? { ok: false, reason: publicRefusal(refused ?? 'refused') };
    },
    applyCustomNodeWrite(write, scope): AutomationPortApplyResult {
      const surface = editor.surface;
      const live = sync();
      if (!surface || !live) return { ok: false, reason: 'no-document' };
      if (editorPreviewActive(editor)) return { ok: false, reason: PREVIEW_WRITE_REFUSAL };
      // THE BODY's store, for as long as the session's payload lane is the body store's: the
      // scope is carried so this refuses a story it cannot write rather than quietly authoring
      // the node somewhere else.
      if (scope.kind !== 'body') return { ok: false, reason: 'unsupported-story' };
      let outcome: AutomationPortApplyResult | null = null;
      // Through `commitReviewOps`, the gate a package-scoped write goes through in the editor:
      // viewing refuses, and the pages repaint from the commit. Reaching past it would let a
      // script author a chip in a document open for reading.
      const refused = grouped(surface, () =>
        surface.commitReviewOps((historyToken) => {
          const result = live.insertCustomNode(write, undefined, { historyToken });
          outcome = result.ok
            ? { ok: true, changed: result.change !== null }
            : {
                ok: false,
                reason: result.detail ? `${result.reason}: ${result.detail}` : result.reason,
              };
          return { committed: result.ok };
        }, 'package-scoped')
      );
      // Null only when a gate or the refresh guard stopped the write before `run`.
      return outcome ?? { ok: false, reason: publicRefusal(refused ?? 'refused') };
    },
    // THROUGH THE EDITOR COMMAND, so a script's replacement passes the same gates and makes
    // the same single undo step as `exec({ type: 'replaceDocument' })`.
    replaceDocument(docx) {
      sync();
      const refused = (code: string, message: string) => ({
        ok: false as const,
        error: replaceDocumentError({ code, message }),
      });
      if (editorPreviewActive(editor))
        return {
          ok: false,
          error: {
            code: 'transaction-refused',
            message: PREVIEW_WRITE_REFUSAL,
            detail: 'edit.preview-active',
          },
        };
      // A replacement is always its own undo step, so it cannot join a history group.
      if (bound() !== undefined)
        return {
          ok: false,
          error: {
            code: 'unsupported-capability',
            message: 'a document replacement cannot join a history group',
            detail: 'edit.operation-unsupported',
          },
        };
      const result = editor.exec({ type: 'replaceDocument', docx });
      const outcome = result.replaceDocument;
      if (outcome?.ok) return { ok: true, changed: outcome.changed };
      if (outcome) return { ok: false, error: replaceDocumentError(outcome) };
      return refused('unavailable', result.ok ? 'no outcome' : result.reason);
    },
    save: () => (sync() ? (editor.surface?.save() ?? null) : null),
    // The one genuinely browser-only operation, and the reason the port declares it optional:
    // a headless host has no caret. Positions arrive as canonical paragraph ids and model
    // offsets — the same vocabulary `SemanticSelection` already uses — so nothing is translated
    // and there is no second coordinate space that could drift. Collapsing to one end is done
    // by pointing both ends at it, which is what a caret IS to the surface.
    //
    // THROUGH THE EDITOR COMMAND, not `surface.setSelection` directly. The public Office-shaped
    // contract says selecting also navigates the reader to the range, and `setSelection` is the
    // canonical focus-independent path that installs the logical selection and reveals its head
    // from layout geometry. That keeps virtualized pages viable: the target usually has no DOM
    // node to measure yet, and the reveal materializes it on the way.
    selectRefusal(story, paragraphId) {
      if (story.kind === 'body') return null;
      const surface = editor.surface;
      if (surface?.editingMode() === 'view')
        return 'a read-only editor does not open a header, footer or note to select in it';
      // A header, footer or note opens where it is laid out; one no page shows cannot be.
      if (surface && !caretAt(surface.layout(), { paragraphId, offset: 0 }))
        return 'that header, footer or note is not shown on any page';
      return null;
    },
    select(range, mode) {
      const surface = editor.surface;
      if (!surface) return false;
      const anchor = mode === 'end' ? range.end : range.start;
      const head = mode === 'start' ? range.start : range.end;
      return editor.exec({
        type: 'setSelection',
        range: {
          anchor: { paragraphId: anchor.paragraphId, offset: anchor.offset },
          head: { paragraphId: head.paragraphId, offset: head.offset },
        },
      }).ok;
    },
    // The EDITOR's change event, not the session's: the facade re-subscribes to each new
    // session across a remount, so a subscription taken here survives one.
    subscribe: (listener) => editor.on('change', () => listener()),
    dispose() {
      released = true;
      session = null;
    },
  };
}

/** The review module compare engine as a port member, or nothing without the module. */
function compareEnginePort(editor: object): Pick<AutomationDocumentPort, 'compareDocuments'> {
  const engine = editorCompareEngine(editor);
  return engine ? { compareDocuments: engine } : {};
}
