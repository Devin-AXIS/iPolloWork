import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@ipollowork/ui/select";
import { Button } from "@ipollowork/ui/controls";
import { InputGroup, InputGroupText } from "@ipollowork/ui/input-group";
import { isTweenConfigKey } from "@hyperframes/core/gsap-constants";
import { CommitField, MetricField } from "./propertyPanelPrimitives";
import {
  PERCENT_PROPS,
  PROP_CONSTRAINTS,
  PROP_LABELS,
  PROP_TOOLTIPS,
  PROP_UNITS,
  clampPropertyValue,
} from "./gsapAnimationConstants";
import { P } from "./panelTokens";
import { useStudioI18n } from "../../i18n";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { GsapAnimationEditCallbacks } from "./gsapAnimationCallbacks";
import { usePlayerStore } from "../../player/store/playerStore";
import { useStudioShellContext } from "../../contexts/StudioContext";
import { readGsapProperty } from "../../hooks/gsapRuntimeReaders";
import { KeyframeEaseList } from "./KeyframeEaseList";
import { useNLEContextOptional } from "../nle/NLEContext";
import { Fragment, useState } from "react";

export const BOOLEAN_PROPS = new Set(["visibility"]);
const STRING_PROPS = new Set(["filter", "clipPath"]);
const FILTER_PRESETS = [
  { label: "Blur", value: "blur(4px)" },
  { label: "Bright", value: "brightness(1.5)" },
  { label: "Gray", value: "grayscale(1)" },
  { label: "None", value: "none" },
];
const CLIP_PATH_PRESETS = [
  { label: "Circle", value: "circle(50% at 50% 50%)" },
  { label: "Inset", value: "inset(10%)" },
  { label: "None", value: "none" },
];

function isPercentProp(prop: string): boolean {
  return PERCENT_PROPS.has(prop);
}

function displayValue(prop: string, val: number | string): string {
  if (isPercentProp(prop)) return String(Math.round(Math.max(0, Math.min(1, Number(val))) * 100));
  return String(val);
}

function adjustedValue(prop: string, raw: string): string {
  if (isPercentProp(prop)) return String(clampPropertyValue(prop, Number(raw) / 100));
  const num = Number(raw);
  if (!Number.isNaN(num) && PROP_CONSTRAINTS[prop]) {
    return String(clampPropertyValue(prop, num));
  }
  return raw;
}

function RemoveButton({ onClick, title }: { onClick: () => void; title: string }) {
  const { tx } = useStudioI18n();
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-shrink-0 rounded p-0.5 text-neutral-600 transition-colors hover:bg-neutral-800 hover:text-red-400"
      title={tx(title)}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path d="M3 3l6 6M9 3l-6 6" />
      </svg>
    </button>
  );
}

// fallow-ignore-next-line complexity
export function PropertyRow({
  prop,
  val,
  onCommit,
  onRemove,
  removeTitle,
}: {
  prop: string;
  val: number | string;
  onCommit: (adjusted: string) => void;
  onRemove: () => void;
  removeTitle: string;
}) {
  const { tx } = useStudioI18n();
  if (BOOLEAN_PROPS.has(prop)) {
    const isVisible = val === "visible" || val === 1;
    return (
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1 flex items-center gap-2 px-2 py-1 rounded-lg bg-neutral-900 border border-neutral-800">
          <span className="flex-1 text-[11px] font-medium text-neutral-500">
            {tx(PROP_LABELS[prop] ?? prop)}
          </span>
          <button
            type="button"
            onClick={() => onCommit(isVisible ? "hidden" : "visible")}
            className="flex-shrink-0 rounded-full transition-all duration-150 relative"
            style={{ width: 28, height: 16, background: isVisible ? P.accent : P.borderInput }}
            title={tx(isVisible ? "Visible — click to hide" : "Hidden — click to show")}
          >
            <span
              className="absolute top-[2px] left-0 rounded-full transition-transform duration-150"
              style={{
                width: 12,
                height: 12,
                background: isVisible ? P.white : P.textMuted,
                transform: isVisible ? "translateX(14px)" : "translateX(2px)",
              }}
            />
          </button>
        </div>
        <RemoveButton onClick={onRemove} title={removeTitle} />
      </div>
    );
  }
  if (STRING_PROPS.has(prop)) {
    const presets =
      prop === "filter" ? FILTER_PRESETS : prop === "clipPath" ? CLIP_PATH_PRESETS : [];
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1 flex items-center gap-2 px-2 py-1 rounded-lg bg-neutral-900 border border-neutral-800">
            <span className="flex-shrink-0 text-[11px] font-medium text-neutral-500">
              {tx(PROP_LABELS[prop] ?? prop)}
            </span>
            <input
              type="text"
              defaultValue={String(val)}
              className="flex-1 bg-transparent text-[11px] text-neutral-200 outline-none"
              onBlur={(e) => onCommit(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
            />
          </div>
          <RemoveButton onClick={onRemove} title={removeTitle} />
        </div>
        {presets.length > 0 && (
          <div className="flex gap-1 pl-1">
            {presets.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => onCommit(p.value)}
                className="px-1.5 py-0.5 rounded text-[9px] font-medium text-neutral-500 bg-neutral-800/50 hover:bg-neutral-800 hover:text-neutral-300 transition-colors"
              >
                {tx(p.label)}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <div className="min-w-0 flex-1">
        <MetricField
          label={PROP_LABELS[prop] ?? prop}
          value={displayValue(prop, val)}
          suffix={PROP_UNITS[prop]}
          tooltip={PROP_TOOLTIPS[prop]}
          scrub
          liveCommit
          onCommit={(raw) => onCommit(adjustedValue(prop, raw))}
        />
      </div>
      <RemoveButton onClick={onRemove} title={removeTitle} />
    </div>
  );
}

export function AddPropertyTrigger({
  adding,
  available,
  addLabel,
  addTitle,
  onAdd,
  onOpen,
  onClose,
  buttonClassName,
}: {
  adding: boolean;
  available: string[];
  addLabel: string;
  addTitle: string;
  onAdd: (prop: string) => void;
  onOpen: () => void;
  onClose: () => void;
  buttonClassName: string;
}) {
  const { tx } = useStudioI18n();
  if (adding && available.length > 0) {
    return (
      <select
        autoFocus
        className="min-w-0 rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1 text-[11px] text-neutral-100 outline-none"
        defaultValue=""
        onChange={(e) => {
          if (e.target.value) onAdd(e.target.value);
          onClose();
        }}
        onBlur={onClose}
      >
        <option value="" disabled>
          {tx("Choose property…")}
        </option>
        {available.map((p) => (
          <option key={p} value={p}>
            {tx(PROP_LABELS[p] ?? p)}
          </option>
        ))}
      </select>
    );
  }
  if (available.length === 0) return null;
  return (
    <button type="button" onClick={onOpen} className={buttonClassName} title={tx(addTitle)}>
      {tx(addLabel)}
    </button>
  );
}

export function parseNumericOrString(raw: string): number | string {
  const num = Number(raw);
  return Number.isFinite(num) ? num : raw;
}

export function PropertyKeyframeRows({
  animation,
  onEdit,
  compact = false,
  ownerKey,
  readOnly = false,
  runtimeSelector,
  relatedAnimations,
}: {
  animation: GsapAnimation;
  compact?: boolean;
  ownerKey?: string;
  readOnly?: boolean;
  runtimeSelector?: string;
  relatedAnimations?: { animation: GsapAnimation; readOnly: boolean }[];
  onEdit: NonNullable<GsapAnimationEditCallbacks["onEditPropertyKeyframe"]>;
}) {
  const { tx } = useStudioI18n();
  const currentTime = usePlayerStore((state) => state.currentTime);
  const selectedPoint = usePlayerStore((state) => state.selectedPropertyKeyframe);
  const selectedOwner = usePlayerStore((state) => state.selectedElementId);
  const selectedEffect = usePlayerStore((state) => state.selectedTimelineEffect);
  const { previewIframeRef, showToast } = useStudioShellContext();
  const [expandedEase, setExpandedEase] = useState<string | null>(null);
  const nle = useNLEContextOptional();
  const timeOffset = nle?.scenePlaybackRange?.start ?? 0;
  const entries = relatedAnimations ?? [{ animation, readOnly }];
  const frames = animation.keyframes?.keyframes ?? [];
  const properties = [...new Set((compact ? entries.flatMap(entry => entry.animation.keyframes?.keyframes ?? []) : frames).flatMap((frame) => Object.keys(frame.properties)))].filter(
    (property) => property !== "_auto" && property !== "id" && !isTweenConfigKey(property),
  );
  const start = typeof animation.position === "number" ? animation.position : 0;
  const duration = animation.duration ?? 0;
  const currentPct = duration > 0 ? ((currentTime - start) / duration) * 100 : 0;
  const restricted =
    animation.hasUnresolvedKeyframes ||
    animation.hasUnresolvedSelector ||
    (animation.provenance && animation.provenance.kind !== "literal") ||
    animation.arcPath?.enabled;
  if (compact) {
    const groupFor = (property: string) =>
      ["x", "y", "z", "xPercent", "yPercent"].includes(property) ? "Position" :
      property.startsWith("scale") ? "Scale" : property.startsWith("rotation") ? "Rotation" :
      property === "opacity" ? "Opacity" : "Other properties";
    const groupOrder = ["Position", "Scale", "Rotation", "Opacity", "Other properties"];
    const channelOrder = ["x", "y", "z", "xPercent", "yPercent", "scale", "scaleX", "scaleY", "scaleZ", "rotation", "rotationX", "rotationY", "rotationZ"];
    const orderedProperties = [...properties].sort((a, b) => groupOrder.indexOf(groupFor(a)) - groupOrder.indexOf(groupFor(b)) || channelOrder.indexOf(a) - channelOrder.indexOf(b));
    return (
      <fieldset className="space-y-1" data-layers-property-editor="true">
        {entries.some(entry => !entry.readOnly) && !restricted && <p className="text-ui-caption text-muted-foreground">{tx("Select a keyframe to edit its value. Current values follow the playhead.")}</p>}
        {orderedProperties.map((property, propertyIndex) => {
          const owner = ownerKey ?? selectedOwner ?? "";
          const startOf = (item: GsapAnimation) => item.resolvedStart ?? (typeof item.position === "number" ? item.position : 0);
          const candidates = entries.filter(entry => entry.animation.keyframes?.keyframes.some(key => property in key.properties));
          const selected = selectedPoint?.ownerKey === owner && selectedPoint.property === property;
          const hasSelectedKey = (item: GsapAnimation) => selected && item.keyframes?.keyframes.some(key => property in key.properties && Math.abs(startOf(item) + (item.duration ?? 0) * key.percentage / 100 - selectedPoint.time) < 0.001);
          const active = (selected && candidates.find(entry => entry.animation.id === selectedPoint.animationId && hasSelectedKey(entry.animation))) ||
            candidates.find(entry => hasSelectedKey(entry.animation)) ||
            candidates.find(entry => selectedEffect?.ownerKey === owner && selectedEffect.property === property && selectedEffect.animationId === entry.animation.id) ||
            [...candidates].reverse().find(entry => currentTime >= startOf(entry.animation) && currentTime <= startOf(entry.animation) + (entry.animation.duration ?? 0)) ||
            [...candidates].sort((a, b) => Math.abs(currentTime - startOf(a.animation)) - Math.abs(currentTime - startOf(b.animation)))[0];
          const animation = active.animation;
          const propertyReadOnly = active.readOnly;
          const restricted = animation.hasUnresolvedKeyframes || animation.hasUnresolvedSelector ||
            (animation.provenance && animation.provenance.kind !== "literal") || animation.arcPath?.enabled;
          const start = startOf(animation);
          const duration = animation.duration ?? 0;
          const keys = (animation.keyframes?.keyframes ?? []).filter(frame => property in frame.properties);
          const key = selected ? keys.find(frame => Math.abs(start + duration * frame.percentage / 100 - selectedPoint.time) < 0.001) : undefined;
          const nearest = (item: GsapAnimation) => (item.keyframes?.keyframes ?? []).filter(frame => property in frame.properties).reduce((closest, frame) =>
            Math.abs(startOf(item) + (item.duration ?? 0) * frame.percentage / 100 - currentTime) < Math.abs(startOf(item) + (item.duration ?? 0) * closest.percentage / 100 - currentTime) ? frame : closest);
          const target = key ?? nearest(animation);
          const locate = (item: GsapAnimation) => {
            const point = nearest(item);
            const time = startOf(item) + (item.duration ?? 0) * point.percentage / 100;
            const store = usePlayerStore.getState();
            store.setSelectedTimelineEffect({ownerKey: owner, animationId: item.id, property, time});
            store.setSelectedPropertyKeyframe({ownerKey: owner, animationId: item.id, property, time});
            store.requestSeek(time);
            store.requestClipReveal(owner);
          };
          const rangeLabel = (item: GsapAnimation) => `${Math.max(0, startOf(item) - timeOffset).toFixed(3)} – ${Math.max(0, startOf(item) + (item.duration ?? 0) - timeOffset).toFixed(3)} s`;
          const group = groupFor(property);
          const runtime = readGsapProperty(
            previewIframeRef.current,
            runtimeSelector ?? animation.targetSelector,
            property,
            { round: false },
          );
          const value = key?.properties[property] ?? runtime ??
            (typeof target?.properties[property] === "string" ? target.properties[property] : undefined);
          const percentage = property === "opacity" || property.startsWith("scale");
          const unit = percentage
            ? "%"
            : property.startsWith("rotation")
              ? "°"
              : (PROP_UNITS[property] ?? "");
          return (
            <Fragment key={property}>
              {(group === "Position" || orderedProperties.filter(item => groupFor(item) === group).length > 1) && (propertyIndex === 0 || groupFor(orderedProperties[propertyIndex - 1]) !== group) &&
                <div data-animation-property-group={group} className="px-2 pb-1 pt-3 text-ui-caption font-medium text-muted-foreground">{tx(group)}</div>}
            <div
              key={property}
              data-layer-effect-property={property}
              data-property-animation-id={animation.id}
              data-selected={key ? "true" : "false"}
              data-value-context={key ? "keyframe" : runtime != null ? "playhead" : "reference"}
              className="grid grid-cols-[minmax(0,1fr)_112px] items-center gap-3 rounded-lg px-2 py-2 text-ui-control"
              style={
                key
                  ? {
                      backgroundColor:
                        "color-mix(in srgb, var(--hf-panel-accent) 10%, transparent)",
                    }
                  : undefined
              }
            >
              <Button variant="ghost"
                type="button"
                className="h-auto min-w-0 flex-col items-start gap-0.5 overflow-hidden px-0 py-0 text-left text-ui-control font-normal"
                onClick={() => locate(animation)}
              >
                <span className="block">{tx(property === "x" ? "X" : property === "y" ? "Y" : PROP_LABELS[property] ?? property)}{propertyReadOnly && entries.some(entry => !entry.readOnly) && <span className="ml-2 text-ui-caption text-muted-foreground">{tx("Read-only")}</span>}</span>
                <span className="block whitespace-nowrap text-ui-caption font-normal tabular-nums text-muted-foreground">
                  <span data-property-value-context>{tx(key ? "Keyframe value" : runtime != null ? "Current value" : "Reference value")}</span>
                  {(key || runtime != null) && <span data-property-value-time> · {Math.max(0, (key ? start + duration * key.percentage / 100 : currentTime) - timeOffset).toFixed(3)} s</span>}
                </span>
              </Button>
              <InputGroup className="h-8 min-w-0" title={typeof value === "string" ? value : undefined}>
                <CommitField
                  appearance="group"
                  align="right"
                  className="min-w-0 px-2 text-ui-control font-normal tabular-nums text-foreground"
                  value={
                    typeof value === "number"
                      ? String(Number((percentage ? value * 100 : value).toFixed(3)))
                      : (value ?? "")
                  }
                  ariaLabel={`${property} keyframe value at ${key?.percentage ?? target?.percentage ?? 0}%`}
                  disabled={propertyReadOnly || !key || !!restricted || typeof value !== "number"}
                  onCommit={(raw) => {
                    const number = Number(raw);
                    if (key && raw.trim() && Number.isFinite(number))
                      onEdit(animation.id, property, key.percentage, {
                        action: "update",
                        value: percentage ? number / 100 : number,
                      });
                  }}
                />
                <InputGroupText className="w-8 shrink-0 justify-end pr-2 text-ui-caption text-muted-foreground">{unit}</InputGroupText>
              </InputGroup>
            </div>
            {candidates.length > 1 && <div className="px-2 pb-2" data-property-animation-segments={property}>
              <Select value={animation.id} onValueChange={id => { const entry = candidates.find(item => item.animation.id === id); if (entry) locate(entry.animation); }}>
                <SelectTrigger size="sm" className="w-full text-ui-caption" aria-label={`${property} ${tx("Animation segment")}`}><SelectValue>{rangeLabel(animation)}</SelectValue></SelectTrigger>
                <SelectContent>{candidates.map((entry, index) => <SelectItem key={entry.animation.id} value={entry.animation.id}>{index + 1} · {rangeLabel(entry.animation)}</SelectItem>)}</SelectContent>
              </Select>
            </div>}
            </Fragment>
          );
        })}
      </fieldset>
    );
  }
  return (
    <fieldset disabled={!!restricted} data-property-keyframes="true" className="space-y-2">
      <p className="text-[10px] text-neutral-400">{tx("Keyframes by property")}</p>
      {restricted && (
        <p className="text-[10px] text-amber-400">
          {tx(
            "Computed and path animations are read-only here. Their existing motion is preserved.",
          )}
        </p>
      )}
      {properties.map((property) => {
        const keys = frames.filter((frame) => property in frame.properties);
        const existing = keys.some((frame) => Math.abs(frame.percentage - currentPct) <= 0.001);
        return (
          <details key={property} className="rounded border border-neutral-700/50 p-2" open>
            <summary className="text-[11px] font-medium">
              {tx(PROP_LABELS[property] ?? property)}
            </summary>
            <button
              type="button"
              className="mt-1 text-[10px] text-panel-accent disabled:text-neutral-500"
              disabled={currentPct < 0 || currentPct > 100 || duration <= 0 || existing}
              title={tx(
                existing ? "A keyframe already exists here" : "Add a keyframe at the playhead",
              )}
              onClick={() => {
                const value = readGsapProperty(
                  previewIframeRef.current,
                  animation.targetSelector,
                  property,
                );
                if (value !== null)
                  onEdit(animation.id, property, currentPct, { action: "add", value });
                else
                  showToast(
                    tx(
                      "Could not read this property at the playhead. Its animation was preserved.",
                    ),
                    "info",
                  );
              }}
            >
              {tx(existing ? "Keyframe at playhead" : "Add at playhead")}
            </button>
            {keys.map((frame) => (
              <div
                key={frame.percentage}
                className="mt-2 grid grid-cols-[auto_1fr_1fr_auto] items-end gap-1"
                data-property-keyframe={property}
                data-keyframe-percentage={frame.percentage}
              >
                <button
                  type="button"
                  aria-label={`${tx("Select keyframe")} · ${tx(PROP_LABELS[property] ?? property)} · ${frame.percentage}%`}
                  className="p-1 text-[12px] text-panel-accent"
                  onClick={() =>
                    usePlayerStore
                      .getState()
                      .requestSeek(start + (duration * frame.percentage) / 100)
                  }
                >
                  ◆
                </button>
                <MetricField
                  label="Time"
                  ariaLabel={`${property} keyframe time at ${frame.percentage}%`}
                  value={String(Number((start + (duration * frame.percentage) / 100).toFixed(3)))}
                  suffix="s"
                  onCommit={(raw) => {
                    const time = Number(raw);
                    if (
                      Number.isFinite(time) &&
                      duration > 0 &&
                      time >= start &&
                      time <= start + duration
                    )
                      onEdit(animation.id, property, frame.percentage, {
                        action: "move",
                        toPercentage: ((time - start) / duration) * 100,
                      });
                  }}
                />
                <MetricField
                  label="Value"
                  ariaLabel={`${property} keyframe value at ${frame.percentage}%`}
                  value={String(frame.properties[property])}
                  onCommit={(raw) =>
                    onEdit(animation.id, property, frame.percentage, {
                      action: "update",
                      value: parseNumericOrString(raw),
                    })
                  }
                />
                <button
                  type="button"
                  aria-label={`${tx("Delete Keyframe")} · ${tx(PROP_LABELS[property] ?? property)}`}
                  className="p-1 text-[10px] text-neutral-400 hover:text-red-400"
                  onClick={() =>
                    onEdit(animation.id, property, frame.percentage, { action: "remove" })
                  }
                >
                  ×
                </button>
              </div>
            ))}
            <KeyframeEaseList
              keyframes={keys}
              globalEase={animation.keyframes?.easeEach ?? animation.ease ?? "none"}
              expandedPct={
                expandedEase?.startsWith(`${property}:`) ? Number(expandedEase.split(":")[1]) : null
              }
              onToggle={(pct) => setExpandedEase(pct === null ? null : `${property}:${pct}`)}
              onEaseCommit={(pct, ease) =>
                onEdit(animation.id, property, pct, { action: "ease", ease })
              }
            />
          </details>
        );
      })}
    </fieldset>
  );
}
