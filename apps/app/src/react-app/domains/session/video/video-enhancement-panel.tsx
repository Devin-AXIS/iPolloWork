/** @jsxImportSource react */
import * as React from "react";
import { Check, Loader2, Pause, Play, RotateCcw, ShieldCheck, Sparkles, Upload } from "lucide-react";
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
import { videoProjectDirectory } from "./video-project";

const maxSizeMB = VIDEO_ENHANCEMENT_MAX_BYTES / 1024 / 1024;
const kindLabels: Record<VideoEnhancementCue["kind"], string> = {
  keyword: "重点标题", number: "数字强调", list: "行动要点", steps: "步骤流程", comparison: "对比卡片", quote: "金句", summary: "总结",
};
const editableCue = ({ id, kind, text, detail, items, start, end, enabled, placement }: VideoEnhancementCue) =>
  ({ id, kind, text, detail, items: items?.map(item => item.trim()).filter(Boolean), start, end, enabled, placement });
const clock = (seconds: number) => Math.floor(seconds / 60) + ":" + String(Math.floor(seconds % 60)).padStart(2, "0");
const selectClass = "h-9 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
type Props = {
  client: iPolloWorkServerClient; workspaceId: string; sessionId: string;
  previewAssetUrl: (path: string) => string; onApplied: () => void;
  onGenerate?: (request: VideoEnhancementWorkflow) => Promise<void>;
};
export function VideoEnhancementPanel({ client, workspaceId, sessionId, previewAssetUrl, onApplied, onGenerate }: Props) {
  const [open, setOpen] = React.useState(false);
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
    let active = true;
    void Promise.all([call("status"), call("read", { sessionId })]).then(([status, saved]) => {
      if (!active) return;
      setModel(videoEnhancementStatusSchema.parse(status));
      if (saved) acceptJob(videoEnhancementJobSchema.parse(saved));
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
    if (!preview || !job) return "";
    const doc = new DOMParser().parseFromString(preview.html, "text/html");
    const media = doc.querySelector("#original-video");
    const url = previewAssetUrl("video/" + sessionId + "/enhancement/" + job.id + "/original.mp4");
    media?.setAttribute("src", url);
    const policy = doc.createElement("meta");
    policy.httpEquiv = "Content-Security-Policy";
    policy.content = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; media-src " + new URL(url, window.location.href).origin + ";";
    doc.head.prepend(policy);
    return "<!doctype html>" + doc.documentElement.outerHTML;
  }, [preview, job?.id, previewAssetUrl, sessionId]);
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
  const apply = () => perform(async () => {
    if (!job) return;
    const latest = videoEnhancementJobSchema.parse(await call("apply", { sessionId, jobId: job.id, cues: draft.map(editableCue), layout }));
    if (mounted.current) { setJob(latest); setDraft(latest.result?.cues.map(editableCue) ?? []); onApplied(); }
  });
  const generate = () => perform(async () => {
    if (!job || !onGenerate) return;
    const request = videoEnhancementWorkflowResultSchema.parse(await call("workflow", { sessionId, jobId: job.id, layout, cues: draft.map(editableCue) }));
    await onGenerate(request);
    if (mounted.current) setOpen(false);
  });
  const upload = <div className="flex flex-wrap items-end gap-3">
    <label className="min-w-48 flex-1 space-y-1.5 text-sm"><span className="font-medium">上传口播视频</span>
      <Input type="file" accept=".mp4,.mov,.webm" disabled={busy || running} onChange={event => setFile(event.target.files?.[0] ?? null)} data-testid="enhancement-file" />
      <span className="block text-xs text-muted-foreground">MP4 / MOV / WebM · 最长 3 分钟 · 最大 {maxSizeMB} MB</span></label>
    <label className="w-24 space-y-1.5 text-sm"><span>讲话语言</span><select aria-label="讲话语言" className={selectClass} value={language} disabled={busy || running} onChange={event => {
      if (event.target.value === "zh" || event.target.value === "en" || event.target.value === "auto") setLanguage(event.target.value);
    }}><option value="zh">中文</option><option value="en">英语</option><option value="auto">自动</option></select></label>
    <Button className="mb-5" disabled={!model.ready || useGestures && !model.gesturesReady || useSegmentation && !model.segmentationReady || !file || busy || running} onClick={() => void start()} data-testid="enhancement-start">
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}开始本地分析</Button>
  </div>;
  return <>
    <div className="flex shrink-0 items-center justify-end border-b bg-background px-3 py-1.5"><Button variant="ghost" size="sm" data-testid="video-enhancement-open" onClick={() => { setJob(null); setPreview(null); setPreviewReady(false); setOpen(true); }}><Sparkles className="size-4" />视频智能增强</Button></div>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex h-[min(820px,calc(100dvh-40px))] max-h-[calc(100dvh-40px)] w-[calc(100%-48px)] max-w-6xl flex-col gap-0 rounded-2xl p-0" data-testid="video-enhancement-panel">
        <DialogHeader className="shrink-0 border-b px-5 py-4 pr-16">
          <DialogTitle className="flex flex-wrap items-center gap-3">视频智能增强<span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground"><ShieldCheck className="size-3.5" />本地分析</span></DialogTitle>
          <DialogDescription>分析讲话与人物，用当前对话的视频制作流程生成画面。</DialogDescription>
        </DialogHeader>
        <div className="shrink-0 border-b px-5 py-3">
          {result ? <details><summary className="w-fit cursor-pointer text-xs text-muted-foreground">更换视频</summary><div className="pt-3">{upload}</div></details> : upload}
          <details className="mt-2 text-xs text-muted-foreground"><summary className="w-fit cursor-pointer">分析设置</summary>
            <div className="flex flex-wrap gap-x-5 gap-y-2 pt-3">
              <label className="flex items-center gap-2"><input type="checkbox" checked={useGestures} disabled={busy || running} onChange={event => setUseGestures(event.target.checked)} data-testid="enhancement-use-gestures" />手势定位</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={useSegmentation} disabled={busy || running} onChange={event => setUseSegmentation(event.target.checked)} data-testid="enhancement-use-segmentation" />精细人物避让</label>
              <p className="w-full">{model.message}</p>
            </div>
          </details>
          {!model.ready && <p role="status" className="mt-2 text-xs text-amber-600">正在准备本地模型；可在分析设置中查看状态。</p>}
          {running && job && <div className="mt-3 space-y-2" aria-live="polite"><div className="flex items-center justify-between gap-3 text-xs"><span>{job.message} · {job.progress}%</span><Button variant="ghost" size="sm" disabled={busy} onClick={() => void perform(async () => { await call("cancel", { sessionId, jobId: job.id }); })}>取消分析</Button></div><Progress value={job.progress} aria-label="本地分析进度" /></div>}
          {!result && job && !running && <p className="mt-2 text-sm" role="status">{job.message}</p>}
          {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
        </div>
        {result ? <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:overflow-hidden" data-testid="enhancement-result">
          <section className="flex min-h-0 shrink-0 flex-col gap-3 p-5 lg:overflow-y-auto" aria-label="布局预览">
            <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-medium">布局预览</h3><span className="text-xs text-muted-foreground">{previewing ? "更新预览…" : job.status === "applied" ? "基础版已应用" : "本地分析完成"}</span></div>
            <div className="relative min-h-64 flex-1 overflow-hidden rounded-xl border bg-muted/40 lg:min-h-72" data-testid="enhancement-preview-stage">
              {previewDocument ? <iframe ref={frame} title="视频增强布局预览" sandbox="allow-scripts" allow="autoplay" srcDoc={previewDocument} className="absolute inset-0 h-full w-full border-0" data-testid="enhancement-preview" />
                : <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>}
            </div>
            <div className="flex items-center gap-3"><Button variant="outline" size="icon-sm" aria-label={paused ? "播放预览" : "暂停预览"} disabled={!previewReady || previewing} onClick={() => frame.current?.contentWindow?.postMessage({ type: "enhancement-play", playing: paused }, "*")}>{!previewReady ? <Loader2 className="size-4 animate-spin" /> : paused ? <Play className="size-4" /> : <Pause className="size-4" />}</Button>
              <input aria-label="预览播放位置" type="range" min={0} max={result.duration} step={.05} value={time} className="min-w-0 flex-1 accent-current" onChange={event => seek(Number(event.target.value))} />
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{clock(time)} / {clock(result.duration)}</span></div>
            {previewError && <p role="alert" className="text-xs text-destructive">{previewError}</p>}
            {onGenerate && <p className="text-xs leading-relaxed text-muted-foreground">这里是基础布局示意。AI 编排会使用当前对话模型与同一套视频 skill，生成更完整的画面和动效。</p>}
            {preview && draft.some(cue => cue.enabled) && !preview.cues.some(cue => cue.enabled && cue.rect) && <p role="status" className="text-xs text-amber-600">当前区域没有足够空间展示内容，请调整位置或选择画中画。</p>}
            <details className="text-xs text-muted-foreground"><summary className="w-fit cursor-pointer">转写与分析详情</summary><div className="mt-3 max-h-36 space-y-2 overflow-y-auto pr-2">
              {result.segments.map((segment, index) => <p key={index}><span className="mr-2 tabular-nums">{clock(segment.start)}</span>{segment.text}</p>)}
              <p>{result.gestures.length} 个手势 · {result.masks.filter(sample => sample.data).length} 帧人物轮廓{result.timings ? " · 分析 " + (result.timings.totalMs / 1000).toFixed(0) + " 秒" : ""}</p>
              {result.warnings.map(warning => <p key={warning}>{warning}</p>)}
            </div></details>
          </section>
          <Tabs defaultValue="layout" className="min-h-0 shrink-0 gap-0 border-t lg:border-t-0 lg:border-l">
            <TabsList variant="line" className="mx-5 mt-4 flex w-auto shrink-0"><TabsTrigger value="layout" data-testid="enhancement-layout-tab">画面布局</TabsTrigger><TabsTrigger value="content" data-testid="enhancement-content-tab">生成内容 · {draft.length}</TabsTrigger></TabsList>
            <TabsContent value="layout" className="space-y-5 overflow-y-auto p-5">
              <fieldset disabled={busy} className="space-y-5">
                <div className="space-y-2"><p className="text-xs font-medium">成片模式</p><div className="grid grid-cols-3 gap-2">{[
                  { value: "pip", label: "角落画中画", hint: "生成内容为主" }, { value: "background", label: "背景叠加", hint: "原视频为背景" }, { value: "split", label: "左右分栏", hint: "人物与内容并列" },
                ].map(mode => <button type="button" key={mode.value} aria-pressed={layout.mode === mode.value} data-testid={"enhancement-mode-" + mode.value} onClick={() => editLayout("mode", mode.value)} className={"rounded-lg border px-2 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " + (layout.mode === mode.value ? "border-primary bg-primary/5" : "hover:bg-muted")}>
                  <span className="block text-xs font-medium">{mode.label}</span><span className="mt-1 block text-[10px] text-muted-foreground">{mode.hint}</span></button>)}</div></div>
                <label className="block space-y-2 text-xs"><span>画布比例</span><select className={selectClass} aria-label="画布比例" value={layout.aspectRatio} onChange={event => editLayout("aspectRatio", event.target.value)}><option value="16:9">16:9 横屏</option><option value="9:16">9:16 竖屏</option><option value="source">跟随原视频</option></select></label>
                {layout.mode !== "background" && <div className="grid grid-cols-2 gap-3"><label className="space-y-2 text-xs"><span>原视频位置</span><select className={selectClass} aria-label="原视频位置" value={layout.sourcePosition} onChange={event => editLayout("sourcePosition", event.target.value)}><option value="bottom-left">{layout.mode === "split" ? "左栏" : "左下角"}</option><option value="bottom-right">{layout.mode === "split" ? "右栏" : "右下角"}</option>{layout.mode === "pip" && <><option value="top-left">左上角</option><option value="top-right">右上角</option></>}</select></label>
                  {layout.mode === "pip" && <label className="space-y-2 text-xs"><span>原视频大小</span><select className={selectClass} aria-label="原视频大小" value={layout.sourceSize} onChange={event => editLayout("sourceSize", event.target.value)}><option value="small">小</option><option value="medium">中</option><option value="large">大</option></select></label>}</div>}
                <label className="block space-y-2 text-xs"><span>生成内容位置</span><select className={selectClass} aria-label="生成内容位置" value={layout.contentPosition} onChange={event => editLayout("contentPosition", event.target.value)}><option value="auto">自动安排</option><option value="left">画面左侧</option><option value="right">画面右侧</option><option value="top">画面上方</option><option value="bottom">画面下方</option><option value="center">画面中央</option></select></label>
                <p className="text-xs leading-relaxed text-muted-foreground">{layout.mode === "background" ? "内容会避让人物与手部；空间不足的片段会跳过。" : "原视频完整保留，生成内容会避开原视频区域。"}</p>
              </fieldset>
            </TabsContent>
            <TabsContent value="content" className="min-h-0 overflow-y-auto p-5">
              <div className="mb-3 flex items-center justify-between gap-2"><p className="text-xs text-muted-foreground">{draft.filter(cue => cue.enabled).length} 个片段已选</p><Button variant="ghost" size="sm" disabled={busy || previewing} onClick={() => setRegenerate(true)} data-testid="enhancement-regenerate"><RotateCcw className="size-3" />重新编排</Button></div>
              {!draft.length && <p className="text-sm text-muted-foreground">未找到可编排的语句，请查看转写或更换视频。</p>}
              <div className="mb-4 max-h-40 space-y-1 overflow-y-auto" data-testid="enhancement-cue-list">{draft.map(cue => <div key={cue.id} data-testid="enhancement-cue" className={"flex items-center gap-2 rounded-lg p-2 " + (selected?.id === cue.id ? "bg-muted" : "hover:bg-muted/50")}>
                <input type="checkbox" aria-label={cue.id + " 启用片段"} checked={cue.enabled} disabled={busy} onChange={event => edit(cue.id, { enabled: event.target.checked })} />
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => { setSelectedId(cue.id); seek(cue.start + .25); }}><span className="block truncate text-xs">{cue.text}</span><span className="text-[10px] text-muted-foreground">{clock(cue.start)} · {kindLabels[cue.kind]}</span></button>
              </div>)}</div>
              {selected && <fieldset disabled={busy} className="space-y-3 border-t pt-4" data-testid="enhancement-cue-editor">
                <div className="flex items-center justify-between gap-2"><span className="text-xs font-medium">编辑当前片段</span><button type="button" className="text-xs text-muted-foreground underline" onClick={() => seek(selected.start + .25)}>定位片段</button></div>
                <label className="block space-y-1.5 text-xs"><span>呈现方式</span><select className={selectClass} aria-label={selected.id + " 呈现方式"} value={selected.kind} onChange={event => { const kind = videoEnhancementCueSchema.shape.kind.safeParse(event.target.value); if (kind.success) edit(selected.id, { kind: kind.data }); }}>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label className="block space-y-1.5 text-xs"><span>标题 / 重点</span><Textarea className="min-h-16 py-2 text-sm" aria-label={selected.id + " 元素文字"} value={selected.text} maxLength={160} onChange={event => edit(selected.id, { text: event.target.value })} /></label>
                {(selected.kind === "steps" || selected.kind === "comparison" || selected.kind === "list") ? <label className="block space-y-1.5 text-xs"><span>内容条目（每行一项，最多 4 项）</span><Textarea className="py-2 text-sm" aria-label={selected.id + " 内容条目"} value={selected.items?.join("\n") ?? ""} maxLength={644} onChange={event => edit(selected.id, { items: event.target.value.split("\n").slice(0, 4) })} /></label>
                  : <label className="block space-y-1.5 text-xs"><span>补充说明</span><Textarea className="py-2 text-sm" aria-label={selected.id + " 补充说明"} value={selected.detail ?? ""} maxLength={480} onChange={event => edit(selected.id, { detail: event.target.value })} /></label>}
                <div className="grid grid-cols-2 gap-3"><label className="space-y-1.5 text-xs"><span>开始（秒）</span><Input aria-label={selected.id + " 开始秒数"} type="number" min={0} max={result.duration} step={.1} value={selected.start} onChange={event => edit(selected.id, { start: Number(event.target.value) })} /></label><label className="space-y-1.5 text-xs"><span>结束（秒）</span><Input aria-label={selected.id + " 结束秒数"} type="number" min={0} max={result.duration} step={.1} value={selected.end} onChange={event => edit(selected.id, { end: Number(event.target.value) })} /></label></div>
                <label className="block space-y-1.5 text-xs"><span>此片段位置</span><select className={selectClass} aria-label={selected.id + " 元素位置"} value={selected.placement ?? "auto"} onChange={event => { const placement = videoEnhancementCueSchema.shape.placement.safeParse(event.target.value); if (placement.success) edit(selected.id, { placement: placement.data }); }}><option value="auto">跟随画面布局</option><option value="left">左侧</option><option value="right">右侧</option><option value="top">上方</option><option value="bottom">下方</option><option value="center">中央</option>{layout.mode === "background" && <option value="gesture">手势位置</option>}</select></label>
                {selectedPlacement?.reason && !selectedPlacement.rect && <p className="text-xs text-amber-600">{selectedPlacement.reason}</p>}
              </fieldset>}
            </TabsContent>
          </Tabs>
        </div> : !running && <div className="px-5 py-10 text-center text-sm text-muted-foreground">上传视频后，选择版式并校对生成内容。</div>}
        {result && <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t px-5 py-3" data-testid="enhancement-actions">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Check className="size-3.5" />{job.status === "applied" ? "已应用到时间轴 · 原视频和备份已保留" : job.message.startsWith("已恢复") ? "已恢复增强前时间轴" : "应用后可在时间轴继续编辑"}</p>
          <div className="flex flex-wrap items-center gap-2">{job.status === "applied" && <Button variant="ghost" size="sm" disabled={busy} data-testid="enhancement-restore" onClick={() => void perform(async () => { const latest = videoEnhancementJobSchema.parse(await call("undo", { sessionId, jobId: job.id })); setJob(latest); onApplied(); })}>恢复增强前时间轴</Button>}
            <Button variant="outline" disabled={busy || previewing || Boolean(previewError) || !preview?.cues.some(cue => cue.enabled && cue.rect)} onClick={() => void apply()} data-testid="enhancement-apply">{job.status === "applied" ? "更新基础版" : "应用基础版"}</Button>
            {onGenerate && <Button disabled={busy || previewing} onClick={() => void generate()} data-testid="enhancement-generate">{busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}AI 编排生成</Button>}</div>
        </div>}
      </DialogContent>
    </Dialog>
  </>;
}
