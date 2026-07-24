import { describe, expect, it } from "bun:test";
import type { UIMessage } from "ai";

import { getLatestArtifactAssistantMessageId } from "../src/components/chat/message-list";

describe("getLatestArtifactAssistantMessageId", () => {
  it("keeps a template entry attached to the latest real assistant response after a synthetic error", () => {
    const messages: UIMessage[] = [
      {
        id: "msg_answer",
        role: "assistant",
        parts: [{ type: "text", text: "Presentation complete.", state: "done" }],
      },
      {
        id: "session-error:msg_failed",
        role: "assistant",
        parts: [{ type: "text", text: "Connection failed.", state: "done" }],
      },
    ];

    expect(getLatestArtifactAssistantMessageId(messages)).toBe("msg_answer");
  });
});
