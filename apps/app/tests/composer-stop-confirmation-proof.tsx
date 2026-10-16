import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import type { UIMessage } from "ai";
import "../src/app/index.css";
import { setLocale } from "../src/i18n";
import { getReactQueryClient } from "../src/react-app/infra/query-client";
import { useQueryCacheState } from "../src/react-app/infra/query-cache-state";
import { ReactSessionComposer as Composer } from "../src/react-app/domains/session/surface/composer/composer";
import { MessageList } from "../src/components/chat/message-list";
import { MessageListProvider } from "../src/components/chat/message-list-provider";
import { Button } from "../src/components/ui/button";
import { deriveRenderedSessionMessages } from "../src/react-app/domains/session/surface/session-render-state";
import { __applySessionSyncEventForTest, __createWorkspaceSessionSyncForTest, beginOptimisticSessionPrompt, sanitizeInterruptedSessionSnapshot, seedSessionState, settleInterruptedSessionRun, trackWorkspaceSessionSync, transcriptKey } from "../src/react-app/domains/session/sync/session-sync";
import type { ConversationSnapshot } from "../src/react-app/domains/session/engine/conversation-engine";

// Isolated fixture: production Composer, MessageList and synchronization; only
// native confirmations are synthetic, deliberately arriving after Stop.
setLocale("zh");
const workspaceId = "stop-confirmation-proof";
const sessionId = "stop-confirmation-proof";
const emptyMessages: UIMessage[] = [];
const queryClient = getReactQueryClient();
const syncInput = { workspaceId, connectionKey: "stop-confirmation-proof" };
__createWorkspaceSessionSyncForTest(syncInput);
trackWorkspaceSessionSync(syncInput, sessionId);
const noop = () => {};
let nativeMessages: UIMessage[] = [];
let clientId = "";
let submitted = 0;
let stopped = 0;
let sentText = "";
const makeSnapshot = (): ConversationSnapshot => ({ session: { id: sessionId, title: "暂停后不会重复" }, messages: nativeMessages, todos: [], status: { type: "idle" } });

function Proof() {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [snapshot, setSnapshot] = useState<ConversationSnapshot | null>(null);
  const [confirmed, setConfirmed] = useState(0);
  const transcript = useQueryCacheState<UIMessage[]>(transcriptKey(workspaceId, sessionId), emptyMessages);
  const messages = deriveRenderedSessionMessages({ transcriptState: transcript, snapshot });
  const replay = () => {
    const next = sanitizeInterruptedSessionSnapshot(workspaceId, makeSnapshot());
    seedSessionState(workspaceId, next);
    setSnapshot(next);
    setConfirmed(nativeMessages.length);
  };
  const send = () => {
    if (!draft.trim() || busy) return;
    sentText = draft.trim(); submitted++;
    clientId = beginOptimisticSessionPrompt(workspaceId, sessionId, sentText);
    if (submitted === 1) __applySessionSyncEventForTest(syncInput, {
      type: "message.upsert", sessionId, message: { id: "native-confirmed-1", role: "user", parts: [] },
    });
    setDraft(""); setBusy(true);
  };
  const stop = () => {
    if (!busy) return;
    // New-project drafts belong to the route, not the surface's active ref.
    settleInterruptedSessionRun(workspaceId, sessionId, submitted === 1 ? undefined : clientId);
    setBusy(false); stopped++;
    nativeMessages = [...nativeMessages, {
      id: `native-confirmed-${submitted}`, role: "user",
      metadata: { ipollowork: { created: Date.now() } },
      parts: [{ type: "text", text: sentText, state: "done" }],
    }];
    setTimeout(replay, 150);
  };
  return <main className="mx-auto max-w-3xl space-y-5 p-8 text-foreground">
    <header><h1 className="text-xl font-semibold">暂停消息确认回归验证</h1><p className="mt-2 text-sm text-muted-foreground">真实聊天控件和消息同步 · 首次发送先收到空消息声明，暂停后才回填正文</p></header>
    <div className="rounded-xl border border-border bg-background p-5">
      <MessageListProvider client={null} workspaceId={workspaceId} sessionId={sessionId} sessionTitle="暂停后不会重复" showThinking={false} developerMode={false} displaySuggestions={false} providerConnectedCount={0} onRevertToUserMessage={noop} onForkAtMessage={noop} onEditUserMessage={noop} dispatchAction={noop} setPrompt={setDraft}>
        <MessageList messages={messages} status={busy ? "submitted" : "ready"} stopAcknowledged={stopped > 0 && !busy} />
      </MessageListProvider>
      <Composer draft={draft} mentions={{}} onDraftChange={setDraft} onSend={send} onQueue={noop} onStop={stop} busy={busy} queuedCount={0} disabled={false} statusLabel="隔离验证模型" modelPickerOpen={false} selectedModel={{ providerID: "proof", modelID: "confirmation" }} onModelPickerOpenChange={noop} onModelChange={noop} attachments={[]} onAttachFiles={noop} onRemoveAttachment={noop} modelVariantLabel="默认" modelVariant={null} onModelVariantChange={noop} selectedMode="work" listModes={async () => []} onSelectMode={noop} listAgents={async () => []} onSelectAgent={noop} listCommands={async () => []} plusMenuScope={workspaceId} listPlusMenuData={async () => ({ extensions: [], externalAgents: [], mcpServers: [], mcpStatuses: null, mcpStatus: null })} recentFiles={[]} searchFiles={async () => []} onInsertMention={noop} onPasteText={noop} onUnsupportedFileLinks={noop} pastedText={[]} onExpandPastedText={noop} onRemovePastedText={noop} isRemoteWorkspace={false} isSandboxWorkspace={false} placeholder="输入：当前是什么模型" layout="inline" />
    </div>
    <div className="flex items-center gap-4"><Button variant="outline" disabled={busy || confirmed === 0} onClick={replay}>回放服务端确认</Button><output data-testid="stop-proof-stats" className="text-sm text-muted-foreground">发送 {submitted} 次 · 暂停 {stopped} 次 · 服务端确认 {confirmed} 条 · 显示 {messages.filter(message => message.role === "user" && message.parts.some(part => part.type === "text" && part.text.trim())).length} 条</output></div>
  </main>;
}
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={queryClient}><Proof /></QueryClientProvider>);
