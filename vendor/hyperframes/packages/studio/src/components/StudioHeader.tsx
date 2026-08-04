import { useRef, type KeyboardEvent } from "react";
import {
  STUDIO_INSPECTOR_PANELS_ENABLED,
  STUDIO_MANUAL_EDITING_DISABLED_TITLE,
} from "./editor/manualEditingAvailability";
import { useStudioShellContext } from "../contexts/StudioContext";
import { usePanelLayoutContext } from "../contexts/PanelLayoutContext";
import { useViewMode, type StudioViewMode } from "../contexts/ViewModeContext";
import { trackStudioEvent } from "../utils/studioTelemetry";
import { Tooltip } from "./ui";
import { useStudioI18n } from "../i18n";

const propertiesIcon = new URL(
  "../assets/figma-video-studio/properties.svg",
  import.meta.url,
).href;
const exportIcon = new URL("../assets/figma-video-studio/export.svg", import.meta.url).href;

export interface StudioHeaderProps {
  inspectorButtonActive: boolean;
  inspectorPanelActive: boolean;
}

const VIEW_MODE_OPTIONS: Array<{
  mode: StudioViewMode;
  labelKey: "header.storyboard" | "header.preview";
}> = [
  { mode: "timeline", labelKey: "header.storyboard" },
  { mode: "storyboard", labelKey: "header.preview" },
];

/** Segmented control switching between the timeline editor and storyboard preview. */
export function ViewModeToggle() {
  const { viewMode, setViewMode } = useViewMode();
  const { t } = useStudioI18n();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectMode = (mode: StudioViewMode) => {
    if (mode === viewMode) return;
    if (setViewMode(mode)) trackStudioEvent("view_mode_toggle", { mode });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    const nextIndex = (index + direction + VIEW_MODE_OPTIONS.length) % VIEW_MODE_OPTIONS.length;
    tabRefs.current[nextIndex]?.focus();
    selectMode(VIEW_MODE_OPTIONS[nextIndex].mode);
  };

  return (
    <div
      className="flex h-8 items-center justify-center gap-0.5 rounded-[9px] bg-[#ededeb] p-[3px]"
      role="tablist"
      aria-label={t("header.viewLabel")}
    >
      {VIEW_MODE_OPTIONS.map(({ mode, labelKey }, index) => {
        const active = viewMode === mode;
        return (
          <button
            key={mode}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => selectMode(mode)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={`h-[26px] rounded-md px-4 text-center text-[12px] leading-none outline-none transition-[color,background-color,box-shadow,transform] duration-150 focus-visible:ring-2 focus-visible:ring-[#20bbc0]/45 enabled:active:scale-[0.97] ${
              active
                ? "bg-white font-semibold text-[#111] shadow-[0_1px_2px_rgba(15,15,14,0.12)]"
                : "font-normal text-[#777974] hover:bg-white/60 hover:text-[#444641] active:bg-white/80"
            }`}
          >
            {t(labelKey)}
          </button>
        );
      })}
    </div>
  );
}

export function StudioHeader({
  inspectorButtonActive,
  inspectorPanelActive,
}: StudioHeaderProps) {
  const { renderQueue, projectId } = useStudioShellContext();
  const { rightCollapsed, setRightCollapsed, setRightPanelTab } = usePanelLayoutContext();
  const { t } = useStudioI18n();
  const isRendering = renderQueue.isRendering;

  const toggleProperties = () => {
    if (!STUDIO_INSPECTOR_PANELS_ENABLED) return;
    if (window.parent !== window) {
      window.parent.postMessage(
        { type: "ipollowork:video-studio-panel", projectId, panel: null },
        "*",
      );
    }
    if (rightCollapsed || !inspectorPanelActive) {
      trackStudioEvent("panel_toggle", { panel: "inspector", collapsed: false });
      setRightPanelTab("design");
      setRightCollapsed(false);
      return;
    }
    trackStudioEvent("panel_toggle", { panel: "inspector", collapsed: true });
    setRightCollapsed(true);
  };

  const openExport = () => {
    if (isRendering) return;
    if (window.parent !== window) {
      window.parent.postMessage(
        { type: "ipollowork:video-studio-panel", projectId, panel: null },
        "*",
      );
    }
    setRightPanelTab("renders");
    setRightCollapsed(false);
  };

  return (
    <header
      className="grid h-[49px] flex-shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b-[0.5px] border-[#ebebeb] bg-white/90 px-4 font-['PingFang_SC'] text-[#242522] backdrop-blur-sm max-[640px]:grid-cols-[1fr_auto] max-[640px]:px-2"
      data-figma-node-id="247:3022"
    >
      <div className="flex w-[151px] min-w-0 items-center gap-[10px] max-[640px]:hidden">
        <span className="max-w-[95px] truncate pl-1 text-[13px] font-medium tracking-[-0.26px] text-[#71736e]">
          {projectId}
        </span>
        <span className="whitespace-nowrap border-l border-[#d9dad7] pl-[13px] text-[11px] font-normal tracking-[-0.26px] text-[#92948f]">
          {t("header.saved")}
        </span>
      </div>

      <div className="justify-self-center max-[640px]:justify-self-start">
        <ViewModeToggle />
      </div>

      <div className="flex items-center justify-end gap-4 max-[640px]:gap-2">
        <Tooltip
          label={
            STUDIO_INSPECTOR_PANELS_ENABLED
              ? t("header.properties")
              : STUDIO_MANUAL_EDITING_DISABLED_TITLE
          }
          side="bottom"
        >
          <button
            type="button"
            onClick={toggleProperties}
            disabled={!STUDIO_INSPECTOR_PANELS_ENABLED}
            aria-pressed={inspectorButtonActive}
            className="flex h-8 items-center justify-center gap-1 overflow-hidden rounded-lg border border-[#858a94] bg-transparent px-[9px] py-px text-[12px] font-medium text-black outline-none transition-[color,background-color,border-color,opacity,transform] duration-150 focus-visible:ring-2 focus-visible:ring-[#20bbc0]/45 enabled:hover:border-[#5f626a] enabled:hover:bg-[#f6f6f4] enabled:active:scale-[0.97] enabled:active:bg-[#ededeb] disabled:cursor-not-allowed disabled:border-[#c7c9ce] disabled:text-[#92948f] disabled:opacity-50 max-[420px]:w-8 max-[420px]:px-0"
            aria-label={
              STUDIO_INSPECTOR_PANELS_ENABLED
                ? t("header.properties")
                : STUDIO_MANUAL_EDITING_DISABLED_TITLE
            }
          >
            <img src={propertiesIcon} alt="" className="h-4 w-4" />
            <span className="max-[420px]:sr-only">{t("header.properties")}</span>
          </button>
        </Tooltip>

        <Tooltip
          label={isRendering ? t("header.renderInProgress") : t("header.renderExport")}
          side="bottom"
        >
          <button
            type="button"
            onClick={openExport}
            disabled={isRendering}
            className="flex h-8 items-center justify-center gap-1 overflow-hidden rounded-lg bg-black px-2 text-[12px] font-medium text-[#fff] outline-none transition-[background-color,opacity,transform] duration-150 focus-visible:ring-2 focus-visible:ring-[#20bbc0]/45 enabled:hover:bg-[#292929] enabled:active:scale-[0.97] enabled:active:bg-[#3a3a3a] disabled:cursor-not-allowed disabled:bg-[#8f918d] disabled:opacity-50"
            aria-label={isRendering ? t("header.rendering") : t("header.export")}
          >
            <img src={exportIcon} alt="" className="h-4 w-4" />
            <span>{isRendering ? t("header.rendering") : t("header.export")}</span>
          </button>
        </Tooltip>
      </div>
    </header>
  );
}
