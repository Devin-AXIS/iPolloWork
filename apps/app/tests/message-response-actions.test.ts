import { withStudioResults } from "../src/react-app/domains/session/sync/message-merge";
import { groupMessages, isStudioResultMessage } from "../src/components/chat/utils";
import type { UIMessage } from "ai";
import type { SessionArtifact } from "@ipollowork/types/workspace";
import { describe, expect, test } from "bun:test";

import { setLocale } from "../src/i18n";
import { assistantResponseMarkdownFilename, buildAssistantResponseMarkdown, buildQuoteFollowUpPrompt, buildReviseFilePrompt, buildSessionMarkdown, getFileMediaType, getFileTitle, sessionMarkdownFilename } from "../src/components/chat/utils";

describe("assistant response actions", () => {
  test("exports trimmed response text with a trailing newline", () => {
    expect(buildAssistantResponseMarkdown("  Result\n")).toBe("Result\n");
  });

  test("uses a sanitized session title and timestamp for the filename", () => {
    expect(assistantResponseMarkdownFilename("  Project: notes?  ", new Date("2026-07-23T02:00:00.000Z"))).toBe(
      "Project- notes--2026-07-23T02-00-00-000Z.md",
    );
  });

  test("exports a full session transcript as structured Markdown", () => {
    const messages = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "Build a dashboard" }] },
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "Created index.html" }] },
    ] as any;

    expect(sessionMarkdownFilename("  Session: alpha?  ", new Date("2026-07-24T02:15:00.000Z"))).toBe(
      "Session- alpha--2026-07-24T02-15-00-000Z.md",
    );
    expect(buildSessionMarkdown("Demo Session", messages)).toBe(
      "# Demo Session\n\n## 1. User\n\nBuild a dashboard\n\n## 2. Assistant\n\nCreated index.html\n",
    );
  });

  test("quotes every response line and adds a localized follow-up prompt", () => {
    setLocale("en");
    expect(buildQuoteFollowUpPrompt("First line\n\nSecond line")).toBe(
      "> First line\n> \n> Second line\n\nWrite your follow-up question here.",
    );

    setLocale("zh");
    expect(buildQuoteFollowUpPrompt("结论")).toBe("> 结论\n\n请在这里输入后续问题。");
    setLocale("en");
  });

  test("builds a localized follow-up prompt for revising an output file", () => {
    setLocale("en");
    expect(buildReviseFilePrompt("src/index.html")).toBe("Please revise this file: src/index.html");

    setLocale("zh");
    expect(buildReviseFilePrompt("src/index.html")).toBe("请基于这个文件继续修改： src/index.html");
    setLocale("en");
  });

  test("handles legacy file parts without media metadata", () => {
    const part = { type: "file", filename: "notes.txt" } as any;

    expect(getFileTitle(part)).toBe("notes.txt");
    expect(getFileMediaType(part)).toBe("");
  });
});

describe("studio result receipts", () => {
  const artifact: SessionArtifact = { path: "video/session/renders/test.mp4", size: 2048, updatedAt: 20,
    generation: { id: "job-1", kind: "video", model: "MiniMax", completedAt: 20, duration: 5, width: 1280, height: 720 } };
  const labels = { image: "Image generated", video: "Video generated" };
  test("restores one stable result between chat turns and leaves engine messages unchanged", () => {
    const messages: UIMessage[] = [
      { id: "before", role: "user", parts: [{ type: "text", text: "Create a video" }], metadata: { ipollowork: { created: 10 } } },
      { id: "after", role: "assistant", parts: [{ type: "text", text: "Hello" }], metadata: { ipollowork: { created: 30 } } },
    ];
    const result = withStudioResults(messages, [artifact, artifact], labels);
    expect(result.map(message => message.id)).toEqual(["before", "studio-result:job-1", "after"]);
    expect(messages).toHaveLength(2);
    expect(result[1].parts).toEqual([{ type: "text", text: expect.stringContaining("1280 × 720 · 5 s · MiniMax") }]);
    expect(withStudioResults(messages, [artifact], labels)).toEqual(result);
    expect(groupMessages(result)).toHaveLength(3);
    expect(isStudioResultMessage(result[1])).toBe(true);
  });
  test("does not duplicate outputs already delivered in the transcript, including renamed files", () => {
    const messages: UIMessage[] = [{ id: "answer", role: "assistant", parts: [{ type: "text", text: `[Video](${artifact.path})` }] }];
    expect(withStudioResults(messages, [artifact], labels)).toEqual(messages);
    expect(withStudioResults(messages, [{ ...artifact, path: "renamed.mp4", previousPaths: [artifact.path] }], labels)).toEqual(messages);
  });
  test("shows only successful generation receipts, including an otherwise empty conversation", () => {
    expect(withStudioResults([], [{ path: "input.png", size: 100, updatedAt: 1 }], labels)).toEqual([]);
    expect(withStudioResults([], [artifact], labels)).toHaveLength(1);
  });
});
