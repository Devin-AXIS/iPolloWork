/** @jsxImportSource react */
import * as React from "react";
import { AudioLines, Film, Loader2, Maximize2, Minimize2, Plus, RefreshCw, X } from "lucide-react";

import type { iPolloWorkServerClient } from "@/app/lib/ipollowork-server";
import { getResolvedThemeMode, subscribeToTheme } from "@/app/theme";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { currentLocale, localeChangedEvent, t } from "@/i18n";
import type { SidePanelLauncherItem } from "../panel/side-panel";
import {
  HYPERFRAMES_STUDIO_LABEL,
  hyperframesStudioPort,
  hyperframesStudioUrl,
  videoProjectDirectory,
  videoProjectId,
} from "./video-project";
import { VideoVoicePanel } from "./video-voice-panel";

export {
  hyperframesStudioPort,
  hyperframesStudioUrl,
  videoProjectDirectory,
  videoProjectId,
} from "./video-project";

type VideoPanelProps = {
  sessionId: string;
  workspaceRoot: string;
  client: iPolloWorkServerClient | null;
  workspaceId: string | null;
  isRemoteWorkspace?: boolean;
  launcherItems?: SidePanelLauncherItem[];
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  onClose: () => void;
};

type StudioStartupStage = "starting-service" | "waiting-for-studio" | "loading-frame";

const studioStartupTitleKey: Record<StudioStartupStage, string> = {
  "starting-service": "video.startup.starting_service_title",
  "waiting-for-studio": "video.startup.waiting_for_studio_title",
  "loading-frame": "video.startup.loading_frame_title",
};

const studioStartupDetailKey: Record<StudioStartupStage, string> = {
  "starting-service": "video.startup.starting_service_detail",
  "waiting-for-studio": "video.startup.waiting_for_studio_detail",
  "loading-frame": "video.startup.loading_frame_detail",
};

export function VideoPanel({ sessionId, workspaceRoot, client, workspaceId, isRemoteWorkspace = false, launcherItems = [], expanded = false, onExpandedChange, onClose }: VideoPanelProps) {
  const terminalIdRef = React.useRef<string | null>(null);
  const studioFrameRef = React.useRef<HTMLIFrameElement | null>(null);
  const localeSyncTimersRef = React.useRef<number[]>([]);
  const [revision, setRevision] = React.useState(0);
  const [reloadToken, setReloadToken] = React.useState(0);
  const [startAttempt, setStartAttempt] = React.useState(0);
  const [status, setStatus] = React.useState<"starting" | "ready" | "failed">("starting");
  const [startupStage, setStartupStage] = React.useState<StudioStartupStage>("starting-service");
  const [detail, setDetail] = React.useState(`Starting ${HYPERFRAMES_STUDIO_LABEL}...`);
  const [studioFrameLoaded, setStudioFrameLoaded] = React.useState(false);
  const [studioChromeReady, setStudioChromeReady] = React.useState(false);
  const [voicePanelOpen, setVoicePanelOpen] = React.useState(false);
  const studioPort = hyperframesStudioPort(sessionId);
  const [activeStudioPort, setActiveStudioPort] = React.useState(studioPort);
  const resolvedTheme = React.useSyncExternalStore(
    subscribeToTheme,
    getResolvedThemeMode,
    getResolvedThemeMode,
  );
  const initialStudioThemeRef = React.useRef(resolvedTheme);
  const studioUrl = hyperframesStudioUrl(
    activeStudioPort,
    videoProjectId(sessionId),
    currentLocale(),
    initialStudioThemeRef.current,
    reloadToken,
  );
  const projectDirectory = videoProjectDirectory(sessionId);

  const syncStudioLocale = React.useCallback(() => {
    const frameWindow = studioFrameRef.current?.contentWindow;
    if (!frameWindow) return;
    const targetOrigin = new URL(studioUrl).origin;
    frameWindow.postMessage(
      { type: "ipollowork:studio-locale", locale: currentLocale() },
      targetOrigin,
    );
  }, [studioUrl]);

  const syncStudioTheme = React.useCallback(() => {
    const frameWindow = studioFrameRef.current?.contentWindow;
    if (!frameWindow) return;
    frameWindow.postMessage(
      { type: "ipollowork:studio-theme", theme: getResolvedThemeMode() },
      new URL(studioUrl).origin,
    );
  }, [studioUrl]);

  const clearLocaleSyncTimers = React.useCallback(() => {
    for (const timer of localeSyncTimersRef.current) window.clearTimeout(timer);
    localeSyncTimersRef.current = [];
  }, []);

  const scheduleStudioLocaleSync = React.useCallback(() => {
    clearLocaleSyncTimers();
    syncStudioLocale();
    localeSyncTimersRef.current = [50, 250, 750].map((delay) => window.setTimeout(syncStudioLocale, delay));
  }, [clearLocaleSyncTimers, syncStudioLocale]);

  React.useEffect(() => {
    setStatus("starting");
    setStartupStage("starting-service");
    setDetail(t("video.starting_hyperframes", { version: HYPERFRAMES_STUDIO_LABEL }));
    setStudioFrameLoaded(false);
    setStudioChromeReady(false);
    setActiveStudioPort(studioPort);
    if (isRemoteWorkspace) {
      setStatus("failed");
      setDetail(t("video.local_workspaces"));
      return;
    }
    if (!workspaceRoot.trim()) {
      setStatus("starting");
      setDetail(t("video.starting_workspace"));
      return;
    }
    const bridge = window.__IPOLLOWORK_ELECTRON__?.hyperframes;
    if (!bridge?.start || !bridge.stop) {
      setStatus("failed");
      setDetail(t("video.requires_desktop"));
      return;
    }
    const startHyperframes = bridge.start;
    const stopHyperframes = bridge.stop;

    let disposed = false;
    const waitingTimer = window.setTimeout(() => {
      if (!disposed) {
        setStartupStage("waiting-for-studio");
        setDetail(t("video.waiting_on_port", { port: studioPort }));
      }
    }, 900);
    void startHyperframes({
      workspaceRoot,
      sessionId,
      projectDirectory,
      port: studioPort,
    }).then((result) => {
      if (disposed) return;
      window.clearTimeout(waitingTimer);
      if (!result?.ok) throw new Error(t("video.could_not_start"));
      if (typeof result.port === "number" && Number.isInteger(result.port) && result.port > 0) {
        setActiveStudioPort(result.port);
      }
      setStatus("ready");
      setStartupStage("loading-frame");
      setDetail(t("video.ready_on_port", { port: result.port ?? studioPort }));
      setStudioFrameLoaded(false);
      setRevision((value) => value + 1);
    }).catch((cause) => {
      if (disposed) return;
      window.clearTimeout(waitingTimer);
      setStatus("failed");
      setDetail(cause instanceof Error ? cause.message : t("video.could_not_start"));
    });

    return () => {
      disposed = true;
      window.clearTimeout(waitingTimer);
      void stopHyperframes(sessionId);
    };
  }, [isRemoteWorkspace, projectDirectory, sessionId, startAttempt, studioPort, workspaceRoot]);

  React.useEffect(() => {
    window.addEventListener(localeChangedEvent, scheduleStudioLocaleSync);
    scheduleStudioLocaleSync();
    return () => {
      window.removeEventListener(localeChangedEvent, scheduleStudioLocaleSync);
      clearLocaleSyncTimers();
    };
  }, [clearLocaleSyncTimers, scheduleStudioLocaleSync]);

  React.useEffect(() => {
    syncStudioTheme();
  }, [resolvedTheme, syncStudioTheme]);

  const toggleFullscreen = React.useCallback(() => {
    onExpandedChange?.(!expanded);
  }, [expanded, onExpandedChange]);

  React.useEffect(() => {
    if (!expanded) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onExpandedChange?.(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [expanded, onExpandedChange]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-testid="video-panel" data-expanded={expanded ? "true" : "false"}>
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-[#EAEAEA] px-3 [border-bottom-width:0.5px]">
        <Film className="size-4 text-primary" />
        <div className="flex min-w-0 flex-1 items-center">
          <p className="truncate text-sm font-medium">{t("video.title")}</p>
          <span className="ml-2 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {status === "failed" ? t("video.status_failed") : status === "ready" && studioChromeReady ? t("video.status_ready") : startupStage === "waiting-for-studio" ? t("video.status_waiting") : t("video.status_starting")}
          </span>
        </div>
        <Tooltip>
          <TooltipTrigger render={<Button variant={voicePanelOpen ? "secondary" : "ghost"} size="icon-xs" onClick={() => setVoicePanelOpen((open) => !open)} disabled={isRemoteWorkspace} aria-label={t("video.voice_settings")}><AudioLines /></Button>} />
          <TooltipContent>{t("video.voice_settings")}</TooltipContent>
        </Tooltip>
        <Button variant="ghost" size="icon-xs" onClick={() => { setStudioFrameLoaded(false); setStudioChromeReady(false); setStartupStage("loading-frame"); setDetail(t("video.reloading")); setReloadToken(Date.now()); setRevision((value) => value + 1); }} aria-label={t("video.reload")}><RefreshCw /></Button>
        <Tooltip>
          <TooltipTrigger
            render={(
              <Button
                variant={expanded ? "secondary" : "ghost"}
                size="icon-xs"
                onClick={toggleFullscreen}
                aria-label={t("video.toggle_fullscreen")}
                aria-pressed={expanded}
              >
                {expanded ? <Minimize2 /> : <Maximize2 />}
              </Button>
            )}
          />
          <TooltipContent>{expanded ? t("video.exit_fullscreen") : t("video.fullscreen")}</TooltipContent>
        </Tooltip>
        {launcherItems.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={(
                <Button variant="ghost" size="icon-xs" aria-label={t("session.right_panel_add")}>
                  <Plus />
                </Button>
              )}
            />
            <DropdownMenuContent
              align="end"
              className="w-[296px] rounded-[18px] border border-[#E5E5E5] bg-white p-3 text-[#242424] shadow-[0_8px_24px_rgba(0,0,0,0.10)] before:hidden"
            >
              {launcherItems.map((item) => (
                <DropdownMenuItem
                  key={item.id}
                  disabled={item.disabled}
                  onClick={item.onClick}
                  className={cn(
                    "h-9 rounded-xl px-2 text-[14px] font-normal tracking-[-0.56px] text-[#242424] focus:bg-[#F5F5F5] focus:text-[#242424] data-disabled:opacity-40",
                    item.active && "bg-[#F5F5F5]",
                  )}
                >
                  <img src={item.iconSrc} alt="" className="size-4 shrink-0" />
                  <span className="flex-1">{item.label}</span>
                  {item.shortcut ? (
                    <span className="text-[12px] tracking-[-0.24px] text-[#8A8A8A]">{item.shortcut}</span>
                  ) : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        <Button variant="ghost" size="icon-xs" onClick={() => { onExpandedChange?.(false); onClose(); }} aria-label={t("video.close")} title={t("video.close")}><X /></Button>
      </header>

      {isRemoteWorkspace ? (
        <div className="grid flex-1 place-items-center p-8 text-center text-sm text-muted-foreground">{t("video.local_only")}</div>
      ) : (
        <div className="relative min-h-0 flex-1 bg-[#0c0c0d]">
          {status === "starting" || (status === "ready" && !studioChromeReady) ? (
            <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-background/80 backdrop-blur-sm" aria-live="polite">
              <div className="text-center">
                <Loader2 className="mx-auto mb-2 size-5 animate-spin text-primary" />
                <p className="text-xs font-medium text-foreground">{t(studioStartupTitleKey[startupStage])}</p>
                <p className="mt-1 max-w-[32rem] text-[11px] text-muted-foreground">{detail || t(studioStartupDetailKey[startupStage])}</p>
              </div>
            </div>
          ) : null}
          {status === "failed" ? <div className="absolute inset-0 z-20 grid place-items-center bg-background p-6"><div className="max-w-md text-center"><p className="text-sm font-medium">{t("video.failed_to_start")}</p><p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">{detail}</p><Button className="mt-4" variant="secondary" size="sm" onClick={() => { setStatus("starting"); setStartupStage("starting-service"); setDetail(t("video.starting_hyperframes", { version: HYPERFRAMES_STUDIO_LABEL })); setStudioFrameLoaded(false); setStudioChromeReady(false); setStartAttempt((value) => value + 1); }}>{t("common.retry")}</Button></div></div> : null}
          {status === "ready" ? <iframe ref={studioFrameRef} key={`${sessionId}:${revision}`} src={studioUrl} title={t("video.iframe_title")} allow="fullscreen" allowFullScreen className={`h-full w-full border-0 transition-opacity duration-150 ${studioChromeReady ? "opacity-100" : "opacity-0"}`} data-loaded={studioFrameLoaded ? "true" : "false"} onLoad={() => {
            setStudioFrameLoaded(true);
            setStudioChromeReady(true);
            scheduleStudioLocaleSync();
            syncStudioTheme();
          }} onError={() => {
            setStatus("failed");
            setDetail(t("video.could_not_load", { url: studioUrl }));
          }} /> : null}
          {voicePanelOpen ? <VideoVoicePanel
            sessionId={sessionId}
            workspaceRoot={workspaceRoot}
            client={client}
            workspaceId={workspaceId}
            previewRequest={0}
            onClose={() => setVoicePanelOpen(false)}
          /> : null}
        </div>
      )}
    </div>
  );
}
