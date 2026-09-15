/**
 * Block drop/add handlers for the Studio.
 * Extracted from App.tsx to keep file sizes under the 600-line limit.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TimelineElement } from "../player";
import { usePlayerStore } from "../player";
import {
  addBlockToProject,
  normalizeBlockVariableValue,
  resolveInstalledComponentParams,
  type BlockVariableValue,
  type InstalledComponentParams,
} from "../utils/blockInstaller";
import type { EditHistoryKind } from "../utils/editHistory";
import { resolveTimelineSelectionSeekTime, type RightPanelTab } from "../utils/studioHelpers";
import { applyPatchByTarget } from "../utils/sourcePatcher";
import { saveProjectFilesWithHistory } from "../utils/studioFileHistory";
import { preloadBlockCatalog } from "./useBlockCatalog";
import { foldRippleGsapShiftsIntoHistory } from "./timelineTimingSync";

interface BlockCtxDeps {
  activeCompPath: string | null;
  timelineElements: TimelineElement[];
  readProjectFile: (path: string) => Promise<string>;
  writeProjectFile: (path: string, content: string) => Promise<void>;
  recordEdit: (entry: {
    label: string;
    kind: EditHistoryKind;
    coalesceKey?: string;
    files: Record<string, { before: string; after: string }>;
  }) => Promise<void>;
  markStudioWrite: () => void;
  refreshFileTree: () => Promise<void>;
  reloadPreview: () => void;
  showToast: (message: string, tone?: "error" | "info") => void;
}

interface UseBlockHandlersParams {
  projectId: string | null;
  blockCtxDeps: BlockCtxDeps;
  setCompositionLoading: (loading: boolean) => void;
  setRightCollapsed: (collapsed: boolean) => void;
  setRightPanelTab: (tab: RightPanelTab) => void;
}

export interface UseBlockHandlersResult {
  activeBlockParams: InstalledComponentParams | null;
  setActiveBlockParams: React.Dispatch<
    React.SetStateAction<UseBlockHandlersResult["activeBlockParams"]>
  >;
  handleAddBlock: (blockName: string) => Promise<boolean>;
  handleBlockVariableChange: (variableId: string, value: BlockVariableValue) => Promise<void>;
  handleTimelineBlockDrop: (blockName: string, placement: { start: number; track: number }) => void;
  handlePreviewBlockDrop: (blockName: string, position: { left: number; top: number }) => void;
}

export function useBlockHandlers({
  projectId,
  blockCtxDeps,
  setCompositionLoading,
  setRightCollapsed,
  setRightPanelTab,
}: UseBlockHandlersParams): UseBlockHandlersResult {
  const [activeBlockParams, setActiveBlockParams] =
    useState<UseBlockHandlersResult["activeBlockParams"]>(null);
  const activeBlockParamsRef = useRef(activeBlockParams);
  activeBlockParamsRef.current = activeBlockParams;
  const variableWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const selectedElementId = usePlayerStore((state) => state.selectedElementId);

  const blockCtx = useMemo(
    () => ({
      activeCompPath: blockCtxDeps.activeCompPath,
      timelineElements: blockCtxDeps.timelineElements,
      readProjectFile: blockCtxDeps.readProjectFile,
      writeProjectFile: blockCtxDeps.writeProjectFile,
      recordEdit: blockCtxDeps.recordEdit,
      markStudioWrite: blockCtxDeps.markStudioWrite,
      refreshFileTree: blockCtxDeps.refreshFileTree,
      reloadPreview: blockCtxDeps.reloadPreview,
      showToast: blockCtxDeps.showToast,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      blockCtxDeps.activeCompPath,
      blockCtxDeps.timelineElements,
      blockCtxDeps.readProjectFile,
      blockCtxDeps.writeProjectFile,
      blockCtxDeps.recordEdit,
      blockCtxDeps.markStudioWrite,
      blockCtxDeps.refreshFileTree,
      blockCtxDeps.reloadPreview,
      blockCtxDeps.showToast,
    ],
  );

  // Block installs hit the server and end in a full preview reload; without a
  // guard, repeat drops while one is in flight stack duplicate installs.
  const installingBlockRef = useRef(false);
  const runBlockInstall = useCallback(
    async <T>(blockName: string, install: () => Promise<T | null>): Promise<T | null> => {
      if (installingBlockRef.current) {
        blockCtx.showToast("A block is already installing — one moment…", "info");
        return null;
      }
      installingBlockRef.current = true;
      setCompositionLoading(true);
      blockCtx.showToast(`Adding ${blockName}…`, "info");
      try {
        const result = await install();
        if (result === null) setCompositionLoading(false);
        return result;
      } catch (error) {
        setCompositionLoading(false);
        throw error;
      } finally {
        installingBlockRef.current = false;
      }
    },
    [blockCtx, setCompositionLoading],
  );

  const activateInstalledBlock = useCallback(
    (result: Awaited<ReturnType<typeof addBlockToProject>>) => {
      if (!result) return;
      const params = result.block.type === "hyperframes:block" ? (result.block.params ?? []) : [];
      const variables = result.block.variables ?? [];
      if (!params.length && !variables.length) return;
      setActiveBlockParams({
        blockTitle: result.block.title,
        params,
        variables,
        variableValues: {},
        visualComponent: result.block.visualComponent,
        hostCompositionPath: result.hostCompositionPath,
        insertedElementId: result.insertedElementId,
        returnTab: "components",
      });
      setRightCollapsed(false);
      setRightPanelTab("block-params");
    },
    [setRightCollapsed, setRightPanelTab],
  );

  useEffect(() => {
    if (!projectId || !selectedElementId) return;
    const element = blockCtx.timelineElements.find(
      (candidate) => (candidate.key ?? candidate.id) === selectedElementId,
    );
    if (!element?.compositionSrc) return;
    const hostCompositionPath = element.sourceFile || blockCtx.activeCompPath || "index.html";
    let active = true;

    void Promise.all([preloadBlockCatalog(), blockCtx.readProjectFile(hostCompositionPath)])
      .then(([catalog, hostSource]) => {
        if (!active) return;
        const params = resolveInstalledComponentParams({
          catalog,
          element,
          hostCompositionPath,
          hostSource,
        });
        if (!params) return;
        setActiveBlockParams(params);
        setRightCollapsed(false);
        setRightPanelTab("block-params");
      })
      .catch((error: unknown) => {
        if (!active) return;
        blockCtx.showToast(
          error instanceof Error ? error.message : "Failed to load component variables",
          "error",
        );
      });

    return () => {
      active = false;
    };
  }, [
    blockCtx.activeCompPath,
    blockCtx.readProjectFile,
    blockCtx.showToast,
    blockCtx.timelineElements,
    projectId,
    selectedElementId,
    setRightCollapsed,
    setRightPanelTab,
  ]);

  const handleAddBlock = useCallback(
    async (blockName: string) => {
      if (!projectId) return false;
      const result = await runBlockInstall(blockName, () =>
        addBlockToProject({
          projectId,
          blockName,
          ...blockCtx,
          currentTime: usePlayerStore.getState().currentTime,
          insertionMode: "ripple",
          syncRippleGsap: ({ changes, coalesceKey, label }) =>
            foldRippleGsapShiftsIntoHistory({
              projectId,
              activeCompPath: blockCtx.activeCompPath,
              label,
              coalesceKey,
              recordEdit: blockCtx.recordEdit,
              changes,
            }),
        }),
      );
      if (result === null) return false;
      const insertedDuration =
        "duration" in result.block && typeof result.block.duration === "number"
          ? result.block.duration
          : 0;
      const previewTime = resolveTimelineSelectionSeekTime(result.insertedStart, {
        id: result.insertedElementId,
        start: result.insertedStart,
        duration: insertedDuration,
        compositionSrc: result.compositionPath,
      });
      usePlayerStore.getState().requestSeek(previewTime ?? result.insertedStart);
      activateInstalledBlock(result);
      return true;
    },
    [projectId, blockCtx, runBlockInstall, activateInstalledBlock],
  );

  const handleBlockVariableChange = useCallback(
    (variableId: string, value: BlockVariableValue): Promise<void> => {
      const save = async () => {
        const active = activeBlockParamsRef.current;
        if (!active || !projectId) return;
        const variable = active.variables.find((candidate) => candidate.id === variableId);
        if (!variable) return;

        const normalized = normalizeBlockVariableValue(variable, value);
        const nextValues = { ...active.variableValues };
        if (normalized === variable.default) delete nextValues[variableId];
        else nextValues[variableId] = normalized;

        const original = await blockCtx.readProjectFile(active.hostCompositionPath);
        const patched = applyPatchByTarget(
          original,
          { id: active.insertedElementId },
          {
            type: "attribute",
            property: "variable-values",
            value: Object.keys(nextValues).length ? JSON.stringify(nextValues) : null,
          },
        );
        if (patched === original) return;

        blockCtx.markStudioWrite();
        await saveProjectFilesWithHistory({
          projectId,
          label: `Configure component: ${active.blockTitle}`,
          kind: "source",
          coalesceKey: `component-variables:${active.insertedElementId}`,
          files: { [active.hostCompositionPath]: patched },
          readFile: async () => original,
          writeFile: blockCtx.writeProjectFile,
          recordEdit: blockCtx.recordEdit,
        });
        const nextActive = { ...active, variableValues: nextValues };
        activeBlockParamsRef.current = nextActive;
        setActiveBlockParams((current) =>
          current?.insertedElementId === active.insertedElementId ? nextActive : current,
        );
        blockCtx.reloadPreview();
      };

      const queued = variableWriteQueueRef.current.then(save);
      variableWriteQueueRef.current = queued.catch((error: unknown) => {
        blockCtx.showToast(
          error instanceof Error ? error.message : "Failed to update component variables",
          "error",
        );
      });
      return variableWriteQueueRef.current;
    },
    [blockCtx, projectId],
  );

  const handleTimelineBlockDrop = useCallback(
    (blockName: string, placement: { start: number; track: number }) => {
      if (!projectId) return;
      void runBlockInstall(blockName, () =>
        addBlockToProject({
          projectId,
          blockName,
          placement,
          ...blockCtx,
          currentTime: usePlayerStore.getState().currentTime,
        }),
      ).then(activateInstalledBlock);
    },
    [projectId, blockCtx, runBlockInstall, activateInstalledBlock],
  );

  const handlePreviewBlockDrop = useCallback(
    (blockName: string, position: { left: number; top: number }) => {
      if (!projectId) return;
      void runBlockInstall(blockName, () =>
        addBlockToProject({
          projectId,
          blockName,
          visualPosition: position,
          ...blockCtx,
          currentTime: usePlayerStore.getState().currentTime,
        }),
      ).then(activateInstalledBlock);
    },
    [projectId, blockCtx, runBlockInstall, activateInstalledBlock],
  );

  return {
    activeBlockParams,
    setActiveBlockParams,
    handleAddBlock,
    handleBlockVariableChange,
    handleTimelineBlockDrop,
    handlePreviewBlockDrop,
  };
}
