import type { EditorDropEvent } from '../contracts/editor-drop.ts';
import type {
  DocumentChange,
  EditorError,
  EditorEvents,
  EditorHostChange,
  EditorSnapshot,
  ParagraphsChangeEvent,
  ReviewChangesResolvedEvent,
  ReviewItemRevealEvent,
  Unsubscribe,
} from '../contracts/editor.ts';
import type { HistoryDiagnostic } from '../contracts/editor-scope.ts';
import type { EditorDiagnostic } from '../contracts/diagnostics.ts';
import type { ResolvedRevisionMarkup } from '../contracts/revision-markup.ts';

/** Per-instance notifications. Snapshot derivation stays lazy without subscribers. */
export function createEditorEvents(
  snapshot: () => EditorSnapshot,
  hostDocument: () => Document | null = () => null
) {
  /** The host document `hostChange` last reported; `undefined` before the first report. */
  let reportedHost: Document | null | undefined = undefined;
  const handlers: { [E in keyof EditorEvents]: Set<EditorEvents[E]> } = {
    dragOver: new Set(),
    drop: new Set(),
    change: new Set(),
    paragraphsChange: new Set(),
    selectionChange: new Set(),
    error: new Set(),
    historyDiagnostic: new Set(),
    diagnostic: new Set(),
    revisionMarkupChange: new Set(),
    reviewItemReveal: new Set(),
    reviewChangesResolved: new Set(),
    hostChange: new Set(),
  };
  /**
   * Report a new host document. Every attach, move, heal and detach also re-publishes the
   * selection, so the check rides on that emission instead of each of those paths.
   */
  const syncHost = (): void => {
    const current = hostDocument();
    if (current === reportedHost) return;
    // Nothing to report before the first mount: a detached editor that never mounted.
    if (reportedHost === undefined && current === null) return;
    reportedHost = current;
    const value: EditorHostChange = Object.freeze({ document: current });
    for (const handler of [...handlers.hostChange]) handler(value);
  };
  let deferring = 0;
  let draining = false;
  let pending: Array<() => void> = [];
  const dispatch = (notify: () => void): void => {
    if (deferring > 0 || draining) pending.push(notify);
    else notify();
  };
  return {
    emitDragEvent(kind: 'dragOver' | 'drop', event: EditorDropEvent) {
      // Acceptance must finish before the browser returns from the native event.
      for (const handler of [...handlers[kind]]) handler(event);
    },
    /**
     * Keep host listeners outside a synchronous commit. Preview commits suppress listener
     * errors; ordinary commits propagate the first error after every queued event runs.
     * The outermost deferral owns this policy.
     */
    defer<T>(run: () => T, propagateListenerErrors = false): T {
      const propagate = propagateListenerErrors && deferring === 0 && !draining;
      let runFailed = false;
      deferring += 1;
      try {
        return run();
      } catch (error) {
        runFailed = true;
        throw error;
      } finally {
        deferring -= 1;
        if (deferring === 0 && !draining) {
          draining = true;
          let firstError: { readonly value: unknown } | undefined;
          try {
            // Listener edits follow every notification already queued by the commit.
            while (pending.length > 0) {
              const notifications = pending;
              pending = [];
              for (const notify of notifications) {
                try {
                  notify();
                } catch (error) {
                  firstError ??= { value: error };
                }
              }
            }
          } finally {
            draining = false;
          }
          if (propagate && firstError && !runFailed) throw firstError.value;
        }
      }
    },
    emitError(error: EditorError, isCurrent?: () => boolean) {
      dispatch(() => {
        for (const handler of [...handlers.error]) {
          // A listener can load another document or destroy the editor before the next listener.
          if (isCurrent && !isCurrent()) return;
          handler(error);
        }
      });
    },
    emitDocumentChange(change: DocumentChange) {
      dispatch(() => {
        for (const handler of [...handlers.change]) handler(change);
      });
    },
    emitParagraphsChange(event: ParagraphsChangeEvent, isCurrent?: () => boolean) {
      dispatch(() => {
        for (const handler of [...handlers.paragraphsChange]) {
          if (isCurrent && !isCurrent()) return;
          handler(event);
        }
      });
    },
    emitSelectionChange() {
      dispatch(() => {
        // `hostChange` rides on this: every mount, move, heal and detach reports the selection,
        // so do not drop a "redundant" selection report from those paths.
        syncHost();
        if (!handlers.selectionChange.size) return;
        const value = snapshot();
        for (const handler of [...handlers.selectionChange]) handler(value);
      });
    },
    emitHistoryDiagnostic(diagnostic: HistoryDiagnostic) {
      dispatch(() => {
        for (const handler of [...handlers.historyDiagnostic]) handler(diagnostic);
      });
    },
    emitDiagnostic(event: EditorDiagnostic) {
      dispatch(() => {
        for (const handler of [...handlers.diagnostic]) handler(event);
      });
    },
    emitRevisionMarkupChange(value: ResolvedRevisionMarkup) {
      dispatch(() => {
        for (const handler of [...handlers.revisionMarkupChange]) handler(value);
      });
    },
    emitReviewChangesResolved(event: ReviewChangesResolvedEvent) {
      dispatch(() => {
        const value = Object.freeze({ ...event, skipped: Object.freeze([...event.skipped]) });
        for (const handler of [...handlers.reviewChangesResolved]) handler(value);
      });
    },
    emitReviewItemReveal(event: ReviewItemRevealEvent) {
      dispatch(() => {
        const value = Object.freeze({ ...event });
        for (const handler of [...handlers.reviewItemReveal]) handler(value);
      });
    },
    hasErrorHandlers: () => handlers.error.size > 0,
    hasParagraphsChangeHandlers: () => handlers.paragraphsChange.size > 0,
    hasDiagnosticHandlers: () => handlers.diagnostic.size > 0,
    hasReviewChangesResolvedHandlers: () => handlers.reviewChangesResolved.size > 0,
    clear() {
      pending = [];
      for (const set of Object.values(handlers)) set.clear();
    },
    on<E extends keyof EditorEvents>(event: E, handler: EditorEvents[E]): Unsubscribe {
      handlers[event].add(handler);
      return () => {
        handlers[event].delete(handler);
      };
    },
  };
}
