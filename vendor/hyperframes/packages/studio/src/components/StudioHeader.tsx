import { useEffect, useRef, useState } from "react";
import { useFileManagerContext } from "../contexts/FileManagerContext";
import { replaceVideoDocumentTitle } from "../utils/studioHelpers";
import { Button, Input } from "@ipollowork/ui/controls";
import { Alert, AlertDescription } from "@ipollowork/ui/alert";
import {
  Download,
  AlertTriangle,
  RefreshCw,
  Pencil,
  Sparkles,
} from "lucide-react";
import { useStudioShellContext } from "../contexts/StudioContext";
import { usePanelLayoutContext } from "../contexts/PanelLayoutContext";
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
    openEnhancement: boolean;
    saveAsTemplate: boolean;
    openTemplates: boolean;
    askAi: boolean;
  };
};

export function StudioHeader({
  onPreviewModeChange,
}: StudioHeaderProps) {
  const { renderQueue, projectId } = useStudioShellContext();
  const { setRightCollapsed, setRightPanelTab } = usePanelLayoutContext();
  const { t, tx } = useStudioI18n();
  const { setViewMode } = useViewMode();
  const { readProjectFile, writeProjectFile } = useFileManagerContext();
  const [videoTitle, setVideoTitle] = useState("");
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [titleSaving, setTitleSaving] = useState(false);
  const [titleError, setTitleError] = useState("");
  const renameButtonRef = useRef<HTMLButtonElement>(null);
  const closeTitleEditor = () => {
    setTitleDraft(null); setTitleError("");
    requestAnimationFrame(() => renameButtonRef.current?.focus());
  };
  const publishTitle = (title: string) => {
    if (window.parent !== window) window.parent.postMessage({ type: "ipollowork:studio-video-title", projectId, title }, "*");
  };
  useEffect(() => {
    let cancelled = false;
    setVideoTitle(""); setTitleDraft(null); setTitleError("");
    void readProjectFile("index.html").then(source => {
      if (cancelled) return;
      const title = new DOMParser().parseFromString(source, "text/html").title.trim();
      if (title) { setVideoTitle(title); publishTitle(title); }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [projectId, readProjectFile]);
  const saveTitle = async () => {
    const title = titleDraft?.trim();
    if (!title || titleSaving) return;
    setTitleSaving(true); setTitleError("");
    try {
      const source = await readProjectFile("index.html");
      await writeProjectFile("index.html", replaceVideoDocumentTitle(source, title), source);
      setVideoTitle(title); publishTitle(title); closeTitleEditor();
    } catch (error) { setTitleError(error instanceof Error ? error.message : tx("Could not save video name.")); }
    finally { setTitleSaving(false); }
  };
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
          openEnhancement: event.data.actions?.openEnhancement === true,
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

  const requestHostAction = (action: "reload" | "save-as-template" | "open-templates" | "ask-ai" | "open-enhancement") => {
    if (window.parent === window) return;
    window.parent.postMessage(
      { type: "ipollowork:studio-host-action", projectId, action },
      "*",
    );
  };

  const openExport = () => {
    onPreviewModeChange(false);
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
    <header className="hf-studio-header relative flex min-h-11 flex-shrink-0 items-center gap-2 border-b border-[var(--hf-panel-hairline)] bg-[var(--hf-studio-header-bg)] px-2 text-[var(--hf-panel-text-1)] backdrop-blur-sm">
      <Dock.WindowMenu label="Panels" visibilityOnly />
      <div className="flex min-w-0 items-center gap-1">
        {titleDraft === null ? <>
          <span className="truncate text-ui-section-title" data-testid="studio-video-title">{videoTitle || hostContext?.title || tx("Untitled video")}</span>
          <Button variant="ghost" size="icon" ref={renameButtonRef} aria-label={tx("Rename video")} data-testid="studio-rename-video" onClick={() => { setTitleDraft(videoTitle || hostContext?.title || ""); setTitleError(""); }}><Pencil className="size-4" /></Button>
        </> : <>
          <Input autoFocus maxLength={120} aria-label={tx("Video name")} value={titleDraft} disabled={titleSaving} className="w-64 max-w-full" onChange={e => setTitleDraft(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void saveTitle(); } if (e.key === "Escape" && !titleSaving) { e.preventDefault(); closeTitleEditor(); } }} />
          <Button variant="default" disabled={!titleDraft.trim() || titleSaving} onClick={() => void saveTitle()}>{tx("Save")}</Button>
          <Button variant="ghost" disabled={titleSaving} onClick={closeTitleEditor}>{tx("Cancel")}</Button>
        </>}
      </div>
      {titleError && <span role="alert" className="text-ui-meta text-destructive">{titleError}</span>}
      <div className="hf-studio-header-actions ml-auto flex min-w-0 items-center">
        <>
            {hostContext?.actions.openEnhancement ? (
              <Tooltip label={t("header.enhancement")} side="bottom">
                <Button variant="ghost" type="button" aria-label={t("header.enhancement")} onClick={() => requestHostAction("open-enhancement")} className="hf-studio-header-action" data-testid="studio-enhancement-open">
                  <Sparkles className="h-4 w-4" aria-hidden="true" /><span className="hf-studio-header-action-label">{t("header.enhancement")}</span>
                </Button>
              </Tooltip>
            ) : null}
            {hostContext?.actions.reload && <Tooltip label={t("header.reloadStudio")}><Button variant="ghost" aria-label={t("header.reloadStudio")} data-testid="studio-reload" onClick={() => requestHostAction("reload")}><RefreshCw className="size-4" />{tx("Reload")}</Button></Tooltip>}
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
      </div>
    </header>
  );
}

/** Keep the migration failure visible; expanding details never retries or deletes history. */
export function HistoryMigrationNotice({ message }: { message: string }) {
  const { t } = useStudioI18n();
  const [detailsOpen, setDetailsOpen] = useState(false);
  return <Alert variant="warning" className="hf-history-notice rounded-none" data-testid="studio-history-notice">
    <AlertTriangle aria-hidden="true" />
    <AlertDescription>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="mr-auto">{t("history.migrationSummary")}</span>
        <Button variant="ghost" size="sm" aria-expanded={detailsOpen} onClick={() => setDetailsOpen(value => !value)}>{detailsOpen ? t("history.hideDetails") : t("history.showDetails")}</Button>
      </div>
      {detailsOpen ? <p className="mt-2 break-words whitespace-pre-wrap">{message}</p> : null}
    </AlertDescription>
  </Alert>;
}
