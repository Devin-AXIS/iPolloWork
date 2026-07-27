import { describe, expect, test } from "bun:test";

import { setLocale } from "../src/i18n";
import { assistantResponseMarkdownFilename, buildAssistantResponseMarkdown, buildQuoteFollowUpPrompt, buildReviseFilePrompt, buildSessionMarkdown, sessionMarkdownFilename } from "../src/components/chat/utils";

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
});
