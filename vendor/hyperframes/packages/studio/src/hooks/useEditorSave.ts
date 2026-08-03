import { useCallback, useEffect, useRef } from "react";
import { saveProjectFilesWithHistory } from "../utils/studioFileHistory";
import type { EditHistoryKind } from "../utils/editHistory";
import { trackStudioEvent } from "../utils/studioTelemetry";
import { addStudioPendingEditFlushListener } from "../utils/studioPendingEdits";

interface RecordEditInput {
  label: string;
  kind: EditHistoryKind;
  coalesceKey?: string;
  files: Record<string, { before: string; after: string }>;
}

interface UseEditorSaveOptions {
  editingPathRef: React.RefObject<string | undefined>;
  projectIdRef: React.RefObject<string | null>;
  readProjectFile: (path: string) => Promise<string>;
  writeProjectFile: (path: string, content: string, expectedContent?: string) => Promise<void>;
  recordEdit: (input: RecordEditInput) => Promise<void>;
  domEditSaveTimestampRef: React.MutableRefObject<number>;
  setRefreshKey: React.Dispatch<React.SetStateAction<number>>;
  showToast: (message: string, tone?: "error" | "info") => void;
}

export function useEditorSave({
  editingPathRef,
  projectIdRef,
  readProjectFile,
  writeProjectFile,
  recordEdit,
  domEditSaveTimestampRef,
  setRefreshKey,
  showToast,
}: UseEditorSaveOptions) {
  // Kept as saveRafRef in the returned contract because FileManager exposes the
  // ref, but it now owns a real debounce timer rather than a next-frame save.
  const saveRafRef = useRef<number | null>(null);
  const refreshRafRef = useRef<number | null>(null);
  const pendingSaveRef = useRef<{ projectId: string; path: string; content: string } | null>(null);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const lastFailureToastAtRef = useRef(0);
  const mountedRef = useRef(true);

  const flushPendingSave = useCallback((): Promise<void> => {
    if (saveRafRef.current != null) {
      window.clearTimeout(saveRafRef.current);
      saveRafRef.current = null;
    }
    const pending = pendingSaveRef.current;
    pendingSaveRef.current = null;
    if (!pending) return saveChainRef.current;

    const save = saveChainRef.current.catch(() => {}).then(async () => {
      const { projectId, path, content } = pending;
      try {
        domEditSaveTimestampRef.current = Date.now();
        await saveProjectFilesWithHistory({
          projectId,
          label: "Edit source",
          kind: "source",
          coalesceKey: `source:${path}`,
          files: { [path]: content },
          readFile: readProjectFile,
          writeFile: writeProjectFile,
          recordEdit,
        });
        if (mountedRef.current) {
          if (refreshRafRef.current != null) cancelAnimationFrame(refreshRafRef.current);
          refreshRafRef.current = requestAnimationFrame(() => setRefreshKey((key) => key + 1));
        }
      } catch (error) {
        trackStudioEvent("save_failure", {
          source: "code_editor",
          error_message: error instanceof Error ? error.message : "unknown",
        });
        const now = Date.now();
        if (now - lastFailureToastAtRef.current > 5000) {
          lastFailureToastAtRef.current = now;
          showToast(
            `Couldn't save ${path} — your latest edits are not persisted. Check the preview server; editing again retries the save.`,
            "error",
          );
        }
      }
    });
    saveChainRef.current = save;
    return save;
  }, [domEditSaveTimestampRef, readProjectFile, recordEdit, setRefreshKey, showToast, writeProjectFile]);

  useEffect(() => {
    const removeFlushListener = addStudioPendingEditFlushListener(flushPendingSave);
    return () => {
      removeFlushListener();
      void flushPendingSave();
      mountedRef.current = false;
      if (refreshRafRef.current != null) cancelAnimationFrame(refreshRafRef.current);
    };
  }, [flushPendingSave]);

  const handleContentChange = useCallback(
    (content: string) => {
      const projectId = projectIdRef.current;
      const path = editingPathRef.current;
      if (!projectId || !path) return;
      pendingSaveRef.current = { projectId, path, content };
      if (saveRafRef.current != null) window.clearTimeout(saveRafRef.current);
      saveRafRef.current = window.setTimeout(() => {
        void flushPendingSave();
      }, 350);
    },
    [editingPathRef, flushPendingSave, projectIdRef],
  );

  return {
    saveRafRef,
    handleContentChange,
  };
}
