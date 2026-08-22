import { describe, expect, test } from "bun:test";
import {
  persistedAttachmentInstruction,
  persistComposerAttachments,
} from "../src/react-app/shell/session-prompt";

describe("composer attachment persistence", () => {
  test("uploads attachments into a session-scoped workspace inbox path", async () => {
    const calls: Array<{ workspaceId: string; path?: string }> = [];
    const attachment = {
      id: "att/1",
      name: "../封面图.png",
      mimeType: "image/png",
      size: 3,
      kind: "image" as const,
      file: new File(["png"], "封面图.png", { type: "image/png" }),
    };

    const items = await persistComposerAttachments({
      attachments: [attachment],
      workspaceId: "ws_1",
      sessionId: "ses/1",
      client: {
        uploadInbox: async (workspaceId, _file, options) => {
          calls.push({ workspaceId, path: options?.path });
          return { path: options?.path ?? "" };
        },
      },
    });

    expect(calls).toEqual([{
      workspaceId: "ws_1",
      path: "chat-attachments/ses-1/att-1-封面图.png",
    }]);
    expect(items).toEqual([{
      attachmentId: "att/1",
      name: "../封面图.png",
      workspacePath: ".opencode/ipollowork/inbox/chat-attachments/ses-1/att-1-封面图.png",
    }]);
    expect(persistedAttachmentInstruction(items)).toContain(items[0].workspacePath);
  });

  test("keeps the chat send usable when inbox persistence is unavailable", async () => {
    const items = await persistComposerAttachments({
      attachments: [{
        id: "att-2",
        name: "image.png",
        mimeType: "image/png",
        size: 3,
        kind: "image",
        file: new File(["png"], "image.png", { type: "image/png" }),
      }],
      workspaceId: "ws_1",
      sessionId: "ses_1",
      client: { uploadInbox: async () => { throw new Error("inbox disabled"); } },
    });

    expect(items).toEqual([]);
    expect(persistedAttachmentInstruction(items)).toBeNull();
  });
});
