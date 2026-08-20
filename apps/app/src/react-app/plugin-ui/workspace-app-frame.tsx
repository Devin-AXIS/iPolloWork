/** @jsxImportSource react */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AppBridge,
  PostMessageTransport,
  buildAllowAttribute,
  type McpUiHostContext,
  type McpUiUpdateModelContextRequest,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Loader2, RotateCw } from "lucide-react";

import type {
  iPolloWorkPluginUiResource,
  iPolloWorkServerClient,
} from "@/app/lib/ipollowork-server";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePlatform } from "@/react-app/kernel/platform";
import {
  useControlActions,
  type iPolloWorkControlAction,
} from "@/react-app/shell/control/control-provider";
import {
  PLUGIN_UI_HOST_CONTEXT_KEY,
  type PluginUiHostContextV1,
} from "@ipollowork/types/plugins";

import type { PluginUiSurface } from "./plugin-ui-contributions";

export type WorkspaceAppModelContext = McpUiUpdateModelContextRequest["params"];

type WorkspaceAppFrameProps = {
  surface: PluginUiSurface;
  client: iPolloWorkServerClient;
  workspaceId: string;
  workspaceRoot: string;
  sessionId?: string | null;
  placement: "workspace" | "settings";
  displayMode?: "inline" | "fullscreen";
  onDisplayModeChange?: (mode: "inline" | "fullscreen") => void;
  onSendMessage?: (input: {
    text: string;
    modelContext: WorkspaceAppModelContext | null;
  }) => boolean | Promise<boolean>;
  onRequestClose?: () => void;
  /** Uses an in-workspace draft resource while Plugin Studio is previewing an uninstalled package. */
  resourceOverride?: iPolloWorkPluginUiResource;
  /** Scopes an unpacked draft to the current conversation without adding it to installed plugins. */
  developmentPreview?: {
    revision: string;
  };
  className?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cspSourceList(values: string[] | undefined, fallback: string) {
  return values?.length ? values.join(" ") : fallback;
}

function withContentSecurityPolicy(resource: iPolloWorkPluginUiResource) {
  const csp = resource.resource.ui.csp;
  const policy = [
    "default-src 'none'",
    `script-src 'unsafe-inline' ${cspSourceList(csp?.resourceDomains, "")}`.trim(),
    `style-src 'unsafe-inline' ${cspSourceList(csp?.resourceDomains, "")}`.trim(),
    `img-src data: blob: ${cspSourceList(csp?.resourceDomains, "")}`.trim(),
    `font-src data: ${cspSourceList(csp?.resourceDomains, "")}`.trim(),
    `media-src data: blob: ${cspSourceList(csp?.resourceDomains, "")}`.trim(),
    `connect-src ${cspSourceList(csp?.connectDomains, "'none'")}`,
    `frame-src ${cspSourceList(csp?.frameDomains, "'none'")}`,
    `base-uri ${cspSourceList(csp?.baseUriDomains, "'none'")}`,
    "form-action 'none'",
  ].join("; ");
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy.replaceAll("&", "&amp;").replaceAll("\"", "&quot;")}">`;
  if (/<head(?:\s[^>]*)?>/i.test(resource.html)) {
    return resource.html.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${meta}`);
  }
  return `${meta}${resource.html}`;
}

function messageText(content: Array<{ type: string; text?: string }>) {
  return content.flatMap((block) => block.type === "text" && block.text?.trim() ? [block.text.trim()] : []).join("\n\n");
}

function toolResult(value: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
    ...(isRecord(value) ? { structuredContent: value } : {}),
  };
}

function toolError(error: unknown): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: error instanceof Error ? error.message : String(error || "Workspace App tool failed") }],
  };
}

function currentTheme(): "light" | "dark" {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function sameWorkspaceAppRuntimeResource(
  current: iPolloWorkPluginUiResource | null,
  next: iPolloWorkPluginUiResource,
): boolean {
  return current?.pluginId === next.pluginId
    && current.resource.id === next.resource.id
    && current.resource.path === next.resource.path
    && current.html === next.html
    && JSON.stringify(current.resource.ui) === JSON.stringify(next.resource.ui);
}

function pluginUiHostContext(
  props: Pick<
    WorkspaceAppFrameProps,
    "surface" | "placement" | "workspaceId" | "workspaceRoot" | "sessionId"
  >,
  developmentPreview: WorkspaceAppFrameProps["developmentPreview"],
): PluginUiHostContextV1 {
  return {
    schemaVersion: 1,
    pluginId: props.surface.pluginId,
    resourceId: props.surface.resource.id,
    surface: props.placement,
    workspaceId: props.workspaceId,
    workspaceRoot: props.workspaceRoot,
    sessionId: props.sessionId ?? null,
    ...(developmentPreview ? {
      developmentPreview: {
        mode: "plugin-workshop",
        revision: developmentPreview.revision,
      },
    } : {}),
  };
}

export function WorkspaceAppFrame(props: WorkspaceAppFrameProps) {
  const platform = usePlatform();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef<AppBridge | null>(null);
  const resourceRef = useRef<iPolloWorkPluginUiResource | null>(null);
  const resourceIdentityRef = useRef("");
  const developmentPreviewRef = useRef(props.developmentPreview);
  const modelContextRef = useRef<WorkspaceAppModelContext | null>(null);
  const onDisplayModeChangeRef = useRef(props.onDisplayModeChange);
  const onSendMessageRef = useRef(props.onSendMessage);
  const onRequestCloseRef = useRef(props.onRequestClose);
  onDisplayModeChangeRef.current = props.onDisplayModeChange;
  onSendMessageRef.current = props.onSendMessage;
  onRequestCloseRef.current = props.onRequestClose;
  developmentPreviewRef.current = props.developmentPreview;
  const supportsDisplayModeChange = Boolean(props.onDisplayModeChange);
  const supportsMessage = Boolean(props.onSendMessage);
  const developmentPreviewActive = Boolean(props.developmentPreview);
  const [resource, setResource] = useState<iPolloWorkPluginUiResource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [bridgeReady, setBridgeReady] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    const resourceIdentity = `${props.surface.pluginId}:${props.surface.resource.id}`;
    const replacingResource = resourceIdentityRef.current !== resourceIdentity;
    if (replacingResource) {
      resourceIdentityRef.current = resourceIdentity;
      resourceRef.current = null;
      setResource(null);
      setBridgeReady(false);
    }
    if (!resourceRef.current) setLoading(true);
    setError(null);
    const request = props.resourceOverride
      ? Promise.resolve(props.resourceOverride)
      : props.client.getPluginPackageUiResource(
          props.workspaceId,
          props.surface.pluginId,
          props.surface.resource.id,
        );
    void request.then((nextResource) => {
      if (!active || sameWorkspaceAppRuntimeResource(resourceRef.current, nextResource)) return;
      resourceRef.current = nextResource;
      setBridgeReady(false);
      setResource(nextResource);
    }).catch((nextError) => {
      if (active && !resourceRef.current) {
        setError(nextError instanceof Error ? nextError.message : "Workspace App could not be loaded");
      }
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [props.client, props.resourceOverride, props.surface.pluginId, props.surface.resource.id, props.workspaceId, revision]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!resource || !iframe?.contentWindow) return;
    setBridgeReady(false);
    let disposed = false;
    const transport = new PostMessageTransport(iframe.contentWindow, iframe.contentWindow);
    const pluginContext = pluginUiHostContext(props, developmentPreviewRef.current);
    const hostContext: McpUiHostContext = {
      theme: currentTheme(),
      displayMode: props.displayMode ?? "inline",
      availableDisplayModes: supportsDisplayModeChange ? ["inline", "fullscreen"] : ["inline"],
      locale: document.documentElement.lang || navigator.language,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      platform: platform.platform === "desktop" ? "desktop" : "web",
      userAgent: navigator.userAgent,
      // Keep this direct alias for unpacked Studios generated before the
      // namespaced iPolloWork host-context contract was documented.
      ...(pluginContext.developmentPreview ? {
        developmentPreview: pluginContext.developmentPreview,
      } : {}),
      [PLUGIN_UI_HOST_CONTEXT_KEY]: pluginContext,
    };
    const bridge = new AppBridge(
      null,
      { name: "iPolloWork", version: "0.21.2" },
      {
        experimental: { [PLUGIN_UI_HOST_CONTEXT_KEY]: {} },
        openLinks: {},
        serverTools: {},
        logging: {},
        updateModelContext: { text: {}, structuredContent: {} },
        ...(supportsMessage ? { message: { text: {} } } : {}),
        sandbox: {
          csp: resource.resource.ui.csp,
          permissions: resource.resource.ui.permissions,
        },
      },
      { hostContext },
    );
    bridgeRef.current = bridge;
    bridge.oncalltool = async ({ name, arguments: args }) => {
      try {
        if (developmentPreviewActive) {
          throw new Error(
            "Uninstalled Plugin Workshop previews cannot execute local-service actions. "
            + "Expose a standard MCP App tools/list + tools/call handler to test Studio behavior before installation.",
          );
        }
        if (props.surface.action && name !== props.surface.action) {
          throw new Error(`Workspace App may only call ${props.surface.action}.`);
        }
        const result = await props.client.callExtensionAction({
          extensionId: props.surface.pluginId,
          action: name,
          args: isRecord(args) ? args : {},
          context: {
            directory: props.workspaceRoot,
            workspaceId: props.workspaceId,
            sessionId: props.sessionId ?? undefined,
          },
        });
        return result.ok ? toolResult(result.result) : toolError(result.message);
      } catch (nextError) {
        return toolError(nextError);
      }
    };
    bridge.onmessage = async ({ content }) => {
      const text = messageText(content);
      const sendMessage = onSendMessageRef.current;
      if (!text || !sendMessage) return { isError: true };
      return await sendMessage({ text, modelContext: modelContextRef.current }) ? {} : { isError: true };
    };
    bridge.onupdatemodelcontext = async (context) => {
      modelContextRef.current = context;
      return {};
    };
    bridge.onopenlink = async ({ url }) => {
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return { isError: true };
        platform.openLink(parsed.toString());
        return {};
      } catch {
        return { isError: true };
      }
    };
    bridge.onrequestdisplaymode = async ({ mode }) => {
      const changeDisplayMode = onDisplayModeChangeRef.current;
      const nextMode = mode === "fullscreen" && changeDisplayMode ? "fullscreen" : "inline";
      changeDisplayMode?.(nextMode);
      return { mode: nextMode };
    };
    bridge.onrequestteardown = () => onRequestCloseRef.current?.();
    bridge.onloggingmessage = ({ level, logger, data }) => {
      const log = level === "error" || level === "critical" ? console.error : level === "warning" ? console.warn : console.debug;
      log(`[workspace-app:${logger ?? props.surface.pluginId}]`, data);
    };

    const resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry || disposed) return;
      bridge.setHostContext({
        containerDimensions: {
          width: Math.round(entry.contentRect.width),
          height: Math.round(entry.contentRect.height),
        },
      });
    });
    resizeObserver.observe(iframe);
    const themeObserver = new MutationObserver(() => {
      if (!disposed) bridge.setHostContext({ theme: currentTheme() });
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    const connection = bridge.connect(transport);
    iframe.srcdoc = withContentSecurityPolicy(resource);
    void connection.then(() => {
      if (!disposed) setBridgeReady(true);
    }).catch((nextError) => {
      if (!disposed) setError(nextError instanceof Error ? nextError.message : "Workspace App bridge failed");
    });

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      themeObserver.disconnect();
      bridgeRef.current = null;
      void bridge.teardownResource({}).catch(() => undefined).finally(() => transport.close());
      iframe.srcdoc = "";
    };
  }, [developmentPreviewActive, platform, props.client, props.placement, props.sessionId, props.surface.action, props.surface.pluginId, props.surface.resource.id, props.workspaceId, props.workspaceRoot, resource, supportsDisplayModeChange, supportsMessage]);

  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge || !props.developmentPreview) return;
    const pluginContext = pluginUiHostContext(props, props.developmentPreview);
    bridge.setHostContext({
      developmentPreview: pluginContext.developmentPreview,
      [PLUGIN_UI_HOST_CONTEXT_KEY]: pluginContext,
    });
  }, [props.developmentPreview?.revision, props.placement, props.sessionId, props.surface.pluginId, props.surface.resource.id, props.workspaceId, props.workspaceRoot]);

  useEffect(() => {
    bridgeRef.current?.setHostContext({ displayMode: props.displayMode ?? "inline" });
  }, [props.displayMode]);

  const controlActions = useMemo<iPolloWorkControlAction[]>(() => props.placement !== "workspace" ? [] : [
    {
      id: "workspace_app.list_tools",
      label: `List ${props.surface.label} tools`,
      description: developmentPreviewActive
        ? "List standard MCP App tools exposed by the active uninstalled Plugin Workshop draft."
        : "List standard MCP App tools exposed by the active Workspace App.",
      sideEffect: "none",
      disabled: !bridgeReady,
      execute: async (args) => {
        if (isRecord(args) && typeof args.sessionId === "string" && args.sessionId !== props.sessionId) {
          throw new Error("The active Workspace App belongs to another conversation");
        }
        const result = await bridgeRef.current?.listTools({}) ?? { tools: [] };
        const developmentPreview = developmentPreviewRef.current;
        return developmentPreview
          ? { ...result, developmentPreview: { active: true, revision: developmentPreview.revision } }
          : result;
      },
    },
    {
      id: "workspace_app.call_tool",
      label: `Edit ${props.surface.label}`,
      description: developmentPreviewActive
        ? "Call a standard MCP App tool on the active uninstalled draft; changes stay in this Plugin Workshop conversation."
        : "Call a standard MCP App tool exposed by the active Workspace App.",
      sideEffect: "mutation",
      disabled: !bridgeReady,
      requiresArgs: true,
      args: [
        { name: "name", type: "string", required: true, description: "Tool name returned by workspace_app.list_tools." },
        { name: "arguments", type: "object", description: "Tool arguments." },
      ],
      execute: async (args) => {
        if (!isRecord(args) || typeof args.name !== "string") throw new Error("name is required");
        if (typeof args.sessionId === "string" && args.sessionId !== props.sessionId) {
          throw new Error("The active Workspace App belongs to another conversation");
        }
        const bridge = bridgeRef.current;
        if (!bridge) throw new Error("Workspace App is not ready");
        return bridge.callTool({
          name: args.name,
          arguments: isRecord(args.arguments) ? args.arguments : {},
        });
      },
    },
  ], [bridgeReady, developmentPreviewActive, props.placement, props.sessionId, props.surface.label]);
  useControlActions(controlActions);

  if (loading) {
    return <div className={cn("flex h-full items-center justify-center text-sm text-muted-foreground", props.className)}><Loader2 className="mr-2 size-4 animate-spin" />Loading {props.surface.label}…</div>;
  }
  if (error || !resource) {
    return (
      <div className={cn("flex h-full items-center justify-center p-6 text-center", props.className)}>
        <div>
          <p className="text-sm font-medium text-foreground">{props.surface.label} could not be displayed.</p>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">{error}</p>
          <Button className="mt-4" size="sm" variant="outline" onClick={() => setRevision((value) => value + 1)}>
            <RotateCw className="size-3.5" />Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <iframe
      ref={iframeRef}
      title={props.surface.label}
      className={cn("h-full w-full border-0 bg-background", props.className)}
      sandbox="allow-scripts allow-same-origin"
      allow={buildAllowAttribute(resource.resource.ui.permissions)}
      data-development-preview={props.developmentPreview ? "plugin-workshop" : undefined}
      data-preview-revision={props.developmentPreview?.revision}
    />
  );
}
