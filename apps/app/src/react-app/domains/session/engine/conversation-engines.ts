import { DEFAULT_ENGINE_ID } from "@ipollowork/types/workspace";
import { enterpriseReferenceText, enterpriseSnapshotSchema } from "@ipollowork/types/enterprise";
import { createiPolloWorkServerClient } from "@/app/lib/ipollowork-server";
import { readActiveEnterpriseConnection } from "@/app/lib/work-context";

import { ConversationEngineAdapterRegistry, type ConversationEngineAdapter } from "./conversation-engine";
import { codexHarnessConversationEngineAdapter } from "./codex-harness-conversation-engine";
import { deepSeekHarnessConversationEngineAdapter } from "./deepseek-harness-conversation-engine";
import { openCodeConversationEngineAdapter } from "./opencode-conversation-engine";

export function withEnterpriseShareContext(adapter: ConversationEngineAdapter): ConversationEngineAdapter {
  return { ...adapter, connect(input) {
    const connection = adapter.connect(input);
    if (!input.serverBaseUrl || !input.workspaceId) return connection;
    const client = createiPolloWorkServerClient({ baseUrl: input.serverBaseUrl, token: input.token });
    const workspaceId = input.workspaceId;
    const sent = new Set<string>();
    return { ...connection, async sendPrompt(request) {
      if (request.signal?.aborted) return { sessionId: request.sessionId };
      const activeEnterprise = readActiveEnterpriseConnection();
      if (!activeEnterprise?.features?.sessionSharing) return connection.sendPrompt(request);
      const key = JSON.stringify([activeEnterprise.id, activeEnterprise.membership.id, request.sessionId]);
      if (sent.has(key)) return connection.sendPrompt(request);
      const result = await client.getEnterpriseSnapshot(workspaceId, request.sessionId);
      if (request.signal?.aborted) return { sessionId: request.sessionId };
      const currentEnterprise = readActiveEnterpriseConnection();
      if (currentEnterprise?.id !== activeEnterprise.id || currentEnterprise.membership.id !== activeEnterprise.membership.id) throw new Error("企业账号已切换，请重新发送。");
      if (!result.snapshot) return connection.sendPrompt(request);
      const snapshot = enterpriseSnapshotSchema.parse(result.snapshot);
      if (snapshot.enterpriseId !== activeEnterprise.id || snapshot.memberId !== activeEnterprise.membership.id) throw new Error("请切回接收分享时的企业账号继续此会话。");
      const reply = await connection.sendPrompt({ ...request, parts: [{ type: "text", text: enterpriseReferenceText(snapshot) }, ...request.parts] });
      if (sent.size >= 100) sent.delete(sent.values().next().value ?? "");
      sent.add(key);
      return reply;
    } };
  } };
}

export const conversationEngineAdapters = new ConversationEngineAdapterRegistry(
  DEFAULT_ENGINE_ID,
  [openCodeConversationEngineAdapter, deepSeekHarnessConversationEngineAdapter, codexHarnessConversationEngineAdapter],
);
