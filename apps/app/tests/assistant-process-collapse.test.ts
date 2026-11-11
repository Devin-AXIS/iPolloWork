import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { getToolActivityLabel } from "../src/lib/tool-activity";
import { t } from "../src/i18n";

import {
  getActiveAssistantMessageId,
  earliestProcessTimestamp,
  getMessageCompleted,
  getMessageCreated,
  getAssistantRenderGroups,
  getAssistantMessagePresentations,
  hasActiveAssistantVisibleResult,
  getScheduleApplyResult,
  groupMessages,
  isAssistantCommentaryMessage,
  isAssistantFinalAnswerMessage,
  isMessageGroup,
  splitAssistantRenderGroups,
} from "../src/components/chat/utils";

describe("assistant process collapse sections", () => {
  test("keeps shell commands and command-like descriptions out of activity labels", () => {
    for (const toolName of ["bash", "exec_command", "functions.exec"]) {
      for (const description of [undefined, "sleep 8 && echo done", "Check project files"]) {
        const part = { type: "dynamic-tool", toolName, toolCallId: "command-label", state: "input-available", input: { command: "sleep 8 && echo done", description } } satisfies Parameters<typeof getToolActivityLabel>[0];
        expect(getToolActivityLabel(part)).toBe(t("chat.activity.command"));
        expect(getToolActivityLabel({ ...part, state: "output-error", errorText: "ENOENT /private/path" })).toBe(t("chat.activity.failed"));
      }
    }
  });
  test("keeps the original user-turn start when a later continuation has a shorter timing", () => {
    expect(earliestProcessTimestamp(70_000, null, 1_000)).toBe(1_000);
  });

  test("reads stable transcript timing from both conversation metadata formats", () => {
    const iPolloMessage = { id: "assistant-time", role: "assistant", parts: [], metadata: { ipollowork: { created: 100, completed: 2_100 } } } satisfies Parameters<typeof getMessageCreated>[0];
    const legacyMessage = { id: "assistant-legacy-time", role: "assistant", parts: [], metadata: { opencode: { created: 200, completed: 2_200 } } } satisfies Parameters<typeof getMessageCreated>[0];
    expect(getMessageCreated(iPolloMessage)).toBe(100);
    expect(getMessageCompleted(iPolloMessage)).toBe(2_100);
    expect(getMessageCreated(legacyMessage)).toBe(200);
    expect(getMessageCompleted(legacyMessage)).toBe(2_200);
  });
  test("keeps Codex commentary in the process while an in-progress final answer is eligible for the result", () => {
    const commentary = {
      id: "progress",
      role: "assistant",
      metadata: { ipollowork: { codexPhase: "commentary" } },
      parts: [{ type: "text", text: "Checking the files", state: "done" }],
    } satisfies Parameters<typeof isAssistantCommentaryMessage>[0];
    const answer = {
      id: "answer",
      role: "assistant",
      metadata: { ipollowork: { codexPhase: "final_answer" } },
      parts: [{ type: "text", text: "The fix is", state: "streaming" }],
    } satisfies Parameters<typeof isAssistantCommentaryMessage>[0];

    expect(isAssistantCommentaryMessage(commentary)).toBe(true);
    expect(isAssistantCommentaryMessage(answer)).toBe(false);
    expect(isAssistantFinalAnswerMessage(commentary)).toBe(false);
    expect(isAssistantFinalAnswerMessage(answer)).toBe(true);
    expect(isAssistantFinalAnswerMessage({ ...answer, metadata: undefined })).toBe(false);
    expect(getAssistantRenderGroups(answer.parts, true)).toEqual([{ kind: "text", text: "The fix is" }]);
  });

  test("retains failed tool attempts for inspection without mutating history or hiding the final explanation", () => {
    const parts = [
      { type: "reasoning", text: "正在准备内容", state: "done" },
      { type: "dynamic-tool", toolName: "ipollowork_browser_snapshot", toolCallId: "failed-browser", state: "output-error", input: {}, errorText: "Browser timeout" },
      { type: "tool-bash", toolCallId: "failed-command", state: "output-error", input: { command: "example" }, errorText: "Exit code 1" },
      { type: "dynamic-tool", toolName: "save-post-draft", toolCallId: "saved", state: "output-available", input: {}, output: { ok: true } },
      { type: "text", text: "草稿已保存；发布仍需处理登录问题。" },
    ] satisfies Parameters<typeof getAssistantRenderGroups>[0];
    const before = JSON.stringify(parts);
    for (const showThinking of [true, false]) {
      const groups = getAssistantRenderGroups(parts, showThinking);
      expect(groups.filter(group => group.kind === "tool").map(group => group.part.toolCallId)).toEqual(["failed-browser", "failed-command", "saved"]);
      expect(groups.at(-1)).toEqual({ kind: "text", text: "草稿已保存；发布仍需处理登录问题。" });
    }
    expect(JSON.stringify(parts)).toBe(before);
    expect(getAssistantRenderGroups([parts[1], parts[2]], true)).toHaveLength(2);
  });

  test("finds a completed schedule import across OpenCode and MCP tool result envelopes", () => {
    const messages = [{
      id: "assistant-schedule",
      role: "assistant",
      parts: [{
        type: "dynamic-tool",
        toolName: "ipollowork.ipollowork_schedule_apply",
        toolCallId: "schedule-call",
        state: "output-available",
        input: { previewId: "schedule-preview" },
        output: {
          content: [{
            type: "text",
            text: JSON.stringify({
              ok: true,
              items: [
                { id: "later", startAt: 1787734800000 },
                { id: "earlier", startAt: 1787648400000 },
              ],
            }),
          }],
        },
      }],
    }] satisfies Parameters<typeof getScheduleApplyResult>[0]

    expect(getScheduleApplyResult(messages)).toEqual({
      itemCount: 2,
      focusAt: 1787648400000,
    })
  })

  test("keeps process details mounted and user-controlled across stream updates", () => {
    const source = readFileSync(new URL("../src/components/chat/message-list.tsx", import.meta.url), "utf8");
    expect(source).toContain('className="chat-process-disclosure" data-open={isOpen} inert={!isOpen}');
    expect(source).toContain("const [isOpen, setIsOpen] = React.useState(false)");
    expect(source).not.toContain("setManualOpen");
  });

  test("separates unphased tool explanations, drafts and final text without altering history", () => {
    const messages = [
      { id: "explanation", role: "assistant", parts: [{ type: "text", text: "I need to inspect generationPath and copy assets", state: "done" }] },
      { id: "tools", role: "assistant", parts: [{ type: "dynamic-tool", toolName: "image_generation", toolCallId: "image", state: "output-available", input: {}, output: "saved" }] },
      { id: "answer", role: "assistant", parts: [{ type: "text", text: "图片已保存。", state: "streaming" }] },
    ] satisfies Parameters<typeof getAssistantMessagePresentations>[0];
    const original = JSON.stringify(messages);
    const live = getAssistantMessagePresentations(messages, { running: true });
    expect(live.get("explanation")).toBe("progress");
    expect(live.get("answer")).toBe("draft");
    const done = getAssistantMessagePresentations(messages, { running: false });
    expect(done.get("explanation")).toBe("progress");
    expect(done.get("answer")).toBe("answer");
    expect(JSON.stringify(messages)).toBe(original);
  });

  test("streams plain chat immediately but holds unclassified artifact task text", () => {
    const messages = [{ id: "text", role: "assistant", parts: [{ type: "text", text: "普通回答", state: "streaming" }] }] satisfies Parameters<typeof getAssistantMessagePresentations>[0];
    expect(getAssistantMessagePresentations(messages, { running: true }).get("text")).toBe("answer");
    expect(getAssistantMessagePresentations(messages, { running: true, artifactTask: true }).get("text")).toBe("draft");
  });

  test("honors common final metadata while keeping commentary inspectable", () => {
    const messages = [
      { id: "progress", role: "assistant", metadata: { ipollowork: { messagePhase: "commentary" } }, parts: [{ type: "text", text: "Working" }] },
      { id: "final", role: "assistant", metadata: { ipollowork: { messagePhase: "final_answer" } }, parts: [{ type: "text", text: "Done" }] },
    ] satisfies Parameters<typeof getAssistantMessagePresentations>[0];
    expect(isAssistantCommentaryMessage(messages[0])).toBe(true);
    expect(isAssistantFinalAnswerMessage(messages[1])).toBe(true);
    expect(getAssistantMessagePresentations(messages, { running: true }).get("progress")).toBe("progress");
    expect(getAssistantMessagePresentations(messages, { running: true, artifactTask: true }).get("final")).toBe("answer");
  });

  test("keeps tool-prefacing text in process even when it shares a tool message", () => {
    const message = { id: "mixed", role: "assistant", parts: [
      { type: "text", text: "Checking the source", state: "done" },
      { type: "dynamic-tool", toolName: "read", toolCallId: "read", input: {}, state: "output-available", output: "content" },
    ] } satisfies Parameters<typeof getAssistantMessagePresentations>[0][number];
    expect(getAssistantMessagePresentations([message], { running: false }).get("mixed")).toBe("progress");
    const groups = getAssistantRenderGroups([...message.parts, { type: "text", text: "Final response", state: "done" }], true);
    const sections = splitAssistantRenderGroups(groups);
    expect(sections.resultGroups).toEqual([{ kind: "text", text: "Final response" }]);
    expect(sections.processGroups[0]).toEqual({ kind: "text", text: "Checking the source" });
  });

  test("keeps a follow-up waiting state off the completed assistant turn", () => {
    const previousTurn = [
      { id: "user-1", role: "user", parts: [{ type: "text", text: "First question" }] },
      { id: "assistant-1", role: "assistant", parts: [{ type: "text", text: "First answer" }] },
    ] satisfies Parameters<typeof getActiveAssistantMessageId>[0];
    const followUpBaseline = previousTurn.length;

    expect(getActiveAssistantMessageId(previousTurn, followUpBaseline)).toBeUndefined();

    const awaitingFollowUp = [
      ...previousTurn,
      { id: "user-2", role: "user", parts: [{ type: "text", text: "Second question" }] },
    ] satisfies Parameters<typeof getActiveAssistantMessageId>[0];
    expect(getActiveAssistantMessageId(awaitingFollowUp, followUpBaseline)).toBeUndefined();
    expect(getActiveAssistantMessageId(awaitingFollowUp)).toBeUndefined();

    const respondingToFollowUp = [
      ...awaitingFollowUp,
      { id: "assistant-2", role: "assistant", parts: [{ type: "reasoning", text: "Working", state: "streaming" }] },
    ] satisfies Parameters<typeof getActiveAssistantMessageId>[0];
    expect(getActiveAssistantMessageId(respondingToFollowUp, followUpBaseline)).toBe("assistant-2");
    expect(getActiveAssistantMessageId(respondingToFollowUp)).toBe("assistant-2");
    expect(hasActiveAssistantVisibleResult(respondingToFollowUp, followUpBaseline)).toBe(false);
  });

  test("keeps the waiting placeholder when OpenCode has only emitted an empty assistant shell", () => {
    const awaitingAssistantParts = [
      { id: "user-1", role: "user", parts: [{ type: "text", text: "1" }] },
      { id: "assistant-shell", role: "assistant", parts: [] },
    ] satisfies Parameters<typeof getActiveAssistantMessageId>[0];

    expect(getActiveAssistantMessageId(awaitingAssistantParts)).toBeUndefined();

    const reasoningStarted = [
      { id: "user-1", role: "user", parts: [{ type: "text", text: "1" }] },
      { id: "assistant-shell", role: "assistant", parts: [{ type: "reasoning", text: "正在处理", state: "streaming" }] },
    ] satisfies Parameters<typeof getActiveAssistantMessageId>[0];

    expect(getActiveAssistantMessageId(reasoningStarted)).toBe("assistant-shell");
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

    expect(sections.processGroups).toEqual(groups);
    expect(sections.resultGroups).toEqual([]);
  });

  test("keeps automatic compaction continuations inside one assistant turn", () => {
    const messages = [
      { id: "user-1", role: "user", parts: [{ type: "text", text: "Update the video" }] },
      { id: "assistant-1", role: "assistant", parts: [{ type: "reasoning", text: "Starting", state: "done" }] },
      { id: "compaction", role: "user", parts: [] },
      { id: "assistant-2", role: "assistant", parts: [{ type: "reasoning", text: "Continuing", state: "done" }] },
      { id: "continue", role: "user", parts: [] },
      { id: "assistant-3", role: "assistant", parts: [{ type: "text", text: "Finished" }] },
      { id: "user-2", role: "user", parts: [{ type: "text", text: "One more change" }] },
    ] satisfies Parameters<typeof groupMessages>[0];

    const items = groupMessages(messages);

    expect(items).toHaveLength(3);
    expect(isMessageGroup(items[1])).toBe(true);
    if (!isMessageGroup(items[1])) throw new Error("Expected one assistant message group");
    expect(items[1].messages.map((item) => item.message.id)).toEqual([
      "assistant-1",
      "assistant-2",
      "assistant-3",
    ]);
  });
});

test("native agent completion replaces its earlier spinner while retaining failed task diagnostics", () => {
  const activity = (id: string, state: "input-streaming" | "output-available" | "output-error") => ({
    type: "dynamic-tool" as const, toolName: "task", toolCallId: id, state,
    input: { task_id: "child" },
    callProviderMetadata: { ipollowork: { nativeTool: "subAgentActivity", sessionId: "child" } },
  });
  const done = activity("done", "output-available");
  expect(getAssistantRenderGroups([activity("start", "input-streaming"), done], false))
    .toEqual([{ kind: "tool", part: done }]);
  const start = activity("earlier-message", "input-streaming");
  const transcriptParts = [start, done];
  expect(getAssistantRenderGroups([start], false, transcriptParts)).toEqual([]);
  expect(getAssistantRenderGroups([done], false, transcriptParts)).toEqual([{ kind: "tool", part: done }]);
  const failed = activity("failed", "output-error");
  expect(getAssistantRenderGroups([activity("start", "input-streaming"), failed], false))
    .toEqual([{ kind: "tool", part: failed }]);
});
