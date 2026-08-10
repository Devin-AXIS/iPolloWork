import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { useTrackDesignInput } from "../../contexts/DesignPanelInputContext";
import { useStudioI18n } from "../../i18n";
import { useNLEContext } from "../nle/NLEContext";
import type { DomEditSelection } from "./domEditing";
import { formatTimingValue } from "./propertyPanelHelpers";
import { parseTimingValue } from "./propertyPanelTimingSection";
import { CommitField } from "./propertyPanelPrimitives";
import { deriveElementTiming } from "./propertyPanelFlatTimingDerivation";
import type { MotionMutationInput, MotionTargetKind } from "@hyperframes/core/motion-presets";
import { SemanticMotionPanel } from "./SemanticMotionPanel";

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
  const { tx } = useStudioI18n();
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
      {cell("Start", formatTimingValue(start), commitStart)}
      {cell("End", formatTimingValue(end), commitEnd)}
      {cell("Duration", formatTimingValue(duration), commitDuration)}
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
  multipleTimelines,
  unsupportedTimelinePattern,
  onSetAttribute,
  onSetAttributes,
  onMutateMotion,
}: {
  element: DomEditSelection;
  animations: GsapAnimation[];
  showTiming: boolean;
  showEffects: boolean;
  multipleTimelines?: boolean;
  unsupportedTimelinePattern?: boolean;
  onSetAttribute: (attr: string, value: string) => void | Promise<void>;
  onSetAttributes?: (selection: DomEditSelection, attrs: Record<string, string>) => Promise<void>;
  onMutateMotion: (targetKind: MotionTargetKind, mutation: MotionMutationInput) => void;
}) {
  const { tx } = useStudioI18n();
  const { previewRange } = useNLEContext();
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
              onMutate={onMutateMotion}
              onPreview={previewRange}
            />
          )}
        </>
      )}
    </div>
  );
}
