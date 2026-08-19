import { useCallback, useMemo, useState, type KeyboardEvent } from "react";
import { useDomEditSelectionContext } from "../../contexts/DomEditContext";
import { useStudioShellContext } from "../../contexts/StudioContext";
import { useStudioI18n } from "../../i18n";
import { usePlayerStore, type TimelineElement } from "../../player";
import {
  ILLUSTRATION_EFFECTS,
  ILLUSTRATION_EFFECT_SAMPLE,
  renderIllustrationEffectHtml,
  selectIllustrationTextCandidates,
  type IllustrationEffectData,
  type IllustrationEffectId,
} from "../../utils/illustrationEffect";
import { HtmlIllustrationPreview } from "./HtmlIllustrationPreview";

export const ILLUSTRATION_SKILL_COUNT = ILLUSTRATION_EFFECTS.length;

const ILLUSTRATION_EFFECT_PREVIEWS = new Map(
  ILLUSTRATION_EFFECTS.map((effect) => [
    effect.id,
    renderIllustrationEffectHtml(effect.id, ILLUSTRATION_EFFECT_SAMPLE),
  ]),
);

interface IllustrationEffectsContentProps {
  onInsert?: (effectId: IllustrationEffectId, data: IllustrationEffectData) => Promise<boolean>;
}

function trimText(value: string | null | undefined, maxLength: number): string | null {
  const compacted = value?.replace(/\s+/g, " ").trim();
  return compacted ? compacted.slice(0, maxLength) : null;
}

function selectedTimelineElement(
  elements: TimelineElement[],
  selectedId: string | null,
): TimelineElement | null {
  if (!selectedId) return null;
  return (
    elements.find((element) => (element.key ?? element.id) === selectedId) ??
    elements.find((element) => element.id === selectedId) ??
    null
  );
}

function buildSelectedClipData(
  timeline: TimelineElement | null,
  selection: ReturnType<typeof useDomEditSelectionContext>["domEditSelection"],
): IllustrationEffectData | null {
  if (!timeline && !selection) return null;

  const uniqueText = selectIllustrationTextCandidates([
    ...(selection?.textFields.map((field) => field.value) ?? []),
    selection?.textContent,
  ]);
  const label = trimText(timeline?.clipLabel ?? timeline?.label ?? selection?.label, 48);
  const sourceFile = selection?.sourceFile || timeline?.sourceFile || "index.html";
  const sourceLabel =
    sourceFile
      .split("/")
      .pop()
      ?.replace(/\.html?$/i, "") || "当前片段";
  const sourceKind =
    trimText(timeline?.timelineKind ?? selection?.tagName ?? timeline?.tag, 18) ?? "HTML";
  const title = uniqueText[0] ?? label ?? "当前片段";
  const subtitle =
    uniqueText.find((value) => value !== title) ??
    (label && label !== title ? label : `来自 ${sourceLabel} 的片段内容`);
  const detail =
    uniqueText.find((value) => value !== title && value !== subtitle) ??
    `${sourceKind} · ${Math.max(1, timeline?.duration ?? 5).toFixed(1)} 秒`;

  return {
    title,
    subtitle,
    eyebrow: label ?? "片段插画",
    detail,
    sourceLabel,
    sourceKind,
    duration: Math.max(1, timeline?.duration ?? 5),
  };
}

export function IllustrationEffectsContent({ onInsert }: IllustrationEffectsContentProps) {
  const { locale } = useStudioI18n();
  const { showToast } = useStudioShellContext();
  const { domEditSelection } = useDomEditSelectionContext();
  const selectedElementId = usePlayerStore((state) => state.selectedElementId);
  const timelineElements = usePlayerStore((state) => state.elements);
  const timeline = useMemo(
    () => selectedTimelineElement(timelineElements, selectedElementId),
    [selectedElementId, timelineElements],
  );
  const clipData = useMemo(
    () => buildSelectedClipData(timeline, domEditSelection),
    [domEditSelection, timeline],
  );
  const [insertingId, setInsertingId] = useState<IllustrationEffectId | null>(null);

  const insert = useCallback(
    async (effectId: IllustrationEffectId) => {
      if (!clipData || !onInsert || insertingId) return;
      setInsertingId(effectId);
      try {
        const inserted = await onInsert(effectId, clipData);
        if (inserted) {
          showToast(
            locale === "zh"
              ? "插画已生成，并插入到当前帧和素材库。"
              : "Illustration added at the playhead and to Assets.",
            "notice",
          );
        }
      } finally {
        setInsertingId(null);
      }
    },
    [clipData, insertingId, locale, onInsert, showToast],
  );

  const handleCardKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>, effectId: IllustrationEffectId) => {
      if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " "))
        return;
      event.preventDefault();
      void insert(effectId);
    },
    [insert],
  );

  const canInsert = Boolean(clipData && onInsert);
  const selectedTitle = clipData ? (trimText(clipData.title, 48) ?? clipData.title) : null;

  return (
    <div className="px-0 pb-1 text-panel-text-1">
      <div className="mb-3 rounded-lg border border-panel-border bg-panel-input/45 px-3 py-2 text-[10px] leading-4 text-panel-text-3">
        {clipData
          ? locale === "zh"
            ? `将使用“${selectedTitle}”的片段数据，本地生成后插入当前帧。`
            : `Uses data from “${selectedTitle}” and inserts locally at the playhead.`
          : locale === "zh"
            ? "可预览全部插画。选中画布元素或时间轴片段后才可应用。"
            : "All previews remain available. Select a canvas element or timeline clip to apply one."}
      </div>
      <div className="grid min-w-0 grid-cols-2 gap-x-[10px] gap-y-4 overflow-x-hidden">
        {ILLUSTRATION_EFFECTS.map((effect) => {
          const previewHtml = ILLUSTRATION_EFFECT_PREVIEWS.get(effect.id) ?? "";
          const inserting = insertingId === effect.id;
          return (
            <div
              key={effect.id}
              role="button"
              tabIndex={canInsert ? 0 : -1}
              aria-disabled={!canInsert}
              data-testid="illustration-effect-card"
              data-illustration-effect={effect.id}
              className={`group/card min-w-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1FBAC0]/60 ${
                canInsert ? "cursor-pointer" : "cursor-default"
              }`}
              onClick={() => void insert(effect.id)}
              onKeyDown={(event) => handleCardKeyDown(event, effect.id)}
            >
              <div className="relative aspect-[14/9] w-full overflow-hidden rounded-lg border border-panel-border bg-panel-input transition-shadow group-hover/card:shadow-[0_3px_12px_rgba(0,0,0,0.12)]">
                <HtmlIllustrationPreview
                  srcDoc={previewHtml}
                  title={`${effect.title[locale]} preview`}
                  className="absolute left-0 top-1/2 w-full -translate-y-1/2"
                />
                <span className="pointer-events-none absolute left-1 top-1 rounded bg-[#174d42] px-1.5 py-1 text-[7px] font-semibold leading-none text-[#6de0c1]">
                  {locale === "zh" ? "本地生成" : "Local"}
                </span>
                <span className="pointer-events-none absolute right-1 top-1 rounded bg-white/90 px-1.5 py-1 text-[8px] font-semibold leading-none text-[#4d5159] shadow-sm">
                  16:9
                </span>
              </div>
              <div className="pt-[7px]">
                <div className="truncate text-[10px] font-medium leading-4 text-panel-text-1">
                  {effect.title[locale]}
                </div>
                <div className="mt-0.5 line-clamp-2 min-h-7 text-[8px] leading-3.5 text-panel-text-3">
                  {effect.description[locale]}
                </div>
                <button
                  type="button"
                  disabled={!canInsert || Boolean(insertingId)}
                  onClick={(event) => {
                    event.stopPropagation();
                    void insert(effect.id);
                  }}
                  title={
                    canInsert
                      ? locale === "zh"
                        ? "用选中片段的数据生成，并插入到当前帧"
                        : "Generate from the selected clip and insert at the playhead"
                      : locale === "zh"
                        ? "请先选中画布元素或时间轴片段"
                        : "Select a canvas element or timeline clip first"
                  }
                  className="mt-1.5 flex h-7 w-full items-center justify-center rounded-md border border-panel-border bg-panel-bg px-1 text-[9px] font-semibold text-panel-text-1 transition-colors hover:bg-panel-input disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {inserting
                    ? locale === "zh"
                      ? "生成中…"
                      : "Generating…"
                    : locale === "zh"
                      ? "插入当前帧"
                      : "Insert at playhead"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
