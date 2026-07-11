/** @jsxImportSource react */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlignCenter, AlignLeft, AlignRight, ArrowLeft, Check, Code2, ImagePlus, Link2, Loader2, Minus, MousePointer2, Move, Palette, Paintbrush, Plus, Save, SlidersHorizontal, Sparkles, Square, Type, Undo2, Upload, X } from "lucide-react";

import type { iPolloWorkServerClient } from "@/app/lib/ipollowork-server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/sonner";
import type { OpenTarget } from "../artifacts/open-target";
import {
  buildDesignPreviewDocument,
  DESIGN_MESSAGE_CHANNEL,
  DESIGN_STYLE_FIELDS,
  designSelectionStorageKey,
  designSessionSelectionStorageKey,
  isLocalHtmlPath,
  type DesignField,
  type DesignRuntimeMessage,
  type DesignSelection,
  type DesignStyleField,
} from "./design-html-runtime";
import { getDesignTemplate } from "./design-template-catalog";

type DesignPanelProps = {
  sessionId: string;
  client: iPolloWorkServerClient | null;
  workspaceId: string | null;
  targets: OpenTarget[];
  isRemoteWorkspace?: boolean;
  onClose: () => void;
};

type LoadedHtml = {
  content: string;
  updatedAt: number | null;
};

const COLOR_SWATCHES = ["#111827", "#ffffff", "#7c3aed", "#2563eb", "#059669", "#ea580c", "#dc2626", "#db2777"];

const TYPE_PRESETS = [
  { label: "Display", sample: "Aa", styles: { fontSize: "48px", fontWeight: "700", lineHeight: "1.05", letterSpacing: "-0.025em" } },
  { label: "Heading", sample: "Title", styles: { fontSize: "32px", fontWeight: "650", lineHeight: "1.15", letterSpacing: "-0.015em" } },
  { label: "Body", sample: "Text", styles: { fontSize: "16px", fontWeight: "400", lineHeight: "1.6", letterSpacing: "0em" } },
] satisfies Array<{ label: string; sample: string; styles: Partial<Record<DesignStyleField, string>> }>;

function isDesignRuntimeMessage(value: unknown): value is DesignRuntimeMessage {
  if (!value || typeof value !== "object") return false;
  return Reflect.get(value, "channel") === DESIGN_MESSAGE_CHANNEL
    && (Reflect.get(value, "type") === "selected" || Reflect.get(value, "type") === "editing" || Reflect.get(value, "type") === "draft");
}

function fileName(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

function normalizeHexColor(value: string) {
  const trimmed = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed;
  const rgb = trimmed.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!rgb) return "#111827";
  return `#${rgb.slice(1, 4).map((part) => Math.max(0, Math.min(255, Number(part))).toString(16).padStart(2, "0")).join("")}`;
}

async function imageFileToPortableDataUrl(file: File) {
  const bitmap = await createImageBitmap(file);
  try {
    const render = (maxSide: number, quality: number) => {
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas is unavailable.");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/webp", quality);
    };
    const first = render(1400, 0.82);
    return first.length <= 360_000 ? first : render(960, 0.72);
  } finally {
    bitmap.close();
  }
}

function updateSelectionValue(selection: DesignSelection, field: DesignField, value: string): DesignSelection {
  if (DESIGN_STYLE_FIELDS.includes(field as DesignStyleField)) {
    return {
      ...selection,
      styles: { ...selection.styles, [field]: value },
    };
  }
  return { ...selection, [field]: value };
}

export function DesignPanel({
  sessionId,
  client,
  workspaceId,
  targets,
  isRemoteWorkspace = false,
  onClose,
}: DesignPanelProps) {
  const queryClient = useQueryClient();
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const imageInputRef = React.useRef<HTMLInputElement>(null);
  const catalogQuery = useQuery({
    queryKey: ["design-html-catalog", workspaceId] as const,
    queryFn: async () => {
      if (!client || !workspaceId) return [];
      return client.listWorkspaceFiles(workspaceId);
    },
    enabled: Boolean(client && workspaceId && !isRemoteWorkspace),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });
  const lockedPath = React.useMemo(() => {
    if (!workspaceId || typeof window === "undefined") return "";
    const stored = window.localStorage.getItem(`ipollowork.session-design-path.${sessionId}`)
      || window.localStorage.getItem(designSessionSelectionStorageKey(workspaceId, sessionId))
      || "";
    if (stored) return stored;
    const template = getDesignTemplate(window.localStorage.getItem(`ipollowork.session-template.${sessionId}`) ?? undefined);
    return template ? `design/${template.fileName}` : "";
  }, [sessionId, workspaceId]);
  const htmlTargets = React.useMemo(() => {
    const unique = new Map<string, { value: string }>();
    catalogQuery.data?.forEach((entry) => {
      if (entry.kind === "file" && isLocalHtmlPath(entry.path)) unique.set(entry.path, { value: entry.path });
    });
    targets.forEach((target) => {
      if (target.kind === "file" && target.exists !== false && isLocalHtmlPath(target.value)) {
        unique.set(target.value, target);
      }
    });
    const entries = Array.from(unique.values()).sort((left, right) => left.value.localeCompare(right.value));
    return lockedPath ? entries.filter((target) => target.value === lockedPath) : entries;
  }, [catalogQuery.data, lockedPath, targets]);
  const versionTargets = React.useMemo(
    () => (catalogQuery.data ?? [])
      .filter((entry) => entry.kind === "file" && entry.path.startsWith(`design/.versions/${sessionId}/`) && isLocalHtmlPath(entry.path))
      .sort((left, right) => right.path.localeCompare(left.path)),
    [catalogQuery.data, sessionId],
  );
  const [selectedPath, setSelectedPath] = React.useState("");
  const [editing, setEditing] = React.useState(false);
  const [selection, setSelection] = React.useState<DesignSelection | null>(null);
  const [draft, setDraft] = React.useState("");
  const draftRef = React.useRef("");
  const [pendingCanvasChange, setPendingCanvasChange] = React.useState(false);
  const [savedSource, setSavedSource] = React.useState("");
  const [history, setHistory] = React.useState<string[]>([]);
  const [previewSource, setPreviewSource] = React.useState("");
  const [previewRevision, setPreviewRevision] = React.useState(0);
  const [previewLoaded, setPreviewLoaded] = React.useState(false);
  const [sourceHydrated, setSourceHydrated] = React.useState(false);
  const [quickEdit, setQuickEdit] = React.useState<"text" | "href" | "src" | "color" | "fontSize" | null>(null);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);

  React.useEffect(() => {
    if (!workspaceId || htmlTargets.length === 0) {
      setSelectedPath("");
      return;
    }
    const stored = lockedPath || window.localStorage.getItem(designSessionSelectionStorageKey(workspaceId, sessionId)) || window.localStorage.getItem(designSelectionStorageKey(workspaceId));
    const next = htmlTargets.some((target) => target.value === stored) ? stored : htmlTargets[0]?.value;
    setSelectedPath(next || "");
  }, [htmlTargets, lockedPath, sessionId, workspaceId]);

  const fileQuery = useQuery<LoadedHtml>({
    queryKey: ["design-html", workspaceId, selectedPath] as const,
    queryFn: async () => {
      if (!client || !workspaceId || !selectedPath) throw new Error("Workspace file is not ready.");
      const result = await client.readWorkspaceFile(workspaceId, selectedPath);
      return { content: result.content, updatedAt: result.updatedAt ?? null };
    },
    enabled: Boolean(client && workspaceId && selectedPath && !isRemoteWorkspace),
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });

  React.useEffect(() => {
    if (!fileQuery.data) return;
    draftRef.current = fileQuery.data.content;
    setPendingCanvasChange(false);
    setDraft(fileQuery.data.content);
    setSavedSource(fileQuery.data.content);
    setHistory([]);
    setSelection(null);
    setQuickEdit(null);
    setAdvancedOpen(false);
    setPreviewSource(fileQuery.data.content);
    setPreviewLoaded(false);
    setSourceHydrated(true);
    setPreviewRevision((current) => current + 1);
  }, [fileQuery.data]);

  React.useEffect(() => {
    const receiveMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow || !isDesignRuntimeMessage(event.data)) return;
      if (event.data.type === "editing") setHistory((current) => [...current, draft]);
      setSelection((current) => {
        if (event.data.type === "selected" || current?.id !== event.data.selection.id) setQuickEdit(null);
        return event.data.selection;
      });
      if (event.data.type === "draft") {
        draftRef.current = event.data.html;
        setDraft(event.data.html);
        setPendingCanvasChange(false);
      }
    };
    window.addEventListener("message", receiveMessage);
    return () => window.removeEventListener("message", receiveMessage);
  }, [draft]);

  const readLatestCanvasHtml = React.useCallback(async () => {
    const frameWindow = iframeRef.current?.contentWindow;
    if (!editing || !frameWindow) return draftRef.current;
    // The visible value of a focused input can be newer than React state while
    // an IME composition is finishing. Flush that exact DOM value to the
    // canvas before requesting the snapshot so Chinese/Japanese/Korean text is
    // never visually changed but omitted from the saved HTML.
    if (selection && quickEdit) {
      const inputSelector = quickEdit === "text"
          ? '[aria-label="Quick edit text"]'
          : quickEdit === "href"
            ? '[aria-label="Quick edit link"]'
            : quickEdit === "src"
              ? '[aria-label="Quick edit image URL"]'
              : quickEdit === "fontSize"
                ? '[aria-label="Quick font size"]'
                : null;
      const input = inputSelector ? document.querySelector<HTMLInputElement>(inputSelector) : null;
      if (input) {
        const field: DesignField = quickEdit === "fontSize" ? "fontSize" : quickEdit;
        const value = quickEdit === "fontSize" ? `${Math.max(1, Number(input.value) || 1)}px` : input.value;
        frameWindow.postMessage({
          channel: DESIGN_MESSAGE_CHANNEL,
          type: "set",
          id: selection.id,
          field,
          value,
          scope: "element",
        }, "*");
      }
    }
    const requestId = crypto.randomUUID();
    return new Promise<string>((resolve) => {
      let settled = false;
      const finish = (html: string) => {
        if (settled) return;
        settled = true;
        window.removeEventListener("message", receiveSnapshot);
        window.clearTimeout(timeout);
        resolve(html);
      };
      const receiveSnapshot = (event: MessageEvent) => {
        const data = event.data;
        if (event.source !== frameWindow || !data || typeof data !== "object") return;
        if (data.channel !== DESIGN_MESSAGE_CHANNEL || data.type !== "snapshot" || data.requestId !== requestId || typeof data.html !== "string") return;
        finish(data.html);
      };
      const timeout = window.setTimeout(() => finish(draftRef.current), 1_000);
      window.addEventListener("message", receiveSnapshot);
      frameWindow.postMessage({ channel: DESIGN_MESSAGE_CHANNEL, type: "snapshot", requestId }, "*");
    });
  }, [editing, quickEdit, selection]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!client || !workspaceId || !selectedPath || !fileQuery.data) {
        throw new Error("Workspace file is not ready.");
      }
      // Read the DOM snapshot directly at save time. This includes the last
      // contenteditable keystroke even when blur/draft messages are still in
      // flight, which is especially important for text nested in controls.
      const content = await readLatestCanvasHtml();
      draftRef.current = content;
      const result = await client.writeWorkspaceFile(workspaceId, {
        path: selectedPath,
        content,
        baseUpdatedAt: fileQuery.data.updatedAt,
      });
      return { result, content };
    },
    onSuccess: ({ result, content }) => {
      queryClient.setQueryData<LoadedHtml>(
        ["design-html", workspaceId, selectedPath] as const,
        { content, updatedAt: result.updatedAt ?? null },
      );
      setDraft(content);
      setSavedSource(content);
      setPendingCanvasChange(false);
      setHistory([]);
      toast.success("Design saved to the workspace.");
    },
    onError: (cause) => {
      const message = cause instanceof Error ? cause.message : "Could not save this design.";
      toast.error(message.includes("changed since") ? "This HTML file changed on disk. Reopen it before saving." : message);
    },
  });

  const restoreVersion = async (versionPath: string) => {
    if (!client || !workspaceId || !lockedPath || !fileQuery.data) return;
    try {
      const snapshot = await client.readWorkspaceFile(workspaceId, versionPath);
      const result = await client.writeWorkspaceFile(workspaceId, {
        path: lockedPath,
        content: snapshot.content,
        baseUpdatedAt: fileQuery.data.updatedAt,
      });
      queryClient.setQueryData<LoadedHtml>(["design-html", workspaceId, lockedPath] as const, { content: snapshot.content, updatedAt: result.updatedAt ?? null });
      toast.success("Version restored.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not restore this version.");
    }
  };

  const chooseFile = (path: string | null) => {
    if (!path || path === selectedPath) return;
    if (draft !== savedSource && !window.confirm("Discard unsaved design changes and open another file?")) return;
    setSelectedPath(path);
    setEditing(false);
    setSelection(null);
    setQuickEdit(null);
    setAdvancedOpen(false);
    setPreviewSource("");
    setPreviewLoaded(false);
    setSourceHydrated(false);
    if (workspaceId) window.localStorage.setItem(designSelectionStorageKey(workspaceId), path);
  };

  const applyField = (field: DesignField, value: string, remember = true) => {
    if (!selection || !editing) return;
    setPendingCanvasChange(true);
    if (remember) setHistory((current) => [...current, draft]);
    setSelection(updateSelectionValue(selection, field, value));
    iframeRef.current?.contentWindow?.postMessage({
      channel: DESIGN_MESSAGE_CHANNEL,
      type: "set",
      id: selection.id,
      field,
      value,
      scope: selection.rangeText && (field === "color" || field === "fontSize" || field === "fontWeight" || field === "letterSpacing") ? "range" : "element",
    }, "*");
  };

  const applyToken = (name: string, value: string) => {
    if (!editing) return;
    setPendingCanvasChange(true);
    setHistory((current) => [...current, draft]);
    iframeRef.current?.contentWindow?.postMessage({
      channel: DESIGN_MESSAGE_CHANNEL,
      type: "set-token",
      name,
      value,
    }, "*");
  };

  const beginQuickEdit = (kind: "text" | "href" | "src" | "color" | "fontSize") => {
    setHistory((current) => [...current, draft]);
    setQuickEdit(kind);
  };

  const applyStyleBatch = (styles: Partial<Record<DesignStyleField, string>>) => {
    if (!selection || !editing) return;
    setPendingCanvasChange(true);
    setHistory((current) => [...current, draft]);
    setSelection((current) => {
      if (!current) return current;
      return Object.entries(styles).reduce(
        (next, [field, value]) => updateSelectionValue(next, field as DesignStyleField, value),
        current,
      );
    });
    Object.entries(styles).forEach(([field, value]) => {
      iframeRef.current?.contentWindow?.postMessage({
        channel: DESIGN_MESSAGE_CHANNEL,
        type: "set",
        id: selection.id,
        field,
        value,
      }, "*");
    });
  };

  const fontSize = Math.max(1, Math.round(Number.parseFloat(selection?.styles.fontSize || "16") || 16));
  const setFontSize = (next: number, remember = false) => applyField("fontSize", `${Math.max(1, Math.min(240, next))}px`, remember);

  const replaceImageFromFile = async (file: File | undefined) => {
    if (!file || !selection || selection.tag !== "img") return;
    if (!file.type.startsWith("image/")) {
      toast.error("Choose an image file to replace this image.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Choose an image smaller than 5 MB.");
      return;
    }
    try {
      const result = await imageFileToPortableDataUrl(file);
      setHistory((current) => [...current, draft]);
      applyField("src", result, false);
      toast.success("Image replaced in the design.");
    } catch {
      toast.error("Could not prepare that image. Try PNG, JPG, or WebP.");
    }
  };

  const undo = () => {
    const previous = history[history.length - 1];
    if (previous === undefined) return;
    draftRef.current = previous;
    setPendingCanvasChange(false);
    setDraft(previous);
    setHistory((current) => current.slice(0, -1));
    setSelection(null);
    setQuickEdit(null);
    setPreviewSource(previous);
    setPreviewLoaded(false);
    setPreviewRevision((current) => current + 1);
  };

  const dirty = pendingCanvasChange || draft !== savedSource;
  const preview = React.useMemo(
    () => buildDesignPreviewDocument(previewSource, editing),
    [editing, previewSource],
  );
  const floatingStyle = selection ? {
    left: `clamp(112px, ${selection.rect.left + selection.rect.width / 2 + 8}px, calc(100% - 112px))`,
    top: `${Math.max(8, selection.rect.top + 8)}px`,
    transform: selection.rect.top > 58 ? "translate(-50%, -100%)" : "translate(-50%, 0)",
  } satisfies React.CSSProperties : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-testid="design-panel">
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        aria-label="Choose replacement image"
        onChange={(event) => {
          replaceImageFromFile(event.currentTarget.files?.[0]);
          event.currentTarget.value = "";
        }}
      />
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <Code2 className="size-4 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">Design</p>
          <p className="truncate text-[11px] text-muted-foreground">Local HTML only</p>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close Design">
          <X />
        </Button>
      </div>

      {isRemoteWorkspace ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
          Design editing is available for local workspaces only.
        </div>
      ) : catalogQuery.isLoading && htmlTargets.length === 0 ? (
        <div className="flex flex-1 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
      ) : htmlTargets.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center">
          <div className="max-w-xs">
            <Code2 className="mx-auto mb-3 size-8 text-muted-foreground" />
            <p className="text-sm font-medium">No local HTML artifacts yet</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Ask iPolloWork to create an HTML file in this task, then open Design to edit it visually.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
            {lockedPath ? (
              <div className="min-w-0 flex flex-1 items-center gap-2"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{fileName(selectedPath)}</p><p className="truncate text-[10px] text-muted-foreground">Current design</p></div>{versionTargets.length > 0 ? <Select value="current" onValueChange={(value) => { if (value && value !== "current") void restoreVersion(value); }}><SelectTrigger size="sm" className="w-32 rounded-lg" aria-label="Design version"><SelectValue>Versions</SelectValue></SelectTrigger><SelectContent><SelectItem value="current">Current version</SelectItem>{versionTargets.map((version, index) => <SelectItem key={version.path} value={version.path}>Restore v{versionTargets.length - index}</SelectItem>)}</SelectContent></Select> : null}</div>
            ) : (
              <Select value={selectedPath} onValueChange={chooseFile}>
                <SelectTrigger size="sm" className="min-w-44 max-w-full flex-1 rounded-lg" aria-label="HTML file">
                  <SelectValue>{fileName(selectedPath)}</SelectValue>
                </SelectTrigger>
                <SelectContent align="start">
                  {htmlTargets.map((target) => (
                    <SelectItem key={target.value} value={target.value}>{target.value}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Label className="flex items-center gap-2 text-xs">
              <Switch
                size="sm"
                checked={editing}
                onCheckedChange={(checked) => {
                  setPreviewSource(draft);
                  setPreviewLoaded(false);
                  setPreviewRevision((current) => current + 1);
                  setEditing(checked);
                  setSelection(null);
                  setQuickEdit(null);
                  setAdvancedOpen(false);
                }}
                aria-label="Edit page"
              />
              Edit page
            </Label>
            {editing ? (
              <div className="ml-auto flex items-center gap-1 rounded-lg border border-border/70 bg-muted/25 p-1" aria-label="Template color theme">
                {["#c96442", "#2563eb", "#7c3aed", "#059669"].map((color) => (
                  <button
                    key={color}
                    type="button"
                    className="size-4 rounded-full border border-black/10 transition-transform hover:scale-110"
                    style={{ backgroundColor: color }}
                    onClick={() => applyToken("--ipw-color-primary", color)}
                    aria-label={`Set template accent ${color}`}
                  />
                ))}
              </div>
            ) : null}
            <Button variant="ghost" size="icon-sm" onClick={undo} disabled={history.length === 0} aria-label="Undo design change">
              <Undo2 />
            </Button>
            <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || (!editing && !dirty)}>
              {saveMutation.isPending ? <Loader2 className="animate-spin" /> : dirty ? <Save /> : <Check />}
              Save
            </Button>
          </div>

          {fileQuery.isLoading || !sourceHydrated ? (
            <div className="flex flex-1 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
          ) : fileQuery.isError ? (
            <div className="p-4 text-sm text-destructive">{fileQuery.error.message}</div>
          ) : (
            <div className="flex min-h-0 flex-1">
              <div className="relative min-w-0 flex-1 overflow-hidden bg-muted/30 p-2">
                <iframe
                  ref={iframeRef}
                  key={`${selectedPath}:${previewRevision}:${editing ? "edit" : "preview"}`}
                  srcDoc={preview}
                  title={`Design preview: ${fileName(selectedPath)}`}
                  className="h-full w-full rounded-lg border border-border bg-white shadow-sm"
                  sandbox="allow-scripts"
                  data-preview-loaded={previewLoaded ? "true" : "false"}
                  onLoad={() => setPreviewLoaded(true)}
                />
                {editing && selection ? (
                  <div
                    className="absolute z-20 flex max-w-[calc(100%-24px)] items-center gap-1 rounded-2xl border border-border/80 bg-background/95 p-1 shadow-xl shadow-black/10 backdrop-blur-xl"
                    style={floatingStyle}
                    role="toolbar"
                    aria-label="Design floating toolbar"
                    data-testid="design-floating-toolbar"
                    onPointerDown={(event) => event.stopPropagation()}
                    onPointerUp={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                  >
                    {quickEdit ? (
                      <>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => setQuickEdit(null)}
                          aria-label="Back to design tools"
                        >
                          <ArrowLeft />
                        </Button>
                        {quickEdit === "color" ? (
                          <div className="flex items-center gap-1 px-0.5" aria-label={selection.colorField === "color" ? "Quick text colors" : "Quick background colors"}>
                            {COLOR_SWATCHES.slice(0, 6).map((color) => (
                              <button
                                key={color}
                                type="button"
                                className="size-6 rounded-full border border-black/10 shadow-sm transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                style={{ backgroundColor: color }}
                                onClick={() => applyField(selection.colorField, color, false)}
                                aria-label={`Set ${selection.colorField === "color" ? "text" : "background"} color ${color}`}
                              />
                            ))}
                            <label
                              className="relative grid size-6 cursor-pointer place-items-center rounded-full border border-border bg-muted text-muted-foreground"
                              aria-label={selection.colorField === "color" ? "Choose custom text color" : "Choose custom background color"}
                            >
                              <Palette className="size-3" />
                              <input
                                type="color"
                                className="absolute inset-0 cursor-pointer opacity-0"
                                value={normalizeHexColor(selection.styles[selection.colorField])}
                                onChange={(event) => applyField(selection.colorField, event.currentTarget.value, false)}
                                aria-label={selection.colorField === "color" ? "Custom text color" : "Custom background color"}
                              />
                            </label>
                          </div>
                        ) : quickEdit === "fontSize" ? (
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon-xs" onClick={() => setFontSize(fontSize - 1)} aria-label="Decrease font size"><Minus /></Button>
                            <Input
                              autoFocus
                              type="number"
                              min={1}
                              max={240}
                              aria-label="Quick font size"
                              className="h-7 w-14 rounded-xl border-0 bg-muted/70 px-1 text-center text-xs shadow-none focus-visible:ring-2"
                              value={fontSize}
                              onChange={(event) => setFontSize(Number(event.currentTarget.value) || 1)}
                            />
                            <span className="text-[10px] text-muted-foreground">px</span>
                            <Button variant="ghost" size="icon-xs" onClick={() => setFontSize(fontSize + 1)} aria-label="Increase font size"><Plus /></Button>
                          </div>
                        ) : (
                          <Input
                            autoFocus
                            aria-label={quickEdit === "text" ? "Quick edit text" : quickEdit === "href" ? "Quick edit link" : "Quick edit image URL"}
                            className="h-7 w-52 rounded-xl border-0 bg-muted/70 px-2.5 text-xs shadow-none focus-visible:ring-2"
                            value={quickEdit === "text" ? selection.text : quickEdit === "href" ? selection.href : selection.src}
                            placeholder={quickEdit === "src" ? "Paste an image URL…" : undefined}
                            onChange={(event) => applyField(quickEdit, event.currentTarget.value, false)}
                            onKeyDown={(event) => {
                              if (event.key === "Escape" || event.key === "Enter") setQuickEdit(null);
                            }}
                          />
                        )}
                        <Button variant="ghost" size="icon-xs" onClick={() => setQuickEdit(null)} aria-label="Done quick editing">
                          <Check />
                        </Button>
                      </>
                    ) : (
                      <>
                        <span className="px-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          {selection.tag}
                        </span>
                        {selection.canEditText ? (
                          <>
                            <Button variant="ghost" size="xs" onClick={() => beginQuickEdit("text")} aria-label="Edit selected text">
                              <Type />
                              Edit text
                            </Button>
                            <Button variant="ghost" size="xs" onClick={() => beginQuickEdit("fontSize")} aria-label="Change selected font size">
                              {fontSize}
                            </Button>
                          </>
                        ) : null}
                        {selection.tag !== "img" ? (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => beginQuickEdit("color")}
                            aria-label={selection.colorField === "color" ? "Change selected text color" : "Change selected background color"}
                            title={selection.colorField === "color" ? "Text color" : "Background color"}
                          >
                            <Palette />
                          </Button>
                        ) : null}
                        {selection.tag === "a" ? (
                          <Button variant="ghost" size="xs" onClick={() => beginQuickEdit("href")} aria-label="Edit selected link">
                            <Link2 />
                            Link
                          </Button>
                        ) : null}
                        {selection.tag === "img" ? (
                          <>
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() => imageInputRef.current?.click()}
                              aria-label="Upload replacement image"
                            >
                              <Upload />
                              Replace
                            </Button>
                            <Button variant="ghost" size="icon-xs" onClick={() => beginQuickEdit("src")} aria-label="Edit image URL">
                              <ImagePlus />
                            </Button>
                          </>
                        ) : null}
                        <Button
                          variant={advancedOpen ? "secondary" : "ghost"}
                          size="icon-xs"
                          onClick={() => setAdvancedOpen((current) => !current)}
                          aria-label="Toggle advanced design settings"
                          aria-pressed={advancedOpen}
                        >
                          <SlidersHorizontal />
                        </Button>
                      </>
                    )}
                  </div>
                ) : null}
              </div>
              {editing && advancedOpen ? (
                <aside className="w-64 shrink-0 overflow-y-auto border-l border-border/70 bg-background" aria-label="Design inspector">
                  {selection ? (
                    <div className="space-y-1 p-2">
                      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border/60 bg-background/95 px-1 py-2 backdrop-blur-xl">
                        <div className="grid size-6 place-items-center rounded-lg bg-primary/10 text-primary"><SlidersHorizontal className="size-3" /></div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold">Design properties</p>
                          <p className="truncate text-[10px] text-muted-foreground">{selection.tag.toUpperCase()} · element {selection.id}</p>
                        </div>
                        <Button variant="ghost" size="icon-xs" onClick={() => setAdvancedOpen(false)} aria-label="Close advanced design settings"><X /></Button>
                      </div>

                      {selection.rangeText ? (
                        <div className="rounded-lg border border-primary/15 bg-primary/5 px-2 py-1.5 text-[9px] text-primary">
                          Formatting selection: “{selection.rangeText.slice(0, 48)}{selection.rangeText.length > 48 ? "…" : ""}”
                        </div>
                      ) : null}

                      {selection.canEditText ? (
                        <InspectorSection icon={<Type />} title="Content">
                          <Input aria-label="Design text" className="h-7 rounded-lg border-0 bg-muted/55 px-2 text-[11px] shadow-none" value={selection.text} onChange={(event) => applyField("text", event.currentTarget.value)} />
                        </InspectorSection>
                      ) : null}

                      {selection.tag === "a" ? (
                        <div className="border-b border-border/60 px-2 py-2.5">
                          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Link</p>
                          <Input aria-label="Design link destination" className="h-9 rounded-xl bg-muted/40 px-3 text-xs" value={selection.href} onChange={(event) => applyField("href", event.currentTarget.value)} />
                        </div>
                      ) : null}

                      {selection.tag === "img" ? (
                        <div className="rounded-2xl border border-border/70 bg-background p-3 shadow-xs">
                          <div className="mb-2 flex items-center justify-between">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Image</p>
                            <Button variant="secondary" size="xs" onClick={() => imageInputRef.current?.click()}><Upload /> Replace</Button>
                          </div>
                          <div className="space-y-2">
                            <Input aria-label="Design image source" className="h-7 rounded-lg border-0 bg-muted/55 px-2 text-[11px] shadow-none" value={selection.src} onChange={(event) => applyField("src", event.currentTarget.value)} />
                            <Input aria-label="Design alt text" className="h-7 rounded-lg border-0 bg-muted/55 px-2 text-[11px] shadow-none" value={selection.alt} onChange={(event) => applyField("alt", event.currentTarget.value)} placeholder="Describe this image" />
                          </div>
                        </div>
                      ) : null}

                      {selection.canEditText ? (
                        <InspectorSection icon={<Sparkles />} title="Text styles">
                          <div className="grid grid-cols-3 gap-1.5">
                            {TYPE_PRESETS.map((preset) => (
                              <button
                                key={preset.label}
                                type="button"
                                className="rounded-lg border border-border/60 bg-muted/20 px-2 py-1.5 text-left transition-all hover:-translate-y-px hover:border-primary/40 hover:bg-primary/5 hover:shadow-sm"
                                onClick={() => applyStyleBatch(preset.styles)}
                                aria-label={`Apply ${preset.label} text preset`}
                              >
                                <span className="block text-sm font-semibold leading-none">{preset.sample}</span>
                                <span className="mt-1 block text-[9px] text-muted-foreground">{preset.label}</span>
                              </button>
                            ))}
                          </div>
                        </InspectorSection>
                      ) : null}

                      <InspectorSection icon={<Type />} title="Typography">
                        <div className="flex items-center gap-2">
                          <div className="flex flex-1 items-center rounded-lg bg-muted/55 p-0.5">
                            <Button variant="ghost" size="icon-xs" onClick={() => setFontSize(fontSize - 1, true)} aria-label="Decrease advanced font size"><Minus /></Button>
                            <Input type="number" min={1} max={240} aria-label="Design font size" className="h-7 min-w-0 flex-1 border-0 bg-transparent px-1 text-center text-xs shadow-none" value={fontSize} onChange={(event) => setFontSize(Number(event.currentTarget.value) || 1, true)} />
                            <span className="pr-1 text-[9px] text-muted-foreground">px</span>
                            <Button variant="ghost" size="icon-xs" onClick={() => setFontSize(fontSize + 1, true)} aria-label="Increase advanced font size"><Plus /></Button>
                          </div>
                          <div className="flex rounded-lg bg-muted/55 p-0.5">
                            {(["left", "center", "right"] as const).map((alignment) => {
                              const Icon = alignment === "left" ? AlignLeft : alignment === "center" ? AlignCenter : AlignRight;
                              return (
                                <Button key={alignment} variant={selection.styles.textAlign === alignment ? "secondary" : "ghost"} size="icon-xs" onClick={() => applyField("textAlign", alignment)} aria-label={`Align ${alignment}`}><Icon /></Button>
                              );
                            })}
                          </div>
                        </div>
                        <div className="mt-2 grid grid-cols-3 gap-2">
                          <InspectorField label="Weight" value={selection.styles.fontWeight} onChange={(value) => applyField("fontWeight", value)} />
                          <InspectorField label="Line height" value={selection.styles.lineHeight} onChange={(value) => applyField("lineHeight", value)} />
                          <InspectorField label="Tracking" value={selection.styles.letterSpacing} onChange={(value) => applyField("letterSpacing", value)} />
                        </div>
                      </InspectorSection>


                      <InspectorSection icon={<Move />} title="Layout & size">
                        <div className="grid grid-cols-2 gap-2">
                          <InspectorField label="Left" value={selection.styles.left} onChange={(value) => applyField("left", value)} />
                          <InspectorField label="Top" value={selection.styles.top} onChange={(value) => applyField("top", value)} />
                          <InspectorField label="Width" value={selection.styles.width} onChange={(value) => applyField("width", value)} />
                          <InspectorField label="Height" value={selection.styles.height} onChange={(value) => applyField("height", value)} />
                          <InspectorField label="Margin" value={selection.styles.margin} onChange={(value) => applyField("margin", value)} />
                          <InspectorField label="Padding" value={selection.styles.padding} onChange={(value) => applyField("padding", value)} />
                        </div>
                      </InspectorSection>

                      <InspectorSection icon={<Square />} title="Appearance">
                        <div className="grid grid-cols-2 gap-2">
                          <InspectorField label="Opacity" value={selection.styles.opacity} onChange={(value) => applyField("opacity", value)} />
                          <InspectorField label="Shadow" value={selection.styles.boxShadow} onChange={(value) => applyField("boxShadow", value)} />
                          <InspectorField label="Border width" value={selection.styles.borderWidth} onChange={(value) => applyField("borderWidth", value)} />
                          <InspectorField label="Border style" value={selection.styles.borderStyle} onChange={(value) => applyField("borderStyle", value)} />
                          <InspectorField label="Border color" value={selection.styles.borderColor} onChange={(value) => applyField("borderColor", value)} />
                          <InspectorField label="Radius" value={selection.styles.borderRadius} onChange={(value) => applyField("borderRadius", value)} />
                        </div>
                      </InspectorSection>

                      <InspectorSection icon={<Paintbrush />} title="Fill & color">
                        <div className="flex flex-wrap gap-2">
                          {COLOR_SWATCHES.map((color) => (
                            <button key={color} type="button" className="size-6 rounded-md border border-black/10 shadow-xs transition-all hover:-translate-y-px hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" style={{ backgroundColor: color }} onClick={() => applyField("color", color)} aria-label={`Set advanced text color ${color}`} />
                          ))}
                          <label className="relative grid size-6 cursor-pointer place-items-center rounded-md border border-border bg-muted text-muted-foreground" aria-label="Choose advanced custom text color">
                            <Palette className="size-3.5" />
                            <input type="color" className="absolute inset-0 cursor-pointer opacity-0" value={normalizeHexColor(selection.styles.color)} onChange={(event) => applyField("color", event.currentTarget.value)} aria-label="Advanced custom text color" />
                          </label>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <InspectorField label="Text color" value={selection.styles.color} onChange={(value) => applyField("color", value)} />
                          <InspectorField label="Background" value={selection.styles.backgroundColor} onChange={(value) => applyField("backgroundColor", value)} />
                        </div>
                      </InspectorSection>

                    </div>
                  ) : (
                    <div className="pt-8 text-center text-xs leading-5 text-muted-foreground">
                      <MousePointer2 className="mx-auto mb-2 size-5" />
                      Click an element in the page to edit it.
                    </div>
                  )}
                </aside>
              ) : null}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function InspectorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="group/field flex h-7 min-w-0 items-center gap-1 rounded-lg bg-muted/45 px-1.5 transition-colors focus-within:bg-muted/70">
      <Label className="min-w-0 flex-1 truncate text-[9px] font-medium text-muted-foreground group-focus-within/field:text-foreground">{label}</Label>
      <Input aria-label={`Design ${label.toLowerCase()}`} className="h-6 w-[58%] min-w-0 rounded-md border-0 bg-transparent px-1 text-right text-[10px] shadow-none focus-visible:ring-1" value={value} onChange={(event) => onChange(event.currentTarget.value)} />
    </div>
  );
}

function InspectorSection({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-border/60 px-2 py-2.5 last:border-b-0">
      <div className="mb-2 flex items-center gap-1.5 text-muted-foreground [&_svg]:size-3">
        {icon}
        <h3 className="text-[9px] font-semibold uppercase tracking-[0.12em]">{title}</h3>
      </div>
      {children}
    </section>
  );
}
