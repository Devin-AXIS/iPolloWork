/**
 * The facade's anonymous diagnostics: builds each {@link EditorDiagnostic} from codes and
 * buckets, and delivers it to module listeners and `editor.on('diagnostic')`.
 *
 * Privacy is decided here, where the event is made. Nothing below reads document text, part
 * names, relationship targets, author names or font names: a raw reason goes through
 * `diagnostic-codes.ts` and only the public code comes out.
 */
import type {
  ByteSizeBucket,
  CollaborationDiagnosticCode,
  DocumentSaveDiagnosticCode,
  DocumentShape,
  EditDiagnosticCode,
  EditorDiagnostic,
  HistoryDiagnosticCode,
} from '../contracts/diagnostics.ts';
import type { HistoryDiagnostic } from '../contracts/editor-scope.ts';
import type { CustomNodeDiagnosticReporter } from './custom-node-wiring.ts';
import type { PaginatedSurface } from './paginated-surface.ts';
import { totalPages } from './docx-editor-derive.ts';
import type { EditorCommand, EditorError, EditorFontError } from '../contracts/editor.ts';
import type { DocxEditorInstance } from './docx-editor.ts';
import type { EditorModuleRegistry } from '../contracts/modules.ts';
import type { ExecResult } from '../contracts/types.ts';
import type { CollaborationStatus, EditorCollaborationSession } from '../collaboration/index.ts';
import {
  byteSizeBucket,
  countBucket,
  createDiagnosticEmitter,
  type DiagnosticEmitter,
} from '@docx-editor.dev/core/automation';
import { HarfBuzzShapingError } from '@docx-editor.dev/core/layout';
import {
  diagnosticCause,
  diagnosticErrorName,
  documentPartKind,
  exceptionCause,
  formattingChangeKind,
  reviewChangeKind,
} from '../automation/diagnostic-context.ts';
import type {
  FailureStage,
  ReviewDiagnosticCode,
  ReviewOperation,
} from '../automation/diagnostic-vocabulary.ts';
import type { ReviewRevisionItem } from '../store/store/index.ts';
import { READ_ONLY_REVISION_REASON } from './opening-editing-mode.ts';

/** The skip reason a refusal leads with, or `unsupported-revision` when it names none. */
function leadingReviewReason(reason: string): string {
  const token = reason.split(':', 1)[0]!;
  return reviewDiagnosticCode(token) ? token : 'unsupported-revision';
}

/** A skipped change as the store reports it: the reason, the change, and the engine condition. */
interface SkippedChange {
  readonly reason: string;
  readonly revision?: {
    readonly revisionKind: string;
    readonly partName: string;
    readonly formattingKind?: string;
  };
  readonly detail?: string;
}
import {
  diagnosticCodeOfRefusal,
  fontDiagnosticCode,
  openDiagnosticCode,
  reviewCodeOfSkip,
  reviewDiagnosticCode,
} from './diagnostic-codes.ts';
import { warnFontFailureOnce } from './font-configuration.ts';
import { createPerformanceSampler, type PerformanceClock } from './editor-performance.ts';
import { createSessionTracker, type SessionClock } from './editor-session.ts';
import { onPageClose } from './page-close.ts';
import { setCommandReporter } from './command-reporting.ts';
import { classifyCommand, unknownCommandReason } from './docx-editor-support.ts';

/** Commands the facade answers itself, before the command classifier sees them. */
const FACADE_COMMANDS: ReadonlySet<string> = new Set<EditorCommand['type']>([
  'acceptAllRevisions',
  'acceptRevision',
  'addComment',
  'insertImage',
  'openBookmarkDialog',
  'openGoTo',
  'openRevisionMarkupDialog',
  'openCompareDocumentsDialog',
  'compareDocuments',
  'proposeDeletion',
  'proposeInsertion',
  'proposeReplacement',
  'rejectAllRevisions',
  'rejectRevision',
  'replaceDocument',
  'replaceImage',
  'replyComment',
  'resolveComment',
  'setEditingMode',
  'setReviewDisplayMode',
  'toggleDocumentProtection',
  'toggleParagraphMarks',
  'toggleReviewPane',
]);

/**
 * The command type, when it is one of the editor's own. `EditorCommands` is open to declaration
 * merging, so a host's own command type could be any word; only built-in names are reported.
 */
function builtInCommand(command: EditorCommand): EditorCommand['type'] | undefined {
  if (FACADE_COMMANDS.has(command.type)) return command.type;
  // The classifier has a case for every built-in command, including one it refuses for bad
  // arguments; only a type it has never heard of reaches its default branch.
  try {
    const support = classifyCommand(command);
    return support.supported || support.reason !== unknownCommandReason(command.type)
      ? command.type
      : undefined;
  } catch {
    return undefined;
  }
}

/** Whether a review command accepts or rejects. Other commands report no operation. */
function reviewOperationOf(command: EditorCommand): ReviewOperation | undefined {
  const type: string = command.type;
  if (type === 'acceptRevision' || type === 'acceptAllRevisions') return 'accept';
  if (type === 'rejectRevision' || type === 'rejectAllRevisions') return 'reject';
  const action = (command as { action?: unknown }).action;
  return action === 'accept' || action === 'reject' ? action : undefined;
}

/** Each editor's automation scope: input refusals inside it belong to an automation batch. */
const AUTOMATION_SCOPES = new WeakMap<object, <T>(run: () => T) => T>();

/**
 * Run an editing API batch on this editor. Refusals the surface raises inside it are the
 * batch's, which its runtime reports with `origin: 'automation'`, so they are not also input.
 */
export function runAsAutomation<T>(editor: object, run: () => T): T {
  const scope = AUTOMATION_SCOPES.get(editor);
  return scope ? scope(run) : run();
}

/** Each editor's automation reporter, for a runtime that borrows the editor. */
const AUTOMATION_REPORTERS = new WeakMap<
  object,
  (code: EditDiagnosticCode, tracked: boolean, cause?: string, error?: { thrown: unknown }) => void
>();

/**
 * Report a refused editing API batch into the diagnostics of the editor it ran on. A runtime
 * from `DocxEditor.createBrowser` calls this, so its refusals reach the editor's telemetry.
 * Does nothing for an object that is not an editor. `cause` is the engine reason behind the
 * refusal; a value the engine does not know is left out of the diagnostic.
 */
export function reportAutomationRefusal(
  editor: object,
  code: EditDiagnosticCode,
  tracked: boolean,
  cause?: string
): void {
  AUTOMATION_REPORTERS.get(editor)?.(code, tracked, cause);
}

/** Each editor's reporter for a refused tracked-change decision from a runtime. */
const AUTOMATION_REVIEW_REPORTERS = new WeakMap<
  object,
  (code: ReviewDiagnosticCode, operation?: ReviewOperation, cause?: string) => void
>();

/**
 * Report a tracked-change decision an editing API batch refused into the diagnostics of the
 * editor it ran on, as one `review.skipped` event. `cause` is the structure behind the skip; a
 * value the engine does not know is left out. Does nothing for an object that is not an editor.
 */
export function reportAutomationReviewSkip(
  editor: object,
  code: ReviewDiagnosticCode,
  operation?: ReviewOperation,
  cause?: string
): void {
  AUTOMATION_REVIEW_REPORTERS.get(editor)?.(code, operation, cause);
}

/**
 * Report an editing API batch that threw an engine error, not a refusal, into the diagnostics of
 * the editor it ran on: `edit.internal-invariant` with the error's class, never its message.
 * Does nothing for an object that is not an editor.
 */
export function reportAutomationException(editor: object, error: unknown, tracked: boolean): void {
  AUTOMATION_REPORTERS.get(editor)?.('edit.internal-invariant', tracked, 'exception', {
    thrown: error,
  });
}

/** What the facade tells the reporter about the opening document. */
interface Opening {
  readonly sizeBucket: ByteSizeBucket;
  /** Null while the bytes wait, detached, for a container: that wait is not open time. */
  start: number | null;
}

export interface EditorDiagnosticsOptions {
  readonly modules: EditorModuleRegistry;
  /** Called once when an open throws, after its `open.failed` diagnostic. */
  readonly onOpenCrash?: () => void;
  /** The instance's event bus: diagnostics go out on it, history diagnostics come in on it. */
  readonly events: {
    readonly emitDiagnostic: (event: EditorDiagnostic) => void;
    readonly on: <K extends 'historyDiagnostic'>(
      event: K,
      handler: (diagnostic: HistoryDiagnostic) => void
    ) => () => void;
    /**
     * Whether `editor.on('diagnostic')` has a handler. Performance is measured only then, or
     * while a module wants it.
     */
    readonly hasDiagnosticHandlers?: () => boolean;
  };
  /** The custom-node reporter, observed so its codes join the stream. */
  readonly customNodes?: CustomNodeDiagnosticReporter;
  readonly now?: () => number;
  /** Performance window and scheduling, for tests. */
  readonly performance?: { readonly windowMs?: number; readonly clock?: PerformanceClock };
  /** Session window and scheduling, for tests. */
  readonly session?: { readonly windowMs?: number; readonly clock?: SessionClock };
}

/** The `save()` failure codes, from the facade's error codes. */
function saveDiagnosticCode(error: unknown): DocumentSaveDiagnosticCode {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'notFound') return 'save.no-document';
  if (code === 'invalidState') return 'save.document-changed';
  return 'save.failed';
}

const HISTORY_KINDS: ReadonlySet<string> = new Set([
  'split',
  'possible-ungrouped-gesture',
  'possible-fragmented-gesture',
]);

export type EditorDiagnostics = ReturnType<typeof createEditorDiagnostics>;

/** One reporter per editor instance. */
export function createEditorDiagnostics(options: EditorDiagnosticsOptions) {
  const clock = () => globalThis.performance?.now() ?? Date.now();
  const emitter = createDiagnosticEmitter<EditorDiagnostic>(
    () => [...options.modules.diagnosticListeners, options.events.emitDiagnostic],
    options.now
  );
  const deliver = emitter.deliver;
  let opening: Opening | null = null;
  /** Depth of `exec` calls, so a surface refusal inside one is reported once, as a command. */
  let execDepth = 0;
  /** Depth of editing API batches on this editor; their refusals are reported as automation. */
  let automationDepth = 0;
  /** Surface refusals reported so far, so a wrapper can tell whether the surface reported one. */
  let inputRejections = 0;
  /** Whether the outermost command or batch running now has counted its edit: one per call. */
  let callEditCounted = false;
  // History and custom-node diagnostics keep their own channels and join this one by code only:
  // the history reason and the node's name and payload issues stay out of it.
  options.events.on('historyDiagnostic', (diagnostic) => {
    if (HISTORY_KINDS.has(diagnostic.kind))
      deliver({ kind: 'history', code: `history.${diagnostic.kind}` as HistoryDiagnosticCode });
  });
  options.customNodes?.observe((diagnostic) => {
    const code = (diagnostic as { code?: unknown } | null)?.code;
    if (code === 'payload-invalid' || code === 'payload-missing')
      deliver({ kind: 'custom-node', code: `custom-node.${code}` });
  });
  const collaboration = options.modules.collaboration?.session;
  const stopCollaboration = collaboration
    ? observeCollaboration(collaboration, deliver, clock)
    : () => {};
  const performance = createPerformanceSampler({
    deliver,
    enabled: () =>
      options.events.hasDiagnosticHandlers?.() === true ||
      options.modules.wantsDiagnostic('performance'),
    ...options.performance,
  });
  const session = createSessionTracker({
    deliver,
    enabled: () =>
      options.events.hasDiagnosticHandlers?.() === true ||
      options.modules.wantsDiagnostic('session'),
    ...options.session,
  });
  // A closed tab rarely destroys its editors: the page closing sends the last summaries.
  const stopPageClose = onPageClose(() => {
    performance.flush();
    session.end();
  });

  /**
   * One `review.skipped` event for each code, engine condition, change kind, formatting kind and
   * part role: what a fix needs, without the author, the key or the part's name.
   */
  const reportSkips = (
    batches: readonly (readonly [readonly SkippedChange[], ReviewOperation | undefined])[]
  ): void => {
    const groups = new Map<string, { readonly event: Record<string, unknown>; count: number }>();
    for (const [skipped, operation] of batches)
      for (const { reason, revision, detail } of skipped) {
        const code = reviewCodeOfSkip({ reason, ...(detail === undefined ? {} : { detail }) });
        if (!code) continue;
        const changeKind = reviewChangeKind(revision?.revisionKind);
        const formattingKind =
          changeKind === 'format' ? formattingChangeKind(revision?.formattingKind) : undefined;
        const part = documentPartKind(revision?.partName);
        const cause = diagnosticCause(detail);
        const key = [code, cause, operation, changeKind, formattingKind, part].join('|');
        const group = groups.get(key);
        if (group) group.count += 1;
        else
          groups.set(key, {
            count: 1,
            event: {
              code,
              ...(operation ? { operation } : {}),
              ...(changeKind ? { changeKind } : {}),
              ...(formattingKind ? { formattingKind } : {}),
              ...(part ? { part } : {}),
              ...(cause ? { cause } : {}),
            },
          });
      }
    for (const { event, count } of groups.values())
      deliver({ kind: 'review.skipped', ...event, count } as Parameters<typeof deliver>[0]);
  };
  const reportSkipped = (command: EditorCommand, result: ExecResult): void =>
    reportSkips([
      [result.revisions?.skipped ?? [], reviewOperationOf(command)],
      [result.revisionAuthors?.skipped ?? [], 'reassign'],
    ]);
  /** An exception the engine did not expect, reported by class and stage, never by message. */
  const reportException = (
    error: unknown,
    stage: FailureStage,
    event: { readonly tracked: boolean; readonly command?: EditorCommand['type'] }
  ): void => {
    // Reporting must never replace the error the caller sees.
    try {
      deliver({
        kind: 'edit.rejected',
        code: 'edit.internal-invariant',
        origin: 'command',
        ...event,
        cause: exceptionCause(),
        errorName: diagnosticErrorName(error),
        stage,
      });
    } catch {
      /* the caller's own error propagates */
    }
  };

  /**
   * One edit for each outermost command or editing API batch, and one for each input commit.
   * Buffered typing is input, also when a command's commit flushes it.
   */
  const edited = (typing: boolean): void => {
    if (typing || (execDepth === 0 && automationDepth === 0)) {
      session.edit('input');
      return;
    }
    if (callEditCounted) return;
    callEditCounted = true;
    session.edit(automationDepth > 0 ? 'automation' : 'command');
  };

  return {
    editorSessionId: emitter.editorSessionId,

    /** What the surface reports: refusals, timings, and committed edits. */
    surfaceHooks(tracked: () => boolean, surface: () => PaginatedSurface | null | undefined) {
      return {
        onRejection: (reason: string) => this.inputRejected(reason, tracked()),
        onTiming: (phase: 'layout' | 'paint' | 'input', value: number) =>
          this.timing(phase, value, surface() ?? undefined),
        onEdit: edited,
      };
    },

    /** A new document starts opening. A remount of the same document is not a new open. */
    openStarted(bytes: Uint8Array): void {
      opening = { sizeBucket: byteSizeBucket(bytes.byteLength), start: clock() };
    },
    /** The opening document waits detached; its clock restarts when it mounts. */
    openDeferred(): void {
      if (opening) opening.start = null;
    },
    /** A container is present and the mount begins. */
    openMounting(): void {
      if (opening && opening.start === null) opening.start = clock();
    },
    /** The opening document laid out. Reports once per open, never for a remount. */
    openSettled(surface: PaginatedSurface): void {
      if (!opening) return;
      const { sizeBucket, start } = opening;
      opening = null;
      deliver({
        kind: 'document.open',
        outcome: 'opened',
        sizeBucket,
        pagesBucket: countBucket(totalPages(surface)),
        durationMs: start === null ? 0 : Math.max(0, Math.round(clock() - start)),
        ...shapeOf(surface),
      });
    },
    /**
     * The open was refused. `limit` disambiguates the one reason two layers share. `detail` is
     * read only for the role of the part it names; it never leaves this function.
     */
    openRejected(reason: string, limit?: string, detail?: string): void {
      const sizeBucket = opening?.sizeBucket;
      opening = null;
      const cause = diagnosticCause(reason);
      const part = documentPartKind(detail);
      deliver({
        kind: 'document.open',
        outcome: 'rejected',
        code: openDiagnosticCode(reason, limit),
        ...(sizeBucket ? { sizeBucket } : {}),
        ...(cause ? { cause } : {}),
        ...(part ? { part } : {}),
      });
    },
    /** The open threw. Reported once as `open.failed`, with the exception's class only. */
    openCrashed(error: unknown, stage: FailureStage = 'open-mount'): void {
      if (!opening) return;
      const { sizeBucket } = opening;
      opening = null;
      deliver({
        kind: 'document.open',
        outcome: 'rejected',
        code: 'open.failed',
        sizeBucket,
        cause: exceptionCause(),
        errorName: diagnosticErrorName(error),
        stage,
      });
      options.onOpenCrash?.();
    },
    /** Run a later slice of a progressive open; an exception in it fails the open, then rethrows. */
    continueOpen<T>(run: () => T): T {
      try {
        return run();
      } catch (error) {
        this.openCrashed(error, 'open-layout');
        throw error;
      }
    },
    /**
     * Wrap a single accept or reject from a review card, which does not go through `exec`. A
     * refusal is reported as a skipped change with its kind; a throw as an engine defect.
     */
    reviewItem(
      resolve: (key: string, action: 'accept' | 'reject') => ExecResult,
      itemOf: (key: string) => ReviewRevisionItem | undefined,
      describe: (
        item: ReviewRevisionItem,
        action: 'accept' | 'reject'
      ) => { readonly partName?: string; readonly detail?: string },
      tracked: () => boolean
    ): (key: string, action: 'accept' | 'reject') => ExecResult {
      return (key, action) => {
        const item = itemOf(key);
        // The surface reports every refusal its commit gates make, a refresh included; one it
        // reported during this call must not be reported again here.
        const reportedBefore = inputRejections;
        let result: ExecResult;
        try {
          result = resolve(key, action);
        } catch (error) {
          if (execDepth === 0) reportException(error, 'review-item', { tracked: tracked() });
          throw error;
        }
        // Inside `exec`, the command reports for itself.
        if (result.ok || execDepth > 0) return result;
        // A gate that refused the write before it ran is not the revision's fault, so it is no
        // skipped change.
        const gate: EditDiagnosticCode = diagnosticCodeOfRefusal(result.reason, result.code);
        const gated =
          gate === 'edit.refresh-in-progress' || gate === 'edit.collaboration-not-ready';
        // A card a lock or a binding keeps is refused before the surface commit, so its
        // rejected edit is reported here; it is still a skipped change.
        const kept =
          (result.code === 'locked' && result.reason.startsWith('locked-content:')) ||
          (result.code === 'bound' && result.reason.startsWith('bound-content:'));
        if (kept && inputRejections === reportedBefore)
          deliver({
            kind: 'edit.rejected',
            code: gate,
            origin: 'command',
            tracked: tracked(),
          });
        if (
          result.code === 'notFound' ||
          ((result.code === 'unsupported' || kept) && item && !gated)
        ) {
          // Read only on this failure path: the planner's preflight names the exact condition.
          const described = item ? describe(item, action) : {};
          const revision = item && {
            revisionKind: item.revisionKind,
            partName: described.partName ?? '',
            ...(item.formattingKind ? { formattingKind: item.formattingKind } : {}),
          };
          // A refusal led by a skip reason reports the structure behind it, such as
          // `nested-table`, not the reason a second time.
          const leading = reviewDiagnosticCode(result.reason.split(':', 1)[0]!) !== null;
          const detail =
            result.reason === READ_ONLY_REVISION_REASON
              ? (described.detail ?? 'read-only')
              : leading
                ? (described.detail ?? diagnosticCause(result.reason))
                : (diagnosticCause(result.reason) ?? described.detail);
          reportSkips([
            [
              [
                {
                  // A refusal that leads with a skip reason, such as a row kept for its nested
                  // table, reports that reason, as the review UI's code does.
                  reason:
                    result.code === 'notFound'
                      ? 'unknown-revision'
                      : leadingReviewReason(result.reason),
                  ...(revision ? { revision } : {}),
                  detail,
                },
              ],
              action,
            ],
          ]);
          return result;
        }
        if (inputRejections !== reportedBefore) return result;
        const cause = diagnosticCause(result.reason);
        deliver({
          kind: 'edit.rejected',
          code: gate,
          origin: 'command',
          tracked: tracked(),
          ...(cause ? { cause } : {}),
        });
        return result;
      };
    },

    /**
     * Wraps `exec`, so its refusal and its skipped tracked changes are reported once. `changed`
     * tells whether the document changed, for a command such as undo that edits without a
     * surface commit.
     */
    exec(
      command: EditorCommand,
      tracked: boolean,
      run: () => ExecResult,
      changed?: () => boolean
    ): ExecResult {
      if (execDepth === 0 && automationDepth === 0) callEditCounted = false;
      execDepth += 1;
      let result: ExecResult;
      try {
        result = run();
      } catch (error) {
        // A command that throws is an engine defect: report its class, then let it propagate.
        if (execDepth === 1) {
          let type: EditorCommand['type'] | undefined;
          try {
            type = builtInCommand(command);
          } catch {
            type = undefined;
          }
          reportException(error, 'command', { tracked, ...(type ? { command: type } : {}) });
        }
        throw error;
      } finally {
        execDepth -= 1;
      }
      if (execDepth > 0) return result;
      if (result.ok && !callEditCounted && changed?.()) {
        callEditCounted = true;
        session.edit(automationDepth > 0 ? 'automation' : 'command');
      }
      if (!result.ok) {
        const type = builtInCommand(command);
        const cause = diagnosticCause(result.reason);
        deliver({
          kind: 'edit.rejected',
          code: diagnosticCodeOfRefusal(result.reason, result.code),
          origin: 'command',
          tracked,
          ...(type ? { command: type } : {}),
          ...(cause ? { cause } : {}),
        });
      }
      reportSkipped(command, result);
      return result;
    },
    /** A refusal from typing, the clipboard, a drag or the pointer. Inside `exec` it is not new. */
    inputRejected(reason: string, tracked: boolean): void {
      if (execDepth > 0 || automationDepth > 0) return;
      inputRejections += 1;
      const code = diagnosticCodeOfRefusal(reason);
      const cause = diagnosticCause(reason);
      deliver({
        kind: 'edit.rejected',
        code,
        origin: 'input',
        tracked,
        ...(cause ? { cause } : {}),
      });
    },

    fontFailed(code: string | undefined): void {
      deliver({ kind: 'font.failed', code: fontDiagnosticCode(code) });
    },

    /**
     * Report `exec` refusals and automation refusals for this editor instance: wraps `exec`, and
     * lets a runtime borrowing the editor report its refused batches into the same stream.
     */
    attach(
      editor: Pick<DocxEditorInstance, 'exec' | 'save' | 'getDocumentHandle'>,
      tracked: () => boolean
    ): void {
      const execNow = editor.exec;
      const revision = () => editor.getDocumentHandle().revision;
      editor.exec = (command, options) => {
        const before = revision();
        return this.exec(
          command,
          tracked(),
          () => execNow(command, options),
          () => revision() !== before
        );
      };
      const saveNow = editor.save;
      editor.save = () => this.save(() => saveNow.call(editor));
      AUTOMATION_SCOPES.set(editor, (run) => {
        if (execDepth === 0 && automationDepth === 0) callEditCounted = false;
        automationDepth += 1;
        try {
          return run();
        } finally {
          automationDepth -= 1;
        }
      });
      // Image inserts and replaces are asynchronous and run outside `exec`.
      setCommandReporter(
        editor,
        (command, result) => void this.exec(command, tracked(), () => result)
      );
      AUTOMATION_REVIEW_REPORTERS.set(editor, (code, operation, reason) => {
        const cause = diagnosticCause(reason);
        deliver({
          kind: 'review.skipped',
          code,
          count: 1,
          ...(operation ? { operation } : {}),
          ...(cause ? { cause } : {}),
        });
      });
      AUTOMATION_REPORTERS.set(editor, (code, automationTracked, reason, exception) => {
        // Checked again here: a cause must be one the engine knows, whoever passes it.
        const cause = diagnosticCause(reason);
        deliver({
          kind: 'edit.rejected',
          code,
          origin: 'automation',
          tracked: automationTracked,
          ...(cause ? { cause } : {}),
          ...(exception
            ? { errorName: diagnosticErrorName(exception.thrown), stage: 'automation' as const }
            : {}),
        });
      });
    },

    /** Wraps `save`, so each call reports its outcome, size bucket, and duration once. */
    async save(run: () => Promise<ArrayBuffer>): Promise<ArrayBuffer> {
      const start = clock();
      const elapsed = () => Math.max(0, Math.round(clock() - start));
      let bytes: ArrayBuffer;
      try {
        bytes = await run();
      } catch (error) {
        // Reporting must never replace the error the caller sees.
        try {
          const code = saveDiagnosticCode(error);
          deliver({
            kind: 'document.save',
            outcome: 'rejected',
            code,
            durationMs: elapsed(),
            ...(code === 'save.failed'
              ? {
                  cause: exceptionCause(),
                  errorName: diagnosticErrorName(error),
                  stage: 'save' as const,
                }
              : {}),
          });
        } catch {
          /* the caller's own error propagates */
        }
        throw error;
      }
      deliver({
        kind: 'document.save',
        outcome: 'saved',
        sizeBucket: byteSizeBucket(bytes.byteLength),
        durationMs: elapsed(),
      });
      return bytes;
    },

    /** A layout or paint duration, or a press timestamp, from the surface. */
    timing(phase: 'layout' | 'paint' | 'input', value: number, surface?: PaginatedSurface): void {
      if (phase === 'input') session.activity();
      performance.timing(
        phase,
        value,
        // Read only when measured: the page count is not free on every paint.
        phase === 'paint' && surface ? () => totalPages(surface) : undefined
      );
    },
    /**
     * Send the last performance summary, end the session, and stop observing the collaboration
     * session. The editor calls this when destroyed, before it drops its event handlers.
     */
    dispose(): void {
      performance.dispose();
      stopCollaboration();
      session.end();
      stopPageClose();
    },
  };
}

/** The bucketed shape of the opened document. Counts only: nothing is read from the content. */
function shapeOf(surface: PaginatedSurface): { readonly shape?: DocumentShape } {
  try {
    const { session } = surface;
    return {
      shape: {
        parts: countBucket(session.currentPackage().parts.size),
        paragraphs: countBucket(session.paragraphIds().length),
        reviewItems: countBucket(session.reviewItems().length),
        embeddedFonts: countBucket(session.embeddedFonts().length),
      },
    };
  } catch {
    return {};
  }
}

/**
 * Reports each collaboration status change and each change in the number of people. A refusal
 * that heals inside one call still reports both of its transitions: the session notifies each.
 */
function observeCollaboration(
  session: EditorCollaborationSession,
  deliver: DiagnosticEmitter<EditorDiagnostic>['deliver'],
  clock: () => number
): () => void {
  const joined = clock();
  let previous: CollaborationStatus | 'none' = 'none';
  let previousCode: string | undefined;
  let previousRecovering = false;
  let readyOnce = false;
  let people = -1;

  const status = () => {
    const snapshot = session.statusSnapshot();
    const failure = snapshot.reason?.code;
    const recovering = snapshot.recovering === true;
    if (
      snapshot.status === previous &&
      failure === previousCode &&
      recovering === previousRecovering
    )
      return;
    const firstReady = snapshot.status === 'ready' && !readyOnce;
    // Timed only when this editor saw the wait. A session that was ready before the editor
    // attached, as a room hook makes it, joined before the clock started.
    const waited = firstReady && previous !== 'none';
    if (firstReady) readyOnce = true;
    deliver({
      kind: 'collab.status',
      status: snapshot.status,
      previous,
      ...(failure ? { code: `collab.${failure}` as CollaborationDiagnosticCode } : {}),
      recovering,
      ...(waited ? { connectMs: Math.max(0, Math.round(clock() - joined)) } : {}),
    });
    previous = snapshot.status;
    previousCode = failure;
    previousRecovering = recovering;
  };
  const participants = () => {
    const count = session.participants().length;
    if (count === people) return;
    people = count;
    deliver({ kind: 'collab.participants', count });
  };

  const stops = [session.subscribeStatus(status), session.subscribeParticipants(participants)];
  status();
  return () => {
    for (const stop of stops) stop();
  };
}

/** What reporting a font failure needs from the facade. */
export interface FontErrorReporting {
  readonly config: { readonly onFontError?: (error: EditorFontError) => void };
  readonly events: {
    readonly hasErrorHandlers: () => boolean;
    readonly emitError: (error: EditorError, isCurrent?: () => boolean) => void;
  };
  readonly diagnostics: EditorDiagnostics;
}

/** Reports one font failure to the host's handler, the `error` event and the diagnostics. */
export function reportEditorFontError(
  error: EditorFontError,
  host: FontErrorReporting,
  isCurrent: () => boolean = () => true
): void {
  if (!isCurrent()) return;
  // A shaper that never loaded is not a per-face degradation: NOTHING measures correctly,
  // and the fault is the host's build rather than the document's content. Said out loud
  // exactly once, and only when nobody is listening — a host that reports it in its own
  // UI does not need library noise it cannot switch off. Before this was fixed the same
  // misconfiguration failed the BUILD, so a green build with a silent console would be a
  // strictly worse trade (#282).
  const shaperNeverLoaded =
    error.code === 'wasmUnavailable' ||
    (error.cause instanceof HarfBuzzShapingError && error.cause.code === 'unsupportedRuntime');
  if (shaperNeverLoaded && !host.config.onFontError && !host.events.hasErrorHandlers()) {
    warnFontFailureOnce(error);
  }
  // A host handler that throws must not abort font resolution — reporting a dropped
  // face would then cost the whole shaped measurer, and the catch's own report would
  // throw again as an unhandled rejection.
  try {
    host.config.onFontError?.(error);
  } catch {
    /* the host's reporting problem, not the document's */
  }
  if (!isCurrent()) return;
  host.events.emitError(error, isCurrent);
  if (isCurrent()) host.diagnostics.fontFailed(shaperNeverLoaded ? 'wasmUnavailable' : error.code);
}
