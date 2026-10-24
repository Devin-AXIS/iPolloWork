// Composition drill-down stack management for NLEContext/EditorShell
import { useState, useCallback, useRef, useEffect } from "react";
import { usePlayerStore, type TimelineElement } from "../../player";
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
  handleDrillDown: (
    element:
      | TimelineElement
      | {
          id: string;
          compositionSrc?: string;
          start?: number;
          playbackStart?: number;
          playbackRate?: number;
          inlineScopeKind?: undefined;
        },
  ) => void;
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
      const fileLevel = next.findLast((level) => !level.inlineTarget);
      const previousFile = prev.findLast((level) => !level.inlineTarget);
      if (fileLevel?.id !== previousFile?.id) {
        queueMicrotask(() =>
          onCompositionChangeRef.current?.(
            fileLevel?.id === "master" ? null : (fileLevel?.id ?? null),
          ),
        );
      }
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
      store.setSelectedPropertyKeyframe(null);
      let time = store.currentTime;
      const stack = compositionStackRef.current;
      const exitedInlineTarget = stack[index + 1]?.inlineTarget;
      if (exitedInlineTarget && stack.slice(index + 1).every((child) => child.inlineTarget)) {
        store.setSelectedElementId(exitedInlineTarget.key ?? exitedInlineTarget.id);
      }
      for (let i = stack.length - 1; i > index; i--) {
        if (stack[i].inlineTarget) continue;
        const timing = stack[i].parentTiming;
        time = timing
          ? timing.start + (time - timing.offset) / timing.rate
          : (stack[i - 1].seekTime ?? time);
      }
      store.setCurrentTime(Math.max(0, time));
      if (stack.slice(index + 1).some((child) => !child.inlineTarget)) store.setElements([]);
      updateCompositionStack((prev) => prev.slice(0, index + 1));
    },
    [updateCompositionStack],
  );

  const handleDrillDown = useCallback(
    (
      element:
        | TimelineElement
        | {
            id: string;
            compositionSrc?: string;
            start?: number;
            playbackStart?: number;
            playbackRate?: number;
            inlineScopeKind?: undefined;
          },
    ) => {
      if (!element.compositionSrc) {
        if (!element.inlineScopeKind) return;
        const stack = compositionStackRef.current;
        const previous = stack[stack.length - 1];
        const targetId = `inline:${element.key ?? element.id}`;
        if (previous.id === targetId) return;
        // No source-file change, element clearing, preview reload, or time conversion.
        const store = usePlayerStore.getState();
        store.setSelectedPropertyKeyframe(null);
        const end = element.start + element.duration;
        if (
          Number.isFinite(element.start) &&
          element.duration > 0 &&
          (store.currentTime < element.start || store.currentTime >= end)
        ) {
          // The provider applies the new scene range after the stack changes.
          // Keep the authored global time until that runtime seek runs.
          store.setCurrentTime(element.start);
        }
        updateCompositionStack([
          ...stack,
          {
            id: targetId,
            label: element.label ?? element.id,
            previewUrl: previous.previewUrl,
            inlineTarget: element,
          },
        ]);
        return;
      }
      const src = (compIdToSrcRef.current.get(element.id) ?? element.compositionSrc).replace(
        /\\/g,
        "/",
      );
      const resolvedPath = src.match(/compositions\/.*\.html/)?.[0] ?? src;
      const stack = compositionStackRef.current;
      if (stack[stack.length - 1].id === resolvedPath && stack.length > 1) {
        handleNavigateComposition(stack.length - 2);
        return;
      }
      const store = usePlayerStore.getState();
      store.setSelectedPropertyKeyframe(null);
      const parentTime = store.currentTime;
      store.setElements([]);
      const parentTiming = {
        start: element.start ?? 0,
        offset: element.playbackStart ?? 0,
        rate: element.playbackRate && element.playbackRate > 0 ? element.playbackRate : 1,
      };
      store.setCurrentTime(
        Math.max(0, parentTiming.offset + (parentTime - parentTiming.start) * parentTiming.rate),
      );
      updateCompositionStack((prev) => {
        const parent = { ...prev[prev.length - 1], seekTime: parentTime };
        const label =
          resolvedPath
            .split("/")
            .pop()
            ?.replace(/\.html$/, "") || resolvedPath;
        const previewUrl = `/api/projects/${projectId}/preview/comp/${encodePreviewPath(resolvedPath)}`;
        return [
          ...prev.slice(0, -1),
          parent,
          { id: resolvedPath, label, previewUrl, parentTiming },
        ];
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
        if (prev.findLast((level) => !level.inlineTarget)?.id === normalizedActivePath) return prev;
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
