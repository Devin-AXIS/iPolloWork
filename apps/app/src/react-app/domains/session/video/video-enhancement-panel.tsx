/** @jsxImportSource react */
import * as React from "react";
import { Check, ChevronDown, Loader2, Pause, Play, RotateCcw, ShieldCheck, Sparkles, Trash2, Upload } from "lucide-react";
import {
  VIDEO_ENHANCEMENT_MAX_BYTES, videoEnhancementCueSchema, videoEnhancementJobSchema,
  videoEnhancementLayoutSchema, videoEnhancementPreviewResultSchema, videoEnhancementStatusSchema, videoEnhancementWorkflowResultSchema,
  type VideoEnhancementCue, type VideoEnhancementJob, type VideoEnhancementLayout, type VideoEnhancementPreview, type VideoEnhancementWorkflow,
} from "@ipollowork/types/video-enhancement";
import type { iPolloWorkServerClient } from "@/app/lib/ipollowork-server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field";
import { FileUpload, FileUploadItem } from "@/components/ui/file-upload";
import { NumberField } from "@/components/ui/number-field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { videoProjectDirectory } from "./video-project";

const maxSizeMB = VIDEO_ENHANCEMENT_MAX_BYTES / 1024 / 1024;
const kindLabels: Record<VideoEnhancementCue["kind"], string> = {
  keyword: "重点标题", number: "数字强调", list: "行动要点", steps: "步骤流程", comparison: "对比卡片", quote: "金句", summary: "总结", chart: "数据图",
};
const editableCue = ({ id, kind, text, detail, items, start, end, enabled, placement, anchor, chart }: VideoEnhancementCue) =>
  ({ id, kind, text, detail, items: items?.map(item => item.trim()).filter(Boolean), start, end, enabled, placement, anchor, chart });
const clock = (seconds: number) => Math.floor(seconds / 60) + ":" + String(Math.floor(seconds % 60)).padStart(2, "0");
function EnhancementSelect({ label, ariaLabel = label, value, options, disabled, onValueChange }: {
  label: string; ariaLabel?: string; value: string; options: { value: string; label: string }[]; disabled: boolean; onValueChange: (value: string) => void;
}) {
  const id = React.useId();
  return <Field><FieldLabel htmlFor={id}>{label}</FieldLabel>
    <Select value={value} disabled={disabled} onValueChange={next => { if (next !== null) onValueChange(next); }}>
      <SelectTrigger id={id} aria-label={ariaLabel} data-value={value} className="w-full"><SelectValue>{options.find(option => option.value === value)?.label}</SelectValue></SelectTrigger>
      <SelectContent align="start">{options.map(option => <SelectItem key={option.value} value={option.value} data-value={option.value}>{option.label}</SelectItem>)}</SelectContent>
    </Select>
  </Field>;
}
type Props = {
  client: iPolloWorkServerClient; workspaceId: string; sessionId: string;
  previewAssetUrl: (path: string) => string;
  onPreparingChange?: (preparing: boolean) => void;
  open?: boolean; onOpenChange?: (open: boolean) => void;
  onGenerate?: (request: VideoEnhancementWorkflow) => Promise<void>;
  aiEditing?: boolean;
};
export function VideoEnhancementPanel({ client, workspaceId, sessionId, previewAssetUrl, onPreparingChange, onGenerate, aiEditing = false, open: controlledOpen, onOpenChange }: Props) {
  const [localOpen, setLocalOpen] = React.useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = onOpenChange ?? setLocalOpen;
  const [model, setModel] = React.useState({ ready: false, gesturesReady: false, segmentationReady: false, message: "正在检查本地模型…" });
  const [useGestures, setUseGestures] = React.useState(true);
  const [useSegmentation, setUseSegmentation] = React.useState(true);
  const [job, setJob] = React.useState<VideoEnhancementJob | null>(null);
  const [draft, setDraft] = React.useState<VideoEnhancementCue[]>([]);
  const [regenerate, setRegenerate] = React.useState(false);
  const [layout, setLayout] = React.useState<VideoEnhancementLayout>(() => videoEnhancementLayoutSchema.parse({}));
  const [selectedId, setSelectedId] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [language, setLanguage] = React.useState<"zh" | "en" | "auto">("zh");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [previewError, setPreviewError] = React.useState("");
  const [preview, setPreview] = React.useState<VideoEnhancementPreview | null>(null);
  const [previewing, setPreviewing] = React.useState(false);
  const [previewReady, setPreviewReady] = React.useState(false);
  const [time, setTime] = React.useState(0);
  const [paused, setPaused] = React.useState(true);
  const mounted = React.useRef(true);
  const frame = React.useRef<HTMLIFrameElement | null>(null);
  const timeRef = React.useRef(0);
  const result = job?.result;
  const running = job?.status === "running";
  const selected = draft.find(cue => cue.id === selectedId) ?? draft[0];
  const selectedPlacement = preview?.cues.find(cue => cue.id === selected?.id);
  const call = React.useCallback(async (action: string, args: Record<string, unknown> = {}) => {
    const response = await client.callExtensionAction({ extensionId: "video-enhancement", action, args, context: { workspaceId, sessionId } });
    if (!response.ok) throw new Error(response.message || "本地增强操作未完成。");
    return response.result;
  }, [client, workspaceId, sessionId]);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const acceptJob = (latest: VideoEnhancementJob) => {
    setJob(latest);
    setLayout(latest.result?.layout ?? videoEnhancementLayoutSchema.parse({}));
    // Older jobs contain short-word overlays; recompose their saved transcript locally.
    setDraft(latest.result?.cues.map(editableCue) ?? []);
    setRegenerate(Boolean(latest.result && !latest.result.layout));
    setSelectedId(latest.result?.cues[0]?.id ?? "");
    setPreview(null); timeRef.current = 0; setTime(0); setPaused(true);
  };
  React.useEffect(() => {
    if (!open) return;
    setJob(null); setPreview(null); setPreviewReady(false);
    let active = true;
    void Promise.all([call("status"), call("read", { sessionId })]).then(([status, saved]) => {
      if (!active) return;
      setModel(videoEnhancementStatusSchema.parse(status));
      if (saved && !job) acceptJob(videoEnhancementJobSchema.parse(saved));
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "无法读取本地状态。"); });
    return () => { active = false; };
  }, [open, call, sessionId]);
  React.useEffect(() => {
    if (!open || job?.status !== "running") return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const latest = videoEnhancementJobSchema.parse(await call("read", { sessionId, jobId: job.id }));
        if (!active) return;
        setJob(latest);
        if (latest.status !== "running") { acceptJob(latest); return; }
        timer = setTimeout(poll, 1200);
      } catch (reason) { if (active) setError(reason instanceof Error ? reason.message : "读取进度失败，重新打开面板可重试。"); }
    };
    timer = setTimeout(poll, 800);
    return () => { active = false; clearTimeout(timer); };
  }, [open, job?.id, job?.status, call, sessionId]);
  React.useEffect(() => {
    if (!open || !job?.result) return;
    let active = true;
    setPreviewing(true);
    const timer = setTimeout(() => {
      void call("preview", { sessionId, jobId: job.id, layout, ...(!regenerate ? { cues: draft.map(editableCue) } : {}) }).then(value => {
        if (!active) return;
        const next = videoEnhancementPreviewResultSchema.parse(value);
        setPreview(next); setPreviewError("");
        if (regenerate) { setDraft(next.cues.map(editableCue)); setSelectedId(next.cues[0]?.id ?? ""); setRegenerate(false); }
      }).catch(reason => { if (active) setPreviewError(reason instanceof Error ? reason.message : "预览未完成。"); })
        .finally(() => { if (active) setPreviewing(false); });
    }, 450);
    return () => { active = false; clearTimeout(timer); };
  }, [open, job?.id, Boolean(result), draft, regenerate, layout, call, sessionId]);
  React.useEffect(() => {
    if (!open) return;
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const data: unknown = event.data;
      if (!data || typeof data !== "object" || !("type" in data)) return;
      if (data.type === "enhancement-ready") {
        setPreviewReady(true);
        frame.current?.contentWindow?.postMessage({ type: "enhancement-seek", time: timeRef.current }, "*");
      }
      if (data.type === "enhancement-error" && "message" in data && typeof data.message === "string") setPreviewError(data.message.slice(0, 240));
      if (data.type === "enhancement-time" && "time" in data && typeof data.time === "number" && Number.isFinite(data.time)) {
        timeRef.current = data.time; setTime(data.time);
        if ("paused" in data && typeof data.paused === "boolean") { setPaused(data.paused); if (!data.paused) setPreviewError(""); }
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [open]);
  const previewDocument = React.useMemo(() => {
    if (!open || !preview || !job) return "";
    const doc = new DOMParser().parseFromString(preview.html, "text/html");
    const media = doc.querySelector("#original-video");
    const url = previewAssetUrl("video/" + sessionId + "/enhancement/" + job.id + "/original.mp4");
    media?.setAttribute("src", url);
    const policy = doc.createElement("meta");
    policy.httpEquiv = "Content-Security-Policy";
    policy.content = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; media-src " + new URL(url, window.location.href).origin + ";";
    doc.head.prepend(policy);
    return "<!doctype html>" + doc.documentElement.outerHTML;
  }, [open, preview, job?.id, previewAssetUrl, sessionId]);
  React.useEffect(() => { setPreviewReady(false); setPaused(true); }, [previewDocument]);
  const seek = (value: number) => {
    timeRef.current = value; setTime(value);
    frame.current?.contentWindow?.postMessage({ type: "enhancement-seek", time: value }, "*");
  };
  const editLayout = (key: keyof VideoEnhancementLayout, value: string) => {
    const next = videoEnhancementLayoutSchema.safeParse({ ...layout, [key]: value,
      ...(key === "mode" && value === "split" ? { sourcePosition: layout.sourcePosition.endsWith("left") ? "bottom-left" : "bottom-right" } : {}) });
    if (next.success) setLayout(next.data);
  };
  const edit = (id: string, patch: Partial<VideoEnhancementCue>) => setDraft(current => current.map(cue => cue.id === id ? { ...cue, ...patch } : cue));
  const perform = async (action: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await action(); }
    catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : "操作失败。"); }
    finally { if (mounted.current) setBusy(false); }
  };
  const start = () => perform(async () => {
    if (!file) throw new Error("请先选择视频。");
    const suffix = file.name.split(".").pop()?.toLowerCase();
    if (!suffix || !["mp4", "mov", "webm"].includes(suffix) || !file.size || file.size > VIDEO_ENHANCEMENT_MAX_BYTES) throw new Error("请选择 " + maxSizeMB + " MB 以内的 MP4、MOV 或 WebM 视频。");
    setJob(null); setDraft([]); setRegenerate(false); setPreview(null); setPreviewError(""); timeRef.current = 0; setTime(0);
    const path = videoProjectDirectory(sessionId) + "/assets/enhance-source-" + crypto.randomUUID() + "." + suffix;
    await client.uploadWorkspaceMedia(workspaceId, path, file);
    const latest = videoEnhancementJobSchema.parse(await call("start", { sessionId, sourcePath: path, language, useGestures, useSegmentation }));
    if (mounted.current) setJob(latest);
  });
  const applyBase = async (prepareForWorkflow = false) => {
    if (!job || aiEditing) throw new Error("AI 正在修改视频，请等待当前编排完成。");
    const latest = videoEnhancementJobSchema.parse(await call("apply", { sessionId, jobId: job.id, cues: draft.map(editableCue), layout, prepareForWorkflow }));
    if (mounted.current) { setJob(latest); setDraft(latest.result?.cues.map(editableCue) ?? []); }
  };
  const apply = () => perform(() => applyBase());
  const generate = () => perform(async () => {
    if (!job || !onGenerate || aiEditing) return;
    // Unmount the second decoder before applying files or starting the agent.
    frame.current?.contentWindow?.postMessage({ type: "enhancement-play", playing: false }, "*");
    if (mounted.current) { setOpen(false); setPreview(null); }
    onPreparingChange?.(true);
    try {
      await applyBase(true);
      const request = videoEnhancementWorkflowResultSchema.parse(await call("workflow", { sessionId, jobId: job.id, layout, cues: draft.map(editableCue) }));
      await onGenerate(request);
    }
    catch (reason) { if (mounted.current) setOpen(true); throw reason; }
    finally { onPreparingChange?.(false); }
  });
  const upload = <div className="grid min-w-0 gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
    <Field>
      <FieldLabel>口播视频</FieldLabel>
      <FileUpload label="上传口播视频" description={"MP4 / MOV / WebM · 最长 3 分钟 · 最大 " + maxSizeMB + " MB"}
        accept=".mp4,.mov,.webm" maxSize={VIDEO_ENHANCEMENT_MAX_BYTES} disabled={busy || running} data-testid="enhancement-file"
        messages={{ invalidType: "请选择 MP4、MOV 或 WebM 视频。", tooLarge: "视频不能超过 " + maxSizeMB + " MB。", empty: "视频文件为空。", tooMany: "每次只能选择一个视频。" }}
        onFilesSelected={files => setFile(files[0] ?? null)} onError={setError} />
      {file && <FileUploadItem name={file.name} status="ready" statusLabel="已选择 · 尚未开始分析"
        onRemove={busy || running ? undefined : () => { setFile(null); setError(""); }} removeLabel="移除所选视频" />}
    </Field>
    <div className="flex flex-col justify-end gap-3">
      <EnhancementSelect label="讲话语言" value={language} disabled={busy || running}
        options={[{ value: "zh", label: "中文" }, { value: "en", label: "英文" }, { value: "auto", label: "自动识别" }]}
        onValueChange={value => { if (value === "zh" || value === "en" || value === "auto") setLanguage(value); }} />
      <Button disabled={!model.ready || useGestures && !model.gesturesReady || useSegmentation && !model.segmentationReady || !file || busy || running}
        onClick={() => void start()} data-testid="enhancement-start">
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}开始本地分析
      </Button>
    </div>
  </div>;
  return <>
    {!onOpenChange && <div className="flex shrink-0 items-center justify-end px-3 py-1.5"><Button variant="ghost" size="sm" disabled={busy} data-testid="video-enhancement-open" onClick={() => { setJob(null); setPreview(null); setPreviewReady(false); setOpen(true); }}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}{busy && !open ? "正在准备 AI 编排…" : "视频智能增强"}</Button></div>}
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className={"video-settings-typography flex max-h-[calc(100dvh-40px)] w-[calc(100%-32px)] flex-col gap-0 rounded-xl p-0 text-ui-control " + (result ? "h-[min(820px,calc(100dvh-40px))] max-w-6xl" : "max-w-3xl")} data-testid="video-enhancement-panel">
        <DialogHeader className="shrink-0 px-5 py-4 pr-14">
          <DialogTitle className="flex flex-wrap items-center gap-2 text-ui-page-title">视频智能增强<Badge variant="secondary"><ShieldCheck className="size-3.5" />本地分析</Badge></DialogTitle>
          <DialogDescription className="text-ui-body">分析讲话与人物，用当前对话的视频制作流程生成画面。</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 shrink-0 space-y-3 overflow-y-auto px-5 pb-4">
          {result ? <Collapsible><CollapsibleTrigger render={<Button variant="ghost" size="sm" />}><ChevronDown className="size-3.5" />更换视频</CollapsibleTrigger><CollapsibleContent className="pt-3">{upload}</CollapsibleContent></Collapsible> : upload}
          <Collapsible>
            <CollapsibleTrigger render={<Button variant="ghost" size="sm" />}><ChevronDown className="size-3.5" />分析设置</CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 pt-3">
              <div className="flex flex-wrap gap-4">
                <Field orientation="horizontal" className="w-auto"><Checkbox id="enhancement-gestures" checked={useGestures} disabled={busy || running} onCheckedChange={setUseGestures} data-testid="enhancement-use-gestures" /><FieldLabel htmlFor="enhancement-gestures">手势定位</FieldLabel></Field>
                <Field orientation="horizontal" className="w-auto"><Checkbox id="enhancement-segmentation" checked={useSegmentation} disabled={busy || running} onCheckedChange={setUseSegmentation} data-testid="enhancement-use-segmentation" /><FieldLabel htmlFor="enhancement-segmentation">精细人物避让</FieldLabel></Field>
              </div>
              <p className="text-ui-meta text-muted-foreground">{model.message}</p>
            </CollapsibleContent>
          </Collapsible>
          {!model.ready && <Alert variant="warning" role="status"><AlertDescription>正在准备本地模型；可在分析设置中查看状态。</AlertDescription></Alert>}
          {running && job && <div className="space-y-2" aria-live="polite"><div className="flex items-center justify-between gap-3 text-ui-meta"><span>{job.message} · {job.progress}%</span><Button variant="ghost" size="sm" disabled={busy} onClick={() => void perform(async () => { await call("cancel", { sessionId, jobId: job.id }); })}>取消分析</Button></div><Progress value={job.progress} aria-label="本地分析进度" /></div>}
          {!result && job && !running && <Alert variant={job.status === "failed" ? "destructive" : "default"} role="status"><AlertDescription>{job.message}</AlertDescription></Alert>}
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        </div>
        {result ? <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:overflow-hidden" data-testid="enhancement-result">
          <section className="flex min-h-0 shrink-0 flex-col gap-3 bg-muted/20 p-5 lg:overflow-y-auto" aria-label="布局预览">
            <div className="flex items-center justify-between gap-3"><h3 className="text-ui-section-title">布局预览</h3><span className="text-ui-meta text-muted-foreground">{previewing ? "更新预览…" : job.status === "applied" ? "基础版已应用" : "本地分析完成"}</span></div>
            <div className="relative min-h-64 flex-1 overflow-hidden rounded-xl bg-muted lg:min-h-72" data-testid="enhancement-preview-stage">
              {previewDocument ? <iframe ref={frame} title="视频增强布局预览" sandbox="allow-scripts" allow="autoplay" srcDoc={previewDocument} className="absolute inset-0 h-full w-full border-0" data-testid="enhancement-preview" />
                : <div className="absolute inset-0 grid place-items-center text-muted-foreground"><Loader2 className="size-5 animate-spin" aria-label="正在准备预览" /></div>}
            </div>
            <div className="flex items-center gap-3"><Button variant="ghost" size="icon-sm" aria-label={paused ? "播放预览" : "暂停预览"} disabled={!previewReady || previewing} onClick={() => frame.current?.contentWindow?.postMessage({ type: "enhancement-play", playing: paused }, "*")}>{!previewReady ? <Loader2 className="size-4 animate-spin" /> : paused ? <Play className="size-4" /> : <Pause className="size-4" />}</Button>
              <Slider thumbLabels={["预览播放位置"]} min={0} max={result.duration} step={.05} value={time} onValueChange={seek} className="min-w-0 flex-1" />
              <span className="shrink-0 text-ui-meta tabular-nums text-muted-foreground">{clock(time)} / {clock(result.duration)}</span></div>
            {previewError && <Alert variant="destructive"><AlertDescription>{previewError}</AlertDescription></Alert>}
            {onGenerate && <p className="text-ui-meta text-muted-foreground">这里是基础布局示意。AI 编排会使用当前对话模型与同一套视频 skill，生成更完整的画面和动效。</p>}
            {preview && draft.some(cue => cue.enabled) && !preview.cues.some(cue => cue.enabled && cue.rect) && <Alert variant="warning" role="status"><AlertDescription>当前区域没有足够空间展示内容，请调整位置或选择画中画。</AlertDescription></Alert>}
            <Collapsible><CollapsibleTrigger render={<Button variant="ghost" size="sm" />}><ChevronDown className="size-3.5" />转写与分析详情</CollapsibleTrigger><CollapsibleContent className="mt-3 max-h-36 space-y-2 overflow-y-auto text-ui-meta text-muted-foreground">
              {result.segments.map((segment, index) => <p key={index}><span className="mr-2 tabular-nums">{clock(segment.start)}</span>{segment.text}</p>)}
              <p>{result.gestures.length} 个手势 · {result.masks.filter(sample => sample.data).length} 帧人物轮廓{result.timings ? " · 分析 " + (result.timings.totalMs / 1000).toFixed(0) + " 秒" : ""}</p>
              {result.warnings.map(warning => <p key={warning}>{warning}</p>)}
            </CollapsibleContent></Collapsible>
          </section>
          <Tabs defaultValue="layout" className="min-h-0 shrink-0 gap-0">
            <TabsList variant="line" className="mx-5 mt-4 flex w-auto shrink-0"><TabsTrigger value="layout" data-testid="enhancement-layout-tab">画面布局</TabsTrigger><TabsTrigger value="content" data-testid="enhancement-content-tab">生成内容 · {draft.length}</TabsTrigger></TabsList>
            <TabsContent value="layout" className="overflow-y-auto p-5">
              <fieldset disabled={busy} className="space-y-4">
                <Field><FieldLabel>成片模式</FieldLabel><RadioGroup value={layout.mode} disabled={busy} aria-label="成片模式" className="grid-cols-3 gap-2" onValueChange={value => { if (typeof value === "string") editLayout("mode", value); }}>
                  {[{ value: "pip", label: "角落画中画", hint: "生成内容为主" }, { value: "background", label: "背景叠加", hint: "原视频为背景" }, { value: "split", label: "左右分栏", hint: "人物与内容并列" }].map(mode =>
                    <label key={mode.value} className="flex min-w-0 cursor-pointer flex-col gap-2 rounded-lg bg-muted/40 p-2.5 has-[[data-checked]]:bg-primary/10">
                      <RadioGroupItem value={mode.value} aria-label={mode.label} data-testid={"enhancement-mode-" + mode.value} />
                      <span className="text-ui-control">{mode.label}</span><span className="text-ui-caption text-muted-foreground">{mode.hint}</span>
                    </label>)}
                </RadioGroup></Field>
                <EnhancementSelect label="画布比例" value={layout.aspectRatio} disabled={busy} onValueChange={value => editLayout("aspectRatio", value)} options={[{ value: "16:9", label: "16:9 横屏" }, { value: "9:16", label: "9:16 竖屏" }, { value: "source", label: "跟随原视频" }]} />
                {layout.mode !== "background" && <div className="grid grid-cols-2 gap-3">
                  <EnhancementSelect label="原视频位置" value={layout.sourcePosition} disabled={busy} onValueChange={value => editLayout("sourcePosition", value)} options={[
                    { value: "bottom-left", label: layout.mode === "split" ? "左栏" : "左下角" }, { value: "bottom-right", label: layout.mode === "split" ? "右栏" : "右下角" },
                    ...(layout.mode === "pip" ? [{ value: "top-left", label: "左上角" }, { value: "top-right", label: "右上角" }] : [])]} />
                  {layout.mode === "pip" && <EnhancementSelect label="原视频大小" value={layout.sourceSize} disabled={busy} onValueChange={value => editLayout("sourceSize", value)} options={[{ value: "small", label: "小" }, { value: "medium", label: "中" }, { value: "large", label: "大" }]} />}
                </div>}
                <EnhancementSelect label="生成内容位置" value={layout.contentPosition} disabled={busy} onValueChange={value => editLayout("contentPosition", value)} options={[{ value: "auto", label: "自动安排" }, { value: "left", label: "画面左侧" }, { value: "right", label: "画面右侧" }, { value: "top", label: "画面上方" }, { value: "bottom", label: "画面下方" }, { value: "center", label: "画面中央" }]} />
                <FieldDescription>{layout.mode === "background" ? "优先按手势定位；无手势时避让人物，空间不足的片段会跳过。" : "原视频完整保留，生成内容会避开原视频区域。"}</FieldDescription>
              </fieldset>
            </TabsContent>
            <TabsContent value="content" className="min-h-0 overflow-y-auto p-5">
              <div className="mb-3 flex items-center justify-between gap-2"><p className="text-ui-meta text-muted-foreground">{draft.filter(cue => cue.enabled).length} 个片段已选</p><Button variant="ghost" size="sm" disabled={busy || previewing} onClick={() => setRegenerate(true)} data-testid="enhancement-regenerate"><RotateCcw className="size-3.5" />重新编排</Button></div>
              {!draft.length && <Empty variant="ghost"><EmptyHeader><EmptyTitle>暂无生成内容</EmptyTitle><EmptyDescription>未找到可编排的语句，请查看转写或更换视频。</EmptyDescription></EmptyHeader></Empty>}
              <div className="mb-4 max-h-40 space-y-1 overflow-y-auto" data-testid="enhancement-cue-list">{draft.map(cue => <div key={cue.id} data-testid="enhancement-cue" className={"flex items-center gap-2 rounded-lg p-2 " + (selected?.id === cue.id ? "bg-muted" : "hover:bg-muted/50")}>
                <Checkbox aria-label={cue.id + " 启用片段"} checked={cue.enabled} disabled={busy} onCheckedChange={checked => edit(cue.id, { enabled: checked })} />
                <Button variant="ghost" data-testid="enhancement-cue-select" className="h-auto min-w-0 flex-1 flex-col items-start px-1 py-0 text-left" onClick={() => { setSelectedId(cue.id); seek(cue.start + .25); }}>
                  <span className="w-full truncate text-ui-control">{cue.text}</span><span className="text-ui-caption text-muted-foreground">{clock(cue.start)} · {kindLabels[cue.kind]}</span>
                </Button>
              </div>)}</div>
              {selected && <fieldset disabled={busy} className="space-y-4" data-testid="enhancement-cue-editor">
                <div className="flex items-center justify-between gap-2"><span className="text-ui-section-title">编辑当前片段</span><Button variant="link" size="sm" onClick={() => seek(selected.start + .25)}>定位片段</Button></div>
                <EnhancementSelect label="呈现方式" ariaLabel={selected.id + " 呈现方式"} value={selected.kind} disabled={busy} options={Object.entries(kindLabels).map(([value, label]) => ({ value, label }))}
                  onValueChange={value => { const kind = videoEnhancementCueSchema.shape.kind.safeParse(value); if (kind.success) edit(selected.id, { kind: kind.data }); }} />
                <Field><FieldLabel htmlFor="enhancement-cue-text">标题 / 重点</FieldLabel><Textarea id="enhancement-cue-text" aria-label={selected.id + " 元素文字"} value={selected.text} maxLength={160} onChange={event => edit(selected.id, { text: event.target.value })} /></Field>
                {selected.kind === "chart" && <Field data-testid="enhancement-chart-editor"><FieldLabel>图表数据</FieldLabel><FieldDescription>使用同一单位，最多 4 项。{!selected.chart?.length ? "当前显示占位图，请补充真实数据。" : ""}</FieldDescription>
                  {selected.chart?.map((point, index) => <div key={index} className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_28px] items-center gap-2">
                    <Input aria-label={selected.id + " 数据标签 " + (index + 1)} value={point.label} maxLength={80} onChange={event => edit(selected.id, { chart: selected.chart?.map((item, i) => i === index ? { ...item, label: event.target.value } : item) })} />
                    <NumberField label={selected.id + " 数据值 " + (index + 1)} value={point.value} disabled={busy} onValueChange={value => { if (value !== null) edit(selected.id, { chart: selected.chart?.map((item, i) => i === index ? { ...item, value } : item) }); }} />
                    <Button variant="ghost" size="icon-sm" aria-label={"删除数据 " + (index + 1)} onClick={() => { const chart = selected.chart?.filter((_, i) => i !== index); edit(selected.id, { chart: chart?.length ? chart : undefined }); }}><Trash2 className="size-3.5" /></Button>
                  </div>)}
                  <Button variant="outline" size="sm" disabled={(selected.chart?.length ?? 0) >= 4} onClick={() => edit(selected.id, { chart: [...(selected.chart ?? []), { label: "数据项", value: 0 }] })}>添加数据</Button>
                </Field>}
                {(selected.kind === "steps" || selected.kind === "comparison" || selected.kind === "list") ? <Field><FieldLabel htmlFor="enhancement-cue-items">内容条目</FieldLabel><Textarea id="enhancement-cue-items" aria-label={selected.id + " 内容条目"} value={selected.items?.join("\n") ?? ""} maxLength={644} onChange={event => edit(selected.id, { items: event.target.value.split("\n").slice(0, 4) })} /><FieldDescription>每行一项，最多 4 项。</FieldDescription></Field>
                  : <Field><FieldLabel htmlFor="enhancement-cue-detail">补充说明</FieldLabel><Textarea id="enhancement-cue-detail" aria-label={selected.id + " 补充说明"} value={selected.detail ?? ""} maxLength={480} onChange={event => edit(selected.id, { detail: event.target.value })} /></Field>}
                <div className="grid grid-cols-2 gap-3">
                  <Field><FieldLabel htmlFor="enhancement-cue-start">开始（秒）</FieldLabel><NumberField inputProps={{ id: "enhancement-cue-start" }} label={selected.id + " 开始秒数"} disabled={busy} min={0} max={result.duration} step={.1} value={selected.start} onValueChange={value => { if (value !== null) edit(selected.id, { start: value }); }} /></Field>
                  <Field><FieldLabel htmlFor="enhancement-cue-end">结束（秒）</FieldLabel><NumberField inputProps={{ id: "enhancement-cue-end" }} label={selected.id + " 结束秒数"} disabled={busy} min={0} max={result.duration} step={.1} value={selected.end} onValueChange={value => { if (value !== null) edit(selected.id, { end: value }); }} /></Field>
                </div>
                <EnhancementSelect label="此片段位置" ariaLabel={selected.id + " 元素位置"} value={selected.placement ?? "auto"} disabled={busy} options={[{ value: "auto", label: "跟随画面布局" }, { value: "left", label: "左侧" }, { value: "right", label: "右侧" }, { value: "top", label: "上方" }, { value: "bottom", label: "下方" }, { value: "center", label: "中央" }, ...(layout.mode === "background" ? [{ value: "gesture", label: "手势位置" }] : [])]}
                  onValueChange={value => { const placement = videoEnhancementCueSchema.shape.placement.safeParse(value); if (placement.success) edit(selected.id, { placement: placement.data }); }} />
                {selectedPlacement?.binding && <p className="text-ui-meta text-muted-foreground" data-testid="enhancement-binding">{selectedPlacement.binding.precision === "word" ? "词语" : "语句"}“{selectedPlacement.binding.phrase || "手势"}” · {selectedPlacement.binding.time.toFixed(2)} 秒 · {{ locked: "指向锁定", follow: "托举跟随", reveal: "引导展开", frame: "双手展示" }[selectedPlacement.binding.behavior]} · {selectedPlacement.binding.space === "source" ? "原视频位置" : "内容区域"}</p>}
                <Field orientation="horizontal"><Checkbox id="enhancement-anchor-lock" aria-label={selected.id + " 锁定位置"} checked={Boolean(selected.anchor)} onCheckedChange={checked => edit(selected.id, { anchor: checked ? selectedPlacement?.binding?.anchor ?? { x: .5, y: .4 } : undefined })} /><FieldLabel htmlFor="enhancement-anchor-lock">手动校正并锁定位置</FieldLabel></Field>
                {selected.anchor && <div className="grid grid-cols-2 gap-3">
                  {(["x", "y"] satisfies (keyof NonNullable<VideoEnhancementCue["anchor"]>)[]).map(axis => <Field key={axis}><FieldLabel htmlFor={"enhancement-anchor-" + axis}>{axis === "x" ? "水平位置（%）" : "垂直位置（%）"}</FieldLabel><NumberField inputProps={{ id: "enhancement-anchor-" + axis }} label={selected.id + " 位置 " + axis} disabled={busy} min={0} max={100} step={1} value={Math.round(selected.anchor![axis] * 100)} onValueChange={value => { if (value !== null) edit(selected.id, { anchor: { ...selected.anchor!, [axis]: Math.max(0, Math.min(100, value)) / 100 } }); }} /></Field>)}
                  <FieldDescription className="col-span-2">{layout.mode === "background" ? "对应原视频中的位置。" : "对应生成内容区域中的位置。"}</FieldDescription>
                </div>}
                {selectedPlacement?.reason && !selectedPlacement.rect && <Alert variant="warning" role="status"><AlertDescription>{selectedPlacement.reason}</AlertDescription></Alert>}
              </fieldset>}
            </TabsContent>
          </Tabs>
        </div> : null}
        {result && <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-5 py-3" data-testid="enhancement-actions">
          <p className="flex items-center gap-1.5 text-ui-meta text-muted-foreground"><Check className="size-3.5" />{job.status === "applied" ? "已应用到时间轴 · 原视频和备份已保留" : job.message.startsWith("已恢复") ? "已恢复增强前时间轴" : "应用后可在时间轴继续编辑"}</p>
          <div role="group" aria-label="视频增强操作" className="flex flex-wrap items-center gap-2">{job.status === "applied" && <Button variant="ghost" size="sm" disabled={busy} data-testid="enhancement-restore" onClick={() => void perform(async () => { const latest = videoEnhancementJobSchema.parse(await call("undo", { sessionId, jobId: job.id })); setJob(latest); })}>恢复增强前时间轴</Button>}
            <Button variant="ghost" disabled={aiEditing || busy || previewing || Boolean(previewError) || !preview?.cues.some(cue => cue.enabled && cue.rect)} onClick={() => void apply()} data-testid="enhancement-apply">{job.status === "applied" ? "更新基础版" : "应用基础版"}</Button>
            {onGenerate && <Button disabled={aiEditing || busy || previewing || Boolean(previewError) || !preview?.cues.some(cue => cue.enabled && cue.rect)} onClick={() => void generate()} data-testid="enhancement-generate">{busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}AI 编排生成</Button>}</div>
        </div>}
      </DialogContent>
    </Dialog>
  </>;
}
