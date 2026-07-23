import { describe, expect, test } from "bun:test";

import { setLocale } from "../src/i18n";
import { assistantResponseMarkdownFilename, buildAssistantResponseMarkdown, buildQuoteFollowUpPrompt } from "../src/components/chat/utils";

describe("assistant response actions", () => {
  test("exports trimmed response text with a trailing newline", () => {
    expect(buildAssistantResponseMarkdown("  Result\n")).toBe("Result\n");
  });

  test("uses a sanitized session title and timestamp for the filename", () => {
    expect(assistantResponseMarkdownFilename("  Project: notes?  ", new Date("2026-07-23T02:00:00.000Z"))).toBe(
      "Project- notes--2026-07-23T02-00-00-000Z.md",
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
});
