import * as React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";

import { bootstrapTheme } from "@/app/theme";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { initLocale, t } from "@/i18n";
import { getReactQueryClient } from "@/react-app/infra/query-client";
import { DesignPanel } from "@/react-app/domains/session/design/public";
import {
  DESIGN_STUDIO_HOST_CHANNEL,
  designStudioAskAiRequest,
} from "../../../../../packages/design-studio/src/bridge";
import { deepSeekDesignStudioClient } from "./deepseek-client";
import "@/app/index.css";

function requiredParameter(name: string) {
  const value = new URLSearchParams(window.location.search).get(name)?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function Studio() {
  const [scope] = React.useState(() => ({
    workspaceId: requiredParameter("workspaceId"),
    sessionId: requiredParameter("sessionId"),
  }));

  return (
    <main className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <DesignPanel
        sessionId={scope.sessionId}
        client={deepSeekDesignStudioClient}
        workspaceId={scope.workspaceId}
        expanded
        features={{
          publish: false,
          templates: {
            title: t(__DEEPSEEK_STUDIO_MODE__ === "slides" ? "design_templates.slides_title" : "design_templates.design_title"),
            description: t(__DEEPSEEK_STUDIO_MODE__ === "slides" ? "design_templates.slides_description" : "design_templates.design_description"),
          },
        }}
        branding={{
          kind: __DEEPSEEK_STUDIO_MODE__ === "slides" ? "slides" : "design",
          title: __DEEPSEEK_STUDIO_MODE__ === "slides" ? "iPPT" : "iDesign",
          byline: "by iPolloWork",
          bylineUrl: "https://github.com/Devin-AXIS/iPolloWork",
          repositoryUrl: "https://github.com/Devin-AXIS/deepseek-design",
          onAskAi: () => window.parent.postMessage({
            channel: DESIGN_STUDIO_HOST_CHANNEL,
            type: "ask-document-ai",
          }, window.location.origin),
        }}
        onAskAi={(context) => window.parent.postMessage({
          channel: DESIGN_STUDIO_HOST_CHANNEL,
          type: "ask-ai",
          request: designStudioAskAiRequest(context),
        }, window.location.origin)}
      />
      <Toaster />
    </main>
  );
}

bootstrapTheme();
initLocale();

const root = document.getElementById("root");
if (!root) throw new Error("Design Studio root element is unavailable.");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <QueryClientProvider client={getReactQueryClient()}>
      <TooltipProvider>
        <Studio />
      </TooltipProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
