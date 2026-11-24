/**
 * `@docx-editor.dev/core/collaboration` — provider-neutral collaboration contracts.
 *
 * This lane names the attachment between the canonical tree and an optional replication
 * implementation. It performs no networking and imports no CRDT.
 *
 * @packageDocumentation
 * @public
 */

import type { StoryScope } from '../store/store/tree-package-store.ts';
import type { TreeDocOp } from '../store/store/tree-op-types.ts';
import type { CollaborationDocumentPort } from './replication.ts';

export { safeParticipantColor } from './participant-color.ts';
export {
  createCollaborationStatusTracker,
  isCollaborationFailureCode,
  type CollaborationFailure,
  type CollaborationFailureCode,
  type CollaborationStatus,
  type CollaborationStatusSnapshot,
} from './failure.ts';
import type {
  CollaborationFailureCode,
  CollaborationStatus,
  CollaborationStatusSnapshot,
} from './failure.ts';

/** Human or automation identity attached to authored collaboration transactions. @public */
export interface CollaborationIdentity {
  /** Stable author id, 1 to 256 characters after trimming. Recorded on authored changes. */
  readonly actorId: string;
  /** Display name, 1 to 256 characters after trimming. */
  readonly name: string;
  /** Presence color, at most 64 characters. An unsafe CSS color falls back to the accent. */
  readonly color?: string;
  /** `agent` for automation. Defaults to `human`. */
  readonly role?: 'human' | 'agent';
}

/** One validated identity visible through ephemeral collaboration presence. @public */
export interface CollaborationParticipant extends CollaborationIdentity {
  /** True for this replica's own participant. */
  readonly isLocal: boolean;
}

/**
 * One endpoint of a published selection: a stable paragraph id and a UTF-16 offset.
 *
 * The wire payload carries only these two endpoints. The receiver walks its own canonical
 * tree to find the paragraphs between them, so a select-all does not grow with document size.
 *
 * @public
 */
export interface CollaborationSelectionAddress {
  /** The stable `w14:paraId` of the paragraph. */
  readonly paragraphId: string;
  /** A UTF-16 offset in the paragraph's text. */
  readonly offset: number;
}

/**
 * How a published selection covers the document.
 *
 * Absent or omitted means a character range. `cells` means the table rectangle whose
 * corner cells contain the two endpoints. The payload still carries only those endpoints,
 * so a large table selection does not grow with the number of selected cells.
 *
 * @public
 */
export type CollaborationSelectionKind = 'cells';

/**
 * One endpoint of a remote selection resolved into this replica's canonical addresses.
 *
 * `paragraphId` is the stable `w14:paraId`. `nodeId` is replica-local and is used to paint.
 *
 * @public
 */
export interface CollaborationRemoteSelectionAddress {
  /** The stable `w14:paraId` of the paragraph. */
  readonly paragraphId: string;
  /** The paragraph's node id in this replica's editor tree. */
  readonly nodeId: string;
  /** A UTF-16 offset in the paragraph's text. */
  readonly offset: number;
}

/**
 * Stable remote selection resolved into this replica's canonical paragraph addresses.
 *
 * Anchor and head may name different paragraphs. A collapsed caret is the same address twice.
 *
 * @public
 */
export interface CollaborationRemoteSelection {
  /** The participant's `actorId`. */
  readonly actorId: string;
  /** The participant's display name. */
  readonly name: string;
  /** The participant's presence color, when it published a safe one. */
  readonly color?: string;
  /** Where the selection starts. */
  readonly anchor: CollaborationRemoteSelectionAddress;
  /** Where the selection ends: the remote caret. */
  readonly head: CollaborationRemoteSelectionAddress;
  /** `cells` for a table cell rectangle; absent for a character range. */
  readonly kind?: CollaborationSelectionKind;
}

/**
 * Selection published by the local editor through ephemeral awareness.
 *
 * Publish an anchor address and a head address. Do not materialize every covered paragraph.
 *
 * @public
 */
export interface CollaborationLocalSelection {
  /** Where the selection starts. */
  readonly anchor: CollaborationSelectionAddress;
  /** Where the selection ends: the caret. */
  readonly head: CollaborationSelectionAddress;
  /** `cells` for a table cell rectangle; absent for a character range. */
  readonly kind?: CollaborationSelectionKind;
}

/**
 * Where a collaboration session carried the local selection across the last remote change.
 *
 * The editor uses `to` only while its selection still equals `from`: a selection the user
 * moved since is the user's. @public
 */
export interface CollaborationSelectionMove {
  /** The selection the session carried, as the editor last published it. */
  readonly from: CollaborationEditorSelection;
  /** Where it stands now: beside the same characters, wherever they show. */
  readonly to: CollaborationEditorSelection;
}

/** A selection in this replica's editor. @public */
export interface CollaborationEditorSelection {
  /** Where the selection starts: it stays put when the selection extends. */
  readonly anchor: CollaborationEditorPosition;
  /** Where the selection ends: the caret. */
  readonly head: CollaborationEditorPosition;
}

/**
 * A position in this replica's editor tree. Unlike a stable paragraph id, which a remote
 * change can rename on one replica, a node id names one paragraph of this editor. @public
 */
export interface CollaborationEditorPosition {
  /** The node id of the paragraph in this replica's editor tree. */
  readonly nodeId: string;
  /** A UTF-16 offset in the paragraph's text. */
  readonly offset: number;
}

/**
 * Optional replication session attached to an editor or headless automation host.
 *
 * Implementations own replication state only. The attached document port remains the authored
 * authority for reads, layout, paint, and save.
 *
 * @public
 */
export interface EditorCollaborationSession {
  /** The room's document id. An attached port must carry the same id. */
  readonly documentId: string;
  /** Unique identity for this attachment lifetime. It prevents operation ID reuse after reconnect. */
  readonly sessionId: string;
  /** The validated local identity. */
  readonly identity: CollaborationIdentity;
  /** Current lifecycle state. */
  status(): CollaborationStatus;
  /**
   * Cached status, current reason, and last failure.
   *
   * Same reference until any of those values change. A host that mounts after a
   * recovered error still reads {@link CollaborationStatusSnapshot.lastFailure}.
   */
  statusSnapshot(): CollaborationStatusSnapshot;
  /** Call `listener` on each status or reason change. Returns the unsubscribe function. */
  subscribeStatus(
    listener: (
      status: CollaborationStatus,
      reason?: CollaborationFailureCode,
      detail?: string
    ) => void
  ): () => void;
  /**
   * Attach the editor's document port and start replicating. Returns the detach function.
   * A second, different port moves the session to `error` with `port-already-attached`.
   */
  attach(port: CollaborationDocumentPort): () => void;
  /**
   * Whether an editor has attached its document port to this replica.
   *
   * False means edits do not replicate, whatever `status()` says — the usual cause is a host
   * that did not remount the editor when the session appeared, so `collaborationModule`
   * never attached. That mistake used to be reachable only as a `console.warn`, which a
   * production build discards; this is the same fact as a value a host can render.
   */
  readonly attached: boolean;
  /**
   * Check whether `ops` may commit now. Returns `null` to admit them, or the refusal code.
   * Call it before every store transaction a custom port commits.
   */
  gateOperations(ops: readonly TreeDocOp[], scope: StoryScope): CollaborationFailureCode | null;
  /** Whether the shared undo history holds a local step to undo. */
  canUndo(): boolean;
  /** Whether the shared undo history holds a local step to redo. */
  canRedo(): boolean;
  /** Undo this participant's last step; others' edits stay. Returns false when refused. */
  undo(): boolean;
  /** Redo this participant's last undone step. Returns false when refused. */
  redo(): boolean;
  /**
   * The selection the last `undo` or `redo` restored: the one its author had before the
   * undone change. Null when the step recorded none. Optional; a session without it leaves
   * the editor to place the caret at the change.
   */
  historySelection?(): CollaborationLocalSelection | null;
  /**
   * Where the last remote change carried the local selection, on the shared characters
   * beside its endpoints, and the selection it was carried from, both in the editor's
   * paragraph node ids. Null when the session could not carry it. Optional; without it the
   * editor maps the selection by text.
   */
  remoteSelectionMove?(): CollaborationSelectionMove | null;
  /** Publish the local selection through presence. `null` clears it. */
  setLocalSelection(selection: CollaborationLocalSelection | null): void;
  /** Participants in presence, this replica included. Capped at 256. */
  participants(): readonly CollaborationParticipant[];
  /** Call `listener` when the participant list changes. Returns the unsubscribe function. */
  subscribeParticipants(
    listener: (participants: readonly CollaborationParticipant[]) => void
  ): () => void;
  /** Other participants' selections, resolved into this replica's addresses. */
  remoteSelections(): readonly CollaborationRemoteSelection[];
  /** Call `listener` when a remote selection changes. Returns the unsubscribe function. */
  subscribeRemoteSelections(
    listener: (selections: readonly CollaborationRemoteSelection[]) => void
  ): () => void;
  /**
   * Publish queued local journals to shared state.
   *
   * Local typing does not wait for replication. Undo, destroy, and page hide call this
   * so a queued journal is never dropped.
   */
  flushPendingJournals(): void;
  /** Stop replicating and release listeners. The status becomes `destroyed`. */
  destroy(): void;
}

/**
 * What a collaboration module contributes: the replica the surface attaches.
 *
 * @public
 */
export interface CollaborationModuleContribution {
  /**
   * A ready session. The host creates the Yjs room, then wraps it with
   * `collaborationModule({ session })`.
   *
   * Core does not build a session from a document id: the opened package has
   * no collaboration room identity. That identity is chosen before mount.
   */
  readonly session: EditorCollaborationSession;
}
