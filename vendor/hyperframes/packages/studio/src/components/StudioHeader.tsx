import { useEffect, useState } from "react";
import {
  STUDIO_INSPECTOR_PANELS_ENABLED,
  STUDIO_MANUAL_EDITING_DISABLED_TITLE,
} from "./editor/manualEditingAvailability";
import { useStudioPlaybackContext, useStudioShellContext } from "../contexts/StudioContext";
import { usePanelLayoutContext } from "../contexts/PanelLayoutContext";
import { trackStudioEvent } from "../utils/studioTelemetry";
import { Tooltip } from "./ui";
import { useStudioI18n } from "../i18n";
import propertiesIconSrc from "../icons/studioHeaderProperties.svg?url";
import exportIconSrc from "../icons/studioHeaderExport.svg?url";

export interface StudioHeaderProps {
  inspectorButtonActive: boolean;
  inspectorPanelActive: boolean;
  previewMode: boolean;
  onPreviewModeChange: (previewMode: boolean) => void;
}

export function StudioHeader({
  inspectorButtonActive,
  inspectorPanelActive,
  previewMode,
  onPreviewModeChange,
}: StudioHeaderProps) {
  const { renderQueue, projectId, previewIframeRef } = useStudioShellContext();
  const { compositionLoading, refreshKey } = useStudioPlaybackContext();
  const { rightCollapsed, setRightCollapsed, setRightPanelTab } = usePanelLayoutContext();
  const { t } = useStudioI18n();
  const isRendering = renderQueue.isRendering;
  const [compositionTitle, setCompositionTitle] = useState(projectId);

  useEffect(() => {
    const preview = previewIframeRef.current;
    const updateTitle = () => {
      const title = preview?.contentDocument?.title.trim();
      setCompositionTitle(title || projectId);
    };
    updateTitle();
    preview?.addEventListener("load", updateTitle);
    return () => preview?.removeEventListener("load", updateTitle);
  }, [compositionLoading, previewIframeRef, projectId, refreshKey]);

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

  const setPreviewMode = (nextPreviewMode: boolean) => {
    if (nextPreviewMode && window.parent !== window) {
      window.parent.postMessage(
        { type: "ipollowork:video-studio-panel", projectId, panel: null },
        "*",
      );
    }
    onPreviewModeChange(nextPreviewMode);
  };

  return (
    <header className="hf-studio-header relative flex h-[49px] flex-shrink-0 items-center border-b border-[var(--hf-panel-hairline)] bg-[var(--hf-studio-header-bg)] px-3 text-[var(--hf-panel-text-1)] backdrop-blur-sm">
      <div className="min-w-0 flex-1">
        <span className="block max-w-64 truncate text-[13px] font-medium text-[var(--hf-panel-text-3)]" title={compositionTitle}>
          {compositionTitle}
        </span>
      </div>

      <div
        className="absolute left-1/2 flex h-8 -translate-x-1/2 items-center gap-0.5 rounded-[9px] bg-[var(--hf-panel-input)] p-[3px]"
        role="tablist"
        aria-label={t("header.viewLabel")}
      >
        <button
          type="button"
          role="tab"
          aria-selected={!previewMode}
          onClick={() => setPreviewMode(false)}
          className={`h-[26px] rounded-md px-3 text-xs transition-[background-color,color,box-shadow] ${
            !previewMode
              ? "bg-[var(--hf-panel-surface)] font-semibold text-[var(--hf-panel-text-0)] shadow-[0_1px_2px_rgba(0,0,0,0.24)]"
              : "font-medium text-[var(--hf-panel-text-3)] hover:text-[var(--hf-panel-text-1)]"
          }`}
        >
          {t("header.edit")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={previewMode}
          onClick={() => setPreviewMode(true)}
          className={`h-[26px] rounded-md px-3 text-xs transition-[background-color,color,box-shadow] ${
            previewMode
              ? "bg-[var(--hf-panel-surface)] font-semibold text-[var(--hf-panel-text-0)] shadow-[0_1px_2px_rgba(0,0,0,0.24)]"
              : "font-medium text-[var(--hf-panel-text-3)] hover:text-[var(--hf-panel-text-1)]"
          }`}
        >
          {t("header.preview")}
        </button>
      </div>

      <div className="flex flex-1 items-center justify-end gap-4">
        {!previewMode ? (
          <>
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
                    ? "border-[var(--hf-panel-text-3)] bg-[var(--hf-studio-button-bg)] text-[var(--hf-panel-text-0)]"
                    : STUDIO_INSPECTOR_PANELS_ENABLED
                      ? "border-[var(--hf-panel-border-input)] bg-[var(--hf-studio-button-bg)] text-[var(--hf-panel-text-1)] hover:border-[var(--hf-panel-text-3)] hover:bg-[var(--hf-panel-hover)]"
                      : "cursor-not-allowed border-[#d9dad7] text-[#92948f]"
                }`}
                aria-label={
                  STUDIO_INSPECTOR_PANELS_ENABLED ? t("header.inspector") : STUDIO_MANUAL_EDITING_DISABLED_TITLE
                }
              >
                <img className="hf-studio-properties-icon h-4 w-4 shrink-0" src={propertiesIconSrc} alt="" aria-hidden="true" />
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
          </>
        ) : null}
      </div>
    </header>
  );
}
