import { DocumentRefreshError } from './document-refresh-types.ts';
export { DocumentRefreshError } from './document-refresh-types.ts';
import { readOoxmlPackage } from '../store/package/ooxml-package.ts';
import type { DocxEditorInstance } from './docx-editor-types.ts';
import type { DocumentHandle } from '../contracts/editor.ts';
import { createParagraphHighlights } from './paragraph-highlights.ts';
import { revealScrollOptions } from './reveal-scroll-options.ts';
import { refreshHostFor } from './document-refresh-host.ts';
import type { ReplaceDocumentRefusal } from '../contracts/replace-document.ts';
import { withRefreshEditSource } from './refresh-edit-source.ts';
import { refreshCompositionActive } from './refresh-write-guard.ts';
import { pendingSurfaceCommit } from './surface-commit-state.ts';
import {
  resolveRefreshChanges,
  revisionChangeKeys,
  type LocatedChange,
} from './document-refresh-changes.ts';
import type {
  DocumentRefresh,
  DocumentRefreshState,
  RefreshFailureCode,
  RefreshResult,
  RefreshSubmission,
  RefreshUpdate,
} from './document-refresh-types.ts';
export type * from './document-refresh-types.ts';

const controllers = new WeakMap<DocxEditorInstance, DocumentRefresh>();

/** The `message` a refusal carries when nothing more specific explains it. */
const REFRESH_FAILURE_MESSAGES: Readonly<Record<RefreshFailureCode, string>> = {
  unavailable: 'No document is mounted, or it is still opening.',
  collaboration: 'A reload cannot replace the document while a collaboration session is attached.',
  busy: 'A replacement is running, or a preview blocks edits.',
  cancelled: 'Cancellation interrupted the update.',
  superseded: 'The result belongs to an inactive submission, or arrived after cancellation.',
  'document-changed': 'The document changed during the update.',
  'local-edits': 'The document changed after capture.',
  'out-of-order': 'A duplicate or older sequence arrived.',
  'invalid-result': 'The update object is malformed.',
  'invalid-document': 'The returned bytes are not a valid DOCX file.',
  'input-failed': 'Pending input or serialization failed.',
  'load-failed': 'A valid file failed to mount.',
  'recovery-failed': 'Mounting and restoration both failed.',
  'edit-not-permitted': 'The editor or the document does not permit an undoable edit.',
  'edit-unsupported': 'The result cannot apply as an undoable edit.',
};
let nextController = 0;

/**
 * Get the engine-owned controller for updated DOCX files. React and Vue use the same controller.
 * Transport and processor jobs belong to your application. This is a host API, not an Office.js document member.
 * @public
 */
export function createDocumentRefresh(editor: DocxEditorInstance): DocumentRefresh {
  const existing = controllers.get(editor);
  if (existing) return existing;
  const host = refreshHostFor(editor);
  const prefix = `refresh-${++nextController}`;
  let generation = 0;
  let active: {
    token: RefreshSubmission;
    epoch: number;
    revision: number;
    /** The document an undoable update must still find: taken at capture, moved on accept. */
    handle: DocumentHandle;
    sequence: number;
    seen: Map<string, string>;
  } | null = null;
  let abort = new AbortController();
  let busy = false;
  let queue = Promise.resolve();
  let recovery: { bytes: Uint8Array; epoch: number } | null = null;
  let located: LocatedChange[] = [];
  let acceptedRevision: number | null = null;
  const listeners = new Set<() => void>();
  const resultListeners = new Set<(result: RefreshResult) => void>();
  let state: DocumentRefreshState = Object.freeze({
    phase: 'idle',
    result: null,
    changes: [],
    highlightsVisible: false,
    recoveryAvailable: false,
  });
  const notify = (patch: Partial<DocumentRefreshState>) => {
    state = Object.freeze({ ...state, ...patch });
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        /* A host observer cannot abort replacement. */
      }
    }
  };
  const highlights = createParagraphHighlights(
    editor,
    host,
    {
      marker: 'data-docx-refresh-highlight',
      defaultColor: 'var(--doc-refresh-highlight-color)',
    },
    () => {
      if (state.highlightsVisible) notify({ highlightsVisible: false });
    }
  );
  const publish = (result: RefreshResult, phase?: DocumentRefreshState['phase']): RefreshResult => {
    if (phase) notify({ phase, result, recoveryAvailable: recovery !== null });
    for (const listener of resultListeners) {
      try {
        listener(result);
      } catch {
        /* Isolate host observers. */
      }
    }
    return result;
  };
  /** A refusal without a specific cause; edit refusals with one go through `editFailure`. */
  const failure = (
    resultId: string,
    code: Exclude<RefreshFailureCode, 'edit-not-permitted' | 'edit-unsupported'>,
    recovered?: boolean
  ): RefreshResult => ({
    ok: false,
    resultId,
    code,
    message: REFRESH_FAILURE_MESSAGES[code],
    ...(recovered === undefined ? {} : { recovered }),
  });
  /** A `replaceDocument` refusal in this controller's own codes, keeping its cause. */
  const editFailure = (resultId: string, refusal: ReplaceDocumentRefusal): RefreshResult => {
    const base = { ok: false as const, resultId, message: refusal.message };
    switch (refusal.code) {
      case 'editNotPermitted':
        // A refresh runs in suggesting mode too, so only viewing and protection reach here.
        return {
          ...base,
          code: 'edit-not-permitted',
          reason: refusal.reason === 'protected' ? 'protected' : 'viewing',
        };
      case 'editUnsupported':
        return {
          ...base,
          code: 'edit-unsupported',
          reason:
            refusal.reason === 'differentMainPart'
              ? 'different-main-part'
              : refusal.reason === 'collaborationRefused'
                ? 'collaboration-refused'
                : 'unsupported-difference',
        };
      case 'unavailable':
        return refusal.reason
          ? { ...base, code: 'unavailable', reason: 'collaboration-unavailable' }
          : { ...base, code: 'unavailable' };
      case 'staleDocument':
        return {
          ...base,
          code: refusal.reason === 'otherDocument' ? 'document-changed' : 'local-edits',
        };
      case 'invalidRequest':
        return { ...base, code: 'invalid-result' };
      case 'invalidDocument':
        return { ...base, code: 'invalid-document' };
      case 'busy':
        return { ...base, code: 'busy' };
    }
  };
  // A reload replaces the session, which a collaboration session cannot follow; an edit can.
  const refusal = (mode: RefreshUpdate['mode']): 'collaboration' | 'unavailable' | null =>
    host.collaboration() && mode !== 'edit'
      ? 'collaboration'
      : !host.surface() || !host.container() || editor.snapshot().isOpening
        ? 'unavailable'
        : null;
  const reset = () => {
    generation++;
    active = null;
    abort.abort();
    abort = new AbortController();
    located = [];
    acceptedRevision = null;
    highlights.clear();
  };
  host.invalidated.add(() => {
    reset();
    recovery = null;
    notify({
      phase: 'idle',
      result: null,
      changes: [],
      highlightsVisible: false,
      recoveryAvailable: false,
    });
  });
  editor.on('change', (change) => {
    if (change.source || acceptedRevision === null || host.revision === acceptedRevision) return;
    // Locations name one accepted revision. Never paint stale ranges after a local edit.
    located = [];
    highlights.clear();
    acceptedRevision = null;
    notify({ changes: [], highlightsVisible: false });
  });
  const settle = async (signal: AbortSignal) => {
    const surface = host.surface();
    const container = host.container();
    if (!surface || !container) throw new Error('unavailable');
    if (refreshCompositionActive(surface)) {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          container.removeEventListener('compositionend', done);
          signal.removeEventListener('abort', cancel);
        };
        const done = () => {
          cleanup();
          resolve();
        };
        const cancel = () => {
          cleanup();
          reject(new Error('cancelled'));
        };
        container.addEventListener('compositionend', done);
        signal.addEventListener('abort', cancel, { once: true });
        if (signal.aborted) cancel();
      });
    }
    const pending = pendingSurfaceCommit(container);
    if (pending) await pending;
    if (signal.aborted || host.surface() !== surface) throw new Error('document-changed');
    // No await between final input, serialization, and the revision read.
    const bytes = surface.save();
    if (host.surface() !== surface) throw new Error('document-changed');
    return { bytes, revision: host.revision, handle: editor.getDocumentHandle() };
  };
  /** Record an accepted result: advance the sequence, resolve its changes, and report. */
  const accept = (
    request: NonNullable<typeof active>,
    resultId: string,
    owned: RefreshUpdate,
    mode: 'reload' | 'edit'
  ): RefreshResult => {
    highlights.clear();
    if (mode === 'edit') {
      // The update's own change event carries a source, so the revision baseline stays put.
      recovery = null;
      request.revision = host.revision;
    }
    request.handle = editor.getDocumentHandle();
    request.sequence = owned.sequence;
    const resolved = resolveRefreshChanges(host, resultId, owned.changes, request.seen);
    located = host.revision === request.revision ? resolved.located : [];
    for (const entry of located) request.seen.set(entry.change.id, entry.fingerprint);
    acceptedRevision = request.revision;
    const changes = Object.freeze(located.map((entry) => Object.freeze(entry.change)));
    const result: RefreshResult = Object.freeze({
      ok: true,
      resultId,
      mode,
      changes,
      changeInformation:
        host.revision === request.revision && resolved.available ? 'available' : 'unavailable',
      failures: Object.freeze(owned.failures ?? []),
    });
    notify({ changes, result, phase: 'complete', recoveryAvailable: false });
    return result;
  };
  const controller: DocumentRefresh = {
    async capture() {
      // Capture serves both modes, so only `applyUpdate()` refuses a reload in collaboration.
      const code = refusal('edit');
      if (recovery) throw new DocumentRefreshError('recovery-failed');
      if (code || busy) throw new DocumentRefreshError(code ?? 'busy');
      reset();
      recovery = null;
      const current = generation;
      const epoch = host.epoch;
      const signal = abort.signal;
      notify({
        phase: 'capturing',
        result: null,
        changes: [],
        highlightsVisible: false,
        recoveryAvailable: false,
      });
      try {
        const captured = await settle(signal);
        if (current !== generation || epoch !== host.epoch) throw new Error('superseded');
        const token = Object.freeze({
          id: `${prefix}-${current}`,
          bytes: captured.bytes.slice().buffer as ArrayBuffer,
        });
        active = {
          token,
          epoch,
          revision: captured.revision,
          handle: captured.handle,
          sequence: -1,
          seen: revisionChangeKeys(host),
        };
        notify({ phase: 'processing' });
        return token;
      } catch (error) {
        if (current === generation) notify({ phase: 'failed' });
        throw new DocumentRefreshError(
          current === generation ? 'input-failed' : 'superseded',
          error
        );
      }
    },
    applyUpdate(update) {
      const resultId = `${update.submission?.id ?? 'unknown'}:${update.sequence}`;
      // Own bytes and metadata at delivery. A caller cannot mutate a queued result.
      let owned: RefreshUpdate;
      try {
        if (
          !Number.isSafeInteger(update.sequence) ||
          update.sequence < 0 ||
          !(update.bytes instanceof Uint8Array || update.bytes instanceof ArrayBuffer) ||
          (update.mode !== undefined && update.mode !== 'reload' && update.mode !== 'edit') ||
          (update.failures !== undefined &&
            (!Array.isArray(update.failures) ||
              update.failures.length > 10000 ||
              Array.from(update.failures).some((id) => typeof id !== 'string'))) ||
          (update.changes !== undefined &&
            (!Array.isArray(update.changes) ||
              update.changes.length > 10000 ||
              new Set(update.changes.map((c) => c.id)).size !== update.changes.length ||
              Array.from(update.changes).some(
                (c) =>
                  !c ||
                  typeof c.id !== 'string' ||
                  !c.id ||
                  (c.description !== undefined &&
                    (typeof c.description !== 'string' || c.description.length > 1000)) ||
                  (c.location !== undefined &&
                    (!c.location ||
                      typeof c.location !== 'object' ||
                      (c.location.paragraphId !== undefined &&
                        typeof c.location.paragraphId !== 'string') ||
                      (c.location.paragraphIndex !== undefined &&
                        typeof c.location.paragraphIndex !== 'number') ||
                      typeof c.location.start !== 'number' ||
                      typeof c.location.end !== 'number' ||
                      typeof c.location.text !== 'string')) ||
                  (c.unavailableReason !== undefined &&
                    !['deleted', 'unavailable'].includes(c.unavailableReason))
              )))
        )
          throw new Error('invalid-result');
        owned = {
          ...update,
          bytes: new Uint8Array(
            update.bytes instanceof Uint8Array ? update.bytes : update.bytes
          ).slice(),
          changes: update.changes?.map((c) => ({
            id: c.id,
            description: c.description,
            unavailableReason: c.unavailableReason,
            location: c.location
              ? {
                  paragraphId: c.location.paragraphId,
                  paragraphIndex: c.location.paragraphIndex,
                  start: c.location.start,
                  end: c.location.end,
                  text: c.location.text,
                }
              : undefined,
          })),
          failures: update.failures?.slice(),
        };
      } catch {
        return Promise.resolve(publish(failure(resultId, 'invalid-result')));
      }
      const apply = async (): Promise<RefreshResult> => {
        const request = active;
        const code = refusal(owned.mode);
        if (code) return publish(failure(resultId, code));
        if (!request || request.token !== owned.submission)
          return publish(failure(resultId, 'superseded'));
        if (owned.sequence <= request.sequence) return publish(failure(resultId, 'out-of-order'));
        if (request.epoch !== host.epoch) return publish(failure(resultId, 'document-changed'));
        busy = true;
        const signal = abort.signal;
        const valid = () => active === request && request.epoch === host.epoch && !signal.aborted;
        try {
          const previous = await settle(signal);
          if (!valid()) return publish(failure(resultId, 'cancelled'));
          if (previous.revision !== request.revision)
            return publish(failure(resultId, 'local-edits'), 'failed');
          const bytes = owned.bytes as Uint8Array;
          if (owned.mode === 'edit') {
            // The `replaceDocument` command does the work; refresh tags its change event.
            const outcome = withRefreshEditSource(host.surface()!.session, () =>
              editor.exec({ type: 'replaceDocument', docx: bytes, expected: request.handle })
            ).replaceDocument;
            if (!outcome) return publish(failure(resultId, 'unavailable'), 'failed');
            if (!outcome.ok) return publish(editFailure(resultId, outcome), 'failed');
            return publish(accept(request, resultId, owned, 'edit'));
          }
          if (!readOoxmlPackage(bytes).ok)
            return publish(failure(resultId, 'invalid-document'), 'failed');
          highlights.clear();
          located = [];
          acceptedRevision = null;
          notify({ phase: 'refreshing', changes: [], highlightsVisible: false });
          // Observers can cancel, switch documents, or edit when notified.
          if (!valid()) return publish(failure(resultId, 'cancelled'));
          const finalBytes = host.surface()!.save();
          if (!valid()) return publish(failure(resultId, 'cancelled'));
          if (host.revision !== request.revision)
            return publish(failure(resultId, 'local-edits'), 'failed');
          recovery = { bytes: finalBytes.slice(), epoch: host.epoch };
          const loaded = await host.replace(bytes, 'refresh');
          if (request.epoch !== host.epoch) return publish(failure(resultId, 'document-changed'));
          if (!loaded && !valid()) {
            recovery = null;
            return publish(failure(resultId, 'cancelled'));
          }
          if (!loaded) {
            notify({ phase: 'recovering' });
            if (request.epoch !== host.epoch) return publish(failure(resultId, 'document-changed'));
            const restored = recovery && (await host.replace(recovery.bytes, 'recovery'));
            if (request.epoch !== host.epoch) return publish(failure(resultId, 'document-changed'));
            if (restored) recovery = null;
            active = null;
            return publish(
              failure(resultId, restored ? 'load-failed' : 'recovery-failed', !!restored),
              'failed'
            );
          }
          // Accepted content stays accepted if cancellation races with mount completion.
          recovery = null;
          request.revision = host.mountedRevision;
          return publish(accept(request, resultId, owned, 'reload'));
        } catch {
          return publish(
            failure(resultId, valid() ? 'input-failed' : 'cancelled'),
            valid() ? 'failed' : undefined
          );
        } finally {
          busy = false;
        }
      };
      const result = queue.then(apply);
      queue = result.then(
        () => undefined,
        () => undefined
      );
      return result;
    },
    cancel() {
      const keepRecovery = state.phase === 'recovering' || (!host.surface() && recovery !== null);
      host.cancel();
      generation++;
      active = null;
      abort.abort();
      abort = new AbortController();
      if (!keepRecovery) recovery = null;
      notify({
        phase: keepRecovery ? 'failed' : state.result?.ok ? 'complete' : 'idle',
        result: keepRecovery || state.result?.ok ? state.result : null,
        recoveryAvailable: recovery !== null,
      });
    },
    finish(submission) {
      if (active?.token === submission && !busy) {
        active = null;
        notify({ phase: state.phase === 'processing' ? 'idle' : state.phase });
      }
    },
    snapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onResult(listener) {
      resultListeners.add(listener);
      return () => {
        resultListeners.delete(listener);
      };
    },
    highlightChanges(options) {
      highlights.validate(options);
      if (acceptedRevision !== host.revision) return 0;
      const ids = options?.changeIds === undefined ? null : new Set(options.changeIds);
      const selected = located.filter(
        (entry) =>
          entry.change.status === 'available' &&
          (ids ? ids.has(entry.change.id) : options?.includePrevious || entry.change.isNew)
      );
      highlights.show(selected, options);
      notify({ highlightsVisible: selected.length > 0 });
      return selected.length;
    },
    clearHighlights(options) {
      highlights.hide(options);
      notify({ highlightsVisible: false });
    },
    navigateToChange(id, options = {}) {
      if (options.focus !== undefined && typeof options.focus !== 'boolean')
        throw new TypeError('focus must be a boolean.');
      const reveal = revealScrollOptions(options, 'center', host.container());
      if (acceptedRevision !== host.revision) return false;
      const target = located.find((entry) => entry.change.id === id);
      if (!target?.paragraphId || target.offset === undefined) return false;
      const surface = host.surface();
      if (
        !surface?.revealPosition({ paragraphId: target.paragraphId, offset: target.offset }, reveal)
      )
        return false;
      if (options?.focus) {
        surface.setActiveScope({ kind: 'body' });
        const position = { paragraphId: target.paragraphId, offset: target.offset };
        surface.setSelection({ anchor: position, head: position });
        surface.focus();
      }
      return true;
    },
    recoveryBytes: () => (recovery ? (recovery.bytes.slice().buffer as ArrayBuffer) : null),
    async recover() {
      if (!recovery || recovery.epoch !== host.epoch || busy) return false;
      busy = true;
      const saved = recovery;
      notify({ phase: 'recovering' });
      try {
        if (saved.epoch !== host.epoch) return false;
        const ok = await host.replace(saved.bytes, 'recovery');
        if (saved.epoch !== host.epoch) return false;
        if (ok) recovery = null;
        notify({ phase: ok ? 'idle' : 'failed', recoveryAvailable: !ok });
        return ok;
      } finally {
        busy = false;
      }
    },
  };
  controllers.set(editor, controller);
  return controller;
}
