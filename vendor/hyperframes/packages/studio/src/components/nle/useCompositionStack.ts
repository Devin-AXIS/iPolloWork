// Composition drill-down stack management for NLEContext/EditorShell
import { useState, useCallback, useRef, useEffect } from "react";
import { usePlayerStore } from "../../player";
import type { CompositionLevel } from "./CompositionBreadcrumb";
import { encodePreviewPath } from "../../player/components/thumbnailUtils";

interface UseCompositionStackOptions {
  projectId: string;
  activeCompositionPath?: string | null;
  onCompositionChange?: (compositionPath: string | null) => void;
}

interface UseCompositionStackResult {
  compositionStack: CompositionLevel[];
  updateCompositionStack: React.Dispatch<React.SetStateAction<CompositionLevel[]>>;
  handleNavigateComposition: (index: number) => void;
  handleDrillDown: (element: { id: string; compositionSrc?: string; start?: number }) => void;
  compIdToSrc: Map<string, string>;
  setCompIdToSrc: React.Dispatch<React.SetStateAction<Map<string, string>>>;
}

export function useCompositionStack({
  projectId,
  activeCompositionPath,
  onCompositionChange,
}: UseCompositionStackOptions): UseCompositionStackResult {
  const [compositionStack, setCompositionStack] = useState<CompositionLevel[]>([
    {
      id: "master",
      label: "Master",
      previewUrl: `/api/projects/${projectId}/preview`,
    },
  ]);

  const onCompositionChangeRef = useRef(onCompositionChange);
  onCompositionChangeRef.current = onCompositionChange;

  const updateCompositionStack: typeof setCompositionStack = useCallback((action) => {
    setCompositionStack((prev) => {
      const next = typeof action === "function" ? action(prev) : action;
      const id = next[next.length - 1]?.id;
      queueMicrotask(() => onCompositionChangeRef.current?.(id === "master" ? null : id));
      return next;
    });
  }, []);

  const compositionStackRef = useRef(compositionStack);
  compositionStackRef.current = compositionStack;
  const [compIdToSrc, setCompIdToSrc] = useState<Map<string, string>>(new Map());

  const compIdToSrcRef = useRef(compIdToSrc);
  compIdToSrcRef.current = compIdToSrc;

  const handleNavigateComposition = useCallback(
    (index: number) => {
      const level = compositionStackRef.current[index];
      if (!level) return;
      const store = usePlayerStore.getState();
      if (level.seekTime !== undefined) store.setCurrentTime(level.seekTime);
      store.setElements([]);
      updateCompositionStack((prev) => prev.slice(0, index + 1));
    },
    [updateCompositionStack],
  );

  const handleDrillDown = useCallback(
    (element: { id: string; compositionSrc?: string; start?: number }) => {
      if (!element.compositionSrc) return;
      const src = (compIdToSrcRef.current.get(element.id) ?? element.compositionSrc)
        .replace(/\\/g, "/");
      const resolvedPath = src.match(/compositions\/.*\.html/)?.[0] ?? src;
      const stack = compositionStackRef.current;
      if (stack[stack.length - 1].id === resolvedPath && stack.length > 1) {
        handleNavigateComposition(stack.length - 2);
        return;
      }
      const store = usePlayerStore.getState();
      const parentTime = store.currentTime;
      store.setElements([]);
      store.setCurrentTime(Math.max(0, parentTime - (element.start ?? 0)));
      updateCompositionStack((prev) => {
        const parent = { ...prev[prev.length - 1], seekTime: parentTime };
        const label = resolvedPath.split("/").pop()?.replace(/\.html$/, "") || resolvedPath;
        const previewUrl = `/api/projects/${projectId}/preview/comp/${encodePreviewPath(resolvedPath)}`;
        return [...prev.slice(0, -1), parent, { id: resolvedPath, label, previewUrl }];
      });
    },
    [projectId, handleNavigateComposition, updateCompositionStack],
  );

  const normalizedActivePath = activeCompositionPath?.replace(/\\/g, "/");

  // Navigate to a composition when activeCompositionPath changes.
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    const master: CompositionLevel = {
      id: "master",
      label: "Master",
      previewUrl: `/api/projects/${projectId}/preview`,
    };
    if (normalizedActivePath === "index.html") {
      usePlayerStore.getState().setElements([]);
      updateCompositionStack([master]);
    } else if (normalizedActivePath && normalizedActivePath.startsWith("compositions/")) {
      const label = normalizedActivePath.replace(/^compositions\//, "").replace(/\.html$/, "");
      const previewUrl = `/api/projects/${projectId}/preview/comp/${encodePreviewPath(normalizedActivePath)}`;
      usePlayerStore.getState().setElements([]);
      updateCompositionStack((prev) => {
        if (prev[prev.length - 1]?.id === normalizedActivePath) return prev;
        return [master, { id: normalizedActivePath, label, previewUrl }];
      });
    } else if (!normalizedActivePath) {
      usePlayerStore.getState().setElements([]);
      updateCompositionStack([master]);
    }
  }, [normalizedActivePath, projectId, updateCompositionStack]);

  return {
    compositionStack,
    updateCompositionStack,
    handleNavigateComposition,
    handleDrillDown,
    compIdToSrc,
    setCompIdToSrc,
  };
}
