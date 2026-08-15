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

    React.useEffect(() => {
      const receive = (event: MessageEvent) => {
        if (event.origin !== window.location.origin || event.source !== iframeRef.current?.contentWindow) return;
        if (!isDesignStudioHostMessage(event.data)) return;
        inputActions.setDraft(designStudioAskAiPrompt(event.data.request));
      };
      window.addEventListener("message", receive);
      return () => window.removeEventListener("message", receive);
    }, [inputActions]);

    if (!workspace) {
      return (
        <div style={emptyStyle}>
          <strong>{options.studioTitle} needs a workspace</strong>
          <span>Open this conversation from a registered DeepSeek Harness workspace.</span>
        </div>
      );
    }

    const query = new URLSearchParams({ workspaceId: String(workspace.workspaceId), sessionId: String(sessionId) });
    const projectId = `${String(sessionId)}${options.projectSuffix ?? ""}`;
    return (
      <section style={shellStyle} aria-label={`iPolloWork ${options.studioTitle}`}>
        <header style={headerStyle}>
          <div><div style={eyebrowStyle}>iPolloWork</div><strong style={titleStyle}>{options.studioTitle}</strong></div>
          <button
            type="button"
            style={buttonStyle}
            onClick={() => inputActions.setDraft([
              `Help me improve the current ${options.studioTitle} document.`,
              `Project: design/${projectId}`,
              "Read manifest.json, then read its entry file and linked design-tokens.css before editing.",
              "Preserve the existing structure unless I request a redesign.",
              "My requested change:",
            ].join("\n"))}
          >
            Ask AI
          </button>
        </header>
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
const headerStyle: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, minHeight: 62, padding: "10px 16px", borderBottom: "1px solid color-mix(in srgb, currentColor 12%, transparent)" };
const eyebrowStyle: React.CSSProperties = { color: "#70757f", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" };
const titleStyle: React.CSSProperties = { fontSize: 14, lineHeight: 1.3 };
const buttonStyle: React.CSSProperties = { border: "1px solid color-mix(in srgb, currentColor 14%, transparent)", borderRadius: 10, padding: "8px 13px", color: "inherit", background: "color-mix(in srgb, currentColor 6%, transparent)", font: "inherit", fontSize: 12, fontWeight: 650, cursor: "pointer" };
const frameStyle: React.CSSProperties = { flex: 1, width: "100%", minHeight: 0, border: 0, background: "#f6f7f9" };
const emptyStyle: React.CSSProperties = { display: "grid", placeContent: "center", gap: 8, height: "100%", padding: 32, color: "#70757f", textAlign: "center" };
