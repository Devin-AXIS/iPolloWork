/** @jsxImportSource react */
import * as React from "react";
import { AudioLines, Film, Loader2, Maximize2, Minimize2, Plus, RefreshCw, X } from "lucide-react";

import type { iPolloWorkServerClient } from "@/app/lib/ipollowork-server";
import { getResolvedThemeMode, subscribeToTheme } from "@/app/theme";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { currentLocale, localeChangedEvent } from "@/i18n";
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
  onClose: () => void;
};

type StudioStartupStage = "starting-service" | "waiting-for-studio" | "loading-frame";

const studioStartupCopy: Record<StudioStartupStage, { title: string; detail: string }> = {
  "starting-service": {
    title: "Starting the local HyperFrames service...",
    detail: "Launching the project server for this video task.",
  },
  "waiting-for-studio": {
    title: "Waiting for HyperFrames Studio...",
    detail: "The service is starting. This can take a moment on the first launch.",
  },
  "loading-frame": {
    title: "Preparing the Video Studio...",
    detail: "Loading the Studio interface and applying iPolloWork settings.",
  },
};

export function VideoPanel({ sessionId, workspaceRoot, client, workspaceId, isRemoteWorkspace = false, launcherItems = [], onClose }: VideoPanelProps) {
  const terminalIdRef = React.useRef<string | null>(null);
  const videoPanelRef = React.useRef<HTMLDivElement | null>(null);
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
  const [isFullscreen, setIsFullscreen] = React.useState(false);
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
    setDetail(`Starting ${HYPERFRAMES_STUDIO_LABEL}...`);
    setStudioFrameLoaded(false);
    setStudioChromeReady(false);
    setActiveStudioPort(studioPort);
    if (isRemoteWorkspace) {
      setStatus("failed");
      setDetail("Video Studio is available for local workspaces.");
      return;
    }
    if (!workspaceRoot.trim()) {
      setStatus("starting");
      setDetail(`Preparing ${HYPERFRAMES_STUDIO_LABEL} workspace...`);
      return;
    }
    const bridge = window.__IPOLLOWORK_ELECTRON__?.hyperframes;
    if (!bridge?.start || !bridge.stop) {
      setStatus("failed");
      setDetail("HyperFrames requires the iPolloWork desktop app.");
      return;
    }
    const startHyperframes = bridge.start;
    const stopHyperframes = bridge.stop;

    let disposed = false;
    const waitingTimer = window.setTimeout(() => {
      if (!disposed) {
        setStartupStage("waiting-for-studio");
        setDetail(`Waiting for ${HYPERFRAMES_STUDIO_LABEL} to answer on port ${studioPort}...`);
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
      if (!result?.ok) throw new Error("Could not start HyperFrames.");
      if (typeof result.port === "number" && Number.isInteger(result.port) && result.port > 0) {
        setActiveStudioPort(result.port);
      }
      setStatus("ready");
      setStartupStage("loading-frame");
      setDetail(`Studio ready on port ${result.port ?? studioPort}`);
      setStudioFrameLoaded(false);
      setRevision((value) => value + 1);
    }).catch((cause) => {
      if (disposed) return;
      window.clearTimeout(waitingTimer);
      setStatus("failed");
      setDetail(cause instanceof Error ? cause.message : "Could not start HyperFrames.");
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

  React.useEffect(() => {
    const syncFullscreenState = () => {
      setIsFullscreen(document.fullscreenElement === videoPanelRef.current);
    };
    document.addEventListener("fullscreenchange", syncFullscreenState);
    syncFullscreenState();
    return () => document.removeEventListener("fullscreenchange", syncFullscreenState);
  }, []);

  const toggleFullscreen = React.useCallback(() => {
    if (document.fullscreenElement === videoPanelRef.current) {
      void document.exitFullscreen();
      return;
    }
    void videoPanelRef.current?.requestFullscreen();
  }, []);

  return (
    <div ref={videoPanelRef} className="flex h-full min-h-0 flex-col bg-background" data-testid="video-panel">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-[#EAEAEA] px-3 [border-bottom-width:0.5px]">
        <Film className="size-4 text-primary" />
        <div className="flex min-w-0 flex-1 items-center">
          <p className="truncate text-sm font-medium">Video Studio</p>
          <span className="ml-2 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {status === "failed" ? "Failed" : status === "ready" && studioChromeReady ? "Ready" : startupStage === "waiting-for-studio" ? "Waiting" : "Starting"}
          </span>
        </div>
        <Tooltip>
          <TooltipTrigger render={<Button variant={voicePanelOpen ? "secondary" : "ghost"} size="icon-xs" onClick={() => setVoicePanelOpen((open) => !open)} disabled={isRemoteWorkspace} aria-label="Voice settings"><AudioLines /></Button>} />
          <TooltipContent>Voice settings</TooltipContent>
        </Tooltip>
        <Button variant="ghost" size="icon-xs" onClick={() => { setStudioFrameLoaded(false); setStudioChromeReady(false); setStartupStage("loading-frame"); setDetail("Reloading Studio..."); setReloadToken(Date.now()); setRevision((value) => value + 1); }} aria-label="Reload Video Studio"><RefreshCw /></Button>
        <Tooltip>
          <TooltipTrigger
            render={(
              <Button
                variant={isFullscreen ? "secondary" : "ghost"}
                size="icon-xs"
                onClick={toggleFullscreen}
                aria-label="Toggle Video Studio fullscreen"
                aria-pressed={isFullscreen}
              >
                {isFullscreen ? <Minimize2 /> : <Maximize2 />}
              </Button>
            )}
          />
          <TooltipContent>{isFullscreen ? "Exit fullscreen" : "Fullscreen Video Studio"}</TooltipContent>
        </Tooltip>
        {launcherItems.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={(
                <Button variant="ghost" size="icon-xs" aria-label="Add panel">
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
        <Button variant="ghost" size="icon-xs" onClick={onClose} aria-label="Close Video Studio" title="Close Video Studio"><X /></Button>
      </header>

      {isRemoteWorkspace ? (
        <div className="grid flex-1 place-items-center p-8 text-center text-sm text-muted-foreground">Video Studio is available for local workspaces only.</div>
      ) : (
        <div className="relative min-h-0 flex-1 bg-[#0c0c0d]">
          {status === "starting" || (status === "ready" && !studioChromeReady) ? (
            <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-background/80 backdrop-blur-sm" aria-live="polite">
              <div className="text-center">
                <Loader2 className="mx-auto mb-2 size-5 animate-spin text-primary" />
                <p className="text-xs font-medium text-foreground">{studioStartupCopy[startupStage].title}</p>
                <p className="mt-1 max-w-[32rem] text-[11px] text-muted-foreground">{detail || studioStartupCopy[startupStage].detail}</p>
              </div>
            </div>
          ) : null}
          {status === "failed" ? <div className="absolute inset-0 z-20 grid place-items-center bg-background p-6"><div className="max-w-md text-center"><p className="text-sm font-medium">HyperFrames Studio failed to start</p><p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">{detail}</p><Button className="mt-4" variant="secondary" size="sm" onClick={() => { setStatus("starting"); setStartupStage("starting-service"); setDetail(`Starting ${HYPERFRAMES_STUDIO_LABEL}...`); setStudioFrameLoaded(false); setStudioChromeReady(false); setStartAttempt((value) => value + 1); }}>Retry</Button></div></div> : null}
          {status === "ready" ? <iframe ref={studioFrameRef} key={`${sessionId}:${revision}`} src={studioUrl} title="HyperFrames Video Studio" allow="fullscreen" allowFullScreen className={`h-full w-full border-0 transition-opacity duration-150 ${studioChromeReady ? "opacity-100" : "opacity-0"}`} data-loaded={studioFrameLoaded ? "true" : "false"} onLoad={() => {
            setStudioFrameLoaded(true);
            setStudioChromeReady(true);
            scheduleStudioLocaleSync();
            syncStudioTheme();
          }} onError={() => {
            setStatus("failed");
            setDetail(`Could not load ${studioUrl}`);
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
