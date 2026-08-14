import { useEffect, useState } from "react";
import { FloppyDisk } from "@phosphor-icons/react";
import {
  STUDIO_INSPECTOR_PANELS_ENABLED,
  STUDIO_MANUAL_EDITING_DISABLED_TITLE,
} from "./editor/manualEditingAvailability";
import { useStudioPlaybackContext, useStudioShellContext } from "../contexts/StudioContext";
import { usePanelLayoutContext } from "../contexts/PanelLayoutContext";
import { trackStudioEvent } from "../utils/studioTelemetry";
import { Tooltip } from "./ui";
import { useStudioI18n } from "../i18n";
import { RotateCw } from "../icons/SystemIcons";
import propertiesIconSrc from "../icons/studioHeaderProperties.svg?url";
import exportIconSrc from "../icons/studioHeaderExport.svg?url";

export interface StudioHeaderProps {
  inspectorButtonActive: boolean;
  inspectorPanelActive: boolean;
  previewMode: boolean;
  onPreviewModeChange: (previewMode: boolean) => void;
}

type StudioHostContext = {
  title: string;
  actions: {
    reload: boolean;
    saveAsTemplate: boolean;
  };
};

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
  const [hostContext, setHostContext] = useState<StudioHostContext | null>(null);

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

  useEffect(() => {
    const handleHostContext = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      if (event.data?.type !== "ipollowork:studio-host-context") return;
      if (event.data.projectId !== projectId || typeof event.data.title !== "string") return;
      setHostContext({
        title: event.data.title.trim(),
        actions: {
          reload: event.data.actions?.reload === true,
          saveAsTemplate: event.data.actions?.saveAsTemplate === true,
        },
      });
    };
    window.addEventListener("message", handleHostContext);
    return () => window.removeEventListener("message", handleHostContext);
  }, [projectId]);

  const displayTitle = hostContext?.title || compositionTitle;

  const requestHostAction = (action: "reload" | "save-as-template") => {
    if (window.parent === window) return;
    window.parent.postMessage(
      { type: "ipollowork:studio-host-action", projectId, action },
      "*",
    );
  };

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
      <div className="flex min-w-0 flex-1 items-center gap-2 pr-6">
        <span className="block min-w-0 max-w-64 truncate text-[13px] font-medium text-[var(--hf-panel-text-3)]" title={displayTitle}>
          {displayTitle}
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
            {hostContext?.actions.reload || hostContext?.actions.saveAsTemplate ? (
              <div className="mr-1 flex items-center gap-2">
                {hostContext.actions.saveAsTemplate ? (
                  <Tooltip label={t("header.saveAsTemplate")} side="bottom">
                    <button
                      type="button"
                      onClick={() => requestHostAction("save-as-template")}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[var(--hf-panel-text-2)] transition-[background-color,color,transform] outline-none hover:bg-[var(--hf-panel-hover)] hover:text-[var(--hf-panel-text-0)] focus-visible:ring-2 focus-visible:ring-black/25 focus-visible:ring-offset-2 active:scale-[0.96]"
                      aria-label={t("header.saveAsTemplate")}
                    >
                      <FloppyDisk className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </Tooltip>
                ) : null}
                {hostContext.actions.reload ? (
                  <Tooltip label={t("header.reloadStudio")} side="bottom">
                    <button
                      type="button"
                      onClick={() => requestHostAction("reload")}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[var(--hf-panel-text-2)] transition-[background-color,color,transform] outline-none hover:bg-[var(--hf-panel-hover)] hover:text-[var(--hf-panel-text-0)] focus-visible:ring-2 focus-visible:ring-black/25 focus-visible:ring-offset-2 active:scale-[0.96]"
                      aria-label={t("header.reloadStudio")}
                    >
                      <RotateCw className="h-4 w-4" />
                    </button>
                  </Tooltip>
                ) : null}
              </div>
            ) : null}
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
