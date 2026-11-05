import * as React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";

import { bootstrapTheme } from "@/app/theme";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { initLocale } from "@/i18n";
import { getReactQueryClient } from "@/react-app/infra/query-client";
import { VideoPanel } from "@/react-app/domains/session/video/public";
import {
  VIDEO_STUDIO_HOST_CHANNEL,
  videoProjectDirectory,
  type VideoStudioSelection,
} from "@ipollowork/video-studio";
import { createDeepSeekVideoStudioHost } from "./api";
import "@/app/index.css";

function requiredParameter(name: string) {
  const value = new URLSearchParams(window.location.search).get(name)?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function postToHarness(message: unknown) {
  window.parent.postMessage(message, window.location.origin);
}

function Studio() {
  const [scope] = React.useState(() => ({
    workspaceId: requiredParameter("workspaceId"),
    sessionId: requiredParameter("sessionId"),
    viewId: requiredParameter("viewId"),
  }));
  const host = React.useMemo(() => createDeepSeekVideoStudioHost(scope), [scope]);
  const projectDirectory = videoProjectDirectory(scope.sessionId);

  return (
    <main className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <VideoPanel
        title="iVideo"
        sessionId={scope.sessionId}
        workspaceRoot={scope.workspaceId}
        client={host.client}
        workspaceId={scope.workspaceId}
        runtime={host.runtime}
        expanded
        features={{
          voice: false,
          designSystem: false,
          templates: {
            title: "Video 模板",
            description: "选择一个可编辑的视频起点，当前项目会安全替换并保留失败回滚。",
          },
        }}
        branding={{
          title: "iVideo",
          byline: "by iPolloWork",
          bylineUrl: "https://github.com/Devin-AXIS/iPolloWork",
          repositoryUrl: "https://github.com/Devin-AXIS/deepseek-design",
          onAskAi: () => postToHarness({
            channel: VIDEO_STUDIO_HOST_CHANNEL,
            type: "ask-video-ai",
          }),
        }}
        onAskAi={(context) => {
          const prefix = `${projectDirectory}/`;
          const selection: VideoStudioSelection = {
            file: context.filePath.startsWith(prefix) ? context.filePath.slice(prefix.length) : "index.html",
            locator: context.target.locator,
            tag: context.target.tag,
            text: context.target.text,
            src: context.target.src,
            alt: context.target.alt,
            styles: context.target.styles,
          };
          postToHarness({
            channel: VIDEO_STUDIO_HOST_CHANNEL,
            type: "ask-ai-selection",
            selection,
          });
        }}
      />
      <Toaster />
    </main>
  );
}

bootstrapTheme();
initLocale();

const root = document.getElementById("root");
if (!root) throw new Error("iVideo root element is unavailable.");
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <QueryClientProvider client={getReactQueryClient()}>
      <TooltipProvider>
        <Studio />
      </TooltipProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
