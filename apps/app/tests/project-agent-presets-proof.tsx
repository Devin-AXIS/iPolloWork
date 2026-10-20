/** @jsxImportSource react */
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import "../src/app/index.css";
import { createiPolloWorkServerClient } from "../src/app/lib/ipollowork-server";
import { ConversationWorkspace } from "../src/react-app/domains/work/conversation-workspace";
import { TooltipProvider } from "../src/components/ui/tooltip";
import { setLocale } from "../src/i18n";

setLocale("zh");
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const client = {
  ...createiPolloWorkServerClient({ baseUrl: "http://127.0.0.1:5297", token: "isolated-preset-proof" }),
  // No native engine or model invocation; all config and workflow calls use the real server.
  listSessions: async () => ({ items: [] }),
};
function Proof() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [image, setImage] = useState("");
  const [frame, setFrame] = useState("project");
  const [saved, setSaved] = useState("");
  return <QueryClientProvider client={queryClient}><TooltipProvider>
    <div className="flex h-screen flex-col bg-background text-foreground">
      <nav className="flex flex-wrap items-center gap-5 border-b p-4 text-sm">
        <span>隔离项目 · 真实配置存储 · 合成对话绑定</span>
        <button onClick={() => setSessionId(null)}>项目概览</button>
        <button onClick={() => setSessionId("before-defaults")}>已有对话</button>
        <button onClick={async () => {
          const response = await fetch("http://127.0.0.1:5298/new", { method: "POST" });
          if (!response.ok) throw new Error("Synthetic session binding failed");
          await queryClient.invalidateQueries({ queryKey: ["work-items"] });
          setSessionId("after-defaults");
        }}>新建验证对话</button>
        <strong data-testid="proof-scope">{sessionId === null ? "项目默认" : sessionId === "before-defaults" ? "已有对话" : "新对话"}</strong>
      </nav>
      <details className="px-4 text-xs"><summary>保存验证截图</summary>
        <select aria-label="验证帧" value={frame} onChange={event => setFrame(event.target.value)}>
          <option value="project">项目刷新</option><option value="old">已有对话</option><option value="new">新对话继承</option>
        </select>
        <textarea aria-label="验证截图数据" value={image} onChange={event => setImage(event.target.value)} />
        <button onClick={async () => {
          const response = await fetch("http://127.0.0.1:5298/evidence", { method: "POST", body: JSON.stringify({ image, frame }) });
          if (!response.ok) throw new Error("Evidence assertion failed");
          setSaved((await response.json()).status); setImage("");
        }}>保存此帧</button><output>{saved}</output>
      </details>
      <div className="min-h-0 flex-1"><ConversationWorkspace client={client} workspaceId="preset-proof"
        sessionId={sessionId} engineId="opencode" title={sessionId === null ? "项目预设验证" : sessionId === "before-defaults" ? "已有对话" : "新对话"}
        runtime={{ engineId: "opencode", model: null, mode: "auto", modelVariant: null }} onOpenTasks={() => undefined} /></div>
    </div><Toaster />
  </TooltipProvider></QueryClientProvider>;
}
const root = document.getElementById("root");
if (!root) throw new Error("Proof root missing");
createRoot(root).render(<Proof />);
