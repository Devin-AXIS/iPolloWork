/**
 * How a document's opening editing mode is decided — pure decisions over the facade's
 * state, kept out of `docx-editor.ts` so the composition root stays under its line cap.
 *
 * Two callers, in order:
 *
 * 1. `resolveOpeningEditingMode` at CONSTRUCTION: an explicit `config.mode` is the
 *    host's standing choice for every open and wins over the document's own request.
 *    (`'view'` is handled where `editingMode` is initialized; it needs no decision here.)
 * 2. `documentTrackingAdoption` at each MOUNT, once the document's settings are
 *    readable. `w:trackRevisions` ASKS for suggesting: it is a property of the file, not
 *    of the reader, so a package that carries it opens in suggesting — otherwise the
 *    first keystroke is an untracked edit in a document whose author asked for the
 *    opposite, with the pill reading "Editing". An enforced
 *    `w:documentProtection w:edit="trackedChanges"` REQUIRES it: that protection makes
 *    `setEditingMode('editing')` refuse `locked`, so it outranks even an explicit
 *    `mode: 'edit'` — opening in editing there would put the editor in a mode its own
 *    gate refuses to enter.
 *
 * Suggesting has preconditions either way: writing `w:ins`/`w:del` is the review
 * module's capability, and a proposal needs an author to be attributed to. With no
 * module the document opens and edits normally — the edits are simply untracked,
 * exactly as `can(setEditingMode: 'suggesting')` reports. With a module but no author,
 * the editor opens editing and the REASON is published (`rejection`) rather than the
 * request being dropped in silence.
 *
 * The same two preconditions gate the RUNTIME request, `setEditingMode('suggesting')`,
 * through `suggestingModeRefusal`. Entering suggesting without an author used to succeed
 * and then refuse every keystroke: the pill read Suggesting, the document took focus, and
 * typing changed nothing. A missing author is a host configuration error, so the request
 * is refused with the reason, and `createSuggestingConfigurationReporter` raises it once
 * through the editor's error channel for the host that never reads the result.
 */

import type { DocumentEditingMode, EditorError, ExecResult } from '../contracts/editor.ts';
import type { DocumentTrackingSettings } from '../store/package/tracking-settings.ts';
import { editorError } from './docx-editor-support.ts';

/** A refused command, as `can` and `exec` both answer it. */
export type CommandRefusal = Extract<ExecResult, { ok: false }>;

/**
 * The refusal every review write gets when no review module is registered.
 *
 * One string, quoted verbatim by `toolbarCommandState` as the disabled tooltip — the
 * same "the engine's own reason" channel every other unavailable control uses.
 */
export const PRO_REVIEW_REASON =
  'comments and tracked changes require the pro review module (@docx-editor.dev/pro)';

/**
 * The refusal any attach or undo-takeover path gets when no collaboration
 * module is registered.
 */
export const PRO_COLLABORATION_REASON =
  'realtime collaboration requires the pro collaboration module (@docx-editor.dev/pro)';

/**
 * The refusal a HOST request for suggesting gets when no author is configured.
 *
 * One sentence for one configuration error, whether the host asked at construction
 * (`config.mode`), through `setMode`, or through `setEditingMode`: a proposal has to be
 * attributed to someone, and `author` is where the host says who.
 */
export const SUGGESTING_AUTHOR_REASON =
  'suggesting mode needs an author; configure author before enabling it';

/** The published reason when the DOCUMENT asks for tracking and no author is configured. */
const DOCUMENT_TRACKING_AUTHOR_REASON =
  'this document asks for tracked changes, but no author is configured';

/**
 * The refusal suggesting gets under enforced filling-in-forms protection.
 *
 * Word greys Track Changes out there and refuses to turn it on, so a document protected this
 * way never carries a tracked edit made in Word. Entering suggesting used to succeed and then
 * refuse every keystroke: the pill read Suggesting while the document ignored typing.
 */
export const FORMS_PROTECTION_SUGGESTING_REASON =
  'this document is protected for filling in forms, which does not track changes';

/** Leaving suggesting under protection that allows only tracked changes. */
export const TRACKED_ONLY_EDITING_REASON = 'this document permits editing only as tracked changes';

/** Replacing a picture's bytes has no tracked-change form. */
export const SUGGESTING_IMAGE_REPLACE_REASON = 'image changes are not supported in suggesting mode';

/** Accepting or rejecting a revision kind the review lane only reads. */
export const READ_ONLY_REVISION_REASON = 'this revision kind has no structural accept/reject yet';

/**
 * The refusal every mode but viewing gets under enforced read-only protection.
 *
 * The document permits no edit (or only a comment), so the editor opens VIEWING rather than
 * presenting an editing pill over a document that refuses every keystroke. That silent-drop
 * shape is the defect this gate exists to prevent: a reader has to be able to SEE that the
 * document is protected, and the mode pill is where the engine says so.
 */
export const READ_ONLY_PROTECTION_REASON =
  'this document is protected against editing; open it in Word to change that';

/** Comments-only keeps review writes available and refuses content edits. */
export const COMMENTS_PROTECTION_REASON = 'this document is protected for comments only';

/** What a decision asks the facade to do: adopt a mode, publish a refusal, or neither. */
export interface OpeningModeDecision {
  /** The mode to open in, or null to leave the current mode alone. */
  readonly mode: DocumentEditingMode | null;
  /** The published reason a requested mode was not entered, or null. */
  readonly rejection: string | null;
}

const NO_DECISION: OpeningModeDecision = { mode: null, rejection: null };

/** Suggesting's preconditions, read by both decisions. */
export interface OpeningModeGuards {
  /** True when a review module is registered (suggesting writes `w:ins`/`w:del`). */
  readonly reviewEnabled: boolean;
  /** True when `config.author` names someone a proposal can be attributed to. */
  readonly hasAuthor: boolean;
}

/**
 * The host's construction-time choice, or nothing when `config.mode` is omitted.
 * Runs before the first mount reads the mode, so the surface comes up in it directly.
 */
export function resolveOpeningEditingMode(
  requested: 'edit' | 'view' | 'suggesting' | undefined,
  guards: OpeningModeGuards
): OpeningModeDecision {
  if (requested === undefined || requested === 'view') return NO_DECISION;
  if (requested === 'edit') return { mode: 'editing', rejection: null };
  const refusal = suggestingModeRefusal(guards);
  if (refusal !== null) return { mode: null, rejection: refusal.reason };
  return { mode: 'suggesting', rejection: null };
}

/**
 * Why a request to enter suggesting is refused right now, or null when it can be entered.
 *
 * ONE statement of suggesting's preconditions, asked by `can` and `exec` for
 * `setEditingMode('suggesting')` and by the construction-time decision above, so the
 * toolbar's disabled reason, the command's refusal and the published rejection are the
 * same sentence. The module comes first: without one there is no author to miss.
 */
export function suggestingModeRefusal(guards: OpeningModeGuards): CommandRefusal | null {
  if (!guards.reviewEnabled) return { ok: false, code: 'unsupported', reason: PRO_REVIEW_REASON };
  if (!guards.hasAuthor) {
    return { ok: false, code: 'invalidArgs', reason: SUGGESTING_AUTHOR_REASON };
  }
  return null;
}

/** The once-per-editor report of the suggesting-without-author configuration error. */
export interface SuggestingConfigurationReporter {
  /** Raise the error for `rejection` when it is the author one; every other reason is ignored. */
  report(rejection: string | null): void;
  /** Drop a report still waiting; the editor is going away. */
  dispose(): void;
}

/**
 * Raise the suggesting-without-author configuration error once per editor.
 *
 * The refusal already reaches the host as an `ExecResult` and as the published
 * `lastRejection`; this is for the host that reads neither, like an `onReady` that calls
 * `setEditingMode('suggesting')` and drops the result. It goes out through the editor's
 * `error` event, the channel every other engine-raised error uses, AND once on the console.
 * Not gated on a listener the way `reportFontError` is: the adapters subscribe to `error`
 * themselves, only to re-render, so a listener count cannot tell a host from an adapter
 * and the gate would silence exactly the React and Vue hosts #692 came from. One line per
 * editor for a developer's configuration mistake is the level of noise a prop warning has.
 *
 * DEFERRED by a task, not raised inline. The adapters build the instance from first-render
 * props and apply a later `author` from an effect, and StrictMode builds, destroys and
 * rebuilds the instance before either; a report raised at construction would name a
 * misconfiguration those hosts fix a moment later. `stillMissing` is asked when the task
 * runs, so an author that arrived or an editor that was destroyed in between raises nothing.
 */
export function createSuggestingConfigurationReporter(input: {
  /** True while the author is still missing and the editor is still alive. */
  readonly stillMissing: () => boolean;
  readonly emit: (error: EditorError) => void;
  readonly log?: (message: string) => void;
}): SuggestingConfigurationReporter {
  let reported = false;
  let pending: ReturnType<typeof globalThis.setTimeout> | null = null;
  const log = input.log ?? ((message: string) => console.error(message));
  return {
    report(rejection) {
      if (rejection !== SUGGESTING_AUTHOR_REASON || reported || pending !== null) return;
      // A deferred report, not UI timing: any window's task will do.
      pending = globalThis.setTimeout(() => {
        pending = null;
        if (!input.stillMissing()) return;
        reported = true;
        const message =
          `${SUGGESTING_AUTHOR_REASON}. Edits are not tracked until an author is set ` +
          '(the author option at construction, setAuthor(), or the adapter author prop).';
        input.emit(editorError('suggestingNeedsAuthor', message));
        log(`[@docx-editor.dev/core] ${message}`);
      }, 0);
    },
    dispose() {
      if (pending !== null) globalThis.clearTimeout(pending);
      pending = null;
    },
  };
}

/**
 * The document's own tracking request at mount, or nothing. See the module comment for
 * the ask/require split; the reader-side overrides are `viewOnly`, a mode the reader
 * has already moved off (`readerChoseMode` — a reload must not undo their choice), and,
 * for the ASK only, an explicit `config.mode` (`hostChoseMode`).
 */
export function documentTrackingAdoption(
  input: OpeningModeGuards & {
    /** True when the facade was constructed `mode: 'view'` — outranks every request. */
    readonly viewOnly: boolean;
    readonly hostChoseMode: boolean;
    readonly readerChoseMode: boolean;
    readonly currentMode: DocumentEditingMode;
    /** The document's `w:trackRevisions` request. */
    readonly trackRevisions: boolean;
    /** Enforced `w:documentProtection w:edit="trackedChanges"` — see the module comment. */
    readonly restrictedToTrackedChanges: boolean;
    /** Enforced `w:documentProtection w:edit="forms"` — tracking is unavailable. */
    readonly restrictedToForms: boolean;
    /** Enforced `w:edit="readOnly"` — no edit at all. */
    readonly restrictedToReadOnly: boolean;
    /** Enforced `w:edit="comments"` — comments only. */
    readonly restrictedToComments: boolean;
    /** True when the ENGINE put the editor in viewing, because a protection demanded it. */
    readonly engineAdoptedViewing?: boolean;
  }
): OpeningModeDecision {
  // A document that permits no editing opens VIEWING, whatever anyone asked for. Every other
  // outcome puts an editing pill over a document whose every write the store refuses.
  if (input.restrictedToReadOnly) {
    return input.currentMode === 'viewing'
      ? NO_DECISION
      : { mode: 'viewing', rejection: READ_ONLY_PROTECTION_REASON };
  }
  // ...and the adoption ENDS with the restriction that caused it. Without this the mode
  // outlived its document: opening a read-only file and then an ordinary one left the second
  // one read-only, with no reason published and no way back but a manual mode change. Undo of
  // a protection change is the same story from the other side.
  let current = input.currentMode;
  let released: DocumentEditingMode | null = null;
  if (input.engineAdoptedViewing && current === 'viewing' && !input.viewOnly) {
    released = 'editing';
    current = 'editing';
  }
  const settled: OpeningModeDecision =
    released === null ? NO_DECISION : { mode: released, rejection: null };
  // Comments need the editing surface, but can never become tracked content writes.
  if (input.restrictedToComments) {
    return current === 'suggesting' && !input.viewOnly
      ? { mode: 'editing', rejection: COMMENTS_PROTECTION_REASON }
      : settled;
  }
  // Forms also refuse suggesting. The released mode preserves field filling after a
  // read-only document; the previous document's viewing adoption must not outlive it.
  if (input.restrictedToForms) {
    return current === 'suggesting' && !input.viewOnly
      ? { mode: 'editing', rejection: FORMS_PROTECTION_SUGGESTING_REASON }
      : settled;
  }
  if (input.viewOnly || current !== 'editing' || input.readerChoseMode) return settled;
  const asks = input.trackRevisions && !input.hostChoseMode;
  if (!asks && !input.restrictedToTrackedChanges) return settled;
  if (!input.reviewEnabled) return settled;
  if (!input.hasAuthor) return { mode: released, rejection: DOCUMENT_TRACKING_AUTHOR_REASON };
  return { mode: 'suggesting', rejection: null };
}

/**
 * What an arriving author does to a suggesting request that was refused for the want of one.
 *
 * The request was refused for the AUTHOR, which means the DOCUMENT's own rules were never
 * asked. Completing it unasked put the editor in a mode its own `can` refuses — and the
 * adapters apply `author` from a later effect, so a Suggesting click that lands before the
 * prop arrives takes exactly this path.
 */
export function completePendingSuggesting(refusal: CommandRefusal | null): {
  readonly enter: boolean;
  readonly rejection: string | null;
} {
  return refusal === null
    ? { enter: true, rejection: null }
    : { enter: false, rejection: refusal.reason };
}

/**
 * Refuse a mode the document's protection rules out: editing when only tracked changes are
 * permitted, suggesting when filling-in-forms protection makes tracking unavailable.
 */
export function documentEditingModeRestriction(
  tracking: DocumentTrackingSettings,
  next: DocumentEditingMode
): CommandRefusal | null {
  if (next !== 'viewing' && tracking.restrictedToReadOnly) {
    return { ok: false, code: 'locked', reason: READ_ONLY_PROTECTION_REASON };
  }
  if (next === 'suggesting' && tracking.restrictedToComments) {
    return { ok: false, code: 'locked', reason: COMMENTS_PROTECTION_REASON };
  }
  if (next === 'suggesting' && tracking.restrictedToForms) {
    return { ok: false, code: 'locked', reason: FORMS_PROTECTION_SUGGESTING_REASON };
  }
  if (next !== 'editing' || !tracking.restrictedToTrackedChanges) return null;
  return {
    ok: false,
    code: 'locked',
    reason: TRACKED_ONLY_EDITING_REASON,
  };
}

/**
 * Why switching to `mode` is refused right now, or null: ONE ladder for `can` and `exec`. The
 * guards and the tracking settings are read only when a rung needs them.
 */
export function refusalOfEditingMode(
  hostViewOnly: boolean,
  guards: () => OpeningModeGuards,
  tracking: () => DocumentTrackingSettings,
  mode: DocumentEditingMode
): CommandRefusal | null {
  // A document opened with `mode: 'view'` is read-only for the session; the pill stays.
  if (hostViewOnly && mode !== 'viewing') {
    return { ok: false, code: 'locked', reason: 'this document was opened for viewing' };
  }
  const suggesting = mode === 'suggesting' ? suggestingModeRefusal(guards()) : null;
  return suggesting ?? documentEditingModeRestriction(tracking(), mode);
}

/** Resolve live host intent against the document whose surface is being edited. */
export function resolveHostEditingMode(
  requested: 'edit' | 'view' | 'suggesting' | undefined,
  guards: OpeningModeGuards,
  tracking: DocumentTrackingSettings,
  currentMode: DocumentEditingMode,
  fallback: DocumentEditingMode,
  /** See {@link documentTrackingAdoption}: without it this lane's viewing outlives its file. */
  engineAdoptedViewing = false
): { mode: DocumentEditingMode; rejection: string | null; configurationRejection: string | null } {
  const host = resolveOpeningEditingMode(requested, guards);
  let mode: DocumentEditingMode = requested === 'view' ? 'viewing' : (host.mode ?? fallback);
  const document = documentTrackingAdoption({
    ...guards,
    ...tracking,
    viewOnly: requested === 'view',
    hostChoseMode: requested !== undefined,
    readerChoseMode: false,
    currentMode: mode,
    engineAdoptedViewing,
  });
  if (document.mode !== null) mode = document.mode;
  const restriction = documentEditingModeRestriction(tracking, mode);
  // A refused mode falls back to the one the protection permits: viewing when nothing may be
  // edited, otherwise the mode already in force.
  const permitted = tracking.restrictedToReadOnly ? 'viewing' : currentMode;
  return {
    mode: restriction === null ? mode : permitted,
    rejection: document.rejection ?? restriction?.reason ?? null,
    configurationRejection: host.rejection,
  };
}
