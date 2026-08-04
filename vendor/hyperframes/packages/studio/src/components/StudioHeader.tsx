import {
  STUDIO_INSPECTOR_PANELS_ENABLED,
  STUDIO_MANUAL_EDITING_DISABLED_TITLE,
} from "./editor/manualEditingAvailability";
import { useStudioShellContext } from "../contexts/StudioContext";
import { usePanelLayoutContext } from "../contexts/PanelLayoutContext";
import { trackStudioEvent } from "../utils/studioTelemetry";
import { Tooltip } from "./ui";
import { useStudioI18n } from "../i18n";
import propertiesIconSrc from "../icons/studioHeaderProperties.svg?url";
import exportIconSrc from "../icons/studioHeaderExport.svg?url";

export interface StudioHeaderProps {
  inspectorButtonActive: boolean;
  inspectorPanelActive: boolean;
}

export function StudioHeader({ inspectorButtonActive, inspectorPanelActive }: StudioHeaderProps) {
  const { renderQueue, projectId } = useStudioShellContext();
  const { rightCollapsed, setRightCollapsed, setRightPanelTab } = usePanelLayoutContext();
  const { t } = useStudioI18n();
  const isRendering = renderQueue.isRendering;

  const toggleProperties = () => {
    if (!STUDIO_INSPECTOR_PANELS_ENABLED) return;
    if (window.parent !== window) {
      window.parent.postMessage({ type: "ipollowork:video-studio-panel", projectId, panel: null }, "*");
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
    if (window.parent !== window) {
      window.parent.postMessage({ type: "ipollowork:video-studio-panel", projectId, panel: null }, "*");
    }
    setRightPanelTab("renders");
    setRightCollapsed(false);
  };

  return (
    <header className="relative flex h-[49px] flex-shrink-0 items-center border-b border-[#ebebeb] bg-white/90 px-3 text-[#1d1d1b] backdrop-blur-sm">
      <div className="min-w-0 flex-1">
        <span className="block max-w-64 truncate text-[13px] font-medium text-[#71736e]" title={projectId}>
          {projectId}
        </span>
      </div>

      <div
        className="absolute left-1/2 flex h-8 -translate-x-1/2 items-center gap-0.5 rounded-[9px] bg-[#ededeb] p-[3px]"
        role="tablist"
        aria-label={t("header.viewLabel")}
      >
        <button
          type="button"
          role="tab"
          aria-selected="true"
          className="h-[26px] rounded-md bg-white px-3 text-xs font-semibold text-[#1d1d1b] shadow-[0_1px_2px_rgba(0,0,0,0.12)]"
        >
          {t("header.edit")}
        </button>
        <Tooltip label={t("header.previewComingSoon")} side="bottom">
          <button
            type="button"
            role="tab"
            aria-selected="false"
            aria-disabled="true"
            className="h-[26px] cursor-default rounded-md px-3 text-xs font-medium text-[#777974]"
          >
            {t("header.preview")}
          </button>
        </Tooltip>
      </div>

      <div className="flex flex-1 items-center justify-end gap-4">
        <Tooltip
          label={
            STUDIO_INSPECTOR_PANELS_ENABLED ? t("header.inspector") : STUDIO_MANUAL_EDITING_DISABLED_TITLE
          }
          side="bottom"
        >
          <button
            type="button"
            onClick={toggleProperties}
            disabled={!STUDIO_INSPECTOR_PANELS_ENABLED}
            aria-pressed={inspectorButtonActive}
            className={`flex h-8 items-center gap-1 overflow-hidden rounded-lg border px-[9px] py-px text-xs font-medium leading-normal transition-[background-color,border-color,transform] outline-none focus-visible:ring-2 focus-visible:ring-black/25 focus-visible:ring-offset-2 active:scale-[0.98] ${
              inspectorButtonActive
                ? "border-[#1d1d1b] bg-[#f2f2f0] text-[#1d1d1b]"
                : STUDIO_INSPECTOR_PANELS_ENABLED
                  ? "border-[#858a94] bg-white text-black hover:border-[#62666e] hover:bg-[#f7f7f5] active:border-black active:bg-[#ededeb]"
                  : "cursor-not-allowed border-[#d9dad7] text-[#92948f]"
            }`}
            aria-label={
              STUDIO_INSPECTOR_PANELS_ENABLED ? t("header.inspector") : STUDIO_MANUAL_EDITING_DISABLED_TITLE
            }
          >
            <img className="h-4 w-4 shrink-0" src={propertiesIconSrc} alt="" aria-hidden="true" />
            {t("header.inspector")}
          </button>
        </Tooltip>
        <Tooltip label={isRendering ? t("header.renderInProgress") : t("header.renderExport")} side="bottom">
          <button
            type="button"
            onClick={openExport}
            className="hf-studio-header-export flex h-8 items-center gap-1 overflow-hidden rounded-lg px-2 text-xs font-medium leading-normal transition-[background-color,transform] outline-none focus-visible:ring-2 focus-visible:ring-black/25 focus-visible:ring-offset-2 active:scale-[0.98]"
          >
            <img className="h-4 w-4 shrink-0" src={exportIconSrc} alt="" aria-hidden="true" />
            {isRendering ? t("header.rendering") : t("header.export")}
          </button>
        </Tooltip>
      </div>
    </header>
  );
}
