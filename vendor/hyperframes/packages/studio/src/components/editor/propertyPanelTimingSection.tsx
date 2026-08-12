import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { Clock } from "../../icons/SystemIcons";
import type { DomEditSelection } from "./domEditing";
import {
  clampPreviewTimeToElementRange,
  deriveElementTiming,
  resolveElementTimingEdit,
} from "./propertyPanelFlatTimingDerivation";
import { formatTimingValue, RESPONSIVE_GRID } from "./propertyPanelHelpers";
import { MetricField, Section } from "./propertyPanelPrimitives";

export function parseTimingValue(input: string): number | null {
  const cleaned = input.replace(/s$/i, "").trim();
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function TimingSection({
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
  onSetAttributes?: (selection: DomEditSelection, attrs: Record<string, string>) => Promise<void>;
  onSeekToTime?: (time: number) => void;
}) {
  const { start, duration, inferred } = deriveElementTiming(element, animations);
  const end = start + duration;

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
    if (nextPreviewTime !== currentTime) onSeekToTime?.(nextPreviewTime);
    void pinRange(range.start, range.duration);
  };

  return (
    <Section title="Timing" icon={<Clock size={15} />}>
      <div className={RESPONSIVE_GRID}>
        <MetricField
          label="Start"
          value={formatTimingValue(start)}
          onCommit={(value) => commitRange("start", value)}
        />
        <MetricField
          label="End"
          value={formatTimingValue(end)}
          onCommit={(value) => commitRange("end", value)}
        />
      </div>
      {inferred && (
        <p className="mt-2 text-[10px] leading-snug text-neutral-500">
          Inferred from this element's animation — edit to pin an explicit clip range.
        </p>
      )}
    </Section>
  );
}
