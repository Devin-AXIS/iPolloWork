/** @jsxImportSource react */
import * as React from "react";
import { videoAvatarContextSchema, videoJobsResultSchema, videoSubmitResultSchema, videoModelStatusSchema, type VideoAvatarContext, type VideoJob } from "@ipollowork/types/video-generation";
import { Loader2, RefreshCw, ImagePlus, Check } from "lucide-react";
import type { iPolloWorkServerClient } from "@/app/lib/ipollowork-server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { videoProjectDirectory } from "./video-project";

type Props = { client: iPolloWorkServerClient; workspaceId: string; workspaceRoot: string; sessionId: string };

export function VideoAvatarPanel({ client, workspaceId, workspaceRoot, sessionId }: Props) {
  const [image, setImage] = React.useState("");
  const [imageName, setImageName] = React.useState("");
  const [imagePreview, setImagePreview] = React.useState("");
  const imagePreviewRef = React.useRef("");
  const [useAudio, setUseAudio] = React.useState(false);
  const [source, setSource] = React.useState<VideoAvatarContext | null>(null);
  const [ratio, setRatio] = React.useState("9:16");
  const [duration, setDuration] = React.useState("10");
  const [prompt, setPrompt] = React.useState("人物面向镜头自然表现，保持人物身份、背景和镜头稳定。");
  const [ready, setReady] = React.useState(false);
  const [checking, setChecking] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(false);
  const [message, setMessage] = React.useState("");
  const [jobs, setJobs] = React.useState<VideoJob[]>([]);
  const [preview, setPreview] = React.useState("");
  const previewRef = React.useRef("");
  const mounted = React.useRef(true);
  const context = React.useMemo(() => ({ workspaceId, sessionId, directory: workspaceRoot }), [workspaceId, sessionId, workspaceRoot]);
  const call = React.useCallback(async (action: string, args: Record<string, unknown>) => {
    const response = await client.callExtensionAction({ extensionId: "video-generation", action, args, context });
    if (!response.ok) throw new Error(response.message || "视频服务请求失败");
    return response.result;
  }, [client, context]);
  const refresh = React.useCallback(async () => {
    const [jobResult, statusResult, sourceResult] = await Promise.allSettled([call("jobs", {}), call("status", {}), call("avatar-context", {})]);
    if (!mounted.current) return;
    if (jobResult.status === "fulfilled") setJobs(videoJobsResultSchema.parse(jobResult.value).jobs.filter(job => job.model === "minimax-h3-avatar"));
    setReady(statusResult.status === "fulfilled" && videoModelStatusSchema.parse(statusResult.value).models.some(model => model.id === "minimax-h3-avatar"));
    setSource(sourceResult.status === "fulfilled" ? videoAvatarContextSchema.parse(sourceResult.value) : null);
    setChecking(false);
    if (sourceResult.status === "rejected") throw sourceResult.reason;
    if (statusResult.status === "rejected") throw statusResult.reason;
  }, [call]);
  React.useEffect(() => {
    mounted.current = true;
    let disposed = false, refreshing = false;
    const poll = async () => {
      if (refreshing) return;
      refreshing = true;
      try { await refresh(); } catch (error) { if (!disposed) setMessage(error instanceof Error ? error.message : "无法读取视频信息"); }
      finally { refreshing = false; }
    };
    void poll();
    const timer = setInterval(() => void poll(), 10_000);
    const onFocus = () => { void poll(); };
    window.addEventListener("focus", onFocus);
    return () => { disposed = true; mounted.current = false; clearInterval(timer); window.removeEventListener("focus", onFocus); URL.revokeObjectURL(previewRef.current); URL.revokeObjectURL(imagePreviewRef.current); };
  }, [refresh]);
  const act = async (fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setMessage("");
    try { await fn(); } catch (error) { if (mounted.current) setMessage(error instanceof Error ? error.message : "操作失败"); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };
  const upload = async (file: File) => {
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!["png", "jpg", "jpeg", "webp"].includes(extension)) throw new Error("人物图片支持 PNG、JPG 和 WebP。");
    if (!file.size || file.size > 20 * 1024 * 1024) throw new Error("人物图片不能超过 20 MB，文件不能为空。");
    const bitmap = await createImageBitmap(file);
    bitmap.close();
    const path = `${videoProjectDirectory(sessionId)}/assets/avatar-${crypto.randomUUID()}.${extension}`;
    await client.writeWorkspaceBinaryFile(workspaceId, { path, data: await file.arrayBuffer() });
    if (!mounted.current) return;
    URL.revokeObjectURL(imagePreviewRef.current);
    imagePreviewRef.current = URL.createObjectURL(file);
    setImage(path); setImageName(file.name); setImagePreview(imagePreviewRef.current);
  };
  const audioAvailable = Boolean(source?.audioCount && !source.audioIssue);
  const canSubmit = ready && !checking && Boolean(image && prompt.trim() && source && (useAudio ? audioAvailable : source.content.trim()));
  const submit = async () => {
    if (!canSubmit) throw new Error("请先检查人物图片、配音素材和 RunningHub Key 配置。");
    const result = videoSubmitResultSchema.parse(await call("submit", {
      requestId: crypto.randomUUID(), model: "minimax-h3-avatar", operation: "reference", prompt,
      resolution: "0.589824MP", duration: useAudio ? String(source?.audioDuration) : duration, ratio,
      imageRefs: image, avatarSource: useAudio ? "video-audio" : "video-content",
    }));
    if (mounted.current) { setJobs(current => [result.job, ...current.filter(job => job.id !== result.job.id)]); setMessage(result.job.message); }
  };
  const show = async (path: string) => {
    const file = await client.downloadWorkspaceFile(workspaceId, path);
    if (!mounted.current) return;
    URL.revokeObjectURL(previewRef.current);
    previewRef.current = URL.createObjectURL(new Blob([file.data], { type: "video/mp4" }));
    setPreview(previewRef.current);
  };
  return <div className="space-y-4" data-testid="video-avatar-panel">
    <p className="text-xs leading-relaxed text-muted-foreground">上传人物图片，沿用图片的人物形象与视觉风格生成数字人。</p>
    <div className="space-y-2">
      <label className="block space-y-2 text-xs font-medium">人物图片
        <Input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void act(() => upload(file)); }} />
      </label>
      {imagePreview ? <div className="overflow-hidden rounded-xl border bg-muted/30"><img src={imagePreview} alt="数字人人物参考图片" className="max-h-52 w-full object-contain p-2" /><p className="truncate border-t px-3 py-2 text-xs text-muted-foreground" title={imageName}>{imageName}</p></div> : <div className="flex items-center gap-2 rounded-lg border border-dashed p-3 text-xs text-muted-foreground"><ImagePlus className="size-4 shrink-0" />PNG / JPG / WebP，最大 20 MB</div>}
      <p className="text-[11px] leading-relaxed text-muted-foreground">生成时参考图片的画风、服装、色彩与光线；插画保持插画风格，照片保持写实风格。</p>
    </div>
    <fieldset className="space-y-2" disabled={busy}>
      <legend className="mb-2 text-xs font-medium">是否使用视频中的配音素材</legend>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant={useAudio ? "secondary" : "outline"} aria-pressed={useAudio} disabled={!audioAvailable || busy} onClick={() => setUseAudio(true)}>使用配音</Button>
        <Button type="button" variant={!useAudio ? "secondary" : "outline"} aria-pressed={!useAudio} onClick={() => setUseAudio(false)}>不使用配音</Button>
      </div>
      <p role="status" className="text-xs leading-relaxed text-muted-foreground">{checking ? "正在读取当前视频配音…" : source?.audioIssue || (!source ? "暂时无法读取当前视频，请刷新重试。" : source.audioCount ? `当前视频有 ${source.audioCount} 段配音，共 ${source.audioDuration.toFixed(1)} 秒。` : "当前视频没有配音素材。")}</p>
      <p className="text-xs leading-relaxed">{useAudio ? `数字人视频将与配音时长一致${source?.audioDuration ? `（${source.audioDuration.toFixed(1)} 秒）` : ""}，按视频时间线保留配音。` : "参考当前视频内容生成数字人，不使用视频配音，可自行选择生成时长。"}</p>
    </fieldset>
    <fieldset className="space-y-2" disabled={busy}>
      <legend className="mb-2 text-xs font-medium">画面尺寸</legend>
      <div className="grid grid-cols-2 gap-2">
        {(["9:16", "16:9"]).map(value => <button key={value} type="button" aria-pressed={ratio === value} aria-label={value === "9:16" ? "竖屏 576×1024" : "横屏 1024×576"} onClick={() => setRatio(value)} className={`relative flex min-w-0 flex-col items-center gap-2 rounded-xl border px-2 py-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${ratio === value ? "border-primary bg-primary/5 text-foreground" : "border-border text-muted-foreground hover:bg-muted/50"}`}>
          <span className="flex h-8 items-center"><span className={`block rounded-sm border-2 ${value === "9:16" ? "h-8 w-5" : "h-5 w-8"}`} /></span>
          <span>{value === "9:16" ? "竖屏 9:16" : "横屏 16:9"}</span><span className="text-[11px] text-muted-foreground">{value === "9:16" ? "576 × 1024" : "1024 × 576"}</span>{ratio === value ? <Check className="absolute right-2 top-2 size-3 text-primary" /> : null}
        </button>)}
      </div>
    </fieldset>
    {!useAudio ? <label className="block space-y-2 text-xs font-medium">生成时长<Select value={duration} onValueChange={value => { if (value) setDuration(value); }} disabled={busy}><SelectTrigger className="w-full" aria-label="数字人视频时长"><SelectValue>{duration} 秒</SelectValue></SelectTrigger><SelectContent>{Array.from({ length: 11 }, (_, i) => String(i + 5)).map(seconds => <SelectItem key={seconds} value={seconds}>{seconds} 秒</SelectItem>)}</SelectContent></Select></label> : null}
    <label className="block space-y-2 text-xs font-medium">动作描述<Textarea value={prompt} disabled={busy} maxLength={3000} onChange={event => setPrompt(event.target.value)} /></label>
    <div className="space-y-2">
      <Button className="w-full" disabled={busy || !canSubmit} onClick={() => void act(submit)}>{busy ? <Loader2 className="animate-spin" /> : null}生成数字人视频（付费）</Button>
      <p className="text-[11px] leading-relaxed text-muted-foreground">{checking ? "正在检查 RunningHub Key…" : ready ? "RunningHub Key 已配置。生成按 RunningHub 实际用量计费。" : "需要先在授权中心配置 RunningHub 视频服务的 Key，配置后才能生成。"}</p>
      {!useAudio && source && !source.content.trim() ? <p className="text-xs text-muted-foreground">当前视频没有可参考的内容，请先完善视频。</p> : null}
    </div>
    {message ? <p role="status" className="break-words text-xs">{message}</p> : null}
    <div className="flex items-center justify-between text-xs">本会话数字人任务<Button variant="ghost" size="icon-xs" aria-label="刷新数字人任务" disabled={busy} onClick={() => void act(refresh)}><RefreshCw /></Button></div>
    {jobs.map(job => <div key={job.id} className="space-y-2 rounded-lg border p-2 text-xs"><p>{job.status === "succeeded" ? "已完成" : ["running", "submitting", "saving"].includes(job.status) ? "生成处理中" : "需要处理"}</p><p className="break-words text-muted-foreground">{job.message}</p>{job.path ? <div className="flex gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => void act(() => show(job.path))}>预览</Button></div> : null}{["uncertain", "save_failed"].includes(job.status) && job.upstreamId ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(async () => { await call("recover", { id: job.id }); await refresh(); })}>恢复查询（不重新生成）</Button> : null}</div>)}
    {preview ? <video controls src={preview} className="max-h-80 w-full rounded-lg" /> : null}
  </div>;
}
