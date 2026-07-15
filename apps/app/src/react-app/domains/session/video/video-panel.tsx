/** @jsxImportSource react */
import * as React from "react";
import { AudioLines, Film, Layers3, Loader2, Play, RefreshCw, X } from "lucide-react";

import type { iPolloWorkServerClient } from "@/app/lib/ipollowork-server";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  HYPERFRAMES_VERSION,
  hyperframesPreviewCommand,
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
  const [detail, setDetail] = React.useState(`Starting HyperFrames ${HYPERFRAMES_VERSION}…`);
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
    setDetail(`Starting HyperFrames ${HYPERFRAMES_VERSION}…`);
    setStudioFrameLoaded(false);
    setStudioChromeReady(false);
    if (isRemoteWorkspace) {
      setStatus("failed");
      setDetail("Video Studio is available for local workspaces.");
      return;
    }
    const bridge = window.__IPOLLOWORK_ELECTRON__?.terminal;
    if (!bridge?.create || !bridge.write || !bridge.kill || !bridge.onData || !bridge.onExit) {
      setStatus("failed");
      setDetail("HyperFrames requires the iPolloWork desktop app.");
      return;
    }
    const createTerminal = bridge.create;
    const writeTerminal = bridge.write;
    const killTerminal = bridge.kill;
    const onTerminalData = bridge.onData;
    const onTerminalExit = bridge.onExit;

    let disposed = false;
    const removeData = onTerminalData(({ terminalId, data }) => {
      if (terminalIdRef.current !== terminalId) return;
      const plain = data.replace(/\x1b\[[0-9;]*m/g, "");
      if (new RegExp(`localhost:${studioPort}|127\\.0\\.0\\.1:${studioPort}|studio.*ready|server.*running`, "i").test(plain)) {
        setStatus("ready");
        setDetail("Studio ready · click any canvas element to edit");
        setStudioFrameLoaded(false);
        setRevision((value) => value + 1);
      }
    });
    const removeExit = onTerminalExit(({ terminalId, exitCode }) => {
      if (terminalIdRef.current !== terminalId || disposed) return;
      terminalIdRef.current = null;
      setStatus("failed");
      setDetail(`HyperFrames stopped${exitCode == null ? "" : ` (${exitCode})`}.`);
    });

    void createTerminal({ cwd: workspaceRoot, cols: 100, rows: 24 }).then(({ terminalId }) => {
      if (disposed) {
        void killTerminal(terminalId);
        return;
      }
      terminalIdRef.current = terminalId;
      void writeTerminal(terminalId, hyperframesPreviewCommand(sessionId));
    }).catch((cause) => {
      setStatus("failed");
      setDetail(cause instanceof Error ? cause.message : "Could not start HyperFrames.");
    });

    return () => {
      disposed = true;
      removeData();
      removeExit();
      const terminalId = terminalIdRef.current;
      terminalIdRef.current = null;
      if (terminalId) void killTerminal(terminalId);
    };
  }, [isRemoteWorkspace, projectDirectory, sessionId, studioPort, workspaceRoot]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-testid="video-panel">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-[#EAEAEA] px-3 [border-bottom-width:0.5px]">
        <Film className="size-4 text-primary" />
        <div className="flex min-w-0 flex-1 items-center">
          <p className="truncate text-sm font-medium">Video Studio</p>
        </div>
        <Tooltip>
          <TooltipTrigger render={<Button variant={voicePanelOpen ? "secondary" : "ghost"} size="icon-xs" onClick={() => setVoicePanelOpen((open) => !open)} disabled={isRemoteWorkspace} aria-label="打开配音设置"><AudioLines /></Button>} />
          <TooltipContent>配音设置</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="xs" onClick={() => { setVoicePanelOpen(true); setVoicePreviewRequest((value) => value + 1); }} disabled={isRemoteWorkspace} aria-label="试听当前配音"><Play />Preview</Button>} />
          <TooltipContent>试听当前已选音色</TooltipContent>
        </Tooltip>
        <Button variant="ghost" size="icon-xs" onClick={() => { setStudioFrameLoaded(false); setStudioChromeReady(false); setDetail("Reloading Studio…"); setRevision((value) => value + 1); }} aria-label="Reload Video Studio"><RefreshCw /></Button>
        <Button variant={simpleMode ? "ghost" : "secondary"} size="xs" onClick={() => void applySimpleMode(!simpleMode)} aria-label="Toggle advanced Video Studio"><Layers3 />{simpleMode ? "Advanced" : "Simple"}</Button>
        <Button variant="ghost" size="icon-xs" onClick={onClose} aria-label="Close Video Studio" title="Close Video Studio"><X /></Button>
      </header>

      {isRemoteWorkspace ? (
        <div className="grid flex-1 place-items-center p-8 text-center text-sm text-muted-foreground">Video Studio is available for local workspaces only.</div>
      ) : (
        <div className="relative min-h-0 flex-1 bg-[#0c0c0d]">
          {status === "starting" || (status === "ready" && !studioChromeReady) ? <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-background/80 backdrop-blur-sm"><div className="text-center"><Loader2 className="mx-auto mb-2 size-5 animate-spin text-primary" /><p className="text-xs text-muted-foreground">{status === "starting" ? "Starting the native HyperFrames workspace…" : "Preparing the Video Studio…"}</p></div></div> : null}
          {status === "ready" ? <iframe key={`${sessionId}:${revision}`} src={studioUrl} title="HyperFrames Video Studio" className={`h-full w-full border-0 transition-opacity duration-150 ${studioChromeReady ? "opacity-100" : "opacity-0"}`} data-loaded={studioFrameLoaded ? "true" : "false"} onLoad={() => {
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
              setDetail("Video Studio is still preparing. Reload to try again.");
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
