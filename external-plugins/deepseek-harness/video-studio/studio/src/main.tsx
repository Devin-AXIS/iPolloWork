import * as React from "react";
import ReactDOM from "react-dom/client";
import {
  parseHyperframesAskAiMessage,
  type VideoStudioSelection,
  VIDEO_STUDIO_HOST_CHANNEL,
} from "@ipollowork/video-studio";
import { deepSeekVideoApi, type VideoRuntimeSession } from "./api";
import { VideoTemplateDialog } from "./video-template-dialog";
import "./video-studio.css";

function requiredParameter(name: string) {
  const value = new URLSearchParams(window.location.search).get(name)?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function resolvedTheme() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

type IconProps = { className?: string };

function FilmIcon({ className }: IconProps) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18V6A1.5 1.5 0 0 1 5 4.5Z" stroke="currentColor" strokeWidth="1.7"/><path d="M8 4.5v15M16 4.5v15M3.5 9h4.5m8 0h4.5M3.5 15h4.5m8 0h4.5" stroke="currentColor" strokeWidth="1.7"/></svg>;
}

function SparkIcon({ className }: IconProps) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3.5c.5 3.3 2.2 5 5.5 5.5-3.3.5-5 2.2-5.5 5.5-.5-3.3-2.2-5-5.5-5.5 3.3-.5 5-2.2 5.5-5.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/><path d="M18.2 14.5c.25 1.65 1.1 2.5 2.8 2.8-1.7.25-2.55 1.1-2.8 2.7-.25-1.6-1.1-2.45-2.7-2.7 1.6-.3 2.45-1.15 2.7-2.8Z" fill="currentColor"/></svg>;
}

function TemplateIcon({ className }: IconProps) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="4" width="17" height="16" rx="2" stroke="currentColor" strokeWidth="1.7"/><path d="M3.5 9h17M9 9v11" stroke="currentColor" strokeWidth="1.7"/></svg>;
}

function GitHubIcon({ className }: IconProps) {
  return <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M12 2.7a9.55 9.55 0 0 0-3.02 18.61c.48.09.65-.2.65-.46v-1.68c-2.67.58-3.23-1.13-3.23-1.13-.44-1.1-1.07-1.4-1.07-1.4-.87-.6.07-.58.07-.58.96.07 1.47.98 1.47.98.86 1.46 2.25 1.04 2.8.8.09-.61.34-1.04.61-1.28-2.13-.24-4.37-1.06-4.37-4.72 0-1.04.37-1.9.98-2.57-.1-.24-.43-1.21.1-2.53 0 0 .8-.26 2.63.98A9.15 9.15 0 0 1 12 7.4c.81 0 1.62.11 2.39.32 1.82-1.24 2.62-.98 2.62-.98.53 1.32.2 2.29.1 2.53.61.67.98 1.53.98 2.57 0 3.67-2.25 4.47-4.39 4.71.35.3.65.88.65 1.78v2.52c0 .26.18.56.66.46A9.55 9.55 0 0 0 12 2.7Z" clipRule="evenodd"/></svg>;
}

function VideoStudio() {
  const [scope] = React.useState(() => ({
    workspaceId: requiredParameter("workspaceId"),
    sessionId: requiredParameter("sessionId"),
    viewId: requiredParameter("viewId"),
  }));
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const [runtime, setRuntime] = React.useState<VideoRuntimeSession | null>(null);
  const [error, setError] = React.useState("");
  const [templateOpen, setTemplateOpen] = React.useState(false);
  const [selection, setSelection] = React.useState<VideoStudioSelection | null>(null);
  const [revision, setRevision] = React.useState(0);

  const load = React.useCallback(() => {
    setError("");
    void deepSeekVideoApi.session(scope.workspaceId, scope.sessionId, scope.viewId)
      .then(setRuntime)
      .catch((reason) => setError(reason instanceof Error ? reason.message : "iVideo could not start."));
  }, [scope]);

  React.useEffect(load, [load]);
  React.useEffect(() => {
    const release = () => void deepSeekVideoApi.release(scope.workspaceId, scope.sessionId, scope.viewId).catch(() => undefined);
    window.addEventListener("pagehide", release);
    return () => {
      window.removeEventListener("pagehide", release);
      release();
    };
  }, [scope]);

  React.useEffect(() => {
    if (!runtime) return;
    const receive = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow || event.origin !== new URL(runtime.studioUrl).origin) return;
      const selection = parseHyperframesAskAiMessage(event.data);
      if (!selection) return;
      window.parent.postMessage({
        channel: VIDEO_STUDIO_HOST_CHANNEL,
        type: "ask-ai-selection",
        selection,
      }, window.location.origin);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [runtime]);

  React.useEffect(() => {
    if (!runtime) {
      setSelection(null);
      return;
    }
    let active = true;
    const refresh = () => void deepSeekVideoApi.selection(scope.workspaceId, scope.sessionId, scope.viewId)
      .then((result) => { if (active) setSelection(result.selection); })
      .catch(() => { if (active) setSelection(null); });
    refresh();
    const timer = window.setInterval(refresh, 800);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [runtime, scope]);

  const syncStudio = React.useCallback(() => {
    const target = iframeRef.current?.contentWindow;
    if (!runtime || !target) return;
    const origin = new URL(runtime.studioUrl).origin;
    target.postMessage({
      type: "ipollowork:studio-host-context",
      projectId: runtime.projectId,
      title: "iVideo",
      actions: { reload: true, saveAsTemplate: false },
    }, origin);
    target.postMessage({ type: "ipollowork:studio-locale", locale: "zh-CN" }, origin);
    target.postMessage({ type: "ipollowork:studio-theme", theme: resolvedTheme() }, origin);
  }, [runtime]);

  return (
    <main className="ivideo-shell">
      {runtime ? (
        <iframe
          ref={iframeRef}
          key={`${runtime.studioUrl}:${revision}`}
          className="ivideo-frame"
          title="HyperFrames Video Studio"
          src={runtime.studioUrl}
          onLoad={syncStudio}
          sandbox="allow-downloads allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
        />
      ) : null}
      <div className="ivideo-native-row" aria-label="iVideo controls">
        <div className="ivideo-glass-cluster">
          <div className="ivideo-brand" title="iVideo by iPolloWork">
            <span className="ivideo-brand-mark"><FilmIcon /></span>
            <span className="ivideo-brand-copy"><strong>iVideo</strong><small>by iPolloWork</small></span>
          </div>
          <span className="ivideo-separator" />
          <button className="ivideo-control" type="button" onClick={() => setTemplateOpen(true)}><TemplateIcon /><span>模板</span></button>
          <button
            className="ivideo-control"
            type="button"
            disabled={!selection}
            title={selection ? `Ask AI about ${selection.locator}` : "请先在画面中选择一个元素"}
            onClick={() => selection && window.parent.postMessage({
              channel: VIDEO_STUDIO_HOST_CHANNEL,
              type: "ask-ai-selection",
              selection,
            }, window.location.origin)}
          ><SparkIcon /><span>元素 AI</span></button>
          <button className="ivideo-control ivideo-control-primary" type="button" onClick={() => window.parent.postMessage({ channel: VIDEO_STUDIO_HOST_CHANNEL, type: "ask-video-ai" }, window.location.origin)}><SparkIcon /><span>Ask AI</span></button>
          <a className="ivideo-icon-control" href="https://github.com/Devin-AXIS/deepseek-design" target="_blank" rel="noreferrer" aria-label="Open iPolloWork on GitHub"><GitHubIcon /></a>
        </div>
      </div>
      {!runtime && !error ? (
        <div className="ivideo-state"><span className="ivideo-spinner" /><strong>正在启动 iVideo</strong><small>连接 HyperFrames Studio…</small></div>
      ) : null}
      {error ? (
        <div className="ivideo-state"><FilmIcon className="ivideo-state-icon" /><strong>iVideo 暂时无法打开</strong><small>{error}</small><button type="button" onClick={load}>重新尝试</button></div>
      ) : null}
      <VideoTemplateDialog
        open={templateOpen}
        onOpenChange={setTemplateOpen}
        listTemplates={() => deepSeekVideoApi.templates(scope.workspaceId)}
        getCover={(templateId) => deepSeekVideoApi.templateCover(scope.workspaceId, templateId)}
        applyTemplate={(templateId) => deepSeekVideoApi.applyTemplate(scope.workspaceId, scope.sessionId, scope.viewId, templateId)}
        onApplied={(nextRuntime) => { setRuntime(nextRuntime); setRevision((value) => value + 1); }}
      />
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("iVideo root element is unavailable.");
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <VideoStudio />
  </React.StrictMode>,
);
