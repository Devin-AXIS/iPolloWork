/** @jsxImportSource react */
import * as React from "react";
import { avatarBackgroundForPrompt, AVATAR_STANDARD_VIDEO, avatarProfileResultSchema, avatarProfilesResultSchema, videoAvatarContextSchema, videoJobsResultSchema, videoSubmitResultSchema, videoModelStatusSchema, type AvatarProfile, type VideoAvatarContext, type VideoJob } from "@ipollowork/types/video-generation";
import { ArrowLeft, Check, ChevronDown, ChevronRight, ImagePlus, Info, Loader2, Pause, Play, Plus, RefreshCw, Trash2, RectangleVertical, RectangleHorizontal } from "lucide-react";
import type { iPolloWorkServerClient } from "@/app/lib/ipollowork-server";
import { AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  onAssetAction?: (action: "view" | "insert", path: string) => Promise<void>;
  previewAssetUrl?: (path: string) => string;
};

const defaultPrompt = "人物面向镜头自然交流，神态放松，自然眨眼和轻微呼吸，表情随语气柔和变化。避免持续露齿笑、夸张张嘴和机械点头，保持人物身份与镜头稳定。";
const menuClassName = "video-settings-typography max-h-(--available-height) max-w-(--available-width) rounded-lg bg-popover p-1.5 text-xs [&_[role=option]]:min-h-[34px] [&_[role=option]]:px-2 [&_[role=option]]:py-1.5 [&_[role=option]]:text-xs";
const fieldClassName = "h-[34px] data-[size=default]:h-[34px] w-full rounded-lg border-0 bg-muted/60 px-3 text-xs font-normal shadow-none";

function sameConfiguration(left: AvatarProfile, right: AvatarProfile) {
  return left.name === right.name && left.imagePath === right.imagePath && left.imageName === right.imageName
    && left.ratio === right.ratio && left.prompt === right.prompt && left.audioClipId === right.audioClipId;
}

function profileStatus(profile: AvatarProfile, jobs: VideoJob[], source: VideoAvatarContext | null) {
  const job = jobs.find(item => item.avatarProfileId === profile.id);
  if (!job) return "未生成";
  if (job.pauseRequested && job.status === "running") return "暂停中";
  if (job.status === "paused") return "已暂停";
  if (["running", "submitting", "saving"].includes(job.status)) return "生成中";
  if (job.status === "stopped") return "已停止";
  if (job.status !== "succeeded") return "需处理";
  const clip = source?.audioClips?.find(item => item.id === profile.audioClipId);
  return job.avatarProfileUpdatedAt === profile.updatedAt && clip?.fingerprint === job.avatarAudioFingerprint ? "已生成" : "待更新";
}

function jobLabel(job: VideoJob) {
  if (job.status === "succeeded") return "已完成";
  if (job.status === "stopped") return "已停止";
  if (job.status === "paused") return "已暂停";
  if (job.pauseRequested && job.status === "running") return "暂停中";
  if (job.status === "saving") return "正在拼接与保存";
  if (["running", "submitting"].includes(job.status)) return "生成中";
  return "需要处理";
}

function jobProgress(job: VideoJob) {
  const segments = job.avatarSequence?.segments ?? [];
  const completed = segments.filter(segment => segment.status === "succeeded").length;
  const total = segments.length;
  const percent = job.status === "succeeded" ? 100 : total ? Math.min(99, Math.floor(completed / total * 100)) : 0;
  const samples = segments.flatMap(segment => segment.startedAt !== undefined && segment.completedAt !== undefined && segment.completedAt > segment.startedAt
    ? [segment.completedAt - segment.startedAt] : []).slice(-5).sort((a, b) => a - b);
  const median = samples.length >= 3 ? samples[Math.floor(samples.length / 2)] : 0;
  const remaining = median * (total - completed);
  const eta = remaining > 0 && job.status === "running" && !job.pauseRequested
    ? `预计还需约 ${Math.max(1, Math.floor(remaining * .75 / 60_000))}–${Math.max(2, Math.ceil(remaining * 1.5 / 60_000))} 分钟`
    : job.status === "running" && !job.pauseRequested ? "正在估算时间" : "";
  return { completed, total, percent, eta };
}

export function VideoAvatarPanel({ client, workspaceId, workspaceRoot, sessionId, active, onOpenVoice, onAssetAction, previewAssetUrl }: Props) {
  const imageInputRef = React.useRef<HTMLInputElement>(null);
  const promptId = React.useId();
  const nameId = React.useId();
  const mounted = React.useRef(true);
  const busyRef = React.useRef(false);
  const previewRef = React.useRef("");
  const thumbnailsRef = React.useRef<Record<string, string>>({});
  const pendingSaveRef = React.useRef<Promise<AvatarProfile | null>>(Promise.resolve(null));
  const profilesRef = React.useRef<AvatarProfile[]>([]);
  const [profiles, setProfiles] = React.useState<AvatarProfile[]>([]);
  const [draft, setDraft] = React.useState<AvatarProfile | null>(null);
  const [source, setSource] = React.useState<VideoAvatarContext | null>(null);
  const [jobs, setJobs] = React.useState<VideoJob[]>([]);
  const [thumbnails, setThumbnails] = React.useState<Record<string, string>>({});
  const [preview, setPreview] = React.useState("");
  const [ready, setReady] = React.useState(false);
  const [checking, setChecking] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [imageMessage, setImageMessage] = React.useState("");
  const [recoveryIds, setRecoveryIds] = React.useState<Record<string, string>>({});
  const [taskOpen, setTaskOpen] = React.useState(false);
  const [taskId, setTaskId] = React.useState<string | null>(null);
  const [starting, setStarting] = React.useState(false);
  const [showAllHistory, setShowAllHistory] = React.useState(false);
  const context = React.useMemo(() => ({ workspaceId, sessionId, directory: workspaceRoot }), [workspaceId, sessionId, workspaceRoot]);
  const call = React.useCallback(async (action: string, args: Record<string, unknown>) => {
    const response = await client.callExtensionAction({ extensionId: "video-generation", action, args, context });
    if (!response.ok) throw new Error(response.message || "视频服务请求失败");
    return response.result;
  }, [client, context]);
  const updateProfiles = React.useCallback((next: AvatarProfile[]) => { profilesRef.current = next; setProfiles(next); }, []);
  const refresh = React.useCallback(async () => {
    const [jobResult, statusResult, sourceResult, profileResult] = await Promise.allSettled([
      call("jobs", {}), call("status", {}), call("avatar-context", {}), call("avatar-profiles", {}),
    ]);
    if (!mounted.current) return;
    if (jobResult.status === "fulfilled") setJobs(videoJobsResultSchema.parse(jobResult.value).jobs.filter(job => job.model === "minimax-h3-avatar"));
    setReady(statusResult.status === "fulfilled" && videoModelStatusSchema.parse(statusResult.value).models.some(model => model.id === "minimax-h3-avatar"));
    if (sourceResult.status === "fulfilled") setSource(videoAvatarContextSchema.parse(sourceResult.value));
    if (profileResult.status === "fulfilled") updateProfiles(avatarProfilesResultSchema.parse(profileResult.value).profiles);
    setChecking(false);
    if (profileResult.status === "rejected") throw profileResult.reason;
    if (sourceResult.status === "rejected") throw sourceResult.reason;
    if (statusResult.status === "rejected") throw statusResult.reason;
  }, [call, updateProfiles]);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      URL.revokeObjectURL(previewRef.current);
      Object.values(thumbnailsRef.current).forEach(url => URL.revokeObjectURL(url));
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
    window.addEventListener("focus", poll);
    return () => { disposed = true; clearInterval(timer); window.removeEventListener("focus", poll); };
  }, [active, refresh]);
  React.useEffect(() => {
    const paths = profiles.map(profile => profile.imagePath).filter(path => path && !thumbnailsRef.current[path]);
    let cancelled = false;
    void Promise.all(paths.map(async path => {
      try {
        const file = await client.downloadWorkspaceFile(workspaceId, path);
        if (cancelled || !mounted.current) return;
        const url = URL.createObjectURL(new Blob([file.data]));
        thumbnailsRef.current[path] = url;
        setThumbnails(current => ({ ...current, [path]: url }));
      } catch { /* A missing image should not hide its saved profile. */ }
    }));
    return () => { cancelled = true; };
  }, [client, profiles, workspaceId]);
  const act = async (fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setMessage("");
    try { await fn(); } catch (error) { if (mounted.current) setMessage(error instanceof Error ? error.message : "操作失败"); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };
  const persist = React.useCallback((next: AvatarProfile) => {
    const save = pendingSaveRef.current.catch(() => null).then(async () => {
      const existing = profilesRef.current.find(profile => profile.id === next.id);
      if (existing && sameConfiguration(existing, next)) return existing;
      const result = avatarProfileResultSchema.parse(await call("avatar-profile-save", {
        id: next.id, name: next.name.trim() || "数字人", imagePath: next.imagePath, imageName: next.imageName,
        ratio: next.ratio, prompt: next.prompt, audioClipId: next.audioClipId,
      }));
      if (mounted.current) {
        updateProfiles(profilesRef.current.map(profile => profile.id === result.profile.id ? result.profile : profile));
        setDraft(current => current?.id === result.profile.id && sameConfiguration(current, next) ? result.profile : current);
      }
      return result.profile;
    });
    pendingSaveRef.current = save;
    return save;
  }, [call, updateProfiles]);
  React.useEffect(() => {
    if (!draft || sameConfiguration(draft, profiles.find(profile => profile.id === draft.id) ?? draft)) return;
    const timer = window.setTimeout(() => { void persist(draft).catch(error => setMessage(error instanceof Error ? error.message : "保存数字人失败")); }, 500);
    return () => window.clearTimeout(timer);
  }, [draft, persist, profiles]);
  const create = async () => {
    const used = new Set(profilesRef.current.map(profile => profile.name));
    let index = 1;
    while (used.has(`数字人 ${index}`)) index++;
    const { profile } = avatarProfileResultSchema.parse(await call("avatar-profile-save", { name: `数字人 ${index}`, ratio: "9:16", prompt: defaultPrompt }));
    updateProfiles([...profilesRef.current, profile]);
    setDraft(profile);
  };
  const back = async () => {
    if (draft) await persist(draft);
    setDraft(null); setImageMessage(""); setPreview("");
  };
  const remove = async () => {
    if (!draft) return;
    await pendingSaveRef.current.catch(() => null);
    await call("avatar-profile-delete", { id: draft.id });
    updateProfiles(profilesRef.current.filter(profile => profile.id !== draft.id));
    setDraft(null); setPreview("");
  };
  const upload = async (file: File) => {
    if (!draft) return;
    setImageMessage("正在读取图片…");
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!["png", "jpg", "jpeg", "webp"].includes(extension)) throw new Error("人物图片支持 PNG、JPG 和 WebP。");
    if (!file.size || file.size > 20 * 1024 * 1024) throw new Error("人物图片不能超过 20 MB，文件不能为空。");
    const bitmap = await createImageBitmap(file);
    bitmap.close();
    const path = `${videoProjectDirectory(sessionId)}/assets/avatar-${crypto.randomUUID()}.${extension}`;
    setImageMessage("正在上传图片…");
    await client.uploadWorkspaceMedia(workspaceId, path, file);
    if (!mounted.current) return;
    const url = URL.createObjectURL(file);
    thumbnailsRef.current[path] = url;
    setThumbnails(current => ({ ...current, [path]: url }));
    setDraft(current => current ? { ...current, imagePath: path, imageName: file.name } : current);
    setImageMessage("图片已上传");
  };
  const show = async (path: string) => {
    if (previewAssetUrl) { setPreview(previewAssetUrl(path)); return; }
    const file = await client.downloadWorkspaceFile(workspaceId, path);
    if (!mounted.current) return;
    URL.revokeObjectURL(previewRef.current);
    previewRef.current = URL.createObjectURL(new Blob([file.data], { type: path.toLowerCase().endsWith(".webm") ? "video/webm" : "video/mp4" }));
    setPreview(previewRef.current);
  };
  const selectedClip = source?.audioClips?.find(clip => clip.id === draft?.audioClipId);
  const canSubmit = Boolean(draft && draft.imagePath && draft.prompt.trim() && selectedClip && ready && !checking);
  const save = async () => {
    if (!draft) return;
    await persist(draft);
    setMessage("设置已保存");
  };
  const submit = async () => {
    if (!draft || !selectedClip || !canSubmit) throw new Error("请先配置人物图片、对应配音片段和 RunningHub Key。");
    const saved = await persist(draft);
    if (!saved) throw new Error("保存数字人失败，请重试。");
    const { job } = videoSubmitResultSchema.parse(await call("submit", {
      requestId: crypto.randomUUID(), model: "minimax-h3-avatar", operation: "reference",
      avatarProfileId: saved.id, avatarProfileUpdatedAt: saved.updatedAt, avatarClipId: selectedClip.id,
      avatarSource: "video-audio", prompt: saved.prompt, imageRefs: saved.imagePath, ratio: saved.ratio,
      duration: String(selectedClip.duration), resolution: AVATAR_STANDARD_VIDEO.resolution,
    }));
    setJobs(current => [job, ...current.filter(item => item.id !== job.id)]);
    setTaskId(job.id);
    setMessage("");
  };
  const beginGeneration = async () => {
    setTaskId(null); setTaskOpen(true); setPreview(""); setStarting(true);
    try { await act(submit); } finally { setStarting(false); }
  };
  const updateJob = async (action: "pause" | "resume" | "stop", id: string) => {
    const { job } = videoSubmitResultSchema.parse(await call(action, { id }));
    setJobs(current => current.map(item => item.id === job.id ? job : item));
  };
  const handleAssetAction = async (action: "view" | "insert", path: string) => {
    if (!onAssetAction) throw new Error("Video Studio 尚未就绪，请稍后重试。");
    await onAssetAction(action, path);
    setTaskOpen(false);
    setMessage(action === "insert" ? "数字人片段已插入当前播放位置，可在时间线中调整。" : "已在素材中打开数字人片段。");
  };
  const visibleJobs = draft ? jobs.filter(job => job.avatarProfileId === draft.id) : jobs.filter(job => !job.avatarProfileId);
  const taskJob = jobs.find(job => job.id === taskId);

  return <div className="video-settings-typography space-y-4 text-xs font-normal text-foreground" data-testid="video-avatar-panel">
    {draft ? <>
      <div className="flex items-center justify-between gap-2"><Button variant="ghost" size="sm" className="-ml-2 h-[34px] text-xs" disabled={busy} onClick={() => void act(back)}><ArrowLeft className="size-4" />数字人列表</Button><Button variant="ghost" size="icon-xs" aria-label="删除此数字人" disabled={busy} onClick={() => setDeleteOpen(true)}><Trash2 className="size-4" /></Button></div>
      <div className="space-y-6">
        <section className="space-y-4" aria-label="名称与人物图片">
          <div className="space-y-1.5"><label htmlFor={nameId} className="text-ui-control font-semibold">名称</label><Input id={nameId} value={draft.name} maxLength={80} disabled={busy} onChange={event => setDraft(current => current ? { ...current, name: event.target.value } : current)} className={fieldClassName} /></div>
          <div className="space-y-2">
            <input ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" aria-label="选择人物图片" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void act(() => upload(file)); }} />
            <button type="button" disabled={busy} onClick={() => imageInputRef.current?.click()} aria-label={draft.imagePath ? "替换人物图片" : "上传人物图片"} className="flex w-full items-center gap-3 rounded-lg bg-muted/60 p-3 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
              {draft.imagePath && thumbnails[draft.imagePath] ? <img src={thumbnails[draft.imagePath]} alt="数字人人物参考图片" className="h-16 w-14 shrink-0 rounded-md object-contain" /> : <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-background"><ImagePlus aria-hidden="true" className="size-5 text-muted-foreground" /></span>}
              <span className="min-w-0 flex-1 space-y-1"><span className="block truncate text-xs font-medium" title={draft.imageName || undefined}>{draft.imageName || "上传人物图片"}</span><span className="block text-[11px] leading-5 text-muted-foreground">{draft.imagePath ? "点击替换图片" : "PNG / JPG / WebP · 最大 20 MB"}</span></span>
            </button>
            {imageMessage && imageMessage !== "图片已上传" ? <p role="status" className={`text-[11px] ${imageMessage.startsWith("图片上传失败") ? "text-destructive" : "text-muted-foreground"}`}>{imageMessage}</p> : null}
          </div>
        </section>
        <section className="space-y-1.5" aria-label="绑定配音片段">
          <label className="text-ui-control font-semibold" htmlFor="avatar-audio-clip">配音片段</label>
          {source?.audioClips?.length ? <><Select value={draft.audioClipId || undefined} onValueChange={value => setDraft(current => current ? { ...current, audioClipId: value ?? "" } : current)}><SelectTrigger id="avatar-audio-clip" aria-label="配音片段" className={fieldClassName}><SelectValue>{selectedClip ? `${selectedClip.label} · ${selectedClip.duration.toFixed(1)} 秒` : "选择这位数字人的配音片段"}</SelectValue></SelectTrigger><SelectContent align="start" className={menuClassName}>{source.audioClips.map(clip => <SelectItem key={clip.id} value={clip.id}>{clip.label} · {clip.duration.toFixed(1)} 秒</SelectItem>)}</SelectContent></Select>{onOpenVoice ? <div className="flex justify-end"><Button type="button" variant="link" size="sm" className="h-auto px-0 text-xs" onClick={onOpenVoice}>调整配音</Button></div> : null}</> : <div className="flex items-start justify-between gap-3"><p role="status" className="min-w-0 text-[11px] leading-5 text-muted-foreground">{checking ? "正在读取配音…" : source?.audioIssue || "当前视频还没有可用的配音。可以先保存形象，设置配音后再生成。"}</p>{onOpenVoice ? <Button type="button" variant="link" size="sm" className="h-auto shrink-0 px-0 text-xs" onClick={onOpenVoice}>去设置配音</Button> : null}</div>}
        </section>
        <section className="space-y-1.5" aria-label="画面设置"><h3 className="text-ui-control font-semibold">画面设置</h3>
          <div className="grid grid-cols-2 gap-2">{(["9:16", "16:9"] as const).map(value => <button key={value} type="button" aria-pressed={draft.ratio === value} aria-label={value === "9:16" ? `竖屏 ${AVATAR_STANDARD_VIDEO.shortEdge}×${AVATAR_STANDARD_VIDEO.longEdge}` : `横屏 ${AVATAR_STANDARD_VIDEO.longEdge}×${AVATAR_STANDARD_VIDEO.shortEdge}`} onClick={() => setDraft(current => current ? { ...current, ratio: value } : current)} className={`relative flex items-center gap-2 rounded-lg border p-2.5 text-left text-xs ${draft.ratio === value ? "border-primary/50 bg-primary/5" : "border-transparent bg-muted/60 text-muted-foreground"}`}>
            {value === "9:16" ? <RectangleVertical aria-hidden="true" className="size-5" strokeWidth={1.5} /> : <RectangleHorizontal aria-hidden="true" className="size-5" strokeWidth={1.5} />}{value === "9:16" ? "竖屏 9:16" : "横屏 16:9"}{draft.ratio === value ? <Check aria-hidden="true" className="ml-auto size-3 text-primary" /> : null}
          </button>)}</div>
          {selectedClip && selectedClip.duration > 15 ? <p className="text-[11px] leading-5 text-muted-foreground">超过 15 秒将自动分段生成并拼接。</p> : null}
        </section>
        <section className="space-y-1.5" aria-label="动作描述">
          <div className="flex items-center justify-between gap-2"><label htmlFor={promptId} className="text-ui-control font-semibold">动作描述</label><Tooltip><TooltipTrigger render={<button type="button" aria-label="动作与背景说明" className="flex items-center gap-1 text-[11px] text-muted-foreground" />}>{avatarBackgroundForPrompt(draft.prompt) === "transparent" ? "透明背景" : "场景背景"}<Info aria-hidden="true" className="size-3" /></TooltipTrigger><TooltipContent className="text-[11px]">如需场景，请在动作描述中写出背景。</TooltipContent></Tooltip></div>
          <Textarea id={promptId} value={draft.prompt} rows={3} maxLength={3000} disabled={busy} onChange={event => setDraft(current => current ? { ...current, prompt: event.target.value } : current)} className="min-h-20 resize-none border-0 bg-muted/60 text-xs leading-5 shadow-none" />
        </section>
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2"><Button type="button" variant="outline" className="h-[34px] w-full rounded-lg text-ui-control shadow-none before:shadow-none" disabled={busy} onClick={() => void act(save)}>保存设置</Button><Button type="button" className="h-[34px] w-full rounded-lg text-[13px] disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100" disabled={busy || !canSubmit} onClick={() => void beginGeneration()}>{busy ? <Loader2 className="size-4 animate-spin" /> : null}生成数字人片段</Button></div>
          <p className="text-[11px] leading-5 text-muted-foreground">{checking ? "正在检查视频服务…" : ready ? "保存设置不会生成视频；生成片段按 RunningHub 实际用量计费。" : "请先在授权中心配置 RunningHub 视频服务的 Key。"}</p>
        </div>
      </div>
    </> : <>
      <div className="flex min-h-[34px] items-center gap-2">
        {profiles.length ? <p className="text-ui-caption text-muted-foreground">已创建 {profiles.length} 位</p> : null}
        <Button variant="outline" size="sm" className="ml-auto h-[34px] rounded-lg text-ui-control shadow-none before:shadow-none" disabled={busy} onClick={() => void act(create)}><Plus className="size-4" />创建数字人</Button>
      </div>
      {profiles.length ? <div className="space-y-2">{profiles.map(profile => {
        const status = profileStatus(profile, jobs, source);
        const job = jobs.find(item => item.avatarProfileId === profile.id);
        return <button key={profile.id} type="button" data-testid="avatar-profile-card" disabled={busy} onClick={() => { setDraft(profile); setPreview(""); }} className="flex w-full items-center gap-3 rounded-lg border border-border/70 p-2 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-md bg-muted/60">{profile.imagePath && thumbnails[profile.imagePath] ? <img src={thumbnails[profile.imagePath]} alt="" className="h-full w-full object-cover" /> : <ImagePlus aria-hidden="true" className="size-5 text-muted-foreground" />}</span>
          <span className="min-w-0 flex-1"><span className="block truncate text-ui-control font-medium">{profile.name}</span><span className="mt-0.5 block truncate text-ui-caption text-muted-foreground">{status}{job?.status === "succeeded" && status === "已生成" ? " · 可预览" : ""}</span></span>
          <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        </button>;
      })}</div> : <p className="rounded-lg bg-muted/45 p-4 text-center text-[11px] leading-5 text-muted-foreground">还没有数字人。创建后可先保存形象，再选择配音片段生成。</p>}
    </>}
    {message ? <p role="status" className="break-words text-[11px] leading-5 text-muted-foreground">{message}</p> : null}
    {visibleJobs.length > 0 ? <section className="space-y-2 border-t border-border/60 pt-4" aria-label={draft ? "此数字人的生成记录" : "历史生成记录"}>
      <div className="flex items-center justify-between"><h3 className="text-ui-control font-semibold">生成记录 <span className="font-normal text-muted-foreground">{visibleJobs.length}</span></h3><Button variant="ghost" size="icon-xs" aria-label="刷新数字人任务" disabled={busy} onClick={() => void act(refresh)}><RefreshCw /></Button></div>
      {(showAllHistory ? visibleJobs : visibleJobs.slice(0, 3)).map(job => {
        const progress = jobProgress(job);
        return <button key={job.id} type="button" data-testid="avatar-job-card" onClick={() => { setTaskId(job.id); setPreview(""); setTaskOpen(true); }} className="flex w-full items-center justify-between gap-2 rounded-lg border border-border/70 px-3 py-2 text-left text-xs hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="min-w-0"><span className="block font-medium">{jobLabel(job)} · {new Date(job.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span><span className="block truncate text-[11px] text-muted-foreground">{progress.total ? `${progress.completed}/${progress.total} 段 · ${job.avatarSequence?.duration.toFixed(1)} 秒` : "正在准备生成"}</span></span><ChevronRight className="size-4 shrink-0 text-muted-foreground" /></button>;
      })}
      {visibleJobs.length > 3 ? <Button type="button" variant="link" size="sm" className="h-auto px-0 text-xs" onClick={() => setShowAllHistory(current => !current)}>{showAllHistory ? "收起记录" : `查看全部 ${visibleJobs.length} 条`}</Button> : null}
    </section> : null}
    <AvatarTaskDialog open={taskOpen} onOpenChange={setTaskOpen} job={taskJob} starting={starting} error={message} busy={busy} preview={preview} recoveryId={taskJob ? recoveryIds[taskJob.id] ?? "" : ""} onRecoveryId={value => { if (taskJob) setRecoveryIds(current => ({ ...current, [taskJob.id]: value })); }} onShow={path => void act(() => show(path))} onPause={() => { if (taskJob) void act(() => updateJob("pause", taskJob.id)); }} onResume={() => { if (taskJob) void act(() => updateJob("resume", taskJob.id)); }} onStop={() => { if (taskJob) void act(() => updateJob("stop", taskJob.id)); }} onRetry={index => { if (taskJob) void act(async () => { await call("retry-segment", { id: taskJob.id, index }); await refresh(); }); }} onRecover={() => { if (taskJob) void act(async () => { await call("recover", { id: taskJob.id, ...(recoveryIds[taskJob.id]?.trim() ? { upstreamId: recoveryIds[taskJob.id].trim() } : {}) }); await refresh(); }); }} onAssetAction={action => { if (taskJob?.path) void act(() => handleAssetAction(action, taskJob.path)); }} onRegenerate={() => void beginGeneration()} canRegenerate={canSubmit} />
    <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}><AlertDialogContent className="video-settings-typography gap-4 rounded-xl p-5"><AlertDialogTitle className="text-sm">删除「{draft?.name}」？</AlertDialogTitle><AlertDialogDescription className="text-xs leading-5">这会删除人物配置，已生成的视频仍保留在素材库。</AlertDialogDescription><AlertDialogFooter><Button type="button" variant="outline" className="h-[34px] text-xs" onClick={() => setDeleteOpen(false)}>取消</Button><AlertDialogAction type="button" variant="destructive" className="h-[34px] text-xs" onClick={() => { setDeleteOpen(false); void act(remove); }}>删除数字人</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}

type AvatarTaskDialogProps = {
  open: boolean; onOpenChange: (open: boolean) => void; job?: VideoJob; starting: boolean; error: string; busy: boolean;
  preview: string; recoveryId: string; onRecoveryId: (value: string) => void; onShow: (path: string) => void;
  onPause: () => void; onResume: () => void; onStop: () => void; onRetry: (index: number) => void;
  onRecover: () => void; onAssetAction: (action: "view" | "insert") => void; onRegenerate: () => void; canRegenerate: boolean;
};

function AvatarTaskDialog({ open, onOpenChange, job, starting, error, busy, preview, recoveryId, onRecoveryId, onShow, onPause, onResume, onStop, onRetry, onRecover, onAssetAction, onRegenerate, canRegenerate }: AvatarTaskDialogProps) {
  const [stopOpen, setStopOpen] = React.useState(false);
  const sequence = job?.avatarSequence;
  const progress = job ? jobProgress(job) : null;
  const currentIndex = sequence?.segments.findIndex(segment => segment.status !== "succeeded") ?? -1;
  const preparationFailed = sequence?.segments.some(segment => ["failed", "save_failed"].includes(segment.status) && !segment.upstreamId && !segment.path);
  const isActive = job && ["running", "submitting", "saving"].includes(job.status);
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent data-testid="avatar-task-dialog" className="video-settings-typography max-h-[calc(100dvh-32px)] max-w-lg gap-4 overflow-y-auto rounded-xl p-5 text-xs">
      <DialogHeader className="gap-1 pr-8"><DialogTitle className="text-ui-title-sm font-semibold">数字人片段 · {job ? jobLabel(job) : "准备中"}</DialogTitle><DialogDescription className="text-ui-caption">关闭窗口后任务仍会继续，可从生成记录重新打开。</DialogDescription></DialogHeader>
      {job ? <div className="space-y-4">
        <div className="space-y-2 rounded-lg bg-muted/50 p-4" role="status">
          <div className="flex items-center justify-between gap-3"><span className="font-medium">{job.status === "saving" ? "正在拼接与保存" : currentIndex >= 0 && isActive ? `第 ${currentIndex + 1}/${progress?.total} 段正在生成` : jobLabel(job)}</span><span className="tabular-nums">{progress?.percent}%</span></div>
          <Progress value={progress?.percent ?? 0} aria-label="数字人生成进度" className="[&_[data-slot=progress-track]]:h-2" />
          <div className="flex flex-wrap justify-between gap-1 text-[11px] text-muted-foreground"><span>{sequence ? `已完成 ${progress?.completed}/${progress?.total} 段 · 视频 ${sequence.duration.toFixed(1)} 秒` : job.status === "succeeded" ? "视频片段已生成" : "正在准备生成"}</span><span>{progress?.eta || (job.status === "saving" ? "正在完成最后处理" : "")}</span></div>
        </div>
        {job.message ? <p className="break-words text-[11px] leading-5 text-muted-foreground">{job.message}</p> : null}
        {job.status === "succeeded" && job.path ? <div className="space-y-3"><p className="font-medium">片段已保存到素材库</p>{preview ? <video controls src={preview} className="max-h-60 w-full rounded-lg bg-black" /> : <Button type="button" variant="outline" className="h-[34px] w-full rounded-lg text-xs shadow-none" disabled={busy} onClick={() => onShow(job.path)}><Play className="size-4" />预览数字人</Button>}<div className="grid grid-cols-2 gap-2"><Button type="button" variant="outline" className="h-[34px] rounded-lg text-xs shadow-none" disabled={busy} onClick={() => onAssetAction("view")}>在素材中查看</Button><Button type="button" className="h-[34px] rounded-lg text-xs text-white" disabled={busy} onClick={() => onAssetAction("insert")}>插入当前视频</Button></div></div> : null}
        {job.status === "running" && sequence && !job.pauseRequested ? <Button type="button" variant="outline" className="h-[34px] w-full rounded-lg text-xs shadow-none" disabled={busy} onClick={onPause}><Pause className="size-4" />当前片段完成后暂停</Button> : null}
        {job.status === "paused" ? <Button type="button" className="h-[34px] w-full rounded-lg text-xs text-white" disabled={busy} onClick={onResume}><Play className="size-4" />继续生成</Button> : null}
        {job.pauseRequested && job.status === "running" ? <p className="text-[11px] text-muted-foreground">暂停请求已收到，当前片段保存后会暂停。</p> : null}
        {["running", "submitting", "paused", "uncertain"].includes(job.status) ? <Button type="button" variant="ghost" className="h-[30px] text-xs text-destructive" disabled={busy} onClick={() => setStopOpen(true)}>停止生成</Button> : null}
        {["uncertain", "save_failed"].includes(job.status) || job.status === "failed" && preparationFailed ? <div className="space-y-2">{job.status === "uncertain" && !job.upstreamId && !sequence?.segments.some(segment => segment.status !== "succeeded" && segment.upstreamId) ? <Input className="text-xs" aria-label="已有服务商任务 ID" placeholder="填写已有 RunningHub 任务 ID" value={recoveryId} onChange={event => onRecoveryId(event.target.value)} /> : null}<Button type="button" variant="outline" className="h-[34px] text-xs" disabled={busy} onClick={onRecover}>{preparationFailed ? "恢复准备并继续生成" : "恢复查询或拼接"}</Button></div> : null}
        {["succeeded", "failed", "stopped"].includes(job.status) && canRegenerate ? <Button type="button" variant="ghost" className="h-[30px] text-xs" disabled={busy} onClick={onRegenerate}>按当前设置重新生成（计费）</Button> : null}
        {sequence ? <Collapsible className="rounded-lg border border-border/70"><CollapsibleTrigger className="flex w-full items-center justify-between p-3 text-left text-[11px] font-medium">片段详情 <ChevronDown className="size-4" /></CollapsibleTrigger><CollapsibleContent data-testid="avatar-job-details" className="max-h-48 space-y-2 overflow-y-auto border-t border-border/70 p-3 text-[11px]">{sequence.segments.map((segment, index) => <div key={index} className="flex items-center justify-between gap-2"><span>第 {index + 1} 段 · {segment.start.toFixed(1)}–{segment.end.toFixed(1)} 秒 · {segment.status === "succeeded" ? "已保存" : segment.status === "pending" ? "待生成" : segment.status === "running" ? "生成中" : "需处理"}</span>{segment.status === "failed" && segment.path ? <Button type="button" variant="link" className="h-auto p-0 text-[11px]" onClick={() => onShow(segment.path)}>预览</Button> : null}{["failed", "save_failed"].includes(job.status) && (segment.status === "failed" && Boolean(segment.upstreamId || segment.path) || job.status === "save_failed" && sequence.segments.every(item => item.status === "succeeded")) ? <Button type="button" variant="link" className="h-auto p-0 text-[11px]" disabled={busy} onClick={() => onRetry(index)}>重试</Button> : null}</div>)}</CollapsibleContent></Collapsible> : null}
        {preview && job.status !== "succeeded" ? <video controls src={preview} className="max-h-48 w-full rounded-lg bg-black" /> : null}
      </div> : <div className="flex min-h-28 items-center justify-center gap-2 text-muted-foreground"><Loader2 className="size-4 animate-spin" />{starting ? "正在准备数字人任务…" : error || "正在读取任务…"}</div>}
      {error && job ? <p role="alert" className="text-[11px] text-destructive">{error}</p> : null}
    </DialogContent>
    <AlertDialog open={stopOpen} onOpenChange={setStopOpen}><AlertDialogContent className="video-settings-typography gap-4 rounded-xl p-5"><AlertDialogTitle className="text-sm">停止数字人生成？</AlertDialogTitle><AlertDialogDescription className="text-xs leading-5">后续片段不再生成，已完成片段会保留。当前片段将请求服务商取消，是否继续计费以服务商结果为准。</AlertDialogDescription><AlertDialogFooter><Button type="button" variant="outline" className="h-[34px] text-xs" onClick={() => setStopOpen(false)}>返回任务</Button><AlertDialogAction type="button" variant="destructive" className="h-[34px] text-xs" onClick={() => { setStopOpen(false); onStop(); }}>停止生成</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </Dialog>;
}
