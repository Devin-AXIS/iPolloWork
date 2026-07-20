/** @jsxImportSource react */
import * as React from "react";
import { AudioLines, Film, Layers3, Loader2, Play, RefreshCw, X } from "lucide-react";

import type { iPolloWorkServerClient } from "@/app/lib/ipollowork-server";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { t } from "@/i18n";
import {
  HYPERFRAMES_VERSION,
  hyperframesStudioPort,
  hyperframesStudioUrl,
  videoProjectDirectory,
  videoProjectId,
} from "./video-project";
import { VideoVoicePanel } from "./video-voice-panel";

export {
  hyperframesPreviewCommand,
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
  onClose: () => void;
};

export function VideoPanel({ sessionId, workspaceRoot, client, workspaceId, isRemoteWorkspace = false, onClose }: VideoPanelProps) {
  const terminalIdRef = React.useRef<string | null>(null);
  const [revision, setRevision] = React.useState(0);
  const [status, setStatus] = React.useState<"starting" | "ready" | "failed">("starting");
  const [detail, setDetail] = React.useState(() => t("video.starting_hyperframes", { version: HYPERFRAMES_VERSION }));
  const [studioFrameLoaded, setStudioFrameLoaded] = React.useState(false);
  const [studioChromeReady, setStudioChromeReady] = React.useState(false);
  const [simpleMode, setSimpleMode] = React.useState(true);
  const [voicePanelOpen, setVoicePanelOpen] = React.useState(false);
  const [voicePreviewRequest, setVoicePreviewRequest] = React.useState(0);
  const studioPort = hyperframesStudioPort(sessionId);
  const studioUrl = hyperframesStudioUrl(studioPort, videoProjectId(sessionId));
  const projectDirectory = videoProjectDirectory(sessionId);

  const applySimpleMode = React.useCallback(async (enabled: boolean) => {
    try {
      const result = await window.__IPOLLOWORK_ELECTRON__?.hyperframes?.setSimpleMode?.(enabled);
      if (result?.ok) setSimpleMode(enabled);
      return Boolean(result?.ok && result.chromeClean);
    } catch {
      return false;
    }
  }, []);

  React.useEffect(() => {
    if (status !== "ready" || !studioFrameLoaded) return;
    // HyperFrames replaces its preview iframe when the playhead crosses into a
    // different composition. Re-apply the selected mode so the iPolloWork
    // chrome cleanup survives those native iframe navigations in both Simple
    // and Advanced modes.
    const interval = window.setInterval(() => void applySimpleMode(simpleMode), 1_000);
    return () => window.clearInterval(interval);
  }, [applySimpleMode, simpleMode, status, studioFrameLoaded]);

  React.useEffect(() => {
    setStatus("starting");
    setDetail(t("video.starting_hyperframes", { version: HYPERFRAMES_VERSION }));
    setStudioFrameLoaded(false);
    setStudioChromeReady(false);
    if (isRemoteWorkspace) {
      setStatus("failed");
      setDetail(t("video.local_workspaces"));
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
    void startHyperframes({
      workspaceRoot,
      sessionId,
      projectDirectory,
      port: studioPort,
    }).then((result) => {
      if (disposed) return;
      if (!result?.ok) throw new Error(t("video.could_not_start"));
      setStatus("ready");
      setDetail(t("video.studio_ready"));
      setStudioFrameLoaded(false);
      setRevision((value) => value + 1);
    }).catch((cause) => {
      if (disposed) return;
      setStatus("failed");
      setDetail(cause instanceof Error ? cause.message : t("video.could_not_start"));
    });

    return () => {
      disposed = true;
      void stopHyperframes(sessionId);
    };
  }, [isRemoteWorkspace, projectDirectory, sessionId, studioPort, workspaceRoot]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-testid="video-panel">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-[#EAEAEA] px-3 [border-bottom-width:0.5px]">
        <Film className="size-4 text-primary" />
        <div className="flex min-w-0 flex-1 items-center">
          <p className="truncate text-sm font-medium">{t("video.title")}</p>
        </div>
        <Tooltip>
          <TooltipTrigger render={<Button variant={voicePanelOpen ? "secondary" : "ghost"} size="icon-xs" onClick={() => setVoicePanelOpen((open) => !open)} disabled={isRemoteWorkspace} aria-label={t("video.voice_settings")}><AudioLines /></Button>} />
          <TooltipContent>{t("video.voice_settings")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="xs" onClick={() => { setVoicePanelOpen(true); setVoicePreviewRequest((value) => value + 1); }} disabled={isRemoteWorkspace} aria-label={t("video.preview_voice")}><Play />{t("video.preview")}</Button>} />
          <TooltipContent>{t("video.preview_voice")}</TooltipContent>
        </Tooltip>
        <Button variant="ghost" size="icon-xs" onClick={() => { setStudioFrameLoaded(false); setStudioChromeReady(false); setDetail(t("video.reload")); setRevision((value) => value + 1); }} aria-label={t("video.reload")}><RefreshCw /></Button>
        <Button variant={simpleMode ? "ghost" : "secondary"} size="xs" onClick={() => void applySimpleMode(!simpleMode)} aria-label={t("video.toggle_advanced")}><Layers3 />{simpleMode ? t("video.advanced") : t("video.simple")}</Button>
        <Button variant="ghost" size="icon-xs" onClick={onClose} aria-label={t("video.close")} title={t("video.close")}><X /></Button>
      </header>

      {isRemoteWorkspace ? (
        <div className="grid flex-1 place-items-center p-8 text-center text-sm text-muted-foreground">{t("video.local_only")}</div>
      ) : (
        <div className="relative min-h-0 flex-1 bg-[#0c0c0d]">
          {status === "starting" || (status === "ready" && !studioChromeReady) ? <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-background/80 backdrop-blur-sm"><div className="text-center"><Loader2 className="mx-auto mb-2 size-5 animate-spin text-primary" /><p className="text-xs text-muted-foreground">{status === "starting" ? t("video.starting_workspace") : t("video.preparing")}</p></div></div> : null}
          {status === "ready" ? <iframe key={`${sessionId}:${revision}`} src={studioUrl} title={t("video.iframe_title")} className={`h-full w-full border-0 transition-opacity duration-150 ${studioChromeReady ? "opacity-100" : "opacity-0"}`} data-loaded={studioFrameLoaded ? "true" : "false"} onLoad={() => {
            setStudioFrameLoaded(true);
            // Do not reveal the embedded Studio while it still has its own
            // product header. HyperFrames renders that header after the first
            // iframe load, so confirm the native cleanup before exposing the
            // canvas rather than relying on a timing-only delay.
            void (async () => {
              for (const delay of [0, 120, 420, 1_200, 2_800]) {
                if (delay) await new Promise<void>((resolve) => window.setTimeout(resolve, delay));
                if (await applySimpleMode(simpleMode)) {
                  setStudioChromeReady(true);
                  return;
                }
              }
              setDetail(t("video.still_preparing"));
            })();
          }} /> : null}
          {voicePanelOpen ? <VideoVoicePanel
            sessionId={sessionId}
            workspaceRoot={workspaceRoot}
            client={client}
            workspaceId={workspaceId}
            previewRequest={voicePreviewRequest}
            onClose={() => setVoicePanelOpen(false)}
          /> : null}
        </div>
      )}
    </div>
  );
}
