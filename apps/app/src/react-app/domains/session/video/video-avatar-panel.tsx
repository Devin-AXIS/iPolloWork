/** @jsxImportSource react */
import * as React from "react";
import { videoJobsResultSchema, videoSubmitResultSchema, videoModelStatusSchema, type VideoJob } from "@ipollowork/types/video-generation";
import { Loader2, RefreshCw } from "lucide-react";
import type { iPolloWorkServerClient } from "@/app/lib/ipollowork-server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { VideoVoiceoverSettings } from "./video-voice";
import { videoProjectDirectory } from "./video-project";

type Props = { client: iPolloWorkServerClient; workspaceId: string; workspaceRoot: string; sessionId: string;
  voice: VideoVoiceoverSettings | null; onAddVideo?: (path: string) => Promise<void> };

// Owns only the avatar form. Submission, persistence and polling remain server-owned.
export function VideoAvatarPanel({ client, workspaceId, workspaceRoot, sessionId, voice, onAddVideo }: Props) {
  const [image, setImage] = React.useState("");
  const [audio, setAudio] = React.useState("");
  const [text, setText] = React.useState("");
  const [ratio, setRatio] = React.useState("9:16");
  const [duration, setDuration] = React.useState("10");
  const [prompt, setPrompt] = React.useState("人物面向镜头自然说话，保持人物身份、背景和镜头稳定。");
  const [ready, setReady] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(false);
  const [message, setMessage] = React.useState("");
  const [jobs, setJobs] = React.useState<VideoJob[]>([]);
  const [audioFiles, setAudioFiles] = React.useState<string[]>([]);
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
    const result = videoJobsResultSchema.parse(await call("jobs", {}));
    if (mounted.current) setJobs(result.jobs.filter(job => job.model === "minimax-h3-avatar"));
  }, [call]);
  React.useEffect(() => {
    mounted.current = true;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { await refresh(); } catch (error) { if (!disposed) setMessage(error instanceof Error ? error.message : "无法读取任务"); }
      if (!disposed) timer = setTimeout(() => void poll(), 10_000);
    };
    void call("status", {}).then(value => {
      const status = videoModelStatusSchema.parse(value);
      if (!disposed) setReady(status.models.some(model => model.id === "minimax-h3-avatar"));
    }).catch(error => { if (!disposed) setMessage(error instanceof Error ? error.message : "无法读取授权"); });
    void poll();
    void client.listSessionArtifacts(workspaceId, sessionId).then(page => {
      if (!disposed) setAudioFiles(page.items.filter(item => /\.(mp3|wav)$/i.test(item.path)).map(item => item.path));
    }).catch(() => undefined);
    return () => { disposed = true; mounted.current = false; clearTimeout(timer); URL.revokeObjectURL(previewRef.current); };
  }, [call, client, refresh, sessionId, workspaceId]);
  const act = async (fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setMessage("");
    try { await fn(); } catch (error) { if (mounted.current) setMessage(error instanceof Error ? error.message : "操作失败"); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };
  const upload = async (file: File, kind: "image" | "audio") => {
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!(kind === "image" ? ["png", "jpg", "jpeg", "webp"] : ["mp3", "wav"]).includes(extension)) throw new Error("图片支持 PNG/JPG/WebP，音频支持 MP3/WAV。");
    if (!file.size || file.size > (kind === "image" ? 20 : 15) * 1024 * 1024) throw new Error("图片上限 20 MB，音频上限 15 MB，文件不能为空。");
    const path = `${videoProjectDirectory(sessionId)}/assets/avatar-${crypto.randomUUID()}.${extension}`;
    await client.writeWorkspaceBinaryFile(workspaceId, { path, data: await file.arrayBuffer() });
    if (mounted.current) { if (kind === "image") setImage(path); else setAudio(path); }
  };
  const synthesize = async () => {
    if (!voice || !text.trim()) throw new Error("先在百炼音色或我的声音中选好声音，再输入配音文字。");
    const outputPath = `${videoProjectDirectory(sessionId)}/assets/avatar-voice-${crypto.randomUUID()}.mp3`;
    const response = await client.callMedia("speech_synthesize_workspace_file", {
      text: text.trim(), sceneText: text.trim(), sceneId: "avatar", sceneStart: 0, sceneDuration: Number(duration),
      outputPath, voice: voice.voiceId, model: voice.model,
    }, context);
    if (!response.ok) throw new Error(response.message || "配音生成失败");
    const payload = response.result;
    if (!payload || typeof payload !== "object" || !("output" in payload)) throw new Error("配音没有返回文件。");
    const result = payload.output;
    if (!result || typeof result !== "object" || !("sourcePath" in result) || typeof result.sourcePath !== "string"
      || !("durationSeconds" in result) || typeof result.durationSeconds !== "number") throw new Error("配音没有返回有效时长。");
    if (mounted.current) {
      setAudio(result.sourcePath);
      const nextDuration = String(Math.min(15, Math.max(5, Math.ceil(result.durationSeconds))));
      setDuration(nextDuration);
      setMessage(`配音已生成，共 ${result.durationSeconds.toFixed(1)} 秒。视频使用开头 ${nextDuration} 秒以内的音频；单次支持 5–15 秒。`);
    }
  };
  const submit = async () => {
    const result = videoSubmitResultSchema.parse(await call("submit", {
      requestId: crypto.randomUUID(), model: "minimax-h3-avatar", operation: "reference", prompt,
      resolution: "0.589824MP", duration, ratio, imageRefs: image, audioRefs: audio,
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
  return <div className="space-y-3" data-testid="video-avatar-panel">
    <p className="text-xs text-muted-foreground">上传人物图和配音，生成对口型数字人视频。MiniMax H3 · lightx2v</p>
    {!ready ? <p role="status" className="text-xs text-amber-600">请先在授权中心配置 RunningHub 视频服务。</p> : null}
    <label className="block space-y-1 text-xs">人物图片<Input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={event => { const file = event.target.files?.[0]; if (file) void act(() => upload(file, "image")); }} /></label>
    {image ? <p className="break-all text-[11px] text-muted-foreground">已选择：{image.split("/").pop()}</p> : null}
    <label className="block space-y-1 text-xs">上传配音<Input type="file" accept=".mp3,.wav" disabled={busy} onChange={event => { const file = event.target.files?.[0]; if (file) void act(() => upload(file, "audio")); }} /></label>
    {audioFiles.length ? <Select value={audioFiles.includes(audio) ? audio : ""} onValueChange={value => { if (value) setAudio(value); }}><SelectTrigger className="w-full min-w-0" aria-label="选择已有配音"><SelectValue className="min-w-0 overflow-hidden" placeholder="选择本会话已有配音">{audioFiles.includes(audio) ? audio.split("/").pop() : "选择本会话已有配音"}</SelectValue></SelectTrigger><SelectContent>{audioFiles.map(path => <SelectItem key={path} value={path}>{path.split("/").pop()}</SelectItem>)}</SelectContent></Select> : null}
    <label className="block space-y-1 text-xs">配音文件路径<Input value={audio} placeholder="也可填写工作区内的 MP3/WAV 路径" onChange={event => setAudio(event.target.value)} /></label>
    <details className="rounded-lg border p-2 text-xs"><summary>用已选声音生成配音</summary><p className="my-2 text-muted-foreground">{voice ? `当前声音：${voice.voiceId}` : "先在百炼音色或我的声音页签选择声音。"}</p><Textarea aria-label="配音文字" value={text} maxLength={1000} onChange={event => setText(event.target.value)} /><Button className="mt-2" size="sm" disabled={busy || !voice || !text.trim()} onClick={() => void act(synthesize)}>生成配音（百炼计费）</Button></details>
    <div className="grid grid-cols-2 gap-2"><Select value={ratio} onValueChange={value => { if (value) setRatio(value); }}><SelectTrigger aria-label="数字人画幅"><SelectValue>{ratio === "9:16" ? "竖屏 576×1024" : "横屏 1024×576"}</SelectValue></SelectTrigger><SelectContent><SelectItem value="9:16">竖屏 576×1024</SelectItem><SelectItem value="16:9">横屏 1024×576</SelectItem></SelectContent></Select><Select value={duration} onValueChange={value => { if (value) setDuration(value); }}><SelectTrigger aria-label="数字人视频时长"><SelectValue>{duration} 秒</SelectValue></SelectTrigger><SelectContent>{Array.from({ length: 11 }, (_, i) => String(i + 5)).map(seconds => <SelectItem key={seconds} value={seconds}>{seconds} 秒</SelectItem>)}</SelectContent></Select></div>
    <label className="block space-y-1 text-xs">动作描述<Textarea value={prompt} maxLength={7000} onChange={event => setPrompt(event.target.value)} /></label>
    <p className="text-[11px] text-muted-foreground">音频从 0 秒开始 · 6 步 · match。视频按 RunningHub Plus 实际计算耗时计费，配音不足时结果可能较短。</p>
    <Button className="w-full" disabled={busy || !ready || !image || !audio || !prompt.trim()} onClick={() => void act(submit)}>{busy ? <Loader2 className="animate-spin" /> : null}生成数字人视频（付费）</Button>
    {message ? <p role="status" className="break-words text-xs">{message}</p> : null}
    <div className="flex items-center justify-between text-xs">本会话数字人任务<Button variant="ghost" size="icon-xs" aria-label="刷新数字人任务" disabled={busy} onClick={() => void act(refresh)}><RefreshCw /></Button></div>
    {jobs.map(job => <div key={job.id} className="space-y-2 rounded-lg border p-2 text-xs"><p>{job.status === "succeeded" ? "已完成" : ["running", "submitting", "saving"].includes(job.status) ? "生成处理中" : "需要处理"}</p><p className="break-words text-muted-foreground">{job.message}</p>{job.path ? <div className="flex gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => void act(() => show(job.path))}>预览</Button>{onAddVideo ? <Button size="sm" disabled={busy} onClick={() => void act(async () => { await onAddVideo(job.path); setMessage("已添加到当前项目素材，可拖入时间线。"); })}>添加到项目素材</Button> : null}</div> : null}{["uncertain", "save_failed"].includes(job.status) && job.upstreamId ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(async () => { await call("recover", { id: job.id }); await refresh(); })}>恢复查询（不重新生成）</Button> : null}</div>)}
    {preview ? <video controls src={preview} className="max-h-80 w-full rounded-lg" /> : null}
  </div>;
}
