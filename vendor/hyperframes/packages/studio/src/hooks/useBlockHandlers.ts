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
import type { EditHistoryKind, EditHistoryState } from "../utils/editHistory";
import {
  resolveTimelineSelectionSeekTime,
  type RightPanelTab,
  type ToastToneInput,
} from "../utils/studioHelpers";
import { applyPatchByTarget, readAttributeByTarget } from "../utils/sourcePatcher";
import { validateComponentVariables, type ComponentVariableValues } from "@hyperframes/core/registry";
import { saveProjectFilesWithHistory } from "../utils/studioFileHistory";
import { preloadBlockCatalog } from "./useBlockCatalog";
import { foldRippleGsapShiftsIntoHistory } from "./timelineTimingSync";

interface BlockCtxDeps {
  activeCompPath: string | null;
  previewIframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
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
  showToast: (message: string, tone?: ToastToneInput) => number;
  dismissToast: (id: number) => void;
}

interface UseBlockHandlersParams {
  projectId: string | null;
  blockCtxDeps: BlockCtxDeps;
  compositionLoading: boolean;
  historyState: EditHistoryState;
  clearDomSelection: () => void;
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
  handleBlockVariablesChange: (values: ComponentVariableValues, expected?: ComponentVariableValues) => Promise<void>;
  handleTimelineBlockDrop: (blockName: string, placement: { start: number; track: number }) => void;
  handlePreviewBlockDrop: (blockName: string, position: { left: number; top: number }) => void;
}

export function useBlockHandlers({
  projectId,
  blockCtxDeps,
  compositionLoading,
  historyState,
  clearDomSelection,
  setCompositionLoading,
  setRightCollapsed,
  setRightPanelTab,
}: UseBlockHandlersParams): UseBlockHandlersResult {
  const [activeBlockParams, setActiveBlockParams] =
    useState<UseBlockHandlersResult["activeBlockParams"]>(null);
  const activeBlockParamsRef = useRef(activeBlockParams);
  activeBlockParamsRef.current = activeBlockParams;
  const variableWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingInsertedSelectionRef = useRef<string | null>(null);
  const selectedElementId = usePlayerStore((state) => state.selectedElementId);

  const blockCtx = useMemo(
    () => ({
      activeCompPath: blockCtxDeps.activeCompPath,
      previewIframeRef: blockCtxDeps.previewIframeRef,
      timelineElements: blockCtxDeps.timelineElements,
      readProjectFile: blockCtxDeps.readProjectFile,
      writeProjectFile: blockCtxDeps.writeProjectFile,
      recordEdit: blockCtxDeps.recordEdit,
      markStudioWrite: blockCtxDeps.markStudioWrite,
      refreshFileTree: blockCtxDeps.refreshFileTree,
      reloadPreview: blockCtxDeps.reloadPreview,
      showToast: blockCtxDeps.showToast,
      dismissToast: blockCtxDeps.dismissToast,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      blockCtxDeps.activeCompPath,
      blockCtxDeps.previewIframeRef,
      blockCtxDeps.timelineElements,
      blockCtxDeps.readProjectFile,
      blockCtxDeps.writeProjectFile,
      blockCtxDeps.recordEdit,
      blockCtxDeps.markStudioWrite,
      blockCtxDeps.refreshFileTree,
      blockCtxDeps.reloadPreview,
      blockCtxDeps.showToast,
      blockCtxDeps.dismissToast,
    ],
  );

  // Block installs hit the server and end in a full preview reload; without a
  // guard, repeat drops while one is in flight stack duplicate installs.
  const installingBlockRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (installingBlockRef.current !== null) window.clearInterval(installingBlockRef.current);
  }, []);
  const runBlockInstall = useCallback(
    async <T>(blockName: string, install: () => Promise<T | null>): Promise<T | null> => {
      if (installingBlockRef.current !== null) {
        blockCtx.showToast("A block is already installing — one moment…", "error");
        return null;
      }
      // Registry downloads can exceed the watcher's self-write window. Keep
      // their intermediate files suppressed until the host patch is saved.
      blockCtx.markStudioWrite();
      const writeTimer = window.setInterval(blockCtx.markStudioWrite, 1_000);
      installingBlockRef.current = writeTimer;
      setCompositionLoading(true);
      const loadingToastId = blockCtx.showToast("Adding component…", "loading");
      try {
        const result = await install();
        blockCtx.dismissToast(loadingToastId);
        if (result === null) setCompositionLoading(false);
        else blockCtx.showToast("Component added", "success");
        return result;
      } catch (error) {
        blockCtx.dismissToast(loadingToastId);
        setCompositionLoading(false);
        throw error;
      } finally {
        window.clearInterval(writeTimer);
        installingBlockRef.current = null;
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

  const selectInstalledBlock = useCallback(
    (result: Awaited<ReturnType<typeof addBlockToProject>>) => {
      if (!result) return;
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
      const playerState = usePlayerStore.getState();
      const insertedSelectionId = result.insertedElement.key ?? result.insertedElement.id;
      if (!playerState.elements.some((element) => (element.key ?? element.id) === insertedSelectionId)) {
        playerState.setElements([...playerState.elements, result.insertedElement]);
      }
      clearDomSelection();
      pendingInsertedSelectionRef.current = result.insertedElementId;
      playerState.setSelectedElementId(insertedSelectionId);
      playerState.requestClipReveal(insertedSelectionId);
      playerState.requestSeek(previewTime ?? result.insertedStart);
      activateInstalledBlock(result);
    },
    [activateInstalledBlock, clearDomSelection],
  );

  useEffect(() => {
    const insertedElementId = pendingInsertedSelectionRef.current;
    if (!insertedElementId) return;
    const insertedElement = blockCtx.timelineElements.find(
      (candidate) =>
        candidate.domId === insertedElementId ||
        candidate.hfId === insertedElementId ||
        candidate.id === insertedElementId,
    );
    if (!insertedElement) return;
    const selectionId = insertedElement.key ?? insertedElement.id;

    if (selectedElementId !== selectionId) {
      usePlayerStore.getState().setSelectedElementId(selectionId);
    }
    usePlayerStore.getState().requestClipReveal(selectionId);
    if (!compositionLoading) pendingInsertedSelectionRef.current = null;
  }, [blockCtx.timelineElements, compositionLoading, selectedElementId]);

  useEffect(() => {
    if (compositionLoading) return;
    if (!projectId || !selectedElementId) {
      setActiveBlockParams(null);
      return;
    }
    const element = blockCtx.timelineElements.find(
      (candidate) => (candidate.key ?? candidate.id) === selectedElementId,
    );
    if (!element?.compositionSrc) {
      setActiveBlockParams(null);
      return;
    }
    const compositionSrc = element.compositionSrc;
    const hostCompositionPath = element.sourceFile || blockCtx.activeCompPath || "index.html";
    let active = true;
    const pendingVariables = variableWriteQueueRef.current;

    // History can restore variables in place without changing the timeline.
    // Read committed source after pending saves, and reject superseded reads.
    void pendingVariables
      .then(() => {
        if (!active) return null;
        return Promise.all([
          preloadBlockCatalog(),
          blockCtx.readProjectFile(hostCompositionPath),
          blockCtx.readProjectFile(compositionSrc),
        ]);
      })
      .then((sources) => {
        if (!active || !sources || pendingVariables !== variableWriteQueueRef.current) return;
        const [catalog, hostSource, compositionSource] = sources;
        const params = resolveInstalledComponentParams({
          catalog,
          element,
          hostCompositionPath,
          hostSource,
          compositionSource,
        });
        if (!params) return;
        const current = activeBlockParamsRef.current;
        const selectionChanged = current?.insertedElementId !== params.insertedElementId ||
          current.hostCompositionPath !== params.hostCompositionPath;
        setActiveBlockParams(params);
        if (selectionChanged) {
          setRightCollapsed(false);
          setRightPanelTab("block-params");
        }
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
    compositionLoading,
    historyState,
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
      selectInstalledBlock(result);
      return true;
    },
    [projectId, blockCtx, runBlockInstall, selectInstalledBlock],
  );

  const handleBlockVariablesChange = useCallback(
    (patch: ComponentVariableValues, expected?: ComponentVariableValues): Promise<void> => {
      const active = activeBlockParamsRef.current;
      const save = async () => {
        if (!active || !projectId) throw Error("Select a component before editing");
        const original = await blockCtx.readProjectFile(active.hostCompositionPath);
        const raw = readAttributeByTarget(original, { id: active.insertedElementId }, "variable-values");
        const parsed: unknown = raw ? JSON.parse(raw) : {};
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw Error("Invalid component variables");
        const previous: ComponentVariableValues = {};
        for (const variable of active.variables) {
          const current: unknown = Reflect.get(parsed, variable.id);
          previous[variable.id] = typeof current === "string" || typeof current === "number" || typeof current === "boolean" ? current : variable.default;
          if (expected && previous[variable.id] !== (expected[variable.id] ?? variable.default)) throw Error("The component changed. Reload current JSON before applying.");
        }
        const model = active.visualComponent?.ai?.model;
        const next = { ...previous };
        for (const [id, value] of Object.entries(patch)) {
          const variable = active.variables.find(candidate => candidate.id === id);
          if (!variable) throw Error(`Unknown component variable: ${id}`);
          next[id] = model ? value : normalizeBlockVariableValue(variable, value);
        }
        if (model) {
          const result = validateComponentVariables(model, next);
          if (result.errors.length) throw Error(result.errors.map(issue => `${issue.path}: ${issue.message}`).join("\n"));
        }
        const nextValues = Object.fromEntries(active.variables.filter(v => next[v.id] !== v.default).map(v => [v.id, next[v.id] ?? v.default]));
        const frame = blockCtx.previewIframeRef.current;
        const host = frame?.contentDocument?.getElementById(active.insertedElementId);
        const root = host?.matches("[data-var-text]") ? host : host?.querySelector<HTMLElement>("[data-hf-live-variables]") ?? host;
        const runtime = (frame?.contentWindow as (Window & {
          __hyperframes?: { updateVariables?: (root: Element, patch: Record<string, unknown>) => boolean };
        }) | null)?.__hyperframes;
        const livePatch = Object.fromEntries(Object.keys(patch).map(id => [id, next[id]]));
        const canUpdateLive = !!model || Object.keys(patch).every(id => active.variables.find(variable => variable.id === id)?.update === "live");
        if (model && (!root || !runtime?.updateVariables)) throw Error("The component preview is not ready. Wait for it to load before applying.");
        const fonts = frame?.contentDocument?.fonts;
        const waitForFonts = async () => {
          if (fonts && !(await Promise.race([fonts.ready.then(() => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), 5000))]))) throw Error("The project fonts are still loading. Try applying again when they are ready.");
          if (frame !== blockCtx.previewIframeRef.current || !root?.isConnected) throw Error("The component preview changed. Wait for it to load before applying.");
        };
        let live = false;
        try {
          if (model) await waitForFonts();
          live = !!(canUpdateLive && root && runtime?.updateVariables?.(root, livePatch));
          if (model && !live) throw Error("The component preview did not accept this update. Reload it before applying.");
          if (model) {
            // A new skin can request fonts that the previous preview never used.
            await waitForFonts();
            if (!runtime?.updateVariables?.(root!, livePatch)) throw Error("The component preview did not accept this update.");
          }
          const patched = applyPatchByTarget(original, { id: active.insertedElementId }, {
            type: "attribute", property: "variable-values",
            value: Object.keys(nextValues).length ? JSON.stringify(nextValues) : null,
          });
          if (patched === original) return;
          blockCtx.markStudioWrite();
          await saveProjectFilesWithHistory({
            projectId, label: `Configure component: ${active.blockTitle}`, kind: "source",
            ...(expected ? {} : { coalesceKey: `component-variables:${active.insertedElementId}` }),
            files: { [active.hostCompositionPath]: patched }, readFile: async () => original,
            writeFile: blockCtx.writeProjectFile, recordEdit: blockCtx.recordEdit,
          });
          const nextActive = { ...active, variableValues: nextValues };
          const sameTarget = (current: InstalledComponentParams | null) => current?.insertedElementId === active.insertedElementId && current.hostCompositionPath === active.hostCompositionPath;
          if (sameTarget(activeBlockParamsRef.current)) activeBlockParamsRef.current = nextActive;
          setActiveBlockParams(current => sameTarget(current) ? nextActive : current);
          if (!live) blockCtx.reloadPreview();
        } catch (error) {
          if (live && root) runtime?.updateVariables?.(root, previous);
          throw error;
        }
      };
      const queued = variableWriteQueueRef.current.then(save);
      variableWriteQueueRef.current = queued.catch((error: unknown) => {
        blockCtx.showToast(error instanceof Error ? error.message : "Failed to update component variables", "error");
      });
      return queued;
    }, [blockCtx, projectId],
  );
  const handleBlockVariableChange = useCallback((id: string, value: BlockVariableValue) =>
    handleBlockVariablesChange({ [id]: value }), [handleBlockVariablesChange]);

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
      ).then(selectInstalledBlock).catch((error: unknown) => {
        blockCtx.showToast(error instanceof Error ? error.message : "Failed to add component", "error");
      });
    },
    [projectId, blockCtx, runBlockInstall, selectInstalledBlock],
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
      ).then(selectInstalledBlock).catch((error: unknown) => {
        blockCtx.showToast(error instanceof Error ? error.message : "Failed to add component", "error");
      });
    },
    [projectId, blockCtx, runBlockInstall, selectInstalledBlock],
  );

  return {
    activeBlockParams,
    setActiveBlockParams,
    handleAddBlock,
    handleBlockVariableChange,
    handleBlockVariablesChange,
    handleTimelineBlockDrop,
    handlePreviewBlockDrop,
  };
}
