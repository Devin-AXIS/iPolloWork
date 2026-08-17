import { DEFAULT_ENGINE_ID } from "@ipollowork/types/workspace";

import { ConversationEngineAdapterRegistry } from "./conversation-engine";
import { deepSeekHarnessConversationEngineAdapter } from "./deepseek-harness-conversation-engine";
import { openCodeConversationEngineAdapter } from "./opencode-conversation-engine";

export const conversationEngineAdapters = new ConversationEngineAdapterRegistry(
  DEFAULT_ENGINE_ID,
  [openCodeConversationEngineAdapter, deepSeekHarnessConversationEngineAdapter],
);
