/** @jsxImportSource react */
import React from "react";
import { createRoot } from "react-dom/client";
import { createiPolloWorkServerClient } from "../src/app/lib/ipollowork-server";
import { VideoVoicePanel } from "../src/react-app/domains/session/video/video-voice-panel";
import "../src/app/index.css";
import { setLocale } from "../src/i18n";
setLocale("zh");

// Real panel and HTTP client, simulated provider boundary: never bills or uses credentials.
const requests: Array<Record<string, unknown>> = [];
const jobs: Array<Record<string, unknown>> = [];
let configured = false, hasNarration = false;
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
    if (action === "avatar-context") return json({ok:true,result:{content:"一款插画风格的智能家居产品介绍",audioCount:hasNarration?2:0,audioDuration:hasNarration?8.2:0,audioIssue:hasNarration?"":"当前视频没有配音素材。"}});
    if (action === "jobs") return json({ ok: true, result: { jobs } });
    if (action === "submit") {
      const receipt=document.getElementById("submission-receipt"); if(receipt) receipt.textContent=JSON.stringify(args,null,2);
      const job = { id: args.requestId, model: args.model, status: "succeeded", path: "video/avatar-proof/renders/result.mp4", message: "模拟生成完成（没有调用云端）", upstreamId: "simulated", workspaceId: "proof", sessionId: "avatar-proof", operation: "reference", prompt: args.prompt, fingerprint: "proof", createdAt: Date.now(), updatedAt: Date.now(), nextPoll: 0 };
      jobs.unshift(job); return json({ ok: true, result: { job } });
    }
  }
  if (path.endsWith("/artifacts")) return json({ items: [{ path: "video/avatar-proof/assets/existing.wav" }], nextCursor: null });
  if (path.endsWith("/files/content")) return json({ content: JSON.stringify({ provider: "aliyun-bailian", model: "cosyvoice-v3-flash", voiceId: "longanyang", source: "preset", updatedAt: new Date().toISOString() }), updatedAt: 1 });
  if (path.endsWith("/files/raw")) { requests.push({ action: "upload", path: body.path }); return json({ ok: true, path: body.path, updatedAt: 1 }); }
  throw new Error(`Unhandled proof route ${path}`);
};
Reflect.set(window, "avatarProof", { requests, jobs, added: [] });
const client = createiPolloWorkServerClient({ baseUrl: "https://avatar-proof.invalid" });
createRoot(document.getElementById("root")!).render(<div style={{ height: "100vh", padding: 32 }}>
  <h1>VideoStudio · 数字人视频</h1><p>组件集成验证：模拟云端结果，不产生费用。</p>
  <div className="flex gap-2"><button onClick={()=>{configured=!configured;window.dispatchEvent(new Event("focus"));}}>切换 Key 配置</button><button onClick={()=>{hasNarration=!hasNarration;window.dispatchEvent(new Event("focus"));}}>切换视频配音</button></div>
  <pre id="submission-receipt" className="max-w-xl whitespace-pre-wrap break-all text-xs" />
  <div style={{ position: "relative", width: 440, height: 1150, marginTop: 20 }}>
    <VideoVoicePanel sessionId="avatar-proof" workspaceRoot="proof" workspaceId="proof" client={client} previewRequest={0} onClose={() => undefined}
      onAddVideo={async path => { Reflect.get(window, "avatarProof").added.push(path); }} />
  </div>
</div>);
