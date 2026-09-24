/** @jsxImportSource react */
import { useMemo } from "react";

import type { iPolloWorkServerClient, iPolloWorkWorkspaceInfo } from "../../../../app/lib/ipollowork-server";
import { getDisplaySessionTitle } from "../../../../app/lib/session-title";
import { useControlAction, type iPolloWorkControlAction } from "../../../shell/control/control-provider";
import { useSessionPinStore } from "../sidebar/session-pin-store";
import type { ConversationEngineConnection } from "../engine/conversation-engine";

type SessionLike = {
  id?: string;
  title?: string | null;
  time?: {
    updated?: number | null;
    created?: number | null;
  };
};

type SessionControlWorkspace = iPolloWorkWorkspaceInfo & {
  displayNameResolved?: string;
};

type UseSessionControlActionsInput = {
  workspaces: SessionControlWorkspace[];
  sessionsByWorkspaceId: Record<string, SessionLike[]>;
  selectedWorkspaceId: string;
  selectedWorkspaceRoot: string;
  selectedSessionId: string | null;
  canCreateTask: boolean;
  ipolloworkClient: iPolloWorkServerClient | null;
  conversation: ConversationEngineConnection | null;
  navigateToSession: (sessionId: string) => void;
  navigateToSessionRoot: () => void;
  createTaskInWorkspace: (workspaceId: string) => Promise<unknown> | unknown;
  openModelPicker: () => void;
  refreshRouteState: () => Promise<unknown> | unknown;
};

function workspaceLabel(workspace: SessionControlWorkspace) {
  return workspace.displayName?.trim() || workspace.name?.trim() || workspace.path?.trim() || "workspace";
}

function findSessionWorkspace(
  workspaces: SessionControlWorkspace[],
  sessionsByWorkspaceId: Record<string, SessionLike[]>,
  sessionId: string,
) {
  return workspaces.find((workspace) => (
    sessionsByWorkspaceId[workspace.id] ?? []
  ).some((session) => session.id === sessionId));
}

function objectArgs(args: unknown) {
  return args && typeof args === "object" ? args as Record<string, unknown> : {};
}

function stringArg(args: unknown, name: string) {
  const value = objectArgs(args)[name];
  return typeof value === "string" ? value.trim() : "";
}

function booleanArg(args: unknown, name: string) {
  return objectArgs(args)[name] === true;
}

export function useSessionControlActions(input: UseSessionControlActionsInput) {
  const {
    canCreateTask,
    createTaskInWorkspace,
    navigateToSession,
    navigateToSessionRoot,
    openModelPicker,
    ipolloworkClient,
    conversation,
    refreshRouteState,
    selectedSessionId,
    selectedWorkspaceId,
    selectedWorkspaceRoot,
    sessionsByWorkspaceId,
    workspaces,
  } = input;

  const createTaskControlAction = useMemo<iPolloWorkControlAction>(() => ({
    id: "session.create_task",
    label: "Create a new task",
    description: "Create a new session in the selected workspace.",
    sideEffect: "mutation",
    disabled: !canCreateTask || !selectedWorkspaceId,
    execute: async () => {
      if (!selectedWorkspaceId) return false;
      await createTaskInWorkspace(selectedWorkspaceId);
      return true;
    },
  }), [canCreateTask, createTaskInWorkspace, selectedWorkspaceId]);
  useControlAction(createTaskControlAction);

  const listSessionsControlAction = useMemo<iPolloWorkControlAction>(() => ({
    id: "session.list_sessions",
    label: "List available sessions",
    description: "Return the list of sessions across workspaces so the user can ask to open one by name.",
    sideEffect: "none",
    execute: () => {
      const out: { sessionId: string; title: string; workspace: string; updatedAt: number }[] = [];
      for (const workspace of workspaces) {
        const list = sessionsByWorkspaceId[workspace.id] ?? [];
        for (const session of list) {
          const sessionId = session.id?.trim() ?? "";
          if (!sessionId) continue;
          const title = getDisplaySessionTitle(session.title ?? "");
          const updatedAt = session.time?.updated ?? session.time?.created ?? 0;
          out.push({ sessionId, title, workspace: workspaceLabel(workspace), updatedAt });
        }
      }
      out.sort((a, b) => b.updatedAt - a.updatedAt);
      return out.slice(0, 30);
    },
  }), [sessionsByWorkspaceId, workspaces]);
  useControlAction(listSessionsControlAction);

  const openSessionControlAction = useMemo<iPolloWorkControlAction>(() => ({
    id: "session.open",
    label: "Open a session by ID",
    description: "Navigate to a specific session. Use list_sessions first to get the session ID.",
    sideEffect: "navigation",
    requiresArgs: true,
    args: [{ name: "sessionId", type: "string", required: true, description: "Session ID from session.list_sessions." }],
    execute: (args) => {
      const sessionId = stringArg(args, "sessionId");
      if (!sessionId) return { ok: false, error: "sessionId is required" };
      navigateToSession(sessionId);
      return { ok: true, navigatedTo: sessionId };
    },
  }), [navigateToSession]);
  useControlAction(openSessionControlAction);

  const renameSessionControlAction = useMemo<iPolloWorkControlAction>(() => ({
    id: "session.rename",
    label: "Rename a session",
    description: "Rename a session by ID. Use list_sessions first to match the title the user said.",
    sideEffect: "mutation",
    requiresArgs: true,
    args: [
      { name: "sessionId", type: "string", required: true, description: "Session ID from session.list_sessions." },
      { name: "title", type: "string", required: true, description: "New session title." },
    ],
    disabled: !conversation,
    execute: async (args) => {
      const sessionId = stringArg(args, "sessionId");
      const title = stringArg(args, "title");
      if (!sessionId) return { ok: false, error: "sessionId is required" };
      if (!title) return { ok: false, error: "title is required" };
      if (!conversation) return { ok: false, error: "Conversation engine is not connected" };

      const targetWorkspace = findSessionWorkspace(workspaces, sessionsByWorkspaceId, sessionId);
      await conversation.rename(sessionId, title, targetWorkspace?.path || selectedWorkspaceRoot || undefined);
      await refreshRouteState();
      return { ok: true, sessionId, title };
    },
  }), [conversation, refreshRouteState, selectedWorkspaceRoot, sessionsByWorkspaceId, workspaces]);
  useControlAction(renameSessionControlAction);

  const deleteSessionControlAction = useMemo<iPolloWorkControlAction>(() => ({
    id: "session.delete",
    label: "Delete a session",
    description: "Delete a session by ID. Destructive: only run after explicit user confirmation.",
    sideEffect: "mutation",
    requiresArgs: true,
    requiresConfirmation: true,
    args: [
      { name: "sessionId", type: "string", required: true, description: "Session ID from session.list_sessions." },
      { name: "confirmed", type: "boolean", required: true, description: "Must be true after explicit user confirmation." },
    ],
    disabled: !ipolloworkClient,
    execute: async (args) => {
      const sessionId = stringArg(args, "sessionId");
      const confirmed = booleanArg(args, "confirmed");
      if (!sessionId) return { ok: false, error: "sessionId is required" };
      if (!confirmed) return { ok: false, error: "Deletion requires confirmed: true after explicit user confirmation" };
      if (!ipolloworkClient) return { ok: false, error: "iPolloWork server is not connected" };

      const targetWorkspace = findSessionWorkspace(workspaces, sessionsByWorkspaceId, sessionId);
      if (!targetWorkspace) return { ok: false, error: "Session was not found in the current session list" };
      await ipolloworkClient.deleteSession(targetWorkspace.id, sessionId);
      if (selectedSessionId === sessionId) {
        navigateToSessionRoot();
      }
      await refreshRouteState();
      return { ok: true, sessionId, deleted: true };
    },
  }), [navigateToSessionRoot, ipolloworkClient, refreshRouteState, selectedSessionId, sessionsByWorkspaceId, workspaces]);
  useControlAction(deleteSessionControlAction);

  const modelPickerControlAction = useMemo<iPolloWorkControlAction>(() => ({
    id: "session.model_picker.open",
    label: "Open the model picker",
    description: "Open the current session model picker.",
    sideEffect: "none",
    disabled: !selectedWorkspaceId,
    execute: openModelPicker,
  }), [openModelPicker, selectedWorkspaceId]);
  useControlAction(modelPickerControlAction);

  // ---------------------------------------------------------------------------
  // Session management control actions (pin and archive)
  // ---------------------------------------------------------------------------

  const store = useSessionPinStore;

  const pinControlAction = useMemo<iPolloWorkControlAction>(() => ({
    id: "session.pin",
    label: "Pin or unpin a session",
    description: "Toggle pin on a session. Pinned sessions float to the top of the sidebar.",
    sideEffect: "mutation",
    requiresArgs: true,
    args: [{ name: "sessionId", type: "string", required: true, description: "Session ID to pin/unpin." }],
    execute: (args) => {
      const sessionId = stringArg(args, "sessionId");
      if (!sessionId) return { ok: false, error: "sessionId is required" };
      store.getState().togglePin(sessionId);
      const pinned = store.getState().pinnedIds.includes(sessionId);
      return { ok: true, sessionId, pinned };
    },
  }), []);
  useControlAction(pinControlAction);

  const archiveControlAction = useMemo<iPolloWorkControlAction>(() => ({
    id: "session.archive",
    label: "Archive or unarchive a session",
    description: "Archive a session (non-destructive, preserves context). Archived sessions move to the Archived section. Pass archived=false to unarchive.",
    sideEffect: "mutation",
    requiresArgs: true,
    args: [
      { name: "sessionId", type: "string", required: true, description: "Session ID." },
      { name: "archived", type: "boolean", required: true, description: "true to archive, false to unarchive." },
    ],
    disabled: !conversation,
    execute: async (args) => {
      const sessionId = stringArg(args, "sessionId");
      const archived = booleanArg(args, "archived");
      if (!sessionId) return { ok: false, error: "sessionId is required" };
      if (!conversation) return { ok: false, error: "Conversation engine is not connected" };
      const targetWorkspace = findSessionWorkspace(workspaces, sessionsByWorkspaceId, sessionId);
      await conversation.setArchived(sessionId, archived, targetWorkspace?.path || selectedWorkspaceRoot || undefined);
      await refreshRouteState();
      return { ok: true, sessionId, archived };
    },
  }), [conversation, refreshRouteState, selectedWorkspaceRoot, sessionsByWorkspaceId, workspaces]);
  useControlAction(archiveControlAction);

}
