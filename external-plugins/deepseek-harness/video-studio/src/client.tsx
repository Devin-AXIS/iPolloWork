import * as React from "react";
import type { Context } from "@deepseek-ai/cordis";
import type { ConvViewProps } from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {} from "@deepseek-ai/dsh-client-runtime/client";
import {
  isVideoStudioHostMessage,
  videoStudioDocumentPrompt,
  videoStudioSelectionPrompt,
} from "../../../../packages/video-studio/src/bridge";
import { videoProjectDirectory } from "../../../../packages/video-studio/src/project";

export const inject = ["slots"];

function VideoView({ sessionId, useWorkspaces, inputActions }: ConvViewProps) {
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const viewIdRef = React.useRef(`video-view-${crypto.randomUUID()}`);
  const workspace = useWorkspaces((state) => state.items.find((item) => item.sessionIds.includes(sessionId)));
  const projectDirectory = videoProjectDirectory(String(sessionId));

  React.useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== iframeRef.current?.contentWindow) return;
      if (!isVideoStudioHostMessage(event.data)) return;
      inputActions.setDraft(event.data.type === "ask-video-ai"
        ? videoStudioDocumentPrompt(projectDirectory)
        : videoStudioSelectionPrompt(projectDirectory, event.data.selection));
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [inputActions, projectDirectory]);

  if (!workspace) {
    return (
      <div style={emptyStyle}>
        <strong>iVideo needs a workspace</strong>
        <span>Open this conversation from a registered DeepSeek Harness workspace.</span>
      </div>
    );
  }

  const query = new URLSearchParams({
    workspaceId: String(workspace.workspaceId),
    sessionId: String(sessionId),
    viewId: viewIdRef.current,
  });
  return (
    <section style={shellStyle} aria-label="iVideo by iPolloWork">
      <iframe
        ref={iframeRef}
        title="iVideo by iPolloWork"
        src={`/ipollowork-video/studio/?${query.toString()}`}
        style={frameStyle}
        sandbox="allow-downloads allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
      />
    </section>
  );
}

export function apply(ctx: Context): void {
  ctx.slots.inject("conversation.view", () => ctx.slots.register({
    name: "conversation.view",
    id: "ipollowork-video-studio",
    order: 22,
    label: "Video",
  }, VideoView));
}

const shellStyle: React.CSSProperties = { display: "flex", flexDirection: "column", width: "100%", height: "100%", minHeight: 0, background: "#0b0d12" };
const frameStyle: React.CSSProperties = { flex: 1, width: "100%", minHeight: 0, border: 0, background: "#0b0d12" };
const emptyStyle: React.CSSProperties = { display: "grid", placeContent: "center", gap: 8, height: "100%", padding: 32, color: "#70757f", textAlign: "center" };
