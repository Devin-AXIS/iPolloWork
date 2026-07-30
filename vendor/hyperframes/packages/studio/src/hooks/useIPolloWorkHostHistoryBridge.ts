import { useEffect, useRef } from "react";

type HistoryFileSnapshot = {
  before: string;
  after: string;
};

type RecordEdit = (input: {
  label: string;
  kind: "source";
  files: Record<string, HistoryFileSnapshot>;
}) => Promise<void>;

type HostHistoryCommand =
  | {
      type: "record";
      operationId: string;
      input: Parameters<RecordEdit>[0];
    }
  | {
      type: "undo" | "redo";
    };

const HOST_HISTORY_PATHS = ["index.html", "design-tokens.css"] as const;
const TRUSTED_DEV_PARENT_PORTS = new Set(["5173", "5273", "5274"]);
const TRUSTED_DEV_PARENT_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isAllowedHistoryPath(path: string) {
  return HOST_HISTORY_PATHS.some((allowed) => allowed === path);
}

export function acceptsIPolloWorkHostHistoryOrigin(eventOrigin: string, ancestorOrigin: string) {
  if (ancestorOrigin === "file://") {
    return eventOrigin === "null" || eventOrigin === "file://";
  }
  try {
    const ancestor = new URL(ancestorOrigin);
    return eventOrigin === ancestorOrigin
      && ancestor.protocol === "http:"
      && TRUSTED_DEV_PARENT_HOSTS.has(ancestor.hostname)
      && TRUSTED_DEV_PARENT_PORTS.has(ancestor.port);
  } catch {
    return false;
  }
}

function parentOrigin() {
  const ancestorOrigin = window.location.ancestorOrigins?.item(0);
  if (ancestorOrigin) return ancestorOrigin;
  if (!document.referrer) return "";
  try {
    return new URL(document.referrer).origin;
  } catch {
    return "";
  }
}

function postToParent(message: unknown, origin: string) {
  window.parent.postMessage(message, origin === "file://" ? "*" : origin);
}

export function parseIPolloWorkHostHistoryMessage(
  value: unknown,
  activeProjectId: string | null,
): HostHistoryCommand | null {
  if (!activeProjectId || !isRecord(value) || value.projectId !== activeProjectId) return null;
  if (value.type === "ipollowork:studio-history-action") {
    return value.action === "undo" || value.action === "redo"
      ? { type: value.action }
      : null;
  }
  if (value.type !== "ipollowork:studio-record-host-edit") return null;
  if (
    typeof value.operationId !== "string"
    || !value.operationId.trim()
    || typeof value.label !== "string"
    || !value.label.trim()
    || !isRecord(value.files)
  ) {
    return null;
  }

  const paths = Object.keys(value.files);
  if (!paths.length || paths.some((path) => !isAllowedHistoryPath(path))) return null;
  const files: Record<string, HistoryFileSnapshot> = {};
  for (const path of paths) {
    const snapshot = value.files[path];
    if (
      !isRecord(snapshot)
      || typeof snapshot.before !== "string"
      || typeof snapshot.after !== "string"
    ) {
      return null;
    }
    files[path] = { before: snapshot.before, after: snapshot.after };
  }
  return {
    type: "record",
    operationId: value.operationId.trim().slice(0, 120),
    input: {
      label: value.label.trim().slice(0, 120),
      kind: "source",
      files,
    },
  };
}

export function useIPolloWorkHostHistoryBridge({
  projectId,
  loaded,
  recordEdit,
  handleUndo,
  handleRedo,
  showToast,
}: {
  projectId: string | null;
  loaded: boolean;
  recordEdit: RecordEdit;
  handleUndo: () => Promise<void>;
  handleRedo: () => Promise<void>;
  showToast: (message: string, tone?: "error" | "info") => void;
}) {
  const queueRef = useRef(Promise.resolve());

  useEffect(() => {
    if (!loaded) return;
    const expectedParentOrigin = parentOrigin();
    if (!expectedParentOrigin) return;
    const handleMessage = (event: MessageEvent) => {
      if (window.parent === window || event.source !== window.parent) return;
      if (!acceptsIPolloWorkHostHistoryOrigin(event.origin, expectedParentOrigin)) return;
      const command = parseIPolloWorkHostHistoryMessage(event.data, projectId);
      if (!command) return;
      queueRef.current = queueRef.current
        .then(async () => {
          if (command.type === "record") {
            await recordEdit(command.input);
            postToParent({
              type: "ipollowork:studio-history-recorded",
              projectId,
              operationId: command.operationId,
              ok: true,
            }, expectedParentOrigin);
            return;
          }
          await (command.type === "undo" ? handleUndo() : handleRedo());
          postToParent({
            type: "ipollowork:studio-history-applied",
            projectId,
            action: command.type,
          }, expectedParentOrigin);
        })
        .catch((error) => {
          if (command.type === "record") {
            postToParent({
              type: "ipollowork:studio-history-recorded",
              projectId,
              operationId: command.operationId,
              ok: false,
              error: error instanceof Error ? error.message : "Could not record Video Studio history.",
            }, expectedParentOrigin);
          }
          showToast(
            error instanceof Error ? error.message : "Could not update Video Studio history.",
            "error",
          );
        });
    };
    window.addEventListener("message", handleMessage);
    postToParent({
      type: "ipollowork:studio-history-ready",
      projectId,
    }, expectedParentOrigin);
    return () => window.removeEventListener("message", handleMessage);
  }, [handleRedo, handleUndo, loaded, projectId, recordEdit, showToast]);
}
