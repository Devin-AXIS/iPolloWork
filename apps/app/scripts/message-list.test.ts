import { describe, expect, it } from "bun:test";
import type { UIMessage } from "ai";

import {
  getAssistantGroupArtifactMessages,
  getLatestArtifactAssistantMessageId,
} from "../src/components/chat/message-list";
import { getArtifactsFromMessages } from "../src/lib/artifacts";

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

describe("getAssistantGroupArtifactMessages", () => {
  it("keeps documents and spreadsheets from earlier tool steps available to the final response cards", () => {
    const messages: UIMessage[] = [
      {
        id: "msg_write",
        role: "assistant",
        parts: [{
          type: "dynamic-tool",
          toolName: "write",
          toolCallId: "write_report",
          state: "output-available",
          input: { filePath: "reports/revenue.xlsx", content: "quarter,revenue" },
          output: { filePath: "reports/revenue.xlsx" },
        }, {
          type: "dynamic-tool",
          toolName: "write",
          toolCallId: "write_summary",
          state: "output-available",
          input: { filePath: "reports/summary.docx", content: "Quarterly summary" },
          output: { filePath: "reports/summary.docx" },
        }],
      },
      {
        id: "msg_done",
        role: "assistant",
        parts: [{ type: "text", text: "The spreadsheet is ready.", state: "done" }],
      },
    ];
    const groupMessages = getAssistantGroupArtifactMessages(
      messages.map((message, index) => ({ message, index })),
    );

    const artifacts = getArtifactsFromMessages(groupMessages, [], { includeTargetFallbacks: false });

    expect(artifacts).toHaveLength(2);
    expect(artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "reports/revenue.xlsx", type: "sheet" }),
      expect.objectContaining({ path: "reports/summary.docx", type: "document" }),
    ]));
  });
});
