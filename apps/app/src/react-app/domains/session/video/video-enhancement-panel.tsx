/** @jsxImportSource react */
import * as React from "react";
import { Loader2, Sparkles, Upload } from "lucide-react";
import {
  VIDEO_ENHANCEMENT_MAX_BYTES, videoEnhancementJobSchema, videoEnhancementStatusSchema,
  type VideoEnhancementJob, type VideoEnhancementCue,
} from "@ipollowork/types/video-enhancement";
import type { iPolloWorkServerClient } from "@/app/lib/ipollowork-server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { videoProjectDirectory } from "./video-project";

type Props = {
  client: iPolloWorkServerClient; workspaceId: string; sessionId: string;
  previewAssetUrl: (path: string) => string; onApplied: () => void;
};
export function VideoEnhancementPanel({ client, workspaceId, sessionId, previewAssetUrl, onApplied }: Props) {
  const [open, setOpen] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  const [modelMessage, setModelMessage] = React.useState("正在检查本地模型…");
  const [job, setJob] = React.useState<VideoEnhancementJob | null>(null);
  const [draft, setDraft] = React.useState<VideoEnhancementCue[]>([]);
  const [file, setFile] = React.useState<File | null>(null);
  const [language, setLanguage] = React.useState<"zh" | "en" | "auto">("zh");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const mounted = React.useRef(true);
  const video = React.useRef<HTMLVideoElement | null>(null);
  const [time, setTime] = React.useState(0);
  const call = React.useCallback(async (action: string, args: Record<string, unknown> = {}) => {
    const response = await client.callExtensionAction({ extensionId: "video-enhancement", action, args,
      context: { workspaceId, sessionId } });
    if (!response.ok) throw new Error(response.message || "本地增强操作未完成。");
    return response.result;
  }, [client, workspaceId, sessionId]);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  React.useEffect(() => {
    if (!open) return;
    let active = true;
    void Promise.all([call("status"), call("read", { sessionId })]).then(([status, saved]) => {
      if (!active) return;
      const model = videoEnhancementStatusSchema.parse(status);
      setReady(model.ready); setModelMessage(model.message);
      const latest = saved ? videoEnhancementJobSchema.parse(saved) : null;
      setJob(latest); setDraft(latest?.result?.cues ?? []);
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
        if (latest.status !== "running") { setDraft(latest.result?.cues ?? []); return; }
        timer = setTimeout(poll, 1200);
      } catch (reason) { if (active) setError(reason instanceof Error ? reason.message : "读取进度失败，重新打开面板可重试。"); }
    };
    timer = setTimeout(poll, 800);
    return () => { active = false; clearTimeout(timer); };
  }, [open, job?.id, job?.status, call, sessionId]);
  const perform = async (action: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await action(); }
    catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : "操作失败。"); }
    finally { if (mounted.current) setBusy(false); }
  };
  const start = () => perform(async () => {
    if (!file) throw new Error("请先选择视频。");
    const suffix = file.name.split(".").pop()?.toLowerCase();
    if (!suffix || !["mp4", "mov", "webm"].includes(suffix) || !file.size || file.size > VIDEO_ENHANCEMENT_MAX_BYTES) throw new Error("请选择 100 MB 以内的 MP4、MOV 或 WebM 视频。");
    const path = `${videoProjectDirectory(sessionId)}/assets/enhance-source-${crypto.randomUUID()}.${suffix}`;
    await client.uploadWorkspaceMedia(workspaceId, path, file);
    const latest = videoEnhancementJobSchema.parse(await call("start", { sessionId, sourcePath: path, language }));
    if (mounted.current) { setJob(latest); setDraft([]); }
  });
  const apply = () => perform(async () => {
    if (!job) return;
    const cues = draft.map(({ id, kind, text, start, end, enabled }) => ({ id, kind, text, start, end, enabled }));
    const latest = videoEnhancementJobSchema.parse(await call("apply", { sessionId, jobId: job.id, cues }));
    if (mounted.current) { setJob(latest); setDraft(latest.result?.cues ?? []); onApplied(); }
  });
  const edit = (id: string, patch: Partial<VideoEnhancementCue>) => setDraft(current => current.map(cue => cue.id === id ? { ...cue, ...patch } : cue));
  const result = job?.result;
  const running = job?.status === "running";
  const activeCue = draft.find(cue => cue.enabled && cue.start <= time && cue.end > time);
  const placed = activeCue && result?.cues.find(cue => cue.id === activeCue.id);
  return <>
    <div className="flex shrink-0 items-center justify-end border-b bg-background px-3 py-1.5">
      <Button variant="ghost" size="sm" data-testid="video-enhancement-open" onClick={() => setOpen(true)}><Sparkles className="size-4" />视频智能增强</Button>
    </div>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex max-w-5xl flex-col gap-4 overflow-y-auto" data-testid="video-enhancement-panel">
        <DialogHeader><DialogTitle>视频智能增强</DialogTitle><DialogDescription>根据原音频生成关键词、数字与列表，并自动避让人物。全部在本机处理。</DialogDescription></DialogHeader>
        <p className={`text-xs ${ready ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400"}`} role="status">{modelMessage}</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-48 flex-1 space-y-1 text-sm"><span>上传口播视频</span><Input type="file" accept=".mp4,.mov,.webm" disabled={busy || running} onChange={event => setFile(event.target.files?.[0] ?? null)} data-testid="enhancement-file" /><span className="text-xs text-muted-foreground">MP4 / MOV / WebM · 最长 3 分钟 · 最大 100 MB</span></label>
          <label className="space-y-1 text-sm"><span className="block">讲话语言</span><select className="h-9 rounded-md border bg-background px-2" value={language} disabled={busy || running} onChange={event => {
            if (event.target.value === "zh" || event.target.value === "en" || event.target.value === "auto") setLanguage(event.target.value);
          }}><option value="zh">中文</option><option value="en">英语</option><option value="auto">自动识别</option></select></label>
          <Button disabled={!ready || !file || busy || running} onClick={() => void start()} data-testid="enhancement-start">{busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}开始本地分析</Button>
        </div>
        {job && <div className="space-y-2" aria-live="polite"><div className="flex items-center justify-between gap-3 text-sm"><p>{job.message}</p>{running && <Button variant="outline" size="sm" disabled={busy} onClick={() => void perform(async () => {
          await call("cancel", { sessionId, jobId: job.id });
        })}>取消分析</Button>}</div>{running && <Progress value={job.progress} aria-label="本地分析进度" />}</div>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {result && <div className="grid min-h-0 gap-4 md:grid-cols-2">
          <div className="space-y-2"><div className="relative mx-auto w-full overflow-hidden rounded-lg bg-black" style={{ aspectRatio: `${result.width}/${result.height}`, maxWidth: 320 * result.width / result.height, containerType: "inline-size" }}>
            <video ref={video} src={previewAssetUrl(`video/${sessionId}/enhancement/${job.id}/original.mp4`)} controls preload="metadata" className="h-full w-full object-contain" onTimeUpdate={event => setTime(event.currentTarget.currentTime)} />
            {activeCue && placed?.rect && <div className="pointer-events-none absolute flex items-center overflow-hidden break-words rounded bg-black/90 p-2 font-semibold" style={{ color: activeCue.kind === "number" ? "#f4db79" : "white", left: `${placed.rect.x * 100}%`, top: `${placed.rect.y * 100}%`, width: `${placed.rect.width * 100}%`, height: `${placed.rect.height * 100}%`, fontSize: `${Math.min(.028, result.height / result.width * .045) * 100}cqw` }}>{activeCue.kind === "list" ? "• " : ""}{activeCue.text}</div>}
          </div><p className="text-xs text-muted-foreground">预览为分析时的建议布局；调整文字或时间后，应用时会重新检查人物避让。</p>{result.warnings.map(warning => <p key={warning} className="text-xs text-muted-foreground">{warning}</p>)}
          <details className="text-xs"><summary className="cursor-pointer">查看本地转写</summary><div className="mt-2 max-h-32 space-y-1 overflow-y-auto">{result.segments.map((segment, index) => <p key={index}>{segment.start.toFixed(1)}s · {segment.text}</p>)}</div></details></div>
          <div className="max-h-80 space-y-3 overflow-y-auto pr-1"><p className="text-sm font-medium">元素建议 · {draft.filter(cue => cue.enabled).length} 项已选</p>{!draft.length && <p className="text-sm text-muted-foreground">未找到适合自动展示的短句或数字。可更换视频后重试。</p>}{draft.map(cue => {
            const original = result.cues.find(item => item.id === cue.id);
            return <div key={cue.id} className="space-y-2 border-b pb-3" data-testid="enhancement-cue"><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={cue.enabled} disabled={busy || job.status === "applied"} onChange={event => edit(cue.id, { enabled: event.target.checked })} />{cue.kind === "number" ? "数字" : cue.kind === "list" ? "列表项" : "关键词"}<button type="button" className="ml-auto text-muted-foreground underline" onClick={() => { if (video.current) video.current.currentTime = cue.start; setTime(cue.start); }}>定位原视频</button></label>
              <Input aria-label={`${cue.id} 元素文字`} value={cue.text} maxLength={80} disabled={busy || job.status === "applied"} onChange={event => edit(cue.id, { text: event.target.value })} />
              <div className="flex items-center gap-2 text-xs"><span>展示时间</span><Input className="w-20" aria-label={`${cue.id} 开始秒数`} type="number" min={0} max={result.duration} step={.1} value={cue.start} disabled={busy || job.status === "applied"} onChange={event => edit(cue.id, { start: Number(event.target.value) })} /><span>至</span><Input className="w-20" aria-label={`${cue.id} 结束秒数`} type="number" min={0} max={result.duration} step={.1} value={cue.end} disabled={busy || job.status === "applied"} onChange={event => edit(cue.id, { end: Number(event.target.value) })} /><span>秒</span></div>
              {original?.reason && <p className="text-xs text-muted-foreground">{original.reason}</p>}
            </div>;
          })}</div>
        </div>}
        {result && <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3"><p className="max-w-lg text-xs text-muted-foreground">应用后将以此视频和增强元素建立当前时间轴。增强前的时间轴已备份，可在继续编辑前恢复；应用后可在工作台调整元素位置并导出。</p>{job.status === "applied" ? <Button variant="outline" disabled={busy} onClick={() => void perform(async () => {
          const latest = videoEnhancementJobSchema.parse(await call("undo", { sessionId, jobId: job.id })); setJob(latest); onApplied();
        })}>恢复增强前时间轴</Button> : <Button disabled={busy || job.status !== "ready" || !draft.some(cue => cue.enabled)} onClick={() => void apply()} data-testid="enhancement-apply">{busy && <Loader2 className="size-4 animate-spin" />}应用到时间轴</Button>}</div>}
      </DialogContent>
    </Dialog>
  </>;
}
