// A STUB collaboration module for core's seam tests.
//
// Core tests exercise attach gating, first-registration-wins, and undo handover.
// The real Yjs replica lives in `@docx-editor.dev/pro`.

import type { EditorCollaborationSession } from '../../collaboration/index.ts';
import type { CollaborationDocumentPort } from '../../collaboration/replication.ts';
import type { EditorModule } from '../../contracts/modules.ts';

export interface StubCollaborationSession extends EditorCollaborationSession {
  readonly attached: boolean;
  readonly undoCalls: number;
}

export function stubCollaborationSession(
  overrides: Partial<EditorCollaborationSession> = {}
): StubCollaborationSession {
  const state = { attached: false, undoCalls: 0 };
  const session: StubCollaborationSession = {
    documentId: 'stub-document',
    sessionId: 'stub-session',
    identity: { actorId: 'stub-actor', name: 'Stub' },
    status: () => 'ready',
    statusSnapshot: () =>
      Object.freeze({ status: 'ready' as const, reason: undefined, lastFailure: undefined }),
    subscribeStatus: () => () => {},
    attach: (_port: CollaborationDocumentPort) => {
      state.attached = true;
      return () => {
        state.attached = false;
      };
    },
    gateOperations: () => null,
    canUndo: () => true,
    canRedo: () => false,
    undo: () => {
      state.undoCalls += 1;
      return true;
    },
    redo: () => false,
    setLocalSelection: () => {},
    participants: () => [],
    subscribeParticipants: () => () => {},
    remoteSelections: () => [],
    subscribeRemoteSelections: () => () => {},
    flushPendingJournals: () => {},
    destroy: () => {},
    get attached() {
      return state.attached;
    },
    get undoCalls() {
      return state.undoCalls;
    },
    ...overrides,
  };
  return session;
}

export function stubCollaborationModule(session: EditorCollaborationSession): EditorModule {
  return {
    id: 'collaboration',
    collaboration: { session },
  };
}
