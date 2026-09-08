/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { serviceErrorMessage } from "@ipollowork/types/provider-errors";
import {
  AppBridge,
  PostMessageTransport,
  buildAllowAttribute,
  type McpUiHostContext,
  type McpUiUpdateModelContextRequest,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { IMAGE_GENERATION_REQUEST_TIMEOUT_MS, VIDEO_SUBMISSION_REQUEST_TIMEOUT_MS } from "@/app/lib/ipollowork-server";
import { ImagePlus, Loader2, RotateCw, SlidersHorizontal, Upload, X } from "lucide-react";
import { useNavigate } from "react-router-dom";

import type {
  ImageStudioAiReference,
} from "@/app/types";
import type {
  iPolloWorkPluginUiResource,
  iPolloWorkServerClient,
} from "@/app/lib/ipollowork-server";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { usePlatform } from "@/react-app/kernel/platform";
import { workspaceSettingsRoute } from "@/react-app/shell/workspace-routes";
import { getReactQueryClient } from "@/react-app/infra/query-client";
import { sessionArtifactsQueryKey } from "@/react-app/infra/session-artifacts-query";
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
export type WorkspaceImageSave = { path: string; originalPath: string; saveMode: "copy" | "overwrite"; revision: string };
export type WorkspaceVideoResult = { path: string; sourcePath: string; requestId: string; saveMode?: "copy" | "overwrite"; revision?: string };

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
  onImageSaved?: (save: WorkspaceImageSave) => void;
  onVideoResult?: (result: WorkspaceVideoResult) => void;
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

function finiteUnitValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

function parseImageStudioAiReference(value: unknown): ImageStudioAiReference | null {
  if (!isRecord(value)) return null;
  const sourcePath = typeof value.sourcePath === "string" ? value.sourcePath.trim() : "";
  const sourceName = typeof value.sourceName === "string" ? value.sourceName.trim() : "";
  const imageWidth = typeof value.imageWidth === "number" && Number.isFinite(value.imageWidth) ? value.imageWidth : 0;
  const imageHeight = typeof value.imageHeight === "number" && Number.isFinite(value.imageHeight) ? value.imageHeight : 0;
  if (!sourcePath || imageWidth <= 0 || imageHeight <= 0) return null;
  if (value.kind === "point" && isRecord(value.point)) {
    const x = finiteUnitValue(value.point.x);
    const y = finiteUnitValue(value.point.y);
    return x === null || y === null ? null : { sourcePath, sourceName, imageWidth, imageHeight, kind: "point", point: { x, y } };
  }
  if (value.kind === "selection" && isRecord(value.selection)) {
    const left = finiteUnitValue(value.selection.left);
    const top = finiteUnitValue(value.selection.top);
    const right = finiteUnitValue(value.selection.right);
    const bottom = finiteUnitValue(value.selection.bottom);
    if (left === null || top === null || right === null || bottom === null || left >= right || top >= bottom) return null;
    return { sourcePath, sourceName, imageWidth, imageHeight, kind: "selection", selection: { left, top, right, bottom } };
  }
  return null;
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
    content: [{ type: "text", text: serviceErrorMessage(error) }],
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
  onOpenAuthorizations: () => void;
};

function InspectorImagePreview({ path, readTool, onCallTool }: {
  path: string;
  readTool?: string;
  onCallTool: WorkspaceAppInspectorProps["onCallTool"];
}) {
  const [src, setSrc] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false, objectUrl = "";
    setSrc(""); setError("");
    if (!path || !readTool) return;
    if (/^https:\/\//i.test(path)) { setSrc(path); return; }
    void (async () => {
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      let offset = 0;
      while (!cancelled) {
        const result = await onCallTool(readTool, { path, offset });
        if (result.isError) throw new Error(callToolResultText(result));
        const part = result.structuredContent;
        if (!part || typeof part.mime !== "string" || !/^image\/(png|jpeg|webp)$/.test(part.mime)
          || typeof part.data !== "string" || part.data.length > 1.5 * 1024 * 1024 || chunks.length >= 20
          || typeof part.size !== "number" || !Number.isSafeInteger(part.size) || part.size > 20 * 1024 * 1024
          || typeof part.nextOffset !== "number" || !Number.isSafeInteger(part.nextOffset) || part.nextOffset <= offset || part.nextOffset > part.size) {
          throw new Error("无法预览此图片，请使用不超过 20 MB 的 PNG、JPG 或 WebP。");
        }
        const chunk = Uint8Array.from(atob(part.data), char => char.charCodeAt(0));
        if (chunk.byteLength !== part.nextOffset - offset) throw new Error("图片读取中断，请重新选择。");
        chunks.push(chunk);
        offset = part.nextOffset;
        if (offset === part.size) {
          if (!cancelled) { objectUrl = URL.createObjectURL(new Blob(chunks, { type: part.mime })); setSrc(objectUrl); }
          break;
        }
      }
    })().catch(nextError => { if (!cancelled) setError(serviceErrorMessage(nextError)); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [path, readTool, onCallTool]);
  if (error) return <span role="status" className="px-3 text-[11px] text-destructive">{error}</span>;
  if (!src) return <Loader2 aria-label="正在加载图片" className="size-5 animate-spin text-muted-foreground" />;
  return <img src={src} alt="已选择的图片预览" referrerPolicy="no-referrer" className="h-32 w-full object-contain"
    onError={() => setError("图片无法预览，请检查链接或更换图片。")} />;
}

function WorkspaceAppInspector({ context, onClose, onCallTool, onOpenAuthorizations }: WorkspaceAppInspectorProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const activeRef = useRef(true);
  useEffect(() => { activeRef.current = true; return () => { activeRef.current = false; }; }, []);
  const [submitting, setSubmitting] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState("");
  const [uploadingField, setUploadingField] = useState("");

  const upload = async (field: PluginUiInspectorContextV1["fields"][number], file: File) => {
    if (!field.media || updating || submitting || context.submitDisabled) return;
    const draft = formArguments();
    setUpdating(true); setUploadingField(field.id); setError("");
    try {
      if (!file.size || file.size > 20 * 1024 * 1024) throw new Error("请选择不超过 20 MB 的素材。");
      if (!file.type.startsWith(`${field.media.kind}/`)) throw new Error("文件类型与所选素材不一致。");
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("无法读取文件。"));
        reader.onerror = () => reject(new Error("无法读取文件。"));
        reader.readAsDataURL(file);
      });
      if (!activeRef.current) return;
      const update = await onCallTool(context.updateTool, draft);
      if (update.isError) throw new Error(callToolResultText(update));
      if (!activeRef.current) return;
      const result = await onCallTool(field.media.importTool, { fieldId: field.id, filename: file.name, dataUrl });
      if (result.isError) throw new Error(callToolResultText(result));
    } catch (nextError) { setError(serviceErrorMessage(nextError)); }
    finally { setUpdating(false); setUploadingField(""); }
  };

  const formArguments = () => {
    const values: Record<string, string> = {};
    if (!formRef.current) return values;
    for (const [name, value] of new FormData(formRef.current)) {
      if (typeof value === "string") values[name] = value;
    }
    return values;
  };

  const submit = async () => {
    if (submitting || updating || context.submitDisabled) return;
    setSubmitting(true);
    setError("");
    try {
      const update = await onCallTool(context.updateTool, formArguments());
      if (update.isError) throw new Error(callToolResultText(update) || "Could not update the settings.");
      const result = await onCallTool(context.submitTool, {});
      if (result.isError) throw new Error(callToolResultText(result) || "The action failed.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "The action failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const updateLiveField = async (fieldId: string, value: string) => {
    if (updating || submitting) return;
    setUpdating(true);
    setError("");
    try {
      const update = await onCallTool(context.updateTool, { ...formArguments(), [fieldId]: value });
      if (update.isError) throw new Error(callToolResultText(update) || "Could not update the settings.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not update the settings.");
    } finally {
      setUpdating(false);
    }
  };

  const status = error
    ? { message: error, tone: "error" }
    : context.status;

  const renderField = (field: PluginUiInspectorContextV1["fields"][number]) => (
    <div key={field.id} className="block space-y-1" data-inspector-field={field.id}>
      <span className="text-[10px] text-muted-foreground">{field.label}</span>
      {field.control === "image" ? (
        <>
          <div className="relative overflow-hidden rounded-xl border border-border bg-muted/30">
            <button type="button" aria-label={`${field.value ? "更换" : "上传"}${field.label}`}
              disabled={submitting || updating || context.submitDisabled}
              onClick={() => formRef.current?.querySelector<HTMLInputElement>(`input[data-media-field="${field.id}"]`)?.click()}
              className="flex h-32 w-full items-center justify-center rounded-xl text-center transition-colors hover:bg-muted/70 focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60">
              {uploadingField === field.id ? <span role="status" className="flex items-center gap-2 text-xs"><Loader2 className="size-4 animate-spin" />正在上传…</span>
                : field.value ? <InspectorImagePreview key={field.value} path={field.value} readTool={field.media?.readTool} onCallTool={onCallTool} />
                : <span className="flex flex-col items-center gap-2 text-muted-foreground"><ImagePlus className="size-6" /><span className="text-xs">点击上传{field.label}</span><span className="text-[10px]">PNG / JPG / WebP · 最大 20 MB</span></span>}
            </button>
            {field.value ? <Tooltip><TooltipTrigger render={<Button type="button" variant="secondary" size="icon"
              className="absolute right-1.5 top-1.5 size-7 rounded-lg" aria-label={`移除${field.label}`}
              disabled={submitting || updating || context.submitDisabled} onClick={() => void updateLiveField(field.id, "")} />}><X className="size-3.5" /></TooltipTrigger><TooltipContent>移除{field.label}</TooltipContent></Tooltip> : null}
          </div>
          <details className="text-[11px] text-muted-foreground">
            <summary className="cursor-pointer">链接 / 工作区路径</summary>
            <Input key={`${field.id}:${field.value}`} name={field.id} defaultValue={field.value} aria-label={`${field.label}路径`}
              placeholder="图片链接 / 工作区路径" disabled={submitting || updating}
              onBlur={event => {
                if (event.relatedTarget instanceof Node && formRef.current?.contains(event.relatedTarget)) return;
                void updateLiveField(field.id, event.currentTarget.value);
              }} className="mt-2 h-8 text-xs" />
          </details>
        </>
      ) : field.control === "textarea" ? (
        <Textarea key={`${field.id}:${field.value}`} name={field.id} defaultValue={field.value}
          aria-label={field.label} placeholder={field.placeholder} disabled={submitting || updating}
          onBlur={field.live ? event => {
            // In-form selects and submit already collect every draft field. Do not
            // disable a clicked submit button during the preceding blur event.
            if (event.relatedTarget instanceof Node && formRef.current?.contains(event.relatedTarget)) return;
            void updateLiveField(field.id, event.currentTarget.value);
          } : undefined}
          className="min-h-28 resize-y" />
      ) : (
        <Select key={`${field.id}:${field.value}:${JSON.stringify(field.options)}`} name={field.id}
          defaultValue={field.value} items={field.options} disabled={submitting || updating}
          onValueChange={field.live ? value => {
            if (value === null) return;
            const option = field.options?.find(candidate => candidate.value === value);
            if (option?.action === "open-authorizations") {
              onOpenAuthorizations();
              return;
            }
            void updateLiveField(field.id, value);
          } : undefined}>
          <SelectTrigger className="w-full border-transparent bg-muted shadow-none hover:bg-muted/80" aria-label={field.label}>
            <SelectValue>{field.live ? field.options?.find(option => option.value === field.value)?.label : undefined}</SelectValue>
          </SelectTrigger>
          <SelectContent align="start">{field.options?.map(option => (
            <SelectItem key={option.value} value={option.value} disabled={option.disabled}>{option.label}</SelectItem>
          ))}</SelectContent>
        </Select>
      )}
      {field.media ? <>
        <input type="file" hidden data-media-field={field.id} aria-label={`上传${field.label}`}
          accept={field.media.kind === "image" ? "image/png,image/jpeg,image/webp" : field.media.kind === "video" ? "video/mp4,video/quicktime" : "audio/mpeg,audio/wav"}
          disabled={submitting || updating || context.submitDisabled}
          onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void upload(field, file); }} />
        {field.control !== "image" ? <Button type="button" variant="outline" size="sm" disabled={submitting || updating || context.submitDisabled}
          onClick={() => formRef.current?.querySelector<HTMLInputElement>(`input[data-media-field="${field.id}"]`)?.click()}>
          {uploadingField === field.id ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}从本机导入
        </Button> : null}
      </> : null}
    </div>
  );

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
      bodyClassName="px-4 py-3.5"
      testId="workspace-app-inspector"
    >
      <form ref={formRef} className="space-y-3" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        {context.fields.filter(field => !field.advanced).map(renderField)}
        {context.fields.some(field => field.advanced) ? (
          <details className="rounded-xl border border-border p-3">
            <summary className="cursor-pointer text-xs font-medium">{context.advancedLabel ?? "Advanced"}</summary>
            <div className="mt-4 space-y-4">{context.fields.filter(field => field.advanced).map(renderField)}</div>
          </details>
        ) : null}

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

        <Button type="submit" className="w-full rounded-xl" disabled={submitting || updating || context.submitDisabled}>
          {submitting ? <Loader2 className="animate-spin" /> : null}
          {context.submitLabel}
        </Button>
      </form>
    </StudioInspectorPanel>
  );
}

export function WorkspaceAppFrame(props: WorkspaceAppFrameProps) {
  const platform = usePlatform();
  const navigate = useNavigate();
  const inspectorBelowAppToolbar = props.surface.pluginId === "image-studio";
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef<AppBridge | null>(null);
  const hostContextRef = useRef<McpUiHostContext>({});
  const updateHostContext = useCallback((patch: Partial<McpUiHostContext>) => {
    if (!bridgeRef.current) return;
    // AppBridge replaces its initialization snapshot instead of merging patches.
    // Keep launch/session data when size, theme or display mode changes first.
    hostContextRef.current = { ...hostContextRef.current, ...patch };
    bridgeRef.current.setHostContext(hostContextRef.current);
  }, []);
  const resourceRef = useRef<iPolloWorkPluginUiResource | null>(null);
  const resourceIdentityRef = useRef("");
  const developmentPreviewRef = useRef(props.developmentPreview);
  const modelContextRef = useRef<WorkspaceAppModelContext | null>(null);
  const inspectorOpenRequestRef = useRef("");
  const onDisplayModeChangeRef = useRef(props.onDisplayModeChange);
  const onSendMessageRef = useRef(props.onSendMessage);
  const onImageSavedRef = useRef(props.onImageSaved);
  onImageSavedRef.current = props.onImageSaved;
  const onVideoResultRef = useRef(props.onVideoResult);
  onVideoResultRef.current = props.onVideoResult;
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
    const receiveImageStudioReference = (event: MessageEvent) => {
      if (props.surface.pluginId !== "image-studio" || event.source !== iframe?.contentWindow || !isRecord(event.data)) return;
      if (event.data.type !== "ipollowork:image-studio:ask-ai") return;
      const reference = parseImageStudioAiReference(event.data.reference);
      if (!reference || !props.sessionId) return;
      window.dispatchEvent(new CustomEvent("ipollowork:add-image-reference", {
        detail: { sessionId: props.sessionId, reference },
      }));
      props.onDisplayModeChange?.("inline");
      window.dispatchEvent(new Event("ipollowork:focusPrompt"));
    };
    window.addEventListener("message", receiveImageStudioReference);
    return () => window.removeEventListener("message", receiveImageStudioReference);
  }, [props.onDisplayModeChange, props.sessionId, props.surface.pluginId]);

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
    hostContextRef.current = hostContext;
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
        if (result.ok && props.sessionId) {
          void getReactQueryClient().invalidateQueries({
            queryKey: sessionArtifactsQueryKey(props.client.baseUrl, props.workspaceId, props.sessionId),
          });
        }
        if (!disposed && result.ok && props.surface.pluginId === "image-studio" && name === "save-edit") {
          const saved = result.result;
          if (isRecord(saved) && typeof saved.path === "string" && typeof saved.originalPath === "string"
            && typeof saved.revision === "string" && (saved.saveMode === "copy" || saved.saveMode === "overwrite")) {
            onImageSavedRef.current?.({ path: saved.path, originalPath: saved.originalPath, revision: saved.revision, saveMode: saved.saveMode });
          }
        }
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
      if (!disposed && props.surface.pluginId === "video-console") {
        const result = context.structuredContent?.videoEditResult;
        if (isRecord(result) && typeof result.path === "string" && typeof result.sourcePath === "string" && typeof result.requestId === "string") {
          onVideoResultRef.current?.({ path: result.path, sourcePath: result.sourcePath, requestId: result.requestId, saveMode: result.saveMode === "overwrite" ? "overwrite" : "copy", ...(typeof result.revision === "string" ? { revision: result.revision } : {}) });
        }
      }
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
      updateHostContext({
        containerDimensions: {
          width: Math.round(entry.contentRect.width),
          height: Math.round(entry.contentRect.height),
        },
      });
    });
    resizeObserver.observe(iframe);
    const themeObserver = new MutationObserver(() => {
      if (!disposed) updateHostContext({ theme: currentTheme() });
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
  }, [developmentPreviewActive, platform, props.client, props.placement, props.sessionId, props.surface.action, props.surface.pluginId, props.surface.resource.id, props.workspaceId, props.workspaceRoot, resource, supportsDisplayModeChange, supportsMessage, updateHostContext]);

  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge) return;
    const pluginContext = pluginUiHostContext(props, props.developmentPreview);
    updateHostContext({
      ...(pluginContext.developmentPreview ? { developmentPreview: pluginContext.developmentPreview } : {}),
      [PLUGIN_UI_HOST_CONTEXT_KEY]: pluginContext,
    });
  }, [bridgeReady, props.developmentPreview?.revision, props.launch, props.placement, props.sessionId, props.surface.pluginId, props.surface.resource.id, props.workspaceId, props.workspaceRoot, updateHostContext]);

  useEffect(() => {
    updateHostContext({ displayMode: props.displayMode ?? "inline" });
  }, [props.displayMode, updateHostContext]);

  const callWorkspaceAppTool = useCallback(async (name: string, args: Record<string, unknown>) => {
    const bridge = bridgeRef.current;
    if (!bridge) return toolError("Workspace App is not ready");
    return bridge.callTool({ name, arguments: args }, props.surface.pluginId === "image-studio" && name === "generate_or_edit"
      ? { timeout: IMAGE_GENERATION_REQUEST_TIMEOUT_MS }
      : props.surface.pluginId === "video-console" && name === "generate_or_edit"
      ? { timeout: VIDEO_SUBMISSION_REQUEST_TIMEOUT_MS }
      : undefined);
  }, [props.surface.pluginId]);

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
        return callWorkspaceAppTool(args.name, isRecord(args.arguments) ? args.arguments : {});
      },
    },
  ], [bridgeReady, callWorkspaceAppTool, developmentPreviewActive, props.placement, props.sessionId, props.surface.label]);
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
    <div className={cn("relative flex h-full min-h-0 w-full overflow-hidden bg-background", props.className)}>
      <iframe
        ref={iframeRef}
        title={props.surface.label}
        className={cn(
          "h-full min-w-0 border-0 bg-background",
          inspectorBelowAppToolbar ? "w-full" : "flex-1",
        )}
        sandbox="allow-scripts allow-same-origin"
        allow={buildAllowAttribute(resource.resource.ui.permissions)}
        data-development-preview={props.developmentPreview ? "plugin-workshop" : undefined}
        data-preview-revision={props.developmentPreview?.revision}
      />
      {inspectorOpen && inspectorContext ? (
        inspectorBelowAppToolbar ? (
          <div className="absolute bottom-0 right-0 top-[52px] z-10">
            <WorkspaceAppInspector
              key={`${props.surface.pluginId}:${props.sessionId}`}
              context={inspectorContext}
              onClose={() => setInspectorOpen(false)}
              onCallTool={callWorkspaceAppTool}
              onOpenAuthorizations={() => navigate(workspaceSettingsRoute(props.workspaceId, "authorizations"))}
            />
          </div>
        ) : (
          <WorkspaceAppInspector
            key={`${props.surface.pluginId}:${props.sessionId}`}
            context={inspectorContext}
            onClose={() => setInspectorOpen(false)}
            onCallTool={callWorkspaceAppTool}
            onOpenAuthorizations={() => navigate(workspaceSettingsRoute(props.workspaceId, "authorizations"))}
          />
        )
      ) : null}
    </div>
  );
}
