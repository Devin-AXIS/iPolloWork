import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { useTrackDesignInput } from "../../contexts/DesignPanelInputContext";
import { useStudioI18n } from "../../i18n";
import type { DomEditSelection } from "./domEditing";
import { formatTimingValue } from "./propertyPanelHelpers";
import { parseTimingValue } from "./propertyPanelTimingSection";
import { CommitField } from "./propertyPanelPrimitives";
import {
  clampPreviewTimeToElementRange,
  deriveElementTiming,
  resolveElementTimingEdit,
} from "./propertyPanelFlatTimingDerivation";
import type { MotionMutationInput, MotionTargetKind } from "@hyperframes/core/motion-presets";
import { SemanticMotionPanel } from "./SemanticMotionPanel";

export function FlatTimingRow({
  element,
  animations = [],
  currentTime,
  onSetAttribute,
  onSetAttributes,
  onSeekToTime,
}: {
  element: DomEditSelection;
  animations?: GsapAnimation[];
  currentTime: number;
  onSetAttribute: (attr: string, value: string) => void | Promise<void>;
  /** Commits start+duration together in ONE atomic persist call, bound to
   *  THIS render's `element` explicitly — not whatever is "currently"
   *  selected by the time the call resolves. Falls back to two sequential
   *  `onSetAttribute` calls (with the same non-atomicity/misdirection risk
   *  documented below) when the caller doesn't wire it up. */
  onSetAttributes?: (selection: DomEditSelection, attrs: Record<string, string>) => Promise<void>;
  onSeekToTime?: (time: number) => void;
}) {
  const track = useTrackDesignInput();
  const { tx } = useStudioI18n();
  const { start, duration, inferred: derived } = deriveElementTiming(element, animations);
  const end = start + duration;

  // Start/end are absolute playback-timeline boundaries. Persist both values so
  // changing start keeps end fixed, changing end keeps start fixed, and an
  // inferred animation range becomes an explicit clip range in one operation.
  // Bind the atomic commit to THIS element —
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

  const commitRange = (field: "start" | "end", nextValue: string) => {
    const parsed = parseTimingValue(nextValue);
    if (parsed == null) return;
    const range = resolveElementTimingEdit(start, end, field, parsed);
    if (!range) return;
    const nextPreviewTime = clampPreviewTimeToElementRange(currentTime, range);
    if (nextPreviewTime !== currentTime) {
      onSeekToTime?.(nextPreviewTime);
    }
    void pinRange(range.start, range.duration);
  };

  const cell = (label: string, value: string, onCommit: (next: string) => void) => (
    <div className="flex h-[34px] min-w-0 items-center justify-between gap-1.5 rounded-[6px] border border-[#f5f6f9] bg-[#f5f6f9] px-[10px] py-px dark:border-panel-input dark:bg-panel-input">
      <span className="flex-shrink-0 text-[10px] font-normal text-[#878984] dark:text-panel-text-4">
        {tx(label)}
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
      {cell("Start", formatTimingValue(start), (value) => commitRange("start", value))}
      {cell("End", formatTimingValue(end), (value) => commitRange("end", value))}
      {derived && (
        <p className="col-span-2 mt-1 text-[10px] leading-snug text-panel-text-3">
          {tx("Inferred from this element's animation — edit to pin an explicit clip range.")}
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
  currentTime,
  multipleTimelines,
  unsupportedTimelinePattern,
  onSetAttribute,
  onSetAttributes,
  onSeekToTime,
  onMutateMotion,
}: {
  element: DomEditSelection;
  animations: GsapAnimation[];
  showTiming: boolean;
  showEffects: boolean;
  currentTime: number;
  multipleTimelines?: boolean;
  unsupportedTimelinePattern?: boolean;
  onSetAttribute: (attr: string, value: string) => void | Promise<void>;
  onSetAttributes?: (selection: DomEditSelection, attrs: Record<string, string>) => Promise<void>;
  onSeekToTime?: (time: number) => void;
  onMutateMotion: (
    targetKind: MotionTargetKind,
    mutation: MotionMutationInput,
    selectionOverride?: DomEditSelection | null,
  ) => Promise<boolean>;
}) {
  const { tx } = useStudioI18n();
  return (
    <div className="space-y-3">
      {showTiming && (
        <FlatTimingRow
          element={element}
          animations={animations}
          currentTime={currentTime}
          onSetAttribute={onSetAttribute}
          onSetAttributes={onSetAttributes}
          onSeekToTime={onSeekToTime}
        />
      )}
      {showEffects && (
        <>
          {multipleTimelines && (
            <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-400">
              {tx(
                "This file has multiple GSAP timelines. Animation editing is disabled to prevent data loss — consolidate into a single timeline to enable editing.",
              )}
            </p>
          )}
          {unsupportedTimelinePattern && (
            <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-400">
              {tx("This timeline uses a computed key the editor can't resolve statically.")}
            </p>
          )}
          {!multipleTimelines && !unsupportedTimelinePattern && (
            <SemanticMotionPanel
              element={element}
              animations={animations}
              onMutate={(targetKind, mutation) => onMutateMotion(targetKind, mutation, element)}
            />
          )}
        </>
      )}
    </div>
  );
}
