import type { ToolPart } from "@opencode-ai/sdk/v2/client";
import type { DynamicToolUIPart, TextUIPart } from "ai";

import { safeStringify } from "@/app/utils";

export const STRUCTURED_OUTPUT_TOOL = "StructuredOutput";

function shouldDeferInProgressTool(part: ToolPart) {
  if (part.state.status === "completed" || part.state.status === "error") {
    return false;
  }

  return Object.keys(part.state.input).length === 0;
}

export function parseStructuredOutputUIPart(part: ToolPart): TextUIPart | null {
  if (part.state.status === "error") {
    return null;
  }

  const text = safeStringify(part.state.input);

  if (text === "{}" && part.state.status !== "completed") {
    return null;
  }

  return {
    type: "text",
    text,
    state: part.state.status === "completed" ? "done" : "streaming",
    providerMetadata: { ipollowork: { partId: `structured-output-${part.callID}`, toolPartId: part.id } },
  };
}

export function parseDynamicToolUIPart(part: ToolPart): DynamicToolUIPart | null {
  if (part.tool === STRUCTURED_OUTPUT_TOOL) {
    return null;
  }

  const metadata = "metadata" in part.state ? part.state.metadata : undefined;
  const childSessionId = part.tool === "task"
    ? metadata?.sessionId ?? part.state.input.task_id
    : undefined;
  const callProviderMetadata = { ipollowork: {
    partId: part.id,
    ...(typeof childSessionId === "string" && childSessionId ? {
      sessionId: childSessionId,
      parentSessionId: part.sessionID,
      nativeTool: typeof metadata?.nativeTool === "string" ? metadata.nativeTool : "task",
      ...(typeof metadata?.nativeKind === "string" ? { nativeKind: metadata.nativeKind } : {}),
      delegationStatus: part.state.status === "completed" ? "completed"
        : part.state.status === "error" ? "failed" : "running",
    } : {}),
  } };

  if (part.state.status === "error") {
    return {
      type: "dynamic-tool",
      toolName: part.tool,
      toolCallId: part.callID,
      state: "output-error",
      input: part.state.input,
      errorText: part.state.error,
      callProviderMetadata,
    };
  }

  if (part.state.status === "completed") {
    return {
      type: "dynamic-tool",
      toolName: part.tool,
      toolCallId: part.callID,
      state: "output-available",
      input: part.state.input,
      output: part.state.output,
      callProviderMetadata,
    };
  }

  // OpenCode emits pending/running tool parts with `{}` input before args
  // (e.g. filePath) are filled in. Skip UI until the next part.updated.
  if (shouldDeferInProgressTool(part)) {
    return null;
  }

  return {
    type: "dynamic-tool",
    toolName: part.tool,
    toolCallId: part.callID,
    state: "input-streaming",
    input: part.state.input,
    callProviderMetadata,
  };
}
