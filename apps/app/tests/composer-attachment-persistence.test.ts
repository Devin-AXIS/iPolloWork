import { describe, expect, test } from "bun:test";
import {
  persistedAttachmentInstruction,
  persistComposerAttachments,
  draftToParts,
} from "../src/react-app/shell/session-prompt";

describe("composer attachment persistence", () => {
  test("workspace-only context files must persist and do not consume inline model context", async () => {
    const attachment = {
      id: "context",
      name: "reference-context.json",
      mimeType: "application/json",
      size: 2,
      kind: "file" as const,
      delivery: "workspace" as const,
      file: new File(["{}"], "reference-context.json", { type: "application/json" }),
    };
    for (const uploadInbox of [async () => { throw new Error("upload failed"); }, async () => ({ path: "" })]) {
      await expect(persistComposerAttachments({ attachments: [attachment], workspaceId: "ws", sessionId: "session", client: { uploadInbox } })).rejects.toThrow();
    }
    const parts = await draftToParts({ text: "Use my references", parts: [{ type: "text", text: "Use my references" }], attachments: [attachment] }, "/workspace", { getState: () => ({ selections: {} }) }, undefined, { supportsNativeAttachments: false });
    expect(parts).toEqual([{ type: "text", text: "Use my references" }]);
  });
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


test("reference uploads keep at most three requests active and preserve order", async () => {
  let active = 0, peak = 0;
  const attachments = Array.from({ length: 8 }, (_, index) => ({ id: String(index), name: `${index}.txt`, mimeType: "text/plain", size: 4, kind: "file" as const, file: new File(["text"], `${index}.txt`), delivery: "workspace" as const }));
  const items = await persistComposerAttachments({ attachments, workspaceId: "ws", sessionId: "session", client: { uploadInbox: async (_workspace, _file, options) => {
    peak = Math.max(peak, ++active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return { path: options!.path! };
  } } });
  expect(peak).toBe(3);
  expect(items.map((item) => item.attachmentId)).toEqual(attachments.map((item) => item.id));
});
