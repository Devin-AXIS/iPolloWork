import { useState } from "react";
import type { DomEditSelection } from "./domEditingTypes";
import { Transform3DCube, type CubePose } from "./Transform3DCube";
import { useTrackDesignInput } from "../../contexts/DesignPanelInputContext";
import { ChevronDown } from "../../icons/SystemIcons";

// translateZ only foreshortens under a perspective lens. Rather than hardcode one
// (an arbitrary px value reads wrong at different canvas sizes), derive it from the
// element's composition: perspective = composition height puts the virtual camera
// one comp-height back, a natural ~53° vertical FOV that looks the same whether the
// canvas is 720p or 4K. Falls back to the element's own height only if the comp size
// can't be read (detached/unmeasured), never to a fixed magic number.
function naturalDepthPerspective(el: HTMLElement | null | undefined): number {
  if (!el) return 0;
  const root = el.closest("[data-hf-inner-root],[data-composition-id]") as HTMLElement | null;
  const compHeight = root?.offsetHeight || el.ownerDocument?.documentElement?.clientHeight || 0;
  if (compHeight > 0) return Math.round(compHeight);
  return Math.round((el.offsetHeight || 0) * 4) || 0;
}

type KeyframeEntry = Array<{
  percentage: number;
  properties: Record<string, number | string>;
  ease?: string;
}> | null;

interface PropertyPanel3dTransformProps {
  gsapRuntimeValues: Record<string, number>;
  gsapAnimId: string | null;
  resolveAnimIdForProp?: (prop: string) => string | null;
  gsapKeyframes: KeyframeEntry;
  currentPct: number;
  elStart: number;
  elDuration: number;
  element: DomEditSelection;
  onCommitAnimatedProperty?: (
    element: DomEditSelection,
    property: string,
    value: number,
  ) => Promise<void>;
  /** Batched commit — several props into one keyframe (the cube's rotationX/Y/Z). */
  onCommitAnimatedProperties?: (
    element: DomEditSelection,
    props: Record<string, number | string>,
  ) => Promise<void>;
  onSeekToTime?: (time: number) => void;
  onRemoveKeyframe?: (animId: string, pct: number) => void;
  onConvertToKeyframes?: (animId: string, duration?: number) => void;
  /** Live-set props on the preview element during a cube drag (no source write). */
  onLivePreviewProps?: (element: DomEditSelection, props: Record<string, number>) => void;
}

/** The draggable cube + its commit/recenter/live-preview wiring. */
function Cube3dControl({
  element,
  gsapRuntimeValues,
  onCommitAnimatedProperties,
  onLivePreviewProps,
  onKeyframe,
  keyframed,
}: {
  element: DomEditSelection;
  gsapRuntimeValues: Record<string, number>;
  onCommitAnimatedProperties: (
    element: DomEditSelection,
    props: Record<string, number | string>,
  ) => Promise<void>;
  onLivePreviewProps?: (element: DomEditSelection, props: Record<string, number>) => void;
  onKeyframe?: () => void;
  keyframed?: boolean;
}) {
  const track = useTrackDesignInput();
  const pose: CubePose = {
    rotationX: gsapRuntimeValues.rotationX ?? 0,
    rotationY: gsapRuntimeValues.rotationY ?? 0,
    rotationZ: gsapRuntimeValues.rotationZ ?? 0,
  };
  // Comp-derived lens (see naturalDepthPerspective) applied the first time depth is
  // set, so the scene's foreshortening scales with the canvas instead of a magic 800.
  const depthPerspective = naturalDepthPerspective(element.element);
  // A gentle, fixed "depth pose" tilt (degrees) dropped on a flat element the first
  // time it gets depth, so translateZ reads as 3D foreshortening instead of a plain
  // resize — small enough to look like a premium card, not a flip.
  const DEPTH_POSE_X = 10;
  const DEPTH_POSE_Y = -15;
  const isFlat = Math.round(pose.rotationX) === 0 && Math.round(pose.rotationY) === 0;
  // Commit only the rotation axes the drag actually changed (each rounded to a
  // whole degree). Reuses the keyframe-aware animated-property commit, so a drag
  // at the playhead writes/updates a keyframe just like the numeric fields.
  const commitPose = (next: CubePose) => {
    const changedProps: Record<string, number> = {};
    for (const axis of ["rotationX", "rotationY", "rotationZ"] as const) {
      const rounded = Math.round(next[axis]);
      if (rounded !== Math.round(pose[axis])) changedProps[axis] = rounded;
    }
    const axes = Object.keys(changedProps);
    if (axes.length === 0) return;
    track("slider", "3D rotation pose");
    // ONE keyframe for the whole pose change — avoids per-axis commits racing into
    // adjacent duplicate keyframes.
    void onCommitAnimatedProperties(element, changedProps);
  };
  const recenter = () => {
    // ONE commit for the whole reset — six per-axis commits meant six soft-reloads
    // (six flashes) for a single click. Batch like commitPose does.
    const identity = {
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      z: 0,
      scale: 1,
      transformPerspective: 0,
    };
    track("button", "Reset 3D transform");
    void onCommitAnimatedProperties(element, identity);
  };
  // Immediate element feedback while dragging — set the live transform without a
  // source write; the release commits via commitPose.
  const livePreview = (next: CubePose) =>
    onLivePreviewProps?.(element, {
      rotationX: next.rotationX,
      rotationY: next.rotationY,
      rotationZ: next.rotationZ,
    });

  return (
    <div>
      <div className="w-full">
        <Transform3DCube
          pose={pose}
          perspective={gsapRuntimeValues.transformPerspective ?? 0}
          defaultPerspective={depthPerspective}
          z={gsapRuntimeValues.z ?? 0}
          onPoseDraft={livePreview}
          onPoseCommit={commitPose}
          onDepthDraft={(z) => {
            // Preview WITH a lens so depth is visible while scrolling — the same
            // default the commit applies, so the element doesn't snap on release.
            const preview: Record<string, number> = gsapRuntimeValues.transformPerspective
              ? { z }
              : { z, transformPerspective: depthPerspective };
            // Depth-pose preview: a flat element only scales under Z, so mirror the
            // commit and preview the gentle tilt that makes the depth read as 3D.
            if (isFlat) {
              preview.rotationX = DEPTH_POSE_X;
              preview.rotationY = DEPTH_POSE_Y;
            }
            onLivePreviewProps?.(element, preview);
          }}
          onDepthCommit={(z) => {
            // Best-UX depth: scroll moves Z, and a 3D transform always has a lens —
            // like an After Effects camera. translateZ is invisible without a
            // perspective, so the FIRST time depth is added (Perspective still 0) we
            // set a sensible comp-derived lens ONCE. Every later scroll touches Z
            // only, and Perspective stays an independent, editable field. The cube's
            // scroll is clamped in front of the lens, so Z can't run away past it.
            const props: Record<string, number> = { z };
            if (!gsapRuntimeValues.transformPerspective && depthPerspective > 0) {
              props.transformPerspective = depthPerspective;
            }
            // Depth-pose: a flat element (no tilt) only scales under Z — it can't read
            // as depth. So the first time depth lands on a flat element, also drop a
            // gentle fixed tilt; the foreshortening makes depth read as 3D IN PLACE
            // (no screen travel, per-element lens unchanged). Once the element has any
            // tilt, depth scrolls touch Z only. Reset tilt to 0 to go flat again.
            if (isFlat) {
              props.rotationX = DEPTH_POSE_X;
              props.rotationY = DEPTH_POSE_Y;
            }
            // One commit for all props so the writes can't race read-modify-write on
            // the same script (which dropped a prop and reverted after a seek).
            track("slider", "3D depth");
            void onCommitAnimatedProperties(element, props);
          }}
          onRecenter={recenter}
          onKeyframe={onKeyframe}
          keyframed={keyframed}
        />
        <p className="mt-1 text-center text-[10px] leading-snug text-[#858a94]">
          Drag to adjust the view
        </p>
      </div>
    </div>
  );
}

export function PropertyPanel3dTransform({
  gsapRuntimeValues,
  gsapAnimId,
  resolveAnimIdForProp,
  gsapKeyframes,
  currentPct,
  elStart,
  elDuration,
  element,
  onCommitAnimatedProperty,
  onCommitAnimatedProperties,
  onSeekToTime,
  onRemoveKeyframe,
  onConvertToKeyframes,
  onLivePreviewProps,
}: PropertyPanel3dTransformProps) {
  const [presetOpen, setPresetOpen] = useState(false);
  const [view, setView] = useState("Front");
  const presets: Record<string, { rotationX: number; rotationY: number; rotationZ: number }> = {
    Front: { rotationX: 0, rotationY: 0, rotationZ: 0 },
    Left: { rotationX: 0, rotationY: -90, rotationZ: 0 },
    Right: { rotationX: 0, rotationY: 90, rotationZ: 0 },
    "Low Angle": { rotationX: -28, rotationY: 0, rotationZ: 0 },
    Custom: {
      rotationX: gsapRuntimeValues.rotationX ?? 0,
      rotationY: gsapRuntimeValues.rotationY ?? 0,
      rotationZ: gsapRuntimeValues.rotationZ ?? 0,
    },
  };
  const choosePreset = (name: string) => {
    const pose = presets[name];
    if (!pose) return;
    setView(name);
    setPresetOpen(false);
    if (name !== "Custom") void onCommitAnimatedProperties?.(element, pose);
  };
  const commitRange = (property: "z" | "scale", raw: string) => {
    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value)) return;
    void onCommitAnimatedProperty?.(element, property, value);
  };
  const rangeControls: Array<{
    label: string;
    property: "z" | "scale";
    value: number;
    min: number;
    max: number;
    step: number;
  }> = [
    {
      label: "Depth",
      property: "z",
      value: gsapRuntimeValues.z ?? 0,
      min: -500,
      max: 500,
      step: 1,
    },
    {
      label: "Size",
      property: "scale",
      value: gsapRuntimeValues.scale ?? 1,
      min: 0.1,
      max: 3,
      step: 0.05,
    },
  ];

  return (
    <div data-flat-3d-transform="true" className="grid gap-2">
      {onCommitAnimatedProperties && (
        <Cube3dControl
          element={element}
          gsapRuntimeValues={gsapRuntimeValues}
          onCommitAnimatedProperties={onCommitAnimatedProperties}
          onLivePreviewProps={onLivePreviewProps}
          keyframed={(gsapKeyframes ?? []).some(
            (kf) =>
              "rotationX" in kf.properties ||
              "rotationY" in kf.properties ||
              "rotationZ" in kf.properties,
          )}
          onKeyframe={() => {
            // Convert the 3D ("other"-group) static set to keyframes so the
            // cube can animate; spans the element's clip via elDuration.
            const id = resolveAnimIdForProp?.("rotationX") ?? gsapAnimId;
            if (id) onConvertToKeyframes?.(id, elDuration);
          }}
        />
      )}
      <div className="relative">
        <button
          type="button"
          aria-expanded={presetOpen}
          onClick={() => setPresetOpen((open) => !open)}
          className="flex h-[34px] w-full items-center justify-between rounded-[6px] bg-panel-input pl-2 pr-4"
        >
          <span className="text-[10px] text-[#858a94]">View</span>
          <span className="flex items-center gap-4 text-[13px] text-[#24262b] dark:text-panel-text-1">
            {view}
            <ChevronDown size={16} className="text-[#858a94]" />
          </span>
        </button>
        {presetOpen && (
          <div className="absolute inset-x-0 top-[42px] z-20 grid gap-[9px] rounded-[12px] border border-[#dedfe3] bg-white p-3 shadow-[0_8px_18px_rgba(37,41,49,0.11)] dark:border-panel-hairline dark:bg-panel-bg">
            {Object.keys(presets).map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => choosePreset(name)}
                className={`flex h-[34px] items-center rounded-[6px] px-[10px] text-left text-[12px] text-[#24262b] dark:text-panel-text-1 ${view === name ? "bg-[#f4f5f7] dark:bg-panel-input" : "hover:bg-[#f4f5f7] dark:hover:bg-panel-input"}`}
              >
                {name}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="hf-flat-responsive-grid grid grid-cols-2 gap-2 px-2">
        {rangeControls.map((control) => (
          <label
            key={control.property}
            className="flex h-[34px] items-center gap-1 text-[10px] text-[#858a94]"
          >
            <span>{control.label}</span>
            <input
              type="range"
              aria-label={control.label}
              min={control.min}
              max={control.max}
              step={control.step}
              value={control.value}
              onChange={(event) => commitRange(control.property, event.target.value)}
              className="min-w-0 flex-1 accent-black dark:accent-white"
            />
          </label>
        ))}
      </div>
    </div>
  );
}
