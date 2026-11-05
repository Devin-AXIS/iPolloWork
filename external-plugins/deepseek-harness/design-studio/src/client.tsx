import * as React from "react";
import type { Context } from "@deepseek-ai/cordis";
import type { ConvViewProps } from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {} from "@deepseek-ai/dsh-client-runtime/client";

import {
  DESIGN_STUDIO_HOST_CHANNEL,
  designStudioAskAiPrompt,
  isDesignStudioHostMessage,
} from "../../../../packages/design-studio/src/bridge";

export type DeepSeekDesignStudioClientOptions = {
  routeRoot: `/${string}`;
  viewId: string;
  label: string;
  studioTitle: string;
  projectSuffix?: string;
};

export const inject = ["slots"];

export function createDeepSeekDesignStudioClient(options: DeepSeekDesignStudioClientOptions) {
  function StudioView({ sessionId, useWorkspaces, inputActions }: ConvViewProps) {
    const iframeRef = React.useRef<HTMLIFrameElement>(null);
    const workspace = useWorkspaces((state) => state.items.find((item) => item.sessionIds.includes(sessionId)));
    const projectId = `${String(sessionId)}${options.projectSuffix ?? ""}`;

    React.useEffect(() => {
      const receive = (event: MessageEvent) => {
        if (event.origin !== window.location.origin || event.source !== iframeRef.current?.contentWindow) return;
        if (!isDesignStudioHostMessage(event.data)) return;
        if (event.data.type === "ask-document-ai") {
          inputActions.setDraft([
            `Help me improve the current ${options.studioTitle} document.`,
            `Project: design/${projectId}`,
            "Read manifest.json, then read its entry file and linked design-tokens.css before editing.",
            "Preserve the existing structure unless I request a redesign.",
            "My requested change:",
          ].join("\n"));
          return;
        }
        inputActions.setDraft(designStudioAskAiPrompt(event.data.request));
      };
      window.addEventListener("message", receive);
      return () => window.removeEventListener("message", receive);
    }, [inputActions, projectId]);

    if (!workspace) {
      return (
        <div style={emptyStyle}>
          <strong>{options.studioTitle} needs a workspace</strong>
          <span>Open this conversation from a registered DeepSeek Harness workspace.</span>
        </div>
      );
    }

    const query = new URLSearchParams({ workspaceId: String(workspace.workspaceId), sessionId: String(sessionId) });
    return (
      <section style={shellStyle} aria-label={`iPolloWork ${options.studioTitle}`}>
        <iframe
          ref={iframeRef}
          title={`iPolloWork ${options.studioTitle}`}
          src={`${options.routeRoot}/studio/?${query.toString()}`}
          style={frameStyle}
          sandbox="allow-downloads allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
        />
      </section>
    );
  }

  return function apply(ctx: Context): void {
    ctx.slots.inject("conversation.view", () => ctx.slots.register({
      name: "conversation.view",
      id: options.viewId,
      order: 20,
      label: options.label,
    }, StudioView));
  };
}

export const apply = createDeepSeekDesignStudioClient({
  routeRoot: "/ipollowork-design",
  viewId: "ipollowork-design-studio",
  label: "Design",
  studioTitle: "DeepSeek iDesign",
});

const shellStyle: React.CSSProperties = { display: "flex", flexDirection: "column", width: "100%", height: "100%", minHeight: 0, background: "var(--color-background, #f6f7f9)" };
const frameStyle: React.CSSProperties = { flex: 1, width: "100%", minHeight: 0, border: 0, background: "#f6f7f9" };
const emptyStyle: React.CSSProperties = { display: "grid", placeContent: "center", gap: 8, height: "100%", padding: 32, color: "#70757f", textAlign: "center" };
