/**
 * Block drop/add handlers for the Studio.
 * Extracted from App.tsx to keep file sizes under the 600-line limit.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import type { TimelineElement } from "../player";
import { usePlayerStore } from "../player";
import { addBlockToProject } from "../utils/blockInstaller";
import type { EffectInsertIntent } from "../utils/blockInstaller";
import type { BlockParam } from "@hyperframes/core/registry";
import type { EditHistoryKind } from "../utils/editHistory";
import { resolveTimelineSelectionSeekTime, type RightPanelTab } from "../utils/studioHelpers";

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
  previewIframeRef: React.RefObject<HTMLIFrameElement | null>;
  setCompositionLoading: (loading: boolean) => void;
  setRightCollapsed: (collapsed: boolean) => void;
  setRightPanelTab: (tab: RightPanelTab) => void;
}

export interface UseBlockHandlersResult {
  activeBlockParams: {
    blockName: string;
    blockTitle: string;
    params: BlockParam[];
    compositionPath: string;
  } | null;
  setActiveBlockParams: React.Dispatch<
    React.SetStateAction<UseBlockHandlersResult["activeBlockParams"]>
  >;
  handleAddBlock: (blockName: string, intent?: EffectInsertIntent) => void;
  handleTimelineBlockDrop: (blockName: string, placement: { start: number; track: number }) => void;
  handlePreviewBlockDrop: (blockName: string, position: { left: number; top: number }) => void;
}

export function useBlockHandlers({
  projectId,
  blockCtxDeps,
  previewIframeRef,
  setCompositionLoading,
  setRightCollapsed,
  setRightPanelTab,
}: UseBlockHandlersParams): UseBlockHandlersResult {
  const [activeBlockParams, setActiveBlockParams] =
    useState<UseBlockHandlersResult["activeBlockParams"]>(null);

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

  const handleAddBlock = useCallback(
    (blockName: string, intent: EffectInsertIntent = "playhead") => {
      if (!projectId) return;
      // fallow-ignore-next-line complexity
      void (async () => {
        const result = await runBlockInstall(blockName, () =>
          addBlockToProject({
            projectId,
            blockName,
            ...blockCtx,
            previewIframe: previewIframeRef.current,
            currentTime: usePlayerStore.getState().currentTime,
            selectedElementId: usePlayerStore.getState().selectedElementId,
            effectIntent: intent,
          }),
        );
        if (result === null) return;
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
        const params = result?.block.type === "hyperframes:block" ? result.block.params : undefined;
        if (params?.length) {
          setActiveBlockParams({
            blockName: result!.block.name,
            blockTitle: result!.block.title,
            params,
            compositionPath: result!.compositionPath,
          });
          setRightCollapsed(false);
          setRightPanelTab("block-params");
        }
      })();
    },
    [projectId, blockCtx, previewIframeRef, runBlockInstall, setRightCollapsed, setRightPanelTab],
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
          previewIframe: previewIframeRef.current,
          currentTime: usePlayerStore.getState().currentTime,
        }),
      );
    },
    [projectId, blockCtx, previewIframeRef, runBlockInstall],
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
          previewIframe: previewIframeRef.current,
          currentTime: usePlayerStore.getState().currentTime,
        }),
      );
    },
    [projectId, blockCtx, previewIframeRef, runBlockInstall],
  );

  return {
    activeBlockParams,
    setActiveBlockParams,
    handleAddBlock,
    handleTimelineBlockDrop,
    handlePreviewBlockDrop,
  };
}
