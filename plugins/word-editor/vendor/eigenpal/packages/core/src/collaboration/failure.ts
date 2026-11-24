/**
 * Lifecycle state of one collaboration replica.
 *
 * One axis, because the only question a host has to answer is whether to tell the reader to
 * wait or to reload:
 *
 * - `initializing` — joining. Edits are refused. Recovers on its own.
 * - `ready` — replicating. Accepts edits.
 * - `disconnected` — the transport dropped. The replica is intact and recovers on its own,
 *   so wait rather than reload. Edits continue by default, and the buffered updates merge on
 *   reconnect. A session created with `offlineEditing: false` refuses them until reconnect.
 * - `error` — this replica does not agree with the room. Edits are refused.
 *   {@link CollaborationStatusSnapshot.reason} says why. A remote update the replica could
 *   not apply yet heals when a later update completes shared state
 *   ({@link CollaborationStatusSnapshot.recovering}). A format or version mismatch needs an
 *   upgrade of this client or the room; every other cause needs a rejoin.
 * - `destroyed` — torn down. Terminal.
 *
 * @public
 */
export type CollaborationStatus = 'initializing' | 'ready' | 'disconnected' | 'error' | 'destroyed';

/**
 * Why a replica refused work, left `ready`, or failed a schema check.
 *
 * Free-form extras (a transport phrase, a blob key, a store refusal) travel in
 * {@link CollaborationFailure.detail}, not here. Branch on the code; log the detail.
 *
 * Codes are grouped by cause, and each group comment names the host action. In `error`, only
 * a remote update that is not applied yet, or one refused local edit, heals on its own. The
 * failure codes table in the collaboration reference lists every code.
 * `transport-disconnected` and `authentication-failed` need opposite answers: wait for the
 * first; refresh the credential and rejoin for the second. `room-generation-changed` means
 * the server compacted the room while this replica was away: save a copy if it holds unsent
 * changes, then rejoin.
 *
 * @public
 */
export type CollaborationFailureCode =
  /** Edit refused by the session gate. The status does not change. Wait for `ready`. */
  | 'collaboration-session-destroyed'
  | 'collaboration-session-not-attached'
  | 'collaboration-session-not-ready'
  | 'collaboration-text-limit'
  | 'experimental-collaboration-body-text-only'
  /** Factory input rejected before joining. Fix the value the host passed. */
  | 'invalid-document-id'
  | 'invalid-identity'
  | 'invalid-identity-color'
  | 'invalid-session-id'
  /** Join or seed did not complete. Connect the provider, check the room id, and retry. */
  | 'already-initialized'
  | 'document-id-mismatch'
  | 'initialization-aborted'
  | 'initialization-timeout'
  | 'not-initialized'
  /** The seed document cannot seed a room. Fix the file. */
  | 'baseline-too-large'
  | 'blob-read'
  | 'invalid-baseline'
  | 'missing-local-blob'
  | 'no-main-document-part'
  /** This client and the room have different formats. Terminal. Save local work. */
  | 'collaboration-format-mismatch'
  | 'protocol-version-mismatch'
  | 'schema-version-mismatch'
  /** The room is unusable. Terminal. Create a new room from saved bytes. */
  | 'blob-digest-mismatch'
  | 'concurrent-seed'
  | 'port-already-attached'
  /** A remote update is not applied yet. Heals when a later update arrives. Wait. */
  | 'duplicate-paragraph-id'
  | 'invalid-relationships'
  | 'materialize-dropped-content'
  | 'missing-blob'
  | 'missing-root'
  | 'remote-apply-failed'
  | 'unknown-paragraph-id'
  /** Over a resource limit. A local edit realigns; shared state over a limit is terminal. */
  | 'blob-store-full'
  | 'blob-too-large'
  | 'invalid-blob-descriptor'
  | 'invalid-bound'
  | 'invalid-logical-id'
  | 'invalid-string'
  | 'prototype-key'
  | 'text-too-long'
  | 'too-many-attributes'
  | 'too-many-children'
  | 'too-many-nodes'
  | 'too-many-parts'
  | 'too-many-relationships'
  | 'tree-too-deep'
  | 'unknown-logical-id'
  | 'unsafe-part-name'
  /** Transport state. Only `transport-disconnected` recovers on its own. */
  | 'authentication-failed'
  | 'room-generation-changed'
  | 'transport'
  | 'transport-disconnected'
  /** Reserved for a room server that refuses a saved room. Passed through, never emitted. */
  | 'invalid-saved-room'
  | 'saved-room-unavailable'
  /** @deprecated Emitted by nothing. Kept for compatibility; do not branch on these. */
  | 'baseline-digest-mismatch'
  | 'experimental-collaboration-existing-paragraphs-only'
  | 'experimental-collaboration-text-only'
  | 'experimental-collaboration-untracked-text-only'
  | 'immutable-baseline-changed'
  | 'immutable-metadata-changed'
  | 'invalid-shared-metadata'
  | 'local-mirror-failed'
  | 'paragraph-set-mismatch'
  | 'shared-schema-invalid'
  | 'unsupported-root-key';

const COLLABORATION_FAILURE_CODE_PRESENT: { readonly [K in CollaborationFailureCode]: true } = {
  'already-initialized': true,
  'authentication-failed': true,
  'baseline-digest-mismatch': true,
  'baseline-too-large': true,
  'blob-digest-mismatch': true,
  'blob-read': true,
  'blob-store-full': true,
  'blob-too-large': true,
  'collaboration-format-mismatch': true,
  'collaboration-session-destroyed': true,
  'collaboration-session-not-attached': true,
  'collaboration-session-not-ready': true,
  'collaboration-text-limit': true,
  'concurrent-seed': true,
  'document-id-mismatch': true,
  'duplicate-paragraph-id': true,
  'experimental-collaboration-body-text-only': true,
  'experimental-collaboration-existing-paragraphs-only': true,
  'experimental-collaboration-text-only': true,
  'experimental-collaboration-untracked-text-only': true,
  'immutable-baseline-changed': true,
  'immutable-metadata-changed': true,
  'initialization-aborted': true,
  'initialization-timeout': true,
  'invalid-baseline': true,
  'invalid-blob-descriptor': true,
  'invalid-bound': true,
  'invalid-document-id': true,
  'invalid-identity': true,
  'invalid-identity-color': true,
  'invalid-logical-id': true,
  'invalid-relationships': true,
  'invalid-saved-room': true,
  'invalid-session-id': true,
  'invalid-shared-metadata': true,
  'invalid-string': true,
  'local-mirror-failed': true,
  'materialize-dropped-content': true,
  'missing-blob': true,
  'missing-local-blob': true,
  'missing-root': true,
  'no-main-document-part': true,
  'not-initialized': true,
  'paragraph-set-mismatch': true,
  'port-already-attached': true,
  'protocol-version-mismatch': true,
  'prototype-key': true,
  'remote-apply-failed': true,
  'room-generation-changed': true,
  'saved-room-unavailable': true,
  'schema-version-mismatch': true,
  'shared-schema-invalid': true,
  'text-too-long': true,
  'too-many-attributes': true,
  'too-many-children': true,
  'too-many-nodes': true,
  'too-many-parts': true,
  'too-many-relationships': true,
  transport: true,
  'transport-disconnected': true,
  'tree-too-deep': true,
  'unknown-logical-id': true,
  'unknown-paragraph-id': true,
  'unsafe-part-name': true,
  'unsupported-root-key': true,
};

/** True when `value` is a {@link CollaborationFailureCode} member. @public */
export function isCollaborationFailureCode(value: string): value is CollaborationFailureCode {
  return Object.hasOwn(COLLABORATION_FAILURE_CODE_PRESENT, value);
}

/** One collaboration failure: a typed code plus optional free-form detail. @public */
export interface CollaborationFailure {
  /** Stable code for application logic. */
  readonly code: CollaborationFailureCode;
  /** Bounded diagnostic text for logs. Not a parsing contract. */
  readonly detail?: string;
}

/**
 * Cached status read. Same reference until one of its fields changes.
 *
 * @public
 */
export interface CollaborationStatusSnapshot {
  /** Current lifecycle state. */
  readonly status: CollaborationStatus;
  /** Why the replica holds `status`, or `undefined` when nothing is wrong. */
  readonly reason: CollaborationFailure | undefined;
  /** The most recent `error` reason. Kept after the replica recovers. */
  readonly lastFailure: CollaborationFailure | undefined;
  /**
   * How many failures this session has recorded. It changes with each new failure, also when
   * its code and detail repeat the last one, as a refused edit refused again does. Absent
   * from a session that does not count.
   */
  readonly failureCount?: number;
  /**
   * The session is in `error` but heals by itself: it realigns on the next clean update and
   * returns to its previous status. A host shows a passing notice, not a rejoin action.
   * Absent means false.
   */
  readonly recovering?: boolean;
  /**
   * Edits wait: the room sent an update that depends on one still on its way, and an edit
   * made now could touch the text it changes. The editor refuses edits meanwhile, with
   * `collaboration-session-not-ready`, and accepts them again when the update arrives or the
   * wait times out. Absent means false.
   */
  readonly waiting?: boolean;
}

function failuresEqual(
  left: CollaborationFailure | undefined,
  right: CollaborationFailure | undefined
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.code === right.code && left.detail === right.detail;
}

function failureOf(code: CollaborationFailureCode, detail?: string): CollaborationFailure {
  return Object.freeze(detail !== undefined && detail.length > 0 ? { code, detail } : { code });
}

/** @internal */
export interface CollaborationStatusTracker {
  status(): CollaborationStatus;
  snapshot(): CollaborationStatusSnapshot;
  /** `recovering` marks an `error` the session heals by itself. */
  set(
    status: CollaborationStatus,
    code?: CollaborationFailureCode,
    detail?: string,
    recovering?: boolean
  ): boolean;
  /** Whether edits wait for the room; returns whether the snapshot changed. */
  setWaiting(waiting: boolean): boolean;
}

/** @internal */
export function createCollaborationStatusTracker(
  initial: CollaborationStatus = 'initializing'
): CollaborationStatusTracker {
  let status = initial;
  let reason: CollaborationFailure | undefined;
  let lastFailure: CollaborationFailure | undefined;
  let failureCount = 0;
  let recovering = false;
  let waiting = false;
  let snapshot: CollaborationStatusSnapshot = Object.freeze({
    status,
    reason,
    lastFailure,
    failureCount,
    recovering,
    waiting,
  });
  const publish = (): void => {
    snapshot = Object.freeze({ status, reason, lastFailure, failureCount, recovering, waiting });
  };
  return {
    status: () => status,
    snapshot: () => snapshot,
    set(
      next: CollaborationStatus,
      code?: CollaborationFailureCode,
      detail?: string,
      healing = false
    ): boolean {
      const nextReason = code === undefined ? undefined : failureOf(code, detail);
      const nextRecovering = next === 'error' && healing;
      if (status === next && failuresEqual(reason, nextReason) && recovering === nextRecovering) {
        return false;
      }
      status = next;
      reason = nextReason;
      recovering = nextRecovering;
      if (next === 'error' && nextReason) {
        lastFailure = nextReason;
        failureCount += 1;
      }
      publish();
      return true;
    },
    setWaiting(next: boolean): boolean {
      if (waiting === next) return false;
      waiting = next;
      publish();
      return true;
    },
  };
}
