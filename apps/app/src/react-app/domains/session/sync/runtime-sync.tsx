/** @jsxImportSource react */
import { useEffect } from "react";

import { ensureWorkspaceSessionSync, trackWorkspaceSessionsSync } from "./session-sync";
import type { ConversationEngineConnection, ConversationStatus } from "../engine/conversation-engine";

type ReactSessionRuntimeProps = {
  workspaceId: string;
  sessionId: string | null;
  connection: ConversationEngineConnection;
  connectionKey: string;
  onSessionUpdated?: (update: { sessionId: string; info: Record<string, unknown> }) => void;
  onSessionStatus?: (update: { sessionId: string; status: ConversationStatus }) => void;
};

export function ReactSessionRuntime(props: ReactSessionRuntimeProps) {
  useEffect(() => {
    const input = {
      workspaceId: props.workspaceId,
      connection: props.connection,
      connectionKey: props.connectionKey,
      onSessionUpdated: props.onSessionUpdated,
      onSessionStatus: props.onSessionStatus,
    };
    const releaseWorkspace = ensureWorkspaceSessionSync(input);
    const releaseSessions = trackWorkspaceSessionsSync(input, props.sessionId ? [props.sessionId] : []);
    return () => {
      releaseSessions();
      releaseWorkspace();
    };
  }, [props.workspaceId, props.sessionId, props.connection, props.connectionKey, props.onSessionUpdated, props.onSessionStatus]);

  return null;
}
