import { DEEPSEEK_HARNESS_ENGINE_ID } from "@ipollowork/types/workspace";

import { DeepSeekHarnessClient } from "@/app/lib/deepseek-harness-client";
import { t } from "@/i18n";
import {
  type ConversationEngineAdapter,
  type ConversationEngineConnection,
  type ConversationMode,
  type ConversationPermission,
  type ConversationPromptPart,
  type ConversationQuestion,
} from "./conversation-engine";
import {
  deepSeekHarnessForkSeq,
  deepSeekHarnessNativeRpcId,
  DEEPSEEK_HARNESS_INTERNAL_SYSTEM_PREFIX,
  mapDeepSeekHarnessEnvelope,
  mapDeepSeekHarnessSession,
  mapDeepSeekHarnessSnapshot,
  normalizeDeepSeekHarnessErrorText,
  type DeepSeekHarnessLiveState,
} from "./deepseek-harness-conversation-mapper";

type AgentPresetList = {
  presets: Array<{
    id: string;
    isDefault: boolean;
    name?: string;
    description?: string;
    broken?: string;
  }>;
};

function modePresentation(id: string): Pick<ConversationMode, "label" | "description" | "icon"> | null {
  const modes: Record<string, Pick<ConversationMode, "label" | "description" | "icon">> = {
    standard: {
      label: t("composer.work_mode_dsh_standard"),
      description: t("composer.work_mode_dsh_standard_description"),
      icon: "execute",
    },
    code: {
      label: t("composer.work_mode_dsh_code"),
      description: t("composer.work_mode_dsh_code_description"),
      icon: "code",
    },
    minimal: {
      label: t("composer.work_mode_dsh_minimal"),
      description: t("composer.work_mode_dsh_minimal_description"),
      icon: "minimal",
    },
    cordis: {
      label: t("composer.work_mode_dsh_create"),
      description: t("composer.work_mode_dsh_create_description"),
      icon: "create",
    },
  };
  return modes[id] ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nativeFrame(value: unknown): Record<string, unknown> | null {
  return isRecord(value) && isRecord(value.frame) ? value.frame : null;
}

function conversationError(error: unknown) {
  const message = error instanceof Error ? error.message : error;
  return new Error(normalizeDeepSeekHarnessErrorText(message), { cause: error });
}

function textDataUrl(url: string): string | null {
  const match = /^data:(text\/[^;,]+)(;base64)?,([\s\S]*)$/u.exec(url);
  if (!match?.[1] || match[3] === undefined) return null;
  if (!match[2]) return decodeURIComponent(match[3]);
  const bytes = Uint8Array.from(atob(match[3]), (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function internalPromptText(text: string): string {
  if (text.startsWith(DEEPSEEK_HARNESS_INTERNAL_SYSTEM_PREFIX)) return text;
  return `${DEEPSEEK_HARNESS_INTERNAL_SYSTEM_PREFIX}${text}\n</system>`;
}

function promptContent(parts: ConversationPromptPart[], system?: string) {
  const content: Array<
    { type: "text"; text: string }
    | { type: "image"; mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif"; data: string; name?: string }
  > = [];
  for (const part of parts) {
    if (part.type === "text") {
      content.push({ type: "text", text: part.synthetic ? internalPromptText(part.text) : part.text });
      continue;
    }
    if (part.type === "agent") {
      content.push({ type: "text", text: `@${part.name}` });
      continue;
    }
    const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/u.exec(part.url);
    if (match?.[1] && match[2]) {
      content.push({
        type: "image",
        mediaType: match[1] as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
        data: match[2],
        ...(part.filename ? { name: part.filename } : {}),
      });
      continue;
    }
    const text = textDataUrl(part.url);
    if (text !== null) {
      content.push({ type: "text", text: `[Attached file: ${part.filename || "file"}]\n${text}` });
      continue;
    }
    if (part.url.startsWith("data:")) {
      throw new Error("DeepSeek Harness supports raster images and text attachments in conversations");
    }
    content.push({
      type: "text",
      text: `[Attached file: ${part.filename || "file"}]\n${part.url}`,
    });
  }
  if (system?.trim()) {
    content.push({
      type: "text",
      text: internalPromptText(system.trim()),
    });
  }
  return content;
}

function deepSeekHarnessConnection(input: {
  serverBaseUrl?: string;
  workspaceId?: string;
  token?: string;
  directory?: string;
}): ConversationEngineConnection {
  if (!input.serverBaseUrl || !input.workspaceId) {
    throw new Error("DeepSeek Harness requires an iPolloWork workspace endpoint");
  }
  const client = new DeepSeekHarnessClient({
    serverBaseUrl: input.serverBaseUrl,
    workspaceId: input.workspaceId,
    token: input.token,
  });
  const permissions = new Map<string, ConversationPermission>();
  const questions = new Map<string, ConversationQuestion>();
  const liveState: DeepSeekHarnessLiveState = { parts: new Set(), tools: new Map() };
  let agentPresets: AgentPresetList | null = null;
  const selectedModels = new Map<string, string>();
  const selectedModes = new Map<string, string>();
  const mutableModes = new Map<string, boolean>();

  const listAgentPresets = async () => {
    agentPresets ??= await client.call<AgentPresetList>("agentPreset.list", {});
    return agentPresets;
  };

  const selectModel = async (request: {
    sessionId: string;
    model?: { providerID: string; modelID: string };
    reasoningEffort?: string;
    variant?: string;
  }) => {
    if (!request.model) return;
    const reasoningEffort = request.reasoningEffort || request.variant;
    const selectionKey = `${request.model.providerID}/${request.model.modelID}/${reasoningEffort ?? ""}`;
    if (selectedModels.get(request.sessionId) === selectionKey) return;
    await client.call("session.selectModel", {
      sessionId: request.sessionId,
      provider: request.model.providerID,
      model: request.model.modelID,
      ...(reasoningEffort ? { reasoningEffort } : {}),
    });
    selectedModels.set(request.sessionId, selectionKey);
  };

  const selectMode = async (sessionId: string, mode?: string) => {
    if (!mode || mutableModes.get(sessionId) === false || selectedModes.get(sessionId) === mode) return;
    const presets = await listAgentPresets();
    if (!presets.presets.some((preset) => preset.id === mode && !preset.broken)) return;
    await client.call("agentPreset.select", { sessionId, agentPreset: mode });
    selectedModes.set(sessionId, mode);
  };

  return {
    mapSnapshot(snapshot) {
      const mapped = mapDeepSeekHarnessSnapshot(snapshot);
      const dsh = isRecord(mapped.session.dsh) ? mapped.session.dsh : null;
      if (dsh && typeof dsh.agentPreset === "string") {
        selectedModes.set(mapped.session.id, dsh.agentPreset);
      }
      if (dsh && typeof dsh.blank === "boolean") mutableModes.set(mapped.session.id, dsh.blank);
      return mapped;
    },
    modeState(session) {
      const dsh = isRecord(session.dsh) ? session.dsh : null;
      return {
        id: dsh && typeof dsh.agentPreset === "string"
          ? dsh.agentPreset
          : selectedModes.get(session.id) ?? null,
        mutable: mutableModes.get(session.id) ?? (!dsh || dsh.blank !== false),
      };
    },
    async subscribe(subscription) {
      const consume = async (stream: "mux" | "host") => {
        for await (const envelope of client.events(stream, subscription.signal)) {
          for (const event of mapDeepSeekHarnessEnvelope(envelope, liveState)) {
            if (event.type === "permission.asked") permissions.set(event.permission.id, event.permission);
            if (event.type === "permission.replied") permissions.delete(event.requestId);
            if (event.type === "question.asked") questions.set(event.question.id, event.question);
            if (event.type === "question.replied") questions.delete(event.requestId);
            subscription.onEvent(event);
          }
        }
      };
      await Promise.all([consume("mux"), consume("host")]);
    },
    async listPermissions(request) {
      return [...permissions.values()].filter((permission) => permission.sessionId === request.sessionId);
    },
    async replyPermission(request) {
      const rpcId = deepSeekHarnessNativeRpcId(request.permission.native);
      if (!rpcId) throw new Error("DeepSeek Harness permission response is no longer available");
      await client.respond(rpcId, {
        ok: true,
        value: {
          sessionId: request.permission.sessionId,
          approvalId: request.permission.id,
          outcome: request.reply === "reject" ? "rejected" : "allowed-once",
        },
      });
      permissions.delete(request.permission.id);
    },
    async listQuestions(request) {
      return [...questions.values()].filter((question) => question.sessionId === request.sessionId);
    },
    async replyQuestion(request) {
      const rpcId = deepSeekHarnessNativeRpcId(request.question.native);
      const frame = nativeFrame(request.question.native);
      if (!rpcId || !frame || !Array.isArray(frame.questions)) {
        throw new Error("DeepSeek Harness question response is no longer available");
      }
      const answers = frame.questions.flatMap((question, index) => {
        if (!isRecord(question) || typeof question.id !== "string") return [];
        const selected = request.answers[index] ?? [];
        const optionLabels = new Set(
          Array.isArray(question.options)
            ? question.options.flatMap((option) => isRecord(option) && typeof option.label === "string" ? [option.label] : [])
            : [],
        );
        return [{
          id: question.id,
          selected: selected.filter((value) => optionLabels.has(value)),
          ...(selected.find((value) => !optionLabels.has(value))
            ? { custom: selected.find((value) => !optionLabels.has(value)) }
            : {}),
        }];
      });
      await client.respond(rpcId, {
        ok: true,
        value: { sessionId: request.question.sessionId, answer: { answers } },
      });
      questions.delete(request.question.id);
    },
    async create(directory) {
      const result = await client.call<{ sessionId: string; agentPreset?: string }>("session.create", {
        cwd: directory || input.directory,
      });
      if (result.agentPreset) selectedModes.set(result.sessionId, result.agentPreset);
      mutableModes.set(result.sessionId, true);
      return {
        id: result.sessionId,
        title: "New conversation",
        slug: result.sessionId,
        directory: directory || input.directory,
        time: { created: Date.now(), updated: Date.now() },
        ...(result.agentPreset ? { dsh: { agentPreset: result.agentPreset } } : {}),
      };
    },
    async abort(sessionId) {
      await client.call("session.cancel", { sessionId });
      return true;
    },
    async revert() {
      throw new Error("DeepSeek Harness does not expose conversation revert");
    },
    async fork(request) {
      const result = await client.call<{ sessionId: string }>("session.fork", {
        sessionId: request.sessionId,
        ...(deepSeekHarnessForkSeq(request.messages, request.messageId) !== undefined
          ? { atSeq: deepSeekHarnessForkSeq(request.messages, request.messageId) }
          : {}),
      });
      const agentPreset = selectedModes.get(request.sessionId);
      if (agentPreset) selectedModes.set(result.sessionId, agentPreset);
      mutableModes.set(result.sessionId, false);
      return {
        id: result.sessionId,
        title: "New conversation",
        slug: result.sessionId,
        parentID: request.sessionId,
        directory: input.directory,
        time: { created: Date.now(), updated: Date.now() },
        dsh: { blank: false, ...(agentPreset ? { agentPreset } : {}) },
      };
    },
    async rename(sessionId, title) {
      await client.call("session.rename", { sessionId, title });
    },
    async setArchived(sessionId, archived) {
      if (!archived) throw new Error("DeepSeek Harness does not expose conversation unarchive");
      await client.call("workspace.archiveSession", { sessionId });
    },
    async shell() {
      throw new Error("DeepSeek Harness does not expose direct shell execution through its conversation API");
    },
    async runCommand(request) {
      try {
        await selectModel(request);
        await client.call("session.prompt", {
          sessionId: request.sessionId,
          mode: "queue",
          content: [{ type: "text", text: `/${request.command}${request.arguments ? ` ${request.arguments}` : ""}` }],
          clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
        mutableModes.set(request.sessionId, false);
      } catch (error) {
        throw conversationError(error);
      }
    },
    async sendPrompt(request) {
      try {
        await selectMode(request.sessionId, request.mode);
        await selectModel(request);
        await client.call("session.prompt", {
          sessionId: request.sessionId,
          mode: "queue",
          content: promptContent(request.parts, request.system),
          clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
        mutableModes.set(request.sessionId, false);
      } catch (error) {
        throw conversationError(error);
      }
    },
    async listCommands() {
      return [];
    },
    async listModes() {
      return (await listAgentPresets()).presets
        .filter((preset) => !preset.broken)
        .map((preset) => ({
          id: preset.id,
          ...(modePresentation(preset.id) ?? {
            label: preset.name || preset.id,
            description: preset.description,
            icon: "execute" as const,
          }),
          isDefault: preset.isDefault,
        }));
    },
    async listAgents() {
      return [];
    },
    async searchFiles() {
      return [];
    },
  };
}

export const deepSeekHarnessConversationEngineAdapter: ConversationEngineAdapter = {
  id: DEEPSEEK_HARNESS_ENGINE_ID,
  connect: deepSeekHarnessConnection,
};
