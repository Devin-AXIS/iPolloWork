import { Card, CardHeader, CardContent, CardFooter } from "@ipollowork/ui/card";
import { Badge } from "@ipollowork/ui/badge";
import { Button } from "@ipollowork/ui/controls";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@ipollowork/ui/collapsible";
import { ChevronRight, LockKeyhole } from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { SUPPORTED_EASES, SUPPORTED_PROPS } from "@hyperframes/core/gsap-constants";
import { RESPONSIVE_GRID } from "./propertyPanelHelpers";
import { MetricField, SelectField } from "./propertyPanelPrimitives";
import { controlPointsForGsapEase } from "./studioMotion";
import { EASE_LABELS, METHOD_LABELS, METHOD_TOOLTIPS, PROP_LABELS } from "./gsapAnimationConstants";
import { buildTweenSummary } from "./gsapAnimationHelpers";
import { EaseCurveSection } from "./EaseCurveSection";
import { ArcPathControls } from "./ArcPathControls";
import type { GsapAnimationEditCallbacks } from "./gsapAnimationCallbacks";
import { ComputedTweenNotice } from "./ComputedTweenNotice";
import { KeyframeEaseList } from "./KeyframeEaseList";
import {
  PropertyRow,
  PropertyKeyframeRows,
  AddPropertyTrigger,
  parseNumericOrString,
  BOOLEAN_PROPS,
} from "./AnimationCardParts";
import {
  animationOrigin,
  clampAnimationMetaToOwner,
  isAnimationSharedForOwner,
  resolveTimelineAnimationPhase,
  resolveTimelineAnimationLabel,
  type TimelineAnimationOwnerRange,
  type TimelineAnimationOwnerLocator,
  type TimelineAnimationPhase,
} from "../../utils/timelineAnimationSegments";
import { synthesizeFlatTweenKeyframes } from "../../hooks/gsapTweenSynth";
import { useStudioI18n } from "../../i18n";

interface AnimationCardProps extends GsapAnimationEditCallbacks {
  animation: GsapAnimation;
  relatedAnimations?: GsapAnimation[];
  defaultExpanded: boolean;
  flat?: boolean;
  compact?: boolean;
  selected?: boolean;
  ownerKey?: string;
  onSelect?: () => void;
  ownerId?: string | null;
  ownerLocator?: TimelineAnimationOwnerLocator;
  ownerRange?: TimelineAnimationOwnerRange;
}

const PHASE_LABELS: Record<TimelineAnimationPhase, string> = {
  entrance: "Entrance",
  loop: "Loop",
  exit: "Exit",
};

// fallow-ignore-next-line complexity
export const AnimationCard = memo(function AnimationCard({
  animation,
  relatedAnimations,
  defaultExpanded,
  flat,
  compact = false,
  selected = false,
  ownerKey,
  onSelect,
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
  onLivePreview,
  onLivePreviewEnd,
  onSetArcPath,
  onUpdateArcSegment,
  onUpdateKeyframeEase,
  onEditPropertyKeyframe,
  onEnablePropertyKeyframes,
  onSetAllKeyframeEases,
  onUnroll,
}: AnimationCardProps) {
  const { locale, tx } = useStudioI18n();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [addingProp, setAddingProp] = useState(false);
  const [addingFromProp, setAddingFromProp] = useState(false);
  const [expandedKfPct, setExpandedKfPct] = useState<number | null>(null);

  const usedProps = useMemo(
    () => new Set(Object.keys(animation.properties)),
    [animation.properties],
  );
  const availableProps = useMemo(
    () =>
      SUPPORTED_PROPS.filter(
        (p) => !usedProps.has(p) && (animation.method === "set" || !BOOLEAN_PROPS.has(p)),
      ),
    [usedProps, animation.method],
  );

  const usedFromProps = useMemo(
    () => new Set(Object.keys(animation.fromProperties ?? {})),
    [animation.fromProperties],
  );
  const availableFromProps = useMemo(
    () => SUPPORTED_PROPS.filter((p) => !usedFromProps.has(p) && !BOOLEAN_PROPS.has(p)),
    [usedFromProps],
  );

  const commitProperty = useCallback(
    (prop: string, raw: string) => {
      const value = parseNumericOrString(raw);
      onUpdateProperty(animation.id, prop, value);
      onLivePreviewEnd?.();
    },
    [animation.id, onUpdateProperty, onLivePreviewEnd],
  );

  const scrubProperty = useCallback(
    (prop: string, raw: string) => {
      onLivePreview?.(prop, parseNumericOrString(raw));
    },
    [onLivePreview],
  );

  const commitFromProperty = useCallback(
    (prop: string, raw: string) => {
      const value = parseNumericOrString(raw);
      onUpdateFromProperty?.(animation.id, prop, value);
      onLivePreviewEnd?.();
    },
    [animation.id, onUpdateFromProperty, onLivePreviewEnd],
  );

  const commitDuration = useCallback(
    (raw: string) => {
      const num = Number(raw);
      if (Number.isFinite(num) && num >= 0)
        onUpdateMeta(
          animation.id,
          clampAnimationMetaToOwner(animation, { duration: Math.max(0, num) }, ownerRange),
        );
    },
    [animation, onUpdateMeta, ownerRange],
  );

  const commitPosition = useCallback(
    (raw: string) => {
      const num = Number(raw);
      if (Number.isFinite(num) && num >= 0)
        onUpdateMeta(
          animation.id,
          clampAnimationMetaToOwner(animation, { position: Math.max(0, num) }, ownerRange),
        );
    },
    [animation, onUpdateMeta, ownerRange],
  );

  const [copied, setCopied] = useState(false);

  const methodLabel = tx(METHOD_LABELS[animation.method] ?? animation.method);
  const easeName =
    (animation.keyframes ? animation.keyframes.easeEach : undefined) ?? animation.ease ?? "none";
  const easeLabel = easeName.startsWith("custom(")
    ? tx("Custom curve")
    : tx(EASE_LABELS[easeName] ?? easeName);
  const endTime =
    typeof animation.position === "number"
      ? animation.position + (animation.duration ?? 0)
      : animation.position;

  const summary = useMemo(() => buildTweenSummary(animation, locale), [animation, locale]);
  const phase =
    animation.method === "set" || !ownerRange
      ? null
      : resolveTimelineAnimationPhase(animation, ownerRange);
  const isShared = isAnimationSharedForOwner(animation, ownerId, ownerLocator);
  const compactEntries = (relatedAnimations ?? [animation]).map(item => ({
    animation: {...item, keyframes: item.keyframes ?? synthesizeFlatTweenKeyframes(item) ?? undefined},
    readOnly: isAnimationSharedForOwner(item, ownerId, ownerLocator),
  }));
  const compactAnimation = compactEntries[0].animation;
  const allShared = compactEntries.every(entry => entry.readOnly);
  const setKeys = Object.keys(animation.properties);
  if (
    animation.method === "set" &&
    // `every` is vacuously true on an empty bag — require at least one key so a
    // property-less set doesn't masquerade as a position row.
    (setKeys.includes("x") || setKeys.includes("y")) &&
    setKeys.every((k) => k === "x" || k === "y" || k === "immediateRender")
  )
    return (
      <div className="border-b border-neutral-800 pb-2">
        <div className="flex items-center gap-2 py-1.5">
          <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] font-medium text-neutral-400">
            {tx("Position")}
          </span>
          <span className="text-[11px] text-neutral-500">
            x: {Math.round(Number(animation.properties.x ?? 0))}, y:{" "}
            {Math.round(Number(animation.properties.y ?? 0))}
          </span>
          <span className="ml-auto text-[9px] text-neutral-600">{tx("drag to move")}</span>
        </div>
      </div>
    );

  if (compact)
    return (
      <Card
        variant="outline"
        size="sm"
        data-layer-effect-card={animation.id}
        data-selected={selected ? "true" : "false"}
        className="gap-3 rounded-xl"
        style={selected ? { borderColor: "var(--hf-panel-accent)" } : undefined}
      >
        <CardHeader className="gap-2">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <Button variant="ghost" size="sm" className="h-auto min-w-0 justify-start px-0 py-1 text-[14px] leading-5 font-medium" onClick={onSelect} aria-label="Locate effect in timeline">
              <span className="truncate">{tx(relatedAnimations && relatedAnimations.length > 1 ? "Property animation" : resolveTimelineAnimationLabel(animation, ownerRange))}</span>
            </Button>
            {allShared && <Badge variant="secondary" className="shrink-0 gap-1 font-normal"><LockKeyhole />{tx("Shared animation · Read-only")}</Badge>}
          </div>
          {compactEntries.some(entry => entry.readOnly) && <p className="text-ui-caption leading-[18px] text-muted-foreground" data-shared-animation-notice>
            {tx(allShared ? "This animation is controlled by shared rules. Individual value edits are protected; locate it in the timeline to inspect keyframes." : "Shared segments are read-only. Other keyframes remain editable.")}
          </p>}
        </CardHeader>
        <CardContent>
        <fieldset disabled={allShared && !compactAnimation.keyframes}>
          {compactAnimation.keyframes && onEditPropertyKeyframe ? (
            <PropertyKeyframeRows
              compact
              ownerKey={ownerKey}
              readOnly={isShared}
              relatedAnimations={compactEntries}
              runtimeSelector={ownerLocator?.hfId ? `[data-hf-id=${JSON.stringify(ownerLocator.hfId)}]` : undefined}
              animation={compactAnimation}
              onEdit={onEditPropertyKeyframe}
            />
          ) : (
            <div className="space-y-1">
              {Object.entries(animation.properties).map(([property, value]) => (
                <PropertyRow
                  key={property}
                  prop={property}
                  val={value}
                  onCommit={(raw) => commitProperty(property, raw)}
                  onRemove={() => onRemoveProperty(animation.id, property)}
                  removeTitle={`Remove ${PROP_LABELS[property] ?? property}`}
                />
              ))}
            </div>
          )}
        </fieldset>
        </CardContent>
        <CardFooter className="border-t">
          <Collapsible className="w-full">
            <CollapsibleTrigger className="group" render={<Button variant="ghost" size="sm" className="h-7 px-0 text-ui-caption text-muted-foreground" />}>
              <ChevronRight className="size-3.5 transition-transform group-aria-expanded:rotate-90" />{tx("Advanced")}
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-2 pt-2">
              {compactEntries.map(entry => <div key={entry.animation.id} className="space-y-1 border-b border-border pb-2 text-ui-caption text-muted-foreground">
                <span>{tx("Animation ID")}</span>
                <code className="block break-all text-ui-caption">{entry.animation.id}</code>
                {!entry.readOnly && <Button variant="ghost" size="sm" className="text-destructive" onClick={() => onDeleteAnimation(entry.animation.id)}>{tx("Remove animation")}</Button>}
              </div>)}
            </CollapsibleContent>
          </Collapsible>
        </CardFooter>
      </Card>
    );
  return (
    <div
      data-flat-effect-card={flat ? "true" : undefined}
      className={
        flat
          ? "border-b border-l-2 border-panel-accent/40 border-b-panel-hairline pb-3 pl-2"
          : "border-b border-neutral-800 pb-3"
      }
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 py-1.5"
      >
        <span
          className="rounded bg-panel-accent/10 px-1.5 py-0.5 text-[10px] font-semibold text-panel-accent"
          title={tx(METHOD_TOOLTIPS[animation.method])}
        >
          {methodLabel}
        </span>
        <span className="rounded px-1 text-[9px] text-panel-text-3">
          {tx(
            animationOrigin(animation) === "manual"
              ? "Manual keyframes"
              : animationOrigin(animation) === "preset"
                ? "Preset animation"
                : "Authored animation",
          )}
        </span>
        {phase && (
          <span
            className="rounded-full border border-white/15 bg-white/5 px-1.5 py-0.5 text-[9px] font-semibold text-panel-text-3"
            title={tx("Derived from this animation's position inside its owner clip")}
          >
            {tx(PHASE_LABELS[phase])}
          </span>
        )}
        {isShared && (
          <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-amber-400">
            {tx("Shared")}
          </span>
        )}
        <span
          className={`text-[11px] font-medium ${flat ? "text-panel-text-3" : "text-neutral-400"}`}
          title={tx("When this effect plays")}
        >
          {typeof animation.position === "number"
            ? `${parseFloat(animation.position.toFixed(3))}s`
            : animation.position}{" "}
          – {typeof endTime === "number" ? `${parseFloat(endTime.toFixed(3))}s` : endTime}
        </span>
        <span
          className={`ml-auto text-[10px] ${flat ? "text-panel-text-3" : "text-neutral-500"}`}
          title={easeName}
        >
          {easeLabel}
        </span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="currentColor"
          className={`flex-shrink-0 transition-transform ${flat ? "text-panel-text-5" : "text-neutral-500"} ${expanded ? "" : "-rotate-90"}`}
        >
          <path d="M2 3l3 4 3-4z" />
        </svg>
      </button>

      {expanded && isShared && (
        <p className="mt-1 rounded-lg bg-amber-500/10 px-2.5 py-2 text-[10px] leading-relaxed text-amber-300">
          {tx(
            "This animation uses a shared selector. It is read-only here so editing one element cannot change another. Add a new effect to create an independent animation for this element.",
          )}
        </p>
      )}
      {expanded && (
        <fieldset disabled={isShared} className={`pt-2 ${isShared ? "opacity-45" : ""}`}>
          <div className="space-y-3">
            <ComputedTweenNotice
              provenance={animation.provenance}
              onUnroll={onUnroll ? () => onUnroll(animation.id) : undefined}
            />
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <p className="text-[10px] leading-relaxed text-neutral-400 italic">{summary}</p>
                {animation.keyframes && (
                  <p className="mt-1 text-[9px] text-neutral-500">
                    <span
                      className="inline-block w-2 h-2 mr-1 align-middle"
                      style={{
                        background: "currentColor",
                        clipPath: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
                      }}
                    />
                    {tx("Keyframed — click a segment below to edit its curve")}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(summary);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="flex-shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-300"
                title={tx("Copy description to clipboard — paste into agent prompts")}
              >
                {tx(copied ? "Copied" : "Copy")}
              </button>
            </div>
            {!animation.keyframes && onEnablePropertyKeyframes && (
              <button
                type="button"
                className="rounded border border-panel-accent/40 px-2 py-1 text-[11px] text-panel-accent disabled:opacity-40"
                disabled={
                  animation.method === "set" ||
                  animation.hasUnresolvedSelector ||
                  animation.hasUnresolvedKeyframes ||
                  !!animation.arcPath?.enabled ||
                  !!(animation.provenance && animation.provenance.kind !== "literal") ||
                  typeof animation.position !== "number" ||
                  Object.values(animation.properties).some((value) => typeof value !== "number")
                }
                onClick={() => onEnablePropertyKeyframes(animation.id)}
              >
                {tx("Enable property keyframe editing")}
              </button>
            )}
            {animation.keyframes && onEditPropertyKeyframe && (
              <PropertyKeyframeRows animation={animation} onEdit={onEditPropertyKeyframe} />
            )}
            <div className={RESPONSIVE_GRID}>
              {animation.method !== "set" && (
                <MetricField
                  label="Length"
                  value={String(Math.max(0, animation.duration ?? 0))}
                  suffix="s"
                  tooltip="How long this effect lasts"
                  onCommit={commitDuration}
                />
              )}
              <MetricField
                label="Starts at"
                value={
                  typeof animation.position === "string"
                    ? animation.position
                    : String(parseFloat(Math.max(0, animation.position).toFixed(3)))
                }
                suffix={typeof animation.position === "number" ? "s" : undefined}
                tooltip="When this effect begins on the timeline"
                onCommit={commitPosition}
              />
            </div>

            {animation.method !== "set" && !(animation.keyframes && onEditPropertyKeyframe) && (
              <>
                {animation.keyframes && onUpdateKeyframeEase ? (
                  <KeyframeEaseList
                    keyframes={animation.keyframes.keyframes}
                    globalEase={animation.keyframes.easeEach ?? animation.ease ?? "none"}
                    expandedPct={expandedKfPct}
                    onToggle={setExpandedKfPct}
                    onEaseCommit={(pct, ease) => onUpdateKeyframeEase(animation.id, pct, ease)}
                    onApplyAll={
                      onSetAllKeyframeEases
                        ? (ease) => onSetAllKeyframeEases(animation.id, ease)
                        : undefined
                    }
                  />
                ) : (
                  <>
                    <SelectField
                      label="Speed"
                      value={easeName.startsWith("custom(") ? "custom" : easeName}
                      options={[...SUPPORTED_EASES, "custom"]}
                      onChange={(next) => {
                        const easeKey = animation.keyframes ? "easeEach" : "ease";
                        if (next === "custom") {
                          const points = controlPointsForGsapEase(
                            easeName !== "none" ? easeName : "power2.out",
                          );
                          const path = `M0,0 C${points.x1},${points.y1} ${points.x2},${points.y2} 1,1`;
                          onUpdateMeta(animation.id, { [easeKey]: `custom(${path})` });
                        } else {
                          onUpdateMeta(animation.id, { [easeKey]: next });
                        }
                      }}
                    />
                    <EaseCurveSection
                      ease={easeName}
                      duration={animation.duration}
                      onCustomEaseCommit={(customEase) => {
                        const easeKey = animation.keyframes ? "easeEach" : "ease";
                        onUpdateMeta(animation.id, { [easeKey]: customEase });
                      }}
                    />
                  </>
                )}
              </>
            )}

            {animation.method === "fromTo" && (
              <div className="space-y-1">
                <p className="text-[9px] font-semibold uppercase tracking-wider text-orange-400/70">
                  {tx("From")}
                </p>
                <div className="space-y-1.5">
                  {Object.entries(animation.fromProperties ?? {}).map(([prop, val]) => (
                    <PropertyRow
                      key={prop}
                      prop={prop}
                      val={val}
                      onCommit={(adjusted) => commitFromProperty(prop, adjusted)}
                      onRemove={() => onRemoveFromProperty?.(animation.id, prop)}
                      removeTitle={`Remove from-${PROP_LABELS[prop] ?? prop}`}
                    />
                  ))}
                </div>
                <div className="pt-0.5">
                  <AddPropertyTrigger
                    adding={addingFromProp}
                    available={availableFromProps}
                    addLabel="+ From property"
                    addTitle="Add a from-state property"
                    onAdd={(prop) => onAddFromProperty?.(animation.id, prop)}
                    onOpen={() => setAddingFromProp(true)}
                    onClose={() => setAddingFromProp(false)}
                    buttonClassName="text-[11px] font-medium text-orange-400/70 transition-colors hover:text-orange-300"
                  />
                </div>
              </div>
            )}

            {animation.method === "fromTo" && Object.keys(animation.properties).length > 0 && (
              <p className="text-[9px] font-semibold uppercase tracking-wider text-panel-accent/70">
                {tx("To")}
              </p>
            )}

            {Object.keys(animation.properties).length > 0 && (
              <div className="space-y-1.5">
                {Object.entries(animation.properties).map(([prop, val]) => (
                  <PropertyRow
                    key={prop}
                    prop={prop}
                    val={val}
                    onCommit={(adjusted) => {
                      scrubProperty(prop, adjusted);
                      commitProperty(prop, adjusted);
                    }}
                    onRemove={() => onRemoveProperty(animation.id, prop)}
                    removeTitle={`Remove ${PROP_LABELS[prop] ?? prop}`}
                  />
                ))}
              </div>
            )}

            {onSetArcPath &&
              (animation.properties.x != null ||
                animation.properties.y != null ||
                animation.keyframes) && (
                <div className="border-t border-neutral-800 pt-3">
                  <ArcPathControls
                    arcPath={
                      animation.arcPath ?? { enabled: false, autoRotate: false, segments: [] }
                    }
                    segmentCount={Math.max(
                      animation.properties.x != null || animation.properties.y != null ? 1 : 0,
                      (animation.keyframes?.keyframes?.length ?? 0) - 1,
                    )}
                    onToggle={(enabled) =>
                      onSetArcPath(animation.id, {
                        enabled,
                        segments: animation.arcPath?.segments,
                      })
                    }
                    onUpdateSegment={(index, update) =>
                      onUpdateArcSegment?.(animation.id, index, update)
                    }
                    onToggleAutoRotate={(autoRotate) =>
                      onSetArcPath(animation.id, {
                        enabled: true,
                        autoRotate,
                        segments: animation.arcPath?.segments,
                      })
                    }
                  />
                </div>
              )}

            <div className="flex items-center gap-2 pt-1">
              <AddPropertyTrigger
                adding={addingProp}
                available={availableProps}
                addLabel="+ Effect"
                addTitle="Add another animated property to this effect"
                onAdd={(prop) => onAddProperty(animation.id, prop)}
                onOpen={() => setAddingProp(true)}
                onClose={() => setAddingProp(false)}
                buttonClassName="text-[11px] font-medium text-neutral-400 transition-colors hover:text-neutral-200"
              />
              <button
                type="button"
                onClick={() => onDeleteAnimation(animation.id)}
                className="ml-auto text-[11px] font-medium text-red-400 transition-colors hover:text-red-300"
                title={tx("Remove this animation")}
              >
                {tx("Remove")}
              </button>
            </div>
          </div>
        </fieldset>
      )}
    </div>
  );
});
