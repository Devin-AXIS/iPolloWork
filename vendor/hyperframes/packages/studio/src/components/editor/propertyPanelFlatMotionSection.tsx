import { useState } from "react";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { useTrackDesignInput } from "../../contexts/DesignPanelInputContext";
import type { DomEditSelection } from "./domEditing";
import { formatTimingValue } from "./propertyPanelHelpers";
import { parseTimingValue } from "./propertyPanelTimingSection";
import { CommitField } from "./propertyPanelPrimitives";
import { Plus, Trash } from "../../icons/SystemIcons";
import {
  ADD_METHODS,
  ADD_METHOD_LABELS,
  METHOD_LABELS,
  METHOD_TOOLTIPS,
} from "./gsapAnimationConstants";
import {
  trackAnimationMetaUpdate,
  type GsapAnimationEditCallbacks,
} from "./gsapAnimationCallbacks";
import { deriveElementTiming } from "./propertyPanelFlatTimingDerivation";

export function FlatTimingRow({
  element,
  animations = [],
  onSetAttribute,
  onSetAttributes,
}: {
  element: DomEditSelection;
  animations?: GsapAnimation[];
  onSetAttribute: (attr: string, value: string) => void | Promise<void>;
  /** Commits start+duration together in ONE atomic persist call, bound to
   *  THIS render's `element` explicitly — not whatever is "currently"
   *  selected by the time the call resolves. Falls back to two sequential
   *  `onSetAttribute` calls (with the same non-atomicity/misdirection risk
   *  documented below) when the caller doesn't wire it up. */
  onSetAttributes?: (selection: DomEditSelection, attrs: Record<string, string>) => Promise<void>;
}) {
  const track = useTrackDesignInput();
  const { start, duration, inferred: derived } = deriveElementTiming(element, animations);
  const end = start + duration;

  // While the range is inferred from animations, editing ONE field must pin the
  // WHOLE displayed range: writing only data-duration flips inference off and
  // drops start to data-start-or-0 (the clip silently shifts), and writing only
  // data-start is ignored while duration is still inferred (the edit looks
  // dead). Pin both attributes in ONE atomic commit bound to THIS element —
  // two sequential `onSetAttribute` calls would each resolve `domEditSelection`
  // fresh from current hook state, so a selection change between the two
  // awaits could misdirect the second write at the newly-selected element, and
  // a failure of just the second call would leave the pair half-applied.
  const pinRange = async (nextStart: number, nextDuration: number) => {
    const attrs = { start: nextStart.toFixed(2), duration: nextDuration.toFixed(2) };
    if (onSetAttributes) {
      await onSetAttributes(element, attrs);
      return;
    }
    await onSetAttribute("start", attrs.start);
    await onSetAttribute("duration", attrs.duration);
  };

  const commitStart = (nextValue: string) => {
    const parsed = parseTimingValue(nextValue);
    if (parsed == null) return;
    if (derived) {
      void pinRange(parsed, duration);
      return;
    }
    void onSetAttribute("start", parsed.toFixed(2));
  };

  const commitDuration = (nextValue: string) => {
    const parsed = parseTimingValue(nextValue);
    if (parsed == null || parsed <= 0) return;
    if (derived) {
      void pinRange(start, parsed);
      return;
    }
    void onSetAttribute("duration", parsed.toFixed(2));
  };

  const commitEnd = (nextValue: string) => {
    const parsed = parseTimingValue(nextValue);
    if (parsed == null || parsed <= start) return;
    if (derived) {
      void pinRange(start, parsed - start);
      return;
    }
    void onSetAttribute("duration", (parsed - start).toFixed(2));
  };

  const cell = (label: string, value: string, onCommit: (next: string) => void) => (
    <div className="flex h-[34px] min-w-0 items-center justify-between gap-1.5 rounded-[6px] border border-[#f5f6f9] bg-[#f5f6f9] px-[10px] py-px dark:border-panel-input dark:bg-panel-input">
      <span className="flex-shrink-0 text-[10px] font-normal text-[#878984] dark:text-panel-text-4">
        {label}
      </span>
      <span className="min-w-0 font-sans text-[13px] font-normal text-[#242522] dark:text-panel-text-0">
        <CommitField
          value={value}
          onCommit={(next) => {
            track("metric", label);
            onCommit(next);
          }}
        />
      </span>
    </div>
  );

  return (
    <div className="hf-flat-responsive-grid grid grid-cols-2 gap-2">
      {cell("Start", formatTimingValue(start), commitStart)}
      {cell("End", formatTimingValue(end), commitEnd)}
      {cell("Duration", formatTimingValue(duration), commitDuration)}
      {derived && (
        <p className="col-span-2 mt-1 text-[10px] leading-snug text-panel-text-3">
          Inferred from this element's animation — edit to pin an explicit clip range.
        </p>
      )}
    </div>
  );
}

export function FlatMotionSection({
  element,
  animations,
  showTiming,
  showEffects,
  multipleTimelines,
  unsupportedTimelinePattern,
  onSetAttribute,
  onSetAttributes,
  onAddAnimation,
  ...callbacks
}: {
  element: DomEditSelection;
  animations: GsapAnimation[];
  showTiming: boolean;
  showEffects: boolean;
  multipleTimelines?: boolean;
  unsupportedTimelinePattern?: boolean;
  onSetAttribute: (attr: string, value: string) => void | Promise<void>;
  onSetAttributes?: (selection: DomEditSelection, attrs: Record<string, string>) => Promise<void>;
  onAddAnimation: (method: "to" | "from" | "set" | "fromTo") => void;
} & GsapAnimationEditCallbacks) {
  const track = useTrackDesignInput();
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  return (
    <div className="space-y-3">
      {showTiming && (
        <FlatTimingRow
          element={element}
          animations={animations}
          onSetAttribute={onSetAttribute}
          onSetAttributes={onSetAttributes}
        />
      )}
      {showEffects && (
        <>
          {multipleTimelines && (
            <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-400">
              This file has multiple GSAP timelines. Animation editing is disabled to prevent data
              loss — consolidate into a single timeline to enable editing.
            </p>
          )}
          {unsupportedTimelinePattern && (
            <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-400">
              This timeline uses a computed key the editor can&apos;t resolve statically.
            </p>
          )}
          {!multipleTimelines && !unsupportedTimelinePattern && (
            <div className="space-y-2">
              {animations.map((animation, index) => {
                const start =
                  typeof animation.position === "number"
                    ? animation.position
                    : (animation.resolvedStart ?? 0);
                const duration = animation.duration ?? 0;
                const commitMetric = (kind: "position" | "duration", raw: string) => {
                  const value = Number.parseFloat(raw.replace("s", ""));
                  if (!Number.isFinite(value) || value < 0) return;
                  trackAnimationMetaUpdate(track, { [kind]: value });
                  callbacks.onUpdateMeta(animation.id, { [kind]: value });
                };
                return (
                  <div key={animation.id} className="grid gap-2">
                    <div className="grid grid-cols-[minmax(0,1fr)_36px] gap-3">
                      <div className="flex h-[34px] items-center justify-between rounded-[6px] bg-panel-input pl-2 pr-4">
                        <span className="text-[10px] text-[#858a94]">Animation</span>
                        <span className="truncate pl-3 text-[13px] text-[#24262b] dark:text-panel-text-1">
                          {METHOD_LABELS[animation.method] ??
                            `Animation ${String(index + 1).padStart(2, "0")}`}
                        </span>
                      </div>
                      <button
                        type="button"
                        aria-label={`Remove animation ${index + 1}`}
                        onClick={() => {
                          track("button", "Remove animation");
                          callbacks.onDeleteAnimation(animation.id);
                        }}
                        className="flex h-[34px] items-center justify-center text-[#858a94] transition-colors hover:text-[#24262b] dark:hover:text-panel-text-1"
                      >
                        <Trash size={18} />
                      </button>
                    </div>
                    <div className="hf-flat-responsive-grid grid grid-cols-2 gap-2">
                      {(["position", "duration"] as const).map((kind) => (
                        <div
                          key={kind}
                          className="flex h-[34px] items-center justify-between rounded-[6px] bg-panel-input px-[10px]"
                        >
                          <span className="text-[10px] text-[#858a94]">
                            {kind === "position" ? "Start" : "Duration"}
                          </span>
                          <span className="w-[62px] text-right text-[13px] text-[#24262b] dark:text-panel-text-1">
                            <CommitField
                              value={`${(kind === "position" ? start : duration).toFixed(2)} s`}
                              align="right"
                              onCommit={(next) => commitMetric(kind, next)}
                            />
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
              <div className="relative">
                {addMenuOpen ? (
                  <div className="hf-flat-responsive-grid grid grid-cols-2 gap-1">
                    {ADD_METHODS.map((method) => (
                      <button
                        key={method}
                        type="button"
                        title={METHOD_TOOLTIPS[method]}
                        onClick={() => {
                          track("button", `Add ${method} animation`);
                          onAddAnimation(method);
                          setAddMenuOpen(false);
                        }}
                        className="h-[34px] rounded-[6px] bg-panel-input px-2 text-[11px] text-panel-text-2 transition-colors hover:text-panel-text-0"
                      >
                        {ADD_METHOD_LABELS[method] ?? method}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setAddMenuOpen(false)}
                      className="col-span-2 h-7 text-[11px] text-panel-text-3 hover:text-panel-text-1"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAddMenuOpen(true)}
                    aria-label="Add animation"
                    className="flex h-[34px] w-full items-center justify-center rounded-[6px] border-[0.5px] border-[#858a94] text-[#858a94] transition-colors hover:border-[#24262b] hover:text-[#24262b] dark:hover:border-panel-text-1 dark:hover:text-panel-text-1"
                    title="Add a new animation effect to this element"
                  >
                    <Plus size={16} />
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
