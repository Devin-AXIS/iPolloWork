import { readMotionInstanceFromExtras } from "@hyperframes/core/motion-presets";
import { usePlayerStore } from "../../player/store/playerStore";
import { memo, useState } from "react";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { ADD_METHODS, ADD_METHOD_LABELS, METHOD_TOOLTIPS } from "./gsapAnimationConstants";
import { AnimationCard } from "./AnimationCard";
import {
  trackAnimationMetaUpdate,
  type GsapAnimationEditCallbacks,
} from "./gsapAnimationCallbacks";
import { useTrackDesignInput } from "../../contexts/DesignPanelInputContext";
import type {
  TimelineAnimationOwnerRange,
  TimelineAnimationOwnerLocator,
} from "../../utils/timelineAnimationSegments";
import { useStudioI18n } from "../../i18n";

interface GsapAnimationSectionProps extends GsapAnimationEditCallbacks {
  animations: GsapAnimation[];
  compact?: boolean;
  multipleTimelines?: boolean;
  unsupportedTimelinePattern?: boolean;
  ownerId?: string | null;
  ownerLocator?: TimelineAnimationOwnerLocator;
  ownerRange?: TimelineAnimationOwnerRange;
  onAddAnimation: (method: "to" | "from" | "set" | "fromTo") => void;
}

export const GsapAnimationSection = memo(function GsapAnimationSection({
  animations,
  compact = false,
  multipleTimelines,
  unsupportedTimelinePattern,
  ownerId,
  ownerLocator,
  ownerRange,
  onUpdateProperty,
  onUpdateMeta,
  onDeleteAnimation,
  onAddProperty,
  onRemoveProperty,
  onUpdateFromProperty,
  onAddFromProperty,
  onRemoveFromProperty,
  onAddAnimation,
  onLivePreview,
  onLivePreviewEnd,
  onSetArcPath,
  onUpdateArcSegment,
  onUpdateKeyframeEase,
  onEditPropertyKeyframe,
  onEnablePropertyKeyframes,
  onSetAllKeyframeEases,
  onUnroll,
}: GsapAnimationSectionProps) {
  const track = useTrackDesignInput();
  const { tx } = useStudioI18n();
  const selectedPoint = usePlayerStore((state) => state.selectedPropertyKeyframe);
  const selectedEffect = usePlayerStore((state) => state.selectedTimelineEffect);
  const ownerKey = usePlayerStore((state) => state.selectedElementId) ?? ownerId ?? "";
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const trackProperty = (property: string) => {
    const control =
      property === "visibility"
        ? "toggle"
        : property === "filter" || property === "clipPath"
          ? "text"
          : "metric";
    track(control, property);
  };
  const updateMeta = (
    animationId: string,
    updates: { duration?: number; ease?: string; position?: number },
  ) => {
    trackAnimationMetaUpdate(track, updates);
    onUpdateMeta(animationId, updates);
  };

  const visibleAnimations = animations.filter(anim => !compact || (!readMotionInstanceFromExtras(anim.extras) && anim.method !== "set" && anim.duration !== 0));
  const cards = compact && onEditPropertyKeyframe ? visibleAnimations.slice(0, 1) : visibleAnimations;

  return (
    <div data-layer-animation-effects="true">
      {multipleTimelines && (
        <p className="mb-2 rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-400">
          {tx(
            "This file has multiple GSAP timelines. Animation editing is disabled to prevent data loss — consolidate into a single timeline to enable editing.",
          )}
        </p>
      )}
      {unsupportedTimelinePattern && (
        <p className="mb-2 rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-400">
          {tx(
            'This timeline uses a computed key (window.__timelines[variable]) the editor can\'t resolve statically. Use a string-literal key (window.__timelines["id"]) or a variable declaration (const tl = gsap.timeline()) to enable editing.',
          )}
        </p>
      )}
      {multipleTimelines || unsupportedTimelinePattern ? null : (
        <div className="space-y-2">
          {cards
            .map((anim, index) => (
              <AnimationCard
                key={anim.id}
                animation={anim}
                relatedAnimations={compact && onEditPropertyKeyframe ? visibleAnimations : undefined}
                compact={compact}
                selected={
                  compact && onEditPropertyKeyframe
                    ? selectedPoint?.ownerKey === ownerKey || selectedEffect?.ownerKey === ownerKey
                    : selectedPoint
                    ? selectedPoint.ownerKey === ownerKey &&
                      !!anim.keyframes?.keyframes.some(
                        (frame) =>
                          selectedPoint.property in frame.properties &&
                          Math.abs(
                            (anim.resolvedStart ??
                              (typeof anim.position === "number" ? anim.position : 0)) +
                              ((anim.duration ?? 0) * frame.percentage) / 100 -
                              selectedPoint.time,
                          ) < 0.001,
                      )
                    : selectedEffect?.ownerKey === ownerKey &&
                      selectedEffect.animationId === anim.id
                }
                ownerKey={ownerKey}
                onSelect={() => {
                  const store = usePlayerStore.getState();
                  const start =
                    anim.resolvedStart ?? (typeof anim.position === "number" ? anim.position : 0);
                  store.setSelectedTimelineEffect({ ownerKey, animationId: anim.id, time: start });
                  store.requestSeek(start);
                  store.requestClipReveal(ownerKey);
                }}
                defaultExpanded={index === 0}
                ownerId={ownerId}
                ownerLocator={ownerLocator}
                ownerRange={ownerRange}
                onUpdateProperty={(animationId, property, value) => {
                  trackProperty(property);
                  onUpdateProperty(animationId, property, value);
                }}
                onUpdateMeta={updateMeta}
                onDeleteAnimation={(animationId) => {
                  track("button", "Remove animation");
                  onDeleteAnimation(animationId);
                }}
                onAddProperty={(animationId, property) => {
                  track("select", "Add effect property");
                  onAddProperty(animationId, property);
                }}
                onRemoveProperty={(animationId, property) => {
                  track("button", `Remove ${property}`);
                  onRemoveProperty(animationId, property);
                }}
                onUpdateFromProperty={
                  onUpdateFromProperty
                    ? (animationId, property, value) => {
                        trackProperty(property);
                        onUpdateFromProperty(animationId, property, value);
                      }
                    : undefined
                }
                onAddFromProperty={
                  onAddFromProperty
                    ? (animationId, property) => {
                        track("select", "Add from property");
                        onAddFromProperty(animationId, property);
                      }
                    : undefined
                }
                onRemoveFromProperty={
                  onRemoveFromProperty
                    ? (animationId, property) => {
                        track("button", `Remove from ${property}`);
                        onRemoveFromProperty(animationId, property);
                      }
                    : undefined
                }
                onLivePreview={onLivePreview}
                onLivePreviewEnd={onLivePreviewEnd}
                onSetArcPath={
                  onSetArcPath
                    ? (animationId, config) => {
                        track(
                          "toggle",
                          config.autoRotate !== undefined ? "Auto rotate" : "Arc motion",
                        );
                        onSetArcPath(animationId, config);
                      }
                    : undefined
                }
                onUpdateArcSegment={
                  onUpdateArcSegment
                    ? (animationId, segmentIndex, update) => {
                        if (update.curviness === undefined) {
                          track("button", `Reset arc segment ${segmentIndex + 1}`);
                        }
                        onUpdateArcSegment(animationId, segmentIndex, update);
                      }
                    : undefined
                }
                onEnablePropertyKeyframes={onEnablePropertyKeyframes}
                onEditPropertyKeyframe={onEditPropertyKeyframe}
                onUpdateKeyframeEase={
                  onUpdateKeyframeEase
                    ? (animationId, percentage, ease) => {
                        track("select", "Keyframe ease");
                        onUpdateKeyframeEase(animationId, percentage, ease);
                      }
                    : undefined
                }
                onSetAllKeyframeEases={
                  onSetAllKeyframeEases
                    ? (animationId, ease) => {
                        track("select", "All keyframe eases");
                        onSetAllKeyframeEases(animationId, ease);
                      }
                    : undefined
                }
                onUnroll={
                  onUnroll
                    ? (animationId) => {
                        track("button", "Unroll animation");
                        onUnroll(animationId);
                      }
                    : undefined
                }
              />
            ))}

          <div className="relative pt-1">
            {addMenuOpen ? (
              <div className="flex gap-1.5">
                {ADD_METHODS.map((method) => (
                  <button
                    key={method}
                    type="button"
                    title={tx(METHOD_TOOLTIPS[method])}
                    onClick={() => {
                      track("button", `Add ${method} animation`);
                      onAddAnimation(method);
                      setAddMenuOpen(false);
                    }}
                    className="rounded-lg border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-[11px] font-medium text-neutral-300 transition-colors hover:border-neutral-600 hover:text-white"
                  >
                    {tx(ADD_METHOD_LABELS[method] ?? method)}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setAddMenuOpen(false)}
                  className="px-1.5 text-[11px] text-neutral-500 hover:text-neutral-300"
                >
                  {tx("Cancel")}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAddMenuOpen(true)}
                className="text-[11px] font-medium text-neutral-400 transition-colors hover:text-neutral-200"
                title={tx("Add a new animation effect to this element")}
              >
                {tx("+ Add animation")}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
});
