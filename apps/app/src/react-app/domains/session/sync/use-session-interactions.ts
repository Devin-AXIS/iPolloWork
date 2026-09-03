import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import type { iPolloWorkServerClient } from "@/app/lib/ipollowork-server";
import type { TodoItem } from "@/app/types";
import { t } from "@/i18n";
import { getReactQueryClient } from "@/react-app/infra/query-client";
import { useQueryCacheState } from "@/react-app/infra/query-cache-state";
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

function nonEmptyStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "string") return [];
    const pattern = entry.trim();
    return pattern ? [pattern] : [];
  });
}

export function persistentPermissionPatterns(permission: ConversationPermission): string[] {
  const savedPatterns = nonEmptyStringList(permission.remember);
  const patterns = savedPatterns.length > 0
    ? savedPatterns
    : nonEmptyStringList(permission.resources);
  return [...new Set(patterns)];
}

export type UseSessionInteractionsInput = {
  connection: ConversationEngineConnection | null;
  workspaceId: string;
  sessionId: string | null;
  workspaceRoot: string;
  ipolloworkServerClient?: iPolloWorkServerClient | null;
  runtimeWorkspaceId?: string | null;
};

export function useSessionInteractions(input: UseSessionInteractionsInput) {
  const {
    connection,
    workspaceId,
    sessionId,
    workspaceRoot,
    ipolloworkServerClient,
    runtimeWorkspaceId,
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

  useEffect(() => {
    if (!connection || !workspaceId || !sessionId) return;
    let cancelled = false;
    const directory = workspaceRoot || undefined;
    void (async () => {
      const snapshotStartedAt = Date.now();
      try {
        const list = await connection.listPermissions({ sessionId, directory });
        if (!cancelled) {
          seedPermissionState(workspaceId, sessionId, list, { snapshotStartedAt });
        }
      } catch {
        // Keep event-synced permission state if the snapshot read fails.
        // Hiding a pending approval can block the running task.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connection, sessionId, workspaceId, workspaceRoot]);

  useEffect(() => {
    if (!connection || !workspaceId || !sessionId) return;
    let cancelled = false;
    const directory = workspaceRoot || undefined;
    void (async () => {
      const snapshotStartedAt = Date.now();
      try {
        const list = await connection.listQuestions({ sessionId, directory });
        if (!cancelled) {
          seedQuestionState(workspaceId, sessionId, list, { snapshotStartedAt });
        }
      } catch {
        // Keep event-synced question state if the snapshot read fails.
        // Hiding a pending question can block the running task.
      }
    })();
    return () => {
      cancelled = true;
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

        // The current task must not remain blocked if persisting the future
        // directory rule fails. Reply first, then save the broader "always"
        // scope as a best-effort cross-session authorization.
        if (
          reply === "always" &&
          pendingPermission.kind === "external_directory" &&
          ipolloworkServerClient &&
          runtimeWorkspaceId
        ) {
          const requestedFolders = persistentPermissionPatterns(pendingPermission);
          if (requestedFolders.length > 0) {
            try {
              const current = await ipolloworkServerClient.listAuthorizedFolders(runtimeWorkspaceId);
              const nextFolders = [...new Set([...current.folders, ...requestedFolders])];
              if (nextFolders.length !== current.folders.length) {
                await ipolloworkServerClient.setAuthorizedFolders(runtimeWorkspaceId, nextFolders);
              }
            } catch (error) {
              toast.error(t("app.error_request_failed"), {
                description: describeRouteError(error),
              });
            }
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
      ipolloworkServerClient,
      pendingPermissions,
      runtimeWorkspaceId,
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
    activePermission,
    permissionReplyBusy,
    respondPermission,
    activeQuestion,
    questionReplyBusy,
    respondQuestion,
    todos,
  };
}
