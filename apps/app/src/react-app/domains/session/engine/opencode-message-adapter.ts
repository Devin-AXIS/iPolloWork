/** @jsxImportSource react */
import type { UIMessage } from "ai";
import { classifyProviderFailure, providerFailureMessages, serviceErrorMessage } from "@ipollowork/types/provider-errors";
import type { FilePart, Part, ToolPart } from "@opencode-ai/sdk/v2/client";

import type { iPolloWorkSessionSnapshot } from "../../../../app/lib/ipollowork-server";
import { SYNTHETIC_SESSION_ERROR_MESSAGE_PREFIX } from "../../../../app/types";
import { parseDesignAiSelectionDisplayMetadata } from "@ipollowork/design-studio";
import { parseHyperframesAnimationDisplayMetadata } from "@/app/lib/hyperframes-effect-params";
import { t } from "@/i18n";
import { parseVideoVoiceDisplayMetadata } from "../video/video-voice";
import {
  conversationContextUsageFromTokens,
  conversationMessageMetadata,
} from "./conversation-engine";
import {
  parseDynamicToolUIPart,
  parseStructuredOutputUIPart,
  STRUCTURED_OUTPUT_TOOL,
} from "./opencode-tool-parts";

export function describeConversationSessionError(error: unknown, fallback = t("message.session_failed")) {
  const message = typeof error === "string" ? error.trim() : error instanceof Error ? error.message.trim() : "";
  const name = error && typeof error === "object" && "name" in error ? error.name : undefined;
  if (name === "MessageAbortedError" || /MessageAbortedError|run was interrupted before it finished/i.test(message)) {
    return "The run was interrupted before it finished.";
  }
  if (name === "ProviderAuthError") return providerFailureMessages.provider_auth_failed;
  const failure = classifyProviderFailure(error);
  if (failure) return failure.code === "provider_rate_limited" ? t("message.rate_limit_error") : failure.message;
  if (message === t("session.deepseek_harness_model_unavailable")) return providerFailureMessages.provider_model_unavailable;
  if (error instanceof Error || /^[{\[<]/.test(message)
    || /(?:responseBody|responseHeaders|request[_-]?id|statusCode)\s*["']?\s*[:=]/i.test(message)) return fallback;
  return message ? serviceErrorMessage(message) : fallback;
}

// Internal conversation events may carry friendly text from the engine
// adapter. Only known provider reasons go into desktop notifications.
export function conversationNotificationError(text: string) {
  return classifyProviderFailure(text)?.message ?? t("session.run_failed_hint");
}

export function describeOpenCodeFinishError(finish: unknown) {
  switch (finish) {
    case "content-filter":
    case "content_filter": return providerFailureMessages.provider_content_filtered;
    case "length": return providerFailureMessages.provider_output_limit;
    case "insufficient_system_resource": return providerFailureMessages.provider_unavailable;
    case "error": return t("session.run_failed_title");
    default: return null;
  }
}


function sessionErrorMessageId(turnKey: string) {
  return `${SYNTHETIC_SESSION_ERROR_MESSAGE_PREFIX}${turnKey}`;
}

/**
 * Build the synthetic chat message that surfaces a session error.
 *
 * The error is keyed to the *turn* that failed (`turnKey`), not the session.
 * Both the live `session.error` event and the snapshot reload derive the same
 * `turnKey` from the errored assistant message id, so they reconcile to one
 * message instead of duplicating — while a brand new error on a later turn
 * still produces its own message instead of overwriting the previous one.
 */
export function createSessionErrorUIMessage(
  turnKey: string,
  text: string,
  options?: { created?: number; parentUserMessageId?: string },
): UIMessage {
  const id = sessionErrorMessageId(turnKey);
  const created = options?.created;
  const parentUserMessageId = options?.parentUserMessageId?.trim();
  const metadata = conversationMessageMetadata(
    { created },
    parentUserMessageId ? { parentUserMessageId } : {},
  );
  return {
    id,
    role: "assistant",
    ...(metadata ? { metadata } : {}),
    parts: [{
      type: "text",
      text,
      state: "done",
      providerMetadata: { ipollowork: { partId: `${id}:text` } },
    }],
  };
}

function fileProviderMetadata(part: FilePart) {
  if (part.source) {
    return { ipollowork: { partId: part.id, source: part.source } };
  }
  return { ipollowork: { partId: part.id } };
}

function getTextPartValue(part: Part) {
  if (part.type === "text") {
    return part.text;
  }
  if (part.type === "reasoning") {
    return part.text;
  }
  return "";
}

function mapFilePart(part: FilePart): UIMessage["parts"][number] {
  return {
    type: "file",
    url: part.url,
    filename: part.filename,
    mediaType: part.mime,
    providerMetadata: fileProviderMetadata(part),
  };
}

function mapFileSourcePart(part: FilePart): UIMessage["parts"][number] | null {
  const source = part.source;
  if (!source) return null;

  const sourceId = `${part.id}:source`;
  const providerMetadata = { ipollowork: { partId: sourceId, sourcePartId: part.id, source } };

  if (source.type === "resource") {
    if (source.uri.startsWith("http://")) {
      return { type: "source-url", sourceId, url: source.uri, title: source.uri, providerMetadata };
    }
    if (source.uri.startsWith("https://")) {
      return { type: "source-url", sourceId, url: source.uri, title: source.uri, providerMetadata };
    }
    return { type: "source-document", sourceId, mediaType: part.mime, title: source.uri, providerMetadata };
  }

  if (source.type === "symbol") {
    return { type: "source-document", sourceId, mediaType: part.mime, title: source.name, filename: source.path, providerMetadata };
  }

  return { type: "source-document", sourceId, mediaType: part.mime, title: source.path, filename: source.path, providerMetadata };
}

function mapFileParts(part: FilePart): UIMessage["parts"] {
  const sourcePart = mapFileSourcePart(part);
  if (sourcePart) return [mapFilePart(part), sourcePart];
  return [mapFilePart(part)];
}

export function opencodePartHasVisibleAssistantOutput(part: Part) {
  if (part.type === "text" && part.synthetic) return false;
  if (part.type === "text" && part.ignored) return false;
  const partType = String(part.type);
  if ("text" in part && typeof part.text === "string" && part.text.trim().length > 0) return true;
  return partType === "tool" || partType === "file" || partType === "agent";
}

export function mapOpencodePartToUIParts(part: Part): UIMessage["parts"] {
  if (part.type === "text") {
    if (part.synthetic) {
      const metadataParts: UIMessage["parts"] = [];
      const selection = parseDesignAiSelectionDisplayMetadata(part.text);
      if (selection) metadataParts.push({
        type: "data-design-selection" as const,
        data: { ...selection, partId: `${part.id}:design-selection` },
      });
      const animations = parseHyperframesAnimationDisplayMetadata(part.text);
      if (animations) metadataParts.push({
        type: "data-animation-references" as const,
        data: { items: animations, partId: `${part.id}:animation-references` },
      });
      const voice = parseVideoVoiceDisplayMetadata(part.text);
      if (voice) metadataParts.push({
        type: "data-voice-reference" as const,
        data: { ...voice, partId: `${part.id}:voice-reference` },
      });
      return metadataParts;
    }
    if (part.ignored) return [];
    return [{
      type: "text",
      text: getTextPartValue(part),
      state: part.time && !part.time.end ? "streaming" : "done",
      providerMetadata: { ipollowork: { partId: part.id } },
    }];
  }
  if (part.type === "reasoning") {
    return [{
      type: "reasoning",
      text: getTextPartValue(part),
      state: part.time && !part.time.end ? "streaming" : "done",
      providerMetadata: { ipollowork: { partId: part.id } },
    }];
  }
  if (part.type === "file") return mapFileParts(part);
  if (part.type === "tool") return mapSnapshotToolParts(part);
  if (part.type === "agent") {
    return [{
      type: "text",
      text: part.name ? `@${part.name}` : "@agent",
      state: "done",
      providerMetadata: { ipollowork: { partId: part.id } },
    }];
  }
  if (part.type === "step-start") {
    return [{ type: "step-start" }];
  }
  return [];
}

function mapSnapshotToolParts(part: ToolPart): UIMessage["parts"] {
  if (part.tool === STRUCTURED_OUTPUT_TOOL) {
    const mapped = parseStructuredOutputUIPart(part);
    return mapped ? [mapped] : [];
  }

  const mapped = parseDynamicToolUIPart(part);
  if (!mapped) return [];

  if (part.state.status === "completed" && part.state.attachments) {
    return [mapped, ...part.state.attachments.flatMap(mapFileParts)];
  }

  return [mapped];
}

export function snapshotToUIMessages(snapshot: iPolloWorkSessionSnapshot): UIMessage[] {
  return snapshot.messages.flatMap((message) => {
    if (message.info.role === "assistant" && message.info.summary === true) return [];
    const created = message.info.time?.created;
    const completed = message.info.time && "completed" in message.info.time
      ? message.info.time.completed
      : undefined;
    const contextUsage = message.info.role === "assistant" && "tokens" in message.info
      ? conversationContextUsageFromTokens(message.info.tokens)
      : undefined;
    const parentUserMessageId = message.info.role === "assistant" && "parentID" in message.info
      && typeof message.info.parentID === "string"
      ? message.info.parentID.trim()
      : "";
    const codexPhase = "codexPhase" in message.info ? message.info.codexPhase : undefined;
    const metadata = conversationMessageMetadata(
      { created, completed },
      {
        ...(contextUsage ? { contextUsage } : {}),
        ...(parentUserMessageId ? { parentUserMessageId } : {}),
        ...(codexPhase === "commentary" || codexPhase === "final_answer" ? { codexPhase } : {}),
      },
    );
    const uiMessage = {
      id: message.info.id,
      role: message.info.role,
      ...(metadata ? { metadata } : {}),
      parts: message.parts.flatMap(mapOpencodePartToUIParts),
    };

    // Surface a failed turn as its own synthetic error message keyed by its
    // parent user message whenever available. Live runtime errors use that
    // same turn key, so a snapshot reload dedupes the error while consecutive
    // failed prompts remain independent rows.
    const assistant = message.info.role === "assistant" ? message.info : null;
    const error = assistant?.error ? describeConversationSessionError(assistant.error) : describeOpenCodeFinishError(assistant?.finish);
    if (!error) return [uiMessage];

    const errorMessage = createSessionErrorUIMessage(parentUserMessageId || message.info.id, error, {
      created,
      ...(parentUserMessageId ? { parentUserMessageId } : {}),
    });
    return uiMessage.parts.length > 0 ? [uiMessage, errorMessage] : [errorMessage];
  });
}
