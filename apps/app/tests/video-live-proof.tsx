/** @jsxImportSource react */
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { VideoPanel } from "../src/react-app/domains/session/video/video-panel";
import { ReactSessionComposer } from "../src/react-app/domains/session/surface/composer/composer";
import { canSteerActiveDraft } from "../src/react-app/domains/session/surface/composer/composer-draft";
import { VIDEO_LIVE_PREVIEW_EVENT, videoLiveSteeringContext } from "../src/react-app/domains/session/video/video-project";
import { codexHarnessConversationEngineAdapter } from "../src/react-app/domains/session/engine/codex-harness-conversation-engine";
import { videoLivePreviewMessageSchema, type VideoLivePreviewMessage } from "@ipollowork/types/hyperframes";
import type { VideoStudioClient } from "@ipollowork/video-studio";
import { Button } from "../src/components/ui/button";
import { setLocale } from "../src/i18n";
import "../src/app/index.css";

setLocale("zh");
const fixtureUrl = "http://127.0.0.1:5397";
const requests: Array<{ method: string; payload: unknown }> = [];
const proof: { requests: typeof requests; preview: VideoLivePreviewMessage | null; direction: string; publications: number } = { requests, preview: null, direction: "", publications: 0 };
Object.assign(window, { liveVideoProof: proof });
const realFetch = window.fetch.bind(window);
// Simulate only the model boundary. The production Codex adapter sends the actual turn/steer RPC.
window.fetch = async (input, init) => {
  if (String(input).startsWith("https://video-live-proof.invalid/")) {
    const { method, payload } = JSON.parse(String(init?.body));
    requests.push({ method, payload });
    if (method === "thread/read") return Response.json({ value: { thread: { turns: [{ id: "live-turn", status: "inProgress" }] } } });
    if (method === "turn/steer") return Response.json({ value: { turnId: "live-turn" } });
    throw new Error(`Unexpected model call: ${method}`);
  }
  return realFetch(input, init);
};
const conversation = codexHarnessConversationEngineAdapter.connect({ serverBaseUrl: "https://video-live-proof.invalid", workspaceId: "proof" });
const client: VideoStudioClient = {
  readWorkspaceFile: async (_workspace, path) => ({ content: path.endsWith("design-tokens.css") ? ":root { --ipw-color-bg: #111827; }" : await (await realFetch(`${fixtureUrl}/source`)).text(), updatedAt: 1 }),
  writeWorkspaceFile: async () => { throw new Error("The proof never writes user projects"); },
};
const runtime = { start: async () => ({ ok: true, port: 5197 }), stop: async () => ({ ok: true }) };
const features = { voice: false, designSystem: false, templates: false } satisfies import("@ipollowork/video-studio").VideoStudioFeatures;

function Proof() {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(true);
  const [count, setCount] = useState(0);
  const [direction, setDirection] = useState("");
  const [error, setError] = useState("");
  const [publishing, setPublishing] = useState(false);
  const previewRef = useRef<VideoLivePreviewMessage | null>(null);
  useEffect(() => {
    void realFetch(`${fixtureUrl}/source`).then(response => response.text()).then(source => {
      const restoredCount = source.match(/<section id="scene-/g)?.length ?? 0;
      setCount(restoredCount); proof.publications = restoredCount;
    }).catch(error => setError(String(error)));
  }, []);
  useEffect(() => {
    const receive = (event: Event) => {
      if (!(event instanceof CustomEvent) || event.detail?.workspaceId !== "proof" || event.detail?.sessionId !== "live-proof") return;
      const parsed = videoLivePreviewMessageSchema.safeParse(event.detail.preview);
      previewRef.current = parsed.success ? parsed.data : null;
      proof.preview = previewRef.current;
    };
    window.addEventListener(VIDEO_LIVE_PREVIEW_EVENT, receive);
    return () => window.removeEventListener(VIDEO_LIVE_PREVIEW_EVENT, receive);
  }, []);
  const publish = async (complete = false) => {
    setPublishing(true); setError("");
    try {
      const response = await realFetch(`${fixtureUrl}/publish`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ count: count + 1, complete, cases: Boolean(proof.direction) }) });
      if (!response.ok) throw new Error(await response.text());
      setCount(count + 1); proof.publications = count + 1;
      if (complete) setBusy(false);
    } catch (error) { setError(String(error)); }
    finally { setPublishing(false); }
  };
  const steer = async () => {
    const submitted = draft.trim();
    const nextDraft = { mode: "prompt", text: submitted, parts: [{ type: "text", text: submitted }], attachments: [] } satisfies import("../src/app/types").ComposerDraft;
    if (!submitted || !canSteerActiveDraft(nextDraft)) return;
    try {
      const context = previewRef.current ? videoLiveSteeringContext(previewRef.current) : "";
      const parts: import("../src/react-app/domains/session/engine/conversation-engine").ConversationPromptPart[] = [{ type: "text", text: submitted }];
      if (context) parts.push({ type: "text", text: context });
      await conversation.steerPrompt?.({ sessionId: "live-proof", parts });
      proof.direction = submitted; setDirection(submitted); setDraft("");
    } catch (error) { setError(String(error)); }
  };
  return <HashRouter><div className="flex h-screen min-h-0 flex-col bg-background text-foreground">
    <header className="flex flex-wrap items-center gap-3 border-b p-3">
      <strong>边生成边播放</strong><span className="text-xs text-muted-foreground">确定性生成模拟 · 原生工作台与 Codex 引导通道</span>
      <Button data-testid="publish-scene" disabled={publishing || !busy} onClick={() => void publish()}>{count ? "生成下一段" : "生成首段"}</Button>
      <Button data-testid="finish-generation" disabled={publishing || !count || !busy} onClick={() => void publish(true)}>生成最后一段并完成</Button>
      <span data-testid="publication-count" className="text-xs">已生成 {count * 4} 秒</span>
    </header>
    <main className="flex min-h-0 flex-1 flex-col md:flex-row">
      <aside className="flex w-full flex-col gap-4 border-r p-4 md:w-[340px] md:shrink-0">
        <p className="text-sm text-muted-foreground">先介绍产品，再展示使用案例。第一段就绪后开始播放，剩余内容按你的指令继续生成。</p>
        <div className="mt-auto">
          {direction && <p data-testid="steering-receipt" data-native-request={JSON.stringify(requests.at(-1))} className="mb-3 text-sm">已引导后续内容：{direction}</p>}
          {error && <p role="alert">{error}</p>}
          <ReactSessionComposer draft={draft} mentions={{}} onDraftChange={setDraft} onSend={steer} onQueue={steer} onStop={() => setBusy(false)}
            busy={busy} queuedCount={0} busySubmitLabel="引导后续视频" disabled={false} statusLabel={busy ? "正在生成后续内容" : "生成完成"}
            modelPickerOpen={false} selectedModel={{ providerID: "proof", modelID: "deterministic" }} onModelPickerOpenChange={() => {}} onModelChange={() => {}}
            attachments={[]} onAttachFiles={() => {}} onRemoveAttachment={() => {}} modelVariantLabel="模拟生成" modelVariant={null} onModelVariantChange={() => {}}
            selectedMode={null} listModes={async () => []} onSelectMode={() => {}} listAgents={async () => []} onSelectAgent={() => {}} listCommands={async () => []}
            plusMenuScope="proof" listPlusMenuData={async () => ({ extensions: [], externalAgents: [], mcpServers: [], mcpStatuses: null, mcpStatus: null })}
            recentFiles={[]} searchFiles={async () => []} onInsertMention={() => {}} onPasteText={() => {}} onUnsupportedFileLinks={() => {}} pastedText={[]}
            onExpandPastedText={() => {}} onRemovePastedText={() => {}} isRemoteWorkspace={false} isSandboxWorkspace={false} placeholder="输入指令，调整后续生成方向…" />
        </div>
      </aside>
      <section className="relative min-h-[360px] min-w-0 flex-1">
        <VideoPanel title="连续生成验证" sessionId="live-proof" workspaceId="proof" workspaceRoot="proof" client={client} aiEditing={busy}
          runtime={runtime} features={features} />
      </section>
    </main>
  </div></HashRouter>;
}
createRoot(document.getElementById("root")!).render(<Proof />);
