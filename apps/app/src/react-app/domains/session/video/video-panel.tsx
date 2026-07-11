/** @jsxImportSource react */
import * as React from "react";
import { CheckCircle2, Film, Layers3, Loader2, RefreshCw, Unplug, X } from "lucide-react";

import { Button } from "@/components/ui/button";

type VideoPanelProps = {
  sessionId: string;
  workspaceRoot: string;
  isRemoteWorkspace?: boolean;
  onClose: () => void;
};

const HYPERFRAMES_VERSION = "0.7.52";
const HYPERFRAMES_PORT_BASE = 3_100;
const HYPERFRAMES_PORT_RANGE = 800;

export function hyperframesStudioPort(sessionId: string) {
  let hash = 0;
  for (const character of sessionId) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
  return HYPERFRAMES_PORT_BASE + (hash % HYPERFRAMES_PORT_RANGE);
}

export function hyperframesStudioUrl(port = 3_002, projectId = "video") {
  // Start on a deterministic, hydrated main-composition frame. HyperFrames can
  // otherwise restore a panel/playhead state before its preview has mounted,
  // which leaves the first playback visually empty until a timeline layer is
  // selected.
  return `http://localhost:${port}/#project/${encodeURIComponent(projectId)}?v=1&t=0&tab=design&rc=1&tv=1`;
}

export function videoProjectId(sessionId: string) {
  return sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function videoProjectDirectory(sessionId: string) {
  return `video/${videoProjectId(sessionId)}`;
}

export function hyperframesPreviewCommand(sessionId: string) {
  const projectDirectory = videoProjectDirectory(sessionId);
  const studioPort = hyperframesStudioPort(sessionId);
  return `if [ ! -f ${projectDirectory}/index.html ]; then HYPERFRAMES_SKIP_SKILLS=1 npx --yes hyperframes@${HYPERFRAMES_VERSION} init ${projectDirectory} --example warm-grain --non-interactive --skip-skills; fi && cd ${projectDirectory} && npx --yes hyperframes@${HYPERFRAMES_VERSION} preview --port ${studioPort} --no-open\n`;
}

export function VideoPanel({ sessionId, workspaceRoot, isRemoteWorkspace = false, onClose }: VideoPanelProps) {
  const terminalIdRef = React.useRef<string | null>(null);
  const [revision, setRevision] = React.useState(0);
  const [status, setStatus] = React.useState<"starting" | "ready" | "failed">("starting");
  const [detail, setDetail] = React.useState(`Starting HyperFrames ${HYPERFRAMES_VERSION}…`);
  const [studioFrameLoaded, setStudioFrameLoaded] = React.useState(false);
  const [simpleMode, setSimpleMode] = React.useState(true);
  const studioPort = hyperframesStudioPort(sessionId);
  const studioUrl = hyperframesStudioUrl(studioPort, videoProjectId(sessionId));
  const projectDirectory = videoProjectDirectory(sessionId);

  const applySimpleMode = React.useCallback(async (enabled: boolean) => {
    const result = await window.__IPOLLOWORK_ELECTRON__?.hyperframes?.setSimpleMode?.(enabled);
    if (result?.ok) setSimpleMode(enabled);
  }, []);

  React.useEffect(() => {
    if (status !== "ready" || !studioFrameLoaded || !simpleMode) return;
    // HyperFrames replaces its preview iframe when the playhead crosses into a
    // different composition. Re-apply the bridge so direct editing survives
    // those native iframe navigations instead of only working on the first frame.
    const interval = window.setInterval(() => void applySimpleMode(true), 1_000);
    return () => window.clearInterval(interval);
  }, [applySimpleMode, simpleMode, status, studioFrameLoaded]);

  React.useEffect(() => {
    setStatus("starting");
    setDetail(`Starting HyperFrames ${HYPERFRAMES_VERSION}…`);
    setStudioFrameLoaded(false);
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
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <Film className="size-4 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">Video Studio</p>
          <p className="flex items-center gap-1 truncate text-[10px] text-muted-foreground">
            {status === "ready" ? <CheckCircle2 className="size-2.5 text-emerald-500" /> : status === "starting" ? <Loader2 className="size-2.5 animate-spin" /> : <Unplug className="size-2.5 text-amber-500" />}
            {detail}
          </p>
        </div>
        <Button variant="ghost" size="icon-xs" onClick={() => { setStudioFrameLoaded(false); setDetail("Reloading Studio…"); setRevision((value) => value + 1); }} aria-label="Reload Video Studio"><RefreshCw /></Button>
        <Button variant={simpleMode ? "ghost" : "secondary"} size="xs" onClick={() => void applySimpleMode(!simpleMode)} aria-label="Toggle advanced Video Studio"><Layers3 />{simpleMode ? "Advanced" : "Simple"}</Button>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close Video"><X /></Button>
      </header>

      {isRemoteWorkspace ? (
        <div className="grid flex-1 place-items-center p-8 text-center text-sm text-muted-foreground">Video Studio is available for local workspaces only.</div>
      ) : (
        <div className="relative min-h-0 flex-1 bg-[#0c0c0d]">
          {status === "starting" ? <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-background/80 backdrop-blur-sm"><div className="text-center"><Loader2 className="mx-auto mb-2 size-5 animate-spin text-primary" /><p className="text-xs text-muted-foreground">Starting the native HyperFrames workspace…</p></div></div> : null}
          {status === "ready" ? <iframe key={revision} src={studioUrl} title="HyperFrames Video Studio" className="h-full w-full border-0" data-loaded={studioFrameLoaded ? "true" : "false"} onLoad={() => {
            setStudioFrameLoaded(true);
            [350, 1_200, 2_800].forEach((delay) => window.setTimeout(() => void applySimpleMode(true), delay));
          }} /> : null}
        </div>
      )}
    </div>
  );
}
