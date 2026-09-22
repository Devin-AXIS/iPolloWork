/** @jsxImportSource react */
import React from "react";
import { HashRouter } from "react-router-dom";
import { createRoot } from "react-dom/client";
import { createiPolloWorkServerClient } from "../src/app/lib/ipollowork-server";
import { VideoAvatarPanel } from "../src/react-app/domains/session/video/video-avatar-panel";
import { VIDEO_VOICEOVER_REQUEST, type VideoVoiceoverRequest } from "../src/react-app/domains/session/video/video-voice";
import { VideoVoicePanel } from "../src/react-app/domains/session/video/video-voice-panel";
import { DesignSystemDrawer } from "../src/react-app/domains/session/design/design-system-drawer";
import "../src/app/index.css";
import { setLocale } from "../src/i18n";
import type { AvatarProfile, VideoJob } from "@ipollowork/types/video-generation";
setLocale("zh");

// Real panel and HTTP client, simulated provider boundary: never bills or uses credentials.
const requests: Array<Record<string, unknown>> = [];
const jobs: VideoJob[] = [];
const profiles: AvatarProfile[] = [];
const longProof = new URLSearchParams(location.search).has("long");
const preparationFailureProof = new URLSearchParams(location.search).has("prepareFail");
const completedProof = new URLSearchParams(location.search).has("complete");
const etaProof = new URLSearchParams(location.search).has("eta");
const longSegmentCount = Number(new URLSearchParams(location.search).get("segments")) || 5;
if (preparationFailureProof) jobs.push({ id: "f251fcef-00fb-429d-ab4f-3db091849e08", model: "minimax-h3-avatar", operation: "reference", prompt: "提交前失败验证", fingerprint: "proof", workspaceId: "proof", sessionId: "avatar-proof", status: "failed", path: "", upstreamId: "", message: "数字人工作流节点已变化，尚未提交生成。", createdAt: Date.now(), updatedAt: Date.now(), nextPoll: 0 });
if (longProof) jobs.push({ id: "31f13c04-a138-4499-b9e4-293796ec07cc", model: "minimax-h3-avatar", operation: "reference", prompt: "长数字人验证", fingerprint: "proof", workspaceId: "proof", sessionId: "avatar-proof", status: completedProof ? "succeeded" : etaProof ? "running" : "failed", path: completedProof ? "video/avatar-proof/assets/avatar-result.mp4" : "", upstreamId: "", message: completedProof ? "已保存到素材库。" : etaProof ? "第 4 段正在生成。" : `第 2/${longSegmentCount} 段失败；第 1 段已保存，可只重试失败片段。`, createdAt: Date.now(), updatedAt: Date.now(), nextPoll: 0,
  avatarSequence: {duration:longSegmentCount === 5 ? 58 : 935.8,audioPath:"voice.wav",imagePath:"person.png",ratio:"9:16",segments:Array.from({length:longSegmentCount},(_,index)=>({start:index*11.5,end:index*11.5+12.5,status:completedProof||etaProof&&index<3||index===0?"succeeded":!etaProof&&index===1?"failed":"pending",upstreamId:index<2?`task-${index}`:"",path:completedProof?`saved-${index}.mp4`:index===0?"saved-first.mp4":!etaProof&&index===1?"rejected-second.mp4":"",attempt:0,...(etaProof && index < 3 ? { startedAt: Date.now() - (index + 4) * 60_000, completedAt: Date.now() - (index + 3) * 60_000 } : {})}))} });
const voiceProofParams = new URLSearchParams(location.search);
let savedVoice = voiceProofParams.get("saved") === "none" ? "" : JSON.stringify({ enabled: voiceProofParams.get("saved") !== "off", provider: "aliyun-bailian", model: "cosyvoice-v3-flash", voiceId: "longanyang", source: "preset", selectionMode: voiceProofParams.get("mode") === "manual" ? "manual" : "auto", volume: voiceProofParams.has("volume") ? Number(voiceProofParams.get("volume")) : 50, updatedAt: new Date().toISOString() });
const audioMarkup = (voice = "longyingmu_v3", rate = 1, pitch = 1, volume = 50, instruction = "") => `<audio src="assets/voice-${voice}.mp3" data-ipw-voiceover="true" data-ipw-voice="${voice}" data-ipw-voice-model="cosyvoice-v3-flash" data-ipw-voice-rate="${rate}" data-ipw-voice-pitch="${pitch}" data-ipw-voice-volume="${volume}" data-ipw-voice-instruction="${instruction}"></audio>`;
let appliedHtml = voiceProofParams.has("applied")
  ? voiceProofParams.get("applied") === "legacy" ? '<audio id="voiceover-old" src="old.mp3"></audio>'
    : audioMarkup() + (voiceProofParams.get("applied") === "mixed" ? audioMarkup("longanyang") : "")
  : "<html><body>视频场景</body></html>";
const proofVoices = voiceProofParams.has("mine") ? [{ id: "proof-ready", name: "我的旁白", model: "cosyvoice-v3-flash", status: "OK" }, { id: "proof-pending", name: "准备中的声音", model: "cosyvoice-v3-flash", status: "DEPLOYING" }] : [];
let configured = longProof || voiceProofParams.has("profiles"), hasNarration = longProof || voiceProofParams.has("audio");
let audioVersion = 1;
let failUpload = false;
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = String(input);
  if (!url.startsWith("https://avatar-proof.invalid")) return originalFetch(input, init);
  const path = new URL(url).pathname;
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
  const json = (value: unknown) => Promise.resolve(Response.json(value));
  if (path.endsWith("/extensions/call")) {
    requests.push(body);
    const { action, extensionId, args } = body;
    if (extensionId === "media") {
      if (action === "status") return json({ ok: true, result: { output: { configured: voiceProofParams.get("auth") !== "off" } } });
      if (action === "voice_list") return json({ ok: true, result: { output: { items: proofVoices } } });
      if (action === "voice_clone_workspace_file") {
        if (voiceProofParams.has("cloneDelay")) await new Promise(resolve => setTimeout(resolve, 1800));
        if (voiceProofParams.has("cloneFail")) return json({ ok: false, message: "模拟复刻失败，请重试。" });
        const voice = { id: "proof-cloned", name: args.name, model: "cosyvoice-v3-flash", status: "OK" };
        proofVoices.push(voice);
        return json({ ok: true, result: { output: { voiceId: voice.id, model: voice.model } } });
      }
      if (action === "speech_synthesize") return json({ ok: true, result: { output: { output: { audio: { url: "data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YSADAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==" } } } } });
      if (action === "speech_synthesize_workspace_file") return json({ ok: true, result: { output: { sourcePath: args.outputPath, durationSeconds: 8.2 } } });
    }
    if (extensionId === "storage") return json({ ok: true, result: { output: { providers: [] } } });
    if (action === "status") return json({ ok: true, result: { models: configured ? [{ id: "minimax-h3-avatar" }] : [] } });
    if (action === "avatar-context") return json({ok:true,result:{content:"一款插画风格的智能家居产品介绍",audioCount:hasNarration?2:0,audioDuration:hasNarration?(longProof?58:8.2):0,audioIssue:hasNarration?"":"当前视频没有配音素材。",audioClips:hasNarration?[{id:"all",label:"整段配音",start:0,duration:longProof?58:8.2,voiceId:"",fingerprint:`all-${audioVersion}`},{id:"scene-one",label:"片段 1",start:0,duration:4.2,voiceId:"longanyang",fingerprint:`one-${audioVersion}`},{id:"scene-two",label:"片段 2",start:4.2,duration:4,voiceId:"longanhuan",fingerprint:`two-${audioVersion}`}]:[]}});
    if (action === "avatar-profiles") return json({ok:true,result:{profiles}});
    if (action === "avatar-profile-save") {
      const previous = profiles.find(profile => profile.id === args.id);
      const profile: AvatarProfile = { id: previous?.id ?? crypto.randomUUID(), name: String(args.name), imagePath: String(args.imagePath ?? ""), imageName: String(args.imageName ?? ""), ratio: args.ratio === "16:9" ? "16:9" : "9:16", prompt: String(args.prompt ?? ""), audioClipId: String(args.audioClipId ?? ""), updatedAt: previous && previous.name === args.name && previous.imagePath === args.imagePath && previous.imageName === args.imageName && previous.ratio === args.ratio && previous.prompt === args.prompt && previous.audioClipId === args.audioClipId ? previous.updatedAt : Date.now() };
      if (previous) profiles.splice(profiles.indexOf(previous), 1, profile); else profiles.push(profile);
      return json({ok:true,result:{profile}});
    }
    if (action === "avatar-profile-delete") { const index = profiles.findIndex(profile => profile.id === args.id); if (index >= 0) profiles.splice(index, 1); return json({ok:true,result:{deleted:true}}); }
    if (action === "jobs") return json({ ok: true, result: { jobs } });
    if (action === "retry-segment") {
      const job=jobs.find(item=>item.id===args.id);
      if(!job?.avatarSequence)throw new Error("missing sequence");
      job.avatarSequence.segments[args.index]={...job.avatarSequence.segments[args.index],status:"pending",upstreamId:"",path:"",attempt:1};
      job.status="running";job.message=`只重试第 ${args.index+1} 段，其余已保存片段保持不变（模拟）。`;
      return json({ok:true,result:{job}});
    }
    if (action === "pause" || action === "resume") {
      const job = jobs.find(item => item.id === args.id);
      if (!job) throw new Error("missing job");
      job.pauseRequested = action === "pause";
      job.status = "running";
      job.message = action === "pause" ? "将在当前片段完成后暂停。" : "继续生成未完成片段。";
      return json({ ok: true, result: { job } });
    }
    if (action === "stop") {
      const job = jobs.find(item => item.id === args.id);
      if (!job) throw new Error("missing job");
      job.status = "stopped";
      job.message = "已停止后续生成，并已向 RunningHub 请求取消当前片段；是否停止计费以服务商结果为准。";
      return json({ ok: true, result: { job } });
    }
    if (action === "submit") {
      const receipt=document.getElementById("submission-receipt"); if(receipt&&!longProof) receipt.textContent=JSON.stringify(args,null,2);
      const profile = profiles.find(item => item.id === args.avatarProfileId);
      const job: VideoJob = { id: args.requestId, model: args.model, status: "succeeded", path: "video/avatar-proof/assets/result.mp4", message: "已自动加入当前 Video Studio 素材库（模拟结果，没有调用云端）", upstreamId: "simulated", workspaceId: "proof", sessionId: "avatar-proof", operation: "reference", prompt: args.prompt, fingerprint: "proof", createdAt: Date.now(), updatedAt: Date.now(), nextPoll: 0, ...(profile ? {avatarProfileId:profile.id,avatarProfileUpdatedAt:profile.updatedAt,avatarAudioFingerprint:`${args.avatarClipId === "scene-one" ? "one" : args.avatarClipId === "scene-two" ? "two" : "all"}-${audioVersion}`,avatarAudioStart:args.avatarClipId === "scene-two" ? 4.2 : 0} : {}) };
      jobs.unshift(job); return json({ ok: true, result: { job } });
    }
  }
  if (path.endsWith("/artifacts")) return json({ items: [{ path: "video/avatar-proof/assets/existing.wav" }], nextCursor: null });
  if (path.endsWith("/files/content")) {
    if (typeof body.content === "string") {
      savedVoice = body.content;
      requests.push({ action: "save-voice", path: body.path, settings: JSON.parse(savedVoice) });
    }
    return json({ content: savedVoice, updatedAt: 1 });
  }
  if (path.endsWith("/files/raw")) {
    const file = init?.body instanceof FormData ? init.body.get("file") : null;
    const uploadPath = new URL(url).searchParams.get("path");
    requests.push({ action: "upload", path: uploadPath, size: file instanceof File ? file.size : 0 });
    if (!(file instanceof File) || !uploadPath) return Response.json({ message: "Expected multipart image upload" }, { status: 400 });
    await new Promise(resolve => setTimeout(resolve, 1200));
    if (failUpload) return Response.json({ message: "模拟上传失败，请重试" }, { status: 503 });
    return json({ ok: true, path: uploadPath, updatedAt: 1 });
  }
  throw new Error(`Unhandled proof route ${path}`);
};
Reflect.set(window, "avatarProof", { requests, jobs, profiles, setAudioVersion: () => { audioVersion++; window.dispatchEvent(new Event("focus")); }, finishCurrent: () => { const job = jobs[0]; if (!job?.avatarSequence) return; const segment = job.avatarSequence.segments.find(item => item.status === "pending" || item.status === "running"); if (segment) { segment.status = "succeeded"; segment.path = "saved-current.mp4"; } job.status = "paused"; job.message = "已暂停。继续生成会保留已完成片段。"; window.dispatchEvent(new Event("focus")); } });
const client = createiPolloWorkServerClient({ baseUrl: "https://avatar-proof.invalid" });
client.writeWorkspaceBinaryFile = async (_workspaceId, payload) => ({ path: payload.path });
client.deleteWorkspaceFiles = async () => ({ deleted: [] });
// Keep provider actions simulated even when Electron routes SDK calls through IPC.
client.callExtensionAction = async payload => {
  const response = await window.fetch("https://avatar-proof.invalid/extensions/call", { body: JSON.stringify(payload) });
  return response.json();
};
client.callMedia = async (action, args) => {
  const response = await window.fetch("https://avatar-proof.invalid/extensions/call", { body: JSON.stringify({ extensionId: "media", action, args }) });
  return response.json();
};
client.downloadWorkspaceFile = async (_workspaceId, path) => ({ data: path.endsWith(".mp4")
  ? new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112])
  : new Uint8Array(await (await originalFetch("/default-brand-avatar.jpg")).arrayBuffer()), path });
client.readWorkspaceFile = async (_workspaceId, path) => {
  if (path.endsWith("index.html")) return { content: appliedHtml, updatedAt: 1 };
  if (!savedVoice) throw new Error("Voice settings not found");
  const response = await window.fetch("https://avatar-proof.invalid/files/content");
  return response.json();
};
client.writeWorkspaceFile = async (_workspaceId, payload) => {
  const response = await window.fetch("https://avatar-proof.invalid/files/content", { body: JSON.stringify(payload) });
  return response.json();
};
function VoiceProofPanel() {
  const [pending, setPending] = React.useState<VideoVoiceoverRequest | null>(null);
  React.useEffect(() => {
    const listener = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const request: VideoVoiceoverRequest = event.detail;
      event.preventDefault();
      requests.push({ action: "generate-voiceover", settings: request.settings, videoSessionId: request.videoSessionId });
      setPending(request);
      request.resolve(true);
    };
    window.addEventListener(VIDEO_VOICEOVER_REQUEST, listener);
    return () => window.removeEventListener(VIDEO_VOICEOVER_REQUEST, listener);
  }, []);
  return <>
    <div className="fixed right-4 top-8 z-50 flex flex-col gap-2 rounded-lg bg-muted p-3 text-xs">
    <button data-testid="proof-finish" disabled={!pending} onClick={() => {
      if (!pending) return;
      const voice = pending.settings;
      appliedHtml = audioMarkup(voice.selectionMode === "auto" ? "longyingmu_v3" : voice.voiceId, voice.rate, voice.pitch, voice.volume, voice.instruction);
      setPending(null);
    }}>模拟完成配音</button>
    <button data-testid="proof-fail" disabled={!pending} onClick={() => setPending(null)}>模拟生成失败（保留原配音）</button>
    </div>
    <VideoVoicePanel sessionId="avatar-proof" workspaceRoot="proof" workspaceId="proof" client={client} generating={Boolean(pending)} previewRequest={0} onClose={() => undefined} />
  </>;
}
function RoleProofPanel() {
  const frame = React.useRef<HTMLIFrameElement>(null);
  const [panel, setPanel] = React.useState<string | null>(null);
  const [width, setWidth] = React.useState(352);
  const studioOrigin = `http://127.0.0.1:${voiceProofParams.get("studioPort") || "5199"}`;
  React.useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== studioOrigin || event.data?.type !== "ipollowork:video-studio-panel") return;
      setPanel(event.data.panel);
      if (typeof event.data.width === "number") setWidth(event.data.width);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);
  return <div className="relative h-screen w-full" data-testid="role-proof">
    <iframe ref={frame} title="角色面板验证" className="h-full w-full border-0" src={`${studioOrigin}/#project/video-layer-accordion-icons-proof?locale=zh&ipolloworkTheme=light&tab=voice&rc=0`} />
    <div className={`absolute bottom-0 right-0 top-[148px] overflow-auto bg-popover p-4 ${panel === "avatar" ? "" : "hidden"}`} style={{width}}>
      <VideoAvatarPanel sessionId="avatar-proof" workspaceRoot="proof" workspaceId="proof" client={client} active={panel === "avatar"} onAssetAction={async (action, path, timelineStart) => { requests.push({ action: `asset-${action}`, path, start: timelineStart }); }} onOpenVoice={() => frame.current?.contentWindow?.postMessage({type:"ipollowork:video-studio-panel",projectId:"video-layer-accordion-icons-proof",panel:"voice"},studioOrigin)} />
    </div>
    {panel === "voice" ? <VideoVoicePanel sessionId="avatar-proof" workspaceRoot="proof" workspaceId="proof" client={client} previewRequest={0} onClose={() => undefined} embedded embeddedWidth={width} /> : null}
  </div>;
}
createRoot(document.getElementById("root")!).render(<HashRouter>{voiceProofParams.get("panel") === "role" ? <RoleProofPanel /> : <div style={{ height: "100vh", padding: 32 }}>
  <h1>VideoStudio · 数字人视频</h1><p>组件集成验证：模拟云端结果，不产生费用。</p>
  <div className="flex gap-2"><button onClick={()=>{configured=!configured;window.dispatchEvent(new Event("focus"));}}>切换 Key 配置</button><button onClick={()=>{hasNarration=!hasNarration;window.dispatchEvent(new Event("focus"));}}>切换视频配音</button><button onClick={()=>{audioVersion++;window.dispatchEvent(new Event("focus"));}}>更新配音片段</button></div>
  <button onClick={() => { failUpload = !failUpload; }}>切换上传失败</button>
  <pre id="submission-receipt" className="max-w-xl whitespace-pre-wrap break-all text-xs" />
  <div style={{ position: "relative", width: 440, height: 1150, marginTop: 20 }}>
    {voiceProofParams.get("panel") === "theme" ? <div className="relative flex h-full w-[400px]"><DesignSystemDrawer open embedded={!voiceProofParams.has("standalone")} templateName="Video Studio" onClose={() => undefined} onTokenChange={() => undefined} /></div> : voiceProofParams.get("panel") === "avatar" ? <div className="w-[400px] bg-popover p-4"><VideoAvatarPanel sessionId="avatar-proof" workspaceRoot="proof" workspaceId="proof" client={client} active onAssetAction={async (action, path, timelineStart) => { requests.push({ action: `asset-${action}`, path, start: timelineStart }); }} /></div> : <VoiceProofPanel />}
  </div>
</div>}</HashRouter>);
