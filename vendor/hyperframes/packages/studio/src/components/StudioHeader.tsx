import { useEffect, useState } from "react";
import { Button } from "@ipollowork/ui/controls";
import { Tabs, TabsList, TabsTrigger } from "@ipollowork/ui/tabs";
import {
  Download,
  Github,
  LayoutGrid,
  RefreshCw,
  Save,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import {
  STUDIO_INSPECTOR_PANELS_ENABLED,
  STUDIO_MANUAL_EDITING_DISABLED_TITLE,
} from "./editor/manualEditingAvailability";
import { useStudioShellContext } from "../contexts/StudioContext";
import { usePanelLayoutContext } from "../contexts/PanelLayoutContext";
import { trackStudioEvent } from "../utils/studioTelemetry";
import { Tooltip } from "./ui";
import { useStudioI18n } from "../i18n";
import { useViewMode } from "../contexts/ViewModeContext";
import { Dock } from "./dock/Dock";

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
  const { renderQueue, projectId } = useStudioShellContext();
  const { rightCollapsed, setRightCollapsed, setRightPanelTab } = usePanelLayoutContext();
  const { t } = useStudioI18n();
  const { viewMode, setViewMode } = useViewMode();
  const scriptMode = viewMode === "storyboard";
  const isRendering = renderQueue.isRendering;
  const [hostContext, setHostContext] = useState<StudioHostContext | null>(null);

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
    if (window.parent !== window) {
      window.parent.postMessage({ type: "ipollowork:studio-host-context-request", projectId }, "*");
    }
    return () => window.removeEventListener("message", handleHostContext);
  }, [projectId]);

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
      if (!inspectorPanelActive) setRightPanelTab("design");
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
    if (!setViewMode("timeline")) return;
    if (nextPreviewMode && window.parent !== window) {
      window.parent.postMessage(
        { type: "ipollowork:video-studio-panel", projectId, panel: null },
        "*",
      );
    }
    onPreviewModeChange(nextPreviewMode);
  };

  return (
    <header className="hf-studio-header relative flex h-10 flex-shrink-0 items-center gap-2 border-b border-[var(--hf-panel-hairline)] bg-[var(--hf-studio-header-bg)] px-2 text-[var(--hf-panel-text-1)] backdrop-blur-sm">
      {!previewMode && !scriptMode && <Dock.WindowMenu label="Control tools" visibilityOnly />}
      <Tabs value={scriptMode ? "storyboard" : previewMode ? "preview" : "edit"} onValueChange={value => {
        if (value === "storyboard") {
          if (!setViewMode("storyboard")) return;
          onPreviewModeChange(false);
          if (window.parent !== window) window.parent.postMessage({ type: "ipollowork:video-studio-panel", projectId, panel: null }, "*");
        } else if (value === "edit" || value === "preview") setPreviewMode(value === "preview");
      }}>
        <TabsList className="hf-studio-header-views shrink-0" aria-label={t("header.viewLabel")}>
          <TabsTrigger value="storyboard">{t("header.storyboard")}</TabsTrigger>
          <TabsTrigger value="edit">{t("header.edit")}</TabsTrigger>
          <TabsTrigger value="preview">{t("header.preview")}</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="hf-studio-header-actions ml-auto flex min-w-0 items-center">
        {!previewMode && !scriptMode ? (
          <>
            {hostContext?.branding && hostContext.actions.askAi ? (
              <div className="flex items-center gap-1">
                <Tooltip label={t("header.openRepository")} side="bottom">
                <a href={hostContext.branding.repositoryUrl} target="_blank" rel="noreferrer" aria-label={t("header.openRepository")} className="hf-studio-header-action">
                  <Github className="h-[17px] w-[17px]" strokeWidth={1.75} aria-hidden="true" />
                  <span className="hf-studio-header-action-label">{t("header.openRepository")}</span>
                </a>
                </Tooltip>
                <Tooltip label={t("header.askAi")} side="bottom">
                <Button variant="ghost" type="button" aria-label={t("header.askAi")} onClick={() => requestHostAction("ask-ai")} className="hf-studio-header-action">
                  <Sparkles className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" /><span className="hf-studio-header-action-label">{t("header.askAi")}</span>
                </Button>
                </Tooltip>
              </div>
            ) : null}
            {hostContext?.actions.openTemplates ? (
              <Tooltip label={t("header.templates")} side="bottom">
                <Button variant="ghost" type="button" aria-label={t("header.templates")} onClick={() => requestHostAction("open-templates")} className="hf-studio-header-action">
                  <LayoutGrid className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" /><span className="hf-studio-header-action-label">{t("header.templates")}</span>
                </Button>
              </Tooltip>
            ) : null}
            {hostContext?.actions.reload || hostContext?.actions.saveAsTemplate ? (
              <>
                <div className="hf-studio-header-utilities flex items-center gap-1">
                  {hostContext.actions.saveAsTemplate ? (
                    <Tooltip label={t("header.saveAsTemplate")} side="bottom">
                      <Button variant="ghost"
                        type="button"
                        onClick={() => requestHostAction("save-as-template")}
                        className="hf-studio-header-action"
                        aria-label={t("header.saveAsTemplate")}
                      >
                        <Save className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                        <span className="hf-studio-header-action-label">{t("header.saveAsTemplate")}</span>
                      </Button>
                    </Tooltip>
                  ) : null}
                  {hostContext.actions.reload ? (
                    <Tooltip label={t("header.reloadStudio")} side="bottom">
                      <Button variant="ghost"
                        type="button"
                        onClick={() => requestHostAction("reload")}
                        className="hf-studio-header-action"
                        aria-label={t("header.reloadStudio")}
                      >
                        <RefreshCw className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                        <span className="hf-studio-header-action-label">{t("header.reloadStudio")}</span>
                      </Button>
                    </Tooltip>
                  ) : null}
                </div>
                <span className="hf-studio-header-actions-divider" aria-hidden="true" />
              </>
            ) : null}
            <Tooltip label={STUDIO_INSPECTOR_PANELS_ENABLED ? t("header.inspector") : STUDIO_MANUAL_EDITING_DISABLED_TITLE} side="bottom">
            <Button variant="ghost"
              type="button"
              onClick={toggleProperties}
              disabled={!STUDIO_INSPECTOR_PANELS_ENABLED}
              aria-pressed={inspectorButtonActive}
              className="hf-studio-header-action hf-studio-properties-action"

              aria-label={
                STUDIO_INSPECTOR_PANELS_ENABLED ? t("header.inspector") : STUDIO_MANUAL_EDITING_DISABLED_TITLE
              }
            >
              <SlidersHorizontal className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
              <span className="hf-studio-header-action-label">{t("header.inspector")}</span>
            </Button>
            </Tooltip>
            <Tooltip label={isRendering ? t("header.rendering") : t("header.export")} side="bottom">
            <Button
              type="button"
              onClick={openExport}
              className="hf-studio-header-action hf-studio-header-export"
              aria-label={isRendering ? t("header.rendering") : t("header.export")}
            >
              <Download className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
              <span className="hf-studio-header-action-label">{isRendering ? t("header.rendering") : t("header.export")}</span>
            </Button>
            </Tooltip>
          </>
        ) : null}
      </div>
    </header>
  );
}
