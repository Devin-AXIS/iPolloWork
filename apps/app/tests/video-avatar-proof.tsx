/** @jsxImportSource react */
import React from "react";
import { createRoot } from "react-dom/client";
import { createiPolloWorkServerClient } from "../src/app/lib/ipollowork-server";
import { VideoVoicePanel } from "../src/react-app/domains/session/video/video-voice-panel";
import "../src/app/index.css";
import { setLocale } from "../src/i18n";
import type { VideoJob } from "@ipollowork/types/video-generation";
setLocale("zh");

// Real panel and HTTP client, simulated provider boundary: never bills or uses credentials.
const requests: Array<Record<string, unknown>> = [];
const jobs: VideoJob[] = [];
const longProof = new URLSearchParams(location.search).has("long");
if (longProof) jobs.push({ id: "31f13c04-a138-4499-b9e4-293796ec07cc", model: "minimax-h3-avatar", operation: "reference", prompt: "长数字人验证", fingerprint: "proof", workspaceId: "proof", sessionId: "avatar-proof", status: "failed", path: "", upstreamId: "", message: "第 2/5 段失败；第 1 段已保存，可只重试失败片段。", createdAt: Date.now(), updatedAt: Date.now(), nextPoll: 0,
  avatarSequence: {duration:58,audioPath:"voice.wav",imagePath:"person.png",ratio:"9:16",segments:Array.from({length:5},(_,index)=>({start:index*11.5,end:Math.min(58,index*11.5+12.5),status:index===0?"succeeded":index===1?"failed":"pending",upstreamId:index<2?`task-${index}`:"",path:index===0?"saved-first.mp4":"",attempt:0}))} });
let savedVoice = JSON.stringify({ provider: "aliyun-bailian", model: "cosyvoice-v3-flash", voiceId: "longanyang", source: "preset", updatedAt: new Date().toISOString() });
let configured = longProof, hasNarration = longProof;
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
      if (action === "status") return json({ ok: true, result: { output: { configured: true } } });
      if (action === "voice_list") return json({ ok: true, result: { output: { items: [] } } });
      if (action === "speech_synthesize_workspace_file") return json({ ok: true, result: { output: { sourcePath: args.outputPath, durationSeconds: 8.2 } } });
    }
    if (extensionId === "storage") return json({ ok: true, result: { output: { providers: [] } } });
    if (action === "status") return json({ ok: true, result: { models: configured ? [{ id: "minimax-h3-avatar" }] : [] } });
    if (action === "avatar-context") return json({ok:true,result:{content:"一款插画风格的智能家居产品介绍",audioCount:hasNarration?2:0,audioDuration:hasNarration?(longProof?58:8.2):0,audioIssue:hasNarration?"":"当前视频没有配音素材。"}});
    if (action === "jobs") return json({ ok: true, result: { jobs } });
    if (action === "retry-segment") {
      const job=jobs.find(item=>item.id===args.id);
      if(!job?.avatarSequence)throw new Error("missing sequence");
      job.avatarSequence.segments[args.index]={...job.avatarSequence.segments[args.index],status:"pending",upstreamId:"",path:"",attempt:1};
      job.status="running";job.message=`只重试第 ${args.index+1} 段，其余已保存片段保持不变（模拟）。`;
      return json({ok:true,result:{job}});
    }
    if (action === "submit") {
      const receipt=document.getElementById("submission-receipt"); if(receipt) receipt.textContent=JSON.stringify(args,null,2);
      const job: VideoJob = { id: args.requestId, model: args.model, status: "succeeded", path: "video/avatar-proof/assets/result.mp4", message: "已自动加入当前 Video Studio 素材库（模拟结果，没有调用云端）", upstreamId: "simulated", workspaceId: "proof", sessionId: "avatar-proof", operation: "reference", prompt: args.prompt, fingerprint: "proof", createdAt: Date.now(), updatedAt: Date.now(), nextPoll: 0 };
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
Reflect.set(window, "avatarProof", { requests, jobs });
const client = createiPolloWorkServerClient({ baseUrl: "https://avatar-proof.invalid" });
// Keep provider actions simulated even when Electron routes SDK calls through IPC.
client.callExtensionAction = async payload => {
  const response = await window.fetch("https://avatar-proof.invalid/extensions/call", { body: JSON.stringify(payload) });
  return response.json();
};
client.callMedia = async (action, args) => {
  const response = await window.fetch("https://avatar-proof.invalid/extensions/call", { body: JSON.stringify({ extensionId: "media", action, args }) });
  return response.json();
};
client.readWorkspaceFile = async () => {
  const response = await window.fetch("https://avatar-proof.invalid/files/content");
  return response.json();
};
client.writeWorkspaceFile = async (_workspaceId, payload) => {
  const response = await window.fetch("https://avatar-proof.invalid/files/content", { body: JSON.stringify(payload) });
  return response.json();
};
createRoot(document.getElementById("root")!).render(<div style={{ height: "100vh", padding: 32 }}>
  <h1>VideoStudio · 数字人视频</h1><p>组件集成验证：模拟云端结果，不产生费用。</p>
  <div className="flex gap-2"><button onClick={()=>{configured=!configured;window.dispatchEvent(new Event("focus"));}}>切换 Key 配置</button><button onClick={()=>{hasNarration=!hasNarration;window.dispatchEvent(new Event("focus"));}}>切换视频配音</button></div>
  <button onClick={() => { failUpload = !failUpload; }}>切换上传失败</button>
  <pre id="submission-receipt" className="max-w-xl whitespace-pre-wrap break-all text-xs" />
  <div style={{ position: "relative", width: 440, height: 1150, marginTop: 20 }}>
    <VideoVoicePanel sessionId="avatar-proof" workspaceRoot="proof" workspaceId="proof" client={client} previewRequest={0} onClose={() => undefined}
      />
  </div>
</div>);
