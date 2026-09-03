/** @jsxImportSource react */
import { useEffect } from "react";

import { ensureWorkspaceSessionSync, trackWorkspaceSessionsSync } from "./session-sync";
import type { ConversationEngineConnection, ConversationSnapshot, ConversationStatus } from "../engine/conversation-engine";

type ReactSessionRuntimeProps = {
  workspaceId: string;
  sessionId: string | null;
  connection: ConversationEngineConnection;
  connectionKey: string;
  readSnapshot?: (sessionId: string) => Promise<ConversationSnapshot>;
  onSessionUpdated?: (update: { sessionId: string; info: Record<string, unknown> }) => void;
  onSessionStatus?: (update: { sessionId: string; status: ConversationStatus }) => void;
  onSessionError?: (update: { sessionId: string; errorText: string }) => void;
};

export function ReactSessionRuntime(props: ReactSessionRuntimeProps) {
  useEffect(() => {
    const input = {
      workspaceId: props.workspaceId,
      connection: props.connection,
      connectionKey: props.connectionKey,
      readSnapshot: props.readSnapshot,
      onSessionUpdated: props.onSessionUpdated,
      onSessionStatus: props.onSessionStatus,
      onSessionError: props.onSessionError,
    };
    const releaseWorkspace = ensureWorkspaceSessionSync(input);
    const releaseSessions = trackWorkspaceSessionsSync(input, props.sessionId ? [props.sessionId] : []);
    return () => {
      releaseSessions();
      releaseWorkspace();
    };
  }, [props.workspaceId, props.sessionId, props.connection, props.connectionKey, props.readSnapshot, props.onSessionUpdated, props.onSessionStatus, props.onSessionError]);

  return null;
}
