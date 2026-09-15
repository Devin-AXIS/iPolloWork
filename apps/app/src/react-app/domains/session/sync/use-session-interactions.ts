import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import type { TodoItem } from "@/app/types";
import { t } from "@/i18n";
import { getReactQueryClient } from "@/react-app/infra/query-client";
import { useQueryCacheState } from "@/react-app/infra/query-cache-state";
import { useSessionActivityStore } from "../status/session-activity-store";
import { describeRouteError } from "@/react-app/shell/route-workspaces";
import {
  permissionKey,
  questionKey,
  seedPermissionState,
  seedQuestionState,
  todoKey,
} from "./session-sync";
import type {
  ConversationEngineConnection,
  ConversationPermission,
  ConversationQuestion,
} from "../engine/conversation-engine";

const emptyPermissions: ConversationPermission[] = [];
const emptyQuestions: ConversationQuestion[] = [];
const emptyTodos: TodoItem[] = [];

export type UseSessionInteractionsInput = {
  connection: ConversationEngineConnection | null;
  workspaceId: string;
  sessionId: string | null;
  workspaceRoot: string;
};

export function useSessionInteractions(input: UseSessionInteractionsInput) {
  const {
    connection,
    workspaceId,
    sessionId,
    workspaceRoot,
  } = input;

  const [permissionReplyBusy, setPermissionReplyBusy] = useState(false);
  const permissionReplyBusyRef = useRef(false);
  const [questionReplyBusy, setQuestionReplyBusy] = useState(false);
  const questionReplyBusyRef = useRef(false);

  const permissionQueryKey = useMemo(
    () => (workspaceId && sessionId ? permissionKey(workspaceId, sessionId) : null),
    [sessionId, workspaceId],
  );
  const pendingPermissions = useQueryCacheState<ConversationPermission[]>(
    permissionQueryKey,
    emptyPermissions,
  );
  const questionQueryKey = useMemo(
    () => (workspaceId && sessionId ? questionKey(workspaceId, sessionId) : null),
    [sessionId, workspaceId],
  );
  const pendingQuestions = useQueryCacheState<ConversationQuestion[]>(
    questionQueryKey,
    emptyQuestions,
  );
  const todoQueryKey = useMemo(
    () => (workspaceId && sessionId ? todoKey(workspaceId, sessionId) : null),
    [sessionId, workspaceId],
  );
  const todos = useQueryCacheState<TodoItem[]>(todoQueryKey, emptyTodos);

  const [interactionsRefreshing, setInteractionsRefreshing] = useState(false);
  const refreshRef = useRef<(() => Promise<void>) | null>(null);
  const refreshInteractions = useCallback(() => refreshRef.current?.(), []);

  useEffect(() => {
    if (!connection || !workspaceId || !sessionId) return;
    let cancelled = false;
    let inFlight: Promise<void> | null = null;
    const directory = workspaceRoot || undefined;
    const refresh = () => {
      if (inFlight) return inFlight;
      setInteractionsRefreshing(true);
      const snapshotStartedAt = Date.now();
      inFlight = Promise.allSettled([
        connection.listPermissions({ sessionId, directory }).then((list) => {
          if (!cancelled) seedPermissionState(workspaceId, sessionId, list, { snapshotStartedAt });
        }),
        connection.listQuestions({ sessionId, directory }).then((list) => {
          if (!cancelled) seedQuestionState(workspaceId, sessionId, list, { snapshotStartedAt });
        }),
      ]).then(() => {}).finally(() => {
        inFlight = null;
        if (!cancelled) setInteractionsRefreshing(false);
      });
      return inFlight;
    };
    refreshRef.current = refresh;
    void refresh();
    const timer = setInterval(() => {
      const status = useSessionActivityStore.getState().getStatus(workspaceId, sessionId);
      if (["thinking", "responding", "compacting", "waiting"].includes(status)) void refresh();
    }, 5_000);
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      refreshRef.current = null;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [connection, sessionId, workspaceId, workspaceRoot]);

  const activePermission = pendingPermissions[0] ?? null;
  const respondPermission = useCallback(
    async (requestID: string, reply: "once" | "always" | "reject") => {
      if (!connection || !workspaceId || !sessionId) return;
      if (permissionReplyBusyRef.current) return;
      permissionReplyBusyRef.current = true;
      setPermissionReplyBusy(true);
      try {
        const pendingPermission = pendingPermissions.find((permission) => permission.id === requestID);
        if (!pendingPermission) return;
        await connection.replyPermission({
          permission: pendingPermission,
          reply,
          directory: workspaceRoot || undefined,
        });
        getReactQueryClient().setQueryData<ConversationPermission[]>(
          permissionKey(workspaceId, sessionId),
          (current = []) => current.filter((permission) => permission.id !== requestID),
        );

        useSessionActivityStore.getState().setWaitingRequest(workspaceId, sessionId, "permission", requestID, false);

        // Apply the task-wide grant to requests already waiting alongside this
        // one. Never persist a session choice as a workspace/global folder rule.
        if (reply === "always") {
          const snapshotStartedAt = Date.now();
          try {
            const remaining = await connection.listPermissions({ sessionId, directory: workspaceRoot || undefined });
            seedPermissionState(workspaceId, sessionId, remaining, { snapshotStartedAt });
          } catch {
            // Preserve visible requests when the engine cannot refresh them.
          }
        }
      } catch (error) {
        toast.error(t("app.error_request_failed"), {
          description: describeRouteError(error),
        });
      } finally {
        permissionReplyBusyRef.current = false;
        setPermissionReplyBusy(false);
      }
    },
    [
      connection,
      pendingPermissions,
      sessionId,
      workspaceId,
      workspaceRoot,
    ],
  );

  const activeQuestion = pendingQuestions[0] ?? null;
  const respondQuestion = useCallback(
    async (requestID: string, answers: string[][]) => {
      if (!connection || !workspaceId || !sessionId) return;
      if (questionReplyBusyRef.current) return;
      questionReplyBusyRef.current = true;
      setQuestionReplyBusy(true);
      try {
        const pendingQuestion = pendingQuestions.find((question) => question.id === requestID);
        if (!pendingQuestion) return;
        await connection.replyQuestion({
          question: pendingQuestion,
          answers,
          directory: workspaceRoot || undefined,
        });
        getReactQueryClient().setQueryData<ConversationQuestion[]>(
          questionKey(workspaceId, sessionId),
          (current = []) => current.filter((question) => question.id !== requestID),
        );
        useSessionActivityStore.getState().setWaitingRequest(workspaceId, sessionId, "question", requestID, false);
      } catch (error) {
        toast.error(t("app.error_request_failed"), {
          description: describeRouteError(error),
        });
      } finally {
        questionReplyBusyRef.current = false;
        setQuestionReplyBusy(false);
      }
    },
    [connection, pendingQuestions, sessionId, workspaceId, workspaceRoot],
  );

  return {
    refreshInteractions,
    interactionsRefreshing,
    activePermission,
    permissionReplyBusy,
    respondPermission,
    activeQuestion,
    questionReplyBusy,
    respondQuestion,
    todos,
  };
}
