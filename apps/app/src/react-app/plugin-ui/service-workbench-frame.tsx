import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
import { PLUGIN_UI_HOST_CONTEXT_KEY, type PluginUiHostContextV1 } from "@ipollowork/types/plugins";
import type { WorkspaceAppModelContext, WorkspaceAppMessageResult } from "./workspace-app-frame";
import { Loader2, RotateCw } from "lucide-react";
import { serviceErrorMessage } from "@ipollowork/types/provider-errors";
import type { iPolloWorkServerClient } from "@/app/lib/ipollowork-server";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PluginUiSurface } from "./plugin-ui-contributions";

export function ServiceWorkbenchFrame(props: {
  surface: PluginUiSurface;
  client: iPolloWorkServerClient;
  workspaceId: string;
  workspaceRoot: string;
  sessionId?: string | null;
  onSendMessage?: (input: { text: string; modelContext: WorkspaceAppModelContext | null }) => WorkspaceAppMessageResult | Promise<WorkspaceAppMessageResult>;
  className?: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [frameLoad, setFrameLoad] = useState(0);
  const sendMessageRef = useRef(props.onSendMessage);
  sendMessageRef.current = props.onSendMessage;
  const workbench = useQuery({
    queryKey: ["plugin-service-workbench", props.client.baseUrl, props.workspaceId, props.workspaceRoot,
      props.sessionId, props.surface.pluginId, props.surface.resource.id],
    queryFn: async () => {
      const response = await props.client.callExtensionAction({
        extensionId: props.surface.pluginId,
        action: "open-workbench",
        args: {},
        context: {
          directory: props.workspaceRoot, workspaceId: props.workspaceId,
          sessionId: props.sessionId ?? undefined,
        },
      });
      if (!response.ok) throw new Error(response.message);
      const value: unknown = response.result;
      const address = value && typeof value === "object" && "url" in value ? value.url : null;
      if (typeof address !== "string") throw new Error("工作台服务没有返回页面地址。");
      const url = new URL(address);
      if (!["http:", "https:"].includes(url.protocol)
        || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
        || url.username || url.password) {
        throw new Error("工作台服务必须返回本机 HTTP 页面地址。");
      }
      return url.href;
    },
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const frameWindow = iframeRef.current?.contentWindow;
    if (!frameWindow || !workbench.data) return;
    const context: PluginUiHostContextV1 = {
      schemaVersion: 1, pluginId: props.surface.pluginId, resourceId: props.surface.resource.id,
      surface: "workspace", workspaceId: props.workspaceId, workspaceRoot: props.workspaceRoot,
      sessionId: props.sessionId ?? null,
    };
    const bridge = new AppBridge(null, { name: "iPolloWork", version: "0.21.2" }, {
      ...(sendMessageRef.current ? { message: { text: {} } } : {}),
    }, { hostContext: { [PLUGIN_UI_HOST_CONTEXT_KEY]: context } });
    bridge.onopenlink = async ({ url }) => {
      const login = props.surface.resource.browserSession;
      if (!login || new URL(url).origin !== login.origin) return { isError: true };
      const browser = window.__IPOLLOWORK_ELECTRON__?.browser;
      if (!browser?.openUrl) return { isError: true };
      await browser.openUrl(url);
      return {};
    };
    bridge.onmessage = async ({ content }) => {
      const text = content.flatMap(item => item.type === "text" ? [item.text] : []).join("\n").trim();
      if (!text || text.length > 30_000 || !sendMessageRef.current) return { isError: true };
      const sent = await sendMessageRef.current({ text, modelContext: null });
      const accepted = typeof sent === "boolean" ? sent : sent.accepted;
      if (accepted && typeof sent !== "boolean" && sent.sessionId !== context.sessionId
        && props.surface.resource.type === "local-service"
        && props.surface.resource.actions?.some(action => action.id === "rebind-session")) {
        const rebound = await props.client.callExtensionAction({
          extensionId: props.surface.pluginId, action: "rebind-session",
          args: { previousSessionId: context.sessionId, sessionId: sent.sessionId },
          context: { directory: props.workspaceRoot, workspaceId: props.workspaceId, sessionId: sent.sessionId },
        });
        if (!rebound.ok) throw new Error(rebound.message);
      }
      return accepted ? {} : { isError: true };
    };
    void bridge.connect(new PostMessageTransport(frameWindow, frameWindow)).catch(console.error);
    return () => { void bridge.close(); };
  }, [frameLoad, workbench.data, props.sessionId, props.workspaceId, props.workspaceRoot, props.surface.pluginId, props.surface.resource.id]);

  useEffect(() => {
    const login = props.surface.resource.browserSession;
    const browser = window.__IPOLLOWORK_ELECTRON__?.browser;
    if (!login || !browser?.getState || !browser.snapshot || !workbench.data || !props.sessionId
      || !props.surface.resource.actions?.some(action => action.id === login.observeAction)) return;
    let stopped = false;
    let busy = false;
    let checks = 0;
    const observe = async () => {
      if (stopped || busy || ++checks > 15) return;
      busy = true;
      try {
        const state = await browser.getState!();
        const tab = state?.tabs?.find(item => item.id === state.activeTabId);
        if (!tab?.url || tab.status !== "ready" || new URL(tab.url).origin !== login.origin
          || !login.paths.includes(new URL(tab.url).pathname)) return;
        const snapshot = await browser.snapshot!({ tabId: tab.id });
        if (stopped || new URL(snapshot.url).origin !== login.origin) return;
        const response = await props.client.callExtensionAction({
          extensionId: props.surface.pluginId, action: login.observeAction,
          args: { url: snapshot.url, tree: snapshot.tree },
          context: { directory: props.workspaceRoot, workspaceId: props.workspaceId, sessionId: props.sessionId ?? undefined },
        });
        if (response.ok && response.result && typeof response.result === "object"
          && "connected" in response.result && response.result.connected === true) stopped = true;
      } catch { /* Navigation and transient page loading can be retried on the next observation. */ }
      finally { busy = false; }
    };
    void observe();
    const timer = window.setInterval(() => { if (stopped || checks >= 15) window.clearInterval(timer); else void observe(); }, 2000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [frameLoad, workbench.data, props.sessionId, props.workspaceId, props.workspaceRoot, props.client, props.surface]);

  if (workbench.isPending || workbench.isFetching) {
    return <div className={cn("flex h-full items-center justify-center text-sm text-muted-foreground", props.className)}>
      <Loader2 className="mr-2 size-4 animate-spin" />正在启动{props.surface.label}…
    </div>;
  }
  if (workbench.isError) {
    return <div className={cn("flex h-full flex-col items-center justify-center gap-3 p-6 text-sm", props.className)}>
      <p>{props.surface.label}启动失败</p>
      <p className="text-muted-foreground">{serviceErrorMessage(workbench.error)}</p>
      <Button size="sm" variant="outline" onClick={() => void workbench.refetch()}>
        <RotateCw className="size-3.5" />重试
      </Button>
    </div>;
  }
  return <iframe
    ref={iframeRef}
    onLoad={() => setFrameLoad(value => value + 1)}
    title={props.surface.label}
    src={workbench.data}
    className={cn("h-full w-full min-w-0 border-0 bg-background", props.className)}
    sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox"
    referrerPolicy="no-referrer"
  />;
}
