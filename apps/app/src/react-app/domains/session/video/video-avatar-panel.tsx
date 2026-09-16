/** @jsxImportSource react */
import * as React from "react";
import { avatarBackgroundForPrompt, AVATAR_STANDARD_VIDEO } from "@ipollowork/types/video-generation";
import { videoAvatarContextSchema, videoJobsResultSchema, videoSubmitResultSchema, videoModelStatusSchema, type VideoAvatarContext, type VideoJob } from "@ipollowork/types/video-generation";
import { Loader2, RefreshCw, ImagePlus, Check } from "lucide-react";
import type { iPolloWorkServerClient } from "@/app/lib/ipollowork-server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { videoProjectDirectory } from "./video-project";

type Props = { client: iPolloWorkServerClient; workspaceId: string; workspaceRoot: string; sessionId: string };

export function VideoAvatarPanel({ client, workspaceId, workspaceRoot, sessionId }: Props) {
  const [image, setImage] = React.useState("");
  const [imageName, setImageName] = React.useState("");
  const [imagePreview, setImagePreview] = React.useState("");
  const [imageMessage, setImageMessage] = React.useState("");
  const [recoveryIds, setRecoveryIds] = React.useState<Record<string, string>>({});
  const imagePreviewRef = React.useRef("");
  const [useAudio, setUseAudio] = React.useState(false);
  const [source, setSource] = React.useState<VideoAvatarContext | null>(null);
  const [ratio, setRatio] = React.useState("9:16");
  const [duration, setDuration] = React.useState("10");
  const [prompt, setPrompt] = React.useState("人物面向镜头自然交流，神态放松，自然眨眼和轻微呼吸，表情随语气柔和变化。避免持续露齿笑、夸张张嘴和机械点头，保持人物身份与镜头稳定。");
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
    setImage("");
    URL.revokeObjectURL(imagePreviewRef.current);
    imagePreviewRef.current = "";
    setImagePreview("");
    setImageName("");
    setImageMessage("正在读取图片…");
    try {
      const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
      if (!["png", "jpg", "jpeg", "webp"].includes(extension)) throw new Error("人物图片支持 PNG、JPG 和 WebP。");
      if (!file.size || file.size > 20 * 1024 * 1024) throw new Error("人物图片不能超过 20 MB，文件不能为空。");
      const bitmap = await createImageBitmap(file);
      bitmap.close();
      const path = `${videoProjectDirectory(sessionId)}/assets/avatar-${crypto.randomUUID()}.${extension}`;
      if (!mounted.current) return;
      URL.revokeObjectURL(imagePreviewRef.current);
      imagePreviewRef.current = URL.createObjectURL(file);
      setImageName(file.name); setImagePreview(imagePreviewRef.current);
      setImageMessage("正在上传图片…");
      await client.uploadWorkspaceMedia(workspaceId, path, file);
      if (mounted.current) { setImage(path); setImageMessage("图片已上传"); }
    } catch (error) {
      if (mounted.current) setImageMessage(`图片上传失败：${error instanceof Error ? error.message : "请重新选择图片重试。"}`);
    }
  };
  const audioAvailable = Boolean(source?.audioCount && !source.audioIssue);
  const canSubmit = ready && !checking && Boolean(image && prompt.trim() && source && (useAudio ? audioAvailable : source.content.trim() && Number.isFinite(Number(duration)) && Number(duration) >= 5));
  const submit = async () => {
    if (!canSubmit) throw new Error("请先检查人物图片、配音素材和 RunningHub Key 配置。");
    const result = videoSubmitResultSchema.parse(await call("submit", {
      requestId: crypto.randomUUID(), model: "minimax-h3-avatar", operation: "reference", prompt,
      resolution: AVATAR_STANDARD_VIDEO.resolution, duration: useAudio ? String(source?.audioDuration) : duration, ratio,
      imageRefs: image, avatarSource: useAudio ? "video-audio" : "video-content",
    }));
    if (mounted.current) { setJobs(current => [result.job, ...current.filter(job => job.id !== result.job.id)]); setMessage(result.job.message); }
  };
  const show = async (path: string) => {
    const file = await client.downloadWorkspaceFile(workspaceId, path);
    if (!mounted.current) return;
    URL.revokeObjectURL(previewRef.current);
    previewRef.current = URL.createObjectURL(new Blob([file.data], { type: path.toLowerCase().endsWith(".webm") ? "video/webm" : "video/mp4" }));
    setPreview(previewRef.current);
  };
  return <div className="space-y-4" data-testid="video-avatar-panel">
    <p className="text-xs leading-relaxed text-muted-foreground">上传人物图片，沿用图片的人物形象与视觉风格生成数字人。使用 24GB 标准模式，优先保持人物和场景稳定。</p>
    <div className="space-y-2">
      <label className="block space-y-2 text-xs font-medium">人物图片
        <Input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void act(() => upload(file)); }} />
      </label>
      {imagePreview ? <div className="overflow-hidden rounded-xl border bg-muted/30"><img src={imagePreview} alt="数字人人物参考图片" className="max-h-52 w-full object-contain p-2" /><p className="truncate border-t px-3 py-2 text-xs text-muted-foreground" title={imageName}>{imageName}</p></div> : <div className="flex items-center gap-2 rounded-lg border border-dashed p-3 text-xs text-muted-foreground"><ImagePlus className="size-4 shrink-0" />PNG / JPG / WebP，最大 20 MB</div>}
      {imageMessage ? <p role="status" className="break-words text-xs" aria-live="polite">{imageMessage}</p> : null}
      <p className="text-[11px] leading-relaxed text-muted-foreground">生成时参考图片的画风、服装、色彩与光线；插画保持插画风格，照片保持写实风格。</p>
    </div>
    <fieldset className="space-y-2" disabled={busy}>
      <legend className="mb-2 text-xs font-medium">是否使用视频中的配音素材</legend>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant={useAudio ? "secondary" : "outline"} aria-pressed={useAudio} disabled={!audioAvailable || busy} onClick={() => setUseAudio(true)}>使用配音</Button>
        <Button type="button" variant={!useAudio ? "secondary" : "outline"} aria-pressed={!useAudio} onClick={() => setUseAudio(false)}>不使用配音</Button>
      </div>
      <p role="status" className="text-xs leading-relaxed text-muted-foreground">{checking ? "正在读取当前视频配音…" : source?.audioIssue || (!source ? "暂时无法读取当前视频，请刷新重试。" : source.audioCount ? `当前视频有 ${source.audioCount} 段配音，共 ${source.audioDuration.toFixed(1)} 秒。` : "当前视频没有配音素材。")}</p>
      <p className="text-xs leading-relaxed">{useAudio ? `数字人视频将与配音时长一致${source?.audioDuration ? `（${source.audioDuration.toFixed(1)} 秒）` : ""}，按视频时间线保留配音。` : "参考当前视频内容生成数字人，不使用视频配音，可自行填写生成时长。"}超过 15 秒会自动分段生成并拼接，逐段检查画面连续性，按各段实际用量计费。</p>
    </fieldset>
    <fieldset className="space-y-2" disabled={busy}>
      <legend className="mb-2 text-xs font-medium">画面尺寸</legend>
      <div className="grid grid-cols-2 gap-2">
        {(["9:16", "16:9"]).map(value => <button key={value} type="button" aria-pressed={ratio === value} aria-label={value === "9:16" ? "竖屏 384×672" : "横屏 672×384"} onClick={() => setRatio(value)} className={`relative flex min-w-0 flex-col items-center gap-2 rounded-xl border px-2 py-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${ratio === value ? "border-primary bg-primary/5 text-foreground" : "border-border text-muted-foreground hover:bg-muted/50"}`}>
          <span className="flex h-8 items-center"><span className={`block rounded-sm border-2 ${value === "9:16" ? "h-8 w-5" : "h-5 w-8"}`} /></span>
          <span>{value === "9:16" ? "竖屏" : "横屏"}</span><span className="text-[11px] text-muted-foreground">{value === "9:16" ? `${AVATAR_STANDARD_VIDEO.shortEdge} × ${AVATAR_STANDARD_VIDEO.longEdge}` : `${AVATAR_STANDARD_VIDEO.longEdge} × ${AVATAR_STANDARD_VIDEO.shortEdge}`}</span>{ratio === value ? <Check className="absolute right-2 top-2 size-3 text-primary" /> : null}
        </button>)}
      </div>
    </fieldset>
    {!useAudio ? <label className="block space-y-2 text-xs font-medium">生成时长（秒）<Input type="number" min="5" step="0.1" aria-label="数字人视频时长" value={duration} onChange={event => setDuration(event.target.value)} disabled={busy} /></label> : null}
    <label className="block space-y-2 text-xs font-medium">动作描述<Textarea value={prompt} disabled={busy} maxLength={3000} onChange={event => setPrompt(event.target.value)} /></label>
    <p className="text-xs text-muted-foreground">{avatarBackgroundForPrompt(prompt) === "transparent" ? "本次生成：透明背景，仅保留人物。" : "本次生成：按描述保留场景背景。"}如需场景，请在动作描述中明确写出背景。放入画布后，右键人物可选择低层级（背景之上）或高层级（其他元素之上）。</p>
    <div className="space-y-2">
      <Button className="w-full" disabled={busy || !canSubmit} onClick={() => void act(submit)}>{busy ? <Loader2 className="animate-spin" /> : null}生成数字人</Button>
      <p className="text-[11px] leading-relaxed text-muted-foreground">{checking ? "正在检查 RunningHub Key…" : ready ? "RunningHub Key 已配置。生成按 RunningHub 实际用量计费。" : "需要先在授权中心配置 RunningHub 视频服务的 Key，配置后才能生成。"}</p>
      {!useAudio && source && !source.content.trim() ? <p className="text-xs text-muted-foreground">当前视频没有可参考的内容，请先完善视频。</p> : null}
    </div>
    {message ? <p role="status" className="break-words text-xs">{message}</p> : null}
    <div className="flex items-center justify-between text-xs">本会话数字人任务<Button variant="ghost" size="icon-xs" aria-label="刷新数字人任务" disabled={busy} onClick={() => void act(refresh)}><RefreshCw /></Button></div>
    {jobs.map(job => {
      const preparationFailed = job.avatarSequence?.segments.some(segment => ["failed", "save_failed"].includes(segment.status) && !segment.upstreamId && !segment.path);
      return <div key={job.id} className="space-y-2 rounded-lg border p-2 text-xs">
      <p>{job.status === "succeeded" ? "已完成" : ["running", "submitting", "saving"].includes(job.status) ? "生成处理中" : "需要处理"}</p>
      <p className="break-words text-muted-foreground">{job.message}</p>
      {job.avatarSequence ? <div className="space-y-2">
        <p>已完成 {job.avatarSequence.segments.filter(segment => segment.status === "succeeded").length}/{job.avatarSequence.segments.length} 段 · {job.avatarSequence.duration.toFixed(1)} 秒</p>
        {job.avatarSequence.segments.map((segment, index) => <div key={index} className="flex flex-wrap items-center justify-between gap-2">
          <span>第 {index + 1} 段 · {segment.start.toFixed(1)}–{segment.end.toFixed(1)} 秒{segment.status === "succeeded" ? " · 已保存" : ""}</span>
          {segment.status === "failed" && segment.path ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(() => show(segment.path))}>预览此段</Button> : null}
          {["failed", "save_failed"].includes(job.status) && (segment.status === "failed" && Boolean(segment.upstreamId || segment.path) || job.status === "save_failed" && job.avatarSequence?.segments.every(item => item.status === "succeeded")) ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(async () => { await call("retry-segment", { id: job.id, index }); await refresh(); })}>重试此段（计费）</Button> : null}
        </div>)}
      </div> : null}
      {job.path ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(() => show(job.path))}>预览</Button> : null}
      {["uncertain", "save_failed"].includes(job.status) || job.status === "failed" && preparationFailed ? <div className="space-y-2">
        {preparationFailed ? <p className="text-muted-foreground">这一段尚未提交生成。恢复本地准备后继续首次生成，按服务商实际用量计费；已完成片段保留。</p> : null}
        {job.status === "uncertain" && !job.upstreamId && !job.avatarSequence?.segments.some(segment => segment.status !== "succeeded" && segment.upstreamId) ? <Input aria-label="已有服务商任务 ID" placeholder="填写当前片段已有的 RunningHub 任务 ID" value={recoveryIds[job.id] ?? ""} onChange={event => setRecoveryIds(current => ({ ...current, [job.id]: event.target.value }))} /> : null}
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(async () => { await call("recover", { id: job.id, ...(recoveryIds[job.id]?.trim() ? { upstreamId: recoveryIds[job.id].trim() } : {}) }); await refresh(); })}>{preparationFailed ? "恢复准备并继续生成" : "恢复查询或拼接（不重新生成）"}</Button>
      </div> : null}
    </div>})}
    {preview ? <video controls src={preview} className="max-h-80 w-full rounded-lg" /> : null}
  </div>;
}
