/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
import { AlertCircle, Clock, RectangleHorizontal, RectangleVertical, Square, Scan, ChevronDown, ImagePlus, Undo2, Sparkles, Loader2, RotateCw, SlidersHorizontal, Upload, X } from "lucide-react";
import { useNavigate } from "react-router-dom";

import type {
  ImageStudioAiReference,
} from "@/app/types";
import type {
  iPolloWorkPluginUiResource,
  iPolloWorkServerClient,
} from "@/app/lib/ipollowork-server";
import { currentLocale, localeChangedEvent, t } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ImagePreview } from "@/react-app/domains/session/artifacts/preview";
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
import { ServiceWorkbenchFrame } from "./service-workbench-frame";

export type WorkspaceAppModelContext = McpUiUpdateModelContextRequest["params"];
export type WorkspaceAppMessageResult = boolean | { accepted: boolean; sessionId: string };
export type WorkspaceImageSave = { path: string; originalPath: string; saveMode: "copy" | "overwrite"; revision: string };
export type WorkspaceVideoResult = { path: string; sourcePath: string; requestId: string; saveMode?: "copy" | "overwrite"; revision?: string };

type WorkspaceAppFrameProps = {
  active?: boolean;
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
  }) => WorkspaceAppMessageResult | Promise<WorkspaceAppMessageResult>;
  onRequestClose?: () => void;
  onEditGalleryImage?: (path: string) => void;
  onGenerateVideo?: (path: string) => void;
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
  const model = typeof value.model === "string" ? value.model.trim() : "";
  const shared = { sourcePath, sourceName, imageWidth, imageHeight, ...(model ? { model } : {}) };
  if (!sourcePath || imageWidth <= 0 || imageHeight <= 0) return null;
  if (value.kind === "point" && isRecord(value.point)) {
    const x = finiteUnitValue(value.point.x);
    const y = finiteUnitValue(value.point.y);
    return x === null || y === null ? null : { ...shared, kind: "point", point: { x, y } };
  }
  if (value.kind === "selection" && isRecord(value.selection)) {
    const left = finiteUnitValue(value.selection.left);
    const top = finiteUnitValue(value.selection.top);
    const right = finiteUnitValue(value.selection.right);
    const bottom = finiteUnitValue(value.selection.bottom);
    if (left === null || top === null || right === null || bottom === null || left >= right || top >= bottom) return null;
    return { ...shared, kind: "selection", selection: { left, top, right, bottom } };
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
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
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
  onChangeModel?: () => void;
  onDismissError?: () => void;
  composer?: boolean;
  onOptimizePrompt?: (args: Record<string, string>) => Promise<string>;
};

function InspectorImagePreview({ path, readTool, onCallTool }: {
  path: string;
  readTool?: string;
  onCallTool: WorkspaceAppInspectorProps["onCallTool"];
}) {
  const [src, setSrc] = useState("");
  const [mime, setMime] = useState("");
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
        if (!part || typeof part.mime !== "string" || !/^(image\/(png|jpeg|webp)|video\/(mp4|quicktime)|audio\/(mpeg|wav))$/.test(part.mime)
          || typeof part.data !== "string" || part.data.length > 1.5 * 1024 * 1024 || chunks.length >= 20
          || typeof part.size !== "number" || !Number.isSafeInteger(part.size) || part.size > 20 * 1024 * 1024
          || typeof part.nextOffset !== "number" || !Number.isSafeInteger(part.nextOffset) || part.nextOffset <= offset || part.nextOffset > part.size) {
          throw new Error(t("media.studio.preview_limit"));
        }
        const chunk = Uint8Array.from(atob(part.data), char => char.charCodeAt(0));
        if (chunk.byteLength !== part.nextOffset - offset) throw new Error(t("media.studio.read_interrupted"));
        chunks.push(chunk);
        offset = part.nextOffset;
        if (offset === part.size) {
          if (!cancelled) { objectUrl = URL.createObjectURL(new Blob(chunks, { type: part.mime })); setMime(part.mime); setSrc(objectUrl); }
          break;
        }
      }
    })().catch(nextError => { if (!cancelled) setError(serviceErrorMessage(nextError)); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [path, readTool, onCallTool]);
  if (error) return <span role="status" className="px-3 text-[11px] text-destructive">{error}</span>;
  if (!src) return <Loader2 aria-label={t("media.studio.loading_image")} className="size-5 animate-spin text-muted-foreground" />;
  if (mime.startsWith("video/")) return <video src={src} muted playsInline preload="metadata" className="h-full w-full object-contain" />;
  if (mime.startsWith("audio/")) return <audio src={src} controls className="w-full" />;
  return <img src={src} alt={t("media.studio.selected_preview")} referrerPolicy="no-referrer" className="max-h-full w-full object-contain"
    onError={() => setError(t("media.studio.preview_error"))} />;
}

function WorkspaceAppInspector({ context, onClose, onCallTool, onOpenAuthorizations, onChangeModel, onDismissError, onOptimizePrompt, composer = false }: WorkspaceAppInspectorProps) {
  useSyncExternalStore(useCallback(listener => {
    window.addEventListener(localeChangedEvent, listener);
    return () => window.removeEventListener(localeChangedEvent, listener);
  }, []), currentLocale, currentLocale);
  const formRef = useRef<HTMLFormElement>(null);
  const [customWidth,setCustomWidth]=useState("16");
  const [customHeight,setCustomHeight]=useState("9");
  const activeRef = useRef(true);
  useEffect(() => { activeRef.current = true; return () => { activeRef.current = false; }; }, []);
  const [submitting, setSubmitting] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState("");
  const [dismissedError, setDismissedError] = useState("");
  const [uploadingField, setUploadingField] = useState("");
  const [originalPrompt, setOriginalPrompt] = useState<string | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizationElapsed, setOptimizationElapsed] = useState(0);
  const [optimizationCompleted, setOptimizationCompleted] = useState(false);
  useEffect(() => {
    if (!optimizing) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => setOptimizationElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [optimizing]);
  useEffect(() => {
    if (!optimizationCompleted) return;
    const timer = window.setTimeout(() => setOptimizationCompleted(false), 1500);
    return () => window.clearTimeout(timer);
  }, [optimizationCompleted]);
  const optimizationLabel = optimizing
    ? optimizationElapsed >= 45
      ? t("media.parameters.optimizing_wait", { value: optimizationElapsed })
      : t("media.parameters.optimizing", { value: Math.min(95, Math.round(95 * (1 - Math.exp(-optimizationElapsed / 12)))) })
    : optimizationCompleted ? t("media.parameters.optimized") : t("media.parameters.optimize");
  const optimizationRequestRef = useRef<string | null>(null);
  const [hasPrompt, setHasPrompt] = useState(Boolean(context.fields.find(field => field.id === "prompt")?.value));
  const optimizePrompt = async () => {
    const draft = formArguments();
    const prompt = typeof draft.prompt === "string" ? draft.prompt.trim() : "";
    if (!prompt || !onOptimizePrompt || optimizing) return;
    const requestId = crypto.randomUUID();
    optimizationRequestRef.current = requestId;
    setOptimizationElapsed(0); setOptimizationCompleted(false);
    setOptimizing(true); setUpdating(true); setError(""); setDismissedError("");
    try {
      const result = await onCallTool(context.updateTool, draft);
      if (result.isError) throw new Error(callToolResultText(result));
      setUpdating(false);
      const optimized = await onOptimizePrompt(draft);
      if (optimizationRequestRef.current !== requestId || !activeRef.current) return;
      const updated = await onCallTool(context.updateTool, { prompt: optimized });
      if (updated.isError) throw new Error(callToolResultText(updated));
      setOriginalPrompt(prompt);
      setOptimizationCompleted(true);
    } catch (error) {
      if (optimizationRequestRef.current !== requestId || !activeRef.current) return;
      setError(error instanceof Error ? error.message : t("media.studio.optimize_error"));
    } finally {
      if (optimizationRequestRef.current === requestId && activeRef.current) {
        optimizationRequestRef.current = null;
        setOptimizing(false);
        setUpdating(false);
      }
    }
  };

  const upload = async (field: PluginUiInspectorContextV1["fields"][number], file: File) => {
    if (!field.media || updating || submitting || context.submitDisabled) return;
    const draft = formArguments();
    setUpdating(true); setUploadingField(field.id); setError(""); setDismissedError("");
    try {
      if (!file.size || file.size > 20 * 1024 * 1024) throw new Error(t("media.studio.upload_limit"));
      if (!file.type.startsWith(`${field.media.kind}/`)) throw new Error(t("media.studio.media_mismatch"));
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error(t("media.studio.read_error")));
        reader.onerror = () => reject(new Error(t("media.studio.read_error")));
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
    optimizationRequestRef.current = null;
    setOptimizing(false);
    setOriginalPrompt(null);
    setSubmitting(true);
    setError(""); setDismissedError("");
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
    setError(""); setDismissedError("");
    try {
      const update = await onCallTool(context.updateTool, { ...formArguments(), [fieldId]: value });
      if (update.isError) throw new Error(callToolResultText(update) || "Could not update the settings.");
      return true;
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not update the settings.");
      return false;
    } finally {
      setUpdating(false);
    }
  };

  const status = error
    ? { message: error, tone: "error" }
    : context.status;

  useEffect(() => { if (status?.tone !== "error") setDismissedError(""); }, [status?.tone]);

  const compactParameters = composer;
  const outputFields = compactParameters
    ? ["ratio", "size", "resolution", "duration"].flatMap(id => context.fields.filter(field => field.id === id && field.control === "select"))
    : [];
  const outputLabel = (field: PluginUiInspectorContextV1["fields"][number], value: string) => {
    if (field.id === "ratio" && value === "adaptive") return t("media.parameters.auto");
    if (field.id === "resolution" && value === "0.5MP") return t("media.parameters.standard");
    if (field.id === "resolution" && value === "1MP") return t("media.parameters.high");
    if (field.id === "duration" && value === "-1") return t("media.parameters.follow");
    const label = field.options?.find(option => option.value === value)?.label ?? (field.customRatio ? value.replace("x", ":") : value);
    return field.id === "duration" && Number(value) > 0 ? t("media.parameters.seconds", { value: label }) : label;
  };
  const ratioIcon = (value: string) => {
    const [width, height] = value.split(/[:x]/).map(Number);
    const Icon = !height ? Scan : width === height ? Square : width > height ? RectangleHorizontal : RectangleVertical;
    return <Icon className="size-3.5 shrink-0" />;
  };
  const isAdvancedField = (field: PluginUiInspectorContextV1["fields"][number]) =>
    field.advanced || (composer && ["style", "camera", "lighting", "quality"].includes(field.id));

  const renderTextarea = (field: PluginUiInspectorContextV1["fields"][number]) => (
    <Textarea key={`${field.id}:${field.value}`} name={field.id} defaultValue={field.value}
          aria-label={field.label} placeholder={field.placeholder} disabled={submitting || updating}
          onBlur={field.live ? event => {
            // In-form selects and submit already collect every draft field. Do not
            // disable a clicked submit button during the preceding blur event.
            if (event.relatedTarget instanceof Node && formRef.current?.contains(event.relatedTarget)) return;
            void updateLiveField(field.id, event.currentTarget.value);
          } : undefined}
          className={cn("min-h-28 resize-y", composer && "h-full min-h-0 max-h-full resize-none border border-transparent bg-transparent px-3 py-1.5 text-sm shadow-none focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent")} />
  );

  const renderField = (field: PluginUiInspectorContextV1["fields"][number]) => (
    <div key={field.id} className={cn("min-w-0 flex flex-col gap-1", composer && (field.control === "image" ? "h-full w-[100cqh] shrink-0" : field.control === "textarea" ? "h-full min-h-0 min-w-0 flex-1 basis-40" : compactParameters ? "w-fit max-w-full shrink-0" : "w-40 max-w-full shrink-0"))} data-inspector-field={field.id}>
      <span className={cn("text-[10px] text-muted-foreground", composer && "text-xs", composer && (field.id === "prompt" || field.control === "image" || (compactParameters && !isAdvancedField(field))) && "sr-only")}>{field.label}</span>
      {field.control === "image" ? (
        <>
          <div className={cn("relative overflow-hidden rounded-xl border border-border bg-muted/30", composer && "h-full rounded-[16px] border-0 bg-background shadow-none")}>
            <button type="button" aria-label={`${field.value ? t("media.studio.replace") : t("media.studio.upload")}${field.label}`}
              disabled={submitting || updating || context.submitDisabled}
              onClick={() => formRef.current?.querySelector<HTMLInputElement>(`input[data-media-field="${field.id}"]`)?.click()}
              className={cn("flex h-32 w-full items-center justify-center rounded-xl text-center transition-colors hover:bg-muted/70 focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60", composer && "media-reference-card h-full rounded-[16px]")}>
              {uploadingField === field.id ? <span role="status" className="flex items-center gap-2 text-xs"><Loader2 className="size-4 animate-spin" />{t("media.studio.uploading")}</span>
                : field.value ? <InspectorImagePreview key={field.value} path={field.value} readTool={field.media?.readTool} onCallTool={onCallTool} />
                : <span className="flex flex-col items-center gap-2 text-muted-foreground"><ImagePlus className="size-6" />{composer ? <span className="media-reference-label text-[11px]">{field.label}</span> : <><span className="text-xs">点击上传{field.label}</span><span className="text-[10px]">PNG / JPG / WebP · 最大 20 MB</span></>}</span>}
            </button>
            {field.value ? <Tooltip><TooltipTrigger render={<Button type="button" variant="secondary" size="icon"
              className="absolute right-1.5 top-1.5 size-7 rounded-[8px]" aria-label={`${t("media.studio.remove")} ${field.label}`}
              disabled={submitting || updating || context.submitDisabled} onClick={() => void updateLiveField(field.id, "")} />}><X className="size-3.5" /></TooltipTrigger><TooltipContent>移除{field.label}</TooltipContent></Tooltip> : null}
          </div>
          <input type="hidden" name={field.id} value={field.value} />
        </>
      ) : field.control === "textarea" ? (
        field.media ? <>
          <input type="hidden" name={field.id} value={field.value} />
          {field.value.split("\n").filter(Boolean).map((path, index, paths) => <div key={`${index}:${path}`} className="flex min-w-0 items-center gap-1 rounded-lg bg-muted px-2 py-1 text-xs">
            <span className="min-w-0 flex-1 truncate">{path.split(/[\\/]/).pop()}</span>
            <Button type="button" variant="ghost" size="icon" className="size-6 shrink-0" aria-label={`${t("media.studio.remove")} ${field.label} ${index + 1}`}
              disabled={submitting || updating || context.submitDisabled} onClick={() => void updateLiveField(field.id, paths.filter((_, position) => position !== index).join("\n"))}><X className="size-3" /></Button>
          </div>)}
        </> : renderTextarea(field)
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
          <SelectTrigger size={compactParameters ? "sm" : "default"} className={cn("w-full border-transparent bg-muted shadow-none hover:bg-muted/80", composer && "rounded-[8px] bg-muted text-foreground hover:bg-muted/80", compactParameters && "data-[size=sm]:h-7 w-auto max-w-full gap-1.5 px-2 text-xs font-normal text-foreground")} aria-label={field.label}>
            <SelectValue>{compactParameters && field.id === "operation" ? <><span className="media-control-full">{t(`media.parameters.operation.${field.value}`)}</span><span className="media-control-short">{t(`media.parameters.operation_short.${field.value}`)}</span></> : field.live ? field.options?.find(option => option.value === field.value)?.label : undefined}</SelectValue>
            {compactParameters && field.id === "duration" && Number(field.value) > 0 ? <span>秒</span> : null}
          </SelectTrigger>
          <SelectContent align="start" className={compactParameters ? "media-composer-controls" : undefined}>{field.options?.map(option => (
            <SelectItem key={option.value} value={option.value} className={compactParameters ? "text-xs font-normal text-foreground" : undefined} disabled={option.disabled}>{compactParameters && field.id === "operation" ? t(`media.parameters.operation.${option.value}`) : option.label}</SelectItem>
          ))}</SelectContent>
        </Select>
      )}
      {field.media ? <>
        <input type="file" hidden data-media-field={field.id} aria-label={`${t("media.studio.upload")} ${field.label}`}
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

  return (<>
    {composer && status?.tone === "error" && status.message !== dismissedError ? <div role="alert" data-composer-error className="flex w-full min-w-0 items-start gap-2 rounded-[16px] bg-destructive/10 px-3 py-2 text-xs text-foreground">
      <AlertCircle className="size-4 shrink-0 text-destructive" />
      <span className="min-w-0 flex-1 break-words">{status.message}</span>
      {onChangeModel && /模型|model|参考素材|reference/i.test(status.message) ? <Button type="button" variant="ghost" size="sm" className="ml-auto h-7 shrink-0 px-2 text-xs" onClick={onChangeModel}>{t("media.parameters.change_model")}</Button> : null}
      <Button type="button" variant="ghost" size="icon" className="size-7 shrink-0" aria-label={t("media.parameters.dismiss_error")} onClick={() => { setDismissedError(status.message); setError(""); onDismissError?.(); }}><X className="size-3.5" /></Button>
    </div> : null}
    <StudioInspectorPanel
      ariaLabel={context.title}
      className={composer ? "media-composer-controls composer-card w-full rounded-[16px] border-0 bg-card text-card-foreground shadow-none" : undefined}
      header={composer ? undefined : <StudioInspectorHeader
        title={context.title}
        description={context.description}
        icon={<SlidersHorizontal />}
        closeLabel="Close settings"
        onClose={onClose}
      />}
      bodyClassName={cn("px-4 py-3.5", composer && "@container py-2 [container-name:media-composer]")}
      testId="workspace-app-inspector"
    >
      <form ref={formRef} onInput={() => setHasPrompt(Boolean(formRef.current?.querySelector<HTMLTextAreaElement>('textarea[name="prompt"]')?.value.trim()))} className={composer ? "flex h-full min-h-0 flex-col gap-2" : "space-y-3"} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        {composer ? <>
          <div className="flex min-h-0 w-full flex-1 items-stretch gap-3 overflow-hidden [container-type:size] [container-name:media-reference-row]">
          {context.fields.some(field => field.media && field.control === "textarea") ? <div className="flex h-full max-w-[45%] shrink-0 items-stretch gap-2 overflow-x-auto [scrollbar-width:none]" data-reference-strip>
            {context.fields.filter(field => field.media && field.control === "textarea").map(field => <div key={field.id} className="contents">
              <input type="hidden" name={field.id} value={field.value} />
              <input type="file" hidden data-media-field={field.id} aria-label={`${t("media.studio.upload")} ${field.label}`} accept={field.media?.kind === "image" ? "image/png,image/jpeg,image/webp" : field.media?.kind === "video" ? "video/mp4,video/quicktime" : "audio/mpeg,audio/wav"} onChange={event => {const file=event.currentTarget.files?.[0];event.currentTarget.value="";if(file)void upload(field,file);}} />
              {field.value.split("\n").filter(Boolean).map((path,index,paths) => <div key={`${path}:${index}`} className="media-reference-card relative flex h-full w-[100cqh] shrink-0 flex-col overflow-hidden rounded-[16px] bg-muted p-2" title={path.split(/[\\/]/).pop()}>
                <div className="min-h-0 flex-1"><InspectorImagePreview path={path} readTool={field.media?.readTool} onCallTool={onCallTool} /></div>
                <span className="media-reference-label truncate text-[10px]">{path.split(/[\\/]/).pop()}</span>
                <Button type="button" variant="secondary" size="icon" className="absolute right-1 top-1 size-5" aria-label={`${t("media.studio.remove")} ${field.label} ${index+1}`} disabled={submitting||updating||context.submitDisabled} onClick={()=>void updateLiveField(field.id,paths.filter((_,i)=>i!==index).join("\n"))}><X className="size-3" /></Button>
              </div>)}
            </div>)}
            <DropdownMenu><DropdownMenuTrigger render={<Button type="button" variant="secondary" className="media-reference-card h-full min-w-0 w-[100cqh] shrink-0 flex-col gap-1 rounded-[16px] bg-muted/30 p-0 text-muted-foreground shadow-none hover:bg-muted/70" disabled={submitting||updating||context.submitDisabled} />}><ImagePlus className="size-6" /><span className="media-reference-label text-[11px]">{t("media.studio.add_reference")}</span></DropdownMenuTrigger><DropdownMenuContent positionerClassName="z-[70]">
              {context.fields.filter(field=>field.media&&field.control==="textarea").map(field=><DropdownMenuItem key={field.id} onClick={()=>formRef.current?.querySelector<HTMLInputElement>(`input[data-media-field="${field.id}"]`)?.click()}>{uploadingField===field.id?t("media.studio.uploading"):field.label}</DropdownMenuItem>)}
            </DropdownMenuContent></DropdownMenu>
          </div> : null}
            {context.fields.filter(field => !isAdvancedField(field) && field.control === "image").map(renderField)}
            {context.fields.filter(field => !isAdvancedField(field) && field.id === "prompt").map(renderField)}
          </div>

        </> : context.fields.filter(field => !isAdvancedField(field)).map(renderField)}
        <div className={compactParameters ? "media-composer-footer flex shrink-0 items-center gap-2" : composer ? "flex max-h-[70%] shrink-0 flex-wrap items-end gap-2 overflow-y-auto" : "contents"}>
          <div className={compactParameters ? "flex min-w-0 items-center gap-2" : composer ? "flex min-w-0 max-w-full items-end gap-2 overflow-x-auto" : "contents"}>
          {composer ? context.fields.filter(field => !isAdvancedField(field) && field.control !== "image" && field.control !== "textarea" && !outputFields.includes(field)).map(renderField) : null}
        {outputFields.length > 0 ? <>
          {outputFields.map(field => <input key={field.id} type="hidden" name={field.id} value={field.value} />)}
          <Popover>
            <PopoverTrigger render={<Button type="button" variant="secondary" className="h-7 gap-1.5 rounded-[8px] bg-muted px-2 text-xs font-normal text-foreground shadow-none" />} aria-label={t("media.parameters.summary")} data-output-settings>
              {outputFields.map((field, index) => <span key={field.id} title={field.id === "resolution" && ["0.5MP", "1MP"].includes(field.value) ? t("media.parameters.pixels", { value: field.value, count: field.value === "0.5MP" ? 50 : 100 }) : undefined} className={cn("media-output-value flex items-center gap-1.5", index > 0 && "border-l border-border pl-2")}>
                {["ratio", "size"].includes(field.id) ? ratioIcon(field.value) : field.id === "duration" ? <Clock className="size-3.5" /> : null}
                {outputLabel(field, field.value)}
              </span>)}
              <span className="media-output-compact">{t("media.parameters.settings")}</span><ChevronDown className="size-3" />
            </PopoverTrigger>
            <PopoverContent align="start" side="top" className="media-composer-controls max-h-[var(--available-height)] w-[min(360px,calc(100vw-24px))] gap-3 overflow-y-auto rounded-[16px] bg-background p-2.5" aria-label={t("media.parameters.title")}>
              {outputFields.map(field => <fieldset key={field.id} className="min-w-0" disabled={submitting || updating || context.submitDisabled}>
                <legend className="mb-1.5 text-xs font-normal text-muted-foreground">{field.id === "size" ? field.label : t(`media.parameters.${field.id}`)}</legend>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(44px,1fr))] gap-1 rounded-lg bg-muted p-1">
                  {field.options?.map(option => <button key={option.value} type="button" title={field.id === "resolution" && ["0.5MP", "1MP"].includes(option.value) ? t("media.parameters.pixels", { value: option.value, count: option.value === "0.5MP" ? 50 : 100 }) : undefined} aria-pressed={field.value === option.value} disabled={option.disabled}
                    className={cn("flex min-h-7 min-w-0 flex-col items-center justify-center gap-0.5 rounded-md px-1 py-1 text-xs font-normal text-foreground transition-colors hover:bg-background/60 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40", field.value === option.value && "bg-background text-foreground")}
                    onClick={() => void updateLiveField(field.id, option.value)}>
                    {["ratio", "size"].includes(field.id) ? ratioIcon(option.value) : null}{outputLabel(field, option.value)}
                  </button>)}
                </div>
                {field.customRatio ? <div className="mt-3 space-y-2">
                  <p className="text-xs text-muted-foreground">{t("media.parameters.custom_ratio_hint")}</p>
                  <div className="flex items-center gap-2">
                    <input aria-label={t("media.parameters.width")} type="number" min="1" max="999" value={customWidth} onChange={event=>setCustomWidth(event.target.value)} className="h-7 w-20 min-w-0 rounded-md bg-muted px-2 text-xs" />
                    <span>:</span>
                    <input aria-label={t("media.parameters.height")} type="number" min="1" max="999" value={customHeight} onChange={event=>setCustomHeight(event.target.value)} className="h-7 w-20 min-w-0 rounded-md bg-muted px-2 text-xs" />
                    <Button type="button" variant="secondary" className="h-7 px-2 text-xs" disabled={!/^[1-9]\d{0,2}$/.test(customWidth)||!/^[1-9]\d{0,2}$/.test(customHeight)} onClick={()=>void updateLiveField(field.id,`${customWidth}x${customHeight}`)}>{t("media.parameters.apply")}</Button>
                  </div>
                </div> : null}
              </fieldset>)}
            </PopoverContent>
          </Popover>
        </> : null}
          </div>
        {composer && context.fields.some(isAdvancedField) ? <>
          {context.fields.filter(isAdvancedField).map(field => <input key={field.id} type="hidden" name={field.id} value={field.value} />)}
          <Popover>
            <PopoverTrigger render={<Button type="button" variant="secondary" className="media-icon-action h-7 shrink-0 gap-1.5 rounded-lg bg-muted px-2 text-xs font-normal text-foreground shadow-none" />} aria-label={t("media.parameters.preferences")}>
              <SlidersHorizontal className="size-3.5" />
              <span className="media-action-label">{(() => { const style = context.fields.find(field => field.id === "style"); return style && style.value !== "auto" ? style.options?.find(option => option.value === style.value)?.label : t("media.parameters.preferences"); })()}</span>
              <ChevronDown className="media-action-label size-3" />
            </PopoverTrigger>
            <PopoverContent align="start" side="top" className="media-composer-controls max-h-[var(--available-height)] w-[min(360px,calc(100vw-24px))] space-y-3 overflow-y-auto rounded-2xl bg-background p-2.5" aria-label={t("media.parameters.preferences")}>
              {context.fields.filter(isAdvancedField).map(field => <fieldset key={field.id} disabled={submitting || updating || context.submitDisabled}>
                <legend className="mb-1.5 text-xs text-muted-foreground">{field.label}</legend>
                <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
                  {field.options?.map(option => <button key={option.value} type="button" aria-pressed={field.value === option.value} disabled={option.disabled} className={cn("min-h-7 rounded-md px-2 py-1 text-xs text-foreground hover:bg-background/60 disabled:opacity-40", field.value === option.value && "bg-background")} onClick={() => void updateLiveField(field.id, option.value)}>{option.label}</button>)}
                </div>
              </fieldset>)}
            </PopoverContent>
          </Popover>
        </> : context.fields.some(field => isAdvancedField(field)) ? (
          <details className={cn("rounded-xl border border-border p-3", composer && "order-10 w-full border-0 p-0")}>
            <summary className="cursor-pointer text-xs font-medium">{context.advancedLabel ?? (composer ? t("media.studio.more_settings") : "Advanced")}</summary>
            <div className={composer ? "mt-1 flex flex-wrap gap-3 bg-background" : "mt-4 space-y-4"}>{context.fields.filter(field => isAdvancedField(field)).map(renderField)}</div>
            {composer && status?.tone === "info" ? <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{status.message}</p> : null}
          </details>
        ) : null}

        {status && (!composer || status.tone === "success") ? (
          <p
            className={cn(
              "rounded-[16px] px-3 py-2 text-xs leading-5",
              composer && "order-20 w-full",
              status.tone === "error" && "bg-destructive/10 text-destructive",
              status.tone === "success" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
              status.tone === "info" && "bg-muted text-muted-foreground",
            )}
            role="status"
          >
            {status.message}
          </p>
        ) : null}

        <div className={compactParameters ? "ml-auto flex shrink-0 items-center justify-end gap-2" : composer ? "ml-auto flex max-w-full flex-wrap items-center justify-end gap-2" : "w-full"} data-inspector-actions>
        {composer && onOptimizePrompt ? <>
          {originalPrompt !== null && !optimizing ? <Button type="button" variant="ghost" size="sm" aria-label={t("media.parameters.undo")} title={t("media.parameters.undo")} className={compactParameters ? "media-icon-action h-7 px-2 text-xs font-normal text-foreground" : undefined} disabled={updating || submitting || optimizing}
            onClick={async () => { if (await updateLiveField("prompt", originalPrompt)) setOriginalPrompt(null); }}><Undo2 className="size-4" /><span className="media-action-label">{t("media.parameters.undo")}</span></Button> : null}
          <Button type="button" variant="ghost" className={cn("h-9 rounded-[8px]", compactParameters && "media-icon-action h-7 px-2 text-xs font-normal text-foreground")} disabled={!hasPrompt || updating || submitting || optimizing || context.submitDisabled}
            aria-label={optimizationLabel} title={optimizationLabel} aria-busy={optimizing} onClick={() => void optimizePrompt()}>
            {optimizing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}<span className="media-action-label">{optimizationLabel}</span>
          </Button>
        </> : null}
        <Button type="submit" className={cn("w-full rounded-xl", composer && !onOptimizePrompt && "ml-auto", composer && "h-9 w-auto min-w-28 shrink-0 rounded-[8px] shadow-none", compactParameters && "media-generate-action h-7 min-w-20 px-2.5 text-xs font-normal")} disabled={submitting || updating || context.submitDisabled}>
          {submitting ? <Loader2 className="animate-spin" /> : null}
          {compactParameters ? <><span className="media-control-full">{context.submitLabel}</span><span className="media-control-short">{t(/处理中|Processing/.test(context.submitLabel) ? "media.parameters.processing" : "media.parameters.generate_short")}</span></> : context.submitLabel}
        </Button>
        </div>
        </div>
      </form>
    </StudioInspectorPanel>
  </>);
}

export function WorkspaceAppFrame(props: WorkspaceAppFrameProps) {
  if (props.surface.resource.type === "local-service") {
    return <ServiceWorkbenchFrame {...props} />;
  }
  return <McpWorkspaceAppFrame {...props} />;
}

function McpWorkspaceAppFrame(props: WorkspaceAppFrameProps) {
  const platform = usePlatform();
  const navigate = useNavigate();
  const inspectorBelowAppToolbar = props.surface.pluginId === "image-studio" || props.surface.pluginId === "video-console";
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [fileInfo, setFileInfo] = useState<{ rows: { label: string; value: string }[]; prompt: string } | null>(null);
  const [downloadMenu, setDownloadMenu] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [imageVideoMenu, setImageVideoMenu] = useState<{path:string;left:number;top:number}|null>(null);
  const [modelMenu, setModelMenu] = useState<{ value: string; options: { id: string; label: string; disabled: boolean }[]; left: number; top: number; width: number; height: number; manageLabel: string } | null>(null);
  const [imagePreview, setImagePreview] = useState<{ src: string; name: string; path: string } | null>(null);
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
      if (!["image-studio", "video-console"].includes(props.surface.pluginId) || event.source !== iframe?.contentWindow || !isRecord(event.data)) return;
      if (event.data.type === `ipollowork:${props.surface.pluginId}:file-info-close`) { setFileInfo(null); return; }
      if (event.data.type === `ipollowork:${props.surface.pluginId}:file-info`) {
        const { rows, prompt } = event.data;
        if (!Array.isArray(rows) || typeof prompt !== "string" || prompt.length > 16000) return;
        setFileInfo({ rows: rows.slice(0, 16).flatMap((row: unknown) => isRecord(row) && typeof row.label === "string" && typeof row.value === "string" ? [{ label: row.label.slice(0, 80), value: row.value.slice(0, 1000) }] : []), prompt });
        return;
      }
      if (props.surface.pluginId === "video-console" && event.data.type === "ipollowork:video-console:download-menu") {
        const { left, top, width, height } = event.data;
        if (typeof left !== "number" || typeof top !== "number" || typeof width !== "number" || typeof height !== "number" || ![left, top, width, height].every(Number.isFinite)) return;
        const bounds = iframe.getBoundingClientRect();
        setDownloadMenu({ left: bounds.left + left, top: bounds.top + top, width, height });
        return;
      }
      if (["video-console", "image-studio"].includes(props.surface.pluginId) && event.data.type === `ipollowork:${props.surface.pluginId}:download-file`) {
        const { blob, name } = event.data;
        if (!(blob instanceof Blob) || blob.size > 100 * 1024 * 1024 || !["video/mp4", "video/quicktime", "image/png", "image/jpeg", "image/webp"].includes(blob.type) || typeof name !== "string") return;
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = name.split(/[\\/]/).pop() || "video.mp4";
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        return;
      }
      if (event.data.type === `ipollowork:${props.surface.pluginId}:model-menu`) {
        const data = event.data;
        if (typeof data.value !== "string" || typeof data.manageLabel !== "string" || !Array.isArray(data.options)
          || typeof data.left !== "number" || typeof data.top !== "number" || typeof data.width !== "number" || typeof data.height !== "number"
          || ![data.left, data.top, data.width, data.height].every(Number.isFinite)) return;
        const options = data.options.flatMap((entry: unknown) => isRecord(entry) && typeof entry.id === "string" && typeof entry.label === "string" && typeof entry.disabled === "boolean"
          ? [{ id: entry.id, label: entry.label, disabled: entry.disabled }] : []);
        const bounds = iframe.getBoundingClientRect();
        setModelMenu({ value: data.value, options, left: bounds.left + data.left, top: bounds.top + data.top, width: data.width, height: data.height, manageLabel: data.manageLabel });
        return;
      }
      if (props.surface.pluginId === "video-console" && event.data.type === "ipollowork:video-console:list-media") {
        if (!props.sessionId) return;
        void props.client.listSessionArtifacts(props.workspaceId, props.sessionId, 60).then(page => {
          iframe.contentWindow?.postMessage({ type: "ipollowork:video-console:media-list", paths: page.items.filter(item => /\.(png|jpe?g|webp|mp4|mov)$/i.test(item.path)).slice(0, 12).map(item => item.path) }, "*");
        }).catch(() => iframe.contentWindow?.postMessage({ type: "ipollowork:video-console:media-list", error: t("media.studio.outputs_error") }, "*"));
        return;
      }
      if (props.surface.pluginId === "image-studio" && typeof event.data.path === "string") {
        if (event.data.type === "ipollowork:image-studio:generate-video") { props.onGenerateVideo?.(event.data.path); return; }
        if (event.data.type === "ipollowork:image-studio:video-menu" && typeof event.data.left === "number" && typeof event.data.top === "number") { const rect=iframe.getBoundingClientRect();setImageVideoMenu({path:event.data.path,left:rect.left+event.data.left,top:rect.top+event.data.top});return; }
      }
      if (props.surface.pluginId === "video-console" && event.data.type === "ipollowork:video-console:edit-image" && typeof event.data.path === "string") { props.onEditGalleryImage?.(event.data.path); return; }
      if (props.surface.pluginId === "video-console" && event.data.type === "ipollowork:video-console:preview") {
        const data = event.data;
        if (typeof data.src === "string" && data.src.length <= 140*1024*1024 && /^data:(image\/(png|jpeg|webp)|video\/(mp4|quicktime));base64,/.test(data.src) && typeof data.name === "string" && typeof data.path === "string") setImagePreview({src:data.src,name:data.name,path:data.path});
        return;
      }
      if (props.surface.pluginId === "video-console" && event.data.type === "ipollowork:video-console:ask-ai") {
        const { path, time } = event.data;
        if (!props.sessionId || typeof path !== "string" || !path.trim() || typeof time !== "number" || !Number.isFinite(time) || time < 0) return;
        window.dispatchEvent(new CustomEvent("ipollowork:add-video-reference", { detail: { sessionId: props.sessionId, path, time } }));
        props.onDisplayModeChange?.("inline");
        window.dispatchEvent(new Event("ipollowork:focusPrompt"));
        return;
      }
      if (props.surface.pluginId !== "image-studio") return;
      if (event.data.type === "ipollowork:image-studio:manage-connections") {
        navigate(workspaceSettingsRoute(props.workspaceId, "authorizations"));
        return;
      }
      if (event.data.type === "ipollowork:image-studio:preview") {
        if (typeof event.data.src !== "string" || event.data.src.length > 36 * 1024 * 1024 || !/^data:image\/(png|jpeg|webp);base64,/.test(event.data.src)
          || typeof event.data.name !== "string" || typeof event.data.path !== "string") return;
        setImagePreview({ src: event.data.src, name: event.data.name, path: event.data.path });
        return;
      }
      if (event.data.type === "ipollowork:image-studio:list-images") {
        if (!props.sessionId) {
          iframe?.contentWindow?.postMessage({ type: "ipollowork:image-studio:image-list", paths: [] }, "*");
          return;
        }
        void props.client.listSessionArtifacts(props.workspaceId, props.sessionId, null).then(page => {
          iframe?.contentWindow?.postMessage({ type: "ipollowork:image-studio:image-list", paths: page.items.filter(item => /\.(png|jpe?g|webp)$/i.test(item.path)).slice(0, 12).map(item => item.path) }, "*");
        }).catch(() => {
          iframe?.contentWindow?.postMessage({ type: "ipollowork:image-studio:image-list", error: t("media.studio.outputs_retry") }, "*");
        });
        return;
      }
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
  }, [navigate, props.client, props.workspaceId, props.onDisplayModeChange, props.onEditGalleryImage, props.onGenerateVideo, props.sessionId, props.surface.pluginId, resource]);

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
      const result = await sendMessage({ text, modelContext: modelContextRef.current });
      return (typeof result === "boolean" ? result : result.accepted) ? {} : { isError: true };
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
      if (!entry || disposed || entry.contentRect.width <= 0 || entry.contentRect.height <= 0) return;
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
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

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

  useEffect(() => {
    const sourcePath = props.launch?.intent === "edit-image" ? props.launch.source?.path : undefined;
    if (!bridgeReady || props.surface.pluginId !== "image-studio" || !sourcePath) return;
    void callWorkspaceAppTool("open_image", { sourcePath });
  }, [bridgeReady, callWorkspaceAppTool, props.launch, props.surface.pluginId]);

  const controlActions = useMemo<iPolloWorkControlAction[]>(() => props.active === false || props.placement !== "workspace" ? [] : [
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
  ], [bridgeReady, callWorkspaceAppTool, developmentPreviewActive, props.active, props.placement, props.sessionId, props.surface.label]);
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
    <div className={cn("relative flex h-full min-h-0 w-full overflow-hidden bg-background", inspectorBelowAppToolbar && inspectorOpen && inspectorContext && "flex-col bg-[#f4f4f2] dark:bg-[#151515]", props.className)}
      style={inspectorBelowAppToolbar && inspectorOpen && inspectorContext ? { backgroundImage: "radial-gradient(circle at 1px 1px, rgba(113,113,122,.13) 1px, transparent 0)", backgroundSize: "20px 20px", backgroundPosition: "0 52px" } : undefined}>
      <iframe
        ref={iframeRef}
        title={props.surface.label}
        className={cn(
          "h-full min-w-0 border-0 bg-background",
          inspectorBelowAppToolbar ? "w-full flex-1 min-h-0 bg-transparent" : "flex-1",
        )}
        sandbox="allow-scripts allow-same-origin"
        allow={buildAllowAttribute(resource.resource.ui.permissions)}
        data-development-preview={props.developmentPreview ? "plugin-workshop" : undefined}
        data-preview-revision={props.developmentPreview?.revision}
      />
      {props.active !== false && fileInfo ? <aside aria-label={t("media.studio.file_info")} className="absolute inset-y-0 right-0 z-20 flex w-[340px] max-w-full flex-col border-l bg-background p-4 shadow-sm" onKeyDown={event => { if (event.key === "Escape") setFileInfo(null); }}>
        <div className="mb-4 flex items-center justify-between"><h2 className="text-sm font-semibold">{t("media.studio.file_info")}</h2><Button autoFocus variant="ghost" size="icon" aria-label={t("media.studio.close_info")} onClick={() => setFileInfo(null)}><X className="size-4" /></Button></div>
        <div className="min-h-0 overflow-y-auto"><dl className="space-y-3">{fileInfo.rows.map(row => <div key={row.label} className="grid grid-cols-[80px_1fr] gap-3 text-xs"><dt className="text-muted-foreground">{row.label}</dt><dd className="break-words whitespace-pre-wrap">{row.value}</dd></div>)}</dl>
          <div className="mt-5 flex items-center justify-between"><h3 className="text-xs font-medium">{t("media.studio.generation_prompt")}</h3>{fileInfo.prompt ? <Button size="sm" variant="ghost" onClick={() => void navigator.clipboard.writeText(fileInfo.prompt)}>{t("media.studio.copy")}</Button> : null}</div>
          <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-6 text-muted-foreground">{fileInfo.prompt || t("media.studio.no_record")}</p>
        </div>
      </aside> : null}
      {inspectorOpen && inspectorContext ? (
        inspectorBelowAppToolbar ? (
          <div className="z-10 flex shrink-0 justify-center px-4 pb-4">
            <div className="pointer-events-auto flex w-full max-w-[760px] flex-col gap-2">
              <WorkspaceAppInspector
                key={`${props.surface.pluginId}:${props.sessionId}`}
                context={inspectorContext}
                composer
                onDismissError={() => iframeRef.current?.contentWindow?.postMessage({ type: `ipollowork:${props.surface.pluginId}:dismiss-error` }, "*")}
                onChangeModel={() => iframeRef.current?.contentWindow?.postMessage({ type: `ipollowork:${props.surface.pluginId}:open-model-menu` }, "*")}
                onClose={() => setInspectorOpen(false)}
                onCallTool={callWorkspaceAppTool}
                onOptimizePrompt={async args => {
                  const video = props.surface.pluginId === "video-console";
                  const current = video ? await callWorkspaceAppTool("set_parameters", {}) : undefined;
                  const model = current?.structuredContent?.model;
                  const response = await props.client.callExtensionAction({
                    extensionId: "openai-image-generation", action: "prompt_optimize",
                    args: { prompt: args.prompt, referencePath: video ? undefined : args.referencePath, mediaKind: video ? "video" : "image", settings: { ...args, ...(typeof model === "string" ? { model } : {}) } },
                    context: { workspaceId: props.workspaceId, directory: props.workspaceRoot },
                  });
                  if (!response.ok) throw new Error(response.message);
                  if (!isRecord(response.result) || typeof response.result.prompt !== "string") throw new Error(t("media.studio.invalid_optimization"));
                  return response.result.prompt;
                }}
                onOpenAuthorizations={() => navigate(workspaceSettingsRoute(props.workspaceId, "authorizations"))}
              />
            </div>
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
      {props.active !== false && imageVideoMenu ? <DropdownMenu open onOpenChange={open=>{if(!open)setImageVideoMenu(null);}}><DropdownMenuTrigger aria-label={t("media.parameters.more_actions")} style={{position:"fixed",left:imageVideoMenu.left,top:imageVideoMenu.top,opacity:0}}/><DropdownMenuContent positionerClassName="z-[70]"><DropdownMenuItem onClick={()=>{props.onGenerateVideo?.(imageVideoMenu.path);setImageVideoMenu(null);}}><Sparkles className="size-4"/>{t("media.parameters.generate_video")}</DropdownMenuItem></DropdownMenuContent></DropdownMenu> : null}
      {props.active !== false && downloadMenu ? <DropdownMenu open onOpenChange={open => { if (!open) setDownloadMenu(null); }}>
        <DropdownMenuTrigger aria-label={t("media.studio.save_assets")} style={{ position: "fixed", ...downloadMenu, opacity: 0 }} />
        <DropdownMenuContent align="end" positionerClassName="z-[70]">
          {[{ value: "video", label: t("media.studio.save_video") }, { value: "first", label: t("media.studio.save_first") }, { value: "last", label: t("media.studio.save_last") }].map(option => <DropdownMenuItem key={option.value} onClick={() => {
            iframeRef.current?.contentWindow?.postMessage({ type: "ipollowork:video-console:download", value: option.value }, "*");
            setDownloadMenu(null);
          }}>{option.label}</DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu> : null}
      {props.active !== false && modelMenu ? <DropdownMenu open onOpenChange={open => {
        if (!open) {
          setModelMenu(null);
          iframeRef.current?.contentWindow?.postMessage({ type: `ipollowork:${props.surface.pluginId}:model-menu-closed` }, "*");
        }
      }}>
        <DropdownMenuTrigger aria-label={props.surface.pluginId === "video-console" ? t("media.studio.video_model") : t("media.studio.image_model")} style={{ position: "fixed", left: modelMenu.left, top: modelMenu.top, width: modelMenu.width, height: modelMenu.height, opacity: 0 }} />
        <DropdownMenuContent align="end" className="w-64" positionerClassName="z-[70]">
          <DropdownMenuRadioGroup value={modelMenu.value} onValueChange={value => {
            iframeRef.current?.contentWindow?.postMessage({ type: `ipollowork:${props.surface.pluginId}:select-model`, value }, "*");
            setModelMenu(null);
          }}>
            {modelMenu.options.map(option => <DropdownMenuRadioItem key={option.id} value={option.id} disabled={option.disabled}>{option.label}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => {
            setModelMenu(null);
            navigate(workspaceSettingsRoute(props.workspaceId, "authorizations"));
          }}>{modelMenu.manageLabel}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu> : null}
      <Dialog open={props.active !== false && imagePreview !== null} onOpenChange={open => {
        if (open) return;
        iframeRef.current?.contentWindow?.postMessage({ type: `ipollowork:${props.surface.pluginId}:preview-closed`, path: imagePreview?.path }, "*");
        setImagePreview(null);
      }}>
        <DialogContent className="flex h-[min(80dvh,800px)] flex-col gap-4 sm:max-w-[min(90vw,1000px)]" data-testid="image-studio-preview" aria-describedby={undefined}>
          <DialogHeader className="shrink-0 pr-8"><DialogTitle className="truncate">{imagePreview?.name}</DialogTitle></DialogHeader>
          {imagePreview?.src.startsWith("data:video/") ? <video src={imagePreview.src} controls autoPlay playsInline className="min-h-0 flex-1 rounded-lg bg-black object-contain" /> : imagePreview ? <ImagePreview src={imagePreview.src} alt={imagePreview.name} className="min-h-0 flex-1 rounded-lg" /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
