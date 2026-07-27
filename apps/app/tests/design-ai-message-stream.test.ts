import { describe, expect, test } from "bun:test";

import type { iPolloWorkSessionSnapshot } from "../src/app/lib/ipollowork-server";
import { designAiSelectionInstruction, type DesignAiSelectionContext } from "../src/react-app/domains/session/design/design-ai-selection";
import { snapshotToUIMessages } from "../src/react-app/domains/session/sync/usechat-adapter";

const context: DesignAiSelectionContext = {
  id: "design-ai-message",
  sessionId: "ses_1",
  workspaceId: "workspace_1",
  filePath: "design/ses_1/index.html",
  baseUpdatedAt: 1,
  beforeHtml: "<p>NBA history</p>",
  target: {
    tag: "p",
    label: "P · NBA history",
    locator: "body > main > p:nth-of-type(2)",
    text: "NBA history",
    src: "",
    alt: "",
    styles: {},
  },
};

function snapshot(): iPolloWorkSessionSnapshot {
  return {
    session: {
      id: "ses_1",
      parentID: undefined,
      title: "Design test",
      time: { created: 1, updated: 2 },
      share: undefined,
      version: "0",
    },
    messages: [{
      info: {
        id: "msg_user",
        role: "user",
        sessionID: "ses_1",
        time: { created: 1 },
      },
      parts: [
        {
          id: "part_selection",
          type: "text",
          text: designAiSelectionInstruction(context),
          synthetic: true,
          sessionID: "ses_1",
          messageID: "msg_user",
        },
        {
          id: "part_prompt",
          type: "text",
          text: "Delete this.",
          sessionID: "ses_1",
          messageID: "msg_user",
        },
      ],
    }],
    todos: [],
    status: { type: "idle" },
  } as unknown as iPolloWorkSessionSnapshot;
}

describe("Design AI message stream", () => {
  test("restores the sent selection as a visible data chip without exposing its locator", () => {
    const [message] = snapshotToUIMessages(snapshot());

    expect(message?.parts).toContainEqual({
      type: "data-design-selection",
      data: {
        contextId: context.id,
        label: context.target.label,
        partId: "part_selection",
      },
    });
    expect(message?.parts).toContainEqual(expect.objectContaining({ type: "text", text: "Delete this." }));
    expect(JSON.stringify(message?.parts)).not.toContain(context.target.locator);
  });
});
