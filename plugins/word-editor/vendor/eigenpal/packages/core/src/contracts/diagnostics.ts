/**
 * Anonymous diagnostics: why something failed, as stable codes and bucketed numbers.
 *
 * A document is user data. Its text, names, part names, relationship targets, author names and
 * font names never appear in a diagnostic. Every field below is a closed enum, a boolean or a
 * number, so an event can go to an error tracker or a metrics backend as it is. The internal
 * rejection reasons stay internal: they map many-to-one onto {@link DiagnosticCode}, which is
 * the public, versioned vocabulary a host can match on.
 *
 * @packageDocumentation
 */

import type { CollaborationStatus } from '../collaboration/index.ts';
import type { EditorCommand } from './editor.ts';

/** Version of the {@link EditorDiagnostic} shape. Raised only when a field changes meaning. @public */
export const DIAGNOSTIC_SCHEMA_VERSION = 1;

import type {
  DocumentOpenDiagnosticCode,
  DocumentSaveDiagnosticCode,
  EditDiagnosticCode,
  ReviewDiagnosticCode,
  FontDiagnosticCode,
  CollaborationDiagnosticCode,
  DiagnosticCode,
  ByteSizeBucket,
  CountBucket,
  CustomNodeDiagnosticCode,
  HistoryDiagnosticCode,
  PerformanceDiagnosticCode,
  DiagnosticErrorName,
  DocumentPartKind,
  FailureStage,
  FormattingChangeKind,
  ReviewChangeKind,
  ReviewOperation,
} from '../automation/diagnostic-vocabulary.ts';

export type {
  DocumentOpenDiagnosticCode,
  DocumentSaveDiagnosticCode,
  EditDiagnosticCode,
  ReviewDiagnosticCode,
  FontDiagnosticCode,
  CollaborationDiagnosticCode,
  DiagnosticCode,
  ByteSizeBucket,
  CountBucket,
  CustomNodeDiagnosticCode,
  HistoryDiagnosticCode,
  PerformanceDiagnosticCode,
  DiagnosticErrorName,
  DocumentPartKind,
  FailureStage,
  FormattingChangeKind,
  ReviewChangeKind,
  ReviewOperation,
} from '../automation/diagnostic-vocabulary.ts';
export type { DiagnosticExplanation } from '../automation/diagnostic-hints.ts';

/** The bucketed shape of an opened document. @public */
export interface DocumentShape {
  /** XML parts in the package. */
  readonly parts: CountBucket;
  readonly paragraphs: CountBucket;
  /** Tracked changes and comments, as the review queue lists them. */
  readonly reviewItems: CountBucket;
  readonly embeddedFonts: CountBucket;
}

/** Fields every diagnostic carries. @public */
export interface DiagnosticBase {
  /** {@link DIAGNOSTIC_SCHEMA_VERSION} when the event was made. */
  readonly schemaVersion: number;
  /**
   * Random for each editor instance and never stored, so one open failure can be linked to the
   * edits after it. It identifies no person and no document.
   */
  readonly editorSessionId: string;
  /** Milliseconds since the epoch. */
  readonly time: number;
}

/**
 * Anonymous detail of a failure, for the engineer who fixes it. Every field is optional and
 * comes from a closed list: never a part name, an element name, a message, or document text.
 *
 * @public
 */
export interface DiagnosticFailureDetail {
  /**
   * The engine's own reason, such as `undeclared-prefix` under `open.xml-malformed`, or
   * `exception` for an error the engine did not expect. Causes can change between engine
   * versions: match on `code`, and include the `cause` when you report a problem. See
   * `diagnosticCauses()` for every value.
   */
  readonly cause?: string;
  /** The class of the exception when `cause` is `exception`. Its message is never reported. */
  readonly errorName?: DiagnosticErrorName;
  /** Where the exception was caught, when `cause` is `exception`. */
  readonly stage?: FailureStage;
}

/** A document opened, or failed to open. @public */
export type DocumentOpenDiagnostic = DiagnosticBase & {
  readonly kind: 'document.open';
} & (
    | {
        readonly outcome: 'opened';
        /** Compressed size of the bytes the editor was given. */
        readonly sizeBucket: ByteSizeBucket;
        /** Pages after the first layout. Absent on a headless host that does not paginate. */
        readonly pagesBucket?: CountBucket;
        /**
         * More of the document's shape, in buckets. A telemetry client sends it only when you
         * ask for the detailed shape: several counts together describe a document more closely.
         */
        readonly shape?: DocumentShape;
        /** Milliseconds from the start of the open to the mounted first layout. */
        readonly durationMs: number;
      }
    | (DiagnosticFailureDetail & {
        readonly outcome: 'rejected';
        readonly code: DocumentOpenDiagnosticCode;
        /** Compressed size of the bytes, absent when the source was not bytes at all. */
        readonly sizeBucket?: ByteSizeBucket;
        /** The role of the part that failed, such as `'header'`. Never its name. */
        readonly part?: DocumentPartKind;
      })
  );

/**
 * A `save()` call returned the document, or failed. Reported for each call, by the editor that
 * saved. A save the host does afterwards, such as an upload, is the host's to measure.
 *
 * @public
 */
export type DocumentSaveDiagnostic = DiagnosticBase & {
  readonly kind: 'document.save';
} & (
    | {
        readonly outcome: 'saved';
        /** Size of the saved bytes. */
        readonly sizeBucket: ByteSizeBucket;
        /** Milliseconds from the `save()` call to the bytes, pending edits included. */
        readonly durationMs: number;
      }
    | (DiagnosticFailureDetail & {
        readonly outcome: 'rejected';
        readonly code: DocumentSaveDiagnosticCode;
        /** Milliseconds from the `save()` call to the failure. */
        readonly durationMs: number;
      })
  );

/**
 * What an editor did over a window of use or over its whole session. Counts and milliseconds
 * only: no key, position, command argument or text.
 *
 * @public
 */
export interface SessionActivity {
  /**
   * For `active`, milliseconds from the window's first activity to the summary. For `end`,
   * milliseconds from the editor's creation to its end, idle time included.
   */
  readonly durationMs: number;
  /**
   * Milliseconds of use: the time between key presses, pointer presses and edits that are at
   * most 30 seconds apart. A longer pause counts as idle.
   */
  readonly activeMs: number;
  /**
   * Edits from typing, the clipboard, drag and drop, keyboard undo, and other input that changed
   * the document. Each committed change counts once: typing commits about one change per
   * character, and characters typed faster than the editor paints commit together.
   */
  readonly inputEdits: number;
  /** Editor commands, from `exec(...)` or the toolbar, that changed the document. */
  readonly commandEdits: number;
  /** Editing API batches that changed the document. */
  readonly automationEdits: number;
}

/**
 * The lifecycle and activity of one editor instance, without any content.
 *
 * - `start`: the editor was created.
 * - `active`: a summary of one window of use. Sent after a minute of activity, when the page is
 *   hidden, and before `end`, if anything happened since the last summary. An idle editor sends
 *   none, so `active` is not a heartbeat.
 * - `end`: the editor was destroyed, or the page closed. Carries totals for the whole session.
 *
 * Edits count changes this editor committed. Refused edits are in `edit.rejected`, and edits
 * that collaborators made are not counted. Sum `active` summaries or read `end` totals, not
 * both: the totals include every summary.
 *
 * @public
 */
export type SessionDiagnostic = DiagnosticBase & {
  readonly kind: 'session';
} & ({ readonly phase: 'start' } | (SessionActivity & { readonly phase: 'active' | 'end' }));

/** Where a refused edit came from. @public */
export type EditRejectionOrigin = 'command' | 'input' | 'automation';

/** An edit, a command or a tracked change was refused. @public */
export interface EditRejectedDiagnostic extends DiagnosticBase, DiagnosticFailureDetail {
  readonly kind: 'edit.rejected';
  readonly code: EditDiagnosticCode;
  /**
   * `'command'` for `exec(...)`, `'input'` for typing, clipboard, drag and pointer edits, and
   * `'automation'` for a batch from the editing API.
   */
  readonly origin: EditRejectionOrigin;
  /** True when the editor was suggesting (tracking changes) at the time. */
  readonly tracked: boolean;
  /** The command type for `origin: 'command'`, such as `'insertTable'`. */
  readonly command?: EditorCommand['type'];
}

/**
 * An accept, reject or re-author request skipped one or more tracked changes. One event for each
 * code and kind of change in the request.
 *
 * @public
 */
export interface ReviewSkippedDiagnostic extends DiagnosticBase {
  readonly kind: 'review.skipped';
  readonly code: ReviewDiagnosticCode;
  /** How many items were skipped for this code and kind in the one request. */
  readonly count: number;
  /** What the request asked: accept, reject, or attribute to another author. */
  readonly operation?: ReviewOperation;
  /** The kind of the skipped changes, absent when the change no longer exists. */
  readonly changeKind?: ReviewChangeKind;
  /** For `changeKind: 'format'`, which property change it is. */
  readonly formattingKind?: FormattingChangeKind;
  /** The role of the part the changes are in, such as `'footnotes'`. Never its name. */
  readonly part?: DocumentPartKind;
  /**
   * The structure behind the skip. For `review.revision-unsupported`, the engine condition that
   * refused the change, such as `unaddressed` (no `w:id` or author). For
   * `review.incomplete-group`, the change the decision would also decide, such as
   * `paired-change` (the other half of a move or merge) or `removed-content`. For
   * `review.retained-structure`, `nested-table`. See `diagnosticCauses()`.
   */
  readonly cause?: string;
}

/** A font failed to load. The editor kept working with a substitute. @public */
export interface FontFailedDiagnostic extends DiagnosticBase {
  readonly kind: 'font.failed';
  readonly code: FontDiagnosticCode;
}

/**
 * A collaboration session changed status: it joined, disconnected, failed, or healed.
 *
 * @public
 */
export interface CollaborationStatusDiagnostic extends DiagnosticBase {
  readonly kind: 'collab.status';
  readonly status: CollaborationStatus;
  /** The status before this change; `'none'` for the first status the editor saw. */
  readonly previous: CollaborationStatus | 'none';
  /** Why the session holds `status`, when something is wrong. */
  readonly code?: CollaborationDiagnosticCode;
  /** True when the session will heal on its own; wait instead of rejoining. */
  readonly recovering: boolean;
  /**
   * Milliseconds from the editor attaching the session to its first `ready`. Present only on
   * that change, and only when the editor saw the wait: a session that was already ready when
   * the editor attached, as `useHocuspocusCollaboration` makes it, reports none.
   */
  readonly connectMs?: number;
}

/** The undo history did not group edits as the gesture intended. Informational. @public */
export interface HistoryDiagnosticEvent extends DiagnosticBase {
  readonly kind: 'history';
  readonly code: HistoryDiagnosticCode;
}

/** A custom node's stored payload could not be read. The node and its data are not named. @public */
export interface CustomNodeDiagnosticEvent extends DiagnosticBase {
  readonly kind: 'custom-node';
  readonly code: CustomNodeDiagnosticCode;
}

/** The number of people in the collaboration room changed. @public */
export interface CollaborationParticipantsDiagnostic extends DiagnosticBase {
  readonly kind: 'collab.participants';
  /** People present, this editor included. A person with two tabs counts twice. */
  readonly count: number;
}

/**
 * Timings of one kind over a performance window. Every value is in milliseconds, rounded to
 * whole milliseconds.
 *
 * @public
 */
export interface TimingSummary {
  /** Timings measured in the window. */
  readonly count: number;
  /** Median. Exact up to 2048 timings; above that, from a uniform sample of 2048. */
  readonly p50Ms: number;
  /** 95th percentile, from the same sample as the median. */
  readonly p95Ms: number;
  /** The slowest timing, always exact. */
  readonly maxMs: number;
  /**
   * Timings per band, always exact. Eight counts: up to 16, 33, 50, 100, 200, 500, and 1000
   * ms, then over 1000 ms. A metrics backend builds a histogram from these.
   */
  readonly bands: readonly number[];
}

/**
 * How the editor performed while it was used: one summary per window, never one event per key
 * press. Sent after a minute of use, when the page is hidden, and when the editor is destroyed,
 * if anything was measured since the last summary.
 *
 * @public
 */
export interface PerformanceDiagnostic extends DiagnosticBase {
  readonly kind: 'performance';
  /**
   * Present when the summary needs attention: `performance.slow-interaction` when at least 20
   * presses were timed and more than one in 20 took over 200 ms.
   */
  readonly code?: PerformanceDiagnosticCode;
  /**
   * Milliseconds from the window's first timing to the summary, one minute or less. Idle time
   * inside the window counts, so this is not active editing time. Use the `count` of
   * `interaction` to measure activity.
   */
  readonly windowMs: number;
  /** Pages in the document at the last paint. */
  readonly pagesBucket?: CountBucket;
  /**
   * Key presses and pointer presses on the pages, from the browser event to the next frame on
   * screen: the delay a person feels. Presses queued behind slow work count with their full
   * delay. Presses of modifier keys alone, and presses while the page is hidden, are not timed.
   */
  readonly interaction?: TimingSummary;
  /**
   * Engine layout passes that the person causes, by an edit or a view change such as zoom.
   * Each pass includes its main-thread work in the background, and the work of a pass that a
   * newer edit replaced. Layouts that loading causes are not here: the opening layout, which
   * `document.open` reports as `durationMs`, and layouts after fonts or images arrive.
   */
  readonly layout?: TimingSummary;
  /** Engine paints of the pages. */
  readonly paint?: TimingSummary;
}

/**
 * One anonymous diagnostic. Switch on `kind` to narrow `code`.
 *
 * @example
 * ```ts
 * editor.on('diagnostic', (event) => {
 *   if (event.kind === 'edit.rejected') {
 *     console.warn(event.code, explainDiagnostic(event.code).hint);
 *   }
 * });
 * ```
 *
 * @public
 */
export type EditorDiagnostic =
  | DocumentOpenDiagnostic
  | EditRejectedDiagnostic
  | ReviewSkippedDiagnostic
  | FontFailedDiagnostic
  | HistoryDiagnosticEvent
  | CustomNodeDiagnosticEvent
  | CollaborationStatusDiagnostic
  | CollaborationParticipantsDiagnostic
  | PerformanceDiagnostic
  | DocumentSaveDiagnostic
  | SessionDiagnostic;

/** The `kind` of every {@link EditorDiagnostic}. @public */
export type EditorDiagnosticKind = EditorDiagnostic['kind'];
