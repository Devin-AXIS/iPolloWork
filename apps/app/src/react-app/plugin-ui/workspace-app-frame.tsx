/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppBridge,
  PostMessageTransport,
  buildAllowAttribute,
  type McpUiHostContext,
  type McpUiUpdateModelContextRequest,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Loader2, RotateCw, SlidersHorizontal } from "lucide-react";

import type {
  iPolloWorkPluginUiResource,
  iPolloWorkServerClient,
} from "@/app/lib/ipollowork-server";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { usePlatform } from "@/react-app/kernel/platform";
import {
  StudioInspectorHeader,
  StudioInspectorPanel,
} from "@/react-app/domains/session/panel/studio-inspector-panel";
import {
  useControlActions,
  type iPolloWorkControlAction,
} from "@/react-app/shell/control/control-provider";
import {
  PLUGIN_UI_HOST_CONTEXT_KEY,
  PLUGIN_UI_INSPECTOR_CONTEXT_KEY,
  parsePluginUiInspectorContext,
  type PluginUiInspectorContextV1,
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
  launch?: PluginUiHostContextV1["launch"];
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

function callToolResultText(result: CallToolResult) {
  return result.content.flatMap((block) => block.type === "text" && block.text.trim() ? [block.text.trim()] : []).join("\n\n");
}

function inspectorContextFrom(modelContext: WorkspaceAppModelContext) {
  if (!isRecord(modelContext.structuredContent)) return null;
  return parsePluginUiInspectorContext(modelContext.structuredContent[PLUGIN_UI_INSPECTOR_CONTEXT_KEY]);
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
    "surface" | "placement" | "workspaceId" | "workspaceRoot" | "sessionId" | "launch"
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
    ...(props.launch ? { launch: props.launch } : {}),
    ...(developmentPreview ? {
      developmentPreview: {
        mode: "plugin-workshop",
        revision: developmentPreview.revision,
      },
    } : {}),
  };
}

type WorkspaceAppInspectorProps = {
  context: PluginUiInspectorContextV1;
  onClose: () => void;
  onCallTool: (name: string, args: Record<string, unknown>) => Promise<CallToolResult>;
};

function WorkspaceAppInspector({ context, onClose, onCallTool }: WorkspaceAppInspectorProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const formArguments = () => {
    const values: Record<string, string> = {};
    if (!formRef.current) return values;
    for (const [name, value] of new FormData(formRef.current)) {
      if (typeof value === "string") values[name] = value;
    }
    return values;
  };

  const submit = async () => {
    if (submitting || context.submitDisabled) return;
    setSubmitting(true);
    setError("");
    try {
      const update = await onCallTool(context.updateTool, formArguments());
      if (update.isError) throw new Error(callToolResultText(update) || "Could not update the image settings.");
      const result = await onCallTool(context.submitTool, {});
      if (result.isError) throw new Error(callToolResultText(result) || "The image action failed.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "The image action failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const updateLiveField = async (fieldId: string, value: string) => {
    setError("");
    try {
      const update = await onCallTool(context.updateTool, { ...formArguments(), [fieldId]: value });
      if (update.isError) throw new Error(callToolResultText(update) || "Could not update the image settings.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not update the image settings.");
    }
  };

  const status = error
    ? { message: error, tone: "error" }
    : context.status;

  return (
    <StudioInspectorPanel
      ariaLabel={context.title}
      header={<StudioInspectorHeader
        title={context.title}
        description={context.description}
        icon={<SlidersHorizontal />}
        closeLabel="Close settings"
        onClose={onClose}
      />}
      bodyClassName="px-4 py-4"
      testId="workspace-app-inspector"
    >
      <form ref={formRef} className="space-y-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        {context.fields.map((field) => (
          <label key={field.id} className="block space-y-1.5">
            <span className="text-[11px] font-medium text-foreground">{field.label}</span>
            {field.control === "textarea" ? (
              <Textarea
                key={`${field.id}:${field.value}`}
                name={field.id}
                defaultValue={field.value}
                placeholder={field.placeholder}
                disabled={submitting}
                className="min-h-28 resize-y rounded-xl bg-background text-[12px] leading-5"
              />
            ) : (
              <Select
                key={`${field.id}:${field.value}`}
                name={field.id}
                defaultValue={field.value}
                disabled={submitting}
                onValueChange={field.live ? (value) => {
                  if (value !== null) void updateLiveField(field.id, value);
                } : undefined}
              >
                <SelectTrigger className="w-full rounded-xl bg-input/50" aria-label={field.label}>
                  <SelectValue>
                    {field.live ? field.options?.find((option) => option.value === field.value)?.label : undefined}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent align="start">
                  {field.options?.map((option) => (
                    <SelectItem key={option.value} value={option.value} disabled={option.disabled}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </label>
        ))}

        {status ? (
          <p
            className={cn(
              "rounded-lg px-2.5 py-2 text-[11px] leading-4",
              status.tone === "error" && "bg-destructive/10 text-destructive",
              status.tone === "success" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
              status.tone === "info" && "bg-muted text-muted-foreground",
            )}
            role="status"
          >
            {status.message}
          </p>
        ) : null}

        <Button type="submit" className="w-full rounded-xl" disabled={submitting || context.submitDisabled}>
          {submitting ? <Loader2 className="animate-spin" /> : null}
          {context.submitLabel}
        </Button>
      </form>
    </StudioInspectorPanel>
  );
}

export function WorkspaceAppFrame(props: WorkspaceAppFrameProps) {
  const platform = usePlatform();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef<AppBridge | null>(null);
  const resourceRef = useRef<iPolloWorkPluginUiResource | null>(null);
  const resourceIdentityRef = useRef("");
  const developmentPreviewRef = useRef(props.developmentPreview);
  const modelContextRef = useRef<WorkspaceAppModelContext | null>(null);
  const inspectorOpenRequestRef = useRef("");
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
  const [inspectorContext, setInspectorContext] = useState<PluginUiInspectorContextV1 | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);

  useEffect(() => {
    let active = true;
    const resourceIdentity = `${props.surface.pluginId}:${props.surface.resource.id}`;
    const replacingResource = resourceIdentityRef.current !== resourceIdentity;
    if (replacingResource) {
      resourceIdentityRef.current = resourceIdentity;
      resourceRef.current = null;
      inspectorOpenRequestRef.current = "";
      setResource(null);
      setBridgeReady(false);
      setInspectorContext(null);
      setInspectorOpen(false);
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
      const nextInspector = inspectorContextFrom(context);
      setInspectorContext(nextInspector);
      if (!nextInspector) {
        setInspectorOpen(false);
      } else if (nextInspector.openRequestId && nextInspector.openRequestId !== inspectorOpenRequestRef.current) {
        inspectorOpenRequestRef.current = nextInspector.openRequestId;
        setInspectorOpen(true);
      }
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
    if (!bridge) return;
    const pluginContext = pluginUiHostContext(props, props.developmentPreview);
    bridge.setHostContext({
      ...(pluginContext.developmentPreview ? { developmentPreview: pluginContext.developmentPreview } : {}),
      [PLUGIN_UI_HOST_CONTEXT_KEY]: pluginContext,
    });
  }, [props.developmentPreview?.revision, props.launch, props.placement, props.sessionId, props.surface.pluginId, props.surface.resource.id, props.workspaceId, props.workspaceRoot]);

  useEffect(() => {
    bridgeRef.current?.setHostContext({ displayMode: props.displayMode ?? "inline" });
  }, [props.displayMode]);

  const callWorkspaceAppTool = useCallback(async (name: string, args: Record<string, unknown>) => {
    const bridge = bridgeRef.current;
    if (!bridge) return toolError("Workspace App is not ready");
    return bridge.callTool({ name, arguments: args });
  }, []);

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
    <div className={cn("flex h-full min-h-0 w-full overflow-hidden bg-background", props.className)}>
      <iframe
        ref={iframeRef}
        title={props.surface.label}
        className="h-full min-w-0 flex-1 border-0 bg-background"
        sandbox="allow-scripts allow-same-origin"
        allow={buildAllowAttribute(resource.resource.ui.permissions)}
        data-development-preview={props.developmentPreview ? "plugin-workshop" : undefined}
        data-preview-revision={props.developmentPreview?.revision}
      />
      {inspectorOpen && inspectorContext ? (
        <WorkspaceAppInspector
          context={inspectorContext}
          onClose={() => setInspectorOpen(false)}
          onCallTool={callWorkspaceAppTool}
        />
      ) : null}
    </div>
  );
}
