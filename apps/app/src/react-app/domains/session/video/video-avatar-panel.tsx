/** @jsxImportSource react */
import * as React from "react";
import { avatarBackgroundForPrompt, AVATAR_STANDARD_VIDEO } from "@ipollowork/types/video-generation";
import { videoAvatarContextSchema, videoJobsResultSchema, videoSubmitResultSchema, videoModelStatusSchema, type VideoAvatarContext, type VideoJob } from "@ipollowork/types/video-generation";
import { Loader2, RefreshCw, ImagePlus, Check, RectangleVertical, RectangleHorizontal, Info } from "lucide-react";
import type { iPolloWorkServerClient } from "@/app/lib/ipollowork-server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { videoProjectDirectory } from "./video-project";

type Props = {
  client: iPolloWorkServerClient;
  workspaceId: string;
  workspaceRoot: string;
  sessionId: string;
  active: boolean;
  onOpenVoice?: () => void;
};

export function VideoAvatarPanel({ client, workspaceId, workspaceRoot, sessionId, active, onOpenVoice }: Props) {
  const imageInputRef = React.useRef<HTMLInputElement>(null);
  const promptId = React.useId();
  const audioSwitchId = React.useId();
  const [image, setImage] = React.useState("");
  const [imageName, setImageName] = React.useState("");
  const [imagePreview, setImagePreview] = React.useState("");
  const [imageMessage, setImageMessage] = React.useState("");
  const [recoveryIds, setRecoveryIds] = React.useState<Record<string, string>>({});
  const imagePreviewRef = React.useRef("");
  const [useAudio, setUseAudio] = React.useState(true);
  const audioPreferenceInitializedRef = React.useRef(false);
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
    const nextSource = sourceResult.status === "fulfilled" ? videoAvatarContextSchema.parse(sourceResult.value) : null;
    setSource(nextSource);
    if (!audioPreferenceInitializedRef.current || !nextSource?.audioCount || nextSource.audioIssue) {
      setUseAudio(Boolean(nextSource?.audioCount && !nextSource.audioIssue));
      audioPreferenceInitializedRef.current = true;
    }
    setChecking(false);
    if (sourceResult.status === "rejected") throw sourceResult.reason;
    if (statusResult.status === "rejected") throw statusResult.reason;
  }, [call]);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      URL.revokeObjectURL(previewRef.current);
      URL.revokeObjectURL(imagePreviewRef.current);
    };
  }, []);
  React.useEffect(() => {
    if (!active) return;
    setChecking(true);
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
    return () => { disposed = true; clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [active, refresh]);
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
  return <div className="space-y-4 text-xs font-normal text-foreground" data-testid="video-avatar-panel">
    <section className="space-y-2.5" aria-label="人物图片">
      <input ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" aria-label="选择人物图片" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void act(() => upload(file)); }} />
      <button
        type="button"
        disabled={busy}
        onClick={() => imageInputRef.current?.click()}
        aria-label={imagePreview ? "替换人物图片" : "上传人物图片"}
        className="flex w-full items-center gap-3 rounded-lg bg-muted/60 p-3 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        {imagePreview ? <img src={imagePreview} alt="数字人人物参考图片" className="h-16 w-14 shrink-0 rounded-md object-contain" /> : <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-background"><ImagePlus aria-hidden="true" className="size-5 text-muted-foreground" /></span>}
        <span className="min-w-0 flex-1 space-y-1">
          <span className="block truncate text-xs font-normal text-foreground" title={imageName || undefined}>{imageName || "上传人物图片"}</span>
          <span className="block text-[11px] font-normal leading-5 text-muted-foreground">{imagePreview ? "点击替换图片" : "PNG / JPG / WebP · 最大 20 MB"}</span>
        </span>
      </button>
      {imageMessage && imageMessage !== "图片已上传" ? <p role="status" className={`break-words text-[11px] ${imageMessage.startsWith("图片上传失败") ? "text-destructive" : "text-muted-foreground"}`} aria-live="polite">{imageMessage}</p> : null}
    </section>

    <fieldset className="space-y-2.5" disabled={busy}>
      <legend className="sr-only">配音</legend>
      <div className="flex min-h-8 items-center justify-between gap-3">
        <label htmlFor={audioSwitchId} className="text-[13px] font-medium text-foreground">使用视频配音</label>
        <Switch id={audioSwitchId} checked={useAudio && audioAvailable} onCheckedChange={setUseAudio} disabled={busy || checking || !audioAvailable} aria-describedby={checking || !audioAvailable ? `${audioSwitchId}-hint` : undefined} />
      </div>
      {checking || !audioAvailable ? <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <p id={`${audioSwitchId}-hint`} role="status" className="text-[11px] font-normal leading-5 text-muted-foreground">{checking ? "正在读取配音…" : source?.audioIssue || (!source ? "暂时无法读取视频。" : "暂无视频配音")}</p>
        {!checking && !source ? <Button type="button" variant="link" size="sm" className="h-auto px-0 text-xs" onClick={() => void act(refresh)}>重试</Button> : !checking && onOpenVoice ? <Button type="button" variant="link" size="sm" className="h-auto px-0 text-xs" onClick={onOpenVoice}>{source?.audioCount ? "调整配音" : "设置配音"}</Button> : null}
      </div> : null}
      {!useAudio && !checking && audioAvailable ? <p className="text-[11px] font-normal leading-5 text-muted-foreground">根据当前视频内容生成。</p> : null}
    </fieldset>

    <fieldset className="space-y-3" disabled={busy}>
      <legend className="sr-only">画面设置</legend>
      <h3 className="text-[13px] font-medium text-foreground">画面设置</h3>
      <div className="grid grid-cols-2 gap-2">
        {(["9:16", "16:9"]).map(value => <button key={value} type="button" aria-pressed={ratio === value} aria-label={value === "9:16" ? `竖屏 ${AVATAR_STANDARD_VIDEO.shortEdge}×${AVATAR_STANDARD_VIDEO.longEdge}` : `横屏 ${AVATAR_STANDARD_VIDEO.longEdge}×${AVATAR_STANDARD_VIDEO.shortEdge}`} title={value === "9:16" ? `${AVATAR_STANDARD_VIDEO.shortEdge} × ${AVATAR_STANDARD_VIDEO.longEdge}` : `${AVATAR_STANDARD_VIDEO.longEdge} × ${AVATAR_STANDARD_VIDEO.shortEdge}`} onClick={() => setRatio(value)} className={`relative flex min-w-0 items-center gap-2 rounded-lg border p-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${ratio === value ? "border-primary/50 bg-primary/5 text-foreground" : "border-transparent bg-muted/60 text-muted-foreground hover:bg-muted"}`}>
          {value === "9:16" ? <RectangleVertical aria-hidden="true" className="size-5 shrink-0" strokeWidth={1.5} /> : <RectangleHorizontal aria-hidden="true" className="size-5 shrink-0" strokeWidth={1.5} />}
          <span className="min-w-0 flex-1 text-xs font-normal">{value === "9:16" ? "竖屏 9:16" : "横屏 16:9"}</span>
          {ratio === value ? <Check aria-hidden="true" className="size-3 shrink-0 text-primary" /> : null}
        </button>)}
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-normal text-muted-foreground">生成时长</span>
        {useAudio ? <span className="text-xs font-normal text-foreground">{source?.audioDuration ? `跟随配音 · ${source.audioDuration.toFixed(1)} 秒` : "跟随视频配音"}</span> : <Input type="number" min="5" step="0.1" className="h-8 w-24 border-0 bg-muted/60 text-xs font-normal text-foreground" aria-label="数字人视频时长" value={duration} onChange={event => setDuration(event.target.value)} disabled={busy} />}
      </div>
      {(useAudio ? source && source.audioDuration > 15 : Number(duration) > 15) ? <p className="text-[11px] font-normal leading-5 text-muted-foreground">超过 15 秒将自动分段生成并拼接，按各段实际用量计费。</p> : null}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={promptId} className="text-xs font-normal text-muted-foreground">动作描述</label>
          <Tooltip>
            <TooltipTrigger render={<button type="button" aria-label="动作与背景说明" className="flex items-center gap-1 text-[11px] font-normal text-muted-foreground" />}>
              {avatarBackgroundForPrompt(prompt) === "transparent" ? "透明背景" : "场景背景"}
              <Info aria-hidden="true" className="size-3" />
            </TooltipTrigger>
            <TooltipContent className="text-[11px] font-normal leading-5">如需场景，请在动作描述中写出背景。</TooltipContent>
          </Tooltip>
        </div>
        <Textarea id={promptId} value={prompt} disabled={busy} rows={3} className="min-h-20 border-0 bg-muted/60 text-xs font-normal leading-5 text-foreground shadow-none" maxLength={3000} onChange={event => setPrompt(event.target.value)} />
      </div>
    </fieldset>

    <div className="space-y-2 pt-1">
      <Button className="w-full text-xs" disabled={busy || !canSubmit} onClick={() => void act(submit)}>{busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}生成数字人</Button>
      <p className="text-[11px] font-normal leading-5 text-muted-foreground">{checking ? "正在检查视频服务…" : ready ? "生成按 RunningHub 实际用量计费。" : "请先在授权中心配置 RunningHub 视频服务的 Key。"}</p>
      {!useAudio && source && !source.content.trim() ? <p className="text-[11px] font-normal leading-5 text-muted-foreground">当前视频没有可参考的内容，请先完善视频。</p> : null}
    </div>
    {message ? <p role="status" className="break-words text-[11px] font-normal leading-5 text-muted-foreground">{message}</p> : null}
    {jobs.length > 0 ? <div className="flex items-center justify-between border-t border-border/60 pt-4 text-[13px] font-medium text-foreground">生成记录<Button variant="ghost" size="icon-xs" aria-label="刷新数字人任务" disabled={busy} onClick={() => void act(refresh)}><RefreshCw /></Button></div> : null}
    {jobs.map(job => {
      const preparationFailed = job.avatarSequence?.segments.some(segment => ["failed", "save_failed"].includes(segment.status) && !segment.upstreamId && !segment.path);
      return <div key={job.id} className="space-y-2 rounded-lg border p-2 text-xs font-normal text-foreground">
      <p className="font-medium">{job.status === "succeeded" ? "已完成" : ["running", "submitting", "saving"].includes(job.status) ? "生成处理中" : "需要处理"}</p>
      <p className="break-words text-[11px] leading-5 text-muted-foreground">{job.message}</p>
      {job.avatarSequence ? <div className="space-y-2">
        <p>已完成 {job.avatarSequence.segments.filter(segment => segment.status === "succeeded").length}/{job.avatarSequence.segments.length} 段 · {job.avatarSequence.duration.toFixed(1)} 秒</p>
        {job.avatarSequence.segments.map((segment, index) => <div key={index} className="flex flex-wrap items-center justify-between gap-2">
          <span>第 {index + 1} 段 · {segment.start.toFixed(1)}–{segment.end.toFixed(1)} 秒{segment.status === "succeeded" ? " · 已保存" : ""}</span>
          {segment.status === "failed" && segment.path ? <Button size="sm" variant="outline" className="text-xs" disabled={busy} onClick={() => void act(() => show(segment.path))}>预览此段</Button> : null}
          {["failed", "save_failed"].includes(job.status) && (segment.status === "failed" && Boolean(segment.upstreamId || segment.path) || job.status === "save_failed" && job.avatarSequence?.segments.every(item => item.status === "succeeded")) ? <Button size="sm" variant="outline" className="text-xs" disabled={busy} onClick={() => void act(async () => { await call("retry-segment", { id: job.id, index }); await refresh(); })}>重试此段（计费）</Button> : null}
        </div>)}
      </div> : null}
      {job.path ? <Button size="sm" variant="outline" className="text-xs" disabled={busy} onClick={() => void act(() => show(job.path))}>预览</Button> : null}
      {["uncertain", "save_failed"].includes(job.status) || job.status === "failed" && preparationFailed ? <div className="space-y-2">
        {preparationFailed ? <p className="text-muted-foreground">这一段尚未提交生成。恢复本地准备后继续首次生成，按服务商实际用量计费；已完成片段保留。</p> : null}
        {job.status === "uncertain" && !job.upstreamId && !job.avatarSequence?.segments.some(segment => segment.status !== "succeeded" && segment.upstreamId) ? <Input className="text-xs font-normal" aria-label="已有服务商任务 ID" placeholder="填写当前片段已有的 RunningHub 任务 ID" value={recoveryIds[job.id] ?? ""} onChange={event => setRecoveryIds(current => ({ ...current, [job.id]: event.target.value }))} /> : null}
        <Button size="sm" variant="outline" className="text-xs" disabled={busy} onClick={() => void act(async () => { await call("recover", { id: job.id, ...(recoveryIds[job.id]?.trim() ? { upstreamId: recoveryIds[job.id].trim() } : {}) }); await refresh(); })}>{preparationFailed ? "恢复准备并继续生成" : "恢复查询或拼接（不重新生成）"}</Button>
      </div> : null}
    </div>})}
    {active && preview ? <video controls src={preview} className="max-h-80 w-full rounded-lg" /> : null}
  </div>;
}
