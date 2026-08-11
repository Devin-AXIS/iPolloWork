import { useCallback } from "react";
import type { Composition } from "@hyperframes/sdk";
import type { RegistryMotionPreset } from "@hyperframes/core/registry";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { roundTo3 } from "../utils/rounding";
import {
  sdkGsapTweenPersist,
  sdkGsapDeleteAllForSelectorPersist,
  sdkAddWithKeyframesPersist,
  sdkReplaceWithKeyframesPersist,
  cutoverCommittedOrThrow,
  type CutoverDeps,
} from "../utils/sdkCutover";
import {
  assignGsapTargetAutoIdIfNeeded,
  ensureElementAddressable,
} from "./gsapScriptCommitHelpers";
import type {
  CommitMutation,
  CommitMutationOptions,
  SafeGsapCommitMutation,
} from "./gsapScriptCommitTypes";
import {
  compileMotionInstance,
  createMotionInstance,
  defaultMotionDuration,
  getMotionPreset,
  type MotionMutationInput,
  type MotionTargetKind,
} from "@hyperframes/core/motion-presets";
import { resolveMotionPresetTiming, resolveSemanticMotionTiming } from "../utils/motionPreset";

interface SdkAnimationDeps {
  sdkSession?: Composition | null;
  sdkDeps?: CutoverDeps | null;
}

interface GsapAnimationOpsParams extends SdkAnimationDeps {
  projectIdRef: React.MutableRefObject<string | null>;
  activeCompPath: string | null;
  commitMutation: CommitMutation;
  commitMutationSafely: SafeGsapCommitMutation;
  showToast: (message: string, tone?: "error" | "info") => void;
}

function buildMotionInstantPatch(
  selector: string,
  targetKind: MotionTargetKind,
  mutation: MotionMutationInput,
  locator: { elementId?: string; hfId?: string },
): CommitMutationOptions["instantPatch"] | undefined {
  if (
    mutation.operation !== "upsert" ||
    !mutation.presetId ||
    mutation.start === undefined ||
    mutation.duration === undefined
  ) {
    return undefined;
  }
  try {
    const instance = createMotionInstance({
      presetId: mutation.presetId,
      target: { selector, ...locator },
      targetKind,
      start: mutation.start,
      duration: mutation.duration,
      loop: mutation.loop,
      parameters: mutation.parameters,
    });
    const compiled = compileMotionInstance(instance);
    return {
      selector: compiled.targetSelector,
      change: { kind: "motion", motionId: instance.id, compiled },
    };
  } catch {
    return undefined;
  }
}

export function useGsapAnimationOps({
  projectIdRef,
  activeCompPath,
  commitMutation,
  commitMutationSafely,
  showToast,
  sdkSession,
  sdkDeps,
}: GsapAnimationOpsParams) {
  const mutateMotion = useCallback(
    async (
      selection: DomEditSelection,
      targetKind: MotionTargetKind,
      mutation: MotionMutationInput,
    ) => {
      const { selector, autoId } = ensureElementAddressable(selection);
      if (autoId) {
        const projectId = projectIdRef.current;
        const targetPath = selection.sourceFile || activeCompPath || "index.html";
        if (!projectId) return;
        const assigned = await assignGsapTargetAutoIdIfNeeded({
          projectId,
          targetPath,
          selection,
          autoId,
          showToast,
        });
        if (!assigned) return;
      }
      const locator = {
        ...(selection.id || autoId ? { elementId: selection.id ?? autoId } : {}),
        ...(selection.hfId ? { hfId: selection.hfId } : {}),
      };
      const preset =
        mutation.operation === "upsert" && mutation.presetId
          ? getMotionPreset(mutation.presetId)
          : undefined;
      const normalizedMutation = preset
        ? (() => {
            const timing = resolveSemanticMotionTiming(
              selection,
              preset.phase,
              mutation.duration ?? defaultMotionDuration(preset),
              mutation.start,
            );
            return {
              ...mutation,
              start: timing.position,
              duration: timing.duration,
            };
          })()
        : mutation;
      const instantPatch = buildMotionInstantPatch(
        selector,
        targetKind,
        normalizedMutation,
        locator,
      );
      await commitMutation(
        selection,
        {
          type: "mutate-motion",
          ...normalizedMutation,
          targetSelector: selector,
          targetKind,
          ...locator,
        },
        {
          label:
            normalizedMutation.operation === "remove"
              ? "Remove motion preset"
              : "Apply motion preset",
          softReload: true,
          ...(instantPatch ? { instantPatch } : {}),
        },
      );
    },
    [activeCompPath, commitMutation, projectIdRef, showToast],
  );
  const updateGsapMeta = useCallback(
    async (
      selection: DomEditSelection,
      animationId: string,
      updates: { duration?: number; ease?: string; easeEach?: string; position?: number },
    ) => {
      if (sdkSession && sdkDeps) {
        const targetPath = selection.sourceFile || activeCompPath || "index.html";
        const handled = await sdkGsapTweenPersist(
          targetPath,
          { kind: "set", animationId, properties: updates },
          sdkSession,
          sdkDeps,
          { label: "Edit GSAP animation", coalesceKey: `gsap:${animationId}:meta` },
        );
        if (cutoverCommittedOrThrow(handled)) return;
      }
      commitMutationSafely(
        selection,
        { type: "update-meta", animationId, updates },
        { label: "Edit GSAP animation", coalesceKey: `gsap:${animationId}:meta`, softReload: true },
      );
    },
    [commitMutationSafely, activeCompPath, sdkSession, sdkDeps],
  );

  const deleteGsapAnimation = useCallback(
    async (selection: DomEditSelection, animationId: string) => {
      if (sdkSession && sdkDeps) {
        const targetPath = selection.sourceFile || activeCompPath || "index.html";
        const handled = await sdkGsapTweenPersist(
          targetPath,
          { kind: "remove", animationId },
          sdkSession,
          sdkDeps,
          { label: "Delete GSAP animation" },
        );
        if (cutoverCommittedOrThrow(handled)) return;
      }
      commitMutationSafely(
        selection,
        { type: "delete", animationId, stripStudioEdits: true },
        { label: "Delete GSAP animation" },
      );
    },
    [commitMutationSafely, activeCompPath, sdkSession, sdkDeps],
  );

  const deleteAllForSelector = useCallback(
    async (selection: DomEditSelection, targetSelector: string) => {
      if (sdkSession && sdkDeps) {
        const targetPath = selection.sourceFile || activeCompPath || "index.html";
        const handled = await sdkGsapDeleteAllForSelectorPersist(
          targetPath,
          targetSelector,
          sdkSession,
          sdkDeps,
          { label: "Delete all animations for element" },
        );
        if (cutoverCommittedOrThrow(handled)) return;
      }
      void commitMutation(
        selection,
        { type: "delete-all-for-selector", targetSelector },
        { label: "Delete all animations for element", softReload: true },
      );
    },
    [commitMutation, activeCompPath, sdkSession, sdkDeps],
  );

  // fallow-ignore-next-line complexity
  const addGsapAnimation = useCallback(
    // fallow-ignore-next-line complexity
    async (
      selection: DomEditSelection,
      method: "to" | "from" | "set" | "fromTo",
      _currentTime?: number,
    ) => {
      const { selector, autoId } = ensureElementAddressable(selection);

      if (autoId) {
        const pid = projectIdRef.current;
        const targetPath = selection.sourceFile || activeCompPath || "index.html";
        if (!pid) return;
        const assigned = await assignGsapTargetAutoIdIfNeeded({
          projectId: pid,
          targetPath,
          selection,
          autoId,
          showToast,
        });
        if (!assigned) return;
      }

      const elStart = Number.parseFloat(selection.dataAttributes?.start ?? "0") || 0;
      const elDuration = Number.parseFloat(selection.dataAttributes?.duration ?? "1") || 1;
      const position = roundTo3(elStart);
      const duration = roundTo3(elDuration);
      const toDefaults: Record<string, Record<string, number>> = {
        from: { opacity: 0 },
        to: { x: 0, y: 0, opacity: 1 },
        set: { opacity: 1 },
        fromTo: { x: 0, y: 0, opacity: 1 },
      };

      // Skip SDK path when an id was just assigned server-side (autoId): the
      // SDK session hasn't reloaded that write yet, so persisting its
      // serialization would clobber the new id — let the server add the tween
      // atomically with the id it wrote.
      if (!autoId && selection.hfId && sdkSession && sdkDeps) {
        const targetPath = selection.sourceFile || activeCompPath || "index.html";
        const spec = {
          method,
          position,
          ...(method !== "set" ? { duration, ease: "power2.out" as const } : {}),
          properties: toDefaults[method] ?? { opacity: 1 },
          ...(method === "fromTo" ? { fromProperties: { opacity: 0 } } : {}),
        };
        const handled = await sdkGsapTweenPersist(
          targetPath,
          { kind: "add", target: selection.hfId, spec },
          sdkSession,
          sdkDeps,
          { label: `Add GSAP ${method} animation` },
        );
        if (cutoverCommittedOrThrow(handled)) return;
      }

      await commitMutation(
        selection,
        {
          type: "add",
          targetSelector: selector,
          method,
          position,
          duration: method === "set" ? undefined : duration,
          ease: method === "set" ? undefined : "power2.out",
          properties: toDefaults[method] ?? { opacity: 1 },
          fromProperties: method === "fromTo" ? { opacity: 0 } : undefined,
        },
        { label: `Add GSAP ${method} animation` },
      );
    },
    [activeCompPath, commitMutation, projectIdRef, showToast, sdkSession, sdkDeps],
  );

  type KeyframeEntry = {
    percentage: number;
    properties: Record<string, number | string>;
    ease?: string;
    auto?: boolean;
  };

  const addWithKeyframes = useCallback(
    async (
      selection: DomEditSelection,
      targetSelector: string,
      position: number,
      duration: number,
      keyframes: KeyframeEntry[],
      ease?: string,
      label = "Add animation with keyframes",
    ) => {
      if (sdkSession && sdkDeps) {
        const targetPath = selection.sourceFile || activeCompPath || "index.html";
        const handled = await sdkAddWithKeyframesPersist(
          targetPath,
          targetSelector,
          position,
          duration,
          keyframes,
          ease,
          sdkSession,
          sdkDeps,
          { label },
        );
        if (cutoverCommittedOrThrow(handled)) return;
      }
      void commitMutation(
        selection,
        {
          type: "add-with-keyframes",
          targetSelector,
          position,
          duration,
          keyframes,
          ...(ease ? { ease } : {}),
        },
        { label, softReload: true },
      );
    },
    [commitMutation, activeCompPath, sdkSession, sdkDeps],
  );

  const replaceWithKeyframes = useCallback(
    async (
      selection: DomEditSelection,
      animationId: string,
      targetSelector: string,
      position: number,
      duration: number,
      keyframes: KeyframeEntry[],
      ease?: string,
      label = "Replace animation with keyframes",
    ) => {
      if (sdkSession && sdkDeps) {
        const targetPath = selection.sourceFile || activeCompPath || "index.html";
        const handled = await sdkReplaceWithKeyframesPersist(
          targetPath,
          animationId,
          targetSelector,
          position,
          duration,
          keyframes,
          ease,
          sdkSession,
          sdkDeps,
          { label },
        );
        if (cutoverCommittedOrThrow(handled)) return;
      }
      void commitMutation(
        selection,
        {
          type: "replace-with-keyframes",
          animationId,
          targetSelector,
          position,
          duration,
          keyframes,
          ...(ease ? { ease } : {}),
        },
        { label, softReload: true },
      );
    },
    [commitMutation, activeCompPath, sdkSession, sdkDeps],
  );

  const applyGsapMotionPreset = useCallback(
    async (
      selection: DomEditSelection,
      preset: RegistryMotionPreset,
      currentTime: number,
      label: string,
    ) => {
      const { selector, autoId } = ensureElementAddressable(selection);
      if (autoId) {
        const projectId = projectIdRef.current;
        const targetPath = selection.sourceFile || activeCompPath || "index.html";
        if (!projectId) return;
        const assigned = await assignGsapTargetAutoIdIfNeeded({
          projectId,
          targetPath,
          selection,
          autoId,
          showToast,
        });
        if (!assigned) return;
      }

      const { position, duration } = resolveMotionPresetTiming(selection, preset, currentTime);
      const mutation = {
        type: "add-with-keyframes",
        targetSelector: selector,
        position,
        duration,
        keyframes: preset.keyframes,
        ease: preset.ease,
      };
      const commitOptions = { label: `Apply ${label} motion preset`, softReload: true };

      if (!autoId && sdkSession && sdkDeps) {
        const targetPath = selection.sourceFile || activeCompPath || "index.html";
        const handled = await sdkAddWithKeyframesPersist(
          targetPath,
          selector,
          position,
          duration,
          preset.keyframes,
          preset.ease,
          sdkSession,
          sdkDeps,
          commitOptions,
        );
        if (cutoverCommittedOrThrow(handled)) return;
      }

      await commitMutation(selection, mutation, commitOptions);
    },
    [activeCompPath, commitMutation, projectIdRef, sdkDeps, sdkSession, showToast],
  );

  return {
    mutateMotion,
    updateGsapMeta,
    deleteGsapAnimation,
    deleteAllForSelector,
    addGsapAnimation,
    applyGsapMotionPreset,
    addWithKeyframes,
    replaceWithKeyframes,
  };
}
