import { useEffect, useState } from "react";
import { DownloadSimple, FilmSlate, FloppyDisk, GithubLogo, SlidersHorizontal, Sparkle, SquaresFour } from "@phosphor-icons/react";
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

export interface StudioHeaderProps {
  inspectorButtonActive: boolean;
  inspectorPanelActive: boolean;
  previewMode: boolean;
  onPreviewModeChange: (previewMode: boolean) => void;
}

type StudioHostContext = {
  title: string;
  branding: null | {
    title: string;
    byline: string;
    bylineUrl: string;
    repositoryUrl: string;
  };
  actions: {
    reload: boolean;
    saveAsTemplate: boolean;
    openTemplates: boolean;
    askAi: boolean;
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
        branding: event.data.branding && typeof event.data.branding === "object"
          ? {
              title: typeof event.data.branding.title === "string" ? event.data.branding.title.trim() : "",
              byline: typeof event.data.branding.byline === "string" ? event.data.branding.byline.trim() : "",
              bylineUrl: typeof event.data.branding.bylineUrl === "string" ? event.data.branding.bylineUrl : "",
              repositoryUrl: typeof event.data.branding.repositoryUrl === "string" ? event.data.branding.repositoryUrl : "",
            }
          : null,
        actions: {
          reload: event.data.actions?.reload === true,
          saveAsTemplate: event.data.actions?.saveAsTemplate === true,
          openTemplates: event.data.actions?.openTemplates === true,
          askAi: event.data.actions?.askAi === true,
        },
      });
    };
    window.addEventListener("message", handleHostContext);
    return () => window.removeEventListener("message", handleHostContext);
  }, [projectId]);

  const displayTitle = hostContext?.title || compositionTitle;

  const requestHostAction = (action: "reload" | "save-as-template" | "open-templates" | "ask-ai") => {
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
      <div className="hf-studio-header-title flex min-w-0 flex-1 items-center gap-2 pr-6">
        {hostContext?.branding ? (
          <>
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] border border-[var(--hf-panel-border-input)] bg-[var(--hf-studio-button-bg)] text-[var(--hf-panel-text-0)] shadow-[inset_0_1px_rgba(255,255,255,0.08)]">
              <FilmSlate className="h-[17px] w-[17px]" weight="duotone" />
            </span>
            <span className="flex min-w-0 flex-col leading-none">
              <strong className="truncate text-[13px] font-semibold tracking-[-0.01em] text-[var(--hf-panel-text-0)]">{hostContext.branding.title}</strong>
              <a className="mt-1 truncate text-[9px] font-medium text-[var(--hf-panel-text-3)] transition-colors hover:text-[var(--hf-panel-text-1)]" href={hostContext.branding.bylineUrl} target="_blank" rel="noreferrer">{hostContext.branding.byline}</a>
            </span>
            {hostContext.actions.openTemplates ? (
              <button type="button" onClick={() => requestHostAction("open-templates")} className="ml-2 flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-[var(--hf-panel-text-2)] transition hover:bg-[var(--hf-studio-header-hover)] hover:text-[var(--hf-panel-text-0)]">
                <SquaresFour className="h-4 w-4" />{t("header.templates")}
              </button>
            ) : null}
          </>
        ) : (
          <span className="hf-studio-header-title-text block min-w-0 max-w-64 truncate text-[13px] font-medium text-[var(--hf-panel-text-3)]" title={displayTitle}>
            {displayTitle}
          </span>
        )}
      </div>

      <div
        className="hf-studio-header-views absolute left-1/2 flex h-8 -translate-x-1/2 items-center gap-0.5 rounded-[9px] bg-[var(--hf-panel-input)] p-[3px]"
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

      <div className="hf-studio-header-actions flex flex-1 items-center justify-end gap-2">
        {!previewMode ? (
          <>
            {hostContext?.branding && hostContext.actions.askAi ? (
              <div className="flex items-center gap-1">
                <a href={hostContext.branding.repositoryUrl} target="_blank" rel="noreferrer" aria-label={t("header.openRepository")} className="grid h-8 w-8 place-items-center rounded-lg text-[var(--hf-panel-text-2)] transition hover:bg-[var(--hf-studio-header-hover)] hover:text-[var(--hf-panel-text-0)]">
                  <GithubLogo className="h-[17px] w-[17px]" />
                </a>
                <button type="button" onClick={() => requestHostAction("ask-ai")} className="flex h-8 items-center gap-1.5 rounded-lg bg-[var(--hf-panel-text-0)] px-3 text-xs font-semibold text-[var(--hf-panel-bg)] shadow-sm transition-[opacity,transform] hover:opacity-90 active:scale-[0.98]">
                  <Sparkle className="h-4 w-4" weight="fill" />{t("header.askAi")}
                </button>
              </div>
            ) : null}
            {hostContext?.actions.reload || hostContext?.actions.saveAsTemplate ? (
              <div className="hf-studio-header-utilities flex items-center gap-1">
                {hostContext.actions.saveAsTemplate ? (
                  <Tooltip label={t("header.saveAsTemplate")} side="bottom">
                    <button
                      type="button"
                      onClick={() => requestHostAction("save-as-template")}
                      className="hf-studio-header-action grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[var(--hf-panel-text-2)] transition-[background-color,color,transform] outline-none hover:bg-[var(--hf-studio-header-hover)] hover:text-[var(--hf-panel-text-0)] focus-visible:ring-2 focus-visible:ring-black/25 focus-visible:ring-offset-2 active:scale-[0.96]"
                      aria-label={t("header.saveAsTemplate")}
                    >
                      <FloppyDisk className="h-4 w-4" weight="regular" aria-hidden="true" />
                    </button>
                  </Tooltip>
                ) : null}
                {hostContext.actions.reload ? (
                  <Tooltip label={t("header.reloadStudio")} side="bottom">
                    <button
                      type="button"
                      onClick={() => requestHostAction("reload")}
                      className="hf-studio-header-action grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[var(--hf-panel-text-2)] transition-[background-color,color,transform] outline-none hover:bg-[var(--hf-studio-header-hover)] hover:text-[var(--hf-panel-text-0)] focus-visible:ring-2 focus-visible:ring-black/25 focus-visible:ring-offset-2 active:scale-[0.96]"
                      aria-label={t("header.reloadStudio")}
                    >
                      <RotateCw className="h-4 w-4" weight="regular" />
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
                className={`hf-studio-header-action hf-studio-properties-action flex h-8 items-center gap-1 overflow-hidden rounded-lg border px-[9px] py-px text-xs font-medium leading-normal transition-[background-color,border-color,transform] outline-none focus-visible:ring-2 focus-visible:ring-black/25 focus-visible:ring-offset-2 active:scale-[0.98] ${
                  inspectorButtonActive
                    ? "border-[var(--hf-panel-text-3)] bg-[var(--hf-studio-button-bg)] text-[var(--hf-panel-text-0)]"
                    : STUDIO_INSPECTOR_PANELS_ENABLED
                      ? "border-[var(--hf-panel-border-input)] bg-[var(--hf-studio-button-bg)] text-[var(--hf-panel-text-2)] hover:border-[var(--hf-panel-text-3)] hover:bg-[var(--hf-studio-header-hover)] hover:text-[var(--hf-panel-text-0)]"
                      : "cursor-not-allowed border-[#d9dad7] text-[#92948f]"
                }`}
                aria-label={
                  STUDIO_INSPECTOR_PANELS_ENABLED ? t("header.inspector") : STUDIO_MANUAL_EDITING_DISABLED_TITLE
                }
              >
                <SlidersHorizontal className="hf-studio-properties-icon h-4 w-4 shrink-0" weight="regular" aria-hidden="true" />
                <span className="hf-studio-header-action-label">{t("header.inspector")}</span>
              </button>
            </Tooltip>
            <Tooltip label={isRendering ? t("header.renderInProgress") : t("header.renderExport")} side="bottom">
              <button
                type="button"
                onClick={openExport}
                className="hf-studio-header-action hf-studio-header-export flex h-8 items-center gap-1 overflow-hidden rounded-lg px-2 text-xs font-medium leading-normal transition-[background-color,transform] outline-none focus-visible:ring-2 focus-visible:ring-black/25 focus-visible:ring-offset-2 active:scale-[0.98]"
                aria-label={isRendering ? t("header.rendering") : t("header.export")}
              >
                <DownloadSimple className="h-4 w-4 shrink-0" weight="regular" aria-hidden="true" />
                <span className="hf-studio-header-action-label">{isRendering ? t("header.rendering") : t("header.export")}</span>
              </button>
            </Tooltip>
          </>
        ) : null}
      </div>
    </header>
  );
}
