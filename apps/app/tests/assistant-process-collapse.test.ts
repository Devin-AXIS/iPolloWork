import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  getAssistantRenderGroups,
  splitAssistantRenderGroups,
} from "../src/components/chat/utils";

describe("assistant process collapse sections", () => {
  test("opens while streaming and defaults completed or historical work to collapsed", () => {
    const source = readFileSync(
      new URL("../src/components/chat/message-list.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("const [isOpen, setIsOpen] = React.useState(isStreaming)");
    expect(source).toContain("if (isStreaming) {");
    expect(source).toContain("setIsOpen(true)");
    expect(source).toContain("else if (previousStreamingRef.current)");
    expect(source).toContain("setIsOpen(false)");
    expect(source).toContain("aria-expanded={isOpen}");
    expect(source).toContain("onClick={() => setIsOpen((open) => !open)}");
    expect(source).toContain("<AssistantProcessDisclosure");
    expect(source).toContain("isStreaming={isLiveGroup}");
    expect(source).toContain("itemRenderData.map(renderProcessItem)");
    expect(source).toContain("hideProcess");
  });

  test("moves completed pre-result work into a collapsible process section", () => {
    const groups = getAssistantRenderGroups([
      {
        type: "reasoning",
        text: "I should inspect the file.",
        state: "done",
        providerMetadata: undefined,
      },
      {
        type: "dynamic-tool",
        toolName: "bash",
        toolCallId: "tool_1",
        state: "output-available",
        input: { description: "Read entry.html" },
        output: "ok",
      },
      { type: "text", text: "Done. The lead paragraph was removed." },
    ], true);

    const sections = splitAssistantRenderGroups(groups);

    expect(sections.processGroups.map((group) => group.kind)).toEqual(["reasoning", "tool"]);
    expect(sections.resultGroups).toEqual([{ kind: "text", text: "Done. The lead paragraph was removed." }]);
  });

  test("keeps work visible when no final text result exists", () => {
    const groups = getAssistantRenderGroups([
      {
        type: "reasoning",
        text: "Still checking.",
        state: "streaming",
        providerMetadata: undefined,
      },
    ], true);

    const sections = splitAssistantRenderGroups(groups);

    expect(sections.processGroups).toEqual([]);
    expect(sections.resultGroups).toEqual(groups);
  });
});
