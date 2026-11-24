import type { CanResult, EditorCommand, ExecResult } from '../contracts/editor.ts';
import type { ExecErrorCode } from '../contracts/types.ts';
import type {
  CompareDocumentsChromeHandlers,
  CompareDocumentsDialogSession,
  CompareDocumentsOutcome,
  CompareDocumentsRequest,
} from '../contracts/compare-documents.ts';
import type {
  CompareDocumentsBackgroundEngine,
  CompareDocumentsEngineOptions,
  CompareDocumentsErrorCode,
  CompareDocumentsProgress,
  CompareDocumentsRefusalReason,
} from '../contracts/document-compare.ts';
import {
  readOoxmlPackage,
  writeOoxmlPackage,
  type OoxmlPackage,
} from '../store/package/ooxml-package.ts';
import type { CompareDocumentsDialog, ReviewModuleContribution } from '../contracts/modules.ts';
import { readDocumentProtection } from '../store/package/document-protection.ts';
import { settingsPartOf } from '../store/package/note-properties.ts';
import { commandProtectionRefusal } from './command-protection.ts';
import { createEditorAnnouncer } from './editor-announcer.ts';
import { createT, en } from '@docx-editor.dev/i18n';
import { hostTimers } from './host-realm.ts';
import { PRO_REVIEW_REASON } from './opening-editing-mode.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import type { PopupChromeRegistrationOptions } from './popup-sessions.ts';
import { createSessionChrome } from './text-form-field-chrome.ts';
import {
  PREVIEW_WRITE_REFUSAL,
  REFRESH_WRITE_REFUSAL,
  refreshWriteBlocked,
  writeBlockReason,
} from './refresh-write-guard.ts';

/**
 * Stable refusal while a collaboration session is attached. `DISABLED_REASON_KEYS` in
 * `@docx-editor.dev/i18n` translates it; the two must stay the same sentence.
 */
export const COMPARE_COLLABORATION_REASON =
  'documents cannot be compared while a collaboration session is attached';
export const COMPARE_FORMS_PROTECTION_REASON =
  'this document is protected; only form fields can be filled';
const COMPARE_PROTECTION_REASON = 'this document is protected against edits';

export interface CompareDocumentsStateHost {
  container(): HTMLElement | null;
  destroyed(): boolean;
  contribution(): ReviewModuleContribution | null;
  translate(): ((key: string, params?: Record<string, string | number>) => string) | undefined;
  surface(): PaginatedSurface | null;
  /** Whether the document is open for viewing only (view-only host or viewing mode). */
  viewing(): boolean;
}

const VIEWING_REASON = 'the document is open for viewing';
const EMPTY_REASON = 'the revised document is empty';
const CLOSED_REASON = 'the dialog is closed';
const BUSY_REASON = 'another compare of this dialog is running';
const CHANGED_REASON = 'the document changed while the compare ran';
const NOT_BYTES_REASON = 'revised must be a Uint8Array';
const english = createT(en) as (key: string, params?: Record<string, string | number>) => string;
/** Where progress stands while the result is applied: the layout of the result remains. */
const APPLYING_FRACTION = 0.95;

type CompareExec = ExecResult & {
  readonly revisionCount?: number;
  readonly engineCode?: CompareDocumentsErrorCode;
  readonly engineReason?: CompareDocumentsRefusalReason;
};

/** The outcome's `reason` for an engine refusal that names one. */
const reasonOf = (result: CompareExec) =>
  result.engineReason === undefined ? {} : { reason: result.engineReason };

/** The stable code a dialog translates for one refused compare. */
function refusalOf(
  result: { readonly code?: string; readonly reason?: string },
  engineCode?: CompareDocumentsErrorCode
): CompareDocumentsErrorCode {
  // The engine's codes are refusal codes as they are.
  if (engineCode) return engineCode;
  if (result.reason === COMPARE_COLLABORATION_REASON) return 'collaboration';
  if (result.reason === VIEWING_REASON) return 'viewing';
  if (result.reason === EMPTY_REASON) return 'empty';
  if (result.reason === CLOSED_REASON) return 'closed';
  if (
    result.reason === BUSY_REASON ||
    result.reason === REFRESH_WRITE_REFUSAL ||
    result.reason === PREVIEW_WRITE_REFUSAL
  )
    return 'busy';
  if (result.reason === CHANGED_REASON) return 'documentChanged';
  if (result.reason === PRO_REVIEW_REASON || result.code === 'notFound') return 'unavailable';
  if (result.code === 'locked' || result.code === 'protected') return 'protected';
  return 'failed';
}

const isBytes = (value: unknown): value is Uint8Array =>
  Object.prototype.toString.call(value) === '[object Uint8Array]';

/** The `exec` code of an engine refusal that is not about the arguments. */
const ENGINE_EXEC_CODES: Partial<Record<CompareDocumentsErrorCode, ExecErrorCode>> = {
  protected: 'locked',
  // The original is the open document, not an argument.
  invalidOriginal: 'unsupported',
  tooLarge: 'unsupported',
  unsupportedContent: 'unsupported',
};

/** Why the command's options are not valid, or null. Options are checked, never coerced. */
function invalidOption(request: CompareDocumentsRequest): string | null {
  if (request.authorName !== undefined && typeof request.authorName !== 'string')
    return 'authorName must be a string';
  for (const name of ['detectFormatChanges', 'removeDateAndTime'] as const)
    if (request[name] !== undefined && typeof request[name] !== 'boolean')
      return `${name} must be a boolean`;
  return null;
}

/**
 * A refusal of the `compareDocuments` command from outside the compare itself (a blocked
 * write, an unsupported history group), with the outcome every compare result carries.
 */
export function withCompareOutcome(
  command: EditorCommand,
  result: Extract<CanResult, { ok: false }>
): ExecResult {
  if (command.type !== 'compareDocuments') return result;
  return {
    ...result,
    compareDocuments: { ok: false, code: refusalOf(result), message: result.reason },
  };
}

/**
 * Compare documents: the command that records a revised DOCX's differences in the open
 * document as tracked changes, and the dialog session that collects its input.
 *
 * The open document is the original. The engine runs on the live package, so nothing is saved
 * first, and the result installs as ONE package undo unit: undo restores the original in one
 * step, redo reapplies the compare.
 */
export function createCompareDocumentsState(host: CompareDocumentsStateHost) {
  let dialog: CompareDocumentsDialog | null = null;
  let active: CompareDocumentsDialogSession | null = null;
  const chrome = createSessionChrome<CompareDocumentsDialogSession>();
  const timers = hostTimers(() => host.container());
  const announcer = createEditorAnnouncer(() => host.container());

  /** Say what a compare recorded, once the dialog that ran it has closed. */
  const announceRecorded = (revisionCount: number): void => {
    const translate = host.translate() ?? english;
    announcer.announce(
      revisionCount > 0
        ? translate('compareDocuments.recorded', { count: revisionCount })
        : translate('compareDocuments.recordedNoRevisions')
    );
  };

  // A frame callback runs before the paint it belongs to, so the work goes in a task queued
  // from it: the first slot after the busy state is on screen. A hidden window fires no
  // frames, so a timer goes on without one.
  const afterPaint = () =>
    new Promise<void>((resolve) => {
      const fallback = timers.setTimeout(() => {
        timers.cancelAnimationFrame(frame);
        resolve();
      }, 250);
      const frame = timers.requestAnimationFrame(() => {
        timers.clearTimeout(fallback);
        timers.setTimeout(resolve, 0);
      });
    });

  const canCompare = (): CanResult => {
    if (host.destroyed())
      return { ok: false, code: 'notFound', reason: 'the editor was destroyed' };
    if (!host.contribution()?.compareDocuments)
      return { ok: false, code: 'unsupported', reason: PRO_REVIEW_REASON };
    const surface = host.surface();
    if (!surface) return { ok: false, code: 'notFound', reason: 'no document is open' };
    if (surface.collaborationSession())
      return { ok: false, code: 'unsupported', reason: COMPARE_COLLABORATION_REASON };
    if (host.viewing()) return { ok: false, code: 'locked', reason: VIEWING_REASON };
    // A preview or an external refresh blocks writes; the compare waits for it to end.
    const container = host.container();
    if (container && refreshWriteBlocked(container))
      return { ok: false, code: 'unsupported', reason: writeBlockReason(container) };
    const protectedWrite = commandProtectionRefusal(
      { type: 'compareDocuments', revised: new Uint8Array() },
      surface
    );
    if (protectedWrite) return protectedWrite;
    const protection = readDocumentProtection(
      settingsPartOf(surface.session.currentPackage())?.root
    );
    if (protection.enforced && protection.edit === 'forms')
      return { ok: false, code: 'locked', reason: COMPARE_FORMS_PROTECTION_REASON };
    // Comments protection forbids content edits. Tracked-changes protection allows only
    // tracked ones, and a compare also writes differences that have no tracked form.
    if (
      protection.enforced &&
      (protection.edit === 'comments' || protection.edit === 'trackedChanges')
    )
      return { ok: false, code: 'locked', reason: COMPARE_PROTECTION_REASON };
    return { ok: true };
  };

  const canOpen = (): CanResult => {
    const result = canCompare();
    if (!result.ok) return result;
    if (!host.contribution()?.createCompareDocumentsDialog)
      return { ok: false, code: 'unsupported', reason: PRO_REVIEW_REASON };
    if (!host.container())
      return { ok: false, code: 'notFound', reason: 'the editor is not attached' };
    return { ok: true };
  };

  /** The checks and engine options of one compare, or why it cannot run. */
  const prepare = (
    request: CompareDocumentsRequest
  ): { readonly refused: CompareExec } | { readonly options: CompareDocumentsEngineOptions } => {
    const allowed = canCompare();
    if (!allowed.ok) return { refused: allowed };
    if (!isBytes(request.revised)) {
      return {
        refused: {
          ok: false,
          code: 'invalidArgs',
          reason: NOT_BYTES_REASON,
          engineCode: 'invalidOptions',
        },
      };
    }
    if (request.revised.byteLength === 0)
      return { refused: { ok: false, code: 'invalidArgs', reason: EMPTY_REASON } };
    const invalid = invalidOption(request);
    if (invalid) {
      return {
        refused: { ok: false, code: 'invalidArgs', reason: invalid, engineCode: 'invalidOptions' },
      };
    }
    const surface = host.surface()!;
    surface.flushPendingInput();
    const authorName = request.authorName?.trim() || surface.author();
    return {
      options: {
        ...(authorName ? { authorName } : {}),
        detectFormatChanges: request.detectFormatChanges !== false,
        ...(request.removeDateAndTime === true ? { removeDateAndTime: true } : {}),
      },
    };
  };

  const engineRefusal = (result: {
    code: CompareDocumentsErrorCode;
    reason?: CompareDocumentsRefusalReason;
    message: string;
  }) => ({
    ok: false as const,
    code: ENGINE_EXEC_CODES[result.code] ?? 'invalidArgs',
    reason: result.message,
    engineCode: result.code,
    ...(result.reason === undefined ? {} : { engineReason: result.reason }),
  });

  /** Install a compare result as one package undo unit. */
  const install = (pkg: OoxmlPackage, revisionCount: number): CompareExec => {
    const replaced = host.surface()!.session.replacePackage(pkg);
    if (!replaced.ok)
      return {
        ok: false,
        code: 'unsupported',
        reason: `the compare result was refused: ${replaced.reason}`,
      };
    return { ok: true, changed: replaced.change !== null, revisionCount };
  };

  const compare = (request: CompareDocumentsRequest): CompareExec => {
    const prepared = prepare(request);
    if ('refused' in prepared) return prepared.refused;
    const surface = host.surface()!;
    const result = host.contribution()!.compareDocuments!(
      surface.session.currentPackage(),
      request.revised,
      prepared.options
    );
    if (!result.ok) return engineRefusal(result);
    return install(result.package, result.revisionCount);
  };

  /**
   * The same compare through the background engine. Only the copy of the original and the
   * install of the result run on the main thread. The open document must not change while
   * the compare runs: a result for an older document is never installed.
   */
  const compareInBackground = async (
    request: CompareDocumentsRequest,
    engine: CompareDocumentsBackgroundEngine,
    signal: AbortSignal,
    onProgress: (progress: CompareDocumentsProgress) => void
  ): Promise<CompareExec> => {
    const prepared = prepare(request);
    if ('refused' in prepared) return prepared.refused;
    const surface = host.surface()!;
    const start = surface.session.currentPackage();
    // A worker reports progress as soon as it starts. One that fails before that never ran (for
    // example, its script is gone after a deploy), so the compare runs on the main thread.
    let started = false;
    let result: Awaited<ReturnType<CompareDocumentsBackgroundEngine>>;
    try {
      result = await engine(writeOoxmlPackage(start), request.revised, prepared.options, {
        signal,
        onProgress: (progress) => {
          started = true;
          onProgress(progress);
        },
      });
    } catch (error) {
      if (started || signal.aborted) throw error;
      onProgress({ phase: 'comparing', fraction: 0 });
      await afterPaint();
      signal.throwIfAborted();
      if (host.surface() !== surface || surface.session.currentPackage() !== start)
        return { ok: false, code: 'unsupported', reason: CHANGED_REASON };
      return compare(request);
    }
    if (!result.ok) return engineRefusal(result);
    const current = (): CanResult => {
      const allowed = canCompare();
      if (!allowed.ok) return allowed;
      if (host.surface() !== surface || surface.session.currentPackage() !== start)
        return { ok: false, code: 'unsupported', reason: CHANGED_REASON };
      return allowed;
    };
    const before = current();
    if (!before.ok) return before;
    if (!result.changed || !result.bytes)
      return { ok: true, changed: false, revisionCount: result.revisionCount };
    onProgress({ phase: 'applying', fraction: APPLYING_FRACTION });
    await afterPaint();
    signal.throwIfAborted();
    const after = current();
    if (!after.ok) return after;
    const read = readOoxmlPackage(result.bytes);
    if (!read.ok)
      return { ok: false, code: 'unsupported', reason: `the compare result cannot be read` };
    return install(read.package, result.revisionCount);
  };

  const destroyDialog = (): void => {
    if (active) {
      active.cancel();
      return;
    }
    const previous = dialog;
    dialog = null;
    previous?.destroy();
  };

  const createSession = (): CompareDocumentsDialogSession => {
    const controller = new AbortController();
    const background = host.contribution()?.compareDocumentsInBackground;
    let running = false;
    const session: CompareDocumentsDialogSession = {
      signal: controller.signal,
      defaultAuthor: host.surface()?.author() ?? '',
      originalHasTrackedChanges:
        host
          .surface()
          ?.session.reviewItems()
          .some((item) => item.kind === 'revision') ?? false,
      canApply: () =>
        active === session && !controller.signal.aborted && !running && canCompare().ok,
      cancelable: background !== undefined,
      async apply(request, options): Promise<CompareDocumentsOutcome> {
        // Progress never goes back, and stops once the dialog closes.
        let reached = 0;
        const report = (progress: CompareDocumentsProgress): void => {
          if (controller.signal.aborted || progress.fraction < reached) return;
          reached = progress.fraction;
          options?.onProgress?.(progress);
        };
        if (!session.canApply()) {
          // A second submission while one runs is refused explicitly; nothing is queued.
          if (running && active === session && !controller.signal.aborted)
            return { ok: false, code: 'busy', message: BUSY_REASON };
          const refusal = canCompare();
          if (refusal.ok) return { ok: false, code: 'closed', message: CLOSED_REASON };
          return { ok: false, code: refusalOf(refusal), message: refusal.reason };
        }
        running = true;
        // The dialog paints its busy state before the synchronous compare.
        await afterPaint();
        try {
          if (controller.signal.aborted)
            return { ok: false, code: 'closed', message: CLOSED_REASON };
          const result = background
            ? await compareInBackground(request, background, controller.signal, report)
            : compare(request);
          if (!result.ok)
            return {
              ok: false,
              code: refusalOf(result, result.engineCode),
              ...reasonOf(result),
              message: result.reason,
            };
          const revisionCount = result.revisionCount ?? 0;
          // With no differences the dialog stays open, so it can say so. Otherwise it closes,
          // and the editor's own live region says what the compare recorded. The document takes
          // focus, so the user can review or undo the result at once: the dialog's opener can be
          // a menu item that is gone, or the page itself.
          if (result.changed) {
            session.cancel();
            host.surface()?.focus();
            announceRecorded(revisionCount);
          }
          return { ok: true, revisionCount, changed: result.changed };
        } catch (error) {
          if (controller.signal.aborted)
            return { ok: false, code: 'closed', message: CLOSED_REASON };
          const message = error instanceof Error ? error.message : String(error);
          return { ok: false, code: 'failed', message };
        } finally {
          running = false;
        }
      },
      cancel() {
        if (controller.signal.aborted) return;
        if (active === session) active = null;
        const previous = dialog;
        dialog = null;
        controller.abort();
        previous?.destroy();
      },
    };
    return session;
  };

  const showNative = (session: CompareDocumentsDialogSession): void => {
    dialog = host.contribution()!.createCompareDocumentsDialog!({
      signal: session.signal,
      defaultAuthor: session.defaultAuthor,
      originalHasTrackedChanges: session.originalHasTrackedChanges,
      cancelable: session.cancelable,
      canApply: session.canApply,
      apply: session.apply,
      cancel: session.cancel,
      container: host.container()!,
      translate: (key) => host.translate()?.(key),
    });
    if (session.signal.aborted) destroyDialog();
    else dialog.open();
  };

  const open = (): ExecResult => {
    const result = canOpen();
    if (!result.ok) return result;
    destroyDialog();
    const session = createSession();
    active = session;
    try {
      if (!chrome.request(session)) showNative(session);
    } catch (error) {
      session.cancel();
      throw error;
    }
    return { ok: true, changed: false };
  };

  return {
    canOpen,
    canCompare,
    open,
    compare,
    destroyDialog,
    register(
      handlers: CompareDocumentsChromeHandlers | null,
      options?: PopupChromeRegistrationOptions
    ) {
      return chrome.register(handlers ?? { onRequest: showNative }, options);
    },
    /** `exec` for the two compare commands; null for every other command. */
    exec(command: EditorCommand): ExecResult | null {
      if (command.type === 'openCompareDocumentsDialog') return open();
      if (command.type !== 'compareDocuments') return null;
      let result: CompareExec;
      try {
        result = compare(command);
      } catch (error) {
        // A write answers with a result, never a throw.
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          code: 'unsupported',
          reason: message,
          compareDocuments: { ok: false, code: 'failed', message },
        };
      }
      if (result.ok)
        return {
          ok: true,
          changed: result.changed,
          compareDocuments: {
            ok: true,
            revisionCount: result.revisionCount ?? 0,
            changed: result.changed,
          },
        };
      return {
        ok: false,
        code: result.code,
        reason: result.reason,
        compareDocuments: {
          ok: false,
          code: refusalOf(result, result.engineCode),
          ...reasonOf(result),
          message: result.reason,
        },
      };
    },
    /** `can` for the two compare commands; null for every other command. */
    can(command: EditorCommand): CanResult | null {
      if (command.type === 'openCompareDocumentsDialog') return canOpen();
      return command.type === 'compareDocuments' ? canCompare() : null;
    },
  };
}
